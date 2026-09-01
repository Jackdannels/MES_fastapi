import asyncio
from copy import deepcopy
from datetime import datetime
import threading

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest


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


class ScopedTrayActionStorage(FakeStorage):
    def __init__(self, payloads=None, *, tray_task_codes=None):
        super().__init__(payloads)
        self.tray_task_codes = dict(tray_task_codes or {})
        self.scope_reads = []
        self.scope_writes = []
        self.read_many_calls = []

    def read_all(self):
        raise AssertionError("scoped tray actions must not read the full snapshot")

    def find_task_code_by_tray(self, tray_code):
        return self.tray_task_codes.get(tray_code, "")

    def read_task_scope(self, task_codes, keys):
        normalized = {str(code or "").strip() for code in task_codes}
        self.scope_reads.append((normalized, tuple(keys)))
        result = {}
        for key in keys:
            rows = self.payloads.get(key, [])
            if key == "mes.devices":
                result[key] = deepcopy(rows)
                continue
            result[key] = [
                deepcopy(row)
                for row in rows
                if str(row.get("code") if key == "mes.tasks" else row.get("task_code") or "").strip() in normalized
            ]
        return result

    def read_many(self, keys):
        requested = tuple(keys)
        self.read_many_calls.append(requested)
        return {key: deepcopy(self.payloads.get(key, [])) for key in requested}

    def write_task_scope(self, updates, *, task_codes):
        normalized = {str(code or "").strip() for code in task_codes}
        self.scope_writes.append((normalized, deepcopy(updates)))
        for key, rows in updates.items():
            current = self.payloads.get(key, [])
            retained = [
                row
                for row in current
                if str(row.get("code") if key == "mes.tasks" else row.get("task_code") or "").strip() not in normalized
            ]
            self.payloads[key] = retained + deepcopy(rows)


class ReadManyStorage(FakeStorage):
    def __init__(self, payloads=None):
        super().__init__(payloads)
        self.read_many_calls = []

    def read_all(self):
        raise AssertionError("targeted storage updates must not read the full snapshot")

    def read_many(self, keys):
        requested = tuple(keys)
        self.read_many_calls.append(requested)
        return {key: deepcopy(self.payloads.get(key, [])) for key in requested}


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


def test_storage_persists_device_maintenance_records(monkeypatch):
    client, storage = build_client(monkeypatch)
    records = [
        {
            "device_code": "冲击一室",
            "maintenance_type": "维修",
            "started_at": "2026-07-15 08:00:00",
            "ended_at": "2026-07-15 09:00:00",
            "status": "已结束",
        }
    ]

    response = client.put("/api/storage", json={"mes.maintenance_records": records})

    assert response.status_code == 200
    assert storage.read("mes.maintenance_records") == records


def test_generic_storage_update_reads_only_updated_key_and_validation_dependencies(monkeypatch):
    storage = ReadManyStorage({"mes.maintenance_records": [{"id": "OLD"}]})
    client, _storage = build_client_with_storage(monkeypatch, storage)

    response = client.put("/api/storage", json={"mes.maintenance_records": [{"id": "NEW"}]})

    assert response.status_code == 200
    assert storage.payloads["mes.maintenance_records"] == [{"id": "NEW"}]
    assert storage.read_many_calls == [("mes.maintenance_records",)]


def test_sample_storage_update_reads_bounded_validation_key_set(monkeypatch):
    sample = {"code": "SP-001", "task_code": "TASK-001", "status": "运输中", "trays": []}
    storage = ReadManyStorage({"mes.tasks": [{"code": "TASK-001", "sample_count": 1}], "mes.samples": [sample]})
    client, _storage = build_client_with_storage(monkeypatch, storage)

    response = client.put("/api/storage", json={"mes.samples": [sample]})

    assert response.status_code == 200
    assert set(storage.read_many_calls[-1]) == {
        "mes.devices",
            "mes.experiment_run_steps",
            "mes.experiment_run_pauses",
            "mes.experiment_run_trays",
        "mes.experiment_runs",
        "mes.experiment_trays",
        "mes.experiments",
        "mes.samples",
        "mes.schedules",
        "mes.staging_events",
        "mes.tasks",
    }


def test_storage_tray_action_uses_task_scope_and_preserves_unrelated_samples(monkeypatch):
    task_code = "TASK-SCOPED"
    tray_code = "TRAY-SCOPED"
    unrelated = {
        "code": "OTHER-SP-001",
        "task_code": "TASK-OTHER",
        "status": "运输中",
        "trays": [],
    }
    storage = ScopedTrayActionStorage(
        {
            "mes.tasks": [{"code": task_code}, {"code": "TASK-OTHER"}],
            "mes.samples": [
                unrelated,
                {
                    "code": "TASK-SCOPED-SP-001",
                    "task_code": task_code,
                    "status": "送至暂存间",
                    "flow_status": "送至暂存间",
                    "location": "接驳区",
                    "trays": [{"tray_code": tray_code, "status": "送至暂存间"}],
                },
            ],
            "mes.staging_events": [],
        },
        tray_task_codes={tray_code: task_code},
    )
    client, _storage = build_client_with_storage(monkeypatch, storage)

    response = client.post(f"/api/storage/rooms/staging/trays/{tray_code}/stock-in", json={"operator": "操作员"})

    assert response.status_code == 200
    assert unrelated in storage.payloads["mes.samples"]
    assert storage.scope_reads[-1][0] == {task_code}
    assert storage.scope_writes[-1][0] == {task_code}
    assert set(storage.scope_writes[-1][1]) == {"mes.samples", "mes.staging_events"}


def _salt_mid_appearance_snapshot():
    task_code = "TASK-SALT-MID"
    tray_code = "TP-SALT-MID"
    run_no = "RUN-SALT-MID"
    pause_no = "PAUSE-SALT-MID-1"
    return {
        "mes.samples": [{
            "code": "SP-SALT-MID",
            "task_code": task_code,
            "location": "盐雾试验室",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "trays": [{"tray_code": tray_code, "status": "实验进行中"}],
        }],
        "mes.experiment_runs": [{
            "run_no": run_no,
            "task_code": task_code,
            "experiment_code": "EXP-SALT-MID",
            "schedule_id": "SCH-SALT-MID",
            "device": "盐雾试验室",
            "status": "实验暂停",
        }],
        "mes.experiment_run_trays": [{
            "run_no": run_no,
            "task_code": task_code,
            "experiment_code": "EXP-SALT-MID",
            "tray_code": tray_code,
            "status": "实验进行中",
        }],
        "mes.experiment_run_pauses": [{
            "pause_no": pause_no,
            "run_no": run_no,
            "task_code": task_code,
            "experiment_code": "EXP-SALT-MID",
            "lab_code": "LAB_SALT",
            "status": "实验暂停",
            "inspection_tray_codes": [tray_code],
        }],
        "mes.staging_events": [],
    }


def test_salt_paused_selected_tray_can_enter_mid_experiment_appearance_and_return_only_to_original_run(monkeypatch):
    snapshot = _salt_mid_appearance_snapshot()
    tray_code = "TP-SALT-MID"
    client, storage = build_client(monkeypatch, snapshot)

    stocked = client.post(f"/api/storage/rooms/appearance/trays/{tray_code}/stock-in", json={})
    assert stocked.status_code == 200
    stocked_event = storage.read("mes.staging_events")[-1]
    assert stocked_event["appearance_phase"] == "mid_experiment"
    assert stocked_event["run_no"] == "RUN-SALT-MID"
    assert stocked_event["pause_no"] == "PAUSE-SALT-MID-1"
    assert storage.read("mes.samples")[0]["status"] == "中途外观检查中"

    forged = client.post(
        f"/api/storage/rooms/appearance/trays/{tray_code}/stock-out",
        json={
            "inspectionResult": "未见新增腐蚀",
            "targetLab": "冲击一室",
            "targetLabCode": "LAB_IMPACT_1",
            "targetExperimentCode": "EXP-OTHER",
            "runNo": "RUN-OTHER",
        },
    )
    assert forged.status_code == 409
    assert "只能返回原盐雾试验室" in forged.json()["detail"]

    returned = client.post(
        f"/api/storage/rooms/appearance/trays/{tray_code}/stock-out",
        json={"inspectionResult": "未见新增腐蚀"},
    )
    assert returned.status_code == 200
    returned_event = storage.read("mes.staging_events")[-1]
    assert returned_event["appearance_phase"] == "mid_experiment"
    assert returned_event["target_lab"] == "盐雾试验室"
    assert returned_event["target_lab_code"] == "LAB_SALT"
    assert returned_event["target_experiment_code"] == "EXP-SALT-MID"
    assert returned_event["run_no"] == "RUN-SALT-MID"
    assert returned_event["inspection_result"] == "未见新增腐蚀"
    assert storage.read("mes.samples")[0]["status"] == "等待恢复实验"


def test_salt_mid_appearance_stock_in_overrides_stale_post_experiment_client_status(monkeypatch):
    snapshot = _salt_mid_appearance_snapshot()
    tray_code = "TP-SALT-MID"
    client, storage = build_client(monkeypatch, snapshot)

    response = client.post(
        f"/api/storage/rooms/appearance/trays/{tray_code}/stock-in",
        json={
            "location": "外观检测间",
            "status": "实验后外观检测间存放",
        },
    )

    assert response.status_code == 200
    event = storage.read("mes.staging_events")[-1]
    assert event["status"] == "中途外观检查中"
    assert event["appearance_phase"] == "mid_experiment"
    assert event["run_no"] == "RUN-SALT-MID"
    assert event["pause_no"] == "PAUSE-SALT-MID-1"
    assert storage.read("mes.samples")[0]["status"] == "中途外观检查中"


def test_mid_experiment_appearance_rejects_unselected_or_unconfirmed_pause_tray(monkeypatch):
    snapshot = _salt_mid_appearance_snapshot()
    snapshot["mes.experiment_run_pauses"][0]["inspection_tray_codes"] = []
    client, _storage = build_client(monkeypatch, snapshot)

    response = client.post("/api/storage/rooms/appearance/trays/TP-SALT-MID/stock-in", json={})

    assert response.status_code == 400
    assert "不能外观检测间入库" in response.json()["detail"]


def test_mid_experiment_resume_validation_requires_result_and_original_salt_return():
    from app.services.appearance_inspection import validate_mid_experiment_trays_ready_for_resume

    snapshot = _salt_mid_appearance_snapshot()
    pause = snapshot["mes.experiment_run_pauses"][0]
    with pytest.raises(ValueError, match="尚未全部返回"):
        validate_mid_experiment_trays_ready_for_resume(snapshot, pause)

    snapshot["mes.staging_events"] = [
        {
            "room": "appearance",
            "action": "stock_in",
            "appearance_phase": "mid_experiment",
            "run_no": "RUN-SALT-MID",
            "pause_no": "PAUSE-SALT-MID-1",
            "tray_code": "TP-SALT-MID",
            "time": "2026-08-12 10:00:00",
        },
        {
            "room": "appearance",
            "action": "stock_out",
            "appearance_phase": "mid_experiment",
            "run_no": "RUN-SALT-MID",
            "pause_no": "PAUSE-SALT-MID-1",
            "tray_code": "TP-SALT-MID",
            "inspection_result": "未见新增腐蚀",
            "target_lab": "盐雾试验室",
            "target_lab_code": "LAB_SALT",
            "time": "2026-08-12 10:10:00",
        },
    ]
    sample = snapshot["mes.samples"][0]
    sample["location"] = "盐雾试验室"
    sample["status"] = "等待恢复实验"
    sample["flow_status"] = "等待恢复实验"
    sample["trays"][0]["status"] = "等待恢复实验"

    validate_mid_experiment_trays_ready_for_resume(snapshot, pause)


