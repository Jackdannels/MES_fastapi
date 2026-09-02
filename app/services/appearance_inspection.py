from __future__ import annotations

from datetime import datetime
from typing import Any


APPEARANCE_INSPECTION_LOCATION = "外观检测间"
APPEARANCE_INSPECTION_DISPATCH_STATUS = "送至外观检测间"
APPEARANCE_INSPECTION_STOCKED_STATUS = "实验后外观检测间存放"
PRE_EXPERIMENT_APPEARANCE_STATUS = "实验前外观检测间存放"
MID_EXPERIMENT_APPEARANCE_STATUS = "中途外观检查中"
MID_EXPERIMENT_RETURNED_STATUS = "等待恢复实验"
MID_EXPERIMENT_APPEARANCE_PHASE = "mid_experiment"
POST_EXPERIMENT_APPEARANCE_PHASE = "post_experiment"
EXPERIMENT_RUN_PAUSES_KEY = "mes.experiment_run_pauses"
APPEARANCE_REQUIRED_KEYWORDS = ("盐雾", "霉菌", "高低温湿热")
APPEARANCE_EVENT_ROOM = "appearance"
APPEARANCE_STOCK_IN_ACTION = "stock_in"
APPEARANCE_STOCK_OUT_ACTION = "stock_out"
STOCK_OUT_WITHDRAW_ACTION = "stock_out_withdraw"
LAB_DISPATCHED_STATUS = "送至实验室"
POST_EXPERIMENT_STAGING_STOCKED_STATUS = "实验后暂存间存放"

HANDOVER_LOCATION_KEYWORDS = ("接驳区",)
HANDOVER_STORED_STATUSES = {"到货"}
STAGING_LOCATION_KEYWORD = "暂存间"
STAGING_STORED_STATUSES = {
    "已到达暂存间",
    POST_EXPERIMENT_STAGING_STOCKED_STATUS,
}


def record_text(record: Any, *keys: str) -> str:
    if not isinstance(record, dict):
        return ""
    for key in keys:
        value = normalize_text(record.get(key))
        if value:
            return value
    return ""


def _selected_inspection_trays(pause: Any) -> set[str]:
    if not isinstance(pause, dict):
        return set()
    values = pause.get("inspection_tray_codes")
    if not isinstance(values, list):
        values = pause.get("inspectionTrayCodes")
    return {normalize_text(value) for value in as_list(values) if normalize_text(value)}


def resolve_mid_experiment_appearance_context(snapshot: Any, tray_code: Any) -> dict[str, Any] | None:
    """Resolve the single open salt-spray pause authorizing a tray inspection."""

    if not isinstance(snapshot, dict):
        return None
    normalized_tray_code = normalize_text(tray_code)
    if not normalized_tray_code:
        return None
    runs = as_list(snapshot.get("mes.experiment_runs"))
    run_trays = as_list(snapshot.get("mes.experiment_run_trays"))
    pauses = as_list(snapshot.get(EXPERIMENT_RUN_PAUSES_KEY))
    contexts: list[dict[str, Any]] = []
    for pause in pauses:
        if not isinstance(pause, dict) or record_text(pause, "status") != "实验暂停":
            continue
        if normalized_tray_code not in _selected_inspection_trays(pause):
            continue
        run_no = record_text(pause, "run_no", "runNo")
        pause_no = record_text(pause, "pause_no", "pauseNo")
        if not run_no or not pause_no:
            continue
        run = next(
            (
                item
                for item in runs
                if isinstance(item, dict)
                and record_text(item, "run_no", "runNo") == run_no
                and record_text(item, "status", "run_status", "runStatus") == "实验暂停"
            ),
            None,
        )
        if run is None:
            continue
        belongs_to_run = any(
            isinstance(relation, dict)
            and record_text(relation, "run_no", "runNo") == run_no
            and record_text(relation, "tray_code", "trayCode", "tray_no", "trayNo") == normalized_tray_code
            for relation in run_trays
        )
        if not belongs_to_run:
            continue
        lab_code = record_text(pause, "lab_code", "labCode")
        lab_name = record_text(run, "device", "device_name", "deviceName", "lab_name", "labName")
        if lab_code != "LAB_SALT" and "盐雾" not in lab_name:
            continue
        contexts.append(
            {
                "experiment_code": record_text(pause, "experiment_code", "experimentCode")
                or record_text(run, "experiment_code", "experimentCode", "experiment_no", "experimentNo"),
                "lab_code": lab_code or "LAB_SALT",
                "lab_id": run.get("lab_id", run.get("labId", "")),
                "lab_name": lab_name or "盐雾试验室",
                "pause_no": pause_no,
                "run_no": run_no,
                "schedule_id": record_text(run, "schedule_id", "scheduleId", "schedule_no", "scheduleNo"),
                "task_code": record_text(pause, "task_code", "taskCode")
                or record_text(run, "task_code", "taskCode", "task_no", "taskNo"),
            }
        )
    return contexts[0] if len(contexts) == 1 else None


