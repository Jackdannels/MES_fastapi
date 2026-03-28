# 旧完成任务清理与 SYLU 编号统一 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除所有旧编号且已完成的历史任务及其关联数据，并将剩余旧编号任务统一迁移到 `SYLU-YYYY-MM-NNN` 编号体系。

**Architecture:** 以存储层迁移为唯一事实来源，先删除旧完成任务，再统一迁移剩余旧编号任务，并把结果回写到快照和 MySQL。前端不单独做编号修补，只消费迁移后的后端数据。

**Tech Stack:** FastAPI, Vue 3, Vitest, Pytest, MySQL

---

## Chunk 1: 删除旧完成任务

### Task 1: 为旧完成任务删除写失败测试

**Files:**
- Modify: `tests/core/test_storage_backend.py`
- Modify: `tests/core/test_mysql_storage_backend.py`

- [ ] **Step 1: 写失败测试**

覆盖：
- 非 `SYLU` 且状态为 `实验已完成 / 实验已经完成` 的任务会被删除
- 删除后关联 `samples / schedules / streams / experiments / experiment_trays / experiment_samples` 一并消失

- [ ] **Step 2: 运行以下命令确认失败**

Run:
`python -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -q`

- [ ] **Step 3: 实现存储层删除逻辑**

**Files:**
- Modify: `app/core/storage_backend.py`
- Modify: `app/core/mysql_storage_backend.py`

要求：
- 统一识别旧编号完成任务
- 清理所有关联数据

- [ ] **Step 4: 重新运行测试确认通过**

Run:
`python -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -q`

## Chunk 2: 迁移剩余旧编号任务到 SYLU

### Task 2: 为剩余旧任务迁移写失败测试

**Files:**
- Modify: `tests/core/test_storage_backend.py`
- Modify: `tests/core/test_mysql_storage_backend.py`

- [ ] **Step 1: 写失败测试**

覆盖：
- 删除完成任务后，剩余旧编号任务都会迁成 `SYLU-YYYY-MM-NNN`
- 任务、样品、托盘、实验、实验托盘、实验样品、排程、数据流都改写为同一主线编号

- [ ] **Step 2: 运行以下命令确认失败**

Run:
`python -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -q`

- [ ] **Step 3: 实现迁移逻辑**

**Files:**
- Modify: `app/core/storage_backend.py`
- Modify: `app/core/mysql_storage_backend.py`

要求：
- 迁移仅作用于未删除的旧任务
- 统一改写全部关联编号

- [ ] **Step 4: 重新运行测试确认通过**

Run:
`python -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -q`

## Chunk 3: 接口与页面只消费新编号

### Task 3: 为任务接口和接驳区接口写回归测试

**Files:**
- Modify: `tests/api/test_tasks.py`
- Modify: `tests/api/test_transfer_area.py`

- [ ] **Step 1: 写失败测试**

覆盖：
- `/api/tasks` 不再返回旧完成任务
- 返回任务编号只包含 `SYLU-...`
- 接驳区接口不再暴露已删除旧任务

- [ ] **Step 2: 运行以下命令确认失败**

Run:
`python -m pytest tests/api/test_tasks.py tests/api/test_transfer_area.py -q`

- [ ] **Step 3: 如有必要，补后端接口层清理或过滤**

**Files:**
- Modify: `app/api/routes/tasks.py`
- Modify: `app/api/routes/transfer_area.py`

- [ ] **Step 4: 重新运行测试确认通过**

Run:
`python -m pytest tests/api/test_tasks.py tests/api/test_transfer_area.py -q`

## Chunk 4: 前端回归

### Task 4: 前端页面验证不再出现旧编号

**Files:**
- Modify: `frontend/src/modules/tasks/page.runtime.test.js`
- Modify: `frontend/src/modules/task-overview/*.test.js`
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: 写失败测试**

覆盖：
- 任务受理页不再显示旧前缀任务号
- 任务总览不再显示旧前缀任务号
- 排程页不再显示旧前缀任务号
- 接驳区不再显示旧前缀任务号

- [ ] **Step 2: 运行以下命令确认失败**

Run:
`npm --prefix frontend run test:run -- src/modules/tasks/page.runtime.test.js src/modules/task-overview/model.test.js src/modules/task-overview/TaskOverviewSummaryTable.test.js src/modules/schedule/page.runtime.test.js src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 3: 若前端仍保留旧编号兼容显示，按最小改动收口**

- [ ] **Step 4: 重新运行测试确认通过**

## Chunk 5: 全量验证

### Task 5: 跑后端回归

**Files:**
- Verify only

- [ ] **Step 1: 运行后端核心回归**

Run:
`python -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py tests/api/test_tasks.py tests/api/test_transfer_area.py -q`

- [ ] **Step 2: 记录结果**

### Task 6: 跑前端核心回归

**Files:**
- Verify only

- [ ] **Step 1: 运行前端核心回归**

Run:
`npm --prefix frontend run test:run -- src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js src/modules/task-overview/model.test.js src/modules/task-overview/TaskOverviewSummaryTable.test.js src/modules/task-overview/useTaskOverview.test.js src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 2: 记录结果**

### Task 7: 手动数据核对

**Files:**
- Verify only

- [ ] **Step 1: 启动后端与前端**

Run:
- `python scripts/run_local.py --reload --host 0.0.0.0 --port 8000`
- `npm --prefix frontend run dev -- --host 0.0.0.0`

- [ ] **Step 2: 手动检查**

检查：
- 不再出现旧编号完成任务
- 剩余任务全部为 `SYLU-...`
- 接口与页面显示一致

- [ ] **Step 3: 记录遗留风险**
