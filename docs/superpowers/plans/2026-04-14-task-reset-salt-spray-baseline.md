# Task Reset Salt Spray Baseline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MySQL-backed task reset flow that rebuilds all task-related data to an unscheduled in-transit baseline where every task includes a salt spray experiment.

**Architecture:** Keep reset generation and destructive overwrite logic in the backend by extending the existing demo reset builder and exposing a dedicated `/api/tasks/reset` endpoint. The frontend only triggers that backend contract from the task intake page through a guarded confirmation flow and then reloads the affected data.

**Tech Stack:** FastAPI, Python, Vue 3, Vitest, pytest, MySQL storage backend

---

## Chunk 1: Backend reset baseline and API

### Task 1: Add failing reset baseline tests

**Files:**
- Modify: `tests/core/test_storage_backend.py`

- [ ] **Step 1: Write the failing test**

Add coverage that asserts every generated reset task contains `盐雾试验`, still has exactly three experiments, and resets all task-related collections back to unscheduled/in-transit defaults.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/core/test_storage_backend.py -k "salt or reset_demo_data" -q`
Expected: FAIL because the current builder still samples all three experiment types randomly.

- [ ] **Step 3: Write minimal implementation**

Update the reset snapshot builder to always include `盐雾试验` plus two distinct remaining experiment types.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/core/test_storage_backend.py -k "salt or reset_demo_data" -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/core/test_storage_backend.py app/core/demo_data_reset.py
git commit -m "test: require salt spray in reset baseline"
```

### Task 2: Add failing tasks reset API tests

**Files:**
- Modify: `tests/api/test_tasks.py`

- [ ] **Step 1: Write the failing test**

Add a `POST /api/tasks/reset` test that seeds task-related collections plus `mes.devices` and `mes.meta`, then asserts reset rewrites the former and preserves the latter.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_tasks.py -k "reset" -q`
Expected: FAIL with missing route or unsupported method.

- [ ] **Step 3: Write minimal implementation**

Add the reset route in `app/api/routes/tasks.py` and delegate to `run_demo_reset(get_storage_backend())`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_tasks.py -k "reset" -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/api/test_tasks.py app/api/routes/tasks.py
git commit -m "feat: add tasks reset api"
```

## Chunk 2: Frontend reset action

### Task 3: Add failing API client and app header tests

**Files:**
- Modify: `frontend/src/lib/tasksApi.test.js`
- Modify: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add tasks API coverage for the reset endpoint and app-shell coverage that the reset button is shown only on the tasks route in the central module.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/tasksApi.test.js src/App.runtime.test.js`
Expected: FAIL because no reset client exists and the button is not rendered.

- [ ] **Step 3: Write minimal implementation**

Add a `resetTasks()` client helper and expose a route-aware header button in `frontend/src/App.vue`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/tasksApi.test.js src/App.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/tasksApi.test.js frontend/src/lib/tasksApi.js frontend/src/App.runtime.test.js frontend/src/App.vue
git commit -m "feat: add task reset header action"
```

### Task 4: Add failing tasks page reset flow tests

**Files:**
- Modify: `frontend/src/modules/tasks/page.runtime.test.js`
- Modify: `frontend/src/modules/tasks/useTasksPage.js`
- Modify: `frontend/src/modules/tasks/page.vue`

- [ ] **Step 1: Write the failing test**

Add runtime coverage for:
- opening the confirmation dialog
- confirming reset
- calling the reset endpoint
- refreshing task-related data after success
- showing explicit failure messaging when reset fails

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/tasks/page.runtime.test.js`
Expected: FAIL because the page has no reset flow.

- [ ] **Step 3: Write minimal implementation**

Implement the reset dialog state, disable-in-flight behavior, success/error messaging, and tasks-page refresh handling.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/tasks/page.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/tasks/page.runtime.test.js frontend/src/modules/tasks/useTasksPage.js frontend/src/modules/tasks/page.vue
git commit -m "feat: add tasks page reset flow"
```

## Chunk 3: Verification and real reset

### Task 5: Run full targeted verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run backend verification**

Run: `python -m pytest tests/core/test_storage_backend.py tests/api/test_tasks.py -q`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `npm run test:run -- src/lib/tasksApi.test.js src/App.runtime.test.js src/modules/tasks/page.runtime.test.js`
Expected: PASS

- [ ] **Step 3: Run real reset against current MySQL**

Run: `python scripts/reset_demo_data.py`
Expected: success summary with rebuilt task, sample, and experiment counts.

- [ ] **Step 4: Spot-check the new baseline**

Run a small inspection command to confirm:
- every task contains `盐雾试验`
- all tasks are `待排程`
- all experiments are `待排程`
- all samples are `运输中`

- [ ] **Step 5: Commit**

```bash
git add app/core/demo_data_reset.py app/api/routes/tasks.py frontend/src/lib/tasksApi.js frontend/src/App.vue frontend/src/modules/tasks/useTasksPage.js frontend/src/modules/tasks/page.vue tests/core/test_storage_backend.py tests/api/test_tasks.py frontend/src/lib/tasksApi.test.js frontend/src/App.runtime.test.js frontend/src/modules/tasks/page.runtime.test.js docs/superpowers/specs/2026-04-14-task-reset-salt-spray-baseline-design.md docs/superpowers/plans/2026-04-14-task-reset-salt-spray-baseline.md
git commit -m "feat: add task reset flow with salt spray baseline"
```
