# Process Current Experiment Label Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the process-control lab cards and task-detail drawer show only the currently scheduled experiment label instead of the task's full experiment-type summary.

**Architecture:** Keep the change local to the process module. Resolve the scheduled experiment name from `schedule.experiment_code` plus the loaded experiment list, use that for card `targetExperiment` and drawer `testType`, and preserve the existing task/lab fallback chain for legacy data.

**Tech Stack:** Vue 3 module state helpers, Vitest module/runtime tests.

---

### Task 1: Lock the display bug with tests

**Files:**
- Modify: `frontend/src/modules/process/model.test.js`
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`

- [ ] **Step 1: Write the failing tests**

Add coverage for:
- `buildProcessLabCards` returning the scheduled experiment label instead of task `test_type`
- `useProcessLabs` task detail returning the scheduled experiment label in `testType`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/modules/process/model.test.js src/modules/process/useProcessLabs.test.js`

Expected: FAIL because both surfaces still use task-level `test_type`.

### Task 2: Implement the minimal label-source fix

**Files:**
- Modify: `frontend/src/modules/process/model.js`
- Modify: `frontend/src/modules/process/useProcessLabs.js`

- [ ] **Step 1: Implement the smallest possible change**

Resolve the current experiment name by:
- reading the active/next schedule's `experiment_code`
- looking up the matching experiment row
- falling back to task `test_type`, then lab default type when absent

- [ ] **Step 2: Run focused tests**

Run: `npm run test:run -- src/modules/process/model.test.js src/modules/process/useProcessLabs.test.js`

Expected: PASS

### Task 3: Verify runtime behavior

**Files:**
- Modify only if needed: `frontend/src/modules/process/page.runtime.test.js`

- [ ] **Step 1: Update runtime expectations if visible text changed**

- [ ] **Step 2: Run process module regression**

Run: `npm run test:run -- src/modules/process`

Expected: PASS
