from fastapi import FastAPI
from fastapi.testclient import TestClient


class FakeTransferStorage:
    def __init__(self, payloads=None):
        self.payloads = {
            "mes.tasks": [],
            "mes.samples": [],
            "mes.schedules": [],
            "mes.experiments": [],
            "mes.experiment_trays": [],
            "mes.experiment_samples": [],
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
                "code": "SYLU-2026-03-101",
                "name": "连接器批次 A",
                "test_type": "盐雾试验 / 振动试验",
                "sample_count": 4,
                "arrival_at": "2026-03-21 10:20",
                "status": "待排程",
            },
            {
                "id": "task-102",
                "code": "SYLU-2026-03-102",
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
                "code": "SYLU-2026-03-103",
                "name": "实验进行中任务",
                "test_type": "振动试验",
                "sample_count": 1,
                "arrival_at": "2026-03-20 08:00",
                "status": "实验进行中",
            },
        ],
        "mes.samples": [
            {"id": "sample-1", "code": "SYLU-2026-03-101-SP-001", "task_code": "SYLU-2026-03-101", "status": "运输中", "flow_status": "运输中", "location": ""},
            {"id": "sample-2", "code": "SYLU-2026-03-101-SP-002", "task_code": "SYLU-2026-03-101", "status": "运输中", "flow_status": "运输中", "location": ""},
            {"id": "sample-3", "code": "SYLU-2026-03-101-SP-003", "task_code": "SYLU-2026-03-101", "status": "运输中", "flow_status": "运输中", "location": ""},
            {"id": "sample-4", "code": "SYLU-2026-03-101-SP-004", "task_code": "SYLU-2026-03-101", "status": "运输中", "flow_status": "运输中", "location": ""},
            {
                "id": "sample-5",
                "code": "SYLU-2026-03-102-SP-001",
                "task_code": "SYLU-2026-03-102",
                "status": "已入库",
                "flow_status": "已入库",
                "location": "接驳区",
                "trays": [
                    {
                        "tray_id": 1001,
                        "tray_code": "SYLU-2026-03-102-TP-001",
                        "quantity": 1,
                        "status": "已入库",
                        "barcode_id": 9001,
                        "barcode_no": "SYLU-2026-03-102-TP-001",
                        "barcode_content": "SYLU-2026-03-102-TP-001",
                    }
                ],
            },
            {
                "id": "sample-6",
                "code": "SYLU-2026-03-102-SP-002",
                "task_code": "SYLU-2026-03-102",
                "status": "已入库",
                "flow_status": "已入库",
                "location": "接驳区",
                "trays": [
                    {
                        "tray_id": 1001,
                        "tray_code": "SYLU-2026-03-102-TP-001",
                        "quantity": 1,
                        "status": "已入库",
                        "barcode_id": 9001,
                        "barcode_no": "SYLU-2026-03-102-TP-001",
                        "barcode_content": "SYLU-2026-03-102-TP-001",
                    }
                ],
            },
        ],
        "mes.schedules": [],
        "mes.experiments": [
            {
                "id": "experiment-101-a",
                "task_code": "SYLU-2026-03-101",
                "experiment_code": "SYLU-2026-03-101-A",
                "experiment_name": "盐雾试验",
                "required_device": "盐雾试验",
                "status": "待排程",
            },
            {
                "id": "experiment-101-b",
                "task_code": "SYLU-2026-03-101",
                "experiment_code": "SYLU-2026-03-101-B",
                "experiment_name": "振动试验",
                "required_device": "振动试验",
                "status": "待排程",
            },
            {
                "id": "experiment-101-c",
                "task_code": "SYLU-2026-03-101",
                "experiment_code": "SYLU-2026-03-101-C",
                "experiment_name": "温度冲击试验",
                "required_device": "温度冲击试验",
                "status": "待排程",
            },
        ],
        "mes.experiment_trays": [],
        "mes.experiment_samples": [],
    }


