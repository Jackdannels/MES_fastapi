from __future__ import annotations

import json
import secrets
from copy import deepcopy
from threading import RLock
from typing import Any, Protocol
from weakref import WeakKeyDictionary

from app.core.time_utils import now_business_text
from app.db.schema_version import require_schema_version


EXPORTS_STORAGE_KEY = "mes.test_data_exports"
SHARES_STORAGE_KEY = "mes.test_data_shares"
_MYSQL_INIT_LOCK = RLock()
_REPOSITORY_CACHE: WeakKeyDictionary[Any, TestDataRepository] = WeakKeyDictionary()
_REPOSITORY_CACHE_LOCK = RLock()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _rows(value: Any) -> list[dict[str, Any]]:
    return [dict(item) for item in value if isinstance(item, dict)] if isinstance(value, list) else []


class TestDataRepository(Protocol):
    __test__ = False

    def list_exports(self, *, status: str = "") -> list[dict[str, Any]]: ...

    def upsert_export(self, record: dict[str, Any]) -> dict[str, Any]: ...

    def get_export(self, export_key: str) -> dict[str, Any] | None: ...

    def get_or_create_share(self, task_code: str, experiment_code: str) -> dict[str, Any]: ...

    def find_share(self, token: str) -> dict[str, Any] | None: ...

    def clear_metadata(self) -> None: ...


