from copy import deepcopy

from fastapi import FastAPI
from fastapi.testclient import TestClient


class FakeStorage:
    def __init__(self, payloads=None):
        self.payloads = {
            "mes.tasks": [],
            "mes.schedules": [],
            "mes.samples": [],
            "mes.streams": [],
            "mes.experiments": [],
            "mes.experiment_trays": [],
            "mes.experiment_samples": [],
            "mes.conflicts": [],
            "mes.devices": [],
            "mes.meta": {},
        }
        self.payloads.update(deepcopy(payloads or {}))

    def read(self, key):
        return deepcopy(self.payloads.get(key, []))

    def read_all(self):
        return deepcopy(self.payloads)

    def write(self, key, value):
        self.payloads[key] = deepcopy(value)

    def write_many(self, updates):
        for key, value in updates.items():
            self.write(key, value)


def build_client(monkeypatch, payloads=None):
    from app.api.routes import storage as storage_route

    storage = FakeStorage(payloads)
    monkeypatch.setattr(storage_route, "get_storage_backend", lambda: storage)

    app = FastAPI()
    app.include_router(storage_route.router)
    return TestClient(app), storage


def test_storage_rejects_lab_arrival_when_tray_was_not_dispatched_from_transfer_area(monkeypatch):
    samples = [
        {
            "code": "SP-NOT-DISPATCHED",
            "location": "接驳区",
            "status": "已入库",
            "flow_status": "已入库",
            "task_code": "SYLU-2026-05-701",
            "trays": [{"tray_code": "TP-NOT-DISPATCHED", "status": "已入库", "quantity": 1}],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    attempted = deepcopy(samples)
    attempted[0]["location"] = "盐雾试验室"
    attempted[0]["status"] = "已到达实验室"
    attempted[0]["flow_status"] = "已到达实验室"
    attempted[0]["trays"][0]["status"] = "已到达实验室"

    response = client.put("/api/storage/mes.samples", json=attempted)

    assert response.status_code == 400
    assert response.json()["detail"] == "托盘尚未从接驳间出库，不能直接到达实验室"
    assert storage.read("mes.samples") == samples


def test_storage_bulk_update_rejects_lab_arrival_when_sample_has_no_dispatched_tray(monkeypatch):
    samples = [
        {
            "code": "SP-NO-TRAY",
            "location": "接驳区",
            "status": "已入库",
            "flow_status": "已入库",
            "task_code": "SYLU-2026-05-703",
            "trays": [],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    attempted = deepcopy(samples)
    attempted[0]["location"] = "盐雾试验室"
    attempted[0]["status"] = "已到达实验室"
    attempted[0]["flow_status"] = "已到达实验室"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "托盘尚未从接驳间出库，不能直接到达实验室"
    assert storage.read("mes.samples") == samples


def test_storage_allows_lab_arrival_after_transfer_area_dispatch(monkeypatch):
    samples = [
        {
            "code": "SP-DISPATCHED",
            "location": "接驳区",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "SYLU-2026-05-702",
            "trays": [{"tray_code": "TP-DISPATCHED", "status": "送至实验室", "quantity": 1}],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    updated = deepcopy(samples)
    updated[0]["location"] = "盐雾试验室"
    updated[0]["status"] = "已到达实验室"
    updated[0]["flow_status"] = "已到达实验室"
    updated[0]["trays"][0]["status"] = "已到达实验室"

    response = client.put("/api/storage", json={"mes.samples": updated})

    assert response.status_code == 200
    assert storage.read("mes.samples") == updated


def test_storage_rejects_staging_stock_in_after_laboratory_progress(monkeypatch):
    samples = [
        {
            "code": "SP-LAB-PROGRESSED",
            "location": "盐雾试验室",
            "status": "工装夹具安装",
            "flow_status": "工装夹具安装",
            "task_code": "SYLU-2026-05-704",
            "trays": [{"tray_code": "TP-LAB-PROGRESSED", "status": "工装夹具安装", "quantity": 1}],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（暂存间）"
    attempted[0]["status"] = "已到达暂存间"
    attempted[0]["flow_status"] = "已到达暂存间"
    attempted[0]["trays"][0]["status"] = "已到达暂存间"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已进入试验间流程，不能暂存间入库。"
    assert storage.read("mes.samples") == samples
