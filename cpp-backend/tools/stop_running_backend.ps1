param(
    [Parameter(Mandatory = $true)]
    [string]$ExePath
)

$resolved = Resolve-Path -LiteralPath $ExePath -ErrorAction SilentlyContinue
if (-not $resolved) {
    exit 0
}

$target = $resolved.Path
Get-CimInstance Win32_Process -Filter "Name='exam_online_cpp.exe'" |
    Where-Object { $_.ExecutablePath -eq $target } |
    ForEach-Object {
        Write-Host "[start-cpp] stopping old backend process PID=$($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force
    }
