# Task Status Vocabulary Split Design

## Goal

Separate task-level status wording from experiment-level status wording so task aggregates no longer reuse experiment labels.

## Decisions

- Task entities use canonical statuses:
  - `待排程`
  - `已排程`
  - `任务进行中`
  - `任务已完成`
  - `厂家收回`
- Experiment entities keep canonical statuses:
  - `待排程`
  - `已排程`
  - `实验准备就绪`
  - `工装夹具安装`
  - `实验进行中`
  - `实验已完成`
- Historical task values `实验进行中` and `实验已完成` must be normalized to task statuses in both JSON and MySQL persistence.
- Historical experiment values continue to normalize within the experiment vocabulary only.

## Frontend Scope

- Task aggregation in `frontend/src/modules/tasks/model.js` becomes the single source of truth for task running/completed wording.
- Task-oriented views that consume aggregated task states must display `任务进行中` / `任务已完成`, including:
  - task list
  - task/托盘总览 task cards
  - task flow in sample tray management
  - laboratory task flow
- Experiment/tray/sample flows remain on experiment wording.

## Backend Scope

- Storage normalization distinguishes `mes.tasks` task statuses from experiment/sample/schedule detail statuses.
- MySQL task persistence reads/writes canonical task statuses.
- Derived task status maps use task wording while derived experiment status maps keep experiment wording.
- Legacy task rows in MySQL are rewritten in place during normalization passes.

## Risks

- A shared normalization helper currently rewrites all statuses as experiment statuses; task collections must stop using it.
- Several task UIs import task constants from `tasks/model.js`; changing those constants is correct for task views but must not leak into experiment detail displays.
- Partial-completion labels must become `任务进行中（已完成X个实验）`.

## Validation

- Backend tests prove task rows normalize to task wording while experiment/sample/tray rows stay on experiment wording.
- Frontend tests prove task rows and task flow cards render task wording.
- Existing experiment-flow tests should remain green to show experiment vocabulary was not regressed.