def _latest_mid_experiment_events(snapshot: Any, *, tray_code: str, run_no: str, pause_no: str) -> list[dict[str, Any]]:
    events = []
    for index, event in enumerate(as_list(snapshot.get("mes.staging_events")) if isinstance(snapshot, dict) else []):
        if not isinstance(event, dict):
            continue
        if staging_event_room(event) != APPEARANCE_EVENT_ROOM:
            continue
        if record_text(event, "appearance_phase", "appearancePhase") != MID_EXPERIMENT_APPEARANCE_PHASE:
            continue
        if record_text(event, "tray_code", "trayCode") != tray_code:
            continue
        if record_text(event, "run_no", "runNo") != run_no or record_text(event, "pause_no", "pauseNo") != pause_no:
            continue
        events.append((parse_datetime_value(event.get("time")) or datetime.min, index, event))
    events.sort(key=lambda item: (item[0], item[1]))
    return [event for _, _, event in events]


def latest_mid_experiment_appearance_action(snapshot: Any, *, tray_code: str, run_no: str, pause_no: str) -> str:
    events = _latest_mid_experiment_events(snapshot, tray_code=tray_code, run_no=run_no, pause_no=pause_no)
    return record_text(events[-1], "action") if events else ""


def _snapshot_rows(snapshot: Any, name: str) -> list[Any]:
    if not isinstance(snapshot, dict):
        return []
    storage_key = f"mes.{name}"
    return as_list(snapshot.get(storage_key) if storage_key in snapshot else snapshot.get(name))


def _latest_mid_experiment_event_for_run(snapshot: Any, *, tray_code: str, run_no: str) -> dict[str, Any] | None:
    candidates: list[tuple[datetime, int, dict[str, Any]]] = []
    for index, event in enumerate(_snapshot_rows(snapshot, "staging_events")):
        if not isinstance(event, dict):
            continue
        if staging_event_room(event) != APPEARANCE_EVENT_ROOM:
            continue
        if record_text(event, "appearance_phase", "appearancePhase") != MID_EXPERIMENT_APPEARANCE_PHASE:
            continue
        if record_text(event, "tray_code", "trayCode") != normalize_text(tray_code):
            continue
        if record_text(event, "run_no", "runNo") != normalize_text(run_no):
            continue
        candidates.append((parse_datetime_value(event.get("time")) or datetime.min, index, event))
    candidates.sort(key=lambda item: (item[0], item[1]))
    return candidates[-1][2] if candidates else None


