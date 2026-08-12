from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Dict, Iterable

from app.core.axis_codes import sort_axis_codes
from app.core.storage_backend import (
    normalize_experiment_detail_text,
    normalize_experiment_status_text,
    normalize_task_status_text,
)
from app.core.mysql_storage_status import EXPERIMENT_COMPLETED_STATUSES
from app.core.mysql_storage_codecs import (
    RETENTION_KEYWORD,
    STORAGE_MARKER,
    current_beijing_datetime,
    decode_sample_meta,
    encode_sample_meta,
    derive_task_code_from_sample_code,
    format_display_storage_datetime,
    format_date_value,
    format_iso_storage_datetime,
    format_priority_value,
    format_quality_value,
    normalize_text,
    parse_bool_flag,
    parse_date_value,
    parse_fixture_ready_flag,
    parse_float_value,
    parse_int_value,
    parse_priority_value,
    parse_storage_datetime,
)

APPEARANCE_INSPECTION_LOCATION = "外观检测间"
PRE_EXPERIMENT_APPEARANCE_STATUS = "实验前外观检测间存放"
SCHEDULE_DELAY_REMARK_PREFIX = "MES_SCHEDULE_DELAY_V1:"
SCHEDULE_DELAY_REASON_MAX_LENGTH = 120
SCHEDULE_DELAY_SOURCE_RUN_MAX_LENGTH = 80
SCHEDULE_DELAY_USER_REMARK_MAX_LENGTH = 160
SCHEDULE_DELAY_FIELDS = (
    "original_start_at",
    "original_end_at",
    "delay_minutes",
    "delay_reason",
    "source_run_no",
)


def _normalize_axis_codes(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        text = value.strip()
        if text.startswith("["):
            try:
                decoded = json.loads(text)
            except (TypeError, ValueError, json.JSONDecodeError):
                decoded = []
            raw_values = decoded if isinstance(decoded, list) else []
        else:
            raw_values = text.replace("，", ",").split(",")
    else:
        raw_values = []
    result: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        normalized = normalize_text(item)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return sort_axis_codes(result)


def _axis_codes_json(value: Any) -> str | None:
    axis_codes = _normalize_axis_codes(value)
    return json.dumps(axis_codes, ensure_ascii=False) if axis_codes else None


def _sub_experiment_code(value: Dict[str, Any]) -> str:
    return normalize_text(
        value.get("sub_experiment_code")
        or value.get("subExperimentCode")
        or value.get("sub_experiment_no")
        or value.get("subExperimentNo")
    )


def build_task_insert_row(task: Dict[str, Any]) -> Dict[str, Any]:
    now_beijing = current_beijing_datetime()
    return {
        "task_no": normalize_text(task.get("code")),
        "task_source_type": normalize_text(task.get("source")),
        "source_system": STORAGE_MARKER,
        "task_name": normalize_text(task.get("name")),
        "client_name": normalize_text(task.get("client")),
        "contact_name": normalize_text(task.get("contact")),
        "contact_phone": normalize_text(task.get("contact_info")),
        "task_type": normalize_text(task.get("test_type")),
        "sample_type": normalize_text(task.get("sample_type")),
        "priority": parse_priority_value(task.get("priority")),
        "sample_count": parse_int_value(task.get("sample_count")),
        "task_status": normalize_task_status_text(task.get("status")),
        "transfer_status": normalize_task_status_text(task.get("transfer_status")),
        "tray_limit": parse_int_value(task.get("tray_limit")),
        "arrival_time": parse_storage_datetime(task.get("arrival_at")),
        "due_time": parse_storage_datetime(task.get("due_at")),
        "required_device": normalize_text(task.get("required_device")),
        "conditions_text": normalize_text(task.get("conditions")),
        "attachment_path": normalize_text(task.get("attachment")),
        "remark": normalize_text(task.get("remark")),
        "created_at": parse_storage_datetime(task.get("created_at")) or now_beijing,
        "updated_at": parse_storage_datetime(task.get("updated_at")) or now_beijing,
    }


def build_storage_task_tray_codes(rows: Iterable[Dict[str, Any]]) -> Dict[str, list[str]]:
    tray_map: Dict[str, list[str]] = {}
    for row in rows:
        task_no = normalize_text(row.get("task_no"))
        tray_no = normalize_text(row.get("tray_no"))
        if not task_no or not tray_no:
            continue
        tray_map.setdefault(task_no, [])
        if tray_no not in tray_map[task_no]:
            tray_map[task_no].append(tray_no)
    for key in tray_map:
        tray_map[key].sort()
    return tray_map


def build_storage_task_item(row: Dict[str, Any], tray_codes: Iterable[str] | None = None) -> Dict[str, Any]:
    return {
        "id": normalize_text(row.get("task_no")),
        "code": normalize_text(row.get("task_no")),
        "name": normalize_text(row.get("task_name")),
        "source": normalize_text(row.get("task_source_type")),
        "client": normalize_text(row.get("client_name")),
        "contact": normalize_text(row.get("contact_name")),
        "contact_info": normalize_text(row.get("contact_phone")),
        "priority": format_priority_value(row.get("priority")),
        "sample_count": "" if row.get("sample_count") is None else str(row.get("sample_count")),
        "sample_type": normalize_text(row.get("sample_type")),
        "test_type": normalize_text(row.get("task_type")),
        "required_device": normalize_text(row.get("required_device")),
        "due_at": format_display_storage_datetime(row.get("due_time")),
        "arrival_at": format_display_storage_datetime(row.get("arrival_time")),
        "conditions": normalize_text(row.get("conditions_text")),
        "attachment": normalize_text(row.get("attachment_path")),
        "remark": normalize_text(row.get("remark")),
        "status": normalize_task_status_text(row.get("task_status")),
        "transfer_status": normalize_task_status_text(row.get("transfer_status")),
        "tray_limit": row.get("tray_limit"),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "tray_codes": [normalize_text(code) for code in (tray_codes or []) if normalize_text(code)],
    }


def normalize_experiment_status(value: Any) -> str:
    return normalize_experiment_status_text(value)


def build_experiment_insert_row(experiment: Dict[str, Any]) -> Dict[str, Any]:
    now_beijing = current_beijing_datetime()
    return {
        "experiment_no": normalize_text(experiment.get("experiment_code")),
        "task_no": normalize_text(experiment.get("task_code")),
        "experiment_name": normalize_text(experiment.get("experiment_name")),
        "required_device": normalize_text(experiment.get("required_device")),
        "priority": parse_priority_value(experiment.get("priority")),
        "planned_hours": parse_float_value(experiment.get("planned_hours")),
        "experiment_status": normalize_experiment_status(experiment.get("status")),
        "axis_codes_json": _axis_codes_json(experiment.get("axis_codes") or experiment.get("axisCodes")),
        "unscheduled_since": parse_storage_datetime(experiment.get("unscheduled_since")),
        "created_at": parse_storage_datetime(experiment.get("created_at")) or now_beijing,
        "updated_at": parse_storage_datetime(experiment.get("updated_at")) or now_beijing,
    }


def build_storage_experiment_item(row: Dict[str, Any]) -> Dict[str, Any]:
    planned_hours = row.get("planned_hours")
    item = {
        "id": normalize_text(row.get("experiment_no")),
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "experiment_name": normalize_text(row.get("experiment_name")),
        "required_device": normalize_text(row.get("required_device")),
        "priority": format_priority_value(row.get("priority")),
        "planned_hours": 0 if planned_hours in (None, "") else float(planned_hours),
        "status": normalize_experiment_status(row.get("experiment_status")),
        "unscheduled_since": format_iso_storage_datetime(row.get("unscheduled_since")),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
    }
    axis_codes = _normalize_axis_codes(row.get("axis_codes_json") or row.get("axis_codes") or row.get("axisCodes"))
    if axis_codes:
        item["axis_codes"] = axis_codes
    return item


def build_experiment_tray_insert_row(relation: Dict[str, Any]) -> Dict[str, Any]:
    now_beijing = current_beijing_datetime()
    return {
        "experiment_no": normalize_text(relation.get("experiment_code")),
        "task_no": normalize_text(relation.get("task_code")),
        "tray_no": normalize_text(relation.get("tray_code")),
        "created_at": parse_storage_datetime(relation.get("created_at")) or now_beijing,
        "updated_at": parse_storage_datetime(relation.get("updated_at")) or now_beijing,
    }


def build_storage_experiment_tray_item(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": normalize_text(row.get("relation_id")) or (
            f"{normalize_text(row.get('experiment_no'))}:{normalize_text(row.get('tray_no'))}"
        ),
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "tray_code": normalize_text(row.get("tray_no")),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
    }


