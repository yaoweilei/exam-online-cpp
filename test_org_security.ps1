$ts = Get-Date -UFormat "%Y%m%d%H%M%S"
$adminUser = "orgadmin_guard_$ts"
$studentUser = "student_guard_$ts"
$orgName = "GuardOrg_$ts"
$inviteEmail = "guard_$ts@example.local"
$baseUrl = "http://127.0.0.1:8000/api/v1"

function Invoke-ApiRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Method,
        [hashtable]$Headers,
        $Body
    )

    $params = @{
        Uri         = $Url
        Method      = $Method
        ContentType = "application/json"
        ErrorAction = "Stop"
    }
    if ($Headers) {
        $params.Headers = $Headers
    }
    if ($null -ne $Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 8)
    }
    return Invoke-RestMethod @params
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

function Invoke-ExpectFailure {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Method,
        [hashtable]$Headers,
        $Body
    )

    try {
        Invoke-ApiRequest -Url $Url -Method $Method -Headers $Headers -Body $Body | Out-Null
        throw "Request unexpectedly succeeded: $Method $Url"
    }
    catch {
        if (-not $_.Exception.Response) {
            throw
        }

        $response = $_.Exception.Response
        $stream = $response.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $rawBody = $reader.ReadToEnd()
        $reader.Dispose()
        if ($stream) {
            $stream.Dispose()
        }

        $parsedBody = $null
        if ($rawBody) {
            try {
                $parsedBody = $rawBody | ConvertFrom-Json
            }
            catch {
                $parsedBody = $null
            }
        }

        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            RawBody    = $rawBody
            Body       = $parsedBody
        }
    }
}

