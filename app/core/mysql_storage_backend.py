from __future__ import annotations

import json
from datetime import datetime
from threading import Lock
from typing import Any, Dict, Iterable

from app.core.performance import observed_lock, performance_span
from app.core.storage_backend import (
    CANONICAL_COMPLETED_STATUS,
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEYS,
    STORAGE_META_KEY,
    StorageBackend,
    _normalize_value,
    normalize_experiment_detail_text,
    normalize_experiment_status_text,
)
from app.core.mysql_storage_codecs import (
    RETENTION_KEYWORD,
    SAMPLE_META_PREFIX,
    STORAGE_MARKER,
    TRAY_META_PREFIX,
    current_beijing_datetime,
    format_iso_storage_datetime,
    normalize_storage_payload,
    normalize_text,
    parse_fixture_ready_flag,
    parse_int_value,
    parse_storage_datetime,
    parse_varchar_length,
)
from app.core.mysql_storage_schema import ensure_schema_extensions
from app.db.mysql_pool import get_mysql_connection_pool
from app.core.mysql_storage_master_readers import (
    list_labs as list_master_labs,
    list_test_types as list_master_test_types,
)
from app.core.mysql_storage_snapshot import (
    delete_missing_rows,
    deserialize_snapshot_payloads,
    serialize_snapshot_updates,
)
from app.core.mysql_storage_loaders import (
    load_devices,
    load_experiment_run_trays,
    load_experiment_run_steps,
    load_experiment_runs,
    load_experiment_samples,
    load_experiment_trays,
    load_experiments,
    load_schedules,
    load_streams,
    load_tasks,
)
from app.core.mysql_storage_replacers import (
    replace_devices,
    replace_experiments,
    replace_task_experiments,
    replace_experiment_runs,
    replace_experiment_run_trays,
    replace_experiment_run_steps,
    replace_experiment_samples,
    replace_experiment_trays,
    replace_schedules,
    replace_streams,
    replace_task_allocation_relations,
    replace_tasks,
)
from app.core.mysql_storage_sample_write import (
    build_managed_sample_write_rows,
    build_sample_tray_write_state,
    build_sample_history_event_rows,
    build_tray_item_rows,
    clear_existing_sample_links,
    delete_missing_managed_samples,
    delete_missing_managed_trays,
    insert_sample_history_event_rows,
    insert_tray_item_rows,
    load_sample_identity_maps,
    load_existing_managed_sample_ids,
    load_existing_managed_tray_ids,
    load_tray_id_map,
    replace_samples,
    replace_sample_patch,
    replace_task_samples,
    update_sample_primary_tray_ids,
    upsert_tray_rows,
    upsert_sample_rows,
)
from app.core.mysql_storage_sample_load import load_samples
from app.core.mysql_storage_mappers import (
    build_experiment_insert_row,
    build_experiment_run_insert_row,
    build_experiment_run_step_insert_row,
    build_experiment_run_tray_insert_row,
    build_experiment_run_tray_insert_rows,
    build_experiment_sample_insert_row,
    build_experiment_tray_insert_row,
    build_device_insert_row,
    build_schedule_insert_row,
    build_storage_experiment_item,
    build_storage_experiment_run_item,
    build_storage_experiment_run_step_item,
    build_storage_experiment_run_tray_item,
    build_storage_experiment_sample_item,
    build_storage_experiment_tray_item,
    build_storage_device_item,
    build_storage_schedule_item,
    build_storage_sample_item,
    build_storage_stream_item,
    build_storage_task_item,
    build_storage_task_tray_codes,
    build_sample_insert_row,
    build_scheduled_dispatch_target_map,
    build_staging_dispatch_target_map,
    build_stream_insert_row,
    build_tray_dispatch_target_map,
    build_task_insert_row,
    extract_dispatch_target_lab,
    normalize_experiment_status,
)
from app.core.mysql_storage_status import (
    EXPERIMENT_COMPLETED_STATUSES,
    EXPERIMENT_RUNNING_STATUS,
    EXPERIMENT_RUNNING_STATUSES,
    LEGACY_EXPERIMENT_RUNNING_STATUS,
    LEGACY_TASK_STORED_STATUS,
    RUN_TRAY_COMPLETED_STATUSES,
    TASK_COMPLETED_STATUS,
    TASK_RUNNING_STATUS,
    TASK_STORED_STATUS,
    UNSCHEDULED_BACKFILL_ELIGIBLE_STATUSES,
    UNSCHEDULED_BACKFILL_HISTORY_ACTION,
    backfill_missing_unscheduled_since,
    derive_experiment_status_map,
    derive_task_status_map,
    has_formal_schedule,
    is_task_stored_status,
    is_unscheduled_since_backfill_eligible,
    resolve_experiment_sample_codes,
    resolve_sample_storage_time,
)
from app.core.mysql_storage_status_sql import (
    backfill_unscheduled_since_for_reads,
    backfill_schedule_task_ids,
    normalize_legacy_status_columns,
    sync_progress_statuses,
    update_experiment_unscheduled_since,
)
from app.core.master_data import DEFAULT_LABS, DEFAULT_TEST_TYPES
from app.db.mysql_snapshot import MySQLConnectionSettings, MySQLSnapshotRepository

