[CmdletBinding()]
param(
    [ValidateSet('Status','Start','Stop','Restart','NetworkInfo')] [string]$Action = 'Status',
    [string]$ResultFile = '',
    [string]$ConfigurationFile = '',
    [switch]$NoOpen,
    [switch]$ValidateOnly,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$toolRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $ConfigurationFile) { $ConfigurationFile = Join-Path $toolRoot 'mes-desktop-tools.json' }

function Resolve-SettingPath([string]$Base, [string]$Value) {
    if ([IO.Path]::IsPathRooted($Value)) { return [IO.Path]::GetFullPath($Value) }
    return [IO.Path]::GetFullPath((Join-Path $Base $Value))
}
function Write-Result($Value) {
    $json = $Value | ConvertTo-Json -Depth 5 -Compress
    if ($ResultFile) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($ResultFile), $json, (New-Object Text.UTF8Encoding($false))) }
    Write-Output $json
}
function Test-Service([string]$Url, [string]$Property = '', [string]$Expected = '') {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
        if ($response.StatusCode -ne 200) { return $false }
        if ($Property) {
            $body = $response.Content | ConvertFrom-Json
            return ([string]$body.$Property).ToLowerInvariant() -eq $Expected
        }
        return $true
    } catch { return $false }
}
function Get-MesDockerPageUrls {
    $server=[string]$config.serverUrl
    $environmentText=[IO.File]::ReadAllText($environment)
    $publicUrl=[regex]::Match($environmentText,'(?m)^MES_PUBLIC_URL=([^\r\n]*)')
    if($publicUrl.Success -and $publicUrl.Groups[1].Value.Trim()) {
        $server=$publicUrl.Groups[1].Value.Trim().Trim('"', "'")
    }
    $urls=@($server)
    if($mode -eq 'demo'){$urls += [string]$config.limsUrl; $urls += [string]$config.upperComputerUrl}
    return @($urls | Select-Object -Unique)
}
function Open-MesDockerPages {
    $warnings=@()
    foreach($url in @(Get-MesDockerPageUrls)) {
        try {
            $uri=$null
            if(-not [Uri]::TryCreate($url,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -notin @('http','https') -or $uri.UserInfo) {
                throw 'MES 页面地址不是有效的 HTTP(S) 地址'
            }
            Start-Process -FilePath $uri.AbsoluteUri | Out-Null
        } catch { $warnings += '服务已启动，浏览器打开失败，请手动访问：'+$url }
    }
    return $warnings
}

try {
    $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $ConfigurationFile | ConvertFrom-Json
    $deployment = Resolve-SettingPath $toolRoot ([string]$config.deploymentDirectory)
    $environment = Resolve-SettingPath $deployment ([string]$config.environmentFile)
    $entry = Join-Path $deployment 'scripts/deploy/Mes-Portable.ps1'
    foreach ($path in @($environment, $entry, (Join-Path $deployment 'compose.portable.yml'))) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "未找到部署文件，请运行 Configure-DesktopTools.ps1 配置实际路径：$path" }
    }
    $mode = [string]$config.mode
    if ($mode -notin @('demo','mes')) { throw '桌面程序的 mode 必须是 demo 或 mes' }
    if ($ValidateOnly -or $DryRun) {
        Write-Result ([ordered]@{status='validated'; message='Docker 桌面程序路径配置有效'; action=$Action; deploymentDirectory=$deployment; environmentFile=$environment; mode=$mode})
        exit 0
    }
    if ($Action -eq 'NetworkInfo') {
        # Read only: never run Start/Stop or change the environment/firewall.
        $composeArguments = @('compose','--env-file',$environment,'-f',(Join-Path $deployment 'compose.portable.yml'))
        if ($mode -eq 'demo') { $composeArguments += @('-f',(Join-Path $deployment 'compose.portable.simulators.yml'),'--profile','simulators') }
        $raw = & docker @composeArguments config --format json
        if ($LASTEXITCODE -ne 0) { throw '无法读取 Docker Web 端口配置，请检查实际环境文件' }
        $compose = $raw -join "`n" | ConvertFrom-Json
        $published = @($compose.services.web.ports | Where-Object { [int]$_.target -eq 8080 })
        if ($published.Count -eq 0) { throw '当前部署未发布 MES Web 8080 端口' }
        $configuredBindings = @(foreach ($port in $published) {
            $hostIp = '0.0.0.0'
            if ($port.PSObject.Properties['host_ip'] -and $port.host_ip) { $hostIp = [string]$port.host_ip }
            @{hostIp=$hostIp;port=[int]$port.published}
        })
        $bindings = @()
        $engineAvailable = $false
        $running = $false
        try {
            $container = @(& docker @composeArguments ps --status running -q web 2>$null)
            $engineAvailable = $LASTEXITCODE -eq 0
            if ($engineAvailable -and $container.Count -eq 1 -and $container[0]) {
                $portsJson = & docker inspect --format '{{json .NetworkSettings.Ports}}' ([string]$container[0]) 2>$null
                if ($LASTEXITCODE -ne 0) { throw '无法读取 Web 容器监听' }
                $ports = $portsJson -join "`n" | ConvertFrom-Json
                if ($ports -and $ports.PSObject.Properties['8080/tcp']) {
                    $bindings = @($ports.'8080/tcp' | Where-Object { $_ } | ForEach-Object { @{hostIp=[string]$_.HostIp;port=[int]$_.HostPort} })
                }
                $running = $true
            }
        } catch { $engineAvailable = $false }
        # Report the live container port if the environment was edited but has
        # not yet been applied with Compose up.
        $webPort = [int]$published[0].published
        if ($bindings.Count -gt 0) { $webPort = [int]$bindings[0].port }
        $publicUrl = ''
        if ($compose.services.PSObject.Properties['api'] -and $compose.services.api.PSObject.Properties['environment'] -and $compose.services.api.environment.PSObject.Properties['TEST_DATA_PUBLIC_BASE_URL']) { $publicUrl = [string]$compose.services.api.environment.TEST_DATA_PUBLIC_BASE_URL }
        Write-Result ([ordered]@{status='network_info'; webPort=$webPort;
            engineAvailable=$engineAvailable; running=$running; publicUrl=$publicUrl; configuredBindings=$configuredBindings; bindings=$bindings})
        exit 0
    }
    if ($Action -eq 'Status') {
        $backend = Test-Service ($config.apiUrl.TrimEnd('/') + '/health/ready') 'status' 'ready'
        $frontend = Test-Service ($config.serverUrl.TrimEnd('/') + '/')
        $lims = $mode -ne 'demo' -or (Test-Service ($config.limsUrl.TrimEnd('/') + '/api/state') 'connected' 'true')
        $upper = $mode -ne 'demo' -or (Test-Service ($config.upperComputerUrl.TrimEnd('/') + '/api/state') 'connected' 'true')
        $status = if ($backend -and $frontend -and $lims -and $upper) { 'running' } else { 'not_running' }
        Write-Result ([ordered]@{status=$status; message=$(if ($status -eq 'running') { 'Docker MES 服务已就绪' } else { 'Docker MES 存在未就绪服务' }); backend=$backend; frontend=$frontend; lims=$lims; upperComputer=$upper})
        exit 0
    }
    $logDirectory = Join-Path $toolRoot 'logs'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $log = Join-Path $logDirectory ('service-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.log')
    $actions = if ($Action -eq 'Restart') { @('Stop','Start') } else { @($Action) }
    foreach ($step in $actions) {
        # Only the selected Compose deployment is controlled. Stop keeps its volumes.
        # Compose uses stderr for ordinary "Starting/Waiting/Healthy" progress.
        # File redirection on a child Process keeps PowerShell's Stop preference
        # from turning that progress into a terminating NativeCommandError.
        $stdout = $log + '.' + $step.ToLowerInvariant() + '.stdout.log'
        $stderr = $log + '.' + $step.ToLowerInvariant() + '.stderr.log'
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $entry + '" -Action ' + $step + ' -EnvFile "' + $environment + '" -Mode ' + $mode
        $process = Start-Process -FilePath powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $handle = $process.Handle
        $process.WaitForExit()
        $process.Refresh()
        Add-Content -LiteralPath $log -Encoding UTF8 -Value ($step + ' exit=' + $process.ExitCode)
        foreach ($stream in @($stdout,$stderr)) {
            if (Test-Path -LiteralPath $stream) {
                Get-Content -LiteralPath $stream | Add-Content -LiteralPath $log -Encoding UTF8
            }
        }
        if ($process.ExitCode -ne 0) { throw "Docker 服务操作失败（$step，退出码 $($process.ExitCode)），详见 $log" }
    }
    $status = switch ($Action) { 'Start' { 'started' } 'Stop' { 'stopped' } default { 'restarted' } }
    $message='Docker MES 服务操作完成'
    if($Action -in @('Start','Restart') -and -not $NoOpen) {
        $warnings=@(Open-MesDockerPages)
        if($warnings.Count){$message+='；'+($warnings -join '；')}
    }
    $result = [ordered]@{status=$status; message=$message}
    if ($Action -in @('Start','Restart')) { $result.pageUrls = @(Get-MesDockerPageUrls) }
    Write-Result $result
} catch {
    Write-Result ([ordered]@{status='error'; message=$_.Exception.Message})
    exit 1
}
