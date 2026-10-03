Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourcePath = Join-Path $repoRoot 'data\paper\jlpt\n2\N2_2025_07.json'
$outputPath = Join-Path $repoRoot 'data\paper\jlpt\n2\N2_DIAGNOSTIC_V1.json'

$source = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8 | ConvertFrom-Json
$sectionPlan = [ordered]@{
    '1.01' = @{ count = 2; domain = 'vocabulary' }
    '1.02' = @{ count = 2; domain = 'vocabulary' }
    '1.03' = @{ count = 1; domain = 'vocabulary' }
    '1.04' = @{ count = 2; domain = 'vocabulary' }
    '1.05' = @{ count = 1; domain = 'vocabulary' }
    '1.06' = @{ count = 2; domain = 'vocabulary' }
    '1.07' = @{ count = 4; domain = 'grammar' }
    '1.08' = @{ count = 3; domain = 'grammar' }
    '1.09' = @{ count = 3; domain = 'grammar' }
    '1.10' = @{ count = 2; domain = 'reading' }
    '1.11' = @{ count = 2; domain = 'reading' }
    '1.12' = @{ count = 2; domain = 'reading' }
    '1.13' = @{ count = 2; domain = 'reading' }
    '1.14' = @{ count = 2; domain = 'reading' }
    '2.01' = @{ count = 2; domain = 'listening' }
    '2.02' = @{ count = 2; domain = 'listening' }
    '2.03' = @{ count = 2; domain = 'listening' }
    '2.04' = @{ count = 2; domain = 'listening' }
    '2.05' = @{ count = 2; domain = 'listening' }
}

function Copy-JsonValue([object]$value) {
    return $value | ConvertTo-Json -Depth 100 | ConvertFrom-Json
}

$selectedSections = @()
$domainCounts = @{ vocabulary = 0; grammar = 0; reading = 0; listening = 0 }

foreach ($sourceSection in $source.exam_info.sections) {
    $sectionId = [string]$sourceSection.section_id
    if (-not $sectionPlan.Contains($sectionId)) { continue }

    $plan = $sectionPlan[$sectionId]
    $remaining = [int]$plan.count
    $section = Copy-JsonValue $sourceSection
    $section | Add-Member -NotePropertyName diagnostic_domain -NotePropertyValue ([string]$plan.domain) -Force
    $section | Add-Member -NotePropertyName questions -NotePropertyValue @() -Force
    $section | Add-Member -NotePropertyName passages -NotePropertyValue @() -Force

    $directQuestions = if ($null -ne $sourceSection.PSObject.Properties['questions']) { @($sourceSection.questions) } else { @() }
    foreach ($sourceQuestion in $directQuestions) {
        if ($null -eq $sourceQuestion -or $remaining -le 0) { continue }
        $section.questions += Copy-JsonValue $sourceQuestion
        $remaining--
    }

    $sourcePassages = if ($null -ne $sourceSection.PSObject.Properties['passages']) { @($sourceSection.passages) } else { @() }
    foreach ($sourcePassage in $sourcePassages) {
        if ($null -eq $sourcePassage -or $remaining -le 0) { continue }
        $passage = Copy-JsonValue $sourcePassage
        $passage | Add-Member -NotePropertyName questions -NotePropertyValue @() -Force
        foreach ($sourceQuestion in @($sourcePassage.questions)) {
            if ($null -eq $sourceQuestion -or $remaining -le 0) { continue }
            $passage.questions += Copy-JsonValue $sourceQuestion
            $remaining--
        }
        if (@($passage.questions).Count -gt 0) { $section.passages += $passage }
    }

    $selected = [int]$plan.count - $remaining
    if ($selected -ne [int]$plan.count) {
        throw "Section $sectionId only supplied $selected of $($plan.count) requested questions"
    }
    $domainCounts[[string]$plan.domain] += $selected
    $selectedSections += $section
}

foreach ($domain in @('vocabulary', 'grammar', 'reading', 'listening')) {
    if ($domainCounts[$domain] -ne 10) { throw "Diagnostic domain $domain has $($domainCounts[$domain]) questions; expected 10" }
}

$output = Copy-JsonValue $source
$output.exam_info.title = 'JLPT N2 入门诊断（40题）'
$output.exam_info.exam_id = 'N2_DIAGNOSTIC_V1'
$output.exam_info.exam_date = 'diagnostic-v1'
$output.exam_info.exam_level = 'N2'
$output.exam_info | Add-Member -NotePropertyName paper_type -NotePropertyValue 'diagnostic' -Force
$output.exam_info | Add-Member -NotePropertyName duration_minutes -NotePropertyValue 35 -Force
$output.exam_info | Add-Member -NotePropertyName source_exam_id -NotePropertyValue 'N2_2025_07' -Force
$output.exam_info | Add-Member -NotePropertyName diagnostic_version -NotePropertyValue 'diagnostic-v1' -Force
$output.exam_info.sections = $selectedSections
$output | Add-Member -NotePropertyName family -NotePropertyValue 'jlpt' -Force
$output | Add-Member -NotePropertyName access_level -NotePropertyValue 'free' -Force
$json = $output | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($outputPath, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Host "Created $outputPath with 40 questions"
