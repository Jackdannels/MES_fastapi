# Dashboard Running Experiment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard running KPI count active experiments by canonical backend status `实验进行中` instead of counting task rows by schedule time windows.

**Architecture:** Normalize legacy running experiment labels in the backend so all derived and persisted experiment statuses converge on `实验进行中`. Then change the dashboard view model to count experiments with that canonical status and update the runtime page copy to match the new KPI meaning.

**Tech Stack:** Python backend mapping/tests, Vue 3 dashboard view-model/runtime tests, Vitest, pytest

---

## Chunk 1: Backend canonical running status

### Task 1: Add failing backend normalization tests

**Files:**
- Modify: `tests/core/test_mysql_storage_backend.py`
- Modify: `app/core/mysql_storage_backend.py`

- [ ] **Step 1: Write the failing test**

```python
def test_experiment_mapping_normalizes_legacy_running_status_to_experiment_running() -> None:
    insert_row = build_experiment_insert_row({"status": "实验中"})
    storage_item = build_storage_experiment_item({**insert_row, "experiment_id": 1})
    assert insert_row["experiment_status"] == "实验进行中"
    assert storage_item["status"] == "实验进行中"


def test_derive_experiment_status_map_returns_experiment_running_for_started_histories() -> None:
    status_map = derive_experiment_status_map(...)
    assert status_map["SYLU-2026-03-002-B"] == "实验进行中"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/core/test_mysql_storage_backend.py -k "normalize_legacy_running_status or derive_experiment_status_map_returns_experiment_running" -v`
Expected: FAIL because backend still returns or stores `实验中`

- [ ] **Step 3: Write minimal implementation**

```python
EXPERIMENT_RUNNING_STATUS = "实验进行中"


def normalize_experiment_status(value: Any) -> str:
    return EXPERIMENT_RUNNING_STATUS if normalize_text(value) == "实验中" else normalize_text(value)
```

Apply normalization in experiment insert mapping, storage mapping, and derived experiment/task status logic.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/core/test_mysql_storage_backend.py -k "normalize_legacy_running_status or derive_experiment_status_map_returns_experiment_running" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/core/test_mysql_storage_backend.py app/core/mysql_storage_backend.py
git commit -m "feat: normalize running experiment status"
```

## Chunk 2: Dashboard KPI semantics

### Task 2: Add failing dashboard model and page tests

**Files:**
- Modify: `frontend/src/modules/dashboard/model.test.js`
- Modify: `frontend/src/modules/dashboard/page.runtime.test.js`
- Modify: `frontend/src/modules/dashboard/model.js`
- Modify: `frontend/src/modules/dashboard/page.vue`

- [ ] **Step 1: Write the failing test**

```js
test("counts running experiments instead of active scheduled tasks", () => {
  const viewModel = buildDashboardViewModel({
    tasks: [{ code: "T-001", status: "已排程" }],
    experiments: [
      { task_code: "T-001", experiment_code: "T-001-A", status: "实验进行中" },
      { task_code: "T-001", experiment_code: "T-001-B", status: "已排程" },
    ],
    schedules: [...active window...],
  });

  expect(viewModel.summaryCards.deviceCount).toBe(1);
});
```

Runtime page assertion:

```js
expect(wrapper.text()).toContain("正在运行（实验）");
expect(wrapper.text()).not.toContain("实验中任务");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/dashboard/model.test.js src/modules/dashboard/page.runtime.test.js`
Expected: FAIL because dashboard still uses task display status and old copy

- [ ] **Step 3: Write minimal implementation**

```js
const STATUS_EXPERIMENT_RUNNING = "实验进行中";
const runningExperimentCount = experimentList.filter(
  (experiment) => normalizeExperimentStatus(experiment?.status) === STATUS_EXPERIMENT_RUNNING,
).length;
```

Use that value in the summary card, update card title copy in the page, and remove the note rendering.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/dashboard/model.test.js src/modules/dashboard/page.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/dashboard/model.js frontend/src/modules/dashboard/model.test.js frontend/src/modules/dashboard/page.vue frontend/src/modules/dashboard/page.runtime.test.js
git commit -m "feat: count running experiments in dashboard"
```

## Chunk 3: Start-experiment write path compatibility

### Task 3: Verify current start flow emits canonical running status

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.js`
- Test: existing process-control tests matching start-experiment state transitions

- [ ] **Step 1: Write or update the failing test**

Add a focused test that starting an experiment persists `实验进行中` rather than `实验中`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/process/useProcessLabs.test.js`
Expected: FAIL if the start flow still writes `实验中`

- [ ] **Step 3: Write minimal implementation**

Replace persisted task/experiment running label with `实验进行中` while keeping legacy input compatibility where needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/process/useProcessLabs.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/process/useProcessLabs.js frontend/src/modules/process/useProcessLabs.test.js
git commit -m "feat: persist canonical running experiment status"
```

## Chunk 4: Focused regression verification

### Task 4: Run verification suites

**Files:**
- Test: `tests/core/test_mysql_storage_backend.py`
- Test: `frontend/src/modules/dashboard/model.test.js`
- Test: `frontend/src/modules/dashboard/page.runtime.test.js`
- Test: any touched process-control test files

- [ ] **Step 1: Run backend verification**

Run: `pytest tests/core/test_mysql_storage_backend.py -v`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `npm run test:run -- src/modules/dashboard/model.test.js src/modules/dashboard/page.runtime.test.js`
Expected: PASS

- [ ] **Step 3: Run touched process-control verification if Task 3 changed code**

Run: `npm run test:run -- src/modules/process/useProcessLabs.test.js`
Expected: PASS

- [ ] **Step 4: Review diffs and working tree**

Run: `git diff -- app/core/mysql_storage_backend.py tests/core/test_mysql_storage_backend.py frontend/src/modules/dashboard/model.js frontend/src/modules/dashboard/model.test.js frontend/src/modules/dashboard/page.vue frontend/src/modules/dashboard/page.runtime.test.js frontend/src/modules/process/useProcessLabs.js frontend/src/modules/process/useProcessLabs.test.js`
Expected: Only the intended semantic and copy changes remain
