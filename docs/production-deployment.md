# MES 正式环境部署与恢复手册

正式环境使用独立的 `compose.production.yml`。它只包含迁移任务、API 和 HTTPS Web，不创建 MySQL、RabbitMQ 或 MQTT 容器，也不读取项目根目录 `.env`。普通 API 账号只保留 DML 权限；DDL 密码只挂载给显式迁移任务。

## 1. 发布制品

CI 或联网发布机必须先构建、测试并推送 API/Web 镜像，再记录不可变的 `tag@sha256:digest`。数据库备份客户端、RabbitMQ 和报告备份工具镜像也必须固定 digest 并一同进入离线包。正式主机不得现场构建源码，也不得使用 `latest` 或只有版本标签的浮动引用。

离线导出示例：

```powershell
.\scripts\deploy\Export-MesRelease.ps1 `
  -ApiImage "registry.example.com/mes/api:1.0.0@sha256:<64位摘要>" `
  -WebImage "registry.example.com/mes/web:1.0.0@sha256:<64位摘要>" `
  -MySqlClientImage "registry.example.com/library/mysql:9.6@sha256:<64位摘要>" `
  -RabbitMqImage "registry.example.com/library/rabbitmq:4.1-management@sha256:<64位摘要>" `
  -ReportsToolImage "registry.example.com/library/python:3.12-slim@sha256:<64位摘要>" `
  -ReleaseVersion "1.0.0" `
  -OutputDirectory "D:\mes-release-1.0.0"
```

Exporter 生成严格的 `release-manifest.json` v3，记录 API、Web、MySQL 客户端、RabbitMQ、报告工具五个镜像角色的不可变引用、镜像 ID、OS/架构，以及全部部署文件和 `mes-images.tar` 的大小/SHA-256。v3 同时强制包含 MySQL 初始化脚本和 Stage4 合成容量数据脚本，从而支持全新离线主机冷启动；Importer 只接受当前 v3 格式。目标主机可先只验证、不写入镜像库：

```powershell
.\scripts\deploy\Import-MesRelease.ps1 `
  -ReleaseDirectory "D:\mes-release-1.0.0" `
  -VerifyOnly
```

移除 `-VerifyOnly` 后才执行一次 `docker load`；脚本不会启动容器、创建卷/网络或连接数据库。导入前会拒绝旧版或无版本清单、路径穿越、绝对路径、大小写冲突、重解析点、额外文件、错误大小/摘要、归档镜像集合不匹配和本机不可变引用冲突。

包内 SHA-256 用于发现复制/存储损坏，不能防止攻击者同时替换制品、清单和包内 Import 脚本。正式传递应从仓库外可信位置运行固定 importer，并通过发布系统记录 `release-manifest.json` 的外部可信哈希；需要更强供应链保证时增加离线签名。

## 2. 配置与 Secrets

复制 `deploy/.env.production.example` 到仓库外或 `.tmp` 下，填写域名、外部 MySQL/MQ 地址、账号和两个固定镜像摘要。密码文件及 TLS 私钥应位于仓库外、仅允许运维账号读取；Compose 只把它们以只读 secret 文件挂入对应容器。

`rabbitmq_url` 文件保存完整 AMQP URL，`session_secret_key` 至少使用 32 字节随机值。不要把密码写进 env 文件、Compose 文件、镜像或发布包。

只做静态预检，不会连接数据库或启动容器：

```powershell
.\scripts\deploy\Test-ProductionDeployment.ps1 -EnvFile "D:\mes-config\production.env"
```

## 3. 上线前备份和恢复演练

迁移为 forward-only，MySQL DDL 可能自动提交；数据库备份和成功的恢复演练才是可靠回滚基础。由 DBA 使用固定版本的 MySQL 客户端执行：

```text
mysqldump --single-transaction --quick --routines --triggers --events --hex-blob \
  --host=<host> --user=<backup_user> --databases mes_single_branch > mes-before-V008.sql
```

密码通过受限的 MySQL option file 提供，禁止放在命令行。对 SQL 文件生成 SHA-256，同时归档 `mes_reports` Docker 卷。不要通过热拷 MySQL 数据目录代替逻辑备份。

生产环境通过 `MES_REPORTS_VOLUME_NAME` 固定报告卷的物理名称，避免 Compose 项目名变化后备份到错误的卷。备份前必须进入维护窗口并停止报告写入；只读挂载不会冻结其他容器正在写入的文件。使用本机已有的固定 digest Python 工具镜像执行：

```powershell
.\scripts\deploy\Backup-MesReports.ps1 `
  -SourceVolume "mes-production-reports" `
  -ToolImage "public.ecr.aws/docker/library/python@sha256:<64位摘要>" `
  -OutputDirectory "D:\mes-backups\reports-before-1.0.0" `
  -ConsistencyMode quiesced
```

输出包含 `mes-reports.tar.gz` 和 `reports-manifest.json`。清单记录归档大小/SHA-256、目录、逐文件路径/大小/SHA-256、工具镜像 digest 和一致性模式；符号链接、硬链接、特殊文件、危险路径或备份期间发生变化都会使任务失败。

恢复演练只创建名称以 `-restore-test` 结尾、带隔离标签的全新 Docker 卷，不覆盖已有卷：

```powershell
.\scripts\deploy\Restore-MesReportsRehearsal.ps1 `
  -BackupDirectory "D:\mes-backups\reports-before-1.0.0" `
  -TargetVolume "mes-reports-1-0-0-restore-test" `
  -ToolImage "public.ecr.aws/docker/library/python@sha256:<与备份工具兼容的64位摘要>"
```

