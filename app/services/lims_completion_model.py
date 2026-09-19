"""Pure, tray-scoped completion snapshots. No transport or physical-device logic."""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from typing import Any

from app.core.axis_codes import canonical_axis_code
from app.services.attendance_time import parse_datetime, parse_business_datetime, format_beijing
from app.services.experiment_segments import record_sub_experiment_code
from app.services.laboratory_completion_rules import required_axis_codes_for_completion

COMPLETION_KEY = "mes.lims_completions"
COMPLETE = {"实验已完成", "实验完成", "实验已经完成"}
RESULT_KEYS = {"experimentRuns": "experiment_runs", "experimentRunTrays": "experiment_run_trays",
               "experimentRunSteps": "experiment_run_steps", "experiments": "experiments",
               "schedules": "schedules", "samples": "samples"}


def text(value: Any) -> str:
    return str(value or "").strip()


def identity(row: dict, kind: str) -> str:
    aliases = {"task": ("task_code", "task_no"), "experiment": ("experiment_code", "experiment_no"),
               "run": ("run_no", "runNo"), "tray": ("tray_code", "tray_no", "trayCode", "trayNo")}
    return next((text(row.get(key)) for key in aliases[kind] if text(row.get(key))), "")


def scoped(row: dict, task: str, experiment: str) -> bool:
    return identity(row, "task") == task and identity(row, "experiment") == experiment


def stable_id(*parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:32]


def ended(row: dict) -> bool:
    return text(row.get("status") or row.get("run_status") or row.get("run_tray_status")) in COMPLETE


def merged_snapshot(snapshot: dict, result: dict) -> dict:
    return {**snapshot, **{key: result[source] for source, key in RESULT_KEYS.items() if source in result}}


def tray_complete(snapshot: dict, task: str, experiment: str, tray: str) -> bool:
    relations = [row for row in snapshot.get("experiment_run_trays", [])
                 if scoped(row, task, experiment) and identity(row, "tray") == tray]
    runs = {identity(row, "run"): row for row in snapshot.get("experiment_runs", []) if scoped(row, task, experiment)}
    # Fault-cancelled/abnormal executions must never contribute completed axes.
    valid = {identity(row, "run") for row in relations if identity(row, "run") in runs
             and not any(word in text(runs[identity(row, "run")].get("status") or runs[identity(row, "run")].get("run_status"))
                         for word in ("取消", "异常", "终止"))}
    required = {canonical_axis_code(a) for a in required_axis_codes_for_completion(
        snapshot.get("experiments", []), snapshot.get("schedules", []), task_code=task, experiment_code=experiment)}
    completed_steps = [row for row in snapshot.get("experiment_run_steps", [])
                       if identity(row, "run") in valid and scoped(row, task, experiment) and ended(row)]
    if required:
        completed = {canonical_axis_code(row.get("axis_code") or row.get("axisCode"))
                     for row in completed_steps}
        if not required.issubset(completed):
            return False
    finished = [row for row in relations if identity(row, "run") in valid and ended(row) and ended(runs[identity(row, "run")])]
    if not finished and not required:
        return False
    required_subs = set()
    sub_axes = defaultdict(set)
    for schedule in snapshot.get("schedules", []):
        if not scoped(schedule, task, experiment) or "取消" in text(schedule.get("status")):
            continue
        trays = schedule.get("tray_codes") or schedule.get("trayCodes") or []
        if trays and tray not in trays:
            continue
        sub = record_sub_experiment_code(schedule)
        if sub:
            required_subs.add(sub)
            sub_axes[sub].update(canonical_axis_code(axis) for axis in schedule.get("axis_codes", schedule.get("axisCodes", [])))
    done_subs = {record_sub_experiment_code(runs[identity(row, "run")]) or record_sub_experiment_code(row) for row in finished}
    for sub in required_subs:
        axes = sub_axes[sub]
        if axes:
            done_axes = {canonical_axis_code(row.get("axis_code") or row.get("axisCode")) for row in completed_steps
                         if (record_sub_experiment_code(row) or record_sub_experiment_code(runs[identity(row, "run")])) == sub}
            if not axes.issubset(done_axes):
                return False
        elif sub not in done_subs:
            return False
    return True


def _window(start: Any, end: Any, *, attendance: bool = False):
    parser = parse_datetime if attendance else parse_business_datetime
    a, b = parser(start), parser(end)
    return (a, b) if a and b and b >= a else None


def union_seconds(windows: list) -> int:
    merged = []
    for a, b in sorted(windows):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else:
            merged.append((a, b))
    return sum(int((b - a).total_seconds()) for a, b in merged)


