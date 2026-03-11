# Process Task Modal Design

**Goal:** Replace the current process-page task drawer with a centered modal that highlights a compact task summary and tray summary without navigating away from the current page.

**Context:** The process page currently uses `useProcessLabs()` to build lab cards and open a right-side drawer. The user wants a clearer popup-style interaction and only the most important attributes, with tray information shown as a summary rather than a full per-sample breakdown.

## Interaction

- Clicking `查看任务` on a lab card keeps the user on `/process`.
- A centered modal opens over the current page.
- The modal is read-only and optimized for scan speed rather than editing.
- Clicking the backdrop or close button closes the modal.

## Information Layout

### Primary summary

- Task code
- Task name
- Current status

### Secondary summary

- Test type
- Lab
- Schedule time

### Operational summary

- Sample count
- Tray count
- Tray code summary

### Supporting details

- Source
- Priority
- Required device
- Due time

## Data rules

- Task-level details come from `mes.tasks`.
- Schedule context comes from `mes.schedules`.
- Tray summary is derived from `mes.samples[].trays`.
- Tray summary remains compact:
  - show tray count
  - show a short joined tray-code preview
  - if more than 3 tray codes exist, show the first 3 and `+N`

## Boundaries

- Keep page-level state in `useProcessLabs()`.
- Keep `ProcessPage.vue` as a render-and-wire component.
- Reuse existing generic `.modal` styling where possible instead of inventing a new interaction system.

## Testing

- Update composable tests to verify opening the process task modal creates a selected task summary with tray info and does not navigate.
- Update runtime tests to verify the process page renders the centered modal summary content.
- Run frontend lint, frontend tests, and frontend build after implementation.
