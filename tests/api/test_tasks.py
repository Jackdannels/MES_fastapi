from datetime import datetime, timezone
import re
import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient


class FakeTaskStorage:
    def __init__(
        self,
        tasks=None,
        external_task_intakes=None,
        schedules=None,
        samples=None,
        streams=None,
        experiments=None,
        experiment_trays=None,
        experiment_samples=None,
        experiment_runs=None,
        experiment_run_trays=None,
        experiment_run_steps=None,
        staging_events=None,
        conflicts=None,
        devices=None,
        meta=None,
    ):
        self.payloads = {
            "mes.tasks": list(tasks or []),
            "mes.external_task_intakes": list(external_task_intakes or []),
            "mes.schedules": list(schedules or []),
            "mes.samples": list(samples or []),
            "mes.streams": list(streams or []),
            "mes.experiments": list(experiments or []),
            "mes.experiment_trays": list(experiment_trays or []),
            "mes.experiment_samples": list(experiment_samples or []),
            "mes.experiment_runs": list(experiment_runs or []),
            "mes.experiment_run_trays": list(experiment_run_trays or []),
            "mes.experiment_run_steps": list(experiment_run_steps or []),
            "mes.staging_events": list(staging_events or []),
            "mes.conflicts": list(conflicts or []),
            "mes.devices": list(devices or []),
            "mes.meta": dict(meta or {}),
        }

    @staticmethod
    def _clone_value(value):
        if isinstance(value, list):
            return list(value)
        if isinstance(value, dict):
            return dict(value)
        return value

    def read(self, key):
        return self._clone_value(self.payloads.get(key, []))

    def read_all(self):
        return {key: self._clone_value(value) for key, value in self.payloads.items()}

    def write(self, key, value):
        self.payloads[key] = self._clone_value(value)

    def write_many(self, updates):
        for key, value in updates.items():
            self.payloads[key] = self._clone_value(value)


def build_client(
    monkeypatch,
    tasks=None,
    external_task_intakes=None,
    schedules=None,
    samples=None,
    streams=None,
    experiments=None,
    experiment_trays=None,
    experiment_samples=None,
    experiment_runs=None,
    experiment_run_trays=None,
    experiment_run_steps=None,
    staging_events=None,
    conflicts=None,
    devices=None,
    meta=None,
):
    from app.api.routes import tasks as tasks_route

    storage = FakeTaskStorage(
        tasks=tasks,
        external_task_intakes=external_task_intakes,
        schedules=schedules,
        samples=samples,
        streams=streams,
        experiments=experiments,
        experiment_trays=experiment_trays,
        experiment_samples=experiment_samples,
        experiment_runs=experiment_runs,
        experiment_run_trays=experiment_run_trays,
        experiment_run_steps=experiment_run_steps,
        staging_events=staging_events,
        conflicts=conflicts,
        devices=devices,
        meta=meta,
    )
    monkeypatch.setattr(tasks_route, "get_storage_backend", lambda: storage)

    app = FastAPI()
    app.state.storage = storage
    app.include_router(tasks_route.router)
    return TestClient(app)


def test_tasks_router_supports_full_lifecycle(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "SYLU-2026-03-001",
                "code": "SYLU-2026-03-001",
                "name": "冲击试验-批次A",
                "status": "待排程",
            }
        ],
    )

    listed = client.get("/api/tasks")
    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-03-002",
            "code": "SYLU-2026-03-002",
            "name": "霉菌试验",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "2",
            "test_type": "霉菌试验 / 盐雾试验",
            "test_types": ["霉菌试验", "盐雾试验"],
            "status": "待排程",
        },
    )
    updated = client.put(
        "/api/tasks/SYLU-2026-03-002",
        json={
            "id": "SYLU-2026-03-002",
            "code": "SYLU-2026-03-003",
            "name": "霉菌试验-改",
            "status": "已排程",
        },
    )
    deleted = client.delete("/api/tasks/SYLU-2026-03-001")
    remaining = client.get("/api/tasks")

    assert listed.status_code == 200
    assert listed.json()[0]["code"] == "SYLU-2026-03-001"
    assert created.status_code == 201
    assert created.json()["code"] == "SYLU-2026-03-002"
    assert created.json()["experiment_count"] == 2
    assert len(created.json()["experiment_codes"]) == 2
    assert updated.status_code == 200
    assert updated.json()["code"] == "SYLU-2026-03-003"
    assert updated.json()["status"] == "已排程"
    assert updated.json()["experiment_count"] == 2
    assert deleted.status_code == 204
    assert [item["code"] for item in remaining.json()] == ["SYLU-2026-03-003"]
    assert remaining.json()[0]["experiment_count"] == 2
    assert len(remaining.json()[0]["experiment_codes"]) == 2


def test_manual_task_creation_forces_internal_source(monkeypatch):
    client = build_client(monkeypatch)

    response = client.post(
        "/api/tasks",
        json={
            "code": "SYLU-2026-07-001",
            "name": "内部任务",
            "source": "外部委托",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "2",
            "test_types": ["盐雾试验"],
        },
    )

    assert response.status_code == 201
    assert response.json()["source"] == "内部新增"


def test_lims_external_intake_stays_out_of_tasks_until_accepted(monkeypatch):
    from app.api.routes import tasks as tasks_route

    client = build_client(monkeypatch)
    payload = {
        "lims_request_id": "LIMS-REQUEST-001",
        "code": "SYLU-2026-07-021",
        "name": "LIMS委托021",
        "client": "37单位",
        "contact": "李四",
        "contact_info": "13900001234",
        "priority": "高",
        "sample_count": "3",
        "sample_type": "金属件",
        "test_types": ["盐雾试验", "振动试验"],
        "due_at": "2026-07-23 09:00",
        "arrival_at": "2026-07-16 09:00",
        "remark": "LIMS模拟下发",
    }

    received = tasks_route.store_external_task_intake(payload, message_id="MSG-001")
    duplicate = tasks_route.store_external_task_intake(payload, message_id="MSG-001")
    tasks_before = client.get("/api/tasks")
    pending_before = client.get("/api/tasks/external-intakes?status=pending")
    storage = client.app.state.storage

    assert client.post("/api/tasks/external-intakes", json=payload).status_code == 405
    assert received["source"] == "外部委托"
    assert received["acceptance_status"] == "pending"
    assert duplicate["intake_id"] == received["intake_id"]
    assert len(storage.read("mes.external_task_intakes")) == 1
    assert len(storage.read("mes.lims_inbox")) == 1
    assert len(storage.read("mes.lims_outbox")) == 1
    assert tasks_before.json() == []
    assert [item["code"] for item in pending_before.json()] == ["SYLU-2026-07-021"]

    accepted = client.post("/api/tasks/external-intakes/LIMS-REQUEST-001/accept")
    assert accepted.status_code == 200
    assert accepted.json()["task"]["source"] == "外部委托"
    assert accepted.json()["task"]["arrival_at"] == ""
    assert accepted.json()["intake"]["acceptance_status"] == "accepted"
    assert accepted.json()["task"]["accepted_at"] == accepted.json()["intake"]["accepted_at"]
    assert accepted.json()["task"]["accepted_at"]
    assert len(storage.read("mes.tasks")) == 1
    assert len(storage.read("mes.samples")) == 3
    assert len(storage.read("mes.experiments")) == 2
    assert client.get("/api/tasks/external-intakes?status=pending").json() == []

    accepted_again = client.post("/api/tasks/external-intakes/LIMS-REQUEST-001/accept")
    assert accepted_again.status_code == 200
    assert len(storage.read("mes.tasks")) == 1


def test_lims_external_intake_rejects_duplicate_request_and_task_code(monkeypatch):
    from app.api.routes import tasks as tasks_route

    existing = {
        "id": "LIMS-REQUEST-001",
        "intake_id": "LIMS-REQUEST-001",
        "lims_request_id": "LIMS-REQUEST-001",
        "code": "SYLU-2026-07-021",
        "acceptance_status": "pending",
    }
    client = build_client(monkeypatch, external_task_intakes=[existing])
    payload = {
        "lims_request_id": "LIMS-REQUEST-001",
        "code": "SYLU-2026-07-022",
        "client": "22单位",
        "contact": "王五",
        "contact_info": "13900001235",
        "sample_count": "1",
        "test_types": ["盐雾试验"],
    }

    with pytest.raises(Exception) as duplicate_request:
        tasks_route.store_external_task_intake(payload, message_id="MSG-002")
    payload["lims_request_id"] = "LIMS-REQUEST-002"
    payload["code"] = "SYLU-2026-07-021"
    with pytest.raises(Exception) as duplicate_code:
        tasks_route.store_external_task_intake(payload, message_id="MSG-003")

    assert duplicate_request.value.status_code == 409
    assert duplicate_code.value.status_code == 409


def test_list_tasks_reads_only_the_task_collection(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[{"id": "TASK-1", "code": "TASK-1", "status": "待排程"}],
    )
    storage = client.app.state.storage

    def fail_if_full_snapshot_is_loaded():
        raise AssertionError("list_tasks must not load the full storage snapshot")

    storage.read_all = fail_if_full_snapshot_is_loaded

    response = client.get("/api/tasks")

    assert response.status_code == 200
    assert [task["code"] for task in response.json()] == ["TASK-1"]


