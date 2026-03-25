from fastapi import FastAPI
from fastapi.testclient import TestClient


class FakeTransferStorage:
    def __init__(self, payloads=None):
        self.payloads = {
            "mes.tasks": [],
            "mes.samples": [],
            "mes.schedules": [],
            "mes.devices": [],
            "mes.streams": [],
            "mes.conflicts": [],
        }
        if isinstance(payloads, dict):
            self.payloads.update({key: list(value) for key, value in payloads.items()})

    def read(self, key):
        return list(self.payloads.get(key, []))

    def read_all(self):
        return {key: list(value) for key, value in self.payloads.items()}

    def write(self, key, value):
        self.payloads[key] = list(value)

    def write_many(self, updates):
        for key, value in dict(updates).items():
            self.payloads[key] = list(value)


def create_payloads():
    return {
        "mes.tasks": [
            {
                "id": "task-101",
                "code": "JB-2026-101",
                "name": "连接器批次 A",
                "test_type": "盐雾试验 / 振动试验",
                "sample_count": 4,
                "arrival_at": "2026-03-21 10:20",
                "status": "待排程",
            },
            {
                "id": "task-102",
                "code": "JB-2026-102",
                "name": "线束批次 E",
                "test_type": "耐久试验 / 通电试验",
                "sample_count": 2,
                "arrival_at": "2026-03-19 09:10",
                "status": "已排程",
                "transfer_status": "已入库",
                "tray_limit": 2,
            },
            {
                "id": "task-103",
                "code": "JB-2026-103",
                "name": "实验中任务",
                "test_type": "振动试验",
                "sample_count": 1,
                "arrival_at": "2026-03-20 08:00",
                "status": "实验中",
            },
        ],
        "mes.samples": [
            {"id": "sample-1", "code": "JB-2026-101-SP-001", "task_code": "JB-2026-101", "status": "运输中", "flow_status": "运输中", "location": ""},
            {"id": "sample-2", "code": "JB-2026-101-SP-002", "task_code": "JB-2026-101", "status": "运输中", "flow_status": "运输中", "location": ""},
            {"id": "sample-3", "code": "JB-2026-101-SP-003", "task_code": "JB-2026-101", "status": "运输中", "flow_status": "运输中", "location": ""},
            {"id": "sample-4", "code": "JB-2026-101-SP-004", "task_code": "JB-2026-101", "status": "运输中", "flow_status": "运输中", "location": ""},
            {
                "id": "sample-5",
                "code": "JB-2026-102-SP-001",
                "task_code": "JB-2026-102",
                "status": "已入库",
                "flow_status": "已入库",
                "location": "接驳区",
                "trays": [
                    {
                        "tray_id": 1001,
                        "tray_code": "JB-2026-102-TP-001",
                        "quantity": 1,
                        "status": "已入库",
                        "barcode_id": 9001,
                        "barcode_no": "JB-2026-102-TP-001",
                        "barcode_content": "TRAY|TASK:JB-2026-102|TRAY:JB-2026-102-TP-001|LOAD:2",
                    }
                ],
            },
            {
                "id": "sample-6",
                "code": "JB-2026-102-SP-002",
                "task_code": "JB-2026-102",
                "status": "已入库",
                "flow_status": "已入库",
                "location": "接驳区",
                "trays": [
                    {
                        "tray_id": 1001,
                        "tray_code": "JB-2026-102-TP-001",
                        "quantity": 1,
                        "status": "已入库",
                        "barcode_id": 9001,
                        "barcode_no": "JB-2026-102-TP-001",
                        "barcode_content": "TRAY|TASK:JB-2026-102|TRAY:JB-2026-102-TP-001|LOAD:2",
                    }
                ],
            },
        ],
        "mes.schedules": [],
    }


