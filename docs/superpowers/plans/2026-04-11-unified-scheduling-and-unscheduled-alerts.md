# Unified Scheduling And Unscheduled Alerts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dual scheduling terminology, add experiment-level unscheduled timers, and surface overdue alerts in dashboard, task overview, and navigation.

**Architecture:** Persist a single experiment-level `unscheduled_since` timestamp in the shared snapshot model. Backend arrival and schedule lifecycle paths own timestamp writes; frontend modules derive current unscheduled and overdue UI from that single field. Existing schedule/task/sample models remain in place, with targeted updates in schedule, dashboard, task-overview, and app-shell layers.

**Tech Stack:** FastAPI, pytest, Vue 3, Vitest, local snapshot storage helpers

---

## File Map

- Modify: `app/api/routes/transfer_area.py`
- Modify: `frontend/src/modules/schedule/model.js`
- Modify: `frontend/src/modules/schedule/model.test.js`
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Modify: `frontend/src/modules/schedule/page.vue`
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`
- Modify: `frontend/src/modules/dashboard/model.js`
- Modify: `frontend/src/modules/dashboard/model.test.js`
- Modify: `frontend/src/modules/dashboard/useDashboardPage.js`
- Modify: `frontend/src/modules/dashboard/page.vue`
- Modify: `frontend/src/modules/dashboard/page.runtime.test.js`
- Modify: `frontend/src/modules/task-overview/model.js`
- Modify: `frontend/src/modules/task-overview/model.test.js`
- Modify: `frontend/src/modules/task-overview/TaskOverviewCard.vue`
- Modify: `frontend/src/modules/task-overview/TaskOverviewCard.test.js`
- Modify: `frontend/src/modules/task-overview/page.vue`
- Modify: `frontend/src/modules/task-overview/useTaskOverview.js`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/App.runtime.test.js`
- Test: `tests/api/test_transfer_area.py`

## Chunk 1: Experiment Timer Persistence

### Task 1: Add failing backend tests for experiment unscheduled timestamps

**Files:**
- Modify: `tests/api/test_transfer_area.py`
- Reference: `app/api/routes/transfer_area.py`

- [ ] **Step 1: Write the failing test**

Add tests covering:

```python
def test_confirm_storage_sets_unscheduled_since_only_for_experiments_without_formal_schedule(client):
    ...

def test_deleting_last_formal_schedule_restarts_unscheduled_since(...):
    ...
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/api/test_transfer_area.py -k unscheduled_since -v`
Expected: FAIL because the backend does not yet write experiment-level timer fields.

- [ ] **Step 3: Write minimal implementation**

Implement helpers in `app/api/routes/transfer_area.py` to:

- find task experiments
- detect formal schedules by `device`
- set `unscheduled_since` at confirm-arrival time

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/api/test_transfer_area.py -k unscheduled_since -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/api/test_transfer_area.py app/api/routes/transfer_area.py
git commit -m "feat: persist unscheduled experiment timers on arrival"
```

### Task 2: Cover schedule create/update/delete timer transitions in schedule-model tests

**Files:**
- Modify: `frontend/src/modules/schedule/model.test.js`
- Modify: `frontend/src/modules/schedule/model.js`

- [ ] **Step 1: Write the failing test**

Add tests for:

```js
it("clears unscheduled_since when creating a formal schedule", () => {});
it("restarts unscheduled_since when deleting the last formal schedule", () => {});
it("does not restart unscheduled_since when another formal schedule remains", () => {});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test -- src/modules/schedule/model.test.js`
Expected: FAIL because schedule helpers do not yet update experiments.

- [ ] **Step 3: Write minimal implementation**

Update schedule helpers to accept and return `experiments`, then:

- clear `unscheduled_since` on formal schedule create/update
- set `unscheduled_since = now` on delete when the experiment becomes unscheduled

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend; npm run test -- src/modules/schedule/model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/schedule/model.js frontend/src/modules/schedule/model.test.js
git commit -m "feat: sync experiment timers with schedule lifecycle"
```

## Chunk 2: Unified Schedule UI

### Task 3: Remove dual-tab schedule UI behind failing runtime tests

