param(
    [int]$ReferralRewardCredits = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildDir = Join-Path $repoRoot 'cpp-backend\build'
$backendExe = Join-Path $repoRoot 'cpp-backend\build\Release\exam_online_cpp.exe'
$toolchainFile = 'C:\vcpkg\scripts\buildsystems\vcpkg.cmake'
$backendStdout = Join-Path $repoRoot 'logs\backend\local-regression.stdout.log'
$backendStderr = Join-Path $repoRoot 'logs\backend\local-regression.stderr.log'

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host ""
    Write-Host ("==> " + $Message) -ForegroundColor Cyan
}

function Stop-Backend {
    Get-Process exam_online_cpp -ErrorAction SilentlyContinue | Stop-Process -Force
}

function Wait-BackendReady {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            $stdout = if (Test-Path $backendStdout) { Get-Content $backendStdout -TotalCount 40 | Out-String } else { '' }
            $stderr = if (Test-Path $backendStderr) { Get-Content $backendStderr -TotalCount 40 | Out-String } else { '' }
            throw "Backend exited early with code $($Process.ExitCode).`nstdout:`n$stdout`nstderr:`n$stderr"
        }

        if (Test-NetConnection -ComputerName 127.0.0.1 -Port 8000 -InformationLevel Quiet -WarningAction SilentlyContinue) {
            return
        }

        Start-Sleep -Milliseconds 500
    }

    throw "Backend did not become reachable on 127.0.0.1:8000 within $TimeoutSeconds seconds."
}

Push-Location $repoRoot
try {
    Write-Step 'Stopping any stale backend process'
    Stop-Backend

    Write-Step 'Configuring CMake build directory if needed'
    if (-not (Test-Path $buildDir)) {
        & cmake -S cpp-backend -B cpp-backend\build -DCMAKE_TOOLCHAIN_FILE=$toolchainFile
    }

    Write-Step 'Building Release backend and smoke tests'
    & cmake --build cpp-backend\build --config Release

    Write-Step 'Running focused C++ smoke tests'
    & ctest --test-dir cpp-backend\build -C Release -R smoke_tests --output-on-failure

    Write-Step ("Starting backend with REFERRAL_REWARD_CREDITS=" + $ReferralRewardCredits)
    New-Item -ItemType Directory -Path (Join-Path $repoRoot 'logs\backend') -Force | Out-Null
    Remove-Item $backendStdout, $backendStderr -ErrorAction SilentlyContinue
    $previousRewardCredits = $env:REFERRAL_REWARD_CREDITS
    $env:REFERRAL_REWARD_CREDITS = [string]$ReferralRewardCredits
    $backendProcess = Start-Process -FilePath $backendExe -WorkingDirectory $repoRoot -RedirectStandardOutput $backendStdout -RedirectStandardError $backendStderr -PassThru
    if ($null -eq $previousRewardCredits) {
        Remove-Item Env:REFERRAL_REWARD_CREDITS -ErrorAction SilentlyContinue
    }
    else {
        $env:REFERRAL_REWARD_CREDITS = $previousRewardCredits
    }

    Wait-BackendReady -Process $backendProcess

    try {
        Write-Step 'Running organization security regression'
        & powershell -ExecutionPolicy Bypass -File .\test_org_security.ps1

        Write-Step 'Running referral reward integration regression'
        & powershell -ExecutionPolicy Bypass -File .\cpp-backend\tests\integration_flow_smoke.ps1 -ReferralRewardCredits $ReferralRewardCredits

        Write-Step 'Local regression passed'
    }
    finally {
        Write-Step 'Stopping backend'
        Stop-Backend
    }
}
finally {
    Pop-Location
}