from __future__ import annotations

from typing import Any

from app.core.time_utils import format_business_datetime, now_business_text
from app.services.laboratory_operations import clear_fixture_ready_marker


ABNORMAL_TERMINATION_STATUS = "实验异常终止"
ABNORMAL_TERMINATION_ACTION = "异常终止实验"
MOLD_CANCELED_STATUS = "实验已取消"
MOLD_CANCELED_ACTION = "取消本次霉菌实验"
MOLD_PENDING_STATUS = "待排程"
MOLD_LAB_CODE = "LAB_MOLD"
MOLD_LAB_NAME = "霉菌试验室"


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
    terminal_status: str = ABNORMAL_TERMINATION_STATUS,
    history_action: str = ABNORMAL_TERMINATION_ACTION,
    next_experiment_status: str = ABNORMAL_TERMINATION_STATUS,
    remove_current_schedule: bool = False,
    require_full_run: bool = False,
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
    if require_full_run and requested_tray_codes and requested_tray_codes != relation_tray_codes:
        raise ValueError("laboratory termination must include every tray in the current run")
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
    normalized_terminal_status = normalize_text(terminal_status) or ABNORMAL_TERMINATION_STATUS
    normalized_history_action = normalize_text(history_action) or ABNORMAL_TERMINATION_ACTION
    normalized_next_experiment_status = normalize_text(next_experiment_status) or normalized_terminal_status
    detail = f"{normalized_task_code} / {experiment_name} / {normalized_terminal_status}"
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
                "status": normalized_terminal_status,
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
        sample["status"] = normalized_terminal_status
        sample["flow_status"] = normalized_terminal_status
        sample["updated_at"] = terminated_time
        sample["trays"] = next_trays
        history_entry: dict[str, Any] = {
            "action": normalized_history_action,
            "detail": detail,
            "location": normalize_text(sample.get("location")),
            "owner": normalize_text(sample.get("owner")),
            "status": normalized_terminal_status,
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
            "status": normalized_next_experiment_status,
            **(
                {"unscheduled_since": terminated_time}
                if normalized_next_experiment_status == MOLD_PENDING_STATUS
                else {}
            ),
            "updated_at": terminated_time,
        }
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        else item
        for item in experiments
    ]
    def matched_schedule(item: dict[str, Any]) -> bool:
        return bool(
            (
                schedule_id
                and normalize_text(item.get("id") or item.get("schedule_id") or item.get("scheduleId")) == schedule_id
            )
            or (
                not schedule_id
                and normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
                and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
            )
        )
    schedules = [item for item in schedules if not matched_schedule(item)] if remove_current_schedule else [
        {
            **item,
            "status": normalized_terminal_status,
            "updated_at": terminated_time,
        }
        if matched_schedule(item)
        else item
        for item in schedules
    ]
    experiment_runs = [
        {
            **item,
            "status": normalized_terminal_status,
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
            "status": normalized_terminal_status,
            "run_tray_status": normalized_terminal_status,
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


def cancel_storage_mold_experiment(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    run_no: str,
    canceled_at: str = "",
    cancel_reason: str = "",
) -> dict[str, Any]:
    """Cancel one complete, currently-running mold run without completing its experiment."""

    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_run_no = normalize_text(run_no)
    run = next(
        (
            item
            for item in snapshot.get("experiment_runs", [])
            if normalize_text(item.get("run_no") or item.get("runNo") or item.get("id")) == normalized_run_no
            and normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
            and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        ),
        None,
    )
    if run is None:
        raise ValueError("experiment run is required for mold cancellation")
    if normalize_text(run.get("status") or run.get("run_status")) != "实验进行中":
        raise ValueError("只有实验进行中的霉菌实验可以取消")
    if normalize_text(run.get("device") or run.get("device_name")) != MOLD_LAB_NAME:
        raise ValueError("取消本次霉菌实验仅支持霉菌试验室")
    schedule_id = normalize_text(run.get("schedule_id") or run.get("schedule_no") or run.get("scheduleId"))
    if not schedule_id:
        raise ValueError("当前霉菌实验缺少排程标识，不能取消")

    experiment = next(
        (
            item
            for item in snapshot.get("experiments", [])
            if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
            and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        ),
        None,
    )
    experiment_name = normalize_text(
        (experiment or {}).get("experiment_name")
        or (experiment or {}).get("experiment_type")
        or (experiment or {}).get("test_type")
    )
    if "霉菌" not in experiment_name:
        raise ValueError("取消本次霉菌实验仅支持霉菌试验")
    reason = normalize_text(cancel_reason)
    if not reason:
        raise ValueError("取消原因不能为空")

    relation_rows = [
        item
        for item in snapshot.get("experiment_run_trays", [])
        if normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no
        and normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
    ]
    if not relation_rows:
        raise ValueError("experiment_run_trays are required for mold cancellation")
    if any(normalize_text(item.get("run_tray_status") or item.get("status")) != "实验进行中" for item in relation_rows):
        raise ValueError("霉菌实验取消必须包含当前运行中的全部托盘")

    result = terminate_storage_laboratory_experiment(
        snapshot,
        task_code=normalized_task_code,
        experiment_code=normalized_experiment_code,
        run_no=normalized_run_no,
        tray_codes=[normalize_text(item.get("tray_code") or item.get("tray_no")) for item in relation_rows],
        terminated_at=canceled_at,
        termination_reason=reason,
        terminal_status=MOLD_CANCELED_STATUS,
        history_action=MOLD_CANCELED_ACTION,
        next_experiment_status=MOLD_PENDING_STATUS,
        remove_current_schedule=True,
        require_full_run=True,
    )
    for sample in result["samples"]:
        for tray in sample.get("trays", []):
            if normalize_text(tray.get("tray_code") or tray.get("tray_no")) not in {
                normalize_text(item.get("tray_code") or item.get("tray_no"))
                for item in relation_rows
            }:
                continue
            tray.pop("fixture_install_id", None)
            tray.pop("fixtureInstallId", None)
    result["canceledAt"] = result.pop("terminatedAt")
    return result
