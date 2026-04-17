# Central Header Schedule Actions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收口中控管理系统的头部按钮，只在任务受理页保留新建任务，彻底删除所有查看排程入口，并在排程看板右上角新增浅红底的异常处理按钮。

**Architecture:** 继续沿用现有 Vue 3 页面头部结构：中控公共头部由 `App.vue` 控制全局按钮显隐，模块页通过 Teleport 注入局部按钮。测试先覆盖 `App`、实验室页、排程页的头部操作区，再做最小模板和样式修改，避免影响既有业务逻辑。

**Tech Stack:** Vue 3, Vue Test Utils, Vitest, CSS

---

## Chunk 1: Test-First Coverage

### Task 1: 调整中控公共头部按钮测试

**Files:**
- Modify: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Write the failing test**

添加断言，确保：
- `任务受理` 路由显示 `新建任务`
- 非 `任务受理` 路由不显示 `新建任务`
- 中控头部不再显示 `查看排程`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- App.runtime.test.js`
Expected: FAIL，仍然能看到 `新建任务` 或 `查看排程`

### Task 2: 调整实验室页头部 Teleport 测试

**Files:**
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

把“Teleport 查看排程并打开排程弹窗”的断言改为：
- 头部只保留 `刷新`、`退出登录`
- 不再存在 `laboratory-open-schedule`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- laboratory/page.runtime.test.js`
Expected: FAIL，仍然渲染 `查看排程`

### Task 3: 为排程看板补头部异常处理按钮测试

**Files:**
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

补一个最小 `.header-actions` 容器，断言：
- Teleport 后头部出现 `异常处理`
- 按钮带浅红底样式 class

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- schedule/page.runtime.test.js`
Expected: FAIL，排程页尚未渲染 `异常处理`

## Chunk 2: Minimal Implementation

### Task 4: 收口公共头部按钮

**Files:**
- Modify: `frontend/src/App.vue`

- [ ] **Step 1: Write minimal implementation**

增加仅任务受理页显示新建任务的计算属性，删除全局 `查看排程` 按钮。

- [ ] **Step 2: Run related test to verify it passes**

Run: `npm run test -- App.runtime.test.js`
Expected: PASS

### Task 5: 删除实验室页查看排程入口

**Files:**
- Modify: `frontend/src/modules/laboratory/page.vue`

- [ ] **Step 1: Write minimal implementation**

删除头部 Teleport 的 `查看排程` 按钮，保留现有 `总览` 与页面内部任务清单能力。

- [ ] **Step 2: Run related test to verify it passes**

Run: `npm run test -- laboratory/page.runtime.test.js`
Expected: PASS

### Task 6: 新增排程看板异常处理按钮

**Files:**
- Modify: `frontend/src/modules/schedule/page.vue`
- Modify: `frontend/src/modules/schedule/styles.css`

- [ ] **Step 1: Write minimal implementation**

通过 Teleport 向 `.header-actions` 注入 `异常处理` 按钮，使用独立 class 提供浅红底样式，不绑定业务行为。

- [ ] **Step 2: Run related test to verify it passes**

Run: `npm run test -- schedule/page.runtime.test.js`
Expected: PASS

## Chunk 3: Final Verification

### Task 7: 运行针对性回归测试

**Files:**
- Test: `frontend/src/App.runtime.test.js`
- Test: `frontend/src/modules/laboratory/page.runtime.test.js`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: Run targeted suite**

Run: `npm run test -- App.runtime.test.js modules/laboratory/page.runtime.test.js modules/schedule/page.runtime.test.js`
Expected: PASS
