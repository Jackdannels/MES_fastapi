from __future__ import annotations

import importlib
import os
import re
import sys
from pathlib import Path
from datetime import datetime

import pytest

import app.core.storage_backend as storage_backend_module
from app.core.demo_data_reset import build_demo_reset_snapshot, reset_demo_data, run_demo_reset
from app.core.storage_backend import normalize_storage_payload


def test_demo_reset_snapshot_generates_20_fresh_tasks_with_expected_structure() -> None:
    current_time = datetime(2026, 5, 13, 9, 30, 0)
    snapshot = build_demo_reset_snapshot(now=current_time)

    tasks = snapshot["mes.tasks"]
    samples = snapshot["mes.samples"]
    experiments = snapshot["mes.experiments"]

    assert len(tasks) == 20
    assert [task["code"] for task in tasks] == [f"SYLU-2026-05-{index:03d}" for index in range(1, 21)]
    assert tasks[0]["created_at"].startswith("2026-05-13T")
    assert tasks[0]["arrival_at"].startswith("2026-05-13")
    assert tasks[0]["due_at"].startswith("2026-05-20")
    assert all(task["source"] == "外部委托" for task in tasks[:10])
    assert all(task["source"] == "内部新增" for task in tasks[10:])
    assert all(task["status"] == "待排程" for task in tasks)
    assert all(task["experiment_count"] == 3 for task in tasks)
    assert all(len(task["test_types"]) == 3 for task in tasks)
    assert all("盐雾试验" in str(task["test_type"]).split(" / ") for task in tasks)
    assert all("盐雾试验" in task["test_types"] for task in tasks)
    assert all(len(set(str(task["test_type"]).split(" / "))) == 3 for task in tasks)

    assert len(experiments) == 60
    experiments_by_task = {}
    for experiment in experiments:
        experiments_by_task.setdefault(experiment["task_code"], []).append(experiment)
    assert set(experiments_by_task) == {task["code"] for task in tasks}
    assert all(len(task_experiments) == 3 for task_experiments in experiments_by_task.values())
    assert all(any(experiment["experiment_name"] == "盐雾试验" for experiment in task_experiments) for task_experiments in experiments_by_task.values())
    assert all(len({experiment["experiment_name"] for experiment in task_experiments}) == 3 for task_experiments in experiments_by_task.values())
    assert all(all(experiment["status"] == "待排程" for experiment in task_experiments) for task_experiments in experiments_by_task.values())

    samples_by_task = {}
    for sample in samples:
        samples_by_task.setdefault(sample["task_code"], []).append(sample)
        assert sample["status"] == "运输中"
        assert sample["flow_status"] == "运输中"
    assert set(samples_by_task) == {task["code"] for task in tasks}
    assert all(len(task_samples) > 4 for task_samples in samples_by_task.values())

    for task in tasks:
        assert re.fullmatch(r"SYLU-2026-05-\d{3}", task["code"])
        assert task["experiment_count"] == 3
        assert len(task["experiment_codes"]) == 3
        assert task["test_type"] == " / ".join(task["test_types"])

    assert snapshot["mes.schedules"] == []
    assert snapshot["mes.experiment_trays"] == []
    assert snapshot["mes.experiment_samples"] == []
    assert snapshot["mes.streams"] == []
    assert snapshot["mes.conflicts"] == []


def test_normalize_storage_payload_does_not_expand_custom_task_experiments_to_three() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-04-501",
                "name": "自定义双实验任务",
                "test_type": "盐雾试验 / 振动试验",
                "test_types": ["盐雾试验", "振动试验"],
                "experiment_count": 2,
                "status": "待排程",
            }
        ],
        "mes.experiments": [],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["experiment_count"] == 2
    assert normalized["mes.tasks"][0]["experiment_codes"] == [
        "SYLU-2026-04-501-A",
        "SYLU-2026-04-501-B",
    ]
    assert [experiment["experiment_name"] for experiment in normalized["mes.experiments"]] == ["盐雾试验", "振动试验"]


