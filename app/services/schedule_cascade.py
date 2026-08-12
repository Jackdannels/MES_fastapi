"""Deterministic, event-driven propagation of delayed laboratory schedules."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any

from app.core.time_utils import format_business_datetime, parse_business_datetime
from app.services.storage_schedule_lock_policy import schedule_is_locked_for_automatic_reschedule
from app.services.storage_schedule_patch import (
    schedule_matches_device,
    schedule_overlaps_maintenance,
    schedule_targets_storage_area,
    schedules_match_lab,
)


LOCKED_CONFLICT = "SCHEDULE_LOCKED"
MAINTENANCE_CONFLICT = "MAINTENANCE_CONFLICT"


class ScheduleCascadeError(ValueError):
    """Raised when the cascade request itself has invalid or incomplete data."""


def _text(value: Any) -> str:
    return str(value or "").strip()


def _rows(snapshot: dict[str, Any], name: str) -> list[dict[str, Any]]:
    value = snapshot.get(name)
    if not isinstance(value, list):
        value = snapshot.get(f"mes.{name}")
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _schedule_id(schedule: dict[str, Any]) -> str:
    return _text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("scheduleId"))


def _window(schedule: dict[str, Any], *, original: bool) -> tuple[datetime | None, datetime | None]:
    start_value = schedule.get("start_at") or schedule.get("startAt")
    end_value = schedule.get("end_at") or schedule.get("endAt")
    if original:
        start_value = schedule.get("original_start_at") or start_value
        end_value = schedule.get("original_end_at") or end_value
    return parse_business_datetime(start_value), parse_business_datetime(end_value)


def _conflict(
    *,
    code: str,
    schedule: dict[str, Any],
    proposed_start: datetime,
    proposed_end: datetime,
    detail: str,
) -> dict[str, Any]:
    return {
        "code": code,
        "schedule_id": _schedule_id(schedule),
        "detail": detail,
        "current_start_at": format_business_datetime(schedule.get("start_at") or schedule.get("startAt")),
        "current_end_at": format_business_datetime(schedule.get("end_at") or schedule.get("endAt")),
        "proposed_start_at": format_business_datetime(proposed_start),
        "proposed_end_at": format_business_datetime(proposed_end),
    }


def plan_same_lab_schedule_cascade(
    snapshot: dict[str, Any],
    *,
    current_schedule_id: str,
    new_end_at: Any,
    reason: str,
    source_run_no: str = "",
) -> dict[str, Any]:
    """Plan a minimal, delay-only cascade for schedules after ``current_schedule_id``.

    This function performs no storage writes and has no timer. Callers invoke it only
    when an event changes an experiment's forecast or actual end. Original schedule
    gaps and durations come from persisted ``original_*`` values, while the current
    scheduled start is a floor so a later recalculation never pulls a notified job
    forward.

    If the first required move is blocked, ``updates`` is empty and one structured
    conflict is returned. ``proposed_updates`` is diagnostic-only and must not be
    persisted in that case.
    """

    if not isinstance(snapshot, dict):
        raise ScheduleCascadeError("排程快照无效")
    normalized_schedule_id = _text(current_schedule_id)
    if not normalized_schedule_id:
        raise ScheduleCascadeError("当前排程编号不能为空")
    boundary_end = parse_business_datetime(new_end_at)
    if boundary_end is None:
        raise ScheduleCascadeError("新的预计或实际结束时间无效")

    schedules = _rows(snapshot, "schedules")
    current = next((item for item in schedules if _schedule_id(item) == normalized_schedule_id), None)
    if current is None:
        raise ScheduleCascadeError(f"未找到当前排程 {normalized_schedule_id}")
    current_original_start, current_original_end = _window(current, original=True)
    if current_original_start is None or current_original_end is None or current_original_end < current_original_start:
        raise ScheduleCascadeError("当前排程缺少有效的原始开始或结束时间")

    same_lab = [
        schedule
        for schedule in schedules
        if not schedule_targets_storage_area(schedule) and schedules_match_lab(current, schedule)
    ]
    ordered: list[tuple[datetime, str, dict[str, Any]]] = []
    for schedule in same_lab:
        original_start, original_end = _window(schedule, original=True)
        if original_start is None or original_end is None or original_end < original_start:
            continue
        ordered.append((original_start, _schedule_id(schedule), schedule))
    ordered.sort(key=lambda item: (item[0], item[1]))
    current_index = next(
        (index for index, (_, _, schedule) in enumerate(ordered) if _schedule_id(schedule) == normalized_schedule_id),
        None,
    )
    if current_index is None:
        raise ScheduleCascadeError("当前排程不属于可顺延的实验室排程")

    devices = _rows(snapshot, "devices")
    proposed_updates: list[dict[str, Any]] = []
    previous_original_end = current_original_end
    previous_effective_end = boundary_end
    normalized_reason = _text(reason) or "前序实验延期"

    for _, _, schedule in ordered[current_index + 1 :]:
        original_start, original_end = _window(schedule, original=True)
        current_start, current_end = _window(schedule, original=False)
        if original_start is None or original_end is None or current_start is None or current_end is None:
            raise ScheduleCascadeError(f"后续排程 {_schedule_id(schedule)} 缺少有效时间")

        original_gap = max(original_start - previous_original_end, timedelta(0))
        duration = original_end - original_start
        earliest_start = previous_effective_end + original_gap
        proposed_start = max(current_start, original_start, earliest_start)
        proposed_end = proposed_start + duration

        if proposed_start > current_start or proposed_end > current_end:
            if schedule_is_locked_for_automatic_reschedule(snapshot, schedule):
                conflict = _conflict(
                    code=LOCKED_CONFLICT,
                    schedule=schedule,
                    proposed_start=proposed_start,
                    proposed_end=proposed_end,
                    detail="完成任务比对或进入实验流程后，排程不可自动顺延。",
                )
                return {"updates": [], "proposed_updates": proposed_updates, "conflicts": [conflict]}

            proposed = deepcopy(schedule)
            proposed["start_at"] = format_business_datetime(proposed_start)
            proposed["end_at"] = format_business_datetime(proposed_end)
            proposed["original_start_at"] = format_business_datetime(original_start)
            proposed["original_end_at"] = format_business_datetime(original_end)
            proposed["delay_minutes"] = int((proposed_start - original_start).total_seconds() // 60)
            proposed["delay_reason"] = normalized_reason
            proposed["source_run_no"] = _text(source_run_no)

            maintenance = next(
                (
                    device
                    for device in devices
                    if schedule_matches_device(proposed, device) and schedule_overlaps_maintenance(proposed, device)
                ),
                None,
            )
            if maintenance is not None:
                conflict = _conflict(
                    code=MAINTENANCE_CONFLICT,
                    schedule=schedule,
                    proposed_start=proposed_start,
                    proposed_end=proposed_end,
                    detail="自动顺延后的排程与设备维修或保养窗口冲突。",
                )
                return {"updates": [], "proposed_updates": proposed_updates, "conflicts": [conflict]}
            proposed_updates.append(proposed)

        previous_original_end = original_end
        previous_effective_end = proposed_end

    return {"updates": proposed_updates, "proposed_updates": proposed_updates, "conflicts": []}
