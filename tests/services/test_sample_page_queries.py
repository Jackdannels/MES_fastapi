from __future__ import annotations

from app.services import sample_page_queries


class Cursor:
    def __init__(self):
        self.executed = []
        self.results = [
            {"total_count": 1},
            [
                {
                    "sample_id": 1,
                    "sample_no": "TASK-001-SP-001",
                    "task_no": "TASK-001",
                    "location_desc": "接驳区",
                    "sample_status": "到货",
                    "flow_status": "到货",
                    "remark": 'FRONTEND_STORAGE:SAMPLE:{"owner":"张三","remark":"保留"}',
                    "tray_codes": "TRAY-001\nTRAY-002",
                }
            ],
            [{"task_no": "TASK-001", "sample_status": "到货"}],
        ]

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, statement, params=None):
        self.executed.append((" ".join(statement.split()), list(params or [])))

    def fetchone(self):
        return self.results.pop(0)

    def fetchall(self):
        return self.results.pop(0)


class Connection:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor


def test_mysql_sample_page_uses_bounded_summary_query_without_sample_history(monkeypatch):
    cursor = Cursor()
    monkeypatch.setattr(sample_page_queries, "get_connection", lambda: Connection(cursor))

    result = sample_page_queries.MySQLSamplePageQueryRepository().list_samples(page=1, page_size=8)

    assert result.total_count == 1
    assert result.samples[0]["id"] == result.samples[0]["code"] == "TASK-001-SP-001"
    assert result.samples[0]["trayCodes"] == ["TRAY-001", "TRAY-002"]
    assert result.samples[0]["owner"] == "张三"
    sql = " ".join(statement for statement, _params in cursor.executed)
    assert "biz_sample_event" not in sql
    assert "GROUP_CONCAT(DISTINCT tray.tray_no" in sql
    assert "LIMIT %s OFFSET %s" in sql
    assert all("history" not in sample for sample in result.samples)
    assert all("trays" not in sample for sample in result.samples)


def test_mysql_staging_page_pushes_location_scope_into_count_page_and_facets(monkeypatch):
    cursor = Cursor()
    monkeypatch.setattr(sample_page_queries, "get_connection", lambda: Connection(cursor))

    sample_page_queries.MySQLSamplePageQueryRepository().list_samples(
        page=1,
        page_size=8,
        locations=("恒温恒湿间（暂存间）", "恒温恒湿间（实验后暂存间）"),
    )

    assert all("s.location_desc IN (%s, %s)" in statement for statement, _params in cursor.executed)
