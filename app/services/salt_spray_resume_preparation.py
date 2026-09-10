from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.core.time_utils import format_business_datetime, now_business_text
from app.services.appearance_inspection import validate_mid_experiment_trays_ready_for_resume
from app.services.laboratory_operations import (
    COMPARE_STATUS,
    INSTALL_STATUS,
    READY_STATUS,
    as_list,
    merge_scoped_samples,
)
from app.services.salt_spray_pause import PAUSED, SALT_LAB_CODE


RESUME_PREPARATION_ROOM = "laboratory_resume_preparation"
RESUME_PREPARATION_START = "resume_preparation_started"
RESUME_PREPARATION_COMPARE = "resume_preparation_compared"
RESUME_PREPARATION_INSTALL = "resume_preparation_installed"
RESUME_PREPARATION_FIXTURE_READY = "resume_preparation_fixture_ready"
RESUME_PREPARATION_READY = "resume_preparation_ready"
SALT_LAB_NAME = "盐雾试验室"

RESUME_PREPARATION_ACTIONS = {
    "start": RESUME_PREPARATION_START,
    "compare": RESUME_PREPARATION_COMPARE,
    "install": RESUME_PREPARATION_INSTALL,
    "fixtureReady": RESUME_PREPARATION_FIXTURE_READY,
    "fixture_ready": RESUME_PREPARATION_FIXTURE_READY,
    "ready": RESUME_PREPARATION_READY,
}
RESUME_PREPARATION_PREVIOUS_ACTION = {
    RESUME_PREPARATION_COMPARE: RESUME_PREPARATION_START,
    RESUME_PREPARATION_INSTALL: RESUME_PREPARATION_COMPARE,
    RESUME_PREPARATION_FIXTURE_READY: RESUME_PREPARATION_INSTALL,
    RESUME_PREPARATION_READY: RESUME_PREPARATION_FIXTURE_READY,
}
RESUME_PREPARATION_STATUS = {
    RESUME_PREPARATION_COMPARE: COMPARE_STATUS,
    RESUME_PREPARATION_INSTALL: INSTALL_STATUS,
    RESUME_PREPARATION_FIXTURE_READY: INSTALL_STATUS,
    RESUME_PREPARATION_READY: READY_STATUS,
}
RESUME_PREPARATION_HISTORY = {
    RESUME_PREPARATION_COMPARE: "继续实验任务比对",
    RESUME_PREPARATION_INSTALL: "继续实验样品安装",
    RESUME_PREPARATION_READY: "继续实验准备确认",
}


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _record_text(record: Any, *keys: str) -> str:
    if not isinstance(record, dict):
        return ""
    for key in keys:
        value = normalize_text(record.get(key))
        if value:
            return value
    return ""


def _selected_trays(pause: dict[str, Any]) -> list[str]:
    values = pause.get("inspection_tray_codes") or pause.get("inspectionTrayCodes") or []
    return sorted({normalize_text(value) for value in as_list(values) if normalize_text(value)})


