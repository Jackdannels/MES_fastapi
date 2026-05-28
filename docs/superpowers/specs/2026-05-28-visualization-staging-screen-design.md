# Visualization Staging Screen Design

## Goal

Build visualization screen 6 as a staging-room sample information board. It should match the existing industrial visualization style, support viewing by task and tray, show up to five samples per tray with an all-samples modal when a tray has more than five samples, show tray remaining capacity from an actual total of 10 trays, and show remaining capacity for salt-spray and mold with default capacity 100.

## Approved Direction

Use方案 A: task/tray operations board.

The full screen uses the existing `.visual-board` dark industrial shell. The main area is split into three zones:

- Left rail: task switcher with task code, tray count, and sample count.
- Center panel: tray switcher plus selected tray details. Each tray displays tray code, task code, experiment type, status, and up to five sample codes. If the tray has more than five samples, show a clear "全部样品" action.
- Right panel: capacity metrics for tray remaining, salt-spray remaining, and mold remaining. Capacity defaults to 100 for each metric.

## Data Model

Add a visualization model function that builds a staging board view from the storage snapshot:

- Inputs: tasks, samples, experiments, experiment_trays, schedules, staging_events.
- Reuse staging concepts from `staging-management/model.js` where possible, especially current staging statuses and latest staging events.
- Current staging inventory includes trays whose latest state is currently in staging: `到货`, `已入库`, `放置实验后暂存间`, or equivalent current staging status from sample/tray data.
- Group rows by task, then tray.
- Resolve experiment type from experiment-tray relations and experiments first, then fallback to task test type or sample type.
- Attach sample codes to each tray from sample tray membership.

Capacity:

- Tray remaining = `10 - current staging tray count`, clamped at 0.
- Salt-spray remaining = `100 - count of current staging trays whose experiment type/test type contains 盐雾`, clamped at 0.
- Mold remaining = `100 - count of current staging trays whose experiment type/test type contains 霉菌`, clamped at 0.

## Interaction

On the full-size screen:

- Clicking a task changes the selected task.
- Clicking a tray changes the selected tray within that task.
- Clicking "全部样品" opens a modal listing all samples for that tray in a readable grid.
- The modal can be closed by its close button or backdrop.

In compact combined preview mode:

- Render a read-only condensed summary with top tasks/trays and capacity values.
- Hide modal controls to keep the combined eight-screen preview stable.

## Visual Style

Use the current visualization industrial language instead of a blue-only reference style:

- dark machinery-room background, fine grid, teal/amber status accents
- thin illuminated borders and dense information hierarchy
- stable fixed-format columns for task rail, tray detail, and capacity panel
- no nested decorative cards; panels are functional zones inside the board

## Testing

Add focused tests:

- model test for task/tray grouping, sample codes, experiment type resolution, and capacity calculation
- runtime test that screen 6 renders the staging board, supports task/tray switching, and opens the all-samples modal for trays with more than five samples
- style test for the new staging screen classes and compact behavior
