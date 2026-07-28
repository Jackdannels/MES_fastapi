from copy import deepcopy
import threading

import pytest
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
            "mes.experiment_runs": [],
            "mes.experiment_run_trays": [],
            "mes.experiment_run_steps": [],
            "mes.staging_events": [],
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


class TrackingReadManyTransferStorage(FakeTransferStorage):
    def __init__(self, payloads=None):
        super().__init__(payloads)
        self.read_all_calls = 0
        self.read_many_calls = []

    def read_all(self):
        self.read_all_calls += 1
        return super().read_all()

    def read_many(self, keys):
        requested_keys = list(keys)
        self.read_many_calls.append(requested_keys)
        return {key: list(self.payloads.get(key, [])) for key in requested_keys}


class ReadOnlyTrackingTransferStorage(TrackingReadManyTransferStorage):
    def __init__(self, payloads=None):
        super().__init__(payloads)
        self.write_calls = []
        self.write_many_calls = []

    def write(self, key, value):
        self.write_calls.append((key, deepcopy(value)))
        super().write(key, value)

    def write_many(self, updates):
        self.write_many_calls.append(deepcopy(dict(updates)))
        super().write_many(updates)


class ScopedTrackingTransferStorage(TrackingReadManyTransferStorage):
    def __init__(self, payloads=None):
        super().__init__(payloads)
        self.scoped_writes = []

    def write_many_scoped(self, updates):
        copied_updates = {key: deepcopy(value) for key, value in dict(updates).items()}
        self.scoped_writes.append(copied_updates)
        for key, value in copied_updates.items():
            if key != "mes.samples":
                self.payloads[key] = list(value)
                continue
            samples_by_code = {sample.get("code"): sample for sample in self.payloads[key]}
            for sample in value:
                samples_by_code[sample.get("code")] = sample
            self.payloads[key] = list(samples_by_code.values())


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
                "transfer_status": "到货",
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
                "status": "到货",
                "flow_status": "到货",
                "location": "接驳区",
                "trays": [
                    {
                        "tray_id": 1001,
                        "tray_code": "SYLU-2026-03-102-TP-001",
                        "quantity": 1,
                        "status": "到货",
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
                "status": "到货",
                "flow_status": "到货",
                "location": "接驳区",
                "trays": [
                    {
                        "tray_id": 1001,
                        "tray_code": "SYLU-2026-03-102-TP-001",
                        "quantity": 1,
                        "status": "到货",
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
        "mes.experiment_runs": [],
    }


def build_client(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    storage = FakeTransferStorage(create_payloads())
    monkeypatch.setattr(transfer_area_route, "get_storage_backend", lambda: storage)

    app = FastAPI()
    app.include_router(transfer_area_route.router)
    return TestClient(app), storage


def test_transfer_area_write_snapshot_merges_without_reverting_concurrent_lab_progress(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    storage = FakeTransferStorage(
        {
            "mes.samples": [
                {
                    "code": "SP-LAB",
                    "location": "冲击一室",
                    "status": "已到达实验室",
                    "flow_status": "已到达实验室",
                    "task_code": "TASK-CONCURRENT",
                    "updated_at": "2026-06-12 10:01:00",
                    "trays": [{"tray_code": "TP-A", "status": "已到达实验室", "quantity": 1, "updated_at": "2026-06-12 10:01:00"}],
                },
                {
                    "code": "SP-STAGING",
                    "location": "接驳区",
                    "status": "到货",
                    "flow_status": "到货",
                    "task_code": "TASK-CONCURRENT",
                    "updated_at": "2026-06-12 10:00:00",
                    "trays": [{"tray_code": "TP-B", "status": "到货", "quantity": 1, "updated_at": "2026-06-12 10:00:00"}],
                },
            ],
            "mes.staging_events": [
                {"id": "event-existing", "tray_code": "TP-A", "task_code": "TASK-CONCURRENT", "action": "stock_out", "time": "2026-06-12 10:00:30"}
            ],
        }
    )
    monkeypatch.setattr(transfer_area_route, "get_storage_backend", lambda: storage)

    stale_snapshot = deepcopy(transfer_area_route.read_snapshot())
    stale_snapshot["samples"][0]["status"] = "送至实验室"
    stale_snapshot["samples"][0]["flow_status"] = "送至实验室"
    stale_snapshot["samples"][0]["updated_at"] = "2026-06-12 10:00:00"
    stale_snapshot["samples"][0]["trays"][0]["status"] = "送至实验室"
    stale_snapshot["samples"][0]["trays"][0]["updated_at"] = "2026-06-12 10:00:00"
    stale_snapshot["samples"][1]["status"] = "送至暂存间"
    stale_snapshot["samples"][1]["flow_status"] = "送至暂存间"
    stale_snapshot["samples"][1]["location"] = "恒温恒湿间（暂存间）"
    stale_snapshot["samples"][1]["updated_at"] = "2026-06-12 10:02:00"
    stale_snapshot["samples"][1]["trays"][0]["status"] = "送至暂存间"
    stale_snapshot["samples"][1]["trays"][0]["updated_at"] = "2026-06-12 10:02:00"
    stale_snapshot["staging_events"] = [
        {"id": "event-new", "tray_code": "TP-B", "task_code": "TASK-CONCURRENT", "action": "stock_out", "time": "2026-06-12 10:02:00"}
    ]

    transfer_area_route.write_snapshot(stale_snapshot)

    samples = {sample["code"]: sample for sample in storage.read("mes.samples")}
    assert samples["SP-LAB"]["status"] == "已到达实验室"
    assert samples["SP-LAB"]["trays"][0]["status"] == "已到达实验室"
    assert samples["SP-STAGING"]["status"] == "送至暂存间"
    assert samples["SP-STAGING"]["trays"][0]["status"] == "送至暂存间"
    assert [event["id"] for event in storage.read("mes.staging_events")] == ["event-existing", "event-new"]


def test_transfer_area_serializes_conflicting_dispatches_before_business_validation(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])
    original_apply_dispatch = transfer_area_route.apply_dispatch
    first_apply_entered = threading.Event()
    second_apply_entered = threading.Event()
    release_first_apply = threading.Event()
    apply_call_guard = threading.Lock()
    apply_call_count = 0

    def gated_apply_dispatch(*args, **kwargs):
        nonlocal apply_call_count
        with apply_call_guard:
            apply_call_count += 1
            call_number = apply_call_count
        if call_number == 1:
            first_apply_entered.set()
            if not release_first_apply.wait(timeout=5):
                raise RuntimeError("timed out waiting to release first dispatch")
        else:
            second_apply_entered.set()
        return original_apply_dispatch(*args, **kwargs)

    monkeypatch.setattr(transfer_area_route, "apply_dispatch", gated_apply_dispatch)
    responses = []

    def dispatch_to_staging():
        responses.append(
            client.post(
                "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
                json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
            )
        )

    first_thread = threading.Thread(target=dispatch_to_staging)
    second_thread = threading.Thread(target=dispatch_to_staging)
    first_thread.start()
    assert first_apply_entered.wait(timeout=5)
    second_thread.start()
    second_reached_business_mutation_while_first_was_open = second_apply_entered.wait(timeout=0.5)
    release_first_apply.set()
    first_thread.join(timeout=5)
    second_thread.join(timeout=5)

    assert not first_thread.is_alive()
    assert not second_thread.is_alive()
    assert second_reached_business_mutation_while_first_was_open is False
    assert sorted(response.status_code for response in responses) == [200, 400]
    assert sum(response.status_code == 200 for response in responses) == 1
    rejected = next(response for response in responses if response.status_code == 400)
    assert rejected.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"


def test_transfer_area_commit_lock_keeps_later_staging_progress_from_being_rolled_back(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route
    from app.services.laboratory_operations import acquire_laboratory_storage_commit_lock

    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])
    original_apply_dispatch = transfer_area_route.apply_dispatch
    dispatch_mutation_entered = threading.Event()
    release_dispatch_mutation = threading.Event()
    staging_commit_entered = threading.Event()

    def gated_apply_dispatch(*args, **kwargs):
        dispatch_mutation_entered.set()
        if not release_dispatch_mutation.wait(timeout=5):
            raise RuntimeError("timed out waiting to release dispatch mutation")
        return original_apply_dispatch(*args, **kwargs)

    monkeypatch.setattr(transfer_area_route, "apply_dispatch", gated_apply_dispatch)
    responses = []

    def dispatch_to_staging():
        responses.append(
            client.post(
                "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
                json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
            )
        )

    def commit_staging_arrival():
        with acquire_laboratory_storage_commit_lock():
            staging_commit_entered.set()
            samples = deepcopy(storage.read("mes.samples"))
            for sample in samples:
                if sample.get("task_code") != "SYLU-2026-03-102":
                    continue
                sample["status"] = "已到达暂存间"
                sample["flow_status"] = "已到达暂存间"
                sample["location"] = "恒温恒湿间（暂存间）"
                sample["updated_at"] = "2099-01-01 00:00:00"
                sample["trays"] = [
                    {
                        **tray,
                        "status": "已到达暂存间",
                        "updated_at": "2099-01-01 00:00:00",
                    }
                    for tray in sample.get("trays", [])
                ]
            storage.write("mes.samples", samples)

    dispatch_thread = threading.Thread(target=dispatch_to_staging)
    dispatch_thread.start()
    assert dispatch_mutation_entered.wait(timeout=5)
    staging_thread = threading.Thread(target=commit_staging_arrival)
    staging_thread.start()
    staging_committed_while_dispatch_was_open = staging_commit_entered.wait(timeout=0.5)
    release_dispatch_mutation.set()
    dispatch_thread.join(timeout=5)
    staging_thread.join(timeout=5)

    assert not dispatch_thread.is_alive()
    assert not staging_thread.is_alive()
    assert staging_committed_while_dispatch_was_open is False
    assert [response.status_code for response in responses] == [200]
    task_samples = [sample for sample in storage.read("mes.samples") if sample.get("task_code") == "SYLU-2026-03-102"]
    assert {sample["status"] for sample in task_samples} == {"已到达暂存间"}
    assert {sample["flow_status"] for sample in task_samples} == {"已到达暂存间"}
    assert {sample["trays"][0]["status"] for sample in task_samples} == {"已到达暂存间"}


def valid_task_101_experiment_trays(first_tray_id=1001, second_tray_id=1002):
    return [
        {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [first_tray_id]},
        {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [first_tray_id, second_tray_id]},
        {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [second_tray_id]},
    ]


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
    assert payload["taskOverview"][1]["taskStatus"] == "到货"
    assert payload["pendingTaskCount"] == 1
    assert payload["storedTaskCount"] == 1


def test_transfer_area_bootstrap_reads_only_contract_required_storage_keys(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    storage = TrackingReadManyTransferStorage(create_payloads())
    monkeypatch.setattr(transfer_area_route, "get_storage_backend", lambda: storage)
    app = FastAPI()
    app.include_router(transfer_area_route.router)

    response = TestClient(app).get("/api/transfer-area/bootstrap")

    assert response.status_code == 200
    assert storage.read_many_calls == [[
        "mes.tasks",
        "mes.samples",
        "mes.schedules",
        "mes.experiments",
        "mes.experiment_run_trays",
        "mes.experiment_trays",
        "mes.staging_events",
    ]]
    assert storage.read_all_calls == 0


def test_transfer_area_bootstrap_is_read_only_when_planned_and_stored_sample_counts_differ(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    payloads = create_payloads()
    payloads["mes.tasks"][0] = {**payloads["mes.tasks"][0], "sample_count": 1}
    storage = ReadOnlyTrackingTransferStorage(payloads)
    monkeypatch.setattr(transfer_area_route, "get_storage_backend", lambda: storage)
    app = FastAPI()
    app.include_router(transfer_area_route.router)
    client = TestClient(app)

    first = client.get("/api/transfer-area/bootstrap")
    second = client.get("/api/transfer-area/bootstrap")

    assert first.status_code == 200
    assert second.status_code == 200
    for response in (first, second):
        task_row = next(item for item in response.json()["taskOverview"] if item["taskNo"] == "SYLU-2026-03-101")
        assert task_row["sampleCount"] == 1
        assert task_row["sampleCodes"] == ["SYLU-2026-03-101-SP-001"]
    assert storage.write_calls == []
    assert storage.write_many_calls == []
    assert len([sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-101"]) == 4


def test_transfer_area_bootstrap_uses_required_device_as_task_experiment_type(monkeypatch):
    client, storage = build_client(monkeypatch)
    experiments = storage.read("mes.experiments")
    experiments[1] = {
        **experiments[1],
        "experiment_name": "高低温湿热试验2",
        "required_device": "高低温湿热试验",
    }
    storage.write("mes.experiments", experiments)

    response = client.get("/api/transfer-area/bootstrap")

    assert response.status_code == 200
    task_row = next(item for item in response.json()["taskOverview"] if item["taskNo"] == "SYLU-2026-03-101")
    assert task_row["experimentTypeText"] == "盐雾试验 / 高低温湿热试验 / 温度冲击试验"
    assert "高低温湿热试验2" not in task_row["experimentTypeText"]


def test_transfer_area_workspace_builds_editable_trays_for_pending_task(monkeypatch):
    client, _storage = build_client(monkeypatch)

    response = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert response.status_code == 200
    payload = response.json()
    assert payload["task"]["taskNo"] == "SYLU-2026-03-101"
    assert payload["task"]["experimentTypeText"] == "盐雾试验 / 振动试验 / 温度冲击试验"
    assert payload["task"]["taskStatus"] == "未入库"
    assert payload["task"]["trayLimit"] == 16
    assert len(payload["assignedTrays"]) == 1
    assert len(payload["assignedTrays"]) > 0
    assert payload["assignedTrays"][0]["samples"][0]["sampleNo"] == "SYLU-2026-03-101-SP-001"
    assert len(payload["trayInventory"]) == 8


def test_transfer_area_workspace_reads_only_contract_required_storage_keys(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    storage = TrackingReadManyTransferStorage(create_payloads())
    monkeypatch.setattr(transfer_area_route, "get_storage_backend", lambda: storage)
    app = FastAPI()
    app.include_router(transfer_area_route.router)

    response = TestClient(app).get("/api/transfer-area/tasks/task-101/workspace")

    assert response.status_code == 200
    assert storage.read_many_calls == [[
        "mes.tasks",
        "mes.samples",
        "mes.schedules",
        "mes.experiments",
        "mes.experiment_run_trays",
        "mes.experiment_trays",
        "mes.experiment_samples",
        "mes.staging_events",
    ]]
    assert storage.read_all_calls == 0


def test_transfer_area_legacy_stored_status_renders_generated_samples_without_persisting(monkeypatch):
    client, storage = build_client(monkeypatch)
    storage.write(
        "mes.tasks",
        [
            {
                "id": "task-legacy",
                "code": "SYLU-2026-03-legacy",
                "name": "旧状态任务",
                "test_type": "耐久试验",
                "sample_count": 2,
                "arrival_at": "2026-03-19 09:10",
                "status": "已排程",
                "transfer_status": "已入库",
            }
        ],
    )
    storage.write("mes.samples", [])
    storage.write("mes.experiments", [])

    response = client.get("/api/transfer-area/tasks/task-legacy/workspace")

    assert response.status_code == 200
    assert response.json()["task"]["taskStatus"] == "未入库"
    assert [sample["sampleNo"] for sample in response.json()["assignedTrays"][0]["samples"]] == [
        "SYLU-2026-03-legacy-SP-001",
        "SYLU-2026-03-legacy-SP-002",
    ]
    assert storage.read("mes.samples") == []


def test_transfer_area_legacy_stored_status_cannot_dispatch_as_arrived(monkeypatch):
    client, storage = build_client(monkeypatch)
    tasks = storage.read("mes.tasks")
    for task in tasks:
        if task["code"] == "SYLU-2026-03-102":
            task["transfer_status"] = "已入库"
    storage.write("mes.tasks", tasks)
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["status"] = "已入库"
        sample["flow_status"] = "已入库"
        sample["trays"] = [{**sample["trays"][0], "status": "已入库"}]
    storage.write("mes.samples", samples)
    seed_task_102_dispatch_data(storage, [])

    bootstrap = client.get("/api/transfer-area/bootstrap")
    dispatched = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )

    assert bootstrap.status_code == 200
    task_row = next(item for item in bootstrap.json()["taskOverview"] if item["taskNo"] == "SYLU-2026-03-102")
    assert task_row["taskStatus"] == "未入库"
    assert bootstrap.json()["storedTaskCount"] == 0
    assert dispatched.status_code == 400
    assert dispatched.json()["detail"] == "该托盘尚未确认入库，不能出库"


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

    response = client.get("/api/transfer-area/trays/MES-TRAY:SYLU-2026-03-102-TP-001/dispatch")

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
    assert payload["tray"]["trayDisplayStatus"] == "送至暂存间"
    assert payload["affectedSampleCount"] == 2

    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "送至暂存间" for sample in updated_samples)
    assert all(sample["flow_status"] == "送至暂存间" for sample in updated_samples)
    assert all(sample["location"] == "恒温恒湿间（暂存间）" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "送至暂存间" for sample in updated_samples)
    assert all(sample["history"][0]["action"] == "送至暂存间" for sample in updated_samples)


def test_transfer_area_dispatch_to_staging_then_storage_api_stock_in_keeps_one_shared_tray_state(monkeypatch):
    from app.api.routes import storage as storage_route
    from app.api.routes import transfer_area as transfer_area_route
    from app.api.routes import transfer_area_commands

    storage = FakeTransferStorage(create_payloads())
    seed_task_102_dispatch_data(storage, [])
    monkeypatch.setattr(transfer_area_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(storage_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(transfer_area_commands, "now_business_text", lambda: "2026-07-21 09:00:00")
    monkeypatch.setattr(storage_route, "now_business_text", lambda: "2026-07-21 09:01:00")
    monkeypatch.setattr(transfer_area_route, "publish_storage_update", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(storage_route, "publish_storage_update", lambda *_args, **_kwargs: None)

    app = FastAPI()
    app.include_router(transfer_area_route.router)
    app.include_router(storage_route.router)
    client = TestClient(app)
    tray_code = "SYLU-2026-03-102-TP-001"

    dispatched = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )
    stocked_in = client.post(
        f"/api/storage/rooms/staging/trays/{tray_code}/stock-in",
        json={"operator": "暂存员A"},
    )
    transfer_lookup = client.get(f"/api/transfer-area/trays/{tray_code}/dispatch")

    assert dispatched.status_code == 200
    assert dispatched.json()["ok"] is True
    assert dispatched.json()["message"] == f"{tray_code}已标记为送至暂存间"
    assert dispatched.json()["affectedSampleCount"] == 2
    assert dispatched.json()["tray"]["trayStatus"] == "送至暂存间"
    assert stocked_in.status_code == 200
    assert stocked_in.json() == {
        "ok": True,
        "trayCode": tray_code,
        "row": {
            "location": "恒温恒湿间（暂存间）",
            "quantity": 2,
            "status": "已到达暂存间",
            "taskCode": "SYLU-2026-03-102",
            "trayCode": tray_code,
        },
        "updatedKeys": ["mes.samples", "mes.staging_events"],
    }
    assert transfer_lookup.status_code == 400
    assert transfer_lookup.json()["detail"] == "该托盘已在暂存间入库，请从暂存间出库"

    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert len(updated_samples) == 2
    assert all(sample["location"] == "恒温恒湿间（暂存间）" for sample in updated_samples)
    assert all(sample["status"] == "已到达暂存间" for sample in updated_samples)
    assert all(sample["flow_status"] == "已到达暂存间" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "已到达暂存间" for sample in updated_samples)
    assert all([entry["action"] for entry in sample["history"][:2]] == ["暂存间扫码入库", "送至暂存间"] for sample in updated_samples)
    assert all([entry["time"] for entry in sample["history"][:2]] == ["2026-07-21 09:01:00", "2026-07-21 09:00:00"] for sample in updated_samples)
    assert storage.read("mes.staging_events") == [
        {
            "id": f"staging-event-{tray_code}-1",
            "tray_code": tray_code,
            "task_code": "SYLU-2026-03-102",
            "room": "staging",
            "action": "stock_in",
            "time": "2026-07-21 09:01:00",
            "operator": "暂存员A",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
        }
    ]


def test_transfer_area_rejects_lab_dispatch_after_staging_stock_in(monkeypatch):
    client, storage = build_client(monkeypatch)
    tray_code = "SYLU-2026-03-102-TP-001"
    task_code = "SYLU-2026-03-102"
    seed_task_102_dispatch_data(
        storage,
        [
            {
                "id": "schedule-102-b",
                "task_code": task_code,
                "experiment_code": f"{task_code}-B",
                "device": "振动一室",
                "start_at": "2026-03-20T09:00:00",
                "end_at": "2026-03-20T12:00:00",
            },
        ],
    )

    staging_dispatch = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )
    assert staging_dispatch.status_code == 200

    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != task_code:
            continue
        sample["location"] = "恒温恒湿间（暂存间）"
        sample["status"] = "已到达暂存间"
        sample["flow_status"] = "已到达暂存间"
        sample["trays"] = [{**sample["trays"][0], "status": "已到达暂存间"}]
        sample["history"] = [
            {
                "action": "暂存间扫码入库",
                "detail": f"{tray_code} 已到达暂存间",
                "location": "恒温恒湿间（暂存间）",
                "status": "已到达暂存间",
                "time": "2026-03-20T08:30:00",
            },
            *sample.get("history", []),
        ]
    storage.write("mes.samples", samples)
    storage.write(
        "mes.staging_events",
        [
            {
                "id": "staging-stock-in",
                "tray_code": tray_code,
                "task_code": task_code,
                "action": "stock_in",
                "time": "2026-03-20T08:30:00",
            }
        ],
    )

    lookup = client.get(f"/api/transfer-area/trays/{tray_code}/dispatch")
    assert lookup.status_code == 400
    assert lookup.json()["detail"] == "该托盘已在暂存间入库，请从暂存间出库"

    response = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": f"{task_code}-B"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已在暂存间入库，请从暂存间出库"
    assert storage.read("mes.staging_events")[-1]["action"] == "stock_in"


def test_transfer_area_rejects_completed_appearance_dispatch_from_handover(monkeypatch):
    client, storage = build_client(monkeypatch)
    task_code = "SYLU-2026-06-029"
    tray_code = f"{task_code}-TP-001"
    sample_code = f"{task_code}-SP-001"
    storage.write("mes.tasks", [{"code": task_code, "transfer_status": "到货", "status": "任务进行中"}])
    storage.write("mes.samples", [
        {
            "code": sample_code,
            "task_code": task_code,
            "location": "外观检测间",
            "status": "实验后外观检测间存放",
            "flow_status": "实验后外观检测间存放",
            "trays": [{"tray_code": tray_code, "status": "实验后外观检测间存放", "quantity": 1}],
        }
    ])
    storage.write("mes.experiment_trays", [
        {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": tray_code},
    ])
    storage.write("mes.experiment_run_trays", [
        {
            "task_code": task_code,
            "experiment_code": f"{task_code}-A",
            "tray_code": tray_code,
            "run_tray_status": "实验已完成",
        },
    ])

    response = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验后外观检测间存放"
    assert updated["flow_status"] == "实验后外观检测间存放"
    assert updated["location"] == "外观检测间"
    assert updated["trays"][0]["status"] == "实验后外观检测间存放"
    assert "history" not in updated


def test_transfer_area_rejects_completed_lab_dispatch_from_handover(monkeypatch):
    client, storage = build_client(monkeypatch)
    task_code = "SYLU-2026-06-032"
    tray_code = f"{task_code}-TP-001"
    sample_code = f"{task_code}-SP-001"
    storage.write("mes.tasks", [{"code": task_code, "transfer_status": "到货", "status": "任务进行中"}])
    storage.write("mes.samples", [
        {
            "code": sample_code,
            "task_code": task_code,
            "location": "盐雾试验室",
            "status": "实验已完成",
            "flow_status": "实验已完成",
            "trays": [{"tray_code": tray_code, "status": "实验已完成", "quantity": 1}],
        }
    ])
    storage.write("mes.experiment_trays", [
        {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": tray_code},
    ])
    storage.write("mes.experiment_run_trays", [
        {
            "task_code": task_code,
            "experiment_code": f"{task_code}-A",
            "tray_code": tray_code,
            "run_tray_status": "实验已完成",
        },
    ])

    response = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验已完成"
    assert updated["flow_status"] == "实验已完成"
    assert updated["location"] == "盐雾试验室"
    assert updated["trays"][0]["status"] == "实验已完成"
    assert "history" not in updated


def test_transfer_area_rejects_partial_appearance_dispatch_from_handover(monkeypatch):
    client, storage = build_client(monkeypatch)
    task_code = "SYLU-2026-06-030"
    tray_code = f"{task_code}-TP-001"
    sample_code = f"{task_code}-SP-001"
    storage.write("mes.tasks", [{"code": task_code, "transfer_status": "到货", "status": "任务进行中"}])
    storage.write("mes.samples", [
        {
            "code": sample_code,
            "task_code": task_code,
            "location": "外观检测间",
            "status": "实验后外观检测间存放",
            "flow_status": "实验后外观检测间存放",
            "trays": [{"tray_code": tray_code, "status": "实验后外观检测间存放", "quantity": 1}],
        }
    ])
    storage.write("mes.experiment_trays", [
        {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": tray_code},
        {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": tray_code},
    ])
    storage.write("mes.experiment_run_trays", [
        {
            "task_code": task_code,
            "experiment_code": f"{task_code}-A",
            "tray_code": tray_code,
            "run_tray_status": "实验已完成",
        },
    ])

    response = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验后外观检测间存放"
    assert updated["flow_status"] == "实验后外观检测间存放"
    assert updated["location"] == "外观检测间"
    assert updated["trays"][0]["status"] == "实验后外观检测间存放"
    assert "history" not in updated


def test_transfer_area_withdraw_staging_dispatch_restores_tray_to_arrived(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])

    dispatched = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )
    assert dispatched.status_code == 200

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "点错暂存间"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "到货"
    assert payload["restoredLocation"] == "接驳区"
    assert payload["tray"]["trayStatus"] == "到货"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "到货" for sample in updated_samples)
    assert all(sample["flow_status"] == "到货" for sample in updated_samples)
    assert all(sample["location"] == "接驳区" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "到货" for sample in updated_samples)
    assert all(sample["history"][0]["action"] == "撤回出库" for sample in updated_samples)


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
    assert payload["tray"]["trayDisplayStatus"] == "振动一室"
    assert payload["affectedSampleCount"] == 2

    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "送至实验室" for sample in updated_samples)
    assert all(sample["flow_status"] == "送至实验室" for sample in updated_samples)
    assert all(sample["location"] == "振动一室" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "送至实验室" for sample in updated_samples)
    assert all(sample["trays"][0]["target_lab"] == "振动一室" for sample in updated_samples)
    assert all(sample["trays"][0]["target_experiment_code"] == "SYLU-2026-03-102-B" for sample in updated_samples)
    assert all(sample["history"][0]["action"] == "送至实验室" for sample in updated_samples)
    assert all("SYLU-2026-03-102-TP-001 -> 振动一室" in sample["history"][0]["detail"] for sample in updated_samples)


@pytest.mark.parametrize(
    ("location", "status"),
    [
        ("恒温恒湿间（暂存间）", "已到达暂存间"),
        ("外观检测间", "实验后外观检测间存放"),
        ("振动二室", "实验已完成"),
    ],
)
def test_transfer_area_rejects_dispatch_when_tray_is_no_longer_in_handover(monkeypatch, location, status):
    client, storage = build_client(monkeypatch)
    tray_code = "SYLU-2026-03-102-TP-001"
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
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = location
        sample["status"] = status
        sample["flow_status"] = status
        sample["trays"] = [{**sample["trays"][0], "status": status}]
    storage.write("mes.samples", samples)

    lookup = client.get(f"/api/transfer-area/trays/{tray_code}/dispatch")
    response = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-B"},
    )

    assert lookup.status_code == 400
    assert lookup.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["location"] == location for sample in updated_samples)
    assert all(sample["status"] == status for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == status for sample in updated_samples)


def test_transfer_area_dispatch_to_salt_lab_goes_directly_to_lab_without_forced_pre_appearance(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(
        storage,
        [
            {
                "id": "schedule-102-b",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-B",
                "device": "盐雾试验室",
                "start_at": "2026-03-20T09:00:00",
                "end_at": "2026-03-20T12:00:00",
            },
        ],
    )
    experiments = storage.read("mes.experiments")
    experiments[1]["experiment_name"] = "盐雾试验"
    experiments[1]["required_device"] = "盐雾试验"
    storage.write("mes.experiments", experiments)

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "盐雾试验室", "experimentCode": "SYLU-2026-03-102-B"},
    )

    assert response.status_code == 200
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "送至实验室" for sample in updated_samples)
    assert all(sample["flow_status"] == "送至实验室" for sample in updated_samples)
    assert all(sample["location"] == "盐雾试验室" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "送至实验室" for sample in updated_samples)
    assert all(sample["trays"][0]["target_lab"] == "盐雾试验室" for sample in updated_samples)
    assert all(sample["trays"][0]["target_experiment_code"] == "SYLU-2026-03-102-B" for sample in updated_samples)


def test_transfer_area_rejects_pre_experiment_appearance_dispatch_from_handover(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(
        storage,
        [
            {
                "id": "schedule-102-b",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-B",
                "device": "盐雾试验室",
                "start_at": "2026-03-20T09:00:00",
                "end_at": "2026-03-20T12:00:00",
            },
        ],
    )
    experiments = storage.read("mes.experiments")
    experiments[1]["experiment_name"] = "盐雾试验"
    experiments[1]["required_device"] = "盐雾试验"
    storage.write("mes.experiments", experiments)
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "外观检测间"
        sample["status"] = "实验前外观检测间存放"
        sample["flow_status"] = "实验前外观检测间存放"
        sample["trays"][0]["status"] = "实验前外观检测间存放"
        sample["trays"][0]["target_lab"] = "盐雾试验室"
        sample["trays"][0]["target_experiment_code"] = "SYLU-2026-03-102-B"
    storage.write("mes.samples", samples)

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "盐雾试验室", "experimentCode": "SYLU-2026-03-102-B"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "实验前外观检测间存放" for sample in updated_samples)
    assert all(sample["flow_status"] == "实验前外观检测间存放" for sample in updated_samples)
    assert all(sample["location"] == "外观检测间" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "实验前外观检测间存放" for sample in updated_samples)
    assert all(sample["trays"][0]["target_lab"] == "盐雾试验室" for sample in updated_samples)
    assert all(sample["trays"][0]["target_experiment_code"] == "SYLU-2026-03-102-B" for sample in updated_samples)
    appearance_events = [
        event
        for event in storage.read("mes.staging_events")
        if event.get("tray_code") == "SYLU-2026-03-102-TP-001" and event.get("room") == "appearance"
    ]
    assert appearance_events == []


def test_transfer_area_dispatch_from_pre_appearance_rejects_non_whitelist_lab(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(
        storage,
        [
            {
                "id": "schedule-102-a",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-A",
                "device": "振动一室",
                "start_at": "2026-03-20T09:00:00",
                "end_at": "2026-03-20T12:00:00",
            },
            {
                "id": "schedule-102-b",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-B",
                "device": "盐雾试验室",
                "start_at": "2026-03-20T10:00:00",
                "end_at": "2026-03-20T13:00:00",
            },
        ],
    )
    experiments = storage.read("mes.experiments")
    experiments[0]["experiment_name"] = "振动试验"
    experiments[0]["required_device"] = "振动一室"
    experiments[1]["experiment_name"] = "盐雾试验"
    experiments[1]["required_device"] = "盐雾试验室"
    storage.write("mes.experiments", experiments)
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "外观检测间"
        sample["status"] = "实验前外观检测间存放"
        sample["flow_status"] = "实验前外观检测间存放"
        sample["trays"][0]["status"] = "实验前外观检测间存放"
    storage.write("mes.samples", samples)

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-A"},
    )
    payload = client.get("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch").json()

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    assert payload["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"


def test_transfer_area_rejects_post_appearance_dispatch_from_handover(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(
        storage,
        [
            {
                "id": "schedule-102-a",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-A",
                "device": "振动一室",
                "start_at": "2026-03-20T09:00:00",
                "end_at": "2026-03-20T12:00:00",
            },
            {
                "id": "schedule-102-b",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-B",
                "device": "盐雾试验室",
                "start_at": "2026-03-20T10:00:00",
                "end_at": "2026-03-20T13:00:00",
            },
        ],
    )
    experiments = storage.read("mes.experiments")
    experiments[0]["experiment_name"] = "振动试验"
    experiments[0]["required_device"] = "振动一室"
    experiments[1]["experiment_name"] = "盐雾试验"
    experiments[1]["required_device"] = "盐雾试验室"
    storage.write("mes.experiments", experiments)
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "外观检测间"
        sample["status"] = "实验后外观检测间存放"
        sample["flow_status"] = "实验后外观检测间存放"
        sample["trays"][0]["status"] = "实验后外观检测间存放"
    storage.write("mes.samples", samples)

    payload = client.get("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch").json()
    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-A"},
    )

    assert payload["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "实验后外观检测间存放" for sample in updated_samples)
    assert all(sample["location"] == "外观检测间" for sample in updated_samples)
    assert all("target_lab" not in sample["trays"][0] for sample in updated_samples)
    assert all("target_experiment_code" not in sample["trays"][0] for sample in updated_samples)


def test_transfer_area_dispatch_to_lab_clears_stale_fixture_ready(monkeypatch):
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
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "恒温恒湿间（暂存间）"
        sample["status"] = "已到达暂存间"
        sample["flow_status"] = "已到达暂存间"
        sample["trays"] = [
            {
                **sample["trays"][0],
                "status": "已到达暂存间",
                "fixture_ready": True,
                "fixtureReady": True,
            }
        ]
    storage.write("mes.samples", samples)

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-B"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["location"] == "恒温恒湿间（暂存间）" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "已到达暂存间" for sample in updated_samples)
    assert all(sample["trays"][0]["fixture_ready"] is True for sample in updated_samples)
    assert all(sample["trays"][0]["fixtureReady"] is True for sample in updated_samples)


def test_transfer_area_dispatch_to_lab_rejects_maintenance_device(monkeypatch):
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
    storage.write("mes.devices", [{"code": "振动一室", "status": "保养"}])

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-B"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "振动一室设备维修中，禁止送至该实验室"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "到货" for sample in updated_samples)


def test_transfer_area_dispatch_to_lab_allows_device_after_planned_maintenance_ends(monkeypatch):
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
    storage.write(
        "mes.devices",
        [
            {
                "code": "振动一室",
                "maintenance_end_at": "2000-01-01T12:00:00",
                "maintenance_start_at": "2000-01-01T08:00:00",
                "status": "保养",
            }
        ],
    )

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-B"},
    )

    assert response.status_code == 200
    assert response.json()["tray"]["trayStatus"] == "送至实验室"


def test_transfer_area_dispatch_to_lab_rejects_open_ended_maintenance_after_start(monkeypatch):
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
    storage.write(
        "mes.devices",
        [
            {
                "code": "振动一室",
                "maintenance_start_at": "2000-01-01T08:00:00",
                "maintenance_type": "计划维修",
                "status": "可用",
            }
        ],
    )

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-B"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "振动一室设备维修中，禁止送至该实验室"


def test_transfer_area_withdraw_handover_dispatch_restores_tray_to_arrived(monkeypatch):
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
    dispatched = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-B"},
    )
    assert dispatched.status_code == 200

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "点错试验间"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "到货"
    assert payload["restoredLocation"] == "接驳区"
    assert payload["tray"]["trayStatus"] == "到货"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "到货" for sample in updated_samples)
    assert all(sample["flow_status"] == "到货" for sample in updated_samples)
    assert all(sample["location"] == "接驳区" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "到货" for sample in updated_samples)
    assert all(sample["history"][0]["action"] == "撤回出库" for sample in updated_samples)


def test_transfer_area_withdraw_lookup_allows_dispatched_tray_outside_handover(monkeypatch):
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
    dispatched = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-B"},
    )
    assert dispatched.status_code == 200

    dispatch_lookup = client.get("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch")
    withdraw_lookup = client.get("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch")

    assert dispatch_lookup.status_code == 400
    assert dispatch_lookup.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    assert withdraw_lookup.status_code == 200
    assert withdraw_lookup.json()["tray"]["trayStatus"] == "送至实验室"
    assert withdraw_lookup.json()["tray"]["trayDisplayStatus"] == "振动一室"


def test_transfer_area_withdraw_dispatch_ignores_other_tray_laboratory_progress_in_same_sample(monkeypatch):
    client, storage = build_client(monkeypatch)
    task_code = "SYLU-2026-03-102"
    storage.write(
        "mes.samples",
        [
            {
                "id": "sample-102-multi",
                "code": "SYLU-2026-03-102-SP-001",
                "task_code": task_code,
                "status": "实验进行中",
                "flow_status": "实验进行中",
                "location": "振动一室",
                "trays": [
                    {
                        "tray_id": 1001,
                        "tray_code": "SYLU-2026-03-102-TP-001",
                        "quantity": 1,
                        "status": "送至实验室",
                    },
                    {
                        "tray_id": 1002,
                        "tray_code": "SYLU-2026-03-102-TP-002",
                        "quantity": 1,
                        "status": "实验进行中",
                    },
                ],
                "history": [
                    {
                        "action": "送至实验室",
                        "detail": "SYLU-2026-03-102-TP-001 -> 振动一室",
                        "location": "振动一室",
                        "status": "送至实验室",
                        "time": "2026-05-19T10:00:00",
                    },
                    {
                        "action": "开始实验",
                        "detail": "SYLU-2026-03-102-TP-002 / 通电试验 / 实验进行中",
                        "location": "振动一室",
                        "status": "实验进行中",
                        "time": "2026-05-19T10:10:00",
                    },
                ],
            }
        ],
    )

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "点错试验间"},
    )

    assert response.status_code == 200
    sample = storage.read("mes.samples")[0]
    by_tray = {tray["tray_code"]: tray for tray in sample["trays"]}
    assert by_tray["SYLU-2026-03-102-TP-001"]["status"] == "到货"
    assert by_tray["SYLU-2026-03-102-TP-002"]["status"] == "实验进行中"
    assert sample["status"] == "实验进行中"
    assert sample["flow_status"] == "实验进行中"