def test_delete_task_rejects_running_experiment(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "TASK-RUNNING",
                "code": "TASK-RUNNING",
                "name": "进行中任务",
                "status": "任务进行中",
            }
        ],
        experiment_runs=[
            {
                "task_code": "TASK-RUNNING",
                "experiment_code": "TASK-RUNNING-A",
                "status": "实验进行中",
            }
        ],
    )

    response = client.delete("/api/tasks/TASK-RUNNING")
    remaining = client.get("/api/tasks?includeArchived=true")

    assert response.status_code == 409
    assert response.json()["detail"] == "任务存在进行中的实验，不能删除任务"
    assert [item["code"] for item in remaining.json()] == ["TASK-RUNNING"]


def test_update_running_task_allows_name_only(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "TASK-RUNNING-EDIT",
                "code": "TASK-RUNNING-EDIT",
                "name": "进行中任务",
                "source": "外部委托",
                "priority": "中",
                "sample_count": "2",
                "sample_type": "金属件",
                "test_type": "盐雾试验",
                "test_types": ["盐雾试验"],
                "due_at": "2026-06-20 18:00",
                "status": "任务进行中",
            }
        ],
        experiment_runs=[
            {
                "task_code": "TASK-RUNNING-EDIT",
                "experiment_code": "TASK-RUNNING-EDIT-A",
                "status": "实验进行中",
            }
        ],
    )

    response = client.put(
        "/api/tasks/TASK-RUNNING-EDIT",
        json={
            "id": "TASK-RUNNING-EDIT",
            "code": "TASK-RUNNING-EDIT",
            "name": "进行中任务-修改",
            "source": "外部委托",
            "priority": "中",
            "sample_count": "2",
            "sample_type": "金属件",
            "test_type": "盐雾试验",
            "test_types": ["盐雾试验"],
            "due_at": "2026-06-20 18:00",
            "status": "任务进行中",
        },
    )
    stored_task = client.app.state.storage.read("mes.tasks")[0]

    assert response.status_code == 200
    assert response.json()["name"] == "进行中任务-修改"
    assert stored_task["name"] == "进行中任务-修改"
    assert stored_task["source"] == "外部委托"
    assert stored_task["priority"] == "中"
    assert stored_task["sample_type"] == "金属件"
    assert stored_task["test_types"] == ["盐雾试验"]
    assert stored_task["due_at"] == "2026-06-20 18:00"


def test_update_running_task_rejects_non_name_changes(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "TASK-RUNNING-EDIT-LOCKED",
                "code": "TASK-RUNNING-EDIT-LOCKED",
                "name": "进行中任务",
                "source": "外部委托",
                "priority": "中",
                "sample_count": "2",
                "sample_type": "金属件",
                "test_type": "盐雾试验",
                "test_types": ["盐雾试验"],
                "due_at": "2026-06-20 18:00",
                "status": "任务进行中",
            }
        ],
        experiment_runs=[
            {
                "task_code": "TASK-RUNNING-EDIT-LOCKED",
                "experiment_code": "TASK-RUNNING-EDIT-LOCKED-A",
                "status": "实验进行中",
            }
        ],
    )

    response = client.put(
        "/api/tasks/TASK-RUNNING-EDIT-LOCKED",
        json={
            "id": "TASK-RUNNING-EDIT-LOCKED",
            "code": "TASK-RUNNING-EDIT-LOCKED",
            "name": "进行中任务-修改",
            "source": "内部新增",
            "priority": "高",
            "sample_count": "2",
            "sample_type": "复合材料",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "due_at": "2026-06-21 18:00",
            "status": "任务进行中",
        },
    )
    stored_task = client.app.state.storage.read("mes.tasks")[0]

    assert response.status_code == 400
    assert response.json()["detail"] == "任务进行中，仅允许修改任务名称"
    assert stored_task["name"] == "进行中任务"
    assert stored_task["source"] == "外部委托"
    assert stored_task["priority"] == "中"
    assert stored_task["sample_type"] == "金属件"
    assert stored_task["test_types"] == ["盐雾试验"]
    assert stored_task["due_at"] == "2026-06-20 18:00"


def test_tasks_router_publishes_storage_updates_for_mutations(monkeypatch):
    from app.api.routes import tasks as tasks_route

    published_updates = []
    monkeypatch.setattr(tasks_route, "publish_storage_update", lambda keys: published_updates.append(list(keys)), raising=False)
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "SYLU-2026-03-001",
                "code": "SYLU-2026-03-001",
                "name": "冲击试验-批次A",
                "contact": "张三",
                "contact_info": "13800001234",
                "sample_count": "2",
                "test_types": ["冲击试验"],
                "status": "待排程",
            }
        ],
    )

    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-03-002",
            "code": "SYLU-2026-03-002",
            "name": "霉菌试验",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "2",
            "test_types": ["霉菌试验"],
            "status": "待排程",
        },
    )
    updated = client.put("/api/tasks/SYLU-2026-03-002", json={**created.json(), "name": "霉菌试验-改"})
    deleted = client.delete("/api/tasks/SYLU-2026-03-001")
    reset = client.post("/api/tasks/reset")

    assert created.status_code == 201
    assert updated.status_code == 200
    assert deleted.status_code == 204
    assert reset.status_code == 200
    assert len(published_updates) == 4
    for keys in published_updates:
        assert "mes.tasks" in keys
        assert "mes.samples" in keys
        assert "mes.experiments" in keys


def test_tasks_list_hides_returned_tasks_unless_archived_are_requested(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {"id": "task-active", "code": "TASK-ACTIVE", "name": "活跃任务", "status": "待排程"},
            {"id": "task-returned", "code": "TASK-RETURNED", "name": "历史任务", "status": "任务进行中", "transfer_status": "厂家收回"},
        ],
        samples=[
            {
                "id": "sample-active",
                "code": "TASK-ACTIVE-SP-001",
                "task_code": "TASK-ACTIVE",
                "status": "已入库",
                "trays": [{"tray_code": "TASK-ACTIVE-TP-001", "status": "已入库"}],
            },
            {
                "id": "sample-returned",
                "code": "TASK-RETURNED-SP-001",
                "task_code": "TASK-RETURNED",
                "status": "厂家收回",
                "trays": [{"tray_code": "TASK-RETURNED-TP-001", "status": "厂家收回"}],
            },
        ],
    )

    active = client.get("/api/tasks")
    archived = client.get("/api/tasks?includeArchived=true")

    assert active.status_code == 200
    assert [item["code"] for item in active.json()] == ["TASK-ACTIVE"]
    assert archived.status_code == 200
    assert [item["code"] for item in archived.json()] == ["TASK-ACTIVE", "TASK-RETURNED"]


def test_tasks_list_keeps_task_visible_when_only_sample_trays_are_returned(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {"id": "task-returned-samples", "code": "TASK-RETURNED-SAMPLES", "name": "样品已回收任务", "status": "任务进行中"},
        ],
        samples=[
            {
                "id": "sample-returned",
                "code": "TASK-RETURNED-SAMPLES-SP-001",
                "task_code": "TASK-RETURNED-SAMPLES",
                "status": "厂家收回",
                "flow_status": "厂家收回",
                "trays": [{"tray_code": "TASK-RETURNED-SAMPLES-TP-001", "status": "厂家收回"}],
            },
        ],
    )

    response = client.get("/api/tasks")

    assert response.status_code == 200
    assert [item["code"] for item in response.json()] == ["TASK-RETURNED-SAMPLES"]


def test_create_task_generates_experiments_from_test_types_in_order(monkeypatch):
    client = build_client(monkeypatch, tasks=[])

    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-04-105",
            "code": "SYLU-2026-04-105",
            "name": "高低温湿热试验-批次E",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "3",
            "test_type": "冲击试验 / 盐雾试验 / 温度冲击试验",
            "test_types": ["冲击试验", "盐雾试验", "温度冲击试验"],
            "required_device": "冲击试验 / 盐雾试验 / 温度冲击试验",
            "status": "待排程",
        },
    )

    storage = client.app.state.storage

    assert created.status_code == 201
    assert created.json()["experiment_count"] == 3
    assert created.json()["experiment_codes"] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]
    assert [item["experiment_code"] for item in storage.read("mes.experiments")] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]
    assert [item["experiment_name"] for item in storage.read("mes.experiments")] == [
        "冲击试验",
        "盐雾试验",
        "温度冲击试验",
    ]
    assert storage.read("mes.tasks")[0]["experiment_count"] == 3
    assert storage.read("mes.tasks")[0]["experiment_codes"] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]
    assert storage.read("mes.tasks")[0]["test_types"] == ["冲击试验", "盐雾试验", "温度冲击试验"]


def test_create_task_applies_axis_selection_to_axis_experiments(monkeypatch):
    client = build_client(monkeypatch, tasks=[])

    response = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-04-106",
            "code": "SYLU-2026-04-106",
            "name": "轴向选择任务",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "3",
            "test_type": "冲击试验 / 振动试验 / 盐雾试验",
            "test_types": ["冲击试验", "振动试验", "盐雾试验"],
            "axis_codes_by_test_type": {
                "冲击试验": ["x+", "z-"],
                "振动试验": ["y-"],
                "盐雾试验": ["x-"],
            },
            "status": "待排程",
        },
    )

    storage = client.app.state.storage
    experiments = storage.read("mes.experiments")

    assert response.status_code == 201
    assert [item.get("axis_codes") for item in experiments] == [["x+", "z-"], ["y-"], None]


