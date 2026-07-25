from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable

from app.db.mysql_pool import get_mysql_connection_pool


CREATE_STORAGE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS app_storage_snapshot (
  storage_key VARCHAR(50) NOT NULL,
  payload_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (storage_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


@dataclass(frozen=True)
class MySQLConnectionSettings:
    host: str
    port: int
    user: str
    password: str
    database: str
    charset: str = "utf8mb4"
    pool_size: int = 20
    pool_timeout_seconds: float = 5.0


class MySQLSnapshotRepository:
    def __init__(self, connection_settings: MySQLConnectionSettings) -> None:
        self._connection_settings = connection_settings
        self._connection_pool = get_mysql_connection_pool(connection_settings)
        self._initialized = False

    def _connect(self):
        return self._connection_pool.acquire()

    def _ensure_table(self) -> None:
        if self._initialized:
            return
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(CREATE_STORAGE_TABLE_SQL)
            connection.commit()
        self._initialized = True

    def read_all(self) -> Dict[str, str]:
        self._ensure_table()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT storage_key, payload_json FROM app_storage_snapshot")
                rows = cursor.fetchall()
        return {storage_key: payload_json for storage_key, payload_json in rows}

    def read_many(self, keys: Iterable[str]) -> Dict[str, str]:
        requested_keys = list(dict.fromkeys(keys))
        if not requested_keys:
            return {}
        self._ensure_table()
        placeholders = ", ".join(["%s"] * len(requested_keys))
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT storage_key, payload_json FROM app_storage_snapshot WHERE storage_key IN ({placeholders})",
                    requested_keys,
                )
                rows = cursor.fetchall()
        return {storage_key: payload_json for storage_key, payload_json in rows}

    def read(self, key: str) -> str | None:
        self._ensure_table()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT payload_json FROM app_storage_snapshot WHERE storage_key = %s",
                    (key,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        return row[0]

    def write_many(self, updates: Dict[str, str]) -> None:
        if not updates:
            return
        self._ensure_table()
        rows = [(key, payload) for key, payload in updates.items()]
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.executemany(
                    """
                    INSERT INTO app_storage_snapshot (storage_key, payload_json)
                    VALUES (%s, %s)
                    ON DUPLICATE KEY UPDATE
                      payload_json = VALUES(payload_json),
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    rows,
                )
            connection.commit()
