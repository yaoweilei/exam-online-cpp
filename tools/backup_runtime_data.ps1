param(
    [string]$DataRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data'),
    [string]$BackupRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'backups')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function FullPath([string]$PathValue) {
    return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\', '/')
}

$source = FullPath $DataRoot
$backupBase = FullPath $BackupRoot
if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "Data root does not exist: $source"
}
if ($backupBase.StartsWith($source + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backup root must not be inside the data root'
}
if (Get-Process exam_online_cpp -ErrorAction SilentlyContinue) {
    throw 'Stop exam_online_cpp before creating a consistent runtime backup'
}

New-Item -ItemType Directory -Path $backupBase -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "runtime-$stamp-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$partial = FullPath (Join-Path $backupBase ".$name.partial")
$final = FullPath (Join-Path $backupBase $name)
if (-not $partial.StartsWith($backupBase + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Computed backup path escaped the backup root'
}

try {
    New-Item -ItemType Directory -Path $partial -Force | Out-Null
    $payload = Join-Path $partial 'data'
    Copy-Item -LiteralPath $source -Destination $payload -Recurse -Force

    $files = @(Get-ChildItem -LiteralPath $payload -Recurse -File | Sort-Object FullName | ForEach-Object {
        [pscustomobject]@{
            path = $_.FullName.Substring($payload.Length + 1).Replace('\', '/')
            length = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    })
    if ($files.Count -eq 0) {
        throw 'Backup payload is empty'
    }
    $manifest = [pscustomobject]@{
        schema_version = 1
        created_at = (Get-Date).ToUniversalTime().ToString('o')
        source = $source
        file_count = $files.Count
        files = $files
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $partial 'manifest.json') -Encoding UTF8
    Move-Item -LiteralPath $partial -Destination $final
    Write-Output "BACKUP_PATH=$final"
    Write-Output "FILE_COUNT=$($files.Count)"
}
catch {
    if (Test-Path -LiteralPath $partial) {
        Remove-Item -LiteralPath $partial -Recurse -Force
    }
    throw
}
