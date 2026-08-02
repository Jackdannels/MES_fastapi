from contextlib import contextmanager
from datetime import datetime

from app.services import capacity_diagnostics
from app.services.capacity_diagnostics import CapacityThresholds


class Cursor:
    def __init__(self) -> None:
        self.description = None
        self._rows = []
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql, params):
        self.calls.append((" ".join(sql.split()), tuple(params)))
        if "information_schema.TABLES" in sql:
            self.description = [("tableName",), ("estimatedRows",), ("dataBytes",), ("indexBytes",)]
            self._rows = [("biz_mq_message_log", 120, 4096, 2048)]
        else:
            self.description = [("storageKey",), ("payloadBytes",), ("itemCount",), ("updatedAt",)]
            self._rows = [("mes.staging_events", 8192, 30, datetime(2026, 8, 2, 10, 0, 0))]

    def fetchall(self):
        return self._rows


class Connection:
    def __init__(self, cursor: Cursor) -> None:
        self._cursor = cursor

    def cursor(self):
        return self._cursor


def test_capacity_diagnostics_reports_table_snapshot_pool_and_retention(monkeypatch) -> None:
    cursor = Cursor()

    @contextmanager
    def connection_factory():
        yield Connection(cursor)

    monkeypatch.setattr(
        capacity_diagnostics,
        "get_mysql_pool_diagnostics",
        lambda: {"poolCount": 1, "maxSize": 10, "created": 8, "available": 0, "inUse": 8, "pools": []},
    )

    report = capacity_diagnostics.collect_capacity_diagnostics(
        connection_factory,
        retention_status={"enabled": True, "running": False, "lastError": ""},
    )

    assert report["status"] == "warning"
    assert report["warnings"] == ["mysql_connection_pool_high_utilization"]
    assert report["tables"] == [
        {"tableName": "biz_mq_message_log", "estimatedRows": 120, "dataBytes": 4096, "indexBytes": 2048}
    ]
    assert report["snapshots"][0]["itemCount"] == 30
    assert report["trackedTotals"] == {
        "estimatedRows": 120,
        "dataBytes": 4096,
        "indexBytes": 2048,
        "snapshotBytes": 8192,
    }
    assert report["mysqlPool"]["utilization"] == 0.8
    assert report["retention"]["enabled"] is True
    assert len(cursor.calls) == 2


def test_capacity_diagnostics_warns_when_retention_last_run_failed(monkeypatch) -> None:
    cursor = Cursor()

    @contextmanager
    def connection_factory():
        yield Connection(cursor)

    monkeypatch.setattr(
        capacity_diagnostics,
        "get_mysql_pool_diagnostics",
        lambda: {"poolCount": 0, "maxSize": 0, "created": 0, "available": 0, "inUse": 0, "pools": []},
    )

    report = capacity_diagnostics.collect_capacity_diagnostics(
        connection_factory,
        retention_status={"enabled": True, "lastError": "database unavailable"},
    )

    assert report["warnings"] == ["data_retention_last_run_failed"]


def test_capacity_diagnostics_applies_configured_data_growth_thresholds(monkeypatch) -> None:
    cursor = Cursor()

    @contextmanager
    def connection_factory():
        yield Connection(cursor)

    monkeypatch.setattr(
        capacity_diagnostics,
        "get_mysql_pool_diagnostics",
        lambda: {"poolCount": 1, "maxSize": 10, "created": 1, "available": 1, "inUse": 0, "pools": []},
    )

    report = capacity_diagnostics.collect_capacity_diagnostics(
        connection_factory,
        thresholds=CapacityThresholds(
            pool_utilization=0.9,
            staging_event_items=30,
            staging_event_bytes=8192,
            mq_message_rows=120,
            experiment_event_rows=1,
        ),
    )

    assert report["warnings"] == [
        "staging_events_item_count_high",
        "staging_events_payload_high",
        "mq_message_log_row_count_high",
    ]
    assert report["thresholds"]["mq_message_rows"] == 120
