# 实验室夹具安装 MQTT 准备就绪门禁设计

## 目标

把实验室“安装夹具”和“实验准备就绪”改成由上位机确认解锁的流程。实验室人员点击安装夹具后，MES 向上位机发送任务与样品校验信息；PLC 检测夹具安装完成后通知上位机，上位机再回传 MES。只有 MES 收到上位机的夹具安装完成/启动准备就绪事件后，实验室界面的“实验准备就绪”按钮才允许点击。

## 业务流程

1. 实验室界面点击“安装夹具”。
2. MES 发送 `INSTALL_FIXTURE` 到上位机，包含 `taskId`、`labId`、`sampleType`、`sampleCount`。
3. MES 将当前任务/实验/实验室进入“等待上位机夹具确认”状态，“实验准备就绪”按钮置灰。
4. PLC 检测实际夹具安装状态。
5. 夹具安装完成后，PLC 向上位机发送完成信号。
6. 上位机向 MES 发送 `FIXTURE_READY`，包含 `taskId`、`labId`、`successId`，建议包含 `messageId`、`correlationId`、`occurredAt`。
7. MES 记录 MQTT 流水和业务事件，并把该任务/实验/实验室标记为可确认准备就绪。
8. 实验室界面刷新或收到状态后，“实验准备就绪”按钮解除置灰。
9. 实验室人员点击“实验准备就绪”，进入后续实验准备完成流程。

## 协议方向

新协议以当前业务确认为准：

- MES -> 上位机：`INSTALL_FIXTURE`
- 上位机 -> MES：`FIXTURE_READY`
- 上位机 -> MES：`EXPERIMENT_STARTED`
- 上位机 -> MES：`EXPERIMENT_ENDED`
- 上位机 -> MES：`EXPERIMENT_RESULT`

现有 MES -> 上位机 `READY` 仅作为旧兼容项，不作为新主流程中“夹具安装完成”的来源。

## 数据库设计

### 扩展现有表

`biz_experiment` 增加实验实际时间：

- `actual_start_time DATETIME NULL`
- `actual_end_time DATETIME NULL`

这两个字段属于实验生命周期，不放入计划排程表 `biz_schedule`，也不放入任务级 `biz_task.actual_end_time`。

### 新增 MQTT 流水表

新增 `biz_mq_message_log` 保存通信原文、幂等键和处理状态：

- `message_id`
- `direction`
- `topic`
- `message_type`
- `correlation_id`
- `lab_code`
- `task_no`
- `experiment_no`
- `payload_json`
- `process_status`
- `error_code`
- `error_message`
- `received_at`
- `processed_at`

该表用于审计、幂等、重复消息处理和联调排错。

### 新增实验室 MQTT 事件表

新增 `biz_experiment_event` 保存上位机回传的业务事件：

- `event_type`
- `task_no`
- `experiment_no`
- `lab_code`
- `success_id`
- `event_time`
- `message_id`
- `message_log_id`
- `payload_json`

`FIXTURE_READY` 可能只有任务和实验室，没有实验编号，因此不直接强塞进 `biz_experiment`。

### 新增实验结果表

新增 `biz_experiment_result` 保存单实验结果包：

- `task_no`
- `experiment_no`
- `lab_code`
- `result_time`
- `conclusion`
- `summary`
- `result_payload_json`
- `message_id`
- `message_log_id`

不使用 `res_task_result` 作为主表，因为当前系统支持一个任务多个实验，任务级结果表无法清楚保存单实验原始包。

## 前端门禁

实验室操作台当前三步流程中，样品安装完成后不能立即允许“实验准备就绪”。新规则：

- 当前实验托盘为 `工装夹具安装` 后，进入等待上位机确认。
- 未收到 `FIXTURE_READY` 时，`canMarkReady = false`。
- 收到 `FIXTURE_READY` 后，`canMarkReady = true`。
- 页面文案提示“等待上位机确认夹具安装完成”。

门禁状态需要持久化，页面刷新后仍然可恢复。

## 后端接收

第一版可以提供 HTTP 调试入口和服务层处理函数，方便测试与联调；随后再由 MQTT subscriber 调用同一处理函数。

处理函数负责：

- 校验 payload。
- 写入 `biz_mq_message_log`。
- 按 `messageId` 幂等。
- 写入 `biz_experiment_event` 或 `biz_experiment_result`。
- 更新 `biz_experiment.actual_start_time` / `actual_end_time` 和状态。
- 返回业务 ACK。

## 测试

- schema 扩展 SQL 测试：确认字段和新表会被创建。
- MQ inbound processor 测试：确认 `FIXTURE_READY` 能记录事件并返回 ACK。
- 前端模型测试：样品安装后未收到上位机确认时准备就绪置灰；收到确认后可点击。
- JSON 协议文档格式测试：`python -m json.tool`。
