# Schedule Eligibility Reset And Reschedule Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在排程页限制仅显示已保存托盘方案的任务，并支持同任务连续排程保留任务编号，以及在任务详情中删除后重新排程。

**Architecture:** 继续沿用 `schedule/model.js` 负责排程准入和表单回填所需的纯函数，`useSchedulePage.js` 负责提交成功后的保留任务重置和详情弹窗动作，`page.vue` 只补任务详情按钮和运行时交互，不改现有排程主结构。

**Tech Stack:** Vue 3, Vitest

---

## Chunk 1: 固定排程任务准入与回填辅助函数

### Task 1: 只让已保存托盘方案的任务进入排程任务下拉

**Files:**
- Modify: `frontend/src/modules/schedule/model.js`
- Test: `frontend/src/modules/schedule/model.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 只有 `task.tray_codes` / `sample.trays` / `experiment_trays` 任一存在时，任务才会进入 `buildManualTaskOptions`
- 未保存托盘方案的任务被过滤掉
- `retention` 页签行为不回归

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/model.test.js`
Expected: FAIL，因为当前接驳区排程任务下拉还不检查托盘方案是否已保存。

- [ ] **Step 3: 做最小实现**

实现要点：
- 在 `model.js` 中新增任务托盘保存状态判断
- `buildManualTaskOptions` 在非 `retention` 页签使用该判断过滤任务

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/model.test.js`
Expected: PASS

### Task 2: 为删除后重新排程补齐顶部表单回填函数

**Files:**
- Modify: `frontend/src/modules/schedule/model.js`
- Test: `frontend/src/modules/schedule/model.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 现有排程记录可反向映射为手动排程表单
- 上午/下午固定时段可还原为对应 `time_slot`
- 自定义时段保留 `custom_start`
- `planned_hours` 被正确带回

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/model.test.js`
Expected: FAIL，因为当前只有编辑抽屉表单映射，没有顶部重排表单回填语义。

- [ ] **Step 3: 做最小实现**

实现要点：
- 新增顶栏排程表单回填函数
- 保持字段格式与 `scheduleForm` 完全一致

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/model.test.js`
Expected: PASS

## Chunk 2: 固定成功排程后的保留任务重置与详情动作

### Task 3: 成功排程后保留当前任务编号并切到下一实验

**Files:**
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Test: `frontend/src/modules/schedule/useSchedulePage.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 成功排程后保留 `task_code`
- 若仍有未排实验，自动切到下一个实验
- `device`、`schedule_date`、`time_slot`、`custom_start`、`planned_hours` 重置
- 若无剩余实验，实验字段清空

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/useSchedulePage.test.js`
Expected: FAIL，因为当前成功排程后会完全重置整张表单。

- [ ] **Step 3: 做最小实现**

实现要点：
- 拆分完整重置与同任务重置
- 普通确认与冲突确认成功后都走同一套“保留任务”重置逻辑

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/useSchedulePage.test.js`
Expected: PASS

### Task 4: 在任务详情中支持删除排程和删除后重新排程

**Files:**
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Test: `frontend/src/modules/schedule/useSchedulePage.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- `删除排程` 会删除记录并关闭详情弹窗
- `删除后重新排程` 会删除记录、关闭详情弹窗并回填顶部表单
- 删除后实验选项重新恢复

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/useSchedulePage.test.js`
Expected: FAIL，因为当前任务详情弹窗没有这两个动作。

- [ ] **Step 3: 做最小实现**

实现要点：
- 增加详情弹窗动作处理器
- 复用现有删除逻辑
- 删除后重排调用顶部表单回填函数

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/useSchedulePage.test.js`
Expected: PASS

## Chunk 3: 渲染任务详情新动作并做页面回归

### Task 5: 在任务详情弹窗增加删除与删除后重新排程按钮

**Files:**
- Modify: `frontend/src/modules/schedule/page.vue`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 任务详情弹窗出现 `删除排程`
- 任务详情弹窗出现 `删除后重新排程`
- 点击后页面状态与表单回填符合预期

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/page.runtime.test.js`
Expected: FAIL，因为当前详情弹窗仍是只读展示。

- [ ] **Step 3: 做最小实现**

实现要点：
- 在详情弹窗增加按钮区域
- 不改编辑抽屉现有逻辑
- 动作直接调用 composable 中的新处理器

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/page.runtime.test.js`
Expected: PASS

### Task 6: 验证排程任务下拉只显示已保存托盘方案任务

**Files:**
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: 写失败测试**

覆盖点：
- 未保存托盘方案任务不出现在接驳区排程任务下拉
- 已保存托盘方案任务正常出现

- [ ] **Step 2: 运行失败测试**

Run: `npm run test:run -- src/modules/schedule/page.runtime.test.js`
Expected: FAIL，因为当前任务下拉口径还未收紧。

- [ ] **Step 3: 做最小实现**

实现要点：
- 页面不直接判断，只消费已过滤的 `taskOptions`
- 保证现有文案和下拉交互不回归

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm run test:run -- src/modules/schedule/page.runtime.test.js`
Expected: PASS

## Chunk 4: 回归验证

### Task 7: 跑排程模块整组回归

**Files:**
- Verify only

- [ ] **Step 1: 运行排程模块测试**

Run: `npm run test:run -- src/modules/schedule`
Expected: PASS

### Task 8: 跑关联跨模块回归

**Files:**
- Verify only

- [ ] **Step 1: 运行受影响模块测试**

Run: `npm run test:run -- src/modules/task-overview/model.test.js src/modules/handover-system/page.runtime.test.js src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
Expected: PASS

### Task 9: 记录残余风险

**Files:**
- Verify only

- [ ] **Step 1: 检查并记录以下风险**

关注点：
- 历史任务若托盘方案只存在于非标准旧字段，需要确认是否都已被迁移进 `task.tray_codes` / `sample.trays` / `experiment_trays`
- 同任务只剩最后一个实验时，成功排程后保留任务但实验为空，页面提示需要足够明确
- 删除后重新排程若原实验已被别处再次排走，需要以最新实验选项为准，不能强行回填失效实验
