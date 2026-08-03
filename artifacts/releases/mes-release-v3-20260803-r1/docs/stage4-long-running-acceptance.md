# 阶段四长期运行验收

阶段四使用只读探针对正在运行的 MES 执行长稳验收，不创建、修改或删除业务任务。探针同时比较运行前后的业务内容签名和容量水位，避免只看响应时间而遗漏数据漂移或后台异常增长。

正式8小时验收应运行在独立Docker主机或虚拟机。同一Docker daemon即使端口和卷完全隔离，仍会争用CPU、内存和磁盘I/O，不能作为“本地主程序零影响”的正式证据。本机只执行低并发短时预演，用于验证镜像、迁移、探针、报告和精确清理链路。

当前执行器使用 Windows 的 TCP 监听进程保护检查，因此正式验收主机应使用独立 Windows 11 主机，或运行在另一台物理服务器上的 Windows VM；不要使用当前开发电脑上的 VM。主机需要 Docker Desktop（Linux containers）、PowerShell 7 和 Python 3.12，建议至少4核CPU、16GiB内存和60GiB可用SSD空间。离线包不携带宿主 Python 运行时，执行时应通过 `-PythonPath` 指向已审计的 Python 3.12 可执行文件；脚本不会安装软件或访问公网。

## 验收命令

本机隔离快速验收使用固定RC2镜像、全新项目卷和资源上限。先复制临时配置并替换密码，再执行统一入口；脚本完成后会核验项目标签并只删除本次项目的容器、卷和网络：

```powershell
Copy-Item deploy\.env.stage4.example .tmp\stage4-soak.env
.\scripts\deploy\Invoke-Stage4Acceptance.ps1 `
  -EnvFile .tmp\stage4-soak.env `
  -ProjectName mes-rc2-20260802-stage4-soak `
  -DurationSeconds 60 -Users 2 -WindowSeconds 15 `
  -MinRequestsPerEndpoint 5 `
  -PythonPath .venv\Scripts\python.exe `
  -OutputDirectory artifacts\performance\stage4-rc2-short
```

正式长稳验收建议至少运行8小时，并在独立主机上要求留存任务至少成功推进一次：

```powershell
.\scripts\deploy\Invoke-Stage4Acceptance.ps1 `
  -EnvFile D:\mes-stage4\stage4.env `
  -ProjectName mes-rc2-20260802-stage4-soak `
  -DurationSeconds 28800 -Users 5 -WindowSeconds 60 `
  -MinRequestsPerEndpoint 100 -LoadP0CapacityFixture -RequireRetentionRun `
  -PythonPath "C:\Python312\python.exe" `
  -OutputDirectory D:\mes-stage4\evidence
```

执行器固定按 `MySQL/RabbitMQ → migrate → P0隔离容量数据 → API/Web → 探针` 的顺序启动。容量数据只允许写入 Compose 网络内精确的 `mysql:3306/<*_stage4_test>`，并同时要求 `REPLACE_CAPACITY_DATABASE` 确认文本；不会连接、导入或复制本机真实3306数据库。正式模式强制加载33个任务、3200个样品、132个实验和4800条实验样品关系，并核对确定性身份签名；探针在开始和结束时都会强制复核。

直接调用探针时必须显式传入 `--base-url`；不要使用本地主程序的8000端口。Stage4示例将隔离API映射到`http://127.0.0.1:28000`。探针自身只调用GET接口，但已启用的后台留存任务可能在窗口内正常清理过期事件。

探针按窗口分段运行，每个窗口结束即汇总并丢弃完整请求对象，同时原子更新检查点，避免8小时累计约72万条完整样本。每个窗口采集readiness、capacity，以及可选Docker项目的容器状态、重启、OOM、CPU、内存、PID和日志轮转配置。报告目录同时保存脱敏Compose配置、宿主/Docker/Compose/Python版本、镜像引用和ID、fixture脚本及快照摘要、Compose状态、容器日志与Docker磁盘快照。结束时生成 `stage4-evidence-manifest.json`，列出除清单自身外全部证据文件的大小和SHA-256；还应从发布系统或其他可信位置保存该清单自身的外部SHA-256。

