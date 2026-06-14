param(
    [string]$BaseDir = ".",
    [string]$BaseUrl = "http://127.0.0.1:8000/api/v1",
    [string]$OrgAdminLoginId = "orgadmin_invite_demo",
    [string]$InviteeLoginId = "student_invite_demo",
    [string]$OrganizationName = "Invite Demo Org",
    [string]$InviteeEmail = "orginvite.demo@example.local",
    [string]$InviteePhone = "13800138099"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertTo-Hashtable {
    param([Parameter(Mandatory = $true)]$InputObject)

    if ($null -eq $InputObject) {
        return $null
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
        $table = [ordered]@{}
        foreach ($key in $InputObject.Keys) {
            $table[$key] = ConvertTo-Hashtable -InputObject $InputObject[$key]
        }
        return $table
    }

    if ($InputObject -is [System.Collections.IEnumerable] -and $InputObject -isnot [string]) {
        $items = New-Object System.Collections.Generic.List[object]
        foreach ($item in $InputObject) {
            [void]$items.Add((ConvertTo-Hashtable -InputObject $item))
        }
        return ,$items.ToArray()
    }

    if ($InputObject -is [pscustomobject]) {
        $table = [ordered]@{}
        foreach ($property in $InputObject.PSObject.Properties) {
            $table[$property.Name] = ConvertTo-Hashtable -InputObject $property.Value
        }
        return $table
    }

    return $InputObject
}

function Read-JsonObject {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$DefaultValue
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $DefaultValue
    }

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $DefaultValue
    }

    return ConvertTo-Hashtable -InputObject ($raw | ConvertFrom-Json)
}

function Write-JsonObject {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Payload
    )

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent | Out-Null
    }

    $json = $Payload | ConvertTo-Json -Depth 32
    Set-Content -LiteralPath $Path -Value $json -Encoding UTF8
}

function Invoke-ApiRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Method,
        $Body
    )

    $params = @{
        Uri         = $Url
        Method      = $Method
        ErrorAction = "Stop"
    }
    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = ($Body | ConvertTo-Json -Depth 16)
    }
    return Invoke-RestMethod @params
}

function As-Array {
    param($Value)

    if ($null -eq $Value) {
        return @()
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string] -and $Value -isnot [System.Collections.IDictionary]) {
        return @($Value)
    }
    return @($Value)
}

function Has-Key {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Dictionary,
        [Parameter(Mandatory = $true)][string]$Key
    )

    return $Dictionary.Contains($Key)
}

function Resolve-UserRecord {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Users,
        [Parameter(Mandatory = $true)][string]$UserId,
        [Parameter(Mandatory = $true)][string]$LoginId
    )

    foreach ($entry in $Users.GetEnumerator()) {
        if ($entry.Value -isnot [System.Collections.IDictionary]) {
            continue
        }
        $candidate = $entry.Value
        if ([string]$candidate["id"] -eq $UserId -or
            [string]$candidate["user_id"] -eq $UserId -or
            [string]$candidate["username"] -eq $LoginId -or
            [string]$candidate["dev_login_id"] -eq $LoginId) {
            return $candidate
        }
    }

    if (Has-Key -Dictionary $Users -Key "users") {
        foreach ($candidate in (As-Array $Users["users"])) {
            if ($candidate -isnot [System.Collections.IDictionary]) {
                continue
            }
            if ([string]$candidate["id"] -eq $UserId -or
                [string]$candidate["user_id"] -eq $UserId -or
                [string]$candidate["username"] -eq $LoginId -or
                [string]$candidate["dev_login_id"] -eq $LoginId) {
                return $candidate
            }
        }
    }

    return $null
}

function Set-VerifiedInviteeContacts {
    param(
        [Parameter(Mandatory = $true)][string]$UsersPath,
        [Parameter(Mandatory = $true)][string]$UserId,
        [Parameter(Mandatory = $true)][string]$LoginId,
        [Parameter(Mandatory = $true)][string]$Email,
        [Parameter(Mandatory = $true)][string]$Phone
    )

    $users = Read-JsonObject -Path $UsersPath -DefaultValue ([ordered]@{})
    $record = Resolve-UserRecord -Users $users -UserId $UserId -LoginId $LoginId
    if ($null -eq $record) {
        throw "Unable to locate invitee user in users.json: $LoginId / $UserId"
    }

    $record["email"] = $Email
    $record["email_verified"] = $true
    $record["phone"] = $Phone
    $record["phone_verified"] = $true
    if (-not (Has-Key -Dictionary $record -Key "display_name") -or [string]::IsNullOrWhiteSpace([string]$record["display_name"])) {
        $record["display_name"] = "Org Invite Demo User"
    }
    if (-not (Has-Key -Dictionary $record -Key "status") -or [string]::IsNullOrWhiteSpace([string]$record["status"])) {
        $record["status"] = "active"
    }

    Write-JsonObject -Path $UsersPath -Payload $users
}

$BaseUrl = $BaseUrl.TrimEnd('/')
$resolvedBaseDir = (Resolve-Path -LiteralPath $BaseDir).Path
$usersPath = Join-Path $resolvedBaseDir "data/user/users.json"

Invoke-ApiRequest -Url "$BaseUrl/health" -Method "Get" -Body $null | Out-Null

$adminLogin = Invoke-ApiRequest -Url "$BaseUrl/auth/login" -Method "Post" -Body @{ username = $OrgAdminLoginId; password = "" }
if ([string]$adminLogin.code -ne "OK") {
    throw "Admin login failed for $OrgAdminLoginId"
}
$adminToken = [string]$adminLogin.data.token

