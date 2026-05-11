# Schedule Actual Completion Design

## Goal

Use actual experiment lifecycle as the source of truth when it conflicts with planned schedule windows.

## Design

Completed experiments must release their planned schedule occupancy immediately. Schedule conflict checks, task tray conflict checks, conflict rows, and process lab cards should ignore schedule records whose scoped experiment has actually completed.

The existing frontend schedule model already derives lifecycle state from sample tray status and experiment history. The fix will reuse that lifecycle helper instead of adding a second status system. Process lab cards will apply the same completed-schedule filter before selecting active or upcoming work.

Task experiment generation must stay tied to fixed experiment types. If a task provides `test_types`, that list defines the experiment count and labels; a larger stale `experiment_count` must not create fallback labels such as `实验4` or `实验5`.

## Testing

Add failing tests for:

- Same-device schedule conflicts ignore completed existing schedules.
- Same-task tray conflicts ignore completed sibling schedules.
- Process lab cards become idle when the only active planned schedule has completed.
- Task creation ignores stale `experiment_count` values larger than the fixed `test_types` list.
