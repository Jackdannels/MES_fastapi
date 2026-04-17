# Task Intake Multi-Experiment Selection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让新增任务弹窗支持多选实验，并强制 `/api/tasks` 按实验类型数组创建多实验任务，同时保持现有任务号格式不变。

**Architecture:** 前端在任务受理模块中新增多选实验交互和数组表单字段，再由任务创建模型派生展示字符串 `test_type`。后端任务创建接口改为强制接收实验类型数组，并按其顺序生成 `experiment_count`、`experiment_codes` 与 `mes.experiments`，不再保留旧单实验兜底逻辑。

**Tech Stack:** Vue 3, Vitest, FastAPI, Python, existing MES snapshot storage

---

## Chunk 1: Frontend Form Model

### Task 1: Add failing model tests for multi-experiment intake form state

**Files:**
- Modify: `frontend/src/modules/tasks/model.test.js`
- Modify: `frontend/src/modules/tasks/model.js`

- [ ] **Step 1: Write the failing test**

Add tests asserting:
- `createTaskIntakeForm()` returns an empty experiment-type array field
- `createTaskRecord(...)` derives `test_type` from the selected array in order
- derived `test_type` looks like `冲击试验 / 盐雾试验 / 温度冲击试验`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/tasks/model.test.js`
Expected: FAIL because intake form still only stores a single `test_type` value

- [ ] **Step 3: Write minimal implementation**

Update `frontend/src/modules/tasks/model.js` to:
- add the new array field to `createTaskIntakeForm()`
- derive `test_type` from the array when creating a task record
- keep existing task-code generation behavior unchanged

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/tasks/model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/tasks/model.js frontend/src/modules/tasks/model.test.js
git commit -m "feat: add multi-experiment intake form model"
```

## Chunk 2: Frontend Intake Modal

### Task 2: Add failing runtime tests for the new multi-select experiment UI

**Files:**
- Modify: `frontend/src/modules/tasks/page.runtime.test.js`
- Modify: `frontend/src/modules/tasks/page.vue`
- Modify: `frontend/src/modules/tasks/useTasksPage.js`

- [ ] **Step 1: Write the failing test**

Add runtime tests proving:
- clicking the intake experiment field opens the experiment picker
- selecting multiple experiments updates the visible summary
- submitting without any selected experiment shows a validation warning
- the create-task payload includes both the array field and the joined `test_type`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/tasks/page.runtime.test.js`
Expected: FAIL because the page still renders a single-select `<select>`

- [ ] **Step 3: Write minimal implementation**

Update the intake modal so:
- `试验类型` becomes a read-only trigger
- a lightweight modal/popover lists all experiment options with checkmarks
- selections write back to the form array
- submit validation requires at least one selected experiment

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/tasks/page.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/tasks/page.vue frontend/src/modules/tasks/useTasksPage.js frontend/src/modules/tasks/page.runtime.test.js
git commit -m "feat: add multi-experiment picker to task intake"
```

## Chunk 3: Frontend API Payload

### Task 3: Make the tasks API tests assert the new request contract

**Files:**
- Modify: `frontend/src/lib/tasksApi.test.js`
- Modify: `frontend/src/lib/tasksApi.js`

- [ ] **Step 1: Write the failing test**

Add tests asserting `createTask(...)` sends:
- `test_type`
- the experiment-type array field

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/tasksApi.test.js`
Expected: FAIL if the new array field is not being asserted or passed through

- [ ] **Step 3: Write minimal implementation**

Keep `tasksApi` transport simple and ensure the created task payload is sent unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/tasksApi.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/tasksApi.js frontend/src/lib/tasksApi.test.js
git commit -m "test: assert multi-experiment task create payload"
```

## Chunk 4: Backend Contract Enforcement

### Task 4: Add failing backend tests for required experiment arrays

**Files:**
- Modify: `tests/api/test_tasks_api.py` or the existing closest tasks-route test file
- Modify: `app/api/routes/tasks.py`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- create-task succeeds when experiment array is present
- missing array returns 4xx
- empty array returns 4xx
- duplicate experiment types return 4xx

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/api/test_tasks_api.py -q`
Expected: FAIL because the route still accepts old payloads

- [ ] **Step 3: Write minimal implementation**

Update `app/api/routes/tasks.py` to:
- require the experiment-type array on create
- validate non-empty and deduplicated values
- build `experiment_count`, `experiment_codes`, and `mes.experiments` strictly from that array
- stop using the old create-time fallback path

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/api/test_tasks_api.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/routes/tasks.py tests/api/test_tasks_api.py
git commit -m "feat: require experiment arrays for task creation"
```

## Chunk 5: Cross-Layer Verification

### Task 5: Run focused frontend and backend verification

**Files:**
- Verify only

- [ ] **Step 1: Run frontend verification**

Run:

```bash
npm run test:run -- src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js src/lib/tasksApi.test.js
```

Expected: PASS

- [ ] **Step 2: Run backend verification**

Run:

```bash
.\.venv\Scripts\python.exe -m pytest tests/api/test_tasks_api.py -q
```

Expected: PASS

- [ ] **Step 3: Spot-check behavior manually**

Verify:
- intake modal requires at least one experiment
- summary text matches selected experiments and order
- created task code still uses `SYLU-YYYY-MM-NNN`
- generated experiments follow `任务号-A/B/C` order

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: support multi-experiment selection in task intake"
```
