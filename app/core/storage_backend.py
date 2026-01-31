from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Iterable

BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_STORE_PATH = BASE_DIR / "data" / "mes_store.json"

STORAGE_KEYS: Iterable[str] = (
    "mes.tasks",
    "mes.schedules",
    "mes.samples",
    "mes.devices",
    "mes.streams",
    "mes.conflicts",
)


def _default_store() -> Dict[str, Any]:
    return {key: [] for key in STORAGE_KEYS}


class StorageBackend:
    """Storage backend interface for future database migration."""

    def read_all(self) -> Dict[str, Any]:
        raise NotImplementedError

    def read(self, key: str) -> Any:
        raise NotImplementedError

    def write(self, key: str, value: Any) -> None:
        raise NotImplementedError

    def write_many(self, updates: Dict[str, Any]) -> None:
        raise NotImplementedError


class JsonFileStorage(StorageBackend):
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = Lock()
        self._ensure_file()

    def _ensure_file(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if self._path.exists():
            return
        self._write_file(_default_store())

    def _read_file(self) -> Dict[str, Any]:
        try:
            content = self._path.read_text(encoding="utf-8")
            payload = json.loads(content)
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        for key in STORAGE_KEYS:
            payload.setdefault(key, [])
        return payload

    def _write_file(self, payload: Dict[str, Any]) -> None:
        data = dict(payload)
        for key in STORAGE_KEYS:
            data.setdefault(key, [])
        tmp_path = self._path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self._path)

    def read_all(self) -> Dict[str, Any]:
        with self._lock:
            return self._read_file()

    def read(self, key: str) -> Any:
        with self._lock:
            payload = self._read_file()
            return payload.get(key, [])

    def write(self, key: str, value: Any) -> None:
        with self._lock:
            payload = self._read_file()
            payload[key] = value
            self._write_file(payload)

    def write_many(self, updates: Dict[str, Any]) -> None:
        with self._lock:
            payload = self._read_file()
            payload.update(updates)
            self._write_file(payload)


_storage_backend: StorageBackend | None = None


def get_storage_backend() -> StorageBackend:
    global _storage_backend
    if _storage_backend is None:
        _storage_backend = JsonFileStorage(DEFAULT_STORE_PATH)
    return _storage_backend
