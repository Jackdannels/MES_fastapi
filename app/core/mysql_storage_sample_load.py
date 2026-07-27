from __future__ import annotations

from typing import Any, Dict, Iterable

from app.core.storage_backend import normalize_experiment_status_text
from app.core.mysql_storage_codecs import SAMPLE_META_PREFIX, normalize_text
from app.core.mysql_storage_mappers import (
    build_appearance_stock_in_index,
    build_scheduled_dispatch_target_map,
    build_staging_dispatch_target_map,
    build_storage_sample_item,
)


def load_samples(
    cursor,
    staging_event_rows: Iterable[Dict[str, Any]] | None = None,
    schedules: Iterable[Dict[str, Any]] | None = None,
    experiment_trays: Iterable[Dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT s.sample_id, s.sample_no, t.task_no, s.sample_type, s.batch_no, s.arrival_time,
               s.quantity, s.storage_condition, s.barcode_no, s.location_desc, s.sample_status,
               s.flow_status, s.remark, s.created_at, s.updated_at
        FROM biz_sample s
        LEFT JOIN biz_task t ON t.task_id = s.task_id
        WHERE s.remark LIKE %s
        ORDER BY s.created_at DESC, s.sample_no DESC
        """,
        (f"{SAMPLE_META_PREFIX}%",),
    )
    sample_rows = cursor.fetchall()
    if not sample_rows:
        return []

    staging_event_row_list = list(staging_event_rows or [])
    schedule_list = list(schedules or [])
    experiment_tray_list = list(experiment_trays or [])
    staging_target_by_tray_code = build_staging_dispatch_target_map(staging_event_row_list)
    scheduled_target_by_key = build_scheduled_dispatch_target_map(schedule_list, experiment_tray_list)
    appearance_stock_in_keys = build_appearance_stock_in_index(staging_event_row_list)

    sample_ids = [row["sample_id"] for row in sample_rows]
    placeholders = ", ".join(["%s"] * len(sample_ids))

    cursor.execute(
        f"""
        SELECT ti.sample_id, t.task_no, tr.tray_no AS tray_code, s.sample_no AS sample_code, ti.quantity, ti.status,
               tr.test_state, tr.tray_status, tr.fixture_ready, tr.target_sub_experiment_code,
               ti.created_at, ti.updated_at
        FROM biz_tray_item ti
        JOIN biz_tray tr ON tr.tray_id = ti.tray_id
        JOIN biz_sample s ON s.sample_id = ti.sample_id
        LEFT JOIN biz_task t ON t.task_id = s.task_id
        WHERE ti.sample_id IN ({placeholders})
        ORDER BY ti.created_at DESC, tr.tray_no ASC
        """,
        sample_ids,
    )
    tray_rows = cursor.fetchall()
    tray_map: Dict[int, list[dict[str, Any]]] = {}
    for row in tray_rows:
        tray_status = normalize_experiment_status_text(row.get("status") or row.get("test_state") or row.get("tray_status"))
        if tray_status == "工装夹具安装" and bool(row.get("fixture_ready")):
            row["fixture_ready"] = True
            row["fixtureReady"] = True
        tray_map.setdefault(row["sample_id"], []).append(row)

    cursor.execute(
        f"""
        SELECT event_id, sample_id, sample_no, action_type, location_desc, owner_name, sample_status, detail, event_time
        FROM biz_sample_event
        WHERE sample_id IN ({placeholders})
        ORDER BY event_time DESC, event_id DESC
        """,
        sample_ids,
    )
    event_rows = cursor.fetchall()
    event_map: Dict[int, list[dict[str, Any]]] = {}
    for row in event_rows:
        event_map.setdefault(row["sample_id"], []).append(row)

    return [
        build_storage_sample_item(
            row,
            tray_rows=tray_map.get(row["sample_id"], []),
            event_rows=event_map.get(row["sample_id"], []),
            staging_event_rows=staging_event_row_list,
            schedules=schedule_list,
            experiment_trays=experiment_tray_list,
            staging_target_by_tray_code=staging_target_by_tray_code,
            scheduled_target_by_key=scheduled_target_by_key,
            appearance_stock_in_keys=appearance_stock_in_keys,
        )
        for row in sample_rows
    ]
