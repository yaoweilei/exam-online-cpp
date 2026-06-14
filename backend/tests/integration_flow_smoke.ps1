param(
    [string]$BaseUrl = "http://127.0.0.1:8000/api/v1",
    [int]$ReferralRewardCredits = 10
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

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if ($Actual -ne $Expected) {
        throw "$Message. expected=[$Expected] actual=[$Actual]"
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-MeContext {
    param([Parameter(Mandatory = $true)][string]$Token)

    return Invoke-JsonRequest -Path ("/me/context?token=" + [uri]::EscapeDataString($Token))
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

    $suffix = Get-Date -Format "yyyyMMddHHmmssfff"
    $referrerUsername = "referrer_flow_$suffix"
    $referredUsername = "referred_flow_$suffix"
    $password = "Passw0rd!"

    $registerReferrer = Invoke-JsonRequest -Path "/auth/register" -Method "POST" -Body @{
        username = $referrerUsername
        password = $password
        email    = "$referrerUsername@example.com"
    }
    Assert-Equal -Actual $registerReferrer.code -Expected "OK" -Message "referrer registration failed"

    $loginReferrer = Invoke-JsonRequest -Path "/auth/login" -Method "POST" -Body @{
        username = $referrerUsername
        password = $password
    }
    Assert-Equal -Actual $loginReferrer.code -Expected "OK" -Message "referrer login failed"
    $referrerToken = [string]$loginReferrer.data.token
    $referrerUserId = [string]$loginReferrer.data.user_id
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($referrerToken)) -Message "referrer token missing"

    $referrerContext = Get-MeContext -Token $referrerToken
    Assert-Equal -Actual $referrerContext.code -Expected "OK" -Message "referrer me/context failed"
    $referralCode = [string]$referrerContext.data.user.referral.code
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($referralCode)) -Message "referral code missing from referrer context"
    Assert-Equal -Actual ([int]$referrerContext.data.user.balance.credits) -Expected 0 -Message "referrer credits should start at 0"

    $registerReferred = Invoke-JsonRequest -Path "/auth/register" -Method "POST" -Body @{
        username      = $referredUsername
        password      = $password
        email         = "$referredUsername@example.com"
        referral_code = $referralCode
    }
    Assert-Equal -Actual $registerReferred.code -Expected "OK" -Message "referred registration failed"

    $loginReferred = Invoke-JsonRequest -Path "/auth/login" -Method "POST" -Body @{
        username = $referredUsername
        password = $password
    }
    Assert-Equal -Actual $loginReferred.code -Expected "OK" -Message "referred login failed"
    $referredToken = [string]$loginReferred.data.token
    $referredUserId = [string]$loginReferred.data.user_id
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($referredToken)) -Message "referred token missing"

    $referredContext = Get-MeContext -Token $referredToken
    Assert-Equal -Actual $referredContext.code -Expected "OK" -Message "referred me/context failed"
    Assert-Equal -Actual ([string]$referredContext.data.user.referral.referred_by_code) -Expected $referralCode -Message "referred_by_code mismatch"
    Assert-Equal -Actual ([string]$referredContext.data.user.referral.reward_status) -Expected "pending" -Message "referral reward should start pending"

    $trialGrant = Invoke-JsonRequest -Path "/subscription/$referredUserId/grant" -Method "POST" -Body @{
        token      = $referredToken
        scope_type = "personal"
        plan       = "pro"
        status     = "trial"
    }
    Assert-Equal -Actual $trialGrant.code -Expected "OK" -Message "trial subscription grant failed"

    $referredAfterTrial = Get-MeContext -Token $referredToken
    Assert-Equal -Actual ([string]$referredAfterTrial.data.user.referral.reward_status) -Expected "pending" -Message "trial should not settle referral reward"
    $referrerAfterTrial = Get-MeContext -Token $referrerToken
    Assert-Equal -Actual ([int]$referrerAfterTrial.data.user.balance.credits) -Expected 0 -Message "trial should not grant referrer credits"

    $activeGrant = Invoke-JsonRequest -Path "/subscription/$referredUserId/grant" -Method "POST" -Body @{
        token      = $referredToken
        scope_type = "personal"
        plan       = "pro"
        status     = "active"
    }
    Assert-Equal -Actual $activeGrant.code -Expected "OK" -Message "active subscription grant failed"

    $referredAfterActive = Get-MeContext -Token $referredToken
    Assert-Equal -Actual ([string]$referredAfterActive.data.user.referral.reward_status) -Expected "granted" -Message "active paid subscription should settle referral reward"
    Assert-Equal -Actual ([int]$referredAfterActive.data.user.referral.reward_credit_amount) -Expected $ReferralRewardCredits -Message "reward credit amount mismatch"
    Assert-Equal -Actual ([string]$referredAfterActive.data.user.referral.reward_credit_recipient_user_id) -Expected $referrerUserId -Message "reward recipient mismatch"

    $referrerAfterActive = Get-MeContext -Token $referrerToken
    Assert-Equal -Actual ([int]$referrerAfterActive.data.user.balance.credits) -Expected $ReferralRewardCredits -Message "referrer credits should be granted after active paid subscription"

    $activeGrantRepeat = Invoke-JsonRequest -Path "/subscription/$referredUserId/grant" -Method "POST" -Body @{
        token      = $referredToken
        scope_type = "personal"
        plan       = "pro"
        status     = "active"
    }
    Assert-Equal -Actual $activeGrantRepeat.code -Expected "OK" -Message "repeated active subscription grant failed"

    $referrerAfterRepeat = Get-MeContext -Token $referrerToken
    Assert-Equal -Actual ([int]$referrerAfterRepeat.data.user.balance.credits) -Expected $ReferralRewardCredits -Message "referrer credits should remain idempotent after repeated activation"

    Write-Host "[ok] integration smoke passed"
}
catch {
    Write-Host "[fail] $($_.Exception.Message)"
    exit 1
}
