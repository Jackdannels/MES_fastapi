param([Parameter(Mandatory=$true)][string]$ProjectRoot, [Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $TestDirectory -Force | Out-Null
$controller = Join-Path $ProjectRoot 'scripts/mes-service-control.ps1'
$null = . $controller -Action Status -StateFile (Join-Path $TestDirectory 'missing-state.json') -IgnorePortListeners
function Get-NetTCPConnection { throw 'Slow NetTCPIP provider must not be called during listener polling' }
$ipv4 = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$ipv6 = $null
$fixture = $null
try {
    $ipv4.Start()
    $port4 = $ipv4.LocalEndpoint.Port
    $owners = @(Get-MesListenerOwners @($port4))
    if (-not @($owners | Where-Object { $_.Port -eq $port4 -and $_.ProcessId -eq $PID }).Count) { throw 'IPv4 listener PID or byte order incorrect' }
    if ([Net.Sockets.Socket]::OSSupportsIPv6) {
        $ipv6 = New-Object Net.Sockets.TcpListener([Net.IPAddress]::IPv6Loopback, 0)
        $ipv6.Start()
        $port6 = $ipv6.LocalEndpoint.Port
        $owners = @(Get-MesListenerOwners @($port6))
        if (-not @($owners | Where-Object { $_.Port -eq $port6 -and $_.ProcessId -eq $PID }).Count) { throw 'IPv6 listener PID or byte order incorrect' }
    }
    $ipv4.Stop()
    if (@(Get-MesListenerOwners @($port4)).Count) { throw 'Closed listener remained in native table' }
    # Keep IPv6 as an unrelated listener and prove shutdown does not touch it.
    $childFile = Join-Path $TestDirectory 'isolated-listener.ps1'
    $ready = Join-Path $TestDirectory 'listener-ready.txt'
    @'
param([string]$ReadyFile)
$listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
$listener.Start()
[IO.File]::WriteAllText($ReadyFile,[string]$listener.LocalEndpoint.Port)
try { while($true) { Start-Sleep -Seconds 1 } } finally { $listener.Stop() }
'@ | Set-Content -LiteralPath $childFile -Encoding UTF8
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "'+$childFile+'" -ReadyFile "'+$ready+'"'
    $fixture = Start-Process -FilePath powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $ready)) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Fixture listener did not become ready' }
        Start-Sleep -Milliseconds 50
    }
    $backendPort = [int][IO.File]::ReadAllText($ready)
    # Use the same isolated port for all four selectors; production ports are never queried or stopped.
    $frontendPort = $limsSimulatorPort = $upperComputerSimulatorPort = $backendPort
    $IgnorePortListeners = $false
    $StateFile = Join-Path $TestDirectory 'fixture-state.json'
    @{backendCommandPid=$fixture.Id;frontendCommandPid=0;limsSimulatorCommandPid=0;browserPid=0;launcherSessionId=[Guid]::NewGuid().ToString('N')} |
        ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $result = Stop-MesSystem
    if ($result.status -ne 'stopped') { throw 'Fixture shutdown did not succeed' }
    if (@(Get-MesListenerOwners @($backendPort)).Count -ne 0) { throw 'Fixture port still occupied' }
    if (Test-ProcessAlive $fixture.Id) { throw 'Fixture root process survived shutdown' }
    if (Test-Path -LiteralPath $StateFile) { throw 'Stale fixture state was retained' }
    if ($ipv6 -and -not @(Get-MesListenerOwners @($port6) | Where-Object { $_.ProcessId -eq $PID }).Count) { throw 'Unrelated listener was touched' }
    Write-Output ('Native listener and isolated shutdown regression passed; shutdown '+[Math]::Round($clock.Elapsed.TotalMilliseconds)+' ms.')
} finally {
    $ipv4.Stop()
    if ($ipv6) { $ipv6.Stop() }
    if ($fixture -and (Test-ProcessAlive $fixture.Id)) { Stop-Process -Id $fixture.Id -Force }
}
