# Task Arrival Time From Sample Store Design

## Goal

Make each task's `arrival_at` come exclusively from the sample-management "confirm store" action. Before store confirmation, the task arrival time may remain empty. Re-store operations overwrite the previous task arrival time.

## Scope

Included:
- Update sample store confirmation so it writes the confirmation timestamp back to the related task `arrival_at`.
- Make repeated store confirmation overwrite the existing task `arrival_at`.
- Stop task intake/edit forms from treating `arrival_at` as a user-maintained source of truth.
- Keep current task and sample persistence paths unchanged.

Excluded:
- Any schema change.
- Any new API route.
- Reworking unrelated sample or task status logic.

## Architecture

`frontend/src/modules/samples/samplesProcessModel.js` already owns the business rule for "confirm store". That is the correct place to derive the canonical task arrival time. When a task's samples are confirmed into storage, the model will set `task.arrival_at` to the current confirmation time and keep `task.updated_at` aligned.

The task intake/edit forms will stop writing `arrival_at` into new or updated task records. The field can still be displayed as a read-only informational field so users can see whether the task has been confirmed into storage.

## Data Flow

1. Task intake creates a task with `arrival_at = ""`.
2. Sample process confirms store for a task.
3. `confirmSampleTaskStore(...)` updates:
   - task `tray_codes`
   - task `arrival_at = confirmation time`
   - sample tray/history/status fields
4. The updated tasks collection is persisted through the existing storage path.
5. Task page reads the updated task and shows the new arrival time.

## Error Handling

- If confirm-store fails validation, no task arrival time changes.
- If a task has not yet been confirmed into storage, `arrival_at` remains blank.
- Re-store uses the latest confirmation time and overwrites the old value.

## Testing

- Add model tests proving confirm-store writes and overwrites task `arrival_at`.
- Add task model tests proving task create/update helpers no longer persist manual `arrival_at`.
- Add a page/runtime assertion proving the task arrival field is not user-editable.
