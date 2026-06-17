# Visualization Screen 4 Current Lab Tasks Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace visualization screen 4 with the approved current-lab-task matrix and synchronize status with the existing laboratory and device models.

**Architecture:** Add a focused visualization model that composes `buildLaboratoryWorkbenchView` and `buildDeviceRows` for each lab. Render the result through a new screen component in `page.vue`, keeping the visual styling in `styles.css`.

**Tech Stack:** Vue 3, Vite/Vitest, existing storage snapshot keys, existing laboratory/device model functions.

---

## Chunk 1: Model And Rendering

### Task 1: Build The Current Lab Task Model

**Files:**
- Create: `frontend/src/modules/visualization/labCurrentTasksModel.js`
- Modify: `frontend/src/modules/visualization/model.js`
- Test: `frontend/src/modules/visualization/model.test.js`

- [x] **Step 1: Write failing tests**
- [x] **Step 2: Run focused model tests and verify failure**
- [x] **Step 3: Implement the model using existing laboratory/device services**
- [x] **Step 4: Re-run focused model tests and verify pass**

### Task 2: Render Screen 4

**Files:**
- Modify: `frontend/src/modules/visualization/page.vue`
- Modify: `frontend/src/modules/visualization/styles.css`
- Test: `frontend/src/modules/visualization/page.runtime.test.js`
- Test: `frontend/src/modules/visualization/styles.test.js`

- [x] **Step 1: Write failing runtime/style tests for screen 4**
- [x] **Step 2: Run focused tests and verify failure**
- [x] **Step 3: Replace screen 4 placeholder with the matrix component**
- [x] **Step 4: Add styles for state tones and running-only countdown**
- [x] **Step 5: Re-run focused tests and verify pass**

### Task 3: Regression Verification

**Files:**
- Test: `frontend/src/modules/visualization/model.test.js`
- Test: `frontend/src/modules/visualization/page.runtime.test.js`
- Test: `frontend/src/modules/visualization/styles.test.js`

- [x] **Step 1: Run focused visualization tests**

Run: `rtk npm run test:run -- src/modules/visualization/model.test.js src/modules/visualization/page.runtime.test.js src/modules/visualization/styles.test.js`

- [x] **Step 2: Run broader frontend test command if focused tests pass**

Run: `rtk npm run test:run -- src/modules/visualization`
