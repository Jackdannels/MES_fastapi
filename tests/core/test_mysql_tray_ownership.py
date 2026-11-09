"""Exercise ownership SQL against real relational joins in an isolated in-memory DB."""
from contextlib import contextmanager
from datetime import datetime
import sqlite3

import pytest

from app.core.mysql_storage_backend import MySQLMesStorageBackend, MySQLConnectionSettings
from app.core.mysql_storage_mappers import build_storage_sample_item
from app.core.mysql_storage_sample_write import (
    build_sample_tray_write_state, build_tray_item_rows, insert_tray_item_rows,
)
from app.services.storage_tray_actions import resolve_tray_action_matches, StorageTrayActionError


class RelationalCursor:
    def __init__(self, connection):
        self.cursor = connection.cursor()

    def execute(self, statement, params):
        self.cursor.execute(statement.replace("%s", "?"), params)

    def fetchall(self):
        return [dict(row) for row in self.cursor.fetchall()]

    def fetchone(self):
        row = self.cursor.fetchone()
        return dict(row) if row else None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.cursor.close()


@pytest.fixture
def bindings_backend(monkeypatch):
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript("""
        CREATE TABLE biz_task(task_id INTEGER PRIMARY KEY, task_no TEXT);
        CREATE TABLE biz_tray(tray_id INTEGER PRIMARY KEY, tray_no TEXT UNIQUE, task_id INTEGER);
        CREATE TABLE biz_sample(sample_id INTEGER PRIMARY KEY, sample_no TEXT, task_id INTEGER,
                                sample_status TEXT, flow_status TEXT);
        CREATE TABLE biz_tray_item(tray_id INTEGER, sample_id INTEGER, status TEXT, unbind_time TEXT);
        INSERT INTO biz_task VALUES (1,'A'), (2,'B'), (3,'OLD'), (4,'UNBOUND');
        INSERT INTO biz_tray VALUES (1,'TP',1), (2,'OTHER-TP',2);
        INSERT INTO biz_sample VALUES
            (1,'A-SP',1,'中途外观检查中','中途外观检查中'),
            (2,'B-SP',2,'实验进行中','实验进行中'),
            (3,'OLD-SP',3,'厂家收回','厂家收回'),
            (4,'UNBOUND-SP',4,'实验进行中','实验进行中');
        INSERT INTO biz_tray_item VALUES
            (1,1,'中途外观检查中',NULL), (1,2,'实验进行中',NULL),
            (1,3,'厂家收回',NULL), (1,4,'实验进行中','2026-11-08 09:00:00'),
            (2,2,'实验进行中',NULL);
    """)
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="isolated", password="", database="isolated"),
        None,
    )
    class Adapter:
        def cursor(self):
            return RelationalCursor(connection)

    @contextmanager
    def isolated_connection():
        yield Adapter()

    monkeypatch.setattr(backend, "_connect", isolated_connection)
    yield backend, connection
    connection.close()


def test_current_membership_query_finds_conflict_hidden_by_tray_owner(bindings_backend):
    backend, _ = bindings_backend
    assert backend.find_task_code_by_tray("TP") == "A"
    bindings = backend.read_tray_bindings("TP")
    assert {row["task_code"] for row in bindings} == {"A", "B", "OLD", "UNBOUND"}
    with pytest.raises(StorageTrayActionError, match="归属冲突"):
        resolve_tray_action_matches(bindings, "TP", expected_task_code="A")
    assert backend.read_tray_bindings("UNKNOWN") == []
    assert backend.read_tray_bindings("") == []


def test_current_membership_query_ignores_returned_and_unbound_loads(bindings_backend):
    backend, db = bindings_backend
    db.execute("UPDATE biz_tray_item SET unbind_time='2026-11-08 10:00:00' WHERE tray_id=1 AND sample_id=2")
    matches = resolve_tray_action_matches(backend.read_tray_bindings("TP"), "TP", expected_task_code="A")
    assert [sample["code"] for sample, _ in matches] == ["A-SP"]
    with pytest.raises(StorageTrayActionError, match="归属冲突"):
        resolve_tray_action_matches(backend.read_tray_bindings("TP"), "TP", expected_task_code="B")


def test_unbound_membership_survives_storage_mapping_and_rewrite():
    unbound_at = datetime(2026, 11, 8, 9)
    sample = build_storage_sample_item({
        "sample_no": "OLD-SP", "task_no": "OLD", "sample_status": "实验进行中",
    }, tray_rows=[{
        "tray_code": "TP", "status": "实验进行中", "quantity": 1, "unbind_time": unbound_at,
    }])
    assert sample["trays"][0]["unbind_time"]
    statuses, trays, _ = build_sample_tray_write_state([sample])
    rows, _ = build_tray_item_rows(trays, {"TP": 1}, {"OLD-SP": 3}, statuses)
    assert rows[0]["unbind_time"] == unbound_at
    # Execute the real insert template with named parameter translation, so
    # accidentally replacing the preserved timestamp with NULL is observable.
    db = sqlite3.connect(":memory:")
    db.executescript("""CREATE TABLE biz_tray_item(
        tray_id INTEGER, sample_id INTEGER, position_no TEXT, quantity INTEGER,
        bind_time TEXT, unbind_time TEXT, status TEXT, created_at TEXT, updated_at TEXT);""")
    class Writer:
        def executemany(self, statement, parameters):
            import re
            statement = re.sub(r"%\((\w+)\)s", r":\1", statement)
            values = [{key: value.isoformat(' ') if isinstance(value, datetime) else value
                       for key, value in row.items()} for row in parameters]
            db.executemany(statement, values)
    insert_tray_item_rows(Writer(), rows)
    assert db.execute("SELECT unbind_time FROM biz_tray_item").fetchone()[0] == "2026-11-08 09:00:00"
    db.close()
