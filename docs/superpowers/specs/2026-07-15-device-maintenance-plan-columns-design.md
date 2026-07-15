# Device Maintenance Plan Columns Design

## Goal

Replace the device-list calibration date with real planned maintenance windows.

## Design

- Device rows expose maintenance plan start/end values only when `maintenance_type` is `计划保养` or `计划维修`.
- The table replaces `下次校准` with `下次维保` and adds `维护计划结束时间`; both render `/` when no qualifying value exists.
- The sequence column uses a narrow fixed width. The obsolete `next_cal` row mapping, sort key, and display are removed from the frontend devices module without legacy fallback.

## Verification

- Model tests cover planned start/end formatting and blank/non-planned plans rendering `/`.
- Page-runtime test asserts the two new headers/cells and absence of `下次校准`.
