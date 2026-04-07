# Transfer Workbench Readonly Lock Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock tray allocation editing after save in both pre-allocation and handover workbenches until the operator explicitly resets the workspace, while permanently blocking reset for tasks whose trays have already entered experiment execution.

**Architecture:** Extend the shared transfer workbench lock model so `allocationSaved` becomes a first-class readonly condition, then add a backend-derived permanent lock for stored tasks with started experiment trays. The frontend consumes the new metadata from `/api/transfer-area/bootstrap` and `/workspace`, while `/reload` enforces the same rule server-side.

**Tech Stack:** Vue 3, Vue Test Utils, Vitest, FastAPI, Pytest

---

## Chunk 1: Runtime Coverage

### Task 1: Pre-allocation readonly regression test

**Files:**
- Modify: `frontend/src/modules/samples/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `npm run test:run -- src/modules/samples/page.runtime.test.js -t "pre-allocation becomes read-only after saving until reallocate is clicked"` and verify it fails**
- [ ] **Step 3: Assert saved state disables add/remove/drag and reset restores editing**
- [ ] **Step 4: Re-run the targeted test and verify it passes**

### Task 2: Handover readonly regression test

**Files:**
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `npm run test:run -- src/modules/handover-system/page.runtime.test.js -t "handover allocation becomes read-only after saving until re-entry is clicked"` and verify it fails**
- [ ] **Step 3: Assert saved state blocks add/move and reset restores editing**
- [ ] **Step 4: Re-run the targeted test and verify it passes**

## Chunk 2: Shared Workbench Lock

### Task 3: Promote saved allocation to readonly state

**Files:**
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`

- [ ] **Step 1: Introduce a dedicated readonly computed based on `allocationSaved` and stored-task state**
- [ ] **Step 2: Apply that lock to drag, click-move, tray creation/deletion, tray limit controls, and experiment tray toggles**
- [ ] **Step 3: Keep reset and print flows available**
- [ ] **Step 4: Re-run the two targeted tests and verify they pass**

## Chunk 3: Verification

### Task 4: Run focused regression suite

**Files:**
- Verify: `frontend/src/modules/samples/page.runtime.test.js`
- Verify: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Run `npm run test:run -- src/modules/samples/page.runtime.test.js src/modules/handover-system/page.runtime.test.js`**
- [ ] **Step 2: Run `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.vue` only if a dedicated runtime suite exists; otherwise skip**
- [ ] **Step 3: Record the verification command and outcome**

## Chunk 4: Started-Experiment Reset Lock

### Task 5: Add backend regression coverage for started stored tasks

**Files:**
- Modify: `tests/api/test_transfer_area.py`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `.\.venv\Scripts\python.exe -m pytest tests/api/test_transfer_area.py -k "keeps_started_stored_tasks_visible_and_rejects_reload" -q` and verify it fails**
- [ ] **Step 3: Assert the task stays visible in bootstrap/workspace and `/reload` returns 400 once any tray enters experiment execution**
- [ ] **Step 4: Re-run the targeted test and verify it passes**

### Task 6: Surface and enforce the permanent reload lock

**Files:**
- Modify: `app/api/routes/transfer_area.py`
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
- Test: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

- [ ] **Step 1: Derive a started-experiment lock from existing task/sample/tray statuses**
- [ ] **Step 2: Keep stored started tasks visible in bootstrap and workspace responses**
- [ ] **Step 3: Return task-level lock metadata and reject `/reload` with a clear message**
- [ ] **Step 4: Make the shared workbench consume that metadata, keep printing available, and disable `重新分配 / 重新入库` with a visible reason**
- [ ] **Step 5: Run `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js -t "started stored tasks stay visible and block re-entry in pre-allocation mode"` and verify it passes**
