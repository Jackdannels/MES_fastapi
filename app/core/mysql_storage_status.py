from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict

from app.core.axis_codes import sort_axis_codes
from app.core.storage_backend import (
    CANONICAL_COMPLETED_STATUS,
    CANONICAL_RUNNING_STATUS,
    CANONICAL_TASK_COMPLETED_STATUS,
    CANONICAL_TASK_RUNNING_STATUS,
    LEGACY_COMPLETED_STATUSES,
    LEGACY_RUNNING_STATUSES,
    normalize_experiment_status_text,
)
from app.core.mysql_storage_codecs import (
    RETENTION_KEYWORD,
    format_iso_storage_datetime,
    normalize_text,
    parse_storage_datetime,
)

EXPERIMENT_RUNNING_STATUS = CANONICAL_RUNNING_STATUS
LEGACY_EXPERIMENT_RUNNING_STATUS = next(iter(LEGACY_RUNNING_STATUSES))
EXPERIMENT_RUNNING_STATUSES = {EXPERIMENT_RUNNING_STATUS, "实验暂停", *LEGACY_RUNNING_STATUSES}
EXPERIMENT_COMPLETED_STATUSES = {CANONICAL_COMPLETED_STATUS, *LEGACY_COMPLETED_STATUSES}
RUN_TRAY_COMPLETED_STATUSES = {
    *EXPERIMENT_COMPLETED_STATUSES,
    "实验后暂存间存放",
    "厂家收回",
    "送至外观检测间",
    "实验后外观检测间存放",
}
TASK_RUNNING_STATUS = CANONICAL_TASK_RUNNING_STATUS
TASK_COMPLETED_STATUS = CANONICAL_TASK_COMPLETED_STATUS
TASK_STORED_STATUS = "到货"
LEGACY_TASK_STORED_STATUS = "已入库"
UNSCHEDULED_BACKFILL_HISTORY_ACTION = "任务已确认入库"
UNSCHEDULED_BACKFILL_ELIGIBLE_STATUSES = {"", "待排程", "已排程"}


def normalize_experiment_status(value: Any) -> str:
    return normalize_experiment_status_text(value)


def is_task_stored_status(value: Any) -> bool:
    return normalize_text(value) == TASK_STORED_STATUS


def normalize_axis_codes(value: Any) -> list[str]:
    raw_values = value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            raw_values = decoded
        except json.JSONDecodeError:
            raw_values = value.replace("，", ",").split(",")
    if not isinstance(raw_values, list):
        return []
    axis_codes: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        axis_code = normalize_text(item)
        if not axis_code or axis_code in seen:
            continue
        seen.add(axis_code)
        axis_codes.append(axis_code)
    return sort_axis_codes(axis_codes)


def record_sub_experiment_code(row: Dict[str, Any]) -> str:
    return normalize_text(
        row.get("sub_experiment_code")
        or row.get("subExperimentCode")
        or row.get("sub_experiment_no")
        or row.get("subExperimentNo")
    )


def schedule_has_axis_scope(row: Dict[str, Any]) -> bool:
    return bool(record_sub_experiment_code(row) and normalize_axis_codes(row.get("axis_codes_json") or row.get("axis_codes") or row.get("axisCodes")))


