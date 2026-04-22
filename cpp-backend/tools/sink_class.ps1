# Generic header-to-impl sinker for a single class definition.
# Reads ${HeaderPath}, identifies `class ${ClassName}` body,
# emits a slim header (declarations + inline templates) and a .cpp with bodies qualified.
#
# Usage:
#   .\sink_class.ps1 -HeaderPath <path> -ClassName <name> [-CppPath <path>] `
#       [-CppExtraIncludes @('"foo.h"','<bar>')] [-KeepInlineMethods @('hashPassword')]
#
# Limitations:
# - Single class per header
# - Templates inside the class are KEPT in the header (not moved)
# - Friend declarations / nested types not handled
# - Default args on member-function definitions are stripped (kept in declarations)

param(
    [Parameter(Mandatory=$true)] [string]$HeaderPath,
    [Parameter(Mandatory=$true)] [string]$ClassName,
    [string]$CppPath,
    [string[]]$CppExtraIncludes = @(),
    [string[]]$KeepInlineMethods = @(),
    [string[]]$HeaderExtraIncludes = @()
)

$ErrorActionPreference = 'Stop'

if (-not $CppPath) {
    $CppPath = [System.IO.Path]::ChangeExtension($HeaderPath, '.cpp')
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText($HeaderPath, $utf8)
$lines = $content -split "`r?`n"

# --- Locate `class <ClassName>` and matching `};` and namespace boundaries ---
$classDeclIdx = $null
for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match "^\s*class\s+$ClassName\b") { $classDeclIdx = $i; break }
}
if ($null -eq $classDeclIdx) { throw "class $ClassName not found in $HeaderPath" }

# Find the `{` that opens the class body (could be on same line or next line)
$openIdx = $null
for ($i = $classDeclIdx; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match '^\s*\{\s*$' -or $lines[$i] -match '\{\s*$') { $openIdx = $i; break }
}
if ($null -eq $openIdx) { throw "class body opening { not found" }

# Find matching `};` by brace tracking starting at openIdx
$depth = 0
$closeIdx = $null
$started = $false
for ($i = $openIdx; $i -lt $lines.Length; $i++) {
    $ln = $lines[$i]
    # crude brace count (ignores braces inside strings/comments — sufficient for clean source)
    foreach ($ch in $ln.ToCharArray()) {
        if ($ch -eq '{') { $depth++; $started = $true }
        elseif ($ch -eq '}') { $depth-- }
    }
    if ($started -and $depth -eq 0) { $closeIdx = $i; break }
}
if ($null -eq $closeIdx) { throw "matching }; for class not found" }

# Find namespace lines (keep header preamble through `namespace ... {` and trailing `}  // namespace`)
$preambleEnd = $classDeclIdx - 1  # everything before `class X` is preamble
# But we want to KEEP the namespace open line; find it
$nsOpenIdx = $null
for ($i = $classDeclIdx - 1; $i -ge 0; $i--) {
    if ($lines[$i] -match '^\{\s*$' -or $lines[$i] -match '^\s*\{\s*$') {
        # likely the `{` after `namespace foo`
        if ($i -ge 1 -and $lines[$i-1] -match 'namespace\s') {
            $nsOpenIdx = $i; break
        }
    }
    if ($lines[$i] -match '^namespace\s.*\{\s*$') { $nsOpenIdx = $i; break }
}

# Find the closing `}  // namespace ...` after the class
$nsCloseIdx = $null
for ($i = $closeIdx + 1; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match '^\}\s*//\s*namespace') { $nsCloseIdx = $i; break }
}
if ($null -eq $nsCloseIdx) { $nsCloseIdx = $lines.Length - 1 }

# Capture original includes (preamble before namespace) — we'll keep them in slim header,
# unless HeaderExtraIncludes overrides
$origPreamble = if ($nsOpenIdx -ne $null) { $lines[0..$nsOpenIdx] } else { $lines[0..$preambleEnd] }
$nsCloseLine = $lines[$nsCloseIdx]