try {
    $loginAdmin = Invoke-ApiRequest -Url "$baseUrl/auth/login" -Method "Post" -Body @{ username = $adminUser; password = "" }
    Assert-Equal -Actual $loginAdmin.code -Expected "OK" -Message "admin login failed"
    $adminToken = [string]$loginAdmin.data.token
    $adminUserId = [string]$loginAdmin.data.user_id
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($adminToken)) -Message "admin token missing"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($adminUserId)) -Message "admin user id missing"
    $adminHeader = @{ Authorization = "Bearer $adminToken" }

    $loginStudent = Invoke-ApiRequest -Url "$baseUrl/auth/login" -Method "Post" -Body @{ username = $studentUser; password = "" }
    Assert-Equal -Actual $loginStudent.code -Expected "OK" -Message "student login failed"
    $studentToken = [string]$loginStudent.data.token
    $studentUserId = [string]$loginStudent.data.user_id
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($studentToken)) -Message "student token missing"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($studentUserId)) -Message "student user id missing"
    $studentHeader = @{ Authorization = "Bearer $studentToken" }

    $createOrg = Invoke-ApiRequest -Url "$baseUrl/organizations" -Method "Post" -Headers $adminHeader -Body @{
        name = $orgName
        organization_type = "business"
        plan = "free"
        seats = 5
    }
    Assert-Equal -Actual $createOrg.code -Expected "OK" -Message "create organization failed"
    $orgId = [string]$createOrg.data.organization_id
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($orgId)) -Message "organization id missing"

    $addStudent = Invoke-ApiRequest -Url "$baseUrl/organizations/$orgId/members" -Method "Post" -Headers $adminHeader -Body @{
        user_id = $studentUserId
        roles = @("student")
        member_no = "MEM-$ts"
    }
    Assert-Equal -Actual $addStudent.code -Expected "OK" -Message "add student member failed"

    $createInvite = Invoke-ApiRequest -Url "$baseUrl/organizations/$orgId/invitations" -Method "Post" -Headers $adminHeader -Body @{
        email = $inviteEmail
        roles = @("student")
        member_no = "INV-$ts"
        message = "security smoke"
    }
    Assert-Equal -Actual $createInvite.code -Expected "OK" -Message "create invitation failed"
    $inviteToken = [string]$createInvite.data.invite_code
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($inviteToken)) -Message "invite token missing"

    $updateSub = Invoke-ApiRequest -Url "$baseUrl/subscription/$orgId/grant" -Method "Post" -Headers $adminHeader -Body @{
        scope_type = "organization"
        plan = "pro"
        status = "active"
        seats = 30
    }
    Assert-Equal -Actual $updateSub.code -Expected "OK" -Message "organization subscription update failed"

    $orgAdminView = Invoke-ApiRequest -Url "$baseUrl/organizations/$orgId" -Method "Get" -Headers $adminHeader
    Assert-Equal -Actual $orgAdminView.code -Expected "OK" -Message "admin get organization failed"
    $adminInvites = @($orgAdminView.data.invitations)
    $adminAuditLogs = @($orgAdminView.data.audit_logs)
    Assert-True -Condition ($adminInvites.Count -ge 1) -Message "admin should see organization invitations"
    Assert-True -Condition ($adminAuditLogs.Count -ge 4) -Message "admin should see audit logs for create/member/invite/subscription events"

    $orgStudentView = Invoke-ApiRequest -Url "$baseUrl/organizations/$orgId" -Method "Get" -Headers $studentHeader
    Assert-Equal -Actual $orgStudentView.code -Expected "OK" -Message "student get organization failed"
    Assert-True -Condition (-not ($orgStudentView.data.PSObject.Properties.Name -contains "invitations")) -Message "student organization view should hide invitations"
    Assert-True -Condition (-not ($orgStudentView.data.PSObject.Properties.Name -contains "audit_logs")) -Message "student organization view should hide audit logs"

    $studentMembers = Invoke-ApiRequest -Url "$baseUrl/organizations/$orgId/members" -Method "Get" -Headers $studentHeader
    Assert-Equal -Actual $studentMembers.code -Expected "OK" -Message "student should still be able to view organization members"

    $studentManageSubscription = Invoke-ExpectFailure -Url "$baseUrl/subscription/$orgId/grant" -Method "Post" -Headers $studentHeader -Body @{
        scope_type = "organization"
        plan = "ultra"
        status = "active"
        seats = 40
    }
    Assert-Equal -Actual $studentManageSubscription.StatusCode -Expected 403 -Message "student organization subscription update should be forbidden"

    $studentCreateInvite = Invoke-ExpectFailure -Url "$baseUrl/organizations/$orgId/invitations" -Method "Post" -Headers $studentHeader -Body @{
        email = "blocked_$ts@example.local"
        roles = @("student")
    }
    Assert-Equal -Actual $studentCreateInvite.StatusCode -Expected 403 -Message "student invitation creation should be forbidden"

    $removeLastAdmin = Invoke-ExpectFailure -Url "$baseUrl/organizations/$orgId/members/$adminUserId" -Method "Delete" -Headers $adminHeader
    Assert-Equal -Actual $removeLastAdmin.StatusCode -Expected 409 -Message "removing the last org admin should fail"
    if ($removeLastAdmin.Body) {
        Assert-Equal -Actual ([string]$removeLastAdmin.Body.code) -Expected "LAST_ORG_ADMIN" -Message "last org admin error code mismatch"
    }

    Write-Host "Summary:"
    Write-Host "Org ID: $orgId"
    Write-Host "Admin sees invitations: $($adminInvites.Count)"
    Write-Host "Admin sees audit logs: $($adminAuditLogs.Count)"
    Write-Host "Student view hides invitations: $(-not ($orgStudentView.data.PSObject.Properties.Name -contains 'invitations'))"
    Write-Host "Student view hides audit_logs: $(-not ($orgStudentView.data.PSObject.Properties.Name -contains 'audit_logs'))"
    Write-Host "Student manage subscription forbidden: $($studentManageSubscription.StatusCode -eq 403)"
    Write-Host "Student create invitation forbidden: $($studentCreateInvite.StatusCode -eq 403)"
    Write-Host "Last org admin protected: $($removeLastAdmin.StatusCode -eq 409)"
    Write-Host "SUCCESS"
}
catch {
    Write-Host "FAILURE"
    throw
}

