# Handover Dispatch Workbench Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `任务总览 / 样品出库` switching to the handover workbench and implement tray-based outbound dispatch from the transfer area to staging or scheduled labs.

**Architecture:** Keep `TransferWorkbench` as the handover shell, extract the new outbound flow into a dedicated dispatch panel, and add two transfer-area tray dispatch endpoints that resolve tray candidates from experiments plus schedules. Persist outbound changes through the existing sample/tray storage model so downstream process pages can consume the updated statuses without a schema rewrite.

**Tech Stack:** Vue 3, Vitest, Vite, FastAPI, pytest, existing transfer-area storage snapshot model

---

## File Structure

### Existing files to modify

- `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
  Responsibility: handover shell, top actions, view switching, existing overview/detail workbench.
- `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
  Responsibility: runtime coverage for header actions, overview/detail flow, and new dispatch panel behavior.
- `frontend/src/modules/handover-system/page.runtime.test.js`
  Responsibility: integration coverage for handover mode using the shared workbench wrapper.
- `app/api/routes/transfer_area.py`
  Responsibility: transfer-area bootstrap/workspace APIs plus new tray dispatch query/command endpoints and storage updates.
- `tests/api/test_transfer_area.py`
  Responsibility: backend regression coverage for transfer-area routes and tray/sample persistence behavior.

### New files to create

- `frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue`
  Responsibility: render the dispatch-specific scan box, tray result card, destination actions, and feedback area.
- `frontend/src/modules/transfer-workbench/useTransferDispatch.js`
  Responsibility: isolate dispatch panel state, scan lookup, candidate normalization, and dispatch submission.

### Notes

- Keep the current overview/detail workbench flow intact; do not move it to a new route.
- Reuse existing tray status vocabulary already present in the sample/process/task modules.
- Do not implement arrival confirmation in this plan.

## Chunk 1: Frontend Shell Switching

### Task 1: Lock the new top-level navigation with failing runtime tests

**Files:**
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Write the failing runtime tests for the new top buttons**

Add expectations for:
- `任务总览` and `样品出库` buttons render to the left of `退出登录`
- default handover mode opens on `任务总览`
- clicking `样品出库` swaps the body to a dispatch view

- [ ] **Step 2: Run the failing tests**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/modules/handover-system/page.runtime.test.js`
Expected: `FAIL` because the buttons and dispatch view do not exist yet.

- [ ] **Step 3: Add minimal shell state and button markup**

Modify:
- `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`

Implementation target:
- add a local workbench view mode such as `overview-workbench` and `dispatch`
- render the two new buttons before the logout button
- preserve existing overview/detail workbench behavior under the `任务总览` tab

- [ ] **Step 4: Re-run the same tests**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/modules/handover-system/page.runtime.test.js`
Expected: `PASS`

- [ ] **Step 5: Commit the shell switching change**

Run:

```bash
git add frontend/src/modules/transfer-workbench/TransferWorkbench.vue frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js frontend/src/modules/handover-system/page.runtime.test.js
git commit -m "feat: add handover workbench dispatch tab shell"
```

## Chunk 2: Tray Dispatch Query API

### Task 2: Add failing backend tests for tray candidate lookup

**Files:**
- Modify: `tests/api/test_transfer_area.py`
- Modify: `app/api/routes/transfer_area.py`

- [ ] **Step 1: Write the failing tests for `GET /api/transfer-area/trays/{tray_code}/dispatch`**

Cover:
- tray lookup returns tray/task metadata
- leftmost staging destination is present
- tray with two experiments returns two destination candidates
- nearest scheduled lab is marked as preferred
- experiments without schedules return `待排程` candidates without preferred state

- [ ] **Step 2: Run the failing backend tests**

Run: `pytest tests/api/test_transfer_area.py -k "dispatch_lookup or preferred_lab" -v`
Expected: `FAIL` with missing route or payload fields.

- [ ] **Step 3: Implement the minimal lookup helpers and GET route**

Modify:
- `app/api/routes/transfer_area.py`

Implementation target:
- locate tray-bearing samples by `tray_code`
- resolve tray experiments from `mes.experiment_trays`
- resolve candidate labs from `mes.schedules`
- compute preferred candidate by earliest `start_at`, ignoring ties and staging

- [ ] **Step 4: Re-run the targeted backend tests**

Run: `pytest tests/api/test_transfer_area.py -k "dispatch_lookup or preferred_lab" -v`
Expected: `PASS`

- [ ] **Step 5: Commit the lookup API change**

Run:

```bash
git add app/api/routes/transfer_area.py tests/api/test_transfer_area.py
git commit -m "feat: add transfer-area tray dispatch lookup"
```

