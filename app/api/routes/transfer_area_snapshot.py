from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from app.core.storage_backend import normalize_storage_payload


TRANSFER_SNAPSHOT_STORAGE_KEYS = {
    "tasks": "mes.tasks",
    "samples": "mes.samples",
    "schedules": "mes.schedules",
    "experiments": "mes.experiments",
    "experiment_runs": "mes.experiment_runs",
    "experiment_run_trays": "mes.experiment_run_trays",
    "experiment_run_steps": "mes.experiment_run_steps",
    "experiment_trays": "mes.experiment_trays",
    "experiment_samples": "mes.experiment_samples",
    "staging_events": "mes.staging_events",
    "devices": "mes.devices",
}
TRANSFER_BOOTSTRAP_READ_FIELDS = (
    "tasks",
    "samples",
    "schedules",
    "experiments",
    "experiment_run_trays",
    "experiment_trays",
    "staging_events",
)
TRANSFER_WORKSPACE_READ_FIELDS = (
    "tasks",
    "samples",
    "schedules",
    "experiments",
    "experiment_run_trays",
    "experiment_trays",
    "experiment_samples",
    "staging_events",
)


def read_transfer_snapshot(
    storage: Any,
    fields: Iterable[str] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    selected_fields = tuple(dict.fromkeys(fields or TRANSFER_SNAPSHOT_STORAGE_KEYS))
    selected_fields = tuple(field for field in selected_fields if field in TRANSFER_SNAPSHOT_STORAGE_KEYS)
    storage_keys = [TRANSFER_SNAPSHOT_STORAGE_KEYS[field] for field in selected_fields]
    read_many = getattr(storage, "read_many", None)
    raw_payload = read_many(storage_keys) if callable(read_many) else storage.read_all()
    payload = normalize_storage_payload(raw_payload)
    return {
        field: [
            dict(item)
            for item in payload.get(TRANSFER_SNAPSHOT_STORAGE_KEYS[field], [])
            if isinstance(item, dict)
        ]
        for field in selected_fields
    }


def hydrate_transfer_snapshot_for_write(
    storage: Any,
    snapshot: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    missing_fields = tuple(field for field in TRANSFER_SNAPSHOT_STORAGE_KEYS if field not in snapshot)
    if not missing_fields:
        return snapshot
    return {**read_transfer_snapshot(storage, missing_fields), **snapshot}


__all__ = [
    "TRANSFER_BOOTSTRAP_READ_FIELDS",
    "TRANSFER_SNAPSHOT_STORAGE_KEYS",
    "TRANSFER_WORKSPACE_READ_FIELDS",
    "hydrate_transfer_snapshot_for_write",
    "read_transfer_snapshot",
]
