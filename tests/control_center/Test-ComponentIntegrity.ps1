param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Bundle,[Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
trap{Write-Output $_.ScriptStackTrace;throw $_.Exception}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Web.Extensions
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$static=[Reflection.BindingFlags]'Static,NonPublic,Public'
$type=$assembly.GetType('MESControlCenter.ComponentStore',$true)
$json=New-Object Web.Script.Serialization.JavaScriptSerializer
$root=[IO.Path]::GetFullPath($TestDirectory)
if(Test-Path -LiteralPath $root){throw 'Integrity test requires a new isolated directory'}
New-Item -ItemType Directory -Path (Join-Path $root '.mes') -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $Bundle '.mes/components') -Destination (Join-Path $root '.mes/components') -Recurse
Copy-Item -LiteralPath (Join-Path $Bundle '.mes/installed-components.json') -Destination (Join-Path $root '.mes/installed-components.json')
$store=$type.GetConstructor($flags,$null,[Type[]]@([string]),$null).Invoke([object[]]@($root))
$token=[Threading.CancellationToken]::None
function Scan {$type.GetMethod('Scan',$flags).Invoke($store,[object[]]@($true,$token))}
function Field($Object,[string]$Name){$Object.GetType().GetField($Name,$flags).GetValue($Object)}
function Find([string]$Id){@(Scan|Where-Object {(Field (Field $_ 'Component') 'id') -eq $Id})[0]}
function Repair([string]$Id){$type.GetMethod('Repair',$flags).Invoke($store,[object[]]@($Id,$token))}
function Assert-Fails([scriptblock]$Action,[string]$Reason){$failed=$false;try{&$Action|Out-Null}catch{$failed=$true};if(-not $failed){throw $Reason}}
function Assert-Status([string]$Id,[string]$Status){$row=Find $Id;if((Field $row 'Status') -ne $Status){throw ($Id+': '+(Field $row 'Status')+' '+(Field $row 'Detail'))}}
Assert-Status 'LAB_SALT' '缺失'
$null=Repair 'LAB_SALT';Assert-Status 'LAB_SALT' '完整'
$folder=Join-Path $root '工位终端/盐雾试验室'
$config=Join-Path $folder 'mes-client.json';$manifest=Join-Path $folder 'client-manifest.json'
$data=$json.DeserializeObject([IO.File]::ReadAllText($config));$data['serverUrl']='http://192.0.2.200:35173'
[IO.File]::WriteAllText($config,$json.Serialize($data),(New-Object Text.UTF8Encoding($false)))
$credentials=Join-Path $folder '.enrollment.bin';[IO.File]::WriteAllText($credentials,'identity-placeholder')
$before=[IO.File]::ReadAllBytes($config)
Remove-Item -LiteralPath (Join-Path $folder 'WebView2Loader.dll') -Force
$null=Repair 'LAB_SALT';Assert-Status 'LAB_SALT' '完整'
if([Convert]::ToBase64String($before) -ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($config)) -or [IO.File]::ReadAllText($credentials) -ne 'identity-placeholder'){throw 'Repair changed custom configuration or binding'}
$manifestJson=$json.DeserializeObject([IO.File]::ReadAllText($manifest));$configEntry=@($manifestJson['files']|Where-Object {$_.path -eq 'mes-client.json'})[0]
if($configEntry.sha256 -ne $type.GetMethod('Hash',$static).Invoke($null,[object[]]@([string]$config))){throw 'Runtime manifest was not refreshed for preserved configuration'}
# Runtime file corruption is repaired; configuration corruption is reported and preserved.
$runtime=Join-Path $folder 'WebView2Loader.dll';[IO.File]::WriteAllText($runtime,'corrupt-runtime')
$null=Repair 'LAB_SALT';Assert-Status 'LAB_SALT' '完整'
[IO.File]::WriteAllText($config,'{broken-json')
Assert-Status 'LAB_SALT' '配置异常'
Assert-Fails {Repair 'LAB_SALT'} 'Configuration was overwritten without explicit resolution'
Remove-Item -LiteralPath $runtime -Force
$null=Repair 'LAB_SALT'
if([IO.File]::ReadAllText($config) -ne '{broken-json'){throw 'Repair overwrote an invalid configuration'}
[IO.File]::WriteAllBytes($config,$before)
# Locked files fail before committing, leaving the configuration and other runtime files unchanged.
$binary=Join-Path $folder 'MES盐雾试验室.exe';[IO.File]::WriteAllText($runtime,'locked-file')
$lock=[IO.File]::Open($runtime,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
try{Assert-Fails {Repair 'LAB_SALT'} 'Locked runtime unexpectedly repaired'}finally{$lock.Dispose()}
if([IO.File]::ReadAllText($runtime) -ne 'locked-file'){throw 'Failed repair modified a locked file'}
$null=Repair 'LAB_SALT';Assert-Status 'LAB_SALT' '完整'
# An unselected component is distinguishable from a deleted installed component.
$installedPath=Join-Path $root '.mes/installed-components.json'
$installed=@($json.DeserializeObject([IO.File]::ReadAllText($installedPath))|Where-Object {$_ -ne 'test'})
[IO.File]::WriteAllText($installedPath,(ConvertTo-Json -InputObject @($installed) -Compress))
Assert-Status 'test' '未安装'
# Missing/bad archives do not create target files.
$archive=Join-Path $root '.mes/components/test.zip';$archiveBytes=[IO.File]::ReadAllBytes($archive)
[IO.File]::WriteAllText($archive,'bad archive');Assert-Fails {Repair 'test'} 'Bad archive was accepted'
if(Test-Path -LiteralPath (Join-Path $root '测试终端/MES综合测试终端.exe')){throw 'Bad archive created a client'}
[IO.File]::WriteAllBytes($archive,$archiveBytes);$null=Repair 'test';Assert-Status 'test' '完整'
# The controller cannot replace its own running executable from this page.
$controller=Find 'controller';if(Field $controller 'CanRepair'){throw 'Self-overwrite is allowed'}
# Strict path checking protects folders outside the root.
$catalogPath=Join-Path $root '.mes/components/catalog.json';$catalogText=[IO.File]::ReadAllText($catalogPath)
$wrongVersion=$json.DeserializeObject($catalogText);$wrongVersion['controlCenterVersion']='2.9.0'
[IO.File]::WriteAllText($catalogPath,$json.Serialize($wrongVersion));Assert-Fails {Scan} 'Mismatched component library version was accepted'
[IO.File]::WriteAllText($catalogPath,$catalogText)
$catalog=$json.DeserializeObject($catalogText);$catalog['components'][1]['directory']='../escape'
[IO.File]::WriteAllText($catalogPath,$json.Serialize($catalog));Assert-Fails {Scan} 'Path traversal was accepted'
[IO.File]::WriteAllText($catalogPath,$catalogText)
$paths=$assembly.GetType('MESControlCenter.ControlCenterPaths',$true)
$junction=Join-Path $root 'linked';New-Item -ItemType Junction -Path $junction -Target (Split-Path -Parent $root)|Out-Null
try{Assert-Fails {$paths.GetMethod('Child',$static).Invoke($null,@($root,'linked/escape.dll'))} 'Junction path was accepted'}finally{[IO.Directory]::Delete($junction)}
# Existing business/secret files remain untouched throughout repairs.
[IO.File]::WriteAllText((Join-Path $root '.env'),'do-not-touch')
$null=Repair 'central'
if([IO.File]::ReadAllText((Join-Path $root '.env')) -ne 'do-not-touch'){throw 'Component repair changed service environment'}
Write-Output 'Component repair regression passed: missing/uninstalled, corruption, invalid config, custom config/identity, locked files, archive integrity, manifest, controller boundary, path traversal and junctions.'
