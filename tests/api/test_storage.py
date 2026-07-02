from copy import deepcopy
import threading

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


class CountingStorage(FakeStorage):
    def __init__(self, payloads=None):
        super().__init__(payloads)
        self.read_calls = []
        self.read_all_count = 0

    def read(self, key):
        self.read_calls.append(key)
        return super().read(key)

    def read_all(self):
        self.read_all_count += 1
        return super().read_all()


class DelayedThreadSafeStorage(FakeStorage):
    def __init__(self, payloads=None, delay_first_write=True):
        super().__init__(payloads)
        self.delay_first_write = delay_first_write
        self.release_first_write = threading.Event()
        self.first_write_waiting = threading.Event()
        self._lock = threading.Lock()
        self._write_count = 0

    def read(self, key):
        with self._lock:
            return deepcopy(self.payloads.get(key, []))

    def read_all(self):
        with self._lock:
            return deepcopy(self.payloads)

    def write(self, key, value):
        with self._lock:
            self.payloads[key] = deepcopy(value)

    def write_many(self, updates):
        with self._lock:
            self._write_count += 1
            should_delay = self.delay_first_write and self._write_count == 1
        if should_delay:
            self.first_write_waiting.set()
            assert self.release_first_write.wait(2)
        with self._lock:
            for key, value in updates.items():
                self.payloads[key] = deepcopy(value)


def build_client(monkeypatch, payloads=None):
    from app.api.routes import storage as storage_route

    storage = FakeStorage(payloads)
    monkeypatch.setattr(storage_route, "get_storage_backend", lambda: storage)

    app = FastAPI()
    app.include_router(storage_route.router)
    return TestClient(app), storage


def build_client_with_storage(monkeypatch, storage):
    from app.api.routes import storage as storage_route

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


