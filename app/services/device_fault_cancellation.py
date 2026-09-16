"""Device-fault cancellation, deliberately separate from salt pause and mold recovery."""
from copy import deepcopy
from typing import Any
from app.core.time_utils import parse_business_datetime
from datetime import datetime

from app.services.laboratory_snapshot_adapter import completion_updates, snapshot_from_storage_payload
from app.services.laboratory_termination import terminate_storage_laboratory_experiment

FAULT_CANCELED = "设备故障试验取消"
FAULT_END_MODE = "device_fault_cancel"
FAULT_APPEARANCE_PHASE = "device_fault_recovery"
ACTIVE_STATUSES = {"实验进行中", "实验中", "实验暂停"}
COMPLETED_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}


def text(value: Any) -> str:
    return str(value or "").strip()


def fault_run_context(payload: dict, *, run_no: str, task_code: str, experiment_code: str) -> dict:
    run = next((row for row in payload.get("mes.experiment_runs", [])
                if text(row.get("run_no") or row.get("id")) == run_no
                and text(row.get("task_code")) == task_code
                and text(row.get("experiment_code")) == experiment_code), None)
    if not run or text(run.get("status")) not in ACTIVE_STATUSES | {FAULT_CANCELED}:
        raise ValueError("当前实验状态已变化，请刷新后重试")
    if not text(run.get("schedule_id") or run.get("schedule_no")):
        raise ValueError("当前运行缺少排程标识，不能取消")
    return run


def build_fault_cancellation_updates(payload: dict, *, run_no: str, task_code: str,
                                     experiment_code: str, canceled_at: str, reason: str, operator: str = "") -> dict:
    """Only the authenticated MQTT confirmation path may apply these updates."""
    run = fault_run_context(payload, run_no=run_no, task_code=task_code, experiment_code=experiment_code)
    if not text(reason):
        raise ValueError("请填写设备故障原因")
    if run["status"] == FAULT_CANCELED:
        return {}  # A duplicate confirmation must not reset a newer attempt or tray location.
    snapshot = snapshot_from_storage_payload(payload)
    relations = [row for row in snapshot["experiment_run_trays"] if text(row.get("run_no")) == run_no]
    if not relations or any(text(row.get("run_tray_status") or row.get("status")) not in ACTIVE_STATUSES for row in relations):
        raise ValueError("设备故障取消必须包含当前运行的全部托盘")
    result = terminate_storage_laboratory_experiment(
        snapshot, task_code=task_code, experiment_code=experiment_code, run_no=run_no,
        terminated_at=canceled_at, termination_reason=reason, terminal_status=FAULT_CANCELED,
        history_action=FAULT_CANCELED, next_experiment_status="待排程",
        remove_current_schedule=True, require_full_run=True,
    )
    affected = set(result["affectedTrayCodes"])
    for sample in result["affectedSamples"]:
        sample["history"][0].update(run_no=run_no, experiment_code=experiment_code, cancellation_type="device_fault")
        # The history SQL table persists detail, but not arbitrary JSON fields.
        sample["history"][0]["detail"] += f" / 运行批次：{run_no}"
        if text(operator):
            sample["history"][0]["owner"] = text(operator)
        for tray in sample["trays"]:
            if text(tray.get("tray_code")) in affected:
                for key in ("fixture_install_id", "fixtureInstallId", "target_schedule_id", "targetScheduleId"):
                    tray.pop(key, None)
    result["experimentRunSteps"] = [
        {**step, "status": FAULT_CANCELED, "ended_at": canceled_at, "updated_at": canceled_at}
        if text(step.get("run_no")) == run_no and text(step.get("status")) not in COMPLETED_STATUSES
        else deepcopy(step) for step in snapshot["experiment_run_steps"]
    ]
    if any(text(other.get("run_no")) != run_no and text(other.get("task_code")) == task_code
           and text(other.get("experiment_code")) == experiment_code and text(other.get("status")) in ACTIVE_STATUSES
           for other in snapshot["experiment_runs"]):
        for experiment in result["experiments"]:
            if text(experiment.get("task_code")) == task_code and text(experiment.get("experiment_code")) == experiment_code:
                experiment["status"] = "实验进行中"
    lab = text(run.get("device") or run.get("lab_code"))
    from app.core.master_data import DEFAULT_LABS
    aliases = {lab, text(run.get("lab_code"))} - {""}
    for laboratory in DEFAULT_LABS:
        if aliases & {text(laboratory.get("lab_code")), text(laboratory.get("lab_name"))}:
            aliases.update({text(laboratory.get("lab_code")), text(laboratory.get("lab_name"))})
    devices = deepcopy(payload.get("mes.devices", []))
    matched = False
    for device in devices:
        if aliases & {text(device.get(key)) for key in ("code", "name", "location", "lab_code")}:
            matched = True
            device.update(status="维修", maintenance_type="维修", maintenance_start_at=canceled_at,
                          maintenance_end_at="", maintenance_note=reason, updated_at=canceled_at)
    if not matched:
        raise ValueError("当前运行未匹配设备台账，不能取消")
    conflicts = deepcopy(payload.get("mes.conflicts", []))
    for schedule in result["schedules"]:
        if not (aliases & {text(schedule.get("device")), text(schedule.get("lab_code"))}) or text(schedule.get("status")) in COMPLETED_STATUSES:
            continue
        conflict_id = f"device-fault-{run_no}-{text(schedule.get('id'))}"
        if not any(text(row.get("id")) == conflict_id for row in conflicts):
            conflicts.append({"id": conflict_id, "type": "device_fault_schedule_blocked", "status": "pending",
                              "task_code": schedule.get("task_code"), "experiment_code": schedule.get("experiment_code"),
                              "schedule_id": schedule.get("id"), "device": lab, "created_at": canceled_at,
                              "reason": "设备故障维修，原排程保留，请调整设备或时间", "detail": reason})
    return {**completion_updates(result), "mes.devices": devices, "mes.conflicts": conflicts}


def canceled_fault_tray_context(payload: dict, *, task_code: str, tray_code: str) -> dict | None:
    """Require latest run evidence, never unlock routing from a client status string alone."""
    relations = [row for row in payload.get("mes.experiment_run_trays", [])
                 if text(row.get("task_code")) == task_code and text(row.get("tray_code")) == tray_code]
    relations.sort(key=lambda row: parse_business_datetime(row.get("updated_at") or row.get("ended_at") or row.get("started_at")) or datetime.min)
    if not relations or text(relations[-1].get("run_tray_status") or relations[-1].get("status")) != FAULT_CANCELED:
        return None
    relation = relations[-1]
    run = next((row for row in payload.get("mes.experiment_runs", [])
                if text(row.get("run_no") or row.get("id")) == text(relation.get("run_no"))
                and text(row.get("task_code")) == task_code and text(row.get("status")) == FAULT_CANCELED), None)
    if not run:
        return None
    return {"run_no": text(run.get("run_no") or run.get("id")), "experiment_code": text(run.get("experiment_code"))}
