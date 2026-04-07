# Transfer Workbench Readonly Lock Design

## Goal

Make tray allocation read-only in both tray pre-allocation and handover workbench views immediately after `保存托盘`, keep it read-only until the operator explicitly clicks the reset action (`重新分配` in pre-allocation, `重新入库` in handover), and permanently block that reset path once any tray in the task has already started experiment execution.

## Scope

- Shared workbench logic in `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
- Transfer-area backend state assembly and reload guard in `app/api/routes/transfer_area.py`
- Runtime coverage in:
  - `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
  - `frontend/src/modules/samples/page.runtime.test.js`
  - `frontend/src/modules/handover-system/page.runtime.test.js`
  - `tests/api/test_transfer_area.py`

## Behavior

- After tray allocation is saved:
  - sample dragging is disabled
  - click-to-move and swap interactions are disabled
  - tray creation is disabled
  - tray deletion is disabled
  - tray limit adjustment is disabled
  - experiment tray selection becomes view-only
- Viewing, paging, and printing stay available
- Resetting the workspace returns the page to editable mode
- Tasks that are already stored and have any tray in `实验进行中 / 实验已完成 / 放置实验后暂存间 / 厂家收回` remain visible in the overview and detail views
- Those tasks continue to expose full tray/sample detail and printing
- Those tasks no longer allow `重新分配 / 重新入库`; the UI must show a clear lock reason and the backend `/reload` endpoint must reject the request
- `实验准备就绪` alone does not trigger the permanent lock

## Design Notes

- Reuse the existing `allocationSaved` state instead of introducing another persisted flag
- Treat `allocationSaved` as a read-only gate separate from experiment-mode editing rules
- Keep the lock inside the shared transfer workbench so both entry points stay aligned
- Derive the permanent lock from existing task/sample/tray statuses instead of persisting another dedicated flag
