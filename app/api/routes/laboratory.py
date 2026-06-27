from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.api.routes.storage import publish_storage_update
from app.core.storage_backend import get_storage_backend, normalize_storage_payload
from app.core.time_utils import now_business_text, parse_business_datetime
from app.services.appearance_inspection import PRE_EXPERIMENT_APPEARANCE_STATUS
from app.services.laboratory_axis_steps import complete_storage_laboratory_axis_step
from app.services.laboratory_completion import complete_storage_laboratory_experiment
from app.services.laboratory_operations import (
    acquire_laboratory_operation_locks,
    acquire_laboratory_storage_commit_lock,
    apply_laboratory_task_operation,
    merge_scoped_samples,
    operation_resource_keys,
    resolve_lab_name,
    run_atomic_laboratory_operation,
    scope_snapshot_samples_for_experiment,
)
from app.services.laboratory_start import start_storage_laboratory_experiment

router = APIRouter(prefix="/api/laboratory", tags=["laboratory"])

STAGING_LOCATION = "恒温恒湿间（暂存间）"
APPEARANCE_LOCATION = "外观检测间"
APPEARANCE_STOCKED_STATUS = "实验后外观检测间存放"
POST_EXPERIMENT_STAGING_STOCKED_STATUS = "实验后暂存间存放"
HANDOVER_LOCATION = "接驳区"
ALLOW_WITHDRAW_STATUSES = {"已到达实验室", "工装夹具安装", "实验准备就绪"}
WITHDRAWAL_HISTORY_ACTIONS = {"撤回出库", "实验任务撤回", "任务切换撤回"}
COMPLETED_EXPERIMENT_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}
PARTIAL_AXIS_CONTINUATION_STATUS = "送至实验室"
BLOCK_WITHDRAW_TRAY_STATUSES = {
    "实验进行中",
    "实验中",
    "实验已完成",
    "实验完成",
    "实验已经完成",
    "送至暂存间",
    POST_EXPERIMENT_STAGING_STOCKED_STATUS,
    "送至外观检测间",
    "实验后外观检测间存放",
    "厂家收回",
}
LABORATORY_STORAGE_UPDATE_KEYS = ("mes.samples", "mes.staging_events")
LABORATORY_COMPLETION_STORAGE_UPDATE_KEYS = (
    "mes.samples",
    "mes.experiments",
    "mes.schedules",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_run_steps",
)
LABORATORY_START_STORAGE_UPDATE_KEYS = (
    "mes.tasks",
    "mes.samples",
    "mes.experiments",
    "mes.schedules",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_run_steps",
)


class LaboratoryWithdrawRequest(BaseModel):
    reason: str = ""
    operation_id: str = Field(default="", alias="operationId")
    tray_codes: list[str] = Field(default_factory=list, alias="trayCodes")

    model_config = ConfigDict(populate_by_name=True)


class LaboratoryCompleteRequest(BaseModel):
    completed_at: str = Field(default="", alias="completedAt")
    run_no: str = Field(default="", alias="runNo")
    sub_experiment_code: str = Field(default="", alias="subExperimentCode")
    tray_codes: list[str] = Field(default_factory=list, alias="trayCodes")
    axis_code: str = Field(default="", alias="axisCode")
    next_axis_code: str = Field(default="", alias="nextAxisCode")

    model_config = ConfigDict(populate_by_name=True)


class LaboratoryStartRequest(BaseModel):
    run_no: str = Field(default="", alias="runNo")
    lab_code: str = Field(default="", alias="labCode")
    lab_name: str = Field(default="", alias="labName")
    schedule_id: str = Field(default="", alias="scheduleId")
    sub_experiment_code: str = Field(default="", alias="subExperimentCode")
    tray_codes: list[str] = Field(default_factory=list, alias="trayCodes")
    started_at: str = Field(default="", alias="startedAt")
    planned_hours: float | int | None = Field(default=None, alias="plannedHours")
    planned_end_at: str = Field(default="", alias="plannedEndAt")
    axis_codes: list[str] = Field(default_factory=list, alias="axisCodes")
    axis_batch_no: int | str | None = Field(default=None, alias="axisBatchNo")
    current_axis_code: str = Field(default="", alias="currentAxisCode")

    model_config = ConfigDict(populate_by_name=True)


class LaboratoryOperationRequest(BaseModel):
    operation_type: str = Field(default="", alias="operationType")
    task_code: str = Field(default="", alias="taskCode")
    experiment_code: str = Field(default="", alias="experimentCode")
    sub_experiment_code: str = Field(default="", alias="subExperimentCode")
    lab_code: str = Field(default="", alias="labCode")
    lab_name: str = Field(default="", alias="labName")
    tray_codes: list[str] = Field(default_factory=list, alias="trayCodes")
    occurred_at: str = Field(default="", alias="occurredAt")
    operation_id: str = Field(default="", alias="operationId")

    model_config = ConfigDict(populate_by_name=True)


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_axis_codes(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = value.replace("，", ",").split(",")
    else:
        raw_values = []
    axis_codes: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        axis_code = normalize_text(item)
        if not axis_code or axis_code in seen:
            continue
        seen.add(axis_code)
        axis_codes.append(axis_code)
    return axis_codes


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def parse_datetime_value(value: Any) -> datetime | None:
    return parse_business_datetime(value)


def read_snapshot() -> dict[str, list[dict[str, Any]]]:
    storage = get_storage_backend()
    payload = normalize_storage_payload(storage.read_all())
    return {
        "tasks": [dict(item) for item in as_list(payload.get("mes.tasks")) if isinstance(item, dict)],
        "samples": [dict(item) for item in as_list(payload.get("mes.samples")) if isinstance(item, dict)],
        "schedules": [dict(item) for item in as_list(payload.get("mes.schedules")) if isinstance(item, dict)],
        "experiments": [dict(item) for item in as_list(payload.get("mes.experiments")) if isinstance(item, dict)],
        "experiment_runs": [dict(item) for item in as_list(payload.get("mes.experiment_runs")) if isinstance(item, dict)],
        "experiment_run_trays": [dict(item) for item in as_list(payload.get("mes.experiment_run_trays")) if isinstance(item, dict)],
        "experiment_run_steps": [dict(item) for item in as_list(payload.get("mes.experiment_run_steps")) if isinstance(item, dict)],
        "experiment_trays": [dict(item) for item in as_list(payload.get("mes.experiment_trays")) if isinstance(item, dict)],
        "experiment_samples": [dict(item) for item in as_list(payload.get("mes.experiment_samples")) if isinstance(item, dict)],
        "staging_events": [dict(item) for item in as_list(payload.get("mes.staging_events")) if isinstance(item, dict)],
    }


def write_snapshot(snapshot: dict[str, list[dict[str, Any]]]) -> None:
    get_storage_backend().write_many(
        {
            "mes.samples": snapshot["samples"],
            "mes.staging_events": snapshot["staging_events"],
        }
    )
    publish_storage_update(list(LABORATORY_STORAGE_UPDATE_KEYS))


def write_completion_snapshot(result: dict[str, Any]) -> None:
    payload = {
        "mes.samples": result["samples"],
        "mes.experiments": result["experiments"],
        "mes.schedules": result["schedules"],
        "mes.experiment_runs": result["experimentRuns"],
        "mes.experiment_run_trays": result["experimentRunTrays"],
    }
    if "experimentRunSteps" in result:
        payload["mes.experiment_run_steps"] = result["experimentRunSteps"]
    get_storage_backend().write_many(
        payload
    )
    publish_storage_update(list(LABORATORY_COMPLETION_STORAGE_UPDATE_KEYS))


def write_start_snapshot(original_snapshot: dict[str, list[dict[str, Any]]], result: dict[str, Any]) -> None:
    payload = {
        "mes.tasks": result["tasks"],
        "mes.samples": merge_scoped_samples(original_snapshot["samples"], result["samples"]),
        "mes.experiments": result["experiments"],
        "mes.schedules": result["schedules"],
        "mes.experiment_runs": result["experimentRuns"],
        "mes.experiment_run_trays": result["experimentRunTrays"],
    }
    if "experimentRunSteps" in result:
        payload["mes.experiment_run_steps"] = result["experimentRunSteps"]
    get_storage_backend().write_many(
        payload
    )
    publish_storage_update(list(LABORATORY_START_STORAGE_UPDATE_KEYS))


def find_task(snapshot: dict[str, list[dict[str, Any]]], task_code: str) -> dict[str, Any]:
    normalized_code = normalize_text(task_code)
    for task in snapshot["tasks"]:
        if normalize_text(task.get("code")) == normalized_code or normalize_text(task.get("id")) == normalized_code:
            return task
    raise HTTPException(status_code=404, detail="未找到任务")


@router.post("/operations")
def apply_laboratory_operation(
    request: LaboratoryOperationRequest = Body(default_factory=LaboratoryOperationRequest),
) -> dict[str, Any]:
    storage = get_storage_backend()
    resource_keys = operation_resource_keys(
        lab_code=request.lab_code,
        lab_name=request.lab_name,
        tray_codes=request.tray_codes,
    )

    def run_operation(snapshot: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
        find_task(snapshot, request.task_code)
        try:
            return apply_laboratory_task_operation(
                snapshot,
                operation_type=request.operation_type,
                task_code=request.task_code,
                experiment_code=request.experiment_code,
                sub_experiment_code=request.sub_experiment_code,
                lab_name=request.lab_name,
                tray_codes=request.tray_codes,
                occurred_at=request.occurred_at,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    result = run_atomic_laboratory_operation(
        operation=run_operation,
        publish_storage_update=publish_storage_update,
        resource_keys=resource_keys,
        storage=storage,
    )
    return {
        "ok": True,
        "operationId": request.operation_id,
        "operationType": request.operation_type,
        **result,
    }


def experiment_name(snapshot: dict[str, list[dict[str, Any]]], task_code: str, experiment_code: str) -> str:
    for experiment in snapshot["experiments"]:
        if (
            normalize_text(experiment.get("task_code")) == task_code
            and normalize_text(experiment.get("experiment_code")) == experiment_code
        ):
            return normalize_text(experiment.get("experiment_name") or experiment.get("experiment_type") or experiment_code)
    return experiment_code


def start_lab_name(
    snapshot: dict[str, list[dict[str, Any]]],
    task_code: str,
    experiment_code: str,
    schedule_id: str,
    fallback: str = "",
) -> str:
    normalized_schedule_id = normalize_text(schedule_id)
    if normalized_schedule_id:
        for schedule in snapshot["schedules"]:
            if (
                normalize_text(schedule.get("task_code") or schedule.get("task_no")) == task_code
                and normalize_text(schedule.get("experiment_code") or schedule.get("experiment_no")) == experiment_code
                and normalize_text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("schedule_no"))
                == normalized_schedule_id
            ):
                return normalize_text(
                    schedule.get("device")
                    or schedule.get("device_name")
                    or schedule.get("labName")
                    or schedule.get("lab_name")
                ) or normalize_text(fallback)
    return resolve_lab_name(snapshot, task_code, experiment_code, fallback)


def experiment_tray_codes(snapshot: dict[str, list[dict[str, Any]]], task_code: str, experiment_code: str) -> list[str]:
    tray_codes = [
        normalize_text(entry.get("tray_code"))
        for entry in snapshot["experiment_trays"]
        if normalize_text(entry.get("task_code")) == task_code
        and normalize_text(entry.get("experiment_code")) == experiment_code
        and normalize_text(entry.get("tray_code"))
    ]
    if not tray_codes:
        raise HTTPException(status_code=404, detail="当前实验未绑定托盘")
    return sorted(set(tray_codes))


def experiment_sample_codes(snapshot: dict[str, list[dict[str, Any]]], task_code: str, experiment_code: str) -> set[str]:
    return {
        normalize_text(entry.get("sample_code"))
        for entry in snapshot.get("experiment_samples", [])
        if normalize_text(entry.get("task_code")) == task_code
        and normalize_text(entry.get("experiment_code")) == experiment_code
        and normalize_text(entry.get("sample_code"))
    }


def parse_experiment_history_detail(detail: Any, task_code: str) -> dict[str, str] | None:
    parts = [normalize_text(part) for part in normalize_text(detail).split("/") if normalize_text(part)]
    if len(parts) < 3 or parts[0] != task_code:
        return None
    status = parts[-1]
    if status in {"实验完成", "实验已经完成"}:
        status = "实验已完成"
    return {"experimentName": parts[1], "status": status}


def staging_event_room(event: dict[str, Any]) -> str:
    return normalize_text(event.get("room") or event.get("storage_room") or event.get("storageRoom"))


def staging_event_matches_room(event: dict[str, Any], room: str) -> bool:
    event_room = staging_event_room(event)
    if room == "staging":
        return event_room in {"", "staging"}
    return event_room == room


def latest_storage_event_for_tray(
    snapshot: dict[str, list[dict[str, Any]]],
    tray_code: str,
    room: str,
) -> dict[str, Any] | None:
    matched = [
        dict(event)
        for event in snapshot["staging_events"]
        if normalize_text(event.get("tray_code")) == tray_code and staging_event_matches_room(event, room)
    ]
    if not matched:
        return None
    matched.sort(key=lambda event: (parse_datetime_value(event.get("time")) or datetime.min, normalize_text(event.get("id"))))
    return matched[-1]


def history_entry_marks_staging_origin(entry: dict[str, Any]) -> bool:
    text = " ".join(
        [
            normalize_text(entry.get("action")),
            normalize_text(entry.get("status")),
            normalize_text(entry.get("location")),
        ]
    )
    return "暂存间" in text


def generic_lab_dispatch_has_staging_origin(
    sample: dict[str, Any],
    dispatch_time: datetime,
    latest_withdrawal_time: datetime,
) -> bool:
    prior_entries = [
        entry
        for entry in as_list(sample.get("history"))
        if latest_withdrawal_time < (parse_datetime_value(entry.get("time")) or datetime.min) < dispatch_time
    ]
    if not prior_entries:
        return False
    prior_entries.sort(key=lambda entry: parse_datetime_value(entry.get("time")) or datetime.min)
    latest_prior = prior_entries[-1]
    return history_entry_marks_staging_origin(latest_prior)


def latest_previous_completed_experiment(
    sample: dict[str, Any],
    task_code: str,
    current_experiment_name: str,
    related_samples: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    seen_sources: set[int] = set()
    for source_sample in [sample, *as_list(related_samples)]:
        source_id = id(source_sample)
        if source_id in seen_sources:
            continue
        seen_sources.add(source_id)
        for entry in as_list(source_sample.get("history")):
            parsed = parse_experiment_history_detail(entry.get("detail"), task_code)
            if not parsed or parsed["status"] != "实验已完成":
                continue
            if parsed["experimentName"] == current_experiment_name:
                continue
            candidates.append(
                {
                    "experimentName": parsed["experimentName"],
                    "location": normalize_text(entry.get("location")) or normalize_text(source_sample.get("location")),
                    "time": parse_datetime_value(entry.get("time")) or datetime.min,
                }
            )
    if not candidates:
        return None
    candidates.sort(key=lambda item: item["time"])
    latest = candidates[-1]
    return {
        "status": "实验已完成",
        "location": latest["location"],
        "experimentName": latest["experimentName"],
        "scope": "experiment",
        "time": latest["time"],
    }


def experiment_display_name(snapshot: dict[str, list[dict[str, Any]]], task_code: str, experiment_code: str) -> str:
    for experiment in snapshot["experiments"]:
        if normalize_text(experiment.get("task_code") or experiment.get("task_no")) != task_code:
            continue
        if normalize_text(experiment.get("experiment_code") or experiment.get("experiment_no")) != experiment_code:
            continue
        return (
            normalize_text(experiment.get("experiment_name"))
            or normalize_text(experiment.get("experiment_type"))
            or experiment_code
        )
    return experiment_code


def required_axis_codes_for_restore(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
) -> list[str]:
    for experiment in snapshot["experiments"]:
        if normalize_text(experiment.get("task_code") or experiment.get("task_no")) != task_code:
            continue
        if normalize_text(experiment.get("experiment_code") or experiment.get("experiment_no")) != experiment_code:
            continue
        axis_codes = normalize_axis_codes(experiment.get("axis_codes") or experiment.get("axisCodes"))
        if axis_codes:
            return axis_codes

    axis_codes: list[str] = []
    seen: set[str] = set()
    schedules = [
        schedule
        for schedule in snapshot["schedules"]
        if normalize_text(schedule.get("task_code") or schedule.get("task_no")) == task_code
        and normalize_text(schedule.get("experiment_code") or schedule.get("experiment_no")) == experiment_code
    ]
    schedules.sort(key=lambda schedule: normalize_text(schedule.get("start_at") or schedule.get("startAt") or schedule.get("start_time")))
    for schedule in schedules:
        for axis_code in normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes")):
            if axis_code in seen:
                continue
            seen.add(axis_code)
            axis_codes.append(axis_code)
    return axis_codes


def latest_previous_partial_axis_completion(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    tray_code: str,
) -> dict[str, Any] | None:
    normalized_tray_code = normalize_text(tray_code)
    if not normalized_tray_code:
        return None

    run_by_no = {
        normalize_text(run.get("run_no") or run.get("runNo") or run.get("id")): run
        for run in snapshot["experiment_runs"]
        if normalize_text(run.get("run_no") or run.get("runNo") or run.get("id"))
    }
    schedule_by_id = {
        normalize_text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("scheduleId")): schedule
        for schedule in snapshot["schedules"]
        if normalize_text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("scheduleId"))
    }
    experiment_codes = {
        normalize_text(relation.get("experiment_code") or relation.get("experiment_no"))
        for relation in snapshot["experiment_run_trays"]
        if normalize_text(relation.get("task_code") or relation.get("task_no")) == task_code
        and normalize_text(relation.get("tray_code") or relation.get("tray_no")) == normalized_tray_code
        and normalize_text(relation.get("status") or relation.get("run_tray_status")) in COMPLETED_EXPERIMENT_STATUSES
        and normalize_text(relation.get("experiment_code") or relation.get("experiment_no"))
    }
    candidates: list[dict[str, Any]] = []
    for experiment_code in experiment_codes:
        experiment_name = experiment_display_name(snapshot, task_code, experiment_code)
        required_axes = required_axis_codes_for_restore(
            snapshot,
            task_code=task_code,
            experiment_code=experiment_code,
        )
        if not required_axes:
            continue

        related_run_nos = {
            normalize_text(relation.get("run_no") or relation.get("runNo"))
            for relation in snapshot["experiment_run_trays"]
            if normalize_text(relation.get("task_code") or relation.get("task_no")) == task_code
            and normalize_text(relation.get("experiment_code") or relation.get("experiment_no")) == experiment_code
            and normalize_text(relation.get("tray_code") or relation.get("tray_no")) == normalized_tray_code
            and normalize_text(relation.get("status") or relation.get("run_tray_status")) in COMPLETED_EXPERIMENT_STATUSES
        }
        related_run_nos.discard("")
        if not related_run_nos:
            continue

        completed_axes: set[str] = set()
        event_times: list[datetime] = []
        completed_schedule_ids: set[str] = set()
        for run_no in related_run_nos:
            run = run_by_no.get(run_no, {})
            completed_axes.update(normalize_axis_codes(run.get("axis_codes") or run.get("axisCodes")))
            schedule_id = normalize_text(run.get("schedule_id") or run.get("scheduleId") or run.get("schedule_no"))
            if schedule_id:
                completed_schedule_ids.add(schedule_id)
            event_times.extend(
                time
                for time in [
                    parse_datetime_value(run.get("ended_at") or run.get("endedAt")),
                    parse_datetime_value(run.get("updated_at") or run.get("updatedAt")),
                ]
                if time is not None
            )

        for relation in snapshot["experiment_run_trays"]:
            if normalize_text(relation.get("run_no") or relation.get("runNo")) not in related_run_nos:
                continue
            event_times.extend(
                time
                for time in [
                    parse_datetime_value(relation.get("ended_at") or relation.get("endedAt")),
                    parse_datetime_value(relation.get("updated_at") or relation.get("updatedAt")),
                ]
                if time is not None
            )

        for step in snapshot["experiment_run_steps"]:
            if normalize_text(step.get("run_no") or step.get("runNo")) not in related_run_nos:
                continue
            if normalize_text(step.get("status")) not in COMPLETED_EXPERIMENT_STATUSES:
                continue
            axis_code = normalize_text(step.get("axis_code") or step.get("axisCode"))
            if axis_code:
                completed_axes.add(axis_code)
            event_times.extend(
                time
                for time in [
                    parse_datetime_value(step.get("ended_at") or step.get("endedAt")),
                    parse_datetime_value(step.get("updated_at") or step.get("updatedAt")),
                ]
                if time is not None
            )

        if not completed_axes or set(required_axes).issubset(completed_axes):
            continue

        location = ""
        for schedule_id in completed_schedule_ids:
            schedule = schedule_by_id.get(schedule_id, {})
            location = normalize_text(schedule.get("device") or schedule.get("lab") or schedule.get("lab_name"))
            if location:
                break
        if not location:
            for run_no in related_run_nos:
                run = run_by_no.get(run_no, {})
                location = normalize_text(run.get("device") or run.get("device_name") or run.get("lab_name"))
                if location:
                    break

        candidates.append(
            {
                "status": PARTIAL_AXIS_CONTINUATION_STATUS,
                "location": location,
                "experimentName": experiment_name,
                "scope": "partial_axis",
                "time": max(event_times) if event_times else datetime.min,
            }
        )

    if not candidates:
        return None
    candidates.sort(key=lambda item: item["time"])
    return candidates[-1]


def related_samples_for_tray(
    snapshot: dict[str, list[dict[str, Any]]],
    task_code: str,
    tray_code: str,
) -> list[dict[str, Any]]:
    normalized_task_code = normalize_text(task_code)
    normalized_tray_code = normalize_text(tray_code)
    if not normalized_task_code or not normalized_tray_code:
        return []
    return [
        sample
        for sample in snapshot["samples"]
        if normalize_text(sample.get("task_code")) == normalized_task_code
        and any(normalize_text(tray.get("tray_code")) == normalized_tray_code for tray in as_list(sample.get("trays")))
    ]


def latest_staging_origin_snapshot(
    sample: dict[str, Any],
    snapshot: dict[str, list[dict[str, Any]]],
    tray_code: str,
) -> dict[str, Any] | None:
    normalized_tray_code = normalize_text(tray_code)
    withdrawal_times = [
        parse_datetime_value(event.get("time")) or datetime.min
        for event in snapshot["staging_events"]
        if normalize_text(event.get("tray_code")) == normalized_tray_code
        and normalize_text(event.get("action")) == "stock_out_withdraw"
    ]
    withdrawal_times.extend(
        parse_datetime_value(entry.get("time")) or datetime.min
        for entry in as_list(sample.get("history"))
        if normalize_text(entry.get("action")) in WITHDRAWAL_HISTORY_ACTIONS
    )
    latest_withdrawal_time = max(withdrawal_times) if withdrawal_times else datetime.min

    dispatch_entries: list[dict[str, Any]] = []
    for event in snapshot["staging_events"]:
        if normalize_text(event.get("tray_code")) != normalized_tray_code:
            continue
        if not staging_event_matches_room(event, "staging"):
            continue
        if normalize_text(event.get("action")) != "stock_out":
            continue
        event_time = parse_datetime_value(event.get("time")) or datetime.min
        if event_time > latest_withdrawal_time:
            dispatch_entries.append({"action": "暂存间扫码出库", "stagingOrigin": True, "time": event_time})

    for entry in as_list(sample.get("history")):
        action = normalize_text(entry.get("action"))
        if action not in {"暂存间扫码出库", "接驳区扫码出库", "送至实验室"}:
            continue
        entry_time = parse_datetime_value(entry.get("time")) or datetime.min
        staging_origin = action == "暂存间扫码出库" or (
            action == "送至实验室"
            and generic_lab_dispatch_has_staging_origin(sample, entry_time, latest_withdrawal_time)
        )
        if entry_time > latest_withdrawal_time:
            dispatch_entries.append({"action": action, "stagingOrigin": staging_origin, "time": entry_time})

    if not dispatch_entries:
        return None
    dispatch_entries.sort(key=lambda entry: entry["time"])
    latest_dispatch = dispatch_entries[-1]
    if not latest_dispatch.get("stagingOrigin"):
        return None

    dispatch_time = latest_dispatch["time"]
    stable_entries: list[dict[str, Any]] = []
    for event in snapshot["staging_events"]:
        if normalize_text(event.get("tray_code")) != normalized_tray_code:
            continue
        if not staging_event_matches_room(event, "staging"):
            continue
        if normalize_text(event.get("action")) != "stock_in":
            continue
        event_time = parse_datetime_value(event.get("time")) or datetime.min
        if latest_withdrawal_time < event_time <= dispatch_time:
            stable_entries.append({"time": event_time})

    for entry in as_list(sample.get("history")):
        action = normalize_text(entry.get("action"))
        status = normalize_text(entry.get("status"))
        location = normalize_text(entry.get("location"))
        entry_time = parse_datetime_value(entry.get("time")) or datetime.min
        marks_staging_arrival = (
            status == "已到达暂存间"
            or action in {"暂存间扫码入库", "送至暂存间", *WITHDRAWAL_HISTORY_ACTIONS}
            and (status in {"已到达暂存间", "送至暂存间"} or location == STAGING_LOCATION)
        )
        if marks_staging_arrival and latest_withdrawal_time < entry_time <= dispatch_time:
            stable_entries.append({"time": entry_time})

    stable_entries.sort(key=lambda entry: entry["time"])
    stable_time = stable_entries[-1]["time"] if stable_entries else dispatch_time
    return {
        "status": "已到达暂存间",
        "location": STAGING_LOCATION,
        "scope": "staging",
        "experimentName": "",
        "time": stable_time,
    }


def latest_appearance_origin_snapshot(
    sample: dict[str, Any],
    snapshot: dict[str, list[dict[str, Any]]],
    tray_code: str,
) -> dict[str, Any] | None:
    normalized_tray_code = normalize_text(tray_code)
    withdrawal_times = [
        parse_datetime_value(event.get("time")) or datetime.min
        for event in snapshot["staging_events"]
        if normalize_text(event.get("tray_code")) == normalized_tray_code
        and normalize_text(event.get("action")) == "stock_out_withdraw"
    ]
    withdrawal_times.extend(
        parse_datetime_value(entry.get("time")) or datetime.min
        for entry in as_list(sample.get("history"))
        if normalize_text(entry.get("action")) in WITHDRAWAL_HISTORY_ACTIONS
    )
    latest_withdrawal_time = max(withdrawal_times) if withdrawal_times else datetime.min

    dispatch_entries: list[dict[str, Any]] = []
    for event in snapshot["staging_events"]:
        if normalize_text(event.get("tray_code")) != normalized_tray_code:
            continue
        if not staging_event_matches_room(event, "appearance"):
            continue
        if normalize_text(event.get("action")) != "stock_out":
            continue
        event_time = parse_datetime_value(event.get("time")) or datetime.min
        if event_time > latest_withdrawal_time:
            dispatch_entries.append({"time": event_time})

    for entry in as_list(sample.get("history")):
        action = normalize_text(entry.get("action"))
        if action != "外观检测间扫码出库":
            continue
        entry_time = parse_datetime_value(entry.get("time")) or datetime.min
        if entry_time > latest_withdrawal_time:
            dispatch_entries.append({"time": entry_time})

    if not dispatch_entries:
        return None
    dispatch_entries.sort(key=lambda entry: entry["time"])
    dispatch_time = dispatch_entries[-1]["time"]

    stable_entries: list[dict[str, Any]] = []
    for event in snapshot["staging_events"]:
        if normalize_text(event.get("tray_code")) != normalized_tray_code:
            continue
        if not staging_event_matches_room(event, "appearance"):
            continue
        if normalize_text(event.get("action")) != "stock_in":
            continue
        event_time = parse_datetime_value(event.get("time")) or datetime.min
        if latest_withdrawal_time < event_time <= dispatch_time:
            stable_entries.append({"time": event_time})

    for entry in as_list(sample.get("history")):
        action = normalize_text(entry.get("action"))
        status = normalize_text(entry.get("status"))
        entry_time = parse_datetime_value(entry.get("time")) or datetime.min
        marks_appearance_storage = (
            status in {APPEARANCE_STOCKED_STATUS, PRE_EXPERIMENT_APPEARANCE_STATUS}
            or action == "外观检测间扫码入库"
            and status in {APPEARANCE_STOCKED_STATUS, PRE_EXPERIMENT_APPEARANCE_STATUS}
        )
        is_prior_withdrawal_restore = action in WITHDRAWAL_HISTORY_ACTIONS and entry_time == latest_withdrawal_time
        if marks_appearance_storage and (latest_withdrawal_time < entry_time <= dispatch_time or is_prior_withdrawal_restore):
            stable_entries.append({"status": status, "time": entry_time})

    stable_entries.sort(key=lambda entry: entry["time"])
    stable_entry = stable_entries[-1] if stable_entries else {"status": APPEARANCE_STOCKED_STATUS, "time": dispatch_time}
    return {
        "status": stable_entry["status"],
        "location": APPEARANCE_LOCATION,
        "scope": "appearance",
        "experimentName": "",
        "time": stable_entry["time"],
    }


def sample_has_staging_origin(sample: dict[str, Any], snapshot: dict[str, list[dict[str, Any]]], tray_code: str) -> bool:
    return latest_staging_origin_snapshot(sample, snapshot, tray_code) is not None


def resolve_restore_snapshot(
    sample: dict[str, Any],
    snapshot: dict[str, list[dict[str, Any]]],
    task_code: str,
    current_experiment_name: str,
    tray_code: str,
) -> dict[str, str]:
    completed = latest_previous_completed_experiment(
        sample,
        task_code,
        current_experiment_name,
        related_samples_for_tray(snapshot, task_code, tray_code),
    )
    partial_axis = latest_previous_partial_axis_completion(
        snapshot,
        task_code=task_code,
        tray_code=tray_code,
    )
    staging = latest_staging_origin_snapshot(sample, snapshot, tray_code)
    appearance = latest_appearance_origin_snapshot(sample, snapshot, tray_code)
    partial_axis_matches_current = (
        partial_axis
        and normalize_text(partial_axis.get("experimentName")) == normalize_text(current_experiment_name)
    )
    if partial_axis_matches_current and (not completed or completed["time"] <= partial_axis["time"]):
        return partial_axis
    candidates = [candidate for candidate in [completed, staging, appearance] if candidate]
    if partial_axis and not partial_axis_matches_current:
        candidates.append(partial_axis)
    if candidates:
        candidates.sort(key=lambda item: item["time"])
        return candidates[-1]
    return {"status": "到货", "location": HANDOVER_LOCATION, "scope": "handover", "experimentName": ""}


def append_history(sample: dict[str, Any], action: str, detail: str, now: str) -> None:
    history = as_list(sample.get("history"))
    history.insert(
        0,
        {
            "id": f"laboratory-event-{normalize_text(sample.get('id')) or normalize_text(sample.get('code'))}-{len(history) + 1}",
            "time": now,
            "action": action,
            "location": normalize_text(sample.get("location")),
            "owner": normalize_text(sample.get("owner")),
            "status": normalize_text(sample.get("status")),
            "detail": detail,
        },
    )
    sample["history"] = history


def matching_samples(
    snapshot: dict[str, list[dict[str, Any]]],
    task_code: str,
    tray_codes: set[str],
    sample_codes: set[str] | None = None,
) -> list[tuple[dict[str, Any], list[str]]]:
    result: list[tuple[dict[str, Any], list[str]]] = []
    for sample in snapshot["samples"]:
        if normalize_text(sample.get("task_code")) != task_code:
            continue
        if sample_codes is not None and normalize_text(sample.get("code")) not in sample_codes:
            continue
        matched_codes = [
            normalize_text(tray.get("tray_code"))
            for tray in as_list(sample.get("trays"))
            if normalize_text(tray.get("tray_code")) in tray_codes
        ]
        if matched_codes:
            result.append((sample, matched_codes))
    return result


def single_tray_sample_matches_current_with_stale_target(
    sample: dict[str, Any],
    *,
    current_experiment_name: str,
    lab_name: str,
    task_code: str,
) -> bool:
    if len(as_list(sample.get("trays"))) != 1:
        return False
    normalized_lab_name = normalize_text(lab_name)
    if normalized_lab_name and normalize_text(sample.get("location")) != normalized_lab_name:
        return False
    sample_status = normalize_text(sample.get("status"))
    if sample_status not in ALLOW_WITHDRAW_STATUSES:
        return False
    current_name = normalize_text(current_experiment_name)
    latest_match: dict[str, Any] | None = None
    for entry in as_list(sample.get("history")):
        parsed = parse_experiment_history_detail(entry.get("detail"), task_code)
        if not parsed or parsed["experimentName"] != current_name:
            continue
        entry_time = parse_datetime_value(entry.get("time")) or datetime.min
        if latest_match is None or entry_time >= latest_match["time"]:
            latest_match = {
                "location": normalize_text(entry.get("location")),
                "status": normalize_text(parsed["status"]),
                "time": entry_time,
            }
    if not latest_match:
        return False
    if latest_match["status"] not in ALLOW_WITHDRAW_STATUSES:
        return False
    return not normalized_lab_name or latest_match["location"] == normalized_lab_name


def withdrawable_sample_matches(
    sample_matches: list[tuple[dict[str, Any], list[str]]],
    *,
    current_experiment_name: str = "",
    experiment_code: str = "",
    lab_name: str = "",
    task_code: str = "",
) -> list[tuple[dict[str, Any], list[str]]]:
    result: list[tuple[dict[str, Any], list[str]]] = []
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_lab_name = normalize_text(lab_name)
    for sample, matched_tray_codes in sample_matches:
        matched_code_set = set(matched_tray_codes)
        withdrawable_codes: list[str] = []
        for tray in as_list(sample.get("trays")):
            tray_code = normalize_text(tray.get("tray_code"))
            if tray_code not in matched_code_set:
                continue
            target_experiment_code = normalize_text(tray.get("target_experiment_code") or tray.get("targetExperimentCode"))
            stale_target_matches_current = single_tray_sample_matches_current_with_stale_target(
                sample,
                current_experiment_name=current_experiment_name,
                lab_name=lab_name,
                task_code=task_code,
            )
            if target_experiment_code and target_experiment_code != normalized_experiment_code and not stale_target_matches_current:
                continue
            target_lab = normalize_text(tray.get("target_lab") or tray.get("targetLab"))
            if target_lab and normalized_lab_name and target_lab != normalized_lab_name and not stale_target_matches_current:
                continue
            sample_status = normalize_text(sample.get("status"))
            tray_status = normalize_text(tray.get("status"))
            if tray_status in BLOCK_WITHDRAW_TRAY_STATUSES:
                continue
            current_status = tray_status if tray_status in ALLOW_WITHDRAW_STATUSES else sample_status
            if current_status in ALLOW_WITHDRAW_STATUSES:
                withdrawable_codes.append(tray_code)
        if withdrawable_codes:
            result.append((sample, sorted(set(withdrawable_codes))))
    return result


@router.post("/tasks/{task_code}/experiments/{experiment_code}/start")
def start_current_experiment(
    task_code: str,
    experiment_code: str,
    request: LaboratoryStartRequest = Body(default_factory=LaboratoryStartRequest),
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    initial_snapshot = read_snapshot()
    initial_lab_name = start_lab_name(
        initial_snapshot,
        normalized_task_code,
        normalized_experiment_code,
        request.schedule_id,
        request.lab_name,
    )
    resource_keys = operation_resource_keys(
        lab_code=request.lab_code,
        lab_name=initial_lab_name,
        tray_codes=request.tray_codes,
    )
    resource_keys.append(f"experiment:{normalized_task_code}:{normalized_experiment_code}")
    with acquire_laboratory_operation_locks(resource_keys):
        with acquire_laboratory_storage_commit_lock():
            snapshot = read_snapshot()
            find_task(snapshot, normalized_task_code)
            current_experiment_name = experiment_name(snapshot, normalized_task_code, normalized_experiment_code)
            lab_name = start_lab_name(
                snapshot,
                normalized_task_code,
                normalized_experiment_code,
                request.schedule_id,
                request.lab_name,
            )
            scoped_snapshot = scope_snapshot_samples_for_experiment(
                snapshot,
                task_code=normalized_task_code,
                experiment_code=normalized_experiment_code,
                tray_codes=request.tray_codes,
            )
            try:
                result = start_storage_laboratory_experiment(
                    scoped_snapshot,
                    task_code=normalized_task_code,
                    experiment_code=normalized_experiment_code,
                    sub_experiment_code=request.sub_experiment_code,
                    run_no=request.run_no,
                    lab_name=lab_name,
                    schedule_id=request.schedule_id,
                    tray_codes=request.tray_codes,
                    started_at=request.started_at,
                    planned_hours=request.planned_hours,
                    planned_end_at=request.planned_end_at,
                    axis_codes=request.axis_codes,
                    axis_batch_no=request.axis_batch_no,
                    current_axis_code=request.current_axis_code,
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            write_start_snapshot(snapshot, result)
            return {
                "ok": True,
                "message": f"{normalized_task_code} / {current_experiment_name} 已开始",
                **result,
            }


@router.post("/tasks/{task_code}/experiments/{experiment_code}/complete")
def complete_current_experiment(
    task_code: str,
    experiment_code: str,
    request: LaboratoryCompleteRequest = Body(default_factory=LaboratoryCompleteRequest),
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    initial_snapshot = read_snapshot()
    initial_tray_codes = request.tray_codes
    resource_keys = operation_resource_keys(
        lab_name=resolve_lab_name(initial_snapshot, normalized_task_code, normalized_experiment_code),
        tray_codes=initial_tray_codes,
    )
    resource_keys.append(f"experiment:{normalized_task_code}:{normalized_experiment_code}")
    with acquire_laboratory_operation_locks(resource_keys):
        with acquire_laboratory_storage_commit_lock():
            snapshot = read_snapshot()
            find_task(snapshot, normalized_task_code)
            current_experiment_name = experiment_name(snapshot, normalized_task_code, normalized_experiment_code)
            try:
                if normalize_text(request.axis_code):
                    result = complete_storage_laboratory_axis_step(
                        snapshot,
                        task_code=normalized_task_code,
                        experiment_code=normalized_experiment_code,
                        sub_experiment_code=request.sub_experiment_code,
                        run_no=request.run_no,
                        axis_code=request.axis_code,
                        next_axis_code=request.next_axis_code,
                        completed_at=request.completed_at,
                    )
                else:
                    result = complete_storage_laboratory_experiment(
                        snapshot,
                        task_code=normalized_task_code,
                        experiment_code=normalized_experiment_code,
                        sub_experiment_code=request.sub_experiment_code,
                        run_no=request.run_no,
                        tray_codes=request.tray_codes,
                        completed_at=request.completed_at,
                    )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            write_completion_snapshot(result)
            return {
                "ok": True,
                "message": f"{normalized_task_code} / {current_experiment_name} 已完成",
                **result,
            }


@router.post("/tasks/{task_code}/experiments/{experiment_code}/withdraw-current")
def withdraw_current_experiment(
    task_code: str,
    experiment_code: str,
    request: LaboratoryWithdrawRequest = Body(default_factory=LaboratoryWithdrawRequest),
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    initial_snapshot = read_snapshot()
    requested_tray_codes = {normalize_text(code) for code in request.tray_codes if normalize_text(code)}
    initial_experiment_tray_codes = set(experiment_tray_codes(initial_snapshot, normalized_task_code, normalized_experiment_code))
    initial_tray_codes = sorted(initial_experiment_tray_codes & requested_tray_codes) if requested_tray_codes else sorted(initial_experiment_tray_codes)
    resource_keys = operation_resource_keys(
        lab_name=resolve_lab_name(initial_snapshot, normalized_task_code, normalized_experiment_code),
        tray_codes=initial_tray_codes,
    )
    resource_keys.append(f"experiment:{normalized_task_code}:{normalized_experiment_code}")
    with acquire_laboratory_operation_locks(resource_keys):
        with acquire_laboratory_storage_commit_lock():
            snapshot = read_snapshot()
            find_task(snapshot, normalized_task_code)
            current_experiment_name = experiment_name(snapshot, normalized_task_code, normalized_experiment_code)
            current_lab_name = resolve_lab_name(snapshot, normalized_task_code, normalized_experiment_code)
            experiment_codes = set(experiment_tray_codes(snapshot, normalized_task_code, normalized_experiment_code))
            tray_codes = experiment_codes & requested_tray_codes if requested_tray_codes else experiment_codes
            scoped_sample_codes = experiment_sample_codes(snapshot, normalized_task_code, normalized_experiment_code)
            sample_matches = matching_samples(
                snapshot,
                normalized_task_code,
                tray_codes,
                scoped_sample_codes if scoped_sample_codes else None,
            )
            if not sample_matches:
                raise HTTPException(status_code=404, detail="当前实验未找到对应托盘样品")

            withdrawable_matches = withdrawable_sample_matches(
                sample_matches,
                current_experiment_name=current_experiment_name,
                experiment_code=normalized_experiment_code,
                lab_name=current_lab_name,
                task_code=normalized_task_code,
            )
            if not withdrawable_matches:
                raise HTTPException(status_code=400, detail="当前实验没有可撤回的已比对、已安装或已准备就绪托盘")

            now = now_business_text()
            affected_sample_count = 0
            affected_tray_codes: set[str] = set()
            restored_targets: list[dict[str, str]] = []
            compensated_tray_codes: set[str] = set()
            restore_lookup_snapshot = deepcopy(snapshot)
            restore_samples_by_code = {
                normalize_text(sample.get("code")): sample
                for sample in restore_lookup_snapshot["samples"]
                if normalize_text(sample.get("code"))
            }
            for sample, matched_tray_codes in withdrawable_matches:
                restore_sample = restore_samples_by_code.get(normalize_text(sample.get("code")), sample)
                restore_snapshot = resolve_restore_snapshot(
                    restore_sample,
                    restore_lookup_snapshot,
                    normalized_task_code,
                    current_experiment_name,
                    matched_tray_codes[0],
                )
                restored_targets.append(restore_snapshot)
                next_trays = []
                for tray in as_list(sample.get("trays")):
                    normalized_tray = dict(tray)
                    tray_code = normalize_text(normalized_tray.get("tray_code"))
                    if tray_code in matched_tray_codes:
                        normalized_tray["status"] = restore_snapshot["status"]
                        normalized_tray["updated_at"] = now
                        normalized_tray.pop("fixture_ready", None)
                        normalized_tray.pop("fixtureReady", None)
                    next_trays.append(normalized_tray)
                affected_tray_codes.update(matched_tray_codes)
                remaining_other_progress_tray = any(
                    normalize_text(tray.get("tray_code")) not in matched_tray_codes
                    and normalize_text(tray.get("status"))
                    and normalize_text(tray.get("status")) != restore_snapshot["status"]
                    for tray in next_trays
                )
                if not remaining_other_progress_tray:
                    sample["location"] = restore_snapshot["location"]
                    sample["status"] = restore_snapshot["status"]
                    sample["flow_status"] = restore_snapshot["status"]
                sample["updated_at"] = now
                sample["trays"] = next_trays
                detail_target = restore_snapshot["status"]
                if restore_snapshot.get("scope") == "partial_axis" and restore_snapshot.get("experimentName"):
                    detail_target = f"{restore_snapshot['experimentName']}部分完成"
                elif restore_snapshot.get("experimentName"):
                    detail_target = f"{restore_snapshot['experimentName']}已完成"
                detail = f"{normalized_task_code} / {current_experiment_name} / 撤回至{detail_target}"
                reason = normalize_text(request.reason)
                if reason:
                    detail = f"{detail}（{reason}）"
                append_history(sample, "实验任务撤回", detail, now)
                affected_sample_count += 1

                if restore_snapshot["scope"] in {"staging", "appearance"}:
                    for tray_code in matched_tray_codes:
                        if tray_code in compensated_tray_codes:
                            continue
                        restore_scope = normalize_text(restore_snapshot.get("scope"))
                        latest_event = latest_storage_event_for_tray(restore_lookup_snapshot, tray_code, restore_scope) or {}
                        compensation_event = {
                            "id": f"staging-event-{tray_code}-{len(snapshot['staging_events']) + 1}",
                            "tray_code": tray_code,
                            "task_code": normalized_task_code,
                            "action": "stock_out_withdraw",
                            "time": now,
                            "operator": reason or "实验任务撤回",
                            "target_lab": normalize_text(latest_event.get("target_lab")),
                            "target_experiment_code": normalize_text(latest_event.get("target_experiment_code")) or normalized_experiment_code,
                        }
                        if restore_scope == "appearance":
                            compensation_event["room"] = "appearance"
                        snapshot["staging_events"].append(compensation_event)
                        compensated_tray_codes.add(tray_code)

            write_snapshot(snapshot)
            first_target = restored_targets[0]
            return {
                "ok": True,
                "message": f"{normalized_task_code} / {current_experiment_name} 已撤回当前实验任务",
                "affectedSampleCount": affected_sample_count,
                "affectedTrayCodes": sorted(affected_tray_codes),
                "restoredStatus": first_target["status"],
                "restoredLocation": first_target["location"],
                "restoredExperimentName": first_target.get("experimentName") or "",
                "samples": snapshot["samples"],
                "stagingEvents": snapshot["staging_events"],
            }
