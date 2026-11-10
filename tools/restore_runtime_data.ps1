param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,
    [string]$DestinationDataRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data'),
    [string]$Confirmation = '',
    [switch]$VerifyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function FullPath([string]$PathValue) {
    return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\', '/')
}

function VerifyPayload([string]$PayloadRoot, $Manifest) {
    if ((Get-Item -LiteralPath $PayloadRoot -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Backup payload root cannot be a link' }
    if ($Manifest.schema_version -ne 1 -or [int]$Manifest.file_count -lt 1) { throw 'Unsupported or empty backup manifest' }
    $inventory = @(Get-ChildItem -LiteralPath $PayloadRoot -Recurse -Force)
    if (@($inventory | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }).Count) { throw 'Backup payload contains links or junctions' }
    if (@($inventory | Where-Object { -not $_.PSIsContainer }).Count -ne [int]$Manifest.file_count) { throw 'Backup contains missing or unlisted files' }
    $seen = @{}
    $checked = 0
    foreach ($entry in @($Manifest.files)) {
        $relative = [string]$entry.path
        if (-not $relative -or $relative.Contains('..') -or [System.IO.Path]::IsPathRooted($relative)) {
            throw "Unsafe manifest path: $relative"
        }
        $file = FullPath (Join-Path $PayloadRoot $relative)
        if ($seen.ContainsKey($file)) { throw "Duplicate manifest path: $relative" }
        $seen[$file] = $true
        if (-not $file.StartsWith((FullPath $PayloadRoot) + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Manifest path escaped payload: $relative"
        }
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Backup file is missing: $relative"
        }
        if ((Get-Item -LiteralPath $file).Length -ne [long]$entry.length) { throw "Backup length mismatch: $relative" }
        $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne ([string]$entry.sha256).ToLowerInvariant()) {
            throw "Backup checksum mismatch: $relative"
        }
        $checked++
    }
    if ($checked -ne [int]$Manifest.file_count) {
        throw "Manifest count mismatch: expected $($Manifest.file_count), checked $checked"
    }
    return $checked
}

$backup = FullPath $BackupPath
$payload = Join-Path $backup 'data'
$manifestPath = Join-Path $backup 'manifest.json'
if (-not (Test-Path -LiteralPath $payload -PathType Container) -or
    -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Backup is incomplete: $backup"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$checked = VerifyPayload $payload $manifest
Write-Output "VERIFIED_FILES=$checked"
if ($VerifyOnly) {
    Write-Output 'VERIFY_ONLY=1'
    exit 0
}
if ($Confirmation -ne 'RESTORE_RUNTIME_DATA') {
    throw 'Set -Confirmation RESTORE_RUNTIME_DATA to apply a restore'
}
if (Get-Process exam_online_cpp -ErrorAction SilentlyContinue) {
    throw 'Stop exam_online_cpp before restoring runtime data'
}

$destination = FullPath $DestinationDataRoot
if ($destination -eq $backup -or $destination.StartsWith($backup + '\', [System.StringComparison]::OrdinalIgnoreCase) -or $backup.StartsWith($destination + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Restore destination and backup must not overlap'
}
if ($destination -eq [System.IO.Path]::GetPathRoot($destination).TrimEnd('\', '/')) {
    throw 'Refusing to restore over a drive root'
}
$parent = Split-Path -Parent $destination
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$stage = FullPath (Join-Path $parent ('.restore-stage-' + [guid]::NewGuid().ToString('N')))
$rollback = FullPath ($destination + '.pre-restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (-not $stage.StartsWith((FullPath $parent) + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Computed restore stage escaped the destination parent'
}

try {
    Copy-Item -LiteralPath $payload -Destination $stage -Recurse -Force
    [void](VerifyPayload $stage $manifest)
    if (Test-Path -LiteralPath $destination) {
        Move-Item -LiteralPath $destination -Destination $rollback
    }
    Move-Item -LiteralPath $stage -Destination $destination
    Write-Output "RESTORED_TO=$destination"
    if (Test-Path -LiteralPath $rollback) {
        Write-Output "ROLLBACK_COPY=$rollback"
    }
}
catch {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
    if (-not (Test-Path -LiteralPath $destination) -and (Test-Path -LiteralPath $rollback)) {
        Move-Item -LiteralPath $rollback -Destination $destination
    }
    throw
}