def test_mid_experiment_appearance_conclusion_is_optional_and_empty_value_is_audited(monkeypatch):
    from app.services.appearance_inspection import validate_mid_experiment_trays_ready_for_resume

    snapshot = _salt_mid_appearance_snapshot()
    tray_code = "TP-SALT-MID"
    client, storage = build_client(monkeypatch, snapshot)

    assert client.post(f"/api/storage/rooms/appearance/trays/{tray_code}/stock-in", json={}).status_code == 200
    response = client.post(f"/api/storage/rooms/appearance/trays/{tray_code}/stock-out", json={})

    assert response.status_code == 200
    event = storage.read("mes.staging_events")[-1]
    assert event["appearance_phase"] == "mid_experiment"
    assert event["inspection_result"] == ""
    assert event["target_lab_code"] == "LAB_SALT"
    validate_mid_experiment_trays_ready_for_resume(
        storage.read_all(),
        storage.read("mes.experiment_run_pauses")[0],
    )


def test_second_salt_pause_allows_manual_appearance_stock_in_after_previous_cycle_returned(monkeypatch):
    snapshot = _salt_mid_appearance_snapshot()
    tray_code = "TP-SALT-MID"
    first_pause = snapshot["mes.experiment_run_pauses"][0]
    first_pause["pause_no"] = "PAUSE-SALT-MID-OLD"
    first_pause["status"] = "实验已恢复"
    snapshot["mes.experiment_run_pauses"].append({
        **first_pause,
        "pause_no": "PAUSE-SALT-MID-NEW",
        "status": "实验暂停",
    })
    snapshot["mes.staging_events"] = [
        {
            "room": "appearance", "action": "stock_in", "appearance_phase": "mid_experiment",
            "run_no": "RUN-SALT-MID", "pause_no": "PAUSE-SALT-MID-OLD", "tray_code": tray_code,
            "time": "2026-08-12 10:00:00",
        },
        {
            "room": "appearance", "action": "stock_out", "appearance_phase": "mid_experiment",
            "run_no": "RUN-SALT-MID", "pause_no": "PAUSE-SALT-MID-OLD", "tray_code": tray_code,
            "inspection_result": "继续实验", "target_lab": "盐雾试验室", "target_lab_code": "LAB_SALT",
            "time": "2026-08-12 10:10:00",
        },
    ]
    sample = snapshot["mes.samples"][0]
    sample["location"] = "盐雾试验室"
    sample["status"] = "等待恢复实验"
    sample["flow_status"] = "等待恢复实验"
    sample["trays"][0]["status"] = "等待恢复实验"
    client, storage = build_client(monkeypatch, snapshot)

    response = client.post(f"/api/storage/rooms/appearance/trays/{tray_code}/stock-in", json={})

    assert response.status_code == 200
    event = storage.read("mes.staging_events")[-1]
    assert event["action"] == "stock_in"
    assert event["pause_no"] == "PAUSE-SALT-MID-NEW"
    assert event["appearance_phase"] == "mid_experiment"
    assert storage.read("mes.samples")[0]["status"] == "中途外观检查中"


def test_completed_current_salt_pause_cannot_be_relisted_or_stocked_in_again(monkeypatch):
    snapshot = _salt_mid_appearance_snapshot()
    tray_code = "TP-SALT-MID"
    snapshot["mes.staging_events"] = [{
        "room": "appearance", "action": "stock_out", "appearance_phase": "mid_experiment",
        "run_no": "RUN-SALT-MID", "pause_no": "PAUSE-SALT-MID-1", "tray_code": tray_code,
        "inspection_result": "继续实验", "target_lab": "盐雾试验室", "target_lab_code": "LAB_SALT",
        "time": "2026-08-12 10:10:00",
    }]
    sample = snapshot["mes.samples"][0]
    sample["location"] = "盐雾试验室"
    sample["status"] = "等待恢复实验"
    sample["flow_status"] = "等待恢复实验"
    sample["trays"][0]["status"] = "等待恢复实验"
    client, _storage = build_client(monkeypatch, snapshot)

    response = client.post(f"/api/storage/rooms/appearance/trays/{tray_code}/stock-in", json={})

    assert response.status_code == 409
    assert "本次盐雾暂停外观检查已完成" in response.json()["detail"]


def test_running_device_repair_atomically_completes_experiment_before_entering_repair(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        {
            "mes.devices": [
                {"code": "冲击一室", "name": "冲击试验系统-1", "status": "可用"},
            ],
            "mes.experiments": [
                {
                    "experiment_code": "TASK-001-A",
                    "experiment_name": "冲击试验",
                    "status": "实验进行中",
                    "task_code": "TASK-001",
                },
            ],
            "mes.experiment_runs": [
                {
                    "device": "冲击一室",
                    "experiment_code": "TASK-001-A",
                    "run_no": "RUN-001",
                    "status": "实验进行中",
                    "task_code": "TASK-001",
                },
            ],
            "mes.experiment_run_trays": [
                {
                    "experiment_code": "TASK-001-A",
                    "run_no": "RUN-001",
                    "run_tray_status": "实验进行中",
                    "status": "实验进行中",
                    "task_code": "TASK-001",
                    "tray_code": "TASK-001-TP-001",
                },
            ],
            "mes.experiment_trays": [
                {
                    "experiment_code": "TASK-001-A",
                    "task_code": "TASK-001",
                    "tray_code": "TASK-001-TP-001",
                },
            ],
            "mes.experiment_samples": [
                {
                    "experiment_code": "TASK-001-A",
                    "sample_code": "TASK-001-SP-001",
                    "task_code": "TASK-001",
                },
            ],
            "mes.samples": [
                {
                    "code": "TASK-001-SP-001",
                    "flow_status": "实验进行中",
                    "location": "冲击一室",
                    "status": "实验进行中",
                    "task_code": "TASK-001",
                    "trays": [{"status": "实验进行中", "tray_code": "TASK-001-TP-001"}],
                },
            ],
            "mes.schedules": [
                {
                    "device": "冲击一室",
                    "end_at": "2099-03-20 10:00:00",
                    "experiment_code": "TASK-001-A",
                    "id": "schedule-1",
                    "start_at": "2026-03-20 07:00:00",
                    "status": "实验进行中",
                    "task_code": "TASK-001",
                },
            ],
        },
    )

    response = client.post(
        "/api/storage/devices/冲击一室/running-repair",
        json={
            "maintenanceNote": "运行异常，立即维修",
            "maintenanceType": "维修",
            "targets": [
                {
                    "experiment_code": "TASK-001-A",
                    "id": "schedule-1",
                    "run_no": "RUN-001",
                    "task_code": "TASK-001",
                    "tray_codes": ["TASK-001-TP-001"],
                },
            ],
        },
    )

    assert response.status_code == 200
    device = storage.read("mes.devices")[0]
    assert device["status"] == "维修"
    assert device["maintenance_type"] == "维修"
    assert device["maintenance_note"] == "运行异常，立即维修"
    assert device["maintenance_start_at"]
    assert storage.read("mes.experiments")[0]["status"] == "实验已完成"
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验已完成"
    assert storage.read("mes.experiment_run_trays")[0]["run_tray_status"] == "实验已完成"
    assert storage.read("mes.schedules")[0]["status"] == "实验已完成"
    sample = storage.read("mes.samples")[0]
    assert sample["status"] == "实验已完成"
    assert sample["trays"][0]["status"] == "实验已完成"


def test_future_planned_maintenance_does_not_make_device_unavailable_early():
    from app.api.routes import storage as storage_route

    device = {
        "code": "冲击一室",
        "maintenance_start_at": "2099-03-20 08:00:00",
        "maintenance_type": "计划保养",
        "status": "保养",
    }

    assert storage_route._device_is_unavailable(device) is False
    normalized = storage_route._normalize_future_maintenance_device_statuses({"mes.devices": [device]})
    assert normalized["mes.devices"][0]["status"] == "可用"


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


def sequence_dependencies(task_code, tray_code, experiment_code, lab_name, *, schedule_id="SCH-NEXT", lab_code=""):
    return {
        "mes.schedules": [
            {
                "id": schedule_id,
                "task_code": task_code,
                "experiment_code": experiment_code,
                "device": lab_name,
                "lab_code": lab_code,
                "start_at": "2099-01-01 09:00:00",
            }
        ],
        "mes.experiment_trays": [
            {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
        ],
    }


def test_storage_write_does_not_resurrect_renamed_samples_from_a_stale_client(monkeypatch):
    task_code = "TASK-RENAMED-SAMPLES"
    current_samples = [
        {"code": "CUSTOM-A", "task_code": task_code, "updated_at": "2026-07-30T11:00:00"},
        {"code": "CUSTOM-B", "task_code": task_code, "updated_at": "2026-07-30T11:00:00"},
    ]
    stale_samples = [
        {"code": f"{task_code}-SP-001", "task_code": task_code, "updated_at": "2026-07-30T10:00:00"},
        {"code": f"{task_code}-SP-002", "task_code": task_code, "updated_at": "2026-07-30T10:00:00"},
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.tasks": [{"code": task_code, "sample_count": 2}],
            "mes.samples": current_samples,
        },
    )

    response = client.put("/api/storage", json={"mes.samples": stale_samples})

    assert response.status_code == 200
    assert storage.read("mes.samples") == current_samples


def test_storage_reads_only_requested_snapshot_keys(monkeypatch):
    client, _storage = build_client(
        monkeypatch,
        {
            "mes.tasks": [{"code": "TASK-001"}],
            "mes.samples": [{"code": "SAMPLE-001"}],
        },
    )

    response = client.get("/api/storage?keys=mes.tasks")

    assert response.status_code == 200
    assert response.json() == {"mes.tasks": [{"code": "TASK-001"}]}


