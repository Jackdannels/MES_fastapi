# Tasks API Cutover Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the tasks page off the generic storage endpoint for task CRUD while preserving current page behavior and dependent snapshot updates.

**Architecture:** Add a task-specific backend router over the existing storage backend, then switch the tasks page to call a dedicated frontend API helper for task reads and writes. Leave schedules, samples, and streams on the snapshot bridge for this increment.

**Tech Stack:** FastAPI, existing storage backend abstraction, Vue 3 composables, Vitest, pytest

---

## Chunk 1: Backend Tasks Router

### Task 1: Add failing backend tests for task CRUD

**Files:**
- Create: `tests/api/test_tasks.py`
- Modify: `tests/api/test_router_registry.py`
- Modify: `tests/api/test_module_registry.py`

- [ ] **Step 1: Write failing tests for `/api/tasks` lifecycle and router registration**
- [ ] **Step 2: Run `pytest tests/api/test_tasks.py tests/api/test_router_registry.py tests/api/test_module_registry.py -q` and confirm failure**
- [ ] **Step 3: Implement minimal backend router and registration**
- [ ] **Step 4: Re-run the same pytest command and confirm it passes**

### Task 2: Add the task router implementation

**Files:**
- Create: `app/api/routes/tasks.py`
- Modify: `app/modules/registry.py`

- [ ] **Step 1: Read and write only `mes.tasks` through the storage backend**
- [ ] **Step 2: Match update/delete by task `id` or `code`**
- [ ] **Step 3: Return task-shaped payloads and 404s for missing rows**
- [ ] **Step 4: Keep implementation minimal and avoid touching unrelated modules**

## Chunk 2: Frontend Tasks API Helper

### Task 3: Add failing frontend API tests

**Files:**
- Create: `frontend/src/lib/tasksApi.test.js`

- [ ] **Step 1: Write failing tests for remote task read/create/update/delete and local fallback**
- [ ] **Step 2: Run `npm --prefix frontend test -- src/lib/tasksApi.test.js` or the repo-equivalent Vitest command and confirm failure**

### Task 4: Implement frontend tasks API helper

**Files:**
- Create: `frontend/src/lib/tasksApi.js`

- [ ] **Step 1: Add fetch wrappers for `GET /api/tasks`, `POST /api/tasks`, `PUT /api/tasks/{id}`, and `DELETE /api/tasks/{id}`**
- [ ] **Step 2: Keep local storage task cache in sync for fallback**
- [ ] **Step 3: Re-run the frontend task API test and confirm it passes**

## Chunk 3: Tasks Page Cutover

### Task 5: Switch the tasks page to the dedicated API

**Files:**
- Modify: `frontend/src/modules/tasks/useTasksPage.js`
- Test: `frontend/src/modules/tasks/page.runtime.test.js`

- [ ] **Step 1: Load tasks from `tasksApi` while still loading schedules/samples/streams from snapshot storage**
- [ ] **Step 2: Route create/update/delete task mutations through `tasksApi`**
- [ ] **Step 3: Keep dependent sample/schedule/stream snapshot writes unchanged**
- [ ] **Step 4: Update or add runtime assertions only where the new API surface changes expectations**

## Chunk 4: Verification and User Checkpoint

### Task 6: Run focused verification and hand off manual checks

**Files:**
- Modify: `app/api/routes/tasks.py` as needed
- Modify: `frontend/src/lib/tasksApi.js` as needed
- Modify: `frontend/src/modules/tasks/useTasksPage.js` as needed

- [ ] **Step 1: Run `pytest tests/api/test_tasks.py tests/api/test_router_registry.py tests/api/test_module_registry.py -q`**
- [ ] **Step 2: Run the focused frontend tests for `tasksApi` and `tasks/page.runtime.test.js`**
- [ ] **Step 3: Run `git diff --check` on touched files**
- [ ] **Step 4: Stop and give the user explicit UI/API verification steps before continuing to the next module**
