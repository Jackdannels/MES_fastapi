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

SAMPLE_TEXT_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("鏍峰搧鐧昏", "样品登记"),
    ("鏍峰搧缂栧彿閲嶆帓", "样品编号重排"),
    ("鏍峰搧缁戝畾浠诲姟", "样品绑定任务"),
    ("浠诲姟鏍峰搧閲嶇粦", "任务样品重绑"),
    ("浠诲姟鏍峰搧鍏ュ簱锛堟帴椹冲尯锛", "任务样品入库（接驳区）"),
    ("閫佽揪鏆傚瓨闂", "送达暂存间"),
    ("閫佽嚦鏆傚瓨闂", "送至暂存间"),
    ("瀹ゅ鎺ラ┏鍖", "室外接驳区"),
    ("瀹ゅ", "室外"),
    ("鎺ラ┏鍖", "接驳区"),
    ("鎭掓俯鎭掓箍闂达紙鏆傚瓨闂达級", "恒温恒湿间（暂存间）"),
    ("鏀舵牱鍙", "收样台"),
    ("鏍峰搧搴", "样品库"),
    ("宸叉帴鏀", "已接收"),
    ("宸插叆搴", "已入库"),
    ("杩愯緭涓", "运输中"),
    ("鍒拌揣", "到货"),
    ("浠诲姟 ", "任务 "),
)


def _default_store() -> Dict[str, Any]:
    return {key: [] for key in STORAGE_KEYS}


def _sanitize_sample_text(value: str) -> str:
    text = str(value)
    for source, target in SAMPLE_TEXT_REPLACEMENTS:
        text = text.replace(source, target)
    return text.rstrip("�?")


def _sanitize_sample_collection(value: Any) -> Any:
    if isinstance(value, list):
        return [_sanitize_sample_collection(item) for item in value]
    if isinstance(value, dict):
        return {key: _sanitize_sample_collection(entry) for key, entry in value.items()}
    if isinstance(value, str):
        return _sanitize_sample_text(value)
    return value


def _normalize_value(key: str, value: Any) -> Any:
    if key == "mes.samples" and isinstance(value, list):
        return _sanitize_sample_collection(value)
    return value


def _normalize_payload(payload: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
    normalized = dict(payload)
    changed = False
    for key in STORAGE_KEYS:
        existing_value = normalized.get(key, [])
        normalized_value = _normalize_value(key, existing_value)
        if normalized_value != existing_value:
            normalized[key] = normalized_value
            changed = True
        elif key not in normalized:
            normalized[key] = []
            changed = True
    return normalized, changed


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

    def _load_file(self) -> tuple[Dict[str, Any], bool]:
        try:
            content = self._path.read_text(encoding="utf-8")
            payload = json.loads(content)
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        return _normalize_payload(payload)

    def _write_file(self, payload: Dict[str, Any]) -> None:
        data = dict(payload)
        for key in STORAGE_KEYS:
            data.setdefault(key, [])
        tmp_path = self._path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self._path)

    def read_all(self) -> Dict[str, Any]:
        with self._lock:
            payload, changed = self._load_file()
            if changed:
                self._write_file(payload)
            return payload

    def read(self, key: str) -> Any:
        with self._lock:
            payload, changed = self._load_file()
            if changed:
                self._write_file(payload)
            return payload.get(key, [])

    def write(self, key: str, value: Any) -> None:
        with self._lock:
            payload, _ = self._load_file()
            payload[key] = _normalize_value(key, value)
            self._write_file(payload)

    def write_many(self, updates: Dict[str, Any]) -> None:
        with self._lock:
            payload, _ = self._load_file()
            payload.update({key: _normalize_value(key, value) for key, value in updates.items()})
            self._write_file(payload)


_storage_backend: StorageBackend | None = None


def get_storage_backend() -> StorageBackend:
    global _storage_backend
    if _storage_backend is None:
        _storage_backend = JsonFileStorage(DEFAULT_STORE_PATH)
    return _storage_backend