def mid_experiment_appearance_stocked_trays_for_run(
    snapshot: Any,
    *,
    run_no: str,
    tray_codes: set[str],
) -> set[str]:
    """Return run trays that are still physically stocked in the appearance room."""

    normalized_run_no = normalize_text(run_no)
    candidates = {normalize_text(code) for code in tray_codes if normalize_text(code)}
    if not normalized_run_no or not candidates:
        return set()
    samples = _snapshot_rows(snapshot, "samples")
    stocked: set[str] = set()
    for tray_code in candidates:
        latest_event = _latest_mid_experiment_event_for_run(
            snapshot,
            tray_code=tray_code,
            run_no=normalized_run_no,
        )
        if record_text(latest_event, "action") != APPEARANCE_STOCK_IN_ACTION:
            continue
        physically_stocked = any(
            isinstance(sample, dict)
            and normalize_text(sample.get("location")) == APPEARANCE_INSPECTION_LOCATION
            and any(
                isinstance(tray, dict)
                and tray_code_text(tray) == tray_code
                and status_text(tray) == MID_EXPERIMENT_APPEARANCE_STATUS
                for tray in as_list(sample.get("trays"))
            )
            for sample in samples
        )
        if physically_stocked:
            stocked.add(tray_code)
    return stocked


def completion_transitioned_appearance_stocked_trays_for_run(
    snapshot: Any,
    *,
    run_no: str,
    tray_codes: set[str],
) -> set[str]:
    """Return trays already moved from mid- to post-experiment appearance stock."""

    normalized_run_no = normalize_text(run_no)
    candidates = {normalize_text(code) for code in tray_codes if normalize_text(code)}
    if not normalized_run_no or not candidates:
        return set()
    samples = _snapshot_rows(snapshot, "samples")
    events = _snapshot_rows(snapshot, "staging_events")
    stocked: set[str] = set()
    for tray_code in candidates:
        physically_stocked = any(
            isinstance(sample, dict)
            and normalize_text(sample.get("location")) == APPEARANCE_INSPECTION_LOCATION
            and any(
                isinstance(tray, dict)
                and tray_code_text(tray) == tray_code
                and status_text(tray) == APPEARANCE_INSPECTION_STOCKED_STATUS
                for tray in as_list(sample.get("trays"))
            )
            for sample in samples
        )
        if not physically_stocked:
            continue
        already_transitioned = any(
            isinstance(event, dict)
            and staging_event_room(event) == APPEARANCE_EVENT_ROOM
            and record_text(event, "tray_code", "trayCode") == tray_code
            and record_text(event, "run_no", "runNo") == normalized_run_no
            and record_text(event, "action") == APPEARANCE_STOCK_IN_ACTION
            and record_text(event, "appearance_phase", "appearancePhase") == POST_EXPERIMENT_APPEARANCE_PHASE
            and record_text(event, "source") == "experiment_completion"
            for event in events
        )
        if already_transitioned:
            stocked.add(tray_code)
    return stocked


