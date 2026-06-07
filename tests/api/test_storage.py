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
            "mes.experiment_run_trays": [],
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


def test_storage_rejects_rearrival_after_manufacturer_return(monkeypatch):
    samples = [
        {
            "code": "SP-RETURNED",
            "location": "厂家收回",
            "status": "厂家收回",
            "flow_status": "厂家收回",
            "task_code": "SYLU-2026-05-704",
            "trays": [{"tray_code": "TP-RETURNED", "status": "厂家收回", "quantity": 1}],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    attempted = deepcopy(samples)
    attempted[0]["location"] = "接驳区"
    attempted[0]["status"] = "到货"
    attempted[0]["flow_status"] = "到货"
    attempted[0]["trays"][0]["status"] = "到货"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已厂家收回，不能再次到货。"
    assert storage.read("mes.samples") == samples


def test_storage_rejects_laboratory_progress_when_device_is_under_maintenance(monkeypatch):
    samples = [
        {
            "code": "SP-MAINTENANCE",
            "location": "盐雾试验室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "SYLU-2026-05-704",
            "trays": [{"tray_code": "TP-MAINTENANCE", "status": "送至实验室", "quantity": 1}],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.devices": [{"code": "盐雾试验室", "status": "保养"}],
            "mes.samples": samples,
        },
    )

    updated = deepcopy(samples)
    updated[0]["status"] = "已到达实验室"
    updated[0]["flow_status"] = "已到达实验室"
    updated[0]["trays"][0]["status"] = "已到达实验室"

    response = client.put("/api/storage", json={"mes.samples": updated})

    assert response.status_code == 400
    assert response.json()["detail"] == "盐雾试验室设备维护中，禁止实验室操作"
    assert storage.read("mes.samples") == samples


def test_storage_allows_laboratory_progress_after_maintenance_window_ends(monkeypatch):
    samples = [
        {
            "code": "SP-MAINTENANCE-ENDED",
            "location": "盐雾试验室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "SYLU-2026-05-705",
            "trays": [{"tray_code": "TP-MAINTENANCE-ENDED", "status": "送至实验室", "quantity": 1}],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.devices": [
                {
                    "code": "盐雾试验室",
                    "maintenance_end_at": "2000-01-01T12:00:00",
                    "maintenance_start_at": "2000-01-01T08:00:00",
                    "status": "保养",
                }
            ],
            "mes.samples": samples,
        },
    )

    updated = deepcopy(samples)
    updated[0]["status"] = "已到达实验室"
    updated[0]["flow_status"] = "已到达实验室"
    updated[0]["trays"][0]["status"] = "已到达实验室"

    response = client.put("/api/storage", json={"mes.samples": updated})

    assert response.status_code == 200
    assert storage.read("mes.samples") == updated


def test_storage_rejects_laboratory_progress_after_open_ended_maintenance_starts(monkeypatch):
    samples = [
        {
            "code": "SP-MAINTENANCE-OPEN",
            "location": "盐雾试验室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "SYLU-2026-05-706",
            "trays": [{"tray_code": "TP-MAINTENANCE-OPEN", "status": "送至实验室", "quantity": 1}],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.devices": [
                {
                    "code": "盐雾试验室",
                    "maintenance_start_at": "2000-01-01T08:00:00",
                    "maintenance_type": "计划保养",
                    "status": "可用",
                }
            ],
            "mes.samples": samples,
        },
    )

    updated = deepcopy(samples)
    updated[0]["status"] = "已到达实验室"
    updated[0]["flow_status"] = "已到达实验室"
    updated[0]["trays"][0]["status"] = "已到达实验室"

    response = client.put("/api/storage", json={"mes.samples": updated})

    assert response.status_code == 400
    assert response.json()["detail"] == "盐雾试验室设备维护中，禁止实验室操作"
    assert storage.read("mes.samples") == samples