def build_experiment_sample_insert_row(relation: Dict[str, Any]) -> Dict[str, Any]:
    now_beijing = current_beijing_datetime()
    return {
        "experiment_no": normalize_text(relation.get("experiment_code")),
        "task_no": normalize_text(relation.get("task_code")),
        "sample_no": normalize_text(relation.get("sample_code")),
        "created_at": parse_storage_datetime(relation.get("created_at")) or now_beijing,
        "updated_at": parse_storage_datetime(relation.get("updated_at")) or now_beijing,
    }


def build_storage_experiment_sample_item(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": normalize_text(row.get("relation_id")) or (
            f"{normalize_text(row.get('experiment_no'))}:{normalize_text(row.get('sample_no'))}"
        ),
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "sample_code": normalize_text(row.get("sample_no")),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
    }


def build_experiment_run_insert_row(run: Dict[str, Any]) -> Dict[str, Any]:
    now_beijing = current_beijing_datetime()
    run_no = normalize_text(run.get("run_no")) or normalize_text(run.get("id"))
    return {
        "run_no": run_no,
        "schedule_no": normalize_text(run.get("schedule_id")) or normalize_text(run.get("schedule_no")),
        "task_no": normalize_text(run.get("task_code")),
        "experiment_no": normalize_text(run.get("experiment_code")),
        "sub_experiment_code": _sub_experiment_code(run),
        "device_name": normalize_text(run.get("device")),
        "axis_codes_json": _axis_codes_json(run.get("axis_codes") or run.get("axisCodes")),
        "axis_batch_no": normalize_text(run.get("axis_batch_no") or run.get("axisBatchNo")),
        "planned_hours": parse_float_value(run.get("planned_hours")),
        "run_status": normalize_experiment_status(run.get("status")),
        "started_at": parse_storage_datetime(run.get("started_at")),
        "planned_end_at": parse_storage_datetime(run.get("planned_end_at")),
        "ended_at": parse_storage_datetime(run.get("ended_at")),
        "created_at": parse_storage_datetime(run.get("created_at")) or now_beijing,
        "updated_at": parse_storage_datetime(run.get("updated_at")) or now_beijing,
    }


