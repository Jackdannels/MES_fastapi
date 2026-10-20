# Windows 原生离线安装与迁移

本安装包包含 MES 主系统、MySQL、RabbitMQ/Erlang、两个模拟器、Caddy Web 服务、Python 私有运行环境、六个 Windows 服务和三个桌面程序。目标机使用已安装的 Windows 11 x64/.NET Framework 4.8 与包内 VC 运行库，不需要 Docker、WSL、Conda、系统 Python、Node 或联网安装依赖。

## 1. 安装包和目录

交付入口为 `MES-Native-Setup-20261020-r1.exe`。三个应用模块和运行环境包含在安装程序中，旁边的 `payload/` 供校验、维护和高级命令使用。

- 默认程序目录：`C:\MESNative\releases\2026.10.20-native.1`。
- 默认数据目录：`C:\ProgramData\MESNative`。
- 数据目录中的 `config/native.json` 保存实际端口、数据库和管理员凭据，只授予系统、管理员与受管理服务读取/写入权限。
- 数据库在 `mysql/`；报告在 `reports/`；LIMS 的三个 SQLite 库在 `lims/`；日志在 `logs/`；工作台程序在 `desktop/`。

程序、数据目录分别选择，需使用无空格英文路径。中文桌面交付文件夹可以用于存放安装包，实际安装位置使用上述规则。安装时拒绝复用非空数据目录、同名服务或占用端口。

## 2. 安装向导

以管理员身份运行安装程序，选择：

1. 完整主机：主系统、两个模拟器和三个桌面程序。
2. 业务主机：主系统和桌面工具，模拟器不启动；真实接口参数由部署人员配置。
3. 工作站客户端：仅安装工作台设置、终端管理，不安装数据库或消息服务。

主机安装填写数据目录、服务实例名、MES URL 和管理员账户。密码可自行设置（至少八个字符）；留空时随机生成并保存在受限配置文件。在“业务数据来源”中选择新建空数据库、从已有 `data-manifest.json` 恢复，或直接从本机正在运行的 Docker 部署迁移。

安装完成创建桌面快捷方式并启动原生服务。默认账号 `admin`；若自定义了账号或密码，使用填写的值。自动生成的密码可由管理员读取 `config/native.json` 中 `environment.DEMO_PASSWORD`，不要把整个配置文件发给普通工作站。

第一版仅接受明确的本机/局域网 HTTP URL，不自动申请互联网证书。HTTPS 如是现场要求，应先配置并验收证书和网关，再切换对外地址。Windows Server 或其他 Windows 版本尚未列为本次验收目标。

### 与已有 Docker 同机预演

勾选隔离预演端口，使用独立实例名和空数据目录。预演默认：

| 服务 | 正常端口 | 预演端口 |
|---|---:|---:|
| MES Web | 15173 | 25173 |
| API | 18000 | 28000 |
| LIMS | 18900 | 28900 |
| 上位机 | 18899 | 28899 |
| MySQL | 13306 | 23306 |
| RabbitMQ AMQP | 5672 | 35672 |
| MQTT | 11883 | 21883 |
| RabbitMQ 管理 | 15673 | 25673 |

预演 AMQP 使用 35672，避开原生 RabbitMQ 常用的 15672 管理和 25672 分布式监听端口。EPMD 和节点通信端口同样隔离。不要让原生和 Docker 上位机同时连接真实设备 Broker。

## 3. 在安装向导中直接迁移 Docker 数据

将 `MES-Native-Setup-20261020-r1.exe` 复制到正在承载 MES 的 PC 上，以管理员身份运行。迁移功能及私有运行环境均已内置，执行此流程不需要旁边的 `payload/` 文件夹，不需要手动输入导出命令。旧 Docker Desktop 必须保持运行，直至安装器完成导出。

1. 选择完整主机及正常端口，填写新的程序目录、空数据目录和管理员凭据。
2. “业务数据来源”选择“从本机当前 Docker 部署导出并迁移”。
3. 选择旧 Docker release 目录，例如 `C:\Users\Administrator\Desktop\MES_Docker迁移交付_20261019-r1\release-20261019-r1`。
4. 检查自动填写的 `.tmp\portable.env`。若旧部署使用其他环境文件，选择实际使用的文件。
5. 选择尚不存在的备份目录，默认 `C:\MESBackups\docker-final-日期-时间`。备份必须位于原生程序、原生数据及旧 release 目录之外。
6. 确认试验已结束、消息已处理完并暂停人员录入，再开始安装。

安装器先验证原生目标目录、配置及服务实例名，再检查 Docker 活动试验和队列，停止旧业务服务，导出 MySQL、报告和 LIMS SQLite，校验文件及 SQLite 完整性。成功后停止该 Compose 项目的全部容器，释放端口，自动恢复备份并安装原生服务与桌面工具。旧容器、镜像和数据卷均保留，不执行 `down` 或卷删除。

导出失败（包括部分业务容器停止后失败）时，工具会尝试恢复原来运行的 Docker 服务，安装器不会继续导入。导出已校验成功但停止基础容器或后续原生安装失败时，备份保留，旧 Docker 可能仍全部或部分停止；查看日志和实际状态后再处理，不自动切回可能过时的数据库。进度和错误记录在备份目录旁的同名 `.log` 文件，原生安装输出记入安装器日志。

选择隔离预演端口时，导出并校验后恢复 Docker 服务，原生服务使用隔离端口和独立空数据目录；正式切换前应重新导出最新数据。

