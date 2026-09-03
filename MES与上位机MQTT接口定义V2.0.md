# MES 与上位机 MQTT 接口定义 V2.0

## 1. 基本约定

协议：MQTT

编码：UTF-8

数据格式：JSON

Topic 前缀：

```text
mes/v1
```

时间格式统一使用北京时间本地字符串：

```text
YYYY-MM-DD HH:mm:ss
```

示例：

```text
2026-06-01 09:30:00
```

字段命名统一使用当前 MES 主项目字段风格：

```text
snake_case
```

事件类型由 MQTT Topic 决定，不再在 payload 中额外传事件类型字段。

本版本不使用以下字段或格式：

```text
命令字段
消息编号字段
旧版驼峰命名字段
ISO 带时区时间字符串
UTC 时间字符串
```

## 2. lab_code 说明

`lab_code` 表示具体试验间的业务唯一编号，对应 MES 主项目中的：

```text
md_lab.lab_code
```

示例：

```text
LAB_IMPACT_1
LAB_IMPACT_2
LAB_VIBRATION_1
LAB_SALT
LAB_MOLD
```

所有试验间共用本协议。不同试验间只需要替换 Topic 和 Payload 中的 `lab_code`。

本协议使用 `lab_code`，不使用 `lab_id`。

原因：

```text
lab_code 是稳定业务编号，适合暴露给上位机、文档、topic 和人工排查。
lab_id 通常是数据库自增主键，只适合 MES 内部关联使用，不适合让上位机长期保存。
lab_id 可能因数据库重建、导入、迁移而变化；lab_code 应保持不变。
```

## 3. 字段对照

| 业务含义 | 接口字段 | MES 主项目字段 |
| --- | --- | --- |
| 任务号 | task_code | mes.tasks.code / biz_task.task_no |
| 实验编号 | experiment_code | mes.experiments.experiment_code / biz_experiment.experiment_no |
| 实验批次号 | run_no | mes.experiment_runs.run_no / biz_experiment_run.run_no |
| 试验间编号 | lab_code | md_lab.lab_code |
| 样品类型 | sample_type | mes.tasks.sample_type |
| 样品数量 | sample_count | mes.tasks.sample_count |
| 成功标识 | success_id | biz_experiment_event.success_id |
| 夹具安装完成时间 | fixture_ready_at | biz_experiment_event.event_time |
| 实验开始时间 | started_at | biz_experiment_run.started_at |
| 实验结束时间 | ended_at | biz_experiment_run.ended_at |
| 结果时间 | result_at | biz_experiment_result.result_time |
| 结果包 | result_package | biz_experiment_result.result_payload_json |

以下字段由 MES 内部根据 `lab_code` 和排程上下文反绑定，不要求上位机自行推导：

| MES 内部字段 | 说明 |
| --- | --- |
| task_code | 当前试验间正在执行的任务号 |
| experiment_code | 当前试验间正在执行的实验编号 |
| tray_codes | 当前实验批次对应托盘列表 |

`run_no` 由 MES 在下发 `experiment-ready` 时生成并发送给上位机。上位机不需要生成或修改 `run_no`，但必须缓存并在后续 `experiment-started`、`experiment-ended`、`experiment-result` 中原样带回。

## 4. MES 发送给上位机

### 4.1 安装夹具，校验信息

Topic：

```text
mes/v1/labs/{lab_code}/commands/fixture-install
```

Payload：