def completed_mid_experiment_appearance_stock_is_recoverable(snapshot: Any, *, tray_code: str) -> bool:
    """Recognize rows stranded by the legacy completion/status mismatch.

    Recovery is deliberately narrow: the tray must still be in the appearance
    room, its latest mid-inspection event must be a stock-in, and that exact
    pause/run must have ended normally via completion criteria.
    """

    normalized_tray_code = normalize_text(tray_code)
    completed_statuses = {"实验已完成", "实验完成", "实验已经完成"}
    matching_samples = [
        sample
        for sample in _snapshot_rows(snapshot, "samples")
        if isinstance(sample, dict)
        and normalize_text(sample.get("location")) == APPEARANCE_INSPECTION_LOCATION
        and any(
            isinstance(tray, dict)
            and tray_code_text(tray) == normalized_tray_code
            and status_text(tray) in completed_statuses
            for tray in as_list(sample.get("trays"))
        )
    ]
    if not matching_samples:
        return False

    events: list[tuple[datetime, int, dict[str, Any]]] = []
    for index, event in enumerate(_snapshot_rows(snapshot, "staging_events")):
        if not isinstance(event, dict):
            continue
        if staging_event_room(event) != APPEARANCE_EVENT_ROOM:
            continue
        if record_text(event, "appearance_phase", "appearancePhase") != MID_EXPERIMENT_APPEARANCE_PHASE:
            continue
        if record_text(event, "tray_code", "trayCode") != normalized_tray_code:
            continue
        events.append((parse_datetime_value(event.get("time")) or datetime.min, index, event))
    events.sort(key=lambda item: (item[0], item[1]))
    latest_event = events[-1][2] if events else None
    if record_text(latest_event, "action") != APPEARANCE_STOCK_IN_ACTION:
        return False
    run_no = record_text(latest_event, "run_no", "runNo")
    pause_no = record_text(latest_event, "pause_no", "pauseNo")
    if not run_no or not pause_no:
        return False

    pause_completed_normally = any(
        isinstance(pause, dict)
        and record_text(pause, "pause_no", "pauseNo") == pause_no
        and record_text(pause, "run_no", "runNo") == run_no
        and record_text(pause, "status", "pause_status", "pauseStatus") == "实验已停止"
        and record_text(pause, "termination_type", "terminationType") == "completion_criteria"
        for pause in _snapshot_rows(snapshot, "experiment_run_pauses")
    )
    run_completed = any(
        isinstance(run, dict)
        and record_text(run, "run_no", "runNo", "id") == run_no
        and record_text(run, "status", "run_status", "runStatus") in completed_statuses
        for run in _snapshot_rows(snapshot, "experiment_runs")
    )
    relation_completed = any(
        isinstance(relation, dict)
        and record_text(relation, "run_no", "runNo") == run_no
        and record_text(relation, "tray_code", "trayCode", "tray_no", "trayNo") == normalized_tray_code
        and record_text(relation, "run_tray_status", "runTrayStatus", "status") in completed_statuses
        for relation in _snapshot_rows(snapshot, "experiment_run_trays")
    )
    return pause_completed_normally and run_completed and relation_completed


def validate_mid_experiment_trays_ready_for_resume(snapshot: Any, pause_record: Any) -> None:
    """Reject resume until every selected inspection tray has a result and has returned."""

    if not isinstance(snapshot, dict) or not isinstance(pause_record, dict):
        raise ValueError("盐雾暂停记录无效，不能恢复实验。")
    run_no = record_text(pause_record, "run_no", "runNo")
    pause_no = record_text(pause_record, "pause_no", "pauseNo")
    selected_trays = sorted(_selected_inspection_trays(pause_record))
    if not selected_trays:
        return
    samples = as_list(snapshot.get("mes.samples"))
    not_ready: list[str] = []
    for tray_code in selected_trays:
        events = _latest_mid_experiment_events(snapshot, tray_code=tray_code, run_no=run_no, pause_no=pause_no)
        last_event = events[-1] if events else None
        has_result = (
            isinstance(last_event, dict)
            and record_text(last_event, "action") == APPEARANCE_STOCK_OUT_ACTION
        )
        returned = (
            isinstance(last_event, dict)
            and record_text(last_event, "action") == APPEARANCE_STOCK_OUT_ACTION
            and record_text(last_event, "target_lab_code", "targetLabCode") == "LAB_SALT"
        )
        sample_returned = any(
            isinstance(sample, dict)
            and normalize_text(sample.get("location")) == record_text(last_event, "target_lab", "targetLab")
            and any(
                isinstance(tray, dict)
                and tray_code_text(tray) == tray_code
                and status_text(tray) == MID_EXPERIMENT_RETURNED_STATUS
                for tray in as_list(sample.get("trays"))
            )
            for sample in samples
        )
        if not (has_result and returned and sample_returned):
            not_ready.append(tray_code)
    if not_ready:
        raise ValueError(f"中途外观检查托盘尚未全部返回盐雾试验室：{', '.join(not_ready)}")


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def parse_datetime_value(value: Any) -> datetime | None:
    normalized = normalize_text(value)
    if not normalized:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        try:
            return datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None