def test_transfer_area_withdraw_staging_dispatch_restores_tray_to_staging_arrival(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "盐雾试验室"
        sample["status"] = "送至实验室"
        sample["flow_status"] = "送至实验室"
        sample["trays"] = [{**sample["trays"][0], "status": "送至实验室"}]
        sample["history"] = [
            {
                "action": "暂存间扫码出库",
                "detail": "SYLU-2026-03-102-TP-001 送至 盐雾试验室",
                "location": "盐雾试验室",
                "status": "送至实验室",
                "time": "2026-05-19T10:00:00",
            },
            {
                "action": "暂存间扫码入库",
                "detail": "SYLU-2026-03-102-TP-001 已到达暂存间",
                "location": "恒温恒湿间（暂存间）",
                "status": "已到达暂存间",
                "time": "2026-05-19T09:50:00",
            },
        ]
    storage.write("mes.samples", samples)
    storage.write(
        "mes.staging_events",
        [
            {
                "id": "staging-event-in",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "action": "stock_in",
                "time": "2026-05-19T09:50:00",
            },
            {
                "id": "staging-event-out",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "action": "stock_out",
                "target_lab": "盐雾试验室",
                "time": "2026-05-19T10:00:00",
            },
        ],
    )

    lookup = client.get("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch")
    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "点错试验间"},
    )

    assert lookup.status_code == 200
    assert lookup.json()["tray"]["trayStatus"] == "送至实验室"
    assert lookup.json()["tray"]["trayDisplayStatus"] == "盐雾试验室"
    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "已到达暂存间"
    assert payload["restoredLocation"] == "恒温恒湿间（暂存间）"
    assert payload["tray"]["trayStatus"] == "已到达暂存间"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "已到达暂存间" for sample in updated_samples)
    assert all(sample["flow_status"] == "已到达暂存间" for sample in updated_samples)
    assert all(sample["location"] == "恒温恒湿间（暂存间）" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "已到达暂存间" for sample in updated_samples)
    staging_events = storage.read("mes.staging_events")
    assert staging_events[-1]["action"] == "stock_out_withdraw"


