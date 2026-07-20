from __future__ import annotations

from datetime import datetime
from typing import Any

from app.core.axis_codes import normalize_text
from app.core.time_utils import parse_business_datetime
from app.services.appearance_inspection import PRE_EXPERIMENT_APPEARANCE_STATUS


ALLOW_WITHDRAW_STATUSES = {"已到达实验室", "工装夹具安装", "实验准备就绪"}
COMPLETED_EXPERIMENT_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}
BLOCK_WITHDRAW_TRAY_STATUSES = {
    "实验进行中",
    "实验中",
    "实验已完成",
    "实验完成",
    "实验已经完成",
    "送至暂存间",
    "实验后暂存间存放",
    "送至外观检测间",
    "实验后外观检测间存放",
    "厂家收回",
}
STAGING_LOCATION = "恒温恒湿间（暂存间）"
APPEARANCE_LOCATION = "外观检测间"
APPEARANCE_STOCKED_STATUS = "实验后外观检测间存放"
WITHDRAWAL_HISTORY_ACTIONS = {"撤回出库", "实验任务撤回", "任务切换撤回"}


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def parse_datetime_value(value: Any) -> datetime | None:
    return parse_business_datetime(value)


def parse_experiment_history_detail(detail: Any, task_code: str) -> dict[str, str] | None:
    parts = [normalize_text(part) for part in normalize_text(detail).split(" / ") if normalize_text(part)]
    if len(parts) < 3 or parts[0] != task_code:
        return None
    status = parts[2]
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


def partial_axis_experiment_name(status: str) -> str:
    normalized = normalize_text(status)
    marker = "部分完成"
    if marker not in normalized or not normalized.endswith("轴"):
        return ""
    return normalize_text(normalized.split(marker, 1)[0])


def status_matches_current_partial_axis(status: str, current_experiment_name: str) -> bool:
    return bool(
        normalize_text(current_experiment_name)
        and partial_axis_experiment_name(status) == normalize_text(current_experiment_name)
    )


def is_withdrawable_laboratory_status(status: str, current_experiment_name: str = "") -> bool:
    return normalize_text(status) in ALLOW_WITHDRAW_STATUSES


def latest_current_experiment_withdrawable_history_status(
    sample: dict[str, Any],
    *,
    current_experiment_name: str,
    lab_name: str,
    task_code: str,
) -> str:
    current_name = normalize_text(current_experiment_name)
    normalized_lab_name = normalize_text(lab_name)
    latest_match: dict[str, Any] | None = None
    for entry in as_list(sample.get("history")):
        parsed = parse_experiment_history_detail(entry.get("detail"), task_code)
        if not parsed or parsed["experimentName"] != current_name:
            continue
        entry_location = normalize_text(entry.get("location"))
        if normalized_lab_name and entry_location != normalized_lab_name:
            continue
        entry_status = normalize_text(parsed["status"])
        if not is_withdrawable_laboratory_status(entry_status, current_name):
            continue
        entry_time = parse_datetime_value(entry.get("time")) or datetime.min
        if latest_match is None or entry_time >= latest_match["time"]:
            latest_match = {"status": entry_status, "time": entry_time}
    return normalize_text(latest_match.get("status")) if latest_match else ""


def status_has_current_experiment_progress(status: Any, current_experiment_name: str) -> bool:
    return status_matches_current_partial_axis(normalize_text(status), current_experiment_name)


