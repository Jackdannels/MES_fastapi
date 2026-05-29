# Device Maintenance Status Design

## Goal

Update device maintenance so device ledger editing is temporarily disabled, device safety state is stored separately from derived work state, and running experiments are handled explicitly before repair.

## Rules

- Safety status is stored as `可用`, `维修`, or `保养`.
- Work status is derived as `空闲`, `工作中`, `维修`, or `保养`.
- `维修` and `保养` override running state.
- `工作中` is derived from running tray status for the device lab.
- `空闲` is shown when safety status is `可用` and no tray is running.
- Planned repair/maintenance starts at `maintenance_start_at` and returns to `可用` after `maintenance_end_at`.
- Immediate `维修` and `保养` take effect on save; start time is not user editable.
- When a device is running, planned maintenance is not allowed. Immediate repair must ask whether to reschedule the current experiment or mark it completed.
- Rescheduling a running experiment must return affected trays to their previous stable state: previous experiment completed, staging, or handover.

## UI

- Hide the device ledger entry form actions for saving or adding devices.
- Keep device list, edit, maintenance plan, and maintenance record entry points.
- Edit dialog shows current work status as read-only and provides `设为可用` to end repair/maintenance early.
- Rename `维护计划` to `维保计划`; rename `维护类型` to `维保类型`.
- Maintenance plan type options are `计划维修`, `维修`, `计划保养`, and `保养`.
- Maintenance modal footer order is `取消`, then `确定`.

## Implementation Notes

- Replace the old task-switch-only pre-dispatch rollback helper with a previous-stable-state rollback helper.
- Keep rollback scoped to task and experiment tray codes.
- Prefer the existing backend `withdraw-current` semantics for current-laboratory reset and align frontend task-switch rollback with the same stable-state order.
- Add persistence fields for maintenance plan data in MySQL device mapping.
