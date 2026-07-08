# Personnel Attendance Persistence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist personnel accounts and attendance work intervals, show a personnel work-time overview before base configuration, and count concurrent same-person laboratory work additively.

**Architecture:** Move attendance business rules behind a shared service used by REST/API flows and MQTT event processing. Store personnel, lab sessions, and work intervals in repository-backed records, with an in-memory repository for tests and a MySQL repository for production database persistence. UI labels change from system information to personnel information, and work-time rows are rendered in a separate section.

**Tech Stack:** FastAPI, pytest, MySQL via existing connection helpers, Vue 3, Vitest.

---

## Chunk 1: Backend Attendance Service

### Task 1: Failing tests for persistence and additive concurrent work

**Files:**
- Modify: `tests/api/test_attendance.py`

- [ ] Add a test proving users survive repository/service reinitialization.
- [ ] Add a test proving the same user can log into two laboratories and two simultaneous 5-minute intervals sum to 600 seconds.
- [ ] Run focused pytest and confirm the new tests fail before implementation.

### Task 2: Shared service and repositories

**Files:**
- Create: `app/services/attendance_service.py`
- Modify: `app/api/routes/attendance.py`

- [ ] Extract user/session/work-time business rules from the router into `AttendanceService`.
- [ ] Add in-memory repository reset helpers for tests.
- [ ] Keep existing API response shapes stable.
- [ ] Change work time calculation to sum stored work intervals plus open intervals.

### Task 3: MySQL schema and repository

**Files:**
- Modify: `app/core/mysql_storage_schema.py`
- Modify: `app/services/attendance_service.py`

- [ ] Add `sys_attendance_user`, `biz_lab_attendance_session`, and `biz_lab_work_interval` tables.
- [ ] Seed default demo users only when no personnel rows exist.
- [ ] Use the existing DB connection helpers for production persistence.

## Chunk 2: REST/MQTT Lifecycle Integration

### Task 4: Failing tests for lifecycle integration

**Files:**
- Modify: `tests/api/test_attendance.py`
- Modify: `tests/api/test_mq.py`

- [ ] Prove API experiment start creates a work interval for the active lab session.
- [ ] Prove MQTT `EXPERIMENT_STARTED` creates the same kind of work interval.
- [ ] Prove experiment end closes the interval in both paths.

### Task 5: Shared lifecycle hooks

**Files:**
- Modify: `app/api/routes/laboratory.py`
- Modify: `app/services/mq_event_processor.py`
- Modify: `app/services/attendance_service.py`

- [ ] Call `start_work_interval` from API experiment start after the run starts.
- [ ] Call `finish_work_interval` from API experiment completion.
- [ ] Call the same service from MQTT started/ended events.
- [ ] Keep behavior identical except for source label `api` vs `mqtt`.

## Chunk 3: Frontend Personnel Page

### Task 6: Failing frontend tests

**Files:**
- Modify: `frontend/src/App.runtime.test.js`
- Modify: `frontend/src/modules/system/page.runtime.test.js`

- [ ] Assert central navigation contains `人员信息` instead of `系统信息`.
- [ ] Assert `人员工作时间一览表` appears before `基础配置`.

### Task 7: UI changes

**Files:**
- Modify: `frontend/src/modules/system/index.js`
- Modify: `frontend/src/modules/system/model.js`
- Modify: `frontend/src/modules/system/page.vue`
- Modify: `frontend/src/modules/system/useSystemPage.js`
- Modify: `frontend/src/modules/system/styles.css`

- [ ] Rename module title/subtitle to personnel wording.
- [ ] Split personnel maintenance and work-time overview into two sections.
- [ ] Show concurrent/current lab names as a readable list.
- [ ] Preserve existing employee create/reset/delete API behavior.

## Verification

- [ ] Run `pytest tests/api/test_attendance.py tests/api/test_mq.py -q`.
- [ ] Run `cd frontend; npm run test:run -- src/App.runtime.test.js src/modules/system/page.runtime.test.js`.
- [ ] Inspect `git diff --stat` and summarize changed files.
