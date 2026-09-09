param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

$physicalInterfaceIndexes = @(
    Get-NetAdapter -Physical |
        Where-Object Status -eq 'Up' |
        Select-Object -ExpandProperty InterfaceIndex
)

$addresses = @(
    Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred |
        Where-Object {
            $_.InterfaceIndex -in $physicalInterfaceIndexes -and
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*'
        } |
        Sort-Object InterfaceMetric, InterfaceIndex |
        Select-Object -ExpandProperty IPAddress -Unique
)

if ($addresses.Count -eq 0) {
    Write-Host '[start-cpp] LAN_URL unavailable (no active physical IPv4 adapter)'
    exit 0
}

foreach ($address in $addresses) {
    Write-Host "[start-cpp] LAN_URL=http://${address}:$Port"
}