def test_storage_operational_profile_uses_narrow_reader_and_has_an_independent_cache_key(monkeypatch):
    from app.services.read_through_cache import read_snapshot_cache

    class OperationalStorage(FakeStorage):
        def __init__(self):
            super().__init__({"mes.samples": [{"code": "FULL", "history": [{"action": "full"}]}]})
            self.full_reads = 0
            self.operational_reads = 0

        def read_many(self, keys):
            self.full_reads += 1
            return {key: self.read(key) for key in keys}

        def read_operational_snapshot(self, keys):
            self.operational_reads += 1
            return {"mes.samples": [{"code": "NARROW", "history": []}]}

    read_snapshot_cache.invalidate()
    storage = OperationalStorage()
    client, _storage = build_client_with_storage(monkeypatch, storage)

    profiled = client.get("/api/storage?keys=mes.samples&profile=dashboard")
    profiled_hit = client.get("/api/storage?keys=mes.samples&profile=dashboard")
    full = client.get("/api/storage?keys=mes.samples")

    assert profiled.json() == profiled_hit.json() == {"mes.samples": [{"code": "NARROW", "history": []}]}
    assert full.json() == {"mes.samples": [{"code": "FULL", "history": [{"action": "full"}]}]}
    assert profiled.headers["X-MES-Read-Cache"] == "miss"
    assert profiled_hit.headers["X-MES-Read-Cache"] == "hit"
    assert storage.operational_reads == 1
    assert storage.full_reads == 1


def test_storage_rejects_unknown_operational_profile(monkeypatch):
    client, _storage = build_client(monkeypatch)

    response = client.get("/api/storage?keys=mes.samples&profile=unknown")

    assert response.status_code == 400
    assert response.json()["detail"] == "Unsupported storage read profile"


def test_storage_read_cache_hits_and_invalidates_after_published_update(monkeypatch):
    from app.api.routes import storage as storage_route
    from app.services.read_through_cache import read_snapshot_cache

    read_snapshot_cache.invalidate()
    storage = CountingStorage({"mes.tasks": [{"code": "TASK-CACHED"}]})
    client, _storage = build_client_with_storage(monkeypatch, storage)

    first = client.get("/api/storage?keys=mes.tasks")
    second = client.get("/api/storage?keys=mes.tasks")
    storage.payloads["mes.tasks"] = [{"code": "TASK-UPDATED"}]
    storage_route.publish_storage_update(["mes.tasks"])
    third = client.get("/api/storage?keys=mes.tasks")

    assert [first.status_code, second.status_code, third.status_code] == [200, 200, 200]
    assert first.headers["X-MES-Read-Cache"] == "miss"
    assert second.headers["X-MES-Read-Cache"] == "hit"
    assert third.headers["X-MES-Read-Cache"] == "miss"
    assert first.json() == second.json() == {"mes.tasks": [{"code": "TASK-CACHED"}]}
    assert third.json() == {"mes.tasks": [{"code": "TASK-UPDATED"}]}
    assert storage.read_calls == ["mes.tasks", "mes.tasks"]


