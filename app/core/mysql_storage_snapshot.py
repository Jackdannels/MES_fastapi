from __future__ import annotations

import json
from typing import Any, Callable, Dict, Iterable


def delete_missing_rows(
    cursor,
    *,
    table_name: str,
    marker_column: str,
    key_column: str,
    incoming_keys: Iterable[str],
    marker_value: str,
) -> None:
    keys = [key for key in incoming_keys if key]
    if not keys:
        cursor.execute(f"DELETE FROM {table_name} WHERE {marker_column} = %s", (marker_value,))
        return
    placeholders = ", ".join(["%s"] * len(keys))
    params = [marker_value, *keys]
    cursor.execute(
        f"DELETE FROM {table_name} WHERE {marker_column} = %s AND {key_column} NOT IN ({placeholders})",
        params,
    )


def deserialize_snapshot_payloads(
    payloads: Dict[str, str],
    snapshot_storage_keys: Iterable[str],
    storage_meta_key: str,
    normalize_value: Callable[[str, Any], Any],
) -> Dict[str, Any]:
    values: Dict[str, Any] = {}
    for key in snapshot_storage_keys:
        raw_value = payloads.get(key)
        if key == storage_meta_key:
            try:
                parsed = json.loads(raw_value) if raw_value else {}
            except json.JSONDecodeError:
                parsed = {}
            values[key] = normalize_value(key, parsed if isinstance(parsed, dict) else {})
            continue
        try:
            parsed = json.loads(raw_value) if raw_value else []
        except json.JSONDecodeError:
            parsed = []
        values[key] = normalize_value(key, parsed if isinstance(parsed, list) else [])
    return values


def serialize_snapshot_updates(
    updates: Dict[str, Any],
    snapshot_storage_keys: Iterable[str],
    storage_meta_key: str,
    normalize_value: Callable[[str, Any], Any],
) -> Dict[str, str]:
    serialized: Dict[str, str] = {}
    for key in snapshot_storage_keys:
        if key not in updates:
            continue
        if key == storage_meta_key:
            normalized = normalize_value(key, updates.get(key) if isinstance(updates.get(key), dict) else {})
        else:
            normalized = normalize_value(key, updates.get(key) if isinstance(updates.get(key), list) else [])
        serialized[key] = json.dumps(normalized, ensure_ascii=False)
    return serialized