def test_create_and_update_task_accept_all_experiment_types(monkeypatch):
    all_types = ["冲击试验", "振动试验", "四综合试验", "温度冲击试验", "高低温湿热试验", "盐雾试验", "霉菌试验"]
    client = build_client(monkeypatch, tasks=[])

    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-04-115",
            "code": "SYLU-2026-04-115",
            "name": "全实验类型任务",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "3",
            "test_type": " / ".join(all_types),
            "test_types": all_types,
            "required_device": " / ".join(all_types),
            "status": "待排程",
        },
    )
    updated = client.put(
        "/api/tasks/SYLU-2026-04-115",
        json={
            **created.json(),
            "name": "全实验类型任务-修改",
            "test_type": " / ".join(all_types),
            "test_types": all_types,
            "required_device": " / ".join(all_types),
        },
    )

    storage = client.app.state.storage

    assert created.status_code == 201
    assert updated.status_code == 200
    assert updated.json()["experiment_count"] == len(all_types)
    assert storage.read("mes.tasks")[0]["test_types"] == all_types
    assert [item["experiment_name"] for item in storage.read("mes.experiments")] == all_types


def test_create_task_rejects_code_that_already_exists_on_returned_archived_task(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-returned",
                "code": "SYLU-2026-05-001",
                "name": "已收回任务",
                "status": "厂家收回",
                "transfer_status": "厂家收回",
                "sample_count": "1",
                "test_type": "盐雾试验",
                "test_types": ["盐雾试验"],
            }
        ],
        samples=[
            {
                "id": "sample-returned",
                "code": "SYLU-2026-05-001-SP-001",
                "task_code": "SYLU-2026-05-001",
                "status": "厂家收回",
                "flow_status": "厂家收回",
                "trays": [{"tray_code": "SYLU-2026-05-001-TP-001", "status": "厂家收回"}],
            }
        ],
    )

    response = client.post(
        "/api/tasks",
        json={
            "id": "task-new",
            "code": "SYLU-2026-05-001",
            "name": "新任务",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "2",
            "test_type": "振动试验",
            "test_types": ["振动试验"],
            "status": "待排程",
        },
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "任务编号已存在"}
    assert [task["id"] for task in client.app.state.storage.read("mes.tasks")] == ["task-returned"]


def test_create_task_uses_test_types_count_over_stale_experiment_count(monkeypatch):
    client = build_client(monkeypatch, tasks=[])

    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-04-109",
            "code": "SYLU-2026-04-109",
            "name": "固定实验类型任务",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "3",
            "test_type": "冲击试验 / 盐雾试验 / 温度冲击试验",
            "test_types": ["冲击试验", "盐雾试验", "温度冲击试验"],
            "experiment_count": 5,
            "status": "待排程",
        },
    )

    storage = client.app.state.storage

    assert created.status_code == 201
    assert created.json()["experiment_count"] == 3
    assert created.json()["experiment_codes"] == [
        "SYLU-2026-04-109-A",
        "SYLU-2026-04-109-B",
        "SYLU-2026-04-109-C",
    ]
    assert storage.read("mes.tasks")[0]["test_types"] == ["冲击试验", "盐雾试验", "温度冲击试验"]
    assert [item["experiment_name"] for item in storage.read("mes.experiments")] == [
        "冲击试验",
        "盐雾试验",
        "温度冲击试验",
    ]


def test_create_task_rejects_missing_empty_or_duplicate_test_types(monkeypatch):
    client = build_client(monkeypatch, tasks=[])

    missing = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-04-106",
            "code": "SYLU-2026-04-106",
            "name": "缺少实验数组",
            "test_type": "冲击试验",
            "status": "待排程",
        },
    )
    empty = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-04-107",
            "code": "SYLU-2026-04-107",
            "name": "空实验数组",
            "test_type": "",
            "test_types": [],
            "status": "待排程",
        },
    )
    duplicate = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-04-108",
            "code": "SYLU-2026-04-108",
            "name": "重复实验数组",
            "test_type": "冲击试验 / 冲击试验",
            "test_types": ["冲击试验", "冲击试验"],
            "status": "待排程",
        },
    )

    assert missing.status_code == 400
    assert missing.json() == {"detail": "test_types is required"}
    assert empty.status_code == 400
    assert empty.json() == {"detail": "test_types must contain at least one experiment type"}
    assert duplicate.status_code == 400
    assert duplicate.json() == {"detail": "test_types must not contain duplicates"}


def test_create_task_rejects_garbled_symbol_text_fields(monkeypatch):
    client = build_client(monkeypatch, tasks=[])

    response = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-05-099",
            "code": "SYLU-2026-05-099",
            "name": "&^*(&U&^GFG&HU&",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "3",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "status": "待排程",
        },
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "任务名称包含无效字符，请检查输入"}
    assert client.app.state.storage.read("mes.tasks") == []


def test_create_task_rejects_invalid_contact_info_and_long_name(monkeypatch):
    client = build_client(monkeypatch, tasks=[])
    base_payload = {
        "id": "SYLU-2026-05-100",
        "code": "SYLU-2026-05-100",
        "name": "字段校验",
        "contact": "张三",
        "contact_info": "13800001234",
        "sample_count": "3",
        "test_type": "冲击试验",
        "test_types": ["冲击试验"],
        "status": "待排程",
    }

    invalid_phone = client.post("/api/tasks", json={**base_payload, "contact_info": "1380000ABC"})
    too_long_phone = client.post("/api/tasks", json={**base_payload, "contact_info": "1234567890123456"})
    too_long_contact = client.post("/api/tasks", json={**base_payload, "contact": "一二三四五六七八九十一二三四五六"})
    too_long_name = client.post("/api/tasks", json={**base_payload, "name": "一二三四五六七八九十一二三四五六七八九十X"})

    assert invalid_phone.status_code == 400
    assert invalid_phone.json() == {"detail": "联系方式必须为 1-15 位数字"}
    assert too_long_phone.status_code == 400
    assert too_long_phone.json() == {"detail": "联系方式必须为 1-15 位数字"}
    assert too_long_contact.status_code == 400
    assert too_long_contact.json() == {"detail": "联系人不能超过 15 个字"}
    assert too_long_name.status_code == 400
    assert too_long_name.json() == {"detail": "任务名称不能超过 20 个字"}


def test_create_task_rejects_missing_contact_fields(monkeypatch):
    client = build_client(monkeypatch, tasks=[])
    base_payload = {
        "id": "SYLU-2026-05-101",
        "code": "SYLU-2026-05-101",
        "name": "联系人校验",
        "sample_count": "3",
        "test_type": "冲击试验",
        "test_types": ["冲击试验"],
        "status": "待排程",
    }

    missing_contact = client.post("/api/tasks", json={**base_payload, "contact_info": "13800001234"})
    missing_phone = client.post("/api/tasks", json={**base_payload, "contact": "张三"})

    assert missing_contact.status_code == 400
    assert missing_contact.json() == {"detail": "请填写联系人"}
    assert missing_phone.status_code == 400
    assert missing_phone.json() == {"detail": "请填写联系方式"}


def test_create_task_defaults_blank_name_from_task_code_suffix(monkeypatch):
    client = build_client(monkeypatch, tasks=[{"id": "old", "code": "SYLU-2025-05-001", "name": "测试实验05001"}])

    response = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-05-001",
            "code": "SYLU-2026-05-001",
            "name": "",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "3",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "status": "待排程",
        },
    )

    assert response.status_code == 201
    assert response.json()["name"] == "测试实验05001-2"


def test_update_task_rejects_empty_test_types_without_falling_back_to_task_name(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-empty-types",
                "code": "SYLU-2026-05-002",
                "name": "演示任务002",
                "sample_count": "7",
                "test_type": "盐雾试验 / 霉菌试验 / 高低温湿热试验",
                "test_types": ["盐雾试验", "霉菌试验", "高低温湿热试验"],
                "required_device": "盐雾试验 / 霉菌试验 / 高低温湿热试验",
                "status": "任务进行中",
            }
        ],
        experiments=[
            {
                "id": "EXP-A",
                "task_code": "SYLU-2026-05-002",
                "experiment_code": "SYLU-2026-05-002-A",
                "experiment_name": "盐雾试验",
                "required_device": "盐雾试验",
            }
        ],
    )

    response = client.put(
        "/api/tasks/task-empty-types",
        json={
            "id": "task-empty-types",
            "code": "SYLU-2026-05-002",
            "name": "演示任务002",
            "sample_count": "7",
            "test_type": "",
            "test_types": [],
            "required_device": "",
            "status": "任务进行中",
        },
    )

    stored_task = client.app.state.storage.read("mes.tasks")[0]

    assert response.status_code == 400
    assert response.json() == {"detail": "任务进行中，仅允许修改任务名称"}
    assert stored_task["test_types"] == ["盐雾试验", "霉菌试验", "高低温湿热试验"]
    assert "演示任务002" not in stored_task["test_type"]