def test_storage_invalid_requested_keys_do_not_fall_back_to_full_snapshot(monkeypatch):
    client, _storage = build_client(
        monkeypatch,
        {"mes.tasks": [{"code": "TASK-001"}]},
    )

    response = client.get("/api/storage?keys=unknown.collection")

    assert response.status_code == 200
    assert response.json() == {}


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
                    "appearance_phase": "pre_experiment",
                    "target_experiment_code": "EXP-SALT",
                    "time": "2026-06-06T21:40:00",
                },
                {
                    "id": "pre-appearance-out",
                    "tray_code": "TP-PRE-APPEARANCE-REPEAT",
                    "task_code": "TASK-PRE-APPEARANCE-REPEAT",
                    "room": "appearance",
                    "action": "stock_out",
                    "appearance_phase": "pre_experiment",
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


def test_storage_allows_pre_experiment_appearance_stock_for_next_target_after_salt_cycle(monkeypatch):
    samples = [
        {
            "code": "SP-PRE-APPEARANCE-NEXT-TARGET",
            "location": "高低温湿热一室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "TASK-PRE-APPEARANCE-NEXT-TARGET",
            "trays": [
                {
                    "tray_code": "TP-PRE-APPEARANCE-NEXT-TARGET",
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_lab": "高低温湿热一室",
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
                {"task_code": "TASK-PRE-APPEARANCE-NEXT-TARGET", "experiment_code": "EXP-SALT", "experiment_name": "盐雾试验"},
                {"task_code": "TASK-PRE-APPEARANCE-NEXT-TARGET", "experiment_code": "EXP-HOT-HUMID", "experiment_name": "高低温湿热试验"},
            ],
            "mes.staging_events": [
                {"id": "salt-pre-in", "tray_code": "TP-PRE-APPEARANCE-NEXT-TARGET", "task_code": "TASK-PRE-APPEARANCE-NEXT-TARGET", "room": "appearance", "action": "stock_in", "appearance_phase": "pre_experiment", "target_experiment_code": "EXP-SALT", "status": "实验前外观检测间存放", "time": "2026-06-06T21:40:00"},
                {"id": "salt-pre-out", "tray_code": "TP-PRE-APPEARANCE-NEXT-TARGET", "task_code": "TASK-PRE-APPEARANCE-NEXT-TARGET", "room": "appearance", "action": "stock_out", "appearance_phase": "pre_experiment", "target_lab": "盐雾试验室", "target_experiment_code": "EXP-SALT", "target_type": "lab", "time": "2026-06-06T21:50:00"},
                {"id": "salt-post-in", "tray_code": "TP-PRE-APPEARANCE-NEXT-TARGET", "task_code": "TASK-PRE-APPEARANCE-NEXT-TARGET", "room": "appearance", "action": "stock_in", "appearance_phase": "post_experiment", "status": "实验后外观检测间存放", "time": "2026-06-06T22:10:00"},
                {"id": "salt-post-out", "tray_code": "TP-PRE-APPEARANCE-NEXT-TARGET", "task_code": "TASK-PRE-APPEARANCE-NEXT-TARGET", "room": "appearance", "action": "stock_out", "appearance_phase": "post_experiment", "target_lab": "恒温恒湿间（暂存间）", "target_type": "staging", "time": "2026-06-06T22:20:00"},
                {"id": "hot-dispatch", "tray_code": "TP-PRE-APPEARANCE-NEXT-TARGET", "task_code": "TASK-PRE-APPEARANCE-NEXT-TARGET", "room": "staging", "action": "stock_out", "target_lab": "高低温湿热一室", "target_experiment_code": "EXP-HOT-HUMID", "target_type": "lab", "time": "2026-06-06T22:30:00"},
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
    assert storage.read("mes.samples")[0]["trays"][0]["target_experiment_code"] == "EXP-HOT-HUMID"


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
                    "appearance_phase": "pre_experiment",
                    "target_experiment_code": "EXP-SALT",
                    "time": "2026-06-06T21:40:00",
                },
                {
                    "id": "pre-appearance-out",
                    "tray_code": "TP-PRE-APPEARANCE-WITHDRAWN",
                    "task_code": "TASK-PRE-APPEARANCE-WITHDRAWN",
                    "room": "appearance",
                    "action": "stock_out",
                    "appearance_phase": "pre_experiment",
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
            "trays": [{
                "tray_code": "TP-DISPATCHED",
                "status": "送至实验室",
                "quantity": 1,
                "target_schedule_id": "SCH-DISPATCHED",
                "target_experiment_code": "EXP-DISPATCHED",
                "target_lab": "盐雾试验室",
            }],
        }
        ]
    client, storage = build_client(monkeypatch, {
        "mes.samples": samples,
        **sequence_dependencies(
            "SYLU-2026-05-702",
            "TP-DISPATCHED",
            "EXP-DISPATCHED",
            "盐雾试验室",
            schedule_id="SCH-DISPATCHED",
        ),
    })

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


def test_storage_staging_stock_out_rejects_lab_without_active_schedule(monkeypatch):
    samples = [
        {
            "code": "SP-STAGING-NO-SCHEDULE",
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "task_code": "TASK-STAGING-NO-SCHEDULE",
            "trays": [{"tray_code": "TP-STAGING-NO-SCHEDULE", "status": "已到达暂存间", "quantity": 1}],
        }
    ]
    client, storage = build_client(
        monkeypatch,
        {"mes.samples": samples, "mes.staging_events": [], "mes.schedules": []},
    )

    response = client.post(
        "/api/storage/rooms/staging/trays/TP-STAGING-NO-SCHEDULE/stock-out",
        json={
            "targetLab": "盐雾试验室",
            "targetExperimentCode": "EXP-SALT-NO-SCHEDULE",
            "targetType": "lab",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "出库请求缺少当前排程标识，请刷新后重试。"


@pytest.mark.parametrize(
    ("room", "location", "status"),
    [
        ("staging", "恒温恒湿间（暂存间）", "已到达暂存间"),
        ("appearance", "外观检测间", "实验前外观检测间存放"),
    ],
)
def test_storage_room_stock_out_rejects_later_scheduled_experiment(monkeypatch, room, location, status):
    task_code = "TASK-ORDERED-STOCK-OUT"
    tray_code = "TP-ORDERED-STOCK-OUT"
    samples = [{
        "code": "SP-ORDERED-STOCK-OUT",
        "location": location,
        "status": status,
        "flow_status": status,
        "task_code": task_code,
        "trays": [{"tray_code": tray_code, "status": status, "quantity": 1}],
    }]
    client, _storage = build_client(monkeypatch, {
        "mes.samples": samples,
        "mes.schedules": [
            {"id": "SCH-A", "task_code": task_code, "experiment_code": "EXP-A", "device": "盐雾试验室", "start_at": "2099-01-01 09:00:00"},
            {"id": "SCH-B", "task_code": task_code, "experiment_code": "EXP-B", "device": "冲击一室", "start_at": "2099-01-01 10:00:00"},
        ],
        "mes.experiment_trays": [
            {"task_code": task_code, "experiment_code": code, "tray_code": tray_code}
            for code in ("EXP-A", "EXP-B")
        ],
    })

    response = client.post(
        f"/api/storage/rooms/{room}/trays/{tray_code}/stock-out",
        json={
            "targetLab": "冲击一室",
            "targetExperimentCode": "EXP-B",
            "scheduleId": "SCH-B",
            "targetType": "lab",
        },
    )

    assert response.status_code == 409
    assert "必须先执行排程 SCH-A" in response.json()["detail"]


def test_storage_generic_put_rejects_later_schedule_target_change(monkeypatch):
    task_code = "TASK-GENERIC-ORDER"
    tray_code = "TP-GENERIC-ORDER"
    samples = [{
        "code": "SP-GENERIC-ORDER",
        "location": "盐雾试验室",
        "status": "送至实验室",
        "flow_status": "送至实验室",
        "task_code": task_code,
        "trays": [{
            "tray_code": tray_code,
            "status": "送至实验室",
            "target_schedule_id": "SCH-A",
            "target_experiment_code": "EXP-A",
            "target_lab": "盐雾试验室",
        }],
    }]
    client, storage = build_client(monkeypatch, {
        "mes.samples": samples,
        "mes.schedules": [
            {"id": "SCH-A", "task_code": task_code, "experiment_code": "EXP-A", "device": "盐雾试验室", "start_at": "2099-01-01 09:00:00"},
            {"id": "SCH-B", "task_code": task_code, "experiment_code": "EXP-B", "device": "冲击一室", "start_at": "2099-01-01 10:00:00"},
        ],
        "mes.experiment_trays": [
            {"task_code": task_code, "experiment_code": code, "tray_code": tray_code}
            for code in ("EXP-A", "EXP-B")
        ],
    })
    attempted = deepcopy(samples)
    attempted[0]["location"] = "冲击一室"
    attempted[0]["trays"][0].update({
        "target_schedule_id": "SCH-B",
        "target_experiment_code": "EXP-B",
        "target_lab": "冲击一室",
    })

    response = client.put("/api/storage", json={"mes.samples": attempted})

    assert response.status_code == 409
    assert "必须先执行排程 SCH-A" in response.json()["detail"]
    assert storage.read("mes.samples") == samples
    assert storage.read("mes.staging_events") == []


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
            **sequence_dependencies(
                "SYLU-2026-06-027",
                "SYLU-2026-06-027-TP-001",
                "SYLU-2026-06-027-A",
                "冲击一室",
                schedule_id="SCH-IMPACT-NEXT",
            ),
        },
    )

    attempted = deepcopy(samples)
    attempted[0]["location"] = "冲击一室"
    attempted[0]["status"] = "送至实验室"
    attempted[0]["flow_status"] = "送至实验室"
    attempted[0]["trays"][0]["status"] = "送至实验室"
    attempted[0]["trays"][0]["target_lab"] = "冲击一室"
    attempted[0]["trays"][0]["target_experiment_code"] = "SYLU-2026-06-027-A"
    attempted[0]["trays"][0]["target_schedule_id"] = "SCH-IMPACT-NEXT"
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
    assert response.json()["detail"] == "盐雾试验室设备维修中，禁止实验室操作"
    assert storage.read("mes.samples") == samples


def test_storage_allows_laboratory_progress_after_maintenance_window_ends(monkeypatch):
    samples = [
        {
            "code": "SP-MAINTENANCE-ENDED",
            "location": "盐雾试验室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "SYLU-2026-05-705",
                "trays": [{
                    "tray_code": "TP-MAINTENANCE-ENDED",
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_schedule_id": "SCH-MAINTENANCE-ENDED",
                    "target_experiment_code": "EXP-MAINTENANCE-ENDED",
                    "target_lab": "盐雾试验室",
                }],
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
                **sequence_dependencies(
                    "SYLU-2026-05-705",
                    "TP-MAINTENANCE-ENDED",
                    "EXP-MAINTENANCE-ENDED",
                    "盐雾试验室",
                    schedule_id="SCH-MAINTENANCE-ENDED",
                ),
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
    assert response.json()["detail"] == "盐雾试验室设备维修中，禁止实验室操作"
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
    client, storage = build_client(monkeypatch, {
        "mes.samples": samples,
        "mes.schedules": [
            {"id": "SCH-PREVIOUS-A", "task_code": "SYLU-2026-05-707", "experiment_code": "EXP-PREVIOUS-A", "device": "盐雾试验室", "start_at": "2099-01-01 09:00:00"},
            {"id": "SCH-NEXT-B", "task_code": "SYLU-2026-05-707", "experiment_code": "EXP-NEXT-B", "device": "温度冲击一室", "start_at": "2099-01-01 10:00:00"},
        ],
        "mes.experiment_trays": [
            {"task_code": "SYLU-2026-05-707", "experiment_code": code, "tray_code": "TP-PREVIOUS-COMPLETED"}
            for code in ("EXP-PREVIOUS-A", "EXP-NEXT-B")
        ],
        "mes.experiment_runs": [
            {"run_no": "RUN-PREVIOUS-A", "schedule_id": "SCH-PREVIOUS-A", "task_code": "SYLU-2026-05-707", "experiment_code": "EXP-PREVIOUS-A"}
        ],
        "mes.experiment_run_trays": [
            {"run_no": "RUN-PREVIOUS-A", "task_code": "SYLU-2026-05-707", "experiment_code": "EXP-PREVIOUS-A", "tray_code": "TP-PREVIOUS-COMPLETED", "run_tray_status": "实验已完成"}
        ],
    })

    updated = deepcopy(samples)
    updated[0]["location"] = "温度冲击一室"
    updated[0]["status"] = "已到达实验室"
    updated[0]["flow_status"] = "已到达实验室"
    updated[0]["trays"][0]["status"] = "已到达实验室"
    updated[0]["trays"][0]["target_schedule_id"] = "SCH-NEXT-B"
    updated[0]["trays"][0]["target_experiment_code"] = "EXP-NEXT-B"
    updated[0]["trays"][0]["target_lab"] = "温度冲击一室"
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
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.staging_events": [],
            "mes.schedules": [
                {
                    "id": "SCH-STAGING-A",
                    "task_code": "TASK-STAGING-A",
                    "experiment_code": "TASK-STAGING-A-A",
                    "device": "冲击一室",
                    "lab_code": "LAB_IMPACT_1",
                    "status": "已排程",
                    "start_at": "2099-01-01 09:00:00",
                }
            ],
            "mes.experiment_trays": [
                {"task_code": "TASK-STAGING-A", "experiment_code": "TASK-STAGING-A-A", "tray_code": "TP-STAGING-A"}
            ],
        },
    )
    monkeypatch.setattr(storage_route, "publish_storage_update", lambda keys, **kwargs: published.append((keys, kwargs)))

    response = client.post(
        "/api/storage/rooms/staging/trays/TP-STAGING-A/stock-out",
        json={
            "targetLab": "冲击一室",
            "targetLabCode": "LAB_IMPACT_1",
            "targetExperimentCode": "TASK-STAGING-A-A",
            "targetExperimentName": "冲击试验",
            "scheduleId": "SCH-STAGING-A",
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


def _storage_lab_occupancy_stock_out_payload(*, occupant_status: str, same_task: bool = False, pushed_out: bool = False):
    target_task_code = "TASK-LAB-OCCUPANCY-TARGET"
    occupant_task_code = target_task_code if same_task else "TASK-LAB-OCCUPANCY-OTHER"
    target_tray_code = "TP-LAB-OCCUPANCY-TARGET"
    occupant_tray_code = "TP-LAB-OCCUPANCY-OCCUPANT"
    occupant_run_status = occupant_status
    occupant_location = "恒温恒湿间（实验后暂存间）" if pushed_out else "冲击一室"
    occupant_tray_status = "实验后暂存间存放" if pushed_out else occupant_status
    target_experiment_code = "EXP-LAB-OCCUPANCY-TARGET"
    occupant_experiment_code = "EXP-LAB-OCCUPANCY-OCCUPANT"
    samples = [
        {
            "code": "SP-LAB-OCCUPANCY-TARGET",
            "task_code": target_task_code,
            "location": "恒温恒湿间（暂存间）",
            "status": "已到达暂存间",
            "flow_status": "已到达暂存间",
            "trays": [{"tray_code": target_tray_code, "status": "已到达暂存间", "quantity": 1}],
        },
        {
            "code": "SP-LAB-OCCUPANCY-OCCUPANT",
            "task_code": occupant_task_code,
            "location": occupant_location,
            "status": occupant_tray_status,
            "flow_status": occupant_tray_status,
            "trays": [
                {
                    "tray_code": occupant_tray_code,
                    "status": occupant_tray_status,
                    "quantity": 1,
                    "target_lab": "冲击一室",
                    "target_lab_code": "LAB_IMPACT_1",
                    "target_experiment_code": occupant_experiment_code,
                }
            ],
        },
    ]
    schedules = [
        {
            "id": "SCH-LAB-OCCUPANCY-TARGET",
            "task_code": target_task_code,
            "experiment_code": target_experiment_code,
            "device": "冲击一室",
            "lab_code": "LAB_IMPACT_1",
            "status": "已排程",
            "start_at": "2099-01-01 09:00:00",
        },
        {
            "id": "SCH-LAB-OCCUPANCY-OCCUPANT",
            "task_code": occupant_task_code,
            "experiment_code": occupant_experiment_code,
            "device": "冲击一室",
            "lab_code": "LAB_IMPACT_1",
            "status": occupant_status,
            "start_at": "2026-08-30 09:00:00",
        },
    ]
    payloads = {
        "mes.samples": samples,
        "mes.staging_events": [],
        "mes.schedules": schedules,
        "mes.experiments": [
            {
                "task_code": occupant_task_code,
                "experiment_code": occupant_experiment_code,
                "experiment_name": "冲击试验",
                "device": "冲击一室",
                "lab_code": "LAB_IMPACT_1",
                "status": occupant_status,
            }
        ],
        "mes.experiment_runs": [
            {
                "run_no": "RUN-LAB-OCCUPANCY",
                "schedule_id": "SCH-LAB-OCCUPANCY-OCCUPANT",
                "task_code": occupant_task_code,
                "experiment_code": occupant_experiment_code,
                "device": "冲击一室",
                "lab_name": "冲击一室",
                "lab_code": "LAB_IMPACT_1",
                "status": occupant_run_status,
                "tray_codes": [occupant_tray_code],
                "started_at": "2026-08-30 09:10:00",
            }
        ],
        "mes.experiment_run_trays": [
            {
                "run_no": "RUN-LAB-OCCUPANCY",
                "task_code": occupant_task_code,
                "experiment_code": occupant_experiment_code,
                "tray_code": occupant_tray_code,
                "run_tray_status": occupant_status,
            }
        ],
        "mes.experiment_trays": [
            {
                "task_code": target_task_code,
                "experiment_code": target_experiment_code,
                "tray_code": target_tray_code,
            },
            {
                "task_code": occupant_task_code,
                "experiment_code": occupant_experiment_code,
                "tray_code": occupant_tray_code,
            },
        ],
    }
    request = {
        "targetLab": "冲击一室",
        "targetLabCode": "LAB_IMPACT_1",
        "targetExperimentCode": target_experiment_code,
        "targetExperimentName": "冲击试验",
        "scheduleId": "SCH-LAB-OCCUPANCY-TARGET",
        "targetType": "lab",
    }
    return payloads, request, target_tray_code


@pytest.mark.parametrize(
    ("occupant_status", "same_task"),
    [
        pytest.param("实验进行中", False, id="other-task-running"),
        pytest.param("实验进行中", True, id="same-task-other-tray-running"),
        pytest.param("实验已完成", False, id="completed-but-tray-not-pushed-out"),
    ],
)
def test_storage_stock_out_rejects_lab_occupied_by_unreleased_run(monkeypatch, occupant_status, same_task):
    payloads, request, target_tray_code = _storage_lab_occupancy_stock_out_payload(
        occupant_status=occupant_status,
        same_task=same_task,
    )
    client, storage = build_client(monkeypatch, payloads)
    original_samples = storage.read("mes.samples")

    response = client.post(
        f"/api/storage/rooms/staging/trays/{target_tray_code}/stock-out",
        json=request,
    )

    assert response.status_code == 409
    assert "尚未推出" in response.json()["detail"]
    assert storage.read("mes.samples") == original_samples
    assert storage.read("mes.staging_events") == []


def test_storage_scoped_stock_out_reads_global_lab_occupancy_before_task_scoped_write(monkeypatch):
    payloads, request, target_tray_code = _storage_lab_occupancy_stock_out_payload(
        occupant_status="实验进行中",
    )
    storage = ScopedTrayActionStorage(
        payloads,
        tray_task_codes={target_tray_code: "TASK-LAB-OCCUPANCY-TARGET"},
    )
    client, _storage = build_client_with_storage(monkeypatch, storage)

    response = client.post(
        f"/api/storage/rooms/staging/trays/{target_tray_code}/stock-out",
        json=request,
    )

    assert response.status_code == 409
    assert storage.scope_reads[-1][0] == {"TASK-LAB-OCCUPANCY-TARGET"}
    assert storage.read_many_calls == [
        ("mes.samples", "mes.experiment_runs", "mes.experiment_run_trays")
    ]
    assert storage.scope_writes == []


def test_storage_scoped_stock_out_keeps_global_occupancy_rows_out_of_task_write(monkeypatch):
    payloads, request, target_tray_code = _storage_lab_occupancy_stock_out_payload(
        occupant_status="实验已完成",
        pushed_out=True,
    )
    storage = ScopedTrayActionStorage(
        payloads,
        tray_task_codes={target_tray_code: "TASK-LAB-OCCUPANCY-TARGET"},
    )
    client, _storage = build_client_with_storage(monkeypatch, storage)

    response = client.post(
        f"/api/storage/rooms/staging/trays/{target_tray_code}/stock-out",
        json=request,
    )

    assert response.status_code == 200
    assert storage.read_many_calls == [
        ("mes.samples", "mes.experiment_runs", "mes.experiment_run_trays")
    ]
    written_samples = storage.scope_writes[-1][1]["mes.samples"]
    assert {sample["task_code"] for sample in written_samples} == {"TASK-LAB-OCCUPANCY-TARGET"}
    assert any(sample["task_code"] == "TASK-LAB-OCCUPANCY-OTHER" for sample in storage.payloads["mes.samples"])


def test_storage_stock_out_allows_lab_after_completed_run_tray_is_pushed_out(monkeypatch):
    payloads, request, target_tray_code = _storage_lab_occupancy_stock_out_payload(
        occupant_status="实验已完成",
        pushed_out=True,
    )
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        f"/api/storage/rooms/staging/trays/{target_tray_code}/stock-out",
        json=request,
    )

    assert response.status_code == 200, response.json()
    target_sample = next(sample for sample in storage.read("mes.samples") if sample["code"] == "SP-LAB-OCCUPANCY-TARGET")
    assert target_sample["trays"][0]["status"] == "送至实验室"


def test_storage_stock_out_allows_same_experiment_trays_before_run_starts(monkeypatch):
    payloads, request, target_tray_code = _storage_lab_occupancy_stock_out_payload(
        occupant_status="已到达实验室",
        same_task=True,
    )
    payloads["mes.experiment_runs"] = []
    payloads["mes.experiment_run_trays"] = []
    payloads["mes.schedules"] = [payloads["mes.schedules"][0]]
    payloads["mes.experiments"] = []
    payloads["mes.samples"][1]["trays"][0]["target_experiment_code"] = request["targetExperimentCode"]
    payloads["mes.experiment_trays"][1]["experiment_code"] = request["targetExperimentCode"]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        f"/api/storage/rooms/staging/trays/{target_tray_code}/stock-out",
        json=request,
    )

    assert response.status_code == 200
    target_sample = next(sample for sample in storage.read("mes.samples") if sample["code"] == "SP-LAB-OCCUPANCY-TARGET")
    assert target_sample["trays"][0]["status"] == "送至实验室"


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
        "mes.experiment_trays": [
            {"task_code": "TASK-READ-COUNT", "experiment_code": "TASK-READ-COUNT-A", "tray_code": "TP-READ-COUNT"}
        ],
        "mes.experiment_run_trays": [],
        "mes.schedules": [
            {
                "id": "SCH-READ-COUNT",
                "task_code": "TASK-READ-COUNT",
                "experiment_code": "TASK-READ-COUNT-A",
                "device": "冲击一室",
                "lab_code": "LAB_IMPACT_1",
                "status": "已排程",
                "start_at": "2099-01-01 09:00:00",
            }
        ],
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
            "scheduleId": "SCH-READ-COUNT",
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


def test_storage_tray_stock_in_action_accepts_prefixed_tray_qr_payload(monkeypatch):
    samples = [
        {
            "code": "SP-IN-QR",
            "location": "恒温恒湿间（暂存间）",
            "status": "送至暂存间",
            "flow_status": "送至暂存间",
            "task_code": "TASK-IN-QR",
            "trays": [{"tray_code": "TP-IN-QR", "status": "送至暂存间", "quantity": 1}],
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.samples": samples, "mes.staging_events": []})

    response = client.post("/api/storage/rooms/staging/trays/MES-TRAY:TP-IN-QR/stock-in", json={})

    assert response.status_code == 200
    assert response.json()["trayCode"] == "TP-IN-QR"
    assert storage.read("mes.staging_events")[-1]["tray_code"] == "TP-IN-QR"


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
    assert storage.read("mes.staging_events")[-1]["location"] == "外观检测间"
    assert storage.read("mes.staging_events")[-1]["status"] == "实验前外观检测间存放"
    assert storage.read("mes.staging_events")[-1]["appearance_phase"] == "pre_experiment"
    assert storage.read("mes.staging_events")[-1]["target_experiment_code"] == "EXP-MOLD"


def test_storage_tray_stock_in_action_rejects_repeat_after_appearance_to_staging(monkeypatch):
    samples = [
        {
            "code": "SP-PRE-APPEARANCE-STAGING-REPEAT",
            "location": "霉菌试验室",
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "task_code": "TASK-PRE-APPEARANCE-STAGING-REPEAT",
            "trays": [
                {
                    "tray_code": "TP-PRE-APPEARANCE-STAGING-REPEAT",
                    "status": "送至实验室",
                    "quantity": 1,
                    "target_lab": "霉菌试验室",
                    "target_experiment_code": "EXP-MOLD-STAGING-REPEAT",
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
                    "task_code": "TASK-PRE-APPEARANCE-STAGING-REPEAT",
                    "experiment_code": "EXP-MOLD-STAGING-REPEAT",
                    "experiment_name": "霉菌试验",
                }
            ],
            "mes.staging_events": [
                {
                    "id": "pre-appearance-staging-in",
                    "tray_code": "TP-PRE-APPEARANCE-STAGING-REPEAT",
                    "task_code": "TASK-PRE-APPEARANCE-STAGING-REPEAT",
                    "room": "appearance",
                    "action": "stock_in",
                    "appearance_phase": "pre_experiment",
                    "target_experiment_code": "EXP-MOLD-STAGING-REPEAT",
                    "time": "2026-06-06T21:40:00",
                },
                {
                    "id": "pre-appearance-staging-out",
                    "tray_code": "TP-PRE-APPEARANCE-STAGING-REPEAT",
                    "task_code": "TASK-PRE-APPEARANCE-STAGING-REPEAT",
                    "room": "appearance",
                    "action": "stock_out",
                    "appearance_phase": "pre_experiment",
                    "target_lab": "恒温恒湿间（暂存间）",
                    "target_type": "staging",
                    "time": "2026-06-06T21:41:00",
                },
            ],
        },
    )

    response = client.post(
        "/api/storage/rooms/appearance/trays/TP-PRE-APPEARANCE-STAGING-REPEAT/stock-in",
        json={"status": "实验前外观检测间存放", "location": "外观检测间"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "该托盘已完成实验前外观检测并出库，不能重复入库外观检测间。"
    assert storage.read("mes.staging_events") == [
        {
            "id": "pre-appearance-staging-in",
            "tray_code": "TP-PRE-APPEARANCE-STAGING-REPEAT",
            "task_code": "TASK-PRE-APPEARANCE-STAGING-REPEAT",
            "room": "appearance",
            "action": "stock_in",
            "appearance_phase": "pre_experiment",
            "target_experiment_code": "EXP-MOLD-STAGING-REPEAT",
            "time": "2026-06-06T21:40:00",
        },
        {
            "id": "pre-appearance-staging-out",
            "tray_code": "TP-PRE-APPEARANCE-STAGING-REPEAT",
            "task_code": "TASK-PRE-APPEARANCE-STAGING-REPEAT",
            "room": "appearance",
            "action": "stock_out",
            "appearance_phase": "pre_experiment",
            "target_lab": "恒温恒湿间（暂存间）",
            "target_type": "staging",
            "time": "2026-06-06T21:41:00",
        },
    ]


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
    assert storage.read("mes.staging_events")[-1]["location"] == "外观检测间"
    assert storage.read("mes.staging_events")[-1]["status"] == "实验后外观检测间存放"


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
    client, storage = build_client(
        monkeypatch,
        {
            "mes.samples": samples,
            "mes.staging_events": [],
            "mes.schedules": [
                {
                    "id": "SCH-STAGING-REPEAT",
                    "task_code": "TASK-STAGING-REPEAT",
                    "experiment_code": "TASK-STAGING-REPEAT-A",
                    "device": "冲击一室",
                    "status": "已排程",
                    "start_at": "2099-01-01 09:00:00",
                }
            ],
            "mes.experiment_trays": [
                {"task_code": "TASK-STAGING-REPEAT", "experiment_code": "TASK-STAGING-REPEAT-A", "tray_code": "TP-STAGING-REPEAT"}
            ],
        },
    )
    payload = {
        "targetLab": "冲击一室",
        "targetExperimentCode": "TASK-STAGING-REPEAT-A",
        "scheduleId": "SCH-STAGING-REPEAT",
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
            "mes.experiments": [
                {
                    "task_code": "TASK-RETURN",
                    "experiment_code": "TASK-RETURN-A",
                    "experiment_name": "冲击试验",
                    "status": "实验进行中",
                }
            ],
            "mes.experiment_trays": [
                {"task_code": "TASK-RETURN", "experiment_code": "TASK-RETURN-A", "tray_code": "TP-RETURN-A"},
                {"task_code": "TASK-RETURN", "experiment_code": "TASK-RETURN-A", "tray_code": "TP-RETURN-B"},
            ],
            "mes.experiment_run_trays": [],
            "mes.schedules": [
                {
                    "id": "schedule-return-active-sibling",
                    "task_code": "TASK-RETURN",
                    "experiment_code": "TASK-RETURN-A",
                    "device": "冲击二室",
                    "status": "已排程",
                }
            ],
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
    assert [schedule["id"] for schedule in storage.read("mes.schedules")] == ["schedule-return-active-sibling"]
    assert storage.read("mes.staging_events")[-1]["action"] == "manufacturer_return"


def test_manufacturer_return_of_last_tray_releases_schedule_for_maintenance(monkeypatch):
    task_code = "TASK-RETURN-MAINTENANCE"
    tray_code = "TP-RETURN-MAINTENANCE"
    devices = [{"code": "冲击二室", "name": "冲击二室", "status": "可用"}]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.devices": devices,
            "mes.samples": [
                {
                    "code": "SP-RETURN-MAINTENANCE",
                    "location": "恒温恒湿间（实验后暂存间）",
                    "status": "实验后暂存间存放",
                    "flow_status": "实验后暂存间存放",
                    "task_code": task_code,
                    "trays": [{"tray_code": tray_code, "status": "实验后暂存间存放", "quantity": 1}],
                }
            ],
            "mes.tasks": [{"code": task_code, "transfer_status": "任务进行中"}],
            "mes.experiments": [
                {
                    "task_code": task_code,
                    "experiment_code": f"{task_code}-A",
                    "experiment_name": "冲击试验",
                    "status": "实验进行中",
                }
            ],
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": tray_code}
            ],
            "mes.experiment_run_trays": [],
            "mes.schedules": [
                {
                    "id": "schedule-return-maintenance",
                    "task_code": task_code,
                    "experiment_code": f"{task_code}-A",
                    "device": "冲击二室",
                    "start_at": "2099-03-20 09:00",
                    "end_at": "2099-03-20 11:00",
                    "status": "已排程",
                }
            ],
            "mes.staging_events": [],
        },
    )

    returned = client.post(f"/api/storage/rooms/staging/trays/{tray_code}/manufacturer-return", json={})
    maintenance = client.put(
        "/api/storage",
        json={
            "mes.devices": [
                {
                    **devices[0],
                    "maintenance_start_at": "2099-03-20 10:00",
                    "maintenance_end_at": "",
                    "maintenance_type": "计划保养",
                }
            ]
        },
    )

    assert returned.status_code == 200
    assert storage.read("mes.schedules") == []
    assert maintenance.status_code == 200


def test_manufacturer_return_of_completed_real_workflow_bypasses_manual_schedule_delete_lock(monkeypatch):
    from app.api.routes import storage as storage_route

    monkeypatch.setattr(storage_route, "now_business_text", lambda: "2026-07-22 10:00:00")
    task_code = "SYLU-2026-07-021"
    tray_code = f"{task_code}-TP-001"
    experiment_codes = [f"{task_code}-{suffix}" for suffix in ("A", "B", "C")]
    sub_experiment_codes = {
        experiment_codes[0]: [f"{experiment_codes[0]}-AXIS-001", f"{experiment_codes[0]}-AXIS-002"],
        experiment_codes[2]: [f"{experiment_codes[2]}-AXIS-001", f"{experiment_codes[2]}-AXIS-002"],
    }
    schedules = [
        {
            "id": "schedule-vibration-axis-001",
            "task_code": task_code,
            "experiment_code": experiment_codes[0],
            "sub_experiment_code": sub_experiment_codes[experiment_codes[0]][0],
            "axis_codes": ["x+", "x-", "y+"],
            "device": "振动一室",
            "status": "实验已完成",
        },
        {
            "id": "schedule-vibration-axis-002",
            "task_code": task_code,
            "experiment_code": experiment_codes[0],
            "sub_experiment_code": sub_experiment_codes[experiment_codes[0]][1],
            "axis_codes": ["y-", "z+", "z-"],
            "device": "振动一室",
            "status": "实验已完成",
        },
        {
            "id": "schedule-salt",
            "task_code": task_code,
            "experiment_code": experiment_codes[1],
            "device": "盐雾试验室",
            "status": "实验已完成",
        },
        {
            "id": "schedule-impact-axis-001",
            "task_code": task_code,
            "experiment_code": experiment_codes[2],
            "sub_experiment_code": sub_experiment_codes[experiment_codes[2]][0],
            "axis_codes": ["x+", "x-", "y+"],
            "device": "冲击一室",
            "status": "实验已完成",
        },
        {
            "id": "schedule-impact-axis-002",
            "task_code": task_code,
            "experiment_code": experiment_codes[2],
            "sub_experiment_code": sub_experiment_codes[experiment_codes[2]][1],
            "axis_codes": ["y-", "z+", "z-"],
            "device": "冲击一室",
            "status": "实验已完成",
        },
    ]
    run_trays = [
        {
            "run_no": f"run-{index}",
            "task_code": task_code,
            "experiment_code": schedule["experiment_code"],
            "sub_experiment_code": schedule.get("sub_experiment_code"),
            "tray_code": tray_code,
            "run_tray_status": "实验已完成",
        }
        for index, schedule in enumerate(schedules, start=1)
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.tasks": [{"code": task_code, "status": "任务已完成", "transfer_status": "到货"}],
            "mes.samples": [
                {
                    "code": f"{task_code}-SP-{index:03d}",
                    "task_code": task_code,
                    "location": "恒温恒湿间（实验后暂存间）",
                    "status": "实验后暂存间存放",
                    "flow_status": "实验后暂存间存放",
                    "trays": [{"tray_code": tray_code, "status": "实验后暂存间存放", "quantity": 1}],
                    "history": [],
                }
                for index in range(1, 3)
            ],
            "mes.experiments": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "status": "实验已完成",
                }
                for experiment_code in experiment_codes
            ],
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
                for experiment_code in experiment_codes
            ],
            "mes.experiment_run_trays": run_trays,
            "mes.schedules": schedules,
            "mes.staging_events": [],
        },
    )

    response = client.post(f"/api/storage/rooms/staging/trays/{tray_code}/manufacturer-return", json={})

    assert response.status_code == 200
    assert storage.read("mes.schedules") == []
    assert storage.read("mes.experiment_run_trays") == run_trays
    assert storage.read("mes.tasks")[0]["transfer_status"] == "厂家收回"
    for sample in storage.read("mes.samples"):
        assert sample["location"] == "厂家收回"
        assert sample["status"] == "厂家收回"
        assert sample["trays"][0]["status"] == "厂家收回"
        assert sample["history"][-1] == {
            "id": f"sample-event-{sample['code']}-1",
            "time": "2026-07-22 10:00:00",
            "action": "厂家收回",
            "location": "厂家收回",
            "owner": "扫码登记",
            "status": "厂家收回",
            "detail": f"{tray_code} 厂家收回",
        }
    assert storage.read("mes.staging_events")[-1]["time"] == "2026-07-22 10:00:00"


def test_manufacturer_return_after_partial_axis_completion_is_not_blocked_by_schedule_lock(monkeypatch):
    from app.api.routes import storage as storage_route

    monkeypatch.setattr(storage_route, "now_business_text", lambda: "2026-07-22 10:30:00")
    task_code = "TASK-PARTIAL-RETURN"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    first_sub_code = f"{experiment_code}-AXIS-001"
    second_sub_code = f"{experiment_code}-AXIS-002"
    client, storage = build_client(
        monkeypatch,
        {
            "mes.tasks": [{"code": task_code, "status": "任务进行中"}],
            "mes.samples": [
                {
                    "code": f"{task_code}-SP-001",
                    "task_code": task_code,
                    "location": "恒温恒湿间（实验后暂存间）",
                    "status": "实验后暂存间存放",
                    "flow_status": "实验后暂存间存放",
                    "trays": [{"tray_code": tray_code, "status": "实验后暂存间存放", "quantity": 1}],
                    "history": [],
                }
            ],
            "mes.experiments": [
                {
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "status": "冲击试验部分完成 3/6轴",
                }
            ],
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
            ],
            "mes.experiment_run_trays": [
                {
                    "run_no": "run-axis-001",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "tray_code": tray_code,
                    "run_tray_status": "实验已完成",
                }
            ],
            "mes.experiment_run_steps": [
                {
                    "run_no": "run-axis-001",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "axis_code": axis_code,
                    "status": "实验已完成",
                }
                for axis_code in ("x+", "x-", "y+")
            ],
            "mes.schedules": [
                {
                    "id": "schedule-axis-001",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": first_sub_code,
                    "axis_codes": ["x+", "x-", "y+"],
                    "status": "实验已完成",
                },
                {
                    "id": "schedule-axis-002",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sub_experiment_code": second_sub_code,
                    "axis_codes": ["y-", "z+", "z-"],
                    "status": "已排程",
                },
            ],
            "mes.staging_events": [],
        },
    )

    response = client.post(f"/api/storage/rooms/staging/trays/{tray_code}/manufacturer-return", json={})

    assert response.status_code == 200
    assert storage.read("mes.schedules") == []
    assert storage.read("mes.experiments")[0]["status"] == "实验已完成"
    assert storage.read("mes.samples")[0]["status"] == "厂家收回"
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
    storage = DelayedThreadSafeStorage({
        "mes.samples": samples,
        "mes.staging_events": [],
        "mes.schedules": [
            {
                "id": "SCH-CONCURRENT",
                "task_code": "TASK-CONCURRENT",
                "experiment_code": "TASK-CONCURRENT-A",
                "device": "冲击一室",
                "status": "已排程",
                "start_at": "2099-01-01 09:00:00",
            }
        ],
        "mes.experiment_trays": [
            {"task_code": "TASK-CONCURRENT", "experiment_code": "TASK-CONCURRENT-A", "tray_code": "TP-CONCURRENT"}
        ],
    })
    client, storage = build_client_with_storage(monkeypatch, storage)
    responses = []

    def stock_out():
        responses.append(
            client.post(
                "/api/storage/rooms/staging/trays/TP-CONCURRENT/stock-out",
                json={"targetLab": "冲击一室", "targetExperimentCode": "TASK-CONCURRENT-A", "scheduleId": "SCH-CONCURRENT", "targetType": "lab"},
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
    storage = DelayedThreadSafeStorage({
        "mes.samples": samples,
        "mes.staging_events": [],
        "mes.schedules": [
            {
                "id": "SCH-CONCURRENT-A",
                "task_code": "TASK-CONCURRENT-A",
                "experiment_code": "TASK-CONCURRENT-A-A",
                "device": "冲击一室",
                "status": "已排程",
                "start_at": "2099-01-01 09:00:00",
            }
        ],
        "mes.experiment_trays": [
            {"task_code": "TASK-CONCURRENT-A", "experiment_code": "TASK-CONCURRENT-A-A", "tray_code": "TP-CONCURRENT-A"}
        ],
    })
    client, storage = build_client_with_storage(monkeypatch, storage)
    responses = {}

    def stock_out():
        responses["stock_out"] = client.post(
            "/api/storage/rooms/staging/trays/TP-CONCURRENT-A/stock-out",
            json={"targetLab": "冲击一室", "targetExperimentCode": "TASK-CONCURRENT-A-A", "scheduleId": "SCH-CONCURRENT-A", "targetType": "lab"},
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
    assert "完成任务比对后排程不可删除" in response.json()["detail"]
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
    assert "完成任务比对后排程不可删除" in response.json()["detail"]
    assert storage.read("mes.schedules") == schedules


def test_storage_rejects_deleting_non_axis_schedule_after_task_comparison(monkeypatch):
    schedules = [{
        "id": "schedule-salt-compared",
        "task_code": "TASK-COMPARED",
        "experiment_code": "EXP-SALT",
        "device": "盐雾试验室",
        "status": "已排程",
    }]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.schedules": schedules,
            "mes.experiment_trays": [
                {"task_code": "TASK-COMPARED", "experiment_code": "EXP-SALT", "tray_code": "TP-COMPARED"}
            ],
            "mes.samples": [{
                "code": "SP-COMPARED",
                "task_code": "TASK-COMPARED",
                "status": "已到达实验室",
                "flow_status": "已到达实验室",
                "trays": [{"tray_code": "TP-COMPARED", "status": "已到达实验室", "quantity": 1}],
            }],
        },
    )

    response = client.put("/api/storage/mes.schedules", json=[])

    assert response.status_code == 400
    assert response.json()["detail"] == "完成任务比对后排程不可删除或重新排程。"
    assert storage.read("mes.schedules") == schedules


def test_storage_locks_compared_axis_schedule_but_allows_deleting_unstarted_sibling(monkeypatch):
    task_code = "TASK-AXIS-COMPARED"
    experiment_code = "EXP-IMPACT-COMPARED"
    active_sub_experiment_code = f"{experiment_code}-AXIS-001"
    future_sub_experiment_code = f"{experiment_code}-AXIS-002"
    schedules = [
        {
            "id": "schedule-axis-compared",
            "task_code": task_code,
            "experiment_code": experiment_code,
            "sub_experiment_code": active_sub_experiment_code,
            "axis_codes": ["x+", "x-", "y+", "y-"],
            "device": "冲击一室",
            "status": "已排程",
        },
        {
            "id": "schedule-axis-future",
            "task_code": task_code,
            "experiment_code": experiment_code,
            "sub_experiment_code": future_sub_experiment_code,
            "axis_codes": ["z+", "z-"],
            "device": "冲击二室",
            "status": "已排程",
        },
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.schedules": schedules,
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": experiment_code, "tray_code": "TP-AXIS-COMPARED"}
            ],
            "mes.samples": [{
                "code": "SP-AXIS-COMPARED",
                "task_code": task_code,
                "status": "已到达实验室",
                "flow_status": "已到达实验室",
                "trays": [{
                    "tray_code": "TP-AXIS-COMPARED",
                    "status": "已到达实验室",
                    "target_sub_experiment_code": active_sub_experiment_code,
                    "quantity": 1,
                }],
            }],
        },
    )

    active_response = client.put("/api/storage/mes.schedules", json=[schedules[1]])
    assert active_response.status_code == 400
    assert storage.read("mes.schedules") == schedules

    rescheduled = deepcopy(schedules)
    rescheduled[0]["device"] = "冲击二室"
    reschedule_response = client.put("/api/storage/mes.schedules", json=rescheduled)
    assert reschedule_response.status_code == 400
    assert storage.read("mes.schedules") == schedules

    future_response = client.put("/api/storage/mes.schedules", json=[schedules[0]])
    assert future_response.status_code == 200
    assert storage.read("mes.schedules") == [schedules[0]]


