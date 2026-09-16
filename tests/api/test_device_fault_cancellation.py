from copy import deepcopy
import pytest
from app.services.device_fault_cancellation import build_fault_cancellation_updates, FAULT_CANCELED
from test_storage import build_client


def fault_snapshot(name="冲击试验", lab="冲击一室"):
    return {
        "mes.devices": [{"code": lab, "name": lab, "status": "可用"}],
        "mes.tasks": [{"code": "T", "status": "任务进行中"}],
        "mes.experiments": [{"task_code": "T", "experiment_code": "E", "experiment_name": name, "status": "实验进行中"},
                            {"task_code": "T", "experiment_code": "NEXT", "experiment_name": "振动试验", "status": "已排程"}],
        "mes.experiment_runs": [{"task_code": "T", "experiment_code": "E", "run_no": "R", "schedule_id": "S", "device": lab, "status": "实验进行中", "started_at": "2026-09-15 08:00:00"}],
        "mes.experiment_run_trays": [{"task_code": "T", "experiment_code": "E", "run_no": "R", "tray_code": "TP", "run_tray_status": "实验进行中"}],
        "mes.experiment_run_steps": [{"run_no": "R", "axis_code": "x", "status": "实验已完成"}, {"run_no": "R", "axis_code": "y", "status": "实验进行中"}],
        "mes.experiment_trays": [{"task_code": "T", "experiment_code": code, "tray_code": "TP"} for code in ("E", "NEXT")],
        "mes.samples": [{"code": "SP", "task_code": "T", "status": "实验进行中", "flow_status": "实验进行中", "location": lab,
                         "trays": [{"tray_code": "TP", "status": "实验进行中", "fixture_install_id": "F"}]}],
        "mes.schedules": [{"id": "S", "task_code": "T", "experiment_code": "E", "device": lab, "status": "实验进行中", "start_at": "2026-09-15 08:00:00", "end_at": "2099-09-15 09:00:00"},
                          {"id": "S2", "task_code": "T", "experiment_code": "NEXT", "device": "振动一室", "status": "已排程", "start_at": "2099-09-16 08:00:00", "end_at": "2099-09-16 09:00:00"}],
    }


def cancel(snapshot):
    return build_fault_cancellation_updates(snapshot, run_no="R", task_code="T", experiment_code="E", canceled_at="2026-09-15 09:00:00", reason="设备故障")


def test_fault_cancellation_preserves_attempt_data_and_axis_results():
    snapshot = fault_snapshot()
    before = deepcopy(snapshot)
    result = cancel(snapshot)
    assert snapshot == before
    assert result["mes.experiment_runs"][0]["status"] == FAULT_CANCELED
    assert result["mes.experiment_runs"][0]["started_at"] == "2026-09-15 08:00:00"
    assert result["mes.experiment_run_steps"][0]["status"] == "实验已完成"
    assert result["mes.experiment_run_steps"][1]["status"] == FAULT_CANCELED
    assert result["mes.experiments"][0]["status"] == "待排程"
    assert [row["id"] for row in result["mes.schedules"]] == ["S2"]
    assert result["mes.samples"][0]["location"] == "冲击一室"
    assert result["mes.samples"][0]["history"][0]["run_no"] == "R"
    assert "fixture_install_id" not in result["mes.samples"][0]["trays"][0]
    assert result["mes.devices"][0]["status"] == "维修"
    assert cancel({**snapshot, **result}) == {}


def test_future_schedule_does_not_block_fault_cancellation():
    snapshot = fault_snapshot()
    snapshot["mes.schedules"][1]["device"] = "冲击一室"
    result = cancel(snapshot)
    assert len(result["mes.schedules"]) == 1
    assert result["mes.conflicts"][0]["type"] == "device_fault_schedule_blocked"


@pytest.mark.parametrize("room,name,lab,expected", [("staging", "冲击试验", "冲击一室", 200),
    ("appearance", "冲击试验", "冲击一室", 400), ("appearance", "盐雾试验", "盐雾试验室", 200),
    ("appearance", "霉菌试验", "霉菌试验室", 200), ("appearance", "高低温湿热试验", "高低温湿热二室", 200)])
def test_fault_canceled_tray_storage_routes(monkeypatch, room, name, lab, expected):
    snapshot = fault_snapshot(name, lab)
    snapshot.update(cancel(snapshot))
    client, storage = build_client(monkeypatch, snapshot)
    response = client.post(f"/api/storage/rooms/{room}/trays/TP/stock-in", json={})
    assert response.status_code == expected, response.json()
    if expected == 200:
        assert storage.read("mes.experiments")[0]["status"] == "待排程"
        assert storage.read("mes.experiment_runs")[0]["status"] == FAULT_CANCELED
        assert client.post(f"/api/storage/rooms/{room}/trays/TP/stock-in", json={}).status_code == 409


