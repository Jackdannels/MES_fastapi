# Transfer Barcode Real Payload Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every tray barcode encode the real tray number only, while preview/print text shows only `任务编号 | 样品数量：x`.

**Architecture:** Update the transfer-area backend payload generator first, then align transfer-workbench preview/print rendering to use the tray number as the single barcode value. Finally, update runtime/API tests so the barcode SVG payload and visible copy are locked to the new rule.

**Tech Stack:** FastAPI, Vue 3, Vitest, Pytest

---

## Chunk 1: Backend Payload Rule

### Task 1: Lock backend barcode payload to tray number

**Files:**
- Modify: `app/api/routes/transfer_area.py`
- Test: `tests/api/test_transfer_area.py`

- [ ] **Step 1: Write the failing test**

Add/adjust an API test so `/api/transfer-area/tasks/{task_id}/print-barcodes` expects `barcodeContent` to equal the tray number itself, not a `TRAY|...` string.

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/api/test_transfer_area.py -q`
Expected: FAIL on the old `barcodeContent` assertion.

- [ ] **Step 3: Write minimal implementation**

Update `build_barcode_payload(...)` and any later mutation of `barcode["barcodeContent"]` so tray barcode payloads persist only the tray number.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/api/test_transfer_area.py -q`
Expected: PASS

## Chunk 2: Frontend Preview And Print

### Task 2: Make preview and print use the real tray barcode value

**Files:**
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
- Test: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Write the failing tests**

Adjust runtime tests so they expect:

- preview barcode SVG `aria-label` equals the tray number
- printed barcode SVG `aria-label` equals the tray number
- visible content line equals `任务编号 | 样品数量：x`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/modules/handover-system/page.runtime.test.js`
Expected: FAIL on old `TRAY|TASK:...|LOAD:...` assertions and old preview copy.

- [ ] **Step 3: Write minimal implementation**

In `TransferWorkbench.vue`:

- feed `buildCode128Svg(...)` only the tray number
- derive the visible content string from current task number plus tray sample count
- remove sample-code long-string printing from the barcode preview/print content area

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/modules/handover-system/page.runtime.test.js`
Expected: PASS

## Chunk 3: Focused Verification

### Task 3: Verify all tray barcode paths use the new rule

**Files:**
- Verify: `app/api/routes/transfer_area.py`
- Verify: `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
- Verify: `frontend/src/modules/handover-system/page.runtime.test.js`
- Verify: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
- Verify: `tests/api/test_transfer_area.py`

- [ ] **Step 1: Run focused grep checks**

Run: `rg -n "TRAY\\|TASK:|TRAY\\|TRAY:|LOAD:" app frontend tests -g '!frontend/dist/**' -g '!frontend/node_modules/**'`
Expected: no remaining tray-barcode payload usage in production code or tray-barcode assertions.

- [ ] **Step 2: Run focused frontend and backend suites**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/modules/handover-system/page.runtime.test.js`

Run: `.\.venv\Scripts\python.exe -m pytest tests/api/test_transfer_area.py -q`

Expected: both commands PASS.
