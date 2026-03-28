# 任务多实验三分支排程与接驳区托盘选择 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将系统从“一个任务默认一个实验”升级为“一个任务固定三个不同实验”，并让排程、任务总览、任务受理、接驳区、数据库持久化全部按同一模型工作。

**Architecture:** 在存储层引入统一实验实体、样品-实验关系和实验-托盘关系；任务仍作为主线编号，实验作为支线排程对象。前端页面统一显示任务编号与实验类型，接驳区继续采用任务级托盘草稿加实验级托盘选择草稿的双层模型。

**Tech Stack:** FastAPI, Vue 3, Vite, Vitest, Pytest, MySQL

---

## Chunk 1: 存储模型与数据库统一

### Task 1: 为默认存储与迁移补齐三实验模型

**Files:**
- Modify: `app/core/storage_backend.py`
- Modify: `app/data/mes_store.json`
- Test: `tests/core/test_storage_backend.py`

- [ ] **Step 1: 写失败测试，断言每个任务至少有三个不同实验**

- [ ] **Step 2: 运行 `pytest tests/core/test_storage_backend.py -q`，确认新增断言先失败**

- [ ] **Step 3: 在 `storage_backend.py` 中补齐默认快照与规范化逻辑**

实现要点：
- 新增或统一 `mes.experiments`
- 新增或统一 `mes.experiment_trays`
- 历史任务少于三个实验时自动补齐
- 三个实验类型互不重复

- [ ] **Step 4: 更新 `mes_store.json` 示例数据，确保任务样例符合三实验口径**

- [ ] **Step 5: 重新运行 `pytest tests/core/test_storage_backend.py -q`，确认通过**

### Task 2: 扩展 MySQL 映射到三实验与样品-实验关系

**Files:**
- Modify: `app/core/mysql_storage_backend.py`
- Test: `tests/core/test_mysql_storage_backend.py`

- [ ] **Step 1: 写失败测试，覆盖以下行为**

测试目标：
- `biz_experiment` 三实验回读
- `biz_experiment_sample` 样品多实验回读
- `biz_experiment_tray` 关联回读
- `biz_schedule.experiment_no` 保留

- [ ] **Step 2: 运行 `pytest tests/core/test_mysql_storage_backend.py -q`，确认失败**

- [ ] **Step 3: 在 `mysql_storage_backend.py` 中补齐表结构 bootstrap 与读写映射**

实现要点：
- 自动创建或补齐 `biz_experiment`
- 自动创建或补齐 `biz_experiment_sample`
- 自动创建或补齐 `biz_experiment_tray`
- 读写 `biz_schedule.experiment_no`

- [ ] **Step 4: 重新运行 `pytest tests/core/test_mysql_storage_backend.py -q`，确认通过**

## Chunk 2: 后端接口升级

### Task 3: 让任务接口返回三实验与样品实验关系

**Files:**
- Modify: `app/api/routes/tasks.py`
- Test: `tests/api/test_tasks.py`

- [ ] **Step 1: 写失败测试，断言任务读取时会带出三个实验摘要**

- [ ] **Step 2: 运行 `pytest tests/api/test_tasks.py -q`，确认失败**

- [ ] **Step 3: 修改 `tasks.py` 的读取、保存、删除逻辑**

实现要点：
- 任务创建时默认生成三个不同实验
- 任务更新时保留实验集合的一致性
- 删除任务时清理 `experiments / experiment_samples / experiment_trays`

- [ ] **Step 4: 重新运行 `pytest tests/api/test_tasks.py -q`，确认通过**

### Task 4: 扩展接驳区接口为任务托盘 + 实验托盘双草稿模型

**Files:**
- Modify: `app/api/routes/transfer_area.py`
- Test: `tests/api/test_transfer_area.py`

- [ ] **Step 1: 写失败测试，覆盖以下行为**

测试目标：
- workspace 返回三个实验类型
- 保存托盘不会清空实验分配
- 重新入库会清空实验分配
- 实验态只使用现有托盘，不改托盘布局

- [ ] **Step 2: 运行 `pytest tests/api/test_transfer_area.py -q`，确认失败**

- [ ] **Step 3: 修改 `transfer_area.py` 的 bootstrap / workspace / allocate / reload / print 逻辑**

实现要点：
- 返回任务级托盘布局
- 返回实验托盘选择集合
- `allocate` 同时保存 tray draft 与 experiment tray draft
- `reload` 清空 experiment tray 与 tray 分配状态
- 打印响应附带实验标签名称

- [ ] **Step 4: 重新运行 `pytest tests/api/test_transfer_area.py -q`，确认通过**

## Chunk 3: 前端任务入口统一为三实验

### Task 5: 任务受理与任务总览显示三实验摘要

**Files:**
- Modify: `frontend/src/modules/tasks/model.js`
- Modify: `frontend/src/modules/tasks/useTasksPage.js`
- Modify: `frontend/src/modules/tasks/page.vue`
- Modify: `frontend/src/modules/task-overview/model.js`
- Modify: `frontend/src/modules/task-overview/useTaskOverview.js`
- Modify: `frontend/src/modules/task-overview/TaskOverviewSummaryTable.vue`
- Test: `frontend/src/modules/tasks/model.test.js`
- Test: `frontend/src/modules/tasks/page.runtime.test.js`
- Test: `frontend/src/modules/task-overview/model.test.js`
- Test: `frontend/src/modules/task-overview/TaskOverviewSummaryTable.test.js`

- [ ] **Step 1: 写失败测试，断言任务列表与任务总览都显示三个实验类型摘要**

- [ ] **Step 2: 运行对应 Vitest 文件，确认失败**

