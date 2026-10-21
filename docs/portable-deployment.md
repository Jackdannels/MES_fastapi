# MES 单机离线迁移包（含两个模拟器）

三个应用包共用一套 Docker Compose：主系统包包含 API、Web、MySQL 和启用 MQTT 的 RabbitMQ；LIMS 和上位机模拟器各一个包。目标 PC 需要 Docker Desktop 的 Linux 引擎、PowerShell，以及与镜像一致的 x86-64 架构；无需安装 Python、Node 或本机 MySQL。

2026.10.21-r1 桌面交付目录额外提供双击部署入口，完成镜像加载、当前源机数据快照恢复、服务检查以及三个桌面快捷方式生成，见 [双击离线部署](portable-one-click.md)。独立 release 目录仍可使用下方命令。

## 1. 源码机构建

从项目根目录运行。初始化生成随机密码，不读取或覆盖项目根 `.env`。

```powershell
.\scripts\deploy\Mes-Portable.ps1 -Action Initialize -ReleaseVersion 2026.10.19-r1
.\scripts\deploy\Mes-Portable.ps1 -Action Build
```

独立配置默认位于 `.tmp/portable.env`。原生服务的 8000、5173、8899、8900、3306、1883 端口与容器默认端口隔离。默认 `MES_NETWORK_MODE=auto`，Start 自动检测物理局域网 IPv4，将 Web 监听设置为 `0.0.0.0`，同步更新 `MES_PUBLIC_URL`、`MES_FRONTEND_ORIGINS` 并备份原环境文件。管理员运行可自动配置专用网络、本地子网的 Web 防火墙规则。需要手动域名或网关配置时设置 `MES_NETWORK_MODE=manual`。两个模拟器始终只发布到本机回环地址。

```powershell
.\scripts\deploy\Mes-Portable.ps1 -Action Start
.\scripts\deploy\Mes-Portable.ps1 -Action Test
.\scripts\deploy\Mes-Portable.ps1 -Action Stop
```

Start 默认 `-Mode demo`，同时启动两个模拟器和 LIMS 回调。接入真实系统时使用 `-Mode mes` 并配置真实 LIMS 对接参数。切换模式前先以原模式 Stop，避免遗留模拟器继续消费命令。Stop 保留所有数据卷。

初始化默认登录账号为 `admin`，密码在独立配置文件的 `MES_LOGIN_PASSWORD` 项中。可修改 `MES_LOGIN_USER` 和 `MES_LOGIN_PASSWORD`；目标机重新生成配置时也会生成新登录密码。不会从业务数据库备份恢复登录密码，因为当前登录凭据由环境配置提供。

## 2. 数据备份

主数据库当前为本机 `mes_single_branch`，目标默认是全新 Docker 数据库 `mes_portable`。先停止业务写入和模拟器发送，等待待处理 MQ 消息落库/回执完成，再停止原生 MES 服务。MySQL 和 RabbitMQ 服务保持运行。上位机的内存运行上下文不会迁移，最终切换前应结束在途试验。

```powershell
.\scripts\mes-service-control.ps1 -Action Stop
C:\ProgramData\anaconda3\envs\fastapi\python.exe scripts\deploy\portable_data.py backup `
  --directory D:\MES-transfer\data-backup --quiesced
.\scripts\mes-service-control.ps1 -Action Start
```

备份目录必须不存在。备份程序使用原生 `mysqldump`，密码通过子进程环境传递，包含表结构、数据、存储过程、触发器和事件；通过 SQLite Backup API 保存三个 LIMS 数据库及报告备份状态库；复制报告文件并计算 SHA-256。`--quiesced` 会检查默认源服务端口均已停止。非默认端口仍需操作人员确认停写。

不指定 `--quiesced` 时生成明确标为 `live_snapshot` 的在线快照，用于预演；各存储间不保证同一业务时点，最终切换须重新生成停写备份。程序检查文件在复制期间未发生变化；目标机恢复会检查全部校验值和 SQLite 完整性。

原生 Windows 的报告备份队列、网络备份目标设置保存在 `runtime-source/` 中供追溯。目标机重新设置备份目标后建立本机队列；不自动启用旧 Windows 共享路径。原生 RabbitMQ 数据目录不跨平台复制：最终切换前确认命令已处理、未发送任务保存在 LIMS 补传库中。

## 3. 导出三个应用包

```powershell
.\scripts\deploy\Mes-Portable.ps1 -Action Export -OutputDirectory D:\MES-transfer\release
.\scripts\deploy\Mes-Portable.ps1 -Action Verify -OutputDirectory D:\MES-transfer\release
```

输出包含 `mes-core/images.tar`、`lims-simulator/images.tar`、`upper-simulator/images.tar`，以及 Compose、配置模板、操作脚本和 `manifest.json`。清单记录镜像 ID、架构、上游摘要及逐文件大小/SHA-256。真实凭据及业务数据不写入应用包。保存这次实际使用的 `.tmp/portable.env` 到独立受控位置，用于重现测试部署；目标机也可以重新生成密码，数据库用户由新容器初始化。

## 4. 目标 PC 导入与恢复

复制 `release/` 和 `data-backup/`，进入 release 目录：

```powershell
.\scripts\deploy\Mes-Portable.ps1 -Action Verify
.\scripts\deploy\Mes-Portable.ps1 -Action Import
.\scripts\deploy\Mes-Portable.ps1 -Action Initialize
.\scripts\deploy\Mes-Portable.ps1 -Action Restore -BackupDirectory ..\data-backup
.\scripts\deploy\Mes-Portable.ps1 -Action Start
.\scripts\deploy\Mes-Portable.ps1 -Action Test
```

导入只执行镜像加载和校验，不启动服务。恢复要求 API、Web 和两个模拟器已停止，目标数据库及报告/LIMS 卷为空；拒绝覆盖已有数据。恢复后把数据库内的报告保存目录转换为 `/data/reports`，同时转换历史报告索引的绝对路径；停写备份会核对全部源表行数。随后启动时执行 V001–V011 迁移并验证 readiness。失败时保留目标数据用于排查，可更换新的 `COMPOSE_PROJECT_NAME` 建立全新隔离目标重试。

导出目录不包含源码及构建依赖。目标机只运行 Import、Initialize、Restore、Start、Test，不执行 Build；Start 固定 `--no-build --pull never`，可离线运行。文件校验用于发现传输损坏，最终应通过可信渠道核对清单哈希。

## 5. 默认入口与业务边界

| 服务 | 目标 PC 地址 |
|---|---|
| MES | http://127.0.0.1:15173/ |
| API | http://127.0.0.1:18000/health/ready |
| LIMS 模拟器 | http://127.0.0.1:18900/ |
| 上位机模拟器 | http://127.0.0.1:18899/ |
| RabbitMQ 管理 | http://127.0.0.1:15673/ |
| MQTT | 127.0.0.1:11883 |

上位机自动模式通过 MQTT 处理所有试验间的命令与遥测。高低温湿热二室仅安装样品/夹具就绪保留本地 hostless 例外；试验准备、启动和结束仍通过 MQTT。API 保持一个容器、一个 worker。
