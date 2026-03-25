from __future__ import annotations

import json

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