def test_normalize_storage_payload_splits_legacy_test_type_without_expanding_to_three() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-04-503",
                "name": "旧双实验任务",
                "test_type": "盐雾试验 / 振动试验",
                "status": "待排程",
            }
        ],
        "mes.experiments": [],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["experiment_count"] == 2
    assert normalized["mes.tasks"][0]["experiment_codes"] == [
        "SYLU-2026-04-503-A",
        "SYLU-2026-04-503-B",
    ]
    assert [experiment["experiment_name"] for experiment in normalized["mes.experiments"]] == ["盐雾试验", "振动试验"]


def test_normalize_storage_payload_does_not_use_task_name_as_experiment_type() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-04-504",
                "name": "只修改任务名称",
                "experiment_count": 1,
                "status": "待排程",
            }
        ],
        "mes.experiments": [],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert [experiment["experiment_name"] for experiment in normalized["mes.experiments"]] == ["冲击试验"]


def test_normalize_storage_payload_uses_test_types_over_stale_experiment_count() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-04-502",
                "name": "固定实验类型任务",
                "test_type": "盐雾试验 / 振动试验",
                "test_types": ["盐雾试验", "振动试验"],
                "experiment_count": 5,
                "status": "待排程",
            }
        ],
        "mes.experiments": [],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["experiment_count"] == 2
    assert normalized["mes.tasks"][0]["experiment_codes"] == [
        "SYLU-2026-04-502-A",
        "SYLU-2026-04-502-B",
    ]
    assert [experiment["experiment_name"] for experiment in normalized["mes.experiments"]] == ["盐雾试验", "振动试验"]


