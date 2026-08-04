# Stage4 新主机 Codex 部署交接单

本文档用于把 MES 的正式 Stage4 长稳验收交给局域网独立主机上的 Codex 执行。本次“部署”仅指在独立主机上运行隔离验收栈，不是生产环境切换，不连接、导入或复制任何真实数据库。

## 1. 交给新主机 Codex 的任务

将下面这段话连同本文档路径一起交给新主机上的 Codex：

> 请完整阅读 `docs/stage4-new-host-codex-handoff.md`，严格按文档执行独立 Stage4 验收部署。先只读预检；任何隔离、安全、镜像、v3清单或资源条件不满足时立即停止并汇报。不得连接真实数据库，不得使用生产凭据，不得执行任何 prune、模糊删除、git提交或推送。正式执行时阶段性汇报并持续监控到8小时验收结束，最后回传完整证据和SHA-256清单。

新主机 Codex 开始前还应阅读离线包中的：

- `docs/stage4-long-running-acceptance.md`
- `docs/production-deployment.md`
- `deploy/.env.stage4.example`
- `scripts/deploy/Import-MesRelease.ps1`
- `scripts/deploy/Invoke-Stage4Acceptance.ps1`

## 2. 必须准备的文件

把以下内容复制到新主机，例如放到 `D:\MES-Stage4\incoming`：

1. 当前格式的 MES v3 离线发布目录，目录内必须有：
   - `release-manifest.json`
   - `mes-images.tar`
   - Compose、部署脚本和文档目录
2. 本文档。
3. 从发布机外部可信位置记录的 `release-manifest.json` SHA-256。不要只信任包内自身记录的摘要。

旧 v1/v2 包不得使用。不要把当前开发目录、真实数据库备份或生产密码复制到验收主机。

建议目录结构：

```text
D:\MES-Stage4\
├─ incoming\mes-release-v3\
├─ config\
├─ runs\
└─ handoff\stage4-new-host-codex-handoff.md
```

## 3. 主机最低条件

当前执行器使用 Windows TCP 监听进程保护检查，因此目标应是：

- 独立 Windows 11 主机，或位于另一台物理服务器上的 Windows VM。
- 不得是在当前开发电脑内创建的 VM。
- 至少4核CPU、16GiB内存、60GiB可用SSD空间。
- Docker Desktop 已启动，并处于 Linux containers 模式。
- Docker Compose 可用。
- PowerShell 7 可用。
- Python 3.12 可用，且能提供明确的可执行文件路径。
- 系统时间同步正常；8小时内禁用休眠和自动重启。
- 主机不承载其他生产业务、MySQL、MQTT或MES实例。

除可选的 SSH 端口外，不需要向局域网开放 Stage4 端口。Compose 会把验收端口只绑定到目标机 `127.0.0.1`。

## 4. 第一阶段：只读预检

新主机 Codex 必须先执行只读检查，不创建容器、卷或网络：

1. 记录 Windows、CPU、内存、磁盘、PowerShell、Python、Docker和Compose版本。
2. 确认 Docker daemon 可用，并记录 Docker Server ID。
3. 确认 Docker 使用 Linux containers。
4. 确认 Python 版本严格为3.12。
5. 确认以下端口未被监听：
   - 25173：Stage4 Web
   - 28000：Stage4 API
   - 23306：Stage4 MySQL
   - 25673：RabbitMQ管理端
   - 21883：Stage4 MQTT
6. 确认磁盘剩余空间不少于60GiB，内存不少于16GiB。
7. 确认离线包目录没有重解析点或额外未知文件。
8. 从可信位置取得外部摘要，核对 `release-manifest.json` SHA-256。

如果目标主机上已经存在名称以 `-stage4-soak` 结尾的 Compose 项目，或存在来源不明的同名卷/网络，停止执行，不得自动删除。

预检输出保存到本次批次的 `preflight` 目录。批次目录示例：

```text
D:\MES-Stage4\runs\20260804-r3\
├─ preflight\
├─ import\
└─ evidence\   # 执行器创建；开始前必须不存在
```

