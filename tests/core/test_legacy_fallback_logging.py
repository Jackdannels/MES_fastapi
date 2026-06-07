from __future__ import annotations

import logging

import pytest

from app.core.legacy_fallback import (
    get_legacy_fallback_hits,
    record_legacy_fallback_hit,
    reset_legacy_fallback_hits,
)


@pytest.fixture(autouse=True)
def _reset_legacy_fallback_hits():
    reset_legacy_fallback_hits()
    yield
    reset_legacy_fallback_hits()


def test_record_legacy_fallback_hit_emits_countable_log_record(caplog):
    caplog.set_level(logging.INFO)

    record_legacy_fallback_hit(
        "backend.test.legacy_fallback",
        reason="missing_relation",
        task_code="TASK-001",
        task_no="TASK-NO-001",
        tray_code="TP-001",
        tray_no="TRAY-NO-001",
        sample_code="SP-001",
        experiment_no="EXP-001",
    )

    hits = [record for record in caplog.records if getattr(record, "legacy_fallback_hit", False)]
    assert len(hits) == 1
    assert hits[0].fallback_id == "backend.test.legacy_fallback"
    assert hits[0].legacy_fallback == {"reason": "missing_relation"}
    assert "TASK-001" not in caplog.text
    assert "TASK-NO-001" not in caplog.text
    assert "TP-001" not in caplog.text
    assert "TRAY-NO-001" not in caplog.text
    assert "SP-001" not in caplog.text
    assert "EXP-001" not in caplog.text
    assert get_legacy_fallback_hits() == [
        {
            "count": 1,
            "id": "backend.test.legacy_fallback",
            "last_detail": {"reason": "missing_relation"},
        }
    ]