def derive_experiment_status_map(
    experiments: list[Dict[str, Any]],
    schedules: list[Dict[str, Any]],
    *,
    experiment_trays: list[Dict[str, Any]] | None = None,
    experiment_run_trays: list[Dict[str, Any]] | None = None,
) -> dict[str, str]:
    schedule_by_experiment = {normalize_text(row.get("experiment_no")) for row in schedules if normalize_text(row.get("experiment_no"))}
    completed_by_experiment = {
        normalize_text(row.get("experiment_no"))
        for row in experiments
        if normalize_experiment_status_text(row.get("experiment_status") or row.get("status")) == CANONICAL_COMPLETED_STATUS
    }
    completed_by_experiment.update(
        normalize_text(row.get("experiment_no"))
        for row in schedules
        if normalize_experiment_status_text(row.get("schedule_status") or row.get("status")) == CANONICAL_COMPLETED_STATUS
    )
    running_by_experiment = {
        normalize_text(row.get("experiment_no"))
        for row in experiments
        if normalize_experiment_status_text(row.get("experiment_status") or row.get("status")) == EXPERIMENT_RUNNING_STATUS
    }
    running_by_experiment.update(
        normalize_text(row.get("experiment_no"))
        for row in schedules
        if normalize_experiment_status_text(row.get("schedule_status") or row.get("status")) == EXPERIMENT_RUNNING_STATUS
    )
    tray_codes_by_experiment: dict[str, set[str]] = {}
    for row in experiment_trays or []:
        experiment_no = normalize_text(row.get("experiment_no"))
        tray_no = normalize_text(row.get("tray_no") or row.get("tray_code"))
        if not experiment_no or not tray_no:
            continue
        tray_codes_by_experiment.setdefault(experiment_no, set()).add(tray_no)

    completed_run_tray_codes_by_experiment: dict[str, set[str]] = {}
    touched_run_tray_codes_by_experiment: dict[str, set[str]] = {}
    completed_run_tray_codes_by_axis_batch: dict[tuple[str, str], set[str]] = {}
    touched_axis_batches_by_experiment: dict[str, set[str]] = {}
    for row in experiment_run_trays or []:
        experiment_no = normalize_text(row.get("experiment_no") or row.get("experiment_code"))
        tray_no = normalize_text(row.get("tray_no") or row.get("tray_code"))
        if not experiment_no or not tray_no:
            continue
        raw_status = normalize_text(row.get("run_tray_status") or row.get("status"))
        status = normalize_experiment_status_text(raw_status)
        if status in (EXPERIMENT_RUNNING_STATUSES | EXPERIMENT_COMPLETED_STATUSES) or raw_status in RUN_TRAY_COMPLETED_STATUSES:
            touched_run_tray_codes_by_experiment.setdefault(experiment_no, set()).add(tray_no)
            sub_experiment_code = record_sub_experiment_code(row)
            if sub_experiment_code:
                touched_axis_batches_by_experiment.setdefault(experiment_no, set()).add(sub_experiment_code)
        if status in EXPERIMENT_COMPLETED_STATUSES or raw_status in RUN_TRAY_COMPLETED_STATUSES:
            completed_run_tray_codes_by_experiment.setdefault(experiment_no, set()).add(tray_no)
            sub_experiment_code = record_sub_experiment_code(row)
            if sub_experiment_code:
                completed_run_tray_codes_by_axis_batch.setdefault((experiment_no, sub_experiment_code), set()).add(tray_no)

    axis_schedule_subs_by_experiment: dict[str, set[str]] = {}
    for row in schedules:
        experiment_no = normalize_text(row.get("experiment_no"))
        sub_experiment_code = record_sub_experiment_code(row)
        if not experiment_no or not schedule_has_axis_scope(row):
            continue
        axis_schedule_subs_by_experiment.setdefault(experiment_no, set()).add(sub_experiment_code)

    status_map: dict[str, str] = {}
    for experiment in experiments:
        experiment_no = normalize_text(experiment.get("experiment_no"))
        related_tray_codes = tray_codes_by_experiment.get(experiment_no, set())
        touched_run_tray_codes = touched_run_tray_codes_by_experiment.get(experiment_no, set())
        completed_run_tray_codes = completed_run_tray_codes_by_experiment.get(experiment_no, set())
        axis_schedule_subs = axis_schedule_subs_by_experiment.get(experiment_no, set())

        if related_tray_codes and axis_schedule_subs:
            completed_axis_subs = {
                sub_experiment_code
                for sub_experiment_code in axis_schedule_subs
                if related_tray_codes.issubset(
                    completed_run_tray_codes_by_axis_batch.get((experiment_no, sub_experiment_code), set())
                )
            }
            touched_axis_subs = touched_axis_batches_by_experiment.get(experiment_no, set())
            if axis_schedule_subs.issubset(completed_axis_subs):
                status_map[experiment_no] = "实验已完成"
            elif touched_axis_subs or experiment_no in completed_by_experiment or experiment_no in running_by_experiment:
                status_map[experiment_no] = EXPERIMENT_RUNNING_STATUS
            elif experiment_no in schedule_by_experiment:
                status_map[experiment_no] = "已排程"
            else:
                status_map[experiment_no] = "待排程"
            continue

        if related_tray_codes and touched_run_tray_codes:
            if related_tray_codes.issubset(completed_run_tray_codes):
                status_map[experiment_no] = "实验已完成"
            else:
                status_map[experiment_no] = EXPERIMENT_RUNNING_STATUS
        elif experiment_no in completed_by_experiment:
            status_map[experiment_no] = "实验已完成"
        elif experiment_no in running_by_experiment:
            status_map[experiment_no] = EXPERIMENT_RUNNING_STATUS
        elif experiment_no in schedule_by_experiment:
            status_map[experiment_no] = "已排程"
        else:
            status_map[experiment_no] = "待排程"
    return status_map


