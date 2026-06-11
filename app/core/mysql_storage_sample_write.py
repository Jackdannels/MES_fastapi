from __future__ import annotations

import json
from typing import Any, Dict

from app.core.storage_backend import normalize_experiment_detail_text, normalize_experiment_status_text
from app.core.mysql_storage_codecs import (
    FIXTURE_READY_COMPAT_MESSAGE_PREFIX,
    SAMPLE_META_PREFIX,
    STORAGE_MARKER,
    TRAY_META_PREFIX,
    current_beijing_datetime,
    normalize_text,
    parse_fixture_ready_flag,
    parse_int_value,
    parse_storage_datetime,
)
from app.core.mysql_storage_mappers import build_sample_insert_row


def build_managed_sample_write_rows(samples: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    managed_samples = [sample for sample in samples if normalize_text(sample.get("code"))]
    sample_rows = [build_sample_insert_row(sample) for sample in managed_samples]
    incoming_sample_codes = [row["sample_no"] for row in sample_rows]
    return managed_samples, sample_rows, incoming_sample_codes


def load_existing_managed_sample_ids(cursor) -> list[int]:
    cursor.execute(
        "SELECT sample_id, sample_no FROM biz_sample WHERE remark LIKE %s",
        (f"{SAMPLE_META_PREFIX}%",),
    )
    existing_sample_rows = cursor.fetchall()
    return [row["sample_id"] for row in existing_sample_rows]


def load_existing_managed_tray_ids(cursor) -> list[int]:
    cursor.execute(
        "SELECT tray_id, tray_no FROM biz_tray WHERE remark = %s",
        (TRAY_META_PREFIX,),
    )
    existing_tray_rows = cursor.fetchall()
    return [row["tray_id"] for row in existing_tray_rows]


def clear_existing_sample_links(cursor, existing_sample_ids: list[int], existing_tray_ids: list[int]) -> None:
    if existing_sample_ids:
        placeholders = ", ".join(["%s"] * len(existing_sample_ids))
        cursor.execute(
            f"UPDATE biz_sample SET tray_id = NULL WHERE sample_id IN ({placeholders})",
            existing_sample_ids,
        )
        cursor.execute(
            f"DELETE FROM biz_sample_event WHERE sample_id IN ({placeholders})",
            existing_sample_ids,
        )

    if existing_tray_ids:
        placeholders = ", ".join(["%s"] * len(existing_tray_ids))
        cursor.execute(
            f"DELETE FROM biz_tray_item WHERE tray_id IN ({placeholders})",
            existing_tray_ids,
        )


def delete_missing_managed_samples(cursor, incoming_sample_codes: list[str]) -> None:
    if incoming_sample_codes:
        placeholders = ", ".join(["%s"] * len(incoming_sample_codes))
        cursor.execute(
            f"DELETE FROM biz_sample WHERE remark LIKE %s AND sample_no NOT IN ({placeholders})",
            [f"{SAMPLE_META_PREFIX}%", *incoming_sample_codes],
        )
    else:
        cursor.execute("DELETE FROM biz_sample WHERE remark LIKE %s", (f"{SAMPLE_META_PREFIX}%",))


def build_sample_tray_write_state(
    managed_samples: list[dict[str, Any]],
) -> tuple[dict[str, str], Dict[str, dict[str, Any]], Dict[str, list[str]]]:
    sample_status_by_code = {
        normalize_text(sample.get("code")): normalize_text(sample.get("status"))
        for sample in managed_samples
        if normalize_text(sample.get("code"))
    }
    tray_defs: Dict[str, dict[str, Any]] = {}
    tray_order_by_sample: Dict[str, list[str]] = {}
    for sample in managed_samples:
        sample_code = normalize_text(sample.get("code"))
        task_code = normalize_text(sample.get("task_code"))
        for tray in sample.get("trays") or []:
            tray_code = normalize_text(tray.get("tray_code"))
            if not tray_code:
                continue
            tray_defs.setdefault(
                tray_code,
                {
                    "tray_no": tray_code,
                    "task_no": task_code,
                    "capacity": None,
                    "load_qty": 0,
                    "tray_status": "ACTIVE",
                    "test_state": normalize_text(tray.get("status")) or normalize_text(sample.get("status")),
                    "bind_time": parse_storage_datetime(tray.get("created_at")) or parse_storage_datetime(sample.get("updated_at")),
                    "remark": TRAY_META_PREFIX,
                    "target_lab": normalize_text(tray.get("target_lab") or tray.get("targetLab")),
                    "samples": [],
                },
            )
            target_lab = normalize_text(tray.get("target_lab") or tray.get("targetLab"))
            if target_lab:
                tray_defs[tray_code]["target_lab"] = target_lab
            quantity = parse_int_value(tray.get("quantity")) or 1
            tray_defs[tray_code]["samples"].append((sample_code, quantity, tray))
            tray_defs[tray_code]["load_qty"] += quantity
            tray_defs[tray_code]["capacity"] = max(tray_defs[tray_code]["capacity"] or 0, tray_defs[tray_code]["load_qty"])
            tray_order_by_sample.setdefault(sample_code, [])
            if tray_code not in tray_order_by_sample[sample_code]:
                tray_order_by_sample[sample_code].append(tray_code)
    return sample_status_by_code, tray_defs, tray_order_by_sample


def delete_missing_managed_trays(cursor, incoming_tray_codes: list[str]) -> None:
    if incoming_tray_codes:
        placeholders = ", ".join(["%s"] * len(incoming_tray_codes))
        cursor.execute(
            f"DELETE FROM biz_tray WHERE remark = %s AND tray_no NOT IN ({placeholders})",
            [TRAY_META_PREFIX, *incoming_tray_codes],
        )
    else:
        cursor.execute("DELETE FROM biz_tray WHERE remark = %s", (TRAY_META_PREFIX,))


def upsert_sample_rows(cursor, sample_rows: list[dict[str, Any]]) -> None:
    if not sample_rows:
        return
    task_nos = sorted({row["task_no"] for row in sample_rows if row["task_no"]})
    task_map: Dict[str, int] = {}
    if task_nos:
        placeholders = ", ".join(["%s"] * len(task_nos))
        cursor.execute(
            f"SELECT task_id, task_no FROM biz_task WHERE task_no IN ({placeholders})",
            task_nos,
        )
        task_map = {row["task_no"]: row["task_id"] for row in cursor.fetchall()}

    sample_upsert_rows = []
    for row in sample_rows:
        sample_upsert_rows.append(
            {
                **row,
                "task_id": task_map.get(row["task_no"]),
            }
        )
    cursor.executemany(
        """
        INSERT INTO biz_sample (
          sample_no, task_id, tray_id, sample_name, batch_no, sample_type, sample_spec, quantity, unit,
          sample_status, received_time, arrival_time, storage_condition, barcode_no, location_desc,
          flow_status, current_owner_id, remark, created_at, updated_at
        ) VALUES (
          %(sample_no)s, %(task_id)s, NULL, %(sample_name)s, %(batch_no)s, %(sample_type)s, %(sample_spec)s, %(quantity)s, %(unit)s,
          %(sample_status)s, %(received_time)s, %(arrival_time)s, %(storage_condition)s, %(barcode_no)s, %(location_desc)s,
          %(flow_status)s, NULL, %(remark)s, %(created_at)s, %(updated_at)s
        )
        ON DUPLICATE KEY UPDATE
          task_id = VALUES(task_id),
          tray_id = NULL,
          sample_name = VALUES(sample_name),
          batch_no = VALUES(batch_no),
          sample_type = VALUES(sample_type),
          sample_spec = VALUES(sample_spec),
          quantity = VALUES(quantity),
          unit = VALUES(unit),
          sample_status = VALUES(sample_status),
          received_time = VALUES(received_time),
          arrival_time = VALUES(arrival_time),
          storage_condition = VALUES(storage_condition),
          barcode_no = VALUES(barcode_no),
          location_desc = VALUES(location_desc),
          flow_status = VALUES(flow_status),
          current_owner_id = NULL,
          remark = VALUES(remark),
          updated_at = VALUES(updated_at)
        """,
        sample_upsert_rows,
    )


def load_sample_identity_maps(cursor, incoming_sample_codes: list[str]) -> tuple[dict[str, int], dict[str, int]]:
    if incoming_sample_codes:
        placeholders = ", ".join(["%s"] * len(incoming_sample_codes))
        cursor.execute(
            f"SELECT sample_id, sample_no, task_id FROM biz_sample WHERE sample_no IN ({placeholders})",
            incoming_sample_codes,
        )
        sample_id_rows = cursor.fetchall()
    else:
        sample_id_rows = []
    sample_id_map = {row["sample_no"]: row["sample_id"] for row in sample_id_rows}
    sample_task_id_map = {row["sample_no"]: row["task_id"] for row in sample_id_rows}
    return sample_id_map, sample_task_id_map


def upsert_tray_rows(cursor, tray_defs: Dict[str, dict[str, Any]], sample_task_id_map: dict[str, int]) -> None:
    if not tray_defs:
        return
    target_lab_names = sorted({tray["target_lab"] for tray in tray_defs.values() if tray.get("target_lab")})
    target_lab_id_by_name: Dict[str, int] = {}
    if target_lab_names:
        placeholders = ", ".join(["%s"] * len(target_lab_names))
        cursor.execute(
            f"""
            SELECT lab_id, lab_code, lab_name
            FROM md_lab
            WHERE COALESCE(status, 1) = 1
              AND (lab_name IN ({placeholders}) OR lab_code IN ({placeholders}))
            """,
            [*target_lab_names, *target_lab_names],
        )
        for row in cursor.fetchall():
            lab_id = row.get("lab_id")
            if lab_id is None:
                continue
            lab_name = normalize_text(row.get("lab_name"))
            lab_code = normalize_text(row.get("lab_code"))
            if lab_name:
                target_lab_id_by_name[lab_name] = lab_id
            if lab_code:
                target_lab_id_by_name[lab_code] = lab_id
    tray_upsert_rows = []
    for tray_code, tray in tray_defs.items():
        task_id = None
        if tray["task_no"]:
            task_id = next((sample_task_id_map.get(sample_code) for sample_code, _, _ in tray["samples"] if sample_task_id_map.get(sample_code)), None)
        current_lab_id = target_lab_id_by_name.get(normalize_text(tray.get("target_lab")))
        tray_upsert_rows.append(
            {
                "tray_no": tray_code,
                "task_id": task_id,
                "current_lab_id": current_lab_id,
                "tray_type": STORAGE_MARKER,
                "capacity": tray["capacity"] or tray["load_qty"],
                "load_qty": tray["load_qty"],
                "tray_status": tray["tray_status"],
                "test_state": tray["test_state"],
                "bind_time": tray["bind_time"],
                "remark": TRAY_META_PREFIX,
            }
        )
    cursor.executemany(
        """
        INSERT INTO biz_tray (
          tray_no, tray_type, task_id, current_temp_room_id, current_lab_id, current_equipment_id,
          temp_position_no, capacity, load_qty, tray_status, test_state, bind_time, in_temp_room_time,
          out_temp_room_time, current_barcode_id, unbind_time, last_barcode_print_time, current_owner_id,
          remark
        ) VALUES (
          %(tray_no)s, %(tray_type)s, %(task_id)s, NULL, %(current_lab_id)s, NULL,
          NULL, %(capacity)s, %(load_qty)s, %(tray_status)s, %(test_state)s, %(bind_time)s, NULL,
          NULL, NULL, NULL, NULL, NULL,
          %(remark)s
        )
        ON DUPLICATE KEY UPDATE
          tray_type = VALUES(tray_type),
          task_id = VALUES(task_id),
          current_lab_id = COALESCE(VALUES(current_lab_id), current_lab_id),
          capacity = VALUES(capacity),
          load_qty = VALUES(load_qty),
          tray_status = VALUES(tray_status),
          test_state = VALUES(test_state),
          bind_time = VALUES(bind_time),
          remark = VALUES(remark)
        """,
        tray_upsert_rows,
    )


def load_tray_id_map(cursor, incoming_tray_codes: list[str]) -> dict[str, int]:
    if incoming_tray_codes:
        placeholders = ", ".join(["%s"] * len(incoming_tray_codes))
        cursor.execute(
            f"SELECT tray_id, tray_no FROM biz_tray WHERE tray_no IN ({placeholders})",
            incoming_tray_codes,
        )
        tray_id_rows = cursor.fetchall()
    else:
        tray_id_rows = []
    return {row["tray_no"]: row["tray_id"] for row in tray_id_rows}


def build_tray_item_rows(
    tray_defs: Dict[str, dict[str, Any]],
    tray_id_map: dict[str, int],
    sample_id_map: dict[str, int],
    sample_status_by_code: dict[str, str],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    tray_item_rows = []
    sample_primary_tray_id: Dict[str, int] = {}
    for tray_code, tray in tray_defs.items():
        tray_id = tray_id_map.get(tray_code)
        if not tray_id:
            continue
        for index, (sample_code, quantity, tray_payload) in enumerate(tray["samples"], start=1):
            sample_id = sample_id_map.get(sample_code)
            if not sample_id:
                continue
            sample_primary_tray_id.setdefault(sample_code, tray_id)
            tray_item_rows.append(
                {
                    "tray_id": tray_id,
                    "sample_id": sample_id,
                    "position_no": f"P{index:02d}",
                    "quantity": quantity,
                    "bind_time": parse_storage_datetime(tray_payload.get("created_at")) or parse_storage_datetime(tray_payload.get("updated_at")),
                    "status": normalize_experiment_status_text(tray_payload.get("status")) or sample_status_by_code.get(sample_code) or "ACTIVE",
                    "created_at": parse_storage_datetime(tray_payload.get("created_at")),
                    "updated_at": parse_storage_datetime(tray_payload.get("updated_at")),
                }
            )
    return tray_item_rows, sample_primary_tray_id


def insert_tray_item_rows(cursor, tray_item_rows: list[dict[str, Any]]) -> None:
    if not tray_item_rows:
        return
    cursor.executemany(
        """
        INSERT INTO biz_tray_item (
          tray_id, sample_id, position_no, quantity, bind_time, unbind_time, status, created_at, updated_at
        ) VALUES (
          %(tray_id)s, %(sample_id)s, %(position_no)s, %(quantity)s, %(bind_time)s, NULL, %(status)s,
          COALESCE(%(created_at)s, CURRENT_TIMESTAMP), COALESCE(%(updated_at)s, CURRENT_TIMESTAMP)
        )
        """,
        tray_item_rows,
    )


def update_sample_primary_tray_ids(cursor, sample_primary_tray_id: dict[str, int]) -> None:
    if not sample_primary_tray_id:
        return
    cursor.executemany(
        "UPDATE biz_sample SET tray_id = %s WHERE sample_no = %s",
        [(tray_id, sample_no) for sample_no, tray_id in sample_primary_tray_id.items()],
    )


def replace_samples(cursor, samples: list[dict[str, Any]]) -> None:
    managed_samples, sample_rows, incoming_sample_codes = build_managed_sample_write_rows(samples)
    existing_sample_ids = load_existing_managed_sample_ids(cursor)
    existing_tray_ids = load_existing_managed_tray_ids(cursor)
    clear_existing_sample_links(cursor, existing_sample_ids, existing_tray_ids)
    delete_missing_managed_samples(cursor, incoming_sample_codes)
    sample_status_by_code, tray_defs, _tray_order_by_sample = build_sample_tray_write_state(managed_samples)

    incoming_tray_codes = sorted(tray_defs.keys())
    delete_missing_managed_trays(cursor, incoming_tray_codes)

    upsert_sample_rows(cursor, sample_rows)
    sample_id_map, sample_task_id_map = load_sample_identity_maps(cursor, incoming_sample_codes)

    upsert_tray_rows(cursor, tray_defs, sample_task_id_map)
    tray_id_map = load_tray_id_map(cursor, incoming_tray_codes)
    tray_item_rows, sample_primary_tray_id = build_tray_item_rows(
        tray_defs,
        tray_id_map,
        sample_id_map,
        sample_status_by_code,
    )
    insert_tray_item_rows(cursor, tray_item_rows)

    delete_managed_fixture_ready_events(cursor, managed_samples)
    insert_fixture_ready_events(cursor, build_fixture_ready_events(managed_samples))

    update_sample_primary_tray_ids(cursor, sample_primary_tray_id)

    insert_sample_history_event_rows(
        cursor,
        build_sample_history_event_rows(managed_samples, sample_id_map, sample_task_id_map),
    )


def delete_managed_fixture_ready_events(cursor, managed_samples: list[dict[str, Any]]) -> None:
    managed_task_nos = sorted(
        {
            normalize_text(sample.get("task_code"))
            for sample in managed_samples
            if normalize_text(sample.get("task_code"))
        }
    )
    if not managed_task_nos:
        return
    placeholders = ", ".join(["%s"] * len(managed_task_nos))
    cursor.execute(
        f"""
        DELETE FROM biz_experiment_event
        WHERE event_type = 'FIXTURE_READY'
          AND message_id LIKE %s
          AND task_no IN ({placeholders})
        """,
        [f"{FIXTURE_READY_COMPAT_MESSAGE_PREFIX}%", *managed_task_nos],
    )


def build_fixture_ready_events(managed_samples: list[dict[str, Any]]) -> Dict[tuple[str, str], dict[str, Any]]:
    fixture_ready_events: Dict[tuple[str, str], dict[str, Any]] = {}
    for sample in managed_samples:
        task_no = normalize_text(sample.get("task_code"))
        if not task_no:
            continue
        for tray in sample.get("trays") or []:
            if not parse_fixture_ready_flag(tray.get("fixture_ready", tray.get("fixtureReady"))):
                continue
            tray_code = normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))
            if not tray_code:
                continue
            experiment_no = normalize_text(
                tray.get("target_experiment_code")
                or tray.get("targetExperimentCode")
                or tray.get("experiment_code")
                or tray.get("experimentCode")
                or tray.get("experiment_no")
                or tray.get("experimentNo")
            )
            event_time = (
                parse_storage_datetime(tray.get("updated_at"))
                or parse_storage_datetime(sample.get("updated_at"))
                or current_beijing_datetime()
            )
            current = fixture_ready_events.get((task_no, tray_code))
            if current is None or event_time > current["event_time"]:
                fixture_ready_events[(task_no, tray_code)] = {
                    "event_time": event_time,
                    "experiment_no": experiment_no,
                    "tray_code": tray_code,
                }
    return fixture_ready_events


