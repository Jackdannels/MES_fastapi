# Task-Tray-Sample Status Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make trays the primary execution unit so that sample status follows tray status and task status is aggregated from trays.

**Architecture:** Keep the existing Vue module structure, but move status authority into tray-centric model helpers. Sample flow continues to own user actions, task/task-overview/process pages consume derived task state, and tests are expanded first to lock the new hierarchy and aggregation rules before implementation.

**Tech Stack:** Vue 3, composables, Vitest, current `modules/*` model helpers

---

## File Structure

### Status source files

- Modify: `frontend/src/modules/samples/samplesFlowModel.js`
  - Add tray-status-oriented helpers
  - Define the canonical tray status set and tray-to-sample mapping
- Modify: `frontend/src/modules/samples/samplesProcessModel.js`
  - Ensure tray creation from initial assignment remains compatible with canonical tray statuses
- Modify: `frontend/src/modules/tasks/model.js`
  - Replace task-status derivation with tray aggregation logic
- Modify: `frontend/src/modules/task-overview/model.js`
  - Derive overview status from aggregated tray status instead of loosely inferred sample/task fields
- Modify: `frontend/src/modules/process/model.js`
  - Align process cards with tray-driven “实验中/完成” interpretation

### Tests

- Modify: `frontend/src/modules/samples/samplesFlowModel.test.js`
- Modify: `frontend/src/modules/samples/samplesProcessModel.test.js`
- Modify: `frontend/src/modules/tasks/model.test.js`
- Modify: `frontend/src/modules/task-overview/model.test.js`
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`

### Optional UI follow-up if needed during implementation

- Modify: `frontend/src/modules/samples/page.runtime.test.js`
- Modify: `frontend/src/modules/tasks/page.runtime.test.js`

---

## Chunk 1: Canonical Tray Status Rules

### Task 1: Define the canonical tray status list and mapping helpers

**Files:**
- Modify: `frontend/src/modules/samples/samplesFlowModel.js`
- Test: `frontend/src/modules/samples/samplesFlowModel.test.js`

- [ ] **Step 1: Write the failing test**

Add tests that assert:

- the canonical tray statuses include:
  - `运输中`
  - `到货`
  - `送至暂存间`
  - `已到达暂存间`
  - `送至实验室`
  - `已到达实验室`
  - `工装夹具安装`
  - `实验准备就绪`
  - `实验已完成`
  - `放置实验后暂存间`
  - `厂家收回`
- a tray status maps directly to the same sample status label

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:run -- src/modules/samples/samplesFlowModel.test.js`

Expected: FAIL because canonical tray status helpers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/modules/samples/samplesFlowModel.js`:

- add a canonical tray status constant list
- add a helper such as `syncSampleStatusWithTrayStatus(status)` that returns the same canonical label
- avoid introducing extra derived labels beyond the approved list

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:run -- src/modules/samples/samplesFlowModel.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/samples/samplesFlowModel.js frontend/src/modules/samples/samplesFlowModel.test.js
git commit -m "refactor: define canonical tray status rules"
```

### Task 2: Keep tray creation compatible with canonical status ownership

**Files:**
- Modify: `frontend/src/modules/samples/samplesProcessModel.js`
- Test: `frontend/src/modules/samples/samplesProcessModel.test.js`

- [ ] **Step 1: Write the failing test**

Add a test that verifies newly assigned trays/samples initialize under a consistent tray-owned status, rather than separate ad hoc sample-only status drift.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:run -- src/modules/samples/samplesProcessModel.test.js`

Expected: FAIL because tray creation does not yet enforce canonical tray-owned status semantics.

- [ ] **Step 3: Write minimal implementation**

Update `frontend/src/modules/samples/samplesProcessModel.js` so that:

- tray-backed sample records initialize with a status compatible with the canonical tray status list
- sample records do not diverge from the assigned tray status during confirmation

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:run -- src/modules/samples/samplesProcessModel.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/samples/samplesProcessModel.js frontend/src/modules/samples/samplesProcessModel.test.js
git commit -m "refactor: align tray assignment with canonical statuses"
```

---

## Chunk 2: Task Status Aggregation

### Task 3: Aggregate task status from tray status

