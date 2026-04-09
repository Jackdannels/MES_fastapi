# 任务重置与单一实验类型展示 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重置当前任务数据并统一排程看板、任务受理页的实验类型下拉与筛选口径，只保留单一实验类型。

**Architecture:** 以后端 demo reset 生成唯一实验类型组合为数据基础，再在前端用共享的实验类型拆分/去重逻辑构建 option 和包含匹配筛选。排程看板只改展示与选项来源，不改底层具体实验记录的持久化结构。

**Tech Stack:** FastAPI/Python, Vue 3, Vitest, pytest, existing MES snapshot storage

---

## Chunk 1: Reset Data Rules

### Task 1: Make demo reset generate unique experiment types per task

**Files:**
- Modify: `app/core/demo_data_reset.py`
- Test: `tests/core/test_storage_backend.py`
- Test: `tests/core/test_mysql_storage_backend.py`

- [ ] **Step 1: Write the failing test**

Add tests asserting that after demo reset:
- each task still has 3 experiments
- each task’s experiment names are unique
- each task’s `test_type` equals the deduplicated experiment-name summary

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -q`
Expected: FAIL if reset output can still emit duplicate experiment types or stale summaries

- [ ] **Step 3: Write minimal implementation**

Update `build_demo_reset_snapshot(...)` so task experiment types are sampled uniquely and `test_type` is rebuilt from the resulting experiment list.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/core/demo_data_reset.py tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py
git commit -m "fix: generate unique experiment types in demo reset"
```

### Task 2: Execute the full reset with the new rule

**Files:**
- Verify only

- [ ] **Step 1: Run the reset**

Run the existing reset entrypoint against the active backend so all current tasks are regenerated under the new rule.

- [ ] **Step 2: Verify reset summary**

Confirm:
- tasks reset to `待排程`
- samples reset to `运输中`
- schedules/experiment_trays/experiment_samples/streams cleared
- regenerated tasks contain no duplicate experiment types

## Chunk 2: Shared Experiment-Type Option Helpers

### Task 3: Add failing tests for atomic experiment-type option generation

**Files:**
- Modify: `frontend/src/modules/tasks/model.test.js`
- Modify: `frontend/src/modules/schedule/model.test.js`
- Modify: `frontend/src/modules/tasks/model.js`
- Modify: `frontend/src/modules/schedule/model.js`

- [ ] **Step 1: Write the failing test**

Add tests covering:
- splitting `冲击试验 / 盐雾试验 / 冲击试验` into atomic unique types
- building globally deduplicated option lists
- preserving Chinese sort order

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/tasks/model.test.js src/modules/schedule/model.test.js`
Expected: FAIL because current options still use combined strings

- [ ] **Step 3: Write minimal implementation**

Add shared helpers in the relevant model layer(s) to:
- split `test_type` summaries by `/`
- normalize/trim each atomic type
- deduplicate and sort

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/tasks/model.test.js src/modules/schedule/model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/tasks/model.js frontend/src/modules/tasks/model.test.js frontend/src/modules/schedule/model.js frontend/src/modules/schedule/model.test.js
git commit -m "feat: normalize atomic experiment type options"
```

## Chunk 3: Task Intake Filtering

### Task 4: Make task intake filter options atomic and filtering fuzzy-by-inclusion

**Files:**
- Modify: `frontend/src/modules/tasks/model.js`
- Modify: `frontend/src/modules/tasks/useTasksPage.js`
- Modify: `frontend/src/modules/tasks/page.runtime.test.js`
- Test: `frontend/src/modules/tasks/model.test.js`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- the “全部实验类型” dropdown only shows single experiment types
- duplicate/combined strings are removed from options
- selecting `冲击试验` matches tasks whose `test_type` contains `冲击试验`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js`
Expected: FAIL because current filtering uses row-level combined test-type strings

- [ ] **Step 3: Write minimal implementation**

Update task-page filtering and option generation to use atomic-type helpers and inclusion matching.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/tasks/model.js frontend/src/modules/tasks/useTasksPage.js frontend/src/modules/tasks/page.runtime.test.js frontend/src/modules/tasks/model.test.js
git commit -m "feat: filter task intake by atomic experiment type"
```

## Chunk 4: Schedule Manual Form

### Task 5: Make manual schedule options show only atomic experiment types

**Files:**
- Modify: `frontend/src/modules/schedule/model.js`
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Modify: `frontend/src/modules/schedule/page.vue`
- Test: `frontend/src/modules/schedule/model.test.js`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- the manual schedule dropdown no longer shows duplicated experiment names
- the dropdown no longer shows combined `A / B / C` strings
- only atomic experiment names remain

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js`
Expected: FAIL because current manual schedule options still derive from concrete experiment rows without global dedupe

- [ ] **Step 3: Write minimal implementation**

Update the manual schedule option builder and relevant page text so the user selects an atomic experiment type while internal scheduling still targets the correct concrete experiment record.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/schedule/model.js frontend/src/modules/schedule/useSchedulePage.js frontend/src/modules/schedule/page.vue frontend/src/modules/schedule/model.test.js frontend/src/modules/schedule/page.runtime.test.js
git commit -m "feat: use atomic experiment types in manual scheduling"
```

## Chunk 5: Final Verification

### Task 6: Run reset + focused regression suite

**Files:**
- Verify only

- [ ] **Step 1: Run backend verification**

Run:

```bash
.\.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -q
```

Expected: PASS

- [ ] **Step 2: Run focused frontend verification**

Run:

```bash
npm run test:run -- src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js
```

Expected: PASS

- [ ] **Step 3: Spot-check current reset data**

Verify:
- all tasks are `待排程`
- all samples are `运输中`
- no task contains duplicate experiment types
- the two experiment-type dropdowns contain only atomic, deduplicated items

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: reset tasks with unique experiment types and atomic filters"
```