def test_storage_allows_deleting_untouched_shared_tray_experiment_while_salt_spray_is_running(monkeypatch):
    task_code = "SYLU-2026-07-031"
    salt_experiment_code = f"{task_code}-F"
    tray_code = f"{task_code}-TP-002"
    untouched_experiments = [
        (f"{task_code}-G", "schedule-temperature-shock-07-031", "温度冲击一室"),
        (f"{task_code}-H", "schedule-hot-humid-07-031", "高低温湿热一室"),
        (f"{task_code}-I", "schedule-mold-07-031", "霉菌试验室"),
    ]
    schedules = [
        {
            "id": "schedule-salt-07-031",
            "task_code": task_code,
            "experiment_code": salt_experiment_code,
            "device": "盐雾试验室",
            "status": "已排程",
        },
        *[
        {
            "id": schedule_id,
            "task_code": task_code,
            "experiment_code": experiment_code,
            "device": device,
            "status": "已排程",
        }
        for experiment_code, schedule_id, device in untouched_experiments
        ],
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.experiment_runs": [{
                "run_no": "run-salt-07-031",
                "schedule_id": "schedule-salt-07-031",
                "task_code": task_code,
                "experiment_code": salt_experiment_code,
                "status": "实验进行中",
            }],
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": salt_experiment_code, "tray_code": tray_code},
                *[
                    {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
                    for experiment_code, _schedule_id, _device in untouched_experiments
                ],
            ],
            "mes.samples": [{
                "code": f"{task_code}-SP-001",
                "task_code": task_code,
                "status": "实验进行中",
                "flow_status": "实验进行中",
                "trays": [{"tray_code": tray_code, "status": "实验进行中", "quantity": 5}],
            }],
            "mes.schedules": schedules,
        },
    )

    untouched_response = client.put("/api/storage/mes.schedules", json=[schedules[0]])
    assert untouched_response.status_code == 200
    assert storage.read("mes.schedules") == [schedules[0]]

    running_response = client.put("/api/storage/mes.schedules", json=[])
    assert running_response.status_code == 400
    assert running_response.json()["detail"] == "完成任务比对后排程不可删除或重新排程。"
    assert storage.read("mes.schedules") == [schedules[0]]