def test_transfer_area_withdraw_appearance_dispatch_restores_tray_to_appearance_storage(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "高低温湿热一室"
        sample["status"] = "送至实验室"
        sample["flow_status"] = "送至实验室"
        sample["trays"] = [{**sample["trays"][0], "status": "送至实验室"}]
        sample["history"] = [
            {
                "action": "外观检测间扫码出库",
                "detail": "SYLU-2026-03-102-TP-001 送至 高低温湿热一室",
                "location": "高低温湿热一室",
                "status": "送至实验室",
                "time": "2026-05-19T10:00:00",
            },
            {
                "action": "外观检测间扫码入库",
                "detail": "SYLU-2026-03-102-TP-001 实验后外观检测间存放",
                "location": "外观检测间",
                "status": "实验后外观检测间存放",
                "time": "2026-05-19T09:50:00",
            },
        ]
    storage.write("mes.samples", samples)
    storage.write(
        "mes.staging_events",
        [
            {
                "id": "appearance-event-in",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "room": "appearance",
                "action": "stock_in",
                "time": "2026-05-19T09:50:00",
            },
            {
                "id": "appearance-event-out",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "room": "appearance",
                "action": "stock_out",
                "target_lab": "高低温湿热一室",
                "time": "2026-05-19T10:00:00",
            },
        ],
    )

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "点错试验间"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "实验后外观检测间存放"
    assert payload["restoredLocation"] == "外观检测间"
    assert payload["tray"]["trayStatus"] == "实验后外观检测间存放"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "实验后外观检测间存放" for sample in updated_samples)
    assert all(sample["flow_status"] == "实验后外观检测间存放" for sample in updated_samples)
    assert all(sample["location"] == "外观检测间" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "实验后外观检测间存放" for sample in updated_samples)
    staging_events = storage.read("mes.staging_events")
    assert staging_events[-1]["action"] == "stock_out_withdraw"
    assert staging_events[-1]["room"] == "appearance"