恢复 helper 在无网络容器的临时目录中先校验 manifest、归档和全部成员，只接受普通文件/目录；验证完成后才写入空目标卷，并再次逐文件核验。失败卷默认保留用于调查，清理时必须同时核对精确卷名、`io.mes.purpose=reports-restore-rehearsal` 和 `io.mes.rehearsal-id`，禁止使用全局 volume prune。

恢复演练只能导入全新的隔离库（例如 `mes_single_branch_restore_test`），然后核对：

- `schema_migrations` 为 V008 且 checksum 正确；
- schema contract 缺口为 0；
- 任务、样品、托盘、实验、排程等关键表行数与备份记录一致；
- 报告卷文件数和 SHA-256 一致；
- 隔离 API 的 `/health/ready` 和核心只读接口正常。

在未完成恢复演练前，不执行正式迁移。

事件留存由 API 后台任务执行，默认启动延迟 60 秒、每小时运行一次，并通过 MySQL 命名锁保证多实例中只有一个清理器工作。上线后应通过 `/health/capacity` 检查当前 `CAPACITY_WARN_*` 阈值、告警原因，以及 `retention` 的最近运行结果、累计删除量和错误信息；保留期、批次或容量阈值变更应先在隔离恢复库验证。长稳验收命令和判定规则见 `docs/stage4-long-running-acceptance.md`。

仓库提供数据库的 `scripts/deploy/Backup-MesDatabase.ps1`、`Restore-MesRehearsal.ps1`，以及报告卷的 `Backup-MesReports.ps1`、`Restore-MesReportsRehearsal.ps1`。这些工具只接受固定 digest 镜像。数据库恢复只允许名称以 `_restore_test` 结尾的空数据库；报告恢复只创建名称以 `-restore-test` 结尾的新卷。正式数据库恢复仍必须由 DBA 在独立维护窗口执行，演练脚本不得覆盖正式数据。

应用发布包、数据库备份和报告备份保持为三个独立制品，不把真实运行数据塞入应用镜像包。维护窗口前将它们放在同一批次目录下，例如 `release/`、`database/`、`reports/`，然后生成关联清单：

```powershell
.\scripts\deploy\New-MesDeploymentOperation.ps1 `
  -ReleaseDirectory "D:\mes-operation-1.0.0\release" `
  -DatabaseBackupDirectory "D:\mes-operation-1.0.0\database" `
  -ReportsBackupDirectory "D:\mes-operation-1.0.0\reports" `
  -PreviousApiImage "registry.example.com/mes/api:0.9.0@sha256:<旧摘要>" `
  -PreviousWebImage "registry.example.com/mes/web:0.9.0@sha256:<旧摘要>" `
  -OutputFile "D:\mes-operation-1.0.0\operation-manifest.json"
```

`operation-manifest.json` 记录新旧镜像、三个子清单及数据库 dump/报告归档的大小与 SHA-256，并交叉要求数据库/报告备份使用发布包内相同的工具镜像。正式批次只接受 `offline` 或 `quiesced` 报告备份，拒绝 `live_best_effort`。

## 4. 维护窗口部署

1. 停止旧 API 的写入入口，确认没有正在执行的写事务。
2. 完成数据库和报告卷备份，记录校验值与旧镜像摘要。
3. 显式运行一次迁移：

   ```powershell
   docker compose --env-file "D:\mes-config\production.env" -f compose.production.yml --profile migration run --rm migrate
   ```

4. 迁移成功后启动正式服务：

   ```powershell
   docker compose --env-file "D:\mes-config\production.env" -f compose.production.yml up -d api web
   ```

5. 验证 HTTPS、`/health/ready`、登录、任务只读、报告下载、RabbitMQ 和 MQTT 状态，再恢复业务写入。

迁移、API 与 Web 容器默认使用 Docker `json-file` 日志驱动，单文件上限 `10m`、最多保留 `5` 个文件。可通过生产环境文件中的 `DOCKER_LOG_MAX_SIZE` 和 `DOCKER_LOG_MAX_FILE` 调整，并在变更后重建容器；外部 MySQL 与消息代理的日志保留策略由各自运维平台独立配置。

普通 `up -d api web` 不会执行 DDL；如果漏做迁移，API 的生产 readiness 会因版本或 schema contract 不满足而拒绝就绪。

## 5. 回滚

应用问题但数据库结构兼容时，可将 env 中 API/Web 引用改回已保留的旧 digest 后重启。若迁移导致不兼容，停止所有写入，按 DBA 流程从已验证备份恢复到新库或原库，再切回旧镜像。不得手工删除 `schema_migrations` 记录伪造降级。

高低温湿热二室仅由应用内 hostless 本地模拟完成安装样品和夹具就绪；准备、启动和结束与其他实验室一样通过 MQTT 上位机接口完成。正式部署不会启动开发上位机模拟器，两种入口继续共享同一套任务、托盘、实验室、流程、存储和设备业务规则。
