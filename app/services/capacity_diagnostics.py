from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Callable

from app.db.mysql_pool import get_mysql_pool_diagnostics


TRACKED_TABLES = (
    "app_storage_snapshot",
    "biz_task",
    "biz_sample",
    "biz_schedule",
    "biz_experiment_run",
    "biz_mq_message_log",
    "biz_experiment_event",
)
TRACKED_SNAPSHOTS = ("mes.staging_events", "mes.conflicts")


@dataclass(frozen=True)
class CapacityThresholds:
    pool_utilization: float = 0.8
    staging_event_items: int = 20000
    staging_event_bytes: int = 16 * 1024 * 1024
    mq_message_rows: int = 500000
    experiment_event_rows: int = 500000

    @classmethod
    def from_settings(cls, settings: Any) -> "CapacityThresholds":
        return cls(
            pool_utilization=max(0.0, min(1.0, float(settings.CAPACITY_WARN_POOL_UTILIZATION))),
            staging_event_items=max(0, int(settings.CAPACITY_WARN_STAGING_EVENT_ITEMS)),
            staging_event_bytes=max(0, int(settings.CAPACITY_WARN_STAGING_EVENT_BYTES)),
            mq_message_rows=max(0, int(settings.CAPACITY_WARN_MQ_MESSAGE_ROWS)),
            experiment_event_rows=max(0, int(settings.CAPACITY_WARN_EXPERIMENT_EVENT_ROWS)),
        )


def _rows(cursor: Any) -> list[dict[str, Any]]:
    rows = cursor.fetchall() or []
    if not rows:
        return []
    if isinstance(rows[0], dict):
        return [dict(row) for row in rows]
    names = [str(item[0]) for item in (cursor.description or [])]
    return [dict(zip(names, row)) for row in rows]


def _integer(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def collect_capacity_diagnostics(
    connection_factory: Callable[[], Any],
    *,
    retention_status: dict[str, Any] | None = None,
    thresholds: CapacityThresholds | None = None,
) -> dict[str, Any]:
    """Collect bounded, read-only capacity signals for long-running diagnostics."""
    with connection_factory() as connection:
        with connection.cursor() as cursor:
            placeholders = ", ".join(["%s"] * len(TRACKED_TABLES))
            cursor.execute(
                f"""
                SELECT TABLE_NAME AS tableName,
                       COALESCE(TABLE_ROWS, 0) AS estimatedRows,
                       COALESCE(DATA_LENGTH, 0) AS dataBytes,
                       COALESCE(INDEX_LENGTH, 0) AS indexBytes
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME IN ({placeholders})
                ORDER BY TABLE_NAME
                """,
                TRACKED_TABLES,
            )
            table_rows = _rows(cursor)
            snapshot_placeholders = ", ".join(["%s"] * len(TRACKED_SNAPSHOTS))
            cursor.execute(
                f"""
                SELECT storage_key AS storageKey,
                       OCTET_LENGTH(payload_json) AS payloadBytes,
                       CASE WHEN JSON_VALID(payload_json) THEN JSON_LENGTH(payload_json) ELSE NULL END AS itemCount,
                       updated_at AS updatedAt
                FROM app_storage_snapshot
                WHERE storage_key IN ({snapshot_placeholders})
                ORDER BY storage_key
                """,
                TRACKED_SNAPSHOTS,
            )
            snapshot_rows = _rows(cursor)

    tables = [
        {
            "tableName": str(row.get("tableName") or ""),
            "estimatedRows": _integer(row.get("estimatedRows")),
            "dataBytes": _integer(row.get("dataBytes")),
            "indexBytes": _integer(row.get("indexBytes")),
        }
        for row in table_rows
    ]
    snapshots = [
        {
            "storageKey": str(row.get("storageKey") or ""),
            "payloadBytes": _integer(row.get("payloadBytes")),
            "itemCount": None if row.get("itemCount") is None else _integer(row.get("itemCount")),
            "updatedAt": row.get("updatedAt"),
        }
        for row in snapshot_rows
    ]
    pool = get_mysql_pool_diagnostics()
    pool_capacity = _integer(pool.get("maxSize"))
    pool_in_use = _integer(pool.get("inUse"))
    pool_utilization = round(pool_in_use / pool_capacity, 4) if pool_capacity else 0.0
    configured_thresholds = thresholds or CapacityThresholds()
    table_by_name = {item["tableName"]: item for item in tables}
    snapshot_by_key = {item["storageKey"]: item for item in snapshots}
    staging_snapshot = snapshot_by_key.get("mes.staging_events", {})
    warnings: list[str] = []
    if pool_capacity and pool_utilization >= configured_thresholds.pool_utilization:
        warnings.append("mysql_connection_pool_high_utilization")
    if configured_thresholds.staging_event_items and _integer(staging_snapshot.get("itemCount")) >= configured_thresholds.staging_event_items:
        warnings.append("staging_events_item_count_high")
    if configured_thresholds.staging_event_bytes and _integer(staging_snapshot.get("payloadBytes")) >= configured_thresholds.staging_event_bytes:
        warnings.append("staging_events_payload_high")
    if configured_thresholds.mq_message_rows and _integer(table_by_name.get("biz_mq_message_log", {}).get("estimatedRows")) >= configured_thresholds.mq_message_rows:
        warnings.append("mq_message_log_row_count_high")
    if configured_thresholds.experiment_event_rows and _integer(table_by_name.get("biz_experiment_event", {}).get("estimatedRows")) >= configured_thresholds.experiment_event_rows:
        warnings.append("experiment_event_row_count_high")
    if retention_status and str(retention_status.get("lastError") or retention_status.get("last_error") or "").strip():
        warnings.append("data_retention_last_run_failed")
    return {
        "status": "warning" if warnings else "ok",
        "warnings": warnings,
        "thresholds": asdict(configured_thresholds),
        "trackedTotals": {
            "estimatedRows": sum(item["estimatedRows"] for item in tables),
            "dataBytes": sum(item["dataBytes"] for item in tables),
            "indexBytes": sum(item["indexBytes"] for item in tables),
            "snapshotBytes": sum(item["payloadBytes"] for item in snapshots),
        },
        "tables": tables,
        "snapshots": snapshots,
        "mysqlPool": {**pool, "utilization": pool_utilization},
        "retention": retention_status or {"enabled": False, "running": False},
    }