## 5. 第二阶段：严格验证并导入 v3 包

在 v3 发布目录中执行，先验证且不写入 Docker 镜像库：

```powershell
$Release = "D:\MES-Stage4\incoming\mes-release-v3"
& "$Release\scripts\deploy\Import-MesRelease.ps1" `
  -ReleaseDirectory $Release `
  -VerifyOnly
```

要求：

- `release-manifest.json` 必须是 `mes-offline-release` v3。
- 镜像角色必须严格为：`api`、`web`、`mysql-client`、`rabbitmq`、`reports-tool`。
- 所有镜像引用必须使用不可变 `@sha256:` 摘要。
- VerifyOnly成功前不得执行镜像导入。

验证成功后再执行离线导入，并把完整控制台输出保存到 `import` 目录：

```powershell
& "$Release\scripts\deploy\Import-MesRelease.ps1" `
  -ReleaseDirectory $Release
```

导入只允许执行 `docker load`，不得构建、拉取或启动服务。导入后逐个记录五个角色的镜像引用、镜像ID、OS和架构。

## 6. 第三阶段：生成隔离配置

从包内模板复制新配置：

```powershell
$Release = "D:\MES-Stage4\incoming\mes-release-v3"
$EnvFile = "D:\MES-Stage4\config\stage4-r3.env"
Copy-Item "$Release\deploy\.env.stage4.example" $EnvFile
```

新主机 Codex 应修改副本，不修改包内模板。配置必须满足：

- `MYSQL_DATABASE` 严格匹配 `^[a-z0-9_]+_stage4_test$`。
- `MES_API_IMAGE` 使用v3清单的 `api` 引用。
- `MES_WEB_IMAGE` 使用v3清单的 `web` 引用。
- `MYSQL_IMAGE` 使用v3清单的 `mysql-client` 引用。
- `RABBITMQ_IMAGE` 使用v3清单的 `rabbitmq` 引用。
- 四个密码和 `SESSION_SECRET_KEY` 使用本次验收新生成的随机值。
- 不得使用生产数据库、RabbitMQ、MQTT或会话密钥。
- 端口保持模板中的25173、28000、23306、25673、21883，除非预检发现冲突；如冲突应停止并汇报，不要自行改用未知端口继续。

环境文件包含临时密码，不得加入Git或回传到聊天。证据中的Compose配置必须脱敏。

## 7. 第四阶段：执行正式8小时验收

本次项目名必须唯一、全小写并以 `-stage4-soak` 结尾，例如：

```text
mes-r3-20260804-stage4-soak
```

执行命令：

```powershell
$Release = "D:\MES-Stage4\incoming\mes-release-v3"
$EnvFile = "D:\MES-Stage4\config\stage4-r3.env"
$Evidence = "D:\MES-Stage4\runs\20260804-r3\evidence"

& "$Release\scripts\deploy\Invoke-Stage4Acceptance.ps1" `
  -EnvFile $EnvFile `
  -ProjectName "mes-r3-20260804-stage4-soak" `
  -ComposeFile "$Release\compose.packaging.yml" `
  -Stage4ComposeFile "$Release\compose.stage4.yml" `
  -PythonPath "C:\Python312\python.exe" `
  -DurationSeconds 28800 `
  -Users 5 `
  -WindowSeconds 60 `
  -MinRequestsPerEndpoint 100 `
  -LoadP0CapacityFixture `
  -RequireRetentionRun `
  -KeepResourcesOnFailure `
  -OutputDirectory $Evidence
```

不得使用 `-SkipProtectedServiceCheck`。`evidence` 目录在命令开始前必须不存在。

执行器应自动保证：

1. 项目、卷和网络是全新的。
2. 端口只绑定目标主机回环地址。
3. 只使用已导入的固定digest镜像，禁止build和pull。
4. 启动顺序为 MySQL/RabbitMQ → migrate → P0夹具 → API/Web → 探针。
5. 夹具只能写入 Compose 内部 `mysql:3306/<*_stage4_test>` 空库。
6. 强制核对33任务、3200样品、132实验、4800实验样品关系及身份签名。
7. 本次业务只读内容在8小时内不漂移。

