import copy
from datetime import datetime, timezone

import pytest

from app.services.lims_completion_model import (
    COMPLETION_KEY, build_completion, execution_snapshot, merged_snapshot,
    personnel_snapshot, tray_complete,
)
from app.services.lims_completion import prepare_completion_updates, materialize_completions, resolve_completion_file
from app.services.lims_http import LIMS_OUTBOX_KEY


def snapshot(axis=True):
    scope = {"task_code": "T1", "experiment_code": "E1"}
    return {
        "tasks": [{"code": "T1", "name": "task", "source": "内部任务"}],
        "experiments": [{**scope, "experiment_name": "振动试验" if axis else "盐雾试验", "axis_codes": ["x", "y+"] if axis else []}],
        "schedules": [],
        "experiment_runs": [{**scope, "run_no": "R1", "status": "实验进行中", "device": "振动一室",
                             "started_at": "2026-09-18 09:00:00", "ended_at": "", "axis_codes": ["x", "y+"] if axis else []}],
        "experiment_run_trays": [{**scope, "run_no": "R1", "tray_code": tray, "status": "实验进行中"} for tray in ["P1", "P2"]],
        "experiment_run_steps": [{**scope, "run_no": "R1", "axis_code": a, "status": "实验进行中",
                                  "started_at": start, "ended_at": ""} for a, start in [("x", "2026-09-18 09:00:00"), ("y+", "2026-09-18 10:00:00")]] if axis else [],
        "experiment_samples": [{**scope, "sample_code": code} for code in ["S1", "S2"]],
        "samples": [{"task_code": "T1", "code": f"S{i}", "name": f"sample{i}", "sample_type": "组件", "trays": [{"tray_code": f"P{i}"}]} for i in [1, 2]],
    }


def completion_result(before, *, all_axes=True, trays=None):
    result = {"affectedTrayCodes": trays or ["P1", "P2"],
              "experimentRuns": copy.deepcopy(before["experiment_runs"]),
              "experimentRunTrays": copy.deepcopy(before["experiment_run_trays"]),
              "experimentRunSteps": copy.deepcopy(before["experiment_run_steps"])}
    for step in result["experimentRunSteps"]:
        if step["axis_code"] == "x" or all_axes:
            step.update(status="实验已完成", ended_at="2026-09-18 09:30:00" if step["axis_code"] == "x" else "2026-09-18 11:00:00")
    if all_axes:
        result["experimentRuns"][0].update(status="实验已完成", ended_at="2026-09-18 11:00:00")
        for relation in result["experimentRunTrays"]:
            if relation["tray_code"] in result["affectedTrayCodes"]:
                relation["status"] = "实验已完成"
    return result


def build(before, result, existing=None):
    return build_completion(before, result, "T1", "E1", "R1", "2026-09-18 11:00:00", existing or [])


def test_intent_only_after_all_axes_and_contains_all_axes_without_tray_time_multiplication():
    before = snapshot()
    assert build(before, completion_result(before, all_axes=False)) is None
    record = build(before, completion_result(before))
    assert record["payload"]["tray_codes"] == ["P1", "P2"]
    assert [e["axis_code"] for e in record["payload"]["executions"]] == ["x", "y+"]
    assert sum(e["running_seconds"] for e in record["payload"]["executions"]) == 5400
    assert len(record["expected_files"]) == 4
    assert record["payload"]["trays"][0]["samples"][0]["sample_code"] == "S1"
    assert build(before, completion_result(before), [record]) is None


def test_partial_tray_batch_sends_only_new_completed_tray():
    before = snapshot(axis=False)
    result = completion_result(before, trays=["P1"])
    first = build(before, result)
    assert first["payload"]["tray_codes"] == ["P1"]
    assert len(first["expected_files"]) == 1
    after = merged_snapshot(before, result)
    result2 = completion_result(after, trays=["P2"])
    second = build(after, result2, [first])
    assert second["payload"]["tray_codes"] == ["P2"]
    assert first["payload"]["executions"][0]["execution_id"] == second["payload"]["executions"][0]["execution_id"]
    assert build(merged_snapshot(after, result2), result2, [first, second]) is None


def test_axes_from_other_tray_never_satisfy_this_tray():
    data = snapshot()
    scope = {"task_code": "T1", "experiment_code": "E1"}
    data["experiment_run_trays"] = [{**scope, "run_no": "R1", "tray_code": "P1"}, {**scope, "run_no": "R2", "tray_code": "P2"}]
    data["experiment_runs"].append({**scope, "run_no": "R2", "status": "实验已完成"})
    data["experiment_run_steps"][0]["status"] = "实验已完成"
    data["experiment_run_steps"][1].update(run_no="R2", status="实验已完成")
    assert not tray_complete(data, "T1", "E1", "P1")
    assert not tray_complete(data, "T1", "E1", "P2")


