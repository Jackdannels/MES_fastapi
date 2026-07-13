# Transfer, Task Detail, and Maintenance Scheduling Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore expected handover drag-and-drop, make task-detail overflow actionable, and make maintenance plans valid, cancellable, and accurately represented beside experiment schedules.

**Architecture:** Keep the existing shared transfer component and complete-list modal. Validate maintenance windows at both the UI and storage boundaries. Preserve the compact half-day board while using exact ranges to decide whether a maintenance window and an experiment can coexist in one rendered slot.

**Tech Stack:** Vue 3, Vitest, FastAPI, pytest.

---

## Chunk 1: Independent UI fixes

### Task 1: Handover drag-and-drop

**Files:**
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
- Test: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

- [ ] Write a failing handover-mode test proving an unlocked sample is draggable and can be moved to a tray.
- [ ] Run the focused test and confirm it fails because handover mode is hard-coded as non-draggable.
- [ ] Change the drag eligibility rule to depend only on the existing editing lock.
- [ ] Run the focused transfer workbench tests; verify saved, arrived, and experiment-selection locks remain non-draggable.

### Task 2: Task detail overflow actions

**Files:**
- Modify: `frontend/src/modules/process/page.vue`
- Test: `frontend/src/modules/process/page.runtime.test.js`

- [ ] Write a failing test that clicks an overflowing `+N` tray count and expects the existing full-list dialog.
- [ ] Run the focused test and confirm `+N` has no interactive behavior.
- [ ] Replace the static overflow count with an accessible button that calls the existing full-list action.
- [ ] Run the focused process page tests and cover hidden-count absence when no overflow exists.

## Chunk 2: Maintenance plan validity and lifecycle

### Task 3: Validate and cancel planned maintenance

**Files:**
- Modify: `frontend/src/modules/devices/useDevicesPage.js`
- Modify: `frontend/src/modules/devices/page.vue`
- Modify: `app/api/routes/storage.py`
- Modify: `app/services/storage_schedule_patch.py`
- Test: `frontend/src/modules/devices/useDevicesPage.test.js`
- Test: `tests/api/test_storage.py`

- [ ] Write failing UI tests for `endAt <= startAt`, and for cancelling future plans with and without an end time.
- [ ] Write a failing API test that rejects an invalid device maintenance window with HTTP 422.
- [ ] Run the focused tests and confirm each failure is attributable to missing validation or the disabled lifecycle control.
- [ ] Add a shared backend maintenance-window validator; call it for full storage updates and schedule patches.
- [ ] Block UI persistence on an invalid planned interval; expose future maintenance as “取消计划” and active maintenance as “提前结束”.
- [ ] Run device and storage tests, including existing schedule-conflict behavior.

## Chunk 3: Exact maintenance slot behaviour

### Task 4: Preserve same-day maintenance after a completed experiment

**Files:**
- Modify: `frontend/src/modules/schedule/model.js`
- Test: `frontend/src/modules/schedule/model.test.js`

- [ ] Write a failing model test for an experiment ending at 13:30 and maintenance beginning at 16:30 on the same day.
- [ ] Run the focused test and confirm the half-day model masks maintenance behind the experiment occupancy.
- [ ] Make exact interval overlap choose the slot representation: non-overlapping same-slot windows retain maintenance visibility, while genuine overlaps remain maintenance conflicts.
- [ ] Run focused schedule model tests, including half-day and cross-day coverage.
