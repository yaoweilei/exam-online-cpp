param(
    [string]$BaseUrl = "http://127.0.0.1:8000/api/v2",
    [int]$Iterations = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-TimedJsonRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [ValidateSet("GET", "POST", "DELETE")][string]$Method = "GET",
        [object]$Body = $null
    )

    $params = @{
        Uri    = $BaseUrl + $Path
        Method = $Method
    }

    if ($null -ne $Body) {
        $params["Body"] = ($Body | ConvertTo-Json -Depth 16)
        $params["ContentType"] = "application/json"
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $result = Invoke-RestMethod @params
    $sw.Stop()

    return @{
        DurationMs = $sw.Elapsed.TotalMilliseconds
        Payload = $result
    }
}

function Get-P95 {
    param([double[]]$Values)

    if (-not $Values -or $Values.Count -eq 0) {
        return 0.0
    }

    $sorted = $Values | Sort-Object
    $index = [Math]::Max(0, [int]([Math]::Ceiling($sorted.Count * 0.95)) - 1)
    return [double]$sorted[$index]
}

$readLat = New-Object System.Collections.Generic.List[double]
$scoreLat = New-Object System.Collections.Generic.List[double]

$examList = Invoke-TimedJsonRequest -Path "/exams"
if (-not $examList.Payload.data -or $examList.Payload.data.Count -eq 0) {
    Write-Host "no exams found, skip"
    exit 0
}

$examId = [string]$examList.Payload.data[0].id

for ($i = 0; $i -lt $Iterations; $i++) {
    $result = Invoke-TimedJsonRequest -Path "/exams/$examId"
    [void]$readLat.Add([double]$result.DurationMs)
}

for ($i = 0; $i -lt $Iterations; $i++) {
    $result = Invoke-TimedJsonRequest -Path "/answers/submit" -Method "POST" -Body @{
        user_id = "guest"
        exam_id = $examId
        answers = @{}
    }
    [void]$scoreLat.Add([double]$result.DurationMs)
}

$readMean = ($readLat | Measure-Object -Average).Average
$scoreMean = ($scoreLat | Measure-Object -Average).Average

Write-Host ("read mean={0:N2}ms p95={1:N2}ms" -f $readMean, (Get-P95 -Values $readLat.ToArray()))
Write-Host ("score mean={0:N2}ms p95={1:N2}ms" -f $scoreMean, (Get-P95 -Values $scoreLat.ToArray()))
