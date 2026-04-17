# Task Overview And Dashboard Unscheduled Consistency Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make experiment-level scheduling status accurate, standardize task arrival state on `transfer_status`, and unify overdue-unscheduled behavior across task overview, dashboard, and navigation.

**Architecture:** Keep the existing module boundaries. Fix the behavior in the smallest responsible places: task-overview model for experiment status derivation, dashboard model for unscheduled timer derivation, and `App.vue` for navigation alert derivation. Protect the changes with focused regression tests first.

**Tech Stack:** Vue 3, Vitest, localStorage-backed snapshot composables

---

## Chunk 1: Regression Tests

### Task 1: Lock task-overview experiment status behavior

**Files:**
- Modify: `frontend/src/modules/task-overview/model.test.js`
- Test: `frontend/src/modules/task-overview/model.test.js`

- [ ] Add a failing test where one experiment has a formal schedule and a sibling experiment does not.
- [ ] Run: `npm run test -- src/modules/task-overview/model.test.js`
- [ ] Confirm the new assertion fails because the unscheduled experiment is incorrectly shown as scheduled.

### Task 2: Lock dashboard unscheduled timer behavior

**Files:**
- Modify: `frontend/src/modules/dashboard/model.test.js`
- Test: `frontend/src/modules/dashboard/model.test.js`

- [ ] Add a failing test proving only experiments without a formal schedule appear in `unscheduledExperimentItems`.
- [ ] Run: `npm run test -- src/modules/dashboard/model.test.js`
- [ ] Confirm the new assertion fails for the current implementation.

## Chunk 2: Minimal Implementation

### Task 3: Fix experiment-level status derivation

**Files:**
- Modify: `frontend/src/modules/task-overview/model.js`

- [ ] Remove task-level scheduled fallback from experiment display status when the specific experiment has no formal schedule.
- [ ] Standardize task stored detection to `transfer_status`.
- [ ] Re-run: `npm run test -- src/modules/task-overview/model.test.js`

### Task 4: Fix dashboard unscheduled timer derivation

**Files:**
- Modify: `frontend/src/modules/dashboard/model.js`

- [ ] Filter `unscheduledExperimentItems` by experiment-level formal schedule absence.
- [ ] Keep the 24-hour overdue threshold unchanged.
- [ ] Re-run: `npm run test -- src/modules/dashboard/model.test.js`

### Task 5: Fix nav alert derivation

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/App.runtime.test.js`

- [ ] Reuse the same `transfer_status`-based overdue-unscheduled detection in the app shell.
- [ ] Add or update a runtime test proving the red dot appears for overdue unscheduled experiments.
- [ ] Re-run: `npm run test -- src/App.runtime.test.js`

## Chunk 3: Verification

### Task 6: Run the focused regression suite

**Files:**
- Test: `frontend/src/modules/task-overview/model.test.js`
- Test: `frontend/src/modules/dashboard/model.test.js`
- Test: `frontend/src/App.runtime.test.js`
- Test: `frontend/src/modules/dashboard/useDashboardPage.test.js`

- [ ] Run: `npm run test -- src/modules/task-overview/model.test.js src/modules/dashboard/model.test.js src/App.runtime.test.js src/modules/dashboard/useDashboardPage.test.js`
- [ ] Confirm all targeted tests pass cleanly.
