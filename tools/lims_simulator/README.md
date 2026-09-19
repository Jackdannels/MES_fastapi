# MES LIMS 模拟器

开发阶段用于模拟 LIMS 与 MES 联调（v1.1）。任务下发仍只通过 RabbitMQ
AMQP 发布持久化 JSON 消息；MES 接收、受理、失败回执改为 HTTP POST。
模拟器不访问 MES 数据库，接收记录保存在模拟器自己的 SQLite 文件中。

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

## 两个页面

- `/#dispatch`：任务编辑、随机生成、批量下发；计数和日志为本次进程会话数据。
- `/#interactions`：持久化 HTTP 通知列表、完整任务编号查询、分页、原始报文。
- 切换页面保留未下发的表单。MQ 连接状态不代表 HTTP 回调状态。
- 完成详情的缺失值显示“无”（实际 0 秒仍显示“0 秒”）；所有时间统一转换为北京时间 `YYYY-MM-DD HH:mm:ss`，不受浏览器时区影响。原始报文不改写。
- 人员和登录会话显示报文中的人员姓名，不追加账号；“退出时间（考勤截止）”显示真实退出、会话截止、试验完成时间三者中最早的有效时间。未退出时使用截止/完成时间，仅作展示，不修改真实会话。
- 每个设备执行阶段显示“涉及托盘及样品”，按该阶段的托盘编号精确匹配报文中的样品，逐托盘列出，不混入其他托盘。
- MES 已接入 `mes.experiment.completion.v1`：至少一个托盘首次完成该试验全部要求的轴向及子试验步骤才发送；单轴完成不发送，不等待其他托盘或任务的其他试验。
- 完成详情展示试验、全部相关执行阶段、人员登录及考勤、托盘样品和范围限定的数据 URL。详见 [完成回传协议](../../docs/lims-experiment-completion.md)。

## HTTP 基础协议（业务字段待确认）

接收接口：`POST /api/mes/events`。统一信封：

```json
{
  "event_id": "唯一事件编号，重试必须不变",
  "message_id": "可选的源消息编号",
  "correlation_id": "原 LIMS 请求编号",
  "type": "mes.external-intake.received.v1",
  "schema_version": 1,
  "source": "MES",
  "occurred_at": "2026-09-18T12:00:00+08:00",
  "payload": {"code": "SYLUW-2026-09-021", "acceptance_status": "received"}
}
```

- 已接入事件：`mes.external-intake.received.v1`、`mes.external-intake.accepted.v1`、`mes.external-intake.failed.v1`。沿用既有业务载荷。
- 完成事件要求 `completion_id`、正整数 `revision`、任务及试验编号。其他 `mes.*` 事件仍作为不透明载荷接收，不计算工时；链接只能由用户点击合法 HTTP(S) 地址打开。
- 成功落盘后返回 `{"ok": true, "event_id": "原事件编号", "duplicate": false}`；重复且内容相同返回成功及 `duplicate: true`。同 ID 不同内容返回 409。
- `Idempotency-Key` 如提供，必须等于 `event_id`。不支持的信封版本返回 422；载荷上限 1 MiB。
- `GET /api/interactions?task_code=完整编号&limit=20&offset=0` 查询接收记录。默认 50 条、最多 100 条。完成记录按 `completion_id` 仅展示最高版本，旧版本晚到不覆盖；`total` 是业务记录数，`raw_total` 是原始事件数。
- 接收库默认与序列文件同目录，名称 `interactions.sqlite3`；可用 `LIMS_INBOX_PATH` 单独配置。重启不丢失，不随 MES 任务重置清理。

## 配置与可靠性

- MES：`LIMS_HTTP_CALLBACK_URL=http://127.0.0.1:8900/api/mes/events`；空值暂停推送但保留待发送记录。
- MES：`LIMS_HTTP_TIMEOUT_SECONDS=5`，单次超时，范围 0～60 秒（不含 0）。
- MES：`LIMS_DATA_PUBLIC_BASE_URL` 指定 LIMS 可访问的 MES 下载地址。空时使用明确的 `TEST_DATA_PUBLIC_BASE_URL`；`auto` 不能用于后台推送。标准启动脚本使用本机后端的局域网 URL。
- 两端：`LIMS_HTTP_TOKEN` 配置相同 Bearer Token。模拟器从环境变量或项目根 `.env` 读取此项；环境变量优先。未设置时只接受 loopback 回调，部署应设置 token 并使用 HTTPS。
- 标准启动脚本按 `LimsSimulatorPort` 自动为 MES 设置本机回调 URL。单独启动 MES 时需要自行设置 URL。
- MES 使用现有 `mes.lims_outbox`，接收/受理回执与业务数据一起保存。HTTP 后台发送独立于 RabbitMQ 连接；失败记录保留并以 2、4、8…最多 300 秒间隔持续重试，不阻塞任务受理。
- 只有 HTTP 2xx 且响应 `ok=true`、`event_id` 匹配才删除待发送记录；拒绝重定向。超时后可能重复发送，接收端负责去重。
- 发送尝试数、下次重试时间及错误类型保存在 `_delivery` 内部字段，不发送给 LIMS。
- MES `GET /health/lims-http` 查看运行状态、待发送数和最近错误；计数为当前发送轮次观测值，成功计数为本次进程累计。该集成不可用不会让 MES 核心就绪检查失败。
- **本版没有人工补发按钮**，恢复服务/修正配置后自动重试；成功通知在模拟器保留，MES 待发送队列不充当审计历史。
- 保持现有 MQTT 实验控制和高低温湿热二室夹具例外不变。

迁移时同时重启 MES 与模拟器。旧的 RabbitMQ 状态交换机/队列不再声明、订阅或发布，旧配置字段仅为兼容保留；不会自动清除旧队列里的历史消息。现有 outbox 未发送记录会改走 HTTP。

模拟器是开发工具，查询页面不带登录鉴权，应保持本机绑定；不要直接暴露到公网。

## 验证

```powershell
python -m pytest -q tests/services/test_lims_http.py tests/services/test_lims_rabbitmq.py tests/tools/test_lims_simulator.py tests/tools/test_lims_http_inbox.py
node --test tests/tools/lims_ui.test.cjs
```
