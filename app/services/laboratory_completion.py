from __future__ import annotations

from datetime import datetime
from typing import Any


COMPLETED_STATUS = "实验已完成"
COMPLETION_ACTION = "实验完成"
RUNNING_STATUS = "实验进行中"
EXPERIMENT_TRAY_FINISHED_STATUSES = {
    COMPLETED_STATUS,
    "实验完成",
    "实验已经完成",
    "放置实验后暂存间",
    "厂家收回",
    "已到达暂存间",
}


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def completion_history_detail(task_code: Any, experiment_name: Any) -> str:
    return f"{normalize_text(task_code)} / {normalize_text(experiment_name)} / {COMPLETED_STATUS}"


def run_tray_completed_statuses_for_experiment(
    experiment_runs: list[dict[str, Any]],
    *,
    completed_tray_codes: set[str] | None = None,
    experiment_code: str,
    task_code: str,
) -> set[str]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    completed = {normalize_text(code) for code in (completed_tray_codes or set()) if normalize_text(code)}
    for run in experiment_runs:
        if (
            normalize_text(run.get("task_code")) != normalized_task_code
            or normalize_text(run.get("experiment_code")) != normalized_experiment_code
            or normalize_text(run.get("status")) not in EXPERIMENT_TRAY_FINISHED_STATUSES
        ):
            continue
        completed.update(normalize_text(code) for code in run.get("tray_codes", []) if normalize_text(code))
    return completed


def experiment_trays_are_completed(
    scoped_tray_codes: set[str],
    completed_tray_codes: set[str],
) -> bool:
    required = {normalize_text(code) for code in scoped_tray_codes if normalize_text(code)}
    completed = {normalize_text(code) for code in completed_tray_codes if normalize_text(code)}
    return bool(required) and required.issubset(completed)


def complete_storage_laboratory_experiment(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    run_no: str = "",
    tray_codes: list[str] | None = None,
    completed_at: str = "",
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_run_no = normalize_text(run_no)
    completed_time = normalize_text(completed_at) or datetime.now().isoformat(timespec="seconds")
    if not normalized_task_code or not normalized_experiment_code:
        raise ValueError("task_code and experiment_code are required")

    experiments = [dict(item) for item in snapshot.get("experiments", [])]
    schedules = [dict(item) for item in snapshot.get("schedules", [])]
    experiment_runs = [dict(item) for item in snapshot.get("experiment_runs", [])]
    experiment_trays = [dict(item) for item in snapshot.get("experiment_trays", [])]
    samples = [
        {
            **sample,
            "trays": [dict(tray) for tray in sample.get("trays", []) if isinstance(tray, dict)],
            "history": [dict(entry) for entry in sample.get("history", []) if isinstance(entry, dict)],
        }
        for sample in snapshot.get("samples", [])
    ]

    experiment = next(
        (
            item
            for item in experiments
            if normalize_text(item.get("task_code")) == normalized_task_code
            and normalize_text(item.get("experiment_code")) == normalized_experiment_code
        ),
        None,
    )
    experiment_name = normalize_text((experiment or {}).get("experiment_name") or (experiment or {}).get("experiment_type")) or normalized_experiment_code
    scoped_tray_codes = {
        normalize_text(item.get("tray_code"))
        for item in experiment_trays
        if normalize_text(item.get("task_code")) == normalized_task_code
        and normalize_text(item.get("experiment_code")) == normalized_experiment_code
        and normalize_text(item.get("tray_code"))
    }
    requested_tray_codes = {normalize_text(code) for code in (tray_codes or []) if normalize_text(code)}
    affected_tray_codes = requested_tray_codes or scoped_tray_codes
    if not affected_tray_codes:
        raise ValueError("current experiment has no tray assignment")

    detail = completion_history_detail(normalized_task_code, experiment_name)
    affected_sample_count = 0
    for sample in samples:
        if normalize_text(sample.get("task_code")) != normalized_task_code:
            continue
        touched = False
        next_trays = []
        for tray in sample.get("trays", []):
            tray_code = normalize_text(tray.get("tray_code"))
            if tray_code in affected_tray_codes:
                next_tray = {
                    **tray,
                    "status": COMPLETED_STATUS,
                    "updated_at": completed_time,
                }
                for target_key in ("target_lab", "targetLab", "target_experiment_code", "targetExperimentCode"):
                    next_tray.pop(target_key, None)
                touched = True
            else:
                next_tray = tray
            next_trays.append(next_tray)
        if not touched:
            continue
        sample["status"] = COMPLETED_STATUS
        sample["flow_status"] = COMPLETED_STATUS
        sample["updated_at"] = completed_time
        sample["trays"] = next_trays
        history_entry = {
            "action": COMPLETION_ACTION,
            "detail": detail,
            "location": normalize_text(sample.get("location")),
            "owner": normalize_text(sample.get("owner")),
            "status": COMPLETED_STATUS,
            "time": completed_time,
        }
        duplicate = any(
            normalize_text(entry.get("detail")) == detail
            and normalize_text(entry.get("time")) == completed_time
            for entry in sample.get("history", [])
        )
        if not duplicate:
            sample["history"] = [history_entry, *sample.get("history", [])]
        affected_sample_count += 1

    if affected_sample_count == 0:
        raise ValueError("current experiment has no matching tray samples")

    completed_experiment_tray_codes = run_tray_completed_statuses_for_experiment(
        experiment_runs,
        completed_tray_codes=affected_tray_codes,
        experiment_code=normalized_experiment_code,
        task_code=normalized_task_code,
    )
    all_experiment_trays_completed = experiment_trays_are_completed(
        scoped_tray_codes,
        completed_experiment_tray_codes,
    )
    next_experiment_status = COMPLETED_STATUS if all_experiment_trays_completed else RUNNING_STATUS

    experiments = [
        {
            **item,
            "status": next_experiment_status,
            "updated_at": completed_time,
        }
        if normalize_text(item.get("task_code")) == normalized_task_code
        and normalize_text(item.get("experiment_code")) == normalized_experiment_code
        else item
        for item in experiments
    ]
    schedules = [
        {
            **item,
            "status": next_experiment_status,
            "updated_at": completed_time,
        }
        if normalize_text(item.get("task_code")) == normalized_task_code
        and normalize_text(item.get("experiment_code")) == normalized_experiment_code
        else item
        for item in schedules
    ]
    def run_matches_completion(item: dict[str, Any]) -> bool:
        if normalized_run_no:
            return normalized_run_no in {normalize_text(item.get("run_no")), normalize_text(item.get("id"))}
        if (
            normalize_text(item.get("task_code")) != normalized_task_code
            or normalize_text(item.get("experiment_code")) != normalized_experiment_code
            or normalize_text(item.get("status")) != RUNNING_STATUS
        ):
            return False
        run_tray_codes = {normalize_text(code) for code in item.get("tray_codes", []) if normalize_text(code)}
        return not run_tray_codes or affected_tray_codes.issubset(run_tray_codes)

    experiment_runs = [
        {
            **item,
            "status": COMPLETED_STATUS,
            "ended_at": completed_time,
            "updated_at": completed_time,
        }
        if run_matches_completion(item)
        else item
        for item in experiment_runs
    ]

    return {
        "affectedSampleCount": affected_sample_count,
        "affectedTrayCodes": sorted(affected_tray_codes),
        "completedAt": completed_time,
        "experiments": experiments,
        "experimentRuns": experiment_runs,
        "samples": samples,
        "schedules": schedules,
    }