def insert_fixture_ready_events(cursor, fixture_ready_events: Dict[tuple[str, str], dict[str, Any]]) -> None:
    if not fixture_ready_events:
        return
    cursor.executemany(
        """
        INSERT INTO biz_experiment_event (
          event_type, task_no, experiment_no, lab_code, success_id, event_time,
          message_id, message_log_id, payload_json
        ) VALUES (
          'FIXTURE_READY', %(task_no)s, %(experiment_no)s, NULL, NULL, %(event_time)s,
          %(message_id)s, NULL, %(payload_json)s
        )
        ON DUPLICATE KEY UPDATE
          event_time = VALUES(event_time),
          payload_json = VALUES(payload_json)
        """,
        [
            {
                "task_no": task_no,
                "experiment_no": event["experiment_no"] or None,
                "event_time": event["event_time"],
                "message_id": f"{FIXTURE_READY_COMPAT_MESSAGE_PREFIX}{task_no}:{tray_code}",
                "payload_json": json.dumps(
                    {
                        "source": "frontend_fixture_countdown",
                        "taskNo": task_no,
                        "experimentNo": event["experiment_no"],
                        "experimentCode": event["experiment_no"],
                        "trayCode": tray_code,
                    },
                    ensure_ascii=False,
                ),
            }
            for (task_no, tray_code), event in fixture_ready_events.items()
        ],
    )


