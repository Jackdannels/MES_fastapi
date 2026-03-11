# Process Lab Visibility Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“试验过程管控”只显示有有效排期窗口的实验室卡片。

**Architecture:** 业务规则统一落在 `buildProcessLabCards()`，由模型层决定哪些实验室可见；`useProcessLabs()` 和 `ProcessPage.vue` 不承担展示过滤判断。先用模型层测试固定行为，再做最小实现。

**Tech Stack:** Vue 3, Vitest, Vite

---

### Task 1: 固定实验室可见性规则

**Files:**
- Modify: `frontend/src/lib/processLabModel.test.js`
- Modify: `frontend/src/lib/processLabModel.js`

- [ ] **Step 1: 写失败测试**

为 `buildProcessLabCards()` 增加一组用例，验证：

- 无排期实验室不会出现在返回结果里
- 已结束超过 24 小时的实验室不会出现在返回结果里
- 正在进行、未来已排期、以及结束未超过 24 小时的实验室仍然保留

- [ ] **Step 2: 跑测试确认红灯**

Run: `cd frontend && npm run test:run -- src/lib/processLabModel.test.js`

Expected: `FAIL`，因为当前实现仍会返回空闲和超时完成实验室。

- [ ] **Step 3: 写最小实现**

在 `buildProcessLabCards()` 内部统一决定每个实验室是否可见：

- 没有排期时直接过滤掉
- 只有历史排期时，基于最近结束时间和 `now` 的差值决定是否保留

- [ ] **Step 4: 跑测试确认转绿**

Run: `cd frontend && npm run test:run -- src/lib/processLabModel.test.js`

Expected: `PASS`

- [ ] **Step 5: 做前端回归验证**

Run:

- `cd frontend && npm run test:run`
- `cd frontend && npm run build`
- `cd frontend && npm run lint`
