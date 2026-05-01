Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)))
Push-Location $repoRoot
try {
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
