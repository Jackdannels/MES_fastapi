# Transfer Workbench Readonly Lock Design

## Goal

Make tray allocation read-only in both tray pre-allocation and handover workbench views immediately after `保存托盘`, and keep it read-only until the operator explicitly clicks the reset action (`重新分配` in pre-allocation, `重新入库` in handover).

## Scope

- Shared workbench logic in `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
- Runtime coverage in:
  - `frontend/src/modules/samples/page.runtime.test.js`
  - `frontend/src/modules/handover-system/page.runtime.test.js`

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

## Design Notes

- Reuse the existing `allocationSaved` state instead of introducing another persisted flag
- Treat `allocationSaved` as a read-only gate separate from experiment-mode editing rules
- Keep the lock inside the shared transfer workbench so both entry points stay aligned
