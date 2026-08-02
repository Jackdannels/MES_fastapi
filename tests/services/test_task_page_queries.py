from __future__ import annotations

from app.services import task_page_queries


class Cursor:
    description = (("task_no",), ("history_updated_at",))

    def __init__(self, results):
        self.results = list(results)
        self.executed = []
        self.current = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params):
        self.executed.append((" ".join(sql.split()), list(params)))
        self.current = self.results.pop(0)

    def fetchone(self):
        return self.current

    def fetchall(self):
        return self.current


class Connection:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor


class TupleOverviewCursor(Cursor):
    def execute(self, sql, params):
        super().execute(sql, params)
        normalized_sql = " ".join(sql.split())
        if "SUM(CASE" in normalized_sql:
            self.description = (
                ("external_count",),
                ("internal_count",),
                ("unscheduled_count",),
            )
        elif "SELECT DISTINCT task_type, task_status" in normalized_sql:
            self.description = (("task_type",), ("task_status",))
        else:
            self.description = (("task_status",),)


def test_active_task_query_counts_then_pages_in_sql(monkeypatch):
    cursor = Cursor([{"total_count": 5}, [{"task_no": "TASK-003"}, {"task_no": "TASK-004"}]])
    monkeypatch.setattr(task_page_queries, "get_connection", lambda: Connection(cursor))

    page = task_page_queries.MySQLTaskPageQueryRepository().list_active_task_codes(
        page=2,
        page_size=2,
        query="TASK",
    )

    assert page == task_page_queries.TaskCodePage(2, ("TASK-003", "TASK-004"), 5, 3)
    count_sql, count_params = cursor.executed[0]
    page_sql, page_params = cursor.executed[1]
    assert "SELECT COUNT(*) AS total_count FROM biz_task t" in count_sql
    assert "LIMIT" not in count_sql
    assert "ORDER BY t.task_no ASC LIMIT %s OFFSET %s" in page_sql
    assert page_params[-2:] == [2, 2]
    assert count_params == page_params[:-2]


def test_active_task_query_applies_filters_and_whitelisted_sort(monkeypatch):
    cursor = Cursor([{"total_count": 1}, [{"task_no": "TASK-009"}]])
    monkeypatch.setattr(task_page_queries, "get_connection", lambda: Connection(cursor))

    page = task_page_queries.MySQLTaskPageQueryRepository().list_active_task_codes(
        page=1,
        page_size=8,
        query="样品A",
        status="实验进行中",
        test_type="盐雾试验",
        sort_key="sampleCount",
        sort_direction="desc",
    )

    assert page == task_page_queries.TaskCodePage(1, ("TASK-009",), 1, 1)
    count_sql, count_params = cursor.executed[0]
    page_sql, page_params = cursor.executed[1]
    assert "t.task_status = %s OR t.transfer_status = %s" in count_sql
    assert "t.task_type LIKE %s" in count_sql
    assert "ORDER BY t.sample_count DESC, t.task_no ASC" in page_sql
    assert "%样品A%" in count_params
    assert count_params[-3:] == ["实验进行中", "实验进行中", "%盐雾试验%"]
    assert page_params[:-2] == count_params


def test_active_task_overview_scopes_statuses_by_test_type(monkeypatch):
    cursor = Cursor(
        [
            {"external_count": 3, "internal_count": 4, "unscheduled_count": 2},
            [
                {"task_type": "盐雾试验", "task_status": "实验进行中"},
                {"task_type": "冲击试验", "task_status": "待排程"},
            ],
            [
                {"task_status": "已受理"},
                {"task_status": "实验进行中"},
            ],
        ]
    )
    monkeypatch.setattr(task_page_queries, "get_connection", lambda: Connection(cursor))

    overview = task_page_queries.MySQLTaskPageQueryRepository().get_active_task_overview(
        test_type="盐雾试验"
    )

    assert overview == {
        "metrics": {"externalCount": 3, "internalCount": 4, "unscheduledCount": 2},
        "statusOptions": ["实验进行中", "待排程"],
        "testTypeOptions": ["冲击试验", "盐雾试验"],
    }
    assert len(cursor.executed) == 3
    status_sql, status_params = cursor.executed[2]
    assert "SELECT DISTINCT task_status" in status_sql
    assert "t.task_type LIKE %s" in status_sql
    assert status_params == [
        task_page_queries.STORAGE_MARKER,
        task_page_queries.RETURNED_STATUS,
        "%盐雾试验%",
    ]


def test_active_task_overview_maps_tuple_rows_from_real_mysql_cursor(monkeypatch):
    cursor = TupleOverviewCursor(
        [
            (10, 10, 20),
            [("盐雾试验", "待排程")],
            [("待排程",)],
        ]
    )
    monkeypatch.setattr(task_page_queries, "get_connection", lambda: Connection(cursor))

    overview = task_page_queries.MySQLTaskPageQueryRepository().get_active_task_overview()

    assert overview == {
        "metrics": {"externalCount": 10, "internalCount": 10, "unscheduledCount": 20},
        "statusOptions": ["待排程"],
        "testTypeOptions": ["盐雾试验"],
    }


def test_next_task_code_uses_month_prefix_and_includes_archived_rows(monkeypatch):
    cursor = Cursor([{"max_sequence": 41}])
    monkeypatch.setattr(task_page_queries, "get_connection", lambda: Connection(cursor))

    code = task_page_queries.MySQLTaskPageQueryRepository().next_task_code(
        "2026-08-02T12:30:00+08:00"
    )

    assert code == "SYLU-2026-08-042"
    sql, params = cursor.executed[0]
    assert "FROM biz_task" in sql
    assert "task_no LIKE %s" in sql
    assert "transfer_status" not in sql
    assert params == ["SYLU-2026-08-%"]


def test_history_query_filters_and_pages_before_related_data_is_loaded(monkeypatch):
    cursor = Cursor([{"total_count": 9}, [{"task_no": "TASK-009"}]])
    monkeypatch.setattr(task_page_queries, "get_connection", lambda: Connection(cursor))

    page = task_page_queries.MySQLTaskPageQueryRepository().list_history_task_codes(
        page=99,
        page_size=8,
        query="TP-009",
        days=30,
        now="2026-08-02T00:00:00+08:00",
    )

    assert page == task_page_queries.TaskCodePage(2, ("TASK-009",), 9, 2)
    count_sql, count_params = cursor.executed[0]
    page_sql, page_params = cursor.executed[1]
    assert "FROM biz_sample_event history_event" in count_sql
    assert "FROM biz_sample search_sample" in count_sql
    assert "FROM biz_tray search_tray" in count_sql
    assert "FROM biz_experiment_tray search_experiment_tray" in count_sql
    assert "AS history_updated_at" in page_sql
    assert "ORDER BY history_updated_at DESC, t.task_no ASC" in page_sql
    assert page_params[-2:] == [8, 8]
    assert len(page_params) == len(count_params) + 5


def test_attendance_operations_are_limited_to_page_task_codes(monkeypatch):
    cursor = Cursor([[{"id": 2, "task_code": "TASK-B"}]])
    monkeypatch.setattr(task_page_queries, "get_connection", lambda: Connection(cursor))

    rows = task_page_queries.MySQLTaskPageQueryRepository().list_attendance_operations(
        {"TASK-B", "TASK-A"}
    )

    assert rows == [{"id": 2, "task_code": "TASK-B"}]
    sql, params = cursor.executed[0]
    assert "WHERE task_no IN (%s, %s)" in sql
    assert params == ["TASK-A", "TASK-B"]
