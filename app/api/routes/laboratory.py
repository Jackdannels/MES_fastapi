from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.core.storage_backend import get_storage_backend, normalize_storage_payload

router = APIRouter(prefix="/api/laboratory", tags=["laboratory"])

STAGING_LOCATION = "恒温恒湿间（暂存间）"
HANDOVER_LOCATION = "接驳区"
ALLOW_WITHDRAW_STATUSES = {"已到达实验室", "工装夹具安装", "实验准备就绪"}
COMPLETED_EXPERIMENT_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}


class LaboratoryWithdrawRequest(BaseModel):
    reason: str = ""
    operation_id: str = Field(default="", alias="operationId")

    model_config = ConfigDict(populate_by_name=True)


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def parse_datetime_value(value: Any) -> datetime | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def read_snapshot() -> dict[str, list[dict[str, Any]]]:
    storage = get_storage_backend()
    payload = normalize_storage_payload(storage.read_all())
    return {
        "tasks": [dict(item) for item in as_list(payload.get("mes.tasks")) if isinstance(item, dict)],
        "samples": [dict(item) for item in as_list(payload.get("mes.samples")) if isinstance(item, dict)],
        "schedules": [dict(item) for item in as_list(payload.get("mes.schedules")) if isinstance(item, dict)],
        "experiments": [dict(item) for item in as_list(payload.get("mes.experiments")) if isinstance(item, dict)],
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


def find_task(snapshot: dict[str, list[dict[str, Any]]], task_code: str) -> dict[str, Any]:
    normalized_code = normalize_text(task_code)
    for task in snapshot["tasks"]:
        if normalize_text(task.get("code")) == normalized_code or normalize_text(task.get("id")) == normalized_code:
            return task
    raise HTTPException(status_code=404, detail="未找到任务")


def experiment_name(snapshot: dict[str, list[dict[str, Any]]], task_code: str, experiment_code: str) -> str:
    for experiment in snapshot["experiments"]:
        if (
            normalize_text(experiment.get("task_code")) == task_code
            and normalize_text(experiment.get("experiment_code")) == experiment_code
        ):
            return normalize_text(experiment.get("experiment_name") or experiment.get("experiment_type") or experiment_code)
    return experiment_code


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


def parse_experiment_history_detail(detail: Any, task_code: str) -> dict[str, str] | None:
    parts = [normalize_text(part) for part in normalize_text(detail).split("/") if normalize_text(part)]
    if len(parts) < 3 or parts[0] != task_code:
        return None
    status = parts[-1]
    if status in {"实验完成", "实验已经完成"}:
        status = "实验已完成"
    return {"experimentName": parts[1], "status": status}


def latest_staging_event_for_tray(snapshot: dict[str, list[dict[str, Any]]], tray_code: str) -> dict[str, Any] | None:
    matched = [
        dict(event)
        for event in snapshot["staging_events"]
        if normalize_text(event.get("tray_code")) == tray_code
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
) -> dict[str, str] | None:
    candidates: list[dict[str, Any]] = []
    for entry in as_list(sample.get("history")):
        parsed = parse_experiment_history_detail(entry.get("detail"), task_code)
        if not parsed or parsed["status"] != "实验已完成":
            continue
        if parsed["experimentName"] == current_experiment_name:
            continue
        candidates.append(
            {
                "experimentName": parsed["experimentName"],
                "location": normalize_text(entry.get("location")) or normalize_text(sample.get("location")),
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
    }


def sample_has_staging_origin(sample: dict[str, Any], snapshot: dict[str, list[dict[str, Any]]], tray_code: str) -> bool:
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
        if normalize_text(entry.get("action")) in {"撤回出库", "实验任务撤回", "任务切换撤回"}
    )
    latest_withdrawal_time = max(withdrawal_times) if withdrawal_times else datetime.min

    dispatch_entries: list[dict[str, Any]] = []
    for event in snapshot["staging_events"]:
        if normalize_text(event.get("tray_code")) != normalized_tray_code:
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
        return False
    dispatch_entries.sort(key=lambda entry: entry["time"])
    return bool(dispatch_entries[-1].get("stagingOrigin"))


def resolve_restore_snapshot(
    sample: dict[str, Any],
    snapshot: dict[str, list[dict[str, Any]]],
    task_code: str,
    current_experiment_name: str,
    tray_code: str,
) -> dict[str, str]:
    completed = latest_previous_completed_experiment(sample, task_code, current_experiment_name)
    if completed:
        return completed
    if sample_has_staging_origin(sample, snapshot, tray_code):
        return {"status": "已到达暂存间", "location": STAGING_LOCATION, "scope": "staging", "experimentName": ""}
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
) -> list[tuple[dict[str, Any], list[str]]]:
    result: list[tuple[dict[str, Any], list[str]]] = []
    for sample in snapshot["samples"]:
        if normalize_text(sample.get("task_code")) != task_code:
            continue
        matched_codes = [
            normalize_text(tray.get("tray_code"))
            for tray in as_list(sample.get("trays"))
            if normalize_text(tray.get("tray_code")) in tray_codes
        ]
        if matched_codes:
            result.append((sample, matched_codes))
    return result