def test_storage_ignores_derived_running_status_for_untouched_schedule_after_shared_tray_return(monkeypatch):
    task_code = "SYLU-2026-07-030"
    salt_experiment_code = f"{task_code}-G"
    future_experiment_code = f"{task_code}-B"
    returned_tray_code = f"{task_code}-TP-001"
    waiting_tray_code = f"{task_code}-TP-002"
    schedules = [
        {
            "id": "schedule-future-07-030",
            "task_code": task_code,
            "experiment_code": future_experiment_code,
            "device": "高低温湿热一室",
            "status": "实验进行中",
        },
        {
            "id": "schedule-salt-07-030",
            "task_code": task_code,
            "experiment_code": salt_experiment_code,
            "device": "盐雾试验室",
            "status": "实验进行中",
        },
    ]
    client, storage = build_client(
        monkeypatch,
        {
            "mes.experiment_runs": [{
                "run_no": "run-salt-07-030",
                "schedule_id": "schedule-salt-07-030",
                "task_code": task_code,
                "experiment_code": salt_experiment_code,
                "status": "实验已完成",
            }],
            "mes.experiment_run_trays": [
                {
                    "run_no": f"RETURNED-{future_experiment_code}",
                    "task_code": task_code,
                    "experiment_code": future_experiment_code,
                    "tray_code": returned_tray_code,
                    "run_tray_status": "厂家收回",
                },
                {
                    "run_no": "run-salt-07-030",
                    "task_code": task_code,
                    "experiment_code": salt_experiment_code,
                    "tray_code": returned_tray_code,
                    "run_tray_status": "实验已完成",
                },
            ],
            "mes.experiment_trays": [
                {"task_code": task_code, "experiment_code": future_experiment_code, "tray_code": returned_tray_code},
                {"task_code": task_code, "experiment_code": future_experiment_code, "tray_code": waiting_tray_code},
                {"task_code": task_code, "experiment_code": salt_experiment_code, "tray_code": returned_tray_code},
                {"task_code": task_code, "experiment_code": salt_experiment_code, "tray_code": waiting_tray_code},
            ],
            "mes.samples": [
                {
                    "code": f"{task_code}-SP-001",
                    "task_code": task_code,
                    "status": "厂家收回",
                    "flow_status": "厂家收回",
                    "trays": [{
                        "tray_code": returned_tray_code,
                        "status": "厂家收回",
                        "target_experiment_code": salt_experiment_code,
                    }],
                },
                {
                    "code": f"{task_code}-SP-011",
                    "task_code": task_code,
                    "status": "已到达暂存间",
                    "flow_status": "已到达暂存间",
                    "trays": [{"tray_code": waiting_tray_code, "status": "已到达暂存间"}],
                },
            ],
            "mes.schedules": schedules,
        },
    )

    future_response = client.put("/api/storage/mes.schedules", json=[schedules[1]])
    assert future_response.status_code == 200
    assert storage.read("mes.schedules") == [schedules[1]]

    completed_response = client.put("/api/storage/mes.schedules", json=[])
    assert completed_response.status_code == 400
    assert completed_response.json()["detail"] == "完成任务比对后排程不可删除或重新排程。"
    assert storage.read("mes.schedules") == [schedules[1]]


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