不要删除当前 Docker 数据卷。RabbitMQ 原始数据目录不从 Linux 复制到 Windows；先确认队列已处理完。逻辑业务记录和补传数据随数据库/SQLite 备份恢复。上位机内存中的在途试验上下文不支持无缝迁移。此前交付的演练备份不能替代正在使用的 PC 上的最新数据。

恢复只接受空目标，先校验数据，再导入 SQL、复制文件、核对表行数、将 `/data/reports` 等历史路径改为 Windows 实际目录，并执行制作版本的数据库迁移检查。源数据库不会被改写。只有迁移导出阶段依赖旧 Docker，原生安装后的日常运行不依赖 Docker。

### 单独导出时使用 PowerShell 脚本

需要单独生成备份时，在完整交付包目录中运行：

```powershell
.\payload\native\Export-DockerData.ps1 `
  -Deployment "C:\Users\Administrator\Desktop\MES_Docker迁移交付_20261019-r1\release-20261019-r1"
```

脚本默认读取旧 release 下的 `.tmp\portable.env`，自动生成带时间的外部备份目录和日志，导出完成后恢复旧 Docker 服务。可用 `-EnvironmentFile` 和 `-Output` 指定其他路径；最终切换时加 `-StopDeployment`，在校验通过后停止全部旧部署容器。

底层 Python 导出命令也保留：

```powershell
.\payload\runtime\python\python.exe -I -X utf8 `
  .\payload\native\export_docker_data.py `
  --deployment "C:\Users\Administrator\Desktop\MES_Docker迁移交付_20261019-r1\release-20261019-r1" `
  --environment-file "C:\Users\Administrator\Desktop\MES_Docker迁移交付_20261019-r1\release-20261019-r1\.tmp\portable.env" `
  --output "D:\MES-backups\docker-final-20261020"
```

路径按实际位置填写，输出目录必须不存在。默认导出后恢复旧服务；`--leave-stopped` 仅在成功导出后保持业务服务停止；同时加 `--stop-deployment` 才会在校验通过后停止整个 Compose 部署。`--log-file` 可指定备份目录之外的全新日志文件。

## 4. 日常操作

控制中心原生版操作 Windows 服务，工作台和终端管理连接安装配置的地址。工作台第一次绑定会询问实际管理员密码；注册后的开机自动登录使用每台终端自己的受保护密钥，不在配置中明文保存管理员密码。

客户端安装填写主机实际 URL，例如 `http://192.168.110.15:15173`。仅在服务器安装且 URL 指向局域网地址时，安装器增加限专用网络、本地子网的 Web 防火墙规则；其他 API、数据库、模拟器端口保持本机入口。用户切换网段/IP 时需更新公开 URL、Origins、LIMS 下载地址及工作站配置。

原生服务使用 `LocalService`，配置了依赖、恢复与日志轮转，成功安装后设为自动启动。API 固定一个 worker。高低温湿热二室只在安装样品/夹具就绪时保留 hostless 例外，准备/启动/结束继续通过 MQTT。

## 5. 命令行维护

以下命令在安装程序目录运行，数据路径替换为实际安装位置。管理操作需管理员权限。

```powershell
# 就绪、登录和模拟器连接检查
.\runtime\python\python.exe -I -X utf8 .\native\native_manager.py test --config C:\ProgramData\MESNative\config\native.json

# 停止 / 启动 / 重启
.\runtime\python\python.exe -I -X utf8 .\native\native_manager.py stop --config C:\ProgramData\MESNative\config\native.json
.\runtime\python\python.exe -I -X utf8 .\native\native_manager.py start --config C:\ProgramData\MESNative\config\native.json
.\runtime\python\python.exe -I -X utf8 .\native\native_manager.py restart --config C:\ProgramData\MESNative\config\native.json

# 暂停业务服务、备份，然后恢复业务服务
.\runtime\python\python.exe -I -X utf8 .\native\native_manager.py backup --config C:\ProgramData\MESNative\config\native.json --output D:\MES-backups\native-20261020
```

备份产生与 Docker 导出相同的通用备份格式。程序更新、卸载或卸载 Docker 前，都要保存最新业务数据及服务器受限配置文件。公共数据备份不包含管理员/数据库密码，凭据另外保存在受限位置。

### 应用更新

先生成已验证的停写备份，将新版本放在另一个程序目录，再使用新目录里的 `native_manager.py update --config <原配置> --backup <最新备份目录>`。此入口只接受基础 MySQL/Erlang/RabbitMQ 文件版本完全一致的应用更新，不隐式升级基础运行环境。发现结构迁移失败时保留旧版本和备份，按实际迁移状态恢复，禁止伪造 schema_migrations 降级。

完整安装向导用于全新安装；对非空数据目录拒绝覆盖，不能把重新运行安装向导当作数据库恢复/覆盖功能。卸载通过 Windows 应用列表执行，停止并移除本产品登记的原生服务和快捷方式，保留数据与备份。共用或原有其他实例不受控制。

## 6. 尚需在目标现场完成的验收

制品已在本机构建与隔离测试。目标 PC 应验证其操作系统、重启后自动启动、Edge 全屏、自启动、局域网访问和共享备份权限。没有可用的干净物理 PC/VM 时，不把本机隔离测试称为干净新机或断网重启验收。

最终切换先完成最新备份，再停止旧 Docker 服务。安装向导已支持自动完成此顺序。验证原生环境的数据、终端、LIMS、MQTT 和报告后再决定卸载 Docker。原生上线后产生新写入，不能直接启动旧 Docker 快照作为当前系统。
