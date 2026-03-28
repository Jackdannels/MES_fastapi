# 旧完成任务清理与 SYLU 编号统一设计

## 背景

当前数据中仍混有两类历史遗留：

1. 旧前缀任务编号，例如 `CJ-...`、`GDW-...`、`MJ-...`、`SZH-...`、`WDC-...`、`ZD-...`、`YW-...`
2. 已经完成的旧编号任务仍保留在数据库和快照中

这会带来两个问题：

- 页面和接口仍可能读到旧编号任务，与“统一使用 `SYLU-YYYY-MM-NNN`”的目标冲突
- 已完成旧任务继续占用样品、托盘、实验、排程、数据流等关联记录，污染当前运行数据

## 目标

本轮目标如下：

1. 彻底物理删除所有“旧编号且任务状态为完成”的任务及其关联数据
2. 将剩余所有非 `SYLU-...` 的任务统一迁移为 `SYLU-YYYY-MM-NNN`
3. 保证任务、样品、托盘、实验、排程、数据流在迁移后引用同一主线编号
4. 前端页面与后端接口不再出现旧编号任务

## 删除范围

删除判定规则：

- 任务编号不是 `SYLU-...`
- 且任务状态为：
  - `实验已完成`
  - `实验已经完成`

满足以上条件的任务，整条任务及全部关联数据都要物理删除。

## 关联数据范围

删除时需要一并清理以下记录：

### 任务主记录

- `mes.tasks`
- `biz_task`

### 样品与托盘

- `mes.samples`
- 样品内部 `trays`
- 任务上的 `tray_codes`
- `biz_sample`
- `biz_tray`
- `biz_tray_item`
- `biz_sample_event`

### 排程与数据流

- `mes.schedules`
- `mes.streams`
- `biz_schedule`
- `biz_data_stream`

### 多实验关系

- `mes.experiments`
- `mes.experiment_trays`
- `mes.experiment_samples`
- `biz_experiment`
- `biz_experiment_tray`
- `biz_experiment_sample`

原则是：
只要记录通过 `task_code / task_no` 或派生编号引用该旧任务，就必须一并删除，不保留孤儿记录。

## 迁移范围

在完成删除后，对剩余所有非 `SYLU-...` 任务统一迁移编号。

### 任务编号

统一格式：

- `SYLU-YYYY-MM-NNN`

其中：

- `YYYY` 为年份
- `MM` 为月份
- `NNN` 为当月任务递增序号

### 关联编号同步改写

迁移任务编号时，必须同步改写以下关联字段：

- `mes.tasks.code`
- `mes.tasks.experiment_codes`
- `mes.samples.task_code`
- `mes.samples.code`
- `mes.samples.trays[].tray_code`
- `mes.samples.trays[].sample_code`
- `mes.experiments.task_code`
- `mes.experiments.experiment_code`
- `mes.experiment_trays.task_code`
- `mes.experiment_trays.experiment_code`
- `mes.experiment_trays.tray_code`
- `mes.experiment_samples.task_code`
- `mes.experiment_samples.experiment_code`
- `mes.experiment_samples.sample_code`
- `mes.schedules.task_code`
- `mes.schedules.experiment_code`
- `mes.streams.task_code`

MySQL 对应列也必须同步改写：

- `biz_task.task_no`
- `biz_sample.task_no / sample_no`
- `biz_tray.task_no / tray_no`
- `biz_tray_item.sample_no / tray_no`
- `biz_experiment.task_no / experiment_no`
- `biz_experiment_tray.task_no / experiment_no / tray_no`
- `biz_experiment_sample.task_no / experiment_no / sample_no`
- `biz_schedule.task_no / experiment_no`
- `biz_data_stream.task_no`

## 执行顺序

推荐顺序：

1. 先扫描并删除旧编号且已完成的任务
2. 再对剩余旧编号任务执行统一迁移
3. 将迁移结果回写到数据库与当前快照
4. 页面和接口读取时只消费迁移后的任务号

这样可以避免把本来就要删除的旧完成任务先迁成 `SYLU`，减少脏数据。

## 接口与页面要求

### 后端

- `/api/tasks`
- `/api/storage`
- 接驳区相关接口
- 排程相关接口

都不应再返回已删除的旧完成任务。

### 前端

以下页面不应再出现旧前缀任务号：

- 任务受理
- 任务总览
- 排程页
- 接驳区
- 样品流程相关页
- 暂存间系统相关总览

## 测试要求

### 数据清理

1. 旧编号且完成状态的任务会被彻底删除
2. 对应样品、托盘、实验、排程、数据流都被删除

### 迁移

1. 剩余旧任务全部迁移为 `SYLU-...`
2. 样品、托盘、实验、排程、数据流全部引用迁移后的新任务号

### 页面回归

1. 前端页面中不再出现旧前缀任务号
2. 删除后的旧完成任务不会再显示

## 成功标准

1. 数据库和当前快照中不再保留旧编号完成任务
2. 运行数据中不再出现旧前缀任务号
3. 剩余任务、样品、托盘、实验、排程、数据流全部统一为 `SYLU` 主线编号
