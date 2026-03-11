# Process Task Modal Polish Design

**Goal:** Make the process-page task modal feel more distinctive while removing batch suffixes from the displayed task name.

## Problem

- The current modal works, but it still reads like a generic detail panel.
- The displayed task name can inherit source data like `Batch A` or `批次A`, which the user does not want shown in this context.

## Interaction

- Keep the current-page centered modal interaction.
- Do not navigate away from `/process`.
- Keep the modal read-only.

## Visual direction

- Turn the modal into a "task intelligence card" rather than a form-like panel.
- Use a stronger hero section with:
  - task code
  - sanitized task name
  - status badge
- Promote tray info from a plain sentence into compact chips plus a highlighted count.
- Keep the information hierarchy:
  - hero
  - key facts
  - execution summary
  - supporting details

## Data rules

- Keep raw task data unchanged.
- Only the displayed name is sanitized.
- Strip trailing batch suffixes such as:
  - `Batch A`
  - `- Batch A`
  - `批次A`
  - `-批次A`

## Testing

- Update composable tests to verify display-name sanitization and tray metadata.
- Update runtime tests to verify the polished modal renders the sanitized name and tray chips.
