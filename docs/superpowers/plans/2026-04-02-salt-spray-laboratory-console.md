# 盐雾试验室操作台 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `laboratory` module that exposes a salt-spray laboratory operations console backed by the current project's storage model.

**Architecture:** Register `laboratory` as a first-class module beside `central`, `handover`, `visual`, and `staging`, then build a dedicated `frontend/src/modules/laboratory/` page that reads current storage snapshots and filters them to `盐雾试验室`. Reuse the zip module's layout ideas, but adapt all business data and workflow state to the existing project rules.

**Tech Stack:** Vue 3, Vue Test Utils, Vitest, local storage snapshot helpers, module registry/auth routing

---

## Chunk 1: Module Shell Wiring

### Task 1: Add failing tests for the new module registry and routing

**Files:**
- Modify: `frontend/src/modules/modules.structure.test.js`
- Modify: `frontend/src/auth.test.js`
- Modify: `frontend/src/lib/authRouting.test.js`
- Modify: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run targeted tests to verify they fail**
- [ ] **Step 3: Implement minimal module catalog, auth, and app-shell wiring**
- [ ] **Step 4: Re-run targeted tests to verify they pass**

### Task 2: Register the standalone module and expose it in module selection

**Files:**
- Modify: `frontend/src/lib/moduleCatalog.js`
- Modify: `frontend/src/modules/index.js`
- Modify: `frontend/src/modules/login/page.vue`

- [ ] **Step 1: Add `laboratory` route/label metadata**
- [ ] **Step 2: Register the new module entry in the shared module registry**
- [ ] **Step 3: Add the new option to the login module selector**
- [ ] **Step 4: Re-run the chunk 1 tests**

## Chunk 2: Laboratory Page Model

### Task 3: Add failing tests for salt-spray task filtering and workflow gating

**Files:**
- Create: `frontend/src/modules/laboratory/model.test.js`
- Create: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] **Step 1: Write model tests for summary counts, current task resolution, and salt-spray filtering**
- [ ] **Step 2: Write runtime tests for independent shell copy, task list modal, and workflow button gating**
- [ ] **Step 3: Run targeted tests to verify they fail**

### Task 4: Implement the model and page-level state adapter

**Files:**
- Create: `frontend/src/modules/laboratory/model.js`
- Create: `frontend/src/modules/laboratory/useLaboratoryPage.js`

- [ ] **Step 1: Add pure selectors for salt-spray schedules, summary counts, and current task resolution**
- [ ] **Step 2: Add workflow state helpers for compare/install/confirm gating**
- [ ] **Step 3: Add a page composable that loads storage snapshots and exposes modal/workflow state**
- [ ] **Step 4: Re-run targeted model/runtime tests**

## Chunk 3: Laboratory Page UI

### Task 5: Build the standalone module page and styles

**Files:**
- Create: `frontend/src/modules/laboratory/index.js`
- Create: `frontend/src/modules/laboratory/page.vue`
- Create: `frontend/src/modules/laboratory/styles.css`
- Modify: `frontend/src/modules/moduleStyles.structure.test.js`

- [ ] **Step 1: Build the page shell with summary cards, action cards, progress panel, and modals**
- [ ] **Step 2: Add page-local styles and structure assertions**
- [ ] **Step 3: Run targeted tests to verify the new page passes**

## Chunk 4: Verification

### Task 6: Run focused verification

**Files:**
- Verify only

- [ ] **Step 1: Run `npm run test:run -- src/modules/modules.structure.test.js src/auth.test.js src/lib/authRouting.test.js src/App.runtime.test.js src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js src/modules/moduleStyles.structure.test.js` from `frontend/`**
- [ ] **Step 2: Fix any regressions and rerun until green**
- [ ] **Step 3: Summarize changed files, behavior, and verification output**

## Chunk 5: Detailed Task Selection And Scan Compare

### Task 7: Add failing tests for selected current task and tray scan validation

**Files:**
- Modify: `frontend/src/modules/laboratory/model.test.js`
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] **Step 1: Write failing model tests for selected-task resolution and tray scan validation**
- [ ] **Step 2: Write failing runtime tests for recent task cards, detailed task modal rows, and scan feedback states**
- [ ] **Step 3: Run targeted tests to verify they fail**

### Task 8: Implement selected-task state and tray ownership matching