def test_axis_completion_across_runs_aggregates_all_executions():
    before = snapshot()
    scope = {"task_code": "T1", "experiment_code": "E1"}
    before["experiment_runs"].append({**scope, "run_no": "R2", "status": "实验进行中"})
    before["experiment_run_trays"].append({**scope, "run_no": "R2", "tray_code": "P1"})
    before["experiment_run_trays"] = [r for r in before["experiment_run_trays"] if r["tray_code"] == "P1"]
    before["experiment_run_steps"][0].update(status="实验已完成", ended_at="2026-09-18 09:30:00")
    before["experiment_run_steps"][1]["run_no"] = "R2"
    result = completion_result(before, trays=["P1"])
    record = build(before, result)
    assert {r["run_no"] for r in record["payload"]["executions"]} == {"R1", "R2"}


def test_non_axis_sub_experiments_must_all_finish_and_cancellation_does_not_count():
    data = snapshot(axis=False)
    data["experiment_runs"][0].update(status="实验已完成", sub_experiment_code="SUB1")
    for row in data["experiment_run_trays"]:
        row["status"] = "实验已完成"
    data["schedules"] = [{"task_code": "T1", "experiment_code": "E1", "sub_experiment_code": sub} for sub in ["SUB1", "SUB2"]]
    assert not tray_complete(data, "T1", "E1", "P1")
    data["schedules"].pop()
    assert tray_complete(data, "T1", "E1", "P1")
    data["experiment_runs"][0]["status"] = "设备故障取消"
    assert not tray_complete(data, "T1", "E1", "P1")


def test_same_axes_required_in_two_sub_experiments_do_not_collapse_to_union():
    before = snapshot()
    data = merged_snapshot(before, completion_result(before))
    for row in data["experiment_runs"] + data["experiment_run_steps"]:
        row["sub_experiment_code"] = "SUB1"
    data["schedules"] = [{"task_code": "T1", "experiment_code": "E1", "sub_experiment_code": sub,
                          "axis_codes": ["x", "y+"]} for sub in ["SUB1", "SUB2"]]
    assert not tray_complete(data, "T1", "E1", "P1")
    data["schedules"].pop()
    assert tray_complete(data, "T1", "E1", "P1")


def test_attendance_includes_between_axis_work_but_device_time_does_not():
    before = snapshot()
    executions = build(before, completion_result(before))["payload"]["executions"]
    people = personnel_snapshot(executions, [{"id": 1, "run_no": "R1", "username": "a",
        "started_at": "2026-09-18T01:00:00Z", "ended_at": "2026-09-18T03:00:00Z"}], [], "2026-09-18 11:00:00")
    assert people[0]["attendance_seconds"] == 7200
    assert people[0]["between_axis_work_seconds"] == 1800
    assert sum(e["running_seconds"] for e in executions) == 5400


def test_device_time_excludes_pauses_and_missing_timestamp_is_unknown():
    before = snapshot(axis=False)
    after = merged_snapshot(before, completion_result(before))
    after["experiment_run_pauses"] = [{"run_no": "R1", "paused_at": "2026-09-18 09:30:00", "resumed_at": "2026-09-18 10:00:00"}]
    row = execution_snapshot(after, "T1", "E1", {"P1"})[0]
    assert row["elapsed_seconds"] == 7200
    assert row["running_seconds"] == 5400
    after["experiment_runs"][0]["started_at"] = ""
    assert execution_snapshot(after, "T1", "E1", {"P1"})[0]["running_seconds"] is None


def test_personnel_shift_changes_open_session_cutoff_and_shared_time_deduplication():
    execution = {"run_no": "R1", "started_at": "2026-09-18 09:00:00", "ended_at": "2026-09-18 11:00:00"}
    # Attendance timestamps are stored UTC, unlike naive workflow timestamps.
    intervals = [{"id": 1, "session_id": 1, "run_no": "R1", "username": "a", "employee_name": "甲",
                  "started_at": "2026-09-18T01:00:00Z", "ended_at": "2026-09-18T02:00:00Z"},
                 {"id": 2, "session_id": 2, "run_no": "R1", "username": "b", "employee_name": "乙",
                  "started_at": "2026-09-18T02:00:00Z", "ended_at": None}]
    sessions = [{"id": 1, "logged_in_at": "2026-09-18T00:30:00Z", "logged_out_at": "2026-09-18T02:00:00Z"},
                {"id": 2, "logged_in_at": "2026-09-18T02:00:00Z", "logged_out_at": None}]
    people = personnel_snapshot([execution], intervals, sessions, "2026-09-18 11:00:00")
    assert [p["attendance_seconds"] for p in people] == [3600, 3600]
    assert [p["login_seconds"] for p in people] == [3600, 3600]
    assert people[1]["sessions"][0]["logged_out_at"] is None
    assert intervals[1]["ended_at"] is None  # Does not close/modify the original session.


