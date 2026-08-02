from __future__ import annotations

from app.core import mysql_storage_loaders, mysql_storage_replacers, mysql_storage_sample_load


class _ResultCursor:
    def __init__(self, results) -> None:
        self.results = list(results)
        self.executions = []

    def execute(self, sql, params=None) -> None:
        self.executions.append((" ".join(str(sql).split()), params))

    def executemany(self, sql, params) -> None:
        self.executions.append((" ".join(str(sql).split()), list(params)))

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


def test_task_loader_applies_task_scope_to_both_queries(monkeypatch) -> None:
    cursor = _ResultCursor([[], []])
    monkeypatch.setattr(mysql_storage_loaders, "build_storage_task_item", lambda row, tray_codes=None: row)

    mysql_storage_loaders.load_tasks(cursor, task_codes={"TASK-002", "TASK-001"})

    assert "t.task_no IN (%s, %s)" in cursor.executions[0][0]
    assert cursor.executions[0][1][-2:] == ["TASK-001", "TASK-002"]
    assert "task_no IN (%s, %s)" in cursor.executions[1][0]
    assert cursor.executions[1][1][-2:] == ["TASK-001", "TASK-002"]


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


def test_sample_loader_filters_the_root_query_by_task() -> None:
    cursor = _ResultCursor([[]])

    assert mysql_storage_sample_load.load_samples(cursor, task_codes={"TASK-001"}) == []

    assert "t.task_no IN (%s)" in cursor.executions[0][0]
    assert cursor.executions[0][1][-1] == "TASK-001"


def test_task_scoped_workflow_write_never_deletes_unrelated_run_steps() -> None:
    cursor = _ResultCursor([])

    mysql_storage_replacers.replace_task_workflow_relations(
        cursor,
        task_codes={"TASK-001"},
        experiment_run_steps=[
            {
                "task_code": "TASK-001",
                "run_no": "RUN-001",
                "experiment_code": "EXP-001",
                "axis_code": "x+",
            },
            {
                "task_code": "TASK-002",
                "run_no": "RUN-002",
                "experiment_code": "EXP-002",
                "axis_code": "x-",
            },
        ],
    )

    delete_sql, delete_params = cursor.executions[0]
    assert delete_sql == "DELETE FROM biz_experiment_run_step WHERE task_no IN (%s)"
    assert delete_params == ["TASK-001"]
    insert_sql, insert_rows = cursor.executions[1]
    assert "INSERT INTO biz_experiment_run_step" in insert_sql
    assert [row["task_no"] for row in insert_rows] == ["TASK-001"]
