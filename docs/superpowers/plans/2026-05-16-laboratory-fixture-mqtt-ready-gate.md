# Laboratory Fixture MQTT Ready Gate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the PLC/host-confirmed fixture installation flow so MES only enables experiment-ready after receiving `FIXTURE_READY`, and publish a concrete MQTT protocol document matching the improved database.

**Architecture:** Keep communication audit data separate from core business tables. Extend `biz_experiment` only for lifecycle timestamps, add dedicated MQTT log/event/result tables, then expose a backend processor that both HTTP tests and future MQTT subscribers can call. Frontend readiness gating reads persisted host-confirmation state instead of assuming local fixture installation is enough.

**Tech Stack:** FastAPI, Pydantic, PyMySQL/MySQL, Vue 3 composition modules, Vitest, Pytest, JSON protocol docs.

---

## File Structure

- Modify `app/core/mysql_storage_backend.py`: schema extension for actual times and new MQTT/result tables; storage mapping if needed for fixture-ready state.
- Modify `scripts/sql/2026-03-17-mes-single-branch-schema-alignment.sql`: formal SQL equivalents for initialization.
- Create `app/services/mq_event_processor.py`: inbound payload validation, ACK creation, and storage write interface.
- Modify `app/api/routes/mq.py`: add debug/test inbound endpoints that call the processor.
- Modify `tests/core/test_mysql_storage_backend.py`: schema SQL capture tests.
- Modify `tests/api/test_mq.py`: inbound processor/API behavior tests.
- Modify `frontend/src/modules/laboratory/model.js`: represent host fixture-ready state in workflow/action state.
- Modify `frontend/src/modules/laboratory/useLaboratoryPage.js`: persist waiting/ready state and keep ready button disabled until host confirmation.
- Modify `frontend/src/modules/laboratory/model.test.js` and `page.runtime.test.js`: frontend gate tests.
- Replace `docs/mqtt-interface-definition.json`: final concrete protocol document.
- Update `README.md`: summarize protocol and point to the JSON document.

## Chunk 1: Database Schema

### Task 1: Add schema extension tests

**Files:**
- Modify: `tests/core/test_mysql_storage_backend.py`

- [ ] **Step 1: Write failing tests**
  - Add a fake-cursor test that `_ensure_schema_extensions()` emits:
    - `ALTER TABLE biz_experiment ADD COLUMN actual_start_time`
    - `ALTER TABLE biz_experiment ADD COLUMN actual_end_time`
    - `CREATE TABLE IF NOT EXISTS biz_mq_message_log`
    - `CREATE TABLE IF NOT EXISTS biz_experiment_event`
    - `CREATE TABLE IF NOT EXISTS biz_experiment_result`

- [ ] **Step 2: Verify RED**
  - Run: `rtk .\.venv\Scripts\python.exe -m pytest tests\core\test_mysql_storage_backend.py -k "schema_extensions" -v`
  - Expected: FAIL because fields/tables are not created yet.

- [ ] **Step 3: Implement schema extension**
  - Update `app/core/mysql_storage_backend.py::_ensure_schema_extensions()`.

- [ ] **Step 4: Verify GREEN**
  - Run the same pytest command.
  - Expected: PASS.

### Task 2: Update initialization SQL

**Files:**
- Modify: `scripts/sql/2026-03-17-mes-single-branch-schema-alignment.sql`

- [ ] Add guarded `add_column_if_missing` calls for actual experiment times.
- [ ] Add `CREATE TABLE IF NOT EXISTS` statements for the three new tables.
- [ ] Keep names aligned with runtime schema.

## Chunk 2: Backend Inbound Processing

### Task 3: Add processor tests

**Files:**
- Modify: `tests/api/test_mq.py`
- Create: `app/services/mq_event_processor.py`

- [ ] **Step 1: Write failing tests**
  - `FIXTURE_READY` returns `EVENT_ACK` with `PROCESSED`.
  - Duplicate `messageId` returns processed ACK without duplicate business update.
  - `EXPERIMENT_STARTED` maps to actual start/status intent.
  - `EXPERIMENT_RESULT` accepts structured result package.

- [ ] **Step 2: Verify RED**
  - Run: `rtk .\.venv\Scripts\python.exe -m pytest tests\api\test_mq.py -v`
  - Expected: FAIL because processor/endpoints do not exist.

- [ ] **Step 3: Implement minimal processor and API endpoint**
  - Add Pydantic models and service functions.
  - Add `POST /api/mq/laboratory/events/{message_type}` debug endpoint.
  - Keep actual MQTT subscriber out of first pass unless needed.

- [ ] **Step 4: Verify GREEN**
  - Run the same pytest command.

## Chunk 3: Frontend Ready Gate

### Task 4: Add frontend gate tests

**Files:**
- Modify: `frontend/src/modules/laboratory/model.test.js`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Modify: `frontend/src/modules/laboratory/model.js`

- [ ] **Step 1: Write failing model test**
  - Installed fixture state without host confirmation returns `canMarkReady: false`.
  - Host-confirmed fixture state returns `canMarkReady: true`.

- [ ] **Step 2: Verify RED**
  - Run: `rtk powershell -NoProfile -Command "cd frontend; npm test -- laboratory/model.test.js --runInBand"`
  - Expected: FAIL.

- [ ] **Step 3: Implement gate**
  - Persist host-confirmed marker in existing sample/tray state or a small storage key.
  - Update action state and progress message.

- [ ] **Step 4: Verify GREEN**
  - Run the same frontend test command.

## Chunk 4: Final Protocol Document

### Task 5: Generate final protocol JSON

**Files:**
- Modify: `docs/mqtt-interface-definition.json`
- Modify: `README.md`

- [ ] Replace the draft JSON with the final protocol:
  - connection parameters
  - topic table
  - public envelope
  - message schemas
  - ACK/ERROR schemas
  - idempotency and time rules
  - result package schema
  - database mappings after schema improvement

- [ ] Validate JSON:
  - Run: `rtk .\.venv\Scripts\python.exe -m json.tool docs\mqtt-interface-definition.json`
  - Expected: exit 0.

## Final Verification

- [ ] Run: `rtk .\.venv\Scripts\python.exe -m pytest tests\core\test_mysql_storage_backend.py -v`
- [ ] Run: `rtk .\.venv\Scripts\python.exe -m pytest tests\api\test_mq.py -v`
- [ ] Run relevant frontend tests for laboratory module.
- [ ] Run JSON validation.
