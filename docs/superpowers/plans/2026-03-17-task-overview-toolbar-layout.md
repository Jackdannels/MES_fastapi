# Task Overview Toolbar Layout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the task/tray mode switch beside the overview counter on desktop while preserving usable wrapping on narrow screens.

**Architecture:** Keep the existing toolbar logic intact and only adjust the toolbar DOM grouping plus the task-overview module CSS. Protect the layout move with a focused component test that verifies where the mode switch renders.

**Tech Stack:** Vue 3, module-scoped CSS, Vitest, Vue Test Utils

---

## Chunk 1: Toolbar Structure And Responsive Layout

### Task 1: Guard the intended DOM placement

**Files:**
- Modify: `frontend/src/modules/task-overview/TaskOverviewToolbar.test.js`
- Test: `frontend/src/modules/task-overview/TaskOverviewToolbar.test.js`

- [x] **Step 1: Write the failing test**

Add a test asserting `.task-overview-heading .task-overview-mode-switch` exists and `.task-overview-actions .task-overview-mode-switch` does not exist.

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/task-overview/TaskOverviewToolbar.test.js`
Expected: FAIL because the mode switch still renders inside the filter action container.

- [x] **Step 3: Write minimal implementation**

Move the mode-switch markup into the heading section and add a wrapper that groups the counter with the tabs.

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/task-overview/TaskOverviewToolbar.test.js`
Expected: PASS

### Task 2: Preserve narrow-screen usability

**Files:**
- Modify: `frontend/src/modules/task-overview/styles.css`
- Test: `frontend/src/modules/task-overview/TaskOverviewToolbar.test.js`

- [x] **Step 1: Write the failing test**

Reuse the same structural test as the guard for the layout move; the CSS task is constrained to keep right-side controls from being forced into the same row on small widths.

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/task-overview/TaskOverviewToolbar.test.js`
Expected: FAIL before the component structure changes.

- [x] **Step 3: Write minimal implementation**

Allow header wrapping, keep desktop actions right-aligned, and switch the action area to full-width left-aligned flow under the existing mobile breakpoint.

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/task-overview/TaskOverviewToolbar.test.js`
Expected: PASS with all existing toolbar interaction tests still green.
