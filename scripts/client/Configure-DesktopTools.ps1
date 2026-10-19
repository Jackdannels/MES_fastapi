[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)] [string]$DeploymentDirectory,
    [string]$EnvironmentFile = '',
    [string]$ServerUrl = '',
    [ValidateSet('demo','mes')] [string]$Mode = 'demo',
    [switch]$CreateShortcuts
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
$deployment = (Resolve-Path -LiteralPath $DeploymentDirectory).Path
if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $deployment '.tmp/portable.env' }
$environment = (Resolve-Path -LiteralPath $EnvironmentFile).Path
$composeFile = Join-Path $deployment 'compose.portable.yml'
if (-not (Test-Path -LiteralPath (Join-Path $deployment 'scripts/deploy/Mes-Portable.ps1'))) { throw '所选目录不是 MES portable 的 release 目录' }
$arguments = @('compose','--env-file',$environment,'-f',$composeFile)
if ($Mode -eq 'demo') { $arguments += @('-f',(Join-Path $deployment 'compose.portable.simulators.yml'),'--profile','simulators') }
$raw = & docker @arguments config --format json
if ($LASTEXITCODE -ne 0) { throw '无法读取已迁移的 Compose 配置' }
$compose = $raw -join "`n" | ConvertFrom-Json
if (-not $ServerUrl) { $ServerUrl = 'http://127.0.0.1:' + $compose.services.web.ports[0].published }
$uri = [Uri]$ServerUrl
if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('http','https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) { throw '请填写完整 MES HTTP(S) 地址，例如 http://192.168.110.15:15173' }
if ($uri.AbsolutePath -ne '/') { throw 'MES 地址应填写服务根地址，不包含页面路径' }
$server = $uri.GetLeftPart([UriPartial]::Authority)
$api = 'http://127.0.0.1:' + $compose.services.api.ports[0].published
$lims = 'http://127.0.0.1:18900'
$upper = 'http://127.0.0.1:18899'
if ($Mode -eq 'demo') {
    $lims = 'http://127.0.0.1:' + $compose.services.'lims-simulator'.ports[0].published
    $upper = 'http://127.0.0.1:' + $compose.services.'upper-simulator'.ports[0].published
}
$config = [ordered]@{deploymentDirectory=$deployment; environmentFile=$environment; mode=$Mode; serverUrl=$server; apiUrl=$api; limsUrl=$lims; upperComputerUrl=$upper}
[IO.File]::WriteAllText((Join-Path $root 'mes-desktop-tools.json'), ($config | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
if ($CreateShortcuts) {
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    foreach ($name in @('MES控制中心_Docker版','MES工作台设置_Docker版','MES终端管理_Docker版')) {
        $executable = Join-Path $root ($name + '.exe')
        if (-not (Test-Path -LiteralPath $executable)) { throw "未找到桌面程序：$executable" }
        $shortcut = $shell.CreateShortcut((Join-Path $desktop ($name + '.lnk')))
        $shortcut.TargetPath = $executable
        $shortcut.WorkingDirectory = $root
        $shortcut.IconLocation = $executable + ',0'
        $shortcut.Save()
    }
}
Write-Output '三个桌面程序的连接配置已保存；未启动、停止或重新部署任何服务。'
Write-Output ('MES 地址：' + $server)
