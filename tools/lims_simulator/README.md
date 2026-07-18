# MES LIMS 模拟器

开发阶段用于模拟 LIMS 向 MES 下发外部委托。模拟器只通过 RabbitMQ
AMQP 发布持久化 JSON 消息，不调用 MES 接收 HTTP API，也不直接写数据库。

标准 `start-dev.ps1` 和桌面启动器会随 MES 一起启动、关闭该服务。
默认页面：`http://127.0.0.1:8900/`。

单独启动：

```powershell
$env:RABBITMQ_URL = "amqp://guest:guest@127.0.0.1:5672/"
python -m uvicorn app:app --app-dir tools/lims_simulator --host 127.0.0.1 --port 8900
```

消息拓扑：

- 命令 Exchange：`lims.mes.commands`
- 下发 Routing Key：`lims.external-intake.created.v1`
- MES Queue：`mes.external-intake.v1`
- 状态 Exchange：`mes.lims.events`
- LIMS 状态 Queue：`lims.external-intake-status.v1`
