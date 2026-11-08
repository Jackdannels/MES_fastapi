# MES 专用客户端 v1.7.0

## 自动进入与全屏工位

非中控工位在本机完成一次管理员绑定后，启动使用现有 `/auth/terminal/ticket` 与 `/auth/terminal/consume` 固定终端认证自动进入。管理员密码不写进 EXE 或 JSON；工位凭据使用当前 Windows 用户的 DPAPI 加密保存在本机客户端数据目录。服务端仍校验模块及实验间绑定，凭据失效或地址变更会提示重新绑定，不回退到匿名或中控账号。

本机管理员使用项目既有配置进行首次绑定：

```powershell
.\.venv\Scripts\python.exe scripts/configure_workstation_clients.py --directory "$env:USERPROFILE\Desktop\MES工位客户端_本机测试"
```

中控仍保留账号登录和三合一页签。其余工位移除原生顶部单页页签；可视化保留普通最大化窗口，实验间、接驳区、暂存间、外观检测间直接无边框全屏。页面“退出登录”改为“关闭”，与窗口关闭／Alt+F4 共用一次原生主题确认，默认取消；确认后只关闭本界面，后台服务继续运行。断网或绑定异常的原生提示页也保留“关闭”按钮。

工位免登录只替代界面进入时的账号登录，不改变实验间内部员工签到、MQTT 实验流程或业务权限。换电脑、换 Windows 用户或服务器地址改变后需由管理员重新绑定，不复制其他工位的本地凭据。

## 实验间与其他工位

新增 11 个固定实验间，以及可视化、接驳区、暂存间、外观检测间四种客户端。实验间名称、编号和角色在编译时固定，不提供工位切换；完成本机绑定后自动进入对应页面。各文件夹独立运行，并使用独立的本机实例、凭据、登录数据和下载目录。

批量生成桌面总文件夹：

```powershell
.\scripts\build_workstation_clients.ps1 -Offline
```

默认生成桌面 `MES工位客户端_本机测试`，每个工位一个子文件夹，共 15 个。当前连接 `http://127.0.0.1:5173`，也可通过 `-ServerUrl` 和 `-OutputDirectory` 指定服务器与输出位置。已有目标目录会拒绝覆盖，保留原配置。

单独构建示例：

```powershell
.\scripts\build_desktop_client.ps1 -OutputDirectory 新实验间目录 -Module laboratory -LaboratoryCode LAB_HOT_HUMID_2 -ServerUrl http://127.0.0.1:5173 -Offline
.\scripts\build_desktop_client.ps1 -OutputDirectory 新可视化目录 -Module visual -ServerUrl http://127.0.0.1:5173 -Offline
```

工位清单维护在 `tools/desktop-client/workstations.json`，与前端标准实验间映射进行一致性测试。每个子目录含 EXE、运行组件、`mes-client.json`、说明和哈希清单，可独立复制整个文件夹。修改 JSON 不能将某个实验间程序改为另一个实验间。

新增客户端沿用现有固定终端认证；窗口固定展示范围不替代服务端权限。模块和实验间绑定继续由服务器校验。本机可执行一次绑定启用免登录，不设置开机启动，不迁移业务数据。现场电脑分别注册，不复制其他电脑的凭据。

新增工位窗口关闭和 Alt+F4 均先确认，默认取消；确认只退出本客户端，不停止服务。退出提示随当前深浅主题显示。

## 误关防护与重新打开

中控窗口右上角关闭及 Alt+F4 均先询问是否关闭，默认取消。取消保留页面，确认后只退出界面，控制中心与后台服务继续运行。

退出提示随当前页面深浅主题配色，默认聚焦“取消”，Enter 和 Esc 均取消退出。

控制中心 v2.8.2 首页有“打开中控管理”按钮：界面已关闭时重新打开，仍在运行时唤起已有窗口；不会启动、关闭或重启服务。控制中心已确认的服务操作和客户端更新不重复弹出窗口退出确认。

关闭控制中心自身会先确认“关闭系统并退出控制中心”，随后停止服务并关闭关联界面，成功后才退出；失败会保留控制中心。没有只退出控制中心的选项，需要保留服务时可最小化。

## 运行文件夹内容