class SnapshotTestDataRepository:
    """Compatibility repository for tests and non-MySQL storage implementations."""

    def __init__(self, storage: Any) -> None:
        self.storage = storage
        self._lock = RLock()

    def list_exports(self, *, status: str = "") -> list[dict[str, Any]]:
        records = _rows(self.storage.read(EXPORTS_STORAGE_KEY))
        normalized = _text(status).lower()
        if normalized:
            records = [row for row in records if _text(row.get("status")).lower() == normalized]
        return sorted(records, key=lambda row: _text(row.get("updatedAt") or row.get("generatedAt")), reverse=True)

    def upsert_export(self, record: dict[str, Any]) -> dict[str, Any]:
        normalized = deepcopy(record)
        export_key = _text(normalized.get("exportKey"))
        if not export_key:
            raise ValueError("exportKey 不能为空")
        with self._lock:
            records = _rows(self.storage.read(EXPORTS_STORAGE_KEY))
            index = next((index for index, row in enumerate(records) if _text(row.get("exportKey")) == export_key), None)
            if index is None:
                records.append(normalized)
            else:
                records[index] = normalized
            self.storage.write(EXPORTS_STORAGE_KEY, records)
        return deepcopy(normalized)

    def get_export(self, export_key: str) -> dict[str, Any] | None:
        normalized = _text(export_key)
        return next((row for row in self.list_exports() if _text(row.get("exportKey")) == normalized), None)

    def get_or_create_share(self, task_code: str, experiment_code: str) -> dict[str, Any]:
        normalized_task = _text(task_code)
        normalized_experiment = _text(experiment_code)
        if not normalized_task:
            raise ValueError("任务编号不能为空")
        with self._lock:
            shares = _rows(self.storage.read(SHARES_STORAGE_KEY))
            existing = next(
                (
                    row
                    for row in shares
                    if bool(row.get("active", True))
                    and _text(row.get("taskCode")) == normalized_task
                    and _text(row.get("experimentCode")) == normalized_experiment
                ),
                None,
            )
            if existing:
                return deepcopy(existing)
            timestamp = now_business_text()
            share = {
                "token": secrets.token_urlsafe(32),
                "taskCode": normalized_task,
                "experimentCode": normalized_experiment,
                "active": True,
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
            shares.append(share)
            self.storage.write(SHARES_STORAGE_KEY, shares)
            return deepcopy(share)

    def find_share(self, token: str) -> dict[str, Any] | None:
        normalized = _text(token)
        return next(
            (
                row
                for row in _rows(self.storage.read(SHARES_STORAGE_KEY))
                if bool(row.get("active", True)) and secrets.compare_digest(_text(row.get("token")), normalized)
            ),
            None,
        )

    def clear_metadata(self) -> None:
        with self._lock:
            self.storage.write(EXPORTS_STORAGE_KEY, [])
            self.storage.write(SHARES_STORAGE_KEY, [])


class MySQLTestDataRepository:
    def __init__(self, storage: Any) -> None:
        self.storage = storage
        with _MYSQL_INIT_LOCK:
            self._ensure_schema()
            if not bool(getattr(storage, "_test_data_legacy_migrated", False)):
                self._migrate_snapshot_exports()
                setattr(storage, "_test_data_legacy_migrated", True)

    def _ensure_schema(self) -> None:
        ensure_extensions = getattr(self.storage, "_ensure_schema_extensions", None)
        if callable(ensure_extensions):
            ensure_extensions()
            return
        with self.storage._connect() as connection:  # noqa: SLF001 - same backend-owned connection pool
            with connection.cursor() as cursor:
                require_schema_version(cursor)

    def _migrate_snapshot_exports(self) -> None:
        legacy = _rows(self.storage.read(EXPORTS_STORAGE_KEY))
        if not legacy:
            return
        for record in legacy:
            if _text(record.get("exportKey")):
                self.upsert_export(record)
        self.storage.write(EXPORTS_STORAGE_KEY, [])

    @staticmethod
    def _decode_export(row: dict[str, Any]) -> dict[str, Any]:
        payload = row.get("payload_json")
        if isinstance(payload, str):
            try:
                decoded = json.loads(payload)
            except (TypeError, ValueError):
                decoded = {}
        elif isinstance(payload, dict):
            decoded = dict(payload)
        else:
            decoded = {}
        return decoded

    def list_exports(self, *, status: str = "") -> list[dict[str, Any]]:
        sql = "SELECT payload_json FROM biz_test_data_export"
        params: tuple[Any, ...] = ()
        normalized = _text(status).lower()
        if normalized:
            sql += " WHERE export_status = %s"
            params = (normalized,)
        sql += " ORDER BY updated_at DESC, export_key DESC"
        with self.storage._connect() as connection:  # noqa: SLF001
            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                rows = cursor.fetchall()
        return [self._decode_export(dict(row)) for row in rows]

    def upsert_export(self, record: dict[str, Any]) -> dict[str, Any]:
        normalized = deepcopy(record)
        export_key = _text(normalized.get("exportKey"))
        if not export_key:
            raise ValueError("exportKey 不能为空")
        payload = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"), default=str)
        with self.storage._connect() as connection:  # noqa: SLF001
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO biz_test_data_export (
                      export_key, task_no, experiment_no, run_no, axis_code, sample_no,
                      export_status, file_path, relative_path, error_text, attempts,
                      generated_at, updated_at, payload_json
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                      task_no = VALUES(task_no), experiment_no = VALUES(experiment_no),
                      run_no = VALUES(run_no), axis_code = VALUES(axis_code), sample_no = VALUES(sample_no),
                      export_status = VALUES(export_status), file_path = VALUES(file_path),
                      relative_path = VALUES(relative_path), error_text = VALUES(error_text),
                      attempts = VALUES(attempts), generated_at = VALUES(generated_at),
                      updated_at = VALUES(updated_at), payload_json = VALUES(payload_json)
                    """,
                    (
                        export_key,
                        _text(normalized.get("taskCode")),
                        _text(normalized.get("experimentCode")),
                        _text(normalized.get("runNo")),
                        _text(normalized.get("axisCode")),
                        _text(normalized.get("sampleCode")),
                        _text(normalized.get("status")) or "pending",
                        _text(normalized.get("filePath")) or None,
                        _text(normalized.get("relativePath")) or None,
                        _text(normalized.get("error")) or None,
                        int(normalized.get("attempts") or 0),
                        _text(normalized.get("generatedAt")) or None,
                        _text(normalized.get("updatedAt")) or None,
                        payload,
                    ),
                )
            connection.commit()
        return deepcopy(normalized)

    def get_export(self, export_key: str) -> dict[str, Any] | None:
        with self.storage._connect() as connection:  # noqa: SLF001
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT payload_json FROM biz_test_data_export WHERE export_key = %s LIMIT 1",
                    (_text(export_key),),
                )
                row = cursor.fetchone()
        return self._decode_export(dict(row)) if row else None

    def get_or_create_share(self, task_code: str, experiment_code: str) -> dict[str, Any]:
        normalized_task = _text(task_code)
        normalized_experiment = _text(experiment_code)
        if not normalized_task:
            raise ValueError("任务编号不能为空")
        timestamp = now_business_text()
        token = secrets.token_urlsafe(32)
        with self.storage._connect() as connection:  # noqa: SLF001
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO biz_test_data_share (
                      share_token, task_no, experiment_no, active, created_at, updated_at
                    ) VALUES (%s, %s, %s, 1, %s, %s)
                    ON DUPLICATE KEY UPDATE active = 1, updated_at = VALUES(updated_at)
                    """,
                    (token, normalized_task, normalized_experiment, timestamp, timestamp),
                )
                cursor.execute(
                    """
                    SELECT share_token, task_no, experiment_no, active, created_at, updated_at
                    FROM biz_test_data_share WHERE task_no = %s AND experiment_no = %s LIMIT 1
                    """,
                    (normalized_task, normalized_experiment),
                )
                row = dict(cursor.fetchone())
            connection.commit()
        return {
            "token": _text(row.get("share_token")),
            "taskCode": _text(row.get("task_no")),
            "experimentCode": _text(row.get("experiment_no")),
            "active": bool(row.get("active")),
            "createdAt": _text(row.get("created_at")),
            "updatedAt": _text(row.get("updated_at")),
        }

    def find_share(self, token: str) -> dict[str, Any] | None:
        with self.storage._connect() as connection:  # noqa: SLF001
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT share_token, task_no, experiment_no, active, created_at, updated_at
                    FROM biz_test_data_share WHERE share_token = %s AND active = 1 LIMIT 1
                    """,
                    (_text(token),),
                )
                row = cursor.fetchone()
        if not row:
            return None
        row = dict(row)
        return {
            "token": _text(row.get("share_token")),
            "taskCode": _text(row.get("task_no")),
            "experimentCode": _text(row.get("experiment_no")),
            "active": bool(row.get("active")),
            "createdAt": _text(row.get("created_at")),
            "updatedAt": _text(row.get("updated_at")),
        }

    def clear_metadata(self) -> None:
        with self.storage._connect() as connection:  # noqa: SLF001
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM biz_test_data_share")
                cursor.execute("DELETE FROM biz_test_data_export")
            connection.commit()
        self.storage.write(EXPORTS_STORAGE_KEY, [])


def get_test_data_repository(storage: Any) -> TestDataRepository:
    try:
        with _REPOSITORY_CACHE_LOCK:
            cached = _REPOSITORY_CACHE.get(storage)
            if cached is not None:
                return cached
            repository: TestDataRepository
            if callable(getattr(storage, "_connect", None)):
                repository = MySQLTestDataRepository(storage)
            else:
                repository = SnapshotTestDataRepository(storage)
            _REPOSITORY_CACHE[storage] = repository
            return repository
    except TypeError:
        if callable(getattr(storage, "_connect", None)):
            return MySQLTestDataRepository(storage)
        return SnapshotTestDataRepository(storage)
