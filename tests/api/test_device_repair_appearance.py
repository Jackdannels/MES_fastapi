from copy import deepcopy
import json
import os
from pathlib import Path

import pytest

from app.services.device_fault_cancellation import FAULT_CANCELED, build_fault_cancellation_updates
from tests.api.test_storage import build_client
from app.services.device_running_repair import build_completed_running_repair_updates


def save_projection_case(name, snapshot, original):
    directory = os.environ.get("MES_DEVICE_REPAIR_OUTPUT", "")
    if not directory:
        return
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    phase = "all" if original["mes.samples"][1]["location"] == "外观检测间" else "mixed"
    (path / f"{name}-{phase}.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")


@pytest.fixture(params=["all_appearance", "mixed_locations"])
def paused_appearance_snapshot(request):
    return {
        "mes.devices": [{"code": "盐雾试验室", "name": "盐雾试验室", "status": "可用"}],
        "mes.tasks": [{"code": "T", "status": "任务进行中"}],
        "mes.experiments": [{"task_code": "T", "experiment_code": "E", "experiment_name": "盐雾试验", "status": "实验进行中"}],
        "mes.schedules": [{"id": "S", "task_code": "T", "experiment_code": "E", "device": "盐雾试验室", "status": "实验进行中", "start_at": "2026-11-08 09:00:00", "end_at": "2099-11-08 18:00:00"}],
        "mes.experiment_runs": [{"run_no": "R", "task_code": "T", "experiment_code": "E", "schedule_id": "S", "lab_code": "LAB_SALT", "device": "盐雾试验室", "status": "实验暂停", "started_at": "2026-11-08 09:00:00"}],
        "mes.experiment_run_pauses": [{"pause_no": "P", "run_no": "R", "task_code": "T", "experiment_code": "E", "lab_code": "LAB_SALT", "status": "实验暂停", "inspection_tray_codes": ["TP1", "TP2"], "paused_at": "2026-11-08 10:00:00"}],
        "mes.experiment_run_trays": [{"run_no": "R", "task_code": "T", "experiment_code": "E", "tray_code": tray, "run_tray_status": "实验进行中"} for tray in ["TP1", "TP2"]],
        "mes.experiment_trays": [{"task_code": "T", "experiment_code": "E", "tray_code": tray} for tray in ["TP1", "TP2"]],
        "mes.experiment_samples": [{"task_code": "T", "experiment_code": "E", "sample_code": sample} for sample in ["SP1", "SP2"]],
        "mes.samples": [{"code": sample, "task_code": "T", "status": "中途外观检查中" if tray == "TP1" or request.param == "all_appearance" else "实验暂停", "flow_status": "中途外观检查中" if tray == "TP1" or request.param == "all_appearance" else "实验暂停", "location": "外观检测间" if tray == "TP1" or request.param == "all_appearance" else "盐雾试验室", "trays": [{"tray_code": tray, "quantity": 1, "status": "中途外观检查中" if tray == "TP1" or request.param == "all_appearance" else "实验暂停"}], "history": []} for sample, tray in [("SP1", "TP1"), ("SP2", "TP2")]],
        "mes.staging_events": [{"id": f"MID-{tray}", "task_code": "T", "tray_code": tray, "room": "appearance", "action": "stock_in", "appearance_phase": "mid_experiment", "run_no": "R", "pause_no": "P", "time": "2026-11-08 10:30:00"} for tray in (["TP1", "TP2"] if request.param == "all_appearance" else ["TP1"])],
    }