def staging_event_room(event: Any) -> str:
    if not isinstance(event, dict):
        return ""
    return normalize_text(event.get("room") or event.get("storage_room") or event.get("storageRoom"))


def status_text(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return normalize_text(value.get("status")) or normalize_text(value.get("flow_status"))


def tray_code_text(tray: Any) -> str:
    if not isinstance(tray, dict):
        return ""
    return normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))


def experiment_requires_appearance_inspection(experiment_name: Any, experiment: dict[str, Any] | None = None) -> bool:
    texts = [
        experiment_name,
        (experiment or {}).get("experiment_name"),
        (experiment or {}).get("experiment_type"),
        (experiment or {}).get("test_type"),
        (experiment or {}).get("required_device"),
    ]
    joined = " / ".join(normalize_text(text) for text in texts if normalize_text(text))
    return any(keyword in joined for keyword in APPEARANCE_REQUIRED_KEYWORDS)


def experiment_name_by_code(experiments: Any, experiment_code: Any) -> str:
    normalized_code = normalize_text(experiment_code)
    if not normalized_code:
        return ""
    for experiment in experiments if isinstance(experiments, list) else []:
        if not isinstance(experiment, dict):
            continue
        if normalize_text(experiment.get("experiment_code") or experiment.get("experiment_no")) != normalized_code:
            continue
        return (
            normalize_text(experiment.get("experiment_name"))
            or normalize_text(experiment.get("experiment_type"))
            or normalize_text(experiment.get("test_type"))
            or normalize_text(experiment.get("required_device"))
        )
    return ""


def target_requires_appearance_inspection(
    *,
    target_lab: Any,
    target_experiment_code: Any,
    experiments: Any,
) -> bool:
    target_lab_name = normalize_text(target_lab)
    if any(keyword in target_lab_name for keyword in APPEARANCE_REQUIRED_KEYWORDS):
        return True
    experiment_name = experiment_name_by_code(experiments, target_experiment_code)
    return experiment_requires_appearance_inspection(experiment_name)


def source_is_handover_or_staging(*, source_location: Any, source_status: Any) -> bool:
    location = normalize_text(source_location)
    status = normalize_text(source_status)
    if location == APPEARANCE_INSPECTION_LOCATION or status in {
        PRE_EXPERIMENT_APPEARANCE_STATUS,
        APPEARANCE_INSPECTION_DISPATCH_STATUS,
        APPEARANCE_INSPECTION_STOCKED_STATUS,
    }:
        return False
    if any(keyword in location for keyword in HANDOVER_LOCATION_KEYWORDS) or status in HANDOVER_STORED_STATUSES:
        return True
    return STAGING_LOCATION_KEYWORD in location or status in STAGING_STORED_STATUSES


def should_route_pre_experiment_appearance(
    *,
    source_location: Any,
    source_status: Any,
    target_lab: Any,
    target_experiment_code: Any,
    experiments: Any,
) -> bool:
    return source_is_handover_or_staging(source_location=source_location, source_status=source_status) and target_requires_appearance_inspection(
        target_lab=target_lab,
        target_experiment_code=target_experiment_code,
        experiments=experiments,
    )


