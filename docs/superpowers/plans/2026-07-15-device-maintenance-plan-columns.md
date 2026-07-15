# Device Maintenance Plan Columns Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display real planned maintenance start/end times in the device list instead of calibration dates.

**Architecture:** The devices model normalizes planned-maintenance fields into two display values. The page consumes those values, removes calibration sorting and display, and applies a constrained sequence column width.

**Tech Stack:** Vue 3, JavaScript, Vitest, CSS.

---

## Chunk 1: Real maintenance window display

### Task 1: Replace calibration row data and table columns

**Files:**
- Modify: `frontend/src/modules/devices/model.js`
- Modify: `frontend/src/modules/devices/model.test.js`
- Modify: `frontend/src/modules/devices/page.vue`
- Modify: `frontend/src/modules/devices/page.runtime.test.js`
- Modify: `frontend/src/modules/devices/styles.css`

- [ ] **Step 1: Write failing model and page tests**

Assert planned maintenance start/end values are displayed and non-planned/empty values are `/`; assert the page has the new headers and no calibration header.

- [ ] **Step 2: Run focused tests**

Run: `npm run test:run -- src/modules/devices/model.test.js src/modules/devices/page.runtime.test.js`

Expected: FAIL because the model still maps `next_cal` and the page still displays `下次校准`.

- [ ] **Step 3: Implement minimal model and page changes**

Remove `next_cal` mapping/sorting/display, add planned-start/end display fields, replace table cells and set a narrow first-column width.

- [ ] **Step 4: Run focused tests and production build**

Run: `npm run test:run -- src/modules/devices/model.test.js src/modules/devices/page.runtime.test.js && npm run build`

Expected: all selected tests and build pass.

Note: Do not create a git commit; project rules require explicit user authorization.