def test_missing_device_time_does_not_hide_known_attendance():
    people = personnel_snapshot([{"run_no": "R1", "started_at": None, "ended_at": None}],
        [{"id": 1, "run_no": "R1", "username": "a", "started_at": "2026-09-18T01:00:00Z", "ended_at": None}],
        [], "2026-09-18 11:00:00")
    assert people[0]["attendance_seconds"] == 7200
    assert people[0]["login_seconds"] is None
    assert people[0]["between_axis_work_seconds"] is None
    assert people[0]["data_quality"]


class Store:
    def __init__(self): self.payload = {}
    def read(self, key): return copy.deepcopy(self.payload.get(key, []))
    def write(self, key, value): self.payload[key] = copy.deepcopy(value)
    def write_many(self, updates): self.payload.update(copy.deepcopy(updates))


def test_capture_persists_intent_then_worker_recovers_and_revises_only_file_scope(tmp_path):
    store = Store()
    before = snapshot()
    result = completion_result(before, trays=["P1"])
    updates = prepare_completion_updates(store, before, result, task_code="T1", experiment_code="E1", run_no="R1", completed_at="2026-09-18 11:00:00")
    assert store.read(COMPLETION_KEY) == []  # Caller commits with business updates.
    store.write_many(updates)
    assert materialize_completions(store, public_base="https://mes.example", recover_reports=False) == 1
    first = store.read(LIMS_OUTBOX_KEY)[0]
    assert first["payload"]["revision"] == 1
    assert first["payload"]["data"]["status"] == "pending"
    assert materialize_completions(store, public_base="https://mes.example", recover_reports=False) == 0
    # Simulate a restart and a late successful report. Do not touch tray assignments.
    store.write("mes.samples", [])
    store.write("mes.test_data_settings", [{"savePath": str(tmp_path)}])
    path = tmp_path / "sample.pdf"
    path.write_bytes(b"%PDF-1.4\n")
    store.write("mes.test_data_exports", [{"exportKey": "R1|x|S1", "status": "success", "filePath": str(path)},
                                          {"exportKey": "R1|x|S2", "status": "success", "filePath": str(path)}])
    assert materialize_completions(store, public_base="https://mes.example", recover_reports=False) == 1
    record = store.read(COMPLETION_KEY)[0]
    second = store.read(LIMS_OUTBOX_KEY)[1]
    assert second["payload"]["completion_id"] == first["payload"]["completion_id"]
    assert second["payload"]["revision"] == 2
    assert second["payload"]["data"]["status"] == "partial"
    assert first["payload"]["trays"] == second["payload"]["trays"]
    assert resolve_completion_file(record["token"], "R1|x|S1", store) == path
    with pytest.raises(FileNotFoundError): resolve_completion_file(record["token"], "R1|x|S2", store)
    with pytest.raises(FileNotFoundError): resolve_completion_file("invalid-token", "R1|x|S1", store)


def test_missing_public_url_never_invents_download_link():
    store = Store()
    before = snapshot(axis=False)
    store.write_many(prepare_completion_updates(store, before, completion_result(before), task_code="T1", experiment_code="E1", run_no="R1", completed_at="2026-09-18 11:00:00"))
    materialize_completions(store, public_base="auto", recover_reports=False)
    assert store.read(LIMS_OUTBOX_KEY)[0]["payload"]["data"]["url"] is None
    assert store.read(LIMS_OUTBOX_KEY)[0]["payload"]["data"]["url_status"] == "public_base_url_missing"


def test_report_recovery_after_committed_intent_uses_frozen_samples(tmp_path):
    from app.services import lims_completion
    lims_completion._REPORT_RETRY_AT.clear()
    store = Store()
    store.write("mes.test_data_settings", [{"savePath": str(tmp_path)}])
    before = snapshot(axis=False)
    record = prepare_completion_updates(store, before, completion_result(before, trays=["P1"]),
        task_code="T1", experiment_code="E1", run_no="R1", completed_at="2026-09-18 11:00:00")
    store.write_many(record)
    store.write("mes.samples", [])  # Live samples have moved; they are NOT the recovery source.
    assert materialize_completions(store, public_base="https://mes.example") == 1
    payload = store.read(LIMS_OUTBOX_KEY)[0]["payload"]
    assert payload["data"]["status"] == "ready"
    assert [f["sample_code"] for f in payload["data"]["files"]] == ["S1"]
    completion = store.read(COMPLETION_KEY)[0]
    path = resolve_completion_file(completion["token"], "R1||S1", store)
    assert path.read_bytes().startswith(b"%PDF")
    assert materialize_completions(store, public_base="https://mes.example") == 0