def test_normalize_storage_payload_marks_task_returned_from_staging_events_when_trays_are_reset() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-03-001",
                "name": "已收回任务",
                "status": "待排程",
                "transfer_status": "已入库",
                "experiment_codes": ["SYLU-2026-03-001-A"],
                "experiment_count": 1,
            }
        ],
        "mes.samples": [
            {
                "code": "SYLU-2026-03-001-SP-001",
                "task_code": "SYLU-2026-03-001",
                "status": "已入库",
                "flow_status": "已入库",
                "trays": [],
            },
            {
                "code": "SYLU-2026-03-001-SP-002",
                "task_code": "SYLU-2026-03-001",
                "status": "已入库",
                "flow_status": "已入库",
                "trays": [],
            },
        ],
        "mes.experiments": [
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "experiment_name": "盐雾试验",
                "status": "待排程",
            }
        ],
        "mes.experiment_trays": [
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "tray_code": "SYLU-2026-03-001-TP-001",
            }
        ],
        "mes.experiment_samples": [
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "sample_code": "SYLU-2026-03-001-SP-001",
            },
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "sample_code": "SYLU-2026-03-001-SP-002",
            },
        ],
        "mes.staging_events": [
            {
                "tray_code": "SYLU-2026-03-001-TP-001",
                "task_code": "SYLU-2026-03-001",
                "action": "manufacturer_return",
                "time": "2026-04-28T03:32:34Z",
                "target_lab": "厂家收回",
            }
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["status"] == "厂家收回"
    assert normalized["mes.tasks"][0]["transfer_status"] == "厂家收回"
    assert normalized["mes.samples"][0]["status"] == "厂家收回"
    assert normalized["mes.samples"][0]["flow_status"] == "厂家收回"
    assert normalized["mes.samples"][0]["trays"] == [
        {
            "tray_code": "SYLU-2026-03-001-TP-001",
            "sample_code": "SYLU-2026-03-001-SP-001",
            "status": "厂家收回",
            "quantity": 1,
            "updated_at": "2026-04-28T03:32:34Z",
        }
    ]


def test_normalize_storage_payload_converts_legacy_handover_stored_status_to_arrived() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-05-001",
                "status": "待排程",
                "transfer_status": "已入库",
            }
        ],
        "mes.samples": [
            {
                "code": "SYLU-2026-05-001-SP-001",
                "task_code": "SYLU-2026-05-001",
                "status": "已入库",
                "flow_status": "已入库",
                "trays": [{"tray_code": "SYLU-2026-05-001-TP-001", "status": "已入库"}],
                "history": [{"action": "任务已确认入库", "status": "已入库"}],
            }
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["transfer_status"] == "到货"
    assert normalized["mes.samples"][0]["status"] == "到货"
    assert normalized["mes.samples"][0]["flow_status"] == "到货"
    assert normalized["mes.samples"][0]["trays"][0]["status"] == "到货"
    assert normalized["mes.samples"][0]["history"][0]["status"] == "到货"


def test_normalize_storage_payload_keeps_returned_task_archived_even_if_legacy_stock_in_followed() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-03-001",
                "name": "已收回任务",
                "sample_count": 1,
                "test_types": ["盐雾试验"],
            }
        ],
        "mes.samples": [
            {
                "code": "SYLU-2026-03-001-SP-001",
                "task_code": "SYLU-2026-03-001",
                "status": "已到达暂存间",
                "flow_status": "已到达暂存间",
                "location": "恒温恒湿间（暂存间）",
                "trays": [
                    {
                        "tray_code": "SYLU-2026-03-001-TP-001",
                        "status": "已到达暂存间",
                    }
                ],
            }
        ],
        "mes.experiments": [
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "experiment_name": "盐雾试验",
                "status": "待排程",
            }
        ],
        "mes.experiment_trays": [
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "tray_code": "SYLU-2026-03-001-TP-001",
            }
        ],
        "mes.staging_events": [
            {
                "tray_code": "SYLU-2026-03-001-TP-001",
                "task_code": "SYLU-2026-03-001",
                "action": "manufacturer_return",
                "time": "2026-04-28T03:32:34Z",
                "target_lab": "厂家收回",
            },
            {
                "tray_code": "SYLU-2026-03-001-TP-001",
                "task_code": "SYLU-2026-03-001",
                "action": "stock_in",
                "time": "2026-04-28T03:40:00Z",
            },
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["status"] == "厂家收回"
    assert normalized["mes.tasks"][0]["transfer_status"] == "厂家收回"
    assert normalized["mes.samples"][0]["status"] == "厂家收回"
    assert normalized["mes.samples"][0]["flow_status"] == "厂家收回"
    assert normalized["mes.samples"][0]["trays"][0]["status"] == "厂家收回"
    assert normalized["mes.samples"][0]["trays"][0]["updated_at"] == "2026-04-28T03:32:34Z"


def test_normalize_storage_payload_keeps_other_task_trays_active_when_one_tray_returned() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-03-002",
                "name": "部分收回任务",
                "sample_count": 2,
                "test_types": ["盐雾试验"],
            }
        ],
        "mes.samples": [
            {
                "code": "SYLU-2026-03-002-SP-001",
                "task_code": "SYLU-2026-03-002",
                "status": "已到达暂存间",
                "flow_status": "已到达暂存间",
                "location": "恒温恒湿间（暂存间）",
                "trays": [{"tray_code": "SYLU-2026-03-002-TP-001", "status": "已到达暂存间"}],
            },
            {
                "code": "SYLU-2026-03-002-SP-002",
                "task_code": "SYLU-2026-03-002",
                "status": "送至暂存间",
                "flow_status": "送至暂存间",
                "location": "恒温恒湿间（暂存间）",
                "trays": [{"tray_code": "SYLU-2026-03-002-TP-002", "status": "送至暂存间"}],
            },
        ],
        "mes.experiment_trays": [
            {
                "task_code": "SYLU-2026-03-002",
                "experiment_code": "SYLU-2026-03-002-A",
                "tray_code": "SYLU-2026-03-002-TP-001",
            },
            {
                "task_code": "SYLU-2026-03-002",
                "experiment_code": "SYLU-2026-03-002-A",
                "tray_code": "SYLU-2026-03-002-TP-002",
            },
        ],
        "mes.staging_events": [
            {
                "tray_code": "SYLU-2026-03-002-TP-001",
                "task_code": "SYLU-2026-03-002",
                "action": "manufacturer_return",
                "time": "2026-04-28T03:32:34Z",
                "target_lab": "厂家收回",
            }
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0].get("transfer_status") != "厂家收回"
    assert normalized["mes.samples"][0]["trays"][0]["status"] == "已到达暂存间"
    assert normalized["mes.samples"][1]["status"] == "送至暂存间"
    assert normalized["mes.samples"][1]["trays"][0]["status"] == "送至暂存间"


