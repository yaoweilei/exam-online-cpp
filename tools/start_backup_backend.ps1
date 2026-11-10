param([Parameter(Mandatory=$true)][string]$ConfigPath,[Parameter(Mandatory=$true)][string]$RunId)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($RunId -notmatch '^\d{8}-\d{6}-[a-f0-9]{8}$') { throw 'Invalid maintenance run ID' }
$cfg=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
foreach ($entry in $cfg.environment.PSObject.Properties) { [Environment]::SetEnvironmentVariable($entry.Name,[string]$entry.Value,'Process') }
$env:BASE_DIR=$cfg.repo_root; $env:DATA_ROOT=$cfg.data_root; $env:PORT=[string]$cfg.port
$env:BACKUP_STATUS_FILE=Join-Path $cfg.backup_root 'job-status/latest.json'
$logs=Join-Path $cfg.backup_root 'maintenance'
if (@(Get-Process exam_online_cpp -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $cfg.exe_path}).Count) { throw 'Configured backend already running' }
Start-Process -FilePath $cfg.exe_path -WorkingDirectory $cfg.repo_root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs ($RunId+'.backend.out.log')) -RedirectStandardError (Join-Path $logs ($RunId+'.backend.err.log'))
