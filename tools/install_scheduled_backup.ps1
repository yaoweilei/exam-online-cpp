param(
    [Parameter(Mandatory=$true)][string]$ConfigPath,
    [ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$At='03:00',
    [string]$TaskName='ExamOnlineCpp-NightlyBackup',
    [switch]$Enable
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$configFile=[IO.Path]::GetFullPath($ConfigPath)
if ((Get-TimeZone).Id -ne 'China Standard Time') { throw 'Expected China Standard Time; schedule was not installed' }
$cfg=Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$script=Join-Path $cfg.repo_root 'tools/invoke_scheduled_backup.ps1'
$shell=(Get-Process -Id $PID).Path
& $shell -NoProfile -ExecutionPolicy Bypass -File $script -ConfigPath $configFile -ValidateOnly
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed; schedule was not installed' }
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$action=New-ScheduledTaskAction -Execute $shell -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$script+'" -ConfigPath "'+$configFile+'"') -WorkingDirectory $cfg.repo_root
$trigger=New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.Add([TimeSpan]::Parse($At)))
# No missed-run catch-up: do not stop the website at an unapproved daytime hour.
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun
$settings.StartWhenAvailable=$false; $settings.Enabled=[bool]$Enable
$description='Daily '+$At+' Asia/Shanghai; offline snapshot then restart and health check; retain '+$cfg.keep_count+' verified copies. Configuration: '+$configFile
$old=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($old -and -not $old.Description.StartsWith('Daily ')) { throw 'A task with this name already exists and is not managed by this installer' }
$logon='S4U'; $failure=''
try {
    $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -Force -ErrorAction Stop | Out-Null
} catch {
    $failure=$_.Exception.Message
    $logon='Interactive'
    $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    try { Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -Force -ErrorAction Stop | Out-Null }
    catch { throw ('Windows denied both S4U and current-user task registration. Run this installer from an administrator PowerShell. '+$_.Exception.Message) }
}
$task=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$info=Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
$result=[ordered]@{task_name=$TaskName;enabled=[bool]$Enable;at=$At;time_zone=(Get-TimeZone).Id;keep_count=$cfg.keep_count;backup_root=$cfg.backup_root;logon_type=$logon;next_run=$info.NextRunTime.ToString('o');catch_up_missed_runs=$false;wake_to_run=$task.Settings.WakeToRun}
if ($logon -eq 'Interactive') { $result.warning='This account can only run the task while signed in (screen lock is supported). S4U registration requires administrator permission.' }
$result | ConvertTo-Json -Depth 5
