param(
    [string]$BaseUrl = "http://127.0.0.1:8000/api/v1"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Json {
    param([Parameter(Mandatory = $true)][string]$Path)
    return Invoke-RestMethod -Uri ($BaseUrl + $Path) -Method Get
}

function Assert-Envelope {
    param([Parameter(Mandatory = $true)]$Payload)
    foreach ($key in @("code", "message", "data", "request_id", "ts")) {
        if (-not ($Payload.PSObject.Properties.Name -contains $key)) {
            throw "missing key: $key"
        }
    }
}

try {
    $exams = Get-Json -Path "/exams"
    Assert-Envelope -Payload $exams
    if ($exams.code -ne "OK") { throw "unexpected exams code: $($exams.code)" }
    if ($null -eq $exams.data -or $exams.data -isnot [System.Collections.IEnumerable]) { throw "exams data is not a list" }

    $roles = Get-Json -Path "/roles"
    Assert-Envelope -Payload $roles
    if ($roles.code -ne "OK") { throw "unexpected roles code: $($roles.code)" }
    if ($null -eq $roles.data) { throw "roles data is null" }

    Write-Host "[ok] contract smoke passed"
}
catch {
    Write-Host "[fail] $($_.Exception.Message)"
    exit 1
}
