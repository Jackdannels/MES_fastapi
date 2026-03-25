# Handover Transfer Area Replacement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing `接驳区系统` landing page with the packaged transfer-area workbench and wire its dedicated backend APIs into the current MES storage model.

**Architecture:** Keep the existing module entry and route stable, but swap the handover-system frontend to the packaged overview/detail workbench. Add a focused FastAPI `transfer-area` router that reads and writes the current `mes.tasks`, `mes.samples`, and `mes.schedules` snapshot so the new UI has one backend contract and still stays linked to the rest of the system.

**Tech Stack:** Vue 3, Vite, Vitest, FastAPI, existing JSON storage backend, pytest

---

## File Structure

- Modify: `frontend/src/modules/handover-system/index.js`
  - Keep route metadata aligned with the packaged page if needed
- Replace: `frontend/src/modules/handover-system/page.vue`
  - Mount the packaged transfer-area overview/detail UI
- Replace: `frontend/src/modules/handover-system/styles.css`
  - Bring in the packaged transfer-area visual system
- Replace: `frontend/src/modules/handover-system/page.runtime.test.js`
  - Cover the new overview/detail interactions
- Create: `app/api/routes/transfer_area.py`
  - Implement the dedicated transfer-area endpoints
- Modify: `app/modules/registry.py`
  - Register the new API router under the handover-system module
- Create: `tests/api/test_transfer_area.py`
  - Cover bootstrap, workspace, allocate, print, confirm, and reload flows
- Modify: `tests/web/test_spa_routes.py`
  - Ensure `/handover-system` stays covered in the SPA route list if needed

## Chunk 1: Backend Contract

### Task 1: Add failing API tests for the transfer-area surface

**Files:**
- Create: `tests/api/test_transfer_area.py`

- [ ] **Step 1: Write the failing test**

Add tests for:

- `GET /api/transfer-area/bootstrap`
- `GET /api/transfer-area/tasks/{task_id}/workspace`
- `POST /api/transfer-area/tasks/{task_id}/allocate`
- `POST /api/transfer-area/tasks/{task_id}/print-barcodes`
- `POST /api/transfer-area/tasks/{task_id}/confirm-storage`
- `POST /api/transfer-area/tasks/{task_id}/reload`

Use storage-backed fixtures that prove task filtering, tray allocation, barcode preview, stored-state transition, and reload behavior.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/api/test_transfer_area.py -q
```

Expected: FAIL because the route file and endpoints do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/routes/transfer_area.py` with the six endpoints and enough helper functions to:

- read current tasks, samples, and schedules
- compute overview task rows and counts
- build task workspace payloads
- persist allocation changes
- create barcode preview payloads
- confirm storage
- reload a stored task back to pending workbench state

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pytest tests/api/test_transfer_area.py -q
```

Expected: PASS

### Task 2: Register the new backend router

**Files:**
- Modify: `app/modules/registry.py`
- Test: `tests/api/test_router_registry.py`

- [ ] **Step 1: Write the failing test**

Add or adjust router registry coverage so the transfer-area router is part of the API registry for the handover-system module.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/api/test_router_registry.py -q
```

Expected: FAIL because the new router is not registered yet.

- [ ] **Step 3: Write minimal implementation**

Import the new router and add it to the `handover-system` module declaration in `app/modules/registry.py`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pytest tests/api/test_router_registry.py -q
```

Expected: PASS

## Chunk 2: Frontend Workbench Replacement

### Task 3: Add failing runtime tests for the packaged handover page

**Files:**
- Replace: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Use the packaged runtime scenarios to cover:

- overview summary rendering
- opening a task into detail view
- moving or swapping samples across trays
- printing barcodes and confirming print
- confirming storage
- reloading a stored task back to pending state

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js
```

Expected: FAIL because the current page is still the old reused samples-process UI.

- [ ] **Step 3: Write minimal implementation**

Replace the current handover page and styles with the packaged transfer-area page while keeping the route path and module metadata stable.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js
```

Expected: PASS

## Chunk 3: Focused Integration Regression

### Task 4: Verify SPA and API integration

**Files:**
- Test: `tests/web/test_spa_routes.py`
- Test: `tests/api/test_transfer_area.py`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Run the focused backend regression**

Run:

```bash
pytest tests/api/test_transfer_area.py tests/api/test_router_registry.py tests/web/test_spa_routes.py -q
```

Expected: PASS

- [ ] **Step 2: Run the focused frontend regression**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js
```

Expected: PASS

- [ ] **Step 3: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no patch-format errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/routes/transfer_area.py app/modules/registry.py tests/api/test_transfer_area.py frontend/src/modules/handover-system/index.js frontend/src/modules/handover-system/page.vue frontend/src/modules/handover-system/styles.css frontend/src/modules/handover-system/page.runtime.test.js docs/superpowers/specs/2026-03-23-handover-transfer-area-replacement-design.md docs/superpowers/plans/2026-03-23-handover-transfer-area-replacement.md
git commit -m "feat: replace handover transfer area workbench"
```
