# Task Overview Tray Current Location Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the task/tray overview tray table so it shows each tray's canonical current status and strict current location.

**Architecture:** Keep the data derivation in `frontend/src/modules/task-overview/model.js` and keep `TaskOverviewTrayTable.vue` presentational. Reuse `buildTrayFlowView` from the sample flow model so tray status follows the existing canonical flow.

**Tech Stack:** Vue 3, Vitest, Vite path aliases.

---

## Chunk 1: Tray Overview Model And Table

### Task 1: Add Model Coverage For Strict Current Location

**Files:**
- Modify: `frontend/src/modules/task-overview/model.test.js`
- Modify: `frontend/src/modules/task-overview/model.js`

- [x] **Step 1: Write the failing test**

Add a `buildTrayOverviewRows` test where a tray belongs to a task with a formal lab schedule, but the sample `location` is `接驳区`. Assert:

```js
expect(rows[0]).toMatchObject({
  currentLocation: "接驳区",
  currentStatus: "到货",
  scheduleStatus: undefined,
});
expect(rows[0].lab).toBeUndefined();
```

- [x] **Step 2: Run test to verify it fails**

Run: `rtk npm --prefix frontend test -- --run src/modules/task-overview/model.test.js`
Expected: FAIL because the current model still returns `scheduleStatus` and `lab`.

- [x] **Step 3: Implement minimal model changes**

In `buildTrayOverviewRows`:

- Import `buildTrayFlowView`.
- Build schedule records with `experiment_code`, `device`, and timestamp only for flow context.
- For each tray, aggregate matching sample locations and statuses.
- Derive `currentStatus` from `buildTrayFlowView({ taskCode, trayCode, location, status, samples, schedules, experiments, experimentTrays })`.
- Set `currentLocation` from the sample `location`, falling back to `-`.
- Stop returning `lab` and `scheduleStatus` for real tray rows.
- For empty slots, set `currentStatus: "-"` and `currentLocation: "-"`.

- [x] **Step 4: Run model test to verify it passes**

Run: `rtk npm --prefix frontend test -- --run src/modules/task-overview/model.test.js`
Expected: PASS.

### Task 2: Update Tray Table Rendering

**Files:**
- Modify: `frontend/src/modules/task-overview/TaskOverviewTrayTable.test.js`
- Modify: `frontend/src/modules/task-overview/TaskOverviewTrayTable.vue`

- [x] **Step 1: Write the failing component test**

Update the component test to pass rows with `currentStatus` and `currentLocation`. Assert:

```js
expect(wrapper.text()).toContain("当前状态");
expect(wrapper.text()).toContain("当前位置");
expect(wrapper.text()).not.toContain("排程状态");
expect(wrapper.text()).not.toContain("实验室");
expect(wrapper.text()).toContain("已到达暂存间");
expect(wrapper.text()).toContain("恒温恒湿间（暂存间）");
```

- [x] **Step 2: Run test to verify it fails**

Run: `rtk npm --prefix frontend test -- --run src/modules/task-overview/TaskOverviewTrayTable.test.js`
Expected: FAIL because the table still renders the old headers and fields.

- [x] **Step 3: Implement minimal component changes**

In `TaskOverviewTrayTable.vue`:

- Change headers to `当前状态` and `当前位置`.
- Render `tray.currentStatus`.
- Render `tray.currentLocation`.
- Keep the status chip classes, but base scheduled/unscheduled styling on whether `currentStatus` is a real value.

- [x] **Step 4: Run component test to verify it passes**

Run: `rtk npm --prefix frontend test -- --run src/modules/task-overview/TaskOverviewTrayTable.test.js`
Expected: PASS.

### Task 3: Regression Verification

**Files:**
- Test: `frontend/src/modules/task-overview/model.test.js`
- Test: `frontend/src/modules/task-overview/TaskOverviewTrayTable.test.js`
- Test: `frontend/src/modules/task-overview/useTaskOverview.test.js`

- [x] **Step 1: Run task overview test set**

Run: `rtk npm --prefix frontend test -- --run src/modules/task-overview/model.test.js src/modules/task-overview/TaskOverviewTrayTable.test.js src/modules/task-overview/useTaskOverview.test.js`
Expected: PASS.

- [x] **Step 2: Check worktree**

Run: `rtk git status --short`
Expected: only the docs and intended frontend files changed.
