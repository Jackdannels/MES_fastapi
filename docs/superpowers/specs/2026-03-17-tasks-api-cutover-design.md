# Tasks API Cutover Design

## Goal

Incrementally remove the tasks page from the generic `/api/storage` snapshot interface by introducing a dedicated `/api/tasks` API, while keeping schedule, sample, and stream side effects on the existing storage bridge for now.

## Scope

This cutover only applies to `frontend/src/modules/tasks`.

Included:
- Add a backend `tasks` router with task list/create/update/delete endpoints.
- Back the router with the current storage backend so MySQL-backed task rows continue to flow through `biz_task`.
- Switch the tasks page to load and mutate tasks through the dedicated API.
- Keep schedule/sample/stream cascading writes on `/api/storage` until later modules are split.

Excluded:
- Refactoring other modules away from `useStorageSnapshot`.
- Moving task-related sample/schedule/stream workflows to dedicated APIs.
- Changing task page behavior, field names, or UI structure.

## Architecture

The new `/api/tasks` router will be a thin task-specific facade over the existing storage backend. It will only read and write the `mes.tasks` collection, but it will expose task-shaped CRUD endpoints instead of generic storage-key updates.

On the frontend, `useTasksPage` will stop treating tasks as part of the snapshot payload. It will load tasks from the dedicated tasks API, while continuing to load `schedules`, `samples`, and `streams` from the snapshot API. Task mutations will call the dedicated tasks API first, then persist related snapshot updates for dependent collections.

## Data Flow

1. `GET /api/tasks`
   - Frontend loads canonical tasks from the backend.
   - Local task cache is refreshed for offline fallback.
2. `POST /api/tasks`
   - Frontend creates the draft task record with existing task-page model helpers.
   - Backend appends it into the backend-managed `mes.tasks` collection.
   - Frontend persists derived sample changes through `/api/storage`.
3. `PUT /api/tasks/{task_id}`
   - Frontend computes the updated task with existing model helpers.
   - Backend replaces the matching task by `id` or `code`.
   - Frontend persists derived sample changes through `/api/storage`.
4. `DELETE /api/tasks/{task_id}`
   - Backend removes the task row only.
   - Frontend persists cascade deletions for schedules, samples, and streams through `/api/storage`.

## Error Handling

- Backend returns `404` when a requested task cannot be found.
- Frontend keeps the current local-storage fallback behavior for task reads and mutations when the dedicated API is unavailable.
- Snapshot writes for dependent collections remain best-effort, consistent with the current storage API behavior.

## Testing

- Add backend API tests for `/api/tasks` list/create/update/delete.
- Update router registry tests to include the new route prefix.
- Add frontend tests for the new tasks API helper.
- Keep the existing tasks runtime tests green to confirm no behavior regression in the page.