def derive_schedule_status_map(
    schedules: list[Dict[str, Any]],
    experiment_status_map: dict[str, str],
    *,
    experiment_trays: list[Dict[str, Any]] | None = None,
    experiment_run_trays: list[Dict[str, Any]] | None = None,
) -> dict[Any, str]:
    tray_codes_by_experiment: dict[str, set[str]] = {}
    for row in experiment_trays or []:
        experiment_no = normalize_text(row.get("experiment_no") or row.get("experiment_code"))
        tray_no = normalize_text(row.get("tray_no") or row.get("tray_code"))
        if experiment_no and tray_no:
            tray_codes_by_experiment.setdefault(experiment_no, set()).add(tray_no)

    completed_axis_tray_codes_by_batch: dict[tuple[str, str], set[str]] = {}
    completed_axis_batches_without_tray_scope: set[tuple[str, str]] = set()
    running_axis_batches: set[tuple[str, str]] = set()
    for row in experiment_run_trays or []:
        experiment_no = normalize_text(row.get("experiment_no") or row.get("experiment_code"))
        sub_experiment_code = record_sub_experiment_code(row)
        tray_no = normalize_text(row.get("tray_no") or row.get("tray_code"))
        if not experiment_no or not sub_experiment_code:
            continue
        raw_status = normalize_text(row.get("run_tray_status") or row.get("status"))
        status = normalize_experiment_status_text(raw_status)
        key = (experiment_no, sub_experiment_code)
        if status in EXPERIMENT_COMPLETED_STATUSES or raw_status in RUN_TRAY_COMPLETED_STATUSES:
            if tray_no:
                completed_axis_tray_codes_by_batch.setdefault(key, set()).add(tray_no)
            else:
                completed_axis_batches_without_tray_scope.add(key)
        elif status in EXPERIMENT_RUNNING_STATUSES:
            running_axis_batches.add(key)

    status_map: dict[Any, str] = {}
    for schedule in schedules:
        schedule_id = schedule.get("schedule_id") or schedule.get("id")
        if schedule_id is None:
            continue
        experiment_no = normalize_text(schedule.get("experiment_no"))
        sub_experiment_code = record_sub_experiment_code(schedule)
        if schedule_has_axis_scope(schedule):
            key = (experiment_no, sub_experiment_code)
            required_tray_codes = tray_codes_by_experiment.get(experiment_no, set())
            completed_tray_codes = completed_axis_tray_codes_by_batch.get(key, set())
            if (
                (required_tray_codes and required_tray_codes.issubset(completed_tray_codes))
                or (not required_tray_codes and (completed_tray_codes or key in completed_axis_batches_without_tray_scope))
            ):
                status_map[schedule_id] = "实验已完成"
            elif key in running_axis_batches or completed_tray_codes:
                status_map[schedule_id] = EXPERIMENT_RUNNING_STATUS
            else:
                status_map[schedule_id] = "已排程"
            continue
        status_map[schedule_id] = experiment_status_map.get(experiment_no, normalize_experiment_status(schedule.get("schedule_status") or schedule.get("status")))
    return status_map


def derive_task_status_map(
    tasks: list[Dict[str, Any]],
    experiments: list[Dict[str, Any]],
    experiment_status_map: dict[str, str],
) -> dict[str, str]:
    status_map: dict[str, str] = {}
    experiments_by_task: dict[str, list[str]] = {}
    for experiment in experiments:
        task_no = normalize_text(experiment.get("task_no"))
        experiment_no = normalize_text(experiment.get("experiment_no"))
        if task_no and experiment_no:
            experiments_by_task.setdefault(task_no, []).append(experiment_no)

    for task in tasks:
        task_no = normalize_text(task.get("task_no"))
        experiment_nos = experiments_by_task.get(task_no, [])
        statuses = [normalize_experiment_status(experiment_status_map.get(experiment_no, "待排程")) for experiment_no in experiment_nos]
        if statuses and all(status == CANONICAL_COMPLETED_STATUS for status in statuses):
            status_map[task_no] = TASK_COMPLETED_STATUS
        elif any(status in {EXPERIMENT_RUNNING_STATUS, CANONICAL_COMPLETED_STATUS} for status in statuses):
            status_map[task_no] = TASK_RUNNING_STATUS
        elif any(status == "已排程" for status in statuses):
            status_map[task_no] = "已排程"
        else:
            status_map[task_no] = "待排程"
    return status_map


def has_formal_schedule(
    schedules: list[Dict[str, Any]],
    task_code: Any,
    experiment_code: Any,
) -> bool:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    return any(
        normalize_text(schedule.get("task_code")) == normalized_task_code
        and normalize_text(schedule.get("experiment_code")) == normalized_experiment_code
        and normalize_text(schedule.get("device"))
        and RETENTION_KEYWORD not in normalize_text(schedule.get("device"))
        for schedule in (schedules or [])
    )


def is_unscheduled_since_backfill_eligible(experiment: Dict[str, Any]) -> bool:
    if normalize_text(experiment.get("unscheduled_since")):
        return False
    return normalize_experiment_status(experiment.get("status")) in UNSCHEDULED_BACKFILL_ELIGIBLE_STATUSES


