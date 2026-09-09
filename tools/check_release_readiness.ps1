param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$AllowDirty
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
    throw "Repository root was not found: $root"
}

$violations = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

Push-Location $root
try {
    $tracked = @(git ls-files)
    if ($LASTEXITCODE -ne 0) {
        throw 'git ls-files failed'
    }

    $forbiddenTracked = @(
        $tracked | Where-Object {
            $_ -eq '.env' -or
            $_ -match '(?i)(^|/)(logs?|tmp|temp|playwright-report|test-results)/' -or
            $_ -match '(?i)\.sqlite3-(wal|shm)$' -or
            $_ -match '(?i)\.(backup|bak)$'
        }
    )
    foreach ($path in $forbiddenTracked) {
        $violations.Add("Runtime or sensitive file is still tracked by Git: $path")
    }

    if (-not $AllowDirty) {
        $dirty = @(git status --short --untracked-files=all)
        if ($LASTEXITCODE -ne 0) {
            throw 'git status failed'
        }
        if ($dirty.Count -gt 0) {
            $violations.Add("The release baseline is dirty: $($dirty.Count) changed paths")
        }
    }

    # Runtime stores are deliberately excluded here.  They must be untracked
    # (validated above), while whitespace validation remains focused on source,
    # tests, static assets, configuration samples, and curated paper content.
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & git diff --check -- . ':(exclude)data/user/**' ':(exclude)data/system/**' 2>$null | Out-Null
    $gitDiffExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($gitDiffExitCode -ne 0) {
        $violations.Add('git diff --check failed')
    }

    $requiredArtifacts = @(
        'backend/build/Release/exam_online_cpp.exe',
        'backend/build/Release/smoke_tests.exe',
        'static/app/main.js',
        'static/index.html',
        'static/legal/privacy-policy.html',
        'static/legal/user-agreement.html',
        'tools/audit_exam_content.mjs',
        'tools/backup_runtime_data.ps1',
        'tools/restore_runtime_data.ps1',
        'tools/check_service_health.ps1',
        'tools/check_production_channels.ps1'
    )
    foreach ($path in $requiredArtifacts) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $path))) {
            $violations.Add("Required release artifact is missing: $path")
        }
    }

    $contentAuditScript = Join-Path $root 'tools/audit_exam_content.mjs'
    if (-not (Test-Path -LiteralPath $contentAuditScript)) {
        $violations.Add('Content audit script is missing: tools/audit_exam_content.mjs')
    }
    elseif (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        $violations.Add('Node.js is required to execute the content release audit')
    }
    else {
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & node $contentAuditScript *> $null
        $contentAuditExitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousErrorActionPreference
        if ($contentAuditExitCode -ne 0) {
            $violations.Add('Content audit found blocking issues; run node tools/audit_exam_content.mjs for details')
        }
    }
}
finally {
    Pop-Location
}

foreach ($warning in $warnings) {
    Write-Warning $warning
}

if ($violations.Count -gt 0) {
    Write-Host 'V1.0 release gate: FAILED' -ForegroundColor Red
    foreach ($violation in $violations) {
        Write-Host " - $violation" -ForegroundColor Red
    }
    exit 1
}

Write-Host 'V1.0 release gate: PASSED' -ForegroundColor Green
if ($warnings.Count -gt 0) {
    Write-Host "Warnings: $($warnings.Count) (manual sign-off required before production release)" -ForegroundColor Yellow
}
