# Split static/style.css into modular files using UTF-8 (no BOM) explicit encoding.
$src = 'd:\_develop\_side\exam-online-cpp\static\style.css'
$dst = 'd:\_develop\_side\exam-online-cpp\static\styles'
New-Item -ItemType Directory -Force -Path $dst | Out-Null

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($src, $utf8NoBom)
$crlf = "`r`n"
$useCrlf = $text.Contains($crlf)
$nl = if ($useCrlf) { $crlf } else { "`n" }

$trimmed = $text.TrimEnd("`r", "`n")
$lines = $trimmed -split "`r?`n"
$total = $lines.Count
Write-Host "Source total lines: $total"

# (StartLine, EndLine, OutputFileName) — line numbers are 1-based inclusive.
$slices = @(
    @( 1,  200, 'tokens.css'),
    @( 201, 387, 'paper-library.css'),
    @( 388, 1953, 'personal-center.css'),
    @( 1954, 2256, 'modals.css'),
    @( 2257, 2399, 'wechat-login.css'),
    @( 2400, 2536, 'layout.css'),
    @( 2537, 2842, 'exam-toolbar.css'),
    @( 2843, 2941, 'exam-controls.css'),
    @( 2942, 3267, 'question-navigation.css'),
    @( 3268, 3449, 'question.css'),
    @( 3450, 3654, 'audio-listening.css'),
    @( 3655, 3782, 'answer-explanation.css'),
    @( 3783, 4541, 'image.css'),
    @( 4542, 4638, 'misc.css'),
    @( 4639, 4798, 'login.css')
)

foreach ($slice in $slices) {
    $start = $slice[0] - 1
    $end = $slice[1] - 1
    $name = $slice[2]
    if ($end -ge $total) { $end = $total - 1 }
    $segment = $lines[$start..$end]
    $segmentText = ($segment -join $nl) + $nl
    $outPath = Join-Path $dst $name
    [System.IO.File]::WriteAllText($outPath, $segmentText, $utf8NoBom)
    Write-Host ("{0}  ({1} lines)  -> {2}" -f $name, ($end - $start + 1), $outPath)
}

# Build a thin entry style.css that @imports the modules in order.
$importBody = @(
    '/*---------------------------------------------------------------------------------------------'
    ' *  Copyright (c) 2025 Yaoweilei. All rights reserved.'
    ' *  Modular entry. Concrete styles live in static/styles/*.css'
    ' *--------------------------------------------------------------------------------------------*/'
    ''
)
foreach ($slice in $slices) {
    $importBody += '@import url("./styles/' + $slice[2] + '");'
}
$importBody += ''

$entryText = ($importBody -join $nl)
[System.IO.File]::WriteAllText($src, $entryText, $utf8NoBom)
Write-Host ("Rewrote entry: {0}" -f $src)