def execution_snapshot(snapshot: dict, task: str, experiment: str, trays: set[str]) -> list[dict]:
    bindings = defaultdict(set)
    for row in snapshot.get("experiment_run_trays", []):
        if scoped(row, task, experiment) and identity(row, "tray") in trays:
            bindings[identity(row, "run")].add(identity(row, "tray"))
    executions = []
    for run in snapshot.get("experiment_runs", []):
        number = identity(run, "run")
        if not scoped(run, task, experiment) or number not in bindings:
            continue
        if any(word in text(run.get("status") or run.get("run_status")) for word in ("取消", "异常", "终止")):
            continue
        steps = [s for s in snapshot.get("experiment_run_steps", []) if identity(s, "run") == number and scoped(s, task, experiment) and ended(s)]
        timings = steps if steps else ([run] if ended(run) else [])
        for timing in timings:
            axis = canonical_axis_code(timing.get("axis_code") or timing.get("axisCode"))
            start, end = timing.get("started_at"), timing.get("ended_at")
            window = _window(start, end)
            paused = []
            quality = "complete" if window else "missing_timestamps"
            if window:
                for pause in snapshot.get("experiment_run_pauses", []):
                    if identity(pause, "run") != number:
                        continue
                    pause_start = parse_business_datetime(pause.get("paused_at"))
                    pause_end = parse_business_datetime(pause.get("resumed_at") or pause.get("stopped_at")) or window[1]
                    if not pause_start or pause_end < pause_start:
                        quality = "invalid_pause_timestamps"
                    elif max(window[0], pause_start) < min(window[1], pause_end):
                        paused.append((max(window[0], pause_start), min(window[1], pause_end)))
            elapsed = int((window[1] - window[0]).total_seconds()) if window else None
            executions.append({
                "execution_id": stable_id(task, experiment, number, axis), "run_no": number,
                "sub_experiment_code": record_sub_experiment_code(run), "axis_code": axis,
                "lab_code": text(run.get("lab_code")), "device_code": text(run.get("device_code")),
                "device_name": text(run.get("device_name") or run.get("device")),
                "started_at": format_beijing(window[0]) if window else text(start) or None,
                "ended_at": format_beijing(window[1]) if window else text(end) or None,
                "elapsed_seconds": elapsed,
                "running_seconds": elapsed - union_seconds(paused) if quality == "complete" else None,
                "duration_source": "mqtt_events", "data_quality": quality,
                "tray_codes": sorted(bindings[number]),
            })
    return sorted(executions, key=lambda row: (row["started_at"] or "", row["execution_id"]))


def personnel_snapshot(executions: list[dict], intervals: list[dict], sessions: list[dict], cutoff: str) -> list[dict]:
    windows = defaultdict(list)
    run_nos = {e["run_no"] for e in executions}
    active_windows = defaultdict(list)
    for execution in executions:
        window = _window(execution["started_at"], execution["ended_at"])
        if window:
            windows[execution["run_no"]].append(window)
            active_windows[execution["run_no"]].append(window)
    # Attendance includes work between axes (e.g. fixture/axis adjustment),
    # while device running_seconds uses the individual active axis windows.
    windows = {run: [(min(a for a, _ in spans), max(b for _, b in spans))] for run, spans in windows.items()}
    session_by_id = {str(row.get("id")): row for row in sessions}
    people = {}
    for interval in intervals:
        run = identity(interval, "run")
        if run not in run_nos:
            continue
        raw = _window(interval.get("started_at"), interval.get("ended_at") or parse_business_datetime(cutoff), attendance=True)
        if not raw:
            continue
        cutoff_dt = parse_business_datetime(cutoff)
        if cutoff_dt:
            raw = (raw[0], min(raw[1], cutoff_dt))
        if raw[1] <= raw[0]:
            continue
        run_windows = windows.get(run) or [raw]
        clipped = [(max(raw[0], a), min(raw[1], b)) for a, b in run_windows if max(raw[0], a) < min(raw[1], b)]
        if not clipped:
            continue
        username = text(interval.get("username"))
        person = people.setdefault(username, {"username": username, "employee_name": text(interval.get("employee_name")),
            "sessions": [], "work_intervals": [], "attendance_seconds": 0, "login_seconds": 0,
            "between_axis_work_seconds": 0, "_login": [], "_work": [], "_active_work": [], "data_quality": []})
        if run not in windows:
            person["data_quality"].append("execution_window_missing_using_run_bound_attendance")
        # Stable ID distinguishes slices of a shared attendance interval across axes.
        for a, b in clipped:
            person["work_intervals"].append({"interval_id": stable_id(interval.get("id"), run, format_beijing(a), format_beijing(b)),
                "source_interval_id": interval.get("id"), "run_no": run, "started_at": format_beijing(a),
                "ended_at": format_beijing(b), "seconds": int((b-a).total_seconds())})
        person["_work"].extend(clipped)
        person["_active_work"].extend((max(a, x), min(b, y)) for a, b in clipped for x, y in active_windows[run]
                                      if max(a, x) < min(b, y))
        session = session_by_id.get(str(interval.get("session_id")))
        if not session:
            person["login_seconds"] = None
            continue
        session_id = session.get("id")
        cutoff_dt = parse_business_datetime(cutoff)
        logout = parse_datetime(session.get("logged_out_at"))
        effective_logout = logout if logout and cutoff_dt and logout <= cutoff_dt else None
        if not any(str(s["session_id"]) == str(session_id) for s in person["sessions"]):
            person["sessions"].append({"session_id": session_id, "logged_in_at": format_beijing(parse_datetime(session.get("logged_in_at"))),
                                      "logged_out_at": format_beijing(effective_logout), "cutoff_at": cutoff})
        session_window = _window(session.get("logged_in_at"), effective_logout or cutoff_dt, attendance=True)
        if session_window:
            person["_login"].extend((max(session_window[0], a), min(session_window[1], b)) for a, b in run_windows
                                    if max(session_window[0], a) < min(session_window[1], b))
        else:
            person["login_seconds"] = None
    for person in people.values():
        person["attendance_seconds"] = union_seconds(person.pop("_work"))
        active_work = union_seconds(person.pop("_active_work"))
        person["between_axis_work_seconds"] = max(0, person["attendance_seconds"] - active_work) if not person["data_quality"] else None
        login_windows = person.pop("_login")
        if person["login_seconds"] is not None:
            person["login_seconds"] = union_seconds(login_windows)
    return sorted(people.values(), key=lambda row: row["username"])


