param(
    [string]$BaseDir = "."
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Text)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $sha.ComputeHash($bytes)
        return -join ($hash | ForEach-Object { $_.ToString("x2") })
    }
    finally {
        $sha.Dispose()
    }
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

function Normalize-Roles {
    param([Parameter(Mandatory = $true)][hashtable]$Raw)

    if ($Raw.ContainsKey("roles") -and $Raw["roles"] -is [System.Collections.IEnumerable]) {
        $normalized = [ordered]@{}
        foreach ($role in $Raw["roles"]) {
            if ($null -eq $role) { continue }
            $roleId = [string]$role["id"]
            if ([string]::IsNullOrWhiteSpace($roleId)) { continue }

            $permissions = @()
            if ($role.ContainsKey("permissions")) {
                $permissions = @($role["permissions"])
            }
            elseif ($role.ContainsKey("privileges")) {
                $permissions = @($role["privileges"])
            }

            $normalized[$roleId] = [ordered]@{
                id = $roleId
                name = if ($role.ContainsKey("name")) { [string]$role["name"] } else { $roleId }
                description = if ($role.ContainsKey("description")) { [string]$role["description"] } else { "" }
                permissions = $permissions
            }
        }
        return $normalized
    }

    return $Raw
}

function Normalize-Users {
    param([Parameter(Mandatory = $true)][hashtable]$Raw)

    $users = [ordered]@{}
    foreach ($entry in $Raw.GetEnumerator()) {
        if ($entry.Value -isnot [hashtable]) { continue }
        $payload = $entry.Value
        $username = [string]$entry.Key
        $roles = @()
        if ($payload.ContainsKey("roles")) {
            $roles = @($payload["roles"])
        }
        elseif ($payload.ContainsKey("roleIds")) {
            $roles = @($payload["roleIds"])
        }
        else {
            $roles = @("user")
        }

        $passwordHash = ""
        if ($payload.ContainsKey("password_hash") -and -not [string]::IsNullOrWhiteSpace([string]$payload["password_hash"])) {
            $passwordHash = [string]$payload["password_hash"]
        }
        elseif ($payload.ContainsKey("password") -and -not [string]::IsNullOrWhiteSpace([string]$payload["password"])) {
            $passwordHash = [string]$payload["password"]
        }
        else {
            $passwordHash = Get-Sha256Hex -Text $username
        }

        $users[$username] = [ordered]@{
            id = if ($payload.ContainsKey("id")) { [string]$payload["id"] } else { $username }
            username = if ($payload.ContainsKey("username")) { [string]$payload["username"] } else { $username }
            password_hash = $passwordHash
            password_algo = if ($payload.ContainsKey("password_algo")) { [string]$payload["password_algo"] } else { "sha256" }
            email = if ($payload.ContainsKey("email")) { [string]$payload["email"] } else { "" }
            roles = $roles
            created_at = if ($payload.ContainsKey("created_at")) { [string]$payload["created_at"] } else { "" }
        }
    }

    if (-not $users.Contains("guest")) {
        $users["guest"] = [ordered]@{
            id = "guest"
            username = "guest"
            password_hash = (Get-Sha256Hex -Text "guest")
            password_algo = "sha256"
            email = ""
            roles = @("guest")
            created_at = ""
        }
    }

    return $users
}

$resolvedBase = (Resolve-Path -LiteralPath $BaseDir).Path
$userDir = Join-Path $resolvedBase "data/user"
$rolesPath = Join-Path $userDir "roles.json"
$usersPath = Join-Path $userDir "users.json"

$roles = Normalize-Roles -Raw (Read-JsonObject -Path $rolesPath -DefaultValue ([ordered]@{}))
$users = Normalize-Users -Raw (Read-JsonObject -Path $usersPath -DefaultValue ([ordered]@{}))

Write-JsonObject -Path $rolesPath -Payload $roles
Write-JsonObject -Path $usersPath -Payload $users

Write-Host "[ok] normalized roles: $rolesPath"
Write-Host "[ok] normalized users: $usersPath"