def test_transfer_area_withdraw_appearance_dispatch_to_post_staging_restores_appearance_storage(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "恒温恒湿间（暂存间）"
        sample["status"] = "送至暂存间"
        sample["flow_status"] = "送至暂存间"
        sample["trays"] = [{**sample["trays"][0], "status": "送至暂存间"}]
        sample["history"] = [
            {
                "action": "外观检测间扫码出库",
                "detail": "SYLU-2026-03-102-TP-001 送至 恒温恒湿间（暂存间）",
                "location": "恒温恒湿间（暂存间）",
                "status": "送至暂存间",
                "time": "2026-05-19T10:00:00",
            },
            {
                "action": "外观检测间扫码入库",
                "detail": "SYLU-2026-03-102-TP-001 实验后外观检测间存放",
                "location": "外观检测间",
                "status": "实验后外观检测间存放",
                "time": "2026-05-19T09:50:00",
            },
        ]
    storage.write("mes.samples", samples)
    storage.write(
        "mes.staging_events",
        [
            {
                "id": "appearance-event-in",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "room": "appearance",
                "action": "stock_in",
                "time": "2026-05-19T09:50:00",
            },
            {
                "id": "appearance-event-out",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "room": "appearance",
                "action": "stock_out",
                "target_type": "staging",
                "target_lab": "恒温恒湿间（暂存间）",
                "time": "2026-05-19T10:00:00",
            },
        ],
    )

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "外观出库到暂存间撤回"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "实验后外观检测间存放"
    assert payload["restoredLocation"] == "外观检测间"
    assert payload["tray"]["trayStatus"] == "实验后外观检测间存放"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "实验后外观检测间存放" for sample in updated_samples)
    assert all(sample["flow_status"] == "实验后外观检测间存放" for sample in updated_samples)
    assert all(sample["location"] == "外观检测间" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "实验后外观检测间存放" for sample in updated_samples)
    staging_events = storage.read("mes.staging_events")
    assert staging_events[-1]["action"] == "stock_out_withdraw"
    assert staging_events[-1]["room"] == "appearance"
    assert staging_events[-1]["target_lab"] == "恒温恒湿间（暂存间）"


def test_transfer_area_withdraw_pre_experiment_appearance_dispatch_restores_pre_appearance_status(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "盐雾试验室"
        sample["status"] = "送至实验室"
        sample["flow_status"] = "送至实验室"
        sample["trays"] = [{**sample["trays"][0], "status": "送至实验室"}]
        sample["history"] = [
            {
                "action": "外观检测间扫码出库",
                "detail": "SYLU-2026-03-102-TP-001 送至 盐雾试验室",
                "location": "盐雾试验室",
                "status": "送至实验室",
                "time": "2026-05-19T10:00:00",
            },
            {
                "action": "外观检测间扫码入库",
                "detail": "SYLU-2026-03-102-TP-001 实验前外观检测间存放",
                "location": "外观检测间",
                "status": "实验前外观检测间存放",
                "time": "2026-05-19T09:50:00",
            },
        ]
    storage.write("mes.samples", samples)
    storage.write(
        "mes.staging_events",
        [
            {
                "id": "pre-appearance-event-in",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "room": "appearance",
                "action": "stock_in",
                "time": "2026-05-19T09:50:00",
            },
            {
                "id": "pre-appearance-event-out",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "room": "appearance",
                "action": "stock_out",
                "target_lab": "盐雾试验室",
                "time": "2026-05-19T10:00:00",
            },
        ],
    )

    lookup = client.get("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch")
    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "点错试验间"},
    )

    assert lookup.status_code == 200
    assert lookup.json()["tray"]["trayStatus"] == "送至实验室"
    assert lookup.json()["tray"]["trayDisplayStatus"] == "盐雾试验室"
    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "实验前外观检测间存放"
    assert payload["restoredLocation"] == "外观检测间"
    assert payload["tray"]["trayStatus"] == "实验前外观检测间存放"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "实验前外观检测间存放" for sample in updated_samples)
    assert all(sample["flow_status"] == "实验前外观检测间存放" for sample in updated_samples)
    assert all(sample["location"] == "外观检测间" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "实验前外观检测间存放" for sample in updated_samples)


def test_transfer_area_withdraw_appearance_dispatch_ignores_staging_room_events(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "高低温湿热一室"
        sample["status"] = "送至实验室"
        sample["flow_status"] = "送至实验室"
        sample["trays"] = [{**sample["trays"][0], "status": "送至实验室"}]
    storage.write("mes.samples", samples)
    storage.write(
        "mes.staging_events",
        [
            {
                "id": "appearance-event-out",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "room": "appearance",
                "action": "stock_out",
                "target_lab": "高低温湿热一室",
                "target_experiment_code": "EXP-HUMID-1",
                "time": "2026-05-19T10:00:00",
            },
            {
                "id": "staging-event-old",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "action": "stock_in",
                "time": "2026-05-19T10:05:00",
            },
        ],
    )

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "外观出库撤回"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "实验后外观检测间存放"
    assert payload["restoredLocation"] == "外观检测间"
    staging_events = storage.read("mes.staging_events")
    assert staging_events[-1]["action"] == "stock_out_withdraw"
    assert staging_events[-1]["room"] == "appearance"
    assert staging_events[-1]["target_lab"] == "高低温湿热一室"
    assert staging_events[-1]["target_experiment_code"] == "EXP-HUMID-1"


def test_transfer_area_withdraw_staging_dispatch_uses_history_when_event_is_missing(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "盐雾试验室"
        sample["status"] = "送至实验室"
        sample["flow_status"] = "送至实验室"
        sample["trays"] = [{**sample["trays"][0], "status": "送至实验室"}]
        sample["history"] = [
            {
                "action": "暂存间扫码出库",
                "detail": "SYLU-2026-03-102-TP-001 送至 盐雾试验室",
                "location": "盐雾试验室",
                "status": "送至实验室",
                "time": "2026-05-19T10:00:00",
            }
        ]
    storage.write("mes.samples", samples)
    storage.write("mes.staging_events", [])

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "点错试验间"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "已到达暂存间"
    assert payload["restoredLocation"] == "恒温恒湿间（暂存间）"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "已到达暂存间" for sample in updated_samples)
    assert storage.read("mes.staging_events")[-1]["action"] == "stock_out_withdraw"


def test_transfer_area_withdraw_dispatch_clears_stale_fixture_ready(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "振动一室"
        sample["status"] = "送至实验室"
        sample["flow_status"] = "送至实验室"
        sample["trays"] = [
            {
                **sample["trays"][0],
                "status": "送至实验室",
                "fixture_ready": True,
                "fixtureReady": True,
            }
        ]
    storage.write("mes.samples", samples)
    storage.write(
        "mes.staging_events",
        [
            {
                "id": "staging-event-out",
                "tray_code": "SYLU-2026-03-102-TP-001",
                "task_code": "SYLU-2026-03-102",
                "action": "stock_out",
                "target_lab": "振动一室",
                "target_experiment_code": "SYLU-2026-03-102-B",
                "time": "2026-05-19T10:00:00",
            },
        ],
    )

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "点错试验间"},
    )

    assert response.status_code == 200
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["trays"][0]["status"] == "已到达暂存间" for sample in updated_samples)
    assert all("fixture_ready" not in sample["trays"][0] for sample in updated_samples)
    assert all("fixtureReady" not in sample["trays"][0] for sample in updated_samples)


def test_transfer_area_withdraw_dispatch_rejects_after_laboratory_compare(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "振动一室"
        sample["status"] = "已到达实验室"
        sample["flow_status"] = "已到达实验室"
        sample["trays"] = [{**sample["trays"][0], "status": "已到达实验室"}]
        sample["history"] = [
            {
                "action": "任务比对",
                "detail": "SYLU-2026-03-102 / 通电试验 / 已到达实验室",
                "location": "振动一室",
                "status": "已到达实验室",
                "time": "2026-05-19T10:10:00",
            }
        ]
    storage.write("mes.samples", samples)

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "点错试验间"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已进入试验间流程，不能撤回出库"
    unchanged_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "已到达实验室" for sample in unchanged_samples)


def test_transfer_area_rejects_arrived_staging_tray_dispatch_from_handover(monkeypatch):
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
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "恒温恒湿间（暂存间）"
        sample["status"] = "已到达暂存间"
        sample["flow_status"] = "已到达暂存间"
        sample["trays"] = [{**sample["trays"][0], "status": "已到达暂存间"}]
    storage.write("mes.samples", samples)

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-B"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["location"] == "恒温恒湿间（暂存间）" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "已到达暂存间" for sample in updated_samples)


def test_transfer_area_rejects_completed_experiment_tray_dispatch_from_handover(monkeypatch):
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
    experiments = storage.read("mes.experiments")
    for experiment in experiments:
        if experiment["experiment_code"] == "SYLU-2026-03-102-A":
            experiment["status"] = "实验已完成"
        if experiment["experiment_code"] == "SYLU-2026-03-102-B":
            experiment["status"] = "已排程"
    storage.write("mes.experiments", experiments)
    samples = storage.read("mes.samples")
    for sample in samples:
        if sample["task_code"] != "SYLU-2026-03-102":
            continue
        sample["location"] = "耐久试验室"
        sample["status"] = "实验已完成"
        sample["flow_status"] = "实验已完成"
        sample["trays"] = [{**sample["trays"][0], "status": "实验已完成"}]
    storage.write("mes.samples", samples)

    response = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "lab", "targetName": "振动一室", "experimentCode": "SYLU-2026-03-102-B"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["location"] == "耐久试验室" for sample in updated_samples)
    assert all(sample["trays"][0]["status"] == "实验已完成" for sample in updated_samples)


