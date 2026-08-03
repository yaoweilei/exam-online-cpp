Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)))
$repoRoot = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\', '/')
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'tmp\e2e-runtime'))
$runtimeDataRoot = Join-Path $runtimeRoot 'data'
$expectedPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar

if (-not $runtimeRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to prepare E2E runtime outside the repository: $runtimeRoot"
}

Push-Location $repoRoot
try {
    $backendExe = Join-Path $repoRoot 'backend\build\Release\exam_online_cpp.exe'
    if (Test-Path -LiteralPath $backendExe) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File backend/tools/stop_running_backend.ps1 -ExePath $backendExe
        if ($LASTEXITCODE -ne 0) {
            throw 'failed to stop an existing backend before preparing E2E data'
        }
    }

    if (Test-Path -LiteralPath $runtimeRoot) {
        Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $runtimeDataRoot -Force | Out-Null

    Write-Host "[e2e] preparing isolated data at $runtimeDataRoot"
    foreach ($dataArea in @('paper', 'system', 'user')) {
        $source = Join-Path $repoRoot "data\$dataArea"
        $destination = Join-Path $runtimeDataRoot $dataArea
        Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
    }

    $env:APP_ENV = 'development'
    $env:BUILD_CONFIG = 'Release'
    $env:THREADS = '1'
    $env:BASE_DIR = $repoRoot
    $env:DOCUMENT_ROOT = Join-Path $repoRoot 'static'
    $env:DATA_ROOT = $runtimeDataRoot
    $env:LOG_DIR = Join-Path $runtimeRoot 'logs'
    $env:LOG_FILE_BASENAME = 'exam-online-cpp-e2e'

    Write-Host '[e2e] building frontend bundle'
    & npm --prefix frontend run build
    if ($LASTEXITCODE -ne 0) {
        throw 'frontend build failed'
    }

    Write-Host '[e2e] starting backend'
    & cmd /c start-cpp.bat
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