def build_storage_experiment_run_item(row: Dict[str, Any], tray_codes: list[str] | None = None) -> Dict[str, Any]:
    run_no = normalize_text(row.get("run_no"))
    planned_hours = row.get("planned_hours")
    item = {
        "id": run_no,
        "run_no": run_no,
        "schedule_id": normalize_text(row.get("schedule_no")),
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "device": normalize_text(row.get("device_name")),
        "planned_hours": 0 if planned_hours in (None, "") else float(planned_hours),
        "status": normalize_experiment_status(row.get("run_status")),
        "started_at": format_iso_storage_datetime(row.get("started_at")),
        "planned_end_at": format_iso_storage_datetime(row.get("planned_end_at")),
        "ended_at": format_iso_storage_datetime(row.get("ended_at")),
        "tray_codes": list(tray_codes or []),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
    }
    sub_experiment_code = _sub_experiment_code(row)
    axis_codes = _normalize_axis_codes(row.get("axis_codes_json") or row.get("axis_codes") or row.get("axisCodes"))
    axis_batch_no = normalize_text(row.get("axis_batch_no") or row.get("axisBatchNo"))
    if sub_experiment_code:
        item["sub_experiment_code"] = sub_experiment_code
    if axis_codes:
        item["axis_codes"] = axis_codes
    if axis_batch_no:
        item["axis_batch_no"] = axis_batch_no
    return item


def build_experiment_run_step_insert_row(step: Dict[str, Any]) -> Dict[str, Any]:
    now_beijing = current_beijing_datetime()
    run_no = normalize_text(step.get("run_no") or step.get("runNo"))
    axis_code = normalize_text(step.get("axis_code") or step.get("axisCode"))
    return {
        "run_no": run_no,
        "task_no": normalize_text(step.get("task_code") or step.get("task_no") or step.get("taskCode") or step.get("taskNo")),
        "experiment_no": normalize_text(
            step.get("experiment_code")
            or step.get("experiment_no")
            or step.get("experimentCode")
            or step.get("experimentNo")
        ),
        "sub_experiment_code": _sub_experiment_code(step),
        "axis_code": axis_code,
        "step_no": parse_int_value(step.get("step_no") or step.get("stepNo")),
        "step_status": normalize_experiment_status(step.get("status") or step.get("step_status") or step.get("stepStatus")),
        "started_at": parse_storage_datetime(step.get("started_at") or step.get("startedAt")),
        "ended_at": parse_storage_datetime(step.get("ended_at") or step.get("endedAt")),
        "created_at": parse_storage_datetime(step.get("created_at") or step.get("createdAt")) or now_beijing,
        "updated_at": parse_storage_datetime(step.get("updated_at") or step.get("updatedAt")) or now_beijing,
    }


def build_storage_experiment_run_step_item(row: Dict[str, Any]) -> Dict[str, Any]:
    step_id = normalize_text(row.get("step_id"))
    run_no = normalize_text(row.get("run_no"))
    axis_code = normalize_text(row.get("axis_code"))
    step_no = parse_int_value(row.get("step_no"))
    item = {
        "id": step_id or f"{run_no}:{step_no}:{axis_code}",
        "run_no": run_no,
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "axis_code": axis_code,
        "step_no": step_no,
        "status": normalize_experiment_status(row.get("step_status") or row.get("status")),
        "started_at": format_iso_storage_datetime(row.get("started_at")),
        "ended_at": format_iso_storage_datetime(row.get("ended_at")),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
    }
    sub_experiment_code = _sub_experiment_code(row)
    if sub_experiment_code:
        item["sub_experiment_code"] = sub_experiment_code
    return item


def build_storage_experiment_run_tray_item(row: Dict[str, Any]) -> Dict[str, Any]:
    relation_id = normalize_text(row.get("relation_id"))
    run_no = normalize_text(row.get("run_no"))
    tray_no = normalize_text(row.get("tray_no"))
    item = {
        "id": relation_id or f"{run_no}:{tray_no}",
        "run_no": run_no,
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "tray_code": tray_no,
        "status": normalize_experiment_status(row.get("run_tray_status") or row.get("status")),
        "run_tray_status": normalize_experiment_status(row.get("run_tray_status") or row.get("status")),
        "started_at": format_iso_storage_datetime(row.get("started_at")),
        "ended_at": format_iso_storage_datetime(row.get("ended_at")),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
    }
    sub_experiment_code = _sub_experiment_code(row)
    if sub_experiment_code:
        item["sub_experiment_code"] = sub_experiment_code
    return item


def build_experiment_run_tray_insert_row(relation: Dict[str, Any]) -> Dict[str, Any]:
    now_beijing = current_beijing_datetime()
    return {
        "run_no": normalize_text(relation.get("run_no")) or normalize_text(relation.get("runNo")),
        "task_no": normalize_text(relation.get("task_code") or relation.get("task_no")),
        "experiment_no": normalize_text(relation.get("experiment_code") or relation.get("experiment_no")),
        "sub_experiment_code": _sub_experiment_code(relation),
        "tray_no": normalize_text(relation.get("tray_code") or relation.get("tray_no")),
        "run_tray_status": normalize_experiment_status(relation.get("run_tray_status") or relation.get("runTrayStatus") or relation.get("status")),
        "started_at": parse_storage_datetime(relation.get("started_at")),
        "ended_at": parse_storage_datetime(relation.get("ended_at")),
        "created_at": parse_storage_datetime(relation.get("created_at")) or now_beijing,
        "updated_at": parse_storage_datetime(relation.get("updated_at")) or now_beijing,
    }


def build_experiment_run_tray_insert_rows(run: Dict[str, Any]) -> list[Dict[str, Any]]:
    return []


