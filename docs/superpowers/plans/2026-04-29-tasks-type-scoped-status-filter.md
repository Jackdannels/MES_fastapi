# Tasks Type Scoped Status Filter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the total task list status filter and search operate inside the selected experiment type scope.

**Architecture:** Keep the UI order unchanged in `page.vue`. Change `useTasksPage.js` to derive type-scoped rows first, build status options from that scoped set, then pass status-filtered rows into the shared table controls for search, sort, and pagination.

**Tech Stack:** Vue 3, Vitest, Vue Test Utils.

---

## Chunk 1: Task List Filter Pipeline

### Task 1: Add Runtime Coverage For Type-Scoped Status Options

**Files:**
- Modify: `frontend/src/modules/tasks/page.runtime.test.js`
- Modify: `frontend/src/modules/tasks/useTasksPage.js`

- [x] **Step 1: Write the failing test**

Add a runtime test with three tasks:

- `冲击试验` task in `待排程`
- `冲击试验` task in `已排程`
- `霉菌试验` task in `任务进行中`

Assert that before selecting a type, the status dropdown contains all three statuses. Select `冲击试验`, then assert the status dropdown contains `待排程` and `已排程`, but not `任务进行中`.

- [x] **Step 2: Run the test to verify it fails**

Run: `rtk npm --prefix frontend test -- --run src/modules/tasks/page.runtime.test.js`
Expected: FAIL because status options currently come from all task rows.

- [x] **Step 3: Implement the minimal filter pipeline**

In `frontend/src/modules/tasks/useTasksPage.js`:

- Add `typeFilteredRows` computed from `allRows` and `selectedTestType`.
- Change `filteredRows` to start from `typeFilteredRows` and only apply `selectedStatus`.
- Change returned `statusOptions` to `computed(() => buildFilterOptions(typeFilteredRows.value).statusOptions)`.
- Add a watcher on `selectedTestType` that clears `selectedStatus` when the current status no longer exists in the type-scoped options.

- [x] **Step 4: Run the runtime test to verify it passes**

Run: `rtk npm --prefix frontend test -- --run src/modules/tasks/page.runtime.test.js`
Expected: PASS.

### Task 2: Cover Search And Status Inside Type Scope

**Files:**
- Modify: `frontend/src/modules/tasks/page.runtime.test.js`

- [x] **Step 1: Extend the test**

After selecting `冲击试验`, choose status `已排程`, then search for the scheduled task code and assert only that row remains. Search for the `霉菌试验` task code and assert zero rows remain because search is scoped by the selected experiment type and status.

- [x] **Step 2: Run the test to verify it passes**

Run: `rtk npm --prefix frontend test -- --run src/modules/tasks/page.runtime.test.js`
Expected: PASS.

### Task 3: Regression Verification

**Files:**
- Test: `frontend/src/modules/tasks/page.runtime.test.js`
- Test: `frontend/src/modules/tasks/model.test.js`

- [x] **Step 1: Run task module tests**

Run: `rtk npm --prefix frontend test -- --run src/modules/tasks/page.runtime.test.js src/modules/tasks/model.test.js`
Expected: PASS.

- [x] **Step 2: Check worktree**

Run: `rtk git status --short`
Expected: only the docs and intended task module files changed.
