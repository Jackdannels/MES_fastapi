# MES 控制中心 v2.4 升级与局域网访问

## 升级已迁移 PC 上的控制中心

把整个更新文件夹复制到 MES 主机，先关闭控制中心窗口，后台 MES 服务可继续运行。在更新文件夹中打开 PowerShell，执行（路径替换为原桌面工具目录）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Update-ControlCenter.ps1 `
  -DesktopToolsDirectory "C:\Users\Administrator\Desktop\MES_Docker迁移交付_20261019-r1\桌面工具"
```

脚本自动识别 Docker / 原生模式，验证更新文件，备份旧控制中心，替换控制中心和所需 Docker 控制脚本；保留 `mes-desktop-tools.json`、三个原快捷方式及其他桌面程序。Docker 更新只涉及两个文件，不重建镜像、不恢复数据、不重启服务、不修改环境文件或防火墙。重新使用原控制中心快捷方式即可。

若原生桌面目录在 `C:\ProgramData\MESNative\desktop`，以管理员身份打开 PowerShell，并把参数改为该目录。此次更新文件夹是现有安装的补丁，不能直接在其中运行 EXE 作为完整安装。原生安装器的旧副本仍是当时打包的版本；现有安装可单独应用此补丁。

升级遇到文件复制错误时脚本会尝试恢复旧文件。旧版本保存在目标目录下 `control-center-backup-日期-时间`。备份中的 JSON 沿用旧访问路径，不含账户密码。

## 关于与访问地址

左侧新增“关于与访问地址”，显示控制中心版本、部署方式、本机访问地址及有线 / Wi-Fi 网卡地址，支持刷新、复制选中地址和浏览器打开。

- Docker 模式读取所选 Compose 部署的 Web 配置，并查询运行中 Web 容器的实际端口绑定。环境文件已修改但尚未应用时，以实际容器绑定为准。
- `127.0.0.1` / `::1` 绑定只允许主机访问，局域网列表明确显示为候选地址。
- 绑定某个网卡时只验证该网卡；绑定 `0.0.0.0` 时验证有线 / Wi-Fi IPv4 地址。排除回环、169.254 自动地址及常见 WSL、Docker、Hyper-V、VMware 等虚拟网卡。
- 只有读到当前监听且通过 MES 识别接口的地址，才启用浏览器打开；“主机访问通过”仍需另一台电脑验证防火墙与网络。
- Docker 未运行、部署路径错误或服务尚未启动时，不把候选地址标成可用。
- 原生 / 开发模式读取本机 TCP 监听并验证 MES 接口；控制中心应在 MES 主机运行。

部署版控制中心启动时直接读取已配置的服务地址，服务暂时未启动也不再同步扫描全部网段。工作站的既有服务发现方式保持原有逻辑。

## Docker 开放局域网访问

支持局域网访问。当前迁移模板默认 `MES_BIND_ADDRESS=127.0.0.1`，需要在实际使用的环境文件（通常 release 目录下 `.tmp\portable.env`）中设置以下值。例子假设 MES 主机 IP 为 `192.168.110.15`：

```dotenv
MES_BIND_ADDRESS=0.0.0.0
MES_WEB_PORT=15173
MES_PUBLIC_URL=http://192.168.110.15:15173
MES_FRONTEND_ORIGINS=http://192.168.110.15:15173,http://127.0.0.1:15173,http://localhost:15173
```

保留该文件其他行，尤其是 `COMPOSE_PROJECT_NAME`、数据库和消息服务配置。不要运行 Initialize 生成另一套密码或更换项目名。在原 release 目录应用现有环境文件（会重新创建受配置变更影响的服务，应选择业务维护时间）：

```powershell
.\scripts\deploy\Mes-Portable.ps1 -Action Start -Mode demo -EnvFile ".\.tmp\portable.env"
```

以管理员身份为 MES Web 放行专用网络、本地子网；端口按实际配置填写：

```powershell
New-NetFirewallRule -DisplayName "MES Docker Web 15173" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 15173 `
  -Profile Private -RemoteAddress LocalSubnet
```

主机网络需为可信的专用网络，同一网段工作站访问 `http://192.168.110.15:15173`。若跨网段，需按现场网络路由和防火墙策略配置。只开放 Web 即可；数据库、API 和模拟器管理端口继续使用原本的主机入口。主机 IP 变化后需更新公开 URL、Origins 及工作站配置，建议现场为主机固定地址或 DHCP 保留。

回到控制中心刷新“关于”，再从另一台 PC 打开网页、登录并检查任务和报告链接。升级控制中心不会自动执行本节的网络变更。

## 为什么启动阶段等待较长

目前启动命令使用 Compose `up --wait`：先等 MySQL 健康，再执行数据库迁移，API 依赖迁移和 RabbitMQ，Web 再依赖 API 健康。MySQL / RabbitMQ 检查间隔 5 秒，API / Web / 模拟器检查间隔 10 秒，这些检查和依赖使“点击启动到整套就绪”存在等待。

Docker Desktop 在 Windows 还需先启动其 Linux 引擎；CPU、内存、存储速度和冷缓存会影响冷启动。此补丁减少了控制中心窗口自身在服务不可用时的同步网段搜索，没有改变数据库、MQTT 或试验流程，也没有跳过健康检查。目标 PC 的确切耗时仍需在那台机器记录 Docker 引擎和各容器启动时间；本机构建时 Docker 引擎未运行，不能据此认定目标 PC 存在资源不足。