def _decode_schedule_delay_remark(value: Any) -> tuple[str, dict[str, Any]]:
    text = normalize_text(value)
    if not text.startswith(SCHEDULE_DELAY_REMARK_PREFIX):
        return text, {}
    try:
        payload = json.loads(text[len(SCHEDULE_DELAY_REMARK_PREFIX) :])
    except (TypeError, ValueError, json.JSONDecodeError):
        return text, {}
    if not isinstance(payload, dict):
        return text, {}
    user_remark = normalize_text(payload.get("user_remark"))[:SCHEDULE_DELAY_USER_REMARK_MAX_LENGTH]
    metadata = {
        "original_start_at": normalize_text(payload.get("original_start_at")),
        "original_end_at": normalize_text(payload.get("original_end_at")),
        "delay_minutes": parse_int_value(payload.get("delay_minutes")),
        "delay_reason": normalize_text(payload.get("reason"))[:SCHEDULE_DELAY_REASON_MAX_LENGTH],
        "source_run_no": normalize_text(payload.get("source_run_no"))[:SCHEDULE_DELAY_SOURCE_RUN_MAX_LENGTH],
    }
    return user_remark, metadata


def _encode_schedule_delay_remark(schedule: Dict[str, Any]) -> str:
    user_remark, existing_metadata = _decode_schedule_delay_remark(schedule.get("remark"))
    metadata = {
        field: schedule.get(field) if schedule.get(field) not in (None, "") else existing_metadata.get(field)
        for field in SCHEDULE_DELAY_FIELDS
    }
    original_start_at = format_iso_storage_datetime(metadata.get("original_start_at"))
    original_end_at = format_iso_storage_datetime(metadata.get("original_end_at"))
    if not original_start_at or not original_end_at:
        return user_remark
    payload: dict[str, Any] = {
        "original_start_at": original_start_at,
        "original_end_at": original_end_at,
        "delay_minutes": parse_int_value(metadata.get("delay_minutes")),
        "reason": normalize_text(metadata.get("delay_reason"))[:SCHEDULE_DELAY_REASON_MAX_LENGTH],
        "source_run_no": normalize_text(metadata.get("source_run_no"))[:SCHEDULE_DELAY_SOURCE_RUN_MAX_LENGTH],
    }
    if user_remark:
        payload["user_remark"] = user_remark[:SCHEDULE_DELAY_USER_REMARK_MAX_LENGTH]
    return SCHEDULE_DELAY_REMARK_PREFIX + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def build_schedule_insert_row(schedule: Dict[str, Any]) -> Dict[str, Any]:
    device = normalize_text(
        schedule.get("device")
        or schedule.get("device_name")
        or schedule.get("deviceName")
        or schedule.get("target_lab")
        or schedule.get("targetLab")
    )
    return {
        "schedule_no": normalize_text(schedule.get("id")),
        "task_no": normalize_text(schedule.get("task_code")),
        "experiment_no": normalize_text(schedule.get("experiment_code")),
        "sub_experiment_code": _sub_experiment_code(schedule),
        "schedule_type": STORAGE_MARKER,
        "lab_id": parse_int_value(schedule.get("lab_id") or schedule.get("labId")),
        "lab_code": normalize_text(schedule.get("lab_code") or schedule.get("labCode")),
        "device_name": device,
        "axis_codes_json": _axis_codes_json(schedule.get("axis_codes") or schedule.get("axisCodes")),
        "axis_batch_no": normalize_text(schedule.get("axis_batch_no") or schedule.get("axisBatchNo")),
        "schedule_start_time": parse_storage_datetime(schedule.get("start_at")),
        "schedule_end_time": parse_storage_datetime(schedule.get("end_at")),
        "planned_hours": parse_float_value(schedule.get("planned_hours")),
        "schedule_status": normalize_experiment_status_text(schedule.get("status")),
        "is_retention": 1 if RETENTION_KEYWORD in device else 0,
        "remark": _encode_schedule_delay_remark(schedule),
    }


def build_storage_schedule_item(row: Dict[str, Any]) -> Dict[str, Any]:
    planned_hours = row.get("planned_hours")
    lab_id = parse_int_value(row.get("lab_id"))
    item = {
        "id": normalize_text(row.get("schedule_no")),
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "lab_id": lab_id,
        "lab_code": normalize_text(row.get("lab_code")),
        "device": normalize_text(row.get("device_name")),
        "start_at": format_iso_storage_datetime(row.get("schedule_start_time")),
        "end_at": format_iso_storage_datetime(row.get("schedule_end_time")),
        "planned_hours": 0 if planned_hours in (None, "") else float(planned_hours),
        "status": normalize_experiment_status_text(row.get("schedule_status")),
    }
    sub_experiment_code = _sub_experiment_code(row)
    axis_codes = _normalize_axis_codes(row.get("axis_codes_json") or row.get("axis_codes") or row.get("axisCodes"))
    axis_batch_no = normalize_text(row.get("axis_batch_no") or row.get("axisBatchNo"))
    if sub_experiment_code:
        item["sub_experiment_code"] = sub_experiment_code
    if axis_codes:
        item["axis_codes"] = axis_codes
    if axis_batch_no:
        item["axis_batch_no"] = axis_batch_no
    user_remark, delay_metadata = _decode_schedule_delay_remark(row.get("remark"))
    if user_remark:
        item["remark"] = user_remark
    if delay_metadata.get("original_start_at") and delay_metadata.get("original_end_at"):
        item.update(delay_metadata)
    return item


