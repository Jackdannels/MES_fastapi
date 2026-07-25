from __future__ import annotations

from app.core import mysql_storage_sample_load


class _Cursor:
    def __init__(self) -> None:
        self._results = [
            [
                {"sample_id": 1, "sample_no": "TASK-001-SP-001"},
                {"sample_id": 2, "sample_no": "TASK-001-SP-002"},
                {"sample_id": 3, "sample_no": "TASK-001-SP-003"},
            ],
            [],
            [],
        ]

    def execute(self, _statement, _params=None) -> None:
        return None

    def fetchall(self):
        return self._results.pop(0)


def test_load_samples_builds_global_dispatch_indexes_once(monkeypatch) -> None:
    staging_index = {"TRAY-001": {"target_lab": "冲击一室"}}
    scheduled_index = {("TASK-001", "TRAY-001", "冲击一室"): "EXP-001"}
    appearance_index = {("TASK-001", "TRAY-001")}
    calls = {"staging": 0, "scheduled": 0, "appearance": 0}
    mapped_rows = []

    def build_staging_index(rows):
        calls["staging"] += 1
        assert list(rows) == [{"id": "STAGING-001"}]
        return staging_index

    def build_scheduled_index(schedules, experiment_trays):
        calls["scheduled"] += 1
        assert list(schedules) == [{"id": "SCHEDULE-001"}]
        assert list(experiment_trays) == [{"id": "RELATION-001"}]
        return scheduled_index

    def build_appearance_index(rows):
        calls["appearance"] += 1
        assert list(rows) == [{"id": "STAGING-001"}]
        return appearance_index

    def build_sample(row, **kwargs):
        assert kwargs["staging_target_by_tray_code"] is staging_index
        assert kwargs["scheduled_target_by_key"] is scheduled_index
        assert kwargs["appearance_stock_in_keys"] is appearance_index
        mapped_rows.append(row["sample_no"])
        return {"code": row["sample_no"]}

    monkeypatch.setattr(
        mysql_storage_sample_load,
        "build_staging_dispatch_target_map",
        build_staging_index,
        raising=False,
    )
    monkeypatch.setattr(
        mysql_storage_sample_load,
        "build_scheduled_dispatch_target_map",
        build_scheduled_index,
        raising=False,
    )
    monkeypatch.setattr(
        mysql_storage_sample_load,
        "build_appearance_stock_in_index",
        build_appearance_index,
        raising=False,
    )
    monkeypatch.setattr(mysql_storage_sample_load, "build_storage_sample_item", build_sample)

    samples = mysql_storage_sample_load.load_samples(
        _Cursor(),
        staging_event_rows=iter([{"id": "STAGING-001"}]),
        schedules=iter([{"id": "SCHEDULE-001"}]),
        experiment_trays=iter([{"id": "RELATION-001"}]),
    )

    assert [sample["code"] for sample in samples] == mapped_rows
    assert calls == {"staging": 1, "scheduled": 1, "appearance": 1}