# --- Walk class body collecting top-level (depth 1) chunks ---
# At depth 1, a chunk is either:
#   - access label (`public:`/`private:`/`protected:`) — toggles section
#   - declaration ending with `;` — keep as-is in header (member field or pure decl)
#   - template <...> ... { ... } — KEEP in header verbatim
#   - signature ... { body } — function definition: emit decl in header, body in cpp
#
# We track depth char-by-char while accumulating lines into a buffer.
# When we see `;` at depth 1 outside a function body: flush as declaration.
# When we see `{` taking depth from 1->2: previous accumulated lines are signature; consume until depth back to 1, that's body.

$slimMembers = New-Object System.Collections.Generic.List[string]   # lines inside class body (decls + templates + access labels + blank lines + comments)
$cppDefs = New-Object System.Collections.Generic.List[string]       # full function definitions (qualified)
$nestedTypes = New-Object System.Collections.Generic.List[string]   # names of nested struct/class/enum to qualify in cpp signatures

$currentAccess = 'private'  # default for class
$buf = New-Object System.Collections.Generic.List[string]
$d = 1  # we start AT depth 1 (just past opening `{`)
$pendingBlankLines = New-Object System.Collections.Generic.List[string]

function Flush-Buffer-AsDecl {
    param($buffer)
    foreach ($l in $buffer) { $null = $script:slimMembers.Add($l) }
}

function Get-FunctionName {
    param([string]$signatureText)
    # Last identifier immediately before the first '(' that's not inside <...>
    # Strip template type-args in return type by removing matched <...>
    $clean = $signatureText
    # Remove default-arg parts to simplify (we strip again later for cpp)
    $m = [regex]::Match($clean, '([A-Za-z_~][A-Za-z0-9_]*)\s*\(')
    if (-not $m.Success) {
        # try harder: walk all matches and pick last whose position precedes any unmatched '('
        $matches = [regex]::Matches($clean, '([A-Za-z_~][A-Za-z0-9_]*)\s*\(')
        if ($matches.Count -gt 0) { return $matches[0].Groups[1].Value }
        return $null
    }
    return $m.Groups[1].Value
}

function Strip-DefaultArgs {
    param([string]$text)
    # Remove ` = "..."`, ` = 0`, ` = nullptr`, ` = false`, ` = true`, ` = {}` etc.
    $text = [regex]::Replace($text, '\s*=\s*"[^"]*"', '')
    $text = [regex]::Replace($text, "\s*=\s*'[^']*'", '')
    $text = [regex]::Replace($text, '\s*=\s*[A-Za-z0-9_:.+\-]+(?=[,)])', '')
    $text = [regex]::Replace($text, '\s*=\s*\{\s*\}', '')
    return $text
}

# Position cursor immediately after the `{` of class body
# We need to scan lines from openIdx to closeIdx, but skip the brace-only line(s) before depth becomes 1
# Simplest: process lines openIdx+1 through closeIdx-1, treating ourselves as starting at depth 1.
# (If the `{` of class is on its own line, that's openIdx and we start at depth 1 on next line.)

# Verify openIdx contains `{` only (or trailing) — increment past it
$startScan = $openIdx + 1

# closeIdx contains `};` — stop before it
$endScan = $closeIdx - 1

