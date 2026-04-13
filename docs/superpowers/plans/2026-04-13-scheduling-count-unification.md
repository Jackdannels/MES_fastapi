# Scheduling Count Unification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify dashboard, tasks, and task/tray overview scheduling counts so they count formal-lab scheduled tasks rather than experiment rows, temporary-room rows, or raw schedule records.

**Architecture:** Keep the change inside existing frontend model helpers. Introduce task-level formal-schedule detection where counts are computed, then update summary metrics and overview counters to consume that derived boolean/count consistently.

**Tech Stack:** Vue 3, Vitest, existing module-scoped model helpers

---

## Chunk 1: Dashboard KPI Semantics

### Task 1: Lock dashboard KPI behavior with tests

**Files:**
- Modify: `frontend/src/modules/dashboard/model.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `npm run test:run -- src/modules/dashboard/model.test.js` and confirm the new expectation fails**
- [ ] **Step 3: Update dashboard KPI expectations to task-level formal scheduling**
- [ ] **Step 4: Re-run `npm run test:run -- src/modules/dashboard/model.test.js` and confirm pass**

### Task 2: Implement dashboard task-level scheduling counts

**Files:**
- Modify: `frontend/src/modules/dashboard/model.js`

- [ ] **Step 1: Derive formal-scheduled task codes from non-retention schedules**
- [ ] **Step 2: Compute `scheduledCount` from unique task codes, not raw schedule rows**
- [ ] **Step 3: Compute `unscheduledCount` as tasks lacking any formal schedule**
- [ ] **Step 4: Remove staging-note suffix from dashboard unscheduled KPI**

## Chunk 2: Tasks KPI Semantics

### Task 3: Lock tasks-page KPI behavior with tests

**Files:**
- Modify: `frontend/src/modules/tasks/model.test.js`

- [ ] **Step 1: Write failing expectations for pure numeric unscheduled count and retention-only tasks staying unscheduled**
- [ ] **Step 2: Run `npm run test:run -- src/modules/tasks/model.test.js` and confirm failure**
- [ ] **Step 3: Keep the task row status assertions intact while changing metric assertions only**
- [ ] **Step 4: Re-run the same test file and confirm pass**

### Task 4: Implement tasks-page KPI change

**Files:**
- Modify: `frontend/src/modules/tasks/model.js`

- [ ] **Step 1: Remove staging-note-based unscheduled label formatting**
- [ ] **Step 2: Keep waiting-task counting task-based and formal-schedule-aware**
- [ ] **Step 3: Preserve task row display status behavior**

## Chunk 3: Task/Tray Overview Semantics

### Task 5: Lock task-overview schedule aggregation with tests

**Files:**
- Modify: `frontend/src/modules/task-overview/model.test.js`
- Modify: `frontend/src/modules/task-overview/useTaskOverview.test.js`

- [ ] **Step 1: Add failing test showing multiple formal schedules on one task still produce a single scheduled task**
- [ ] **Step 2: Add failing test showing overview top counter stays task-based**
- [ ] **Step 3: Run `npm run test:run -- src/modules/task-overview/model.test.js src/modules/task-overview/useTaskOverview.test.js` and confirm failure**
- [ ] **Step 4: Re-run after implementation and confirm pass**

### Task 6: Implement task-overview schedule aggregation change

**Files:**
- Modify: `frontend/src/modules/task-overview/model.js`
- Modify: `frontend/src/modules/task-overview/useTaskOverview.js`

- [ ] **Step 1: Collapse formal schedule presence to a task-level boolean/count instead of raw record count**
- [ ] **Step 2: Keep tray view scheduled/unscheduled based on any formal schedule presence**
- [ ] **Step 3: Keep top counter using scheduled-task rows under the new row semantics**

## Chunk 4: Final Verification

### Task 7: Run focused regression tests

**Files:**
- Test: `frontend/src/modules/dashboard/model.test.js`
- Test: `frontend/src/modules/tasks/model.test.js`
- Test: `frontend/src/modules/task-overview/model.test.js`
- Test: `frontend/src/modules/task-overview/useTaskOverview.test.js`
- Test: `frontend/src/modules/dashboard/page.runtime.test.js`

- [ ] **Step 1: Run `npm run test:run -- src/modules/dashboard/model.test.js src/modules/tasks/model.test.js src/modules/task-overview/model.test.js src/modules/task-overview/useTaskOverview.test.js src/modules/dashboard/page.runtime.test.js`**
- [ ] **Step 2: Confirm all touched suites pass with zero failures**
