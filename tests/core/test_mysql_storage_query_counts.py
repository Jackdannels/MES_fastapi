from __future__ import annotations

from app.core import mysql_storage_loaders, mysql_storage_sample_load


class _ResultCursor:
    def __init__(self, results) -> None:
        self.results = list(results)
        self.executions = []

    def execute(self, sql, params=None) -> None:
        self.executions.append((" ".join(str(sql).split()), params))

    def fetchall(self):
        return self.results.pop(0)


def test_task_loader_uses_two_batched_queries_regardless_of_task_count(monkeypatch) -> None:
    task_count = 250
    cursor = _ResultCursor(
        [
            [{"task_no": f"TASK-{index:03d}", "tray_no": f"TRAY-{index:03d}"} for index in range(task_count)],
            [{"task_no": f"TASK-{index:03d}"} for index in range(task_count)],
        ]
    )
    monkeypatch.setattr(
        mysql_storage_loaders,
        "build_storage_task_item",
        lambda row, tray_codes=None: {"code": row["task_no"], "tray_codes": tray_codes or []},
    )

    tasks = mysql_storage_loaders.load_tasks(cursor)

    assert len(tasks) == task_count
    assert len(cursor.executions) == 2


def test_sample_loader_uses_three_batched_queries_regardless_of_sample_count(monkeypatch) -> None:
    sample_count = 500
    cursor = _ResultCursor(
        [
            [
                {"sample_id": index, "sample_no": f"TASK-001-SP-{index:03d}"}
                for index in range(1, sample_count + 1)
            ],
            [],
            [],
        ]
    )
    monkeypatch.setattr(
        mysql_storage_sample_load,
        "build_storage_sample_item",
        lambda row, **_kwargs: {"code": row["sample_no"]},
    )

    samples = mysql_storage_sample_load.load_samples(cursor)

    assert len(samples) == sample_count
    assert len(cursor.executions) == 3