$i = $startScan
while ($i -le $endScan) {
    $ln = $lines[$i]

    # Access label?
    if ($d -eq 1 -and $buf.Count -eq 0 -and $ln -match '^\s*(public|private|protected):\s*$') {
        $currentAccess = $Matches[1]
        $null = $slimMembers.Add($ln)
        $i++
        continue
    }

    # Pure blank line between members at depth 1 — keep
    if ($d -eq 1 -and $buf.Count -eq 0 -and $ln -match '^\s*$') {
        $null = $slimMembers.Add($ln)
        $i++
        continue
    }

    # Pure comment line at depth 1, no buffer — keep in header
    if ($d -eq 1 -and $buf.Count -eq 0 -and $ln -match '^\s*//') {
        $null = $slimMembers.Add($ln)
        $i++
        continue
    }

    # Template at depth 1 — capture entire template (signature + body) verbatim into header
    if ($d -eq 1 -and $buf.Count -eq 0 -and $ln -match '^\s*template\s*<') {
        $tplStart = $i
        # advance past template signature lines until we find `{` at depth-1 -> depth-2 transition
        $td = 1
        $j = $i
        $foundBrace = $false
        while ($j -le $endScan) {
            $tln = $lines[$j]
            foreach ($ch in $tln.ToCharArray()) {
                if ($ch -eq '{') { $td++; $foundBrace = $true }
                elseif ($ch -eq '}') { $td-- }
            }
            if ($foundBrace -and $td -eq 1) { break }
            $j++
        }
        for ($k = $tplStart; $k -le $j; $k++) { $null = $slimMembers.Add($lines[$k]) }
        $i = $j + 1
        continue
    }

    # Otherwise accumulate into buf and update depth char-by-char
    $null = $buf.Add($ln)
    $newDepth = $d
    $foundOpenInThisLine = $false
    foreach ($ch in $ln.ToCharArray()) {
        if ($ch -eq '{') { $newDepth++; $foundOpenInThisLine = $true }
        elseif ($ch -eq '}') { $newDepth-- }
    }

    # Did we just enter a function body? (depth went from 1 to 2 via this line)
    # Also handle inline single-line functions (e.g. `Foo() : init() {}` or `int bar() { return 1; }`)
    # where the brace opens AND closes on the same line, so newDepth==1 but $foundOpenInThisLine.
    $isInlineSingleLine = ($d -eq 1 -and $foundOpenInThisLine -and $newDepth -eq 1)
    if (($d -eq 1 -and $newDepth -ge 2) -or $isInlineSingleLine) {
        # Detect nested type (struct/class/enum/union): no `(` before `{` in accumulated buf
        $bufJoined = ($buf -join ' ')
        $braceIdxInJoined = $bufJoined.IndexOf('{')
        $beforeBraceJoined = if ($braceIdxInJoined -ge 0) { $bufJoined.Substring(0, $braceIdxInJoined) } else { $bufJoined }
        $isNestedType = ($beforeBraceJoined -notmatch '\(') -or ($beforeBraceJoined -match '^\s*(struct|class|enum|union)\b')
        if ($isNestedType) {
            # Capture nested type name from the first matching line
            foreach ($bl in $buf) {
                $mm = [regex]::Match($bl, '^\s*(?:struct|class|enum(?:\s+class)?|union)\s+([A-Za-z_][A-Za-z0-9_]*)')
                if ($mm.Success) { $null = $nestedTypes.Add($mm.Groups[1].Value); break }
            }
            # Keep entire nested type definition verbatim in header, including trailing `;` line
            $d = $newDepth
            $i++
            while ($i -le $endScan -and $d -gt 1) {
                $bln = $lines[$i]
                $null = $buf.Add($bln)
                foreach ($ch in $bln.ToCharArray()) {
                    if ($ch -eq '{') { $d++ }
                    elseif ($ch -eq '}') { $d-- }
                }
                $i++
            }
            # The last buf line should contain `};` (struct close + semicolon).
            # If not (e.g. `}` and `;` on separate lines), include any trailing `;` line.
            if ($i -le $endScan -and $lines[$i] -match '^\s*;\s*$') {
                $null = $buf.Add($lines[$i])
                $i++
            }
            foreach ($bl in $buf) { $null = $slimMembers.Add($bl) }
            $buf.Clear()
            $d = 1
            continue
        }
        # Continue consuming until depth returns to 1
        $d = $newDepth
        $i++
        while ($i -le $endScan -and $d -gt 1) {
            $bln = $lines[$i]
            $null = $buf.Add($bln)
            foreach ($ch in $bln.ToCharArray()) {
                if ($ch -eq '{') { $d++ }
                elseif ($ch -eq '}') { $d-- }
            }
            $i++
        }
        # buf now contains: signature line(s) ending with `{...`, body lines, closing `}` line
        # Split into signature, body
        $sigLines = New-Object System.Collections.Generic.List[string]
        $bodyLines = New-Object System.Collections.Generic.List[string]
        $sigDone = $false
        foreach ($bl in $buf) {
            if (-not $sigDone) {
                $idxBrace = $bl.IndexOf('{')
                if ($idxBrace -ge 0) {
                    $beforeBrace = $bl.Substring(0, $idxBrace).TrimEnd()
                    $afterBrace = $bl.Substring($idxBrace + 1)
                    if ($beforeBrace.Length -gt 0) { $null = $sigLines.Add($beforeBrace) }
                    if ($afterBrace.Trim().Length -gt 0) { $null = $bodyLines.Add($afterBrace) }
                    $sigDone = $true
                    continue
                } else {
                    $null = $sigLines.Add($bl)
                }
            } else {
                $null = $bodyLines.Add($bl)
            }
        }
        # Last line of bodyLines is the closing `}` — strip it
        if ($bodyLines.Count -gt 0) {
            $last = $bodyLines[$bodyLines.Count - 1]
            $idxClose = $last.LastIndexOf('}')
            if ($idxClose -ge 0) {
                $beforeClose = $last.Substring(0, $idxClose)
                $bodyLines.RemoveAt($bodyLines.Count - 1)
                if ($beforeClose.Trim().Length -gt 0) { $null = $bodyLines.Add($beforeClose.TrimEnd()) }
            }
        }

        # Determine function name and whether to keep inline
        $sigJoined = ($sigLines -join ' ')
        $fnName = Get-FunctionName -signatureText $sigJoined
        $keepInline = $false
        if ($fnName -and ($KeepInlineMethods -contains $fnName)) { $keepInline = $true }

        if ($keepInline) {
            # Keep entire definition in header
            foreach ($bl in $buf) { $null = $slimMembers.Add($bl) }
        } else {
            # --- Header: emit declaration (last sig line gets `;` instead of nothing) ---
            # Strip trailing whitespace; ensure last sig line ends with `;`
            for ($si = 0; $si -lt $sigLines.Count; $si++) {
                $sl = $sigLines[$si]
                # If this is the last sig line and it doesn't already end with `;`, append `;`
                if ($si -eq $sigLines.Count - 1) {
                    # Strip any initializer-list start `:` segments — those are ctor-only, but check:
                    # init list starts on a new line typically with leading whitespace and `:`
                    # We need to find where the actual declaration ends. For most functions: the line ends with `)` or `) const`.
                    $stripped = $sl.TrimEnd()
                    # Remove trailing `:` (init list start) and everything after
                    # Detect init list: signature has `)` then optional `const`/`override`/etc, then `: foo(...)...`
                    # We'll cut at the position of `:` that follows `)` and is not `::`
                    $cutIdx = -1
                    $parenDepth = 0
                    for ($ci = 0; $ci -lt $stripped.Length; $ci++) {
                        $c = $stripped[$ci]
                        if ($c -eq '(') { $parenDepth++ }
                        elseif ($c -eq ')') { $parenDepth-- }
                        elseif ($c -eq ':' -and $parenDepth -eq 0) {
                            # Check it's not `::`
                            if ($ci + 1 -lt $stripped.Length -and $stripped[$ci+1] -eq ':') { continue }
                            if ($ci -gt 0 -and $stripped[$ci-1] -eq ':') { continue }
                            $cutIdx = $ci; break
                        }
                    }
                    if ($cutIdx -ge 0) {
                        $stripped = $stripped.Substring(0, $cutIdx).TrimEnd()
                    }
                    if (-not $stripped.EndsWith(';')) { $stripped += ';' }
                    $null = $slimMembers.Add($stripped)
                } else {
                    # If this line contains the start of init list `:`, strip from `:` onward
                    $stripped = $sl
                    $cutIdx = -1
                    $parenDepth = 0
                    for ($ci = 0; $ci -lt $stripped.Length; $ci++) {
                        $c = $stripped[$ci]
                        if ($c -eq '(') { $parenDepth++ }
                        elseif ($c -eq ')') { $parenDepth-- }
                        elseif ($c -eq ':' -and $parenDepth -eq 0) {
                            if ($ci + 1 -lt $stripped.Length -and $stripped[$ci+1] -eq ':') { continue }
                            if ($ci -gt 0 -and $stripped[$ci-1] -eq ':') { continue }
                            $cutIdx = $ci; break
                        }
                    }
                    if ($cutIdx -ge 0) {
                        $stripped = $stripped.Substring(0, $cutIdx).TrimEnd()
                        if (-not $stripped.EndsWith(';')) { $stripped += ';' }
                        $null = $slimMembers.Add($stripped)
                        break  # init list found mid-signature — stop
                    } else {
                        $null = $slimMembers.Add($sl)
                    }
                }
            }

            # --- CPP: qualified definition ---
            # Build qualified signature: drop leading indent, drop `static ` / `explicit `, qualify name, KEEP init list
            $cppSigLines = New-Object System.Collections.Generic.List[string]
            $nameQualified = $false
            foreach ($sl in $sigLines) {
                $s = $sl -replace '^\s+', ''  # drop ALL leading indent
                if (-not $nameQualified -and $s -match $fnName + '\s*\(') {
                    $s = $s -replace '^static\s+', ''
                    $s = $s -replace '^explicit\s+', ''
                    $s = [regex]::Replace($s, "(?<![A-Za-z0-9_:])$fnName\s*\(", "${ClassName}::${fnName}(", 1)
                    $s = Strip-DefaultArgs $s
                    $null = $cppSigLines.Add($s)
                    $nameQualified = $true
                } else {
                    $s = Strip-DefaultArgs $s
                    $null = $cppSigLines.Add($s)
                }
            }
            # Qualify nested type references in the signature lines
            for ($qi = 0; $qi -lt $cppSigLines.Count; $qi++) {
                $sigLine = $cppSigLines[$qi]
                foreach ($nt in $nestedTypes) {
                    $sigLine = [regex]::Replace($sigLine, "(?<![A-Za-z0-9_:])$nt(?![A-Za-z0-9_])", "${ClassName}::$nt")
                }
                # Avoid double-qualifying our own ClassName::name
                $sigLine = [regex]::Replace($sigLine, "${ClassName}::${ClassName}::", "${ClassName}::")
                $cppSigLines[$qi] = $sigLine
            }
            foreach ($sl in $cppSigLines) { $null = $cppDefs.Add($sl) }
            $null = $cppDefs.Add('{')
            # Body lines: strip ONE level of class indent (4 spaces) if present
            foreach ($bl in $bodyLines) {
                if ($bl -match '^\s{4}(.*)$') { $null = $cppDefs.Add($Matches[1]) }
                else { $null = $cppDefs.Add($bl) }
            }
            $null = $cppDefs.Add('}')
            $null = $cppDefs.Add('')
        }

        $buf.Clear()
        $d = 1
        continue
    }

    # Did we hit a `;` at depth 1 (no brace)? It's a declaration / member field — keep as-is
    if ($d -eq 1 -and $newDepth -eq 1 -and ($ln -match ';\s*$')) {
        # Capture forward-declared nested types
        foreach ($bl in $buf) {
            $mm = [regex]::Match($bl, '^\s*(?:struct|class|enum(?:\s+class)?|union)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;')
            if ($mm.Success) { $null = $nestedTypes.Add($mm.Groups[1].Value) }
        }
        foreach ($bl in $buf) { $null = $slimMembers.Add($bl) }
        $buf.Clear()
        $i++
        continue
    }

    # Otherwise depth unchanged or accumulating multi-line signature/decl — continue
    $d = $newDepth
    $i++
}

