# 三个 Windows 桌面程序迁移到 Docker 环境

本补充包包含：`MES工作台设置_Docker版.exe`、`MES控制中心_Docker版.exe`、`MES终端管理_Docker版.exe`。作为 Windows 客户端在容器外运行，连接已经迁移的 MES。补充包不执行数据库恢复或镜像重建。

## 安装位置

把整个桌面工具文件夹复制到新 PC。推荐与 `release-20261019-r1` 并排：

```text
MES迁移目录/
├─ release-20261019-r1/
├─ data-backup-20261019/
└─ 桌面工具/
   ├─ MES控制中心_Docker版.exe
   ├─ MES工作台设置_Docker版.exe
   ├─ MES终端管理_Docker版.exe
   ├─ mes-desktop-tools.json
   ├─ Configure-DesktopTools.ps1
   └─ scripts/docker-service-control.ps1
```

控制中心的 exe、JSON 和 scripts 目录需放在一起；桌面上使用快捷方式。程序需要 Windows .NET Framework 4.x（Windows 11 通常已具备）。Docker 服务控制在 Docker 主机上执行，当前 Windows 用户需能够运行 `docker info`。

## 在已经迁移完成的 Docker 主机配置

在桌面工具目录打开 PowerShell，填写新 PC 的实际 release 路径和 MES 地址：

```powershell
.\Configure-DesktopTools.ps1 `
  -DeploymentDirectory "D:\MES\release-20261019-r1" `
  -ServerUrl "http://127.0.0.1:15173" `
  -CreateShortcuts
```

配置脚本读取该 release 的 `.tmp/portable.env` 和 Compose 文件，自动提取实际端口；仅保存桌面程序配置、创建快捷方式。若部署使用其他环境文件，额外传入 `-EnvironmentFile "D:\MES-config\actual.env"`。模拟联调使用默认 `-Mode demo`。

在程序旁的 JSON 中只记录地址、部署目录和环境文件位置，不复制数据库密码或 MES 登录密码。当前登录密码仍查看服务器部署环境文件的 `MES_LOGIN_PASSWORD`。

## 各程序的使用位置

Docker 迁移使用配置文件中的实际管理员密码。工作台首次保存或测试注册时会弹出认证框；控制中心和终端管理的密码框也需输入实际密码。管理员密码不保存在桌面工具 JSON 中。固定工作台注册后使用自己的终端密钥自动登录。

| 程序 | 放置位置 | 迁移后操作 |
|---|---|---|
| MES 控制中心 | Docker 主机 | 状态检查、启动、关闭、重启本机 Compose 服务；关闭保留数据卷 |
| MES 工作台设置 | 每台固定工作站 | 填新 MES 地址，选择该电脑的操作台，登录并重新绑定、自启动 |
| MES 终端管理 | 主机或管理员电脑 | 填新 MES 地址并登录，查看与管理已授权的工作站 |

工作台配置在每台电脑自己的 `%LOCALAPPDATA%\MESWorkstation\config.xml` 中，开机项也由各电脑分别创建。迁移到新工作站时通过设置程序重新注册；不要把另一台电脑的 config.xml 或 EdgeProfile 复制过来，以免复用终端身份。保留原工作站时，更新其服务器地址并重新确认绑定即可。

其他工作站填写 `http://新MES主机IP:15173`，例如 `http://192.168.110.15:15173`。Docker 网页需已开放给局域网：核对部署 env 的 `MES_BIND_ADDRESS`、`MES_PUBLIC_URL`、`MES_FRONTEND_ORIGINS` 及主机防火墙。默认回环绑定只能由主机本机访问。模拟器管理页面仍保持本机入口。

控制中心通过现有 `Mes-Portable.ps1` 操作同一个 Compose 项目，不要求原项目源码、Conda 或 Node。失败日志保存在桌面工具的 `logs/` 目录。

## 可先做的只读检查

```powershell
.\scripts\docker-service-control.ps1 -Action Status -ValidateOnly
.\scripts\docker-service-control.ps1 -Action Status
```

第一条只核对部署文件路径；第二条检查 HTTP 服务状态。打开控制中心、终端管理后，先检查地址和状态，再根据需要使用控制功能。
