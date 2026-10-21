# Host-side networking/startup helpers. Never log business credentials.
function Get-MesEnvironmentValue([string]$Text, [string]$Name, [string]$Fallback = '') {
    $match = [regex]::Match($Text, '(?m)^' + [regex]::Escape($Name) + '=([^\r\n]*)')
    if (-not $match.Success) { return $Fallback }
    return $match.Groups[1].Value.Trim().Trim('"', "'")
}
function Set-MesEnvironmentValue([string]$Text, [string]$Name, [string]$Value) {
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=[^\r\n]*'
    if ([regex]::IsMatch($Text, $pattern)) { return [regex]::Replace($Text, $pattern, $Name + '=' + $Value) }
    return $Text.TrimEnd("`r", "`n") + "`n" + $Name + '=' + $Value + "`n"
}
function Get-MesLanInterfaces {
    $candidates = @(foreach ($adapter in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($adapter.OperationalStatus -ne 'Up' -or $adapter.NetworkInterfaceType -notin @('Ethernet','Wireless80211','GigabitEthernet','FastEthernetFx','FastEthernetT')) { continue }
        if (($adapter.Name + ' ' + $adapter.Description) -match 'vEthernet|WSL|Docker|Hyper-V|VirtualBox|VMware|Loopback|Tunnel|TAP-Windows|Virtual Ethernet') { continue }
        try {
            $properties = $adapter.GetIPProperties()
            $gateway = @($properties.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0' }).Count -gt 0
            foreach ($address in $properties.UnicastAddresses) {
                $ip = $address.Address
                if ($ip.AddressFamily -ne 'InterNetwork' -or [Net.IPAddress]::IsLoopback($ip)) { continue }
                $bytes = $ip.GetAddressBytes()
                if ($bytes[0] -eq 0 -or $bytes[0] -ge 224 -or ($bytes[0] -eq 169 -and $bytes[1] -eq 254)) { continue }
                [pscustomobject]@{Name=$adapter.Name;Address=$ip.ToString();HasGateway=$gateway;Wired=($adapter.NetworkInterfaceType -ne 'Wireless80211')}
            }
        } catch { continue }
    })
    return @($candidates | Sort-Object @{Expression='HasGateway';Descending=$true},@{Expression='Wired';Descending=$true},Name,Address)
}
function Set-MesWebFirewall([string]$ProjectName, [int]$Port) {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Warning "MES Web LAN port $Port requires a firewall rule; run the control center once as administrator if remote access is blocked."
        return
    }
    $ruleName = 'MES-Portable-Web-' + ($ProjectName -replace '[^a-zA-Z0-9_-]', '-')
    & netsh.exe advfirewall firewall delete rule "name=$ruleName" *> $null
    & netsh.exe advfirewall firewall add rule "name=$ruleName" dir=in action=allow protocol=TCP "localport=$Port" profile=private remoteip=localsubnet *> $null
    if ($LASTEXITCODE -ne 0) { Write-Warning "MES Web firewall rule could not be applied for port $Port." }
}
function Update-MesPortableNetwork([string]$EnvironmentFile, [switch]$ConfigureFirewall) {
    $text = [IO.File]::ReadAllText($EnvironmentFile)
    $mode = Get-MesEnvironmentValue $text 'MES_NETWORK_MODE' 'auto'
    if ($mode -notin @('auto','manual')) { throw 'MES_NETWORK_MODE must be auto or manual' }
    $port = 0
    if (-not [int]::TryParse((Get-MesEnvironmentValue $text 'MES_WEB_PORT' '15173'), [ref]$port) -or $port -lt 1024 -or $port -gt 65535) { throw 'MES_WEB_PORT must be 1024..65535' }
    if ($mode -eq 'manual') { return [pscustomobject]@{Mode=$mode;PublicUrl=(Get-MesEnvironmentValue $text 'MES_PUBLIC_URL');Changed=$false;Port=$port;BackupPath=''} }
    $interfaces = @(Get-MesLanInterfaces)
    $preferred = Get-MesEnvironmentValue $text 'MES_LAN_IP'
    if ($preferred -and $preferred -notin @($interfaces | ForEach-Object { $_.Address })) { throw 'MES_LAN_IP is not an active physical LAN address on this PC' }
    $address = '127.0.0.1'
    if ($preferred) { $address = $preferred }
    elseif ($interfaces.Count -gt 0) { $address = $interfaces[0].Address }
    $url = 'http://' + $address + ':' + $port
    $origins = @($url, ('http://127.0.0.1:' + $port), ('http://localhost:' + $port))
    $origins += @($interfaces | ForEach-Object { 'http://' + $_.Address + ':' + $port })
    $updated = Set-MesEnvironmentValue $text 'MES_NETWORK_MODE' 'auto'
    $updated = Set-MesEnvironmentValue $updated 'MES_BIND_ADDRESS' '0.0.0.0'
    $updated = Set-MesEnvironmentValue $updated 'MES_PUBLIC_URL' $url
    $updated = Set-MesEnvironmentValue $updated 'MES_FRONTEND_ORIGINS' (($origins | Select-Object -Unique) -join ',')
    $backup = ''
    if ($updated -cne $text) {
        $backup = $EnvironmentFile + '.network-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
        [IO.File]::Copy($EnvironmentFile, $backup, $false)
        $temporary = $EnvironmentFile + '.network-' + [Guid]::NewGuid().ToString('N')
        try {
            [IO.File]::WriteAllText($temporary, $updated, (New-Object Text.UTF8Encoding($false)))
            [IO.File]::Replace($temporary, $EnvironmentFile, $backup)
        } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
    }
    if ($ConfigureFirewall) { Set-MesWebFirewall (Get-MesEnvironmentValue $updated 'COMPOSE_PROJECT_NAME' 'mes-portable') $port }
    if ($interfaces.Count -eq 0) { Write-Warning 'No active wired/Wi-Fi IPv4 interface found; connect the LAN and start again to update public URLs.' }
    return [pscustomobject]@{Mode=$mode;PublicUrl=$url;Changed=($updated -cne $text);Port=$port;BackupPath=$backup}
}
function Test-MesDockerEngine {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = 'docker.exe'
    $info.Arguments = 'info --format "{{.ServerVersion}}"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { return $false }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(5000)) { $process.Kill(); return $false }
        return $process.ExitCode -eq 0
    } catch { return $false }
    finally { $process.Dispose() }
}
function Wait-MesDockerEngine {
    if (Test-MesDockerEngine) { return }
    $desktop = Join-Path $env:ProgramFiles 'Docker/Docker/Docker Desktop.exe'
    if (-not (Test-Path -LiteralPath $desktop)) { throw 'Docker engine is unavailable. Start the configured Docker engine first.' }
    Write-Host 'Starting Docker Desktop and waiting for its Linux engine...'
    Start-Process -FilePath $desktop -WindowStyle Hidden | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(180)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-MesDockerEngine) { return }
        Start-Sleep -Seconds 2
    }
    throw 'Docker Desktop did not become ready within 180 seconds. Inspect its startup diagnostics.'
}
function Write-MesStartupOverride([string]$Path, [bool]$FastHealthChecks) {
    $directory = Split-Path -Parent $Path
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $gzip = Join-Path $directory 'mes-portable-performance.conf'
    [IO.File]::WriteAllText($gzip, "gzip on;`ngzip_vary on;`ngzip_min_length 1024;`ngzip_comp_level 5;`ngzip_types text/css application/javascript text/javascript image/svg+xml;`n", (New-Object Text.UTF8Encoding($false)))
    $content = "services:`n"
    foreach ($service in @('mysql','rabbitmq','api','web','lims-simulator','upper-simulator')) {
        $content += '  ' + $service + ":`n"
        if ($FastHealthChecks -or $service -eq 'rabbitmq') {
            $content += "    healthcheck:`n"
            if ($FastHealthChecks) { $content += "      start_interval: 1s`n      start_period: 60s`n" }
            if ($service -eq 'rabbitmq') {
                # Erlang ping can succeed before AMQP/MQTT listeners exist.
                $content += '      test: ["CMD-SHELL", "rabbitmq-diagnostics -q check_protocol_listener amqp && rabbitmq-diagnostics -q check_protocol_listener mqtt"]' + "`n      timeout: 10s`n"
            }
        }
        if ($service -eq 'web') {
            $content += "    volumes:`n      - type: bind`n        source: " + (($gzip.Replace('\','/')) | ConvertTo-Json -Compress) + "`n        target: /etc/nginx/conf.d/mes-performance.conf`n        read_only: true`n"
        } elseif (-not $FastHealthChecks) { $content += "    restart: unless-stopped`n" }
    }
    [IO.File]::WriteAllText($Path, $content, (New-Object Text.UTF8Encoding($false)))
}