def test_transfer_area_rejects_partial_axis_completed_tray_dispatch_from_handover(monkeypatch):
    client, storage = build_client(monkeypatch)
    task_code = "SYLU-2026-07-001"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    sample_code = f"{task_code}-SP-001"
    completed_axes = ["x+", "x-", "y+"]
    remaining_axes = ["y-", "z+", "z-"]
    first_sub_code = f"{experiment_code}#AXIS-001"
    second_sub_code = f"{experiment_code}#AXIS-002"
    storage.write(
        "mes.tasks",
        [
            {
                "id": task_code,
                "code": task_code,
                "name": "13652",
                "test_type": "冲击试验",
                "status": "任务进行中",
                "transfer_status": "到货",
            }
        ],
    )
    storage.write(
        "mes.samples",
        [
            {
                "id": sample_code,
                "code": sample_code,
                "task_code": task_code,
                "status": "实验进行中",
                "flow_status": "实验进行中",
                "location": "冲击一室",
                "trays": [
                    {
                        "tray_code": tray_code,
                        "quantity": 1,
                        "status": "实验进行中",
                        "target_lab": "冲击一室",
                        "target_experiment_code": experiment_code,
                        "target_sub_experiment_code": second_sub_code,
                    }
                ],
            }
        ],
    )
    storage.write(
        "mes.experiments",
        [
            {
                "id": experiment_code,
                "task_code": task_code,
                "experiment_code": experiment_code,
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
                "status": "实验进行中",
                "axis_codes": [*completed_axes, *remaining_axes],
            }
        ],
    )
    storage.write("mes.experiment_trays", [{"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}])
    storage.write(
        "mes.schedules",
        [
            {
                "id": "schedule-impact-done",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "device": "冲击一室",
                "start_at": "2026-06-25T15:08:00",
                "status": "实验已完成",
                "axis_codes": completed_axes,
                "sub_experiment_code": first_sub_code,
            },
            {
                "id": "schedule-impact-remaining",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "device": "冲击一室",
                "start_at": "2026-06-26T08:00:00",
                "status": "已排程",
                "axis_codes": remaining_axes,
                "sub_experiment_code": second_sub_code,
            },
        ],
    )
    storage.write(
        "mes.experiment_runs",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "status": "实验已完成",
                "tray_codes": [tray_code],
                "axis_codes": completed_axes,
                "schedule_id": "schedule-impact-done",
                "sub_experiment_code": first_sub_code,
            }
        ],
    )
    storage.write(
        "mes.experiment_run_trays",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "tray_code": tray_code,
                "run_tray_status": "实验已完成",
                "sub_experiment_code": first_sub_code,
            }
        ],
    )
    storage.write(
        "mes.experiment_run_steps",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "axis_code": axis_code,
                "step_no": index + 1,
                "status": "实验已完成",
                "sub_experiment_code": first_sub_code,
            }
            for index, axis_code in enumerate(completed_axes)
        ],
    )

    response = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "lab", "targetName": "冲击一室", "experimentCode": experiment_code},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated_sample = storage.read("mes.samples")[0]
    assert updated_sample["status"] == "实验进行中"
    assert updated_sample["trays"][0]["target_experiment_code"] == experiment_code


def test_transfer_area_rejects_partial_axis_completed_tray_staging_dispatch_from_handover(monkeypatch):
    client, storage = build_client(monkeypatch)
    task_code = "SYLU-2026-07-001"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    sample_code = f"{task_code}-SP-001"
    completed_axes = ["x+", "x-", "y+"]
    remaining_axes = ["y-", "z+", "z-"]
    first_sub_code = f"{experiment_code}#AXIS-001"
    second_sub_code = f"{experiment_code}#AXIS-002"
    storage.write(
        "mes.tasks",
        [{"id": task_code, "code": task_code, "name": "13652", "test_type": "冲击试验", "status": "任务进行中", "transfer_status": "到货"}],
    )
    storage.write(
        "mes.samples",
        [
            {
                "id": sample_code,
                "code": sample_code,
                "task_code": task_code,
                "status": "实验进行中",
                "flow_status": "实验进行中",
                "location": "冲击一室",
                "trays": [
                    {
                        "tray_code": tray_code,
                        "quantity": 1,
                        "status": "实验进行中",
                        "target_lab": "冲击一室",
                        "target_experiment_code": experiment_code,
                        "target_sub_experiment_code": second_sub_code,
                    }
                ],
            }
        ],
    )
    storage.write(
        "mes.experiments",
        [
            {
                "id": experiment_code,
                "task_code": task_code,
                "experiment_code": experiment_code,
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
                "status": "实验进行中",
                "axis_codes": [*completed_axes, *remaining_axes],
            }
        ],
    )
    storage.write("mes.experiment_trays", [{"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}])
    storage.write(
        "mes.schedules",
        [
            {
                "id": "schedule-impact-done",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "device": "冲击一室",
                "status": "实验已完成",
                "axis_codes": completed_axes,
                "sub_experiment_code": first_sub_code,
            },
            {
                "id": "schedule-impact-remaining",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "device": "冲击一室",
                "status": "已排程",
                "axis_codes": remaining_axes,
                "sub_experiment_code": second_sub_code,
            },
        ],
    )
    storage.write(
        "mes.experiment_runs",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "status": "实验已完成",
                "axis_codes": completed_axes,
                "schedule_id": "schedule-impact-done",
                "sub_experiment_code": first_sub_code,
            }
        ],
    )
    storage.write(
        "mes.experiment_run_trays",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "tray_code": tray_code,
                "run_tray_status": "实验已完成",
                "sub_experiment_code": first_sub_code,
            }
        ],
    )
    storage.write(
        "mes.experiment_run_steps",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "axis_code": axis_code,
                "status": "实验已完成",
                "sub_experiment_code": first_sub_code,
            }
            for axis_code in completed_axes
        ],
    )

    response = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    updated_sample = storage.read("mes.samples")[0]
    assert updated_sample["status"] == "实验进行中"
    assert updated_sample["trays"][0]["status"] == "实验进行中"
    assert updated_sample["trays"][0]["target_experiment_code"] == experiment_code


def test_transfer_area_rejects_partial_axis_redispatch_without_pending_axis_schedule(monkeypatch):
    client, storage = build_client(monkeypatch)
    task_code = "SYLU-2026-07-001"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    sample_code = f"{task_code}-SP-001"
    completed_axes = ["x+", "x-", "y+"]
    remaining_axes = ["y-", "z+", "z-"]
    first_sub_code = f"{experiment_code}#AXIS-001"
    second_sub_code = f"{experiment_code}#AXIS-002"
    storage.write(
        "mes.tasks",
        [{"id": task_code, "code": task_code, "name": "13652", "test_type": "冲击试验", "status": "任务进行中", "transfer_status": "到货"}],
    )
    storage.write(
        "mes.samples",
        [
            {
                "id": sample_code,
                "code": sample_code,
                "task_code": task_code,
                "status": "送至实验室",
                "flow_status": "送至实验室",
                "location": "冲击一室",
                "trays": [
                    {
                        "tray_code": tray_code,
                        "quantity": 1,
                        "status": "送至实验室",
                        "target_lab": "冲击一室",
                        "target_experiment_code": experiment_code,
                        "target_sub_experiment_code": second_sub_code,
                    }
                ],
            }
        ],
    )
    storage.write(
        "mes.experiments",
        [
            {
                "id": experiment_code,
                "task_code": task_code,
                "experiment_code": experiment_code,
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
                "status": "实验进行中",
                "axis_codes": [*completed_axes, *remaining_axes],
            }
        ],
    )
    storage.write("mes.experiment_trays", [{"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}])
    storage.write(
        "mes.schedules",
        [
            {
                "id": "schedule-impact-done",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "device": "冲击一室",
                "status": "实验已完成",
                "axis_codes": completed_axes,
                "sub_experiment_code": first_sub_code,
            },
            {
                "id": "schedule-impact-remaining",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "device": "冲击一室",
                "status": "实验已完成",
                "axis_codes": remaining_axes,
                "sub_experiment_code": second_sub_code,
            },
        ],
    )
    storage.write(
        "mes.experiment_runs",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "status": "实验已完成",
                "tray_codes": [tray_code],
                "axis_codes": completed_axes,
                "schedule_id": "schedule-impact-done",
                "sub_experiment_code": first_sub_code,
            }
        ],
    )
    storage.write(
        "mes.experiment_run_trays",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "tray_code": tray_code,
                "run_tray_status": "实验已完成",
                "sub_experiment_code": first_sub_code,
            }
        ],
    )
    storage.write(
        "mes.experiment_run_steps",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "axis_code": axis_code,
                "status": "实验已完成",
                "sub_experiment_code": first_sub_code,
            }
            for axis_code in completed_axes
        ],
    )

    response = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "lab", "targetName": "冲击一室", "experimentCode": experiment_code},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    assert storage.read("mes.samples")[0]["status"] == "送至实验室"


