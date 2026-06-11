from __future__ import annotations

import json
from datetime import datetime
from threading import Lock
from typing import Any, Dict, Iterable

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
    FIXTURE_READY_COMPAT_MESSAGE_PREFIX,
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
    replace_experiment_runs,
    replace_experiment_run_trays,
    replace_experiment_samples,
    replace_experiment_trays,
    replace_schedules,
    replace_streams,
    replace_tasks,
)
from app.core.mysql_storage_sample_write import (
    build_managed_sample_write_rows,
    build_fixture_ready_events,
    build_sample_tray_write_state,
    build_sample_history_event_rows,
    build_tray_item_rows,
    clear_existing_sample_links,
    delete_managed_fixture_ready_events,
    delete_missing_managed_samples,
    delete_missing_managed_trays,
    insert_fixture_ready_events,
    insert_sample_history_event_rows,
    insert_tray_item_rows,
    load_sample_identity_maps,
    load_existing_managed_sample_ids,
    load_existing_managed_tray_ids,
    load_tray_id_map,
    replace_samples,
    update_sample_primary_tray_ids,
    upsert_tray_rows,
    upsert_sample_rows,
)
from app.core.mysql_storage_sample_load import load_samples
from app.core.mysql_storage_mappers import (
    build_experiment_insert_row,
    build_experiment_run_insert_row,
    build_experiment_run_tray_insert_row,
    build_experiment_run_tray_insert_rows,
    build_experiment_sample_insert_row,
    build_experiment_tray_insert_row,
    build_device_insert_row,
    build_schedule_insert_row,
    build_storage_experiment_item,
    build_storage_experiment_run_item,
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
    parse_experiment_event_detail,
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
    "mes.experiment_trays",
    "mes.experiment_samples",
)
SNAPSHOT_STORAGE_KEYS = ("mes.conflicts", "mes.staging_events", STORAGE_META_KEY)


class MySQLMesStorageBackend(StorageBackend):
    def __init__(
        self,
        connection_settings: MySQLConnectionSettings,
        snapshot_repository: MySQLSnapshotRepository,
    ) -> None:
        self._connection_settings = connection_settings
        self._snapshot_repository = snapshot_repository
        self._lock = Lock()
        self._schema_initialized = False

    def _connect(self):
        try:
            import pymysql
            from pymysql.cursors import DictCursor
        except ImportError as exc:
            raise RuntimeError("pymysql is required for the MySQL storage backend") from exc

        return pymysql.connect(
            host=self._connection_settings.host,
            port=self._connection_settings.port,
            user=self._connection_settings.user,
            password=self._connection_settings.password,
            database=self._connection_settings.database,
            charset=self._connection_settings.charset,
            autocommit=False,
            cursorclass=DictCursor,
        )

    def list_test_types(self) -> list[dict[str, Any]]:
        return list_master_test_types(self)

    def list_labs(self) -> list[dict[str, Any]]:
        return list_master_labs(self)

    def _ensure_schema_extensions(self) -> None:
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

    def _write_many_internal(self, updates: Dict[str, Any]) -> None:
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

    def read_all(self) -> Dict[str, Any]:
        with self._lock:
            self._ensure_schema_extensions()
            snapshot_values = self._deserialize_snapshot_payloads(self._snapshot_repository.read_all())
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    self._normalize_legacy_status_columns(cursor)
                    connection.commit()
                    tasks = self._load_tasks(cursor)
                    schedules = self._load_schedules(cursor)
                    experiments = self._load_experiments(cursor)
                    experiment_runs = self._load_experiment_runs(cursor)
                    experiment_run_trays = self._load_experiment_run_trays(cursor)
                    experiment_trays = self._load_experiment_trays(cursor)
                    experiment_samples = self._load_experiment_samples(cursor)
                    samples = self._load_samples(
                        cursor,
                        snapshot_values.get("mes.staging_events"),
                        schedules=schedules,
                        experiment_trays=experiment_trays,
                    )
                    experiments, repaired = self._backfill_unscheduled_since_for_reads(
                        cursor,
                        tasks=tasks,
                        schedules=schedules,
                        experiments=experiments,
                        experiment_trays=experiment_trays,
                        experiment_samples=experiment_samples,
                        samples=samples,
                    )
                    if repaired:
                        connection.commit()
                    data = {
                        "mes.tasks": tasks,
                        "mes.schedules": schedules,
                        "mes.devices": self._load_devices(cursor),
                        "mes.streams": self._load_streams(cursor),
                        "mes.samples": samples,
                        "mes.experiments": experiments,
                        "mes.experiment_runs": experiment_runs,
                        "mes.experiment_run_trays": experiment_run_trays,
                        "mes.experiment_trays": experiment_trays,
                        "mes.experiment_samples": experiment_samples,
                    }
            data.update(snapshot_values)
            for key in STORAGE_KEYS:
                data.setdefault(key, [])
            data.setdefault(STORAGE_META_KEY, {"schema_version": CURRENT_SCHEMA_VERSION})
            return normalize_storage_payload(data)

    def read(self, key: str) -> Any:
        if key not in STORAGE_KEYS:
            return []
        with self._lock:
            self._ensure_schema_extensions()
            if key in SNAPSHOT_STORAGE_KEYS:
                snapshot_values = self._deserialize_snapshot_payloads(self._snapshot_repository.read_all())
                return snapshot_values.get(key, [])
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    self._normalize_legacy_status_columns(cursor)
                    connection.commit()
                    tasks = self._load_tasks(cursor)
                    schedules = self._load_schedules(cursor)
                    snapshot_values = self._deserialize_snapshot_payloads(self._snapshot_repository.read_all())
                    experiments = self._load_experiments(cursor)
                    experiment_runs = self._load_experiment_runs(cursor)
                    experiment_run_trays = self._load_experiment_run_trays(cursor)
                    experiment_trays = self._load_experiment_trays(cursor)
                    experiment_samples = self._load_experiment_samples(cursor)
                    samples = self._load_samples(
                        cursor,
                        snapshot_values.get("mes.staging_events"),
                        schedules=schedules,
                        experiment_trays=experiment_trays,
                    )
                    experiments, repaired = self._backfill_unscheduled_since_for_reads(
                        cursor,
                        tasks=tasks,
                        schedules=schedules,
                        experiments=experiments,
                        experiment_trays=experiment_trays,
                        experiment_samples=experiment_samples,
                        samples=samples,
                    )
                    if repaired:
                        connection.commit()
                    if key == "mes.tasks":
                        return tasks
                    if key == "mes.schedules":
                        return schedules
                    if key == "mes.devices":
                        return self._load_devices(cursor)
                    if key == "mes.streams":
                        return self._load_streams(cursor)
                    if key == "mes.samples":
                        return samples
                    if key == "mes.experiments":
                        return experiments
                    if key == "mes.experiment_runs":
                        return experiment_runs
                    if key == "mes.experiment_run_trays":
                        return experiment_run_trays
                    if key == "mes.experiment_trays":
                        return experiment_trays
                    if key == "mes.experiment_samples":
                        return experiment_samples
            return []

    def write(self, key: str, value: Any) -> None:
        self.write_many({key: value})

    def write_many(self, updates: Dict[str, Any]) -> None:
        with self._lock:
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