RELATIONAL_STORAGE_KEYS = (
    "mes.tasks",
    "mes.schedules",
    "mes.devices",
    "mes.streams",
    "mes.samples",
    "mes.experiments",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_run_steps",
    "mes.experiment_trays",
    "mes.experiment_samples",
)
SNAPSHOT_STORAGE_KEYS = (
    "mes.conflicts",
    "mes.external_task_intakes",
    "mes.lims_inbox",
    "mes.lims_outbox",
    "mes.maintenance_records",
    "mes.staging_events",
    "mes.test_data_settings",
    "mes.test_data_exports",
    STORAGE_META_KEY,
)


class MySQLMesStorageBackend(StorageBackend):
    def __init__(
        self,
        connection_settings: MySQLConnectionSettings,
        snapshot_repository: MySQLSnapshotRepository,
    ) -> None:
        self._connection_settings = connection_settings
        self._connection_pool = get_mysql_connection_pool(connection_settings, dict_cursor=True)
        self._snapshot_repository = snapshot_repository
        self._schema_lock = Lock()
        self._write_lock = Lock()
        self._schema_initialized = False

    def _connect(self):
        return self._connection_pool.acquire()

    def list_test_types(self) -> list[dict[str, Any]]:
        return list_master_test_types(self)

    def list_labs(self) -> list[dict[str, Any]]:
        return list_master_labs(self)

    def _ensure_schema_extensions(self) -> None:
        if self._schema_initialized:
            return
        with self._schema_lock:
            ensure_schema_extensions(self)

    def _deserialize_snapshot_payloads(self, payloads: Dict[str, str]) -> Dict[str, Any]:
        return deserialize_snapshot_payloads(payloads, SNAPSHOT_STORAGE_KEYS, STORAGE_META_KEY, _normalize_value)

    def _serialize_snapshot_updates(self, updates: Dict[str, Any]) -> Dict[str, str]:
        return serialize_snapshot_updates(updates, SNAPSHOT_STORAGE_KEYS, STORAGE_META_KEY, _normalize_value)

    def _delete_missing_rows(
        self,
        cursor,
        *,
        table_name: str,
        marker_column: str,
        key_column: str,
        incoming_keys: Iterable[str],
        marker_value: str,
    ) -> None:
        delete_missing_rows(
            cursor,
            table_name=table_name,
            marker_column=marker_column,
            key_column=key_column,
            incoming_keys=incoming_keys,
            marker_value=marker_value,
        )

    def _replace_tasks(self, cursor, tasks: list[dict[str, Any]], *, prune: bool = True) -> None:
        replace_tasks(cursor, tasks, prune=prune)

    def _replace_schedules(self, cursor, schedules: list[dict[str, Any]]) -> None:
        replace_schedules(cursor, schedules)

    def _replace_experiments(self, cursor, experiments: list[dict[str, Any]]) -> None:
        replace_experiments(cursor, experiments)

    def _replace_experiment_trays(self, cursor, experiment_trays: list[dict[str, Any]]) -> None:
        replace_experiment_trays(cursor, experiment_trays)

    def _replace_experiment_samples(self, cursor, experiment_samples: list[dict[str, Any]]) -> None:
        replace_experiment_samples(cursor, experiment_samples)

    def _replace_experiment_run_trays(self, cursor, experiment_run_trays: list[dict[str, Any]]) -> None:
        replace_experiment_run_trays(cursor, experiment_run_trays)

    def _replace_experiment_run_steps(self, cursor, experiment_run_steps: list[dict[str, Any]]) -> None:
        replace_experiment_run_steps(cursor, experiment_run_steps)

    def _replace_experiment_runs(self, cursor, experiment_runs: list[dict[str, Any]], *, replace_trays: bool = True) -> None:
        replace_experiment_runs(cursor, experiment_runs, replace_trays=replace_trays)

    def _backfill_schedule_task_ids(self, cursor) -> None:
        backfill_schedule_task_ids(cursor)

    def _normalize_legacy_status_columns(self, cursor) -> None:
        normalize_legacy_status_columns(cursor)

    def _sync_progress_statuses(self, cursor) -> None:
        sync_progress_statuses(self, cursor)

    def _replace_devices(self, cursor, devices: list[dict[str, Any]]) -> None:
        replace_devices(cursor, devices)

    def _replace_streams(self, cursor, streams: list[dict[str, Any]]) -> None:
        replace_streams(cursor, streams)

    def _replace_samples(self, cursor, samples: list[dict[str, Any]]) -> None:
        replace_samples(cursor, samples)

    def _replace_sample_patch(self, cursor, samples: list[dict[str, Any]]) -> None:
        replace_sample_patch(cursor, samples)

    def _replace_task_samples(self, cursor, samples: list[dict[str, Any]], task_codes: set[str]) -> None:
        replace_task_samples(cursor, samples, task_codes)

    def _replace_task_experiments(self, cursor, experiments: list[dict[str, Any]], task_codes: set[str]) -> None:
        replace_task_experiments(cursor, experiments, task_codes)

    def _delete_task_experiment_samples(self, cursor, task_codes: set[str]) -> None:
        normalized_task_codes = sorted({normalize_text(code) for code in task_codes if normalize_text(code)})
        if not normalized_task_codes:
            return
        placeholders = ", ".join(["%s"] * len(normalized_task_codes))
        cursor.execute(
            f"DELETE FROM biz_experiment_sample WHERE task_no IN ({placeholders})",
            normalized_task_codes,
        )

    def _insert_task_experiment_samples(
        self,
        cursor,
        experiment_samples: list[dict[str, Any]],
        task_codes: set[str],
    ) -> None:
        normalized_task_codes = {normalize_text(code) for code in task_codes if normalize_text(code)}
        rows = [
            build_experiment_sample_insert_row(relation)
            for relation in experiment_samples
            if normalize_text(relation.get("task_code")) in normalized_task_codes
            and normalize_text(relation.get("experiment_code"))
            and normalize_text(relation.get("sample_code"))
        ]
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_experiment_sample (experiment_no, task_no, sample_no, created_at, updated_at)
            VALUES (%(experiment_no)s, %(task_no)s, %(sample_no)s, %(created_at)s, %(updated_at)s)
            """,
            rows,
        )

    def _replace_task_allocation_relations(
        self,
        cursor,
        *,
        task_code: str,
        experiment_runs: list[dict[str, Any]],
        experiment_run_trays: list[dict[str, Any]],
        experiment_trays: list[dict[str, Any]],
        experiment_samples: list[dict[str, Any]],
    ) -> None:
        replace_task_allocation_relations(
            cursor,
            task_code=task_code,
            experiment_runs=experiment_runs,
            experiment_run_trays=experiment_run_trays,
            experiment_trays=experiment_trays,
            experiment_samples=experiment_samples,
        )

    def _load_tasks(self, cursor) -> list[dict[str, Any]]:
        return load_tasks(cursor)

    def _load_schedules(self, cursor) -> list[dict[str, Any]]:
        return load_schedules(cursor)

    def _load_experiments(self, cursor) -> list[dict[str, Any]]:
        return load_experiments(cursor)

    def _load_experiment_trays(self, cursor) -> list[dict[str, Any]]:
        return load_experiment_trays(cursor)

    def _load_experiment_samples(self, cursor) -> list[dict[str, Any]]:
        return load_experiment_samples(cursor)

    def _load_experiment_runs(self, cursor) -> list[dict[str, Any]]:
        return load_experiment_runs(cursor)

    def _load_experiment_run_trays(self, cursor) -> list[dict[str, Any]]:
        return load_experiment_run_trays(cursor)

    def _load_experiment_run_steps(self, cursor) -> list[dict[str, Any]]:
        return load_experiment_run_steps(cursor)

    def _load_devices(self, cursor) -> list[dict[str, Any]]:
        return load_devices(cursor)

    def _load_streams(self, cursor) -> list[dict[str, Any]]:
        return load_streams(cursor)

    def _load_samples(
        self,
        cursor,
        staging_event_rows: Iterable[Dict[str, Any]] | None = None,
        schedules: Iterable[Dict[str, Any]] | None = None,
        experiment_trays: Iterable[Dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        return load_samples(
            cursor,
            staging_event_rows=staging_event_rows,
            schedules=schedules,
            experiment_trays=experiment_trays,
        )
    def _update_experiment_unscheduled_since(
        self,
        cursor,
        repaired: dict[str, datetime],
    ) -> None:
        update_experiment_unscheduled_since(cursor, repaired)

    def _backfill_unscheduled_since_for_reads(
        self,
        cursor,
        *,
        tasks: list[dict[str, Any]],
        schedules: list[dict[str, Any]],
        experiments: list[dict[str, Any]],
        experiment_trays: list[dict[str, Any]],
        experiment_samples: list[dict[str, Any]],
        samples: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], bool]:
        return backfill_unscheduled_since_for_reads(
            self,
            cursor,
            tasks=tasks,
            schedules=schedules,
            experiments=experiments,
            experiment_trays=experiment_trays,
            experiment_samples=experiment_samples,
            samples=samples,
        )

    def _write_many_internal(self, updates: Dict[str, Any], *, patch_samples: bool = False) -> None:
        with performance_span("storage.schema"):
            self._ensure_schema_extensions()
        relational_updates = {key: updates.get(key) for key in RELATIONAL_STORAGE_KEYS if key in updates}
        snapshot_updates = self._serialize_snapshot_updates(updates)

        with self._connect() as connection:
            with connection.cursor() as cursor:
                if "mes.devices" in relational_updates:
                    self._replace_devices(cursor, relational_updates["mes.devices"] or [])
                if "mes.tasks" in relational_updates:
                    self._replace_tasks(cursor, relational_updates["mes.tasks"] or [], prune=False)
                if "mes.schedules" in relational_updates:
                    self._replace_schedules(cursor, relational_updates["mes.schedules"] or [])
                if "mes.streams" in relational_updates:
                    self._replace_streams(cursor, relational_updates["mes.streams"] or [])
                if "mes.samples" in relational_updates:
                    if patch_samples:
                        self._replace_sample_patch(cursor, relational_updates["mes.samples"] or [])
                    else:
                        self._replace_samples(cursor, relational_updates["mes.samples"] or [])
                if "mes.experiments" in relational_updates:
                    self._replace_experiments(cursor, relational_updates["mes.experiments"] or [])
                if "mes.experiment_runs" in relational_updates:
                    self._replace_experiment_runs(
                        cursor,
                        relational_updates["mes.experiment_runs"] or [],
                        replace_trays="mes.experiment_run_trays" not in relational_updates,
                    )
                if "mes.experiment_run_trays" in relational_updates:
                    self._replace_experiment_run_trays(cursor, relational_updates["mes.experiment_run_trays"] or [])
                if "mes.experiment_run_steps" in relational_updates:
                    self._replace_experiment_run_steps(cursor, relational_updates["mes.experiment_run_steps"] or [])
                if "mes.experiment_trays" in relational_updates:
                    self._replace_experiment_trays(cursor, relational_updates["mes.experiment_trays"] or [])
                if "mes.experiment_samples" in relational_updates:
                    self._replace_experiment_samples(cursor, relational_updates["mes.experiment_samples"] or [])
                if "mes.tasks" in relational_updates:
                    self._replace_tasks(cursor, relational_updates["mes.tasks"] or [], prune=True)
                if relational_updates:
                    self._backfill_schedule_task_ids(cursor)
                    self._sync_progress_statuses(cursor)
            connection.commit()

        if snapshot_updates:
            self._snapshot_repository.write_many(snapshot_updates)

    def read_many(self, keys: Iterable[str]) -> Dict[str, Any]:
        requested_keys = list(dict.fromkeys(
            key for key in keys if key in STORAGE_KEYS or key == STORAGE_META_KEY
        ))
        if not requested_keys:
            return {}

        with performance_span("storage.schema"):
            self._ensure_schema_extensions()
        requested_set = set(requested_keys)
        snapshot_keys = [
            key
            for key in requested_keys
            if key in SNAPSHOT_STORAGE_KEYS or key == STORAGE_META_KEY
        ]
        if "mes.samples" in requested_set and "mes.staging_events" not in snapshot_keys:
            snapshot_keys.append("mes.staging_events")
        if snapshot_keys:
            with performance_span("storage.snapshot"):
                read_snapshot_many = getattr(self._snapshot_repository, "read_many", None)
                if callable(read_snapshot_many):
                    raw_snapshot_values = read_snapshot_many(snapshot_keys)
                else:
                    all_snapshot_values = self._snapshot_repository.read_all()
                    raw_snapshot_values = {
                        key: all_snapshot_values[key]
                        for key in snapshot_keys
                        if key in all_snapshot_values
                    }
                snapshot_values = self._deserialize_snapshot_payloads(raw_snapshot_values)
        else:
            snapshot_values = {}
        data: Dict[str, Any] = {
            key: snapshot_values.get(
                key,
                {"schema_version": CURRENT_SCHEMA_VERSION} if key == STORAGE_META_KEY else [],
            )
            for key in requested_keys
            if key in SNAPSHOT_STORAGE_KEYS or key == STORAGE_META_KEY
        }

        relational_keys = requested_set.intersection(RELATIONAL_STORAGE_KEYS)
        if relational_keys:
            with performance_span("storage.relational"), self._connect() as connection:
                with connection.cursor() as cursor:
                    loaded: Dict[str, Any] = {}

                    def load(key: str) -> Any:
                        if key in loaded:
                            return loaded[key]
                        loaders = {
                            "mes.tasks": self._load_tasks,
                            "mes.schedules": self._load_schedules,
                            "mes.devices": self._load_devices,
                            "mes.streams": self._load_streams,
                            "mes.experiments": self._load_experiments,
                            "mes.experiment_runs": self._load_experiment_runs,
                            "mes.experiment_run_trays": self._load_experiment_run_trays,
                            "mes.experiment_run_steps": self._load_experiment_run_steps,
                            "mes.experiment_trays": self._load_experiment_trays,
                            "mes.experiment_samples": self._load_experiment_samples,
                        }
                        if key == "mes.samples":
                            loaded[key] = self._load_samples(
                                cursor,
                                snapshot_values.get("mes.staging_events"),
                                schedules=load("mes.schedules"),
                                experiment_trays=load("mes.experiment_trays"),
                            )
                        else:
                            loaded[key] = loaders[key](cursor)
                        return loaded[key]

                    for key in requested_keys:
                        if key in RELATIONAL_STORAGE_KEYS:
                            data[key] = load(key)

        return {key: data.get(key, []) for key in requested_keys}

    def read_all(self) -> Dict[str, Any]:
        data = self.read_many([*STORAGE_KEYS, STORAGE_META_KEY])
        data.setdefault(STORAGE_META_KEY, {"schema_version": CURRENT_SCHEMA_VERSION})
        return normalize_storage_payload(data)

    def read(self, key: str) -> Any:
        if key not in STORAGE_KEYS:
            return []
        return self.read_many([key]).get(key, [])

    def write(self, key: str, value: Any) -> None:
        self.write_many({key: value})

    def write_many(self, updates: Dict[str, Any]) -> None:
        with observed_lock(self._write_lock, "storage.write_lock"):
            normalized_updates = {
                key: (
                    _normalize_value(key, value if isinstance(value, dict) else {})
                    if key == STORAGE_META_KEY
                    else _normalize_value(key, value if isinstance(value, list) else [])
                )
                for key, value in updates.items()
                if key in STORAGE_KEYS or key == STORAGE_META_KEY
            }
            if not normalized_updates:
                return
            self._write_many_internal(normalized_updates)

    def write_many_scoped(self, updates: Dict[str, Any]) -> None:
        with observed_lock(self._write_lock, "storage.write_lock"):
            normalized_updates = {
                key: (
                    _normalize_value(key, value if isinstance(value, dict) else {})
                    if key == STORAGE_META_KEY
                    else _normalize_value(key, value if isinstance(value, list) else [])
                )
                for key, value in updates.items()
                if key in STORAGE_KEYS or key == STORAGE_META_KEY
            }
            if not normalized_updates:
                return
            self._write_many_internal(normalized_updates, patch_samples=True)

    def write_task_scope(self, updates: Dict[str, Any], *, task_codes: set[str]) -> None:
        normalized_task_codes = {normalize_text(code) for code in task_codes if normalize_text(code)}
        if not normalized_task_codes:
            return
        with observed_lock(self._write_lock, "storage.write_lock"):
            normalized_updates = {
                key: _normalize_value(key, value if isinstance(value, list) else [])
                for key, value in updates.items()
                if key in {"mes.tasks", "mes.samples", "mes.experiments", "mes.experiment_samples"}
            }
            if not normalized_updates:
                return
            self._ensure_schema_extensions()
            with self._connect() as connection:
                try:
                    with connection.cursor() as cursor:
                        if "mes.experiment_samples" in normalized_updates:
                            self._delete_task_experiment_samples(cursor, normalized_task_codes)
                        if "mes.tasks" in normalized_updates:
                            self._replace_tasks(cursor, normalized_updates["mes.tasks"], prune=False)
                        if "mes.samples" in normalized_updates:
                            self._replace_task_samples(cursor, normalized_updates["mes.samples"], normalized_task_codes)
                        if "mes.experiments" in normalized_updates:
                            self._replace_task_experiments(cursor, normalized_updates["mes.experiments"], normalized_task_codes)
                        if "mes.experiment_samples" in normalized_updates:
                            self._insert_task_experiment_samples(
                                cursor,
                                normalized_updates["mes.experiment_samples"],
                                normalized_task_codes,
                            )
                        self._backfill_schedule_task_ids(cursor)
                        self._sync_progress_statuses(cursor)
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise

    def write_task_allocation_scope(self, task_code: str, updates: Dict[str, Any]) -> None:
        """Atomically persist only the allocation-owned rows for one task."""
        normalized_task_code = normalize_text(task_code)
        if not normalized_task_code:
            raise ValueError("task_code must not be empty")

        allocation_keys = {
            "mes.tasks",
            "mes.samples",
            "mes.experiment_runs",
            "mes.experiment_run_trays",
            "mes.experiment_trays",
            "mes.experiment_samples",
        }
        with observed_lock(self._write_lock, "storage.write_lock"):
            normalized_updates = {
                key: _normalize_value(key, value if isinstance(value, list) else [])
                for key, value in updates.items()
                if key in allocation_keys
            }
            scoped_updates = {
                key: [
                    row
                    for row in normalized_updates.get(key, [])
                    if normalize_text(row.get("code") if key == "mes.tasks" else row.get("task_code"))
                    == normalized_task_code
                ]
                for key in allocation_keys
            }
            task_rows = scoped_updates["mes.tasks"]
            if len(task_rows) != 1:
                raise ValueError(f"allocation update must contain exactly one task row for {normalized_task_code}")

            self._ensure_schema_extensions()
            with self._connect() as connection:
                try:
                    with connection.cursor() as cursor:
                        self._replace_tasks(cursor, task_rows, prune=False)
                        self._replace_task_samples(
                            cursor,
                            scoped_updates["mes.samples"],
                            {normalized_task_code},
                        )
                        self._replace_task_allocation_relations(
                            cursor,
                            task_code=normalized_task_code,
                            experiment_runs=scoped_updates["mes.experiment_runs"],
                            experiment_run_trays=scoped_updates["mes.experiment_run_trays"],
                            experiment_trays=scoped_updates["mes.experiment_trays"],
                            experiment_samples=scoped_updates["mes.experiment_samples"],
                        )
                        self._backfill_schedule_task_ids(cursor)
                        self._sync_progress_statuses(cursor)
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
