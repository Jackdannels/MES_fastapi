[CmdletBinding()]
param(
    [ValidateSet('Status','Start','Stop','Restart')] [string]$Action = 'Status',
    [string]$ResultFile = '',
    [string]$ConfigurationFile = '',
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
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $entry -Action $step -EnvFile $environment -Mode $mode *> $log
        if ($LASTEXITCODE -ne 0) { throw "Docker 服务操作失败，详见 $log" }
    }
    $status = switch ($Action) { 'Start' { 'started' } 'Stop' { 'stopped' } default { 'restarted' } }
    Write-Result ([ordered]@{status=$status; message='Docker MES 服务操作完成'})
} catch {
    Write-Result ([ordered]@{status='error'; message=$_.Exception.Message})
    exit 1
}