## 默认通过条件

- 所有只读请求无错误，各场景 P95 不超过 500ms。
- 每个接口达到配置的最少请求数；连续两个窗口吞吐不得较首窗口下降30%以上。
- 运行前后任务、样品、实验、排程等业务内容 SHA-256 一致；允许后台留存任务减少 `mes.staging_events`。
- `/health/capacity` 最终状态为 `ok`，留存清理器没有最近错误。
- 留存清理器必须处于 `enabled=true`，且为 `scheduled=true` 或正在运行。
- 正式8小时验收要求 `lastFinishedAt` 至少推进一次，且 `lastResult.acquired=true`、没有 `skippedReason`、三类清理结果完整；每个窗口还检查留存错误和累计删除计数不得回退。
- 只读窗口内 `mes.staging_events` 不增长。
- MQTT 与实验事件允许外部设备在验收期间产生最多 1000 行增量；可按现场消息频率调整。
- 所有非迁移容器持续运行且健康，迁移容器退出码为0；不得发生restart、OOM或dead，内存使用率不得达到限制的80%。

## 容量告警

`/health/capacity` 默认在以下水位产生 `warning`：

- MySQL 连接池使用率达到 80%。
- `mes.staging_events` 达到 20000 条或 16MiB。
- `biz_mq_message_log` 或 `biz_experiment_event` 估算达到 500000 行。
- 最近一次留存清理失败。

阈值通过 `CAPACITY_WARN_*` 环境变量调整。调整前应先查看实际增长速度，并保证留存批次能在两个清理周期内追上写入量。

| 配置 | 默认值 | 含义 |
| --- | ---: | --- |
| `CAPACITY_WARN_POOL_UTILIZATION` | `0.8` | MySQL 连接池告警使用率 |
| `CAPACITY_WARN_STAGING_EVENT_ITEMS` | `20000` | 暂存事件条数告警线 |
| `CAPACITY_WARN_STAGING_EVENT_BYTES` | `16777216` | 暂存事件 JSON 字节告警线（16MiB） |
| `CAPACITY_WARN_MQ_MESSAGE_ROWS` | `500000` | MQTT 消息估算行数告警线 |
| `CAPACITY_WARN_EXPERIMENT_EVENT_ROWS` | `500000` | 实验事件估算行数告警线 |

## Docker 验收

Stage4使用`compose.packaging.yml`叠加`compose.stage4.yml`，固定本机已有的RC2/API/Web/MySQL/RabbitMQ digest，并通过`--no-build --pull never`禁止构建和下载。所有服务配置CPU、内存、PID上限及`restart: no`，避免自动重启掩盖失败。启动后依次确认：

1. `/health/ready` 返回 `ready`。
2. `/health/capacity` 返回 `ok`，且 `retention.scheduled=true`。
3. V007 四个留存索引存在。
4. Docker `json-file` 日志轮转参数已应用到 MySQL、RabbitMQ、API 和 Web 容器。
5. 再从宿主机对Web/API隔离地址执行阶段四探针。

如只对已经运行的授权隔离栈调用探针：

```powershell
rtk proxy .\.venv\Scripts\python.exe scripts\stage4_soak_probe.py `
  --base-url http://127.0.0.1:28000 --duration 60 --users 2 `
  --window-seconds 15 --min-requests-per-endpoint 5 `
  --docker-project mes-rc2-20260802-stage4-soak `
  --output artifacts\performance\stage4-soak-packaging-60s.json
```

新空数据库只能证明基础设施与只读链路稳定。正式8小时验收使用 `-LoadP0CapacityFixture` 向全新隔离卷写入确定性合成数据；不得连接或复制本机真实3306数据库。既有空库短测的低延迟不能代替3200样品规模下的正式性能结论。
