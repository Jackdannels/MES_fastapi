# Scheduling Terminology And Retention Status Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一前端任务状态与排程文案，让暂存间任务在所有页面都按“未排程 / 暂存间存放”展示。

**Architecture:** 在前端保留对旧状态值“暂存间排放”的兼容读取，但所有新显示和新写入统一使用“暂存间存放”。任务总览、任务页、中控总览、排程页和过程页都按“正式实验室才算已排程，暂存间仍算未排程”的口径收口。

**Tech Stack:** Vue 3, Vitest, existing module models/composables

---

## Chunk 1: 状态口径与文案统一

### Task 1: 先写失败测试

**Files:**
- Modify: `frontend/src/modules/task-overview/model.test.js`
- Modify: `frontend/src/modules/task-overview/useTaskOverview.test.js`
- Modify: `frontend/src/modules/dashboard/model.test.js`
- Modify: `frontend/src/modules/tasks/model.test.js`

- [ ] 写出“暂存间存放仍算未排程”的失败测试
- [ ] 写出“排期文案改为排程”的失败测试
- [ ] 跑定向测试确认失败

### Task 2: 最小实现

**Files:**
- Modify: `frontend/src/modules/task-overview/model.js`
- Modify: `frontend/src/modules/task-overview/useTaskOverview.js`
- Modify: `frontend/src/modules/dashboard/model.js`
- Modify: `frontend/src/modules/tasks/model.js`
- Modify: `frontend/src/modules/schedule/model.js`

- [ ] 在模型层增加旧值“暂存间排放”到“暂存间存放”的兼容归一化
- [ ] 让 task-overview 只把正式实验室排程算作“已排程”
- [ ] 统一任务状态显示为“暂存间存放”

### Task 3: 页面文案统一

**Files:**
- Modify: `frontend/src/modules/task-overview/*.vue`
- Modify: `frontend/src/modules/process/page.vue`
- Modify: `frontend/src/modules/process/index.js`
- Modify: `frontend/src/modules/tasks/page.vue`
- Modify: `frontend/src/modules/dashboard/page.vue`
- Modify: `frontend/src/modules/samples/sampleTraceModel.js`

- [ ] 将“排期/未排期/已排期/暂无排期”统一改为“排程/未排程/已排程/暂无排程”
- [ ] 将“暂存间排放”统一改为“暂存间存放”

### Task 4: 回归验证

**Files:**
- Modify: `frontend/src/modules/process/*.test.js`
- Modify: `frontend/src/modules/task-overview/*.test.js`
- Modify: `frontend/src/modules/samples/sampleTraceModel.test.js`
- Modify: `frontend/src/modules/schedule/model.test.js`

- [ ] 跑定向测试
- [ ] 跑 `npm run test:run`

