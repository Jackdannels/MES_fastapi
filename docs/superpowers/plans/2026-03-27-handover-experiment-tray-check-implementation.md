# Handover Experiment Tray Check Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在接驳区详情页支持“任务编号下方多实验切换 + 托盘打勾 + 多色标签 + 样品随托盘自动挂多个实验”。

**Architecture:** 保持任务级托盘布局和实验级托盘选择的双层模型不变，在 `transfer_area` 接口中补齐样品实验归属的持久化与回读；前端仅增强实验切换、勾选和多色标签渲染，不改变托盘布局算法。

**Tech Stack:** FastAPI, Vue 3, Vitest, Pytest

---

## Chunk 1: 固定后端多实验托盘与样品归属规则

### Task 1: 为任务接口补齐样品多实验关系存储键

**Files:**
- Modify: `app/core/storage_backend.py`
- Modify: `frontend/src/lib/storageKeys.js`
- Test: `tests/core/test_storage_backend.py`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 默认存储包含 `mes.experiment_samples`
- 读写会保留该集合

- [ ] **Step 2: 运行失败测试**

Run: `python -m pytest tests/core/test_storage_backend.py -q`
Expected: FAIL，因为当前默认存储和前端存储键都还没有 `mes.experiment_samples`。

- [ ] **Step 3: 做最小实现**

实现要点：
- 存储默认键补齐 `mes.experiment_samples`
- 规范化/读写链路保留该集合
- 前端 `STORAGE_KEYS` 补齐 `experiment_samples`

- [ ] **Step 4: 重新运行测试确认通过**

Run: `python -m pytest tests/core/test_storage_backend.py -q`
Expected: PASS

### Task 2: 为接驳区 allocate / reload 固定样品随托盘挂实验的行为

**Files:**
- Modify: `app/api/routes/transfer_area.py`
- Test: `tests/api/test_transfer_area.py`

- [ ] **Step 1: 写失败测试**

覆盖点：
- allocate 保存 `experiment_trays` 后，同时写出 `experiment_samples`
- 某托盘被多个实验勾选时，托盘内样品会同时挂多个实验
- reload 会清空 `experiment_trays` 和 `experiment_samples`
- workspace 返回的样品读模型含 `experimentCodes`

- [ ] **Step 2: 运行失败测试**

Run: `python -m pytest tests/api/test_transfer_area.py -q`
Expected: FAIL，因为当前后端只保存 `experiment_trays`，没有样品多实验回写。

- [ ] **Step 3: 做最小实现**

实现要点：
- snapshot 读写纳入 `mes.experiment_samples`
- 根据 `request.experiment_trays` 和托盘内样品反推 `experiment_samples`
- `serialize_sample` / `serialize_workspace` 返回样品实验编号集合
- reload 清空 `experiment_samples`

- [ ] **Step 4: 重新运行测试确认通过**

Run: `python -m pytest tests/api/test_transfer_area.py -q`
Expected: PASS

## Chunk 2: 固定任务编辑保存时的样品实验汇总

### Task 3: 任务编辑保存时同步样品实验集合

**Files:**
- Modify: `frontend/src/modules/task-overview/useTaskOverviewEditor.js`
- Modify: `app/api/routes/tasks.py`
- Test: `frontend/src/modules/task-overview/useTaskOverviewEditor.test.js`
- Test: `tests/api/test_tasks.py`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 任务编辑保存会保留/刷新 `experiment_samples`
- 删除任务时会级联删除 `experiment_samples`

- [ ] **Step 2: 运行失败测试**

Run: `npm --prefix frontend run test:run -- src/modules/task-overview/useTaskOverviewEditor.test.js`
Run: `python -m pytest tests/api/test_tasks.py -q`
Expected: FAIL，因为当前只清理/写入 experiments 和 experiment_trays。

- [ ] **Step 3: 做最小实现**

实现要点：
- 前端编辑器快照保存带上 `experiment_samples`
- 后端 tasks 路由继续保留 `experiment_samples` 级联删除

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm --prefix frontend run test:run -- src/modules/task-overview/useTaskOverviewEditor.test.js`
Run: `python -m pytest tests/api/test_tasks.py -q`
Expected: PASS

## Chunk 3: 接驳区页面交互与多色标签

### Task 4: 固定实验按钮位于任务编号下方的交互

**Files:**
- Modify: `frontend/src/modules/handover-system/page.vue`
- Modify: `frontend/src/modules/handover-system/styles.css`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 任务编号下方显示多个实验按钮
- 点击实验进入托盘勾选态
- 勾选态只允许托盘打勾，不允许改布局
- 切换实验不改变托盘布局

- [ ] **Step 2: 运行失败测试**

Run: `npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js`
Expected: FAIL，如果当前行为与新规则不完全一致。

- [ ] **Step 3: 做最小实现**

实现要点：
- 保持头部两层结构
- 保持实验态锁定布局编辑
- 保持切换实验只改当前勾选上下文

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js`
Expected: PASS

### Task 5: 为托盘标签补齐稳定色板和多实验即时渲染

**Files:**
- Modify: `frontend/src/modules/handover-system/page.vue`
- Modify: `frontend/src/modules/handover-system/styles.css`
- Modify: `frontend/src/modules/handover-system/barcode.js`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`
- Test: `frontend/src/modules/handover-system/barcode.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 勾选某实验后立即产生标签
- 同一托盘可渲染多个不同颜色标签
- 打印预览带出实验标签，但条码值仍只编码托盘号

- [ ] **Step 2: 运行失败测试**

Run: `npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js src/modules/handover-system/barcode.test.js`
Expected: FAIL，因为当前标签和打印数据未完全覆盖样品多实验回读。

- [ ] **Step 3: 做最小实现**

实现要点：
- 根据实验编号生成稳定 tone
- 标签即时跟随勾选变化
- 打印预览读取托盘标签，不混入条码内容

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js src/modules/handover-system/barcode.test.js`
Expected: PASS

## Chunk 4: 回归验证

### Task 6: 跑后端回归

**Files:**
- Verify only

- [ ] **Step 1: 运行后端测试**

Run: `python -m pytest tests/core/test_storage_backend.py tests/api/test_tasks.py tests/api/test_transfer_area.py -q`
Expected: PASS

### Task 7: 跑前端回归

**Files:**
- Verify only

- [ ] **Step 1: 运行前端测试**

Run: `npm --prefix frontend run test:run -- src/modules/task-overview/useTaskOverviewEditor.test.js src/modules/handover-system/page.runtime.test.js src/modules/handover-system/barcode.test.js`
Expected: PASS

### Task 8: 记录风险

**Files:**
- Verify only

- [ ] **Step 1: 检查仍需关注的兼容性**

关注点：
- 历史样品没有 `experiment_codes` 时的兼容回读
- 任务托盘重排后旧的实验托盘关系是否需要完全重算
- 打印预览在多标签场景下的拥挤度
