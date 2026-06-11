from __future__ import annotations

import json
from typing import Any, Dict, Iterable

from app.core.storage_backend import normalize_experiment_status_text
from app.core.mysql_storage_codecs import SAMPLE_META_PREFIX, normalize_text, parse_storage_datetime
from app.core.mysql_storage_mappers import build_storage_sample_item


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

    sample_ids = [row["sample_id"] for row in sample_rows]
    placeholders = ", ".join(["%s"] * len(sample_ids))

    cursor.execute(
        f"""
        SELECT ti.sample_id, t.task_no, tr.tray_no AS tray_code, s.sample_no AS sample_code, ti.quantity, ti.status,
               tr.test_state, tr.tray_status, ti.created_at, ti.updated_at
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
    task_nos = sorted({normalize_text(row.get("task_no")) for row in sample_rows if normalize_text(row.get("task_no"))})
    fixture_ready_events_by_task: Dict[str, list[dict[str, Any]]] = {}
    if task_nos:
        task_placeholders = ", ".join(["%s"] * len(task_nos))
        cursor.execute(
            f"""
            SELECT task_no, experiment_no, event_time, payload_json
            FROM biz_experiment_event
            WHERE event_type = 'FIXTURE_READY'
              AND task_no IN ({task_placeholders})
            ORDER BY event_time DESC
            """,
            task_nos,
        )
        for row in cursor.fetchall():
            task_no = normalize_text(row.get("task_no"))
            event_time = parse_storage_datetime(row.get("event_time"))
            if not task_no or event_time is None:
                continue
            payload = {}
            payload_json = row.get("payload_json")
            if isinstance(payload_json, str) and normalize_text(payload_json):
                try:
                    decoded_payload = json.loads(payload_json)
                    if isinstance(decoded_payload, dict):
                        payload = decoded_payload
                except json.JSONDecodeError:
                    payload = {}
            fixture_ready_events_by_task.setdefault(task_no, []).append(
                {
                    "event_time": event_time,
                    "experiment_no": normalize_text(row.get("experiment_no") or payload.get("experimentNo") or payload.get("experimentCode")),
                    "tray_code": normalize_text(payload.get("trayCode") or payload.get("tray_code") or payload.get("trayNo") or payload.get("tray_no")),
                }
            )
    tray_map: Dict[int, list[dict[str, Any]]] = {}
    for row in tray_rows:
        task_no = normalize_text(row.get("task_no"))
        tray_code = normalize_text(row.get("tray_code"))
        tray_updated_at = parse_storage_datetime(row.get("updated_at")) or parse_storage_datetime(row.get("created_at"))
        tray_status = normalize_experiment_status_text(row.get("status") or row.get("test_state") or row.get("tray_status"))
        fixture_ready_time = next(
            (
                event["event_time"]
                for event in fixture_ready_events_by_task.get(task_no, [])
                if not event["tray_code"] or event["tray_code"] == tray_code
            ),
            None,
        )
        if (
            tray_status == "工装夹具安装"
            and fixture_ready_time is not None
            and (tray_updated_at is None or fixture_ready_time >= tray_updated_at)
        ):
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
            staging_event_rows=staging_event_rows,
            schedules=schedules,
            experiment_trays=experiment_trays,
        )
        for row in sample_rows
    ]
