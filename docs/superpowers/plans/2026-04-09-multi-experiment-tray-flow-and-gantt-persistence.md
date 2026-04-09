# 多实验托盘流程图与甘特保留 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让全系统托盘流程图支持多实验压缩显示，并让甘特图仅在实验真实开始且真实完成后才隐藏排程。

**Architecture:** 以 `samplesFlowModel` 为共享托盘流程图模型中心，新增多实验压缩视图构建能力，由各页面继续复用。甘特图继续基于 `schedule/model.js` 构建，但将隐藏条件从“计划时间”改为“真实开始 + 真实完成”双条件。

**Tech Stack:** Vue 3, Vitest, existing MES snapshot models, shared frontend view-model builders

---

## Chunk 1: Shared Tray Flow Model

### Task 1: Add failing tests for compressed multi-experiment tray flow

**Files:**
- Modify: `frontend/src/modules/samples/samplesFlowModel.test.js`
- Reference: `frontend/src/modules/laboratory/model.test.js`

- [ ] **Step 1: Write the failing test**

Add tests covering:
- `A -> B -> C` three-experiment tray flow with A completed and B active
- completed experiments collapsing to `X实验已完成`
- current unfinished experiment keeping full steps
- post-experiment routing displaying staging or next lab based on real follow-up actions
- final all-completed view keeping only the last experiment’s pre-run path and completion node

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/samples/samplesFlowModel.test.js`
Expected: FAIL because current `buildTrayFlowView(...)` still emits the fixed 12-step flow

- [ ] **Step 3: Write minimal implementation**

Implement a shared compressed tray-flow builder in `frontend/src/modules/samples/samplesFlowModel.js` that:
- reads experiment order
- detects finished experiment milestones
- expands only the current unfinished experiment
- preserves final-route display for the last experiment

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/samples/samplesFlowModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/samples/samplesFlowModel.js frontend/src/modules/samples/samplesFlowModel.test.js
git commit -m "feat: compress multi-experiment tray flows"
```

### Task 2: Preserve compatibility for existing single-experiment flow consumers

**Files:**
- Modify: `frontend/src/modules/samples/samplesFlowModel.js`
- Test: `frontend/src/modules/samples/samplesFlowModel.test.js`

- [ ] **Step 1: Write the failing test**

Add tests proving single-experiment trays still render the existing linear flow without missing steps.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/samples/samplesFlowModel.test.js`
Expected: FAIL if the new compressed builder breaks old one-experiment behavior

- [ ] **Step 3: Write minimal implementation**

Keep single-experiment paths on the legacy simple route while routing only multi-experiment trays through the new compression logic.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/samples/samplesFlowModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/samples/samplesFlowModel.js frontend/src/modules/samples/samplesFlowModel.test.js
git commit -m "fix: keep single-experiment tray flows stable"
```

## Chunk 2: Process, Laboratory, and Tray Views

### Task 3: Wire process-control tray flow to the new shared model

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.js`
- Modify: `frontend/src/modules/process/page.vue`
- Test: `frontend/src/modules/process/useProcessLabs.test.js`
- Test: `frontend/src/modules/process/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add tests proving process-control tray flow:
- collapses completed experiments
- expands only current experiment
- keeps current task switching behavior intact

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/process/useProcessLabs.test.js src/modules/process/page.runtime.test.js`
Expected: FAIL because current process page still consumes the simple tray flow

- [ ] **Step 3: Write minimal implementation**

Update process-control view-model inputs so the selected tray flow receives task experiment order, current experiment context, and follow-up route state.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/process/useProcessLabs.test.js src/modules/process/page.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/process/useProcessLabs.js frontend/src/modules/process/page.vue frontend/src/modules/process/useProcessLabs.test.js frontend/src/modules/process/page.runtime.test.js
git commit -m "feat: use compressed tray flow in process control"
```

### Task 4: Wire laboratory tray flow to the new shared model

**Files:**
- Modify: `frontend/src/modules/laboratory/model.js`
- Test: `frontend/src/modules/laboratory/model.test.js`
- Test: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add tests proving the lab console tray flow uses:
- collapsed finished experiments
- expanded current experiment steps
- real follow-up route detection after experiment completion

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js`
Expected: FAIL because current lab console still shows the old unified tray flow

- [ ] **Step 3: Write minimal implementation**

Pass the same shared multi-experiment tray-flow inputs into the laboratory view builder.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/laboratory/model.js frontend/src/modules/laboratory/model.test.js frontend/src/modules/laboratory/page.runtime.test.js
git commit -m "feat: use compressed tray flow in laboratory console"
```