def build_device_insert_row(device: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "equipment_code": normalize_text(device.get("code")),
        "equipment_name": normalize_text(device.get("name")),
        "equipment_type": normalize_text(device.get("type")),
        "model_no": normalize_text(device.get("model")),
        "manufacturer": STORAGE_MARKER,
        "status": normalize_text(device.get("status")),
        "maintenance_start_at": parse_storage_datetime(device.get("maintenance_start_at") or device.get("maintenanceStartAt")),
        "maintenance_end_at": parse_storage_datetime(device.get("maintenance_end_at") or device.get("maintenanceEndAt")),
        "maintenance_type": normalize_text(device.get("maintenance_type") or device.get("maintenanceType")),
        "maintenance_note": normalize_text(device.get("maintenance_note") or device.get("maintenanceNote")),
        "acquisition_enabled": normalize_text(device.get("acquisition_enabled")) or "启用",
        "next_calibration_date": parse_date_value(device.get("next_cal")),
        "location_desc": normalize_text(device.get("location")),
        "remark": normalize_text(device.get("owner")),
    }


def build_storage_device_item(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": normalize_text(row.get("equipment_code")),
        "code": normalize_text(row.get("equipment_code")),
        "name": normalize_text(row.get("equipment_name")),
        "type": normalize_text(row.get("equipment_type")),
        "status": normalize_text(row.get("status")),
        "maintenance_start_at": format_iso_storage_datetime(row.get("maintenance_start_at")),
        "maintenance_end_at": format_iso_storage_datetime(row.get("maintenance_end_at")),
        "maintenance_type": normalize_text(row.get("maintenance_type")),
        "maintenance_note": normalize_text(row.get("maintenance_note")),
        "location": normalize_text(row.get("location_desc")),
        "next_cal": format_date_value(row.get("next_calibration_date")),
        "owner": normalize_text(row.get("remark")),
        "model": normalize_text(row.get("model_no")),
        "acquisition_enabled": normalize_text(row.get("acquisition_enabled")) or "启用",
    }


def build_stream_insert_row(stream: Dict[str, Any]) -> Dict[str, Any]:
    device = normalize_text(stream.get("device"))
    return {
        "stream_no": normalize_text(stream.get("id")),
        "task_no": normalize_text(stream.get("task_code")),
        "equipment_code": device,
        "device_name": device,
        "last_packet_time": parse_storage_datetime(stream.get("last_packet")),
        "quality_value": parse_float_value(stream.get("quality")),
        "stream_status": normalize_text(stream.get("status")),
        "reported_flag": parse_bool_flag(stream.get("reported")),
        "remark": STORAGE_MARKER,
    }


def build_storage_stream_item(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": normalize_text(row.get("stream_no")),
        "task_code": normalize_text(row.get("task_no")),
        "device": normalize_text(row.get("device_name") or row.get("equipment_code")),
        "last_packet": format_display_storage_datetime(row.get("last_packet_time")),
        "quality": format_quality_value(row.get("quality_value")),
        "status": normalize_text(row.get("stream_status")),
        "reported": bool(row.get("reported_flag")),
    }


def build_sample_insert_row(sample: Dict[str, Any]) -> Dict[str, Any]:
    code = normalize_text(sample.get("code"))
    return {
        "sample_no": code,
        "task_no": normalize_text(sample.get("task_code")),
        "sample_name": code,
        "batch_no": normalize_text(sample.get("batch_no")),
        "sample_type": normalize_text(sample.get("sample_type")),
        "sample_spec": "",
        "quantity": parse_int_value(sample.get("quantity")),
        "unit": "",
        "sample_status": normalize_experiment_status_text(sample.get("status")),
        "received_time": parse_storage_datetime(sample.get("created_at")) or parse_storage_datetime(sample.get("arrival_at")),
        "arrival_time": parse_storage_datetime(sample.get("arrival_at")),
        "storage_condition": normalize_text(sample.get("storage_condition")),
        "barcode_no": normalize_text(sample.get("barcode")),
        "location_desc": normalize_text(sample.get("location")),
        "flow_status": normalize_experiment_status_text(sample.get("flow_status")),
        "remark": encode_sample_meta(owner=sample.get("owner"), remark=sample.get("remark")),
        "created_at": parse_storage_datetime(sample.get("created_at")) or current_beijing_datetime(),
        "updated_at": parse_storage_datetime(sample.get("updated_at")) or current_beijing_datetime(),
    }


def extract_dispatch_target_lab(detail: Any, tray_code: str = "") -> str:
    text = normalize_text(detail)
    if not text:
        return ""
    normalized_tray_code = normalize_text(tray_code)
    if normalized_tray_code and normalized_tray_code not in text:
        return ""
    arrow_match = re.search(r"(?:->|→)\s*(?P<lab>[^，,；;/\s]+室)", text)
    if arrow_match:
        return normalize_text(arrow_match.group("lab"))
    dispatch_match = re.search(r"送至\s*(?P<lab>[^，,；;/\s]+室)", text)
    return normalize_text(dispatch_match.group("lab")) if dispatch_match else ""


LAB_OPERATION_TARGET_ACTIONS = {"任务比对", "样品安装", "实验确认"}
LAB_OPERATION_TARGET_STATUSES = {"已到达实验室", "工装夹具安装", "实验准备就绪"}
WITHDRAWAL_TARGET_ACTIONS = {"实验任务撤回", "任务切换撤回"}


def is_axis_partial_status(status: Any) -> bool:
    normalized = normalize_experiment_status_text(status)
    return "部分完成" in normalized and normalized.endswith("轴")


def partial_axis_status_name(status: Any) -> str:
    normalized = normalize_experiment_status_text(status)
    marker = "部分完成"
    if marker not in normalized:
        return ""
    return normalize_text(normalized.split(marker, 1)[0])