**Files:**
- Modify: `frontend/src/modules/laboratory/model.js`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`

- [ ] **Step 1: Extend schedule rows with start/end fields, tray lists, and current-task resolution**
- [ ] **Step 2: Add tray ownership lookup using `experiment_trays`, `samples`, `schedules`, and `experiments`**
- [ ] **Step 3: Add scan validation helpers that return green/red feedback payloads**
- [ ] **Step 4: Re-run targeted model tests**

### Task 9: Implement the richer UI and compare modal workflow

**Files:**
- Modify: `frontend/src/modules/laboratory/page.vue`
- Modify: `frontend/src/modules/laboratory/styles.css`

- [ ] **Step 1: Add recent task cards below the action grid**
- [ ] **Step 2: Upgrade the task modal to support selection confirmation and detailed tray rows**
- [ ] **Step 3: Replace compare confirmation with scanner input, green/red feedback, and guarded compare completion**
- [ ] **Step 4: Re-run targeted runtime tests**

## Chunk 6: Persisted Laboratory Progress

### Task 10: Add failing tests for persisted laboratory step progress

**Files:**
- Modify: `frontend/src/modules/laboratory/model.test.js`
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] **Step 1: Write failing model tests for tray-status-based workflow recovery and task-step sample updates**
- [ ] **Step 2: Write failing runtime tests for compare/install/confirm persistence and full datetime rendering**
- [ ] **Step 3: Run targeted tests to verify they fail**

### Task 11: Persist tray status transitions and refresh the recent task card layout

**Files:**
- Modify: `frontend/src/modules/laboratory/model.js`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Modify: `frontend/src/modules/laboratory/page.vue`
- Modify: `frontend/src/modules/laboratory/styles.css`

- [ ] **Step 1: Add pure helpers that map tray statuses to workflow progress and write the next laboratory step into current task trays**
- [ ] **Step 2: Replace temporary in-memory workflow progression with `persistSnapshot` writes to `mes.samples`**
- [ ] **Step 3: Render recent task cards with centered enlarged text and full date-time ranges**
- [ ] **Step 4: Re-run targeted model/runtime tests**

## Chunk 7: Real-Time Sync And Dual Flow Layout

### Task 12: Add failing tests for real-time sample refresh and dual flow state

**Files:**
- Modify: `frontend/src/modules/laboratory/model.test.js`
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`
- Modify: `frontend/src/modules/samples/page.runtime.test.js`

- [ ] **Step 1: Write a failing model test proving the laboratory task flow reuses `aggregateTaskStatusFromSamples(...)` across all experiments and trays**
- [ ] **Step 2: Write a failing runtime test proving each laboratory step dispatches `mes:samples-updated` after persisting `mes.samples`**
- [ ] **Step 3: Write a failing runtime test proving the right-side tray flow can switch between trays from the same current experiment**
- [ ] **Step 4: Run the targeted tests to verify they fail for the expected reasons**

## Chunk 8: Explicit Start Semantics

### Task 13: Add failing tests for explicit experiment start semantics

**Files:**
- Modify: `frontend/src/modules/tasks/model.test.js`
- Modify: `frontend/src/modules/schedule/model.test.js`
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`
- Modify: `frontend/src/modules/laboratory/model.test.js`
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`

- [x] **Step 1: Write failing tests proving pre-start tray statuses remain scheduled**
- [x] **Step 2: Run targeted tests to verify they fail under the old time-driven behavior**

### Task 14: Implement strict click-to-start status propagation

**Files:**
- Modify: `frontend/src/modules/tasks/model.js`
- Modify: `frontend/src/modules/schedule/model.js`
- Modify: `frontend/src/modules/process/model.js`
- Modify: `frontend/src/modules/laboratory/model.js`
- Modify: `frontend/src/modules/laboratory/page.vue`

- [x] **Step 1: Restrict task-level `实验中` aggregation to truly started trays only**
- [x] **Step 2: Keep active schedule windows at `已排程` until process control explicitly starts the experiment**
- [x] **Step 3: Rename salt-spray console wording from “开始实验” to “确认实验准备就绪”**
- [x] **Step 4: Re-run affected task, schedule, process, laboratory, and samples test suites**

### Task 13: Implement event dispatch, enlarged task rows, and dual flow rendering

**Files:**
- Modify: `frontend/src/modules/laboratory/model.js`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Modify: `frontend/src/modules/laboratory/page.vue`
- Modify: `frontend/src/modules/laboratory/styles.css`

- [ ] **Step 1: Add view helpers for current-experiment tray tabs and single-tray flow state while reusing the central task-flow aggregation rules**
- [ ] **Step 2: Dispatch `mes:samples-updated` after every successful laboratory step persistence**
- [ ] **Step 3: Rebuild the task-list modal into an enlarged single-row layout with full-row selected highlighting**
- [ ] **Step 4: Replace the bottom progress panel with left task-flow and right tray-flow columns, including same-experiment tray switching**
- [ ] **Step 5: Re-run the targeted model/runtime tests until green**

## Chunk 8: Verification

### Task 14: Run focused regression verification for laboratory and tray management sync

**Files:**
- Verify only

- [ ] **Step 1: Run `npm run test:run -- src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js src/modules/samples/page.runtime.test.js` from `frontend/`**
- [ ] **Step 2: Run `npm run test:run -- src/modules/modules.structure.test.js src/modules/moduleStyles.structure.test.js src/auth.test.js src/lib/authRouting.test.js src/App.runtime.test.js src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js` from `frontend/`**
- [ ] **Step 3: Summarize the task-flow rule alignment, tray-flow switching behavior, and real-time refresh verification evidence**