def test_mysql_like_datetime_normalization_does_not_generate_spurious_revisions():
    from app.core.storage_backend import _normalize_value
    class NormalizingStore(Store):
        def write_many(self, updates):
            super().write_many({key: _normalize_value(key, value) for key, value in updates.items()})
    store = NormalizingStore()
    before = snapshot(axis=False)
    store.write_many(prepare_completion_updates(store, before, completion_result(before),
        task_code="T1", experiment_code="E1", run_no="R1", completed_at="2026-09-18 11:00:00"))
    assert materialize_completions(store, public_base="https://mes.example", recover_reports=False) == 1
    assert materialize_completions(store, public_base="https://mes.example", recover_reports=False) == 0
    assert "+08:00" in store.read(LIMS_OUTBOX_KEY)[0]["payload"]["completed_at"]


def test_scoped_download_page_and_file_reject_other_batch(client, monkeypatch, tmp_path):
    from app.services import lims_completion
    from app.api.routes import test_data
    store = Store()
    before = snapshot(axis=False)
    store.write_many(prepare_completion_updates(store, before, completion_result(before, trays=["P1"]),
        task_code="T1", experiment_code="E1", run_no="R1", completed_at="2026-09-18 11:00:00"))
    token = store.read(COMPLETION_KEY)[0]["token"]
    store.write("mes.test_data_settings", [{"savePath": str(tmp_path)}])
    path = tmp_path / "test.pdf"
    path.write_bytes(b"%PDF-1.4")
    store.write("mes.test_data_exports", [{"exportKey": "R1||S1", "status": "success", "filePath": str(path)}])
    monkeypatch.setattr(test_data, "get_storage_backend", lambda: store)
    monkeypatch.setattr(lims_completion, "get_storage_backend", lambda: store)
    response = client.get(f"/api/test-data/completions/{token}")
    assert response.status_code == 200
    assert "S1" in response.text and "S2" not in response.text
    assert client.get(f"/api/test-data/completions/{token}/files/R1%7C%7CS1").content.startswith(b"%PDF")
    assert client.get(f"/api/test-data/completions/{token}/files/R1%7C%7CS2").status_code == 404
    assert client.get("/api/test-data/completions/wrong-token").status_code == 404


def test_shared_mqtt_completion_path_captures_only_final_axis(monkeypatch, tmp_path):
    from app.services import mq_event_processor, test_data_reports
    from app.services.laboratory_axis_steps import complete_storage_laboratory_axis_step
    before = snapshot()
    # Real shared completion service requires sub-experiment identities for axis runs.
    for row in before["experiment_runs"] + before["experiment_run_trays"] + before["experiment_run_steps"]:
        row["sub_experiment_code"] = "SUB1"
    before["experiment_trays"] = [{"task_code": "T1", "experiment_code": "E1", "tray_code": t} for t in ["P1", "P2"]]
    store = Store()
    store.write_many({f"mes.{key}": value for key, value in before.items()})
    store.write("mes.test_data_settings", [{"savePath": str(tmp_path)}])
    store.read_all = lambda: copy.deepcopy(store.payload)
    monkeypatch.setattr(mq_event_processor, "get_storage_backend", lambda: store)
    monkeypatch.setattr(test_data_reports, "get_storage_backend", lambda: store)
    monkeypatch.setattr(mq_event_processor, "apply_mqtt_schedule_cascade", lambda *args, **kwargs: None)
    repo = mq_event_processor.MySQLMqEventRepository()
    repo.mark_run_ended("R1", "2026-09-18 09:30:00", "x", "y+", "SUB1")
    assert store.read(COMPLETION_KEY) == []
    repo.mark_run_ended("R1", "2026-09-18 11:00:00", "y+", "", "SUB1")
    records = store.read(COMPLETION_KEY)
    assert len(records) == 1
    assert records[0]["payload"]["tray_codes"] == ["P1", "P2"]
    assert {e["axis_code"] for e in records[0]["payload"]["executions"]} == {"x", "y+"}
    repo.mark_run_ended("R1", "2026-09-18 11:00:00", "y+", "", "SUB1")
    assert len(store.read(COMPLETION_KEY)) == 1