def test_paused_repair_completion_keeps_appearance_stock_and_allows_transfer(monkeypatch, paused_appearance_snapshot):
    client, storage = build_client(monkeypatch, paused_appearance_snapshot)
    save_projection_case("initial", storage.read_all(), paused_appearance_snapshot)
    response = client.post("/api/storage/devices/盐雾试验室/running-repair", json={"targets": [{"task_code": "T", "experiment_code": "E", "run_no": "R", "schedule_id": "S", "tray_codes": ["TP1", "TP2"]}], "maintenanceNote": "设备损坏，人工判定实验已完成"})
    assert response.status_code == 200, response.json()
    assert storage.read("mes.devices")[0]["status"] == "维修"
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验已完成"
    sample = storage.read("mes.samples")[0]
    assert sample["location"] == "外观检测间"
    assert sample["status"] == "实验后外观检测间存放"
    assert any(event.get("source") == "experiment_completion" and event.get("tray_code") == "TP1" for event in storage.read("mes.staging_events"))
    save_projection_case("complete-appearance", storage.read_all(), paused_appearance_snapshot)
    out = client.post("/api/storage/rooms/appearance/trays/TP1/stock-out", json={"targetType": "staging", "targetLab": "恒温恒湿间（暂存间）"})
    assert out.status_code == 200, out.json()
    stocked = client.post("/api/storage/rooms/staging/trays/TP1/stock-in", json={"status": "实验后暂存间存放", "location": "恒温恒湿间（实验后暂存间）"})
    assert stocked.status_code == 200, stocked.json()
    save_projection_case("complete-staging", storage.read_all(), paused_appearance_snapshot)


def test_paused_fault_cancel_preserves_location_and_allows_appearance_stock_out(monkeypatch, paused_appearance_snapshot):
    before = deepcopy(paused_appearance_snapshot)
    updates = build_fault_cancellation_updates(paused_appearance_snapshot, run_no="R", task_code="T", experiment_code="E", canceled_at="2026-11-08 12:00:00", reason="盐雾设备故障")
    assert paused_appearance_snapshot == before
    client, storage = build_client(monkeypatch, {**paused_appearance_snapshot, **updates})
    assert storage.read("mes.devices")[0]["status"] == "维修"
    assert storage.read("mes.experiments")[0]["status"] == "待排程"
    assert storage.read("mes.experiment_runs")[0]["status"] == FAULT_CANCELED
    assert storage.read("mes.samples")[0]["location"] == "外观检测间"
    assert any(entry["status"] == FAULT_CANCELED for entry in storage.read("mes.samples")[0]["history"])
    assert [sample["location"] for sample in storage.read("mes.samples")] == [sample["location"] for sample in before["mes.samples"]]
    transitioned = [event["tray_code"] for event in storage.read("mes.staging_events") if event.get("source") == "device_fault_cancellation"]
    expected_trays = [sample["trays"][0]["tray_code"] for sample in before["mes.samples"] if sample["location"] == "外观检测间"]
    assert sorted(transitioned) == sorted(expected_trays)
    save_projection_case("cancel-appearance", storage.read_all(), paused_appearance_snapshot)
    out = client.post("/api/storage/rooms/appearance/trays/TP1/stock-out", json={"targetType": "staging", "targetLab": "恒温恒湿间（暂存间）"})
    assert out.status_code == 200, out.json()
    assert client.post("/api/storage/rooms/staging/trays/TP1/stock-in", json={}).status_code == 200
    assert storage.read("mes.experiments")[0]["status"] == "待排程"
    assert storage.read("mes.experiment_runs")[0]["status"] == FAULT_CANCELED
    save_projection_case("cancel-staging", storage.read_all(), paused_appearance_snapshot)
    repeated = build_fault_cancellation_updates(storage.read_all(), run_no="R", task_code="T", experiment_code="E", canceled_at="2026-11-08 12:01:00", reason="重复确认")
    assert repeated == {}


