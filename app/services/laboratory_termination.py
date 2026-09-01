from __future__ import annotations

from typing import Any

from app.core.time_utils import format_business_datetime, now_business_text
from app.services.laboratory_operations import clear_fixture_ready_marker


ABNORMAL_TERMINATION_STATUS = "实验异常终止"
ABNORMAL_TERMINATION_ACTION = "异常终止实验"


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def terminate_storage_laboratory_experiment(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    run_no: str,
    tray_codes: list[str] | None = None,
    terminated_at: str = "",
    termination_reason: str = "",
) -> dict[str, Any]:
    """Apply the shared abnormal-stop workflow to a laboratory storage snapshot."""

    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_run_no = normalize_text(run_no)
    terminated_time = (
        format_business_datetime(terminated_at)
        or normalize_text(terminated_at)
        or now_business_text()
    )
    if not normalized_task_code or not normalized_experiment_code or not normalized_run_no:
        raise ValueError("task_code, experiment_code and run_no are required")

    tasks = [dict(item) for item in snapshot.get("tasks", [])]
    experiments = [dict(item) for item in snapshot.get("experiments", [])]
    schedules = [dict(item) for item in snapshot.get("schedules", [])]
    experiment_runs = [dict(item) for item in snapshot.get("experiment_runs", [])]
    experiment_run_trays = [dict(item) for item in snapshot.get("experiment_run_trays", [])]
    experiment_samples = [dict(item) for item in snapshot.get("experiment_samples", [])]
    samples = [
        {
            **sample,
            "trays": [dict(tray) for tray in sample.get("trays", []) if isinstance(tray, dict)],
            "history": [dict(entry) for entry in sample.get("history", []) if isinstance(entry, dict)],
        }
        for sample in snapshot.get("samples", [])
    ]

    run = next(
        (
            item
            for item in experiment_runs
            if normalize_text(item.get("run_no") or item.get("runNo") or item.get("id")) == normalized_run_no
            and normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
            and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        ),
        None,
    )
    if run is None:
        raise ValueError("experiment run is required for abnormal termination")

    relation_tray_codes = {
        normalize_text(item.get("tray_code") or item.get("tray_no"))
        for item in experiment_run_trays
        if normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no
        and normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        and normalize_text(item.get("tray_code") or item.get("tray_no"))
    }
    if not relation_tray_codes:
        raise ValueError("experiment_run_trays are required for abnormal termination")
    requested_tray_codes = {
        normalize_text(tray_code)
        for tray_code in tray_codes or []
        if normalize_text(tray_code)
    }
    affected_tray_codes = relation_tray_codes & requested_tray_codes if requested_tray_codes else relation_tray_codes
    if not affected_tray_codes:
        raise ValueError("current experiment run has no matching trays")

    experiment = next(
        (
            item
            for item in experiments
            if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
            and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        ),
        {},
    )
    experiment_name = normalize_text(
        experiment.get("experiment_name") or experiment.get("experiment_type")
    ) or normalized_experiment_code
    scoped_sample_codes = {
        normalize_text(item.get("sample_code") or item.get("sample_no") or item.get("sample_id"))
        for item in experiment_samples
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        and normalize_text(item.get("sample_code") or item.get("sample_no") or item.get("sample_id"))
    }
    reason = normalize_text(termination_reason)
    detail = f"{normalized_task_code} / {experiment_name} / {ABNORMAL_TERMINATION_STATUS}"
    if reason:
        detail = f"{detail} / 原因：{reason}"

    affected_samples: list[dict[str, Any]] = []
    for sample in samples:
        if normalize_text(sample.get("task_code") or sample.get("task_no")) != normalized_task_code:
            continue
        sample_code = normalize_text(
            sample.get("code") or sample.get("sample_code") or sample.get("sample_no") or sample.get("id")
        )
        touched_tray_codes: list[str] = []
        next_trays: list[dict[str, Any]] = []
        for tray in sample.get("trays", []):
            tray_code = normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no"))
            if tray_code not in affected_tray_codes:
                next_trays.append(tray)
                continue
            if scoped_sample_codes and sample_code not in scoped_sample_codes:
                next_trays.append(tray)
                continue
            next_tray = {
                **tray,
                "status": ABNORMAL_TERMINATION_STATUS,
                "updated_at": terminated_time,
            }
            for key in (
                "target_lab",
                "targetLab",
                "target_experiment_code",
                "targetExperimentCode",
                "target_sub_experiment_code",
                "targetSubExperimentCode",
            ):
                next_tray.pop(key, None)
            clear_fixture_ready_marker(next_tray)
            next_trays.append(next_tray)
            touched_tray_codes.append(tray_code)

        if not touched_tray_codes:
            continue
        sample["status"] = ABNORMAL_TERMINATION_STATUS
        sample["flow_status"] = ABNORMAL_TERMINATION_STATUS
        sample["updated_at"] = terminated_time
        sample["trays"] = next_trays
        history_entry: dict[str, Any] = {
            "action": ABNORMAL_TERMINATION_ACTION,
            "detail": detail,
            "location": normalize_text(sample.get("location")),
            "owner": normalize_text(sample.get("owner")),
            "status": ABNORMAL_TERMINATION_STATUS,
            "time": terminated_time,
        }
        unique_tray_codes = sorted(set(touched_tray_codes))
        if len(unique_tray_codes) == 1:
            history_entry["tray_code"] = unique_tray_codes[0]
        else:
            history_entry["tray_codes"] = unique_tray_codes
        duplicate = any(
            normalize_text(entry.get("detail")) == detail
            and normalize_text(entry.get("time")) == terminated_time
            for entry in sample.get("history", [])
        )
        if not duplicate:
            sample["history"] = [history_entry, *sample.get("history", [])]
        affected_samples.append(sample)

    if not affected_samples:
        raise ValueError("current experiment has no matching active tray samples")

    schedule_id = normalize_text(run.get("schedule_id") or run.get("schedule_no") or run.get("scheduleId"))
    experiments = [
        {
            **item,
            "status": ABNORMAL_TERMINATION_STATUS,
            "updated_at": terminated_time,
        }
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        else item
        for item in experiments
    ]
    schedules = [
        {
            **item,
            "status": ABNORMAL_TERMINATION_STATUS,
            "updated_at": terminated_time,
        }
        if (
            schedule_id
            and normalize_text(item.get("id") or item.get("schedule_id") or item.get("scheduleId")) == schedule_id
        )
        or (
            not schedule_id
            and normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
            and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        )
        else item
        for item in schedules
    ]
    experiment_runs = [
        {
            **item,
            "status": ABNORMAL_TERMINATION_STATUS,
            "ended_at": terminated_time,
            "updated_at": terminated_time,
        }
        if normalize_text(item.get("run_no") or item.get("runNo") or item.get("id")) == normalized_run_no
        else item
        for item in experiment_runs
    ]
    experiment_run_trays = [
        {
            **item,
            "status": ABNORMAL_TERMINATION_STATUS,
            "run_tray_status": ABNORMAL_TERMINATION_STATUS,
            "ended_at": terminated_time,
            "updated_at": terminated_time,
        }
        if normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no
        and normalize_text(item.get("tray_code") or item.get("tray_no")) in affected_tray_codes
        else item
        for item in experiment_run_trays
    ]

    return {
        "affectedSampleCount": len(affected_samples),
        "affectedSamples": affected_samples,
        "affectedTrayCodes": sorted(affected_tray_codes),
        "experiments": experiments,
        "experimentRuns": experiment_runs,
        "experimentRunTrays": experiment_run_trays,
        "samples": samples,
        "schedules": schedules,
        "tasks": tasks,
        "terminatedAt": terminated_time,
    }