def completed_axis_tray_codes(
    snapshot: dict[str, list[dict[str, Any]]],
    sample_matches: list[tuple[dict[str, Any], list[str]]],
    *,
    task_code: str,
    experiment_code: str,
    experiment_name: str,
    schedule_id: str = "",
    sub_experiment_code: str = "",
    axis_batch_no: int | str | None = None,
) -> list[str]:
    """Return selected trays that already contain progress for the current experiment.

    Status and history checks catch legacy or manually corrected rows. Run, tray-run,
    and step records make the restriction authoritative even when a current status was
    overwritten unexpectedly.
    """
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_schedule_id = normalize_text(schedule_id)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)

    def normalized_axis_batch_key(value: Any) -> str:
        normalized = normalize_text(value)
        if normalized.isdigit():
            return str(int(normalized))
        return normalized

    normalized_axis_batch_no = normalized_axis_batch_key(axis_batch_no)
    has_batch_scope = bool(normalized_schedule_id or normalized_sub_experiment_code or normalized_axis_batch_no)
    selected_codes = {
        normalize_text(tray_code)
        for _sample, tray_codes in sample_matches
        for tray_code in tray_codes
        if normalize_text(tray_code)
    }
    if not selected_codes:
        return []

    blocked_codes: set[str] = set()
    if not has_batch_scope:
        for sample, tray_codes in sample_matches:
            matched_codes = {normalize_text(tray_code) for tray_code in tray_codes if normalize_text(tray_code)}
            if status_has_current_experiment_progress(sample.get("status"), experiment_name):
                blocked_codes.update(matched_codes)
            for tray in as_list(sample.get("trays")):
                tray_code = normalize_text(tray.get("tray_code"))
                if tray_code in matched_codes and status_has_current_experiment_progress(tray.get("status"), experiment_name):
                    blocked_codes.add(tray_code)
            for entry in as_list(sample.get("history")):
                parsed = parse_experiment_history_detail(entry.get("detail"), normalized_task_code)
                if parsed and parsed["experimentName"] == normalize_text(experiment_name) and status_has_current_experiment_progress(
                    parsed["status"], experiment_name
                ):
                    blocked_codes.update(matched_codes)

    schedules_by_id = {
        normalize_text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("scheduleId")): schedule
        for schedule in snapshot["schedules"]
        if normalize_text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("scheduleId"))
    }
    runs_by_no = {
        normalize_text(run.get("run_no") or run.get("runNo") or run.get("id")): run
        for run in snapshot["experiment_runs"]
        if normalize_text(run.get("run_no") or run.get("runNo") or run.get("id"))
    }

    def record_matches_batch_scope(record: dict[str, Any], run: dict[str, Any] | None = None) -> bool:
        if not has_batch_scope:
            return True
        related_run = run or {}
        record_schedule_id = normalize_text(
            record.get("schedule_id")
            or record.get("scheduleId")
            or record.get("schedule_no")
            or related_run.get("schedule_id")
            or related_run.get("scheduleId")
            or related_run.get("schedule_no")
        )
        schedule = schedules_by_id.get(record_schedule_id, {})
        record_sub_experiment_code = normalize_text(
            record.get("sub_experiment_code")
            or record.get("subExperimentCode")
            or related_run.get("sub_experiment_code")
            or related_run.get("subExperimentCode")
            or schedule.get("sub_experiment_code")
            or schedule.get("subExperimentCode")
        )
        record_axis_batch_no = normalized_axis_batch_key(
            record.get("axis_batch_no")
            or record.get("axisBatchNo")
            or related_run.get("axis_batch_no")
            or related_run.get("axisBatchNo")
            or schedule.get("axis_batch_no")
            or schedule.get("axisBatchNo")
        )
        matched_identifier = False
        for requested, actual in (
            (normalized_schedule_id, record_schedule_id),
            (normalized_sub_experiment_code, record_sub_experiment_code),
            (normalized_axis_batch_no, record_axis_batch_no),
        ):
            if not requested or not actual:
                continue
            matched_identifier = True
            if requested != actual:
                return False
        return matched_identifier

    tray_codes_by_run: dict[str, set[str]] = {}
    for relation in snapshot["experiment_run_trays"]:
        if (
            normalize_text(relation.get("task_code") or relation.get("task_no")) != normalized_task_code
            or normalize_text(relation.get("experiment_code") or relation.get("experiment_no")) != normalized_experiment_code
        ):
            continue
        tray_code = normalize_text(relation.get("tray_code") or relation.get("tray_no"))
        if tray_code not in selected_codes:
            continue
        run_no = normalize_text(relation.get("run_no") or relation.get("runNo"))
        related_run = runs_by_no.get(run_no, {})
        if not record_matches_batch_scope(relation, related_run):
            continue
        if run_no:
            tray_codes_by_run.setdefault(run_no, set()).add(tray_code)
        if normalize_text(relation.get("status") or relation.get("run_tray_status")) in COMPLETED_EXPERIMENT_STATUSES:
            blocked_codes.add(tray_code)

    for run in snapshot["experiment_runs"]:
        if (
            normalize_text(run.get("task_code") or run.get("task_no")) != normalized_task_code
            or normalize_text(run.get("experiment_code") or run.get("experiment_no")) != normalized_experiment_code
            or normalize_text(run.get("status")) not in COMPLETED_EXPERIMENT_STATUSES
            or not record_matches_batch_scope(run, run)
        ):
            continue
        blocked_codes.update(tray_codes_by_run.get(normalize_text(run.get("run_no") or run.get("runNo") or run.get("id")), set()))

    for step in snapshot["experiment_run_steps"]:
        if normalize_text(step.get("status")) not in COMPLETED_EXPERIMENT_STATUSES:
            continue
        run_no = normalize_text(step.get("run_no") or step.get("runNo"))
        if not record_matches_batch_scope(step, runs_by_no.get(run_no, {})):
            continue
        blocked_codes.update(tray_codes_by_run.get(run_no, set()))

    return sorted(blocked_codes)


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
    current_name = normalize_text(current_experiment_name)
    for sample, matched_tray_codes in sample_matches:
        matched_code_set = set(matched_tray_codes)
        withdrawable_codes: list[str] = []
        history_withdrawable_status = latest_current_experiment_withdrawable_history_status(
            sample,
            current_experiment_name=current_experiment_name,
            lab_name=lab_name,
            task_code=task_code,
        )
        for tray in as_list(sample.get("trays")):
            tray_code = normalize_text(tray.get("tray_code"))
            if tray_code not in matched_code_set:
                continue
            target_experiment_code = normalize_text(tray.get("target_experiment_code") or tray.get("targetExperimentCode"))
            target_lab = normalize_text(tray.get("target_lab") or tray.get("targetLab"))
            stale_target_matches_current = single_tray_sample_matches_current_with_stale_target(
                sample,
                current_experiment_name=current_experiment_name,
                lab_name=lab_name,
                task_code=task_code,
            )
            history_matches_this_tray = bool(history_withdrawable_status) and (
                not target_lab or not normalized_lab_name or target_lab == normalized_lab_name
            )
            stale_target_matches_current = stale_target_matches_current or history_matches_this_tray
            if target_experiment_code and target_experiment_code != normalized_experiment_code and not stale_target_matches_current:
                continue
            if target_lab and normalized_lab_name and target_lab != normalized_lab_name and not stale_target_matches_current:
                continue
            sample_status = normalize_text(sample.get("status"))
            tray_status = normalize_text(tray.get("status"))
            if tray_status in BLOCK_WITHDRAW_TRAY_STATUSES:
                continue
            if is_withdrawable_laboratory_status(tray_status, current_name):
                current_status = tray_status
            elif is_withdrawable_laboratory_status(sample_status, current_name):
                current_status = sample_status
            else:
                current_status = history_withdrawable_status
            if is_withdrawable_laboratory_status(current_status, current_name):
                withdrawable_codes.append(tray_code)
        if withdrawable_codes:
            result.append((sample, sorted(set(withdrawable_codes))))
    return result
