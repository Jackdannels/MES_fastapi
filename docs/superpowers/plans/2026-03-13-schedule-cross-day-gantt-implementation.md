# Schedule Cross-Day Gantt Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-day gantt bars and editable `planned_hours` scheduling without changing existing scheduling semantics.

**Architecture:** Keep the current Vue page/composable/model split. Put all time-span math and gantt segmentation in `schedulePageModel`, keep `useSchedulePage` responsible for form state and interactions, and keep `SchedulePage.vue` focused on rendering the new bar model.

**Tech Stack:** Vue 3, Vitest, Vite, plain CSS

---

## Chunk 1: Model time-span support

### Task 1: Add failing model tests for planned hours

**Files:**
- Modify: `frontend/src/lib/schedulePageModel.test.js`
- Modify: `frontend/src/lib/schedulePageModel.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run test to verify it passes**

### Task 2: Add failing model tests for cross-day gantt bars

**Files:**
- Modify: `frontend/src/lib/schedulePageModel.test.js`
- Modify: `frontend/src/lib/schedulePageModel.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run test to verify it passes**

## Chunk 2: Form and page integration

### Task 3: Add failing runtime tests for planned hours inputs

**Files:**
- Modify: `frontend/src/pages/SchedulePage.runtime.test.js`
- Modify: `frontend/src/pages/SchedulePage.vue`
- Modify: `frontend/src/composables/useSchedulePage.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run test to verify it passes**

### Task 4: Add failing runtime tests for cross-day bar rendering

**Files:**
- Modify: `frontend/src/pages/SchedulePage.runtime.test.js`
- Modify: `frontend/src/pages/SchedulePage.vue`
- Modify: `frontend/src/composables/useSchedulePage.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run test to verify it passes**

## Chunk 3: Verification

### Task 5: Run targeted and broader verification

**Files:**
- Test: `frontend/src/lib/schedulePageModel.test.js`
- Test: `frontend/src/pages/SchedulePage.runtime.test.js`

- [ ] **Step 1: Run targeted schedule tests**
  - `cd frontend && npm run test:run -- src/lib/schedulePageModel.test.js src/pages/SchedulePage.runtime.test.js`
- [ ] **Step 2: Run impacted regression tests**
  - `cd frontend && npm run test:run -- src/App.runtime.test.js src/lib/appConfig.test.js src/router/index.structure.test.js src/pages/TasksPage.runtime.test.js src/pages/SchedulePage.runtime.test.js src/lib/schedulePageModel.test.js`
- [ ] **Step 3: Run frontend build**
  - `cd frontend && npm run build`