def find_resume_preparation_pause(
    snapshot: dict[str, Any],
    *,
    task_code: str,
    experiment_code: str,
    run_no: str,
    pause_no: str,
    lab_code: str,
) -> dict[str, Any]:
    normalized = {
        "task_code": normalize_text(task_code),
        "experiment_code": normalize_text(experiment_code),
        "run_no": normalize_text(run_no),
        "pause_no": normalize_text(pause_no),
        "lab_code": normalize_text(lab_code),
    }
    if not all(normalized.values()):
        raise ValueError("继续实验准备缺少任务、实验、运行、暂停或试验室信息")
    if normalized["lab_code"] != SALT_LAB_CODE:
        raise ValueError("继续实验准备仅支持盐雾试验室")

    run = next(
        (
            row for row in as_list(snapshot.get("experiment_runs"))
            if _record_text(row, "run_no", "runNo", "id") == normalized["run_no"]
        ),
        None,
    )
    if not isinstance(run, dict):
        raise ValueError("未找到当前盐雾实验运行")
    run_lab_code = _record_text(run, "lab_code", "labCode")
    run_lab_name = _record_text(run, "device", "device_name", "deviceName", "lab_name", "labName")
    run_is_salt = (
        run_lab_code == SALT_LAB_CODE
        if run_lab_code
        else run_lab_name == SALT_LAB_NAME
    )
    if (
        _record_text(run, "task_code", "task_no", "taskCode") != normalized["task_code"]
        or _record_text(run, "experiment_code", "experiment_no", "experimentCode") != normalized["experiment_code"]
        or not run_is_salt
        or _record_text(run, "status", "run_status", "runStatus") != PAUSED
    ):
        raise ValueError("当前盐雾实验不处于可继续准备的暂停状态")

    pause = next(
        (
            row for row in as_list(snapshot.get("experiment_run_pauses"))
            if _record_text(row, "pause_no", "pauseNo") == normalized["pause_no"]
            and _record_text(row, "run_no", "runNo") == normalized["run_no"]
        ),
        None,
    )
    if not isinstance(pause, dict) or _record_text(pause, "status", "pause_status", "pauseStatus") != PAUSED:
        raise ValueError("当前实验不存在可继续准备的暂停区间")
    if (
        _record_text(pause, "task_code", "task_no", "taskCode") != normalized["task_code"]
        or _record_text(pause, "experiment_code", "experiment_no", "experimentCode") != normalized["experiment_code"]
        or _record_text(pause, "lab_code", "labCode") != SALT_LAB_CODE
    ):
        raise ValueError("继续实验准备的暂停上下文不匹配")
    if not _selected_trays(pause):
        raise ValueError("当前暂停记录没有需要重新准备的托盘")
    return pause


def resume_preparation_events(
    snapshot: dict[str, Any], *, run_no: str, pause_no: str
) -> list[dict[str, Any]]:
    return [
        event for event in as_list(snapshot.get("staging_events"))
        if isinstance(event, dict)
        and _record_text(event, "room") == RESUME_PREPARATION_ROOM
        and _record_text(event, "run_no", "runNo") == normalize_text(run_no)
        and _record_text(event, "pause_no", "pauseNo") == normalize_text(pause_no)
    ]


def completed_resume_preparation_actions(
    snapshot: dict[str, Any], *, run_no: str, pause_no: str
) -> dict[str, set[str]]:
    completed: dict[str, set[str]] = {}
    for event in resume_preparation_events(snapshot, run_no=run_no, pause_no=pause_no):
        action = _record_text(event, "action")
        tray_code = _record_text(event, "tray_code", "trayCode")
        if action in RESUME_PREPARATION_ACTIONS.values() and tray_code:
            completed.setdefault(action, set()).add(tray_code)
    return completed


def active_resume_preparation_context(
    snapshot: dict[str, Any], *, task_code: str, experiment_code: str, lab_code: str, tray_codes: list[str]
) -> dict[str, str] | None:
    if normalize_text(lab_code) != SALT_LAB_CODE:
        return None
    normalized_trays = {normalize_text(code) for code in tray_codes if normalize_text(code)}
    candidates = []
    for pause in as_list(snapshot.get("experiment_run_pauses")):
        if not isinstance(pause, dict) or _record_text(pause, "status", "pause_status") != PAUSED:
            continue
        if (
            _record_text(pause, "task_code", "task_no") != normalize_text(task_code)
            or _record_text(pause, "experiment_code", "experiment_no") != normalize_text(experiment_code)
            or _record_text(pause, "lab_code") != SALT_LAB_CODE
        ):
            continue
        selected = set(_selected_trays(pause))
        run_no = _record_text(pause, "run_no", "runNo")
        pause_no = _record_text(pause, "pause_no", "pauseNo")
        completed = completed_resume_preparation_actions(snapshot, run_no=run_no, pause_no=pause_no)
        if (
            normalized_trays
            and normalized_trays.issubset(selected)
            and selected.issubset(completed.get(RESUME_PREPARATION_START, set()))
        ):
            candidates.append({"run_no": run_no, "pause_no": pause_no})
    return candidates[-1] if candidates else None


