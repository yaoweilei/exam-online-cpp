param(
    [string]$BaseUrl = 'http://127.0.0.1:8000',
    [int]$MaxResponseMs = 3000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$base = $BaseUrl.TrimEnd('/')
$failures = [System.Collections.Generic.List[string]]::new()
foreach ($endpoint in @('/healthz', '/readyz')) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ($base + $endpoint) -TimeoutSec 10
        $watch.Stop()
        if ($response.StatusCode -ne 200) {
            $failures.Add("$endpoint returned HTTP $($response.StatusCode)")
            continue
        }
        $payload = $response.Content | ConvertFrom-Json
        if ($payload.code -ne 'OK') {
            $failures.Add("$endpoint returned application code $($payload.code)")
        }
        if ($endpoint -eq '/readyz' -and $payload.data.status -ne 'ready') {
            $failures.Add("$endpoint reported status $($payload.data.status)")
        }
        if ($watch.ElapsedMilliseconds -gt $MaxResponseMs) {
            $failures.Add("$endpoint exceeded ${MaxResponseMs}ms: $($watch.ElapsedMilliseconds)ms")
        }
        Write-Output "$endpoint HTTP=$($response.StatusCode) DURATION_MS=$($watch.ElapsedMilliseconds)"
    }
    catch {
        $watch.Stop()
        $failures.Add("$endpoint request failed: $($_.Exception.Message)")
    }
}

if ($failures.Count -gt 0) {
    Write-Host 'Service health check: FAILED' -ForegroundColor Red
    foreach ($failure in $failures) { Write-Host " - $failure" -ForegroundColor Red }
    exit 1
}
Write-Host 'Service health check: PASSED' -ForegroundColor Green