def test_storage_rejects_deleting_partially_completed_multi_axis_schedule(monkeypatch):
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

    assert response.status_code == 400
    assert "完成任务比对后排程不可删除" in response.json()["detail"]
    assert storage.read("mes.schedules") == schedules
    assert storage.read("mes.experiment_run_steps") == experiment_run_steps


def test_storage_rejects_maintenance_window_over_existing_schedule(monkeypatch):
    schedules = [
        {
            "id": "schedule-maintenance-conflict",
            "task_code": "TASK-MAINTENANCE",
            "experiment_code": "EXP-MAINTENANCE",
            "device": "冲击一室",
            "start_at": "2099-03-20 09:00",
            "end_at": "2099-03-20 11:00",
            "status": "已排程",
        }
    ]
    devices = [{"code": "冲击一室", "name": "冲击一室", "status": "可用"}]
    client, storage = build_client(monkeypatch, {"mes.devices": devices, "mes.schedules": schedules})
    attempted_devices = [
        {
            "code": "冲击一室",
            "name": "冲击一室",
            "status": "可用",
            "maintenance_start_at": "2099-03-20 10:00",
            "maintenance_end_at": "",
            "maintenance_type": "计划保养",
        }
    ]

    response = client.put("/api/storage", json={"mes.devices": attempted_devices})

    assert response.status_code == 409
    assert "维保窗口内已有排程" in response.json()["detail"]
    assert storage.read("mes.devices") == devices


def test_storage_allows_unrelated_device_save_when_historical_maintenance_conflict_is_unchanged(monkeypatch):
    schedules = [
        {
            "id": "schedule-historical-maintenance-conflict",
            "task_code": "TASK-HISTORICAL",
            "experiment_code": "EXP-HISTORICAL",
            "device": "冲击一室",
            "start_at": "2099-03-20 09:00",
            "end_at": "2099-03-20 11:00",
            "status": "已排程",
        }
    ]
    devices = [
        {
            "code": "冲击一室",
            "name": "冲击一室",
            "status": "可用",
            "maintenance_start_at": "2099-03-20 10:00",
            "maintenance_end_at": "",
            "maintenance_type": "计划维修",
        },
        {"code": "振动一室", "name": "振动一室", "owner": "原负责人", "status": "可用"},
    ]
    client, storage = build_client(monkeypatch, {"mes.devices": devices, "mes.schedules": schedules})
    attempted_devices = [
        devices[0],
        {**devices[1], "owner": "新负责人"},
    ]

    response = client.put("/api/storage", json={"mes.devices": attempted_devices})

    assert response.status_code == 200
    assert storage.read("mes.devices") == attempted_devices


@pytest.mark.parametrize(
    ("start_at", "end_at"),
    [
        ("2099-03-20 10:00", "2099-03-20 10:00"),
        ("2099-03-20 10:00", "2099-03-20 09:00"),
    ],
)
def test_storage_rejects_maintenance_window_ending_at_or_before_start(monkeypatch, start_at, end_at):
    existing_devices = [{"code": "冲击一室", "name": "冲击一室", "status": "可用"}]
    client, storage = build_client(monkeypatch, {"mes.devices": existing_devices})
    attempted_devices = [
        {
            "code": "冲击一室",
            "name": "冲击一室",
            "status": "可用",
            "maintenance_start_at": start_at,
            "maintenance_end_at": end_at,
            "maintenance_type": "计划维修",
        }
    ]

    response = client.put("/api/storage", json={"mes.devices": attempted_devices})

    assert response.status_code == 422
    assert response.json()["detail"] == "维保结束时间必须晚于开始时间"
    assert storage.read("mes.devices") == existing_devices