def test_transfer_area_rejects_partial_axis_staging_dispatch_without_pending_axis_schedule(monkeypatch):
    client, storage = build_client(monkeypatch)
    task_code = "SYLU-2026-07-001"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    completed_axes = ["x+", "x-", "y+"]
    remaining_axes = ["y-", "z+", "z-"]
    first_sub_code = f"{experiment_code}#AXIS-001"
    second_sub_code = f"{experiment_code}#AXIS-002"
    storage.write(
        "mes.tasks",
        [{"id": task_code, "code": task_code, "name": "13652", "test_type": "冲击试验", "status": "任务进行中", "transfer_status": "到货"}],
    )
    storage.write(
        "mes.samples",
        [
            {
                "id": f"{task_code}-SP-001",
                "code": f"{task_code}-SP-001",
                "task_code": task_code,
                "status": "送至实验室",
                "flow_status": "送至实验室",
                "location": "冲击一室",
                "trays": [
                    {
                        "tray_code": tray_code,
                        "quantity": 1,
                        "status": "送至实验室",
                        "target_lab": "冲击一室",
                        "target_experiment_code": experiment_code,
                        "target_sub_experiment_code": second_sub_code,
                    }
                ],
            }
        ],
    )
    storage.write(
        "mes.experiments",
        [
            {
                "id": experiment_code,
                "task_code": task_code,
                "experiment_code": experiment_code,
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
                "status": "实验进行中",
                "axis_codes": [*completed_axes, *remaining_axes],
            }
        ],
    )
    storage.write("mes.experiment_trays", [{"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}])
    storage.write(
        "mes.schedules",
        [
            {
                "id": "schedule-impact-done",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "device": "冲击一室",
                "status": "实验已完成",
                "axis_codes": completed_axes,
                "sub_experiment_code": first_sub_code,
            },
            {
                "id": "schedule-impact-remaining",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "device": "冲击一室",
                "status": "实验已完成",
                "axis_codes": remaining_axes,
                "sub_experiment_code": second_sub_code,
            },
        ],
    )
    storage.write(
        "mes.experiment_runs",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "status": "实验已完成",
                "tray_codes": [tray_code],
                "axis_codes": completed_axes,
                "schedule_id": "schedule-impact-done",
                "sub_experiment_code": first_sub_code,
            }
        ],
    )
    storage.write(
        "mes.experiment_run_trays",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "tray_code": tray_code,
                "run_tray_status": "实验已完成",
                "sub_experiment_code": first_sub_code,
            }
        ],
    )
    storage.write(
        "mes.experiment_run_steps",
        [
            {
                "run_no": "RUN-IMPACT-AXIS",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "axis_code": axis_code,
                "status": "实验已完成",
                "sub_experiment_code": first_sub_code,
            }
            for axis_code in completed_axes
        ],
    )

    response = client.post(
        f"/api/transfer-area/trays/{tray_code}/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    assert storage.read("mes.samples")[0]["status"] == "送至实验室"


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
    assert second.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"


def test_transfer_area_workspace_backfills_experiments_from_legacy_test_type_when_storage_has_none(monkeypatch):
    client, storage = build_client(monkeypatch)
    storage.write("mes.experiments", [])

    response = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert response.status_code == 200
    payload = response.json()
    assert [item["experimentCode"] for item in payload["experiments"]] == [
        "SYLU-2026-03-101-A",
        "SYLU-2026-03-101-B",
    ]
    assert [item["experimentName"] for item in payload["experiments"]] == ["盐雾试验", "振动试验"]


def test_transfer_area_workspace_scopes_legacy_sample_and_tray_experiment_fallbacks_by_task(monkeypatch):
    client, storage = build_client(monkeypatch)
    storage.write(
        "mes.tasks",
        [
            {
                "id": "task-a",
                "code": "TASK-A",
                "name": "任务 A",
                "test_type": "盐雾试验",
                "sample_count": 1,
                "status": "已排程",
                "transfer_status": "到货",
            },
            {
                "id": "task-b",
                "code": "TASK-B",
                "name": "任务 B",
                "test_type": "盐雾试验",
                "sample_count": 1,
                "status": "已排程",
                "transfer_status": "到货",
            },
        ],
    )
    storage.write(
        "mes.samples",
        [
            {
                "id": "sample-a-1",
                "code": "SP-001",
                "task_code": "TASK-A",
                "status": "到货",
                "flow_status": "到货",
                "location": "接驳区",
                "trays": [{"tray_id": 1001, "tray_code": "TP-001", "quantity": 1, "status": "到货"}],
            },
            {
                "id": "sample-b-1",
                "code": "SP-001",
                "task_code": "TASK-B",
                "status": "到货",
                "flow_status": "到货",
                "location": "接驳区",
                "trays": [{"tray_id": 1001, "tray_code": "TP-001", "quantity": 1, "status": "到货"}],
            },
        ],
    )
    storage.write(
        "mes.experiments",
        [
            {"id": "exp-a", "task_code": "TASK-A", "experiment_code": "TASK-A-EXP", "experiment_name": "盐雾试验", "status": "已排程"},
            {"id": "exp-b", "task_code": "TASK-B", "experiment_code": "TASK-B-EXP", "experiment_name": "盐雾试验", "status": "已排程"},
        ],
    )
    storage.write("mes.experiment_samples", [{"task_code": "TASK-B", "experiment_code": "TASK-B-EXP", "sample_code": "SP-001"}])
    storage.write("mes.experiment_trays", [{"task_code": "TASK-B", "experiment_code": "TASK-B-EXP", "tray_code": "TP-001"}])

    response = client.get("/api/transfer-area/tasks/task-a/workspace")

    assert response.status_code == 200
    tray = response.json()["assignedTrays"][0]
    assert tray["experimentCodes"] == []
    assert tray["experimentLabels"] == []
    assert tray["samples"][0]["sampleNo"] == "SP-001"
    assert tray["samples"][0]["experimentCodes"] == []


def test_transfer_area_renders_missing_task_samples_without_persisting_from_get_requests(monkeypatch):
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
    assert stored_samples == []


def test_transfer_area_bootstrap_reuses_sample_index_for_many_tasks(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    client, storage = build_client(monkeypatch)
    tasks = []
    samples = []
    for task_index in range(30):
        task_code = f"SYLU-2026-06-{task_index + 1:03d}"
        tasks.append(
            {
                "id": f"task-{task_index + 1}",
                "code": task_code,
                "name": f"批次 {task_index + 1}",
                "test_type": "盐雾试验",
                "sample_count": 99,
                "arrival_at": "2026-06-01 10:00",
                "status": "待排程",
            }
        )
        samples.extend(
            {
                "id": f"sample-{task_index + 1}-{sample_index + 1}",
                "code": f"{task_code}-SP-{sample_index + 1:03d}",
                "task_code": task_code,
                "status": "运输中",
                "flow_status": "运输中",
                "location": "",
            }
            for sample_index in range(99)
        )
    storage.write("mes.tasks", tasks)
    storage.write("mes.samples", samples)

    original_build_task_sample_map = transfer_area_route.build_task_sample_map
    calls = []

    def counted_build_task_sample_map(all_samples):
        calls.append(len(all_samples))
        return original_build_task_sample_map(all_samples)

    monkeypatch.setattr(transfer_area_route, "build_task_sample_map", counted_build_task_sample_map)

    response = client.get("/api/transfer-area/bootstrap")

    assert response.status_code == 200
    assert len(response.json()["taskOverview"]) == 30
    assert calls == [2970]


def test_transfer_area_bootstrap_returns_preview_codes_for_large_sample_tasks(monkeypatch):
    client, storage = build_client(monkeypatch)
    task_code = "SYLU-2026-06-099"
    storage.write(
        "mes.tasks",
        [
            {
                "id": "task-99",
                "code": task_code,
                "name": "99 样品任务",
                "test_type": "盐雾试验",
                "sample_count": 99,
                "arrival_at": "2026-06-01 10:00",
                "status": "待排程",
            }
        ],
    )
    storage.write(
        "mes.samples",
        [
            {
                "id": f"sample-{index + 1}",
                "code": f"{task_code}-SP-{index + 1:03d}",
                "task_code": task_code,
                "status": "运输中",
                "flow_status": "运输中",
                "location": "",
            }
            for index in range(99)
        ],
    )

    response = client.get("/api/transfer-area/bootstrap")

    assert response.status_code == 200
    task_row = response.json()["taskOverview"][0]
    assert task_row["sampleCount"] == 99
    assert task_row["sampleCodeCount"] == 99
    assert task_row["sampleCodes"] == [f"{task_code}-SP-{index + 1:03d}" for index in range(12)]
    assert task_row["sampleCodePreview"] == [f"{task_code}-SP-{index + 1:03d}" for index in range(12)]
    assert f"{task_code}-SP-099" in task_row["sampleCodeSearchText"]


def test_transfer_area_lazy_sample_backfill_does_not_publish_storage_update_from_get(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    published_updates = []
    monkeypatch.setattr(transfer_area_route, "publish_storage_update", lambda keys: published_updates.append(list(keys)), raising=False)
    client, storage = build_client(monkeypatch)
    storage.write(
        "mes.samples",
        [sample for sample in storage.read("mes.samples") if sample["task_code"] != "SYLU-2026-03-101"],
    )

    response = client.get("/api/transfer-area/bootstrap")

    assert response.status_code == 200
    assert published_updates == []


def test_transfer_area_limits_unassigned_samples_to_task_sample_count(monkeypatch):
    client, storage = build_client(monkeypatch)
    tasks = storage.read("mes.tasks")
    tasks[0] = {**tasks[0], "sample_count": 1}
    storage.write("mes.tasks", tasks)

    bootstrap = client.get("/api/transfer-area/bootstrap")
    workspace = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert bootstrap.status_code == 200
    task_row = next(item for item in bootstrap.json()["taskOverview"] if item["taskNo"] == "SYLU-2026-03-101")
    assert task_row["sampleCount"] == 1
    assert task_row["sampleCodes"] == ["SYLU-2026-03-101-SP-001"]

    assert workspace.status_code == 200
    assert workspace.json()["task"]["sampleCount"] == 1
    assert [sample["sampleNo"] for sample in workspace.json()["assignedTrays"][0]["samples"]] == [
        "SYLU-2026-03-101-SP-001",
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
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    printed = client.post("/api/transfer-area/tasks/task-101/print-barcodes", json={"barcodeType": "QRCODE"})
    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")
    reloaded = client.post("/api/transfer-area/tasks/task-101/reload")

    assert allocated.status_code == 200
    assert allocated.json()["workspace"]["assignedTrays"][0]["samples"][0]["sampleNo"] == "SYLU-2026-03-101-SP-001"

    assert printed.status_code == 200
    assert len(printed.json()["barcodes"]) > 0
    assert printed.json()["workspace"]["assignedTrays"][0]["barcode"]["barcodeNo"]

    assert confirmed.status_code == 200
    assert confirmed.json()["workspace"]["task"]["taskStatus"] == "到货"
    assert confirmed.json()["workspace"]["assignedTrays"][0]["samples"][0]["sampleStatus"] == "到货"

    assert reloaded.status_code == 200
    assert reloaded.json()["workspace"]["task"]["taskStatus"] == "未入库"
    assert reloaded.json()["workspace"]["assignedTrays"][0]["barcode"] is None
    assert reloaded.json()["workspace"]["assignedTrays"][0]["experimentLabels"] == []
    assert all(item["assignedTrayCount"] == 0 for item in reloaded.json()["workspace"]["experiments"])
    assert storage.read("mes.tasks")[0]["transfer_status"] == "未入库"
    assert storage.read("mes.tasks")[0]["tray_codes"] == []
    assert storage.read("mes.experiment_trays") == []
    assert storage.read("mes.experiment_samples") == []
    assert storage.read("mes.experiment_runs") == []
    assert all(sample["trays"] == [] for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-101")


def test_transfer_area_reload_clears_timestamped_mysql_style_preallocation(monkeypatch):
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
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")

    assert allocated.status_code == 200
    assert confirmed.status_code == 200

    timestamped_samples = []
    for sample in storage.read("mes.samples"):
        next_sample = deepcopy(sample)
        if next_sample.get("task_code") == "SYLU-2026-03-101":
            next_sample["updated_at"] = "2026-06-15 15:31:56"
            next_sample["trays"] = [
                {
                    **tray,
                    "updated_at": "2026-06-15 15:31:56",
                    "created_at": "2026-06-15 15:31:56",
                }
                for tray in next_sample.get("trays", [])
            ]
        timestamped_samples.append(next_sample)
    storage.write("mes.samples", timestamped_samples)

    for key in ("mes.experiment_trays", "mes.experiment_samples"):
        timestamped_rows = [
            {
                **row,
                "created_at": "2026-06-15 15:31:56",
                "updated_at": "2026-06-15 15:31:56",
            }
            for row in storage.read(key)
        ]
        storage.write(key, timestamped_rows)

    reloaded = client.post("/api/transfer-area/tasks/task-101/reload")

    assert reloaded.status_code == 200
    payload = reloaded.json()["workspace"]
    assert payload["allocationSaved"] is False


    assert all(tray["samples"] for tray in payload["assignedTrays"])
    assert all(tray["experimentLabels"] == [] for tray in payload["assignedTrays"])
    assert all(item["assignedTrayCount"] == 0 for item in payload["experiments"])
    assert storage.read("mes.experiment_trays") == []
    assert storage.read("mes.experiment_samples") == []
    assert all(sample["trays"] == [] for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-101")

    refreshed = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert refreshed.status_code == 200
    refreshed_payload = refreshed.json()
    assert refreshed_payload["allocationSaved"] is False
    assert all(tray["experimentLabels"] == [] for tray in refreshed_payload["assignedTrays"])
    assert all(item["assignedTrayCount"] == 0 for item in refreshed_payload["experiments"])


def test_transfer_area_workspace_mutations_publish_storage_updates(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    published_updates = []
    monkeypatch.setattr(transfer_area_route, "publish_storage_update", lambda keys: published_updates.append(list(keys)), raising=False)
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
        "experimentTrays": [
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    printed = client.post("/api/transfer-area/tasks/task-101/print-barcodes", json={"barcodeType": "QRCODE"})
    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")
    reloaded = client.post("/api/transfer-area/tasks/task-101/reload")

    assert allocated.status_code == 200
    assert printed.status_code == 200
    assert confirmed.status_code == 200
    assert reloaded.status_code == 200
    assert len(published_updates) == 4
    for keys in published_updates:
        assert "mes.tasks" in keys
        assert "mes.samples" in keys
        assert "mes.experiment_runs" in keys
        assert "mes.experiment_trays" in keys
        assert "mes.experiment_samples" in keys
        assert "mes.staging_events" in keys


def test_transfer_area_dispatch_mutations_publish_storage_updates(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    published_updates = []
    monkeypatch.setattr(transfer_area_route, "publish_storage_update", lambda keys: published_updates.append(list(keys)), raising=False)
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(storage, [])

    dispatched = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )
    withdrawn = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch",
        json={"reason": "点错暂存间"},
    )

    assert dispatched.status_code == 200
    assert withdrawn.status_code == 200
    assert len(published_updates) == 2
    for keys in published_updates:
        assert "mes.tasks" in keys
        assert "mes.samples" in keys
        assert "mes.staging_events" in keys


def test_transfer_area_mutations_publish_storage_update_metadata(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    published_updates = []
    monkeypatch.setattr(
        transfer_area_route,
        "publish_storage_update",
        lambda keys, **kwargs: published_updates.append((list(keys), kwargs)),
        raising=False,
    )
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
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
        ],
    }
    assert client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation).status_code == 200
    published_updates.clear()

    confirmed = client.post(
        "/api/transfer-area/tasks/task-101/confirm-storage",
        headers={
            "X-MES-Update-Source": "transfer-workbench",
            "X-MES-Update-Request-Id": "confirm-1",
        },
    )

    assert confirmed.status_code == 200
    assert published_updates[-1][1] == {"source": "transfer-workbench", "request_id": "confirm-1"}

    seed_task_102_dispatch_data(storage, [])
    dispatched = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
        headers={
            "X-MES-Update-Source": "transfer-workbench",
            "X-MES-Update-Request-Id": "dispatch-1",
        },
    )

    assert dispatched.status_code == 200
    assert published_updates[-1][1] == {"source": "transfer-workbench", "request_id": "dispatch-1"}


def test_transfer_area_allocate_rejects_stale_saved_allocation_after_storage_confirmed(monkeypatch):
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
        "experimentTrays": [
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")
    stale_save = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)

    assert allocated.status_code == 200
    assert confirmed.status_code == 200
    assert stale_save.status_code == 400
    assert stale_save.json()["detail"] == "该任务已到货，不能重新保存预接驳托盘。"


def test_transfer_area_workspace_and_allocate_include_experiment_tray_assignments(monkeypatch):
    client, storage = build_client(monkeypatch)
    experiments = storage.read("mes.experiments")
    experiments[1] = {
        **experiments[1],
        "experiment_name": "高低温湿热试验2",
        "required_device": "高低温湿热试验",
    }
    storage.write("mes.experiments", experiments)

    workspace = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert workspace.status_code == 200
    workspace_payload = workspace.json()
    assert [item["experimentCode"] for item in workspace_payload["experiments"]] == ["SYLU-2026-03-101-A", "SYLU-2026-03-101-B", "SYLU-2026-03-101-C"]
    assert [item["experimentName"] for item in workspace_payload["experiments"]] == ["盐雾试验", "高低温湿热试验", "温度冲击试验"]
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
    assert allocated_payload["assignedTrays"][0]["experimentLabels"] == ["盐雾试验", "高低温湿热试验"]
    assert allocated_payload["assignedTrays"][1]["experimentLabels"] == ["高低温湿热试验", "温度冲击试验"]
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


def test_transfer_area_preallocation_keeps_in_transit_samples_until_storage_confirm(monkeypatch):
    client, storage = build_client(monkeypatch)
    assert storage.read("mes.tasks")[0]["arrival_at"] == "2026-03-21 10:20"
    assert {
        sample["flow_status"]
        for sample in storage.read("mes.samples")
        if sample["task_code"] == "SYLU-2026-03-101"
    } == {"运输中"}

    allocation = {
        "trayLimit": 2,
        "trays": [
            {"trayId": 1001, "sampleIds": ["sample-1", "sample-2"]},
            {"trayId": 1002, "sampleIds": ["sample-3", "sample-4"]},
        ],
        "experimentTrays": valid_task_101_experiment_trays(),
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)

    assert allocated.status_code == 200
    preallocated_samples = [
        sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-101"
    ]
    assert {sample["status"] for sample in preallocated_samples} == {"运输中"}
    assert {sample["flow_status"] for sample in preallocated_samples} == {"运输中"}
    assert {sample["location"] for sample in preallocated_samples} == {""}

    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")

    assert confirmed.status_code == 200
    stored_samples = [
        sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-101"
    ]
    assert {sample["status"] for sample in stored_samples} == {"到货"}
    assert {sample["flow_status"] for sample in stored_samples} == {"到货"}
    assert {sample["location"] for sample in stored_samples} == {"接驳区"}


def test_transfer_area_workspace_remaining_trays_counts_current_preallocation(monkeypatch):
    client, _storage = build_client(monkeypatch)

    allocation = {
        "trayLimit": 2,
        "trays": [
            {"trayId": 1001, "sampleIds": ["sample-1", "sample-2"]},
            {"trayId": 1002, "sampleIds": ["sample-3"]},
            {"trayId": 1003, "sampleIds": ["sample-4"]},
        ],
        "experimentTrays": [
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [1001]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [1002]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [1003]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    workspace = client.get("/api/transfer-area/tasks/task-101/workspace")

    assert allocated.status_code == 200
    assert workspace.status_code == 200
    assert len(workspace.json()["assignedTrays"]) == 3
    assert workspace.json()["task"]["remainingTrayCount"] == 6
    assert len(workspace.json()["trayInventory"]) == 6


def test_transfer_area_prints_preallocated_qrcodes_before_arrival(monkeypatch):
    client, storage = build_client(monkeypatch)
    tasks = storage.read("mes.tasks")
    tasks[0]["arrival_at"] = ""
    storage.write("mes.tasks", tasks)

    allocation = {
        "trayLimit": 2,
        "trays": [
            {"trayId": 1001, "sampleIds": ["sample-1", "sample-2"]},
            {"trayId": 1002, "sampleIds": ["sample-3", "sample-4"]},
        ],
        "experimentTrays": valid_task_101_experiment_trays(),
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    printed = client.post("/api/transfer-area/tasks/task-101/print-barcodes", json={"barcodeType": "QRCODE"})

    assert allocated.status_code == 200
    assert printed.status_code == 200
    assert printed.json()["message"] == "二维码已生成"
    assert [barcode["barcodeNo"] for barcode in printed.json()["barcodes"]] == [
        "SYLU-2026-03-101-TP-001",
        "SYLU-2026-03-101-TP-002",
    ]
    assert [barcode["barcodeType"] for barcode in printed.json()["barcodes"]] == ["QRCODE", "QRCODE"]
    assert [barcode["barcodeContent"] for barcode in printed.json()["barcodes"]] == [
        "MES-TRAY:SYLU-2026-03-101-TP-001",
        "MES-TRAY:SYLU-2026-03-101-TP-002",
    ]
    assert printed.json()["workspace"]["task"]["receivedTime"] == ""
    assert printed.json()["workspace"]["assignedTrays"][0]["barcode"]["barcodeNo"] == "SYLU-2026-03-101-TP-001"
    assert printed.json()["workspace"]["assignedTrays"][0]["barcode"]["barcodeContent"] == "MES-TRAY:SYLU-2026-03-101-TP-001"
    assert printed.json()["workspace"]["assignedTrays"][0]["barcodeData"] == "MES-TRAY:SYLU-2026-03-101-TP-001"


def test_transfer_area_print_rejects_unsaved_preallocation(monkeypatch):
    client, storage = build_client(monkeypatch)
    tasks = storage.read("mes.tasks")
    tasks[0]["arrival_at"] = ""
    storage.write("mes.tasks", tasks)

    printed = client.post("/api/transfer-area/tasks/task-101/print-barcodes", json={"barcodeType": "QRCODE"})

    assert printed.status_code == 400
    assert printed.json()["detail"] == "请先保存托盘，再打印二维码"


def test_transfer_area_allocate_rejects_incomplete_experiment_tray_assignments(monkeypatch):
    client, _storage = build_client(monkeypatch)
    allocation = {
        "trayLimit": 2,
        "trays": [
            {"trayId": 1001, "sampleIds": ["sample-1", "sample-2"]},
            {"trayId": 1002, "sampleIds": ["sample-3", "sample-4"]},
        ],
        "experimentTrays": [
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [1001]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [1001]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [1001]},
        ],
    }

    response = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)

    assert response.status_code == 400
    assert response.json()["detail"] == "有样品的托盘必须至少分配一个实验"


def test_transfer_area_allocate_rejects_unified_sample_limit_above_16(monkeypatch):
    client, _storage = build_client(monkeypatch)
    workspace = client.get("/api/transfer-area/tasks/task-101/workspace").json()
    allocation = {
        "trayLimit": 17,
        "trays": [
            {
                "trayId": workspace["assignedTrays"][0]["trayId"],
                "sampleIds": [
                    sample["sampleId"]
                    for tray in workspace["assignedTrays"]
                    for sample in tray["samples"]
                ],
            }
        ],
        "experimentTrays": [
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)

    assert allocated.status_code == 422


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
        "experimentTrays": [
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
        ],
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")

    assert allocated.status_code == 200
    assert confirmed.status_code == 200
    assert confirmed.json()["workspace"]["task"]["taskStatus"] == "到货"
    assert confirmed.json()["workspace"]["assignedTrays"][0]["samples"][0]["sampleStatus"] == "到货"


def test_transfer_area_confirm_storage_uses_targeted_read_and_scoped_sample_write(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    storage = ScopedTrackingTransferStorage(create_payloads())
    monkeypatch.setattr(transfer_area_route, "get_storage_backend", lambda: storage)
    app = FastAPI()
    app.include_router(transfer_area_route.router)
    client = TestClient(app)

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
        "experimentTrays": valid_task_101_experiment_trays(
            workspace["assignedTrays"][0]["trayId"],
            workspace["assignedTrays"][0]["trayId"],
        ),
    }
    assert client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation).status_code == 200
    unrelated_sample_before = deepcopy(
        next(sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102")
    )
    storage.read_all_calls = 0
    storage.read_many_calls.clear()
    storage.scoped_writes.clear()

    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")

    assert confirmed.status_code == 200
    assert storage.read_all_calls == 0
    assert storage.read_many_calls == [
        [
            "mes.tasks",
            "mes.samples",
            "mes.schedules",
            "mes.experiments",
            "mes.experiment_trays",
            "mes.experiment_samples",
        ]
    ]
    assert len(storage.scoped_writes) == 1
    scoped_update = storage.scoped_writes[0]
    assert set(scoped_update) == {"mes.tasks", "mes.samples", "mes.experiments"}
    assert {sample["task_code"] for sample in scoped_update["mes.samples"]} == {"SYLU-2026-03-101"}
    assert next(sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102") == unrelated_sample_before


def test_transfer_area_confirm_storage_is_idempotent_without_rewriting_or_republishing(monkeypatch):
    from app.api.routes import transfer_area as transfer_area_route

    published_updates = []
    monkeypatch.setattr(
        transfer_area_route,
        "publish_storage_update",
        lambda keys, **metadata: published_updates.append((list(keys), dict(metadata))),
        raising=False,
    )
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
        "experimentTrays": valid_task_101_experiment_trays(
            workspace["assignedTrays"][0]["trayId"],
            workspace["assignedTrays"][0]["trayId"],
        ),
    }
    assert client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation).status_code == 200
    assert client.post("/api/transfer-area/tasks/task-101/confirm-storage").status_code == 200
    stored_payload = deepcopy(storage.payloads)
    published_count = len(published_updates)

    duplicate = client.post(
        "/api/transfer-area/tasks/task-101/confirm-storage",
        headers={
            "X-MES-Update-Source": "transfer-workbench",
            "X-MES-Update-Request-Id": "duplicate-confirm",
        },
    )

    assert duplicate.status_code == 200
    assert duplicate.json()["workspace"]["task"]["taskStatus"] == "到货"
    assert storage.payloads == stored_payload
    assert len(published_updates) == published_count


def test_transfer_area_confirm_storage_rejects_saved_trays_without_experiment_matching(monkeypatch):
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
        "experimentTrays": valid_task_101_experiment_trays(
            workspace["assignedTrays"][0]["trayId"],
            workspace["assignedTrays"][0]["trayId"],
        ),
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    storage.write("mes.experiment_trays", [])
    storage.write("mes.experiment_samples", [])

    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")

    assert allocated.status_code == 200
    assert confirmed.status_code == 400
    assert confirmed.json()["detail"] == "每个实验都必须至少分配一个托盘"
    assert storage.read("mes.tasks")[0]["transfer_status"] == "未入库"


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
        "experimentTrays": [
            {"experimentCode": "SYLU-2026-03-101-A", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-B", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
            {"experimentCode": "SYLU-2026-03-101-C", "trayIds": [workspace["assignedTrays"][0]["trayId"]]},
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


def test_transfer_area_rejects_dispatch_when_transfer_flag_is_missing_even_if_samples_are_stored(monkeypatch):
    client, storage = build_client(monkeypatch)

    allocation = {
        "trayLimit": 2,
        "trays": [
            {"trayId": 1001, "sampleIds": ["sample-1", "sample-2"]},
            {"trayId": 1002, "sampleIds": ["sample-3", "sample-4"]},
        ],
        "experimentTrays": valid_task_101_experiment_trays(),
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    confirmed = client.post("/api/transfer-area/tasks/task-101/confirm-storage")

    assert allocated.status_code == 200
    assert confirmed.status_code == 200

    tasks = storage.read("mes.tasks")
    tasks[0]["transfer_status"] = ""
    storage.write("mes.tasks", tasks)

    bootstrap = client.get("/api/transfer-area/bootstrap")
    first = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-101-TP-001/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )
    second = client.post(
        "/api/transfer-area/trays/SYLU-2026-03-101-TP-002/dispatch",
        json={"targetType": "staging", "targetName": "恒温恒湿间（暂存间）"},
    )

    assert bootstrap.status_code == 200
    task_row = next(item for item in bootstrap.json()["taskOverview"] if item["taskNo"] == "SYLU-2026-03-101")
    assert task_row["taskStatus"] == "未入库"
    assert first.status_code == 400
    assert first.json()["detail"] == "该托盘尚未确认入库，不能出库"
    assert second.status_code == 400
    assert second.json()["detail"] == "该托盘尚未确认入库，不能出库"


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
    assert task_row["taskStatus"] == "到货"
    assert task_row["taskProgress"] == "实验进行中"

    assert workspace.status_code == 200
    assert workspace.json()["task"]["taskStatus"] == "到货"
    assert workspace.json()["task"]["taskProgress"] == "实验进行中"
    assert workspace.json()["task"]["reloadBlocked"] is True
    assert workspace.json()["task"]["reloadBlockedReason"] == "该任务已有托盘开始实验，不能重新入库。"

    assert reloaded.status_code == 400
    assert reloaded.json()["detail"] == "该任务已有托盘开始实验，不能重新入库。"


def test_transfer_area_reload_clears_existing_task_schedules_and_marks_reschedule_required(monkeypatch):
    client, storage = build_client(monkeypatch)
    seed_task_102_dispatch_data(
        storage,
        [
            {
                "id": "schedule-102-a",
                "task_code": "SYLU-2026-03-102",
                "experiment_code": "SYLU-2026-03-102-A",
                "device": "耐久试验室",
                "status": "已排程",
            },
            {
                "id": "schedule-other",
                "task_code": "TASK-OTHER",
                "experiment_code": "TASK-OTHER-A",
                "device": "盐雾试验室",
                "status": "已排程",
            },
        ],
    )

    workspace = client.get("/api/transfer-area/tasks/task-102/workspace")
    reloaded = client.post("/api/transfer-area/tasks/task-102/reload")

    assert workspace.status_code == 200
    assert workspace.json()["task"]["hasSchedules"] is True
    assert "需要重新排程" in workspace.json()["task"]["scheduleResetWarning"]
    assert reloaded.status_code == 200
    assert reloaded.json()["scheduleReset"] is True
    assert "需要重新排程" in reloaded.json()["message"]
    assert [item["id"] for item in storage.read("mes.schedules")] == ["schedule-other"]
    experiments = {
        item["experiment_code"]: item
        for item in storage.read("mes.experiments")
        if item["task_code"] == "SYLU-2026-03-102"
    }
    assert experiments["SYLU-2026-03-102-A"]["status"] == "待排程"
    assert experiments["SYLU-2026-03-102-A"]["unscheduled_since"]
    assert experiments["SYLU-2026-03-102-B"]["status"] == "待排程"
    assert experiments["SYLU-2026-03-102-B"]["unscheduled_since"]


def test_transfer_area_preallocation_reassign_clears_existing_task_schedules(monkeypatch):
    client, storage = build_client(monkeypatch)
    storage.write(
        "mes.schedules",
        [
            {
                "id": "schedule-101-a",
                "task_code": "SYLU-2026-03-101",
                "experiment_code": "SYLU-2026-03-101-A",
                "device": "盐雾试验室",
                "status": "已排程",
            },
            {
                "id": "schedule-other",
                "task_code": "TASK-OTHER",
                "experiment_code": "TASK-OTHER-A",
                "device": "盐雾试验室",
                "status": "已排程",
            },
        ],
    )
    experiments = storage.read("mes.experiments")
    for experiment in experiments:
        if experiment["task_code"] == "SYLU-2026-03-101":
            experiment["status"] = "已排程"
    storage.write("mes.experiments", experiments)
    allocation = {
        "trayLimit": 2,
        "trays": [
            {"trayId": 1001, "sampleIds": ["sample-1", "sample-2"]},
            {"trayId": 1002, "sampleIds": ["sample-3", "sample-4"]},
        ],
        "experimentTrays": valid_task_101_experiment_trays(),
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)
    reloaded = client.post("/api/transfer-area/tasks/task-101/reload")

    assert allocated.status_code == 200
    assert allocated.json()["scheduleReset"] is False
    assert reloaded.status_code == 200
    assert reloaded.json()["scheduleReset"] is True
    assert "需要重新排程" in reloaded.json()["message"]
    assert [item["id"] for item in storage.read("mes.schedules")] == ["schedule-other"]
    task_experiments = [
        item
        for item in storage.read("mes.experiments")
        if item["task_code"] == "SYLU-2026-03-101"
    ]
    assert {item["status"] for item in task_experiments} == {"待排程"}
    assert all(item.get("unscheduled_since") for item in task_experiments)


def test_transfer_area_rejects_reload_after_tray_leaves_handover(monkeypatch):
    blocked_statuses = ["送至暂存间", "已到达暂存间", "送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪"]

    for status in blocked_statuses:
        client, storage = build_client(monkeypatch)
        samples = storage.read("mes.samples")
        for sample in samples:
            if sample["task_code"] != "SYLU-2026-03-102":
                continue
            sample["status"] = status
            sample["flow_status"] = status
            sample["location"] = "恒温恒湿间（暂存间）" if "暂存间" in status else "振动一室"
            sample["trays"] = [{**sample["trays"][0], "status": status}]
        storage.write("mes.samples", samples)

        workspace = client.get("/api/transfer-area/tasks/task-102/workspace")
        reloaded = client.post("/api/transfer-area/tasks/task-102/reload")

        assert workspace.status_code == 200
        assert workspace.json()["task"]["reloadBlocked"] is True
        assert workspace.json()["task"]["reloadBlockedReason"] == "该任务已有托盘离开接驳区，不能重新入库。"
        assert reloaded.status_code == 400
        assert reloaded.json()["detail"] == "该任务已有托盘离开接驳区，不能重新入库。"


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
    assert task_row["taskStatus"] == "到货"
    assert task_row["taskProgress"] == "实验进行中"

    assert workspace.status_code == 200
    assert workspace.json()["task"]["taskStatus"] == "到货"
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
    tasks = storage.read("mes.tasks")
    for task in tasks:
        if task["code"] == "SYLU-2026-03-102":
            task["transfer_status"] = "厂家收回"
    storage.write("mes.tasks", tasks)

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


def test_transfer_area_rejects_reload_for_explicitly_returned_transfer_task(monkeypatch):
    client, storage = build_client(monkeypatch)
    tasks = storage.read("mes.tasks")
    for task in tasks:
        if task["code"] == "SYLU-2026-03-102":
            task["transfer_status"] = "厂家收回"
    storage.write("mes.tasks", tasks)

    response = client.post("/api/transfer-area/tasks/task-102/reload")

    assert response.status_code == 400
    assert response.json()["detail"] == "该任务已厂家收回，不能重新入库。"


def test_transfer_area_does_not_treat_returned_sample_trays_as_returned_task(monkeypatch):
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

    response = client.post("/api/transfer-area/tasks/task-102/reload")

    assert response.status_code == 400
    assert response.json()["detail"] != "该任务已厂家收回，不能重新入库。"


def test_transfer_area_rejects_all_reentry_actions_for_explicitly_returned_task(monkeypatch):
    client, storage = build_client(monkeypatch)
    tasks = storage.read("mes.tasks")
    for task in tasks:
        if task["code"] == "SYLU-2026-03-102":
            task["transfer_status"] = "厂家收回"
    storage.write("mes.tasks", tasks)

    allocation = {
        "trayLimit": 2,
        "trays": [{"trayId": 1001, "sampleIds": ["sample-5", "sample-6"]}],
    }

    dispatch_lookup = client.get("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch")
    allocated = client.post("/api/transfer-area/tasks/task-102/allocate", json=allocation)
    printed = client.post("/api/transfer-area/tasks/task-102/print-barcodes", json={"barcodeType": "QRCODE"})
    confirmed = client.post("/api/transfer-area/tasks/task-102/confirm-storage")

    assert dispatch_lookup.status_code == 404
    assert dispatch_lookup.json()["detail"] == "任务已归档"
    assert allocated.status_code == 400
    assert allocated.json()["detail"] == "该任务已厂家收回，不能重新入库。"
    assert printed.status_code == 400
    assert printed.json()["detail"] == "该任务已厂家收回，不能重新入库。"
    assert confirmed.status_code == 400
    assert confirmed.json()["detail"] == "该任务已厂家收回，不能重新入库。"
    stored_task = next(task for task in storage.read("mes.tasks") if task["code"] == "SYLU-2026-03-102")
    assert stored_task["transfer_status"] == "厂家收回"


def test_transfer_area_keeps_task_accessible_when_only_sample_trays_were_returned(monkeypatch):
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

    bootstrap = client.get("/api/transfer-area/bootstrap")
    workspace = client.get("/api/transfer-area/tasks/task-102/workspace")
    dispatch_lookup = client.get("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch")

    assert bootstrap.status_code == 200
    task_nos = [item["taskNo"] for item in bootstrap.json()["taskOverview"]]
    assert "SYLU-2026-03-102" in task_nos
    assert workspace.status_code == 200
    assert dispatch_lookup.status_code == 400
    assert dispatch_lookup.json()["detail"] == "该托盘当前不在接驳区，不能从接驳区出库"
    stored_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-102"]
    assert all(sample["status"] == "厂家收回" for sample in stored_samples)
    assert all(sample["trays"][0]["status"] == "厂家收回" for sample in stored_samples)


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
    assert workspace.json()["task"]["remainingTrayCount"] == 9
    assert len(workspace.json()["trayInventory"]) == 9


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
        "experimentTrays": valid_task_101_experiment_trays(),
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


def test_transfer_area_reallocate_clears_stale_experiment_runs_for_task(monkeypatch):
    client, storage = build_client(monkeypatch)
    storage.write(
        "mes.experiment_runs",
        [
            {
                "run_no": "RUN-STALE",
                "task_code": "SYLU-2026-03-101",
                "experiment_code": "SYLU-2026-03-101-A",
                "tray_codes": ["SYLU-2026-03-101-TP-001"],
                "status": "实验进行中",
            },
            {
                "run_no": "RUN-OTHER",
                "task_code": "OTHER",
                "experiment_code": "OTHER-A",
                "tray_codes": ["OTHER-TP-001"],
                "status": "实验进行中",
            },
        ],
    )
    storage.write(
        "mes.experiment_run_trays",
        [
            {
                "run_no": "RUN-STALE",
                "task_code": "SYLU-2026-03-101",
                "experiment_code": "SYLU-2026-03-101-A",
                "tray_code": "SYLU-2026-03-101-TP-001",
                "run_tray_status": "实验进行中",
            },
            {
                "run_no": "RUN-OTHER",
                "task_code": "OTHER",
                "experiment_code": "OTHER-A",
                "tray_code": "OTHER-TP-001",
                "run_tray_status": "实验进行中",
            },
        ],
    )

    allocation = {
        "trayLimit": 2,
        "trays": [
            {"trayId": 1001, "sampleIds": ["sample-1", "sample-2"]},
            {"trayId": 1002, "sampleIds": ["sample-3", "sample-4"]},
        ],
        "experimentTrays": valid_task_101_experiment_trays(),
    }

    allocated = client.post("/api/transfer-area/tasks/task-101/allocate", json=allocation)

    assert allocated.status_code == 200
    assert storage.read("mes.experiment_runs") == [
        {
            "run_no": "RUN-OTHER",
            "task_code": "OTHER",
            "experiment_code": "OTHER-A",
            "tray_codes": ["OTHER-TP-001"],
            "status": "实验进行中",
        }
    ]
    assert storage.read("mes.experiment_run_trays") == [
        {
            "run_no": "RUN-OTHER",
            "task_code": "OTHER",
            "experiment_code": "OTHER-A",
            "tray_code": "OTHER-TP-001",
            "run_tray_status": "实验进行中",
        }
    ]


def test_transfer_area_workspace_repairs_legacy_gap_tray_codes_in_response_without_persisting(monkeypatch):
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
    assert updated_task["tray_codes"] == ["SYLU-2026-03-101-TP-002", "SYLU-2026-03-101-TP-003"]
    updated_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-03-101"]
    assert updated_samples[0]["trays"][0]["tray_code"] == "SYLU-2026-03-101-TP-002"
    assert updated_samples[2]["trays"][0]["tray_code"] == "SYLU-2026-03-101-TP-003"


def test_transfer_area_allocate_rejects_when_system_trays_are_insufficient(monkeypatch):
    client, storage = build_client(monkeypatch)

    samples = storage.read("mes.samples")
    for index in range(1, 11):
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
    experiments = storage.read("mes.experiments")
    experiments.append(
        {
            "id": "experiment-201-a",
            "task_code": "SYLU-2026-04-201",
            "experiment_code": "SYLU-2026-04-201-A",
            "experiment_name": "盐雾试验",
            "required_device": "盐雾试验",
            "status": "待排程",
        }
    )
    storage.write("mes.experiments", experiments)
    storage.write(
        "mes.experiment_trays",
        [
            *storage.read("mes.experiment_trays"),
            {
                "task_code": "SYLU-2026-04-201",
                "experiment_code": "SYLU-2026-04-201-A",
                "tray_code": "SYLU-2026-04-201-TP-001",
            },
        ],
    )
    storage.write(
        "mes.experiment_samples",
        [
            *storage.read("mes.experiment_samples"),
            {
                "task_code": "SYLU-2026-04-201",
                "experiment_code": "SYLU-2026-04-201-A",
                "sample_code": "SYLU-2026-04-201-SP-001",
            },
            {
                "task_code": "SYLU-2026-04-201",
                "experiment_code": "SYLU-2026-04-201-A",
                "sample_code": "SYLU-2026-04-201-SP-002",
            },
        ],
    )

    response = client.post("/api/transfer-area/tasks/task-201/confirm-storage")

    assert response.status_code == 200
    assert response.json()["workspace"]["task"]["taskStatus"] == "到货"
    assert response.json()["workspace"]["task"]["receivedTime"]
    updated_task = next(task for task in storage.read("mes.tasks") if task["code"] == "SYLU-2026-04-201")
    assert updated_task["arrival_at"]
