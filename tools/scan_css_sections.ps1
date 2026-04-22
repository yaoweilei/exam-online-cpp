$src = 'd:\_develop\_side\exam-online-cpp\static\style.css'
$lines = Get-Content -LiteralPath $src
$total = $lines.Count
Write-Host "total=$total"
for ($i = 0; $i -lt $total; $i++) {
    if ($lines[$i] -match '^/\*') {
        Write-Host "$($i + 1): $($lines[$i].Trim())"
    }
}
