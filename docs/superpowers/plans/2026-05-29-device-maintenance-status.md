# Device Maintenance Status Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement separated device safety/work status, revised maintenance planning, and previous-stable-state rollback for laboratory task switching.

**Architecture:** Frontend device work status remains derived from devices, schedules, samples, and experiment trays. Safety status and maintenance fields are persisted on `mes.devices` and mapped through MySQL storage. Laboratory task-switch rollback uses the same stable-state order as backend current-experiment withdrawal.

**Tech Stack:** Vue 3, Vitest, FastAPI, pytest, MySQL storage backend.

---

### Task 1: Previous Stable State Rollback

**Files:**
- Modify: `frontend/src/modules/laboratory/model.js`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Test: `frontend/src/modules/laboratory/model.test.js`

- [ ] Write a failing test where a task-switch rollback sees prior history for another experiment completed and restores the tray to `实验已完成` instead of `到货` or `已到达暂存间`.
- [ ] Run the targeted Vitest test and verify it fails.
- [ ] Add a previous-stable-state rollback helper and update task-switch compare flow to use it.
- [ ] Run the targeted Vitest test and existing laboratory model tests.

### Task 2: Device Status Model

**Files:**
- Modify: `frontend/src/modules/devices/model.js`
- Modify: `frontend/src/modules/devices/useDevicesPage.js`
- Modify: `frontend/src/modules/devices/page.vue`
- Test: `frontend/src/modules/devices/model.test.js`
- Test: `frontend/src/modules/devices/page.runtime.test.js`
- Test: `frontend/src/modules/devices/useDevicesPage.test.js`

- [ ] Write failing tests for safety status `可用/维修/保养`, derived work status `空闲/工作中/维修/保养`, planned end auto-return, and revised maintenance type options.
- [ ] Run targeted device tests and verify failures.
- [ ] Implement status constants, normalization, plan type behavior, read-only edit status, `设为可用`, and modal button order.
- [ ] Run targeted device tests.

### Task 3: Storage Mapping and Guards

**Files:**
- Modify: `app/core/mysql_storage_backend.py`
- Modify: `app/api/routes/storage.py`
- Modify: `app/api/routes/transfer_area.py`
- Test: `tests/core/test_mysql_storage_backend.py`
- Test: `tests/api/test_storage.py`
- Test: `tests/api/test_transfer_area.py`

- [ ] Write failing backend tests for maintenance fields round-trip and `保养` being unavailable.
- [ ] Run targeted pytest tests and verify failures.
- [ ] Persist maintenance fields and include `保养` in unavailable-device checks.
- [ ] Run targeted pytest tests.

### Task 4: Verification

- [ ] Run `rtk npm --prefix frontend run test:run -- src/modules/laboratory/model.test.js src/modules/devices/model.test.js src/modules/devices/page.runtime.test.js src/modules/devices/useDevicesPage.test.js`.
- [ ] Run targeted backend pytest tests for storage, transfer area, and MySQL storage backend.
- [ ] Review `git diff` for unrelated changes before final response.