def test_storage_keeps_end_time_error_when_planned_start_is_also_in_the_past(monkeypatch):
    monkeypatch.setattr(
        "app.services.storage_schedule_patch.now_business_datetime",
        lambda: datetime(2099, 3, 20, 7, 30),
    )
    existing_devices = [{"code": "冲击一室", "name": "冲击一室", "status": "可用"}]
    client, storage = build_client(monkeypatch, {"mes.devices": existing_devices})
    attempted_devices = [{
        **existing_devices[0],
        "maintenance_start_at": "2099-03-20 07:29",
        "maintenance_end_at": "2099-03-20 07:28",
        "maintenance_type": "计划维修",
    }]

    response = client.put("/api/storage", json={"mes.devices": attempted_devices})

    assert response.status_code == 422
    assert response.json()["detail"] == "维保结束时间必须晚于开始时间"
    assert storage.read("mes.devices") == existing_devices


@pytest.mark.parametrize("maintenance_type", ["计划维修", "计划保养"])
def test_storage_rejects_planned_maintenance_starting_before_current_time(monkeypatch, maintenance_type):
    monkeypatch.setattr(
        "app.services.storage_schedule_patch.now_business_datetime",
        lambda: datetime(2099, 3, 20, 7, 30),
    )
    existing_devices = [{"code": "冲击一室", "name": "冲击一室", "status": "可用"}]
    client, storage = build_client(monkeypatch, {"mes.devices": existing_devices})
    attempted_devices = [
        {
            "code": "冲击一室",
            "name": "冲击一室",
            "status": "可用",
            "maintenance_start_at": "2099-03-20 07:29",
            "maintenance_end_at": "",
            "maintenance_type": maintenance_type,
        }
    ]

    response = client.put("/api/storage", json={"mes.devices": attempted_devices})

    assert response.status_code == 422
    assert response.json()["detail"] == "维保开始时间不得早于当前时间"
    assert storage.read("mes.devices") == existing_devices


def test_storage_allows_planned_maintenance_starting_at_current_time(monkeypatch):
    monkeypatch.setattr(
        "app.services.storage_schedule_patch.now_business_datetime",
        lambda: datetime(2099, 3, 20, 7, 30),
    )
    existing_devices = [{"code": "冲击一室", "name": "冲击一室", "status": "可用"}]
    attempted_devices = [
        {
            **existing_devices[0],
            "maintenance_start_at": "2099-03-20 07:30",
            "maintenance_end_at": "",
            "maintenance_type": "计划维修",
        }
    ]
    client, storage = build_client(monkeypatch, {"mes.devices": existing_devices})

    response = client.put("/api/storage", json={"mes.devices": attempted_devices})

    assert response.status_code == 200
    assert storage.read("mes.devices") == attempted_devices


def test_storage_allows_editing_a_device_with_an_unchanged_historical_plan(monkeypatch):
    monkeypatch.setattr(
        "app.services.storage_schedule_patch.now_business_datetime",
        lambda: datetime(2099, 3, 20, 7, 30),
    )
    existing_devices = [
        {
            "code": "冲击一室",
            "name": "冲击一室",
            "owner": "原负责人",
            "status": "维修",
            "maintenance_start_at": "2020-03-20 07:00",
            "maintenance_end_at": "",
            "maintenance_type": "计划保养",
        }
    ]
    attempted_devices = [{**existing_devices[0], "owner": "新负责人"}]
    client, storage = build_client(monkeypatch, {"mes.devices": existing_devices})

    response = client.put("/api/storage", json={"mes.devices": attempted_devices})

    assert response.status_code == 200
    assert storage.read("mes.devices") == attempted_devices


def test_storage_rejects_maintenance_end_time_without_a_valid_start_time(monkeypatch):
    existing_devices = [{"code": "冲击一室", "name": "冲击一室", "status": "可用"}]
    client, storage = build_client(monkeypatch, {"mes.devices": existing_devices})
    attempted_devices = [
        {
            "code": "冲击一室",
            "name": "冲击一室",
            "status": "可用",
            "maintenance_start_at": "",
            "maintenance_end_at": "2099-03-20 10:00",
            "maintenance_type": "计划维修",
        }
    ]

    response = client.put("/api/storage", json={"mes.devices": attempted_devices})

    assert response.status_code == 422
    assert response.json()["detail"] == "维保结束时间需要有效的开始时间"
    assert storage.read("mes.devices") == existing_devices


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


def test_storage_schedule_patch_reads_bounded_key_set_without_full_snapshot(monkeypatch):
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
    storage = ReadManyStorage({"mes.schedules": [existing_schedule]})
    client, _storage = build_client_with_storage(monkeypatch, storage)

    response = client.post(
        "/api/storage/schedules/patch",
        json={"upserts": {"mes.schedules": [new_schedule]}},
    )

    assert response.status_code == 200
    assert storage.payloads["mes.schedules"] == [existing_schedule, new_schedule]
    assert len(storage.read_many_calls) == 1
    assert set(storage.read_many_calls[0]) == {
        "mes.conflicts",
        "mes.devices",
        "mes.experiment_run_steps",
        "mes.experiment_run_trays",
        "mes.experiment_runs",
        "mes.experiment_trays",
        "mes.experiments",
        "mes.samples",
        "mes.schedules",
        "mes.streams",
        "mes.tasks",
    }


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


def test_storage_schedule_patch_rejects_schedule_inside_maintenance_window(monkeypatch):
    device = {
        "code": "高低温湿热一室",
        "name": "高低温湿热一室",
        "status": "可用",
        "maintenance_start_at": "2099-03-20 08:00",
        "maintenance_end_at": "",
        "maintenance_type": "计划维修",
    }
    schedule = {
        "id": "schedule-maintenance-window",
        "task_code": "TASK-MAINTENANCE-WINDOW",
        "experiment_code": "EXP-MAINTENANCE-WINDOW",
        "device": "高低温湿热一室",
        "start_at": "2099-03-21 09:00",
        "end_at": "2099-03-21 10:00",
        "status": "已排程",
    }
    client, storage = build_client(monkeypatch, {"mes.devices": [device], "mes.schedules": []})

    response = client.post(
        "/api/storage/schedules/patch",
        json={"upserts": {"mes.schedules": [schedule]}},
    )

    assert response.status_code == 409
    assert "维修状态" in response.json()["detail"]
    assert storage.read("mes.schedules") == []


def test_storage_update_event_stream_yields_published_keys():
    from app.api.routes import storage as storage_route

    async def exercise_stream():
        stream = storage_route._storage_update_event_stream()
        try:
            assert await anext(stream) == ": connected\n\n"
            storage_route.publish_storage_update(["mes.samples"], source="staging-management", request_id="write-1")
            return await anext(stream)
        finally:
            await stream.aclose()

    event = asyncio.run(exercise_stream())

    assert event.startswith("data: ")
    assert '"keys": ["mes.samples"]' in event
    assert '"source": "staging-management"' in event
    assert '"requestId": "write-1"' in event
    assert '"updatedAt":' in event
    assert '"version":' in event


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


def test_storage_partial_axis_reentry_is_blocked_only_after_a_newer_lab_attempt():
    from app.api.routes.storage import _normal_staging_reentry_is_partial_axis_batch

    task_code = "TASK-PARTIAL-REENTRY"
    experiment_code = f"{task_code}-A"
    tray_code = f"{task_code}-TP-001"
    first_sub_code = f"{experiment_code}-AXIS-001"
    second_sub_code = f"{experiment_code}-AXIS-002"
    sample = {
        "code": f"{task_code}-SP-001",
        "task_code": task_code,
        "status": "实验进行中",
        "flow_status": "实验进行中",
        "trays": [{"tray_code": tray_code, "status": "实验进行中"}],
        "history": [
            {
                "action": "实验完成",
                "status": "冲击试验部分完成 1/2轴",
                "detail": f"{task_code} / 冲击试验 / 冲击试验部分完成 1/2轴",
                "time": "2026-07-16 10:00:00",
            }
        ],
    }
    tray = sample["trays"][0]
    experiments = [
        {
            "task_code": task_code,
            "experiment_code": experiment_code,
            "experiment_name": "冲击试验",
            "axis_codes": ["x+", "x-"],
        }
    ]
    schedules = [
        {
            "id": "schedule-axis-001",
            "task_code": task_code,
            "experiment_code": experiment_code,
            "sub_experiment_code": first_sub_code,
            "axis_codes": ["x+"],
            "status": "实验已完成",
        },
        {
            "id": "schedule-axis-002",
            "task_code": task_code,
            "experiment_code": experiment_code,
            "sub_experiment_code": second_sub_code,
            "axis_codes": ["x-"],
            "status": "已排程",
        },
    ]
    experiment_runs = [
        {
            "run_no": "run-axis-001",
            "schedule_id": "schedule-axis-001",
            "task_code": task_code,
            "experiment_code": experiment_code,
            "sub_experiment_code": first_sub_code,
            "axis_codes": ["x+"],
            "status": "实验已完成",
            "ended_at": "2026-07-16 10:00:00",
        }
    ]
    experiment_run_trays = [
        {
            "run_no": "run-axis-001",
            "task_code": task_code,
            "experiment_code": experiment_code,
            "sub_experiment_code": first_sub_code,
            "tray_code": tray_code,
            "run_tray_status": "实验已完成",
            "ended_at": "2026-07-16 10:00:00",
        }
    ]
    arguments = {
        "sample": sample,
        "tray": tray,
        "experiments": experiments,
        "experiment_runs": experiment_runs,
        "experiment_run_steps": [],
        "experiment_trays": [{"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}],
        "experiment_run_trays": experiment_run_trays,
        "schedules": schedules,
    }

    assert _normal_staging_reentry_is_partial_axis_batch(**arguments) is True

    sample["history"].insert(
        0,
        {"action": "任务比对", "status": "已到达实验室", "time": "2026-07-16 10:01:00"},
    )
    assert _normal_staging_reentry_is_partial_axis_batch(**arguments) is False

    sample["history"].insert(
        0,
        {"action": "实验任务撤回", "status": "冲击试验部分完成 1/2轴", "time": "2026-07-16 10:02:00"},
    )
    assert _normal_staging_reentry_is_partial_axis_batch(**arguments) is True

    experiment_runs.append(
        {
            "run_no": "run-axis-002",
            "schedule_id": "schedule-axis-002",
            "task_code": task_code,
            "experiment_code": experiment_code,
            "sub_experiment_code": second_sub_code,
            "status": "实验进行中",
            "started_at": "2026-07-16 10:03:00",
        }
    )
    experiment_run_trays.append(
        {
            "run_no": "run-axis-002",
            "task_code": task_code,
            "experiment_code": experiment_code,
            "sub_experiment_code": second_sub_code,
            "tray_code": tray_code,
            "run_tray_status": "实验进行中",
            "started_at": "2026-07-16 10:03:00",
        }
    )
    assert _normal_staging_reentry_is_partial_axis_batch(**arguments) is False


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