@router.post("/tasks/{task_code}/experiments/{experiment_code}/withdraw-current")
def withdraw_current_experiment(
    task_code: str,
    experiment_code: str,
    request: LaboratoryWithdrawRequest = Body(default_factory=LaboratoryWithdrawRequest),
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    snapshot = read_snapshot()
    find_task(snapshot, normalized_task_code)
    current_experiment_name = experiment_name(snapshot, normalized_task_code, normalized_experiment_code)
    tray_codes = set(experiment_tray_codes(snapshot, normalized_task_code, normalized_experiment_code))
    sample_matches = matching_samples(snapshot, normalized_task_code, tray_codes)
    if not sample_matches:
        raise HTTPException(status_code=404, detail="当前实验未找到对应托盘样品")

    for sample, matched_tray_codes in sample_matches:
        for tray in as_list(sample.get("trays")):
            tray_code = normalize_text(tray.get("tray_code"))
            if tray_code not in matched_tray_codes:
                continue
            current_status = normalize_text(tray.get("status")) or normalize_text(sample.get("status"))
            if current_status not in ALLOW_WITHDRAW_STATUSES:
                raise HTTPException(status_code=400, detail=f"托盘{tray_code}当前状态为{current_status or '未知'}，不能撤回当前实验任务")

    now = datetime.now().isoformat(timespec="seconds")
    affected_sample_count = 0
    restored_targets: list[dict[str, str]] = []
    compensated_tray_codes: set[str] = set()
    for sample, matched_tray_codes in sample_matches:
        restore_snapshot = resolve_restore_snapshot(
            sample,
            snapshot,
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
        sample["location"] = restore_snapshot["location"]
        sample["status"] = restore_snapshot["status"]
        sample["flow_status"] = restore_snapshot["status"]
        sample["updated_at"] = now
        sample["trays"] = next_trays
        detail_target = restore_snapshot["status"]
        if restore_snapshot.get("experimentName"):
            detail_target = f"{restore_snapshot['experimentName']}已完成"
        detail = f"{normalized_task_code} / {current_experiment_name} / 撤回至{detail_target}"
        reason = normalize_text(request.reason)
        if reason:
            detail = f"{detail}（{reason}）"
        append_history(sample, "实验任务撤回", detail, now)
        affected_sample_count += 1

        if restore_snapshot["scope"] == "staging":
            for tray_code in matched_tray_codes:
                if tray_code in compensated_tray_codes:
                    continue
                latest_event = latest_staging_event_for_tray(snapshot, tray_code) or {}
                snapshot["staging_events"].append(
                    {
                        "id": f"staging-event-{tray_code}-{len(snapshot['staging_events']) + 1}",
                        "tray_code": tray_code,
                        "task_code": normalized_task_code,
                        "action": "stock_out_withdraw",
                        "time": now,
                        "operator": reason or "实验任务撤回",
                        "target_lab": normalize_text(latest_event.get("target_lab")),
                        "target_experiment_code": normalize_text(latest_event.get("target_experiment_code")) or normalized_experiment_code,
                    }
                )
                compensated_tray_codes.add(tray_code)

    write_snapshot(snapshot)
    first_target = restored_targets[0]
    return {
        "ok": True,
        "message": f"{normalized_task_code} / {current_experiment_name} 已撤回当前实验任务",
        "affectedSampleCount": affected_sample_count,
        "affectedTrayCodes": sorted(tray_codes),
        "restoredStatus": first_target["status"],
        "restoredLocation": first_target["location"],
        "restoredExperimentName": first_target.get("experimentName") or "",
        "samples": snapshot["samples"],
        "stagingEvents": snapshot["staging_events"],
    }
