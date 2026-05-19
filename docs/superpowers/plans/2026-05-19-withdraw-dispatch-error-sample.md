# Withdraw Dispatch Error Sample Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tray-level error-sample handling flow that can withdraw an unconfirmed outbound dispatch from handover or staging without corrupting tray flow diagrams.

**Architecture:** Add a dedicated `POST /api/transfer-area/trays/{tray_code}/withdraw-dispatch` endpoint that derives the prior station from current sample state and history. Shared frontend error handling UI will query a tray, show current state, require a red confirmation modal, then call the endpoint and refresh.

**Tech Stack:** FastAPI, pytest, Vue 3, Vitest, existing storage snapshot APIs.

---

### Task 1: Backend Withdraw API

**Files:**
- Modify: `tests/api/test_transfer_area.py`
- Modify: `app/api/routes/transfer_area.py`

- [ ] Write failing tests for handover dispatch withdrawal to `到货/接驳区`, staging dispatch withdrawal to `已到达暂存间/恒温恒湿间（暂存间）`, and laboratory-compared trays being rejected.
- [ ] Run `rtk pytest tests/api/test_transfer_area.py -q -k withdraw` and verify the tests fail because the route is missing.
- [ ] Implement `TrayWithdrawDispatchRequest`, current-state inspection, prior-station restore logic, and append-only `撤回出库` history.
- [ ] Run `rtk pytest tests/api/test_transfer_area.py -q -k withdraw` and verify the new tests pass.

### Task 2: Frontend Error Sample UI

**Files:**
- Modify: `frontend/src/modules/transfer-workbench/useTransferDispatch.js`
- Modify: `frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue`
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
- Modify: `frontend/src/App.vue`

- [ ] Write failing Vitest coverage for the handover error-sample button, query modal, withdraw button, and red confirmation modal.
- [ ] Add the handover header button before logout and wire the modal to the shared dispatch state.
- [ ] Add the staging header button before logout in `App.vue` and route it to the same tray-level modal behavior.
- [ ] Run targeted Vitest tests.

### Task 3: Verification

- [ ] Run backend targeted and transfer-area tests.
- [ ] Run frontend targeted transfer-workbench tests.
- [ ] Report any broader test gaps clearly.
