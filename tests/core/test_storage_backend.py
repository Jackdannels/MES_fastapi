from __future__ import annotations

import json
import re

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
            "task_code": "SZH-2026-021",
            "history": [
                {
                    "action": "鏍峰搧缂栧彿閲嶆帓",
                    "detail": "浠诲姟 SZH-2026-021；鏍峰搧缁戝畾浠诲姟",
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
    assert samples[0]["history"][0]["detail"] == "任务 SZH-2026-021；样品绑定任务"
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
    assert persisted["mes.samples"][0]["history"][0]["detail"] == "任务 SZH-2026-021；样品绑定任务"


def test_write_many_sanitizes_legacy_sample_text_before_persisting(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    storage = JsonFileStorage(path)

    storage.write_many({"mes.samples": _legacy_sample_payload()})

    persisted = _read_store(path)
    assert persisted["mes.samples"][0]["history"][0]["location"] == "室外接驳区"
    assert persisted["mes.samples"][0]["history"][0]["status"] == "运输中"


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
    assert json.loads(repository.payloads["mes.samples"])[0]["history"][0]["detail"] == "任务 SZH-2026-021；样品绑定任务"


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


def test_json_storage_migrates_legacy_task_codes_and_related_records_to_sylu(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    path.write_text(
        json.dumps(
            {
                "mes.tasks": [
                    {
                        "id": "task-1",
                        "code": "GDW-2024-005",
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
                        "task_code": "GDW-2024-005",
                        "experiment_code": "GDW-2024-005-A",
                        "device": "高低温湿热一室",
                        "start_at": "2026-03-12T08:00:00.000Z",
                        "end_at": "2026-03-12T12:00:00.000Z",
                        "status": "待排程",
                    }
                ],
                "mes.samples": [
                    {
                        "id": "sample-1",
                        "code": "GDW-2024-005-SP-001",
                        "task_code": "GDW-2024-005",
                        "created_at": "2026-03-11T05:31:59.908Z",
                        "trays": [
                            {
                                "id": "tray-1",
                                "tray_code": "GDW-2024-005-TP-001",
                                "sample_code": "GDW-2024-005-SP-001",
                                "quantity": 1,
                            }
                        ],
                    }
                ],
                "mes.streams": [
                    {
                        "id": "stream-1",
                        "task_code": "GDW-2024-005",
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

    migrated_task_code = snapshot["mes.tasks"][0]["code"]
    assert migrated_task_code == "SYLU-2026-03-001"
    assert snapshot["mes.meta"]["schema_version"] == 2
    assert snapshot["mes.samples"][0]["task_code"] == migrated_task_code
    assert snapshot["mes.samples"][0]["code"] == "SYLU-2026-03-001-SP-001"
    assert snapshot["mes.samples"][0]["trays"][0]["tray_code"] == "SYLU-2026-03-001-TP-001"
    assert snapshot["mes.samples"][0]["trays"][0]["sample_code"] == "SYLU-2026-03-001-SP-001"
    assert snapshot["mes.schedules"][0]["task_code"] == migrated_task_code
    assert snapshot["mes.schedules"][0]["experiment_code"] == "SYLU-2026-03-001-A"
    assert snapshot["mes.streams"][0]["task_code"] == migrated_task_code

    persisted = _read_store(path)
    assert persisted["mes.tasks"][0]["code"] == "SYLU-2026-03-001"
    assert persisted["mes.meta"]["schema_version"] == 2


def test_json_storage_backfills_historical_multi_experiment_tasks_and_is_idempotent(tmp_path) -> None:
    path = tmp_path / "mes_store.json"
    path.write_text(
        json.dumps(
            {
                "mes.tasks": [
                    {
                        "id": "task-1",
                        "code": "GDW-2024-005",
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

    assert first_snapshot["mes.tasks"][0]["code"] == second_snapshot["mes.tasks"][0]["code"]
    assert first_snapshot["mes.tasks"][0]["experiment_count"] == 3
    assert first_snapshot["mes.tasks"][0]["experiment_codes"] == [
        "SYLU-2026-03-001-A",
        "SYLU-2026-03-001-B",
        "SYLU-2026-03-001-C",
    ]
    assert [item["experiment_code"] for item in first_snapshot["mes.experiments"]] == [
        "SYLU-2026-03-001-A",
        "SYLU-2026-03-001-B",
        "SYLU-2026-03-001-C",
    ]
    assert len(first_snapshot["mes.experiments"]) == 3
    assert all(re.match(r"^SYLU-2026-03-001-[A-Z]$", item["experiment_code"]) for item in first_snapshot["mes.experiments"])
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