def resolve_experiment_sample_codes(
    experiment: Dict[str, Any],
    experiment_trays: list[Dict[str, Any]],
    experiment_samples: list[Dict[str, Any]],
    samples: list[Dict[str, Any]],
) -> list[str]:
    task_code = normalize_text(experiment.get("task_code") or experiment.get("task_no"))
    experiment_code = normalize_text(experiment.get("experiment_code") or experiment.get("experiment_no"))

    def relation_task_code(entry: Dict[str, Any]) -> str:
        return normalize_text(entry.get("task_code") or entry.get("task_no"))

    def relation_experiment_code(entry: Dict[str, Any]) -> str:
        return normalize_text(entry.get("experiment_code") or entry.get("experiment_no"))

    def relation_sample_code(entry: Dict[str, Any]) -> str:
        return normalize_text(entry.get("sample_code") or entry.get("sample_no"))

    def relation_tray_code(entry: Dict[str, Any]) -> str:
        return normalize_text(entry.get("tray_code") or entry.get("tray_no"))

    direct_sample_codes = sorted(
        {
            relation_sample_code(entry)
            for entry in (experiment_samples or [])
            if (not relation_task_code(entry) or relation_task_code(entry) == task_code)
            and relation_experiment_code(entry) == experiment_code
            and relation_sample_code(entry)
        }
    )
    if direct_sample_codes:
        return direct_sample_codes

    tray_codes = {
        relation_tray_code(entry)
        for entry in (experiment_trays or [])
        if (not relation_task_code(entry) or relation_task_code(entry) == task_code)
        and relation_experiment_code(entry) == experiment_code
        and relation_tray_code(entry)
    }
    if tray_codes:
        tray_sample_codes = sorted(
            {
                normalize_text(sample.get("code"))
                for sample in (samples or [])
                if normalize_text(sample.get("task_code")) == task_code
                and any(normalize_text(tray.get("tray_code")) in tray_codes for tray in (sample.get("trays") or []))
                and normalize_text(sample.get("code"))
            }
        )
        if tray_sample_codes:
            return tray_sample_codes

    return []


def resolve_sample_storage_time(sample: Dict[str, Any]) -> datetime | None:
    history_times = [
        parse_storage_datetime(entry.get("time"))
        for entry in (sample.get("history") or [])
        if normalize_text(entry.get("action")) == UNSCHEDULED_BACKFILL_HISTORY_ACTION
        and parse_storage_datetime(entry.get("time")) is not None
    ]
    if history_times:
        return min(history_times)

    status_times = [
        parse_storage_datetime(entry.get("time"))
        for entry in (sample.get("history") or [])
        if is_task_stored_status(entry.get("status"))
        and parse_storage_datetime(entry.get("time")) is not None
    ]
    if status_times:
        return min(status_times)

    if (
        is_task_stored_status(sample.get("status"))
        or is_task_stored_status(sample.get("flow_status"))
    ):
        return parse_storage_datetime(sample.get("updated_at"))

    return None


def backfill_missing_unscheduled_since(
    tasks: list[Dict[str, Any]],
    schedules: list[Dict[str, Any]],
    experiments: list[Dict[str, Any]],
    experiment_trays: list[Dict[str, Any]],
    experiment_samples: list[Dict[str, Any]],
    samples: list[Dict[str, Any]],
) -> tuple[list[Dict[str, Any]], dict[str, datetime]]:
    task_by_code = {
        normalize_text(task.get("code")): task
        for task in (tasks or [])
        if normalize_text(task.get("code"))
    }
    sample_by_code = {
        normalize_text(sample.get("code")): sample
        for sample in (samples or [])
        if normalize_text(sample.get("code"))
    }

    next_experiments: list[Dict[str, Any]] = []
    repaired: dict[str, datetime] = {}

    for experiment in (experiments or []):
        next_experiment = dict(experiment)
        experiment_code = normalize_text(experiment.get("experiment_code"))
        task_code = normalize_text(experiment.get("task_code"))
        task = task_by_code.get(task_code) or {}

        if not is_task_stored_status(task.get("transfer_status")):
            next_experiments.append(next_experiment)
            continue
        if not is_unscheduled_since_backfill_eligible(experiment):
            next_experiments.append(next_experiment)
            continue
        if has_formal_schedule(schedules, task_code, experiment_code):
            next_experiments.append(next_experiment)
            continue

        sample_codes = resolve_experiment_sample_codes(experiment, experiment_trays, experiment_samples, samples)
        sample_times = [
            resolve_sample_storage_time(sample_by_code[sample_code])
            for sample_code in sample_codes
            if sample_code in sample_by_code
        ]
        sample_times = [value for value in sample_times if value is not None]
        if not sample_times:
            next_experiments.append(next_experiment)
            continue

        earliest_time = min(sample_times)
        next_experiment["unscheduled_since"] = format_iso_storage_datetime(earliest_time)
        repaired[experiment_code] = earliest_time
        next_experiments.append(next_experiment)

    return next_experiments, repaired
