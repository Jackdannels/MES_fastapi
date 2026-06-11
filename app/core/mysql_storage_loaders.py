from __future__ import annotations

from typing import Any

from app.core.mysql_storage_codecs import STORAGE_MARKER, TRAY_META_PREFIX, normalize_text
from app.core.mysql_storage_mappers import (
    build_storage_device_item,
    build_storage_experiment_item,
    build_storage_experiment_run_item,
    build_storage_experiment_run_tray_item,
    build_storage_experiment_sample_item,
    build_storage_experiment_tray_item,
    build_storage_schedule_item,
    build_storage_stream_item,
    build_storage_task_item,
    build_storage_task_tray_codes,
)


def load_tasks(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT t.task_no, tr.tray_no
        FROM biz_tray tr
        JOIN biz_task t ON t.task_id = tr.task_id
        WHERE tr.remark = %s AND t.source_system = %s
        ORDER BY tr.tray_no ASC
        """,
        (TRAY_META_PREFIX, STORAGE_MARKER),
    )
    tray_map = build_storage_task_tray_codes(cursor.fetchall())
    cursor.execute(
        """
        SELECT task_no, task_name, task_source_type, client_name, contact_name, contact_phone,
               priority, sample_count, tray_limit, sample_type, task_type, required_device, due_time,
               arrival_time, conditions_text, attachment_path, remark, task_status, transfer_status, created_at
        FROM biz_task
        WHERE source_system = %s
        ORDER BY created_at DESC, task_no DESC
        """,
        (STORAGE_MARKER,),
    )
    return [build_storage_task_item(row, tray_codes=tray_map.get(row["task_no"])) for row in cursor.fetchall()]


def load_schedules(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT s.schedule_no, s.task_no, s.experiment_no, s.device_name, s.lab_id, l.lab_code,
               s.schedule_start_time, s.schedule_end_time, s.planned_hours, s.schedule_status
        FROM biz_schedule s
        LEFT JOIN md_lab l
          ON l.lab_id = s.lab_id
        WHERE s.schedule_type = %s
        ORDER BY s.schedule_start_time DESC, s.schedule_no DESC
        """,
        (STORAGE_MARKER,),
    )
    return [build_storage_schedule_item(row) for row in cursor.fetchall()]


def load_experiments(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT experiment_no, task_no, experiment_name, required_device, priority,
               planned_hours, experiment_status, unscheduled_since, created_at, updated_at
        FROM biz_experiment
        ORDER BY task_no ASC, experiment_no ASC
        """
    )
    return [build_storage_experiment_item(row) for row in cursor.fetchall()]


def load_experiment_trays(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT relation_id, experiment_no, task_no, tray_no, created_at, updated_at
        FROM biz_experiment_tray
        ORDER BY task_no ASC, experiment_no ASC, tray_no ASC
        """
    )
    return [build_storage_experiment_tray_item(row) for row in cursor.fetchall()]


def load_experiment_samples(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT relation_id, experiment_no, task_no, sample_no, created_at, updated_at
        FROM biz_experiment_sample
        ORDER BY task_no ASC, experiment_no ASC, sample_no ASC
        """
    )
    return [build_storage_experiment_sample_item(row) for row in cursor.fetchall()]


def load_experiment_runs(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT run_no, tray_no
        FROM biz_experiment_run_tray
        ORDER BY run_no ASC, tray_no ASC
        """
    )
    tray_map: dict[str, list[str]] = {}
    for row in cursor.fetchall():
        run_no = normalize_text(row.get("run_no"))
        tray_no = normalize_text(row.get("tray_no"))
        if run_no and tray_no:
            tray_map.setdefault(run_no, []).append(tray_no)

    cursor.execute(
        """
        SELECT run_no, schedule_no, task_no, experiment_no, device_name, planned_hours,
               run_status, started_at, planned_end_at, ended_at, created_at, updated_at
        FROM biz_experiment_run
        ORDER BY started_at DESC, run_no DESC
        """
    )
    return [build_storage_experiment_run_item(row, tray_codes=tray_map.get(normalize_text(row.get("run_no")))) for row in cursor.fetchall()]


def load_experiment_run_trays(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT relation_id, run_no, task_no, experiment_no, tray_no, run_tray_status,
               started_at, ended_at, created_at, updated_at
        FROM biz_experiment_run_tray
        ORDER BY task_no ASC, experiment_no ASC, run_no ASC, tray_no ASC
        """
    )
    return [build_storage_experiment_run_tray_item(row) for row in cursor.fetchall()]


def load_devices(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT equipment_code, equipment_name, equipment_type, model_no, status,
               maintenance_start_at, maintenance_end_at, maintenance_type, maintenance_note,
               acquisition_enabled, next_calibration_date, location_desc, remark
        FROM md_equipment
        WHERE manufacturer = %s
        ORDER BY equipment_code ASC
        """,
        (STORAGE_MARKER,),
    )
    return [build_storage_device_item(row) for row in cursor.fetchall()]


def load_streams(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT stream_no, task_no, equipment_code, device_name, last_packet_time,
               quality_value, stream_status, reported_flag
        FROM biz_data_stream
        WHERE remark = %s
        ORDER BY last_packet_time DESC, stream_no DESC
        """,
        (STORAGE_MARKER,),
    )
    return [build_storage_stream_item(row) for row in cursor.fetchall()]