def test_fault_status_alone_cannot_unlock_storage(monkeypatch):
    snapshot = fault_snapshot()
    snapshot["mes.samples"][0]["status"] = FAULT_CANCELED
    snapshot["mes.samples"][0]["trays"][0]["status"] = FAULT_CANCELED
    client, _ = build_client(monkeypatch, snapshot)
    assert client.post("/api/storage/rooms/staging/trays/TP/stock-in", json={}).status_code == 400


def test_fault_canceled_tray_can_compare_next_experiment(monkeypatch):
    snapshot = fault_snapshot()
    snapshot.update(cancel(snapshot))
    client, storage = build_client(monkeypatch, snapshot)
    samples = deepcopy(snapshot["mes.samples"])
    samples[0].update(status="已到达实验室", flow_status="已到达实验室", location="振动一室")
    samples[0]["trays"][0].update(status="已到达实验室", target_lab="振动一室", target_experiment_code="NEXT", target_schedule_id="S2")
    response = client.put("/api/storage/mes.samples", json=samples)
    assert response.status_code == 200, response.json()
    assert storage.read("mes.experiments")[0]["status"] == "待排程"


@pytest.mark.parametrize("room,name,lab", [("staging", "冲击试验", "冲击一室"), ("appearance", "霉菌试验", "霉菌试验室")])
def test_fault_recovery_stock_out_to_next_experiment(monkeypatch, room, name, lab):
    snapshot = fault_snapshot(name, lab)
    snapshot.update(cancel(snapshot))
    client, storage = build_client(monkeypatch, snapshot)
    assert client.post(f"/api/storage/rooms/{room}/trays/TP/stock-in", json={}).status_code == 200
    response = client.post(f"/api/storage/rooms/{room}/trays/TP/stock-out", json={"targetLab": "振动一室", "targetExperimentCode": "NEXT", "scheduleId": "S2"})
    assert response.status_code == 200, response.json()
    assert storage.read("mes.samples")[0]["status"] == "送至实验室"


@pytest.mark.parametrize("lab_code,lab", [("LAB_IMPACT_1", "冲击一室"), ("LAB_SALT", "盐雾试验室"), ("LAB_MOLD", "霉菌试验室"), ("LAB_HOT_HUMID_2", "高低温湿热二室")])
def test_mqtt_fault_confirmation_never_uses_normal_or_salt_completion(monkeypatch, lab_code, lab):
    from test_mq import FakeMqEventRepository
    from app.services.mq_event_processor import process_laboratory_event
    class Repo(FakeMqEventRepository):
        def find_pending_device_fault_cancel(self, run_no, cancel_request_id=""):
            return command if run_no == "R" and cancel_request_id in ("", "C") else {}
        def mark_device_fault_canceled(self, run_no, occurred_at, received):
            assert received == command
            self.faults.append(run_no)
    command = {"task_code": "T", "experiment_code": "E", "run_no": "R", "cancel_request_id": "C", "cancel_reason": "故障", "end_mode": "device_fault_cancel"}
    repo = Repo()
    repo.faults = []
    repo.runs_by_lab = {lab_code: {"run_no": "R", "task_no": "T", "experiment_no": "E", "lab_code": lab_code, "device_name": lab, "run_status": "实验进行中", "axis_codes": ["x", "y"]}}
    monkeypatch.setattr("app.services.mq_event_processor.publish_realtime_update", lambda: None)
    payload = {**command, "lab_code": lab_code, "message_id": "M"}
    ack = process_laboratory_event(f"mes/v1/labs/{lab_code}/events/experiment-ended", payload, repository=repo)
    assert ack["status"] == "PROCESSED"
    assert repo.faults == ["R"]
    assert repo.ended == []
    assert repo.mold_canceled == []
    process_laboratory_event(f"mes/v1/labs/{lab_code}/events/experiment-ended", payload, repository=repo)
    assert repo.faults == ["R"]
    with pytest.raises(ValueError, match="matching device fault"):
        process_laboratory_event(f"mes/v1/labs/{lab_code}/events/experiment-ended", {**payload, "message_id": "BAD", "cancel_request_id": "wrong"}, repository=repo)