**Files:**
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`
- Modify: `frontend/src/modules/schedule/page.vue`
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Modify: `frontend/src/modules/schedule/model.js`
- Modify: `frontend/src/modules/schedule/useSchedulePage.test.js`

- [ ] **Step 1: Write the failing test**

Add runtime assertions such as:

```js
expect(screen.queryByTestId("schedule-tab-unpacking")).toBeNull();
expect(screen.queryByTestId("schedule-tab-retention")).toBeNull();
```

Also add state-level tests that no longer depend on `activeTab` / retention-panel branching.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test -- src/modules/schedule/page.runtime.test.js src/modules/schedule/useSchedulePage.test.js`
Expected: FAIL because tabs and retention-specific logic still exist.

- [ ] **Step 3: Write minimal implementation**

Remove:

- tab buttons from `page.vue`
- `useTabState` dependency from `useSchedulePage.js`
- retention-only task-source branching from schedule helpers

Keep:

- one experiment-at-a-time scheduling flow
- partial scheduling support through experiment options

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend; npm run test -- src/modules/schedule/page.runtime.test.js src/modules/schedule/useSchedulePage.test.js src/modules/schedule/model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/schedule/page.vue frontend/src/modules/schedule/useSchedulePage.js frontend/src/modules/schedule/useSchedulePage.test.js frontend/src/modules/schedule/page.runtime.test.js frontend/src/modules/schedule/model.js frontend/src/modules/schedule/model.test.js
git commit -m "feat: unify schedule page into a single scheduling flow"
```

## Chunk 3: Dashboard Unscheduled Timing Panel

### Task 4: Add dashboard model tests for unscheduled experiment timers

**Files:**
- Modify: `frontend/src/modules/dashboard/model.test.js`
- Modify: `frontend/src/modules/dashboard/model.js`
- Modify: `frontend/src/modules/dashboard/useDashboardPage.js`

- [ ] **Step 1: Write the failing test**

Add tests for:

```js
it("replaces data channel output with unscheduled experiment timers", () => {});
it("marks overdue timers when unscheduled duration exceeds 24 hours", () => {});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test -- src/modules/dashboard/model.test.js`
Expected: FAIL because the view model still returns `dataHealth` and `dataGap`.

- [ ] **Step 3: Write minimal implementation**

Change the dashboard view model to:

- load `experiments`
- build `unscheduledExperimentItems`
- compute elapsed duration and overdue style flags
- stop returning the old data-channel card model

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend; npm run test -- src/modules/dashboard/model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/dashboard/model.js frontend/src/modules/dashboard/model.test.js frontend/src/modules/dashboard/useDashboardPage.js
git commit -m "feat: add dashboard unscheduled experiment timers"
```

### Task 5: Replace the dashboard card in the page runtime

**Files:**
- Modify: `frontend/src/modules/dashboard/page.vue`
- Modify: `frontend/src/modules/dashboard/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Assert:

```js
expect(wrapper.text()).not.toContain("数据通道");
expect(wrapper.text()).toContain("未排程实验计时");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test -- src/modules/dashboard/page.runtime.test.js`
Expected: FAIL because the page still renders the old card.

- [ ] **Step 3: Write minimal implementation**

Render the unscheduled-timer list with red overdue text and empty-state handling.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend; npm run test -- src/modules/dashboard/page.runtime.test.js src/modules/dashboard/model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/dashboard/page.vue frontend/src/modules/dashboard/page.runtime.test.js frontend/src/modules/dashboard/model.js frontend/src/modules/dashboard/model.test.js frontend/src/modules/dashboard/useDashboardPage.js
git commit -m "feat: replace dashboard data channel with timing panel"
```

## Chunk 4: Task Overview And Navigation Alerts

### Task 6: Add failing model tests for overdue waiting state

**Files:**
- Modify: `frontend/src/modules/task-overview/model.test.js`
- Modify: `frontend/src/modules/task-overview/model.js`
- Modify: `frontend/src/modules/task-overview/useTaskOverview.js`

- [ ] **Step 1: Write the failing test**

Add tests proving:

```js
it("marks experiment waiting rows overdue when unscheduled_since is older than 24 hours", () => {});
it("keeps waiting rows normal when unscheduled_since is within 24 hours", () => {});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test -- src/modules/task-overview/model.test.js src/modules/task-overview/useTaskOverview.test.js`
Expected: FAIL because task-overview rows do not expose overdue experiment flags yet.

