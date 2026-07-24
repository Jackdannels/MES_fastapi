"""Pure tray and axis completion queries shared by MQTT and hostless paths."""

from __future__ import annotations

from typing import Any

from app.core.axis_codes import sort_axis_codes
from app.services.appearance_inspection import (
    APPEARANCE_INSPECTION_DISPATCH_STATUS,
    APPEARANCE_INSPECTION_STOCKED_STATUS,
)
from app.services.experiment_segments import record_sub_experiment_code, resolve_record_sub_experiment_code


COMPLETED_STATUS = "实验已完成"
COMPLETION_ACTION = "实验完成"
RUNNING_STATUS = "实验进行中"
PARTIAL_AXIS_CONTINUATION_STATUS = "送至实验室"
EXPERIMENT_TRAY_FINISHED_STATUSES = {
    COMPLETED_STATUS,
    "实验完成",
    "实验已经完成",
    "实验后暂存间存放",
    "厂家收回",
    APPEARANCE_INSPECTION_DISPATCH_STATUS,
    APPEARANCE_INSPECTION_STOCKED_STATUS,
}


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_axis_codes(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = value.replace("，", ",").split(",")
    else:
        raw_values = []
    axis_codes: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        axis_code = normalize_text(item)
        if not axis_code or axis_code in seen:
            continue
        seen.add(axis_code)
        axis_codes.append(axis_code)
    return sort_axis_codes(axis_codes)


def completion_history_detail(task_code: Any, experiment_name: Any) -> str:
    return f"{normalize_text(task_code)} / {normalize_text(experiment_name)} / {COMPLETED_STATUS}"


def axis_partial_completion_status(experiment_name: Any, completed_count: int, total_count: int) -> str:
    return f"{normalize_text(experiment_name)}部分完成 {completed_count}/{total_count}轴"


def run_tray_completed_statuses_for_experiment(
    experiment_runs: list[dict[str, Any]],
    *,
    completed_tray_codes: set[str] | None = None,
    experiment_code: str,
    experiment_run_trays: list[dict[str, Any]] | None = None,
    sub_experiment_code: str = "",
    task_code: str,
) -> set[str]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    completed = {normalize_text(code) for code in (completed_tray_codes or set()) if normalize_text(code)}
    for relation in experiment_run_trays or []:
        if (
            normalize_text(relation.get("task_code")) != normalized_task_code
            or normalize_text(relation.get("experiment_code")) != normalized_experiment_code
            or (normalized_sub_experiment_code and record_sub_experiment_code(relation) != normalized_sub_experiment_code)
            or normalize_text(relation.get("status") or relation.get("run_tray_status")) not in EXPERIMENT_TRAY_FINISHED_STATUSES
        ):
            continue
        tray_code = normalize_text(relation.get("tray_code") or relation.get("tray_no"))
        if tray_code:
            completed.add(tray_code)
    return completed


def experiment_trays_are_completed(scoped_tray_codes: set[str], completed_tray_codes: set[str]) -> bool:
    required = {normalize_text(code) for code in scoped_tray_codes if normalize_text(code)}
    completed = {normalize_text(code) for code in completed_tray_codes if normalize_text(code)}
    return bool(required) and required.issubset(completed)


def experiment_status_for_completed_trays(scoped_tray_codes: set[str], completed_tray_codes: set[str]) -> str:
    return COMPLETED_STATUS if experiment_trays_are_completed(scoped_tray_codes, completed_tray_codes) else RUNNING_STATUS


def required_axis_codes_for_completion(
    experiments: list[dict[str, Any]],
    schedules: list[dict[str, Any]],
    *,
    experiment_code: str,
    sub_experiment_code: str = "",
    task_code: str,
) -> list[str]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    if normalized_sub_experiment_code:
        axes: list[str] = []
        seen: set[str] = set()
        related_schedules = [
            schedule
            for schedule in schedules
            if normalize_text(schedule.get("task_code") or schedule.get("task_no")) == normalized_task_code
            and normalize_text(schedule.get("experiment_code") or schedule.get("experiment_no")) == normalized_experiment_code
            and resolve_record_sub_experiment_code(schedule, experiment_code=normalized_experiment_code) == normalized_sub_experiment_code
        ]
        related_schedules.sort(key=lambda item: normalize_text(item.get("start_at") or item.get("startAt") or item.get("start_time")))
        for schedule in related_schedules:
            for axis_code in normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes")):
                if axis_code in seen:
                    continue
                seen.add(axis_code)
                axes.append(axis_code)
        if axes:
            return sort_axis_codes(axes)
    for experiment in experiments:
        if (
            normalize_text(experiment.get("task_code") or experiment.get("task_no")) == normalized_task_code
            and normalize_text(experiment.get("experiment_code") or experiment.get("experiment_no")) == normalized_experiment_code
        ):
            axes = normalize_axis_codes(experiment.get("axis_codes") or experiment.get("axisCodes"))
            if axes:
                return sort_axis_codes(axes)
    axes = []
    seen = set()
    related_schedules = [
        schedule
        for schedule in schedules
        if normalize_text(schedule.get("task_code") or schedule.get("task_no")) == normalized_task_code
        and normalize_text(schedule.get("experiment_code") or schedule.get("experiment_no")) == normalized_experiment_code
    ]
    related_schedules.sort(key=lambda item: normalize_text(item.get("start_at") or item.get("startAt") or item.get("start_time")))
    for schedule in related_schedules:
        for axis_code in normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes")):
            if axis_code in seen:
                continue
            seen.add(axis_code)
            axes.append(axis_code)
    return sort_axis_codes(axes)


def run_axis_codes(run: dict[str, Any] | None) -> list[str]:
    return normalize_axis_codes((run or {}).get("axis_codes") or (run or {}).get("axisCodes"))
