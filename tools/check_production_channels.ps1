param(
    [Parameter(Mandatory = $true)]
    [string]$EnvFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$path = [System.IO.Path]::GetFullPath($EnvFile)
if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Production environment file does not exist: $path"
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([^=]+)=(.*)$') { continue }
    $values[$matches[1].Trim()] = $matches[2].Trim()
}

function Value([string]$Name) {
    if ($values.ContainsKey($Name)) { return [string]$values[$Name] }
    return ''
}

function RequireValue([string]$Name, [System.Collections.Generic.List[string]]$Errors) {
    $value = Value $Name
    if (-not $value -or $value -match '(?i)change-me|replace-me|example-secret|your[_-]') {
        $Errors.Add("$Name is missing or still uses a placeholder")
    }
}

$errors = [System.Collections.Generic.List[string]]::new()
if ((Value 'APP_ENV').ToLowerInvariant() -ne 'production') {
    $errors.Add('APP_ENV must be production')
}
$publicUrl = Value 'PUBLIC_WEB_BASE_URL'
if (-not $publicUrl.StartsWith('https://', [System.StringComparison]::OrdinalIgnoreCase)) {
    $errors.Add('PUBLIC_WEB_BASE_URL must use HTTPS')
}
if ((Value 'PAYMENT_PRIMARY_PROVIDER').ToLowerInvariant() -ne 'stripe') {
    $errors.Add('PAYMENT_PRIMARY_PROVIDER must be stripe for the current release')
}
foreach ($name in @('STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET')) {
    RequireValue $name $errors
}
if ((Value 'EMAIL_PROVIDER').ToLowerInvariant() -ne 'resend') {
    $errors.Add('EMAIL_PROVIDER must be resend')
}
foreach ($name in @('EMAIL_API_KEY', 'EMAIL_FROM_ADDRESS')) {
    RequireValue $name $errors
}
if ((Value 'SMS_PROVIDER').ToLowerInvariant() -ne 'twilio') {
    $errors.Add('SMS_PROVIDER must be twilio')
}
foreach ($name in @('SMS_ACCOUNT_SID', 'SMS_AUTH_TOKEN', 'SMS_FROM_NUMBER')) {
    RequireValue $name $errors
}

$googleValues = @('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI')
$googleConfigured = @($googleValues | Where-Object { Value $_ }).Count -gt 0
if ($googleConfigured) {
    foreach ($name in $googleValues) { RequireValue $name $errors }
    if (-not (Value 'GOOGLE_OAUTH_REDIRECT_URI').StartsWith('https://', [System.StringComparison]::OrdinalIgnoreCase)) {
        $errors.Add('GOOGLE_OAUTH_REDIRECT_URI must use HTTPS')
    }
}

$wechatValues = @('WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'WECHAT_CALLBACK_BASE_URL')
$wechatConfigured = @($wechatValues | Where-Object { Value $_ }).Count -gt 0
if ($wechatConfigured) {
    foreach ($name in $wechatValues) { RequireValue $name $errors }
    if (-not (Value 'WECHAT_CALLBACK_BASE_URL').StartsWith('https://', [System.StringComparison]::OrdinalIgnoreCase)) {
        $errors.Add('WECHAT_CALLBACK_BASE_URL must use HTTPS')
    }
}

if ($errors.Count -gt 0) {
    Write-Host 'Production channel configuration: FAILED' -ForegroundColor Red
    foreach ($errorMessage in $errors) { Write-Host " - $errorMessage" -ForegroundColor Red }
    exit 1
}

Write-Host 'Production channel configuration: PASSED' -ForegroundColor Green
Write-Output 'PAYMENT=stripe'
Write-Output 'EMAIL=resend'
Write-Output 'SMS=twilio'
Write-Output "GOOGLE_OAUTH=$($googleConfigured.ToString().ToLowerInvariant())"
Write-Output "WECHAT_LOGIN=$($wechatConfigured.ToString().ToLowerInvariant())"
