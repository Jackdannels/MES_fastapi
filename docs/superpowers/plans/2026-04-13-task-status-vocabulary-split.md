# Task Status Vocabulary Split Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate task statuses from experiment statuses across storage, task aggregation, and task-flow UI.

**Architecture:** Introduce explicit task-status normalization alongside existing experiment-status normalization, then route all task-oriented frontend derivations through the task vocabulary while leaving experiment/tray/sample records on experiment vocabulary. Migration logic rewrites legacy task rows in JSON/MySQL so old data converges automatically.

**Tech Stack:** FastAPI/Python storage backends, Vue 3, Vitest, pytest

---

## Chunk 1: Storage And Persistence

### Task 1: Add failing backend normalization tests

**Files:**
- Modify: `tests/core/test_storage_backend.py`
- Modify: `tests/core/test_mysql_storage_backend.py`

- [ ] Add JSON normalization expectations showing `mes.tasks` values normalize to `任务进行中` / `任务已完成` while experiment/sample/schedule values stay in experiment wording.
- [ ] Add MySQL task-map expectations showing derived task statuses return task wording.
- [ ] Run:
  - `.venv\\Scripts\\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -k "task_status or normalize_storage_payload or derive_task_status_map" -v`
- [ ] Confirm the new assertions fail for the expected vocabulary mismatch.

### Task 2: Implement backend task-status normalization

**Files:**
- Modify: `app/core/storage_backend.py`
- Modify: `app/core/mysql_storage_backend.py`

- [ ] Add explicit task-status canonical helpers separate from experiment-status helpers.
- [ ] Update JSON payload normalization so `mes.tasks` uses task-status normalization and other collections keep experiment normalization.
- [ ] Update MySQL task row build/load and derived task status maps to use task vocabulary.
- [ ] Update legacy MySQL task-status rewrite SQL to convert only task rows to task wording.
- [ ] Re-run the targeted backend tests and confirm they pass.

## Chunk 2: Frontend Task Views

### Task 3: Add failing frontend task-status tests

**Files:**
- Modify: `frontend/src/modules/tasks/model.test.js`
- Modify: `frontend/src/modules/tasks/page.runtime.test.js`
- Modify: `frontend/src/modules/samples/TrayManagementPanel.test.js`
- Modify: `frontend/src/modules/task-overview/model.test.js`

- [ ] Add expectations for `任务进行中`, `任务已完成`, and `任务进行中（已完成X个实验）`.
- [ ] Run:
  - `npm run test:run -- src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js src/modules/samples/TrayManagementPanel.test.js src/modules/task-overview/model.test.js`
- [ ] Confirm failures are caused by old experiment wording in task displays.

### Task 4: Implement frontend task vocabulary split

**Files:**
- Modify: `frontend/src/modules/tasks/model.js`
- Modify: `frontend/src/modules/tasks/page.vue`
- Modify: `frontend/src/modules/task-overview/model.js`
- Modify: `frontend/src/modules/samples/TrayManagementPanel.vue`
- Modify: `frontend/src/modules/laboratory/model.js`
- Modify: `frontend/src/modules/dashboard/model.js`
- Modify: `frontend/src/modules/process/useProcessLabs.js`

- [ ] Split task status normalization from experiment status normalization in `tasks/model.js`.
- [ ] Update task list filters/edit options and task display labels to task wording.
- [ ] Update task-overview and task-flow consumers to display task wording while experiment detail rows remain unchanged.
- [ ] Update task-status writeback paths so persisted task records use `任务进行中` / `任务已完成`.
- [ ] Re-run the targeted frontend tests and confirm they pass.

## Chunk 3: Verification

### Task 5: Run focused regression suites

**Files:**
- No code changes expected

- [ ] Run backend regression:
  - `.venv\\Scripts\\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -v`
- [ ] Run frontend regression:
  - `npm run test:run -- src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js src/modules/samples/TrayManagementPanel.test.js src/modules/task-overview/model.test.js src/modules/task-overview/TaskOverviewSummaryTable.test.js src/modules/process/useProcessLabs.test.js`
- [ ] If failures expose additional task-view wording leaks, patch the smallest responsible module and rerun affected suites.
