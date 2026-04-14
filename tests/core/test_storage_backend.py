from __future__ import annotations

import json
import re
import sys

import app.core.storage_backend as storage_backend_module
from app.core.demo_data_reset import build_demo_reset_snapshot, reset_demo_data, run_demo_reset
from app.core.storage_backend import DatabaseStorageBackend, JsonFileStorage


class InMemorySnapshotRepository:
    def __init__(self, payloads: dict[str, str] | None = None) -> None:
        self.payloads = dict(payloads or {})

    def read_all(self) -> dict[str, str]:
        return dict(self.payloads)

    def read(self, key: str) -> str | None:
        return self.payloads.get(key)

    def write_many(self, updates: dict[str, str]) -> None:
        self.payloads.update(updates)


def _legacy_sample_payload() -> list[dict]:
    return [
        {
            "code": "SP-001",
            "task_code": "SYLU-2026-04-121",
            "history": [
                {
                    "action": "鏍峰搧缂栧彿閲嶆帓",
                    "detail": "浠诲姟 SYLU-2026-04-121；鏍峰搧缁戝畾浠诲姟",
                    "location": "瀹ゅ鎺ラ┏鍖",
                    "owner": "",
                    "status": "杩愯緭涓",
                }
            ],
        }
    ]


def _read_store(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_read_sanitizes_legacy_sample_text_and_rewrites_file(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    path.write_text(json.dumps({"mes.samples": _legacy_sample_payload()}, ensure_ascii=False), encoding="utf-8")

    storage = JsonFileStorage(path)

    samples = storage.read("mes.samples")

    assert samples[0]["history"][0]["action"] == "样品编号重排"
    assert samples[0]["history"][0]["detail"] == "任务 SYLU-2026-04-121；样品绑定任务"
    assert samples[0]["history"][0]["location"] == "室外接驳区"
    assert samples[0]["history"][0]["status"] == "运输中"

    persisted = _read_store(path)
    assert persisted["mes.samples"][0]["history"][0]["action"] == "样品编号重排"


def test_write_sanitizes_legacy_sample_text_before_persisting(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    storage = JsonFileStorage(path)

    storage.write("mes.samples", _legacy_sample_payload())

    persisted = _read_store(path)
    assert persisted["mes.samples"][0]["history"][0]["action"] == "样品编号重排"
    assert persisted["mes.samples"][0]["history"][0]["detail"] == "任务 SYLU-2026-04-121；样品绑定任务"


def test_write_many_sanitizes_legacy_sample_text_before_persisting(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    storage = JsonFileStorage(path)

    storage.write_many({"mes.samples": _legacy_sample_payload()})

    persisted = _read_store(path)
    assert persisted["mes.samples"][0]["history"][0]["location"] == "室外接驳区"
    assert persisted["mes.samples"][0]["history"][0]["status"] == "运输中"


def test_json_storage_normalizes_legacy_experiment_statuses_and_rewrites_file(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    path.write_text(
        json.dumps(
            {
                "mes.tasks": [
                    {"code": "TASK-001", "status": "实验中"},
                    {"code": "TASK-002", "status": "实验已经完成"},
                ],
                "mes.experiments": [
                    {"task_code": "TASK-001", "experiment_code": "TASK-001-A", "status": "实验中"},
                    {"task_code": "TASK-002", "experiment_code": "TASK-002-A", "status": "实验完成"},
                ],
                "mes.schedules": [
                    {"task_code": "TASK-001", "experiment_code": "TASK-001-A", "status": "实验中"},
                    {"task_code": "TASK-002", "experiment_code": "TASK-002-A", "status": "实验已经完成"},
                ],
                "mes.samples": [
                    {
                        "code": "TASK-001-SP-001",
                        "task_code": "TASK-001",
                        "status": "实验中",
                        "flow_status": "实验完成",
                        "trays": [{"tray_code": "TASK-001-TP-001", "status": "实验中", "quantity": 1}],
                        "history": [{"action": "开始实验", "detail": "TASK-001 / A实验 / 实验中", "status": "实验完成"}],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    storage = JsonFileStorage(path)
    snapshot = storage.read_all()

    assert [task["status"] for task in snapshot["mes.tasks"]] == ["任务进行中", "任务已完成"]
    experiment_status_by_code = {experiment["experiment_code"]: experiment["status"] for experiment in snapshot["mes.experiments"]}
    assert experiment_status_by_code["TASK-001-A"] == "实验进行中"
    assert experiment_status_by_code["TASK-002-A"] == "实验已完成"
    assert [schedule["status"] for schedule in snapshot["mes.schedules"]] == ["实验进行中", "实验已完成"]
    assert snapshot["mes.samples"][0]["status"] == "实验进行中"
    assert snapshot["mes.samples"][0]["flow_status"] == "实验已完成"
    assert snapshot["mes.samples"][0]["trays"][0]["status"] == "实验进行中"
    assert snapshot["mes.samples"][0]["history"][0]["status"] == "实验已完成"
    assert snapshot["mes.samples"][0]["history"][0]["detail"] == "TASK-001 / A实验 / 实验进行中"

    persisted = _read_store(path)
    assert persisted["mes.tasks"][0]["status"] == "任务进行中"
    assert persisted["mes.tasks"][1]["status"] == "任务已完成"


def test_database_storage_backend_bootstraps_from_seed_storage_and_normalizes_samples(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    seed_storage = JsonFileStorage(path)
    seed_storage.write_many(
        {
            "mes.tasks": [{"id": "task-1", "code": "TASK-001", "name": "Task 1"}],
            "mes.samples": _legacy_sample_payload(),
        }
    )
    repository = InMemorySnapshotRepository()

    storage = DatabaseStorageBackend(repository, bootstrap_storage=seed_storage)

    snapshot = storage.read_all()

    assert snapshot["mes.tasks"][0]["code"] == "TASK-001"
    assert snapshot["mes.samples"][0]["history"][0]["action"] == "样品编号重排"
    assert json.loads(repository.payloads["mes.tasks"])[0]["code"] == "TASK-001"
    assert json.loads(repository.payloads["mes.samples"])[0]["history"][0]["detail"] == "任务 SYLU-2026-04-121；样品绑定任务"


def test_database_storage_backend_write_many_persists_snapshot_payloads() -> None:
    repository = InMemorySnapshotRepository()
    storage = DatabaseStorageBackend(repository)

    storage.write_many(
        {
            "mes.devices": [{"id": "device-1", "code": "EQ-001", "name": "Device 1"}],
            "mes.streams": [{"id": "stream-1", "task_code": "TASK-001", "status": "采集中"}],
        }
    )

    assert json.loads(repository.payloads["mes.devices"])[0]["code"] == "EQ-001"
    assert storage.read("mes.streams")[0]["status"] == "采集中"
    assert storage.read_all()["mes.conflicts"] == []


def test_json_storage_initializes_experiment_collections_by_default(tmp_path) -> None:
    path = tmp_path / "mes_store.json"

    storage = JsonFileStorage(path)
    snapshot = storage.read_all()

    assert snapshot["mes.experiments"] == []
    assert snapshot["mes.experiment_trays"] == []
    assert snapshot["mes.experiment_samples"] == []


def test_database_storage_bootstrap_persists_experiment_collections(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    seed_storage = JsonFileStorage(path)
    seed_storage.write_many(
        {
            "mes.tasks": [{"id": "task-1", "code": "TASK-001", "name": "Task 1"}],
            "mes.experiments": [{"id": "exp-1", "task_code": "TASK-001", "experiment_code": "TASK-001-A"}],
            "mes.experiment_trays": [{"id": "rel-1", "task_code": "TASK-001", "experiment_code": "TASK-001-A", "tray_code": "TASK-001-TP-001"}],
            "mes.experiment_samples": [{"id": "sample-rel-1", "task_code": "TASK-001", "experiment_code": "TASK-001-A", "sample_code": "TASK-001-SP-001"}],
        }
    )
    repository = InMemorySnapshotRepository()

    storage = DatabaseStorageBackend(repository, bootstrap_storage=seed_storage)
    snapshot = storage.read_all()

    assert [item["experiment_code"] for item in snapshot["mes.experiments"]] == ["TASK-001-A", "TASK-001-B", "TASK-001-C"]
    assert snapshot["mes.experiment_trays"] == [{"id": "rel-1", "task_code": "TASK-001", "experiment_code": "TASK-001-A", "tray_code": "TASK-001-TP-001"}]
    assert snapshot["mes.experiment_samples"] == [{"id": "sample-rel-1", "task_code": "TASK-001", "experiment_code": "TASK-001-A", "sample_code": "TASK-001-SP-001"}]
    assert json.loads(repository.payloads["mes.experiments"])[0]["experiment_code"] == "TASK-001-A"
    assert json.loads(repository.payloads["mes.experiment_samples"])[0]["sample_code"] == "TASK-001-SP-001"


def test_demo_reset_snapshot_generates_20_fresh_tasks_with_expected_structure() -> None:
    snapshot = build_demo_reset_snapshot()

    tasks = snapshot["mes.tasks"]
    samples = snapshot["mes.samples"]
    experiments = snapshot["mes.experiments"]

    assert len(tasks) == 20
    assert [task["code"] for task in tasks] == [f"SYLU-2026-03-{index:03d}" for index in range(1, 21)]
    assert all(task["source"] == "外部委托" for task in tasks[:10])
    assert all(task["source"] == "内部新增" for task in tasks[10:])
    assert all(task["status"] == "待排程" for task in tasks)

    assert len(experiments) == 60
    experiments_by_task = {}
    for experiment in experiments:
        experiments_by_task.setdefault(experiment["task_code"], []).append(experiment)
    assert set(experiments_by_task) == {task["code"] for task in tasks}
    assert all(len(task_experiments) == 3 for task_experiments in experiments_by_task.values())
    assert all(len({item["experiment_name"] for item in task_experiments}) == 3 for task_experiments in experiments_by_task.values())

    samples_by_task = {}
    for sample in samples:
        samples_by_task.setdefault(sample["task_code"], []).append(sample)
        assert sample["status"] == "运输中"
        assert sample["flow_status"] == "运输中"
    assert set(samples_by_task) == {task["code"] for task in tasks}
    assert all(len(task_samples) > 4 for task_samples in samples_by_task.values())

    for task in tasks:
        assert re.fullmatch(r"SYLU-2026-03-\d{3}", task["code"])
        assert task["experiment_count"] == 3
        assert len(task["experiment_codes"]) == 3
        assert task["sample_count"].isdigit()
        assert int(task["sample_count"]) > 4
        assert len(samples_by_task[task["code"]]) == int(task["sample_count"])

    assert snapshot["mes.schedules"] == []
    assert snapshot["mes.experiment_trays"] == []
    assert snapshot["mes.experiment_samples"] == []
    assert snapshot["mes.streams"] == []
    assert snapshot["mes.conflicts"] == []


def test_reset_demo_data_rewrites_store_with_fresh_tasks_and_preserves_devices(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    seed_storage = JsonFileStorage(path)
    seed_storage.write_many(
        {
            "mes.tasks": [{"id": "legacy-task", "code": "SYLU-2026-03-999", "name": "旧任务", "status": "已排程"}],
            "mes.samples": [{"id": "legacy-sample", "code": "SYLU-2026-03-999-SP-001", "task_code": "SYLU-2026-03-999", "status": "已入库"}],
            "mes.experiments": [{"id": "legacy-exp", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A"}],
            "mes.schedules": [{"id": "legacy-schedule", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A"}],
            "mes.experiment_trays": [{"id": "legacy-rel", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "tray_code": "SYLU-2026-03-999-TP-001"}],
            "mes.experiment_samples": [{"id": "legacy-sample-rel", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "sample_code": "SYLU-2026-03-999-SP-001"}],
            "mes.streams": [{"id": "legacy-stream", "task_code": "SYLU-2026-03-999", "status": "采集中"}],
            "mes.conflicts": [{"id": "legacy-conflict", "task_code": "SYLU-2026-03-999"}],
            "mes.devices": [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}],
        }
    )
    repository = InMemorySnapshotRepository()
    storage = DatabaseStorageBackend(repository, bootstrap_storage=seed_storage)

    snapshot = reset_demo_data(storage, store_path=path)
    persisted = _read_store(path)

    assert snapshot["mes.devices"] == [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}]
    assert len(snapshot["mes.tasks"]) == 20
    assert snapshot["mes.schedules"] == []
    assert snapshot["mes.experiment_trays"] == []
    assert snapshot["mes.experiment_samples"] == []
    assert snapshot["mes.streams"] == []
    assert snapshot["mes.conflicts"] == []
    assert len(persisted["mes.tasks"]) == 20
    assert persisted["mes.devices"] == [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}]
    assert persisted["mes.tasks"][0]["code"] == "SYLU-2026-03-001"


def test_run_demo_reset_returns_summary_counts(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    storage = DatabaseStorageBackend(InMemorySnapshotRepository(), bootstrap_storage=JsonFileStorage(path))

    summary = run_demo_reset(storage, store_path=path)

    assert summary["task_count"] == 20
    assert summary["experiment_count"] == 60
    assert summary["sample_count"] > 100
    assert summary["store_path"] == str(path)


def test_json_storage_preserves_existing_task_codes_without_auto_migration(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    path.write_text(
        json.dumps(
            {
                "mes.tasks": [
                    {
                        "id": "task-1",
                        "code": "SYLU-2026-04-105",
                        "name": "高低温湿热试验-批次E",
                        "test_type": "高低温湿热试验",
                        "required_device": "高低温湿热试验",
                        "sample_count": 2,
                        "arrival_at": "2026-03-11 23:31",
                        "created_at": "2026-03-11T05:31:40.547Z",
                    }
                ],
                "mes.schedules": [
                    {
                        "id": "schedule-1",
                        "task_code": "SYLU-2026-04-105",
                        "experiment_code": "SYLU-2026-04-105-A",
                        "device": "高低温湿热一室",
                        "start_at": "2026-03-12T08:00:00.000Z",
                        "end_at": "2026-03-12T12:00:00.000Z",
                        "status": "待排程",
                    }
                ],
                "mes.samples": [
                    {
                        "id": "sample-1",
                        "code": "SYLU-2026-04-105-SP-001",
                        "task_code": "SYLU-2026-04-105",
                        "created_at": "2026-03-11T05:31:59.908Z",
                        "trays": [
                            {
                                "id": "tray-1",
                                "tray_code": "SYLU-2026-04-105-TP-001",
                                "sample_code": "SYLU-2026-04-105-SP-001",
                                "quantity": 1,
                            }
                        ],
                    }
                ],
                "mes.streams": [
                    {
                        "id": "stream-1",
                        "task_code": "SYLU-2026-04-105",
                        "device": "高低温湿热一室",
                        "status": "采集中",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    storage = JsonFileStorage(path)
    snapshot = storage.read_all()

    preserved_task_code = snapshot["mes.tasks"][0]["code"]
    assert preserved_task_code == "SYLU-2026-04-105"
    assert snapshot["mes.meta"]["schema_version"] == 2
    assert snapshot["mes.samples"][0]["task_code"] == preserved_task_code
    assert snapshot["mes.samples"][0]["code"] == "SYLU-2026-04-105-SP-001"
    assert snapshot["mes.samples"][0]["trays"][0]["tray_code"] == "SYLU-2026-04-105-TP-001"
    assert snapshot["mes.samples"][0]["trays"][0]["sample_code"] == "SYLU-2026-04-105-SP-001"
    assert snapshot["mes.schedules"][0]["task_code"] == preserved_task_code
    assert snapshot["mes.schedules"][0]["experiment_code"] == "SYLU-2026-04-105-A"
    assert snapshot["mes.streams"][0]["task_code"] == preserved_task_code

    persisted = _read_store(path)
    assert persisted["mes.tasks"][0]["code"] == "SYLU-2026-04-105"
    assert persisted["mes.meta"]["schema_version"] == 2


def test_json_storage_backfills_three_experiments_without_renaming_existing_task_codes(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    path.write_text(
        json.dumps(
            {
                "mes.tasks": [
                    {
                        "id": "task-1",
                        "code": "SYLU-2026-04-105",
                        "name": "高低温湿热试验-批次E",
                        "test_type": "高低温湿热试验",
                        "required_device": "高低温湿热试验",
                        "sample_count": 4,
                        "arrival_at": "2026-03-11 23:31",
                        "created_at": "2026-03-11T05:31:40.547Z",
                    }
                ],
                "mes.samples": [],
                "mes.schedules": [],
                "mes.experiments": [],
                "mes.experiment_trays": [],
                "mes.streams": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    storage = JsonFileStorage(path)

    first_snapshot = storage.read_all()
    second_snapshot = storage.read_all()

    assert first_snapshot["mes.tasks"][0]["code"] == second_snapshot["mes.tasks"][0]["code"] == "SYLU-2026-04-105"
    assert first_snapshot["mes.tasks"][0]["experiment_count"] == 3
    assert first_snapshot["mes.tasks"][0]["experiment_codes"] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]
    assert [item["experiment_code"] for item in first_snapshot["mes.experiments"]] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]
    assert len(first_snapshot["mes.experiments"]) == 3
    assert all(re.match(r"^SYLU-2026-04-105-[A-Z]$", item["experiment_code"]) for item in first_snapshot["mes.experiments"])
    assert all(item["experiment_name"] and item["experiment_name"] not in {"A实验", "B实验"} for item in first_snapshot["mes.experiments"])


def test_json_storage_backfills_three_experiments_for_existing_sylu_tasks_without_experiment_rows(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    path.write_text(
        json.dumps(
            {
                "mes.tasks": [
                    {
                        "id": "SYLU-2026-03-001",
                        "code": "SYLU-2026-03-001",
                        "name": "温度冲击试验",
                        "test_type": "温度冲击试验",
                        "required_device": "温度冲击试验",
                        "sample_count": 6,
                        "arrival_at": "2026-03-11 16:17",
                        "created_at": "2026-03-11T06:17:03Z",
                    }
                ],
                "mes.samples": [],
                "mes.schedules": [],
                "mes.experiments": [],
                "mes.experiment_trays": [],
                "mes.experiment_samples": [],
                "mes.streams": [],
                "mes.meta": {"schema_version": 2},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    storage = JsonFileStorage(path)

    snapshot = storage.read_all()

    assert snapshot["mes.tasks"][0]["experiment_count"] == 3
    assert snapshot["mes.tasks"][0]["experiment_codes"] == [
        "SYLU-2026-03-001-A",
        "SYLU-2026-03-001-B",
        "SYLU-2026-03-001-C",
    ]
    assert [item["experiment_code"] for item in snapshot["mes.experiments"]] == [
        "SYLU-2026-03-001-A",
        "SYLU-2026-03-001-B",
        "SYLU-2026-03-001-C",
    ]


def test_storage_health_report_describes_json_mode_and_bootstrap_source(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(storage_backend_module.settings, "STORAGE_BACKEND", "json")
    monkeypatch.setattr(storage_backend_module.settings, "MYSQL_BOOTSTRAP_FROM_JSON", True)
    monkeypatch.setattr(storage_backend_module, "DEFAULT_STORE_PATH", tmp_path / "mes_store.json")
    monkeypatch.setattr(
        storage_backend_module,
        "check_mysql_storage_connection",
        lambda: {
            "status": "unhealthy",
            "detail": "pymysql is required for the MySQL storage backend",
        },
    )
    storage_backend_module._storage_backend = None

    storage_backend_module.get_storage_backend()
    report = storage_backend_module.get_storage_health_report()

    assert report["status"] == "ok"
    assert report["configured_backend"] == "json"
    assert report["active_backend"] == "json"
    assert report["database"]["status"] == "not_configured"
    assert report["mysql"] == {
        "status": "unhealthy",
        "detail": "pymysql is required for the MySQL storage backend",
    }
    assert report["bootstrap"] == {
        "from_json_enabled": True,
        "source_path": str(tmp_path / "mes_store.json"),
        "last_result": "not_applicable",
    }


def test_storage_health_report_marks_mysql_unhealthy_when_connection_check_fails(monkeypatch) -> None:
    monkeypatch.setattr(storage_backend_module.settings, "STORAGE_BACKEND", "mysql")
    monkeypatch.setattr(storage_backend_module.settings, "MYSQL_BOOTSTRAP_FROM_JSON", True)
    storage_backend_module._storage_backend = None
    monkeypatch.setattr(
        storage_backend_module,
        "check_mysql_storage_connection",
        lambda: {
            "status": "unhealthy",
            "detail": "pymysql is required for the MySQL storage backend",
        },
    )

    report = storage_backend_module.get_storage_health_report()

    assert report["status"] == "unhealthy"
    assert report["configured_backend"] == "mysql"
    assert report["active_backend"] is None
    assert report["database"] == {
        "status": "unhealthy",
        "detail": "pymysql is required for the MySQL storage backend",
    }
    assert report["bootstrap"]["from_json_enabled"] is True
    assert report["bootstrap"]["last_result"] == "not_checked"


def test_check_mysql_storage_connection_uses_short_timeouts(monkeypatch) -> None:
    captured = {}

    class _FakeCursor:
        def execute(self, sql):
            captured["sql"] = sql

        def fetchone(self):
            return (1,)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class _FakeConnection:
        def cursor(self):
            return _FakeCursor()

        def close(self):
            captured["closed"] = True

    class _FakePyMySQL:
        @staticmethod
        def connect(**kwargs):
            captured["kwargs"] = kwargs
            return _FakeConnection()

    monkeypatch.setitem(sys.modules, "pymysql", _FakePyMySQL)

    report = storage_backend_module.check_mysql_storage_connection()

    assert report["status"] == "ok"
    assert captured["kwargs"]["connect_timeout"] == 3
    assert captured["kwargs"]["read_timeout"] == 3
    assert captured["kwargs"]["write_timeout"] == 3
    assert captured["sql"] == "SELECT 1"
    assert captured["closed"] is True


def test_storage_backend_defaults_to_mysql() -> None:
    assert storage_backend_module.settings.STORAGE_BACKEND == "mysql"