**Files:**
- Modify: `frontend/src/modules/tasks/model.js`
- Test: `frontend/src/modules/tasks/model.test.js`

- [ ] **Step 1: Write the failing test**

Add tests covering:

- one tray at `送至实验室` makes the task `实验中`
- one tray at `工装夹具安装` makes the task `实验中`
- mixed tray states where one tray is complete and one is still active keep the task at `实验中`
- all trays in `实验已完成` / `放置实验后暂存间` / `厂家收回` make the task `实验完成`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:run -- src/modules/tasks/model.test.js`

Expected: FAIL because current task status still depends on schedules and legacy labels.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/modules/tasks/model.js`:

- add a helper to collect tray statuses from `sample.trays`
- implement task aggregation priority:
  - all trays complete/post-complete => `实验完成`
  - any tray in lab/fixture/ready chain => `实验中`
  - otherwise retain pre-experiment state
- keep compatibility with existing pages by preserving row shape

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:run -- src/modules/tasks/model.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/tasks/model.js frontend/src/modules/tasks/model.test.js
git commit -m "feat: aggregate task status from tray states"
```

### Task 4: Update task overview aggregation to use tray-driven status

**Files:**
- Modify: `frontend/src/modules/task-overview/model.js`
- Test: `frontend/src/modules/task-overview/model.test.js`

- [ ] **Step 1: Write the failing test**

Add overview tests that assert:

- tray-derived task status appears in overview rows
- tasks are not marked complete until all tray entries are in post-complete states

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:run -- src/modules/task-overview/model.test.js`

Expected: FAIL because overview rows currently aggregate trays but not full tray-driven task status.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/modules/task-overview/model.js`:

- reuse the same tray aggregation semantics as task model
- avoid duplicating unrelated task-status logic

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:run -- src/modules/task-overview/model.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/task-overview/model.js frontend/src/modules/task-overview/model.test.js
git commit -m "feat: derive overview status from tray states"
```

---

## Chunk 3: Process View Alignment

### Task 5: Align process lab cards with tray-driven experimental progress

**Files:**
- Modify: `frontend/src/modules/process/model.js`
- Test: `frontend/src/modules/process/useProcessLabs.test.js`

- [ ] **Step 1: Write the failing test**

Add tests that confirm process cards stay consistent when:

- task trays are not all complete
- at least one tray is in active experiment-chain status
- all trays are complete/post-complete

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:run -- src/modules/process/useProcessLabs.test.js`

Expected: FAIL because process cards still lean on schedule-centric interpretation only.

- [ ] **Step 3: Write minimal implementation**

Update `frontend/src/modules/process/model.js` so displayed progress uses tray-derived task progress where needed, while preserving current card shape and routing behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:run -- src/modules/process/useProcessLabs.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/process/model.js frontend/src/modules/process/useProcessLabs.test.js
git commit -m "feat: align process labs with tray-driven task status"
```

---

## Chunk 4: Regression Coverage

### Task 6: Re-run cross-module regressions

**Files:**
- Test: `frontend/src/modules/samples/page.runtime.test.js`
- Test: `frontend/src/modules/tasks/page.runtime.test.js`
- Test: `frontend/src/modules/task-overview/useTaskOverview.test.js`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/samples/page.runtime.test.js src/modules/samples/samplesFlowModel.test.js src/modules/samples/samplesProcessModel.test.js src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js src/modules/task-overview/model.test.js src/modules/task-overview/useTaskOverview.test.js src/modules/process/useProcessLabs.test.js
```

Expected: PASS

- [ ] **Step 2: Fix any regressions uncovered**

Limit fixes to the modules above. Do not fold unrelated cleanup into this step.

- [ ] **Step 3: Re-run the same suite until green**

Run the same command again.

Expected: PASS with no unexpected warnings.

- [ ] **Step 4: Run diff hygiene checks**

Run:

```bash
git diff --check
```

Expected: no patch-format errors beyond known line-ending warnings.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/samples frontend/src/modules/tasks frontend/src/modules/task-overview frontend/src/modules/process
git commit -m "test: cover tray-driven status aggregation"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-03-18-task-tray-sample-status.md`. Ready to execute?
