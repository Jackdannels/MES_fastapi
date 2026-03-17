from __future__ import annotations

import json

from app.core.storage_backend import JsonFileStorage


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
