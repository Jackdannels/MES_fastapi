# Schedule Task Overlap Conflict Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在排程页为多实验任务增加“当前任务已排程”甘特辅助展示，并在提交前按托盘交集弹出 `部分冲突` / `完全冲突` 确认框。

**Architecture:** 保持现有排程表单和持久化链路不变，在 `schedule/model.js` 中补齐任务内辅助占用块和托盘冲突分析；`useSchedulePage.js` 负责在提交前中断并等待用户确认；`page.vue` 和 `styles.css` 只负责渲染辅助块与两类确认弹窗。

**Tech Stack:** Vue 3, Vitest

---

## Chunk 1: 固定排程模型的任务内辅助占用块与冲突判定

### Task 1: 为视图模型补齐当前任务已排程辅助块

**Files:**
- Modify: `frontend/src/modules/schedule/model.js`
- Test: `frontend/src/modules/schedule/model.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 选择某任务和实验后，`buildGanttRows` 或新增辅助函数会返回该任务其他正式实验的辅助占用块
- 辅助占用块带实验名称、实验室、托盘摘要和时间信息
- 暂存间排程不进入辅助块结果

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/model.test.js`
Expected: FAIL，因为当前模型只构建实验室甘特块，没有任务内辅助占用块。

- [ ] **Step 3: 做最小实现**

实现要点：
- 在 `model.js` 中新增任务内排程筛选与格式化函数
- 只纳入同一任务、不同实验、非暂存间设备的正式排程
- 输出给甘特图消费的结构化 overlay 数据

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/model.test.js`
Expected: PASS

### Task 2: 为排程模型补齐部分冲突与完全冲突判定

**Files:**
- Modify: `frontend/src/modules/schedule/model.js`
- Test: `frontend/src/modules/schedule/model.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 时间重叠且托盘交集为部分时，返回 `partial`
- 时间重叠且托盘交集覆盖本次全部托盘时，返回 `full`
- 时间不重叠或无托盘交集时，不返回冲突结果
- 缺少托盘明细的历史排程不触发托盘级弹窗

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/model.test.js`
Expected: FAIL，因为当前 `createScheduleRecord` 前没有托盘级冲突分析。

- [ ] **Step 3: 做最小实现**

实现要点：
- 新增纯函数分析：
  - 待提交排程的起止时间
  - 当前实验选中托盘
  - 同任务其他实验已排程托盘
- 输出统一的 `pendingConflict` 结构：
  - `level`
  - `conflictTrayNos`
  - `conflictSchedules`
  - `overlapRange`

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/model.test.js`
Expected: PASS

## Chunk 2: 固定提交前确认状态机

### Task 3: 在排程提交前接入冲突确认流程

**Files:**
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Test: `frontend/src/modules/schedule/useSchedulePage.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 无冲突时，`submitSchedule` 直接沿用现有提交流程
- `partial` / `full` 冲突时，先打开确认弹窗，不立即持久化
- 点击 `取消排程` 不写入排程
- 点击 `确认排程` 后继续走原持久化逻辑

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/useSchedulePage.test.js`
Expected: FAIL，因为当前 `submitSchedule` 只要校验通过就直接写入。

- [ ] **Step 3: 做最小实现**

实现要点：
- 新增确认弹窗状态：
  - 是否打开
  - 当前冲突级别
  - 当前冲突详情
  - 待确认提交 payload
- `submitSchedule` 改成两段式：
  - 先分析冲突
  - 有冲突则挂起提交并等待确认
- 新增：
  - `confirmScheduleConflict`
  - `cancelScheduleConflict`

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/useSchedulePage.test.js`
Expected: PASS

## Chunk 3: 渲染甘特辅助块与两类冲突弹窗

### Task 4: 在甘特图区叠加当前任务已排程辅助块

**Files:**
- Modify: `frontend/src/modules/schedule/page.vue`
- Modify: `frontend/src/modules/schedule/styles.css`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 选择任务和实验后，甘特图区出现“当前任务已排程”辅助信息
- 辅助块或辅助标记显示实验名称与托盘摘要
- 现有实验室排程块点击详情能力不回归

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/page.runtime.test.js`
Expected: FAIL，因为当前页面没有任务内辅助块渲染。

- [ ] **Step 3: 做最小实现**

实现要点：
- 在 `page.vue` 的甘特区挂辅助块或辅助列表
- 辅助块视觉明显区别于正常排程块
- 仅在已选 `task_code + experiment_code` 时显示

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/page.runtime.test.js`
Expected: PASS

### Task 5: 新增部分冲突与完全冲突确认弹窗

**Files:**
- Modify: `frontend/src/modules/schedule/page.vue`
- Modify: `frontend/src/modules/schedule/styles.css`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- `partial` 冲突时显示橙色系提示和 `部分冲突提示`
- `full` 冲突时显示红色系提示和 `完全冲突提示`
- 弹窗内展示冲突托盘标签、冲突实验名、时间重叠区间
- `取消排程` 关闭弹窗且不新增排程
- `确认排程` 关闭弹窗并新增排程

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/page.runtime.test.js`
Expected: FAIL，因为当前页面没有该确认弹窗。

- [ ] **Step 3: 做最小实现**

实现要点：
- 用现有模态容器渲染统一确认框
- 根据 `level` 切换标题、说明文案和色板 class
- 冲突托盘按接驳区标签风格渲染

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/page.runtime.test.js`
Expected: PASS

## Chunk 4: 回归验证

### Task 6: 跑排程模块定向回归

**Files:**
- Verify only

- [ ] **Step 1: 运行排程相关测试**

Run: `npm run test:run -- src/modules/schedule/model.test.js src/modules/schedule/useSchedulePage.test.js src/modules/schedule/page.runtime.test.js`
Expected: PASS

### Task 7: 跑受影响的跨模块回归

**Files:**
- Verify only

- [ ] **Step 1: 运行关联模块测试**

Run: `npm run test:run -- src/modules/task-overview/model.test.js src/modules/handover-system/page.runtime.test.js src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
Expected: PASS

### Task 8: 记录残余风险

**Files:**
- Verify only

- [ ] **Step 1: 检查并记录以下兼容性风险**

关注点：
- 历史排程若缺少托盘明细，只能显示任务内已排程辅助信息，无法做托盘级弹窗
- 同一任务跨多实验室密集排程时，甘特辅助块信息量可能偏大，必要时后续再做折叠
- 用户强制确认 `完全冲突` 后，后续执行链路仍需靠实验过程管控和接驳区共同识别实际占用情况
