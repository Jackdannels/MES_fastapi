from __future__ import annotations

from typing import Any

from app.core.time_utils import format_business_datetime, now_business_text
from app.services.experiment_segments import (
    record_sub_experiment_code,
    resolve_record_sub_experiment_code,
)
from app.services.laboratory_axis_steps import (
    AXIS_PENDING_STATUS,
    AXIS_RUNNING_STATUS,
    normalize_axis_codes,
    planned_axis_codes_for_run,
)
from app.services.laboratory_operations import clear_fixture_ready_marker
from app.services.laboratory_run_lifecycle import close_superseded_running_runs_for_trays


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
    sub_experiment_code: str = "",
    run_no: str,
    lab_name: str = "",
    schedule_id: str = "",
    tray_codes: list[str] | None = None,
    started_at: str = "",
    planned_hours: float | int | None = None,
    planned_end_at: str = "",
    axis_codes: list[str] | None = None,
    axis_batch_no: int | str | None = None,
    current_axis_code: str = "",
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    normalized_run_no = normalize_text(run_no)
    started_time = format_business_datetime(started_at) or normalize_text(started_at) or now_business_text()
    if not normalized_task_code or not normalized_experiment_code or not normalized_run_no:
        raise ValueError("task_code, experiment_code and run_no are required")

    affected_tray_codes = [normalize_text(code) for code in (tray_codes or []) if normalize_text(code)]
    if not affected_tray_codes:
        raise ValueError("trayCodes are required for experiment start")

    experiments = [dict(item) for item in snapshot.get("experiments", [])]
    schedules = [dict(item) for item in snapshot.get("schedules", [])]
    normalized_schedule_id = normalize_text(schedule_id)
    tasks = [dict(item) for item in snapshot.get("tasks", [])]
    experiment_runs = [dict(item) for item in snapshot.get("experiment_runs", [])]
    experiment_run_trays = [dict(item) for item in snapshot.get("experiment_run_trays", [])]
    experiment_run_steps = [dict(item) for item in snapshot.get("experiment_run_steps", [])]
    experiment_trays = [dict(item) for item in snapshot.get("experiment_trays", [])]
    experiment_samples = [dict(item) for item in snapshot.get("experiment_samples", [])]
    samples = [
        {
            **sample,
            "trays": [dict(tray) for tray in sample.get("trays", []) if isinstance(tray, dict)],
            "history": [dict(entry) for entry in sample.get("history", []) if isinstance(entry, dict)],
        }
        for sample in snapshot.get("samples", [])
    ]

    scoped_tray_codes = {
        normalize_text(item.get("tray_code") or item.get("tray_no"))
        for item in experiment_trays
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        and normalize_text(item.get("tray_code") or item.get("tray_no"))
    }
    if scoped_tray_codes:
        affected_tray_codes = [tray_code for tray_code in affected_tray_codes if tray_code in scoped_tray_codes]
        if not affected_tray_codes:
            raise ValueError("current experiment has no matching active tray samples")
    affected_tray_code_scope = set(affected_tray_codes)

    scoped_sample_codes = {
        normalize_text(item.get("sample_code") or item.get("sample_no") or item.get("sample_id"))
        for item in experiment_samples
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        and normalize_text(item.get("sample_code") or item.get("sample_no") or item.get("sample_id"))
    }

    def sample_matches_current_experiment(sample: dict[str, Any]) -> bool:
        if normalize_text(sample.get("task_code") or sample.get("task_no")) != normalized_task_code:
            return False
        sample_code = normalize_text(sample.get("code") or sample.get("sample_code") or sample.get("sample_no") or sample.get("id"))
        if sample_code in scoped_sample_codes:
            return True
        for tray in sample.get("trays", []):
            tray_code = normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no"))
            if tray_code not in affected_tray_code_scope:
                continue
            target_experiment_code = normalize_text(
                tray.get("target_experiment_code")
                or tray.get("targetExperimentCode")
                or tray.get("experiment_code")
                or tray.get("experimentCode")
                or tray.get("experiment_no")
                or tray.get("experimentNo")
            )
            if target_experiment_code == normalized_experiment_code:
                return True
        return False

    def sample_tray_is_returned(sample: dict[str, Any], tray_code: str) -> bool:
        trays = [tray for tray in sample.get("trays", []) if isinstance(tray, dict)]
        target_tray = next(
            (
                tray
                for tray in trays
                if normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no")) == tray_code
            ),
            None,
        )
        if target_tray and is_returned_text(target_tray.get("status")):
            return True
        if target_tray and normalize_text(target_tray.get("status")):
            return False
        if target_tray is None:
            return False
        if not is_returned_text(sample.get("status")) and not is_returned_text(sample.get("flow_status")) and not is_returned_text(sample.get("location")):
            return False
        if len(trays) <= 1:
            return target_tray is not None
        return all(is_returned_text(tray.get("status")) for tray in trays)

    returned_tray_codes = {
        normalize_text(item.get("tray_code") or item.get("tray_no"))
        for item in experiment_run_trays
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        and is_returned_text(item.get("run_tray_status") or item.get("runTrayStatus") or item.get("status"))
    }
    returned_tray_codes.update(
        tray_code
        for sample in samples
        if sample_matches_current_experiment(sample)
        for tray_code in affected_tray_code_scope
        if sample_tray_is_returned(sample, tray_code)
    )

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
    if not normalized_sub_experiment_code and normalized_schedule_id:
        for schedule in schedules:
            if normalize_text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("scheduleId")) != normalized_schedule_id:
                continue
            normalized_sub_experiment_code = resolve_record_sub_experiment_code(
                schedule,
                experiment_code=normalized_experiment_code,
            )
            break

    for sample in samples:
        if not sample_matches_current_experiment(sample):
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
                if normalized_sub_experiment_code:
                    next_tray["target_sub_experiment_code"] = normalized_sub_experiment_code
                else:
                    next_tray.pop("target_sub_experiment_code", None)
                    next_tray.pop("targetSubExperimentCode", None)
                clear_fixture_ready_marker(next_tray)
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
    schedules = [
        {
            **item,
            "status": RUNNING_STATUS,
            "updated_at": started_time,
        }
        if (
            (
                normalized_schedule_id
                and normalize_text(item.get("id") or item.get("schedule_id") or item.get("scheduleId")) == normalized_schedule_id
            )
            or (
                not normalized_schedule_id
                and
                normalize_text(item.get("task_code")) == normalized_task_code
                and normalize_text(item.get("experiment_code")) == normalized_experiment_code
                and (not normalized_sub_experiment_code or record_sub_experiment_code(item) == normalized_sub_experiment_code)
                and (not normalized_lab_name or normalize_text(item.get("device") or item.get("device_name")) == normalized_lab_name)
            )
        )
        else item
        for item in schedules
    ]

    planned_hours_value = None if planned_hours in ("", None) else planned_hours
    planned_axis_codes = normalize_axis_codes(axis_codes)
    if not planned_axis_codes and normalized_schedule_id:
        for schedule in schedules:
            if normalize_text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("scheduleId")) != normalized_schedule_id:
                continue
            planned_axis_codes = normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes"))
            if not normalized_sub_experiment_code:
                normalized_sub_experiment_code = resolve_record_sub_experiment_code(
                    schedule,
                    experiment_code=normalized_experiment_code,
                )
            break
    if not planned_axis_codes:
        planned_axis_codes = planned_axis_codes_for_run(
            {**snapshot, "experiment_runs": experiment_runs, "schedules": schedules},
            task_code=normalized_task_code,
            experiment_code=normalized_experiment_code,
            run_no=normalized_run_no,
        )
    if planned_axis_codes and not normalized_sub_experiment_code:
        raise ValueError("sub_experiment_code is required for axis experiment start")
    normalized_current_axis_code = normalize_text(current_axis_code) or (planned_axis_codes[0] if planned_axis_codes else "")

    run_record = {
        "id": normalized_run_no,
        "run_no": normalized_run_no,
        "schedule_id": normalized_schedule_id,
        "task_code": normalized_task_code,
        "experiment_code": normalized_experiment_code,
        "sub_experiment_code": normalized_sub_experiment_code,
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
    if planned_axis_codes:
        run_record["axis_codes"] = planned_axis_codes
    if axis_batch_no not in ("", None):
        run_record["axis_batch_no"] = axis_batch_no
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
                        "sub_experiment_code": normalized_sub_experiment_code or record_sub_experiment_code(item),
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
                "sub_experiment_code": normalized_sub_experiment_code,
                "tray_code": tray_code,
                "status": RUNNING_STATUS,
                "run_tray_status": RUNNING_STATUS,
                "started_at": started_time,
                "ended_at": "",
                "created_at": started_time,
                "updated_at": started_time,
            }
        )

    experiment_runs, experiment_run_trays = close_superseded_running_runs_for_trays(
        experiment_runs=experiment_runs,
        experiment_run_trays=experiment_run_trays,
        task_code=normalized_task_code,
        experiment_code=normalized_experiment_code,
        sub_experiment_code=normalized_sub_experiment_code,
        tray_codes=affected_tray_codes,
        current_run_no=normalized_run_no,
        ended_at=started_time,
    )

    if planned_axis_codes:
        existing_step_keys = {
            (
                normalize_text(item.get("run_no") or item.get("runNo")),
                normalize_text(item.get("axis_code") or item.get("axisCode")),
            )
            for item in experiment_run_steps
        }
        for index, axis_code in enumerate(planned_axis_codes, start=1):
            step_key = (normalized_run_no, axis_code)
            if step_key in existing_step_keys:
                experiment_run_steps = [
                    {
                        **item,
                        "sub_experiment_code": normalized_sub_experiment_code or record_sub_experiment_code(item),
                        "status": AXIS_RUNNING_STATUS if axis_code == normalized_current_axis_code else normalize_text(item.get("status")) or AXIS_PENDING_STATUS,
                        "started_at": started_time if axis_code == normalized_current_axis_code else normalize_text(item.get("started_at") or item.get("startedAt")),
                        "updated_at": started_time,
                    }
                    if (
                        normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no
                        and normalize_text(item.get("axis_code") or item.get("axisCode")) == axis_code
                    )
                    else item
                    for item in experiment_run_steps
                ]
                continue
            experiment_run_steps.append(
                {
                    "id": f"{normalized_run_no}:{index}:{axis_code}",
                    "run_no": normalized_run_no,
                    "task_code": normalized_task_code,
                    "experiment_code": normalized_experiment_code,
                    "sub_experiment_code": normalized_sub_experiment_code,
                    "axis_code": axis_code,
                    "step_no": index,
                    "status": AXIS_RUNNING_STATUS if axis_code == normalized_current_axis_code else AXIS_PENDING_STATUS,
                    "started_at": started_time if axis_code == normalized_current_axis_code else "",
                    "ended_at": "",
                    "created_at": started_time,
                    "updated_at": started_time,
                }
            )

    return {
        "affectedSampleCount": affected_sample_count,
        "affectedTrayCodes": affected_tray_codes,
        "experimentRunTrays": experiment_run_trays,
        "experimentRunSteps": experiment_run_steps,
        "experimentRuns": experiment_runs,
        "experiments": experiments,
        "samples": samples,
        "schedules": schedules,
        "startedAt": started_time,
        "tasks": tasks,
    }
