# Unscheduled Since Read-Time Backfill Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill missing experiment `unscheduled_since` timestamps during MySQL snapshot reads and persist the repaired values for old data.

**Architecture:** Keep the repair inside `MySQLMesStorageBackend` so every consumer of `/api/storage` benefits from the same fix. Use small helper functions to compute missing timestamps from tasks, schedules, experiments, experiment relations, and samples, then persist only changed experiment rows.

**Tech Stack:** Python, FastAPI storage backend, MySQL-backed runtime snapshot, pytest

---

## Chunk 1: Regression Tests

### Task 1: Lock experiment mapping behavior

**Files:**
- Modify: `tests/core/test_mysql_storage_backend.py`

- [ ] Add a failing test proving experiment storage mapping preserves `unscheduled_since`.
- [ ] Run the focused backend test if environment allows.

### Task 2: Lock read-time backfill behavior

**Files:**
- Modify: `tests/core/test_mysql_storage_backend.py`

- [ ] Add a failing test proving missing `unscheduled_since` is backfilled from the earliest stored sample time.
- [ ] Add a failing test proving scheduled or started experiments are not backfilled.
- [ ] Run the focused backend test if environment allows.

## Chunk 2: Minimal Implementation

### Task 3: Persist the field in MySQL experiment storage

**Files:**
- Modify: `app/core/mysql_storage_backend.py`

- [ ] Add schema support for `biz_experiment.unscheduled_since`.
- [ ] Include `unscheduled_since` in experiment insert/update/select mapping.

### Task 4: Implement read-time backfill

**Files:**
- Modify: `app/core/mysql_storage_backend.py`

- [ ] Add helper logic to identify eligible experiments with missing `unscheduled_since`.
- [ ] Derive timestamps from experiment-sample relations, tray relations, and stored sample history.
- [ ] Persist only repaired experiments before returning data.

## Chunk 3: Verification

### Task 5: Run target verification

**Files:**
- Test: `tests/core/test_mysql_storage_backend.py`
- Test: `frontend/src/modules/dashboard/model.test.js`
- Test: `frontend/src/modules/dashboard/useDashboardPage.test.js`
- Test: `frontend/src/App.runtime.test.js`

- [ ] Run backend pytest if environment allows.
- [ ] Run frontend regression suite to confirm no UI behavior regressed.
- [ ] If backend pytest is blocked by missing env deps, record the exact blocker and at least run Python syntax validation.
