# Staging Management Real Data Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the staging page's static tray data with real storage-derived trays, update the KPI/filter behavior, and keep the tray panel fixed at five rows while scan actions remain barcode-only.

**Architecture:** Derive staging tray rows in the front-end from `mes.tasks`, `mes.samples`, and a new `mes.staging_events` storage collection. Persist scan in/out operations by appending staging events through the existing storage API, then rebuild the page view model from snapshot data so KPI totals, filters, and pagination stay consistent.

**Tech Stack:** Vue 3, Vitest, existing storage API (`/api/storage`), FastAPI storage key registry

---

## Chunk 1: Storage Contract

### Task 1: Add the staging events storage key

**Files:**
- Modify: `app/core/storage_backend.py`
- Modify: `frontend/src/lib/storageKeys.js`
- Test: `frontend/src/lib/storageApi.test.js`

- [ ] **Step 1: Write the failing test**

Add a storage API expectation that `mes.staging_events` survives snapshot reads.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/storageApi.test.js`
Expected: FAIL because the new storage key is missing from the snapshot contract.

- [ ] **Step 3: Write minimal implementation**

Add `mes.staging_events` to the backend and frontend storage key registries.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/storageApi.test.js`
Expected: PASS

## Chunk 2: Staging Model

### Task 2: Replace static rows with snapshot-derived rows

**Files:**
- Modify: `frontend/src/modules/staging-management/model.js`
- Test: `frontend/src/modules/staging-management/model.test.js`

- [ ] **Step 1: Write the failing test**

Add model tests for:
- deriving tray rows from `tasks`, `samples`, `staging_events`
- using real `task_code`
- mapping statuses to `待入库 / 已入库 / 已出库`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/staging-management/model.test.js`
Expected: FAIL because the model still returns static rows.

- [ ] **Step 3: Write minimal implementation**

Create snapshot-based helpers that:
- group samples by tray
- locate task/sample metadata
- summarize latest staging event per tray
- build page rows and metrics

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/staging-management/model.test.js`
Expected: PASS

### Task 3: Add KPI filter and fixed five-row paging behavior

**Files:**
- Modify: `frontend/src/modules/staging-management/model.js`
- Test: `frontend/src/modules/staging-management/model.test.js`

- [ ] **Step 1: Write the failing test**

Add model tests for:
- `今日已入库` filter
- `今日已出库` filter
- `暂存间中样品数量` filter
- paging at 5 rows per page

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/staging-management/model.test.js`
Expected: FAIL because the model has no KPI filter mode or 5-row viewport contract.

- [ ] **Step 3: Write minimal implementation**

Add filter mode handling and set the viewport page size contract to five tray rows.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/staging-management/model.test.js`
Expected: PASS

### Task 4: Persist staging stock-in and stock-out events

**Files:**
- Modify: `frontend/src/modules/staging-management/model.js`
- Test: `frontend/src/modules/staging-management/model.test.js`

- [ ] **Step 1: Write the failing test**

Add model tests proving:
- stock-in appends a `stock_in` event
- stock-out appends a `stock_out` event
- metrics update from event timestamps, not from overwritten status text

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/staging-management/model.test.js`
Expected: FAIL because current actions mutate static row status only.

- [ ] **Step 3: Write minimal implementation**

Return updated `stagingEvents` collections from the action helper alongside derived rows.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/staging-management/model.test.js`
Expected: PASS

## Chunk 3: Page Integration

### Task 5: Load storage snapshot and rebuild the page from real data

**Files:**
- Modify: `frontend/src/modules/staging-management/page.vue`
- Test: `frontend/src/modules/staging-management/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add runtime coverage that mounts the page with storage-backed tasks, samples, and staging events and expects the real `SYLU` task code to appear.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/staging-management/page.runtime.test.js`
Expected: FAIL because the page still mounts static rows.

- [ ] **Step 3: Write minimal implementation**

Use `readStorageSnapshot` on mount and rebuild page state from the returned snapshot.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/staging-management/page.runtime.test.js`
Expected: PASS

### Task 6: Turn the KPI cards into clickable filters and keep the tray panel fixed

**Files:**
- Modify: `frontend/src/modules/staging-management/page.vue`
- Modify: `frontend/src/modules/staging-management/styles.css`
- Test: `frontend/src/modules/staging-management/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add runtime tests for:
- clicking KPI cards only filters the middle list
- the scan buttons remain present after filter changes
- the tray table shows at most five rows per page

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/staging-management/page.runtime.test.js`
Expected: FAIL because KPI cards are not interactive and page size is still six.

- [ ] **Step 3: Write minimal implementation**

Convert the cards to filter buttons, add active state, and style the center panel to reserve five-row height.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/staging-management/page.runtime.test.js`
Expected: PASS

### Task 7: Keep scan flows barcode-only and auto-focus the input

**Files:**
- Modify: `frontend/src/modules/staging-management/page.vue`
- Test: `frontend/src/modules/staging-management/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add runtime tests proving:
- clicking a tray row does not open scan modals or fill scan input
- opening `扫码入库 / 扫码出库` auto-focuses the input field

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/staging-management/page.runtime.test.js`
Expected: FAIL because focus is not explicitly managed and row click behavior is unprotected.

- [ ] **Step 3: Write minimal implementation**

Add autofocus management with a template ref and keep list rows display-only.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/staging-management/page.runtime.test.js`
Expected: PASS

## Chunk 4: Final Verification

### Task 8: Run focused verification

**Files:**
- Test: `frontend/src/lib/storageApi.test.js`
- Test: `frontend/src/modules/staging-management/model.test.js`
- Test: `frontend/src/modules/staging-management/page.runtime.test.js`

- [ ] **Step 1: Run the focused test suite**

Run: `npm run test:run -- src/lib/storageApi.test.js src/modules/staging-management/model.test.js src/modules/staging-management/page.runtime.test.js`
Expected: PASS with 0 failures.

- [ ] **Step 2: Review the changed behavior against the approved design**

Check:
- real `SYLU` task codes are shown
- KPI labels are `暂存间中样品数量 / 今日已入库 / 今日已出库`
- KPI clicks only filter the list
- tray panel stays at five rows with pagination
- scan input auto-focuses and remains barcode-only
