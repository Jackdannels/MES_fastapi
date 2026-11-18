[CmdletBinding()]
param(
    [string]$OutputDirectory=(Join-Path ([Environment]::GetFolderPath('Desktop')) 'MES开发环境_v2.10.0'),
    [string]$ServerUrl='http://127.0.0.1:5173',
    [switch]$NoAdminManifest
)
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(Test-Path -LiteralPath $output){throw '输出目录已存在，请选择新目录以保留已有配置。'}
$build=Join-Path $project ('.runtime/terminal-client-builds/'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$python=Join-Path $project '.venv/Scripts/python.exe'
& (Join-Path $PSScriptRoot 'build_workstation_clients.ps1') -OutputDirectory $build -ServerUrl $ServerUrl -Offline
& $python (Join-Path $PSScriptRoot 'build_terminal_packages.py') --source $build
if($LASTEXITCODE -ne 0){throw '生成服务端工位分发包失败。'}
New-Item -ItemType Directory -Path $output|Out-Null
& (Join-Path $PSScriptRoot 'build_control_center.ps1') -OutputPath (Join-Path $output 'MES控制中心_v2.10.0.exe') -NoAdminManifest:$NoAdminManifest
& (Join-Path $PSScriptRoot 'build_desktop_client.ps1') -OutputDirectory (Join-Path $output '中控管理') -ServerUrl $ServerUrl -CombineSimulators -LimsUrl http://127.0.0.1:8900 -UpperComputerUrl http://127.0.0.1:8899 -Offline
Copy-Item -LiteralPath $build -Destination (Join-Path $output '工位终端') -Recurse
& (Join-Path $PSScriptRoot 'build_desktop_client.ps1') -OutputDirectory (Join-Path $output '测试终端') -Module test -ServerUrl $ServerUrl -Offline
& $python (Join-Path $PSScriptRoot 'build_component_library.py') --output $output --clients $output --controller (Join-Path $output 'MES控制中心_v2.10.0.exe')
if($LASTEXITCODE -ne 0){throw '生成离线组件补全资源失败。'}
$resources=Get-Item -LiteralPath (Join-Path $output '.mes') -Force;$resources.Attributes=$resources.Attributes -bor [IO.FileAttributes]::Hidden
Copy-Item -LiteralPath (Join-Path $project 'docs/control-center-v2.10.0.md') -Destination (Join-Path $output '版本说明.md')
$note=@"
# MES 当前开发环境

控制中心 v2.10.0；工位客户端和终端接入 v1.8.0。本轮不部署 Docker。

1. 打开 MES控制中心_v2.10.0.exe，启动开发服务组；在终端管理页用原有 MES 管理员账号连接。
2. 将“工位终端”中对应的完整工位文件夹复制到工作机，运行其中的“MES终端接入.exe”。申请默认固定为该工位，填写 MES 的前端地址（当前默认 $ServerUrl）后提交。其他电脑使用开发主机的局域网地址与前端端口，不填自身的 127.0.0.1。
3. 管理员在“绑定申请与记录”中核对电脑和申请编号，可调整工位并批准。
4. 首次审批且文件校验成功后，可激活当前工位文件夹；重置绑定、改派工位或预置包不匹配时生成新的桌面工位目录。以后直接双击对应工位 EXE。
5. 管理员可重置绑定、删除终端或预览清理历史记录；重置后旧凭据和会话失效，需要重新申请。

现有工位的未绑定页面也可点击“申请绑定 / 重新绑定”。工作机 IP 可以自动获取，主机访问地址需稳定。员工签到和实验业务流程保持原来的规则。

中控管理可以通过控制中心打开，也可单独双击 中控管理/MES中控管理.exe；关闭中控不停止后台服务。

复制到工作机时保留完整工位文件夹，不要只复制 EXE。此开发版依赖当前源码机的项目目录、运行环境及 WebView2 Runtime。

“工位终端”包含15个独立工位文件夹，各有对应的工位 EXE 和 MES终端接入.exe。独立接入默认固定工位；首次审批校验成功后可激活当前目录，重置或改派后生成新工位目录。

“测试终端/MES综合测试终端.exe”使用开发测试账号登录，通过页面右上角“退出登录 → 切换其他界面”切换中控、全部试验间和其他工位共16个业务页面；不包含上位机和 LIMS 模拟器。无额外左侧切换栏或顶部横条，业务操作使用当前连接环境。

控制中心“系统完整性”可快速检测或完整校验，勾选缺失/损坏的组件后补全。离线资源和日志位于隐藏的 .mes 目录，原配置与工位绑定保留。控制中心本身丢失时运行 .mes/恢复控制中心.cmd。
"@
[IO.File]::WriteAllText((Join-Path $output '使用说明.md'),$note,(New-Object Text.UTF8Encoding($false)))
Write-Output ('开发版已生成：'+$output)
