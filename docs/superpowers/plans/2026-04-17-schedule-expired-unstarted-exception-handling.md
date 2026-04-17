# Schedule Expired Unstarted Exception Handling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止排程过时自动推导实验完成；对超时未启动排程立即自动撤销并写入可确认异常；让排程看板右上角异常处理按钮显示未确认数量并通过弹窗确认消除。

**Architecture:** 在共享快照读取链路前增加一个全局排程异常协调器，统一收敛 `mes.schedules`、`mes.tasks`、`mes.experiments` 与 `mes.conflicts`。排程页只负责展示和确认异常，不负责发现异常；真实开始实验的口径继续来自过程管控已存在的托盘/样品状态更新链路。

**Tech Stack:** Vue 3, Vue Test Utils, Vitest, JavaScript, CSS

---

## Chunk 1: 先锁住状态口径

### Task 1: 为排程状态推导补失败测试

**Files:**
- Modify: `frontend/src/modules/schedule/model.test.js`
- Modify: `frontend/src/modules/schedule/model.js`

- [ ] **Step 1: Write the failing test**

补一条测试，断言：
- 正式排程已经结束
- 但关联托盘/样品从未进入 `实验进行中`
- `resolveTaskStatus(...)` 不应返回 `实验已完成`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/modules/schedule/model.test.js`
Expected: FAIL，当前仍把过期排程判成 `实验已完成`

- [ ] **Step 3: Write minimal implementation**

移除 `resolveTaskStatus(...)` 中“仅因正式排程结束就完成”的推导分支，完成态只由真实实验生命周期驱动。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/modules/schedule/model.test.js`
Expected: PASS

## Chunk 2: 全局异常协调器

### Task 2: 为超时未启动排程自动撤销补失败测试

**Files:**
- Create: `frontend/src/lib/scheduleExceptions.js`
- Create: `frontend/src/lib/scheduleExceptions.test.js`

- [ ] **Step 1: Write the failing test**

覆盖以下行为：
- 排程 `end_at < now`
- 从未开始实验
- 执行协调器后该排程被删除
- 对应任务状态回退
- `mes.conflicts` 追加 `schedule_missed_start` 异常

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/scheduleExceptions.test.js`
Expected: FAIL，协调器尚不存在

- [ ] **Step 3: Write minimal implementation**

在 `scheduleExceptions.js` 中实现：
- 真实开始判定
- 超时未启动排程筛选
- 排程删除
- 实验/任务状态重算
- 异常去重追加

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/scheduleExceptions.test.js`
Expected: PASS

### Task 3: 把协调器接入共享快照读取

**Files:**
- Modify: `frontend/src/composables/useStorageSnapshot.js`
- Modify: `frontend/src/lib/storageApi.js`
- Test: `frontend/src/lib/scheduleExceptions.test.js`

- [ ] **Step 1: Write the failing integration test**

增加一条集成测试或扩展现有测试，断言任意 `loadSnapshot()` 路径都会先执行协调器，并在需要时持久化更新。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/scheduleExceptions.test.js`
Expected: FAIL，`loadSnapshot()` 目前只直接读快照

- [ ] **Step 3: Write minimal implementation**

在共享读快照链路中接入协调器：
- 读取原始快照
- 运行异常收敛
- 如有变更则一次性 `writeStorageUpdates(...)`
- 返回协调后的快照

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/scheduleExceptions.test.js`
Expected: PASS

## Chunk 3: 保证开始实验后的排程不会误删

### Task 4: 为已启动排程免于异常撤销补失败测试

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`
- Test: `frontend/src/lib/scheduleExceptions.test.js`

- [ ] **Step 1: Write the failing test**

断言：
- 点击 `开始实验` 后，托盘进入 `实验进行中`
- 即使当前时间超过原排程结束时间
- 协调器也不会把该排程当作“未启动异常”删除

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/modules/process/useProcessLabs.test.js src/lib/scheduleExceptions.test.js`
Expected: FAIL，协调器尚未识别真实开始链路

- [ ] **Step 3: Write minimal implementation**

让协调器基于托盘状态/样品历史/过程管控写回结果判定“真实开始”。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/modules/process/useProcessLabs.test.js src/lib/scheduleExceptions.test.js`
Expected: PASS

## Chunk 4: 排程页异常处理入口

### Task 5: 为异常处理按钮数量与弹窗补失败测试

**Files:**
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Modify: `frontend/src/modules/schedule/page.vue`
- Modify: `frontend/src/modules/schedule/styles.css`

- [ ] **Step 1: Write the failing test**

补运行时断言：
- 按钮显示 `异常处理 1`
- 点击后打开 `AppModal`
- 弹窗展示异常原因
- 点击确认后该异常从未确认列表消失，按钮数量归零

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/modules/schedule/page.runtime.test.js`
Expected: FAIL，当前按钮无数量、无弹窗、无确认逻辑

- [ ] **Step 3: Write minimal implementation**

在排程页新增：
- 未确认异常数量计算
- 异常处理弹窗
- 单条确认逻辑
- `mes.conflicts` 中 `pending -> acknowledged` 的持久化

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/modules/schedule/page.runtime.test.js`
Expected: PASS

## Chunk 5: 回归验证

### Task 6: 运行针对性测试

**Files:**
- Test: `frontend/src/modules/schedule/model.test.js`
- Test: `frontend/src/lib/scheduleExceptions.test.js`
- Test: `frontend/src/modules/process/useProcessLabs.test.js`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: Run targeted suite**

Run: `npm run test -- src/modules/schedule/model.test.js src/lib/scheduleExceptions.test.js src/modules/process/useProcessLabs.test.js src/modules/schedule/page.runtime.test.js`
Expected: PASS
