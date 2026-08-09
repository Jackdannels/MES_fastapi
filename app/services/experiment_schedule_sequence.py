from __future__ import annotations

from datetime import datetime
from typing import Any

from app.core.time_utils import parse_business_datetime
from app.services.experiment_segments import record_sub_experiment_code
from app.services.storage_schedule_patch import (
    schedule_device,
    schedule_lab_code,
    schedule_lab_id,
    schedule_targets_storage_area,
)


COMPLETED_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}


class ExperimentScheduleSequenceError(ValueError):
    pass


def _text(value: Any) -> str:
    return str(value or "").strip()


def _rows(snapshot: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = snapshot.get(key)
    if value is None:
        value = snapshot.get(f"mes.{key}")
    return [dict(item) for item in value or [] if isinstance(item, dict)]


def _task_code(record: dict[str, Any]) -> str:
    return _text(record.get("task_code") or record.get("task_no") or record.get("taskCode"))


def _experiment_code(record: dict[str, Any]) -> str:
    return _text(record.get("experiment_code") or record.get("experiment_no") or record.get("experimentCode"))


def _tray_code(record: dict[str, Any]) -> str:
    return _text(record.get("tray_code") or record.get("tray_no") or record.get("trayCode"))


def _schedule_id(record: dict[str, Any]) -> str:
    return _text(record.get("id") or record.get("schedule_id") or record.get("schedule_no") or record.get("scheduleId"))


def _run_no(record: dict[str, Any]) -> str:
    return _text(record.get("run_no") or record.get("runNo") or record.get("id"))


def _run_schedule_id(record: dict[str, Any]) -> str:
    return _text(record.get("schedule_id") or record.get("schedule_no") or record.get("scheduleId"))


def _status(record: dict[str, Any]) -> str:
    return _text(record.get("run_tray_status") or record.get("status") or record.get("schedule_status"))


def _start_at(record: dict[str, Any]) -> str:
    return _text(record.get("start_at") or record.get("startAt") or record.get("start_time"))


def _axis_codes(record: dict[str, Any]) -> list[str]:
    value = record.get("axis_codes") if "axis_codes" in record else record.get("axisCodes")
    if isinstance(value, str):
        value = value.replace("，", ",").split(",")
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        code = _text(item)
        if code and code not in result:
            result.append(code)
    return result


def _schedule_sort_key(schedule: dict[str, Any]) -> tuple[datetime, str]:
    return parse_business_datetime(_start_at(schedule)) or datetime.max, _schedule_id(schedule)


def _relation_completes_schedule(
    relation: dict[str, Any],
    *,
    run_by_no: dict[str, dict[str, Any]],
    schedule: dict[str, Any],
) -> bool:
    if _status(relation) not in COMPLETED_STATUSES:
        return False
    run = run_by_no.get(_run_no(relation), {})
    expected_schedule_id = _schedule_id(schedule)
    actual_schedule_id = _run_schedule_id(run) or _text(relation.get("schedule_id") or relation.get("schedule_no"))
    if actual_schedule_id:
        return actual_schedule_id == expected_schedule_id

    return False


def _schedule_is_completed_for_tray(
    schedule: dict[str, Any],
    *,
    experiment_run_trays: list[dict[str, Any]],
    run_by_no: dict[str, dict[str, Any]],
    task_code: str,
    tray_code: str,
) -> bool:
    experiment_code = _experiment_code(schedule)
    return any(
        _task_code(relation) == task_code
        and _experiment_code(relation) == experiment_code
        and _tray_code(relation) == tray_code
        and _relation_completes_schedule(
            relation,
            run_by_no=run_by_no,
            schedule=schedule,
        )
        for relation in experiment_run_trays
    )


def resolve_next_scheduled_step(
    snapshot: dict[str, Any],
    *,
    task_code: str,
    tray_code: str,
) -> dict[str, Any] | None:
    normalized_task_code = _text(task_code)
    normalized_tray_code = _text(tray_code)
    if not normalized_task_code or not normalized_tray_code:
        raise ExperimentScheduleSequenceError("task_code and tray_code are required")

    assigned_experiment_codes = {
        _experiment_code(relation)
        for relation in _rows(snapshot, "experiment_trays")
        if _task_code(relation) == normalized_task_code
        and _tray_code(relation) == normalized_tray_code
        and _experiment_code(relation)
    }
    if not assigned_experiment_codes:
        return None

    candidates = [
        schedule
        for schedule in _rows(snapshot, "schedules")
        if _task_code(schedule) == normalized_task_code
        and _experiment_code(schedule) in assigned_experiment_codes
        and schedule_device(schedule)
        and not schedule_targets_storage_area(schedule)
    ]
    candidates.sort(key=_schedule_sort_key)
    if not candidates:
        return None

    schedule_ids = [_schedule_id(schedule) for schedule in candidates]
    if any(not schedule_id for schedule_id in schedule_ids) or len(schedule_ids) != len(set(schedule_ids)):
        raise ExperimentScheduleSequenceError("当前托盘排程身份缺失或重复，请先修正排程")

    runs = _rows(snapshot, "experiment_runs")
    run_by_no = {_run_no(run): run for run in runs if _run_no(run)}
    run_trays = _rows(snapshot, "experiment_run_trays")
    completion_flags = [
        _schedule_is_completed_for_tray(
            schedule,
            experiment_run_trays=run_trays,
            run_by_no=run_by_no,
            task_code=normalized_task_code,
            tray_code=normalized_tray_code,
        )
        for schedule in candidates
    ]
    first_unfinished_index = next((index for index, completed in enumerate(completion_flags) if not completed), None)
    if first_unfinished_index is None:
        return None
    if any(completion_flags[first_unfinished_index + 1 :]):
        raise ExperimentScheduleSequenceError("当前托盘存在越序完成记录，请重置任务数据")

    schedule = candidates[first_unfinished_index]
    return {
        "schedule_id": _schedule_id(schedule),
        "task_code": normalized_task_code,
        "tray_code": normalized_tray_code,
        "experiment_code": _experiment_code(schedule),
        "sub_experiment_code": record_sub_experiment_code(schedule),
        "axis_batch_no": _text(schedule.get("axis_batch_no") or schedule.get("axisBatchNo")),
        "axis_codes": _axis_codes(schedule),
        "lab_id": schedule_lab_id(schedule),
        "lab_code": schedule_lab_code(schedule),
        "lab_name": schedule_device(schedule),
        "start_at": _start_at(schedule),
        "end_at": _text(schedule.get("end_at") or schedule.get("endAt") or schedule.get("end_time")),
    }


def scheduled_step_matches(
    step: dict[str, Any],
    *,
    schedule_id: str = "",
    experiment_code: str = "",
    sub_experiment_code: str = "",
    axis_batch_no: Any = "",
    axis_codes: list[str] | None = None,
    lab_id: Any = "",
    lab_code: str = "",
    lab_name: str = "",
) -> bool:
    checks = (
        (schedule_id, step.get("schedule_id")),
        (experiment_code, step.get("experiment_code")),
        (sub_experiment_code, step.get("sub_experiment_code")),
        (_text(axis_batch_no), step.get("axis_batch_no")),
        (_text(lab_id), step.get("lab_id")),
        (lab_code, step.get("lab_code")),
        (lab_name, step.get("lab_name")),
    )
    if not all(not _text(expected) or _text(expected) == _text(actual) for expected, actual in checks):
        return False
    normalized_axis_codes = [_text(code) for code in (axis_codes or []) if _text(code)]
    return not normalized_axis_codes or normalized_axis_codes == step.get("axis_codes", [])


def assert_expected_next_scheduled_step(
    snapshot: dict[str, Any],
    *,
    task_code: str,
    tray_code: str,
    schedule_id: str = "",
    experiment_code: str = "",
    sub_experiment_code: str = "",
    axis_batch_no: Any = "",
    axis_codes: list[str] | None = None,
    lab_id: Any = "",
    lab_code: str = "",
    lab_name: str = "",
) -> dict[str, Any]:
    step = resolve_next_scheduled_step(snapshot, task_code=task_code, tray_code=tray_code)
    if step is None:
        raise ExperimentScheduleSequenceError("当前托盘没有可执行的下一排程实验")
    if not scheduled_step_matches(
        step,
        schedule_id=schedule_id,
        experiment_code=experiment_code,
        sub_experiment_code=sub_experiment_code,
        axis_batch_no=axis_batch_no,
        axis_codes=axis_codes,
        lab_id=lab_id,
        lab_code=lab_code,
        lab_name=lab_name,
    ):
        raise ExperimentScheduleSequenceError(
            f"当前托盘必须先执行排程 {step['schedule_id']} / {step['experiment_code']} / {step['lab_name']}"
        )
    return step


def assert_common_next_scheduled_step(
    snapshot: dict[str, Any],
    *,
    task_code: str,
    tray_codes: list[str] | set[str],
    **expected: Any,
) -> dict[str, Any]:
    normalized_tray_codes = sorted({_text(code) for code in tray_codes if _text(code)})
    if not normalized_tray_codes:
        raise ExperimentScheduleSequenceError("tray_codes are required")
    steps = [
        assert_expected_next_scheduled_step(
            snapshot,
            task_code=task_code,
            tray_code=tray_code,
            **expected,
        )
        for tray_code in normalized_tray_codes
    ]
    identity = lambda step: (
        step["schedule_id"],
        step["experiment_code"],
        step["sub_experiment_code"],
        step["axis_batch_no"],
        tuple(step["axis_codes"]),
        step["lab_id"],
        step["lab_code"],
        step["lab_name"],
    )
    if len({identity(step) for step in steps}) != 1:
        raise ExperimentScheduleSequenceError("所选托盘的下一排程不一致，请拆分操作")
    return steps[0]
