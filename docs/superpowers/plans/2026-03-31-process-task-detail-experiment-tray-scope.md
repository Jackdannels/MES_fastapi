# Process Task Detail Experiment Tray Scope Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the process-control task detail modal show only the trays and samples assigned to the currently scheduled experiment instead of every tray under the task.

**Architecture:** Keep the fix local to `useProcessLabs`. Pass the active schedule's `experiment_code` into task-detail construction, derive the active experiment tray set from `mes.experiment_trays`, and filter all tray/sample summary areas through that set. Preserve the current task-level fallback when no experiment tray mapping exists.

**Tech Stack:** Vue 3 composables, Vitest, existing process-control runtime/composable tests.

---

## Chunk 1: Lock the Bug With Tests

### Task 1: Add failing composable coverage for experiment-scoped trays

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`

- [ ] **Step 1: Write the failing test**

Add a test where:
- one task has one schedule in a lab for experiment `A`
- `mes.experiment_trays` maps `A -> TP-001/TP-002` and another experiment `B -> TP-003`
- task samples exist across all three trays

Assert that after opening the task drawer:
- `trayCodes` only contain `TP-001/TP-002`
- `trayCount` is `2`
- selected/remaining/running tray rows only contain experiment `A` trays
- displayed sample list only contains samples from `TP-001/TP-002`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/process/useProcessLabs.test.js`

Expected: FAIL because current logic aggregates by task.

### Task 2: Add fallback coverage for missing experiment tray mappings

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`

- [ ] **Step 1: Write the failing-or-protective test**

Add a test showing that when the selected schedule has no `experiment_trays` rows, the existing task-level tray summary remains available.

- [ ] **Step 2: Run the focused test file**

Run: `npm run test:run -- src/modules/process/useProcessLabs.test.js`

Expected: either the new fallback test passes already or the file still fails only on the new scoped-tray case.

## Chunk 2: Minimal Fix

### Task 3: Filter task detail trays by current experiment

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.js`

- [ ] **Step 1: Implement the smallest change**

Update task-detail construction so it:
- keeps the selected schedule's `experiment_code`
- builds a tray-code set from `experimentTrays` for that `task_code + experiment_code`
- filters `collectTaskTrayCodes`, `buildTrayRows`, and selected tray/sample derivation through that set when present
- falls back to the current task-level logic when the set is empty

- [ ] **Step 2: Run the focused composable test**

Run: `npm run test:run -- src/modules/process/useProcessLabs.test.js`

Expected: PASS

### Task 4: Verify runtime rendering expectations still hold

**Files:**
- Modify only if necessary: `frontend/src/modules/process/page.runtime.test.js`

- [ ] **Step 1: Update runtime test doubles/assertions if the filtered tray counts change**

Only adjust runtime tests if the new scoped behavior changes existing test-double expectations.

- [ ] **Step 2: Run runtime verification**

Run: `npm run test:run -- src/modules/process/page.runtime.test.js src/modules/process/useProcessLabs.test.js`

Expected: PASS

## Chunk 3: Final Verification

### Task 5: Run module regression

**Files:**
- Verify only

- [ ] **Step 1: Run process module tests**

Run: `npm run test:run -- src/modules/process`

Expected: PASS

- [ ] **Step 2: Re-run adjacent schedule/process tests if needed**

Run: `npm run test:run -- src/modules/process src/modules/schedule/page.runtime.test.js`

Expected: PASS

- [ ] **Step 3: Summarize the exact behavior change**

Record that task detail tray/sample summaries are now experiment-scoped with task-level fallback for unmapped legacy data.