def appearance_flow_markers(sample: Any, staging_events: Any, tray_code: str) -> list[tuple[datetime, int, str]]:
    markers: list[tuple[datetime, int, str]] = []
    normalized_tray_code = normalize_text(tray_code)
    if not normalized_tray_code:
        return markers

    task_code = normalize_text(sample.get("task_code") or sample.get("task_no")) if isinstance(sample, dict) else ""
    sequence = 0
    for event in as_list(staging_events):
        if not isinstance(event, dict):
            continue
        if staging_event_room(event) != APPEARANCE_EVENT_ROOM:
            continue
        if normalize_text(event.get("tray_code") or event.get("trayCode")) != normalized_tray_code:
            continue
        event_task_code = normalize_text(event.get("task_code") or event.get("taskCode") or event.get("task_no") or event.get("taskNo"))
        if task_code and event_task_code and event_task_code != task_code:
            continue
        action = normalize_text(event.get("action"))
        if action not in {APPEARANCE_STOCK_IN_ACTION, APPEARANCE_STOCK_OUT_ACTION, STOCK_OUT_WITHDRAW_ACTION}:
            continue
        markers.append((parse_datetime_value(event.get("time")) or datetime.min, sequence, action))
        sequence += 1

    if isinstance(sample, dict):
        for entry in as_list(sample.get("history")):
            if not isinstance(entry, dict):
                continue
            action = normalize_text(entry.get("action"))
            marker_action = ""
            if action == "外观检测间扫码入库":
                marker_action = APPEARANCE_STOCK_IN_ACTION
            elif action == "外观检测间扫码出库":
                marker_action = APPEARANCE_STOCK_OUT_ACTION
            elif action in {"撤回出库", "实验任务撤回", "任务切换撤回"}:
                marker_action = STOCK_OUT_WITHDRAW_ACTION
            if not marker_action:
                continue
            detail = normalize_text(entry.get("detail"))
            entry_tray_code = normalize_text(entry.get("tray_code") or entry.get("trayCode"))
            if normalized_tray_code not in detail and entry_tray_code not in {"", normalized_tray_code}:
                continue
            markers.append((parse_datetime_value(entry.get("time")) or datetime.min, sequence, marker_action))
            sequence += 1

    markers.sort(key=lambda marker: (marker[0], marker[1]))
    return markers


def pre_experiment_appearance_already_dispatched(
    sample: Any,
    tray: Any,
    staging_events: Any,
    *,
    target_experiment_code: Any = "",
) -> bool:
    if not isinstance(sample, dict) or not isinstance(tray, dict):
        return False
    sample_statuses = {
        normalize_text(sample.get("status")),
        normalize_text(sample.get("flow_status")),
    }
    if status_text(tray) != LAB_DISPATCHED_STATUS and LAB_DISPATCHED_STATUS not in sample_statuses:
        return False
    target_code = normalize_text(target_experiment_code) or normalize_text(
        tray.get("target_experiment_code")
        or tray.get("targetExperimentCode")
        or tray.get("experiment_code")
        or tray.get("experimentCode")
    )
    if not target_code:
        return False

    task_code = normalize_text(sample.get("task_code") or sample.get("task_no"))
    tray_code = tray_code_text(tray)
    events: list[tuple[datetime, int, dict[str, Any]]] = []
    for index, event in enumerate(as_list(staging_events)):
        if not isinstance(event, dict) or staging_event_room(event) != APPEARANCE_EVENT_ROOM:
            continue
        if normalize_text(event.get("tray_code") or event.get("trayCode")) != tray_code:
            continue
        event_task_code = normalize_text(event.get("task_code") or event.get("taskCode") or event.get("task_no") or event.get("taskNo"))
        if task_code and event_task_code and event_task_code != task_code:
            continue
        events.append((parse_datetime_value(event.get("time")) or datetime.min, index, event))
    events.sort(key=lambda item: (item[0], item[1]))

    dispatched = False
    for _, _, event in events:
        action = normalize_text(event.get("action"))
        phase = normalize_text(event.get("appearance_phase") or event.get("appearancePhase"))
        event_target_code = normalize_text(
            event.get("target_experiment_code")
            or event.get("targetExperimentCode")
            or event.get("experiment_code")
            or event.get("experimentCode")
        )
        if event_target_code != target_code:
            continue
        if action in {APPEARANCE_STOCK_IN_ACTION, APPEARANCE_STOCK_OUT_ACTION} and phase == "pre_experiment":
            dispatched = True
    return dispatched
