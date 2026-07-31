# MES 正式环境部署与恢复手册

正式环境使用独立的 `compose.production.yml`。它只包含迁移任务、API 和 HTTPS Web，不创建 MySQL、RabbitMQ 或 MQTT 容器，也不读取项目根目录 `.env`。普通 API 账号只保留 DML 权限；DDL 密码只挂载给显式迁移任务。

## 1. 发布制品

CI 或联网发布机必须先构建、测试并推送 API/Web 镜像，再记录不可变的 `tag@sha256:digest`。正式主机不得现场构建源码，也不得使用 `latest` 或只有版本标签的浮动引用。

离线导出示例：

```powershell
.\scripts\deploy\Export-MesRelease.ps1 `
  -ApiImage "registry.example.com/mes/api:1.0.0@sha256:<64位摘要>" `
  -WebImage "registry.example.com/mes/web:1.0.0@sha256:<64位摘要>" `
  -ReleaseVersion "1.0.0" `
  -OutputDirectory "D:\mes-release-1.0.0"
```

目标主机先运行 `Import-MesRelease.ps1`。脚本会先验证每个文件的 SHA-256，再执行 `docker load`，但不会启动服务。

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
  --host=<host> --user=<backup_user> --databases mes_single_branch > mes-before-V005.sql
```

密码通过受限的 MySQL option file 提供，禁止放在命令行。对 SQL 文件生成 SHA-256，同时归档 `mes_reports` Docker 卷。不要通过热拷 MySQL 数据目录代替逻辑备份。

恢复演练只能导入全新的隔离库（例如 `mes_single_branch_restore_test`），然后核对：

- `schema_migrations` 为 V005 且 checksum 正确；
- schema contract 缺口为 0；
- 任务、样品、托盘、实验、排程等关键表行数与备份记录一致；
- 报告卷文件数和 SHA-256 一致；
- 隔离 API 的 `/health/ready` 和核心只读接口正常。

在未完成恢复演练前，不执行正式迁移。

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

普通 `up -d api web` 不会执行 DDL；如果漏做迁移，API 的生产 readiness 会因版本或 schema contract 不满足而拒绝就绪。

## 5. 回滚

应用问题但数据库结构兼容时，可将 env 中 API/Web 引用改回已保留的旧 digest 后重启。若迁移导致不兼容，停止所有写入，按 DBA 流程从已验证备份恢复到新库或原库，再切回旧镜像。不得手工删除 `schema_migrations` 记录伪造降级。

高低温湿热二室仅由应用内 hostless 本地模拟完成安装样品和夹具就绪；准备、启动和结束与其他实验室一样通过 MQTT 上位机接口完成。正式部署不会启动开发上位机模拟器，两种入口继续共享同一套任务、托盘、实验室、流程、存储和设备业务规则。
