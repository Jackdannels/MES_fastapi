"""Staging re-entry and partial-axis completion policies."""

from datetime import datetime
from typing import Any

from app.core.axis_codes import canonical_axis_code, sort_axis_codes
from app.core.time_utils import parse_business_datetime
from app.services.experiment_segments import record_sub_experiment_code, resolve_record_sub_experiment_code
from app.services.laboratory_completion import tray_assigned_experiments_are_completed
from app.services.storage_policies import STAGING_STOCK_IN_BLOCKED_CURRENT_STATUSES


COMPLETED_EXPERIMENT_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}
PARTIAL_AXIS_REENTRY_BLOCKING_ACTIONS = {"任务比对", "样品安装", "实验确认", "开始实验", "实验开始"}
PARTIAL_AXIS_REENTRY_RESET_ACTIONS = {"撤回出库", "实验任务撤回", "任务切换撤回"}


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _parse_datetime(value: Any) -> datetime | None:
    return parse_business_datetime(value)


def _tray_code(tray: Any) -> str:
    return _normalize_text(tray.get("tray_code")) if isinstance(tray, dict) else ""


def _task_code(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return _normalize_text(row.get("task_code") or row.get("taskCode") or row.get("code"))


def _experiment_code(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return _normalize_text(row.get("experiment_code") or row.get("experimentCode"))


def _schedule_id(schedule: Any) -> str:
    return _normalize_text(schedule.get("id")) if isinstance(schedule, dict) else ""


def _normalize_axis_codes(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = value.replace("，", ",").split(",")
    else:
        raw_values = []
    axis_codes: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        axis_code = _normalize_text(item)
        if not axis_code or axis_code in seen:
            continue
        seen.add(axis_code)
        axis_codes.append(axis_code)
    return sort_axis_codes(axis_codes)


def _run_no(record: Any) -> str:
    return _normalize_text(record.get("run_no") or record.get("runNo") or record.get("id")) if isinstance(record, dict) else ""


def _record_schedule_id(record: Any) -> str:
    return _normalize_text(record.get("schedule_id") or record.get("scheduleId") or record.get("schedule_no")) if isinstance(record, dict) else ""


def _is_completed_status(value: Any) -> bool:
    return _normalize_text(value) in COMPLETED_EXPERIMENT_STATUSES


def _record_sub_code(record: Any, *, experiment_code: str = "") -> str:
    if not isinstance(record, dict):
        return ""
    return resolve_record_sub_experiment_code(record, experiment_code=experiment_code)


def tray_has_scoped_partial_axis_batch_completion(
    *,
    task_code: str,
    tray_code: str,
    experiments: list[dict[str, Any]] | None = None,
    experiment_runs: list[dict[str, Any]] | None = None,
    experiment_run_steps: list[dict[str, Any]] | None = None,
    experiment_run_trays: list[dict[str, Any]] | None = None,
    experiment_trays: list[dict[str, Any]] | None = None,
    schedules: list[dict[str, Any]] | None = None,
) -> bool:
    normalized_task_code = _normalize_text(task_code)
    normalized_tray_code = _normalize_text(tray_code)
    run_by_no = {
        _run_no(run): run
        for run in _as_list(experiment_runs)
        if isinstance(run, dict) and _task_code(run) == normalized_task_code and _run_no(run)
    }
    schedule_by_id = {
        _schedule_id(schedule): schedule
        for schedule in _as_list(schedules)
        if isinstance(schedule, dict) and _schedule_id(schedule)
    }
    completed_steps_by_run: dict[str, set[str]] = {}
    for step in _as_list(experiment_run_steps):
        if not isinstance(step, dict) or _task_code(step) != normalized_task_code:
            continue
        if not _is_completed_status(step.get("status")):
            continue
        axis_code = canonical_axis_code(step.get("axis_code") or step.get("axisCode"))
        if not axis_code:
            continue
        completed_steps_by_run.setdefault(_run_no(step), set()).add(axis_code)

    completed_batches: dict[str, list[dict[str, Any]]] = {}
    for relation in _as_list(experiment_run_trays):
        if not isinstance(relation, dict):
            continue
        if _task_code(relation) != normalized_task_code or _normalize_text(relation.get("tray_code") or relation.get("tray_no")) != normalized_tray_code:
            continue
        if not _is_completed_status(relation.get("status") or relation.get("run_tray_status")):
            continue
        experiment_code = _experiment_code(relation)
        run_no = _run_no(relation)
        run = run_by_no.get(run_no)
        if not experiment_code or not run or not _is_completed_status(run.get("status")):
            continue
        axes = set(completed_steps_by_run.get(run_no, set()))
        axes.update(_normalize_axis_codes(run.get("axis_codes") or run.get("axisCodes")))
        if not axes:
            continue
        run_schedule = schedule_by_id.get(_record_schedule_id(run))
        sub_code = record_sub_experiment_code(relation) or record_sub_experiment_code(run)
        if not sub_code and run_schedule:
            sub_code = _record_sub_code(run_schedule, experiment_code=experiment_code)
        if not sub_code:
            continue
        completed_batches.setdefault(experiment_code, []).append(
            {
                "axes": axes,
                "schedule_id": _record_schedule_id(run),
                "sub_experiment_code": sub_code,
            }
        )

    for schedule in _as_list(schedules):
        if not isinstance(schedule, dict) or _task_code(schedule) != normalized_task_code:
            continue
        if _is_completed_status(schedule.get("status") or schedule.get("schedule_status")):
            continue
        experiment_code = _experiment_code(schedule)
        pending_axes = set(_normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes")))
        if not experiment_code or not pending_axes:
            continue
        schedule_id = _schedule_id(schedule)
        schedule_sub_code = _record_sub_code(schedule, experiment_code=experiment_code)
        if not schedule_sub_code:
            continue
        for completed_batch in completed_batches.get(experiment_code, []):
            if schedule_id and schedule_id == completed_batch["schedule_id"]:
                continue
            if schedule_sub_code == completed_batch["sub_experiment_code"]:
                continue
            if pending_axes - completed_batch["axes"]:
                return True
    return False


def _post_staging_reentry_is_completed(
    sample: Any,
    tray: Any,
    experiments: Any,
    experiment_runs: Any,
    experiment_run_steps: Any,
    experiment_trays: Any,
    experiment_run_trays: Any,
    schedules: Any,
) -> bool:
    if not isinstance(sample, dict) or not isinstance(tray, dict):
        return False
    task_code = _normalize_text(sample.get("task_code") or sample.get("task_no"))
    tray_code = _tray_code(tray)
    normalized_experiments = [item for item in _as_list(experiments) if isinstance(item, dict)]
    normalized_experiment_runs = [item for item in _as_list(experiment_runs) if isinstance(item, dict)]
    normalized_experiment_run_steps = [item for item in _as_list(experiment_run_steps) if isinstance(item, dict)]
    normalized_experiment_trays = [item for item in _as_list(experiment_trays) if isinstance(item, dict)]
    normalized_experiment_run_trays = [item for item in _as_list(experiment_run_trays) if isinstance(item, dict)]
    normalized_schedules = [item for item in _as_list(schedules) if isinstance(item, dict)]
    if tray_has_scoped_partial_axis_batch_completion(
        task_code=task_code,
        tray_code=tray_code,
        experiments=normalized_experiments,
        experiment_runs=normalized_experiment_runs,
        experiment_run_steps=normalized_experiment_run_steps,
        experiment_trays=normalized_experiment_trays,
        experiment_run_trays=normalized_experiment_run_trays,
        schedules=normalized_schedules,
    ):
        return True
    assigned_experiment_codes = {
        _experiment_code(item)
        for item in normalized_experiment_trays
        if _task_code(item) == task_code
        and _normalize_text(item.get("tray_code") or item.get("tray_no")) == tray_code
        and _experiment_code(item)
    }
    axis_aware_experiment_codes = {
        _experiment_code(item)
        for item in normalized_experiments
        if _task_code(item) == task_code
        and _experiment_code(item) in assigned_experiment_codes
        and _normalize_axis_codes(item.get("axis_codes") or item.get("axisCodes"))
    }
    axis_aware_experiment_codes.update(
        _experiment_code(item)
        for item in normalized_schedules
        if _task_code(item) == task_code
        and _experiment_code(item) in assigned_experiment_codes
        and _normalize_axis_codes(item.get("axis_codes") or item.get("axisCodes"))
    )
    if axis_aware_experiment_codes:
        return _tray_axis_aware_experiments_are_completed(
            task_code=task_code,
            tray_code=tray_code,
            axis_aware_experiment_codes=axis_aware_experiment_codes,
            assigned_experiment_codes=assigned_experiment_codes,
            experiments=normalized_experiments,
            experiment_runs=normalized_experiment_runs,
            experiment_run_steps=normalized_experiment_run_steps,
            schedules=normalized_schedules,
            experiment_run_trays=normalized_experiment_run_trays,
        )
    return tray_assigned_experiments_are_completed(
        task_code=task_code,
        tray_code=tray_code,
        experiment_trays=normalized_experiment_trays,
        experiment_run_trays=normalized_experiment_run_trays,
    )


def _normal_staging_reentry_is_partial_axis_batch(
    sample: Any,
    tray: Any,
    experiments: Any,
    experiment_runs: Any,
    experiment_run_steps: Any,
    experiment_trays: Any,
    experiment_run_trays: Any,
    schedules: Any,
) -> bool:
    if not isinstance(sample, dict) or not isinstance(tray, dict):
        return False
    normalized_experiments = [item for item in _as_list(experiments) if isinstance(item, dict)]
    normalized_experiment_runs = [item for item in _as_list(experiment_runs) if isinstance(item, dict)]
    normalized_experiment_run_steps = [item for item in _as_list(experiment_run_steps) if isinstance(item, dict)]
    normalized_experiment_trays = [item for item in _as_list(experiment_trays) if isinstance(item, dict)]
    normalized_experiment_run_trays = [item for item in _as_list(experiment_run_trays) if isinstance(item, dict)]
    normalized_schedules = [item for item in _as_list(schedules) if isinstance(item, dict)]
    task_code = _normalize_text(sample.get("task_code") or sample.get("task_no"))
    tray_code = _tray_code(tray)
    if not tray_has_scoped_partial_axis_batch_completion(
        task_code=task_code,
        tray_code=tray_code,
        experiments=normalized_experiments,
        experiment_runs=normalized_experiment_runs,
        experiment_run_steps=normalized_experiment_run_steps,
        experiment_trays=normalized_experiment_trays,
        experiment_run_trays=normalized_experiment_run_trays,
        schedules=normalized_schedules,
    ):
        return False
    return not _partial_axis_reentry_has_newer_lab_activity(
        sample=sample,
        task_code=task_code,
        tray_code=tray_code,
        experiment_runs=normalized_experiment_runs,
        experiment_run_trays=normalized_experiment_run_trays,
    )


def _partial_axis_reentry_has_newer_lab_activity(
    *,
    sample: dict[str, Any],
    task_code: str,
    tray_code: str,
    experiment_runs: list[dict[str, Any]],
    experiment_run_trays: list[dict[str, Any]],
) -> bool:
    run_by_no = {_run_no(run): run for run in experiment_runs if _run_no(run)}
    completion_times: list[datetime] = []
    for relation in experiment_run_trays:
        if (
            _task_code(relation) != task_code
            or _normalize_text(relation.get("tray_code") or relation.get("tray_no")) != tray_code
            or not _is_completed_status(relation.get("status") or relation.get("run_tray_status"))
        ):
            continue
        run = run_by_no.get(_run_no(relation), {})
        for value in (
            relation.get("ended_at"),
            relation.get("endedAt"),
            relation.get("updated_at"),
            relation.get("updatedAt"),
            run.get("ended_at"),
            run.get("endedAt"),
            run.get("updated_at"),
            run.get("updatedAt"),
        ):
            if parsed := _parse_datetime(value):
                completion_times.append(parsed)

    for entry in _as_list(sample.get("history")):
        if not isinstance(entry, dict):
            continue
        status_text = " ".join(
            (_normalize_text(entry.get("status")), _normalize_text(entry.get("detail")))
        )
        if "部分完成" not in status_text or "轴" not in status_text:
            continue
        if parsed := _parse_datetime(entry.get("time") or entry.get("updated_at") or entry.get("updatedAt")):
            completion_times.append(parsed)

    latest_completion_time = max(completion_times) if completion_times else None
    lifecycle_events: list[tuple[datetime, str]] = []
    if latest_completion_time is not None:
        for entry in _as_list(sample.get("history")):
            if not isinstance(entry, dict):
                continue
            action = _normalize_text(entry.get("action"))
            if action not in PARTIAL_AXIS_REENTRY_BLOCKING_ACTIONS | PARTIAL_AXIS_REENTRY_RESET_ACTIONS:
                continue
            event_time = _parse_datetime(entry.get("time") or entry.get("updated_at") or entry.get("updatedAt"))
            if event_time is not None and event_time > latest_completion_time:
                lifecycle_events.append((event_time, action))
    if lifecycle_events:
        latest_action = max(lifecycle_events, key=lambda item: item[0])[1]
        if latest_action in PARTIAL_AXIS_REENTRY_BLOCKING_ACTIONS:
            return True

    for relation in experiment_run_trays:
        if (
            _task_code(relation) != task_code
            or _normalize_text(relation.get("tray_code") or relation.get("tray_no")) != tray_code
            or _normalize_text(relation.get("status") or relation.get("run_tray_status"))
            not in STAGING_STOCK_IN_BLOCKED_CURRENT_STATUSES
        ):
            continue
        run = run_by_no.get(_run_no(relation), {})
        started_at = next(
            (
                parsed
                for value in (
                    relation.get("started_at"),
                    relation.get("startedAt"),
                    relation.get("created_at"),
                    relation.get("createdAt"),
                    run.get("started_at"),
                    run.get("startedAt"),
                    run.get("created_at"),
                    run.get("createdAt"),
                )
                if (parsed := _parse_datetime(value)) is not None
            ),
            None,
        )
        if latest_completion_time is None or started_at is None or started_at >= latest_completion_time:
            return True
    return False


def _tray_axis_aware_experiments_are_completed(
    *,
    task_code: str,
    tray_code: str,
    axis_aware_experiment_codes: set[str],
    assigned_experiment_codes: set[str],
    experiments: list[dict[str, Any]],
    experiment_runs: list[dict[str, Any]],
    experiment_run_steps: list[dict[str, Any]],
    schedules: list[dict[str, Any]],
    experiment_run_trays: list[dict[str, Any]],
) -> bool:
    if not axis_aware_experiment_codes:
        return False
    completed_by_experiment: dict[str, set[str]] = {}
    completed_non_axis_experiment_codes: set[str] = set()
    completed_run_nos_by_experiment: dict[str, set[str]] = {}
    unfinished_axis_experiment_codes: set[str] = set()
    for relation in experiment_run_trays:
        if (
            _task_code(relation) != task_code
            or _normalize_text(relation.get("tray_code") or relation.get("tray_no")) != tray_code
        ):
            continue
        experiment_code = _experiment_code(relation)
        if not experiment_code:
            continue
        if not _is_completed_status(relation.get("status") or relation.get("run_tray_status")):
            if experiment_code in axis_aware_experiment_codes:
                unfinished_axis_experiment_codes.add(experiment_code)
            continue
        sub_experiment_code = record_sub_experiment_code(relation)
        if sub_experiment_code:
            completed_by_experiment.setdefault(experiment_code, set()).add(sub_experiment_code)
        else:
            completed_non_axis_experiment_codes.add(experiment_code)
        if run_no := _run_no(relation):
            completed_run_nos_by_experiment.setdefault(experiment_code, set()).add(run_no)

    completed_runs_by_no = {
        _run_no(run): run
        for run in experiment_runs
        if _task_code(run) == task_code and _is_completed_status(run.get("status")) and _run_no(run)
    }
    completed_step_axes_by_run: dict[str, set[str]] = {}
    for step in experiment_run_steps:
        if _task_code(step) != task_code or not _is_completed_status(step.get("status")):
            continue
        axis_code = canonical_axis_code(step.get("axis_code") or step.get("axisCode"))
        if axis_code:
            completed_step_axes_by_run.setdefault(_run_no(step), set()).add(axis_code)

    for experiment_code in axis_aware_experiment_codes:
        required_sub_experiment_codes = {
            _record_sub_code(schedule, experiment_code=experiment_code)
            for schedule in schedules
            if _task_code(schedule) == task_code
            and _experiment_code(schedule) == experiment_code
            and _normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes"))
            and _record_sub_code(schedule, experiment_code=experiment_code)
        }
        if not required_sub_experiment_codes:
            if experiment_code in unfinished_axis_experiment_codes:
                return False
            required_axes = {
                axis_code
                for experiment in experiments
                if _task_code(experiment) == task_code and _experiment_code(experiment) == experiment_code
                for axis_code in _normalize_axis_codes(experiment.get("axis_codes") or experiment.get("axisCodes"))
            }
            completed_axes: set[str] = set()
            for run_no in completed_run_nos_by_experiment.get(experiment_code, set()):
                run = completed_runs_by_no.get(run_no)
                if not run:
                    continue
                completed_axes.update(_normalize_axis_codes(run.get("axis_codes") or run.get("axisCodes")))
                completed_axes.update(completed_step_axes_by_run.get(run_no, set()))
            if not required_axes or not required_axes.issubset(completed_axes):
                return False
            continue
        if not required_sub_experiment_codes.issubset(completed_by_experiment.get(experiment_code, set())):
            return False

    non_axis_experiment_codes = assigned_experiment_codes - axis_aware_experiment_codes
    return non_axis_experiment_codes.issubset(completed_non_axis_experiment_codes)