def test_storage_allows_pre_experiment_appearance_stock_for_salt_target_from_handover(monkeypatch):
    samples = [
        {
            "code": "SP-PRE-APPEARANCE",
            "location": "接驳区",
            "status": "到货",
            "flow_status": "到货",
            "task_code": "TASK-PRE-APPEARANCE",
            "trays": [{"tray_code": "TP-PRE-APPEARANCE", "status": "到货", "quantity": 1}],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-PRE-APPEARANCE",
                    "experiment_code": "EXP-SALT",
                    "experiment_name": "盐雾试验",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "外观检测间"
    attempted[0]["status"] = "实验前外观检测间存放"
    attempted[0]["flow_status"] = "实验前外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验前外观检测间存放"
    attempted[0]["trays"][0]["target_lab"] = "盐雾试验室"
    attempted[0]["trays"][0]["target_experiment_code"] = "EXP-SALT"

    response = client.put("/api/storage/mes.samples", json=attempted)

    assert response.status_code == 200
    assert storage.read("mes.samples")[0]["status"] == "实验前外观检测间存放"
    assert storage.read("mes.samples")[0]["trays"][0]["target_lab"] == "盐雾试验室"


def test_storage_allows_pre_experiment_appearance_stock_for_hot_humid_target_from_handover(monkeypatch):
    samples = [
        {
            "code": "SP-PRE-APPEARANCE-HOT-HUMID",
            "location": "接驳区",
            "status": "到货",
            "flow_status": "到货",
            "task_code": "TASK-PRE-APPEARANCE-HOT-HUMID",
            "trays": [{"tray_code": "TP-PRE-APPEARANCE-HOT-HUMID", "status": "到货", "quantity": 1}],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-PRE-APPEARANCE-HOT-HUMID",
                    "experiment_code": "EXP-HOT-HUMID",
                    "experiment_name": "高低温湿热试验",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "外观检测间"
    attempted[0]["status"] = "实验前外观检测间存放"
    attempted[0]["flow_status"] = "实验前外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验前外观检测间存放"
    attempted[0]["trays"][0]["target_lab"] = "高低温湿热一室"
    attempted[0]["trays"][0]["target_experiment_code"] = "EXP-HOT-HUMID"

    response = client.put("/api/storage/mes.samples", json=attempted)

    assert response.status_code == 200
    assert storage.read("mes.samples")[0]["status"] == "实验前外观检测间存放"
    assert storage.read("mes.samples")[0]["trays"][0]["target_lab"] == "高低温湿热一室"


def test_storage_allows_pre_experiment_appearance_stock_for_mold_target_after_lab_dispatch(monkeypatch):
    samples = [
        {
            "code": "SP-PRE-APPEARANCE-DISPATCHED",
            "location": "霉菌试验室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "TASK-PRE-APPEARANCE-DISPATCHED",
            "trays": [
                {
                    "tray_code": "TP-PRE-APPEARANCE-DISPATCHED",
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_lab": "霉菌试验室",
                    "target_experiment_code": "EXP-MOLD",
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-PRE-APPEARANCE-DISPATCHED",
                    "experiment_code": "EXP-MOLD",
                    "experiment_name": "霉菌试验",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "外观检测间"
    attempted[0]["status"] = "实验前外观检测间存放"
    attempted[0]["flow_status"] = "实验前外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验前外观检测间存放"

    response = client.put("/api/storage/mes.samples", json=attempted)

    assert response.status_code == 200
    assert storage.read("mes.samples")[0]["status"] == "实验前外观检测间存放"
    assert storage.read("mes.samples")[0]["trays"][0]["target_lab"] == "霉菌试验室"
    assert storage.read("mes.samples")[0]["trays"][0]["target_experiment_code"] == "EXP-MOLD"


def test_storage_allows_pre_experiment_appearance_stock_for_hot_humid_target_after_lab_dispatch(monkeypatch):
    samples = [
        {
            "code": "SP-PRE-APPEARANCE-HOT-HUMID-DISPATCHED",
            "location": "高低温湿热二室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "TASK-PRE-APPEARANCE-HOT-HUMID-DISPATCHED",
            "trays": [
                {
                    "tray_code": "TP-PRE-APPEARANCE-HOT-HUMID-DISPATCHED",
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_lab": "高低温湿热二室",
                    "target_experiment_code": "EXP-HOT-HUMID",
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-PRE-APPEARANCE-HOT-HUMID-DISPATCHED",
                    "experiment_code": "EXP-HOT-HUMID",
                    "experiment_name": "高低温湿热试验",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "外观检测间"
    attempted[0]["status"] = "实验前外观检测间存放"
    attempted[0]["flow_status"] = "实验前外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验前外观检测间存放"

    response = client.put("/api/storage/mes.samples", json=attempted)

    assert response.status_code == 200
    assert storage.read("mes.samples")[0]["status"] == "实验前外观检测间存放"
    assert storage.read("mes.samples")[0]["trays"][0]["target_lab"] == "高低温湿热二室"
    assert storage.read("mes.samples")[0]["trays"][0]["target_experiment_code"] == "EXP-HOT-HUMID"


def test_storage_rejects_repeat_pre_experiment_appearance_stock_after_appearance_dispatch(monkeypatch):
    samples = [
        {
            "code": "SP-PRE-APPEARANCE-REPEAT",
            "location": "盐雾试验室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "TASK-PRE-APPEARANCE-REPEAT",
            "trays": [
                {
                    "tray_code": "TP-PRE-APPEARANCE-REPEAT",
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_lab": "盐雾试验室",
                    "target_experiment_code": "EXP-SALT",
                }
            ],
            "history": [
                {
                    "action": "外观检测间扫码出库",
                    "detail": "TP-PRE-APPEARANCE-REPEAT 送至 盐雾试验室",
                    "location": "盐雾试验室",
                    "status": "送至实验室",
                    "time": "2026-06-06T21:50:00",
                },
                {
                    "action": "外观检测间扫码入库",
                    "detail": "TP-PRE-APPEARANCE-REPEAT 实验前外观检测间存放",
                    "location": "外观检测间",
                    "status": "实验前外观检测间存放",
                    "time": "2026-06-06T21:40:00",
                },
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-PRE-APPEARANCE-REPEAT",
                    "experiment_code": "EXP-SALT",
                    "experiment_name": "盐雾试验",
                }
            ],
            "mes.staging_events": [
                {
                    "id": "pre-appearance-in",
                    "tray_code": "TP-PRE-APPEARANCE-REPEAT",
                    "task_code": "TASK-PRE-APPEARANCE-REPEAT",
                    "room": "appearance",
                    "action": "stock_in",
                    "time": "2026-06-06T21:40:00",
                },
                {
                    "id": "pre-appearance-out",
                    "tray_code": "TP-PRE-APPEARANCE-REPEAT",
                    "task_code": "TASK-PRE-APPEARANCE-REPEAT",
                    "room": "appearance",
                    "action": "stock_out",
                    "target_lab": "盐雾试验室",
                    "target_experiment_code": "EXP-SALT",
                    "target_type": "lab",
                    "time": "2026-06-06T21:50:00",
                },
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "外观检测间"
    attempted[0]["status"] = "实验前外观检测间存放"
    attempted[0]["flow_status"] = "实验前外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验前外观检测间存放"

    response = client.put("/api/storage/mes.samples", json=attempted)

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已完成实验前外观检测并出库，不能重复入库外观检测间。"
    assert storage.read("mes.samples") == samples


def test_storage_allows_pre_experiment_appearance_stock_after_appearance_dispatch_withdrawn(monkeypatch):
    samples = [
        {
            "code": "SP-PRE-APPEARANCE-WITHDRAWN",
            "location": "盐雾试验室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "TASK-PRE-APPEARANCE-WITHDRAWN",
            "trays": [
                {
                    "tray_code": "TP-PRE-APPEARANCE-WITHDRAWN",
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_lab": "盐雾试验室",
                    "target_experiment_code": "EXP-SALT",
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-PRE-APPEARANCE-WITHDRAWN",
                    "experiment_code": "EXP-SALT",
                    "experiment_name": "盐雾试验",
                }
            ],
            "mes.staging_events": [
                {
                    "id": "pre-appearance-in",
                    "tray_code": "TP-PRE-APPEARANCE-WITHDRAWN",
                    "task_code": "TASK-PRE-APPEARANCE-WITHDRAWN",
                    "room": "appearance",
                    "action": "stock_in",
                    "time": "2026-06-06T21:40:00",
                },
                {
                    "id": "pre-appearance-out",
                    "tray_code": "TP-PRE-APPEARANCE-WITHDRAWN",
                    "task_code": "TASK-PRE-APPEARANCE-WITHDRAWN",
                    "room": "appearance",
                    "action": "stock_out",
                    "target_lab": "盐雾试验室",
                    "target_experiment_code": "EXP-SALT",
                    "target_type": "lab",
                    "time": "2026-06-06T21:50:00",
                },
                {
                    "id": "pre-appearance-withdraw",
                    "tray_code": "TP-PRE-APPEARANCE-WITHDRAWN",
                    "task_code": "TASK-PRE-APPEARANCE-WITHDRAWN",
                    "room": "appearance",
                    "action": "stock_out_withdraw",
                    "target_lab": "盐雾试验室",
                    "target_experiment_code": "EXP-SALT",
                    "time": "2026-06-06T21:55:00",
                },
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "外观检测间"
    attempted[0]["status"] = "实验前外观检测间存放"
    attempted[0]["flow_status"] = "实验前外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验前外观检测间存放"

    response = client.put("/api/storage/mes.samples", json=attempted)

    assert response.status_code == 200
    assert storage.read("mes.samples")[0]["status"] == "实验前外观检测间存放"
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "实验前外观检测间存放"


def test_storage_rejects_pre_experiment_appearance_stock_when_not_from_handover_or_staging(monkeypatch):
    samples = [
        {
            "code": "SP-PRE-APPEARANCE-WRONG-SOURCE",
            "location": "盐雾试验室",
            "status": "实验已完成",
            "flow_status": "实验已完成",
            "task_code": "TASK-PRE-APPEARANCE-WRONG-SOURCE",
            "trays": [{"tray_code": "TP-PRE-APPEARANCE-WRONG-SOURCE", "status": "实验已完成", "quantity": 1}],
            "history": [
                {
                    "action": "实验完成",
                    "detail": "TASK-PRE-APPEARANCE-WRONG-SOURCE / 盐雾试验 / 实验已完成",
                    "status": "实验已完成",
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-PRE-APPEARANCE-WRONG-SOURCE",
                    "experiment_code": "EXP-SALT",
                    "experiment_name": "盐雾试验",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "外观检测间"
    attempted[0]["status"] = "实验前外观检测间存放"
    attempted[0]["flow_status"] = "实验前外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验前外观检测间存放"
    attempted[0]["trays"][0]["target_lab"] = "盐雾试验室"
    attempted[0]["trays"][0]["target_experiment_code"] = "EXP-SALT"

    response = client.put("/api/storage/mes.samples", json=attempted)

    assert response.status_code == 400
    assert response.json()["detail"] == "当前试验类型不支持进入外观检测间。"
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


def test_storage_bulk_update_merges_stale_storage_room_snapshot_without_reverting_lab_progress(monkeypatch):
    current_samples = [
        {
            "code": "SP-LAB",
            "location": "盐雾试验室",
            "status": "已到达实验室",
            "flow_status": "已到达实验室",
            "task_code": "TASK-CONCURRENT",
            "updated_at": "2026-06-12 10:01:00",
            "trays": [
                {
                    "tray_code": "TP-A",
                    "status": "已到达实验室",
                    "quantity": 1,
                    "updated_at": "2026-06-12 10:01:00",
                }
            ],
        },
        {
            "code": "SP-STAGING",
            "location": "恒温恒湿间（暂存间）",
            "status": "送至暂存间",
            "flow_status": "送至暂存间",
            "task_code": "TASK-CONCURRENT",
            "updated_at": "2026-06-12 10:00:00",
            "trays": [
                {
                    "tray_code": "TP-B",
                    "status": "送至暂存间",
                    "quantity": 1,
                    "updated_at": "2026-06-12 10:00:00",
                }
            ],
        },
    ]
    current_events = [
        {"id": "event-existing", "tray_code": "TP-A", "task_code": "TASK-CONCURRENT", "action": "stock_out", "time": "2026-06-12 10:00:30"}
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": current_samples,
            "mes.staging_events": current_events,
        },
    )

    stale_storage_room_samples = [
        {
            **deepcopy(current_samples[0]),
            "location": "盐雾试验室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "updated_at": "2026-06-12 10:00:00",
            "trays": [
                {
                    **deepcopy(current_samples[0]["trays"][0]),
                    "status": "送至实验室",
                    "updated_at": "2026-06-12 10:00:00",
                }
            ],
        },
        {
            **deepcopy(current_samples[1]),
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "updated_at": "2026-06-12 10:02:00",
            "trays": [
                {
                    **deepcopy(current_samples[1]["trays"][0]),
                    "status": "已到达暂存间",
                    "updated_at": "2026-06-12 10:02:00",
                }
            ],
        },
    ]
    stale_storage_room_events = [
        {"id": "event-new", "tray_code": "TP-B", "task_code": "TASK-CONCURRENT", "action": "stock_in", "time": "2026-06-12 10:02:00"}
    ]

    response = client.put(
        "/api/storage",
        json={
            "mes.samples": stale_storage_room_samples,
            "mes.staging_events": stale_storage_room_events,
        },
    )

    assert response.status_code == 200
    samples = {sample["code"]: sample for sample in storage.read("mes.samples")}
    assert samples["SP-LAB"]["status"] == "已到达实验室"
    assert samples["SP-LAB"]["trays"][0]["status"] == "已到达实验室"
    assert samples["SP-STAGING"]["status"] == "已到达暂存间"
    assert samples["SP-STAGING"]["trays"][0]["status"] == "已到达暂存间"
    event_ids = [event["id"] for event in storage.read("mes.staging_events")]
    assert event_ids == ["event-existing", "event-new"]


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


def test_storage_handover_arrival_statuses_exclude_legacy_stored_status():
    from app.api.routes import storage as storage_route

    assert storage_route.HANDOVER_ARRIVAL_STATUSES == {"到货"}


def test_storage_allows_legacy_stored_status_after_manufacturer_return_without_rearrival_block(monkeypatch):
    samples = [
        {
            "code": "SP-RETURNED-LEGACY-STORED",
            "location": "厂家收回",
            "status": "厂家收回",
            "flow_status": "厂家收回",
            "task_code": "SYLU-2026-05-708",
            "trays": [{"tray_code": "TP-RETURNED-LEGACY-STORED", "status": "厂家收回", "quantity": 1}],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    attempted = deepcopy(samples)
    attempted[0]["location"] = "接驳区"
    attempted[0]["status"] = "已入库"
    attempted[0]["flow_status"] = "已入库"
    attempted[0]["trays"][0]["status"] = "已入库"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


def test_storage_rejects_post_staging_stock_in_when_tray_has_unfinished_experiments(monkeypatch):
    samples = [
        {
            "code": "SYLU-2026-06-025-SP-001",
            "location": "盐雾试验室",
            "status": "实验已完成",
            "flow_status": "实验已完成",
            "task_code": "SYLU-2026-06-025",
            "trays": [{"tray_code": "SYLU-2026-06-025-TP-001", "status": "实验已完成", "quantity": 1}],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiment_trays": [
                {
                    "task_code": "SYLU-2026-06-025",
                    "experiment_code": "SYLU-2026-06-025-A",
                    "tray_code": "SYLU-2026-06-025-TP-001",
                },
                {
                    "task_code": "SYLU-2026-06-025",
                    "experiment_code": "SYLU-2026-06-025-B",
                    "tray_code": "SYLU-2026-06-025-TP-001",
                },
            ],
            "mes.experiment_run_trays": [
                {
                    "task_code": "SYLU-2026-06-025",
                    "experiment_code": "SYLU-2026-06-025-A",
                    "tray_code": "SYLU-2026-06-025-TP-001",
                    "run_tray_status": "实验已完成",
                },
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（实验后暂存间）"
    attempted[0]["status"] = "实验后暂存间存放"
    attempted[0]["flow_status"] = "实验后暂存间存放"
    attempted[0]["trays"][0]["status"] = "实验后暂存间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已进入试验间流程，不能暂存间入库。"
    assert storage.read("mes.samples") == samples


def test_storage_rejects_appearance_stock_in_when_tray_is_in_post_staging(monkeypatch):
    samples = [
        {
            "code": "SP-POST-STAGING-APPEARANCE-BLOCKED",
            "location": "恒温恒湿间（实验后暂存间）",
            "status": "实验后暂存间存放",
            "flow_status": "实验后暂存间存放",
            "task_code": "TASK-POST-STAGING-APPEARANCE-BLOCKED",
            "trays": [
                {
                    "tray_code": "TP-POST-STAGING-APPEARANCE-BLOCKED",
                    "status": "实验后暂存间存放",
                    "quantity": 1,
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-POST-STAGING-APPEARANCE-BLOCKED",
                    "experiment_code": "EXP-POST-STAGING-SALT",
                    "experiment_name": "盐雾试验",
                }
            ],
            "mes.experiment_run_trays": [
                {
                    "task_code": "TASK-POST-STAGING-APPEARANCE-BLOCKED",
                    "experiment_code": "EXP-POST-STAGING-SALT",
                    "tray_code": "TP-POST-STAGING-APPEARANCE-BLOCKED",
                    "run_tray_status": "实验已完成",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "外观检测间"
    attempted[0]["status"] = "实验后外观检测间存放"
    attempted[0]["flow_status"] = "实验后外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验后外观检测间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已进入试验间流程，不能外观检测间入库。"
    assert storage.read("mes.samples") == samples


def test_storage_rejects_post_staging_stock_in_when_tray_is_in_appearance_room(monkeypatch):
    samples = [
        {
            "code": "SP-APPEARANCE-STAGING-BLOCKED",
            "location": "外观检测间",
            "status": "实验后外观检测间存放",
            "flow_status": "实验后外观检测间存放",
            "task_code": "TASK-APPEARANCE-STAGING-BLOCKED",
            "trays": [
                {
                    "tray_code": "TP-APPEARANCE-STAGING-BLOCKED",
                    "status": "实验后外观检测间存放",
                    "quantity": 1,
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
                    "task_code": "TASK-APPEARANCE-STAGING-BLOCKED",
                    "experiment_code": "EXP-APPEARANCE-SALT",
                    "tray_code": "TP-APPEARANCE-STAGING-BLOCKED",
                }
            ],
            "mes.experiment_run_trays": [
                {
                    "task_code": "TASK-APPEARANCE-STAGING-BLOCKED",
                    "experiment_code": "EXP-APPEARANCE-SALT",
                    "tray_code": "TP-APPEARANCE-STAGING-BLOCKED",
                    "run_tray_status": "实验已完成",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（实验后暂存间）"
    attempted[0]["status"] = "实验后暂存间存放"
    attempted[0]["flow_status"] = "实验后暂存间存放"
    attempted[0]["trays"][0]["status"] = "实验后暂存间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已进入试验间流程，不能暂存间入库。"
    assert storage.read("mes.samples") == samples


def test_storage_allows_completed_appearance_dispatch_to_post_staging(monkeypatch):
    samples = [
        {
            "code": "SYLU-2026-06-025-SP-001",
            "location": "外观检测间",
            "status": "实验后外观检测间存放",
            "flow_status": "实验后外观检测间存放",
            "task_code": "SYLU-2026-06-025",
            "trays": [
                {
                    "tray_code": "SYLU-2026-06-025-TP-001",
                    "status": "实验后外观检测间存放",
                    "quantity": 1,
                    "target_lab": "盐雾试验室",
                    "target_experiment_code": "SYLU-2026-06-025-B",
                }
            ],
        }
    ]
    staging_events = [
        {
            "id": "appearance-stock-in",
            "tray_code": "SYLU-2026-06-025-TP-001",
            "task_code": "SYLU-2026-06-025",
            "room": "appearance",
            "action": "stock_in",
            "time": "2026-06-15 15:40:18",
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.staging_events": staging_events,
            "mes.experiment_trays": [
                {
                    "task_code": "SYLU-2026-06-025",
                    "experiment_code": "SYLU-2026-06-025-A",
                    "tray_code": "SYLU-2026-06-025-TP-001",
                },
                {
                    "task_code": "SYLU-2026-06-025",
                    "experiment_code": "SYLU-2026-06-025-B",
                    "tray_code": "SYLU-2026-06-025-TP-001",
                },
            ],
            "mes.experiment_run_trays": [
                {
                    "task_code": "SYLU-2026-06-025",
                    "experiment_code": "SYLU-2026-06-025-A",
                    "tray_code": "SYLU-2026-06-025-TP-001",
                    "run_tray_status": "实验已完成",
                },
                {
                    "task_code": "SYLU-2026-06-025",
                    "experiment_code": "SYLU-2026-06-025-B",
                    "tray_code": "SYLU-2026-06-025-TP-001",
                    "run_tray_status": "实验已完成",
                },
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（暂存间）"
    attempted[0]["status"] = "送至暂存间"
    attempted[0]["flow_status"] = "送至暂存间"
    attempted[0]["trays"][0]["status"] = "送至暂存间"
    attempted[0]["trays"][0]["target_lab"] = "恒温恒湿间（暂存间）"
    attempted[0]["trays"][0]["target_experiment_code"] = ""
    attempted[0]["trays"][0]["target_type"] = "staging"
    next_events = [
        *staging_events,
        {
            "id": "appearance-stock-out-to-staging",
            "tray_code": "SYLU-2026-06-025-TP-001",
            "task_code": "SYLU-2026-06-025",
            "room": "appearance",
            "action": "stock_out",
            "target_lab": "恒温恒湿间（暂存间）",
            "target_type": "staging",
            "time": "2026-06-15 16:05:00",
        },
    ]

    response = client.put("/api/storage", json={"mes.samples": attempted, "mes.staging_events": next_events})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted
    assert storage.read("mes.staging_events")[-1]["id"] == "appearance-stock-out-to-staging"


def test_storage_rejects_pre_appearance_dispatch_to_non_whitelist_lab(monkeypatch):
    samples = [
        {
            "code": "SYLU-2026-06-026-SP-001",
            "location": "外观检测间",
            "status": "实验前外观检测间存放",
            "flow_status": "实验前外观检测间存放",
            "task_code": "SYLU-2026-06-026",
            "trays": [
                {
                    "tray_code": "SYLU-2026-06-026-TP-001",
                    "status": "实验前外观检测间存放",
                    "quantity": 1,
                }
            ],
        }
    ]
    staging_events = [
        {
            "id": "appearance-stock-in",
            "tray_code": "SYLU-2026-06-026-TP-001",
            "task_code": "SYLU-2026-06-026",
            "room": "appearance",
            "action": "stock_in",
            "time": "2026-06-15 15:40:18",
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.staging_events": staging_events,
            "mes.experiments": [
                {
                    "task_code": "SYLU-2026-06-026",
                    "experiment_code": "SYLU-2026-06-026-A",
                    "experiment_name": "振动试验",
                    "required_device": "振动一室",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "振动一室"
    attempted[0]["status"] = "送至实验室"
    attempted[0]["flow_status"] = "送至实验室"
    attempted[0]["trays"][0]["status"] = "送至实验室"
    attempted[0]["trays"][0]["target_lab"] = "振动一室"
    attempted[0]["trays"][0]["target_experiment_code"] = "SYLU-2026-06-026-A"
    next_events = [
        *staging_events,
        {
            "id": "appearance-stock-out-to-vibration",
            "tray_code": "SYLU-2026-06-026-TP-001",
            "task_code": "SYLU-2026-06-026",
            "room": "appearance",
            "action": "stock_out",
            "target_lab": "振动一室",
            "target_experiment_code": "SYLU-2026-06-026-A",
            "target_type": "lab",
            "time": "2026-06-15 16:05:00",
        },
    ]

    response = client.put("/api/storage", json={"mes.samples": attempted, "mes.staging_events": next_events})

    assert response.status_code == 400
    assert response.json()["detail"] == "目标实验室与当前托盘不匹配"
    assert storage.read("mes.samples") == samples


def test_storage_allows_post_appearance_dispatch_to_scheduled_non_whitelist_lab(monkeypatch):
    samples = [
        {
            "code": "SYLU-2026-06-027-SP-001",
            "location": "外观检测间",
            "status": "实验后外观检测间存放",
            "flow_status": "实验后外观检测间存放",
            "task_code": "SYLU-2026-06-027",
            "trays": [
                {
                    "tray_code": "SYLU-2026-06-027-TP-001",
                    "status": "实验后外观检测间存放",
                    "quantity": 1,
                    "target_lab": "霉菌试验室",
                    "target_experiment_code": "SYLU-2026-06-027-B",
                }
            ],
        }
    ]
    staging_events = [
        {
            "id": "appearance-stock-in",
            "tray_code": "SYLU-2026-06-027-TP-001",
            "task_code": "SYLU-2026-06-027",
            "room": "appearance",
            "action": "stock_in",
            "time": "2026-06-15 15:40:18",
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.staging_events": staging_events,
            "mes.experiments": [
                {
                    "task_code": "SYLU-2026-06-027",
                    "experiment_code": "SYLU-2026-06-027-A",
                    "experiment_name": "冲击试验",
                    "required_device": "冲击一室",
                    "status": "已排程",
                },
                {
                    "task_code": "SYLU-2026-06-027",
                    "experiment_code": "SYLU-2026-06-027-B",
                    "experiment_name": "霉菌试验",
                    "required_device": "霉菌试验室",
                    "status": "实验已完成",
                },
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "冲击一室"
    attempted[0]["status"] = "送至实验室"
    attempted[0]["flow_status"] = "送至实验室"
    attempted[0]["trays"][0]["status"] = "送至实验室"
    attempted[0]["trays"][0]["target_lab"] = "冲击一室"
    attempted[0]["trays"][0]["target_experiment_code"] = "SYLU-2026-06-027-A"
    next_events = [
        *staging_events,
        {
            "id": "appearance-stock-out-to-impact",
            "tray_code": "SYLU-2026-06-027-TP-001",
            "task_code": "SYLU-2026-06-027",
            "room": "appearance",
            "action": "stock_out",
            "target_lab": "冲击一室",
            "target_experiment_code": "SYLU-2026-06-027-A",
            "target_type": "lab",
            "time": "2026-06-15 16:05:00",
        },
    ]

    response = client.put("/api/storage", json={"mes.samples": attempted, "mes.staging_events": next_events})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted
    assert storage.read("mes.staging_events")[-1]["target_lab"] == "冲击一室"


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
    monkeypatch.setattr(storage_route, "publish_storage_update", lambda keys, **kwargs: published.append((keys, kwargs)))

    response = client.put("/api/storage", json={"mes.samples": [{"code": "SP-1"}], "mes.tasks": [{"code": "T-1"}]})

    assert response.status_code == 200
    assert storage.read("mes.samples") == [{"code": "SP-1"}]
    assert published == [(["mes.samples", "mes.tasks"], {})]


def test_storage_bulk_update_publishes_source_metadata(monkeypatch):
    from app.api.routes import storage as storage_route

    published = []
    client, _storage = build_client(monkeypatch)
    monkeypatch.setattr(storage_route, "publish_storage_update", lambda keys, **kwargs: published.append((keys, kwargs)))

    response = client.put(
        "/api/storage",
        json={"mes.samples": [{"code": "SP-1"}]},
        headers={
            "X-MES-Update-Source": "staging-management",
            "X-MES-Update-Request-Id": "write-1",
        },
    )

    assert response.status_code == 200
    assert published == [(["mes.samples"], {"source": "staging-management", "request_id": "write-1"})]


def test_storage_bulk_sample_update_reuses_read_all_snapshot_for_validation(monkeypatch):
    samples = [
        {
            "code": "SP-BULK-READ-COUNT",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-BULK-READ-COUNT",
            "trays": [{"tray_code": "TP-BULK-READ-COUNT", "status": "已到达暂存间", "quantity": 1}],
        },
    ]
    storage = CountingStorage({
        "mes.samples": samples,
        "mes.staging_events": [],
        "mes.experiments": [],
        "mes.experiment_runs": [],
        "mes.experiment_run_steps": [],
        "mes.experiment_trays": [],
        "mes.experiment_run_trays": [],
        "mes.schedules": [],
        "mes.devices": [],
    })
    client, storage = build_client_with_storage(monkeypatch, storage)

    response = client.put("/api/storage", json={"mes.samples": samples})

    assert response.status_code == 200
    assert storage.read_all_count == 1
    assert storage.read_calls == []


def test_storage_tray_stock_out_action_updates_only_target_tray_and_publishes_metadata(monkeypatch):
    from app.api.routes import storage as storage_route

    published = []
    samples = [
        {
            "code": "SP-STAGING-A",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-STAGING-A",
            "trays": [{"tray_code": "TP-STAGING-A", "status": "已到达暂存间", "quantity": 1}],
        },
        {
            "code": "SP-STAGING-B",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-STAGING-B",
            "trays": [{"tray_code": "TP-STAGING-B", "status": "已到达暂存间", "quantity": 1}],
        },
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples, "mes.staging_events": []})
    monkeypatch.setattr(storage_route, "publish_storage_update", lambda keys, **kwargs: published.append((keys, kwargs)))

    response = client.post(
        "/api/storage/rooms/staging/trays/TP-STAGING-A/stock-out",
        json={
            "targetLab": "冲击一室",
            "targetLabCode": "LAB_IMPACT_1",
            "targetExperimentCode": "TASK-STAGING-A-A",
            "targetExperimentName": "冲击试验",
            "targetType": "lab",
        },
        headers={
            "X-MES-Update-Source": "staging-management",
            "X-MES-Update-Request-Id": "tray-write-1",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["trayCode"] == "TP-STAGING-A"
    assert payload["updatedKeys"] == ["mes.samples", "mes.staging_events"]
    updated_samples = {sample["code"]: sample for sample in storage.read("mes.samples")}
    assert updated_samples["SP-STAGING-A"]["location"] == "冲击一室"
    assert updated_samples["SP-STAGING-A"]["status"] == "送至实验室"
    assert updated_samples["SP-STAGING-A"]["trays"][0]["status"] == "送至实验室"
    assert updated_samples["SP-STAGING-A"]["trays"][0]["target_lab"] == "冲击一室"
    assert updated_samples["SP-STAGING-B"] == samples[1]
    events = storage.read("mes.staging_events")
    assert events[-1]["action"] == "stock_out"
    assert events[-1]["target_lab"] == "冲击一室"
    assert published == [
        (
            ["mes.samples", "mes.staging_events"],
            {"source": "staging-management", "request_id": "tray-write-1"},
        )
    ]


def test_storage_tray_action_validates_against_single_loaded_snapshot(monkeypatch):
    from app.api.routes import storage as storage_route

    samples = [
        {
            "code": "SP-READ-COUNT",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-READ-COUNT",
            "trays": [{"tray_code": "TP-READ-COUNT", "status": "已到达暂存间", "quantity": 1}],
        },
    ]
    storage = CountingStorage({
        "mes.samples": samples,
        "mes.staging_events": [],
        "mes.experiments": [],
        "mes.experiment_runs": [],
        "mes.experiment_run_steps": [],
        "mes.experiment_trays": [],
        "mes.experiment_run_trays": [],
        "mes.schedules": [],
        "mes.devices": [],
    })
    client, storage = build_client_with_storage(monkeypatch, storage)
    monkeypatch.setattr(storage_route, "publish_storage_update", lambda keys, **kwargs: None)

    response = client.post(
        "/api/storage/rooms/staging/trays/TP-READ-COUNT/stock-out",
        json={
            "targetLab": "冲击一室",
            "targetLabCode": "LAB_IMPACT_1",
            "targetExperimentCode": "TASK-READ-COUNT-A",
            "targetExperimentName": "冲击试验",
            "targetType": "lab",
        },
    )

    assert response.status_code == 200
    assert storage.read_all_count == 1
    assert storage.read_calls == []


def test_storage_tray_stock_in_action_updates_only_target_tray(monkeypatch):
    samples = [
        {
            "code": "SP-IN-A",
            "location": "恒温恒湿间（暂存间）",
            "status": "送至暂存间",
            "flow_status": "送至暂存间",
            "task_code": "TASK-IN-A",
            "trays": [{"tray_code": "TP-IN-A", "status": "送至暂存间", "quantity": 1}],
        },
        {
            "code": "SP-IN-B",
            "location": "恒温恒湿间（暂存间）",
            "status": "送至暂存间",
            "flow_status": "送至暂存间",
            "task_code": "TASK-IN-B",
            "trays": [{"tray_code": "TP-IN-B", "status": "送至暂存间", "quantity": 1}],
        },
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples, "mes.staging_events": []})

    response = client.post("/api/storage/rooms/staging/trays/TP-IN-A/stock-in", json={})

    assert response.status_code == 200
    updated_samples = {sample["code"]: sample for sample in storage.read("mes.samples")}
    assert updated_samples["SP-IN-A"]["status"] == "已到达暂存间"
    assert updated_samples["SP-IN-A"]["location"] == "恒温恒湿间（暂存间）"
    assert updated_samples["SP-IN-A"]["trays"][0]["status"] == "已到达暂存间"
    assert updated_samples["SP-IN-B"] == samples[1]
    assert storage.read("mes.staging_events")[-1]["action"] == "stock_in"


def test_storage_tray_stock_in_action_allows_partial_axis_completion(monkeypatch):
    samples = [
        {
            "code": "SP-IN-PARTIAL-AXIS",
            "location": "冲击一室",
            "status": "冲击试验部分完成 3/6轴",
            "flow_status": "冲击试验部分完成 3/6轴",
            "task_code": "TASK-IN-PARTIAL-AXIS",
            "trays": [
                {
                    "tray_code": "TP-IN-PARTIAL-AXIS",
                    "status": "冲击试验部分完成 3/6轴",
                    "quantity": 1,
                    "target_experiment_code": "TASK-IN-PARTIAL-AXIS-B",
                    "target_lab": "冲击一室",
                }
            ],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples, "mes.staging_events": []})

    response = client.post("/api/storage/rooms/staging/trays/TP-IN-PARTIAL-AXIS/stock-in", json={})

    assert response.status_code == 200
    updated = storage.read("mes.samples")[0]
    assert updated["location"] == "恒温恒湿间（暂存间）"
    assert updated["status"] == "已到达暂存间"
    assert updated["flow_status"] == "已到达暂存间"
    assert updated["trays"][0]["status"] == "已到达暂存间"
    assert updated["history"][0]["action"] == "暂存间扫码入库"
    assert storage.read("mes.staging_events")[-1]["action"] == "stock_in"


def test_storage_tray_stock_in_action_allows_completed_tray_to_post_experiment_staging(monkeypatch):
    samples = [
        {
            "code": "SP-IN-COMPLETED",
            "location": "振动一室",
            "status": "实验已完成",
            "flow_status": "实验已完成",
            "task_code": "TASK-IN-COMPLETED",
            "trays": [
                {
                    "tray_code": "TP-IN-COMPLETED",
                    "status": "实验已完成",
                    "quantity": 1,
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-IN-COMPLETED",
                    "experiment_code": "TASK-IN-COMPLETED-A",
                    "experiment_name": "振动试验",
                    "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
                }
            ],
            "mes.experiment_trays": [
                {
                    "task_code": "TASK-IN-COMPLETED",
                    "experiment_code": "TASK-IN-COMPLETED-A",
                    "tray_code": "TP-IN-COMPLETED",
                }
            ],
            "mes.schedules": [
                {
                    "task_code": "TASK-IN-COMPLETED",
                    "experiment_code": "TASK-IN-COMPLETED-A",
                    "sub_experiment_code": "TASK-IN-COMPLETED-A-AXIS-001",
                    "axis_codes": ["x+", "x-", "y+"],
                    "status": "实验已完成",
                },
                {
                    "task_code": "TASK-IN-COMPLETED",
                    "experiment_code": "TASK-IN-COMPLETED-A",
                    "sub_experiment_code": "TASK-IN-COMPLETED-A-AXIS-002",
                    "axis_codes": ["y-", "z+", "z-"],
                    "status": "实验已完成",
                },
            ],
            "mes.experiment_run_trays": [
                {
                    "task_code": "TASK-IN-COMPLETED",
                    "experiment_code": "TASK-IN-COMPLETED-A",
                    "sub_experiment_code": "TASK-IN-COMPLETED-A-AXIS-001",
                    "tray_code": "TP-IN-COMPLETED",
                    "run_tray_status": "实验已完成",
                },
                {
                    "task_code": "TASK-IN-COMPLETED",
                    "experiment_code": "TASK-IN-COMPLETED-A",
                    "sub_experiment_code": "TASK-IN-COMPLETED-A-AXIS-002",
                    "tray_code": "TP-IN-COMPLETED",
                    "run_tray_status": "实验已完成",
                }
            ],
            "mes.staging_events": [],
        },
    )

    response = client.post(
        "/api/storage/rooms/staging/trays/TP-IN-COMPLETED/stock-in",
        json={"status": "实验后暂存间存放", "location": "恒温恒湿间（实验后暂存间）"},
    )

    assert response.status_code == 200
    updated = storage.read("mes.samples")[0]
    assert updated["location"] == "恒温恒湿间（实验后暂存间）"
    assert updated["status"] == "实验后暂存间存放"
    assert updated["flow_status"] == "实验后暂存间存放"
    assert updated["trays"][0]["status"] == "实验后暂存间存放"
    assert updated["history"][0]["action"] == "暂存间扫码入库"
    assert storage.read("mes.staging_events")[-1]["room"] == "staging"
    assert storage.read("mes.staging_events")[-1]["action"] == "stock_in"


def test_storage_tray_stock_in_action_allows_dispatched_pre_experiment_appearance(monkeypatch):
    samples = [
        {
            "code": "SP-PRE-APPEARANCE-ACTION",
            "location": "霉菌试验室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "TASK-PRE-APPEARANCE-ACTION",
            "trays": [
                {
                    "tray_code": "TP-PRE-APPEARANCE-ACTION",
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_lab": "霉菌试验室",
                    "target_experiment_code": "EXP-MOLD",
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-PRE-APPEARANCE-ACTION",
                    "experiment_code": "EXP-MOLD",
                    "experiment_name": "霉菌试验",
                }
            ],
            "mes.staging_events": [],
        },
    )

    response = client.post(
        "/api/storage/rooms/appearance/trays/TP-PRE-APPEARANCE-ACTION/stock-in",
        json={"status": "实验前外观检测间存放", "location": "外观检测间"},
    )

    assert response.status_code == 200
    updated = storage.read("mes.samples")[0]
    assert updated["location"] == "外观检测间"
    assert updated["status"] == "实验前外观检测间存放"
    assert updated["flow_status"] == "实验前外观检测间存放"
    assert updated["trays"][0]["status"] == "实验前外观检测间存放"
    assert updated["trays"][0]["target_lab"] == "霉菌试验室"
    assert updated["trays"][0]["target_experiment_code"] == "EXP-MOLD"
    assert updated["history"][0]["action"] == "外观检测间扫码入库"
    assert storage.read("mes.staging_events")[-1]["room"] == "appearance"
    assert storage.read("mes.staging_events")[-1]["action"] == "stock_in"


def test_storage_tray_stock_in_action_allows_completed_appearance_required_experiment(monkeypatch):
    samples = [
        {
            "code": "SP-POST-APPEARANCE-ACTION",
            "location": "盐雾试验室",
            "status": "实验已完成",
            "flow_status": "实验已完成",
            "task_code": "TASK-POST-APPEARANCE-ACTION",
            "trays": [
                {
                    "tray_code": "TP-POST-APPEARANCE-ACTION",
                    "status": "实验已完成",
                    "quantity": 1,
                }
            ],
            "history": [
                {
                    "detail": "TASK-POST-APPEARANCE-ACTION / 盐雾试验 / 实验已完成",
                    "location": "盐雾试验室",
                    "status": "实验已完成",
                    "time": "2026-07-01 16:03:01",
                },
                {
                    "detail": "TP-POST-APPEARANCE-ACTION 实验前外观检测间存放",
                    "location": "外观检测间",
                    "status": "实验前外观检测间存放",
                    "time": "2026-07-01 16:02:34",
                },
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "TASK-POST-APPEARANCE-ACTION",
                    "experiment_code": "EXP-MOLD",
                    "experiment_name": "霉菌试验",
                },
                {
                    "task_code": "TASK-POST-APPEARANCE-ACTION",
                    "experiment_code": "EXP-SALT",
                    "experiment_name": "盐雾试验",
                },
            ],
            "mes.experiment_trays": [
                {
                    "task_code": "TASK-POST-APPEARANCE-ACTION",
                    "experiment_code": "EXP-MOLD",
                    "tray_code": "TP-POST-APPEARANCE-ACTION",
                },
                {
                    "task_code": "TASK-POST-APPEARANCE-ACTION",
                    "experiment_code": "EXP-SALT",
                    "tray_code": "TP-POST-APPEARANCE-ACTION",
                },
            ],
            "mes.experiment_run_trays": [
                {
                    "task_code": "TASK-POST-APPEARANCE-ACTION",
                    "experiment_code": "EXP-SALT",
                    "tray_code": "TP-POST-APPEARANCE-ACTION",
                    "run_tray_status": "实验已完成",
                }
            ],
            "mes.staging_events": [
                {
                    "id": "pre-appearance-in",
                    "tray_code": "TP-POST-APPEARANCE-ACTION",
                    "task_code": "TASK-POST-APPEARANCE-ACTION",
                    "room": "appearance",
                    "action": "stock_in",
                    "time": "2026-07-01 16:02:34",
                },
                {
                    "id": "pre-appearance-out",
                    "tray_code": "TP-POST-APPEARANCE-ACTION",
                    "task_code": "TASK-POST-APPEARANCE-ACTION",
                    "room": "appearance",
                    "action": "stock_out",
                    "target_experiment_code": "EXP-SALT",
                    "target_experiment_name": "盐雾试验",
                    "target_lab": "盐雾试验室",
                    "target_type": "lab",
                    "time": "2026-07-01 16:02:43",
                },
            ],
        },
    )

    response = client.post(
        "/api/storage/rooms/appearance/trays/TP-POST-APPEARANCE-ACTION/stock-in",
        json={"status": "实验后外观检测间存放", "location": "外观检测间"},
    )

    assert response.status_code == 200
    updated = storage.read("mes.samples")[0]
    assert updated["location"] == "外观检测间"
    assert updated["status"] == "实验后外观检测间存放"
    assert updated["flow_status"] == "实验后外观检测间存放"
    assert updated["trays"][0]["status"] == "实验后外观检测间存放"
    assert updated["history"][0]["action"] == "外观检测间扫码入库"
    assert storage.read("mes.staging_events")[-1]["room"] == "appearance"
    assert storage.read("mes.staging_events")[-1]["action"] == "stock_in"


def test_storage_tray_stock_in_action_rejects_repeat_operation_from_latest_state(monkeypatch):
    samples = [
        {
            "code": "SP-IN-REPEAT",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-IN-REPEAT",
            "trays": [{"tray_code": "TP-IN-REPEAT", "status": "已到达暂存间", "quantity": 1}],
        }
    ]
    client, _storage = build_client(monkeypatch, {"mes.samples": samples, "mes.staging_events": []})

    response = client.post("/api/storage/rooms/staging/trays/TP-IN-REPEAT/stock-in", json={})

    assert response.status_code == 409
    assert response.json()["detail"] == "该托盘已完成暂存间扫码入库。"


def test_storage_tray_stock_out_action_rejects_repeat_operation_from_latest_state(monkeypatch):
    samples = [
        {
            "code": "SP-STAGING-REPEAT",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-STAGING-REPEAT",
            "trays": [{"tray_code": "TP-STAGING-REPEAT", "status": "已到达暂存间", "quantity": 1}],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples, "mes.staging_events": []})
    payload = {
        "targetLab": "冲击一室",
        "targetExperimentCode": "TASK-STAGING-REPEAT-A",
        "targetType": "lab",
    }

    first = client.post("/api/storage/rooms/staging/trays/TP-STAGING-REPEAT/stock-out", json=payload)
    second = client.post("/api/storage/rooms/staging/trays/TP-STAGING-REPEAT/stock-out", json=payload)

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["detail"] == "该托盘尚未完成暂存间扫码入库。"
    assert [event["action"] for event in storage.read("mes.staging_events")] == ["stock_out"]


def test_storage_tray_manufacturer_return_action_is_local_to_selected_tray(monkeypatch):
    samples = [
        {
            "code": "SP-RETURN-A",
            "location": "恒温恒湿间（实验后暂存间）",
            "status": "实验后暂存间存放",
            "flow_status": "实验后暂存间存放",
            "task_code": "TASK-RETURN",
            "trays": [{"tray_code": "TP-RETURN-A", "status": "实验后暂存间存放", "quantity": 1}],
        },
        {
            "code": "SP-RETURN-B",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-RETURN",
            "trays": [{"tray_code": "TP-RETURN-B", "status": "已到达暂存间", "quantity": 1}],
        },
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.tasks": [{"code": "TASK-RETURN", "transfer_status": "任务进行中"}],
            "mes.staging_events": [],
        },
    )

    response = client.post("/api/storage/rooms/staging/trays/TP-RETURN-A/manufacturer-return", json={})

    assert response.status_code == 200
    updated_samples = {sample["code"]: sample for sample in storage.read("mes.samples")}
    assert updated_samples["SP-RETURN-A"]["status"] == "厂家收回"
    assert updated_samples["SP-RETURN-A"]["location"] == "厂家收回"
    assert updated_samples["SP-RETURN-A"]["trays"][0]["status"] == "厂家收回"
    assert updated_samples["SP-RETURN-B"] == samples[1]
    assert storage.read("mes.tasks")[0]["transfer_status"] == "任务进行中"
    assert storage.read("mes.staging_events")[-1]["action"] == "manufacturer_return"


def test_storage_tray_actions_serialize_same_tray_stock_out_conflict(monkeypatch):
    samples = [
        {
            "code": "SP-CONCURRENT",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-CONCURRENT",
            "trays": [{"tray_code": "TP-CONCURRENT", "status": "已到达暂存间", "quantity": 1}],
        }
    ]
    storage = DelayedThreadSafeStorage({"mes.samples": samples, "mes.staging_events": []})
    client, storage = build_client_with_storage(monkeypatch, storage)
    responses = []

    def stock_out():
        responses.append(
            client.post(
                "/api/storage/rooms/staging/trays/TP-CONCURRENT/stock-out",
                json={"targetLab": "冲击一室", "targetExperimentCode": "TASK-CONCURRENT-A", "targetType": "lab"},
            )
        )

    threads = [threading.Thread(target=stock_out), threading.Thread(target=stock_out)]
    threads[0].start()
    assert storage.first_write_waiting.wait(2)
    threads[1].start()
    storage.release_first_write.set()
    for thread in threads:
        thread.join(2)

    assert all(not thread.is_alive() for thread in threads)
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert [event["action"] for event in storage.read("mes.staging_events")] == ["stock_out"]
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "送至实验室"


def test_storage_tray_actions_keep_distinct_tray_updates_when_requests_overlap(monkeypatch):
    samples = [
        {
            "code": "SP-CONCURRENT-A",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-CONCURRENT-A",
            "trays": [{"tray_code": "TP-CONCURRENT-A", "status": "已到达暂存间", "quantity": 1}],
        },
        {
            "code": "SP-CONCURRENT-B",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-CONCURRENT-B",
            "trays": [{"tray_code": "TP-CONCURRENT-B", "status": "已到达暂存间", "quantity": 1}],
        },
    ]
    storage = DelayedThreadSafeStorage({"mes.samples": samples, "mes.staging_events": []})
    client, storage = build_client_with_storage(monkeypatch, storage)
    responses = {}

    def stock_out():
        responses["stock_out"] = client.post(
            "/api/storage/rooms/staging/trays/TP-CONCURRENT-A/stock-out",
            json={"targetLab": "冲击一室", "targetExperimentCode": "TASK-CONCURRENT-A-A", "targetType": "lab"},
        )

    def manufacturer_return():
        responses["manufacturer_return"] = client.post(
            "/api/storage/rooms/staging/trays/TP-CONCURRENT-B/manufacturer-return",
            json={},
        )

    first = threading.Thread(target=stock_out)
    second = threading.Thread(target=manufacturer_return)
    first.start()
    assert storage.first_write_waiting.wait(2)
    second.start()
    storage.release_first_write.set()
    first.join(2)
    second.join(2)

    assert not first.is_alive()
    assert not second.is_alive()
    assert responses["stock_out"].status_code == 200
    assert responses["manufacturer_return"].status_code == 200
    updated_samples = {sample["code"]: sample for sample in storage.read("mes.samples")}
    assert updated_samples["SP-CONCURRENT-A"]["trays"][0]["status"] == "送至实验室"
    assert updated_samples["SP-CONCURRENT-B"]["trays"][0]["status"] == "厂家收回"
    assert [event["action"] for event in storage.read("mes.staging_events")] == ["stock_out", "manufacturer_return"]


def test_storage_key_update_publishes_changed_key(monkeypatch):
    from app.api.routes import storage as storage_route

    published = []
    client, storage = build_client(monkeypatch)
    monkeypatch.setattr(storage_route, "publish_storage_update", lambda keys: published.append(keys))

    response = client.put("/api/storage/mes.tasks", json=[{"code": "T-2"}])

    assert response.status_code == 200
    assert storage.read("mes.tasks") == [{"code": "T-2"}]
    assert published == [["mes.tasks"]]


def test_storage_rejects_deleting_schedule_after_fixture_install(monkeypatch):
    schedules = [
        {
            "id": "schedule-installed",
            "task_code": "TASK-INSTALLED",
            "experiment_code": "EXP-INSTALLED",
            "device": "冲击一室",
            "start_at": "2026-06-23 08:00",
            "end_at": "2026-06-23 10:00",
        }
    ]
    samples = [
        {
            "code": "SP-INSTALLED",
            "task_code": "TASK-INSTALLED",
            "status": "工装夹具安装",
            "flow_status": "工装夹具安装",
            "trays": [{"tray_code": "TP-INSTALLED", "status": "工装夹具安装", "quantity": 1}],
        }
    ]
    experiment_trays = [
        {"task_code": "TASK-INSTALLED", "experiment_code": "EXP-INSTALLED", "tray_code": "TP-INSTALLED"}
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.experiment_trays": experiment_trays,
            "mes.samples": samples,
            "mes.schedules": schedules,
        },
    )

    response = client.put("/api/storage", json={"mes.schedules": []})

    assert response.status_code == 400
    assert "夹具安装后排程不可删除" in response.json()["detail"]
    assert storage.read("mes.schedules") == schedules


def test_storage_rejects_rescheduling_after_fixture_install(monkeypatch):
    schedules = [
        {
            "id": "schedule-installed",
            "task_code": "TASK-INSTALLED",
            "experiment_code": "EXP-INSTALLED",
            "device": "冲击一室",
            "start_at": "2026-06-23 08:00",
            "end_at": "2026-06-23 10:00",
        }
    ]
    samples = [
        {
            "code": "SP-INSTALLED",
            "task_code": "TASK-INSTALLED",
            "status": "工装夹具安装",
            "flow_status": "工装夹具安装",
            "trays": [{"tray_code": "TP-INSTALLED", "status": "工装夹具安装", "quantity": 1}],
        }
    ]
    experiment_trays = [
        {"task_code": "TASK-INSTALLED", "experiment_code": "EXP-INSTALLED", "tray_code": "TP-INSTALLED"}
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.experiment_trays": experiment_trays,
            "mes.samples": samples,
            "mes.schedules": schedules,
        },
    )
    attempted = deepcopy(schedules)
    attempted[0]["start_at"] = "2026-06-23 09:00"
    attempted[0]["end_at"] = "2026-06-23 11:00"

    response = client.put("/api/storage/mes.schedules", json=attempted)

    assert response.status_code == 400
    assert "夹具安装后排程不可删除" in response.json()["detail"]
    assert storage.read("mes.schedules") == schedules


def test_storage_allows_deleting_untouched_future_axis_schedule_after_sibling_starts(monkeypatch):
    schedules = [
        {
            "id": "schedule-vibration-active",
            "task_code": "TASK-AXIS-SCHEDULE",
            "experiment_code": "EXP-VIBRATION",
            "sub_experiment_code": "EXP-VIBRATION#AXIS-001",
            "device": "振动一室",
            "start_at": "2026-06-23 08:00",
            "end_at": "2026-06-23 10:00",
            "axis_codes": ["x+"],
        },
        {
            "id": "schedule-vibration-future",
            "task_code": "TASK-AXIS-SCHEDULE",
            "experiment_code": "EXP-VIBRATION",
            "sub_experiment_code": "EXP-VIBRATION#AXIS-002",
            "device": "振动二室",
            "start_at": "2026-06-24 08:00",
            "end_at": "2026-06-24 10:00",
            "axis_codes": ["y+"],
        },
    ]
    samples = [
        {
            "code": "SP-AXIS-SCHEDULE",
            "task_code": "TASK-AXIS-SCHEDULE",
            "status": "工装夹具安装",
            "flow_status": "工装夹具安装",
            "trays": [{"tray_code": "TP-AXIS-SCHEDULE", "status": "工装夹具安装", "quantity": 1}],
        }
    ]
    experiment_trays = [
        {"task_code": "TASK-AXIS-SCHEDULE", "experiment_code": "EXP-VIBRATION", "tray_code": "TP-AXIS-SCHEDULE"}
    ]
    experiment_runs = [
        {
            "run_no": "run-vibration-active",
            "schedule_id": "schedule-vibration-active",
            "task_code": "TASK-AXIS-SCHEDULE",
            "experiment_code": "EXP-VIBRATION",
            "sub_experiment_code": "EXP-VIBRATION#AXIS-001",
            "status": "实验进行中",
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.experiment_runs": experiment_runs,
            "mes.experiment_trays": experiment_trays,
            "mes.samples": samples,
            "mes.schedules": schedules,
        },
    )

    response = client.put("/api/storage/mes.schedules", json=[schedules[0]])

    assert response.status_code == 200
    assert storage.read("mes.schedules") == [schedules[0]]


def test_storage_allows_deleting_partially_completed_multi_axis_schedule(monkeypatch):
    sub_experiment_code = "EXP-IMPACT#AXIS-001"
    schedules = [
        {
            "id": "schedule-axis",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "device": "冲击一室",
            "start_at": "2026-06-23 08:00",
            "end_at": "2026-06-23 12:00",
            "axis_codes": ["x+", "x-"],
            "sub_experiment_code": sub_experiment_code,
        }
    ]
    samples = [
        {
            "code": "SP-AXIS",
            "task_code": "TASK-AXIS",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "trays": [{"tray_code": "TP-AXIS", "status": "实验进行中", "quantity": 1}],
        }
    ]
    experiment_trays = [
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS"}
    ]
    experiment_run_steps = [
        {
            "run_no": "RUN-AXIS",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "axis_code": "x+",
            "step_no": 1,
            "status": "实验已完成",
            "sub_experiment_code": sub_experiment_code,
        },
        {
            "run_no": "RUN-AXIS",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "axis_code": "x-",
            "step_no": 2,
            "status": "待执行",
            "sub_experiment_code": sub_experiment_code,
        },
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.experiment_run_steps": experiment_run_steps,
            "mes.experiment_trays": experiment_trays,
            "mes.samples": samples,
            "mes.schedules": schedules,
        },
    )

    response = client.put("/api/storage", json={"mes.schedules": []})

    assert response.status_code == 200
    assert storage.read("mes.schedules") == []
    assert storage.read("mes.experiment_run_steps") == experiment_run_steps


def test_storage_schedule_patch_upserts_changed_rows_without_replacing_full_snapshot(monkeypatch):
    existing_schedule = {
        "id": "schedule-existing",
        "task_code": "TASK-OLD",
        "experiment_code": "EXP-OLD",
        "device": "冲击一室",
        "start_at": "2026-06-23 08:00",
        "end_at": "2026-06-23 10:00",
    }
    new_schedule = {
        "id": "schedule-new",
        "task_code": "TASK-NEW",
        "experiment_code": "EXP-NEW",
        "device": "冲击二室",
        "start_at": "2026-06-23 10:30",
        "end_at": "2026-06-23 12:00",
    }
    client, storage = build_client(monkeypatch, {"mes.schedules": [existing_schedule]})

    response = client.post(
        "/api/storage/schedules/patch",
        json={
            "upserts": {
                "mes.schedules": [new_schedule],
                "mes.tasks": [{"code": "TASK-NEW", "status": "已排程"}],
            }
        },
    )

    assert response.status_code == 200
    assert storage.read("mes.schedules") == [existing_schedule, new_schedule]
    assert storage.read("mes.tasks") == [{"code": "TASK-NEW", "status": "已排程"}]


def test_storage_schedule_patch_rejects_concurrent_overlapping_schedule(monkeypatch):
    existing_schedule = {
        "id": "schedule-existing",
        "task_code": "TASK-OLD",
        "experiment_code": "EXP-OLD",
        "device": "振动一室",
        "lab_code": "LAB-VIB-1",
        "start_at": "2026-06-23 08:00",
        "end_at": "2026-06-23 10:00",
    }
    overlapping_schedule = {
        "id": "schedule-overlap",
        "task_code": "TASK-NEW",
        "experiment_code": "EXP-NEW",
        "device": "振动一室",
        "lab_code": "LAB-VIB-1",
        "start_at": "2026-06-23 09:30",
        "end_at": "2026-06-23 11:00",
    }
    client, storage = build_client(monkeypatch, {"mes.schedules": [existing_schedule]})

    response = client.post(
        "/api/storage/schedules/patch",
        json={"upserts": {"mes.schedules": [overlapping_schedule]}},
    )

    assert response.status_code == 409
    assert "排程冲突" in response.json()["detail"]
    assert storage.read("mes.schedules") == [existing_schedule]


def test_storage_schedule_patch_rejects_concurrent_duplicate_experiment_scope(monkeypatch):
    existing_schedule = {
        "id": "schedule-existing",
        "task_code": "TASK-DUP",
        "experiment_code": "EXP-DUP",
        "device": "冲击一室",
        "start_at": "2026-06-23 08:00",
        "end_at": "2026-06-23 10:00",
    }
    duplicate_schedule = {
        "id": "schedule-duplicate",
        "task_code": "TASK-DUP",
        "experiment_code": "EXP-DUP",
        "device": "冲击二室",
        "start_at": "2026-06-23 11:00",
        "end_at": "2026-06-23 12:00",
    }
    client, storage = build_client(monkeypatch, {"mes.schedules": [existing_schedule]})

    response = client.post(
        "/api/storage/schedules/patch",
        json={"upserts": {"mes.schedules": [duplicate_schedule]}},
    )

    assert response.status_code == 409
    assert "重复排程" in response.json()["detail"]
    assert storage.read("mes.schedules") == [existing_schedule]


def test_storage_update_event_stream_yields_published_keys():
    from app.api.routes import storage as storage_route

    stream = storage_route._storage_update_event_stream()
    try:
        assert next(stream) == ": connected\n\n"

        storage_route.publish_storage_update(["mes.samples"], source="staging-management", request_id="write-1")

        event = next(stream)
    finally:
        stream.close()

    assert event.startswith("data: ")
    assert '"keys": ["mes.samples"]' in event
    assert '"source": "staging-management"' in event
    assert '"requestId": "write-1"' in event
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
    attempted[0]["status"] = "实验后外观检测间存放"
    attempted[0]["flow_status"] = "实验后外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验后外观检测间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已进入试验间流程，不能外观检测间入库。"
    assert storage.read("mes.samples") == samples


def test_storage_allows_staging_stock_in_for_other_tray_when_sample_has_laboratory_progress(monkeypatch):
    samples = [
        {
            "code": "SP-MULTI-TRAY-STAGING",
            "location": "盐雾试验室",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "task_code": "SYLU-2026-05-715",
            "trays": [
                {"tray_code": "TP-MULTI-STAGING-001", "status": "实验进行中", "quantity": 1},
                {"tray_code": "TP-MULTI-STAGING-002", "status": "送至暂存间", "quantity": 1},
            ],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples})

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（暂存间）"
    attempted[0]["status"] = "已到达暂存间"
    attempted[0]["flow_status"] = "已到达暂存间"
    attempted[0]["trays"][1]["status"] = "已到达暂存间"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


def test_storage_allows_appearance_stock_in_for_other_tray_when_sample_has_laboratory_progress(monkeypatch):
    samples = [
        {
            "code": "SP-MULTI-TRAY-APPEARANCE",
            "location": "盐雾试验室",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "task_code": "SYLU-2026-05-716",
            "trays": [
                {"tray_code": "TP-MULTI-APPEARANCE-001", "status": "实验进行中", "quantity": 1},
                {"tray_code": "TP-MULTI-APPEARANCE-002", "status": "送至外观检测间", "quantity": 1},
            ],
            "history": [
                {
                    "detail": "SYLU-2026-05-716 / 盐雾试验 / 实验已完成",
                    "location": "盐雾试验室",
                    "status": "实验已完成",
                    "time": "2026-06-07T10:00:00",
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {"task_code": "SYLU-2026-05-716", "experiment_code": "EXP-SALT", "experiment_name": "盐雾试验"}
            ],
            "mes.experiment_run_trays": [
                {
                    "task_code": "SYLU-2026-05-716",
                    "experiment_code": "EXP-SALT",
                    "tray_code": "TP-MULTI-APPEARANCE-002",
                    "run_tray_status": "实验已完成",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "外观检测间"
    attempted[0]["status"] = "实验后外观检测间存放"
    attempted[0]["flow_status"] = "实验后外观检测间存放"
    attempted[0]["trays"][1]["status"] = "实验后外观检测间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


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
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {"task_code": "SYLU-2026-05-706", "experiment_code": "EXP-SALT", "experiment_name": "盐雾试验"}
            ],
            "mes.experiment_run_trays": [
                {
                    "task_code": "SYLU-2026-05-706",
                    "experiment_code": "EXP-SALT",
                    "tray_code": "TP-APPEARANCE-DISPATCHED",
                    "run_tray_status": "实验已完成",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["status"] = "实验后外观检测间存放"
    attempted[0]["flow_status"] = "实验后外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验后外观检测间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


def test_storage_allows_appearance_stock_in_after_completed_hot_humid_experiment(monkeypatch):
    samples = [
        {
            "code": "SP-APPEARANCE-HOT-HUMID",
            "location": "外观检测间",
            "status": "送至外观检测间",
            "flow_status": "送至外观检测间",
            "task_code": "SYLU-2026-05-708",
            "trays": [{"tray_code": "TP-APPEARANCE-HOT-HUMID", "status": "送至外观检测间", "quantity": 1}],
            "history": [
                {
                    "detail": "SYLU-2026-05-708 / 高低温湿热试验 / 实验已完成",
                    "location": "高低温湿热二室",
                    "status": "实验已完成",
                    "time": "2026-06-07T10:00:00",
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": "SYLU-2026-05-708",
                    "experiment_code": "EXP-HOT-HUMID",
                    "experiment_name": "高低温湿热试验",
                }
            ],
            "mes.experiment_run_trays": [
                {
                    "task_code": "SYLU-2026-05-708",
                    "experiment_code": "EXP-HOT-HUMID",
                    "tray_code": "TP-APPEARANCE-HOT-HUMID",
                    "run_tray_status": "实验已完成",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["status"] = "实验后外观检测间存放"
    attempted[0]["flow_status"] = "实验后外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验后外观检测间存放"

    response = client.put("/api/storage/mes.samples", json=attempted)

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


def test_storage_rejects_appearance_stock_in_after_non_appearance_experiment(monkeypatch):
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
    attempted[0]["status"] = "实验后外观检测间存放"
    attempted[0]["flow_status"] = "实验后外观检测间存放"
    attempted[0]["trays"][0]["status"] = "实验后外观检测间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "当前试验类型不支持进入外观检测间。"
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
    attempted[0]["status"] = "实验后暂存间存放"
    attempted[0]["flow_status"] = "实验后暂存间存放"
    attempted[0]["trays"][0]["status"] = "实验后暂存间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


def test_storage_allows_post_staging_stock_in_when_axis_batch_completed(monkeypatch):
    task_code = "SYLU-2026-07-001"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    completed_axes = ["x+", "x-", "y+"]
    remaining_axes = ["y-", "z+", "z-"]
    first_sub_code = f"{experiment_code}#AXIS-001"
    second_sub_code = f"{experiment_code}#AXIS-002"
    samples = [
        {
            "code": f"{task_code}-SP-001",
            "location": "冲击一室",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "task_code": task_code,
            "trays": [
                {
                    "tray_code": tray_code,
                    "status": "实验进行中",
                    "quantity": 1,
                    "target_lab": "冲击一室",
                    "target_experiment_code": experiment_code,
                    "target_sub_experiment_code": second_sub_code,
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "experiment_name": "冲击试验",
                    "axis_codes": [*completed_axes, *remaining_axes],
                }
            ],
            "mes.schedules": [
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
            "mes.experiment_runs": [
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
            "mes.experiment_run_steps": [
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
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
            ],
            "mes.experiment_run_trays": [
                {
                    "run_no": "RUN-IMPACT-AXIS",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "tray_code": tray_code,
                    "run_tray_status": "实验已完成",
                    "sub_experiment_code": first_sub_code,
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（实验后暂存间）"
    attempted[0]["status"] = "实验后暂存间存放"
    attempted[0]["flow_status"] = "实验后暂存间存放"
    attempted[0]["trays"][0]["status"] = "实验后暂存间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


def test_storage_allows_live_shaped_axis_batch_reentry_after_lab_dispatch(monkeypatch):
    task_code = "SYLU-2026-06-001"
    experiment_code = f"{task_code}-C"
    tray_code = f"{task_code}-TP-001"
    first_sub_code = f"{experiment_code}-AXIS-001"
    second_sub_code = f"{experiment_code}-AXIS-002"
    samples = [
        {
            "code": f"{task_code}-SP-004",
            "location": "振动一室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": task_code,
            "trays": [
                {
                    "tray_code": tray_code,
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_lab": "振动一室",
                    "target_experiment_code": experiment_code,
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "experiment_name": "振动试验",
                    "axis_codes": ["x+", "y+"],
                }
            ],
            "mes.schedules": [
                {
                    "id": "schedule-axis-x",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "device": "振动一室",
                    "status": "实验进行中",
                    "axis_codes": ["x+"],
                    "sub_experiment_code": first_sub_code,
                },
                {
                    "id": "schedule-axis-y",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "device": "振动一室",
                    "status": "实验进行中",
                    "axis_codes": ["y+"],
                    "sub_experiment_code": second_sub_code,
                },
            ],
            "mes.experiment_runs": [
                {
                    "run_no": "run-live-axis-x",
                    "schedule_id": "schedule-axis-x",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "status": "实验已完成",
                    "axis_codes": ["x+"],
                    "tray_codes": [tray_code],
                }
            ],
            "mes.experiment_run_steps": [
                {
                    "run_no": "run-live-axis-x",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "axis_code": "x+",
                    "status": "实验已完成",
                }
            ],
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
            ],
            "mes.experiment_run_trays": [
                {
                    "run_no": "run-live-axis-x",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "tray_code": tray_code,
                    "run_tray_status": "实验已完成",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（实验后暂存间）"
    attempted[0]["status"] = "实验后暂存间存放"
    attempted[0]["flow_status"] = "实验后暂存间存放"
    attempted[0]["trays"][0]["status"] = "实验后暂存间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


def test_storage_allows_first_completed_tray_to_post_staging_before_axis_experiment_global_completion(monkeypatch):
    task_code = "SYLU-2026-06-022"
    experiment_code = f"{task_code}-A"
    first_tray_code = f"{task_code}-TP-001"
    second_tray_code = f"{task_code}-TP-002"
    first_sub_code = f"{experiment_code}-AXIS-001"
    second_sub_code = f"{experiment_code}-AXIS-002"
    samples = [
        {
            "code": f"{task_code}-SP-001",
            "location": "冲击一室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": task_code,
            "trays": [
                {
                    "tray_code": first_tray_code,
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_lab": "冲击一室",
                    "target_experiment_code": experiment_code,
                }
            ],
        },
        {
            "code": f"{task_code}-SP-002",
            "location": "冲击一室",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "task_code": task_code,
            "trays": [
                {
                    "tray_code": second_tray_code,
                    "status": "实验进行中",
                    "quantity": 1,
                    "target_lab": "冲击一室",
                    "target_experiment_code": experiment_code,
                }
            ],
        },
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "experiment_name": "冲击试验",
                    "status": "实验进行中",
                    "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
                }
            ],
            "mes.schedules": [
                {
                    "id": "schedule-impact-axis-001",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "device": "冲击一室",
                    "status": "实验已完成",
                    "axis_codes": ["x+", "x-", "y+"],
                    "sub_experiment_code": first_sub_code,
                },
                {
                    "id": "schedule-impact-axis-002",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "device": "冲击一室",
                    "status": "实验已完成",
                    "axis_codes": ["y-", "z+", "z-"],
                    "sub_experiment_code": second_sub_code,
                },
            ],
            "mes.experiment_runs": [
                {
                    "run_no": "run-first-axis-001",
                    "schedule_id": "schedule-impact-axis-001",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "status": "实验已完成",
                    "axis_codes": ["x+", "x-", "y+"],
                    "tray_codes": [first_tray_code],
                },
                {
                    "run_no": "run-first-axis-002",
                    "schedule_id": "schedule-impact-axis-002",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": second_sub_code,
                    "status": "实验已完成",
                    "axis_codes": ["y-", "z+", "z-"],
                    "tray_codes": [first_tray_code],
                },
                {
                    "run_no": "run-second-axis-001",
                    "schedule_id": "schedule-impact-axis-001",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "status": "实验进行中",
                    "axis_codes": ["x+", "x-", "y+"],
                    "tray_codes": [second_tray_code],
                },
            ],
            "mes.experiment_run_steps": [
                {
                    "run_no": run_no,
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": sub_code,
                    "axis_code": axis_code,
                    "status": "实验已完成",
                }
                for run_no, sub_code, axes in [
                    ("run-first-axis-001", first_sub_code, ["x+", "x-", "y+"]),
                    ("run-first-axis-002", second_sub_code, ["y-", "z+", "z-"]),
                ]
                for axis_code in axes
            ],
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": first_tray_code},
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": second_tray_code},
            ],
            "mes.experiment_run_trays": [
                {
                    "run_no": "run-first-axis-001",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "tray_code": first_tray_code,
                    "run_tray_status": "实验已完成",
                },
                {
                    "run_no": "run-first-axis-002",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": second_sub_code,
                    "tray_code": first_tray_code,
                    "run_tray_status": "实验已完成",
                },
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（实验后暂存间）"
    attempted[0]["status"] = "实验后暂存间存放"
    attempted[0]["flow_status"] = "实验后暂存间存放"
    attempted[0]["trays"][0]["status"] = "实验后暂存间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


def test_storage_rejects_axis_batch_reentry_without_sub_experiment_code(monkeypatch):
    task_code = "SYLU-2026-07-001"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    completed_axes = ["x+", "x-", "y+"]
    remaining_axes = ["y-", "z+", "z-"]
    samples = [
        {
            "code": f"{task_code}-SP-001",
            "location": "冲击一室",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "task_code": task_code,
            "trays": [
                {
                    "tray_code": tray_code,
                    "status": "实验进行中",
                    "quantity": 1,
                    "target_lab": "冲击一室",
                    "target_experiment_code": experiment_code,
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "experiment_name": "冲击试验",
                    "axis_codes": [*completed_axes, *remaining_axes],
                }
            ],
            "mes.schedules": [
                {"task_code": task_code, "experiment_code": experiment_code, "device": "冲击一室", "status": "实验已完成", "axis_codes": completed_axes},
                {"task_code": task_code, "experiment_code": experiment_code, "device": "冲击一室", "status": "已排程", "axis_codes": remaining_axes},
            ],
            "mes.experiment_runs": [
                {"run_no": "RUN-IMPACT-AXIS", "task_code": task_code, "experiment_code": experiment_code, "status": "实验已完成", "axis_codes": completed_axes}
            ],
            "mes.experiment_run_steps": [
                {"run_no": "RUN-IMPACT-AXIS", "task_code": task_code, "experiment_code": experiment_code, "axis_code": axis_code, "status": "实验已完成"}
                for axis_code in completed_axes
            ],
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
            ],
            "mes.experiment_run_trays": [
                {
                    "run_no": "RUN-IMPACT-AXIS",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "tray_code": tray_code,
                    "run_tray_status": "实验已完成",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（实验后暂存间）"
    attempted[0]["status"] = "实验后暂存间存放"
    attempted[0]["flow_status"] = "实验后暂存间存放"
    attempted[0]["trays"][0]["status"] = "实验后暂存间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已进入试验间流程，不能暂存间入库。"
    assert storage.read("mes.samples") == samples


def test_storage_allows_scoped_axis_batch_reentry_to_post_experiment_staging(monkeypatch):
    task_code = "SYLU-2026-07-001"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    completed_axes = ["x+", "x-", "y+"]
    remaining_axes = ["y-", "z+", "z-"]
    first_sub_code = f"{experiment_code}-AXIS-001"
    second_sub_code = f"{experiment_code}-AXIS-002"
    samples = [
        {
            "code": f"{task_code}-SP-001",
            "location": "冲击一室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": task_code,
            "trays": [
                {
                    "tray_code": tray_code,
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_lab": "冲击一室",
                    "target_experiment_code": experiment_code,
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "experiment_name": "冲击试验",
                    "axis_codes": [*completed_axes, *remaining_axes],
                }
            ],
            "mes.schedules": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "device": "冲击一室",
                    "status": "实验已完成",
                    "axis_codes": completed_axes,
                },
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": second_sub_code,
                    "device": "冲击一室",
                    "status": "已排程",
                    "axis_codes": remaining_axes,
                },
            ],
            "mes.experiment_runs": [
                {
                    "run_no": "RUN-IMPACT-AXIS",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "status": "实验已完成",
                    "axis_codes": completed_axes,
                }
            ],
            "mes.experiment_run_steps": [
                {
                    "run_no": "RUN-IMPACT-AXIS",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "axis_code": axis_code,
                    "status": "实验已完成",
                }
                for axis_code in completed_axes
            ],
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
            ],
            "mes.experiment_run_trays": [
                {
                    "run_no": "RUN-IMPACT-AXIS",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "tray_code": tray_code,
                    "run_tray_status": "实验已完成",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（暂存间）"
    attempted[0]["status"] = "实验后暂存间存放"
    attempted[0]["flow_status"] = "实验后暂存间存放"
    attempted[0]["trays"][0]["status"] = "实验后暂存间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted


def test_storage_allows_scoped_axis_batch_reentry_to_normal_staging(monkeypatch):
    task_code = "SYLU-2026-07-001"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    completed_axes = ["x+", "x-", "y+", "y-"]
    remaining_axes = ["z+", "z-"]
    first_sub_code = f"{experiment_code}-AXIS-001"
    second_sub_code = f"{experiment_code}-AXIS-002"
    samples = [
        {
            "code": f"{task_code}-SP-001",
            "location": "冲击一室",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "task_code": task_code,
            "trays": [
                {
                    "tray_code": tray_code,
                    "status": "实验进行中",
                    "quantity": 1,
                    "target_lab": "冲击一室",
                    "target_experiment_code": experiment_code,
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "experiment_name": "冲击试验",
                    "axis_codes": [*completed_axes, *remaining_axes],
                }
            ],
            "mes.schedules": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "device": "冲击一室",
                    "status": "实验已完成",
                    "axis_codes": completed_axes,
                },
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": second_sub_code,
                    "device": "冲击一室",
                    "status": "已排程",
                    "axis_codes": remaining_axes,
                },
            ],
            "mes.experiment_runs": [
                {
                    "run_no": "RUN-IMPACT-AXIS",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "status": "实验已完成",
                    "axis_codes": completed_axes,
                }
            ],
            "mes.experiment_run_steps": [
                {
                    "run_no": "RUN-IMPACT-AXIS",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "axis_code": axis_code,
                    "status": "实验已完成",
                }
                for axis_code in completed_axes
            ],
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
            ],
            "mes.experiment_run_trays": [
                {
                    "run_no": "RUN-IMPACT-AXIS",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "tray_code": tray_code,
                    "run_tray_status": "实验已完成",
                }
            ],
            "mes.staging_events": [
                {
                    "id": "staging-stock-out",
                    "tray_code": tray_code,
                    "task_code": task_code,
                    "action": "stock_out",
                    "target_lab": "冲击一室",
                    "target_experiment_code": experiment_code,
                    "time": "2026-06-25 15:08:58",
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（暂存间）"
    attempted[0]["status"] = "已到达暂存间"
    attempted[0]["flow_status"] = "已到达暂存间"
    attempted[0]["trays"][0]["status"] = "已到达暂存间"
    next_events = [
        *storage.read("mes.staging_events"),
        {
            "id": "staging-stock-in",
            "tray_code": tray_code,
            "task_code": task_code,
            "action": "stock_in",
            "time": "2026-06-25 15:30:22",
        },
    ]

    response = client.put("/api/storage", json={"mes.samples": attempted, "mes.staging_events": next_events})

    assert response.status_code == 200
    assert storage.read("mes.samples") == attempted
    assert storage.read("mes.staging_events")[-1]["id"] == "staging-stock-in"


def test_storage_rejects_post_staging_stock_in_when_axis_batch_has_no_pending_schedule(monkeypatch):
    task_code = "SYLU-2026-07-001"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    completed_axes = ["x+", "x-", "y+"]
    remaining_axes = ["y-", "z+", "z-"]
    first_sub_code = f"{experiment_code}#AXIS-001"
    second_sub_code = f"{experiment_code}#AXIS-002"
    samples = [
        {
            "code": f"{task_code}-SP-001",
            "location": "冲击一室",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "task_code": task_code,
            "trays": [
                {
                    "tray_code": tray_code,
                    "status": "实验进行中",
                    "quantity": 1,
                    "target_lab": "冲击一室",
                    "target_experiment_code": experiment_code,
                    "target_sub_experiment_code": second_sub_code,
                }
            ],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.experiments": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "experiment_name": "冲击试验",
                    "axis_codes": [*completed_axes, *remaining_axes],
                }
            ],
            "mes.schedules": [
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
            "mes.experiment_runs": [
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
            "mes.experiment_run_steps": [
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
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
            ],
            "mes.experiment_run_trays": [
                {
                    "run_no": "RUN-IMPACT-AXIS",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "tray_code": tray_code,
                    "run_tray_status": "实验已完成",
                    "sub_experiment_code": first_sub_code,
                }
            ],
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "恒温恒湿间（实验后暂存间）"
    attempted[0]["status"] = "实验后暂存间存放"
    attempted[0]["flow_status"] = "实验后暂存间存放"
    attempted[0]["trays"][0]["status"] = "实验后暂存间存放"

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已进入试验间流程，不能暂存间入库。"
    assert storage.read("mes.samples") == samples
