# Task Overview Summary Layout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update task overview so experiment information is shown per experiment row, tray allocation is shown per tray row, and both overview tables fit a desktop page more reasonably.

**Architecture:** Extend the task overview view model to expose normalized per-experiment status lines derived from experiments, schedules, and task/sample fallback state. Keep the page structure intact, but change the summary table cells from single-line text to stacked line groups and rebalance CSS widths for the summary and tray tables.

**Tech Stack:** Vue 3, Vitest, Vite, CSS

---

## Chunk 1: Model and Summary Table

### Task 1: Add failing model tests for experiment line summaries

**Files:**
- Modify: `frontend/src/modules/task-overview/model.test.js`
- Test: `frontend/src/modules/task-overview/model.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `npm run test:run -- src/modules/task-overview/model.test.js` to verify it fails**
- [ ] **Step 3: Implement minimal model changes in `frontend/src/modules/task-overview/model.js`**
- [ ] **Step 4: Run `npm run test:run -- src/modules/task-overview/model.test.js` to verify it passes**

### Task 2: Add failing component tests for multi-line summary rendering

**Files:**
- Modify: `frontend/src/modules/task-overview/TaskOverviewSummaryTable.test.js`
- Modify: `frontend/src/modules/task-overview/TaskOverviewTrayTable.test.js`
- Test: `frontend/src/modules/task-overview/TaskOverviewSummaryTable.test.js`
- Test: `frontend/src/modules/task-overview/TaskOverviewTrayTable.test.js`

- [ ] **Step 1: Write the failing tests for updated headers and stacked line rendering**
- [ ] **Step 2: Run `npm run test:run -- src/modules/task-overview/TaskOverviewSummaryTable.test.js src/modules/task-overview/TaskOverviewTrayTable.test.js` to verify they fail**
- [ ] **Step 3: Implement minimal component changes in `frontend/src/modules/task-overview/TaskOverviewSummaryTable.vue` and `frontend/src/modules/task-overview/TaskOverviewTrayTable.vue`**
- [ ] **Step 4: Run the same Vitest command to verify it passes**

## Chunk 2: Styles and Verification

### Task 3: Rebalance table widths for single-page desktop viewing

**Files:**
- Modify: `frontend/src/modules/task-overview/styles.css`
- Test: `frontend/src/modules/task-overview/TaskOverviewSummaryTable.test.js`
- Test: `frontend/src/modules/task-overview/TaskOverviewTrayTable.test.js`

- [ ] **Step 1: Adjust summary and tray table widths to reduce over-compression**
- [ ] **Step 2: Preserve small-screen behavior for stacked content**
- [ ] **Step 3: Run `npm run test:run -- src/modules/task-overview/model.test.js src/modules/task-overview/TaskOverviewSummaryTable.test.js src/modules/task-overview/TaskOverviewTrayTable.test.js src/modules/task-overview/useTaskOverview.test.js`**
- [ ] **Step 4: If green, stop with the exact verification command/results recorded in the handoff**