def build_completion(snapshot: dict, result: dict, task: str, experiment: str, run_no: str, completed_at: str,
                     existing: list[dict]) -> dict | None:
    after = merged_snapshot(snapshot, result)
    already = {tray for row in existing if row.get("task_code") == task and row.get("experiment_code") == experiment
               for tray in row.get("payload", {}).get("tray_codes", [])}
    candidates = set(result.get("affectedTrayCodes", []))
    trays = {tray for tray in candidates - already if tray_complete(after, task, experiment, tray)
             and not tray_complete(snapshot, task, experiment, tray)}
    if not trays:
        return None
    task_row = next((r for r in snapshot.get("tasks", []) if text(r.get("code") or r.get("task_code")) == task), {})
    experiment_row = next((r for r in snapshot.get("experiments", []) if scoped(r, task, experiment)), {})
    sample_scope = {text(r.get("sample_code") or r.get("sample_no")) for r in snapshot.get("experiment_samples", []) if scoped(r, task, experiment)}
    tray_items = []
    for tray in sorted(trays):
        samples = []
        for sample in snapshot.get("samples", []):
            code = text(sample.get("code") or sample.get("sample_code"))
            if identity(sample, "task") != task or (sample_scope and code not in sample_scope):
                continue
            bindings = {identity(sample, "tray"), *(identity(t, "tray") for t in sample.get("trays", []) if isinstance(t, dict))}
            if tray in bindings:
                samples.append({"sample_code": code, "sample_name": text(sample.get("name") or sample.get("sample_name")),
                                "sample_type": text(sample.get("sample_type") or sample.get("type"))})
        tray_items.append({"tray_code": tray, "samples": samples})
    executions = execution_snapshot(after, task, experiment, trays)
    completion_id = stable_id(task, experiment, run_no, sorted(trays))
    payload = {"completion_id": completion_id, "revision": 0, "code": task, "task_code": task,
        "task_name": text(task_row.get("name")), "task_source": text(task_row.get("source")),
        "lims_request_id": text(task_row.get("lims_request_id") or task_row.get("intake_id")),
        "experiment_code": experiment, "experiment_name": text(experiment_row.get("experiment_name")),
        "completed_at": format_beijing(parse_business_datetime(completed_at)) or completed_at,
        "tray_codes": sorted(trays), "trays": tray_items, "executions": executions,
        "personnel": [], "data_quality": []}
    expected = []
    for execution in executions:
        sample_codes = {s["sample_code"] for t in tray_items if t["tray_code"] in execution["tray_codes"] for s in t["samples"]}
        for sample_code in sorted(sample_codes):
            expected.append({"export_key": f"{execution['run_no']}|{execution['axis_code']}|{sample_code}",
                             "sample_code": sample_code, "run_no": execution["run_no"], "axis_code": execution["axis_code"]})
    if not executions or any(e["data_quality"] != "complete" for e in executions):
        payload["data_quality"].append("device_timing_incomplete")
    if any(not t["samples"] for t in tray_items):
        payload["data_quality"].append("sample_mapping_missing")
    return {"completion_id": completion_id, "task_code": task, "experiment_code": experiment,
            "payload": payload, "expected_files": expected, "state": "pending", "last_fingerprint": "",
            "report_snapshot": {key: after.get(key, []) for key in (
                "samples", "experiments", "schedules", "experiment_runs", "experiment_run_steps",
                "experiment_run_trays", "experiment_samples")}}
