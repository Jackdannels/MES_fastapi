# MES Single Branch Schema Alignment Design

**Date:** 2026-03-17

**Goal**

在保留现有 `mes_single_branch` 主业务表的前提下，补齐当前前端 `frontend/src/modules` 所需的数据库结构，使任务受理、排程、样品流转、设备配置、试验数据和系统设置具备正式落库能力。

**Current Context**

- 当前前端仍基于 `useStorageSnapshot` 使用 `mes.tasks`、`mes.schedules`、`mes.samples`、`mes.streams` 等本地快照键。
- 当前 MySQL 库已经存在主链路表：`biz_task`、`biz_sample`、`biz_tray`、`biz_tray_item`、`exec_test_run`、`res_report`、`md_equipment`、`sys_role`。
- 实库核对结果表明，当前缺少 6 张业务表和 16 个前端直接使用的字段。

## Scope

本次只处理数据库层：

- 修改种子 schema：`C:\Users\12051\Desktop\mes_single_branch_schema_seed.sql`
- 生成增量补库 SQL，应用到现有 `mes_single_branch`
- 执行后验证表结构

本次不处理：

- FastAPI ORM / CRUD / API 路由
- 前端 `useStorageSnapshot` 到后端接口的迁移
- 旧数据的复杂业务清洗

## Chosen Approach

采用“增量补齐”方案：

- 保留现有主表和主键关系，不重建已有业务骨架
- 通过 `ALTER TABLE` 补前端已使用但当前库缺失的字段
- 通过新增缺失业务表承接当前前端独立状态模型
- 将“排程”和“实际执行”明确分层：
  - `biz_schedule` 表示计划排程
  - `exec_test_run` 继续表示实际执行

这样可以最小化对已建库和现有种子数据的破坏，同时为后续 FastAPI 接入预留稳定结构。

## Required Schema Changes

### 1. Extend Existing Tables

#### `biz_task`

新增字段：

- `client_name`
- `contact_name`
- `contact_phone`
- `arrival_time`
- `due_time`
- `required_device`
- `conditions_text`
- `attachment_path`

用途：

- 对齐任务受理页的客户、联系人、到样、截止、附件、实验条件等字段

#### `biz_sample`

新增字段：

- `batch_no`
- `arrival_time`
- `storage_condition`
- `barcode_no`
- `location_desc`
- `flow_status`

用途：

- 对齐样品登记、流转和追溯页需要的批次、位置、流转状态和条码字段

#### `md_equipment`

新增字段：

- `acquisition_enabled`

用途：

- 对齐设备页的采集启停配置

#### `sys_role`

新增字段：

- `key_permissions`

用途：

- 对齐系统页的关键权限文案

### 2. Add Missing Tables

#### `biz_schedule`

用途：

- 对齐前端 `mes.schedules`
- 支持未来排程、留样暂存排程、时长、冲突检测

核心字段：

- `schedule_id`
- `schedule_no`
- `task_id`
- `task_no`
- `schedule_type`
- `lab_id`
- `lab_name`
- `equipment_id`
- `equipment_code`
- `schedule_start_time`
- `schedule_end_time`
- `planned_hours`
- `schedule_status`
- `is_retention`
- `created_by`
- `remark`
- `created_at`
- `updated_at`

#### `biz_data_stream`

用途：

- 对齐前端 `mes.streams`
- 保存采集链路最后心跳、质量、状态、是否已出报告

核心字段：

- `stream_id`
- `stream_no`
- `task_id`
- `task_no`
- `equipment_id`
- `equipment_code`
- `last_packet_time`
- `quality_value`
- `stream_status`
- `reported_flag`
- `remark`
- `created_at`
- `updated_at`

#### `md_equipment_connection`

用途：

- 保存设备连接配置，如协议、地址、端口、站号、轮询策略

#### `md_equipment_point`

用途：

- 保存设备点位配置，如寄存器地址、倍率、频率、单位、说明

#### `biz_sample_event`

用途：

- 承接前端 `history`
- 作为样品级追溯时间线的正式事件表

核心字段：

- `event_id`
- `sample_id`
- `sample_no`
- `task_id`
- `task_no`
- `action_type`
- `location_desc`
- `owner_name`
- `sample_status`
- `detail`
- `event_time`
- `created_at`

#### `sys_config`

用途：

- 保存系统设置页中的通知方式、留样期限、班次配置等简单键值项

## Naming and Compatibility Rules

- 与现有表风格保持一致：主键使用 `*_id`
- 面向前端兼容保留 `task_no`、`equipment_code`、`lab_name` 这类冗余业务键，减少联表依赖
- 所有新增表默认使用 `utf8mb4`
- 对历史数据采用“允许为空 + 后续逐步回填”的兼容策略

## Verification Strategy

执行前验证：

- 使用 `information_schema` 查询确认缺表和缺字段

执行后验证：

- `SHOW TABLES` 检查新增表是否存在
- `DESC` 检查新增字段是否存在
- 检查索引和外键是否成功建立

## Risks

- `biz_schedule` 与 `exec_test_run` 的职责如果后续接口层处理不清晰，容易出现状态重复维护
- 若后续前端仍长期使用本地存储，数据库与前端状态会继续分叉
- `sys_config` 采用通用键值结构，后续若配置复杂度增加，可能需要拆专表

## Success Criteria

- 当前真实库 `mes_single_branch` 拥有本设计定义的全部新增表和字段
- 更新后的 `mes_single_branch_schema_seed.sql` 可一键重建同样结构
- 结构层面能承接当前前端模块的主要字段，不再因为缺表或缺字段被阻塞
