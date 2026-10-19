[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)] [string]$OutputDirectory,
    [string]$ServerUrl = 'http://127.0.0.1:15173'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Desktop-tool output directory already exists' }
$csc = @('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe','C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw '.NET Framework C# compiler was not found' }
$temporary = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('MESDesktopBuild-' + [Guid]::NewGuid().ToString('N'))))
$encoding = New-Object Text.UTF8Encoding($true)
function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, $encoding) }
function Compile([string]$Name, [string[]]$Sources, [string]$Icon, [string[]]$ExtraReferences = @()) {
    $arguments = @('/nologo','/target:winexe','/platform:anycpu','/optimize+','/codepage:65001',
        '/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll',
        ('/win32icon:' + $Icon),('/out:' + (Join-Path $output $Name)))
    $arguments += $ExtraReferences
    $arguments += $Sources
    & $csc @arguments
    if ($LASTEXITCODE -ne 0) { throw "Desktop-tool compilation failed: $Name" }
}
try {
    New-Item -ItemType Directory -Path $output,$temporary | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $output 'scripts') | Out-Null
    $discovery = Join-Path $project 'scripts/client/MESServerDiscovery.cs'
    $terminal = Join-Path $project 'scripts/client/MESTerminalManager.cs'
    $workstation = Join-Path $project 'scripts/client/MESWorkstationConfigurator.cs'
    $control = Join-Path $temporary 'MESControlCenter.cs'
    Write-Utf8 $control ((Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $project 'tools/control-center/MESControlCenter.cs')).Replace('__PROJECT_ROOT__','__DOCKER_PORTABLE__'))
    $client = Get-Content -Raw -Encoding UTF8 -LiteralPath $terminal
    $client = [regex]::Replace($client, '(?m)^\[assembly:.*\]\s*\r?\n?', '')
    $program = $client.LastIndexOf('    internal static class Program')
    if ($program -lt 0) { throw 'Cannot locate terminal-manager entry point' }
    $terminalClient = Join-Path $temporary 'TerminalClient.cs'
    Write-Utf8 $terminalClient ($client.Substring(0,$program) + "}`n")
    $launcherIcon = Join-Path $project 'assets/mes-launcher.ico'
    Compile 'MES工作台设置_Docker版.exe' @($workstation,$discovery) $launcherIcon @('/reference:System.Management.dll','/reference:System.Xml.dll')
    Compile 'MES终端管理_Docker版.exe' @($terminal,$discovery) $launcherIcon
    Compile 'MES控制中心_Docker版.exe' @($control,$terminalClient,$discovery) (Join-Path $project 'assets/mes-control-center.ico')
    Copy-Item -LiteralPath (Join-Path $project 'scripts/client/docker-service-control.ps1') -Destination (Join-Path $output 'scripts/docker-service-control.ps1')
    Copy-Item -LiteralPath (Join-Path $project 'scripts/client/Configure-DesktopTools.ps1') -Destination (Join-Path $output 'Configure-DesktopTools.ps1')
    Copy-Item -LiteralPath (Join-Path $project 'docs/desktop-tools-docker.md') -Destination (Join-Path $output '使用说明.md')
    $config = [ordered]@{deploymentDirectory='../release-20261019-r1'; environmentFile='.tmp/portable.env'; mode='demo';
        serverUrl=$ServerUrl.TrimEnd('/'); apiUrl='http://127.0.0.1:18000'; limsUrl='http://127.0.0.1:18900'; upperComputerUrl='http://127.0.0.1:18899'}
    Write-Utf8 (Join-Path $output 'mes-desktop-tools.json') ($config | ConvertTo-Json)
    $files = @(foreach($file in Get-ChildItem -LiteralPath $output -File -Recurse) {
        $stream = [IO.File]::OpenRead($file.FullName)
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try { $hash = -join ($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
        finally { $stream.Dispose(); $algorithm.Dispose() }
        [ordered]@{path=$file.FullName.Substring($output.Length+1).Replace('\','/'); bytes=$file.Length; sha256=$hash}
    })
    $manifest = [ordered]@{format='mes-docker-desktop-tools'; format_version=1; version='2026.10.19-r1';
        platform='windows-dotnet-framework'; files=$files}
    Write-Utf8 (Join-Path $output 'desktop-tools-manifest.json') ($manifest | ConvertTo-Json -Depth 6)
    Write-Output "Three Docker desktop tools built: $output"
} finally {
    if (Test-Path -LiteralPath $temporary) {
        $resolved = (Resolve-Path -LiteralPath $temporary).Path
        $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'MESDesktopBuild-*') {
            throw 'Refused to remove an unexpected compiler staging directory'
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