| 文件或目录 | 用途 |
|---|---|
| `MES控制中心_本机测试.exe` | 服务状态与启动、关闭、重启管理，以及重新打开中控 |
| `mes-desktop-tools.json` | 控制中心连接地址与部署配置，必须保留 |
| `central-client/MES中控管理.exe` | 实际显示中控、LIMS、上位机页面的客户端 |
| `central-client/*.dll` 和 `MES中控管理.exe.config` | 网页显示组件及 .NET 运行配置，必须与客户端一起保留 |
| `central-client/mes-client.json` | 中控与模拟器地址、角色、窗口偏好，必须保留 |
| `combined-manifest.json`、`client-manifest.json` | 文件完整性校验和版本记录，建议保留 |
| `update_desktop_client.ps1` | 在原文件夹内更新程序并备份旧版 |
| `.client-updates` | 旧版本文件与更新记录，用于回退，确认新版本稳定前保留 |
| `*.md`、`WebView2-LICENSE.txt` | 使用说明、验证记录和组件许可说明 |

此文件夹是运行目录，源码仍在 MES 项目维护。业务数据库和实验数据不保存在这些程序组件文件中。

## 三合一联调窗口

窗口顶部同一栏直接提供“MES中控管理 / LIMS模拟器 / 上位机模拟器”三个页面入口，不再另设第二层页签栏。每个页面使用独立 WebView2 容器和用户数据目录，切换不会重新加载已打开页面。关闭主窗口会一起释放三个页面；后台 HTTP、RabbitMQ 与 MQTT 服务继续由现有程序维护。

生成三合一版本：

```powershell
.\scripts\build_desktop_client.ps1 -OutputDirectory 新目录 -CombineSimulators -ServerUrl http://127.0.0.1:5173 -LimsUrl http://127.0.0.1:8900 -UpperComputerUrl http://127.0.0.1:8899 -Offline
```

`mes-client.json` 的 `simulatorsEnabled` 为 `true` 时显示模拟器页签，改为 `false` 后重新启动，只保留中控。模拟器的地址分别由 `limsUrl` 和 `upperComputerUrl` 指定。模拟器仍需启动现有后台服务，页签本身不启动或停止服务。

## 窗口与文件操作

- 顶部三个页面入口跟随当前页面的明暗主题配色；中控左侧“自动采集”下方显示系统版本和运行此客户端电脑的局域网 IPv4。地址每 30 秒更新，多个有线／Wi‑Fi 地址会同时显示。
- 底部不再显示常驻说明；只有下载或操作异常等临时提示会短暂出现。

- 使用 Windows 原生标题栏的最小化、最大化／还原、关闭按钮，可以拖动和调整尺寸。
- 客户端顶部已移除“打开下载文件夹”“刷新”“全屏”，独立全屏模式及其快捷键已取消。
- 刷新、下载和打印由对应业务页面的入口处理。文件仍可正常下载，完成后底部状态显示保存位置。

## 本机三套界面

当前支持中控、LIMS 模拟器和上位机模拟器三套独立 EXE，使用相同 WebView2 内核。角色在编译时固定，不能通过修改配置把 LIMS EXE 改成中控。每套程序都有自己的实例、用户数据和下载目录。

| 角色 | EXE | 独立构建时默认地址 |
|---|---|---|
| 中控 | `MES中控管理.exe` | `http://127.0.0.1:15173`；本机开发通常改为 5173 |
| LIMS | `MES_LIMS模拟器.exe` | `http://127.0.0.1:8900` |
| 上位机 | `MES上位机模拟器.exe` | `http://127.0.0.1:8899` |

模拟器 EXE 负责界面，连接已有模拟器 HTTP 服务；退出界面不停止该服务或更改其 RabbitMQ/MQTT 连接。上位机原有自动/手动工作模式仍是模拟器业务控制，并非切换客户端角色。

## 使用

保留整个客户端文件夹，编辑同目录 `mes-client.json` 中的 `serverUrl` 为该角色的服务地址，运行对应 EXE。中控使用现有管理员账号登录；两个模拟器保持原有页面流程。程序默认最大化，需要 Windows x64、.NET Framework 4.8 和 Microsoft Edge WebView2 Runtime。

重复打开会唤起同一配置对应的已有窗口。点击右上角关闭按钮或按 Alt+F4 退出客户端；MES 服务继续运行。主动退出后客户端不会自行重新打开。日志位于当前 Windows 用户 `%LOCALAPPDATA%\MESDesktopClient` 对应安装配置目录。

`startMaximized` 决定是否启动即最大化。旧版 `fullScreen` 配置自动解释为最大化偏好，升级时不改写你的 JSON。不同安装/配置使用独立的用户数据和本机控制通道。服务器 IP 变化时更新 `serverUrl`，不复制其他工位的浏览器数据或终端凭据。

## 运行库

交付包有 `prerequisites/MicrosoftEdgeWebView2RuntimeInstallerX64.exe` 时，由部署人员运行该微软签名的离线安装器。客户端不会自行联网安装。带 `WebView2Runtime` 的包使用随包固定运行库。两者都没有时，使用目标机已经安装的 Evergreen Runtime；缺失时显示安装提示。

