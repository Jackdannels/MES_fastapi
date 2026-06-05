from __future__ import annotations

from typing import Any

from app.core.time_utils import format_business_datetime, now_business_text


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
    experiment_run_trays: list[dict[str, Any]] | None = None,
    task_code: str,
) -> set[str]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    completed = {normalize_text(code) for code in (completed_tray_codes or set()) if normalize_text(code)}
    for relation in experiment_run_trays or []:
        if (
            normalize_text(relation.get("task_code")) != normalized_task_code
            or normalize_text(relation.get("experiment_code")) != normalized_experiment_code
            or normalize_text(relation.get("status") or relation.get("run_tray_status")) not in EXPERIMENT_TRAY_FINISHED_STATUSES
        ):
            continue
        tray_code = normalize_text(relation.get("tray_code") or relation.get("tray_no"))
        if tray_code:
            completed.add(tray_code)
    if experiment_run_trays:
        return completed
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


def experiment_status_for_completed_trays(
    scoped_tray_codes: set[str],
    completed_tray_codes: set[str],
) -> str:
    return COMPLETED_STATUS if experiment_trays_are_completed(scoped_tray_codes, completed_tray_codes) else RUNNING_STATUS


def tray_assigned_experiments_are_completed(
    *,
    task_code: str,
    tray_code: str,
    experiment_trays: list[dict[str, Any]] | None = None,
    experiment_run_trays: list[dict[str, Any]] | None = None,
) -> bool:
    normalized_task_code = normalize_text(task_code)
    normalized_tray_code = normalize_text(tray_code)
    if not normalized_task_code or not normalized_tray_code:
        return False

    assigned_experiment_codes = {
        normalize_text(item.get("experiment_code") or item.get("experiment_no"))
        for item in experiment_trays or []
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("tray_code") or item.get("tray_no")) == normalized_tray_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no"))
    }
    if not assigned_experiment_codes:
        return False

    completed_experiment_codes = {
        normalize_text(item.get("experiment_code") or item.get("experiment_no"))
        for item in experiment_run_trays or []
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("tray_code") or item.get("tray_no")) == normalized_tray_code
        and normalize_text(item.get("status") or item.get("run_tray_status")) in EXPERIMENT_TRAY_FINISHED_STATUSES
        and normalize_text(item.get("experiment_code") or item.get("experiment_no"))
    }
    return assigned_experiment_codes.issubset(completed_experiment_codes)


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
    completed_time = format_business_datetime(completed_at) or normalize_text(completed_at) or now_business_text()
    if not normalized_task_code or not normalized_experiment_code:
        raise ValueError("task_code and experiment_code are required")

    experiments = [dict(item) for item in snapshot.get("experiments", [])]
    schedules = [dict(item) for item in snapshot.get("schedules", [])]
    experiment_runs = [dict(item) for item in snapshot.get("experiment_runs", [])]
    experiment_run_trays = [dict(item) for item in snapshot.get("experiment_run_trays", [])]
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
    def run_matches_request(run: dict[str, Any]) -> bool:
        run_key = normalize_text(run.get("run_no") or run.get("runNo") or run.get("id"))
        return (
            run_key == normalized_run_no
            and normalize_text(run.get("task_code")) == normalized_task_code
            and normalize_text(run.get("experiment_code")) == normalized_experiment_code
        )

    def infer_tray_codes_from_run() -> set[str]:
        if not normalized_run_no:
            return set()
        inferred_from_relations = {
            normalize_text(item.get("tray_code") or item.get("tray_no"))
            for item in experiment_run_trays
            if normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no
            and normalize_text(item.get("task_code")) == normalized_task_code
            and normalize_text(item.get("experiment_code")) == normalized_experiment_code
            and normalize_text(item.get("tray_code") or item.get("tray_no"))
        }
        if inferred_from_relations:
            return inferred_from_relations
        matched_run = next((run for run in experiment_runs if run_matches_request(run)), None)
        if not matched_run:
            return set()
        return {normalize_text(code) for code in matched_run.get("tray_codes", []) if normalize_text(code)}

    inferred_run_tray_codes = infer_tray_codes_from_run()
    if requested_tray_codes:
        affected_tray_codes = requested_tray_codes
    elif inferred_run_tray_codes:
        affected_tray_codes = inferred_run_tray_codes
    elif len(scoped_tray_codes) == 1:
        affected_tray_codes = set(scoped_tray_codes)
    else:
        raise ValueError("trayCodes are required for multi-tray experiment completion")
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
        experiment_run_trays=experiment_run_trays,
        task_code=normalized_task_code,
    )
    next_experiment_status = experiment_status_for_completed_trays(
        scoped_tray_codes,
        completed_experiment_tray_codes,
    )

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
            return run_matches_request(item)
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

    existing_relation_keys = {
        (
            normalize_text(item.get("run_no") or item.get("runNo")),
            normalize_text(item.get("tray_code") or item.get("tray_no")),
        )
        for item in experiment_run_trays
    }
    experiment_run_trays = [
        {
            **item,
            "status": COMPLETED_STATUS,
            "run_tray_status": COMPLETED_STATUS,
            "ended_at": completed_time,
            "updated_at": completed_time,
        }
        if (
            normalize_text(item.get("task_code")) == normalized_task_code
            and normalize_text(item.get("experiment_code")) == normalized_experiment_code
            and (not normalized_run_no or normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no)
            and normalize_text(item.get("tray_code") or item.get("tray_no")) in affected_tray_codes
        )
        else item
        for item in experiment_run_trays
    ]
    for run in experiment_runs:
        run_key = normalize_text(run.get("run_no") or run.get("id"))
        if normalized_run_no and run_key != normalized_run_no:
            continue
        if (
            normalize_text(run.get("task_code")) != normalized_task_code
            or normalize_text(run.get("experiment_code")) != normalized_experiment_code
        ):
            continue
        for tray_code in affected_tray_codes:
            if (run_key, tray_code) in existing_relation_keys:
                continue
            experiment_run_trays.append(
                {
                    "run_no": run_key,
                    "task_code": normalized_task_code,
                    "experiment_code": normalized_experiment_code,
                    "tray_code": tray_code,
                    "status": COMPLETED_STATUS,
                    "run_tray_status": COMPLETED_STATUS,
                    "started_at": normalize_text(run.get("started_at")),
                    "ended_at": completed_time,
                    "created_at": normalize_text(run.get("created_at")) or completed_time,
                    "updated_at": completed_time,
                }
            )

    return {
        "affectedSampleCount": affected_sample_count,
        "affectedTrayCodes": sorted(affected_tray_codes),
        "completedAt": completed_time,
        "experiments": experiments,
        "experimentRunTrays": experiment_run_trays,
        "experimentRuns": experiment_runs,
        "samples": samples,
        "schedules": schedules,
    }
