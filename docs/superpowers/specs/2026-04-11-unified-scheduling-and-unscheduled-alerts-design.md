# Unified Scheduling And Unscheduled Alerts Design

## Summary

This change removes the conceptual split between `接驳区排程` and `暂存间排程` and replaces it with one unified scheduling system for all experiments, regardless of current sample location. The new model must support partial scheduling within a task, experiment-level unscheduled timing, and overdue alerts after `确认到货`.

The alerting rule is experiment-scoped, not task-scoped:

- when a task is confirmed as arrived, every experiment without a formal schedule starts an unscheduled timer
- when an experiment receives a formal schedule, its timer is cleared
- when a formal schedule is deleted and the experiment becomes unscheduled again, the timer restarts from the deletion time
- if the current continuous unscheduled duration exceeds 24 hours, the UI shows red text and a navigation red-dot reminder

## Goals

- Present only one scheduling entry point and one scheduling concept throughout the central-control UI.
- Allow scheduling only part of a task's experiments.
- Replace the dashboard `数据通道` card with an experiment-level unscheduled timing panel.
- Add experiment-level overdue styling and a task-overview menu red dot when any experiment is overdue.
- Preserve existing reschedule flows, including delete-then-reschedule and edit flows.

## Non-Goals

- Reconstruct historical unscheduled durations for legacy data.
- Introduce a new standalone alert table or background job.
- Redesign tray logistics or sample transport semantics beyond removing scheduling terminology split.

## Product Rules

### Unified scheduling

- The scheduling module no longer distinguishes `接驳区排程` and `暂存间排程`.
- Samples in any location use the same scheduling page and the same schedule-record model.
- `暂存间` may still exist as a logistics location in sample flow, but it is not a scheduling type anymore.

### Partial experiment scheduling

- A task with experiments `A/B/C` may schedule only `A/B`.
- The schedule form continues to operate on a single experiment at a time.
- Only experiments without a formal schedule appear in the schedule-form experiment selector.

### Unscheduled timer lifecycle

- The timer field lives on each experiment as `unscheduled_since`.
- `确认到货` initializes `unscheduled_since` for every experiment under the task that has no formal schedule.
- Creating or updating a formal schedule for an experiment clears `unscheduled_since`.
- Deleting a formal schedule for an experiment sets `unscheduled_since` to the deletion time if the experiment still has no remaining formal schedule.
- The timer measures the current continuous unscheduled interval only. It does not accumulate historical totals across multiple schedule/delete cycles.

### Formal schedule definition

- A formal schedule is any schedule record whose `device` is not a staging/retention location.
- Legacy staging schedule records remain readable for compatibility but do not count as formal scheduled state.

### Alert thresholds

- Every currently unscheduled experiment is shown in the dashboard timing panel with a live elapsed duration.
- When elapsed time exceeds 24 hours:
  - the elapsed duration text becomes red in the dashboard panel
  - the experiment's `待排程` state becomes red in task overview
  - the left navigation item `任务/托盘总览` shows a red dot

## Data Model Changes

### Experiment records

Add to `mes.experiments` records:

- `unscheduled_since: string`
  - ISO timestamp
  - empty string when the experiment is formally scheduled

No additional persisted boolean is required. Overdue state is derived from `unscheduled_since`.

### Schedule records

- No new schedule schema is required.
- Existing `device` semantics continue to determine whether a record is formal or staging-like.

## Backend Design

### Arrival confirmation path

Update the transfer-area confirm-arrival path so that after task arrival is confirmed:

1. load experiments for the task
2. detect which experiments already have formal schedules
3. set `unscheduled_since = now` for experiments without formal schedules
4. leave scheduled experiments unchanged

The timing baseline must be written by the backend because `确认到货` already occurs there.

### Schedule create/update/delete path

Update schedule persistence helpers so experiment timing stays correct:

- create formal schedule:
  - clear the target experiment's `unscheduled_since`
- update schedule:
  - if the experiment remains formally scheduled, keep `unscheduled_since` cleared
- delete schedule:
  - if the deleted record was the experiment's last formal schedule, set `unscheduled_since = now`

Delete-and-immediately-reschedule flows should not leave stale overdue state behind once the new schedule is saved.

## Frontend Design

### Schedule page

- Remove the two top tab buttons from `frontend/src/modules/schedule/page.vue`.
- Remove `activeTab === "retention"` branching from schedule-page state and model helpers.
- Present one scheduling workflow:
  - select task
  - select experiment
  - select formal device
  - select time
  - save schedule

The experiment selector remains the mechanism that supports partial scheduling.

### Dashboard

Replace the current `数据通道` card with `未排程实验计时` content:

- list experiments that currently have `unscheduled_since`
- show task code, experiment label, and elapsed duration
- update elapsed duration live on the client
- show overdue durations in red after 24 hours

The summary-card area stays intact unless implementation reveals a strong need to move counts.

### Task overview

- Keep task and tray overview structure unchanged.
- In task view, mark experiment-level `待排程` as red when `unscheduled_since` is older than 24 hours.
- Keep tray view focused on tray allocation/schedule summary, without introducing experiment-level duplicated counters there.

### App navigation

- Add a red dot to the left navigation item `任务/托盘总览` whenever at least one experiment is overdue.
- Do not show a numeric badge in the nav.

## Legacy Data Compatibility

- Existing records without `unscheduled_since` remain valid.
- Legacy tasks do not receive retroactive overdue timestamps.
- Timing begins only after a new arrival confirmation or a schedule deletion under the new rules.

## Error Handling

- Missing or malformed `unscheduled_since` is treated as no active timer.
- If an experiment is missing from the experiment list, schedule create/delete should not fail the entire action; the schedule action succeeds and timing is skipped for that experiment.
- Formal-schedule detection must ignore staging-like devices consistently in backend and frontend helpers.

## Testing Strategy

### Backend

- confirm-arrival sets `unscheduled_since` only for unscheduled experiments
- creating a formal schedule clears `unscheduled_since`
- deleting the last formal schedule restarts `unscheduled_since`
- deleting one of multiple formal schedules does not restart timing if another formal schedule still exists

### Frontend model/unit tests

- schedule options include only experiments without formal schedules
- dashboard view model emits unscheduled experiment timers and overdue styling flags
- task overview rows expose overdue `待排程` state correctly
- app-shell navigation shows a red dot when overdue experiments exist

### Runtime/component tests

- schedule page no longer renders dual scheduling tabs
- dashboard no longer renders `数据通道`
- task overview renders overdue waiting state in red
- app shell renders the menu red dot

## Acceptance Criteria

- The schedule page exposes only one scheduling concept.
- A multi-experiment task can remain partially scheduled.
- Arrival confirmation starts experiment-level unscheduled timing only for currently unscheduled experiments.
- Removing a schedule without re-adding one restarts unscheduled timing for that experiment.
- Dashboard shows all currently unscheduled experiments with live elapsed durations.
- Experiments overdue for more than 24 hours are red in both dashboard timing and task-overview status.
- The left navigation item `任务/托盘总览` shows a red dot whenever any overdue experiment exists.
