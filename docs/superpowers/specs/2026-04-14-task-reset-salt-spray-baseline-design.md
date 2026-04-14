# Task Reset Salt Spray Baseline Design

## Background

The project already has a MySQL-backed demo reset path in `app/core/demo_data_reset.py` and `scripts/reset_demo_data.py`, but the current baseline still chooses three experiment types fully at random. That means reset data does not guarantee salt spray coverage, and there is no in-app reset control for operators working from the task intake page.

The new requirement is:

- Reset all task-related business data from the UI.
- Rebuild every task as an unscheduled task with samples still in transit.
- Ensure every reset task keeps three experiment types, with `盐雾试验` always included.

## Goals

- Guarantee every reset task contains `盐雾试验` plus two distinct additional experiment types.
- Reset all task-related collections back to a clean baseline while preserving devices and system metadata.
- Expose a dedicated reset action from the task intake area with an explicit confirmation step.
- Keep the implementation MySQL-first and reuse the existing backend reset flow instead of inventing a frontend-only overwrite path.

## Non-Goals

- Changing the number of experiments per task.
- Introducing a new sample status vocabulary. The reset baseline continues to use `运输中` for unconfirmed arrival.
- Resetting devices or global metadata.
- Adding role-based authorization beyond the current authenticated app flow.

## Approach Options

### Option 1: Dedicated reset API plus task-page button

Add a dedicated tasks reset API, keep all reset semantics in the backend, and call it from the task intake page after a confirmation dialog.

Pros:

- Clear ownership of destructive behavior.
- Easy to test backend and frontend separately.
- Reuses the existing MySQL reset path.

Cons:

- Requires both backend and frontend changes.

### Option 2: Frontend triggers an existing script indirectly

Try to wrap `scripts/reset_demo_data.py` from the application flow.

Pros:

- Looks small initially.

Cons:

- Scripts are not a stable runtime contract.
- Deployment and permission handling become awkward.

### Option 3: Frontend rewrites all storage collections directly

Read all data in the browser and overwrite task-related collections from the UI.

Pros:

- Fastest to prototype.

Cons:

- Wrong ownership boundary for a destructive operation.
- Brittle and hard to protect.

## Selected Design

Use Option 1.

## Architecture

### Reset Baseline Builder

`app/core/demo_data_reset.py` remains the single source of truth for reset data generation. Its task generator changes from “three random experiments” to “salt spray plus two distinct non-salt experiments”.

For each generated task:

- `test_type` still stores three experiment names joined by ` / `.
- `experiment_codes` remains `A/B/C`.
- `experiment_count` remains `3`.
- At least one experiment is `盐雾试验`.
- The other two are sampled without duplication from the remaining experiment options.

Reset state stays aligned with current app vocabulary:

- Tasks: `待排程`
- Experiments: `待排程`
- Samples: `status=运输中`, `flow_status=运输中`
- Schedules, experiment trays, experiment samples, streams, conflicts: emptied

`mes.devices` and `mes.meta` are preserved.

### Reset API

Add a dedicated endpoint under the tasks router so the task intake flow can trigger the same backend reset used by scripts.

Expected behavior:

- Method: `POST`
- Path: `/api/tasks/reset`
- Result: summary counts plus a success message

The route delegates to `run_demo_reset(get_storage_backend())`, so runtime reset behavior stays aligned with MySQL storage and any future storage adapter boundary.

### Frontend Trigger

The central header gains a `任务重置` button to the left of `新建任务`, but only when the current route is the task intake page.

Interaction flow:

1. User clicks `任务重置`
2. A confirmation dialog explains that all current task-related data will be cleared and rebuilt
3. User confirms again
4. Frontend calls the new reset API
5. On success, the tasks page reloads tasks and dependent collections
6. A visible success message is shown
7. On failure, existing page state remains and an explicit error is shown

The reset button is disabled while reset is in progress to prevent double submission.

## Data Scope

Reset replaces these collections:

- `mes.tasks`
- `mes.samples`
- `mes.experiments`
- `mes.schedules`
- `mes.experiment_trays`
- `mes.experiment_samples`
- `mes.streams`
- `mes.conflicts`

Reset preserves:

- `mes.devices`
- `mes.meta`

## Error Handling

- Backend returns a normal HTTP error if reset cannot be completed.
- Frontend surfaces the backend failure as a visible message in the tasks page flow.
- If reset succeeds but follow-up page reload fails, the UI shows a partial-success warning instead of pretending everything refreshed cleanly.

## Testing Strategy

### Backend

- `tests/core/test_storage_backend.py`
  - Assert every generated reset task includes `盐雾试验`
  - Assert task, experiment, sample, and schedule-related reset states are rebuilt correctly
- `tests/api/test_tasks.py`
  - Assert `POST /api/tasks/reset` rewrites task-related collections and preserves devices/meta

### Frontend

- `frontend/src/lib/tasksApi.test.js`
  - Add reset API client coverage
- `frontend/src/modules/tasks/page.runtime.test.js`
  - Assert the reset button only appears in the intended context
  - Assert the confirmation flow calls the reset endpoint
  - Assert success and failure messages behave correctly
- `frontend/src/App.runtime.test.js`
  - Assert the central header shows the reset button only on the tasks route

## Rollout

1. Add backend tests.
2. Implement backend baseline and reset endpoint.
3. Add frontend tests.
4. Implement header button, confirmation dialog, and tasks-page integration.
5. Run targeted verification.
6. Execute a real database reset on the current machine.
