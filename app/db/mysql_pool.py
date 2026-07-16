from __future__ import annotations

import queue
import threading
from typing import Any


class _ConnectionLease:
    def __init__(self, pool: "MySQLConnectionPool", connection: Any) -> None:
        self._pool = pool
        self._connection = connection
        self._released = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.close(discard=exc_type is not None)
        return False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._connection, name)

    def close(self, *, discard: bool = False) -> None:
        if self._released:
            return
        self._released = True
        self._pool.release(self._connection, discard=discard)


class MySQLConnectionPool:
    def __init__(self, connection_settings: Any, *, dict_cursor: bool = False) -> None:
        self._connection_settings = connection_settings
        self._dict_cursor = dict_cursor
        self._max_size = max(1, int(getattr(connection_settings, "pool_size", 20) or 20))
        self._timeout = max(0.1, float(getattr(connection_settings, "pool_timeout_seconds", 5.0) or 5.0))
        self._available: queue.LifoQueue[Any] = queue.LifoQueue(maxsize=self._max_size)
        self._guard = threading.Lock()
        self._created = 0

    def _create_connection(self):
        try:
            import pymysql
        except ImportError as exc:
            raise RuntimeError("pymysql is required for the MySQL storage backend") from exc

        connect_options = dict(
            host=self._connection_settings.host,
            port=self._connection_settings.port,
            user=self._connection_settings.user,
            password=self._connection_settings.password,
            database=self._connection_settings.database,
            charset=getattr(self._connection_settings, "charset", "utf8mb4"),
            autocommit=False,
            connect_timeout=max(1, int(self._timeout)),
        )
        if self._dict_cursor:
            from pymysql.cursors import DictCursor

            connect_options["cursorclass"] = DictCursor
        return pymysql.connect(**connect_options)

    def acquire(self) -> _ConnectionLease:
        try:
            connection = self._available.get_nowait()
        except queue.Empty:
            with self._guard:
                if self._created < self._max_size:
                    connection = self._create_connection()
                    self._created += 1
                    return _ConnectionLease(self, connection)
            try:
                connection = self._available.get(timeout=self._timeout)
            except queue.Empty as exc:
                raise TimeoutError(f"MySQL connection pool exhausted after {self._timeout:.1f}s") from exc

        try:
            connection.ping(reconnect=True)
        except Exception:
            try:
                connection.close()
            finally:
                with self._guard:
                    self._created = max(0, self._created - 1)
            return self.acquire()
        return _ConnectionLease(self, connection)

    def release(self, connection: Any, *, discard: bool = False) -> None:
        if not discard:
            try:
                connection.rollback()
            except Exception:
                discard = True
        if discard:
            try:
                connection.close()
            finally:
                with self._guard:
                    self._created = max(0, self._created - 1)
            return
        try:
            self._available.put_nowait(connection)
        except queue.Full:
            connection.close()
            with self._guard:
                self._created = max(0, self._created - 1)


_POOLS: dict[tuple[Any, ...], MySQLConnectionPool] = {}
_POOLS_LOCK = threading.Lock()


def get_mysql_connection_pool(connection_settings: Any, *, dict_cursor: bool = False) -> MySQLConnectionPool:
    key = (
        connection_settings.host,
        connection_settings.port,
        connection_settings.user,
        connection_settings.password,
        connection_settings.database,
        getattr(connection_settings, "charset", "utf8mb4"),
        int(getattr(connection_settings, "pool_size", 20) or 20),
        float(getattr(connection_settings, "pool_timeout_seconds", 5.0) or 5.0),
        dict_cursor,
    )
    with _POOLS_LOCK:
        pool = _POOLS.get(key)
        if pool is None:
            pool = MySQLConnectionPool(connection_settings, dict_cursor=dict_cursor)
            _POOLS[key] = pool
        return pool
