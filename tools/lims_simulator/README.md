# MES LIMS 模拟器

开发阶段用于模拟 LIMS 向 MES 下发外部委托。模拟器只通过 RabbitMQ
AMQP 发布持久化 JSON 消息，不调用 MES 接收 HTTP API，也不直接写数据库。

标准 `start-dev.ps1` 和桌面启动器会随 MES 一起启动、关闭该服务。
默认页面：`http://127.0.0.1:8900/`。

## 任务编号

- MES 内部新建使用 `SYLUN-YYYY-MM-NNN`；LIMS 外部委托使用 `SYLUW-YYYY-MM-NNN`，MES 原样受理并回传外部编号。
- 两个号段独立按月递增；流水号至少三位，超过 `999` 后继续递增，不回绕。
- 模拟器按北京时间当前月取号。`001`～`020` 为 MES 演示重置数据保留（已建外部任务 `001`～`010`、待受理 `011`～`018`），模拟器从 `021` 起号。
- 流水号保存在模拟器自己的 `data/task-sequence.sqlite3`，可通过 `LIMS_SEQUENCE_PATH` 指定位置；不会访问 MES 数据库。重启不会重复取号，多进程共用该文件时以 SQLite 事务串行分配。
- 手动填写更大的外部编号也会推进对应月份的流水号；生成但未发送、发送失败可能产生空号，这是防止重号的正常行为。
- 不再接受旧的 `SYLU-` 编号或内部 `SYLUN-` 编号。修改旧页面表单时，请重新“随机生成”后下发。
- MES 任务重置不重置模拟器流水号。不要单独删除序列文件，否则可能重用已下发的外部编号。

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
