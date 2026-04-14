# Transfer Progress And Lab Compare Lock Design

## Background

The current transfer-area summary can show `实验已完成` as soon as one experiment finishes, even when the task still has other unfinished experiments. The laboratory workflow also still allows returning to step 1 after step 2 has started, which conflicts with the intended operating rule.

## Target Behavior

1. Transfer-area task progress should only show `实验已完成` when all experiments under the task are complete.
2. If any experiment work has started but not all experiments are complete, the transfer-area summary should show `实验进行中`.
3. In the laboratory console, step 1 (`任务比对`) remains available before step 2 starts.
4. Once step 2 (`样品安装`) has been executed for the current experiment, step 1 and step 2 must both stay disabled until the experiment finishes.
5. Step 2 only upgrades trays that have already been compared to `工装夹具安装`.
6. Step 3 (`确认准备就绪`) only upgrades trays already at `工装夹具安装` to `实验准备就绪`.

## Design

### Transfer-area progress summary

Use the task's experiment records as the authoritative source for "all experiments complete". Sample/tray status remains the trigger for "started". The summary logic becomes:

- No started experiment state: keep existing transfer-area messaging (`已确认入库`, `条形码已打印，待确认入库`, etc.)
- Started state exists and all task experiments are complete: show the completed-like state
- Started state exists but task experiments are not all complete: show `实验进行中`

This prevents a single finished experiment from promoting the whole task to `实验已完成`.

### Laboratory workflow lock

Treat "any tray has reached install-or-later status" as a hard lock on both step 1 and step 2. The workflow model keeps the existing derived booleans, but the action-state rule changes to:

- `任务比对` allowed only when installation has not started and comparison is not already fully complete
- `样品安装` allowed only before installation has started, once at least one tray has already been compared
- `确认准备就绪` allowed once installation has started/completed and ready has not already been confirmed

The page-level status updates also stay tray-scoped:

- `样品安装` targets only trays currently at `已到达实验室`
- `确认准备就绪` targets only trays currently at `工装夹具安装`

This keeps pre-install repeated comparison available while preventing both re-compare and re-install after installation begins, and it prevents un-compared trays from being promoted by a repeated install click.

## Validation

- Backend API tests for transfer-area bootstrap/workspace summaries
- Frontend laboratory model tests for action-state transitions, including install lock after the first install
- Frontend runtime tests covering button disablement after installation and tray-scoped ready promotion
