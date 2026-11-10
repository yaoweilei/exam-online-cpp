param(
    [ValidateSet('Create', 'Verify')][string]$Mode = 'Verify',
    [string]$DataRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data'),
    [string]$BackupRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'backups'),
    [string]$BackupPath = '',
    [string]$OffsiteRoot = '',
    [ValidateRange(1, 3650)][int]$KeepCount = 7,
    [switch]$ApplyRetention
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function FullPath([string]$Value) { return [IO.Path]::GetFullPath($Value).TrimEnd('\', '/') }
function Inside([string]$Child, [string]$Parent) { return $Child.Equals($Parent,[StringComparison]::OrdinalIgnoreCase) -or $Child.StartsWith($Parent+'\',[StringComparison]::OrdinalIgnoreCase) }
function NoLinks([string]$Value) {
    $current = $Value
    while ($current) {
        if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Links and junctions are not allowed: $current" }
        $next = Split-Path -Parent $current
        if (-not $next -or $next -eq $current) { break }; $current = $next
    }
}
$source = FullPath $DataRoot
$local = FullPath $BackupRoot
$remote = if ($OffsiteRoot) { FullPath $OffsiteRoot } else { '' }
if ((Inside $local $source) -or (Inside $source $local)) { throw 'Backup and data roots must not overlap' }
if ($remote -and ((Inside $remote $source) -or (Inside $source $remote) -or (Inside $remote $local) -or (Inside $local $remote))) { throw 'Offsite, local backup and data roots must not overlap' }
NoLinks $source; NoLinks $local; if ($remote) { NoLinks $remote }
New-Item -ItemType Directory -Path $local -Force | Out-Null
$stateRoot = Join-Path $local 'job-status'
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
NoLinks $stateRoot
# One lease covers creation, verification, replication and retention.
$lease = $null
try { $lease = [IO.File]::Open((Join-Path $stateRoot 'run.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
catch { throw 'Another backup job is running; this run did not start' }
$id = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$lastSuccessAt=''; $lastSuccessBackup=''; $lastSuccessCreated=''
try {
    $previous=Get-Content -LiteralPath (Join-Path $stateRoot 'latest.json') -Raw | ConvertFrom-Json
    if ($previous.state -eq 'succeeded') { $lastSuccessAt=$previous.finished_at; $lastSuccessBackup=$previous.backup_path }
    else { $lastSuccessAt=$previous.last_successful_at; $lastSuccessBackup=$previous.last_successful_backup }
    if ($previous.PSObject.Properties['last_successful_backup_created_at']) { $lastSuccessCreated=$previous.last_successful_backup_created_at }
} catch { }
$shell=(Get-Process -Id $PID).Path
$status = [ordered]@{ schema_version=1; run_id=$id; mode=$Mode; started_at=(Get-Date).ToUniversalTime().ToString('o'); state='running'; phase='initializing'; data_root=$source; backup_path=''; backup_created_at=''; offsite_path=''; keep_count=$KeepCount; retention_applied=[bool]$ApplyRetention; retention_plan=@(); removed=@(); error=''; finished_at=$null; last_successful_at=$lastSuccessAt; last_successful_backup=$lastSuccessBackup; last_successful_backup_created_at=$lastSuccessCreated }
$partialRemote = ''
function SaveStatus {
    $json = $status | ConvertTo-Json -Depth 8
    $runFile = Join-Path $stateRoot ($id+'.json')
    $json | Set-Content -LiteralPath $runFile -Encoding UTF8
    $temporary = Join-Path $stateRoot ('latest.'+$id+'.tmp')
    $json | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination (Join-Path $stateRoot 'latest.json') -Force
}
function Manifest([string]$Directory) {
    NoLinks $Directory
    $manifestFile=Join-Path $Directory 'manifest.json'; NoLinks $manifestFile
    $manifest=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
    if (-not (FullPath ([string]$manifest.source)).Equals($source,[StringComparison]::OrdinalIgnoreCase)) { throw 'Backup belongs to another data root' }
    return $manifest
}
function Verify([string]$Directory) {
    [void](Manifest $Directory)
    # Execute in a child process: the verifier's exit must not end this job.
    $output = & $shell -NoProfile -File (Join-Path $PSScriptRoot 'restore_runtime_data.ps1') -BackupPath $Directory -VerifyOnly 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Backup verification failed: '+($output -join "`n")) }
}
function Candidates([string]$Root) {
    $out=@()
    foreach ($entry in @(Get-ChildItem -LiteralPath $Root -Directory -Force)) {
        if ($entry.Name -notmatch '^runtime-\d{8}-\d{6}-[a-f0-9]{8}$') { continue }
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        try { $manifest=Manifest $entry.FullName; $created=[DateTimeOffset]$manifest.created_at; $out += [pscustomobject]@{ path=$entry.FullName; created=$created } } catch { continue }
    }
    return @($out | Sort-Object created -Descending)
}
try {
    SaveStatus
    if ($Mode -eq 'Create') {
        if ($BackupPath) { throw 'BackupPath is only used in Verify mode' }
        $status.phase='creating'; SaveStatus
        $output=& $shell -NoProfile -File (Join-Path $PSScriptRoot 'backup_runtime_data.ps1') -DataRoot $source -BackupRoot $local 2>&1
        if ($LASTEXITCODE -ne 0) { throw ('Backup creation failed: '+($output -join "`n")) }
        $match=[regex]::Match(($output -join "`n"),'BACKUP_PATH=([^\r\n]+)')
        if (-not $match.Success) { throw 'Backup command did not return a completed path' }; $chosen=FullPath $match.Groups[1].Value.Trim()
    } elseif ($BackupPath) { $chosen=FullPath $BackupPath }
    else { $choices=@(Candidates $local); if (-not $choices.Count) { throw 'No completed backup for this data root; create an offline backup first' }; $chosen=$choices[0].path }
    if (-not (Inside $chosen $local) -or (Split-Path -Parent $chosen) -ne $local -or (Split-Path -Leaf $chosen) -notmatch '^runtime-\d{8}-\d{6}-[a-f0-9]{8}$') { throw 'Selected backup must be a completed direct child of BackupRoot' }
    $status.backup_path=$chosen; $status.phase='verifying-local'; SaveStatus; Verify $chosen
    $status.backup_created_at=([DateTimeOffset](Manifest $chosen).created_at).ToUniversalTime().ToString('o')
    if ($remote) {
        $status.phase='replicating'; SaveStatus
        New-Item -ItemType Directory -Path $remote -Force | Out-Null; NoLinks $remote
        $finalRemote=FullPath (Join-Path $remote (Split-Path -Leaf $chosen))
        if (Test-Path -LiteralPath $finalRemote) { Verify $finalRemote }
        else {
            $partialRemote=FullPath (Join-Path $remote ('.'+(Split-Path -Leaf $chosen)+'.'+$id+'.partial'))
            if (-not (Inside $partialRemote $remote)) { throw 'Replication stage escaped the destination' }
            Copy-Item -LiteralPath $chosen -Destination $partialRemote -Recurse
            Verify $partialRemote
            Move-Item -LiteralPath $partialRemote -Destination $finalRemote; $partialRemote=''
        }
        $status.offsite_path=$finalRemote
    }
    # Retention is planned by default. It runs only after every required copy
    # is verified and only touches verified backups of this exact data root.
    $status.phase='retention'; SaveStatus
    foreach ($location in @($local,$remote)) {
        if (-not $location) { continue }
        # Damaged snapshots must not consume a retained, usable backup slot.
        $choices=@(Candidates $location | Where-Object { try { Verify $_.path; $true } catch { $false } })
        $protected=if ($location -eq $local) { $chosen } else { $status.offsite_path }
        # Verifying an old archive must never evict a newer recovery point.
        # Keep the newest N usable snapshots plus the explicitly selected one.
        $keep=@($protected)+@($choices | Select-Object -First $KeepCount | ForEach-Object path)
        foreach ($candidate in $choices) {
            if ($candidate.path -in $keep) { continue }
            $status.retention_plan += $candidate.path
            if ($ApplyRetention) {
                $resolved=FullPath $candidate.path; NoLinks $resolved
                if ((Split-Path -Parent $resolved) -ne $location -or -not (Inside $resolved $location)) { throw 'Retention path escaped the chosen backup root' }
                Remove-Item -LiteralPath $resolved -Recurse -Force
                $status.removed += $resolved
            }
        }
    }
    $status.state='succeeded'; $status.phase='complete'; $status.finished_at=(Get-Date).ToUniversalTime().ToString('o'); $status.last_successful_at=$status.finished_at; $status.last_successful_backup=$chosen; $status.last_successful_backup_created_at=$status.backup_created_at; SaveStatus
    $status | ConvertTo-Json -Depth 8
} catch {
    $status.state='failed'; $status.error=$_.Exception.Message; $status.finished_at=(Get-Date).ToUniversalTime().ToString('o')
    try { SaveStatus } catch { Write-Warning 'Could not save job status' }
    if ($partialRemote -and (Test-Path -LiteralPath $partialRemote)) {
        $resolved=FullPath $partialRemote
        if ((Inside $resolved $remote) -and (Split-Path -Parent $resolved) -eq $remote -and (Split-Path -Leaf $resolved).EndsWith('.partial')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
    }
    throw
} finally { $lease.Dispose() }