def test_update_task_rejects_removing_schedule_after_fixture_install(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-installed",
                "code": "TASK-INSTALLED",
                "name": "已安装任务",
                "sample_count": "1",
                "test_type": "冲击试验 / 盐雾试验",
                "test_types": ["冲击试验", "盐雾试验"],
                "required_device": "冲击试验 / 盐雾试验",
                "status": "待排程",
            }
        ],
        schedules=[
            {
                "id": "schedule-installed",
                "task_code": "TASK-INSTALLED",
                "experiment_code": "TASK-INSTALLED-A",
                "device": "冲击一室",
                "start_at": "2026-06-23 08:00",
                "end_at": "2026-06-23 10:00",
            }
        ],
        experiments=[
            {
                "task_code": "TASK-INSTALLED",
                "experiment_code": "TASK-INSTALLED-A",
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
            }
        ],
        experiment_trays=[
            {"task_code": "TASK-INSTALLED", "experiment_code": "TASK-INSTALLED-A", "tray_code": "TP-INSTALLED"}
        ],
        samples=[
            {
                "code": "SP-INSTALLED",
                "task_code": "TASK-INSTALLED",
                "status": "工装夹具安装",
                "flow_status": "工装夹具安装",
                "trays": [{"tray_code": "TP-INSTALLED", "status": "工装夹具安装"}],
            }
        ],
    )

    response = client.put(
        "/api/tasks/task-installed",
        json={
            "id": "task-installed",
            "code": "TASK-INSTALLED",
            "name": "已安装任务",
            "sample_count": "1",
            "test_type": "盐雾试验",
            "test_types": ["盐雾试验"],
            "required_device": "盐雾试验",
            "confirm_remove_scheduled_experiments": True,
            "status": "待排程",
        },
    )

    assert response.status_code == 400
    assert "夹具安装后排程不可删除" in response.json()["detail"]
    assert client.app.state.storage.read("mes.schedules")[0]["id"] == "schedule-installed"


def test_delete_task_rejects_schedule_removal_after_fixture_install(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-installed",
                "code": "TASK-INSTALLED",
                "name": "已安装任务",
                "sample_count": "1",
                "test_type": "冲击试验",
                "test_types": ["冲击试验"],
                "required_device": "冲击试验",
                "status": "待排程",
            }
        ],
        schedules=[
            {
                "id": "schedule-installed",
                "task_code": "TASK-INSTALLED",
                "experiment_code": "TASK-INSTALLED-A",
                "device": "冲击一室",
                "start_at": "2026-06-23 08:00",
                "end_at": "2026-06-23 10:00",
            }
        ],
        experiment_trays=[
            {"task_code": "TASK-INSTALLED", "experiment_code": "TASK-INSTALLED-A", "tray_code": "TP-INSTALLED"}
        ],
        samples=[
            {
                "code": "SP-INSTALLED",
                "task_code": "TASK-INSTALLED",
                "status": "工装夹具安装",
                "flow_status": "工装夹具安装",
                "trays": [{"tray_code": "TP-INSTALLED", "status": "工装夹具安装"}],
            }
        ],
    )

    response = client.delete("/api/tasks/task-installed")

    assert response.status_code == 400
    assert "夹具安装后排程不可删除" in response.json()["detail"]
    assert client.app.state.storage.read("mes.tasks")[0]["id"] == "task-installed"


def test_update_task_name_does_not_become_an_experiment_type(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-rename",
                "code": "SYLU-2026-05-020",
                "name": "旧任务名称",
                "sample_count": "3",
                "test_type": "盐雾试验",
                "required_device": "盐雾试验",
                "status": "待排程",
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-05-020-A",
                "task_code": "SYLU-2026-05-020",
                "experiment_code": "SYLU-2026-05-020-A",
                "experiment_name": "盐雾试验",
                "required_device": "盐雾试验",
            }
        ],
    )

    response = client.put(
        "/api/tasks/task-rename",
        json={
            "id": "task-rename",
            "code": "SYLU-2026-05-020",
            "name": "只修改任务名称",
            "sample_count": "3",
            "test_type": "盐雾试验",
            "required_device": "盐雾试验",
            "status": "待排程",
        },
    )

    storage = client.app.state.storage

    assert response.status_code == 200
    assert response.json()["name"] == "只修改任务名称"
    assert response.json()["test_type"] == "盐雾试验"
    assert response.json()["test_types"] == ["盐雾试验"]
    assert "只修改任务名称" not in response.json()["test_type"]
    assert [experiment["experiment_name"] for experiment in storage.read("mes.experiments")] == ["盐雾试验"]


def test_update_task_replaces_stale_experiment_metadata_when_test_types_change(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-replace-types",
                "code": "SYLU-2026-05-003",
                "name": "三实验改一实验",
                "sample_count": "8",
                "test_type": "温度冲击试验 / 高低温湿热试验 / 盐雾试验",
                "test_types": ["温度冲击试验", "高低温湿热试验", "盐雾试验"],
                "required_device": "温度冲击试验 / 高低温湿热试验 / 盐雾试验",
                "experiment_codes": [
                    "SYLU-2026-05-003-A",
                    "SYLU-2026-05-003-B",
                    "SYLU-2026-05-003-C",
                ],
                "experiment_count": 3,
                "status": "待排程",
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-05-003-A",
                "task_code": "SYLU-2026-05-003",
                "experiment_code": "SYLU-2026-05-003-A",
                "experiment_name": "温度冲击试验",
                "required_device": "温度冲击试验",
            },
            {
                "id": "SYLU-2026-05-003-B",
                "task_code": "SYLU-2026-05-003",
                "experiment_code": "SYLU-2026-05-003-B",
                "experiment_name": "高低温湿热试验",
                "required_device": "高低温湿热试验",
            },
            {
                "id": "SYLU-2026-05-003-C",
                "task_code": "SYLU-2026-05-003",
                "experiment_code": "SYLU-2026-05-003-C",
                "experiment_name": "盐雾试验",
                "required_device": "盐雾试验",
            },
        ],
    )

    response = client.put(
        "/api/tasks/task-replace-types",
        json={
            "id": "task-replace-types",
            "code": "SYLU-2026-05-003",
            "name": "三实验改一实验",
            "sample_count": "8",
            "test_type": "四综合试验",
            "test_types": ["四综合试验"],
            "required_device": "四综合试验",
            "experiment_codes": [
                "SYLU-2026-05-003-A",
                "SYLU-2026-05-003-B",
                "SYLU-2026-05-003-C",
            ],
            "experiment_count": 3,
            "status": "待排程",
        },
    )

    stored_task = client.app.state.storage.read("mes.tasks")[0]
    stored_experiments = client.app.state.storage.read("mes.experiments")

    assert response.status_code == 200
    assert stored_task["test_type"] == "四综合试验"
    assert stored_task["test_types"] == ["四综合试验"]
    assert stored_task["required_device"] == "四综合试验"
    assert stored_task["experiment_count"] == 1
    assert stored_task["experiment_codes"] == ["SYLU-2026-05-003-A"]
    assert stored_experiments == [
        {
            "id": "SYLU-2026-05-003-A",
            "task_code": "SYLU-2026-05-003",
            "experiment_code": "SYLU-2026-05-003-A",
            "experiment_name": "四综合试验",
            "required_device": "四综合试验",
            "priority": "",
            "status": "待排程",
            "unscheduled_since": "",
        }
    ]


def test_update_task_rejects_test_type_change_after_storage_confirmed(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-storage-confirmed",
                "code": "SYLU-2026-05-004",
                "name": "已确认入库任务",
                "sample_count": "2",
                "test_type": "冲击试验",
                "test_types": ["冲击试验"],
                "required_device": "冲击试验",
                "transfer_status": "到货",
                "status": "待排程",
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-05-004-A",
                "task_code": "SYLU-2026-05-004",
                "experiment_code": "SYLU-2026-05-004-A",
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
            }
        ],
        samples=[
            {
                "id": "SYLU-2026-05-004-SP-001",
                "code": "SYLU-2026-05-004-SP-001",
                "task_code": "SYLU-2026-05-004",
                "status": "到货",
                "flow_status": "到货",
                "trays": [{"tray_code": "SYLU-2026-05-004-TP-001", "status": "到货"}],
            }
        ],
    )

    response = client.put(
        "/api/tasks/task-storage-confirmed",
        json={
            "id": "task-storage-confirmed",
            "code": "SYLU-2026-05-004",
            "name": "已确认入库任务",
            "sample_count": "2",
            "test_type": "盐雾试验",
            "test_types": ["盐雾试验"],
            "required_device": "盐雾试验",
            "transfer_status": "到货",
            "status": "待排程",
        },
    )

    storage = client.app.state.storage

    assert response.status_code == 400
    assert response.json() == {"detail": "该任务样品已在接驳区确认到货，不允许更改实验类型"}
    assert storage.read("mes.tasks")[0]["test_types"] == ["冲击试验"]
    assert storage.read("mes.experiments")[0]["experiment_name"] == "冲击试验"


def test_update_task_allows_test_type_change_when_only_legacy_storage_status_exists(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-legacy-storage-confirmed",
                "code": "SYLU-2026-05-014",
                "name": "旧状态任务",
                "sample_count": "2",
                "test_type": "冲击试验",
                "test_types": ["冲击试验"],
                "required_device": "冲击试验",
                "transfer_status": "已入库",
                "status": "待排程",
            }
        ],
        experiments=[
            {
                "id": "exp-legacy-storage-confirmed",
                "task_code": "SYLU-2026-05-014",
                "experiment_code": "SYLU-2026-05-014-A",
                "experiment_name": "冲击试验",
                "status": "待排程",
            }
        ],
        samples=[
            {
                "id": "SYLU-2026-05-014-SP-001",
                "code": "SYLU-2026-05-014-SP-001",
                "task_code": "SYLU-2026-05-014",
                "status": "已入库",
                "flow_status": "已入库",
                "trays": [{"tray_code": "SYLU-2026-05-014-TP-001", "status": "已入库"}],
            }
        ],
    )

    response = client.put(
        "/api/tasks/task-legacy-storage-confirmed",
        json={
            "id": "task-legacy-storage-confirmed",
            "code": "SYLU-2026-05-014",
            "name": "旧状态任务",
            "sample_count": "2",
            "test_type": "盐雾试验",
            "test_types": ["盐雾试验"],
            "required_device": "盐雾试验",
            "transfer_status": "已入库",
            "status": "待排程",
        },
    )

    storage = client.app.state.storage

    assert response.status_code == 200
    assert storage.read("mes.tasks")[0]["test_types"] == ["盐雾试验"]
    assert storage.read("mes.experiments")[0]["experiment_name"] == "盐雾试验"


