param(
    [Parameter(Mandatory=$true)][string]$ConfigPath,
    [switch]$ValidateOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
function Full([string]$Value) { return [IO.Path]::GetFullPath($Value).TrimEnd('\','/') }
function Inside([string]$Child,[string]$Parent) { return $Child.Equals($Parent,[StringComparison]::OrdinalIgnoreCase) -or $Child.StartsWith($Parent+'\',[StringComparison]::OrdinalIgnoreCase) }
function NoLinks([string]$Value) {
    while ($Value) {
        if ((Test-Path -LiteralPath $Value) -and ((Get-Item -LiteralPath $Value -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Links and junctions are not allowed: $Value" }
        $parent=Split-Path -Parent $Value; if (-not $parent -or $parent -eq $Value) { break }; $Value=$parent
    }
}
$cfg=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($cfg.schema_version -ne 1) { throw 'Unsupported maintenance configuration' }
$repo=Full $cfg.repo_root; $source=Full $cfg.data_root; $backup=Full $cfg.backup_root; $exe=Full $cfg.exe_path
$offsite=if ($cfg.offsite_root) { Full $cfg.offsite_root } else { '' }
$keep=[int]$cfg.keep_count
if ($keep -lt 1 -or $keep -gt 3650) { throw 'Invalid retention count' }
if (-not (Test-Path -LiteralPath $repo -PathType Container) -or -not (Test-Path -LiteralPath $source -PathType Container) -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Missing repository, runtime executable or source data' }
if ((Split-Path -Leaf $exe) -ne 'exam_online_cpp.exe') { throw 'Unexpected runtime executable name' }
if ((Inside $backup $source) -or (Inside $source $backup)) { throw 'Backup and data roots must not overlap' }
if ($offsite -and ((Inside $offsite $source) -or (Inside $source $offsite) -or (Inside $offsite $backup) -or (Inside $backup $offsite))) { throw 'Offsite and runtime roots must not overlap' }
foreach ($value in @($source,$backup,$repo,$exe)) { NoLinks $value }; if ($offsite) { NoLinks $offsite }
$port=[int]$cfg.port
if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid backend port' }
$base='http://127.0.0.1:'+$port
$shell=(Get-Process -Id $PID).Path
$inventory=@(Get-ChildItem -LiteralPath $source -Recurse -Force)
if (@($inventory | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Source contains a link or junction; backend was not stopped' }
$size=($inventory | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum
if (-not $size) { throw 'Source data is empty' }
$drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($backup))
if ($drive.AvailableFreeSpace -lt ($size+512MB)) { throw 'Insufficient backup space; backend was not stopped' }
if ($ValidateOnly) { [pscustomobject]@{valid=$true;source_bytes=$size;backup_root=$backup;keep_count=$keep;time_zone=(Get-TimeZone).Id} | ConvertTo-Json; exit 0 }

New-Item -ItemType Directory -Path $backup -Force | Out-Null
$stateRoot=Join-Path $backup 'job-status'; New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null; NoLinks $stateRoot
$maintenance=Join-Path $backup 'maintenance'; New-Item -ItemType Directory -Path $maintenance -Force | Out-Null; NoLinks $maintenance
$lease=$null; $jobLease=$null
try { $lease=[IO.File]::Open((Join-Path $maintenance 'run.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
catch { throw 'Another maintenance run is active; backend was not stopped' }
$run=(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$status=[ordered]@{schema_version=1;run_id=$run;mode='ScheduledCreate';data_root=$source;state='running';phase='preflight';started_at=(Get-Date).ToUniversalTime().ToString('o');finished_at=$null;backup_path='';error='';last_successful_at='';last_successful_backup='';last_successful_backup_created_at=''}
$stopped=$false; $snapshot=''; $failure=''; $startedProcess=$null; $ownsStatus=$false
function Save {
    $json=$status | ConvertTo-Json -Depth 6
    $json | Set-Content -LiteralPath (Join-Path $maintenance ($run+'.json')) -Encoding UTF8
    $temp=Join-Path $stateRoot ('maintenance.'+$run+'.tmp')
    $json | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination (Join-Path $stateRoot 'latest.json') -Force
}
function Healthy {
    foreach ($endpoint in @('/healthz','/readyz')) {
        try { $r=Invoke-RestMethod -Uri ($base+$endpoint) -TimeoutSec 5; if ($r.code -ne 'OK' -or $r.data.status -notin @('ok','ready')) { return $false } }
        catch { return $false }
    }
    return $true
}
function Processes { return @(Get-Process exam_online_cpp -ErrorAction SilentlyContinue) }
function StartBackend {
    # Read a narrowly scoped runtime configuration; never dump inherited secrets.
    foreach ($entry in $cfg.environment.PSObject.Properties) { [Environment]::SetEnvironmentVariable($entry.Name,[string]$entry.Value,'Process') }
    $env:BASE_DIR=$repo; $env:DATA_ROOT=$source; $env:PORT=[string]$port
    $env:BACKUP_STATUS_FILE=Join-Path $stateRoot 'latest.json'
    # WMI detaches the long-lived backend from the scheduled task's process tree.
    $helper=Join-Path $repo 'tools/start_backup_backend.ps1'
    $startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
    $created=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=('"'+$shell+'" -NoProfile -ExecutionPolicy Bypass -File "'+$helper+'" -ConfigPath "'+(Full $ConfigPath)+'" -RunId '+$run);CurrentDirectory=$repo;ProcessStartupInformation=$startup} -ErrorAction Stop
    if ($created.ReturnValue -ne 0) { throw 'Detached backend launcher failed' }
    for ($i=0;$i -lt 60;$i++) {
        if (Healthy) { return $created.ProcessId }
        Start-Sleep -Seconds 1
    }
    throw 'Backend restart health check timed out; inspect maintenance logs'
}
try {
    # Block a manual verification/retention run before stopping the service.
    $jobLease=[IO.File]::Open((Join-Path $stateRoot 'run.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $ownsStatus=$true
    try {
        $previous=Get-Content -LiteralPath (Join-Path $stateRoot 'latest.json') -Raw | ConvertFrom-Json
        foreach ($key in @('last_successful_at','last_successful_backup','last_successful_backup_created_at')) {
            if ($previous.PSObject.Properties[$key]) { $status[$key]=$previous.$key }
        }
    } catch { }
    $processes=@(Processes)
    if ($processes.Count -ne 1 -or -not $processes[0].Path -or -not $processes[0].Path.Equals($exe,[StringComparison]::OrdinalIgnoreCase)) { throw 'Expected exactly the configured backend; no process was stopped' }
    $listener=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    if (@($listener | Where-Object { $_.OwningProcess -ne $processes[0].Id }).Count) { throw 'Backend port belongs to another process' }
    if (-not (Healthy)) { throw 'Backend is not healthy before maintenance; no process was stopped' }
    $status.phase='stopping'; Save
    $target=$processes[0]; $stopped=$true
    Stop-Process -Id $target.Id -ErrorAction Stop
    if (-not $target.WaitForExit(30000)) { throw 'Backend did not exit; backup was not started' }
    if (@(Processes).Count) { throw 'Another backend started; backup was not started' }
    $status.phase='creating'; Save
    $output=& $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools/backup_runtime_data.ps1') -DataRoot $source -BackupRoot $backup 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Snapshot creation failed: '+($output -join "`n")) }
    $match=[regex]::Match(($output -join "`n"),'BACKUP_PATH=([^\r\n]+)')
    if (-not $match.Success) { throw 'Snapshot path was not returned' }
    $snapshot=Full $match.Groups[1].Value.Trim(); $status.backup_path=$snapshot
} catch { $failure=$_.Exception.Message }
finally {
    if ($stopped) {
        $status.phase='restarting'; try { Save } catch { }
        try {
            $running=@(Processes | Where-Object { $_.Path -and $_.Path.Equals($exe,[StringComparison]::OrdinalIgnoreCase) })
            if ($running.Count -eq 0) { $startedProcess=StartBackend }
            elseif ($running.Count -ne 1 -or -not (Healthy)) { throw 'Backend restart could not be confirmed' }
        } catch { $failure=($failure+' Restart failed: '+$_.Exception.Message).Trim() }
    }
    if ($jobLease) { $jobLease.Dispose(); $jobLease=$null }
}
try {
    if ($failure) { throw $failure }
    # The website is running again before full verification, replication and pruning.
    $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $repo 'tools/run_backup_job.ps1'),'-Mode','Verify','-DataRoot',$source,'-BackupRoot',$backup,'-BackupPath',$snapshot,'-KeepCount',[string]$keep,'-ApplyRetention')
    if ($offsite) { $arguments+=@('-OffsiteRoot',$offsite) }
    $output=& $shell @arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Post-start verification failed: '+($output -join "`n")) }
    $status.state='succeeded'; $status.phase='complete'; $status.finished_at=(Get-Date).ToUniversalTime().ToString('o')
    $status | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $maintenance ($run+'.json')) -Encoding UTF8
    Write-Output "BACKUP_PATH=$snapshot"; Write-Output 'SERVICE_RESTARTED_AND_HEALTHY=1'; Write-Output "KEEP_COUNT=$keep"
} catch {
    $status.state='failed'; $status.error=$_.Exception.Message; $status.finished_at=(Get-Date).ToUniversalTime().ToString('o')
    try {
        if ($ownsStatus) {
            $jobLease=[IO.File]::Open((Join-Path $stateRoot 'run.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
            try { Save } finally { $jobLease.Dispose(); $jobLease=$null }
        } else { $status | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $maintenance ($run+'.json')) -Encoding UTF8 }
    } catch { Write-Warning 'Could not save maintenance failure status without interfering with another job' }
    throw
} finally { $lease.Dispose() }