def latest_withdrawal_restores_partial_axis(
    event_rows: Iterable[Dict[str, Any]] | None,
    *,
    partial_status: str,
    tray_code: str,
) -> bool:
    expected_name = partial_axis_status_name(partial_status)
    if not expected_name:
        return False
    candidates: list[tuple[datetime, Dict[str, Any]]] = []
    for event in event_rows or []:
        action = normalize_text(event.get("action") or event.get("action_type"))
        if action not in WITHDRAWAL_TARGET_ACTIONS:
            continue
        detail = normalize_experiment_detail_text(event.get("detail"))
        if tray_code and tray_code not in detail and "托盘" in detail:
            continue
        status = normalize_experiment_status_text(event.get("status") or event.get("sample_status"))
        if expected_name not in status and f"撤回至{expected_name}部分完成" not in detail:
            continue
        event_time = parse_storage_datetime(event.get("time") or event.get("event_time")) or datetime.min
        candidates.append((event_time, event))
    if not candidates:
        return False
    candidates.sort(key=lambda item: item[0])
    latest_time, latest_event = candidates[-1]
    for event in event_rows or []:
        event_time = parse_storage_datetime(event.get("time") or event.get("event_time")) or datetime.min
        if event_time > latest_time:
            detail = normalize_experiment_detail_text(event.get("detail"))
            status = normalize_experiment_status_text(event.get("status") or event.get("sample_status"))
            if expected_name in status or expected_name in detail:
                continue
            return False
    return bool(latest_event)


def build_tray_dispatch_target_map(event_rows: Iterable[Dict[str, Any]] | None) -> Dict[str, str]:
    dispatch_events: list[tuple[datetime, str, str]] = []
    for event in event_rows or []:
        action = normalize_text(event.get("action") or event.get("action_type"))
        status = normalize_experiment_status_text(event.get("status") or event.get("sample_status"))
        is_pre_appearance = action == PRE_EXPERIMENT_APPEARANCE_STATUS or status == PRE_EXPERIMENT_APPEARANCE_STATUS
        is_lab_operation_target = action in LAB_OPERATION_TARGET_ACTIONS and status in LAB_OPERATION_TARGET_STATUSES
        if action != "送至实验室" and status != "送至实验室" and not is_pre_appearance and not is_lab_operation_target:
            continue
        detail = normalize_experiment_detail_text(event.get("detail"))
        tray_match = re.search(r"(?P<tray_code>[A-Za-z0-9_-]+-TP-\d+)", detail)
        tray_code = normalize_text(tray_match.group("tray_code")) if tray_match else ""
        explicit_target_lab = normalize_text(event.get("target_lab") or event.get("targetLab"))
        if is_pre_appearance:
            target_lab = explicit_target_lab or extract_dispatch_target_lab(detail, tray_code)
        else:
            target_lab = (
                explicit_target_lab
                or normalize_text(event.get("location") or event.get("location_desc"))
                or extract_dispatch_target_lab(detail, tray_code)
            )
        if not tray_code or not target_lab:
            continue
        event_time = parse_storage_datetime(event.get("time") or event.get("event_time")) or datetime.min
        dispatch_events.append((event_time, tray_code, target_lab))
    dispatch_events.sort(key=lambda item: item[0])
    return {tray_code: target_lab for _event_time, tray_code, target_lab in dispatch_events}


def build_staging_dispatch_target_map(event_rows: Iterable[Dict[str, Any]] | None) -> Dict[str, dict[str, str]]:
    ordered_events: list[tuple[datetime, str, dict[str, Any]]] = []
    for event in event_rows or []:
        tray_code = normalize_text(event.get("tray_code") or event.get("trayCode"))
        if not tray_code:
            continue
        event_time = parse_storage_datetime(event.get("time") or event.get("event_time")) or datetime.min
        ordered_events.append((event_time, tray_code, event))
    ordered_events.sort(key=lambda item: item[0])

    targets: Dict[str, dict[str, str]] = {}
    for _event_time, tray_code, event in ordered_events:
        action = normalize_text(event.get("action"))
        if action == "stock_in":
            targets.pop(tray_code, None)
            continue
        if action != "stock_out":
            continue
        target_lab = normalize_text(event.get("target_lab") or event.get("targetLab"))
        target_experiment_code = normalize_text(
            event.get("target_experiment_code")
            or event.get("targetExperimentCode")
            or event.get("experiment_code")
            or event.get("experimentCode")
        )
        if target_lab or target_experiment_code:
            targets[tray_code] = {
                "target_lab": target_lab,
                "target_experiment_code": target_experiment_code,
            }
    return targets


def build_scheduled_dispatch_target_map(
    schedules: Iterable[Dict[str, Any]] | None,
    experiment_trays: Iterable[Dict[str, Any]] | None,
) -> Dict[tuple[str, str, str], str]:
    assigned_trays_by_experiment: Dict[tuple[str, str], set[str]] = {}
    for entry in experiment_trays or []:
        task_code = normalize_text(entry.get("task_code") or entry.get("taskCode") or entry.get("task_no"))
        experiment_code = normalize_text(entry.get("experiment_code") or entry.get("experimentCode") or entry.get("experiment_no"))
        tray_code = normalize_text(entry.get("tray_code") or entry.get("trayCode") or entry.get("tray_no"))
        if task_code and experiment_code and tray_code:
            assigned_trays_by_experiment.setdefault((task_code, experiment_code), set()).add(tray_code)

    candidates: Dict[tuple[str, str, str], set[str]] = {}
    for schedule in schedules or []:
        task_code = normalize_text(schedule.get("task_code") or schedule.get("taskCode") or schedule.get("task_no"))
        experiment_code = normalize_text(schedule.get("experiment_code") or schedule.get("experimentCode") or schedule.get("experiment_no"))
        device = normalize_text(schedule.get("device") or schedule.get("device_name") or schedule.get("target_lab"))
        if not task_code or not experiment_code or not device:
            continue
        for tray_code in assigned_trays_by_experiment.get((task_code, experiment_code), set()):
            candidates.setdefault((task_code, tray_code, device), set()).add(experiment_code)
    return {
        key: next(iter(experiment_codes))
        for key, experiment_codes in candidates.items()
        if len(experiment_codes) == 1
    }