$inviteeLogin = Invoke-ApiRequest -Url "$BaseUrl/auth/login" -Method "Post" -Body @{ username = $InviteeLoginId; password = "" }
if ([string]$inviteeLogin.code -ne "OK") {
    throw "Invitee login failed for $InviteeLoginId"
}
$inviteeToken = [string]$inviteeLogin.data.token
$inviteeUserId = [string]$inviteeLogin.data.user_id

Set-VerifiedInviteeContacts -UsersPath $usersPath -UserId $inviteeUserId -LoginId $InviteeLoginId -Email $InviteeEmail -Phone $InviteePhone

$orgList = Invoke-ApiRequest -Url "$BaseUrl/organizations?token=$([System.Uri]::EscapeDataString($adminToken))" -Method "Get" -Body $null
$existingOrganization = As-Array $orgList.data | Where-Object { [string]$_.name -eq $OrganizationName } | Select-Object -First 1

if ($null -eq $existingOrganization) {
    $createdOrganization = Invoke-ApiRequest -Url "$BaseUrl/organizations" -Method "Post" -Body @{
        token = $adminToken
        name = $OrganizationName
        organization_type = "business"
        plan = "pro"
        status = "active"
        seats = 20
    }
    if ([string]$createdOrganization.code -ne "OK") {
        throw "Organization creation failed: $OrganizationName"
    }
    $organizationId = [string]$createdOrganization.data.organization_id
}
else {
    $organizationId = [string]$existingOrganization.organization_id
}

Invoke-ApiRequest -Url "$BaseUrl/subscription/$organizationId/grant" -Method "Post" -Body @{
    token = $adminToken
    scope_type = "organization"
    plan = "pro"
    status = "active"
    seats = 20
} | Out-Null

$membersResponse = Invoke-ApiRequest -Url "$BaseUrl/organizations/${organizationId}/members?token=$([System.Uri]::EscapeDataString($adminToken))" -Method "Get" -Body $null
$members = As-Array $membersResponse.data

$inviteeMembership = $members | Where-Object { [string]$_.user_id -eq $inviteeUserId } | Select-Object -First 1
if ($null -ne $inviteeMembership) {
    Invoke-ApiRequest -Url "$BaseUrl/organizations/${organizationId}/members/${inviteeUserId}?token=$([System.Uri]::EscapeDataString($adminToken))" -Method "Delete" -Body $null | Out-Null
}

$currentOrganization = Invoke-ApiRequest -Url "$BaseUrl/organizations/${organizationId}?token=$([System.Uri]::EscapeDataString($adminToken))" -Method "Get" -Body $null
$pendingInvitations = As-Array $currentOrganization.data.invitations | Where-Object {
    [string]$_.status -eq "pending" -and (([string]$_.contact -eq $InviteeEmail) -or ([string]$_.contact -eq $InviteePhone))
}

foreach ($invitation in $pendingInvitations) {
    Invoke-ApiRequest -Url "$BaseUrl/organizations/$organizationId/invitations/$([string]$invitation.invitation_id)?token=$([System.Uri]::EscapeDataString($adminToken))" -Method "Delete" -Body $null | Out-Null
}

$emailInvitation = Invoke-ApiRequest -Url "$BaseUrl/organizations/$organizationId/invitations" -Method "Post" -Body @{
    token = $adminToken
    email = $InviteeEmail
    roles = @("student")
    member_no = "DEMO-EMAIL"
    message = "local invite demo by email"
}

$phoneInvitation = Invoke-ApiRequest -Url "$BaseUrl/organizations/$organizationId/invitations" -Method "Post" -Body @{
    token = $adminToken
    phone = $InviteePhone
    roles = @("student")
    member_no = "DEMO-PHONE"
    message = "local invite demo by phone"
}

$inviteePending = Invoke-ApiRequest -Url "$BaseUrl/me/invitations?token=$([System.Uri]::EscapeDataString($inviteeToken))" -Method "Get" -Body $null
$inviteePendingItems = As-Array $inviteePending.data | Where-Object { [string]$_.organization_id -eq $organizationId }
$inviteeAcceptable = @($inviteePendingItems | Where-Object { $_.can_accept })

if ($inviteePendingItems.Count -lt 2) {
    throw "Invitee should see both email and phone invitations, but only $($inviteePendingItems.Count) item(s) were returned."
}
if ($inviteeAcceptable.Count -lt 2) {
    throw "Invitee invitations are visible but not all are immediately acceptable."
}

Write-Host "Summary:"
Write-Host "Organization: $OrganizationName"
Write-Host "Organization ID: $organizationId"
Write-Host "Admin Login: $OrgAdminLoginId (development mode empty password)"
Write-Host "Invitee Login: $InviteeLoginId (development mode empty password)"
Write-Host "Invitee Email: $InviteeEmail"
Write-Host "Invitee Phone: $InviteePhone"
Write-Host "Email Invite Code: $([string]$emailInvitation.data.invite_code)"
Write-Host "Phone Invite Code: $([string]$phoneInvitation.data.invite_code)"
Write-Host "Invitee Pending Invitations: $($inviteePendingItems.Count)"
Write-Host "Invitee Acceptable Invitations: $($inviteeAcceptable.Count)"
Write-Host ""
Write-Host "How to test:"
Write-Host "1. Login as $OrgAdminLoginId, open the personal center management view, and review the organization invitation panel."
Write-Host "2. Login as $InviteeLoginId, open personal center, and accept the pending invitation directly."
Write-Host "3. If you want to test invite links, use the printed invite codes or the stub email/SMS output in the backend console."
Write-Host "SUCCESS"