def build_sample_history_event_rows(
    managed_samples: list[dict[str, Any]],
    sample_id_map: dict[str, int],
    sample_task_id_map: dict[str, int],
) -> list[dict[str, Any]]:
    event_rows = []
    for sample in managed_samples:
        sample_no = normalize_text(sample.get("code"))
        sample_id = sample_id_map.get(sample_no)
        if not sample_id:
            continue
        task_id = sample_task_id_map.get(sample_no)
        for event in sample.get("history") or []:
            event_rows.append(
                {
                    "sample_id": sample_id,
                    "sample_no": sample_no,
                    "task_id": task_id,
                    "task_no": normalize_text(sample.get("task_code")),
                    "action_type": normalize_text(event.get("action")),
                    "location_desc": normalize_text(event.get("location")),
                    "owner_name": normalize_text(event.get("owner")),
                    "sample_status": normalize_experiment_status_text(event.get("status")),
                    "detail": normalize_experiment_detail_text(event.get("detail")),
                    "event_time": parse_storage_datetime(event.get("time")) or parse_storage_datetime(sample.get("updated_at")) or parse_storage_datetime(sample.get("created_at")),
                    "created_at": parse_storage_datetime(event.get("time")) or parse_storage_datetime(sample.get("updated_at")) or parse_storage_datetime(sample.get("created_at")),
                }
            )
    return event_rows


def insert_sample_history_event_rows(cursor, event_rows: list[dict[str, Any]]) -> None:
    if not event_rows:
        return
    cursor.executemany(
        """
        INSERT INTO biz_sample_event (
          sample_id, sample_no, task_id, task_no, action_type, location_desc,
          owner_name, sample_status, detail, event_time, created_at
        ) VALUES (
          %(sample_id)s, %(sample_no)s, %(task_id)s, %(task_no)s, %(action_type)s, %(location_desc)s,
          %(owner_name)s, %(sample_status)s, %(detail)s, %(event_time)s, %(created_at)s
        )
        """,
        event_rows,
    )