def event_is_appearance_stock_in(event: Dict[str, Any], task_code: str, tray_code: str) -> bool:
    event_tray_code = normalize_text(event.get("tray_code") or event.get("trayCode"))
    if event_tray_code != tray_code:
        return False
    event_task_code = normalize_text(event.get("task_code") or event.get("taskCode") or event.get("task_no"))
    if event_task_code and event_task_code != task_code:
        return False
    room = normalize_text(event.get("room") or event.get("storage_room") or event.get("storageRoom"))
    return normalize_text(event.get("action")) == "stock_in" and room == "appearance"


def build_appearance_stock_in_index(
    event_rows: Iterable[Dict[str, Any]] | None,
) -> set[tuple[str, str]]:
    appearance_stock_in_keys: set[tuple[str, str]] = set()
    for event in event_rows or []:
        tray_code = normalize_text(event.get("tray_code") or event.get("trayCode"))
        room = normalize_text(event.get("room") or event.get("storage_room") or event.get("storageRoom"))
        if not tray_code or normalize_text(event.get("action")) != "stock_in" or room != "appearance":
            continue
        task_code = normalize_text(event.get("task_code") or event.get("taskCode") or event.get("task_no"))
        appearance_stock_in_keys.add((task_code, tray_code))
    return appearance_stock_in_keys


def history_has_appearance_stock_in(history: Iterable[Dict[str, Any]], tray_code: str) -> bool:
    for event in history or []:
        action = normalize_text(event.get("action") or event.get("action_type"))
        detail = normalize_experiment_detail_text(event.get("detail"))
        if tray_code and tray_code not in detail:
            continue
        if APPEARANCE_INSPECTION_LOCATION in action and "入库" in action:
            return True
    return False


def latest_non_appearance_history_state(history: Iterable[Dict[str, Any]]) -> dict[str, str]:
    for event in history or []:
        status = normalize_experiment_status_text(event.get("status"))
        location = normalize_text(event.get("location"))
        action = normalize_text(event.get("action"))
        if (
            status == PRE_EXPERIMENT_APPEARANCE_STATUS
            or action == PRE_EXPERIMENT_APPEARANCE_STATUS
            or location == APPEARANCE_INSPECTION_LOCATION
        ):
            continue
        if status or location:
            return {
                "location": location or "接驳区",
                "status": status or "到货",
            }
    return {"location": "接驳区", "status": "到货"}