def test_update_task_requires_confirmation_before_removing_scheduled_experiment(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-scheduled-removal",
                "code": "SYLU-2026-05-005",
                "name": "删除已排程实验",
                "sample_count": "3",
                "test_type": "冲击试验 / 盐雾试验",
                "test_types": ["冲击试验", "盐雾试验"],
                "required_device": "冲击试验 / 盐雾试验",
                "experiment_codes": ["SYLU-2026-05-005-A", "SYLU-2026-05-005-B"],
                "experiment_count": 2,
                "status": "待排程",
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-05-005-A",
                "task_code": "SYLU-2026-05-005",
                "experiment_code": "SYLU-2026-05-005-A",
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
            },
            {
                "id": "SYLU-2026-05-005-B",
                "task_code": "SYLU-2026-05-005",
                "experiment_code": "SYLU-2026-05-005-B",
                "experiment_name": "盐雾试验",
                "required_device": "盐雾试验",
            },
        ],
        schedules=[
            {
                "id": "SCH-KEEP",
                "task_code": "SYLU-2026-05-005",
                "experiment_code": "SYLU-2026-05-005-A",
                "device": "冲击一室",
            },
            {
                "id": "SCH-REMOVE",
                "task_code": "SYLU-2026-05-005",
                "experiment_code": "SYLU-2026-05-005-B",
                "device": "盐雾试验室",
            },
        ],
        experiment_trays=[
            {"task_code": "SYLU-2026-05-005", "experiment_code": "SYLU-2026-05-005-A", "tray_code": "TP-A"},
            {"task_code": "SYLU-2026-05-005", "experiment_code": "SYLU-2026-05-005-B", "tray_code": "TP-B"},
        ],
        experiment_samples=[
            {"task_code": "SYLU-2026-05-005", "experiment_code": "SYLU-2026-05-005-A", "sample_code": "SP-A"},
            {"task_code": "SYLU-2026-05-005", "experiment_code": "SYLU-2026-05-005-B", "sample_code": "SP-B"},
        ],
    )

    response = client.put(
        "/api/tasks/task-scheduled-removal",
        json={
            "id": "task-scheduled-removal",
            "code": "SYLU-2026-05-005",
            "name": "删除已排程实验",
            "sample_count": "3",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "required_device": "冲击试验",
            "experiment_codes": ["SYLU-2026-05-005-A", "SYLU-2026-05-005-B"],
            "experiment_count": 2,
            "status": "待排程",
        },
    )

    storage = client.app.state.storage

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "SCHEDULED_EXPERIMENT_REMOVAL_REQUIRES_CONFIRMATION"
    assert response.json()["detail"]["affected_schedules"] == [
        {
            "id": "SCH-KEEP",
            "experiment_code": "SYLU-2026-05-005-A",
            "device": "冲击一室",
            "start_at": "",
            "end_at": "",
        },
        {
            "id": "SCH-REMOVE",
            "experiment_code": "SYLU-2026-05-005-B",
            "device": "盐雾试验室",
            "start_at": "",
            "end_at": "",
        }
    ]
    assert [item["id"] for item in storage.read("mes.schedules")] == ["SCH-KEEP", "SCH-REMOVE"]
    assert storage.read("mes.tasks")[0]["test_types"] == ["冲击试验", "盐雾试验"]


def test_update_task_confirmed_scheduled_experiment_removal_cleans_related_rows(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-confirm-removal",
                "code": "SYLU-2026-05-006",
                "name": "确认删除已排程实验",
                "sample_count": "3",
                "test_type": "冲击试验 / 盐雾试验",
                "test_types": ["冲击试验", "盐雾试验"],
                "required_device": "冲击试验 / 盐雾试验",
                "experiment_codes": ["SYLU-2026-05-006-A", "SYLU-2026-05-006-B"],
                "experiment_count": 2,
                "status": "待排程",
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-05-006-A",
                "task_code": "SYLU-2026-05-006",
                "experiment_code": "SYLU-2026-05-006-A",
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
            },
            {
                "id": "SYLU-2026-05-006-B",
                "task_code": "SYLU-2026-05-006",
                "experiment_code": "SYLU-2026-05-006-B",
                "experiment_name": "盐雾试验",
                "required_device": "盐雾试验",
            },
        ],
        schedules=[
            {"id": "SCH-KEEP", "task_code": "SYLU-2026-05-006", "experiment_code": "SYLU-2026-05-006-A", "device": "冲击一室"},
            {"id": "SCH-REMOVE", "task_code": "SYLU-2026-05-006", "experiment_code": "SYLU-2026-05-006-B", "device": "盐雾试验室"},
            {"id": "SCH-OTHER", "task_code": "OTHER", "experiment_code": "OTHER-A", "device": "盐雾试验室"},
        ],
        experiment_trays=[
            {"task_code": "SYLU-2026-05-006", "experiment_code": "SYLU-2026-05-006-A", "tray_code": "TP-A"},
            {"task_code": "SYLU-2026-05-006", "experiment_code": "SYLU-2026-05-006-B", "tray_code": "TP-B"},
        ],
        experiment_samples=[
            {"task_code": "SYLU-2026-05-006", "experiment_code": "SYLU-2026-05-006-A", "sample_code": "SP-A"},
            {"task_code": "SYLU-2026-05-006", "experiment_code": "SYLU-2026-05-006-B", "sample_code": "SP-B"},
        ],
        experiment_runs=[
            {"run_no": "RUN-KEEP", "task_code": "SYLU-2026-05-006", "experiment_code": "SYLU-2026-05-006-A", "tray_codes": ["TP-A"]},
            {"run_no": "RUN-REMOVE", "task_code": "SYLU-2026-05-006", "experiment_code": "SYLU-2026-05-006-B", "tray_codes": ["TP-B"]},
            {"run_no": "RUN-OTHER", "task_code": "OTHER", "experiment_code": "OTHER-A", "tray_codes": ["OTHER-TP-001"]},
        ],
    )

    response = client.put(
        "/api/tasks/task-confirm-removal",
        json={
            "id": "task-confirm-removal",
            "code": "SYLU-2026-05-006",
            "name": "确认删除已排程实验",
            "sample_count": "3",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "required_device": "冲击试验",
            "experiment_codes": ["SYLU-2026-05-006-A", "SYLU-2026-05-006-B"],
            "experiment_count": 2,
            "status": "待排程",
            "confirm_remove_scheduled_experiments": True,
        },
    )

    storage = client.app.state.storage

    assert response.status_code == 200
    assert storage.read("mes.tasks")[0]["test_types"] == ["冲击试验"]
    assert [item["experiment_code"] for item in storage.read("mes.experiments")] == ["SYLU-2026-05-006-A"]
    assert [item["id"] for item in storage.read("mes.schedules")] == ["SCH-OTHER"]
    assert storage.read("mes.experiment_trays") == []
    assert storage.read("mes.experiment_samples") == []
    assert [item["run_no"] for item in storage.read("mes.experiment_runs")] == ["RUN-OTHER"]


