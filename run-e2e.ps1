param(
    [switch]$Headed,
    [switch]$Ui,
    [string]$Spec
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host ""
    Write-Host ("==> " + $Message) -ForegroundColor Cyan
}

Push-Location $repoRoot
try {
    $playwrightCmd = @('playwright', 'test')

    if ($Headed) {
        $playwrightCmd += '--headed'
    }

    if ($Ui) {
        $playwrightCmd += '--ui'
        $playwrightCmd += '--ui-host'
        $playwrightCmd += '127.0.0.1'
    }

    if ($Spec) {
        $playwrightCmd += $Spec
    }

    Write-Step 'Installing npm dependencies if needed'
    if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
        & npm ci
        if ($LASTEXITCODE -ne 0) {
            throw 'npm ci failed'
        }
    }

    Write-Step 'Ensuring Playwright browser dependencies are installed'
    & npm run e2e:install
    if ($LASTEXITCODE -ne 0) {
        throw 'playwright browser install failed'
    }

    Write-Step ('Running E2E tests: ' + ($playwrightCmd -join ' '))
    & npx @playwrightCmd
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
