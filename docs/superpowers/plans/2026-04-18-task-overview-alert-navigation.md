# Task Overview Alert Navigation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `任务/托盘总览` alert dot navigate to the lowest overdue task card, flash that card without selecting it, and simplify the dashboard unscheduled timer display.

**Architecture:** Extract the overdue-task selection logic into a small shared helper used by `App.vue` for alert-dot routing. Let `useTaskOverview` consume a short-lived `highlightTask` query to scroll and flash the matching card, then clear the query. Keep the dashboard display change local to the page and styles.

**Tech Stack:** Vue 3, Vue Router, Vitest, Vue Test Utils

---

## Chunk 1: Alert Target Resolution

### Task 1: Add failing tests for overdue task selection and nav click behavior

**Files:**
- Modify: `frontend/src/App.runtime.test.js`
- Create: `frontend/src/lib/taskOverviewAlerts.test.js`

- [ ] Step 1: Write failing tests for overdue task sorting and nav click routing
- [ ] Step 2: Run `npm run test -- src/App.runtime.test.js src/lib/taskOverviewAlerts.test.js`
- [ ] Step 3: Confirm failures come from missing helper/behavior

### Task 2: Implement shared alert helper and App nav handling

**Files:**
- Create: `frontend/src/lib/taskOverviewAlerts.js`
- Modify: `frontend/src/App.vue`

- [ ] Step 1: Implement helper to compute overdue waiting task codes with formal-schedule exclusion
- [ ] Step 2: Reuse helper in `App.vue` for red-dot visibility and click routing
- [ ] Step 3: Re-run `npm run test -- src/App.runtime.test.js src/lib/taskOverviewAlerts.test.js`

## Chunk 2: Task Overview Highlight

### Task 3: Add failing tests for route-driven scroll and flash

**Files:**
- Modify: `frontend/src/modules/task-overview/useTaskOverview.test.js`

- [ ] Step 1: Add a composable runtime test for `highlightTask`
- [ ] Step 2: Run `npm run test -- src/modules/task-overview/useTaskOverview.test.js`
- [ ] Step 3: Confirm the new test fails before implementation

### Task 4: Implement highlight query handling in task overview

**Files:**
- Modify: `frontend/src/modules/task-overview/useTaskOverview.js`
- Modify: `frontend/src/modules/task-overview/styles.css`

- [ ] Step 1: Add route-query consumption, scroll, temporary flash class, and query cleanup
- [ ] Step 2: Keep `selectedTaskCode` untouched during highlight
- [ ] Step 3: Re-run `npm run test -- src/modules/task-overview/useTaskOverview.test.js`

## Chunk 3: Dashboard Timer Presentation

### Task 5: Add failing tests for simplified unscheduled timer display

**Files:**
- Modify: `frontend/src/modules/dashboard/page.runtime.test.js`

- [ ] Step 1: Add assertions that experiment code line is removed
- [ ] Step 2: Add assertions that overdue title and timer both use overdue styling
- [ ] Step 3: Run `npm run test -- src/modules/dashboard/page.runtime.test.js`

### Task 6: Implement dashboard title styling changes

**Files:**
- Modify: `frontend/src/modules/dashboard/page.vue`
- Modify: `frontend/src/modules/dashboard/styles.css`

- [ ] Step 1: Remove the experiment code row from the template
- [ ] Step 2: Apply overdue class to the title line and timer
- [ ] Step 3: Re-run `npm run test -- src/modules/dashboard/page.runtime.test.js`

## Chunk 4: Final Verification

### Task 7: Run targeted regression checks

**Files:**
- Verify only

- [ ] Step 1: Run `npm run test -- src/App.runtime.test.js src/lib/taskOverviewAlerts.test.js src/modules/task-overview/useTaskOverview.test.js src/modules/dashboard/page.runtime.test.js`
- [ ] Step 2: Review failures and fix if needed
- [ ] Step 3: Report verification evidence and any remaining environment limits