def test_update_task_type_change_after_preallocation_resets_handover_allocation(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-preallocated",
                "code": "SYLU-2026-05-020",
                "name": "预接驳后新增实验",
                "sample_count": "2",
                "test_type": "冲击试验",
                "test_types": ["冲击试验"],
                "required_device": "冲击试验",
                "experiment_codes": ["SYLU-2026-05-020-A"],
                "experiment_count": 1,
                "status": "待排程",
                "transfer_status": "未入库",
                "tray_codes": ["SYLU-2026-05-020-TP-001"],
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-05-020-A",
                "task_code": "SYLU-2026-05-020",
                "experiment_code": "SYLU-2026-05-020-A",
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
                "status": "已排程",
            }
        ],
        samples=[
            {
                "id": "SYLU-2026-05-020-SP-001",
                "code": "SYLU-2026-05-020-SP-001",
                "task_code": "SYLU-2026-05-020",
                "status": "运输中",
                "flow_status": "运输中",
                "location": "",
                "trays": [{"tray_code": "SYLU-2026-05-020-TP-001", "status": "未入库"}],
            },
            {
                "id": "SYLU-2026-05-020-SP-002",
                "code": "SYLU-2026-05-020-SP-002",
                "task_code": "SYLU-2026-05-020",
                "status": "运输中",
                "flow_status": "运输中",
                "location": "",
                "trays": [{"tray_code": "SYLU-2026-05-020-TP-001", "status": "未入库"}],
            },
        ],
        schedules=[
            {"id": "SCH-OLD", "task_code": "SYLU-2026-05-020", "experiment_code": "SYLU-2026-05-020-A", "device": "冲击一室"},
            {"id": "SCH-OTHER", "task_code": "OTHER", "experiment_code": "OTHER-A", "device": "盐雾试验室"},
        ],
        experiment_trays=[
            {"task_code": "SYLU-2026-05-020", "experiment_code": "SYLU-2026-05-020-A", "tray_code": "SYLU-2026-05-020-TP-001"},
            {"task_code": "OTHER", "experiment_code": "OTHER-A", "tray_code": "OTHER-TP-001"},
        ],
        experiment_samples=[
            {"task_code": "SYLU-2026-05-020", "experiment_code": "SYLU-2026-05-020-A", "sample_code": "SYLU-2026-05-020-SP-001"},
            {"task_code": "OTHER", "experiment_code": "OTHER-A", "sample_code": "OTHER-SP-001"},
        ],
        experiment_runs=[
            {"run_no": "RUN-OLD", "task_code": "SYLU-2026-05-020", "experiment_code": "SYLU-2026-05-020-A", "tray_codes": ["SYLU-2026-05-020-TP-001"]},
            {"run_no": "RUN-OTHER", "task_code": "OTHER", "experiment_code": "OTHER-A", "tray_codes": ["OTHER-TP-001"]},
        ],
    )

    response = client.put(
        "/api/tasks/task-preallocated",
        json={
            "id": "task-preallocated",
            "code": "SYLU-2026-05-020",
            "name": "预接驳后新增实验",
            "sample_count": "2",
            "test_type": "冲击试验 / 盐雾试验",
            "test_types": ["冲击试验", "盐雾试验"],
            "required_device": "冲击试验 / 盐雾试验",
            "experiment_codes": ["SYLU-2026-05-020-A", "SYLU-2026-05-020-B"],
            "experiment_count": 2,
            "status": "待排程",
            "transfer_status": "未入库",
            "confirm_remove_scheduled_experiments": True,
        },
    )

    storage = client.app.state.storage
    stored_task = storage.read("mes.tasks")[0]
    stored_samples = [sample for sample in storage.read("mes.samples") if sample["task_code"] == "SYLU-2026-05-020"]

    assert response.status_code == 200
    assert stored_task["test_types"] == ["冲击试验", "盐雾试验"]
    assert stored_task["test_type"] == "冲击试验 / 盐雾试验"
    assert stored_task["required_device"] == "冲击试验 / 盐雾试验"
    assert stored_task["transfer_status"] == "未入库"
    assert stored_task["tray_codes"] == []
    assert [item["experiment_name"] for item in storage.read("mes.experiments") if item["task_code"] == "SYLU-2026-05-020"] == [
        "冲击试验",
        "盐雾试验",
    ]
    assert [item["id"] for item in storage.read("mes.schedules")] == ["SCH-OTHER"]
    assert storage.read("mes.experiment_trays") == [
        {"task_code": "OTHER", "experiment_code": "OTHER-A", "tray_code": "OTHER-TP-001"}
    ]
    assert storage.read("mes.experiment_samples") == [
        {"task_code": "OTHER", "experiment_code": "OTHER-A", "sample_code": "OTHER-SP-001"}
    ]
    assert storage.read("mes.experiment_runs") == [
        {"run_no": "RUN-OTHER", "task_code": "OTHER", "experiment_code": "OTHER-A", "tray_codes": ["OTHER-TP-001"]}
    ]
    assert all(sample["status"] == "运输中" for sample in stored_samples)
    assert all(sample["flow_status"] == "运输中" for sample in stored_samples)
    assert all(sample["location"] == "" for sample in stored_samples)
    assert all(sample["trays"] == [] for sample in stored_samples)


def test_update_task_string_false_does_not_confirm_scheduled_experiment_removal(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-string-confirm",
                "code": "SYLU-2026-05-007",
                "name": "字符串确认值",
                "sample_count": "3",
                "test_type": "冲击试验 / 盐雾试验",
                "test_types": ["冲击试验", "盐雾试验"],
                "required_device": "冲击试验 / 盐雾试验",
                "experiment_codes": ["SYLU-2026-05-007-A", "SYLU-2026-05-007-B"],
                "experiment_count": 2,
                "status": "待排程",
            }
        ],
        experiments=[
            {"id": "SYLU-2026-05-007-A", "task_code": "SYLU-2026-05-007", "experiment_code": "SYLU-2026-05-007-A", "experiment_name": "冲击试验"},
            {"id": "SYLU-2026-05-007-B", "task_code": "SYLU-2026-05-007", "experiment_code": "SYLU-2026-05-007-B", "experiment_name": "盐雾试验"},
        ],
        schedules=[
            {"id": "SCH-REMOVE", "task_code": "SYLU-2026-05-007", "experiment_code": "SYLU-2026-05-007-B", "device": "盐雾试验室"}
        ],
    )

    response = client.put(
        "/api/tasks/task-string-confirm",
        json={
            "id": "task-string-confirm",
            "code": "SYLU-2026-05-007",
            "name": "字符串确认值",
            "sample_count": "3",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "required_device": "冲击试验",
            "experiment_codes": ["SYLU-2026-05-007-A", "SYLU-2026-05-007-B"],
            "experiment_count": 2,
            "status": "待排程",
            "confirm_remove_scheduled_experiments": "false",
        },
    )

    assert response.status_code == 409
    assert [item["id"] for item in client.app.state.storage.read("mes.schedules")] == ["SCH-REMOVE"]


def test_update_task_uses_task_id_when_code_is_missing_for_scheduled_removal(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "TASK-NO-CODE",
                "name": "无任务编号旧数据",
                "sample_count": "3",
                "test_type": "冲击试验 / 盐雾试验",
                "test_types": ["冲击试验", "盐雾试验"],
                "required_device": "冲击试验 / 盐雾试验",
                "experiment_codes": ["TASK-NO-CODE-A", "TASK-NO-CODE-B"],
                "experiment_count": 2,
                "status": "待排程",
            }
        ],
        experiments=[
            {"id": "TASK-NO-CODE-A", "task_code": "TASK-NO-CODE", "experiment_code": "TASK-NO-CODE-A", "experiment_name": "冲击试验"},
            {"id": "TASK-NO-CODE-B", "task_code": "TASK-NO-CODE", "experiment_code": "TASK-NO-CODE-B", "experiment_name": "盐雾试验"},
        ],
        schedules=[
            {"id": "SCH-REMOVE", "task_code": "TASK-NO-CODE", "experiment_code": "TASK-NO-CODE-B", "device": "盐雾试验室"}
        ],
    )

    response = client.put(
        "/api/tasks/TASK-NO-CODE",
        json={
            "id": "TASK-NO-CODE",
            "name": "无任务编号旧数据",
            "sample_count": "3",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "required_device": "冲击试验",
            "experiment_codes": ["TASK-NO-CODE-A", "TASK-NO-CODE-B"],
            "experiment_count": 2,
            "status": "待排程",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["affected_schedules"][0]["id"] == "SCH-REMOVE"


def test_create_task_rejects_invalid_sample_count(monkeypatch):
    client = build_client(monkeypatch, tasks=[])
    base_payload = {
        "id": "SYLU-2026-04-110",
        "code": "SYLU-2026-04-110",
        "name": "样品数量校验",
        "contact": "张三",
        "contact_info": "13800001234",
        "test_type": "冲击试验",
        "test_types": ["冲击试验"],
        "status": "待排程",
    }

    missing = client.post("/api/tasks", json=base_payload)
    non_integer = client.post("/api/tasks", json={**base_payload, "sample_count": "1.5"})
    zero = client.post("/api/tasks", json={**base_payload, "sample_count": "0"})
    negative = client.post("/api/tasks", json={**base_payload, "sample_count": "-1"})
    too_many = client.post("/api/tasks", json={**base_payload, "sample_count": "100"})
    one_sample = client.post("/api/tasks", json={**base_payload, "sample_count": "1"})
    valid = client.post(
        "/api/tasks",
        json={**base_payload, "id": "SYLU-2026-04-110-B", "code": "SYLU-2026-04-110-B", "sample_count": "99"},
    )

    assert missing.status_code == 400
    assert missing.json() == {"detail": "请填写样品数量"}
    assert non_integer.status_code == 400
    assert non_integer.json() == {"detail": "样品数量必须为整数"}
    assert zero.status_code == 400
    assert zero.json() == {"detail": "样品数量至少为 1"}
    assert negative.status_code == 400
    assert negative.json() == {"detail": "样品数量至少为 1"}
    assert too_many.status_code == 400
    assert too_many.json() == {"detail": "样品数量最多为 99"}
    assert one_sample.status_code == 201
    assert one_sample.json()["sample_count"] == "1"
    assert valid.status_code == 201


def test_update_task_rejects_invalid_sample_count(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "SYLU-2026-04-111",
                "code": "SYLU-2026-04-111",
                "name": "样品数量校验",
                "sample_count": "2",
                "test_type": "冲击试验",
                "test_types": ["冲击试验"],
                "status": "待排程",
            }
        ],
    )

    response = client.put(
        "/api/tasks/SYLU-2026-04-111",
        json={
            "id": "SYLU-2026-04-111",
            "code": "SYLU-2026-04-111",
            "name": "样品数量校验",
            "sample_count": "0",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "status": "待排程",
        },
    )
    too_many = client.put(
        "/api/tasks/SYLU-2026-04-111",
        json={
            "id": "SYLU-2026-04-111",
            "code": "SYLU-2026-04-111",
            "name": "样品数量校验",
            "sample_count": "100",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "status": "待排程",
        },
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "样品数量至少为 1"}
    assert too_many.status_code == 400
    assert too_many.json() == {"detail": "样品数量最多为 99"}


