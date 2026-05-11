from fastapi import FastAPI
from fastapi.testclient import TestClient


class FakeTaskStorage:
    def __init__(
        self,
        tasks=None,
        schedules=None,
        samples=None,
        streams=None,
        experiments=None,
        experiment_trays=None,
        experiment_samples=None,
        conflicts=None,
        devices=None,
        meta=None,
    ):
        self.payloads = {
            "mes.tasks": list(tasks or []),
            "mes.schedules": list(schedules or []),
            "mes.samples": list(samples or []),
            "mes.streams": list(streams or []),
            "mes.experiments": list(experiments or []),
            "mes.experiment_trays": list(experiment_trays or []),
            "mes.experiment_samples": list(experiment_samples or []),
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
    schedules=None,
    samples=None,
    streams=None,
    experiments=None,
    experiment_trays=None,
    experiment_samples=None,
    conflicts=None,
    devices=None,
    meta=None,
):
    from app.api.routes import tasks as tasks_route

    storage = FakeTaskStorage(
        tasks=tasks,
        schedules=schedules,
        samples=samples,
        streams=streams,
        experiments=experiments,
        experiment_trays=experiment_trays,
        experiment_samples=experiment_samples,
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


def test_tasks_list_hides_returned_tasks_unless_archived_are_requested(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {"id": "task-active", "code": "TASK-ACTIVE", "name": "活跃任务", "status": "待排程"},
            {"id": "task-returned", "code": "TASK-RETURNED", "name": "历史任务", "status": "厂家收回"},
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


def test_create_task_generates_experiments_from_test_types_in_order(monkeypatch):
    client = build_client(monkeypatch, tasks=[])

    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-04-105",
            "code": "SYLU-2026-04-105",
            "name": "高低温湿热试验-批次E",
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


def test_create_task_uses_test_types_count_over_stale_experiment_count(monkeypatch):
    client = build_client(monkeypatch, tasks=[])

    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-04-109",
            "code": "SYLU-2026-04-109",
            "name": "固定实验类型任务",
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
        conflicts=[{"task_code": "SYLU-2026-03-999"}],
        devices=[{"id": "device-1", "code": "LAB-001", "name": "振动一室"}],
        meta={"schema_version": 2},
    )

    response = client.post("/api/tasks/reset")
    storage = client.app.state.storage

    assert response.status_code == 200
    assert response.json()["task_count"] == 20
    assert response.json()["experiment_count"] == 60
    assert response.json()["sample_count"] == len(storage.read("mes.samples"))
    assert response.json()["sample_count"] > 100
    assert len(storage.read("mes.tasks")) == 20
    assert all(task["status"] == "待排程" for task in storage.read("mes.tasks"))
    assert all("盐雾试验" in str(task["test_type"]).split(" / ") for task in storage.read("mes.tasks"))
    assert all(sample["status"] == "运输中" and sample["flow_status"] == "运输中" for sample in storage.read("mes.samples"))
    assert all(experiment["status"] == "待排程" for experiment in storage.read("mes.experiments"))
    assert storage.read("mes.schedules") == []
    assert storage.read("mes.streams") == []
    assert storage.read("mes.experiment_trays") == []
    assert storage.read("mes.experiment_samples") == []
    assert storage.read("mes.conflicts") == []
    assert storage.read("mes.devices") == [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}]
    assert storage.read_all()["mes.meta"] == {"schema_version": 2}

