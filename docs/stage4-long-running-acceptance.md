# 阶段四长期运行验收

阶段四使用只读探针对正在运行的 MES 执行长稳验收，不创建、修改或删除业务任务。探针同时比较运行前后的业务内容签名和容量水位，避免只看响应时间而遗漏数据漂移或后台异常增长。

## 验收命令

本地快速验收：

```powershell
rtk proxy .\.venv\Scripts\python.exe scripts\stage4_soak_probe.py `
  --base-url http://127.0.0.1:8000 --duration 60 --users 5 `
  --output artifacts\performance\stage4-soak-60s.json
```

正式长稳验收建议至少运行 8 小时：

```powershell
rtk proxy .\.venv\Scripts\python.exe scripts\stage4_soak_probe.py `
  --base-url http://127.0.0.1:8000 --duration 28800 --users 5 `
  --output artifacts\performance\stage4-soak-8h.json
```

Docker 隔离打包栈默认将 API 映射到 `http://127.0.0.1:18000`，执行探针时必须显式传入该地址。运行前先分别请求 `/health/ready` 与 `/health/capacity`；不要把探针指向未授权的正式环境。探针自身只调用 GET 接口，但已启用的后台留存任务可能在窗口内正常清理过期事件。

## 默认通过条件

- 所有只读请求无错误，各场景 P95 不超过 500ms。
- 运行前后任务、样品、实验、排程等业务内容 SHA-256 一致；允许后台留存任务减少 `mes.staging_events`。
- `/health/capacity` 最终状态为 `ok`，留存清理器没有最近错误。
- 留存清理器必须处于 `enabled=true`，且为 `scheduled=true` 或正在运行。
- 只读窗口内 `mes.staging_events` 不增长。
- MQTT 与实验事件允许外部设备在验收期间产生最多 1000 行增量；可按现场消息频率调整。

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

Docker 环境需要重新构建 API 镜像并先运行迁移服务。启动后依次确认：

1. `/health/ready` 返回 `ready`。
2. `/health/capacity` 返回 `ok`，且 `retention.scheduled=true`。
3. V007 四个留存索引存在。
4. Docker `json-file` 日志轮转参数已应用到 MySQL、RabbitMQ、API 和 Web 容器。
5. 再从宿主机对 Web/API 地址执行阶段四探针。

隔离打包栈的快速验收命令为：

```powershell
rtk proxy .\.venv\Scripts\python.exe scripts\stage4_soak_probe.py `
  --base-url http://127.0.0.1:18000 --duration 60 --users 5 `
  --output artifacts\performance\stage4-soak-packaging-60s.json
```
