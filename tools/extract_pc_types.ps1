# Extract PC types: keep the 8-line license, insert import-type block, keep lines 243+.
# UTF-8 (no BOM) explicit encoding so CJK survives.

$src = 'd:\_develop\_side\exam-online-cpp\frontend\src\viewer\personalCenter.ts'

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($src, $utf8NoBom)

if ($text.Contains("from './personalCenter/types.js'")) {
    Write-Host "Already extracted (import present); skipping."
    return
}

$crlf = "`r`n"
$useCrlf = $text.Contains($crlf)
$nl = if ($useCrlf) { $crlf } else { "`n" }

$trimmed = $text.TrimEnd("`r", "`n")
$lines = $trimmed -split "`r?`n"
$total = $lines.Count
Write-Host "Original total lines: $total"

if ($total -lt 3000) {
    throw "Unexpected file size ($total lines); expected ~3420. Aborting."
}

$header = $lines[0..7]
$body   = $lines[242..($total - 1)]

$importLines = @(
    '',
    'import type {',
    "`tPCBalance, PCSubscription, PCReferral, PCUser, PCContext, PCContextManager,",
    "`tManagedOrganizationMember, ManagedOrganizationInvitation, PendingOrganizationInvitation,",
    "`tManagedOrganizationAuditLog, ManagedOrganization, OrganizationMemberDraft,",
    "`tContactVerificationDraft, ContactVerificationKind, SectionDef, SystemFlag,",
    "`tFeatureItem, RoleDef, AvatarPreset, AvatarPalette, AvatarSeed",
    "} from './personalCenter/types.js';",
    ''
)

$out = ($header + $importLines + $body) -join $nl
if ($text.EndsWith($nl)) { $out = $out + $nl }

[System.IO.File]::WriteAllText($src, $out, $utf8NoBom)

$verify = [System.IO.File]::ReadAllText($src, $utf8NoBom)
$verifyLines = ($verify.TrimEnd("`r", "`n")) -split "`r?`n"
Write-Host ("New total lines: {0} (delta: {1})" -f $verifyLines.Count, ($verifyLines.Count - $total))
# Use .NET APIs with explicit UTF-8 (no BOM) so CJK characters survive.
$src = 'd:\_develop\_side\exam-online-cpp\frontend\src\viewer\personalCenter.ts'

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($src, $utf8NoBom)

# Idempotency guard: if the import statement is already present, this script
# has been applied; abort to avoid double-trimming.
if ($text.Contains("from './personalCenter/types.js'")) {
    Write-Host "Already extracted (import present); skipping."
    return
}

$lf = "`n"
$crlf = "`r`n"
$useCrlf = $text.Contains($crlf)
$nl = if ($useCrlf) { $crlf } else { $lf }

$trimmed = $text.TrimEnd("`r", "`n")
$lines = $trimmed -split "`r?`n"
$total = $lines.Count
Write-Host "Original total lines: $total"

if ($total -lt 3000) {
    throw "Unexpected file size ($total lines); expected ~3420. Aborting."
}

$header = $lines[0..7]
$body   = $lines[242..($total - 1)]

$importLines = @(
    '',
    'import type {',
    "`tPCBalance, PCSubscription, PCReferral, PCUser, PCContext, PCContextManager,",
    "`tManagedOrganizationMember, ManagedOrganizationInvitation, PendingOrganizationInvitation,",
    "`tManagedOrganizationAuditLog, ManagedOrganization, OrganizationMemberDraft,",
    "`tContactVerificationDraft, ContactVerificationKind, SectionDef, SystemFlag,",
    "`tFeatureItem, RoleDef, AvatarPreset, AvatarPalette, AvatarSeed",
    "} from './personalCenter/types.js';",
    ''
)

$out = ($header + $importLines + $body) -join $nl
if ($text.EndsWith($nl)) { $out = $out + $nl }

[System.IO.File]::WriteAllText($src, $out, $utf8NoBom)

$verify = [System.IO.File]::ReadAllText($src, $utf8NoBom)
$verifyLines = ($verify.TrimEnd("`r", "`n")) -split "`r?`n"
Write-Host ("New total lines: {0} (delta: {1})" -f $verifyLines.Count, ($verifyLines.Count - $total))
# Replace personalCenter.ts: keep lines 1-8 (license), insert import-type line, keep lines 243+
$src = 'd:\_develop\_side\exam-online-cpp\frontend\src\viewer\personalCenter.ts'
$lines = Get-Content -LiteralPath $src
$total = $lines.Count
Write-Host "Original total: $total"

$header = $lines[0..7]   # 8 lines: copyright header
$body   = $lines[242..($total - 1)]   # lines 243..end (0-indexed 242)

$importLine = @(
    '',
    "import type {",
    "    PCBalance, PCSubscription, PCReferral, PCUser, PCContext, PCContextManager,",
    "    ManagedOrganizationMember, ManagedOrganizationInvitation, PendingOrganizationInvitation,",
    "    ManagedOrganizationAuditLog, ManagedOrganization, OrganizationMemberDraft,",
    "    ContactVerificationDraft, ContactVerificationKind, SectionDef, SystemFlag,",
    "    FeatureItem, RoleDef, AvatarPreset, AvatarPalette, AvatarSeed",
    "} from './personalCenter/types.js';",
    ''
)

$out = $header + $importLine + $body
Set-Content -LiteralPath $src -Value $out -Encoding UTF8

$newCount = (Get-Content -LiteralPath $src).Count
Write-Host "New total: $newCount (delta: $($newCount - $total))"