# Flush any trailing buffer (shouldn't happen for clean input)
foreach ($bl in $buf) { $null = $slimMembers.Add($bl) }

# --- Assemble outputs ---

# Slim header: original preamble (or with extra includes), then `class X\n{`, then slimMembers, then `};\n}  // namespace`
$slimHeader = New-Object System.Collections.Generic.List[string]
foreach ($l in $origPreamble) { $null = $slimHeader.Add($l) }
if ($HeaderExtraIncludes.Count -gt 0) {
    # insert extra includes right before namespace open
    # (origPreamble already includes ns open; we'll just append before closing it... simpler: append to origPreamble before nsOpenIdx)
    # For simplicity: ignore HeaderExtraIncludes for now if origPreamble already ends with `{`
}

# Strip trailing blank line from preamble if present
while ($slimHeader.Count -gt 0 -and $slimHeader[$slimHeader.Count - 1] -match '^\s*$') {
    $slimHeader.RemoveAt($slimHeader.Count - 1)
}

# If origPreamble didn't end with `{` (namespace open), it ended at `class X` — re-add `class X`
if ($slimHeader.Count -gt 0 -and $slimHeader[$slimHeader.Count - 1] -notmatch '^\s*\{\s*$' -and $slimHeader[$slimHeader.Count - 1] -notmatch 'namespace\s.*\{\s*$') {
    # We assume origPreamble ends with namespace { — if not, fall back: use lines up to classDeclIdx-1
}

