[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Control-center update output directory already exists' }
$staging = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('MESControlUpdate-' + [Guid]::NewGuid().ToString('N'))))
try {
    New-Item -ItemType Directory -Path $output,$staging | Out-Null
    $docker = Join-Path $staging 'docker'
    $native = Join-Path $staging 'native'
    & (Join-Path $PSScriptRoot 'build_desktop_tools.ps1') -OutputDirectory $docker
    & (Join-Path $PSScriptRoot 'build_desktop_tools.ps1') -OutputDirectory $native -Native
    New-Item -ItemType Directory -Path (Join-Path $output 'Docker版/scripts'),(Join-Path $output '原生版'),(Join-Path $output '部署更新/scripts/deploy') | Out-Null
    Copy-Item -LiteralPath (Join-Path $docker 'MES控制中心_Docker版.exe') -Destination (Join-Path $output 'Docker版/MES控制中心_Docker版.exe')
    Copy-Item -LiteralPath (Join-Path $docker 'scripts/docker-service-control.ps1') -Destination (Join-Path $output 'Docker版/scripts/docker-service-control.ps1')
    Copy-Item -LiteralPath (Join-Path $native 'MES控制中心_原生版.exe') -Destination (Join-Path $output '原生版/MES控制中心_原生版.exe')
    Copy-Item -LiteralPath (Join-Path $project 'scripts/client/Update-ControlCenter.ps1') -Destination (Join-Path $output 'Update-ControlCenter.ps1')
    foreach ($name in @('Mes-Portable.ps1','Mes-PortableHost.ps1')) {
        Copy-Item -LiteralPath (Join-Path $project ('scripts/deploy/' + $name)) -Destination (Join-Path $output ('部署更新/scripts/deploy/' + $name))
    }
    Copy-Item -LiteralPath (Join-Path $project 'docs/control-center-v2.7.2.md') -Destination (Join-Path $output '使用说明.md')
    $files = @(foreach ($file in Get-ChildItem -LiteralPath $output -File -Recurse) {
        $stream = [IO.File]::OpenRead($file.FullName)
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try { $digest = -join ($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
        finally { $stream.Dispose(); $algorithm.Dispose() }
        [ordered]@{path=$file.FullName.Substring($output.Length+1).Replace('\','/');bytes=$file.Length;sha256=$digest}
    })
    $manifest = [ordered]@{format='mes-control-center-update';format_version=1;version='2.7.2';built_at_utc=[DateTime]::UtcNow.ToString('o');files=$files}
    [IO.File]::WriteAllText((Join-Path $output 'update-manifest.json'), ($manifest | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    Write-Output "Control-center update ready: $output"
} finally {
    if (Test-Path -LiteralPath $staging) {
        $resolved = (Resolve-Path -LiteralPath $staging).Path
        $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'MESControlUpdate-*') {
            throw 'Refused to remove an unexpected update staging directory'
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