## 本机管理

```powershell
.\MES中控管理.exe --status --result-file .\client-status.json
.\MES中控管理.exe --close
.\MES中控管理.exe --reload
.\MES中控管理.exe --server-url http://192.168.110.15:15173
```

可用 `--config 配置文件路径` 指定独立配置。关闭命令等待客户端实际退出；重复关闭不报错。不按进程名结束 Edge 或其他应用。

文件默认保存到当前用户 `Downloads\MES\角色`。可在 JSON 中设置 `downloadDirectory`；相对路径以配置文件目录为基准。同名文件自动追加编号。

## 在已解压文件夹中迭代更新

源码继续在 MES 项目维护，编译的新程序可直接更新已解压文件夹，桌面入口路径保持不变。使用随包或项目中的更新脚本：

```powershell
.\scripts\update_desktop_client.ps1 -SourceDirectory 新版本构建目录 -TargetDirectory 已解压目录 -RestartIfRunning
```

更新前校验新文件哈希；保留已有 `mes-client.json` 和桌面工具地址配置；原程序与更新记录保存在目标目录 `.client-updates/时间戳/`。正在运行的目标客户端先正常退出，按开关重新打开。更新过程不停止后台服务。复制失败会恢复原文件。

本轮配套控制中心为 v2.8.2。更新管理窗口前先退出该窗口；正常退出控制中心会同步关闭系统，请在允许停机时更新。单独更新客户端仍不停止服务。

## 与控制中心一起交付

桌面工具目录包含下列客户端时，新版控制中心分别使用对应程序打开三套界面，并在重启、关闭时等待它们退出：

```text
central-client/MES中控管理.exe
lims-client/MES_LIMS模拟器.exe
upper-client/MES上位机模拟器.exe
```

配置的 `serverUrl`、`limsUrl` 和 `upperComputerUrl` 决定入口。没有某一专用客户端时，该入口仍使用原浏览器方式。各客户端默认只允许在自己的站点内跳转。关闭时会逐个处理所有专用客户端和旧浏览器窗口，并汇总失败原因。

构建桌面工具时传入 `-CombineSimulators` 会仅生成一个三合一中控客户端。控制中心收到三个服务地址时只打开一个窗口，默认选中中控；单独打开模拟器入口时切换到对应页签，不弹出新浏览器。

## 构建

```powershell
.\scripts\build_desktop_client.ps1 -OutputDirectory .\artifacts\desktop-client\central-v1 -ServerUrl http://127.0.0.1:15173
.\scripts\build_desktop_client.ps1 -OutputDirectory .\artifacts\desktop-client\lims-v1 -Module lims
.\scripts\build_desktop_client.ps1 -OutputDirectory .\artifacts\desktop-client\upper-v1 -Module upper-computer
```

联网构建从固定地址取得已锁定哈希的 Microsoft.Web.WebView2 SDK。离线构建使用 `-Offline -SdkPackagePath 已准备的NuGet包路径`。`-RuntimeInstallerPath` 可把已取得的微软签名离线安装器加入交付包；`-FixedRuntimeDirectory` 可加入固定运行库。SDK、Node 和源码只用于构建，不是客户端运行条件。

一起构建配套桌面工具时使用 `scripts/build_desktop_tools.ps1 -OutputDirectory 新目录 -IncludeAllClients`。也可单独选 `-IncludeCentralClient` 或 `-IncludeSimulatorClients`，通过 `-ServerUrl`、`-LimsUrl`、`-UpperComputerUrl` 指定实际地址。桌面工具的模拟器默认地址使用 Docker 的 18900/18899；本机开发测试应明确传入 8900/8899。服务器需要使用配套前端构建，才能隐藏中控网页登录页和退出弹窗中的模块切换入口。

## 本机验收命令

```powershell
.\.venv\Scripts\python.exe -m pytest tests/core/test_desktop_client.py tests/core/test_desktop_simulator_clients.py -q
```

测试使用真实 WebView2 进程、临时端口和模拟器临时数据目录。模拟器以 `lifespan=off` 启动，不连接真实 RabbitMQ/MQTT。控制中心联动使用测试服务脚本，不停止本机正在运行的服务。`--status` 还提供页面脚本错误计数和 HTTP API 响应计数，便于确认网页脚本及轮询工作。

现场验收应包括实际服务器登录、明暗主题、排程拖拽、二维码图片及历史数据下载、重新打开、关闭、服务断开后恢复。其他工位迁移范围见 `docs/desktop-client-plan.md`。
