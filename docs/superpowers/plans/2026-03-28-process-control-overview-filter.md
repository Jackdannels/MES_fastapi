# Process Control Overview Filter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“试验过程管控”默认展示全部正式实验室，并通过顶部 `总览 / 实验中 / 已排程 / 空闲` 卡片完成筛选。

**Architecture:** 保持 `model.js` 作为唯一实验室状态建模入口，但改为产出完整正式实验室集合；`useProcessLabs.js` 新增筛选状态和派生计数；`page.vue` 只负责把顶部卡片渲染为可点击筛选和空态。实现按 TDD 执行，先固定模型和 composable 行为，再接入页面。

**Tech Stack:** Vue 3, Vitest, Vite

---

### Task 1: 固定实验室完整集合与状态口径

**Files:**
- Modify: `frontend/src/modules/process/model.test.js`
- Modify: `frontend/src/modules/process/model.js`

- [ ] **Step 1: 写失败测试**

为 `buildProcessLabCards()` 增加用例，覆盖：

- 无排程实验室仍返回卡片，状态为 `空闲`
- 进行中实验室状态为 `实验中`
- 未来排程实验室状态为 `已排程`
- 返回结果包含全部正式实验室，不包含暂存间

- [ ] **Step 2: 跑测试确认红灯**

Run: `cd frontend && npm run test:run -- src/modules/process/model.test.js`

Expected: `FAIL`，因为当前实现会过滤掉无排程实验室。

- [ ] **Step 3: 写最小实现**

在 `buildProcessLabCards()` 中：

- 为每个正式实验室始终返回一张卡片
- 无排程时填充空闲态字段
- 有排程时沿用现有任务/实验状态聚合逻辑

- [ ] **Step 4: 跑测试确认转绿**

Run: `cd frontend && npm run test:run -- src/modules/process/model.test.js`

Expected: `PASS`

### Task 2: 固定筛选状态与计数派生

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`
- Modify: `frontend/src/modules/process/useProcessLabs.js`

- [ ] **Step 1: 写失败测试**

为 `useProcessLabs()` 增加用例，覆盖：

- 默认筛选为 `总览`
- `总览 / 实验中 / 已排程 / 空闲` 四个计数正确
- 切换筛选后 `visibleLabCards` 返回正确列表

- [ ] **Step 2: 跑测试确认红灯**

Run: `cd frontend && npm run test:run -- src/modules/process/useProcessLabs.test.js`

Expected: `FAIL`，因为当前 composable 没有筛选状态，也没有完整计数派生。

- [ ] **Step 3: 写最小实现**

在 `useProcessLabs()` 中：

- 增加当前筛选状态 `activeFilter`
- 暴露切换筛选方法
- 从完整卡片列表派生 `visibleLabCards`
- 计算四个头部数字

- [ ] **Step 4: 跑测试确认转绿**

Run: `cd frontend && npm run test:run -- src/modules/process/useProcessLabs.test.js`

Expected: `PASS`

### Task 3: 接入页面卡片筛选与空闲态交互

**Files:**
- Modify: `frontend/src/modules/process/page.runtime.test.js`
- Modify: `frontend/src/modules/process/page.vue`
- Modify: `frontend/src/modules/process/styles.css`

- [ ] **Step 1: 写失败测试**

为页面增加运行时断言，覆盖：

- 头部显示 `总览 / 实验中 / 已排程 / 空闲`
- 默认选中 `总览`
- 点击筛选项后只显示对应实验室
- 空闲实验室的“查看任务”按钮禁用

- [ ] **Step 2: 跑测试确认红灯**

Run: `cd frontend && npm run test:run -- src/modules/process/page.runtime.test.js`

Expected: `FAIL`，因为当前页面没有总览卡片，也没有筛选交互。

- [ ] **Step 3: 写最小实现**

在页面层：

- 把顶部统计卡改为可点击筛选卡
- 使用 `visibleLabCards` 代替原始 `labCards`
- 对空闲实验室禁用“查看任务”
- 增加空态提示和选中态样式

- [ ] **Step 4: 跑测试确认转绿**

Run: `cd frontend && npm run test:run -- src/modules/process/page.runtime.test.js`

Expected: `PASS`

### Task 4: 做过程模块回归验证

**Files:**
- Modify: `frontend/src/modules/process/model.test.js`
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`
- Modify: `frontend/src/modules/process/page.runtime.test.js`

- [ ] **Step 1: 跑过程模块相关测试**

Run: `cd frontend && npm run test:run -- src/modules/process/model.test.js src/modules/process/useProcessLabs.test.js src/modules/process/page.runtime.test.js`

Expected: `PASS`

- [ ] **Step 2: 跑更大范围前端回归**

Run: `cd frontend && npm run test:run -- src/modules/process`

Expected: `PASS`
