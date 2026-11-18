[CmdletBinding()]
param(
    [string]$OutputDirectory=(Join-Path ([Environment]::GetFolderPath('Desktop')) 'MES开发环境_v2.10.0'),
    [string]$ServerUrl='',
    [switch]$Offline
)
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=(Resolve-Path -LiteralPath $OutputDirectory).Path
if(-not (Test-Path -LiteralPath (Join-Path $output 'MES控制中心_v2.10.0.exe'))){throw '请选择已有的 MES开发环境_v2.10.0 目录。'}
if(-not $ServerUrl){
    $central=Join-Path $output '中控管理/mes-client.json'
    if(-not (Test-Path -LiteralPath $central)){$central=Join-Path $output 'central-client/mes-client.json'}
    $ServerUrl=if(Test-Path -LiteralPath $central){[string](Get-Content -Encoding UTF8 -Raw -LiteralPath $central|ConvertFrom-Json).serverUrl}else{'http://127.0.0.1:5173'}
}
$stage=Join-Path $project ('.runtime/terminal-layout-builds/'+[Guid]::NewGuid().ToString('N'))
$stations=Join-Path $stage '工位终端'
& (Join-Path $PSScriptRoot 'build_workstation_clients.ps1') -OutputDirectory $stations -ServerUrl $ServerUrl -Offline:$Offline
& (Join-Path $PSScriptRoot 'build_desktop_client.ps1') -OutputDirectory (Join-Path $stage '测试终端') -Module test -ServerUrl $ServerUrl -Offline:$Offline
& (Join-Path $PSScriptRoot 'build_desktop_client.ps1') -OutputDirectory (Join-Path $stage '中控管理') -ServerUrl $ServerUrl -CombineSimulators -LimsUrl http://127.0.0.1:8900 -UpperComputerUrl http://127.0.0.1:8899 -Offline:$Offline
$python=Join-Path $project '.venv/Scripts/python.exe'
& $python (Join-Path $PSScriptRoot 'build_terminal_packages.py') --source $stations
if($LASTEXITCODE -ne 0){throw '服务端工位包生成失败。'}
$encoding=New-Object Text.UTF8Encoding($false)
function File-Sha256([string]$Path){
    $stream=[IO.File]::OpenRead($Path);$algorithm=[Security.Cryptography.SHA256]::Create()
    try{return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$algorithm.Dispose()}
}
function Merge-Client([string]$Source,[string]$Destination){
    $target=[IO.Path]::GetFullPath($Destination)
    if(-not $target.StartsWith($output.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw '客户端输出路径越界。'}
    New-Item -ItemType Directory -Path $target -Force|Out-Null
    $manifest=Get-Content -Encoding UTF8 -Raw -LiteralPath (Join-Path $Source 'client-manifest.json')|ConvertFrom-Json
    foreach($entry in $manifest.files){
        $relative=[string]$entry.path
        $file=[IO.Path]::GetFullPath((Join-Path $target $relative))
        if(-not $file.StartsWith($target.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw '客户端文件路径越界。'}
        $parent=Split-Path -Parent $file;New-Item -ItemType Directory -Path $parent -Force|Out-Null
        if($relative -ne 'mes-client.json' -or -not (Test-Path -LiteralPath $file)){
            Copy-Item -LiteralPath (Join-Path $Source $relative) -Destination $file -Force
        }
        $entry.bytes=(Get-Item -LiteralPath $file).Length;$entry.sha256=File-Sha256 $file
    }
    [IO.File]::WriteAllText((Join-Path $target 'client-manifest.json'),($manifest|ConvertTo-Json -Depth 8),$encoding)
}
$catalog=Get-Content -Encoding UTF8 -Raw -LiteralPath (Join-Path $project 'tools/desktop-client/workstations.json')|ConvertFrom-Json
foreach($station in $catalog){Merge-Client (Join-Path $stations $station.folder) (Join-Path $output ('工位终端/'+$station.folder))}
Merge-Client (Join-Path $stage '测试终端') (Join-Path $output '测试终端')
Merge-Client (Join-Path $stage '中控管理') (Join-Path $output '中控管理')
& $python (Join-Path $PSScriptRoot 'build_component_library.py') --output $output --clients $stage --controller (Join-Path $output 'MES控制中心_v2.10.0.exe')
if($LASTEXITCODE -ne 0){throw '更新离线组件补全资源失败。'}
$resources=Get-Item -LiteralPath (Join-Path $output '.mes') -Force;$resources.Attributes=$resources.Attributes -bor [IO.FileAttributes]::Hidden
foreach($name in @('工位清单.json','使用说明.md')){Copy-Item -LiteralPath (Join-Path $stations $name) -Destination (Join-Path $output ('工位终端/'+$name)) -Force}
$workstationManifestPath=Join-Path $output '工位终端/workstations-manifest.json'
$workstationFiles=@(Get-ChildItem -LiteralPath (Join-Path $output '工位终端') -File -Recurse|Where-Object FullName -ne $workstationManifestPath|ForEach-Object {
    [ordered]@{path=$_.FullName.Substring((Join-Path $output '工位终端').Length+1).Replace('\','/');bytes=$_.Length;sha256=(File-Sha256 $_.FullName)}
})
$workstationManifest=Get-Content -Encoding UTF8 -Raw -LiteralPath (Join-Path $stations 'workstations-manifest.json')|ConvertFrom-Json
$workstationManifest.files=$workstationFiles
foreach($entry in $workstationManifest.workstations){$entry.serverUrl=[string](Get-Content -Encoding UTF8 -Raw -LiteralPath (Join-Path $output ('工位终端/'+$entry.folder+'/mes-client.json'))|ConvertFrom-Json).serverUrl}
[IO.File]::WriteAllText($workstationManifestPath,($workstationManifest|ConvertTo-Json -Depth 8),$encoding)
$checksum=Join-Path $output 'SHA256SUMS.txt'
$lines=@(Get-ChildItem -LiteralPath $output -File -Recurse|Where-Object FullName -ne $checksum|Sort-Object FullName|ForEach-Object {
    (File-Sha256 $_.FullName)+'  '+$_.FullName.Substring($output.Length+1).Replace('\','/')
})
[IO.File]::WriteAllLines($checksum,$lines,$encoding)
Write-Output ('已更新原目录：'+$output)
Write-Output '15个独立工位文件夹及对应接入入口；1个16页面综合测试终端。'
Write-Output ('构建验证目录：'+$stage)
