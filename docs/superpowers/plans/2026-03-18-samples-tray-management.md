# Samples Tray Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a temporary tray-management tab inside the samples page so users can list trays and update tray status with an inline dropdown.

**Architecture:** Keep the new feature inside the existing samples module. `samplesFlowModel.js` owns tray aggregation and update helpers, `useSamplesFlow.js` owns reactive state and persistence, and `page.vue` only renders the extra tab and table. Status changes continue to persist through the existing samples snapshot and global refresh event.

**Tech Stack:** Vue 3, composables, Vitest, existing samples module model helpers

---

## File Structure

- Modify: `frontend/src/modules/samples/samplesFlowModel.js`
  - Add tray-overview row builder and tray-status update helper
- Modify: `frontend/src/modules/samples/useSamplesFlow.js`
  - Add tray-overview reactive state and save action
- Modify: `frontend/src/modules/samples/page.vue`
  - Add `托盘总览` tab and tray management table
- Modify: `frontend/src/modules/samples/styles.css`
  - Add tray management table styles
- Modify: `frontend/src/modules/samples/samplesFlowModel.test.js`
  - Add unit coverage for tray aggregation and tray status update
- Modify: `frontend/src/modules/samples/page.runtime.test.js`
  - Add runtime coverage for tab switching and inline tray-status update

## Chunk 1: Tray Overview Model

### Task 1: Add tray overview helpers

**Files:**
- Modify: `frontend/src/modules/samples/samplesFlowModel.js`
- Test: `frontend/src/modules/samples/samplesFlowModel.test.js`

- [ ] **Step 1: Write the failing tests**

Add tests covering:

- tray rows aggregate multiple samples by `tray_code`
- tray rows expose `taskCode`, `taskName`, `testType`, `status`, `sampleCount`, `sampleCodes`
- updating a tray status updates the matching tray entries and all affected sample statuses

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:run -- src/modules/samples/samplesFlowModel.test.js`

Expected: FAIL because tray overview helpers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- `buildSamplesTrayOverviewView(...)`
- `updateTrayStatus(...)`

Keep the implementation tray-code-driven and snapshot-based.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:run -- src/modules/samples/samplesFlowModel.test.js`

Expected: PASS

## Chunk 2: Samples Page State

### Task 2: Wire tray overview state into the composable

**Files:**
- Modify: `frontend/src/modules/samples/useSamplesFlow.js`
- Test: `frontend/src/modules/samples/page.runtime.test.js`

- [ ] **Step 1: Write the failing runtime test**

Add runtime coverage that:

- switches to the new `托盘总览` tab
- renders at least one tray row
- changes tray status from the inline dropdown
- persists the updated tray/sample status into the samples store

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:run -- src/modules/samples/page.runtime.test.js`

Expected: FAIL because the tray-management tab and action do not exist yet.

- [ ] **Step 3: Write minimal implementation**

In `useSamplesFlow.js`:

- expose tray overview rows
- expose tray status options
- add `updateTrayStatusInline(trayCode, nextStatus)`
- persist via existing snapshot path and broadcast `mes:samples-updated`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:run -- src/modules/samples/page.runtime.test.js`

Expected: PASS

## Chunk 3: Samples Page UI

### Task 3: Render the tray management tab

**Files:**
- Modify: `frontend/src/modules/samples/page.vue`
- Modify: `frontend/src/modules/samples/styles.css`
- Test: `frontend/src/modules/samples/page.runtime.test.js`

- [ ] **Step 1: Extend the failing runtime test if needed**

Add assertions for:

- the new `samples-tab-trays` tab button
- the new `samples-trays-panel`
- inline tray status dropdown contents

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:run -- src/modules/samples/page.runtime.test.js`

Expected: FAIL until the view is rendered.

- [ ] **Step 3: Write minimal implementation**

In `page.vue` and `styles.css`:

- add the third tab
- add the tray table
- bind the dropdown to the composable action

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:run -- src/modules/samples/page.runtime.test.js`

Expected: PASS

## Chunk 4: Regression

### Task 4: Re-run focused samples regressions

**Files:**
- Test: `frontend/src/modules/samples/page.runtime.test.js`
- Test: `frontend/src/modules/samples/samplesFlowModel.test.js`
- Test: `frontend/src/modules/tasks/model.test.js`
- Test: `frontend/src/modules/task-overview/model.test.js`
- Test: `frontend/src/modules/process/useProcessLabs.test.js`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/samples/page.runtime.test.js src/modules/samples/samplesFlowModel.test.js src/modules/tasks/model.test.js src/modules/task-overview/model.test.js src/modules/process/useProcessLabs.test.js
```

Expected: PASS

- [ ] **Step 2: Fix any regressions uncovered**

Keep fixes limited to the samples/tray-management change surface.

- [ ] **Step 3: Re-run the same suite until green**

Run the same command again.

Expected: PASS

- [ ] **Step 4: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no patch-format errors beyond known line-ending warnings.