def test_reset_demo_data_resets_backend_snapshot_with_fresh_tasks_and_preserves_devices() -> None:
    writes = {}

    class _DummyStorage:
        def read_all(self):
            return {
                "mes.tasks": [{"code": "SYLU-2026-03-999", "name": "旧任务"}],
                "mes.samples": [{"code": "SYLU-2026-03-999-SP-001", "task_code": "SYLU-2026-03-999"}],
                "mes.experiments": [{"experiment_code": "SYLU-2026-03-999-A", "task_code": "SYLU-2026-03-999"}],
                "mes.schedules": [{"task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A"}],
                "mes.experiment_trays": [{"task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "tray_code": "SYLU-2026-03-999-TP-001"}],
                "mes.experiment_samples": [{"task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "sample_code": "SYLU-2026-03-999-SP-001"}],
                "mes.streams": [{"task_code": "SYLU-2026-03-999", "status": "采集中"}],
                "mes.conflicts": [{"task_code": "SYLU-2026-03-999"}],
                "mes.devices": [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}],
                "mes.meta": {"schema_version": 2},
            }

        def write_many(self, updates):
            writes.update(updates)

    snapshot = reset_demo_data(_DummyStorage())

    assert snapshot["mes.devices"] == [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}]
    assert len(snapshot["mes.tasks"]) == 20
    assert all("盐雾试验" in str(task["test_type"]).split(" / ") for task in snapshot["mes.tasks"])
    assert snapshot["mes.schedules"] == []
    assert snapshot["mes.experiment_trays"] == []
    assert snapshot["mes.experiment_samples"] == []
    assert snapshot["mes.streams"] == []
    assert snapshot["mes.conflicts"] == []
    assert all(sample["status"] == "运输中" and sample["flow_status"] == "运输中" for sample in snapshot["mes.samples"])
    assert all(experiment["status"] == "待排程" for experiment in snapshot["mes.experiments"])
    assert writes["mes.devices"] == [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}]
    today = datetime.now()
    assert writes["mes.tasks"][0]["code"] == f"SYLU-{today.year}-{today.month:02d}-001"


def test_run_demo_reset_returns_summary_counts() -> None:
    class _DummyStorage:
        def read_all(self):
            return {
                "mes.devices": [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}],
                "mes.meta": {"schema_version": 2},
            }

        def write_many(self, updates):
            return None

    summary = run_demo_reset(_DummyStorage())

    assert summary["task_count"] == 20
    assert summary["experiment_count"] == 60
    assert summary["sample_count"] > 100


def test_reset_demo_script_resets_mysql_only(monkeypatch, capsys) -> None:
    module = importlib.import_module("scripts.reset_demo_data")
    captured = {}

    monkeypatch.setattr(module, "initialize_mysql_storage", lambda seed_demo=False: captured.update({"seed_demo": seed_demo}))
    monkeypatch.setattr(module, "create_mysql_storage_backend", lambda: "backend")
    monkeypatch.setattr(
        module,
        "run_demo_reset",
        lambda backend: captured.update({"backend": backend}) or {
            "task_count": 20,
            "sample_count": 160,
            "experiment_count": 60,
        },
    )

    exit_code = module.main([])

    assert exit_code == 0
    assert captured == {"seed_demo": False, "backend": "backend"}
    assert "json_snapshot" not in capsys.readouterr().out


def test_init_mysql_storage_script_initializes_schema_without_demo_seed_by_default(monkeypatch, capsys) -> None:
    module = importlib.import_module("scripts.init_mysql_storage")
    captured = {}

    monkeypatch.setattr(
        module,
        "initialize_mysql_storage",
        lambda seed_demo=False: captured.update({"seed_demo": seed_demo}) or {
            "database": "mes",
            "schema_initialized": True,
            "demo_seeded": False,
            "task_count": 0,
        },
    )

    exit_code = module.main([])

    assert exit_code == 0
    assert captured == {"seed_demo": False}
    assert "demo_seeded=no" in capsys.readouterr().out


