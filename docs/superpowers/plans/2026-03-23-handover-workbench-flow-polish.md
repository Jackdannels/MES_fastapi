# Handover Workbench Flow Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the handover workbench so pagination stays anchored, tray allocation auto-rebalances around a default limit of four, saved reallocations restart task tray numbering from `TP-001` while clearing old transfer history, printing stays disabled until allocation is saved and then triggers the browser print flow, minimal tray layouts show a clear delete warning, the footer action label becomes `重新入库`, and saving tray allocation is enough to allow storage confirmation while disabling repeat saves until the next edit.

**Architecture:** Keep the existing handover page and API route, but tighten the workflow rules at both layers. The frontend owns presentation, auto-layout, and browser printing, while the backend owns persisted tray allocation, default tray-limit rules, and the relaxed confirm-storage gate.

**Tech Stack:** Vue 3, Vue Router, Vitest, FastAPI, pytest

---

## File Structure

- Modify: `frontend/src/modules/handover-system/page.vue`
  - Add auto-rebalance helpers, saved-reallocation renumbering, delete warning guards, hidden-frame print flow, save-to-confirm gate, renamed footer action, and overview layout hooks
- Modify: `frontend/src/modules/handover-system/styles.css`
  - Anchor pagination and support the revised overview/table layout
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`
  - Cover print triggering, auto-rebalance, tray deletion rebalance, and save-before-confirm behavior
- Modify: `frontend/src/modules/handover-system/styles.structure.test.js`
  - Lock in pagination layout hooks if needed
- Modify: `app/api/routes/transfer_area.py`
  - Change default tray limit to four, relax confirm-storage barcode requirements, and clear stale transfer history on reallocation
- Modify: `tests/api/test_transfer_area.py`
  - Cover new backend defaults and confirm-storage behavior

## Chunk 1: Backend Rule Changes

### Task 1: Lock backend defaults with failing tests

**Files:**
- Modify: `tests/api/test_transfer_area.py`
- Modify: `app/api/routes/transfer_area.py`

- [ ] **Step 1: Write the failing tests**

Add tests proving:

- pending task workspaces default to tray limit `4`
- confirm-storage succeeds after allocation even when no barcode has been printed

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
.\.venv\Scripts\python.exe -m pytest tests/api/test_transfer_area.py -q
```

Expected: FAIL because the backend still defaults to `2` and still requires printed barcodes.

- [ ] **Step 3: Write minimal implementation**

Update `transfer_area.py` so the default tray limit is `4` and confirm-storage only requires non-empty assigned trays.

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 2: Frontend Workflow Fixes

### Task 2: Lock the broken handover interactions with failing tests

**Files:**
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`
- Modify: `frontend/src/modules/handover-system/page.vue`

- [ ] **Step 1: Write the failing tests**

Add focused tests proving:

- clicking confirm print calls the browser print flow
- increasing tray limit rebalances samples into the minimum tray count in sequence
- deleting a non-empty tray rebalances remaining samples automatically
- deleting shows a warning when the current tray count is already minimal
- newly added trays keep task-local sequential numbering
- saved reallocations restart numbering from `TP-001`
- print stays disabled until tray allocation is saved
- saving tray allocation enables confirm-storage without requiring print and disables the save button until the next edit
- the detail footer action label is `重新入库`

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js
```

Expected: FAIL because the current page neither prints nor auto-rebalances, and confirm still depends on print confirmation.

- [ ] **Step 3: Write minimal implementation**

Implement tray rebalance helpers, saved-reallocation renumbering, minimal-delete warnings, hidden-frame printing, save-state tracking, the renamed footer action, and the relaxed confirm button gate in `page.vue`.

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

### Task 3: Lock overview pagination layout

**Files:**
- Modify: `frontend/src/modules/handover-system/styles.structure.test.js`
- Modify: `frontend/src/modules/handover-system/styles.css`

- [ ] **Step 1: Write the failing structure test**

Assert the overview shell uses a layout that reserves a stable footer region for pagination.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/handover-system/styles.structure.test.js
```

Expected: FAIL because the current styles do not explicitly anchor the pagination footer.

- [ ] **Step 3: Write minimal implementation**

Update the overview shell/table styles so pagination stays visually anchored at the bottom.

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 3: Focused Verification

### Task 4: Run targeted regressions and build verification

**Files:**
- Test: `tests/api/test_transfer_area.py`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`
- Test: `frontend/src/modules/handover-system/styles.structure.test.js`
- Test: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Run backend regression**

Run:

```bash
.\.venv\Scripts\python.exe -m pytest tests/api/test_transfer_area.py -q
```

Expected: PASS

- [ ] **Step 2: Run frontend regression**

Run:

```bash
npm --prefix frontend run test:run -- src/App.runtime.test.js src/modules/handover-system/page.runtime.test.js src/modules/handover-system/styles.structure.test.js
```

Expected: PASS

- [ ] **Step 3: Run production build**

Run:

```bash
npm --prefix frontend run build
```

Expected: PASS

- [ ] **Step 4: Run diff hygiene**

Run:

```bash
git diff --check -- frontend/src/modules/handover-system/page.vue frontend/src/modules/handover-system/page.runtime.test.js frontend/src/modules/handover-system/styles.css frontend/src/modules/handover-system/styles.structure.test.js app/api/routes/transfer_area.py tests/api/test_transfer_area.py
```

Expected: no patch-format errors