def test_update_task_sample_count_shrinks_related_samples(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-shrink-samples",
                "code": "SYLU-2026-04-112",
                "name": "样品数量降低",
                "sample_count": "4",
                "test_type": "冲击试验",
                "test_types": ["冲击试验"],
                "status": "待排程",
            }
        ],
        samples=[
            {
                "id": f"sample-{index}",
                "code": f"SYLU-2026-04-112-SP-{index:03d}",
                "task_code": "SYLU-2026-04-112",
                "status": "运输中",
            }
            for index in range(1, 5)
        ],
    )

    response = client.put(
        "/api/tasks/task-shrink-samples",
        json={
            "id": "task-shrink-samples",
            "code": "SYLU-2026-04-112",
            "name": "样品数量降低",
            "sample_count": "2",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "status": "待排程",
        },
    )

    samples = [
        sample for sample in client.app.state.storage.read("mes.samples")
        if sample.get("task_code") == "SYLU-2026-04-112"
    ]

    assert response.status_code == 200
    assert response.json()["sample_count"] == "2"
    assert [sample["code"] for sample in samples] == [
        "SYLU-2026-04-112-SP-001",
        "SYLU-2026-04-112-SP-002",
    ]


def test_update_task_rejects_sample_count_change_after_storage_confirmed_with_experiments(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-confirmed-sample-count",
                "code": "SYLU-2026-04-113",
                "name": "已入库样品数锁定",
                "sample_count": "2",
                "test_type": "冲击试验",
                "test_types": ["冲击试验"],
                "transfer_status": "到货",
                "status": "待排程",
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-04-113-A",
                "task_code": "SYLU-2026-04-113",
                "experiment_code": "SYLU-2026-04-113-A",
                "experiment_name": "冲击试验",
            }
        ],
        samples=[
            {
                "id": "sample-1",
                "code": "SYLU-2026-04-113-SP-001",
                "task_code": "SYLU-2026-04-113",
                "status": "到货",
            },
            {
                "id": "sample-2",
                "code": "SYLU-2026-04-113-SP-002",
                "task_code": "SYLU-2026-04-113",
                "status": "到货",
            },
        ],
    )

    response = client.put(
        "/api/tasks/task-confirmed-sample-count",
        json={
            "id": "task-confirmed-sample-count",
            "code": "SYLU-2026-04-113",
            "name": "已入库样品数锁定",
            "sample_count": "3",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "transfer_status": "到货",
            "status": "待排程",
        },
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "该任务样品已在接驳区确认到货，不允许更改样品数量"}
    assert client.app.state.storage.read("mes.tasks")[0]["sample_count"] == "2"
    assert len(client.app.state.storage.read("mes.samples")) == 2


def test_update_completed_task_allows_name_only(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-completed-rename",
                "code": "SYLU-2026-06-210",
                "name": "完成任务旧名称",
                "sample_count": "2",
                "sample_type": "金属件",
                "test_type": "冲击试验",
                "test_types": ["冲击试验"],
                "required_device": "冲击试验",
                "status": "任务已完成",
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-06-210-A",
                "task_code": "SYLU-2026-06-210",
                "experiment_code": "SYLU-2026-06-210-A",
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
                "status": "实验已完成",
            }
        ],
    )

    response = client.put(
        "/api/tasks/task-completed-rename",
        json={
            "id": "task-completed-rename",
            "code": "SYLU-2026-06-210",
            "name": "完成任务新名称",
            "sample_count": "2",
            "sample_type": "金属件",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "required_device": "冲击试验",
            "status": "任务已完成",
        },
    )

    stored_task = client.app.state.storage.read("mes.tasks")[0]

    assert response.status_code == 200
    assert response.json()["name"] == "完成任务新名称"
    assert stored_task["name"] == "完成任务新名称"
    assert stored_task["sample_count"] == "2"
    assert stored_task["sample_type"] == "金属件"
    assert client.app.state.storage.read("mes.experiments")[0]["experiment_name"] == "冲击试验"


def test_update_completed_task_rejects_non_name_changes_from_completed_experiments(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "task-completed-locked",
                "code": "SYLU-2026-06-211",
                "name": "完成任务",
                "sample_count": "2",
                "sample_type": "金属件",
                "test_type": "冲击试验",
                "test_types": ["冲击试验"],
                "required_device": "冲击试验",
                "status": "任务进行中",
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-06-211-A",
                "task_code": "SYLU-2026-06-211",
                "experiment_code": "SYLU-2026-06-211-A",
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
                "status": "实验已完成",
            }
        ],
    )

    response = client.put(
        "/api/tasks/task-completed-locked",
        json={
            "id": "task-completed-locked",
            "code": "SYLU-2026-06-211",
            "name": "完成任务改名",
            "sample_count": "3",
            "sample_type": "复合材料",
            "test_type": "冲击试验",
            "test_types": ["冲击试验"],
            "required_device": "冲击试验",
            "status": "任务进行中",
        },
    )

    stored_task = client.app.state.storage.read("mes.tasks")[0]

    assert response.status_code == 400
    assert response.json() == {"detail": "任务已完成，仅允许修改任务名称"}
    assert stored_task["name"] == "完成任务"
    assert stored_task["sample_count"] == "2"
    assert stored_task["sample_type"] == "金属件"


def test_create_task_preserves_existing_experiments_for_other_tasks(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[{"id": "SYLU-2026-03-001", "code": "SYLU-2026-03-001", "name": "旧任务", "status": "待排程"}],
        experiments=[
            {
                "id": "SYLU-2026-03-001-A",
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "experiment_name": "温度冲击试验",
                "required_device": "温度冲击试验",
            }
        ],
    )

    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-03-002",
            "code": "SYLU-2026-03-002",
            "name": "新任务",
            "contact": "张三",
            "contact_info": "13800001234",
            "sample_count": "2",
            "test_type": "振动试验 / 盐雾试验",
            "test_types": ["振动试验", "盐雾试验"],
            "status": "待排程",
        },
    )

    storage = client.app.state.storage

    assert created.status_code == 201
    assert [item["experiment_code"] for item in storage.read("mes.experiments")] == [
        "SYLU-2026-03-001-A",
        "SYLU-2026-03-002-A",
        "SYLU-2026-03-002-B",
    ]


def test_update_task_keeps_experiment_metadata_in_sync(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "SYLU-2026-04-105",
                "code": "SYLU-2026-04-105",
                "name": "高低温湿热试验-批次E",
                "sample_count": "3",
                "test_type": "高低温湿热试验",
                "required_device": "高低温湿热试验",
                "status": "待排程",
                "experiment_count": 1,
                "experiment_codes": ["SYLU-2026-04-105-A"],
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-04-105-A",
                "task_code": "SYLU-2026-04-105",
                "experiment_code": "SYLU-2026-04-105-A",
                "experiment_name": "高低温湿热试验",
                "required_device": "高低温湿热试验",
            }
        ],
    )

    updated = client.put(
        "/api/tasks/SYLU-2026-04-105",
        json={
            "id": "SYLU-2026-04-105",
            "code": "SYLU-2026-04-105",
            "name": "高低温湿热试验-批次E",
            "test_type": "高低温湿热试验",
            "required_device": "高低温湿热试验",
            "status": "已排程",
            "experiment_count": 3,
            "experiment_codes": ["SYLU-2026-04-105-A", "SYLU-2026-04-105-B", "SYLU-2026-04-105-C"],
        },
    )

    storage = client.app.state.storage

    assert updated.status_code == 200
    assert updated.json()["experiment_count"] == 3
    assert updated.json()["experiment_codes"] == ["SYLU-2026-04-105-A", "SYLU-2026-04-105-B", "SYLU-2026-04-105-C"]
    assert [item["experiment_code"] for item in storage.read("mes.experiments")] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]
    assert storage.read("mes.tasks")[0]["experiment_count"] == 3
    assert storage.read("mes.tasks")[0]["experiment_codes"] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]


def test_update_task_updates_axis_codes_without_changing_experiment_types(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "SYLU-2026-04-106",
                "code": "SYLU-2026-04-106",
                "name": "冲击试验-轴向修改",
                "sample_count": "3",
                "test_type": "冲击试验 / 盐雾试验",
                "test_types": ["冲击试验", "盐雾试验"],
                "required_device": "冲击试验 / 盐雾试验",
                "status": "待排程",
                "experiment_count": 2,
                "experiment_codes": ["SYLU-2026-04-106-A", "SYLU-2026-04-106-B"],
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-04-106-A",
                "task_code": "SYLU-2026-04-106",
                "experiment_code": "SYLU-2026-04-106-A",
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
                "axis_codes": ["z-", "x+"],
            },
            {
                "id": "SYLU-2026-04-106-B",
                "task_code": "SYLU-2026-04-106",
                "experiment_code": "SYLU-2026-04-106-B",
                "experiment_name": "盐雾试验",
                "required_device": "盐雾试验",
            },
        ],
    )

    updated = client.put(
        "/api/tasks/SYLU-2026-04-106",
        json={
            "id": "SYLU-2026-04-106",
            "code": "SYLU-2026-04-106",
            "name": "冲击试验-轴向修改",
            "sample_count": "3",
            "test_type": "冲击试验 / 盐雾试验",
            "test_types": ["冲击试验", "盐雾试验"],
            "required_device": "冲击试验 / 盐雾试验",
            "axis_codes_by_test_type": {"冲击试验": ["x+", "y+"]},
        },
    )

    storage = client.app.state.storage
    experiments = sorted(storage.read("mes.experiments"), key=lambda item: item["experiment_code"])

    assert updated.status_code == 200
    assert experiments[0]["axis_codes"] == ["x+", "y+"]
    assert "axis_codes" not in experiments[1]