def _copy_samples(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    return [deepcopy(sample) for sample in as_list(snapshot.get("samples")) if isinstance(sample, dict)]


def _append_event(
    events: list[dict[str, Any]], *, action: str, task_code: str, experiment_code: str,
    run_no: str, pause_no: str, tray_code: str, occurred_at: str,
) -> None:
    event_id = f"resume-preparation:{pause_no}:{action}:{tray_code}"
    if any(_record_text(event, "id") == event_id for event in events):
        return
    events.append({
        "id": event_id,
        "action": action,
        "experiment_code": experiment_code,
        "lab_code": SALT_LAB_CODE,
        "pause_no": pause_no,
        "room": RESUME_PREPARATION_ROOM,
        "run_no": run_no,
        "task_code": task_code,
        "time": occurred_at,
        "tray_code": tray_code,
    })


def apply_salt_resume_preparation_operation(
    snapshot: dict[str, Any], *, operation_type: str, task_code: str, experiment_code: str,
    run_no: str, pause_no: str, lab_code: str, tray_codes: list[str], occurred_at: str = "",
    fixture_install_id: str = "",
) -> dict[str, Any]:
    normalized_operation = normalize_text(operation_type)
    action = RESUME_PREPARATION_ACTIONS.get(normalized_operation)
    if not action:
        raise ValueError("不支持的继续实验准备操作")
    pause = find_resume_preparation_pause(
        snapshot,
        task_code=task_code,
        experiment_code=experiment_code,
        run_no=run_no,
        pause_no=pause_no,
        lab_code=lab_code,
    )
    required_trays = set(_selected_trays(pause))
    requested_trays = {normalize_text(code) for code in tray_codes if normalize_text(code)}
    if normalized_operation == "start":
        requested_trays = required_trays
        validate_mid_experiment_trays_ready_for_resume({
            "mes.samples": snapshot.get("samples", []),
            "mes.staging_events": snapshot.get("staging_events", []),
        }, pause)
    elif not requested_trays or not requested_trays.issubset(required_trays):
        raise ValueError("继续实验准备托盘与当前暂停记录不匹配")

    completed = completed_resume_preparation_actions(snapshot, run_no=run_no, pause_no=pause_no)
    already_completed = completed.get(action, set())
    pending_trays = requested_trays - already_completed
    if not pending_trays:
        return {
            "affectedSampleCount": 0,
            "affectedSamples": [],
            "affectedTrayCodes": sorted(requested_trays),
            "resumePreparation": True,
            "resumePreparationAction": action,
            "samples": list(snapshot.get("samples", [])),
            "stagingEvents": list(snapshot.get("staging_events", [])),
            "status": RESUME_PREPARATION_STATUS.get(action, PAUSED),
        }
    previous_action = RESUME_PREPARATION_PREVIOUS_ACTION.get(action)
    if previous_action and not pending_trays.issubset(completed.get(previous_action, set())):
        raise ValueError("继续实验准备步骤顺序不正确，请先完成前一步操作")
    if action in {RESUME_PREPARATION_INSTALL, RESUME_PREPARATION_READY} and requested_trays != required_trays:
        raise ValueError("继续实验准备必须包含当前暂停的全部托盘")

    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_run_no = normalize_text(run_no)
    normalized_pause_no = normalize_text(pause_no)
    event_time = format_business_datetime(occurred_at) or normalize_text(occurred_at) or now_business_text()
    events = [deepcopy(event) for event in as_list(snapshot.get("staging_events")) if isinstance(event, dict)]
    for tray_code in sorted(pending_trays):
        _append_event(
            events,
            action=action,
            task_code=normalized_task_code,
            experiment_code=normalized_experiment_code,
            run_no=normalized_run_no,
            pause_no=normalized_pause_no,
            tray_code=tray_code,
            occurred_at=event_time,
        )
        if normalize_text(fixture_install_id):
            events[-1]["fixture_install_id"] = normalize_text(fixture_install_id)

    samples = _copy_samples(snapshot)
    touched_samples: list[dict[str, Any]] = []
    next_status = RESUME_PREPARATION_STATUS.get(action, "")
    if next_status:
        for sample in samples:
            if _record_text(sample, "task_code", "task_no", "taskCode", "taskNo") != normalized_task_code:
                continue
            touched_codes = []
            for tray in as_list(sample.get("trays")):
                if not isinstance(tray, dict):
                    continue
                tray_code = _record_text(tray, "tray_code", "trayCode", "tray_no", "trayNo")
                if tray_code not in pending_trays:
                    continue
                tray["status"] = next_status
                tray["updated_at"] = event_time
                if action == RESUME_PREPARATION_FIXTURE_READY:
                    tray["fixture_ready"] = True
                    tray["fixtureReady"] = True
                elif action in {RESUME_PREPARATION_COMPARE, RESUME_PREPARATION_INSTALL}:
                    tray.pop("fixture_ready", None)
                    tray.pop("fixtureReady", None)
                touched_codes.append(tray_code)
            if not touched_codes:
                continue
            sample["status"] = next_status
            sample["flow_status"] = next_status
            sample["location"] = "盐雾试验室"
            sample["updated_at"] = event_time
            history_action = RESUME_PREPARATION_HISTORY.get(action)
            if history_action:
                history = [dict(entry) for entry in as_list(sample.get("history")) if isinstance(entry, dict)]
                sample["history"] = [
                    {
                        "action": history_action,
                        "detail": (
                            f"{normalized_task_code} / 继续实验准备 / {next_status} / 托盘：{tray_code}"
                            f" / run_no：{normalized_run_no} / pause_no：{normalized_pause_no}"
                        ),
                        "location": "盐雾试验室",
                        "status": next_status,
                        "time": event_time,
                    }
                    for tray_code in touched_codes
                ] + history
            touched_samples.append(sample)

    return {
        "affectedSampleCount": len(touched_samples),
        "affectedSamples": touched_samples,
        "affectedTrayCodes": sorted(pending_trays),
        "resumePreparation": True,
        "resumePreparationAction": action,
        "samples": merge_scoped_samples(snapshot.get("samples", []), samples),
        "stagingEvents": events,
        "status": next_status or PAUSED,
    }


def validate_salt_resume_preparation_ready(snapshot: dict[str, Any], pause: dict[str, Any]) -> None:
    run_no = _record_text(pause, "run_no", "runNo")
    pause_no = _record_text(pause, "pause_no", "pauseNo")
    required_trays = set(_selected_trays(pause))
    completed = completed_resume_preparation_actions(snapshot, run_no=run_no, pause_no=pause_no)
    missing = sorted(required_trays - completed.get(RESUME_PREPARATION_READY, set()))
    if missing:
        raise ValueError(f"继续实验前尚未完成重新比对、安装和准备就绪：{', '.join(missing)}")


def apply_salt_resume_confirmation(
    snapshot: dict[str, Any], *, pause: dict[str, Any], occurred_at: str
) -> dict[str, Any]:
    """Project an acknowledged resume back to the running tray workflow."""

    validate_salt_resume_preparation_ready(snapshot, pause)
    task_code = _record_text(pause, "task_code", "task_no", "taskCode")
    experiment_code = _record_text(pause, "experiment_code", "experiment_no", "experimentCode")
    run_no = _record_text(pause, "run_no", "runNo")
    pause_no = _record_text(pause, "pause_no", "pauseNo")
    required_trays = set(_selected_trays(pause))
    event_time = format_business_datetime(occurred_at) or normalize_text(occurred_at) or now_business_text()
    samples = _copy_samples(snapshot)
    touched_samples: list[dict[str, Any]] = []
    for sample in samples:
        if _record_text(sample, "task_code", "task_no", "taskCode", "taskNo") != task_code:
            continue
        touched_codes: list[str] = []
        for tray in as_list(sample.get("trays")):
            if not isinstance(tray, dict):
                continue
            tray_code = _record_text(tray, "tray_code", "trayCode", "tray_no", "trayNo")
            if tray_code not in required_trays:
                continue
            tray["status"] = "实验进行中"
            tray["updated_at"] = event_time
            touched_codes.append(tray_code)
        if not touched_codes:
            continue
        sample["status"] = "实验进行中"
        sample["flow_status"] = "实验进行中"
        sample["location"] = "盐雾试验室"
        sample["updated_at"] = event_time
        history = [dict(entry) for entry in as_list(sample.get("history")) if isinstance(entry, dict)]
        sample["history"] = [
            {
                "action": "继续实验",
                "detail": (
                    f"{task_code} / 盐雾试验 / 实验进行中 / 托盘：{tray_code}"
                    f" / run_no：{run_no} / pause_no：{pause_no}"
                ),
                "location": "盐雾试验室",
                "status": "实验进行中",
                "time": event_time,
            }
            for tray_code in touched_codes
        ] + history
        touched_samples.append(sample)

    if not touched_samples:
        raise ValueError("继续实验确认未找到当前暂停运行的托盘")
    return {
        "affectedSamples": touched_samples,
        "samples": merge_scoped_samples(snapshot.get("samples", []), samples),
    }
