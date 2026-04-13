# Task Overview Status Unification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify running/completed experiment status values across frontend and backend, migrate legacy stored values, and add a task-overview KPI card for scheduled experiments.

**Architecture:** Normalize legacy statuses at the storage boundary so persisted JSON/MySQL data converges to canonical values `实验进行中` and `实验已完成`. Then extend task-overview row models with scheduled/eligible experiment counts and render a second KPI card in task mode using filtered row aggregates.

**Tech Stack:** Python storage backends and pytest, Vue 3 task-overview modules, Vitest

---

## Chunk 1: Storage normalization

### Task 1: Add failing storage normalization tests

**Files:**
- Modify: `tests/core/test_storage_backend.py`
- Modify: `tests/core/test_mysql_storage_backend.py`
- Modify: `app/core/storage_backend.py`
- Modify: `app/core/mysql_storage_backend.py`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- JSON storage rewrites `实验中` to `实验进行中`
- JSON storage rewrites `实验完成` / `实验已经完成` to `实验已完成`
- MySQL experiment/task mappings return canonical values

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -k "status" -v`
Expected: FAIL because legacy values still persist or are returned unchanged

- [ ] **Step 3: Write minimal implementation**

Add canonical status helpers and apply them in JSON payload normalization plus MySQL insert/load/derived status paths.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -k "status" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py app/core/storage_backend.py app/core/mysql_storage_backend.py
git commit -m "feat: normalize legacy experiment statuses"
```

## Chunk 2: Task overview row metrics

### Task 2: Add failing task-overview model tests

**Files:**
- Modify: `frontend/src/modules/task-overview/model.test.js`
- Modify: `frontend/src/modules/task-overview/model.js`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- a row exposes `scheduledExperimentCount` and `eligibleExperimentCount`
- completed and running canonical statuses count as scheduled
- `厂家收回` tasks contribute `0/0`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/task-overview/model.test.js`
Expected: FAIL because counts are not present yet

- [ ] **Step 3: Write minimal implementation**

Implement canonical status helpers in the task-overview model and compute row-level experiment metrics.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/task-overview/model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/task-overview/model.js frontend/src/modules/task-overview/model.test.js
git commit -m "feat: add task overview scheduled experiment counts"
```

## Chunk 3: Toolbar and filtered KPI aggregation

### Task 3: Add failing toolbar and overview-metric tests

**Files:**
- Modify: `frontend/src/modules/task-overview/useTaskOverview.test.js`
- Modify: `frontend/src/modules/task-overview/TaskOverviewToolbar.test.js`
- Modify: `frontend/src/modules/task-overview/useTaskOverview.js`
- Modify: `frontend/src/modules/task-overview/TaskOverviewToolbar.vue`
- Modify: `frontend/src/modules/task-overview/page.vue`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- task mode shows two KPI cards
- second card label is `已排程总实验数`
- second card value aggregates from filtered rows
- tray mode still shows only the tray counter

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/task-overview/useTaskOverview.test.js src/modules/task-overview/TaskOverviewToolbar.test.js`
Expected: FAIL because no second card exists

- [ ] **Step 3: Write minimal implementation**

Add a second counter prop pair and aggregate scheduled/eligible experiment counts from `filteredRows`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/task-overview/useTaskOverview.test.js src/modules/task-overview/TaskOverviewToolbar.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/task-overview/useTaskOverview.js frontend/src/modules/task-overview/useTaskOverview.test.js frontend/src/modules/task-overview/TaskOverviewToolbar.vue frontend/src/modules/task-overview/TaskOverviewToolbar.test.js frontend/src/modules/task-overview/page.vue
git commit -m "feat: add task overview scheduled experiment counter"
```

## Chunk 4: Frontend status copy and compatibility

### Task 4: Update high-impact modules to canonical labels

**Files:**
- Modify: `frontend/src/modules/tasks/model.js`
- Modify: `frontend/src/modules/process/model.js`
- Modify: `frontend/src/modules/process/useProcessLabs.js`
- Modify: `frontend/src/modules/schedule/model.js`
- Modify: `frontend/src/modules/laboratory/model.js`
- Modify: touched tests under those modules

- [ ] **Step 1: Write/update failing tests**

Target the smallest set of affected tests that still assert old labels like `实验中` or `实验已经完成`.

- [ ] **Step 2: Run tests to verify failures**

Run: `npm run test:run -- src/modules/tasks/model.test.js src/modules/process/model.test.js src/modules/process/useProcessLabs.test.js src/modules/schedule/model.test.js`
Expected: FAIL on old labels

- [ ] **Step 3: Write minimal implementation**

Normalize old inputs to canonical outputs while preserving compatibility on ingest.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/tasks/model.test.js src/modules/process/model.test.js src/modules/process/useProcessLabs.test.js src/modules/schedule/model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/tasks/model.js frontend/src/modules/process/model.js frontend/src/modules/process/useProcessLabs.js frontend/src/modules/schedule/model.js frontend/src/modules/laboratory/model.js
git commit -m "feat: unify canonical experiment status labels"
```

## Chunk 5: Verification

### Task 5: Run focused regression suites

**Files:**
- Test: `tests/core/test_storage_backend.py`
- Test: `tests/core/test_mysql_storage_backend.py`
- Test: `frontend/src/modules/task-overview/model.test.js`
- Test: `frontend/src/modules/task-overview/useTaskOverview.test.js`
- Test: `frontend/src/modules/task-overview/TaskOverviewToolbar.test.js`
- Test: touched frontend module tests

- [ ] **Step 1: Run backend verification**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -v`
Expected: PASS

- [ ] **Step 2: Run task-overview verification**

Run: `npm run test:run -- src/modules/task-overview/model.test.js src/modules/task-overview/useTaskOverview.test.js src/modules/task-overview/TaskOverviewToolbar.test.js`
Expected: PASS

- [ ] **Step 3: Run touched frontend module verification**

Run: `npm run test:run -- src/modules/tasks/model.test.js src/modules/process/model.test.js src/modules/process/useProcessLabs.test.js src/modules/schedule/model.test.js`
Expected: PASS

- [ ] **Step 4: Review diff**

Run: `git diff -- app/core/storage_backend.py app/core/mysql_storage_backend.py tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py frontend/src/modules/task-overview/model.js frontend/src/modules/task-overview/useTaskOverview.js frontend/src/modules/task-overview/TaskOverviewToolbar.vue`
Expected: Diff contains only status-unification and counter-card changes
