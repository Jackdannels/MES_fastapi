param([string]$Directory=$PSScriptRoot)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $Directory).Path
$exe=Join-Path $root 'MES综合测试终端.exe'
if(-not (Test-Path -LiteralPath $exe -PathType Leaf)){throw '所选目录中没有 MES综合测试终端.exe。'}
$stream=[IO.File]::OpenRead($exe);$hash=[Security.Cryptography.SHA256]::Create()
try{$digest=[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$hash.Dispose()}
$bytes=[IO.File]::ReadAllBytes($exe)
# .NET user strings can begin at either byte alignment in the PE file.
$text=[Text.Encoding]::Unicode.GetString($bytes)
$unaligned=if($bytes.Length -gt 1){[Text.Encoding]::Unicode.GetString($bytes,1,$bytes.Length-1)}else{''}
$legacy=($text.Contains('开发测试 · 请先登录账号') -or $unaligned.Contains('开发测试 · 请先登录账号')) -and ($text.Contains('综合测试终端') -or $unaligned.Contains('综合测试终端'))
$modern=$text.Contains('page-top-right') -or $unaligned.Contains('page-top-right')
$configPath=$exe+'.config';$dpi='未找到配置'
if(Test-Path -LiteralPath $configPath){$xml=[xml][IO.File]::ReadAllText($configPath);$section=$xml.configuration.'System.Windows.Forms.ApplicationConfigurationSection';if($section){$item=@($section.add|Where-Object key -eq 'DpiAwareness');if($item.Count){$dpi=[string]$item[0].value}}}
$running=@(Get-Process -Name 'MES综合测试终端' -ErrorAction SilentlyContinue|ForEach-Object {@{id=$_.Id;executable=$_.Path}})
$result=[ordered]@{directory=$root;executable=$exe;bytes=(Get-Item -LiteralPath $exe).Length;sha256=$digest;legacySidebarDetected=$legacy;pageTopRightNavigation=$modern;dpiAwarenessSetting=$dpi;runningInstances=$running}
$result|ConvertTo-Json -Depth 6
if($legacy){Write-Host '检测到带左侧栏和顶部横条的旧版测试终端，请关闭后完整更新文件夹。'}
elseif($modern){Write-Host '检测到页面右上角切换的新版测试终端。请核对 runningInstances 中的实际运行路径。'}
else{Write-Host '无法识别此构建，请提供输出中的SHA256和实际运行路径。'}