### Task 5: Wire tray-management flow view to the new shared model

**Files:**
- Modify: `frontend/src/modules/samples/TrayManagementPanel.vue`
- Modify: `frontend/src/modules/samples/useSamplesFlow.js` (if input shaping is needed)
- Test: `frontend/src/modules/samples/page.runtime.test.js`
- Test: `frontend/src/modules/samples/samplesFlowModel.test.js`

- [ ] **Step 1: Write the failing test**

Add tests proving tray management shows the compressed multi-experiment tray flow for a three-experiment tray.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/samples/page.runtime.test.js src/modules/samples/samplesFlowModel.test.js`
Expected: FAIL because tray management still renders the fixed single-flow model

- [ ] **Step 3: Write minimal implementation**

Pass enriched tray context into the shared flow builder from tray management.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/samples/page.runtime.test.js src/modules/samples/samplesFlowModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/samples/TrayManagementPanel.vue frontend/src/modules/samples/useSamplesFlow.js frontend/src/modules/samples/page.runtime.test.js frontend/src/modules/samples/samplesFlowModel.test.js
git commit -m "feat: use compressed tray flow in tray management"
```

## Chunk 3: Gantt Persistence Rules

### Task 6: Add failing tests for unstarted schedules staying visible

**Files:**
- Modify: `frontend/src/modules/schedule/model.test.js`
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`
- Reference: `frontend/src/modules/schedule/model.js`

- [ ] **Step 1: Write the failing test**

Add tests covering:
- unstarted experiment still visible after planned end time passes
- started experiment stays visible using recomputed time window
- only truly completed experiments disappear
- starting one experiment does not wipe the entire gantt view

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js`
Expected: FAIL because current gantt still hides completed/past segments too aggressively

- [ ] **Step 3: Write minimal implementation**

Update `frontend/src/modules/schedule/model.js` so gantt segment visibility depends on:
- experiment started flag inferred from tray/sample status
- recomputed real schedule window after process-control start
- real completion status before hiding

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/schedule/model.js frontend/src/modules/schedule/model.test.js frontend/src/modules/schedule/page.runtime.test.js
git commit -m "fix: keep gantt schedules visible until real completion"
```

### Task 7: Keep schedule-page task scoping stable after gantt visibility changes

**Files:**
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Test: `frontend/src/modules/schedule/useSchedulePage.test.js`

- [ ] **Step 1: Write the failing test**

Add a regression test proving selected-task scoping still works after a started experiment updates its real times.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/schedule/useSchedulePage.test.js`
Expected: FAIL if selected-task lab filtering breaks under the new gantt visibility rules

- [ ] **Step 3: Write minimal implementation**

Adjust schedule-page scoping logic only if necessary to keep selected-task filtering stable with the new model output.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/schedule/useSchedulePage.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/schedule/useSchedulePage.js frontend/src/modules/schedule/useSchedulePage.test.js
git commit -m "fix: preserve selected-task gantt scoping"
```

## Chunk 4: Final Verification

### Task 8: Run focused regression suite and update docs references if needed

**Files:**
- Verify only

- [ ] **Step 1: Run focused frontend suite**

Run:

```bash
npm run test:run -- src/modules/samples/samplesFlowModel.test.js src/modules/samples/page.runtime.test.js src/modules/process/useProcessLabs.test.js src/modules/process/page.runtime.test.js src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js src/modules/schedule/model.test.js src/modules/schedule/useSchedulePage.test.js src/modules/schedule/page.runtime.test.js
```

Expected: PASS

- [ ] **Step 2: Inspect affected docs and UI text for stale flow wording**

Check whether any page text still implies:
- completed experiments always remain expanded
- gantt hides by original planned time alone

- [ ] **Step 3: Run broader regression if time allows**

Run:

```bash
npm run test:run
```

Expected: PASS or known unrelated failures only

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: support compressed multi-experiment tray flows and persistent gantt schedules"
```

