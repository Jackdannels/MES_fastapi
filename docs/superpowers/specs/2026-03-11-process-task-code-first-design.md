# Process Task Code-First Design

**Goal:** Make the process task modal emphasize task code over task name.

## Problem

The current hero section still gives the task name more visual weight than the task code. In this workflow, operators identify tasks primarily by code, so the code should become the main headline.

## Design

- Promote task code to the hero headline.
- Demote task name to a smaller secondary line.
- Keep the status badge in the hero area.
- Do not change the data model or the modal information structure below the hero section.

## Testing

- Update the runtime test to require a dedicated code headline element.
- Keep the current name sanitization and tray summary assertions.
