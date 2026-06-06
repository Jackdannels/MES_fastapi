from __future__ import annotations

from typing import Any

from app.core.time_utils import format_business_datetime, now_business_text


RUNNING_STATUS = "实验进行中"
START_ACTION = "开始实验"
TASK_RUNNING_STATUS = "任务进行中"
RETURNED_STATUS = "厂家收回"


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def is_returned_text(value: Any) -> bool:
    return normalize_text(value) == RETURNED_STATUS


def start_history_detail(task_code: Any, experiment_name: Any, tray_codes: list[str]) -> str:
    tray_text = "、".join(normalize_text(code) for code in tray_codes if normalize_text(code))
    return f"{normalize_text(task_code)} / {normalize_text(experiment_name) or '-'} / {RUNNING_STATUS} / 托盘：{tray_text}"


def start_storage_laboratory_experiment(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    run_no: str,
    lab_name: str = "",
    schedule_id: str = "",
    tray_codes: list[str] | None = None,
    started_at: str = "",
    planned_hours: float | int | None = None,
    planned_end_at: str = "",
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_run_no = normalize_text(run_no)
    started_time = format_business_datetime(started_at) or normalize_text(started_at) or now_business_text()
    if not normalized_task_code or not normalized_experiment_code or not normalized_run_no:
        raise ValueError("task_code, experiment_code and run_no are required")

    affected_tray_codes = [normalize_text(code) for code in (tray_codes or []) if normalize_text(code)]
    if not affected_tray_codes:
        raise ValueError("trayCodes are required for experiment start")

    experiments = [dict(item) for item in snapshot.get("experiments", [])]
    schedules = [dict(item) for item in snapshot.get("schedules", [])]
    tasks = [dict(item) for item in snapshot.get("tasks", [])]
    experiment_runs = [dict(item) for item in snapshot.get("experiment_runs", [])]
    experiment_run_trays = [dict(item) for item in snapshot.get("experiment_run_trays", [])]
    samples = [
        {
            **sample,
            "trays": [dict(tray) for tray in sample.get("trays", []) if isinstance(tray, dict)],
            "history": [dict(entry) for entry in sample.get("history", []) if isinstance(entry, dict)],
        }
        for sample in snapshot.get("samples", [])
    ]

    returned_tray_codes = {
        normalize_text(item.get("tray_code") or item.get("tray_no"))
        for item in experiment_run_trays
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        and is_returned_text(item.get("run_tray_status") or item.get("runTrayStatus") or item.get("status"))
    }
    for sample in samples:
        if normalize_text(sample.get("task_code")) != normalized_task_code:
            continue
        sample_is_returned = (
            is_returned_text(sample.get("status"))
            or is_returned_text(sample.get("flow_status"))
            or is_returned_text(sample.get("location"))
        )
        for tray in sample.get("trays", []):
            tray_code = normalize_text(tray.get("tray_code"))
            if tray_code and (sample_is_returned or is_returned_text(tray.get("status"))):
                returned_tray_codes.add(tray_code)

    affected_tray_codes = [tray_code for tray_code in affected_tray_codes if tray_code not in returned_tray_codes]
    if not affected_tray_codes:
        raise ValueError("current experiment has no matching active tray samples")
    affected_tray_code_set = set(affected_tray_codes)

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
    detail = start_history_detail(normalized_task_code, experiment_name, affected_tray_codes)
    normalized_lab_name = normalize_text(lab_name)
    affected_sample_count = 0

    for sample in samples:
        if normalize_text(sample.get("task_code")) != normalized_task_code:
            continue
        touched = False
        next_trays = []
        for tray in sample.get("trays", []):
            tray_code = normalize_text(tray.get("tray_code"))
            if tray_code in affected_tray_code_set:
                next_tray = {
                    **tray,
                    "status": RUNNING_STATUS,
                    "updated_at": started_time,
                }
                for target_key in ("target_lab", "targetLab", "target_experiment_code", "targetExperimentCode"):
                    next_tray.pop(target_key, None)
                touched = True
            else:
                next_tray = tray
            next_trays.append(next_tray)
        if not touched:
            continue
        sample["status"] = RUNNING_STATUS
        sample["flow_status"] = RUNNING_STATUS
        sample["location"] = normalized_lab_name or normalize_text(sample.get("location"))
        sample["updated_at"] = started_time
        sample["trays"] = next_trays
        history_entry = {
            "action": START_ACTION,
            "detail": detail,
            "location": normalize_text(sample.get("location")),
            "owner": normalize_text(sample.get("owner")),
            "status": RUNNING_STATUS,
            "time": started_time,
        }
        duplicate = any(
            normalize_text(entry.get("detail")) == detail
            and normalize_text(entry.get("time")) == started_time
            for entry in sample.get("history", [])
        )
        if not duplicate:
            sample["history"] = [history_entry, *sample.get("history", [])]
        affected_sample_count += 1

    if affected_sample_count == 0:
        raise ValueError("current experiment has no matching tray samples")

    tasks = [
        {
            **item,
            "status": TASK_RUNNING_STATUS,
            "updated_at": started_time,
        }
        if normalize_text(item.get("code") or item.get("id")) == normalized_task_code
        else item
        for item in tasks
    ]
    experiments = [
        {
            **item,
            "actual_start_time": normalize_text(item.get("actual_start_time")) or started_time,
            "status": RUNNING_STATUS,
            "updated_at": started_time,
        }
        if normalize_text(item.get("task_code")) == normalized_task_code
        and normalize_text(item.get("experiment_code")) == normalized_experiment_code
        else item
        for item in experiments
    ]
    normalized_schedule_id = normalize_text(schedule_id)
    schedules = [
        {
            **item,
            "status": RUNNING_STATUS,
            "updated_at": started_time,
        }
        if (
            (normalized_schedule_id and normalize_text(item.get("id") or item.get("schedule_id")) == normalized_schedule_id)
            or (
                normalize_text(item.get("task_code")) == normalized_task_code
                and normalize_text(item.get("experiment_code")) == normalized_experiment_code
                and (not normalized_lab_name or normalize_text(item.get("device") or item.get("device_name")) == normalized_lab_name)
            )
        )
        else item
        for item in schedules
    ]

    planned_hours_value = None if planned_hours in ("", None) else planned_hours
    run_record = {
        "id": normalized_run_no,
        "run_no": normalized_run_no,
        "schedule_id": normalized_schedule_id,
        "task_code": normalized_task_code,
        "experiment_code": normalized_experiment_code,
        "device": normalized_lab_name,
        "device_name": normalized_lab_name,
        "tray_codes": affected_tray_codes,
        "status": RUNNING_STATUS,
        "started_at": started_time,
        "planned_hours": planned_hours_value,
        "planned_end_at": normalize_text(planned_end_at),
        "ended_at": "",
        "created_at": started_time,
        "updated_at": started_time,
    }
    experiment_runs = [
        run
        for run in experiment_runs
        if normalize_text(run.get("run_no") or run.get("id")) != normalized_run_no
    ]
    experiment_runs.append(run_record)

    existing_relation_keys = {
        (
            normalize_text(item.get("run_no") or item.get("runNo")),
            normalize_text(item.get("tray_code") or item.get("tray_no")),
        )
        for item in experiment_run_trays
    }
    for tray_code in affected_tray_codes:
        relation_key = (normalized_run_no, tray_code)
        if relation_key in existing_relation_keys:
            experiment_run_trays = [
                {
                    **item,
                    "status": RUNNING_STATUS,
                    "run_tray_status": RUNNING_STATUS,
                    "started_at": normalize_text(item.get("started_at")) or started_time,
                    "ended_at": "",
                    "updated_at": started_time,
                }
                if (
                    normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no
                    and normalize_text(item.get("tray_code") or item.get("tray_no")) == tray_code
                )
                else item
                for item in experiment_run_trays
            ]
            continue
        experiment_run_trays.append(
            {
                "id": f"{normalized_run_no}:{tray_code}",
                "run_no": normalized_run_no,
                "task_code": normalized_task_code,
                "experiment_code": normalized_experiment_code,
                "tray_code": tray_code,
                "status": RUNNING_STATUS,
                "run_tray_status": RUNNING_STATUS,
                "started_at": started_time,
                "ended_at": "",
                "created_at": started_time,
                "updated_at": started_time,
            }
        )

    return {
        "affectedSampleCount": affected_sample_count,
        "affectedTrayCodes": affected_tray_codes,
        "experimentRunTrays": experiment_run_trays,
        "experimentRuns": experiment_runs,
        "experiments": experiments,
        "samples": samples,
        "schedules": schedules,
        "startedAt": started_time,
        "tasks": tasks,
    }
