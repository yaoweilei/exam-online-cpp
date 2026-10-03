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
    $sampleImageSource = Join-Path $repoRoot 'data\image\eju\2024_01'
    $sampleImageParent = Join-Path $runtimeDataRoot 'image\eju'
    New-Item -ItemType Directory -Path $sampleImageParent -Force | Out-Null
    Copy-Item -LiteralPath $sampleImageSource -Destination (Join-Path $sampleImageParent '2024_01') -Recurse -Force
    $sampleAudioSource = Join-Path $repoRoot 'data\audio\eju\2024_01'
    $sampleAudioParent = Join-Path $runtimeDataRoot 'audio\eju'
    New-Item -ItemType Directory -Path $sampleAudioParent -Force | Out-Null
    Copy-Item -LiteralPath $sampleAudioSource -Destination (Join-Path $sampleAudioParent '2024_01') -Recurse -Force
    foreach ($sample in @(
        @{ Year = '2018_01'; Image = 'listening_reading_q01_material.jpg'; Audio = 'track_06.mp3' },
        @{ Year = '2021_01'; Image = 'listening_reading_q04_material.jpg'; Audio = 'track_09.mp3' },
        @{ Year = '2023_02'; Image = 'listening_reading_q01.jpg'; Audio = 'track_06.mp3' }
    )) {
        $imageDestination = Join-Path $sampleImageParent $sample.Year
        $audioDestination = Join-Path $sampleAudioParent $sample.Year
        New-Item -ItemType Directory -Path $imageDestination, $audioDestination -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $repoRoot "data\image\eju\$($sample.Year)\$($sample.Image)") -Destination $imageDestination -Force
        Copy-Item -LiteralPath (Join-Path $repoRoot "data\audio\eju\$($sample.Year)\$($sample.Audio)") -Destination $audioDestination -Force
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
