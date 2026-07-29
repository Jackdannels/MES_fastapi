import sys
from types import ModuleType, SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.performance import PerformanceMiddleware
from app.db.mysql_pool import MySQLConnectionPool


class FakeConnection:
    def __init__(self) -> None:
        self.closed = False
        self.ping_count = 0
        self.rollback_count = 0

    def close(self) -> None:
        self.closed = True

    def ping(self, reconnect: bool = False) -> None:
        assert reconnect is True
        self.ping_count += 1

    def rollback(self) -> None:
        self.rollback_count += 1


class FakeCursor:
    def __init__(self) -> None:
        self.executions = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, statement, params=None):
        self.executions.append((statement, params))
        return 1


class FakeCursorConnection(FakeConnection):
    def __init__(self) -> None:
        super().__init__()
        self.test_cursor = FakeCursor()

    def cursor(self):
        return self.test_cursor


def test_mysql_pool_reuses_released_connections(monkeypatch) -> None:
    pool = MySQLConnectionPool(SimpleNamespace(pool_size=2, pool_timeout_seconds=0.1))
    created = []

    def create_connection():
        connection = FakeConnection()
        created.append(connection)
        return connection

    monkeypatch.setattr(pool, "_create_connection", create_connection)

    first = pool.acquire()
    first_connection = first._connection
    first.close()
    second = pool.acquire()

    assert len(created) == 1
    assert second._connection is first_connection
    assert first_connection.rollback_count == 1
    assert first_connection.ping_count == 1
    second.close()


def test_mysql_pool_discards_failed_connections(monkeypatch) -> None:
    pool = MySQLConnectionPool(SimpleNamespace(pool_size=1, pool_timeout_seconds=0.1))
    connection = FakeConnection()
    monkeypatch.setattr(pool, "_create_connection", lambda: connection)

    lease = pool.acquire()
    lease.close(discard=True)

    assert connection.closed is True
    assert pool._created == 0


def test_mysql_pool_keeps_tuple_and_dict_cursor_modes_separate(monkeypatch) -> None:
    settings = SimpleNamespace(
        host="127.0.0.1",
        port=3306,
        user="mes",
        password="secret",
        database="mes",
        charset="utf8mb4",
        pool_size=2,
        pool_timeout_seconds=0.1,
    )
    connect_calls = []

    def connect(**kwargs):
        connect_calls.append(kwargs)
        return FakeConnection()

    pymysql_module = ModuleType("pymysql")
    cursors_module = ModuleType("pymysql.cursors")

    class DictCursor:
        pass

    pymysql_module.connect = connect
    cursors_module.DictCursor = DictCursor
    monkeypatch.setitem(sys.modules, "pymysql", pymysql_module)
    monkeypatch.setitem(sys.modules, "pymysql.cursors", cursors_module)

    tuple_lease = MySQLConnectionPool(settings).acquire()
    dict_lease = MySQLConnectionPool(settings, dict_cursor=True).acquire()

    assert "cursorclass" not in connect_calls[0]
    assert connect_calls[1]["cursorclass"] is DictCursor
    tuple_lease.close()
    dict_lease.close()


def test_mysql_pool_records_query_duration_in_request_trace(monkeypatch) -> None:
    pool = MySQLConnectionPool(SimpleNamespace(pool_size=1, pool_timeout_seconds=0.1))
    connection = FakeCursorConnection()
    monkeypatch.setattr(pool, "_create_connection", lambda: connection)
    app = FastAPI()
    app.add_middleware(PerformanceMiddleware, enabled=True)

    @app.get("/query")
    def query():
        with pool.acquire() as lease:
            with lease.cursor() as cursor:
                cursor.execute("SELECT 1")
        return {"ok": True}

    response = TestClient(app).get("/query")

    assert response.status_code == 200
    assert "db.query;dur=" in response.headers["Server-Timing"]
    assert response.headers["X-MES-DB-Queries"] == "1"
    assert connection.test_cursor.executions == [("SELECT 1", None)]
