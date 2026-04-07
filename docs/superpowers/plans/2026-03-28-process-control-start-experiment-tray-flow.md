# Process Control Start Experiment Tray Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让过程管控页支持按当前准备就绪托盘批次开始实验，并在任务抽屉中展示当前批次、剩余批次和统一托盘流程图。

**Architecture:** 在 `useProcessLabs.js` 中增加托盘级聚合和开始实验写回逻辑；页面层新增 `开始实验` 按钮和托盘视图；流程图步骤复用样品模块的 `SAMPLE_FLOW_STEPS` / `buildTrayFlowView()`。按 TDD 执行，先固定托盘级业务规则，再接入页面渲染。

**Tech Stack:** Vue 3, Vitest, Vite

---

### Task 1: 固定托盘级开始实验规则

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`
- Modify: `frontend/src/modules/process/useProcessLabs.js`

- [ ] **Step 1: 写失败测试**

增加用例，覆盖：

- 仅当存在 `实验准备就绪` 托盘且不存在 `实验进行中` 托盘时允许开始实验
- 点击 `开始实验` 后仅当前准备就绪托盘转为 `实验进行中`
- 点击 `开始实验` 后当前实验排程的 `start_at/end_at` 同步重算
- 成功提示输出“当前开始进行 x 个托盘，剩余 x 个托盘”
- 当前存在 `实验进行中` 托盘时按钮禁用状态和原因正确

- [ ] **Step 2: 跑测试确认红灯**

Run: `cd frontend && npm run test:run -- src/modules/process/useProcessLabs.test.js`

Expected: `FAIL`

- [ ] **Step 3: 写最小实现**

在 `useProcessLabs()` 中：

- 聚合任务下托盘行
- 派生 `canStartExperiment`、当前批次托盘与剩余托盘
- 实现 `startExperiment(lab)` 并写回 `mes.samples` / `mes.tasks` / `mes.schedules`

- [ ] **Step 4: 跑测试确认转绿**

Run: `cd frontend && npm run test:run -- src/modules/process/useProcessLabs.test.js`

Expected: `PASS`

### Task 2: 接入抽屉托盘批次与流程图

**Files:**
- Modify: `frontend/src/modules/process/page.runtime.test.js`
- Modify: `frontend/src/modules/process/page.vue`
- Modify: `frontend/src/modules/process/styles.css`

- [ ] **Step 1: 写失败测试**

增加页面运行时断言，覆盖：

- 每张实验室卡片渲染 `开始实验`
- 抽屉中展示 `当前实验托盘`、`待下一轮托盘`
- 点击托盘后右侧流程图切换为对应托盘
- 不可启动时按钮禁用

- [ ] **Step 2: 跑测试确认红灯**

Run: `cd frontend && npm run test:run -- src/modules/process/page.runtime.test.js`

Expected: `FAIL`

- [ ] **Step 3: 写最小实现**

在页面层：

- 增加 `开始实验` 按钮和提示区
- 抽屉增加托盘批次列表与统一流程图区
- 绑定托盘点击切换与按钮禁用文案

- [ ] **Step 4: 跑测试确认转绿**

Run: `cd frontend && npm run test:run -- src/modules/process/page.runtime.test.js`

Expected: `PASS`

### Task 3: 做过程模块回归验证

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`
- Modify: `frontend/src/modules/process/page.runtime.test.js`

- [ ] **Step 1: 跑过程模块测试**

Run: `cd frontend && npm run test:run -- src/modules/process`

Expected: `PASS`

- [ ] **Step 2: 跑编译与 lint**

Run:

- `cd frontend && npm run build`
- `cd frontend && npx eslint src/modules/process --ext .js,.vue`

Expected: `PASS`