```json
{
  "task_code": "SYLU-2026-06-001",
  "lab_code": "LAB_IMPACT_1",
  "experiment_code": "SYLU-2026-06-001-A",
  "sample_type": "金属样品",
  "sample_count": 8
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| task_code | string | 是 | 任务号 |
| lab_code | string | 是 | 试验间编号 |
| experiment_code | string | 是 | 当前试验编号 |
| sample_type | string | 是 | 样品类型 |
| sample_count | number | 是 | 样品数量 |

### 4.2 准备就绪信号

Topic：

```text
mes/v1/labs/{lab_code}/commands/experiment-ready
```

Payload：

```json
{
  "task_code": "SYLU-2026-06-001",
  "lab_code": "LAB_IMPACT_1",
  "experiment_code": "SYLU-2026-06-001-A",
  "run_no": "run-20260607193000123456",
  "sub_experiment_code": "EXP-001-AXIS-001",
  "axis_codes": ["x+", "x-", "y+"],
  "current_axis_code": "x-"
}
```

首次启动时，`current_axis_code` 为该批次首轴向。工作人员完成夹具切换后，MES 会使用同一个 `run_no` 再次下发 `experiment-ready`，并把 `current_axis_code` 更新为待启动的下一轴向。上位机必须以每次 READY 的最新轴向上下文为准。

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| task_code | string | 是 | 任务号 |
| lab_code | string | 是 | 试验间编号 |
| experiment_code | string | 是 | 当前试验编号 |
| run_no | string | 是 | MES 预生成的实验批次号，上位机后续事件必须原样带回 |

### 4.3 实验结束请求

Topic：

```text
mes/v1/labs/{lab_code}/commands/experiment-end-request
```

正常完成沿用原有字段。取消正在运行的霉菌实验时，MES 额外下发：

```json
{
  "task_code": "SYLU-2026-06-001",
  "lab_code": "LAB_MOLD",
  "experiment_code": "SYLU-2026-06-001-A",
  "run_no": "run-20260607193000123456",
  "end_mode": "cancel",
  "cancel_reason": "霉菌未按预期繁殖",
  "cancel_request_id": "cancel-0123456789abcdef"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| task_code | string | 是 | 当前任务号 |
| lab_code | string | 是 | 当前试验间编号；取消霉菌实验时必须为 `LAB_MOLD` |
| experiment_code | string | 是 | 当前实验编号 |
| run_no | string | 是 | 当前运行批次号 |
| end_mode | string | 取消时是 | 取消霉菌实验时固定为 `cancel`；正常完成省略 |
| cancel_reason | string | 取消时是 | MES 操作人员填写的取消原因 |
| cancel_request_id | string | 取消时是 | MES 生成的取消请求标识，上位机确认时必须原样返回 |

## 5. 上位机发送给 MES

### 5.1 夹具安装完成，启动准备就绪

Topic：

```text
mes/v1/labs/{lab_code}/events/fixture-ready
```

Payload：

```json
{
  "lab_code": "LAB_IMPACT_1",
  "success_id": "OK",
  "fixture_ready_at": "2026-06-01 09:20:00"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| lab_code | string | 是 | 试验间编号 |
| success_id | string | 是 | 成功标识 |
| fixture_ready_at | string | 是 | 夹具安装完成时间，北京时间 |

### 5.2 实验开始时间

Topic：

```text
mes/v1/labs/{lab_code}/events/experiment-started
```

Payload：

```json
{
  "lab_code": "LAB_IMPACT_1",
  "run_no": "run-20260607193000123456",
  "sub_experiment_code": "EXP-001-AXIS-001",
  "current_axis_code": "x-",
  "started_at": "2026-06-01 09:30:00"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| lab_code | string | 是 | 试验间编号 |
| run_no | string | 是 | 来自 `experiment-ready` 的实验批次号 |
| sub_experiment_code | string | 轴向任务是 | MES 下发的分段实验编号，原样带回 |
| current_axis_code | string | 轴向任务是 | 本次实际启动的轴向，原样带回 |
| started_at | string | 是 | 实验开始时间，北京时间 |

### 5.3 实验结束时间

Topic：

```text
mes/v1/labs/{lab_code}/events/experiment-ended
```

Payload：

```json
{
  "lab_code": "LAB_IMPACT_1",
  "run_no": "run-20260607193000123456",
  "sub_experiment_code": "EXP-001-AXIS-001",
  "axis_code": "x+",
  "next_axis_code": "y-",
  "ended_at": "2026-06-01 11:30:00"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| lab_code | string | 是 | 试验间编号 |
| run_no | string | 是 | 来自 `experiment-ready` 的实验批次号 |
| sub_experiment_code | string | 轴向任务是 | MES 下发的分段实验编号，原样带回 |
| axis_code | string | 轴向任务是 | 本次完成的轴向；非轴向任务不传 |
| next_axis_code | string | 否 | MES 结束请求中存在下一轴向时原样带回；最终轴向不传 |
| end_mode | string | 取消时是 | 确认取消霉菌实验时原样返回 `cancel`；正常完成省略 |
| cancel_request_id | string | 取消时是 | 确认取消霉菌实验时原样返回 MES 下发的标识 |
| ended_at | string | 是 | 实验结束时间，北京时间 |

霉菌取消确认示例：

```json
{
  "lab_code": "LAB_MOLD",
  "run_no": "run-20260607193000123456",
  "end_mode": "cancel",
  "cancel_request_id": "cancel-0123456789abcdef",
  "ended_at": "2026-06-01 11:30:00"
}
```

同一 `run_no` 可以包含多个轴向结束事件。上位机应按 `run_no + sub_experiment_code + axis_code` 保证轴向结束事件幂等，不能在首个轴向结束后屏蔽该运行批次的后续轴向。

霉菌取消确认必须同时匹配 `run_no + end_mode + cancel_request_id`。MES 在收到匹配确认前不会释放运行批次、托盘或排程；缺少取消标识的普通 `experiment-ended` 仍按正常实验完成处理。

### 5.4 实验结果接收

Topic：

```text
mes/v1/labs/{lab_code}/events/experiment-result
```

Payload：

```json
{
  "lab_code": "LAB_IMPACT_1",
  "run_no": "run-20260607193000123456",
  "result_at": "2026-06-01 11:31:00",
  "result_package": {
    "conclusion": "PASS",
    "summary": "实验结果正常",
    "files": []
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| lab_code | string | 是 | 试验间编号 |
| run_no | string | 是 | 来自 `experiment-ready` 的实验批次号 |
| result_at | string | 是 | 结果生成或发送时间，北京时间 |
| result_package | object | 是 | 结果包 |

`result_package` 内部字段可按上位机实际结果内容扩展，MES 按 JSON 对象整体保存。

## 6. MES 内部反绑定规则

上位机只需要告诉 MES 哪个试验间发生了什么事件，并在实验开始后的事件中原样带回 MES 下发的 `run_no`。MES 根据 `run_no` 精确绑定实验批次，根据 `lab_code` 反查当前试验间对应的任务、实验和托盘上下文。

匹配规则：

```text
fixture-ready:
根据 lab_code 找到当前试验间处于工装夹具安装状态的唯一任务/实验上下文，记录 fixture_ready_at。

experiment-started:
首次启动时使用 payload.run_no 创建并启动对应实验批次。轴向接续时使用 payload.run_no + payload.current_axis_code 精确恢复原批次的目标轴向，只把该轴向从“等待上位机启动”更新为“实验进行中”，不会重建批次或重新激活已完成轴向。

experiment-ended:
根据 payload.run_no 精确找到实验批次。轴向任务按 payload.axis_code 完成当前轴向，最后一个轴向完成后再将实验置为实验已完成；非轴向任务直接完成实验。如未携带 run_no，则仅兼容旧协议按 lab_code 找正在运行批次。

experiment-result:
根据 payload.run_no 精确找到实验批次并绑定 result_package。未携带 run_no 的旧结果包只作为历史兼容处理，可能触发旧兜底风险日志。
```

约束：

```text
同一个试验间同一时刻只能有一个由上位机控制的活动实验批次。
如果存在多个可匹配批次，MES 不更新状态，并记录异常。
如果找不到可匹配批次，MES 不更新状态，并记录异常。
```

MES 内部维护 `run_no`，并通过 `experiment-ready` 下发给上位机。上位机必须缓存该值并在开始、结束、结果事件中原样回传，避免同一试验间多批次或延迟结果包被错误绑定。

## 7. 涉及数据库表

测试和排查时，主要查询以下表。

### 7.1 试验间主数据

```text
md_lab
```

用途：

```text
保存试验间主数据。
lab_code 来自该表。
```

常用字段：

```text
lab_id
lab_code
lab_name
lab_type
test_type_id
status
```

### 7.2 任务表

```text
biz_task
```

用途：

```text
保存任务基本信息。
task_code 对应 biz_task.task_no。
```

常用字段：

```text
task_no
task_name
sample_count
sample_type
task_status
transfer_status
created_at
```

### 7.3 实验表

```text
biz_experiment
```

用途：

```text
保存任务下需要执行的实验项目。
```

常用字段：

```text
experiment_no
task_no
experiment_name
required_device
experiment_status
```

### 7.4 实验批次表

```text
biz_experiment_run
```

用途：

```text
保存一次实际实验运行批次。
MES 根据 lab_code 反绑定后，会更新该表的 started_at、ended_at、run_status。
```

常用字段：

```text
run_no
schedule_no
task_no
experiment_no
device_name
run_status
started_at
planned_end_at
ended_at
```

### 7.5 实验批次托盘表

```text
biz_experiment_run_tray
```

用途：

```text
保存某个实验批次实际包含哪些托盘。
用于判断本次实验涉及哪些托盘，以及是否还存在第二批次待实验托盘。
```

常用字段：

```text
run_no
task_no
experiment_no
tray_no
run_tray_status
started_at
ended_at
```

### 7.6 MQ 消息日志表

```text
biz_mq_message_log
```

用途：

```text
记录 MES 与上位机之间的消息日志。
用于排查上位机是否发送、MES 是否收到、处理是否失败。
```

常用字段：

```text
message_log_id
direction
topic
message_type
lab_code
task_no
experiment_no
payload_json
process_status
error_code
error_message
received_at
processed_at
```

### 7.7 实验事件表

```text
biz_experiment_event
```

用途：

```text
记录上位机回传的夹具完成、实验开始、实验结束等事件。
```

常用字段：

```text
event_type
task_no
experiment_no
lab_code
success_id
event_time
message_id
message_log_id
payload_json
```

### 7.8 实验结果表

```text
biz_experiment_result
```

用途：

```text
保存上位机回传的实验结果包。
```

常用字段：

```text
task_no
experiment_no
lab_code
result_time
conclusion
summary
result_payload_json
message_log_id
status
```

## 8. Topic 汇总

| 方向 | 场景 | Topic |
| --- | --- | --- |
| MES -> 上位机 | 安装夹具 | mes/v1/labs/{lab_code}/commands/fixture-install |
| MES -> 上位机 | 准备就绪 | mes/v1/labs/{lab_code}/commands/experiment-ready |
| 上位机 -> MES | 夹具安装完成 | mes/v1/labs/{lab_code}/events/fixture-ready |
| 上位机 -> MES | 实验开始 | mes/v1/labs/{lab_code}/events/experiment-started |
| 上位机 -> MES | 实验结束 | mes/v1/labs/{lab_code}/events/experiment-ended |
| 上位机 -> MES | 实验结果 | mes/v1/labs/{lab_code}/events/experiment-result |