def build_client(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    storage = FakeTransferStorage(create_payloads())
    monkeypatch.setattr(transfer_area_route, "get_storage_backend", lambda: storage)

    app = FastAPI()
    app.include_router(transfer_area_route.router)
    return TestClient(app), storage


def seed_task_102_dispatch_data(storage, schedules):
    storage.write(
        "mes.experiments",
        [
            {
                "id": "experiment-102-a",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-A",
                "experiment_name": "耐久试验",
                "required_device": "耐久试验",
                "status": "已排程",
            },
            {
                "id": "experiment-102-b",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-B",
                "experiment_name": "通电试验",
                "required_device": "通电试验",
                "status": "已排程",
            },
        ],
    )
    storage.write(
        "mes.experiment_trays",
        [
            {"task_code": "SYLU-2026-03-102", "experiment_code": "SYLU-2026-03-102-A", "tray_code": "SYLU-2026-03-102-TP-001"},
            {"task_code": "SYLU-2026-03-102", "experiment_code": "SYLU-2026-03-102-B", "tray_code": "SYLU-2026-03-102-TP-001"},
        ],
    )
    storage.write("mes.schedules", schedules)


def test_transfer_area_bootstrap_filters_out_running_tasks_and_counts_statuses(monkeypatch):
    client, _storage = build_client(monkeypatch)

    response = client.get("/api/transfer-area/bootstrap")

    assert response.status_code == 200
    payload = response.json()
    task_nos = [item["taskNo"] for item in payload["taskOverview"]]
    assert task_nos == ["SYLU-2026-03-101", "SYLU-2026-03-102"]
    assert "SYLU-2026-03-103" not in task_nos
    assert payload["taskOverview"][0]["experimentTypeText"] == "盐雾试验 / 振动试验 / 温度冲击试验"
    assert payload["pendingTaskCount"] == 1
    assert payload["storedTaskCount"] == 1


def test_transfer_area_workspace_builds_editable_trays_for_pending_task(monkeypatch):
    client, _storage = build_client(monkeypatch)

    response = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert response.status_code == 200
    payload = response.json()
    assert payload["task"]["taskNo"] == "SYLU-2026-03-101"
    assert payload["task"]["experimentTypeText"] == "盐雾试验 / 振动试验 / 温度冲击试验"
    assert payload["task"]["taskStatus"] == "未入库"
    assert payload["task"]["trayLimit"] == 4
    assert len(payload["assignedTrays"]) == 1
    assert len(payload["assignedTrays"]) > 0
    assert payload["assignedTrays"][0]["samples"][0]["sampleNo"] == "SYLU-2026-03-101-SP-001"
    assert len(payload["trayInventory"]) == 19


def test_transfer_area_dispatch_lookup_returns_staging_and_sorted_lab_candidates(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(
        storage,
        [
            {
                "id": "schedule-102-b",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-B",
                "device": "振动一室",
                "start_at": "2026-03-20T09:00:00",
                "end_at": "2026-03-20T12:00:00",
            },
            {
                "id": "schedule-102-a",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-A",
                "device": "冲击一室",
                "start_at": "2026-03-20T14:00:00",
                "end_at": "2026-03-20T16:00:00",
            },
        ],
    )

    response = client.get("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch")

    assert response.status_code == 200
    payload = response.json()
    assert payload["tray"]["trayNo"] == "SYLU-2026-03-102-TP-001"
    assert payload["tray"]["taskNo"] == "SYLU-2026-03-102"
    assert payload["tray"]["sampleCount"] == 2
    assert [item["targetName"] for item in payload["destinations"]] == [
        "恒温恒湿间（暂存间）",
        "振动一室",
        "冲击一室",
    ]
    assert payload["destinations"][0]["targetType"] == "staging"
    assert payload["destinations"][1]["preferred"] is True
    assert payload["destinations"][1]["experimentCode"] == "SYLU-2026-03-102-B"
    assert payload["destinations"][2]["preferred"] is False


def test_transfer_area_dispatch_lookup_keeps_unscheduled_experiments_pending(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])

    response = client.get("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch")

    assert response.status_code == 200
    payload = response.json()
    assert [item["targetName"] for item in payload["destinations"]] == [
        "恒温恒湿间（暂存间）",
        "耐久试验（待排程）",
        "通电试验（待排程）",
    ]
    assert payload["destinations"][1]["preferred"] is False
    assert payload["destinations"][1]["scheduled"] is False
    assert payload["destinations"][2]["preferred"] is False
    assert payload["destinations"][2]["scheduled"] is False


def test_transfer_area_dispatch_to_staging_updates_tray_samples_and_history(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["tray"]["trayNo"] == "SYLU-2026-03-102-TP-001"
    assert payload["tray"]["trayStatus"] == "送至暂存间"
    assert payload["affectedSampleCount"] == 2

    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "送至暂存间" for sample in updated_samples)
    assert all(sample["flow_status"] == "送至暂存间" for sample in updated_samples)
    assert all(sample["location"] == "恒温恒湿间（暂存间）" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "送至暂存间" for sample in updated_samples)
    assert all(sample["history"][0]["action"] == "送至暂存间" for sample in updated_samples)


def test_transfer_area_dispatch_to_lab_updates_tray_samples_and_history(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(
        storage,
        [
            {
                "id": "schedule-102-b",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-B",
                "device": "振动一室",
                "start_at": "2026-03-20T09:00:00",
                "end_at": "2026-03-20T12:00:00",
            },
        ],
    )

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-B"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["tray"]["trayStatus"] == "送至实验室"
    assert payload["affectedSampleCount"] == 2

    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "送至实验室" for sample in updated_samples)
    assert all(sample["flow_status"] == "送至实验室" for sample in updated_samples)
    assert all(sample["location"] == "振动一室" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "送至实验室" for sample in updated_samples)
    assert all(sample["history"][0]["action"] == "送至实验室" for sample in updated_samples)
    assert all("SYLU-2026-03-102-TP-001 -> 振动一室" in sample["history"][0]["detail"] for sample in updated_samples)


def test_transfer_area_dispatch_rejects_duplicate_outbound(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])

    first = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )
    second = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )

    assert first.status_code == 200
    assert second.status_code == 400
    assert second.json()["detail"] == "该托盘已送往目标位置，请勿重复操作"