function Request($url, $method, $header, $body) {
    try {
        $p = @{Uri=$url; Method=$method; ContentType="application/json"}
        if ($header) { $p.Headers = $header }
        if ($body) { $p.Body = ($body | ConvertTo-Json) }
        return Invoke-RestMethod @p
    } catch {
        return $_
    }
}

$loginAdmin = Request "$baseUrl/auth/login" "Post" $null @{username=$adminUser; password=""}
if ($loginAdmin -is [Exception]) { throw "Admin Login Failed: $($loginAdmin.Exception.Message)" }
$adminHeader = @{Authorization = "Bearer $($loginAdmin.data.token)"}

$createOrg = Request "$baseUrl/organizations" "Post" $adminHeader @{name=$orgName; organization_type="business"; plan="free"; seats=5}
if ($createOrg -is [Exception]) { throw "Create Org Failed: $($createOrg.Exception.Message)" }
$orgId = $createOrg.data.organization_id

$createInvite = Request "$baseUrl/organizations/$orgId/invitations" "Post" $adminHeader @{email=$inviteEmail; roles=@("student"); member_number="m$ts"}
$inviteCode = $createInvite.data.invite_code

$updateSub = Request "$baseUrl/organizations/$orgId/subscription" "Put" $adminHeader @{plan="pro"; seats=30}

$getOrgAdmin = Request "$baseUrl/organizations/$orgId" "Get" $adminHeader $null
$hasInvites = $getOrgAdmin.data.invitations -is [Array]
$hasAuditLogs = $getOrgAdmin.data.audit_logs -is [Array]

$loginStudent = Request "$baseUrl/auth/login" "Post" $null @{username=$studentUser; password=""}
$studentHeader = @{Authorization = "Bearer $($loginStudent.data.token)"}

$acceptInvite = Request "$baseUrl/organizations/invitations/accept" "Post" $studentHeader @{invite_code=$inviteCode}

$getOrgStudent = Request "$baseUrl/organizations/$orgId" "Get" $studentHeader $null
$studentSeesInvites = $null -ne $getOrgStudent.data.invitations
$studentSeesAudit = $null -ne $getOrgStudent.data.audit_logs

$forbiddenStatus = $null
$forbiddenBody = ""
try {
    # Using the path exactly as requested in prompt, ignoring the 404 for a moment to see if it catches
    Invoke-RestMethod -Uri "$baseUrl/subscription/$orgId/grant" -Method Post -Headers $studentHeader -Body (@{scope_type="organization"} | ConvertTo-Json) -ContentType "application/json"
} catch {
    if ($_.Exception.Response) {
         $forbiddenStatus = [int]$_.Exception.Response.StatusCode
         $reader = [System.IO.StreamReader]($_.Exception.Response.GetResponseStream())
         $forbiddenBody = $reader.ReadToEnd()
    } else {
         $forbiddenStatus = "Ex: " + $_.Exception.Message
    }
}

Write-Host "Summary:"
Write-Host "Org ID: $orgId"
Write-Host "Admin Assertions: Invites=$hasInvites, AuditLogs=$hasAuditLogs"
Write-Host "Student Assertions: NoInvites=$(-not $studentSeesInvites), NoAuditLogs=$(-not $studentSeesAudit)"
Write-Host "Forbidden Assert (Expected 403): $forbiddenStatus"
if ($forbiddenStatus -eq 403 -and $hasInvites -and $hasAuditLogs -and (-not $studentSeesInvites) -and (-not $studentSeesAudit)) { 
    Write-Host "SUCCESS" 
} else { 
    Write-Host "FAILURE"
    Write-Host "Reason: Check assertion values above or Forbidden response."
    Write-Host "Forbidden Body: $forbiddenBody"
}