def test_storage_allows_next_experiment_arrival_after_previous_experiment_completed(monkeypatch):
    samples = [
        {
            "code": "SP-PREVIOUS-COMPLETED",
            "location": "盐雾试验室",
            "status": "实验已完成",
            "flow_status": "实验已完成",
            "task_code": "SYLU-2026-05-707",
            "trays": [{"tray_code": "TP-PREVIOUS-COMPLETED", "status": "实验已完成", "quantity": 1}],
            "history": [
                {
                    "action": "实验完成",
                    "detail": "SYLU-2026-05-707 / 盐雾试验 / 实验已完成",
                    "status": "实验已完成",
                    "time": "2026-05-20T22:19:29+08:00",
                }
            ],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    updated = deepcopy(samples)
    updated[0]["location"] = "温度冲击一室"
    updated[0]["status"] = "已到达实验室"
    updated[0]["flow_status"] = "已到达实验室"
    updated[0]["trays"][0]["status"] = "已到达实验室"
    updated[0]["history"].insert(
        0,
        {
            "action": "任务比对",
            "detail": "SYLU-2026-05-707 / 温度冲击试验 / 已到达实验室",
            "status": "已到达实验室",
            "time": "2026-05-20T22:25:00+08:00",
        },
    )

    response = client.put("/api/storage", json={"mes.samples": updated})

    assert response.status_code == 200
    assert storage.read("mes.samples") == updated


def test_storage_allows_idempotent_snapshot_when_sample_already_arrived_lab(monkeypatch):
    samples = [
        {
            "code": "SP-ALREADY-ARRIVED",
            "location": "盐雾试验室",
            "status": "已到达实验室",
            "flow_status": "已到达实验室",
            "task_code": "SYLU-2026-05-705",
            "trays": [{"tray_code": "TP-ALREADY-ARRIVED", "status": "已到达实验室", "quantity": 1}],
        },
        {
            "code": "SP-NEW",
            "location": "",
            "status": "样品运输中",
            "flow_status": "样品运输中",
            "task_code": "SYLU-2026-05-706",
            "trays": [],
        },
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    updated = deepcopy(samples)
    updated[1]["owner"] = "新任务"

    response = client.put("/api/storage", json={"mes.samples": updated})

    assert response.status_code == 200
    assert storage.read("mes.samples") == updated


def test_storage_bulk_update_publishes_changed_keys(monkeypatch):
    from app.api.routes import storage as storage_route

    published = []
    client, storage = build_client(monkeypatch)
    monkeypatch.setattr(storage_route, "publish_storage_update", lambda keys: published.append(keys))

    response = client.put("/api/storage", json={"mes.samples": [{"code": "SP-1"}], "mes.tasks": [{"code": "T-1"}]})

    assert response.status_code == 200
    assert storage.read("mes.samples") == [{"code": "SP-1"}]
    assert published == [["mes.samples", "mes.tasks"]]


def test_storage_key_update_publishes_changed_key(monkeypatch):
    from app.api.routes import storage as storage_route

    published = []
    client, storage = build_client(monkeypatch)
    monkeypatch.setattr(storage_route, "publish_storage_update", lambda keys: published.append(keys))

    response = client.put("/api/storage/mes.tasks", json=[{"code": "T-2"}])

    assert response.status_code == 200
    assert storage.read("mes.tasks") == [{"code": "T-2"}]
    assert published == [["mes.tasks"]]


def test_storage_update_event_stream_yields_published_keys():
    from app.api.routes import storage as storage_route

    stream = storage_route._storage_update_event_stream()
    try:
        assert next(stream) == ": connected\n\n"

        storage_route.publish_storage_update(["mes.samples"])

        event = next(stream)
    finally:
        stream.close()

    assert event.startswith("data: ")
    assert '"keys": ["mes.samples"]' in event
    assert '"updatedAt":' in event


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


def test_storage_rejects_appearance_stock_in_after_laboratory_progress(monkeypatch):
    samples = [
        {
            "code": "SP-LAB-PROGRESSED-APPEARANCE",
            "location": "盐雾试验室",
            "status": "工装夹具安装",
            "flow_status": "工装夹具安装",
            "task_code": "SYLU-2026-05-705",
            "trays": [{"tray_code": "TP-LAB-PROGRESSED-APPEARANCE", "status": "工装夹具安装", "quantity": 1}],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    attempted = deepcopy(samples)
    attempted[0]["location"] = "外观检测间"
    attempted[0]["status"] = "外观检测间存放"
    attempted[0]["flow_status"] = "外观检测间存放"
    attempted[0]["trays"][0]["status"] = "外观检测间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已进入试验间流程，不能外观检测间入库。"
    assert storage.read("mes.samples") == samples


def test_storage_allows_appearance_stock_in_after_appearance_dispatch(monkeypatch):
    samples = [
        {
            "code": "SP-APPEARANCE-DISPATCHED",
            "location": "外观检测间",
            "status": "送至外观检测间",
            "flow_status": "送至外观检测间",
            "task_code": "SYLU-2026-05-706",
            "trays": [{"tray_code": "TP-APPEARANCE-DISPATCHED", "status": "送至外观检测间", "quantity": 1}],
            "history": [
                {
                    "detail": "SYLU-2026-05-706 / 盐雾试验 / 实验已完成",
                    "location": "盐雾试验室",
                    "status": "实验已完成",
                    "time": "2026-06-07T10:00:00",
                }
            ],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    attempted = deepcopy(samples)
    attempted[0]["status"] = "外观检测间存放"
    attempted[0]["flow_status"] = "外观检测间存放"
    attempted[0]["trays"][0]["status"] = "外观检测间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


def test_storage_rejects_appearance_stock_in_after_non_salt_mold_experiment(monkeypatch):
    samples = [
        {
            "code": "SP-APPEARANCE-NON-SALT",
            "location": "外观检测间",
            "status": "送至外观检测间",
            "flow_status": "送至外观检测间",
            "task_code": "SYLU-2026-05-707",
            "trays": [{"tray_code": "TP-APPEARANCE-NON-SALT", "status": "送至外观检测间", "quantity": 1}],
            "history": [
                {
                    "detail": "SYLU-2026-05-707 / 冲击试验 / 实验已完成",
                    "location": "冲击一室",
                    "status": "实验已完成",
                    "time": "2026-06-07T10:00:00",
                }
            ],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    attempted = deepcopy(samples)
    attempted[0]["status"] = "外观检测间存放"
    attempted[0]["flow_status"] = "外观检测间存放"
    attempted[0]["trays"][0]["status"] = "外观检测间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "只有盐雾、霉菌实验完成后才能进入外观检测间。"
    assert storage.read("mes.samples") == samples


def test_storage_allows_post_staging_stock_in_when_all_tray_experiments_completed(monkeypatch):
    samples = [
        {
            "code": "SYLU-2026-06-021-SP-003",
            "location": "冲击二室",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "task_code": "SYLU-2026-06-021",
            "trays": [
                {
                    "tray_code": "SYLU-2026-06-021-TP-003",
                    "status": "实验进行中",
                    "quantity": 1,
                    "target_lab": "冲击二室",
                    "target_experiment_code": "SYLU-2026-06-021-A",
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiment_trays": [
                {
                    "task_code": "SYLU-2026-06-021",
                    "experiment_code": "SYLU-2026-06-021-A",
                    "tray_code": "SYLU-2026-06-021-TP-003",
                },
                {
                    "task_code": "SYLU-2026-06-021",
                    "experiment_code": "SYLU-2026-06-021-C",
                    "tray_code": "SYLU-2026-06-021-TP-003",
                },
            ],
            "mes.experiment_run_trays": [
                {
                    "task_code": "SYLU-2026-06-021",
                    "experiment_code": "SYLU-2026-06-021-A",
                    "tray_code": "SYLU-2026-06-021-TP-003",
                    "run_tray_status": "实验已完成",
                },
                {
                    "task_code": "SYLU-2026-06-021",
                    "experiment_code": "SYLU-2026-06-021-C",
                    "tray_code": "SYLU-2026-06-021-TP-003",
                    "run_tray_status": "实验已完成",
                },
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（实验后暂存间）"
    attempted[0]["status"] = "放置实验后暂存间"
    attempted[0]["flow_status"] = "放置实验后暂存间"
    attempted[0]["trays"][0]["status"] = "放置实验后暂存间"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted
