from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import logging
from threading import Lock
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.api.routes.storage import publish_storage_update
from app.core.axis_codes import canonical_axis_code, sort_axis_codes
from app.core.master_data import (
    LAB_INTERFACE_HOSTLESS,
    LAB_INTERFACE_OPERATION_EXPERIMENT_END,
    LAB_INTERFACE_OPERATION_EXPERIMENT_START,
    LAB_INTERFACE_OPERATION_FIXTURE_READY,
    require_laboratory_interface,
)
from app.core.storage_backend import get_storage_backend, normalize_storage_payload
from app.core.time_utils import now_business_text, parse_business_datetime
from app.services.attendance_service import get_attendance_service, should_finish_work_interval_for_completion
from app.services.laboratory_axis_steps import (
    AXIS_WAITING_START_STATUS,
    complete_storage_laboratory_axis_step,
    mark_storage_laboratory_axis_adjustment_ready,
    start_storage_laboratory_axis_step,
)
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
    write_laboratory_updates,
)
from app.services.laboratory_start import start_storage_laboratory_experiment
from app.services.schedule_cascade_runtime import apply_run_schedule_cascade, run_forecast_end_at
from app.services.test_data_reports import archive_completion_reports
from app.services.laboratory_withdrawal import (
    COMPLETED_EXPERIMENT_STATUSES,
    completed_axis_tray_codes,
    latest_appearance_origin_snapshot,
    latest_staging_origin_snapshot,
    latest_storage_event_for_tray,
    matching_samples,
    parse_experiment_history_detail,
    withdrawable_sample_matches,
)
from app.services.laboratory_snapshot_adapter import (
    SNAPSHOT_KEYS as LABORATORY_SNAPSHOT_KEYS,
    completion_updates,
    snapshot_from_storage_payload,
    start_updates,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/laboratory", tags=["laboratory"])
LABORATORY_WITHDRAW_LOCK = Lock()

HANDOVER_LOCATION = "接驳区"
LABORATORY_STORAGE_UPDATE_KEYS = ("mes.samples", "mes.staging_events")
LABORATORY_COMPLETION_STORAGE_UPDATE_KEYS = (
    "mes.samples",
    "mes.experiments",
    "mes.schedules",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_run_steps",
    "mes.staging_events",
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
    schedule_id: str = Field(default="", alias="scheduleId")
    sub_experiment_code: str = Field(default="", alias="subExperimentCode")
    axis_batch_no: int | str | None = Field(default=None, alias="axisBatchNo")

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


class LaboratoryAxisAdjustmentReadyRequest(BaseModel):
    run_no: str = Field(default="", alias="runNo")
    axis_code: str = Field(default="", alias="axisCode")
    lab_code: str = Field(default="", alias="labCode")
    lab_name: str = Field(default="", alias="labName")

    model_config = ConfigDict(populate_by_name=True)


class LaboratoryOperationRequest(BaseModel):
    operation_type: str = Field(default="", alias="operationType")
    task_code: str = Field(default="", alias="taskCode")
    experiment_code: str = Field(default="", alias="experimentCode")
    sub_experiment_code: str = Field(default="", alias="subExperimentCode")
    schedule_id: str = Field(default="", alias="scheduleId")
    lab_code: str = Field(default="", alias="labCode")
    lab_name: str = Field(default="", alias="labName")
    tray_codes: list[str] = Field(default_factory=list, alias="trayCodes")
    occurred_at: str = Field(default="", alias="occurredAt")
    operation_id: str = Field(default="", alias="operationId")

    model_config = ConfigDict(populate_by_name=True)


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def require_hostless_laboratory(*, operation: str = "", lab_code: str = "", lab_name: str = "") -> None:
    try:
        require_laboratory_interface(
            LAB_INTERFACE_HOSTLESS,
            operation=operation,
            lab_code=lab_code,
            lab_name=lab_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def require_hostless_completion_laboratory(*, lab_name: str = "") -> None:
    """Physical-interface guard kept separate from shared completion rules."""
    require_hostless_laboratory(operation=LAB_INTERFACE_OPERATION_EXPERIMENT_END, lab_name=lab_name)


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
    return sort_axis_codes(axis_codes)


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def parse_datetime_value(value: Any) -> datetime | None:
    return parse_business_datetime(value)


def read_snapshot(task_code: str = "") -> dict[str, list[dict[str, Any]]]:
    storage = get_storage_backend()
    storage_keys = tuple(LABORATORY_SNAPSHOT_KEYS.values())
    normalized_task_code = normalize_text(task_code)
    scope_reader = getattr(storage, "read_task_scope", None)
    read_many = getattr(storage, "read_many", None)
    if normalized_task_code and callable(scope_reader):
        raw_payload = scope_reader({normalized_task_code}, storage_keys)
    elif callable(read_many):
        raw_payload = read_many(storage_keys)
    else:
        raw_payload = storage.read_all()
    payload = normalize_storage_payload(raw_payload)
    return snapshot_from_storage_payload(payload)


def write_snapshot(snapshot: dict[str, list[dict[str, Any]]], task_code: str = "") -> None:
    write_laboratory_updates(
        get_storage_backend(),
        {
            "mes.samples": snapshot["samples"],
            "mes.staging_events": snapshot["staging_events"],
        },
        task_codes={task_code} if normalize_text(task_code) else None,
    )
    publish_storage_update(list(LABORATORY_STORAGE_UPDATE_KEYS))


def write_completion_snapshot(result: dict[str, Any], task_code: str = "") -> None:
    payload = completion_updates(result)
    write_laboratory_updates(
        get_storage_backend(),
        payload,
        task_codes={task_code} if normalize_text(task_code) else None,
    )
    publish_storage_update(list(LABORATORY_COMPLETION_STORAGE_UPDATE_KEYS))


def write_start_snapshot(
    original_snapshot: dict[str, list[dict[str, Any]]],
    result: dict[str, Any],
    task_code: str = "",
) -> None:
    payload = start_updates(
        original_snapshot,
        result,
        merged_samples=merge_scoped_samples(original_snapshot["samples"], result["samples"]),
    )
    write_laboratory_updates(
        get_storage_backend(),
        payload,
        scoped_samples=result["samples"],
        task_codes={task_code} if normalize_text(task_code) else None,
    )
    publish_storage_update(list(LABORATORY_START_STORAGE_UPDATE_KEYS))


def apply_result_schedule_cascade(
    result: dict[str, Any],
    *,
    run_no: str,
    new_end_at: str = "",
    reason: str,
) -> dict[str, Any]:
    normalized_run_no = normalize_text(run_no)
    run = next(
        (
            item
            for item in as_list(result.get("experimentRuns"))
            if normalize_text(item.get("run_no") or item.get("runNo") or item.get("id")) == normalized_run_no
        ),
        None,
    )
    if run is None:
        return {"changed": False, "skipped_reason": "run_not_found"}
    boundary = normalize_text(new_end_at) or run_forecast_end_at(run)
    try:
        cascade = apply_run_schedule_cascade(
            get_storage_backend(),
            run,
            new_end_at=boundary,
            reason=reason,
        )
    except Exception as exc:
        logger.exception("Failed to cascade schedules for run=%s", normalized_run_no)
        return {"changed": False, "error": str(exc)}
    if cascade.get("changed"):
        publish_storage_update(["mes.schedules", "mes.conflicts"])
    return cascade


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
    if normalize_text(request.operation_type) in {"fixtureReady", "fixture_ready"}:
        require_hostless_laboratory(
            operation=LAB_INTERFACE_OPERATION_FIXTURE_READY,
            lab_code=request.lab_code,
            lab_name=request.lab_name,
        )
    storage = get_storage_backend()
    occurred_at = now_business_text()
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
                schedule_id=request.schedule_id,
                lab_code=request.lab_code,
                lab_name=request.lab_name,
                tray_codes=request.tray_codes,
                occurred_at=occurred_at,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    result = run_atomic_laboratory_operation(
        operation=run_operation,
        publish_storage_update=publish_storage_update,
        resource_keys=resource_keys,
        storage=storage,
        task_code=request.task_code,
    )
    try:
        get_attendance_service().record_laboratory_workflow_operation(
            operation_type=request.operation_type,
            lab_name=request.lab_name,
            lab_code=request.lab_code,
            task_code=request.task_code,
            experiment_code=request.experiment_code,
            tray_codes=result.get("affectedTrayCodes") or request.tray_codes,
            source="api",
            operated_at=occurred_at,
        )
    except Exception:
        logger.exception(
            "Failed to record laboratory workflow attendance operation task=%s experiment=%s operation=%s",
            request.task_code,
            request.experiment_code,
            request.operation_type,
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
    return sort_axis_codes(axis_codes)


def latest_previous_partial_axis_completion(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    tray_code: str,
    exclude_experiment_code: str = "",
) -> dict[str, Any] | None:
    normalized_tray_code = normalize_text(tray_code)
    normalized_excluded_experiment_code = normalize_text(exclude_experiment_code)
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
        if normalized_excluded_experiment_code and experiment_code == normalized_excluded_experiment_code:
            continue
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
            axis_code = canonical_axis_code(step.get("axis_code") or step.get("axisCode"))
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

        remaining_axes = set(required_axes) - completed_axes
        remaining_schedules = [
            schedule
            for schedule in snapshot["schedules"]
            if normalize_text(schedule.get("task_code") or schedule.get("task_no")) == task_code
            and normalize_text(schedule.get("experiment_code") or schedule.get("experiment_no")) == experiment_code
        ]
        remaining_schedules.sort(
            key=lambda schedule: normalize_text(schedule.get("start_at") or schedule.get("startAt") or schedule.get("start_time"))
        )
        target_location = ""
        for schedule in remaining_schedules:
            schedule_id = normalize_text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("scheduleId"))
            if schedule_id and schedule_id in completed_schedule_ids:
                continue
            schedule_axes = set(normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes")))
            if remaining_axes and not schedule_axes:
                continue
            if schedule_axes and not schedule_axes.intersection(remaining_axes):
                continue
            target_location = normalize_text(schedule.get("device") or schedule.get("lab") or schedule.get("lab_name"))
            if target_location:
                break

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
        if not location:
            expected_partial_status = f"{experiment_name}部分完成"
            history_locations: list[tuple[datetime, str]] = []
            for sample in related_samples_for_tray(snapshot, task_code, normalized_tray_code):
                for entry in as_list(sample.get("history")):
                    entry_location = normalize_text(entry.get("location"))
                    if not entry_location:
                        continue
                    entry_tray_code = normalize_text(entry.get("tray_code") or entry.get("trayCode") or entry.get("tray_no"))
                    if entry_tray_code and entry_tray_code != normalized_tray_code:
                        continue
                    entry_status = normalize_text(entry.get("status"))
                    entry_detail = normalize_text(entry.get("detail"))
                    if expected_partial_status not in entry_status and expected_partial_status not in entry_detail:
                        continue
                    entry_time = parse_datetime_value(entry.get("time") or entry.get("created_at") or entry.get("createdAt"))
                    history_locations.append((entry_time or datetime.min, entry_location))
            if history_locations:
                history_locations.sort(key=lambda item: item[0])
                location = history_locations[-1][1]

        candidates.append(
            {
                "status": f"{experiment_name}部分完成 {len(completed_axes)}/{len(required_axes)}轴",
                "location": location,
                "targetLab": target_location or location,
                "experimentCode": experiment_code,
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
    candidates = [candidate for candidate in [completed, staging, appearance] if candidate]
    if partial_axis:
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


@router.post("/tasks/{task_code}/experiments/{experiment_code}/axis-adjustment-ready")
def confirm_axis_adjustment_ready(
    task_code: str,
    experiment_code: str,
    request: LaboratoryAxisAdjustmentReadyRequest,
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    snapshot = read_snapshot(normalized_task_code)
    lab_name = resolve_lab_name(snapshot, normalized_task_code, normalized_experiment_code) or request.lab_name
    require_hostless_laboratory(
        operation=LAB_INTERFACE_OPERATION_EXPERIMENT_START,
        lab_code=request.lab_code,
        lab_name=lab_name,
    )
    resource_keys = operation_resource_keys(lab_code=request.lab_code, lab_name=lab_name)
    resource_keys.append(f"experiment:{normalized_task_code}:{normalized_experiment_code}")
    with acquire_laboratory_operation_locks(resource_keys):
        with acquire_laboratory_storage_commit_lock():
            snapshot = read_snapshot(normalized_task_code)
            scoped_axis_step = next(
                (
                    step
                    for step in snapshot.get("experiment_run_steps", [])
                    if normalize_text(step.get("run_no") or step.get("runNo")) == normalize_text(request.run_no)
                    and canonical_axis_code(step.get("axis_code") or step.get("axisCode")) == canonical_axis_code(request.axis_code)
                    and normalize_text(step.get("task_code") or step.get("task_no")) == normalized_task_code
                    and normalize_text(step.get("experiment_code") or step.get("experiment_no")) == normalized_experiment_code
                ),
                None,
            )
            if not scoped_axis_step:
                raise HTTPException(status_code=409, detail="当前任务和实验不存在对应的轴向调整步骤")
            try:
                result = mark_storage_laboratory_axis_adjustment_ready(
                    snapshot,
                    run_no=request.run_no,
                    axis_code=request.axis_code,
                    occurred_at=now_business_text(),
                )
            except ValueError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            write_laboratory_updates(
                get_storage_backend(),
                {"mes.experiment_run_steps": result["experimentRunSteps"]},
                task_codes={normalized_task_code},
            )
            publish_storage_update(["mes.experiment_run_steps"])
    return {"ok": True, **result}


@router.post("/tasks/{task_code}/experiments/{experiment_code}/start")
def start_current_experiment(
    task_code: str,
    experiment_code: str,
    request: LaboratoryStartRequest = Body(default_factory=LaboratoryStartRequest),
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    started_at = now_business_text()
    initial_snapshot = read_snapshot(normalized_task_code)
    initial_lab_name = start_lab_name(
        initial_snapshot,
        normalized_task_code,
        normalized_experiment_code,
        request.schedule_id,
        request.lab_name,
    )
    require_hostless_laboratory(
        operation=LAB_INTERFACE_OPERATION_EXPERIMENT_START,
        lab_code=request.lab_code,
        lab_name=initial_lab_name,
    )
    resource_keys = operation_resource_keys(
        lab_code=request.lab_code,
        lab_name=initial_lab_name,
        tray_codes=request.tray_codes,
    )
    resource_keys.append(f"experiment:{normalized_task_code}:{normalized_experiment_code}")
    with acquire_laboratory_operation_locks(resource_keys):
        with acquire_laboratory_storage_commit_lock():
            snapshot = read_snapshot(normalized_task_code)
            find_task(snapshot, normalized_task_code)
            current_experiment_name = experiment_name(snapshot, normalized_task_code, normalized_experiment_code)
            requested_axis_code = canonical_axis_code(request.current_axis_code)
            prepared_axis_step = next(
                (
                    step
                    for step in snapshot.get("experiment_run_steps", [])
                    if normalize_text(step.get("run_no") or step.get("runNo")) == normalize_text(request.run_no)
                    and canonical_axis_code(step.get("axis_code") or step.get("axisCode")) == requested_axis_code
                    and normalize_text(step.get("task_code") or step.get("task_no")) == normalized_task_code
                    and normalize_text(step.get("experiment_code") or step.get("experiment_no")) == normalized_experiment_code
                    and normalize_text(step.get("status")) == AXIS_WAITING_START_STATUS
                ),
                None,
            )
            if prepared_axis_step:
                try:
                    result = start_storage_laboratory_axis_step(
                        snapshot,
                        run_no=request.run_no,
                        axis_code=requested_axis_code,
                        started_at=started_at,
                    )
                except ValueError as exc:
                    raise HTTPException(status_code=409, detail=str(exc)) from exc
                write_laboratory_updates(
                    get_storage_backend(),
                    {"mes.experiment_run_steps": result["experimentRunSteps"]},
                    task_codes={normalized_task_code},
                )
                publish_storage_update(["mes.experiment_run_steps"])
                return {
                    "ok": True,
                    "message": f"{normalized_task_code} / {current_experiment_name} / {requested_axis_code}轴向 已开始",
                    "startedAt": result["occurredAt"],
                    **result,
                }
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
                    started_at=started_at,
                    planned_hours=request.planned_hours,
                    planned_end_at=request.planned_end_at,
                    axis_codes=request.axis_codes,
                    axis_batch_no=request.axis_batch_no,
                    current_axis_code=request.current_axis_code,
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            write_start_snapshot(snapshot, result, normalized_task_code)
            schedule_cascade = apply_result_schedule_cascade(
                result,
                run_no=request.run_no,
                reason="实验实际开始时间变化",
            )
            attendance_service = get_attendance_service()
            attendance_service.start_work_interval(
                lab_code=request.lab_code,
                lab_name=lab_name,
                run_no=request.run_no,
                task_code=normalized_task_code,
                experiment_code=normalized_experiment_code,
                source="api",
                started_at=result.get("startedAt") or started_at,
            )
            return {
                "attendanceSession": attendance_service.read_lab_session(lab_name),
                "ok": True,
                "message": f"{normalized_task_code} / {current_experiment_name} 已开始",
                "scheduleCascade": schedule_cascade,
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
    completed_at = now_business_text()
    initial_snapshot = read_snapshot(normalized_task_code)
    initial_tray_codes = request.tray_codes
    initial_lab_name = resolve_lab_name(initial_snapshot, normalized_task_code, normalized_experiment_code)
    require_hostless_completion_laboratory(lab_name=initial_lab_name)
    resource_keys = operation_resource_keys(
        lab_name=initial_lab_name,
        tray_codes=initial_tray_codes,
    )
    resource_keys.append(f"experiment:{normalized_task_code}:{normalized_experiment_code}")
    with acquire_laboratory_operation_locks(resource_keys):
        with acquire_laboratory_storage_commit_lock():
            snapshot = read_snapshot(normalized_task_code)
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
                        completed_at=completed_at,
                    )
                else:
                    result = complete_storage_laboratory_experiment(
                        snapshot,
                        task_code=normalized_task_code,
                        experiment_code=normalized_experiment_code,
                        sub_experiment_code=request.sub_experiment_code,
                        run_no=request.run_no,
                        tray_codes=request.tray_codes,
                        completed_at=completed_at,
                    )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            write_completion_snapshot(result, normalized_task_code)
            schedule_cascade = apply_result_schedule_cascade(
                result,
                run_no=request.run_no,
                new_end_at=completed_at,
                reason="实验实际结束时间变化",
            )
            if should_finish_work_interval_for_completion(axis_code=request.axis_code, next_axis_code=request.next_axis_code):
                get_attendance_service().finish_work_interval(
                    run_no=request.run_no,
                    lab_name=resolve_lab_name(snapshot, normalized_task_code, normalized_experiment_code),
                    ended_at=completed_at,
                )
        try:
            report_archive = archive_completion_reports(
                snapshot=snapshot,
                result=result,
                task_code=normalized_task_code,
                experiment_code=normalized_experiment_code,
                run_no=request.run_no,
                axis_code=request.axis_code,
                completed_at=completed_at,
            )
        except Exception as exc:  # Physical completion must remain committed if report IO fails.
            logger.exception(
                "Failed to archive completion reports for task=%s experiment=%s run=%s axis=%s",
                normalized_task_code,
                normalized_experiment_code,
                request.run_no,
                request.axis_code,
            )
            report_archive = {
                "ok": False,
                "attempted": 0,
                "succeeded": 0,
                "skipped": 0,
                "failed": 1,
                "items": [],
                "error": str(exc),
            }
        return {
            "ok": True,
            "message": f"{normalized_task_code} / {current_experiment_name} 已完成",
            "scheduleCascade": schedule_cascade,
            **result,
            "reportArchive": report_archive,
        }


@router.post("/tasks/{task_code}/experiments/{experiment_code}/withdraw-current")
def withdraw_current_experiment(
    task_code: str,
    experiment_code: str,
    request: LaboratoryWithdrawRequest = Body(default_factory=LaboratoryWithdrawRequest),
) -> dict[str, Any]:
    with LABORATORY_WITHDRAW_LOCK:
        return _withdraw_current_experiment(task_code, experiment_code, request)


def _withdraw_current_experiment(
    task_code: str,
    experiment_code: str,
    request: LaboratoryWithdrawRequest,
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    initial_snapshot = read_snapshot(normalized_task_code)
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
            snapshot = read_snapshot(normalized_task_code)
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

            progressed_tray_codes = completed_axis_tray_codes(
                snapshot,
                sample_matches,
                task_code=normalized_task_code,
                experiment_code=normalized_experiment_code,
                experiment_name=current_experiment_name,
                schedule_id=request.schedule_id,
                sub_experiment_code=request.sub_experiment_code,
                axis_batch_no=request.axis_batch_no,
            )
            if progressed_tray_codes:
                joined_tray_codes = "、".join(progressed_tray_codes)
                raise HTTPException(
                    status_code=409,
                    detail=f"托盘 {joined_tray_codes} 当前实验已有完成轴向，不允许撤回实验任务；请保持当前实验进度",
                )

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
                        if restore_snapshot.get("scope") == "partial_axis":
                            restore_experiment_code = normalize_text(restore_snapshot.get("experimentCode"))
                            restore_target_lab = normalize_text(restore_snapshot.get("targetLab") or restore_snapshot.get("location"))
                            if restore_experiment_code:
                                normalized_tray["target_experiment_code"] = restore_experiment_code
                                normalized_tray.pop("targetExperimentCode", None)
                            if restore_target_lab:
                                normalized_tray["target_lab"] = restore_target_lab
                                normalized_tray.pop("targetLab", None)
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

            write_snapshot(snapshot, normalized_task_code)
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
