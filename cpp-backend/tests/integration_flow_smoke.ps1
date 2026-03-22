param(
    [string]$BaseUrl = "http://127.0.0.1:8000/api/v2"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-JsonRequest {
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

    return Invoke-RestMethod @params
}

try {
    $exams = Invoke-JsonRequest -Path "/exams"
    if ($exams.code -ne "OK") { throw "unexpected exams code: $($exams.code)" }
    if (-not $exams.data -or $exams.data.Count -eq 0) {
        Write-Host "[skip] no exams data"
        exit 0
    }

    $examId = [string]$exams.data[0].id
    $examDetail = Invoke-JsonRequest -Path "/exams/$examId"
    if ($examDetail.code -ne "OK") { throw "unexpected exam detail code: $($examDetail.code)" }

    $submit = Invoke-JsonRequest -Path "/answers/submit" -Method "POST" -Body @{
        user_id = "guest"
        exam_id = $examId
        answers = @{}
    }
    if ($submit.code -ne "OK") { throw "unexpected submit code: $($submit.code)" }

    $stats = Invoke-JsonRequest -Path "/statistics/guest"
    if ($stats.code -ne "OK") { throw "unexpected statistics code: $($stats.code)" }

    Write-Host "[ok] integration smoke passed"
}
catch {
    Write-Host "[fail] $($_.Exception.Message)"
    exit 1
}
