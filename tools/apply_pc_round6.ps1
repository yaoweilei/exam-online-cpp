# Apply Round 6 conservative modularization to personalCenter.ts:
# - Add imports for extracted pure functions at the top (module scope)
# - Delete the corresponding local function declarations inside the IIFE
# All other code continues to call these by name, and IIFE captures them from module scope.
$ErrorActionPreference = 'Stop'

$path = 'd:\_develop\_side\exam-online-cpp\frontend\src\viewer\personalCenter.ts'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText($path, $utf8)

# --- 1. Inject imports right after the existing `import type { ... } from './personalCenter/types.js';` ---
$importBlock = @"

import {
	escapeHtml, svgToDataUri, asRecord, readString, readBoolean, readNumber, readCount, readStringArray,
	deriveFallbackDisplayName, preferredDisplayName, triggerMonogram
} from './personalCenter/utils.js';
import { renderAccessory, renderHair, buildAvatarSvg, buildEmojiAvatarSvg, buildAvatarPresets } from './personalCenter/avatar.js';
import { renderOutlineIcon } from './personalCenter/icons.js';
import { normalizeSubscription, normalizeReferral, normalizePendingInvitation } from './personalCenter/normalize.js';

"@

# Anchor: find the last `} from './personalCenter/types.js';` and insert after it
$anchor = "} from './personalCenter/types.js';"
$idx = $content.IndexOf($anchor)
if ($idx -lt 0) { throw "Import anchor not found" }
$insertAt = $idx + $anchor.Length
$content = $content.Substring(0, $insertAt) + $importBlock + $content.Substring($insertAt)

# --- 2. Delete the local function declarations inside the IIFE ---
# Each function occupies a contiguous block starting with `\tfunction <name>(` (tab-indent 1) through its matching `\t}` closing brace at indent 1.

$fnNames = @(
	'escapeHtml', 'svgToDataUri',
	'deriveFallbackDisplayName', 'preferredDisplayName',
	'asRecord', 'readString', 'readBoolean', 'readNumber', 'readCount', 'readStringArray',
	'normalizeSubscription', 'normalizeReferral',
	'triggerMonogram',
	'renderAccessory', 'renderHair', 'buildAvatarSvg', 'buildEmojiAvatarSvg', 'buildAvatarPresets',
	'renderOutlineIcon',
	'normalizePendingInvitation'
)

$lines = $content -split "`r?`n"
$linesToRemove = New-Object 'System.Collections.Generic.HashSet[int]'

foreach ($fn in $fnNames) {
	# Find starting line: `\tfunction <fn>(`
	$startIdx = -1
	for ($i = 0; $i -lt $lines.Length; $i++) {
		if ($lines[$i] -match "^\tfunction\s+$fn\s*\(") {
			$startIdx = $i
			break
		}
	}
	if ($startIdx -lt 0) {
		Write-Warning "Function $fn not found"
		continue
	}
	# Find matching closing `\t}` by brace depth
	$depth = 0
	$endIdx = -1
	$started = $false
	for ($j = $startIdx; $j -lt $lines.Length; $j++) {
		$ln = $lines[$j]
		foreach ($ch in $ln.ToCharArray()) {
			if ($ch -eq '{') { $depth++; $started = $true }
			elseif ($ch -eq '}') { $depth-- }
		}
		if ($started -and $depth -eq 0) { $endIdx = $j; break }
	}
	if ($endIdx -lt 0) { throw "End of $fn not found" }

	# Also consume a single blank line immediately after, if present
	$removeUpTo = $endIdx
	if ($removeUpTo + 1 -lt $lines.Length -and $lines[$removeUpTo + 1] -match '^\s*$') {
		$removeUpTo++
	}

	for ($k = $startIdx; $k -le $removeUpTo; $k++) {
		$null = $linesToRemove.Add($k)
	}
	Write-Host ("Removed $fn : lines {0}-{1}" -f ($startIdx + 1), ($removeUpTo + 1))
}

$keptLines = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $lines.Length; $i++) {
	if (-not $linesToRemove.Contains($i)) {
		$null = $keptLines.Add($lines[$i])
	}
}

[System.IO.File]::WriteAllText($path, ($keptLines -join "`r`n"), $utf8)
Write-Host ("Output lines: {0}" -f $keptLines.Count)
