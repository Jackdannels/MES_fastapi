# Schedule Actual Completion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make actual experiment completion release planned schedule occupancy and prevent generated placeholder experiments beyond fixed experiment types.

**Architecture:** Reuse existing lifecycle inference in `frontend/src/modules/schedule/model.js` and add matching completed-schedule filtering to `frontend/src/modules/process/model.js`. Keep backend task experiment generation bounded by explicit fixed type definitions in `app/api/routes/tasks.py`.

**Tech Stack:** Vue/Vitest frontend model tests, FastAPI/Pytest backend route tests.

---

### Task 1: Schedule Conflict Lifecycle Filtering

**Files:**
- Modify: `frontend/src/modules/schedule/model.test.js`
- Modify: `frontend/src/modules/schedule/model.js`

- [ ] Write failing Vitest cases showing completed existing schedules do not trigger `buildConflictRows()` or `analyzeTaskTrayConflict()`.
- [ ] Run `npm run test:run -- src/modules/schedule/model.test.js`.
- [ ] Add minimal lifecycle-aware filtering to conflict functions.
- [ ] Re-run the same Vitest file.

### Task 2: Process Lab Completed Schedule Filtering

**Files:**
- Modify: `frontend/src/modules/process/model.test.js`
- Modify: `frontend/src/modules/process/model.js`

- [ ] Write a failing Vitest case showing an active planned schedule with completed trays produces an idle lab card.
- [ ] Run `npm run test:run -- src/modules/process/model.test.js`.
- [ ] Reuse scoped completion detection before choosing active/upcoming schedules.
- [ ] Re-run the same Vitest file.

### Task 3: Fixed Experiment Type Count

**Files:**
- Modify: `tests/api/test_tasks.py`
- Modify: `app/api/routes/tasks.py`

- [ ] Write a failing Pytest case where `experiment_count` is larger than `test_types` and no `实验4`/`实验5` rows are created.
- [ ] Run `python -m pytest tests/api/test_tasks.py`.
- [ ] Bound generated experiment count to explicit type/code metadata.
- [ ] Re-run the same Pytest file.

### Task 4: Final Verification

**Files:**
- Verify all touched model/route tests.

- [ ] Run `npm run test:run -- src/modules/schedule/model.test.js src/modules/process/model.test.js`.
- [ ] Run `python -m pytest tests/api/test_tasks.py`.
- [ ] Inspect `git diff --check`.