# Re-insert the class header line(s): `class X\n{`
$null = $slimHeader.Add($lines[$classDeclIdx])
$null = $slimHeader.Add($lines[$openIdx])

# slimMembers
foreach ($l in $slimMembers) { $null = $slimHeader.Add($l) }

# closing `};` and namespace close
$null = $slimHeader.Add('};')
$null = $slimHeader.Add($nsCloseLine)
$null = $slimHeader.Add('')

# CPP: include the header + extra includes, then namespace, then defs
$cpp = New-Object System.Collections.Generic.List[string]
$relHeader = [System.IO.Path]::GetFileName($HeaderPath)
$null = $cpp.Add("// Auto-generated by tools/sink_class.ps1 from $relHeader")
$null = $cpp.Add("#include `"$relHeader`"")
$null = $cpp.Add('')
foreach ($inc in $CppExtraIncludes) {
    $null = $cpp.Add("#include $inc")
}
if ($CppExtraIncludes.Count -gt 0) { $null = $cpp.Add('') }

# Find namespace name from origPreamble
$nsName = ''
foreach ($l in $origPreamble) {
    if ($l -match '^namespace\s+([A-Za-z_:0-9]+)') { $nsName = $Matches[1]; break }
}
if (-not $nsName) { throw "Could not determine namespace from preamble" }
$null = $cpp.Add("namespace $nsName")
$null = $cpp.Add('{')
$null = $cpp.Add('')
foreach ($l in $cppDefs) { $null = $cpp.Add($l) }
$null = $cpp.Add("}  // namespace $nsName")
$null = $cpp.Add('')

[System.IO.File]::WriteAllText($HeaderPath, ($slimHeader -join "`r`n"), $utf8)
[System.IO.File]::WriteAllText($CppPath,    ($cpp -join "`r`n"), $utf8)

Write-Host ("Header lines: {0}" -f $slimHeader.Count)
Write-Host ("Cpp lines:    {0}" -f $cpp.Count)