def build_storage_sample_item(
    row: Dict[str, Any],
    *,
    tray_rows: Iterable[Dict[str, Any]] | None = None,
    event_rows: Iterable[Dict[str, Any]] | None = None,
    staging_event_rows: Iterable[Dict[str, Any]] | None = None,
    schedules: Iterable[Dict[str, Any]] | None = None,
    experiment_trays: Iterable[Dict[str, Any]] | None = None,
    staging_target_by_tray_code: Dict[str, dict[str, str]] | None = None,
    scheduled_target_by_key: Dict[tuple[str, str, str], str] | None = None,
    appearance_stock_in_keys: set[tuple[str, str]] | None = None,
) -> Dict[str, Any]:
    meta = decode_sample_meta(row.get("remark"))
    resolved_task_code = normalize_text(row.get("task_no")) or derive_task_code_from_sample_code(row.get("sample_no"))
    event_row_list = list(event_rows or [])
    needs_staging_rows = staging_target_by_tray_code is None or appearance_stock_in_keys is None
    staging_event_row_list = list(staging_event_rows or []) if needs_staging_rows else []
    target_lab_by_tray_code = build_tray_dispatch_target_map(event_row_list)
    if staging_target_by_tray_code is None:
        staging_target_by_tray_code = build_staging_dispatch_target_map(staging_event_row_list)
    if scheduled_target_by_key is None:
        scheduled_target_by_key = build_scheduled_dispatch_target_map(schedules, experiment_trays)
    if appearance_stock_in_keys is None:
        appearance_stock_in_keys = build_appearance_stock_in_index(staging_event_row_list)
    trays = []
    for tray in tray_rows or []:
        tray_code = normalize_text(tray.get("tray_code"))
        if not tray_code:
            continue
        tray_status = normalize_experiment_status_text(tray.get("status") or tray.get("test_state") or tray.get("tray_status"))
        tray_completed = tray_status in EXPERIMENT_COMPLETED_STATUSES
        raw_target_lab = normalize_text(tray.get("target_lab") or tray.get("targetLab"))
        if tray_status == PRE_EXPERIMENT_APPEARANCE_STATUS and raw_target_lab == APPEARANCE_INSPECTION_LOCATION:
            raw_target_lab = ""
        staging_target = staging_target_by_tray_code.get(tray_code, {})
        staging_target_lab = normalize_text(staging_target.get("target_lab"))
        staging_target_experiment_code = normalize_text(staging_target.get("target_experiment_code"))
        raw_target_experiment_code = normalize_text(tray.get("target_experiment_code") or tray.get("targetExperimentCode"))
        event_target_lab = "" if is_axis_partial_status(tray_status) else target_lab_by_tray_code.get(tray_code, "")
        if tray_completed:
            target_lab = ""
            target_experiment_code = ""
        elif is_axis_partial_status(tray_status) and latest_withdrawal_restores_partial_axis(
            event_row_list,
            partial_status=tray_status,
            tray_code=tray_code,
        ):
            target_lab = normalize_text(row.get("location_desc")) or raw_target_lab or staging_target_lab
            target_experiment_code = (
                scheduled_target_by_key.get((resolved_task_code, tray_code, target_lab), "")
                or raw_target_experiment_code
                or staging_target_experiment_code
            )
        elif is_axis_partial_status(tray_status) and (staging_target_lab or staging_target_experiment_code):
            target_lab = staging_target_lab or raw_target_lab
            target_experiment_code = (
                staging_target_experiment_code
                or raw_target_experiment_code
                or scheduled_target_by_key.get((resolved_task_code, tray_code, target_lab), "")
            )
        else:
            target_lab = event_target_lab or raw_target_lab or staging_target_lab
            scheduled_target_experiment_code = scheduled_target_by_key.get(
                (resolved_task_code, tray_code, target_lab),
                "",
            )
            matching_raw_target_experiment_code = (
                raw_target_experiment_code
                if raw_target_lab and raw_target_lab == target_lab
                else ""
            )
            unscoped_raw_target_experiment_code = raw_target_experiment_code if not raw_target_lab else ""
            matching_staging_target_experiment_code = (
                staging_target_experiment_code
                if not staging_target_lab or staging_target_lab == target_lab
                else ""
            )
            target_experiment_code = (
                matching_raw_target_experiment_code
                or scheduled_target_experiment_code
                or unscoped_raw_target_experiment_code
                or matching_staging_target_experiment_code
            )
        tray_item = {
            "id": normalize_text(tray.get("tray_code") or tray.get("id")),
            "tray_code": tray_code,
            "sample_code": normalize_text(tray.get("sample_code") or row.get("sample_no")),
            "quantity": 0 if tray.get("quantity") in (None, "") else int(tray.get("quantity")),
            "status": tray_status,
            "target_lab": target_lab,
            "target_experiment_code": target_experiment_code,
            "fixture_ready": parse_fixture_ready_flag(tray.get("fixture_ready", tray.get("fixtureReady"))),
            "fixtureReady": parse_fixture_ready_flag(tray.get("fixtureReady", tray.get("fixture_ready"))),
            "created_at": format_iso_storage_datetime(tray.get("created_at")),
            "updated_at": format_iso_storage_datetime(tray.get("updated_at")),
        }
        target_sub_experiment_code = normalize_text(
            tray.get("target_sub_experiment_code") or tray.get("targetSubExperimentCode")
        )
        if target_sub_experiment_code:
            tray_item["target_sub_experiment_code"] = target_sub_experiment_code
        trays.append(tray_item)
    history = [
        {
            "id": normalize_text(event.get("id") or event.get("event_id") or event.get("sample_no")),
            "time": format_iso_storage_datetime(event.get("time") or event.get("event_time")),
            "action": normalize_text(event.get("action") or event.get("action_type")),
            "location": normalize_text(event.get("location") or event.get("location_desc")),
            "owner": normalize_text(event.get("owner") or event.get("owner_name")),
            "status": normalize_experiment_status_text(event.get("status") or event.get("sample_status")),
            "detail": normalize_experiment_detail_text(event.get("detail")),
        }
        for event in event_row_list
    ]
    history.sort(key=lambda item: normalize_text(item.get("time")), reverse=True)
    restored_state = latest_non_appearance_history_state(history)
    for tray in trays:
        if tray.get("status") != PRE_EXPERIMENT_APPEARANCE_STATUS:
            continue
        tray_code = normalize_text(tray.get("tray_code"))
        has_appearance_stock_in = (
            (resolved_task_code, tray_code) in appearance_stock_in_keys
            or ("", tray_code) in appearance_stock_in_keys
            or history_has_appearance_stock_in(history, tray_code)
        )
        if has_appearance_stock_in:
            continue
        tray["status"] = restored_state["status"]
        tray["target_lab"] = ""
        tray["target_experiment_code"] = ""

    status = normalize_experiment_status_text(row.get("sample_status"))
    flow_status = normalize_experiment_status_text(row.get("flow_status"))
    location = normalize_text(row.get("location_desc"))
    if (
        status == PRE_EXPERIMENT_APPEARANCE_STATUS
        and location == APPEARANCE_INSPECTION_LOCATION
        and not any(tray.get("status") == PRE_EXPERIMENT_APPEARANCE_STATUS for tray in trays)
    ):
        location = restored_state["location"]
        status = restored_state["status"]
        flow_status = restored_state["status"]

    return {
        "id": normalize_text(row.get("sample_no")),
        "code": normalize_text(row.get("sample_no")),
        "task_code": resolved_task_code,
        "sample_type": normalize_text(row.get("sample_type")),
        "batch_no": normalize_text(row.get("batch_no")),
        "arrival_at": format_display_storage_datetime(row.get("arrival_time")),
        "quantity": "" if row.get("quantity") is None else str(row.get("quantity")),
        "storage_condition": normalize_text(row.get("storage_condition")),
        "barcode": normalize_text(row.get("barcode_no")),
        "remark": meta["remark"],
        "location": location,
        "owner": meta["owner"],
        "status": status,
        "flow_status": flow_status,
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
        "trays": trays,
        "history": history,
    }