def test_tasks_router_returns_404_for_missing_task(monkeypatch):
    client = build_client(monkeypatch, tasks=[])

    updated = client.put(
        "/api/tasks/UNKNOWN-1",
        json={"id": "UNKNOWN-1", "code": "UNKNOWN-1", "name": "missing"},
    )
    deleted = client.delete("/api/tasks/UNKNOWN-1")

    assert updated.status_code == 404
    assert updated.json() == {"detail": "Task not found"}
    assert deleted.status_code == 404
    assert deleted.json() == {"detail": "Task not found"}


def test_delete_task_also_removes_related_records(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {"id": "SYLU-2026-03-001", "code": "SYLU-2026-03-001", "name": "冲击试验-批次A"},
            {"id": "SYLU-2026-03-002", "code": "SYLU-2026-03-002", "name": "霉菌试验"},
        ],
        schedules=[
            {"id": "SCH-1", "task_code": "SYLU-2026-03-001"},
            {"id": "SCH-2", "task_code": "SYLU-2026-03-002"},
        ],
        samples=[
            {"id": "SYLU-2026-03-001-SP-001", "code": "SYLU-2026-03-001-SP-001", "task_code": "SYLU-2026-03-001"},
            {"id": "SYLU-2026-03-002-SP-001", "code": "SYLU-2026-03-002-SP-001", "task_code": "SYLU-2026-03-002"},
        ],
        streams=[
            {"id": "STREAM-1", "task_code": "SYLU-2026-03-001"},
            {"id": "STREAM-2", "task_code": "SYLU-2026-03-002"},
        ],
        experiments=[
            {"id": "EXP-1", "task_code": "SYLU-2026-03-001", "experiment_code": "SYLU-2026-03-001-A"},
            {"id": "EXP-2", "task_code": "SYLU-2026-03-002", "experiment_code": "SYLU-2026-03-002-A"},
        ],
        experiment_trays=[
            {"id": "REL-1", "task_code": "SYLU-2026-03-001", "experiment_code": "SYLU-2026-03-001-A", "tray_code": "SYLU-2026-03-001-TP-001"},
            {"id": "REL-2", "task_code": "SYLU-2026-03-002", "experiment_code": "SYLU-2026-03-002-A", "tray_code": "SYLU-2026-03-002-TP-001"},
        ],
        experiment_samples=[
            {"id": "EXS-1", "task_code": "SYLU-2026-03-001", "experiment_code": "SYLU-2026-03-001-A", "sample_code": "SYLU-2026-03-001-SP-001"},
            {"id": "EXS-2", "task_code": "SYLU-2026-03-002", "experiment_code": "SYLU-2026-03-002-A", "sample_code": "SYLU-2026-03-002-SP-001"},
        ],
        experiment_runs=[
            {"run_no": "RUN-1", "task_code": "SYLU-2026-03-001", "experiment_code": "SYLU-2026-03-001-A", "tray_codes": ["SYLU-2026-03-001-TP-001"]},
            {"run_no": "RUN-2", "task_code": "SYLU-2026-03-002", "experiment_code": "SYLU-2026-03-002-A", "tray_codes": ["SYLU-2026-03-002-TP-001"]},
        ],
        experiment_run_trays=[
            {"run_no": "RUN-1", "task_code": "SYLU-2026-03-001", "experiment_code": "SYLU-2026-03-001-A", "tray_code": "SYLU-2026-03-001-TP-001"},
            {"run_no": "RUN-2", "task_code": "SYLU-2026-03-002", "experiment_code": "SYLU-2026-03-002-A", "tray_code": "SYLU-2026-03-002-TP-001"},
        ],
    )

    deleted = client.delete("/api/tasks/SYLU-2026-03-001")
    remaining = client.get("/api/tasks")
    storage = client.app.state.storage

    assert deleted.status_code == 204
    assert [item["code"] for item in remaining.json()] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.schedules")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.samples")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.streams")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.experiments")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.experiment_trays")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.experiment_samples")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.experiment_runs")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.experiment_run_trays")] == ["SYLU-2026-03-002"]


def test_tasks_reset_rebuilds_task_related_collections_and_preserves_devices_and_meta(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[{"id": "SYLU-2026-03-999", "code": "SYLU-2026-03-999", "name": "旧任务", "status": "实验进行中"}],
        schedules=[{"id": "SCH-1", "task_code": "SYLU-2026-03-999"}],
        samples=[{"id": "SYLU-2026-03-999-SP-001", "code": "SYLU-2026-03-999-SP-001", "task_code": "SYLU-2026-03-999", "status": "到货", "flow_status": "到货"}],
        streams=[{"id": "STREAM-1", "task_code": "SYLU-2026-03-999"}],
        experiments=[{"id": "EXP-1", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "experiment_name": "振动试验", "status": "实验进行中"}],
        experiment_trays=[{"id": "REL-1", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "tray_code": "SYLU-2026-03-999-TP-001"}],
        experiment_samples=[{"id": "EXS-1", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "sample_code": "SYLU-2026-03-999-SP-001"}],
        experiment_runs=[{"run_no": "RUN-OLD", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A"}],
        experiment_run_trays=[{"run_no": "RUN-OLD", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "tray_code": "SYLU-2026-03-999-TP-001"}],
        experiment_run_steps=[{"run_no": "RUN-OLD", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "axis_code": "x+", "status": "实验进行中"}],
        staging_events=[{"id": "EVENT-OLD", "task_code": "SYLU-2026-03-999", "tray_code": "SYLU-2026-03-999-TP-001", "action": "stock_out"}],
        conflicts=[{"task_code": "SYLU-2026-03-999"}],
        devices=[{"id": "device-1", "code": "LAB-001", "name": "振动一室"}],
        meta={"schema_version": 2},
    )

    response = client.post("/api/tasks/reset")
    storage = client.app.state.storage

    assert response.status_code == 200
    assert response.json()["task_count"] == 20
    assert response.json()["experiment_count"] == 60
    assert response.json()["external_intake_count"] == 8
    assert response.json()["sample_count"] == len(storage.read("mes.samples"))
    assert response.json()["sample_count"] > 100
    assert len(storage.read("mes.tasks")) == 20
    assert len(storage.read("mes.external_task_intakes")) == 8
    assert all(re.fullmatch(r"\d{2}单位", item["client"]) for item in storage.read("mes.external_task_intakes"))
    today = datetime.now()
    assert storage.read("mes.tasks")[0]["code"] == f"SYLU-{today.year}-{today.month:02d}-001"
    assert storage.read("mes.tasks")[0]["arrival_at"].startswith(f"{today.year}-{today.month:02d}-{today.day:02d}")
    assert all(len(task["test_types"]) == 3 for task in storage.read("mes.tasks"))
    assert all(task["test_type"] == " / ".join(task["test_types"]) for task in storage.read("mes.tasks"))
    assert all(task["status"] == "待排程" for task in storage.read("mes.tasks"))
    assert all("盐雾试验" in str(task["test_type"]).split(" / ") for task in storage.read("mes.tasks"))
    assert all(sample["status"] == "运输中" and sample["flow_status"] == "运输中" for sample in storage.read("mes.samples"))
    assert all(experiment["status"] == "待排程" for experiment in storage.read("mes.experiments"))
    assert storage.read("mes.schedules") == []
    assert storage.read("mes.streams") == []
    assert storage.read("mes.experiment_trays") == []
    assert storage.read("mes.experiment_samples") == []
    assert storage.read("mes.experiment_runs") == []
    assert storage.read("mes.experiment_run_trays") == []
    assert storage.read("mes.experiment_run_steps") == []
    assert storage.read("mes.staging_events") == []
    assert storage.read("mes.conflicts") == []
    preserved_devices = storage.read("mes.devices")
    assert [(device["id"], device["code"], device["name"]) for device in preserved_devices] == [
        ("device-1", "LAB-001", "振动一室")
    ]
    assert storage.read_all()["mes.meta"] == {"schema_version": 2}

    from app.api.routes import tasks as tasks_route

    assert "mes.experiment_run_steps" in tasks_route.TASK_STORAGE_UPDATE_KEYS
    assert "mes.staging_events" in tasks_route.TASK_STORAGE_UPDATE_KEYS


def test_tasks_reset_clears_attendance_sessions_without_deleting_users(monkeypatch):
    from app.services.attendance_service import AttendanceService, InMemoryAttendanceRepository, get_attendance_service, set_attendance_service_for_tests

    client = build_client(monkeypatch)
    current_time = {"value": datetime(2026, 7, 3, 8, 0, 0, tzinfo=timezone.utc)}
    service = AttendanceService(
        repository=InMemoryAttendanceRepository(),
        now=lambda: current_time["value"],
    )
    set_attendance_service_for_tests(service)
    service = get_attendance_service()
    service.create_user(
        username="task-reset-worker",
        password="pw123",
        employee_name="任务重置员工",
        role_name="试验员",
        active=True,
    )
    service.login_lab("冲击二室", username="task-reset-worker", password="pw123")
    service.start_lab_work("冲击二室")
    current_time["value"] = datetime(2026, 7, 3, 8, 5, 0, tzinfo=timezone.utc)
    service.finish_work_interval(lab_name="冲击二室")
    assert next(row for row in service.list_work_times("2026-07-03") if row["username"] == "task-reset-worker")["todaySeconds"] == 300

    reset = client.post("/api/tasks/reset")
    session = service.read_lab_session("冲击二室")
    users = service.list_users()
    worker = next(row for row in service.list_work_times("2026-07-03") if row["username"] == "task-reset-worker")

    assert reset.status_code == 200
    assert session["active"] is False
    assert any(user["username"] == "task-reset-worker" for user in users)
    assert worker["todaySeconds"] == 0