def test_mid_appearance_repair_request_does_not_release_trays_before_host_confirmation(monkeypatch, paused_appearance_snapshot):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.routes import mq
    from tests.api.test_storage import FakeStorage

    storage = FakeStorage(paused_appearance_snapshot)
    class Repository:
        def find_run_by_no(self, run_no):
            return {"run_no": "R", "task_no": "T", "experiment_no": "E", "lab_code": "LAB_SALT", "run_status": "实验暂停", "schedule_no": "S"}

        def find_pending_device_fault_cancel(self, run_no):
            return {}

    commands = []
    monkeypatch.setattr(mq, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(mq, "MySQLMqEventRepository", Repository)
    monkeypatch.setattr(mq, "publish_laboratory_command", lambda command, payload: commands.append((command, payload)) or {"published": True})
    monkeypatch.setattr("app.api.auth_session.require_auth_session", lambda request: {"username": "operator"})
    app = FastAPI()
    app.include_router(mq.router)
    response = TestClient(app).post("/api/mq/laboratory/device-fault-cancel-request", json={"task_code": "T", "experiment_code": "E", "run_no": "R", "lab_code": "LAB_SALT", "cancel_reason": "设备故障"})

    assert response.status_code == 200, response.json()
    assert commands[0][1]["end_mode"] == "device_fault_cancel"
    assert storage.read("mes.samples") == paused_appearance_snapshot["mes.samples"]
    assert storage.read("mes.experiment_runs") == paused_appearance_snapshot["mes.experiment_runs"]
    assert storage.read("mes.staging_events") == paused_appearance_snapshot["mes.staging_events"]
    assert storage.read("mes.devices")[0]["status"] == "维修"


def test_fault_phase_transition_cannot_use_same_tray_from_another_task(paused_appearance_snapshot):
    snapshot = deepcopy(paused_appearance_snapshot)
    for sample in snapshot["mes.samples"]:
        sample["location"] = "盐雾试验室"
        sample["status"] = sample["flow_status"] = sample["trays"][0]["status"] = "实验暂停"
    foreign = {"code": "FOREIGN", "task_code": "OTHER", "location": "外观检测间", "status": "中途外观检查中", "trays": [{"tray_code": "TP1", "status": "中途外观检查中"}], "history": []}
    snapshot["mes.samples"].append(foreign)
    updates = build_fault_cancellation_updates(snapshot, run_no="R", task_code="T", experiment_code="E", canceled_at="2026-11-08 12:00:00", reason="设备故障")
    assert updates["mes.samples"][-1] == foreign
    assert all(sample["status"] == FAULT_CANCELED for sample in updates["mes.samples"] if sample["task_code"] == "T")
    assert not any(event.get("source") == "device_fault_cancellation" for event in updates.get("mes.staging_events", []))


def test_multiple_paused_repair_targets_keep_each_appearance_transition(paused_appearance_snapshot):
    snapshot = deepcopy(paused_appearance_snapshot)
    second = deepcopy(paused_appearance_snapshot)
    for key, rows in second.items():
        if key in {"mes.devices", "mes.tasks", "mes.experiment_run_pauses"}:
            continue
        for row in rows:
            for field, old, new in [("task_code", "T", "T2"), ("experiment_code", "E", "E2"), ("run_no", "R", "R2"), ("schedule_id", "S", "S2"), ("id", "S", "S2")]:
                if row.get(field) == old:
                    row[field] = new
            if "code" in row:
                row["code"] += "-OTHER"
            if "sample_code" in row:
                row["sample_code"] += "-OTHER"
            if "tray_code" in row:
                row["tray_code"] += "-OTHER"
            for tray in row.get("trays", []):
                tray["tray_code"] += "-OTHER"
        snapshot.setdefault(key, []).extend(rows)
    result = build_completed_running_repair_updates(snapshot, device_code="盐雾试验室", payload={"targets": [{"task_code": "T", "experiment_code": "E", "run_no": "R"}, {"task_code": "T2", "experiment_code": "E2", "run_no": "R2"}]}, completed_at="2026-11-08 12:00:00")
    transitions = [event for event in result["mes.staging_events"] if event.get("source") == "experiment_completion"]
    assert {event["run_no"] for event in transitions} == {"R", "R2"}
    assert len(transitions) == (4 if paused_appearance_snapshot["mes.samples"][1]["location"] == "外观检测间" else 2)