## Chunk 3: Tray Dispatch Command API

### Task 3: Add failing backend tests for dispatch persistence

**Files:**
- Modify: `tests/api/test_transfer_area.py`
- Modify: `app/api/routes/transfer_area.py`

- [ ] **Step 1: Write the failing tests for `POST /api/transfer-area/trays/{tray_code}/dispatch`**

Cover:
- dispatch to staging writes `送至暂存间` to tray/sample status and sets staging location
- dispatch to lab writes `送至实验室` and sets the selected lab location
- sample history records the correct action/detail
- already-dispatched trays reject duplicate outbound actions
- tray not tied to the chosen lab is rejected

- [ ] **Step 2: Run the failing tests**

Run: `pytest tests/api/test_transfer_area.py -k "dispatch_to_staging or dispatch_to_lab or duplicate_dispatch" -v`
Expected: `FAIL`

- [ ] **Step 3: Implement the minimal POST route and persistence logic**

Modify:
- `app/api/routes/transfer_area.py`

Implementation target:
- add request model for `targetType`, `targetName`, and optional `experimentCode`
- update every sample carrying the tray
- update tray entries inside each sample's `trays` list
- append sample history entries using existing history helpers

- [ ] **Step 4: Re-run the targeted backend tests**

Run: `pytest tests/api/test_transfer_area.py -k "dispatch_to_staging or dispatch_to_lab or duplicate_dispatch" -v`
Expected: `PASS`

- [ ] **Step 5: Commit the dispatch command change**

Run:

```bash
git add app/api/routes/transfer_area.py tests/api/test_transfer_area.py
git commit -m "feat: persist transfer-area tray dispatch actions"
```

## Chunk 4: Frontend Dispatch Panel

### Task 4: Add failing runtime tests for scan, candidate rendering, and dispatch submission

**Files:**
- Add: `frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue`
- Add: `frontend/src/modules/transfer-workbench/useTransferDispatch.js`
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

- [ ] **Step 1: Write failing runtime tests for the dispatch panel**

Cover:
- scan input and prompt render in `样品出库`
- successful tray lookup renders task/tray summary
- staging appears first
- multiple lab candidates render and the preferred candidate shows `优先送达`
- clicking a destination calls the POST API and updates success feedback

- [ ] **Step 2: Run the failing runtime tests**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
Expected: `FAIL`

- [ ] **Step 3: Implement the minimal dispatch panel and composition logic**

Create:
- `frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue`
- `frontend/src/modules/transfer-workbench/useTransferDispatch.js`

Modify:
- `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`

Implementation target:
- keep dispatch state out of the main workbench where possible
- call the new GET/POST tray dispatch endpoints
- preserve the currently scanned tray result after a successful outbound action

- [ ] **Step 4: Re-run the runtime test**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
Expected: `PASS`

- [ ] **Step 5: Commit the dispatch panel change**

Run:

```bash
git add frontend/src/modules/transfer-workbench/TransferWorkbench.vue frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue frontend/src/modules/transfer-workbench/useTransferDispatch.js frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js
git commit -m "feat: add handover tray dispatch panel"
```

## Chunk 5: Regression Verification

### Task 5: Verify handover workbench and transfer-area regressions end to end

**Files:**
- Test: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`
- Test: `tests/api/test_transfer_area.py`

- [ ] **Step 1: Run the full targeted verification suite**

Run:

```bash
npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/modules/handover-system/page.runtime.test.js
pytest tests/api/test_transfer_area.py -v
```

Expected:
- all targeted Vitest specs `PASS`
- all transfer-area pytest cases `PASS`

- [ ] **Step 2: Smoke-check residual risks**

Manually verify:
- top buttons remain visible in handover mode
- switching between `任务总览` and `样品出库` does not lose unsaved tray edits unless intentionally reset
- preferred lab styling is visible on desktop and mobile widths

- [ ] **Step 3: Commit final verification-only adjustments if needed**

Run:

```bash
git add frontend/src/modules/transfer-workbench/TransferWorkbench.vue frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue frontend/src/modules/transfer-workbench/useTransferDispatch.js app/api/routes/transfer_area.py tests/api/test_transfer_area.py frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js frontend/src/modules/handover-system/page.runtime.test.js
git commit -m "test: cover handover dispatch workbench flow"
```

- [ ] **Step 4: Record residual risks**

Residual risks to call out if manual verification is skipped:
- unsaved overview-side tray edits while toggling tabs may need explicit preservation handling
- schedule data quality may produce more `待排程` candidates than operators expect
- downstream arrival-confirmation pages are still pending and must handle `送至...` statuses correctly