def build_client(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    storage = FakeTransferStorage(create_payloads())
    monkeypatch.setattr(transfer_area_route, "get_storage_backend", lambda: storage)

    app = FastAPI()
    app.include_router(transfer_area_route.router)
    return TestClient(app), storage


def test_transfer_area_bootstrap_filters_out_running_tasks_and_counts_statuses(monkeypatch):
    client, _storage = build_client(monkeypatch)

    response = client.get("/api/transfer-area/bootstrap")

    assert response.status_code == 200
    payload = response.json()
    task_nos = [item["taskNo"] for item in payload["taskOverview"]]
    assert task_nos == ["JB-2026-101", "JB-2026-102"]
    assert "JB-2026-103" not in task_nos
    assert payload["pendingTaskCount"] == 1
    assert payload["storedTaskCount"] == 1


def test_transfer_area_workspace_builds_editable_trays_for_pending_task(monkeypatch):
    client, _storage = build_client(monkeypatch)

    response = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert response.status_code == 200
    payload = response.json()
    assert payload["task"]["taskNo"] == "JB-2026-101"
    assert payload["task"]["taskStatus"] == "未入库"
    assert payload["task"]["trayLimit"] == 4
    assert len(payload["assignedTrays"]) == 1
    assert len(payload["assignedTrays"]) > 0
    assert payload["assignedTrays"][0]["samples"][0]["sampleNo"] == "JB-2026-101-SP-001"
    assert len(payload["trayInventory"]) == 19


def test_transfer_area_allocate_print_confirm_and_reload_round_trip(monkeypatch):
    client, storage = build_client(monkeypatch)

    workspace = client.get("/api/transfer-area/tasks/task-101/workspace").json()
    allocation = {
        "trayLimit": workspace["task"]["trayLimit"],
        "trays": [
            {
                "trayId": tray["trayId"],
                "sampleIds": [sample["sampleId"] for sample in tray["samples"]],
            }
            for tray in workspace["assignedTrays"]
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    printed = client.post("/api/transfer-area/tasks/task-101/print-barcodes", json={"barcodeType": "CODE128"})
    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")
    reloaded = client.post("/api/transfer-area/tasks/task-101/reload")

    assert allocated.status_code == 200
    assert allocated.json()["workspace"]["assignedTrays"][0]["samples"][0]["sampleNo"] == "JB-2026-101-SP-001"

    assert printed.status_code == 200
    assert len(printed.json()["barcodes"]) > 0
    assert printed.json()["workspace"]["assignedTrays"][0]["barcode"]["barcodeNo"]

    assert confirmed.status_code == 200
    assert confirmed.json()["workspace"]["task"]["taskStatus"] == "已入库"
    assert confirmed.json()["workspace"]["assignedTrays"][0]["samples"][0]["sampleStatus"] == "已入库"

    assert reloaded.status_code == 200
    assert reloaded.json()["workspace"]["task"]["taskStatus"] == "未入库"
    assert reloaded.json()["workspace"]["assignedTrays"][0]["barcode"] is None
    assert storage.read("mes.tasks")[0]["transfer_status"] == "未入库"


def test_transfer_area_confirm_storage_succeeds_after_save_without_printing(monkeypatch):
    client, _storage = build_client(monkeypatch)

    workspace = client.get("/api/transfer-area/tasks/task-101/workspace").json()
    allocation = {
        "trayLimit": workspace["task"]["trayLimit"],
        "trays": [
            {
                "trayId": tray["trayId"],
                "sampleIds": [sample["sampleId"] for sample in tray["samples"]],
            }
            for tray in workspace["assignedTrays"]
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")

    assert allocated.status_code == 200
    assert confirmed.status_code == 200
    assert confirmed.json()["workspace"]["task"]["taskStatus"] == "已入库"
    assert confirmed.json()["workspace"]["assignedTrays"][0]["samples"][0]["sampleStatus"] == "已入库"


def test_transfer_area_reallocate_clears_old_transfer_history_and_rewrites_tray_codes(monkeypatch):
    client, storage = build_client(monkeypatch)

    samples = storage.read("mes.samples")
    legacy_assignments = {
        "sample-1": "JB-2026-101-TP-002",
        "sample-2": "JB-2026-101-TP-002",
        "sample-3": "JB-2026-101-TP-003",
        "sample-4": "JB-2026-101-TP-003",
    }
    for sample in samples:
        if sample["id"] not in legacy_assignments:
            continue
        tray_code = legacy_assignments[sample["id"]]
        tray_serial = 1000 + int(tray_code.rsplit("-", 1)[-1])
        sample["trays"] = [{
            "tray_id": tray_serial,
            "tray_code": tray_code,
            "quantity": 1,
            "status": "未入库",
            "barcode_id": 9000 + tray_serial,
            "barcode_no": tray_code,
            "barcode_content": f"TRAY|TASK:JB-2026-101|TRAY:{tray_code}|LOAD:2",
        }]
        sample["history"] = [
            {"id": f"old-{sample['id']}-1", "time": "2026-03-20T08:00:00", "action": "样品分装托盘", "detail": tray_code},
            {"id": f"old-{sample['id']}-2", "time": "2026-03-20T09:00:00", "action": "任务已确认入库", "detail": "JB-2026-101"},
        ]
    storage.write("mes.samples", samples)
    tasks = storage.read("mes.tasks")
    tasks[0]["tray_codes"] = ["JB-2026-101-TP-002", "JB-2026-101-TP-003"]
    storage.write("mes.tasks", tasks)

    allocation = {
        "trayLimit": 2,
        "trays": [
            {"trayId": 1001, "sampleIds": ["sample-1", "sample-2"]},
            {"trayId": 1002, "sampleIds": ["sample-3", "sample-4"]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)

    assert allocated.status_code == 200
    payload = allocated.json()
    assert [tray["trayNo"] for tray in payload["workspace"]["assignedTrays"]] == ["JB-2026-101-TP-001", "JB-2026-101-TP-002"]

    updated_task = storage.read("mes.tasks")[0]
    assert updated_task["tray_codes"] == ["JB-2026-101-TP-001", "JB-2026-101-TP-002"]

    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "JB-2026-101"]
    assert updated_samples[0]["trays"][0]["tray_code"] == "JB-2026-101-TP-001"
    assert updated_samples[0]["history"][0]["detail"] == "JB-2026-101-TP-001"
    assert all(entry["action"] != "任务已确认入库" for entry in updated_samples[0]["history"])
    assert all(entry["detail"] != "JB-2026-101-TP-003" for entry in updated_samples[2]["history"])


def test_transfer_area_workspace_repairs_legacy_gap_tray_codes_without_printed_barcodes(monkeypatch):
    client, storage = build_client(monkeypatch)

    samples = storage.read("mes.samples")
    legacy_assignments = {
        "sample-1": "JB-2026-101-TP-002",
        "sample-2": "JB-2026-101-TP-002",
        "sample-3": "JB-2026-101-TP-003",
        "sample-4": "JB-2026-101-TP-003",
    }
    for sample in samples:
        if sample["id"] not in legacy_assignments:
            continue
        tray_code = legacy_assignments[sample["id"]]
        tray_serial = 1000 + int(tray_code.rsplit("-", 1)[-1])
        sample["trays"] = [{
            "tray_id": tray_serial,
            "tray_code": tray_code,
            "quantity": 1,
            "status": "未入库",
            "barcode_id": None,
            "barcode_no": None,
            "barcode_content": None,
            "barcode_type": None,
            "printed_at": None,
        }]
    storage.write("mes.samples", samples)
    tasks = storage.read("mes.tasks")
    tasks[0]["tray_codes"] = ["JB-2026-101-TP-002", "JB-2026-101-TP-003"]
    storage.write("mes.tasks", tasks)

    response = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert response.status_code == 200
    payload = response.json()
    assert [tray["trayNo"] for tray in payload["assignedTrays"]] == ["JB-2026-101-TP-001", "JB-2026-101-TP-002"]
    updated_task = storage.read("mes.tasks")[0]
    assert updated_task["tray_codes"] == ["JB-2026-101-TP-001", "JB-2026-101-TP-002"]
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "JB-2026-101"]
    assert updated_samples[0]["trays"][0]["tray_code"] == "JB-2026-101-TP-001"
    assert updated_samples[2]["trays"][0]["tray_code"] == "JB-2026-101-TP-002"


def test_transfer_area_allocate_rejects_when_system_trays_are_insufficient(monkeypatch):
    client, storage = build_client(monkeypatch)

    samples = storage.read("mes.samples")
    for index in range(1, 21):
      samples.append(
          {
              "id": f"occupied-sample-{index}",
              "code": f"OCC-2026-{index:03d}-SP-001",
              "task_code": f"OCC-2026-{index:03d}",
              "status": "未入库",
              "flow_status": "到货",
              "location": "接驳区",
              "trays": [
                  {
                      "tray_id": 5000 + index,
                      "tray_code": f"OCC-2026-{index:03d}-TP-001",
                      "quantity": 1,
                      "status": "未入库",
                      "barcode_id": None,
                      "barcode_no": None,
                      "barcode_content": None,
                      "barcode_type": None,
                      "printed_at": None,
                  }
              ],
          }
      )
    storage.write("mes.samples", samples)

    allocation = {
        "trayLimit": 4,
        "trays": [
            {
                "trayId": 1001,
                "sampleIds": ["sample-1", "sample-2", "sample-3", "sample-4"],
            }
        ],
    }

    response = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)

    assert response.status_code == 400
    assert response.json()["detail"] == "系统剩余托盘不足，当前最多可分配 0 个托盘。"
