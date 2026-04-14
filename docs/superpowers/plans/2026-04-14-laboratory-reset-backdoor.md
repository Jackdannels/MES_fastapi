# 盐雾试验室重置当前实验任务 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanently visible red reset button to the salt-spray laboratory console that double-confirms a dangerous rollback and resets only the current task's current-experiment trays back to `送至实验室`.

**Architecture:** Keep the reset scope and rollback rules in the laboratory model as pure functions so tray filtering remains tied to `currentTask.experimentCode` and `experiment_trays`. Keep button state, double-confirm modal flow, persistence, and event dispatch in `useLaboratoryPage`, while `page.vue` only renders the button and confirmation dialogs.

**Tech Stack:** Vue 3, Vue Test Utils, Vitest, existing storage snapshot helpers, `AppModal`

---

## Chunk 1: Reset Scope And Rollback Logic

### Task 1: Add failing model tests for experiment-scoped reset behavior

**Files:**
- Modify: `frontend/src/modules/laboratory/model.test.js`
- Modify: `frontend/src/modules/laboratory/model.js`

- [ ] **Step 1: Write the failing test**

Add model tests proving:
- only `currentTask.taskCode + currentTask.experimentCode` trays are reset
- other experiments under the same task are unchanged
- mixed-tray samples only reset the trays that belong to the current experiment

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/laboratory/model.test.js`
Expected: FAIL because no experiment-scoped reset helper exists yet.

- [ ] **Step 3: Write minimal implementation**

Add a pure helper in `frontend/src/modules/laboratory/model.js` that:
- collects current-experiment tray codes
- updates only those trays to `送至实验室`
- writes `实验任务重置` history
- leaves unrelated trays untouched

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/laboratory/model.test.js`
Expected: PASS

## Chunk 2: Reset Button And Double Confirmation Flow

### Task 2: Add failing runtime tests for the red reset button and modal chain

**Files:**
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`
- Modify: `frontend/src/modules/laboratory/page.vue`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Modify: `frontend/src/modules/laboratory/styles.css`

- [ ] **Step 1: Write the failing test**

Add runtime tests proving:
- the header shows `重置当前实验任务`
- the button is disabled during `实验进行中`
- clicking the button opens the first confirm modal
- the first confirm opens a second danger modal with the exact warning text

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: FAIL because the button and modal flow do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Update the page and composable to add:
- always-visible reset button in the header
- first standard confirmation modal
- second danger confirmation modal
- button disablement when `runningExperiment.active` or no current task

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: PASS

## Chunk 3: Persistence And Workflow Reopen

### Task 3: Add failing runtime coverage for actual reset persistence

**Files:**
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`

- [ ] **Step 1: Write the failing test**

Extend the runtime suite to prove that after the second confirmation:
- current-experiment trays roll back to `送至实验室`
- other experiments remain unchanged
- compare/install/ready buttons reopen to the pre-compare state
- `SAMPLES_UPDATED_EVENT` is dispatched exactly once

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: FAIL because no reset persistence is wired yet.

- [ ] **Step 3: Write minimal implementation**

Wire the reset action in `useLaboratoryPage.js` to:
- call the model helper
- persist `mes.samples`
- close both dialogs
- dispatch `SAMPLES_UPDATED_EVENT`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: PASS

## Chunk 4: Focused Verification

### Task 4: Run focused laboratory verification

**Files:**
- Verify only

- [ ] **Step 1: Run focused model verification**

Run: `npm run test:run -- src/modules/laboratory/model.test.js`
Expected: PASS

- [ ] **Step 2: Run focused runtime verification**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: PASS

- [ ] **Step 3: Review changed files**

Run: `git diff --stat -- frontend/src/modules/laboratory/model.js frontend/src/modules/laboratory/model.test.js frontend/src/modules/laboratory/page.vue frontend/src/modules/laboratory/page.runtime.test.js frontend/src/modules/laboratory/styles.css frontend/src/modules/laboratory/useLaboratoryPage.js`
Expected: only the reset-button implementation files are listed.