def test_transfer_area_workspace_backfills_three_experiments_for_sylu_task_when_storage_has_none(monkeypatch):
    client, storage = build_client(monkeypatch)
    storage.write("mes.experiments", [])

    response = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert response.status_code == 200
    payload = response.json()
    assert [item["experimentCode"] for item in payload["experiments"]] == [
        "SYLU-2026-03-101-A",
        "SYLU-2026-03-101-B",
        "SYLU-2026-03-101-C",
    ]
    assert len({item["experimentName"] for item in payload["experiments"]}) == 3


def test_transfer_area_backfills_missing_task_samples_from_sample_count(monkeypatch):
    client, storage = build_client(monkeypatch)
    storage.write(
        "mes.samples",
        [sample for sample in storage.read("mes.samples") if sample["task_code"] != "SYLU-2026-03-101"],
    )

    bootstrap = client.get("/api/transfer-area/bootstrap")
    workspace = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert bootstrap.status_code == 200
    task_row = next(item for item in bootstrap.json()["taskOverview"] if item["taskNo"] == "SYLU-2026-03-101")
    assert task_row["sampleCodes"] == [
        "SYLU-2026-03-101-SP-001",
        "SYLU-2026-03-101-SP-002",
        "SYLU-2026-03-101-SP-003",
        "SYLU-2026-03-101-SP-004",
    ]

    assert workspace.status_code == 200
    assert [sample["sampleNo"] for sample in workspace.json()["assignedTrays"][0]["samples"]] == [
        "SYLU-2026-03-101-SP-001",
        "SYLU-2026-03-101-SP-002",
        "SYLU-2026-03-101-SP-003",
        "SYLU-2026-03-101-SP-004",
    ]

    stored_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-101"]
    assert [sample["code"] for sample in stored_samples] == [
        "SYLU-2026-03-101-SP-001",
        "SYLU-2026-03-101-SP-002",
        "SYLU-2026-03-101-SP-003",
        "SYLU-2026-03-101-SP-004",
    ]


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
        "experimentTrays": [
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [1001]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [1001, 1002]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [1002]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    printed = client.post("/api/transfer-area/tasks/task-101/print-barcodes", json={"barcodeType": "CODE128"})
    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")
    reloaded = client.post("/api/transfer-area/tasks/task-101/reload")

    assert allocated.status_code == 200
    assert allocated.json()["workspace"]["assignedTrays"][0]["samples"][0]["sampleNo"] == "SYLU-2026-03-101-SP-001"

    assert printed.status_code == 200
    assert len(printed.json()["barcodes"]) > 0
    assert printed.json()["workspace"]["assignedTrays"][0]["barcode"]["barcodeNo"]

    assert confirmed.status_code == 200
    assert confirmed.json()["workspace"]["task"]["taskStatus"] == "已入库"
    assert confirmed.json()["workspace"]["assignedTrays"][0]["samples"][0]["sampleStatus"] == "已入库"

    assert reloaded.status_code == 200
    assert reloaded.json()["workspace"]["task"]["taskStatus"] == "未入库"
    assert reloaded.json()["workspace"]["assignedTrays"][0]["barcode"] is None
    assert reloaded.json()["workspace"]["assignedTrays"][0]["experimentLabels"] == []
    assert all(item["assignedTrayCount"] == 0 for item in reloaded.json()["workspace"]["experiments"])
    assert storage.read("mes.tasks")[0]["transfer_status"] == "未入库"
    assert storage.read("mes.tasks")[0]["tray_codes"] == []
    assert storage.read("mes.experiment_trays") == []
    assert storage.read("mes.experiment_samples") == []
    assert all(sample["trays"] == [] for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-101")


def test_transfer_area_workspace_and_allocate_include_experiment_tray_assignments(monkeypatch):
    client, storage = build_client(monkeypatch)

    workspace = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert workspace.status_code == 200
    workspace_payload = workspace.json()
    assert [item["experimentCode"] for item in workspace_payload["experiments"]] == ["SYLU-2026-03-101-A", "SYLU-2026-03-101-B", "SYLU-2026-03-101-C"]
    assert workspace_payload["assignedTrays"][0]["experimentLabels"] == []

    allocation = {
        "trayLimit": 2,
        "trays": [
            {"trayId": 1001, "sampleIds": ["sample-1", "sample-2"]},
            {"trayId": 1002, "sampleIds": ["sample-3", "sample-4"]},
        ],
        "experimentTrays": [
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [1001]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [1001, 1002]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [1002]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)

    assert allocated.status_code == 200
    allocated_payload = allocated.json()["workspace"]
    assert allocated_payload["experiments"][0]["assignedTrayCount"] == 1
    assert allocated_payload["experiments"][1]["assignedTrayCount"] == 2
    assert allocated_payload["experiments"][2]["assignedTrayCount"] == 1
    assert allocated_payload["assignedTrays"][0]["experimentLabels"] == ["盐雾试验", "振动试验"]
    assert allocated_payload["assignedTrays"][1]["experimentLabels"] == ["振动试验", "温度冲击试验"]
    assert allocated_payload["assignedTrays"][0]["samples"][0]["experimentCodes"] == ["SYLU-2026-03-101-A", "SYLU-2026-03-101-B"]
    assert allocated_payload["assignedTrays"][1]["samples"][0]["experimentCodes"] == ["SYLU-2026-03-101-B", "SYLU-2026-03-101-C"]
    assert storage.read("mes.experiment_trays") == [
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-A", "tray_code": "SYLU-2026-03-101-TP-001"},
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-B", "tray_code": "SYLU-2026-03-101-TP-001"},
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-B", "tray_code": "SYLU-2026-03-101-TP-002"},
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-C", "tray_code": "SYLU-2026-03-101-TP-002"},
    ]
    assert storage.read("mes.experiment_samples") == [
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-A", "sample_code": "SYLU-2026-03-101-SP-001"},
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-A", "sample_code": "SYLU-2026-03-101-SP-002"},
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-B", "sample_code": "SYLU-2026-03-101-SP-001"},
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-B", "sample_code": "SYLU-2026-03-101-SP-002"},
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-B", "sample_code": "SYLU-2026-03-101-SP-003"},
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-B", "sample_code": "SYLU-2026-03-101-SP-004"},
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-C", "sample_code": "SYLU-2026-03-101-SP-003"},
        {"task_code": "SYLU-2026-03-101", "experiment_code": "SYLU-2026-03-101-C", "sample_code": "SYLU-2026-03-101-SP-004"},
    ]

    printed = client.post("/api/transfer-area/tasks/task-101/print-barcodes", json={"barcodeType": "CODE128"})

    assert printed.status_code == 200
    assert printed.json()["barcodes"][0]["experimentLabels"] == ["盐雾试验", "振动试验"]
    assert printed.json()["barcodes"][0]["barcodeNo"] == "SYLU-2026-03-101-TP-001"
    assert printed.json()["barcodes"][0]["barcodeContent"] == "SYLU-2026-03-101-TP-001"


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


def test_transfer_area_confirm_storage_sets_unscheduled_since_only_for_experiments_without_formal_schedule(monkeypatch):
    client, storage = build_client(monkeypatch)
    storage.write(
        "mes.schedules",
        [
            {
                "id": "schedule-101-b",
                "task_code": "SYLU-2026-03-101",
                "experiment_code": "SYLU-2026-03-101-B",
                "device": "振动一室",
                "start_at": "2026-03-22T09:00:00",
                "end_at": "2026-03-22T12:00:00",
            }
        ],
    )

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

    experiments = {
        item["experiment_code"]: item
        for item in storage.read("mes.experiments")
        if item["task_code"] == "SYLU-2026-03-101"
    }
    assert experiments["SYLU-2026-03-101-A"]["unscheduled_since"]
    assert experiments["SYLU-2026-03-101-B"].get("unscheduled_since", "") == ""
    assert experiments["SYLU-2026-03-101-C"]["unscheduled_since"]


def test_transfer_area_allows_second_tray_dispatch_when_transfer_flag_is_missing_but_task_was_already_stored(monkeypatch):
    client, storage = build_client(monkeypatch)

    allocation = {
        "trayLimit": 2,
        "trays": [
            {"trayId": 1001, "sampleIds": ["sample-1", "sample-2"]},
            {"trayId": 1002, "sampleIds": ["sample-3", "sample-4"]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")

    assert allocated.status_code == 200
    assert confirmed.status_code == 200

    tasks = storage.read("mes.tasks")
    tasks[0]["transfer_status"] = ""
    storage.write("mes.tasks", tasks)

    first = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-101-TP-001/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )
    second = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-101-TP-002/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["tray"]["trayNo"] == "SYLU-2026-03-101-TP-002"


def test_transfer_area_keeps_started_stored_tasks_visible_and_rejects_reload(monkeypatch):
    client, storage = build_client(monkeypatch)

    tasks = storage.read("mes.tasks")
    tasks[1]["status"] = "实验进行中"
    storage.write("mes.tasks", tasks)

    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["status"] = "实验进行中"
        sample["flow_status"] = "实验进行中"
        sample["trays"] = [
            {
                **sample["trays"][0],
                "status": "实验进行中",
            }
        ]
    storage.write("mes.samples", samples)

    bootstrap = client.get("/api/transfer-area/bootstrap")
    workspace = client.get("/api/transfer-area/tasks/task-102/workspace")
    reloaded = client.post("/api/transfer-area/tasks/task-102/reload")

    assert bootstrap.status_code == 200
    task_row = next(item for item in bootstrap.json()["taskOverview"] if item["taskNo"] == "SYLU-2026-03-102")
    assert task_row["taskStatus"] == "已入库"
    assert task_row["taskProgress"] == "实验进行中"

    assert workspace.status_code == 200
    assert workspace.json()["task"]["taskStatus"] == "已入库"
    assert workspace.json()["task"]["taskProgress"] == "实验进行中"
    assert workspace.json()["task"]["reloadBlocked"] is True
    assert workspace.json()["task"]["reloadBlockedReason"] == "该任务已有托盘开始实验，不能重新入库。"

    assert reloaded.status_code == 400
    assert reloaded.json()["detail"] == "该任务已有托盘开始实验，不能重新入库。"


def test_transfer_area_progress_stays_running_until_all_task_experiments_complete(monkeypatch):
    client, storage = build_client(monkeypatch)

    storage.write(
        "mes.experiments",
        [
            {
                "id": "experiment-102-a",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-A",
                "experiment_name": "耐久试验",
                "required_device": "耐久试验",
                "status": "实验已完成",
            },
            {
                "id": "experiment-102-b",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-B",
                "experiment_name": "通电试验",
                "required_device": "通电试验",
                "status": "待排程",
            },
        ],
    )

    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["status"] = "实验已完成"
        sample["flow_status"] = "实验已完成"
        sample["location"] = "耐久试验室"
        sample["trays"] = [
            {
                **sample["trays"][0],
                "status": "实验已完成",
            }
        ]
    storage.write("mes.samples", samples)

    bootstrap = client.get("/api/transfer-area/bootstrap")
    workspace = client.get("/api/transfer-area/tasks/task-102/workspace")

    assert bootstrap.status_code == 200
    task_row = next(item for item in bootstrap.json()["taskOverview"] if item["taskNo"] == "SYLU-2026-03-102")
    assert task_row["taskStatus"] == "已入库"
    assert task_row["taskProgress"] == "实验进行中"

    assert workspace.status_code == 200
    assert workspace.json()["task"]["taskStatus"] == "已入库"
    assert workspace.json()["task"]["taskProgress"] == "实验进行中"


def test_transfer_area_hides_returned_tasks_from_active_views_even_with_unfinished_experiments(monkeypatch):
    client, storage = build_client(monkeypatch)

    storage.write(
        "mes.experiments",
        [
            {
                "id": "experiment-102-a",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-A",
                "experiment_name": "耐久试验",
                "required_device": "耐久试验",
                "status": "实验已完成",
            },
            {
                "id": "experiment-102-b",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-B",
                "experiment_name": "通电试验",
                "required_device": "通电试验",
                "status": "待排程",
            },
        ],
    )

    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["status"] = "厂家收回"
        sample["flow_status"] = "厂家收回"
        sample["location"] = "厂家收回"
        sample["trays"] = [
            {
                **sample["trays"][0],
                "status": "厂家收回",
            }
        ]
    storage.write("mes.samples", samples)

    bootstrap = client.get("/api/transfer-area/bootstrap")
    workspace = client.get("/api/transfer-area/tasks/task-102/workspace")

    assert bootstrap.status_code == 200
    task_nos = [item["taskNo"] for item in bootstrap.json()["taskOverview"]]
    assert "SYLU-2026-03-102" not in task_nos

    assert workspace.status_code == 404


def test_transfer_area_bootstrap_hides_explicitly_returned_transfer_tasks(monkeypatch):
    client, storage = build_client(monkeypatch)
    tasks = storage.read("mes.tasks")
    for task in tasks:
        if task["code"] == "SYLU-2026-03-102":
            task["transfer_status"] = "厂家收回"
    storage.write("mes.tasks", tasks)

    bootstrap = client.get("/api/transfer-area/bootstrap")
    workspace = client.get("/api/transfer-area/tasks/task-102/workspace")

    assert bootstrap.status_code == 200
    task_nos = [item["taskNo"] for item in bootstrap.json()["taskOverview"]]
    assert "SYLU-2026-03-102" not in task_nos
    assert workspace.status_code == 404


def test_transfer_area_returned_trays_do_not_occupy_system_inventory(monkeypatch):
    client, storage = build_client(monkeypatch)

    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["status"] = "厂家收回"
        sample["flow_status"] = "厂家收回"
        sample["location"] = "厂家收回"
        sample["trays"] = [
            {
                **sample["trays"][0],
                "status": "厂家收回",
            }
        ]
    storage.write("mes.samples", samples)

    workspace = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert workspace.status_code == 200
    assert workspace.json()["task"]["remainingTrayCount"] == 20
    assert len(workspace.json()["trayInventory"]) == 20


def test_transfer_area_reallocate_clears_old_transfer_history_and_rewrites_tray_codes(monkeypatch):
    client, storage = build_client(monkeypatch)

    samples = storage.read("mes.samples")
    legacy_assignments = {
        "sample-1": "SYLU-2026-03-101-TP-002",
        "sample-2": "SYLU-2026-03-101-TP-002",
        "sample-3": "SYLU-2026-03-101-TP-003",
        "sample-4": "SYLU-2026-03-101-TP-003",
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
            "barcode_content": tray_code,
        }]
        sample["history"] = [
            {"id": f"old-{sample['id']}-1", "time": "2026-03-20T08:00:00", "action": "样品分装托盘", "detail": tray_code},
            {"id": f"old-{sample['id']}-2", "time": "2026-03-20T09:00:00", "action": "任务已确认入库", "detail": "SYLU-2026-03-101"},
        ]
    storage.write("mes.samples", samples)
    tasks = storage.read("mes.tasks")
    tasks[0]["tray_codes"] = ["SYLU-2026-03-101-TP-002", "SYLU-2026-03-101-TP-003"]
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
    assert [tray["trayNo"] for tray in payload["workspace"]["assignedTrays"]] == ["SYLU-2026-03-101-TP-001", "SYLU-2026-03-101-TP-002"]

    updated_task = storage.read("mes.tasks")[0]
    assert updated_task["tray_codes"] == ["SYLU-2026-03-101-TP-001", "SYLU-2026-03-101-TP-002"]

    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-101"]
    assert updated_samples[0]["trays"][0]["tray_code"] == "SYLU-2026-03-101-TP-001"
    assert updated_samples[0]["history"][0]["detail"] == "SYLU-2026-03-101-TP-001"
    assert all(entry["action"] != "任务已确认入库" for entry in updated_samples[0]["history"])
    assert all(entry["detail"] != "SYLU-2026-03-101-TP-003" for entry in updated_samples[2]["history"])


def test_transfer_area_workspace_repairs_legacy_gap_tray_codes_without_printed_barcodes(monkeypatch):
    client, storage = build_client(monkeypatch)

    samples = storage.read("mes.samples")
    legacy_assignments = {
        "sample-1": "SYLU-2026-03-101-TP-002",
        "sample-2": "SYLU-2026-03-101-TP-002",
        "sample-3": "SYLU-2026-03-101-TP-003",
        "sample-4": "SYLU-2026-03-101-TP-003",
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
    tasks[0]["tray_codes"] = ["SYLU-2026-03-101-TP-002", "SYLU-2026-03-101-TP-003"]
    storage.write("mes.tasks", tasks)

    response = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert response.status_code == 200
    payload = response.json()
    assert [tray["trayNo"] for tray in payload["assignedTrays"]] == ["SYLU-2026-03-101-TP-001", "SYLU-2026-03-101-TP-002"]
    updated_task = storage.read("mes.tasks")[0]
    assert updated_task["tray_codes"] == ["SYLU-2026-03-101-TP-001", "SYLU-2026-03-101-TP-002"]
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-101"]
    assert updated_samples[0]["trays"][0]["tray_code"] == "SYLU-2026-03-101-TP-001"
    assert updated_samples[2]["trays"][0]["tray_code"] == "SYLU-2026-03-101-TP-002"


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


def test_transfer_area_confirm_storage_backfills_arrival_time_for_preallocated_tasks(monkeypatch):
    client, storage = build_client(monkeypatch)
    tasks = storage.read("mes.tasks")
    tasks.append(
        {
            "id": "task-201",
            "code": "SYLU-2026-04-201",
            "name": "中控新增任务",
            "test_type": "盐雾试验",
            "sample_count": 2,
            "arrival_at": "",
            "status": "待排程",
            "tray_limit": 4,
            "tray_codes": ["SYLU-2026-04-201-TP-001"],
        }
    )
    storage.write("mes.tasks", tasks)
    samples = storage.read("mes.samples")
    samples.extend(
        [
            {
                "id": "sample-201-1",
                "code": "SYLU-2026-04-201-SP-001",
                "task_code": "SYLU-2026-04-201",
                "status": "未入库",
                "flow_status": "运输中",
                "location": "",
                "trays": [
                    {
                        "tray_id": 1001,
                        "tray_code": "SYLU-2026-04-201-TP-001",
                        "quantity": 1,
                        "status": "未入库",
                    }
                ],
            },
            {
                "id": "sample-201-2",
                "code": "SYLU-2026-04-201-SP-002",
                "task_code": "SYLU-2026-04-201",
                "status": "未入库",
                "flow_status": "运输中",
                "location": "",
                "trays": [
                    {
                        "tray_id": 1001,
                        "tray_code": "SYLU-2026-04-201-TP-001",
                        "quantity": 1,
                        "status": "未入库",
                    }
                ],
            },
        ]
    )
    storage.write("mes.samples", samples)

    response = client.post("/api/transfer-area/tasks/task-201/confirm-storage")

    assert response.status_code == 200
    assert response.json()["workspace"]["task"]["taskStatus"] == "已入库"
    assert response.json()["workspace"]["task"]["receivedTime"]
    updated_task = next(task for task in storage.read("mes.tasks") if task["code"] == "SYLU-2026-04-201")
    assert updated_task["arrival_at"]
