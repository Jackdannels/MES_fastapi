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
| 试验间编号 | lab_code | md_lab.lab_code |
| 样品类型 | sample_type | mes.tasks.sample_type |
| 样品数量 | sample_count | mes.tasks.sample_count |
| 成功标识 | success_id | biz_experiment_event.success_id |
| 夹具安装完成时间 | fixture_ready_at | biz_experiment_event.event_time |
| 实验开始时间 | started_at | biz_experiment_run.started_at |
| 实验结束时间 | ended_at | biz_experiment_run.ended_at |
| 结果时间 | result_at | biz_experiment_result.result_time |
| 结果包 | result_package | biz_experiment_result.result_payload_json |

以下字段由 MES 内部根据 `lab_code` 反绑定，不要求上位机回传：

| MES 内部字段 | 说明 |
| --- | --- |
| run_no | 实验批次号，对应 biz_experiment_run.run_no |
| task_code | 当前试验间正在执行的任务号 |
| experiment_code | 当前试验间正在执行的实验编号 |
| tray_codes | 当前实验批次对应托盘列表 |

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
  "sample_type": "金属样品",
  "sample_count": 8
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| task_code | string | 是 | 任务号 |
| lab_code | string | 是 | 试验间编号 |
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
  "lab_code": "LAB_IMPACT_1"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| task_code | string | 是 | 任务号 |
| lab_code | string | 是 | 试验间编号 |

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
  "started_at": "2026-06-01 09:30:00"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| lab_code | string | 是 | 试验间编号 |
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
  "ended_at": "2026-06-01 11:30:00"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| lab_code | string | 是 | 试验间编号 |
| ended_at | string | 是 | 实验结束时间，北京时间 |

### 5.4 实验结果接收

Topic：

```text
mes/v1/labs/{lab_code}/events/experiment-result
```

Payload：

```json
{
  "lab_code": "LAB_IMPACT_1",
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
| result_at | string | 是 | 结果生成或发送时间，北京时间 |
| result_package | object | 是 | 结果包 |

`result_package` 内部字段可按上位机实际结果内容扩展，MES 按 JSON 对象整体保存。

## 6. MES 内部反绑定规则

上位机只需要告诉 MES 哪个试验间发生了什么事件。MES 根据 `lab_code` 反查当前试验间对应的任务、实验、托盘和实验批次。

匹配规则：

```text
fixture-ready:
根据 lab_code 找到当前试验间处于工装夹具安装状态的唯一任务/实验上下文，记录 fixture_ready_at。

experiment-started:
根据 lab_code 找到当前试验间待开始 / 已准备就绪的唯一实验批次，写入 started_at。

experiment-ended:
根据 lab_code 找到当前试验间正在运行的唯一实验批次，写入 ended_at，并将该批次置为实验已完成。

experiment-result:
根据 lab_code 找到当前试验间最近完成且尚未绑定结果的唯一实验批次，绑定 result_package。
```

约束：

```text
同一个试验间同一时刻只能有一个由上位机控制的活动实验批次。
如果存在多个可匹配批次，MES 不更新状态，并记录异常。
如果找不到可匹配批次，MES 不更新状态，并记录异常。
```

MES 内部仍会维护 `run_no`，但 `run_no` 不要求上位机传递。

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