def test_initialize_mysql_storage_applies_schema_sql_before_loading_backend(monkeypatch, tmp_path) -> None:
    module = importlib.import_module("scripts.init_mysql_storage")
    schema_paths = [tmp_path / "001.sql", tmp_path / "002.sql"]
    applied_paths = []
    touched = []

    class _DummyBackend:
        def read_all(self):
            touched.append("read_all")
            return {"mes.tasks": []}

    monkeypatch.setattr(module, "ensure_database_exists", lambda: touched.append("ensure_database"))
    monkeypatch.setattr(module, "ensure_required_base_tables_exist", lambda: touched.append("ensure_required_base_tables"))
    monkeypatch.setattr(module, "iter_schema_sql_paths", lambda: schema_paths)
    monkeypatch.setattr(module, "apply_sql_file", lambda path: applied_paths.append(path))
    monkeypatch.setattr(module, "create_mysql_storage_backend", lambda: _DummyBackend())

    summary = module.initialize_mysql_storage(seed_demo=False)

    assert applied_paths == schema_paths
    assert touched == ["ensure_database", "ensure_required_base_tables", "read_all"]
    assert summary["schema_initialized"] is True
    assert summary["task_count"] == 0


def test_initialize_mysql_storage_requires_preprovisioned_base_schema(monkeypatch, tmp_path) -> None:
    module = importlib.import_module("scripts.init_mysql_storage")
    schema_paths = [tmp_path / "001.sql", tmp_path / "2026-03-17-mes-single-branch-schema-alignment.sql"]
    applied_paths = []

    monkeypatch.setattr(module, "ensure_database_exists", lambda: None)
    monkeypatch.setattr(module, "iter_schema_sql_paths", lambda: schema_paths)
    monkeypatch.setattr(module, "apply_sql_file", lambda path: applied_paths.append(path))
    monkeypatch.setattr(
        module,
        "ensure_required_base_tables_exist",
        lambda: (_ for _ in ()).throw(RuntimeError("Missing required tables: biz_task")),
    )

    with pytest.raises(RuntimeError, match="Missing required tables: biz_task"):
        module.initialize_mysql_storage(seed_demo=False)

    assert applied_paths == []


def test_storage_health_report_has_mysql_only_fields(monkeypatch) -> None:
    monkeypatch.setattr(storage_backend_module.settings, "STORAGE_BACKEND", "mysql")
    storage_backend_module._storage_backend = None
    monkeypatch.setattr(
        storage_backend_module,
        "check_mysql_storage_connection",
        lambda: {"status": "ok", "result": 1},
    )

    report = storage_backend_module.get_storage_health_report()

    assert report == {
        "status": "ok",
        "configured_backend": "mysql",
        "active_backend": None,
        "database": {"status": "ok", "result": 1},
        "mysql": {"status": "ok", "result": 1},
    }


def test_storage_health_report_marks_mysql_unhealthy_when_connection_check_fails(monkeypatch) -> None:
    monkeypatch.setattr(storage_backend_module.settings, "STORAGE_BACKEND", "mysql")
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
    assert report["mysql"] == {
        "status": "unhealthy",
        "detail": "pymysql is required for the MySQL storage backend",
    }


def test_get_storage_backend_rejects_non_mysql_runtime_mode(monkeypatch) -> None:
    monkeypatch.setattr(storage_backend_module.settings, "STORAGE_BACKEND", "json")
    storage_backend_module._storage_backend = None

    with pytest.raises(RuntimeError, match="Only mysql runtime storage is supported"):
        storage_backend_module.get_storage_backend()


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


def test_pytest_defaults_use_mysql_runtime() -> None:
    assert os.environ["STORAGE_BACKEND"] == "mysql"


def test_repository_no_longer_ships_runtime_json_artifacts() -> None:
    repo_root = Path(__file__).resolve().parents[2]

    assert (repo_root / "app" / "data" / "mes_store.json").exists() is False
    assert (repo_root / "scripts" / "migrate_json_to_mysql.py").exists() is False
    assert (repo_root / "scripts" / "export_mysql_snapshot.py").exists() is False