运行：
`npm --prefix frontend run test:run -- src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js src/modules/task-overview/model.test.js src/modules/task-overview/TaskOverviewSummaryTable.test.js`

- [ ] **Step 3: 修改任务页与总览模型/页面**

实现要点：
- 从 `mes.experiments` 读取实验摘要
- 不再依赖单一 `test_type`
- `experimentCount` 固定按真实实验数量显示

- [ ] **Step 4: 重新运行同一组 Vitest，确认通过**

### Task 6: 任务编辑默认生成三个不同实验

**Files:**
- Modify: `frontend/src/modules/task-overview/useTaskOverviewEditor.js`
- Modify: `frontend/src/modules/task-overview/TaskOverviewEditorPanel.vue`
- Test: `frontend/src/modules/task-overview/useTaskOverviewEditor.test.js`
- Test: `frontend/src/modules/task-overview/TaskOverviewEditorPanel.test.js`

- [ ] **Step 1: 写失败测试，断言新建任务默认带三个不同实验**

- [ ] **Step 2: 运行对应 Vitest，确认失败**

- [ ] **Step 3: 修改编辑器默认值与保存流程**

实现要点：
- 从类型池生成三个不同实验
- 编辑时保留已存在实验并补齐到三个
- 页面显示实验类型，不把任务类型误当实验

- [ ] **Step 4: 重新运行对应 Vitest，确认通过**

## Chunk 4: 排程升级为任务主线 + 实验支线

### Task 7: 排程模型改为按实验排，但主显示保留任务编号

**Files:**
- Modify: `frontend/src/modules/schedule/model.js`
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Modify: `frontend/src/modules/schedule/page.vue`
- Test: `frontend/src/modules/schedule/model.test.js`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: 写失败测试，覆盖以下行为**

测试目标：
- 同一任务显示三个实验选项
- 下拉显示实验类型，不显示内部编号
- 排程写入保留 `experiment_code`
- 列表主显示任务编号

- [ ] **Step 2: 运行 `npm --prefix frontend run test:run -- src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js`，确认失败**

- [ ] **Step 3: 修改排程模型、表单和列表渲染**

实现要点：
- 构建 experiment-aware rows
- 保留任务编号为主要显示字段
- 实验下拉正文展示实验类型

- [ ] **Step 4: 重新运行同一组 Vitest，确认通过**

## Chunk 5: 接驳区任务托盘与实验托盘选择

### Task 8: 接驳区默认任务模式 + 点击实验类型切换

**Files:**
- Modify: `frontend/src/modules/handover-system/page.vue`
- Modify: `frontend/src/modules/handover-system/styles.css`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: 写失败测试，覆盖以下行为**

测试目标：
- 默认进入任务托盘模式
- 顶部显示任务编号和三个实验类型
- 点击实验类型进入实验选择模式
- 实验模式只允许选托盘，不允许改托盘结构
- 保存托盘后保留实验分配
- 重新入库清空实验分配

- [ ] **Step 2: 运行 `npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js`，确认失败**

- [ ] **Step 3: 修改接驳区页面状态机与交互**

实现要点：
- 默认任务态
- 实验类型切换
- 任务草稿与实验草稿共存
- 标签显示实验类型简称

- [ ] **Step 4: 重新运行同一组 Vitest，确认通过**

### Task 9: 打印与条码标签显示实验类型

**Files:**
- Modify: `frontend/src/modules/handover-system/page.vue`
- Modify: `frontend/src/modules/handover-system/barcode.js`
- Test: `frontend/src/modules/handover-system/barcode.test.js`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: 写失败测试，断言打印预览显示实验类型标签且条码值仍为托盘编号**

- [ ] **Step 2: 运行 `npm --prefix frontend run test:run -- src/modules/handover-system/barcode.test.js src/modules/handover-system/page.runtime.test.js`，确认失败**

- [ ] **Step 3: 修改打印展示与条码数据**

实现要点：
- 条码内容只编码托盘编号
- 打印区域附带实验类型标签
- 不把实验标签混入条码值

- [ ] **Step 4: 重新运行同一组 Vitest，确认通过**

## Chunk 6: 联调与回归

### Task 10: 跑后端多实验主链路回归

**Files:**
- Verify only

- [ ] **Step 1: 运行后端核心回归**

运行：
`python -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py tests/api/test_tasks.py tests/api/test_transfer_area.py -q`

- [ ] **Step 2: 若失败，逐项修正后再次运行直到通过**

### Task 11: 跑前端多实验主链路回归

**Files:**
- Verify only

- [ ] **Step 1: 运行前端核心回归**

运行：
`npm --prefix frontend run test:run -- src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js src/modules/task-overview/model.test.js src/modules/task-overview/TaskOverviewSummaryTable.test.js src/modules/task-overview/useTaskOverviewEditor.test.js src/modules/task-overview/TaskOverviewEditorPanel.test.js src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js src/modules/handover-system/barcode.test.js src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 2: 若失败，逐项修正后再次运行直到通过**

### Task 12: 手动冒烟验证

**Files:**
- Verify only

- [ ] **Step 1: 启动后端与前端**

运行：
- `python scripts/run_local.py --reload --host 0.0.0.0 --port 8000`
- `npm --prefix frontend run dev -- --host 0.0.0.0`

- [ ] **Step 2: 手动验证**

检查：
- 新建或读取任务时能看到三个实验
- 任务受理与任务总览实验摘要一致
- 排程页能分别给三个实验排程
- 接驳区默认任务模式可分托盘
- 点击实验类型后只选托盘不改布局
- 保存托盘后实验分配保留
- 点击重新入库后实验分配清空

- [ ] **Step 3: 记录剩余风险或兼容性问题**