def test_fault_request_marks_device_unavailable_but_waits_for_host_before_releasing_trays(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.routes import mq
    from test_storage import FakeStorage
    snapshot = fault_snapshot()
    storage = FakeStorage(snapshot)
    class Repo:
        def find_run_by_no(self, run_no):
            return {"run_no": "R", "task_no": "T", "experiment_no": "E", "lab_code": "LAB_IMPACT_1", "run_status": "实验进行中", "schedule_no": "S"}
        def find_pending_device_fault_cancel(self, run_no):
            return {}
    messages = []
    monkeypatch.setattr(mq, "MySQLMqEventRepository", Repo)
    monkeypatch.setattr(mq, "get_storage_backend", lambda: storage)
    monkeypatch.setattr("app.api.auth_session.require_auth_session", lambda request: {"username": "operator"})
    monkeypatch.setattr(mq, "publish_laboratory_command", lambda command, payload: messages.append(payload) or {"published": True})
    app = FastAPI()
    app.include_router(mq.router)
    response = TestClient(app).post("/api/mq/laboratory/device-fault-cancel-request", json={"task_code": "T", "experiment_code": "E", "run_no": "R", "lab_code": "LAB_IMPACT_1", "cancel_reason": "故障"})
    assert response.status_code == 200, response.json()
    assert messages[0]["end_mode"] == "device_fault_cancel"
    assert messages[0]["operator"] == "operator"
    assert messages[0]["schedule_snapshot"]["id"] == "S"
    assert storage.read("mes.devices")[0]["status"] == "维修"
    assert storage.read("mes.experiment_runs") == snapshot["mes.experiment_runs"]
    assert storage.read("mes.samples") == snapshot["mes.samples"]
    assert storage.read("mes.schedules") == snapshot["mes.schedules"]
    client, _ = build_client(monkeypatch, storage.read_all())
    devices = storage.read("mes.devices")
    devices[0].update(status="可用", maintenance_start_at="", maintenance_type="")
    assert client.put("/api/storage/mes.devices", json=devices).status_code == 409


def test_fault_report_archives_received_data_and_late_results_without_overwriting_new_run(monkeypatch, tmp_path):
    from test_storage import FakeStorage
    from app.services import test_data_reports
    from app.services.device_fault_reports import archive_device_fault_reports
    from app.services.test_data_repository import get_test_data_repository
    snapshot = fault_snapshot()
    snapshot.update(cancel(snapshot))
    storage = FakeStorage(snapshot)
    monkeypatch.setattr(test_data_reports, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(test_data_reports.app_settings, "TEST_DATA_SAVE_PATH", str(tmp_path))
    result = archive_device_fault_reports(storage, run_no="R")
    assert result["ok"], result
    record = get_test_data_repository(storage).list_exports()[0]
    assert record["terminalStatus"] == FAULT_CANCELED
    assert "待补齐" in record["resultCompleteness"]
    from pypdf import PdfReader
    assert FAULT_CANCELED in "".join(page.extract_text() for page in PdfReader(record["filePath"]).pages)
    storage.write("mes.experiment_results", [{"run_no": "R", "temperature": [22, 23], "conclusion": "中断"}, {"run_no": "NEW", "temperature": [40]}])
    result = archive_device_fault_reports(storage, run_no="R")
    assert result["succeeded"] == 1
    record = get_test_data_repository(storage).list_exports()[0]
    assert record["resultPackages"] == [{"run_no": "R", "temperature": [22, 23], "conclusion": "中断"}]
    assert archive_device_fault_reports(storage, run_no="R")["skipped"] == 1


def test_interrupted_fault_archive_is_visible_and_retryable(monkeypatch, tmp_path):
    from test_storage import FakeStorage
    from app.services import test_data_reports
    snapshot = fault_snapshot()
    snapshot.update(cancel(snapshot))
    snapshot["mes.conflicts"] = [{"id": "device-fault-archive-R", "type": "device_fault_archive_pending", "status": "pending", "run_no": "R", "task_code": "T", "experiment_code": "E"}]
    storage = FakeStorage(snapshot)
    monkeypatch.setattr(test_data_reports, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(test_data_reports.app_settings, "TEST_DATA_SAVE_PATH", str(tmp_path))
    records = test_data_reports.list_export_records(storage=storage, status="failed")
    assert records[0]["exportKey"] == "R|fault-archive"
    result = test_data_reports.retry_failed_exports(storage=storage, export_keys=["R|fault-archive"])
    assert result["ok"], result
    assert storage.read("mes.conflicts")[0]["status"] == "resolved"
    assert test_data_reports.list_export_records(storage=storage, status="failed") == []


def test_newer_run_prevents_old_fault_from_unlocking_storage(monkeypatch):
    snapshot = fault_snapshot()
    snapshot.update(cancel(snapshot))
    snapshot["mes.experiment_run_trays"].append({"run_no": "NEW", "task_code": "T", "experiment_code": "NEXT", "tray_code": "TP", "run_tray_status": "实验进行中", "updated_at": "2026-09-15 10:00:00"})
    client, _ = build_client(monkeypatch, snapshot)
    assert client.post("/api/storage/rooms/staging/trays/TP/stock-in", json={}).status_code == 400


def test_fault_cancellation_includes_all_trays_and_preserves_other_runs():
    snapshot = fault_snapshot()
    snapshot["mes.experiment_run_trays"].append({"run_no": "R", "task_code": "T", "experiment_code": "E", "tray_code": "TP2", "run_tray_status": "实验进行中"})
    snapshot["mes.samples"].append({"code": "SP2", "task_code": "T", "location": "冲击一室", "status": "实验进行中", "trays": [{"tray_code": "TP2", "status": "实验进行中"}]})
    unrelated = {"run_no": "OTHER", "task_code": "T2", "experiment_code": "E2", "status": "实验进行中"}
    snapshot["mes.experiment_runs"].append(unrelated)
    result = cancel(snapshot)
    assert all(sample["trays"][0]["status"] == FAULT_CANCELED for sample in result["mes.samples"])
    assert result["mes.experiment_runs"][1] == unrelated


def test_cancelled_run_mysql_mappers_preserve_status_and_original_identity():
    from app.core.mysql_storage_mappers import build_experiment_run_insert_row, build_storage_experiment_run_item
    run = cancel(fault_snapshot())["mes.experiment_runs"][0]
    restored = build_storage_experiment_run_item(build_experiment_run_insert_row(run))
    assert restored["status"] == FAULT_CANCELED
    assert restored["schedule_id"] == "S"
    assert restored["run_no"] == "R"


def test_end_to_end_fault_request_confirmation_and_result_archive(monkeypatch, tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.routes import mq
    from app.services import mq_event_processor, test_data_reports
    from test_storage import FakeStorage
    from test_mq import FakeMqEventRepository
    storage = FakeStorage(fault_snapshot())
    commands = []
    class Repo(FakeMqEventRepository):
        def find_run_by_no(self, run_no):
            run = next(row for row in storage.read("mes.experiment_runs") if row["run_no"] == run_no)
            return {**run, "task_no": run["task_code"], "experiment_no": run["experiment_code"], "lab_code": "LAB_IMPACT_1", "run_status": run["status"]}
        def find_pending_device_fault_cancel(self, run_no, cancel_request_id=""):
            return next((command for command in commands if command["run_no"] == run_no and (not cancel_request_id or command["cancel_request_id"] == cancel_request_id)), {})
        def mark_device_fault_canceled(self, run_no, occurred_at, command):
            mq_event_processor.MySQLMqEventRepository.mark_device_fault_canceled(self, run_no, occurred_at, command)
        def record_result(self, result):
            storage.write("mes.experiment_results", [*storage.read("mes.experiment_results"), result["result_payload"]])
    repo = Repo()
    monkeypatch.setattr(mq, "MySQLMqEventRepository", lambda: repo)
    monkeypatch.setattr(mq, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(mq_event_processor, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(mq_event_processor, "publish_realtime_update", lambda: None)
    monkeypatch.setattr(test_data_reports, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(test_data_reports.app_settings, "TEST_DATA_SAVE_PATH", str(tmp_path))
    monkeypatch.setattr("app.api.auth_session.require_auth_session", lambda request: {"username": "operator"})
    monkeypatch.setattr(mq, "publish_laboratory_command", lambda command, payload: commands.append(payload) or {"published": True})
    app = FastAPI()
    app.include_router(mq.router)
    client = TestClient(app)
    request = {"task_code": "T", "experiment_code": "E", "run_no": "R", "lab_code": "LAB_IMPACT_1", "cancel_reason": "设备故障"}
    assert client.post("/api/mq/laboratory/device-fault-cancel-request", json=request).status_code == 200
    assert client.post("/api/mq/laboratory/device-fault-cancel-request", json=request).status_code == 200
    assert len(commands) == 1
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验进行中"
    event = {**commands[0], "message_id": "CONFIRMED"}
    ack = mq_event_processor.process_laboratory_event("mes/v1/labs/LAB_IMPACT_1/events/experiment-ended", event, repository=repo)
    assert ack["status"] == "PROCESSED"
    assert storage.read("mes.experiment_runs")[0]["status"] == FAULT_CANCELED
    assert storage.read("mes.samples")[0]["history"][0]["owner"] == "operator"
    assert storage.read("mes.conflicts")[-1]["status"] == "resolved"
    result = {"run_no": "R", "lab_code": "LAB_IMPACT_1", "message_id": "RESULT", "result_package": {"summary": "故障前已采集数据"}}
    mq_event_processor.process_laboratory_event("mes/v1/labs/LAB_IMPACT_1/events/experiment-result", result, repository=repo)
    reports = test_data_reports.list_export_records(storage=storage)
    assert len(reports) == 1
    assert reports[0]["resultPackages"][0]["summary"] == "故障前已采集数据"
    with pytest.raises(ValueError, match="不能改为正常完成"):
        mq_event_processor.process_laboratory_event("mes/v1/labs/LAB_IMPACT_1/events/experiment-ended", {"run_no": "R", "lab_code": "LAB_IMPACT_1", "message_id": "STALE-NORMAL-END"}, repository=repo)