- [ ] **Step 3: Write minimal implementation**

Extend task-overview row shaping to expose:

- experiment-level overdue flag
- menu-alert aggregate flag for the app shell

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend; npm run test -- src/modules/task-overview/model.test.js src/modules/task-overview/useTaskOverview.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/task-overview/model.js frontend/src/modules/task-overview/model.test.js frontend/src/modules/task-overview/useTaskOverview.js frontend/src/modules/task-overview/useTaskOverview.test.js
git commit -m "feat: expose overdue unscheduled experiment state"
```

### Task 7: Render red waiting state in task overview cards

**Files:**
- Modify: `frontend/src/modules/task-overview/TaskOverviewCard.vue`
- Modify: `frontend/src/modules/task-overview/TaskOverviewCard.test.js`
- Modify: `frontend/src/modules/task-overview/page.vue`

- [ ] **Step 1: Write the failing test**

Add a component test verifying overdue `待排程` uses the alert class.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test -- src/modules/task-overview/TaskOverviewCard.test.js`
Expected: FAIL because the component does not yet style overdue waiting rows differently.

- [ ] **Step 3: Write minimal implementation**

Render overdue experiment status with a red modifier class while preserving current layout.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend; npm run test -- src/modules/task-overview/TaskOverviewCard.test.js src/modules/task-overview/model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/task-overview/TaskOverviewCard.vue frontend/src/modules/task-overview/TaskOverviewCard.test.js frontend/src/modules/task-overview/model.js frontend/src/modules/task-overview/model.test.js
git commit -m "feat: style overdue waiting experiments in task overview"
```

### Task 8: Add app-shell red-dot alert

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add a test that mounts the app shell with overdue experiment data and expects a nav-dot next to `任务/托盘总览`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test -- src/App.runtime.test.js`
Expected: FAIL because the navigation currently renders plain labels only.

- [ ] **Step 3: Write minimal implementation**

Load snapshot state needed for the red dot in `App.vue` and render a non-numeric badge on the `任务/托盘总览` nav link when overdue experiments exist.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend; npm run test -- src/App.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.vue frontend/src/App.runtime.test.js
git commit -m "feat: add overdue alert dot to task overview navigation"
```

## Chunk 5: End-To-End Verification

### Task 9: Run focused regression suites

**Files:**
- Test: `tests/api/test_transfer_area.py`
- Test: `frontend/src/modules/schedule/model.test.js`
- Test: `frontend/src/modules/schedule/useSchedulePage.test.js`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`
- Test: `frontend/src/modules/dashboard/model.test.js`
- Test: `frontend/src/modules/dashboard/page.runtime.test.js`
- Test: `frontend/src/modules/task-overview/model.test.js`
- Test: `frontend/src/modules/task-overview/useTaskOverview.test.js`
- Test: `frontend/src/modules/task-overview/TaskOverviewCard.test.js`
- Test: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Run backend verification**

Run: `pytest tests/api/test_transfer_area.py -v`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run:

```bash
cd frontend
npm run test -- src/modules/schedule/model.test.js src/modules/schedule/useSchedulePage.test.js src/modules/schedule/page.runtime.test.js src/modules/dashboard/model.test.js src/modules/dashboard/page.runtime.test.js src/modules/task-overview/model.test.js src/modules/task-overview/useTaskOverview.test.js src/modules/task-overview/TaskOverviewCard.test.js src/App.runtime.test.js
```

Expected: PASS

- [ ] **Step 3: Run one final mixed smoke check**

Run: `git diff --check`
Expected: no whitespace or patch-format errors

- [ ] **Step 4: Commit**

```bash
git add app/api/routes/transfer_area.py tests/api/test_transfer_area.py frontend/src/modules/schedule frontend/src/modules/dashboard frontend/src/modules/task-overview frontend/src/App.vue frontend/src/App.runtime.test.js
git commit -m "feat: unify scheduling and add unscheduled experiment alerts"
```

## Notes For Execution

- Follow @superpowers:test-driven-development for every behavior change.
- Use @superpowers:verification-before-completion before claiming the feature is finished.
- Ignore unrelated dirty-worktree files already present in the repository.
- Do not add historical backfill for legacy records lacking `unscheduled_since`; only new lifecycle events should start timers.
