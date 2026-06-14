from __future__ import annotations

from datetime import datetime
from typing import Any, Dict

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
EXPERIMENT_RUNNING_STATUSES = {EXPERIMENT_RUNNING_STATUS, *LEGACY_RUNNING_STATUSES}
EXPERIMENT_COMPLETED_STATUSES = {CANONICAL_COMPLETED_STATUS, *LEGACY_COMPLETED_STATUSES}
RUN_TRAY_COMPLETED_STATUSES = {
    *EXPERIMENT_COMPLETED_STATUSES,
    "实验后暂存间存放",
    "厂家收回",
    "送至外观检测间",
    "外观检测间存放",
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
    for row in experiment_run_trays or []:
        experiment_no = normalize_text(row.get("experiment_no") or row.get("experiment_code"))
        tray_no = normalize_text(row.get("tray_no") or row.get("tray_code"))
        if not experiment_no or not tray_no:
            continue
        raw_status = normalize_text(row.get("run_tray_status") or row.get("status"))
        status = normalize_experiment_status_text(raw_status)
        if status in (EXPERIMENT_RUNNING_STATUSES | EXPERIMENT_COMPLETED_STATUSES) or raw_status in RUN_TRAY_COMPLETED_STATUSES:
            touched_run_tray_codes_by_experiment.setdefault(experiment_no, set()).add(tray_no)
        if status in EXPERIMENT_COMPLETED_STATUSES or raw_status in RUN_TRAY_COMPLETED_STATUSES:
            completed_run_tray_codes_by_experiment.setdefault(experiment_no, set()).add(tray_no)

    status_map: dict[str, str] = {}
    for experiment in experiments:
        experiment_no = normalize_text(experiment.get("experiment_no"))
        related_tray_codes = tray_codes_by_experiment.get(experiment_no, set())
        touched_run_tray_codes = touched_run_tray_codes_by_experiment.get(experiment_no, set())
        completed_run_tray_codes = completed_run_tray_codes_by_experiment.get(experiment_no, set())

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