## 8. 运行期间监控与阶段汇报

新主机 Codex 必须保持任务运行，不得因单次无新输出而停止。建议每30至60分钟汇报一次：

- 已运行时长和剩余时长。
- 当前窗口请求数、错误数、吞吐和最高P95。
- API/Web/MySQL/RabbitMQ健康状态。
- 容器重启、OOM、dead状态。
- 各容器内存占资源限制的比例。
- capacity状态和留存任务状态。
- 是否出现业务签名或固定规模变化。

不要在等待时启动第二套Stage4，不要修改环境文件或重启Docker Desktop。遇到失败时保留现场，先采集证据和日志。

## 9. 正式通过条件

必须同时满足：

- 持续运行28800秒。
- 5个并发用户、60秒窗口。
- 请求错误数为0。
- 各接口累计样本不少于100。
- 每个窗口各接口P95不超过500ms。
- 不得连续两个窗口吞吐比首窗口下降超过30%。
- readiness全程为 `ready`，最终capacity为 `ok`。
- 业务规模、身份签名和内容签名前后不变。
- 暂存事件不增长；MQTT和实验事件增长不超过配置阈值。
- 留存任务至少有一次获得数据库锁且结果完整的成功运行。
- 没有restart、OOM、dead或unhealthy。
- 容器内存占限制比例低于80%。
- Docker日志轮转配置存在。

历史3200样品基线曾出现部分P95高于500ms。若正式验收因此失败，应如实判定失败并保留证据，不得降低阈值或用空库结果替代。

## 10. 证据和回传内容

至少回传：

- `preflight` 目录。
- v3 VerifyOnly和docker load完整日志。
- 外部可信的 `release-manifest.json` SHA-256。
- `stage4-soak-report.json`。
- `stage4-runner-summary.json`。
- `stage4-evidence-manifest.json`。
- `compose-config.redacted.json`。
- `stage4-host.json`和`stage4-images.json`。
- fixture脚本、快照摘要和装载日志。
- `compose-ps.jsonl`、`compose.log`、`docker-system-df.txt`。

最后对整个批次目录生成一个外层SHA-256清单。外层清单应包含 `preflight`、`import` 和 `evidence` 下的所有普通文件，但排除清单自身，避免循环摘要。把外层清单自身的SHA-256另行记录并回传。

禁止回传未脱敏环境文件、密码、会话密钥或任何真实业务数据。

## 11. 清理规则

验收成功时，执行器会按精确Compose项目标签删除本次容器、卷和网络。

验收失败且使用了 `-KeepResourcesOnFailure` 时：

1. 先保存全部证据。
2. 核对每个容器、卷和网络的 `com.docker.compose.project` 标签等于本次完整项目名。
3. 未经确认不要删除失败现场。
4. 获得确认后，只能使用相同项目名、环境文件和两个Compose文件执行精确 `down --volumes --remove-orphans`。

任何情况下都禁止：

- `docker system prune`
- `docker volume prune`
- `docker network prune`
- 模糊匹配删除容器或卷
- 删除其他项目或历史RC资源
- 连接当前开发机或生产环境的3306、1883、5173、8000

## 12. Codex 最终汇报格式

新主机 Codex 最终应汇报：

```text
结论：PASS / FAIL / BLOCKED
主机：OS、CPU、内存、磁盘、Docker Server ID
发布包：版本、manifest SHA-256、五个镜像ID
验收：时长、请求数、错误数、吞吐、最高窗口P95
数据：33/3200/132/4800、身份签名是否一致
留存：成功运行次数、是否获得数据库锁、删除结果
容器：restart/OOM/dead、最高内存占比
证据：批次目录、stage4证据清单SHA-256、外层清单SHA-256
清理：已精确清理 / 因失败保留现场
剩余问题：需要优化或人工决策的事项
```

只有正式8小时报告通过、证据完整且外部摘要核验成功，才能把Stage4标记为完成。
