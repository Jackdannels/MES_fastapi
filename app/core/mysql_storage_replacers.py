from __future__ import annotations

from typing import Any

from app.core.mysql_storage_codecs import STORAGE_MARKER, normalize_text
from app.core.mysql_storage_mappers import (
    build_device_insert_row,
    build_experiment_insert_row,
    build_experiment_run_insert_row,
    build_experiment_run_tray_insert_row,
    build_experiment_sample_insert_row,
    build_experiment_tray_insert_row,
    build_schedule_insert_row,
    build_stream_insert_row,
    build_task_insert_row,
)
from app.core.mysql_storage_snapshot import delete_missing_rows


def replace_experiment_trays(cursor, experiment_trays: list[dict[str, Any]]) -> None:
    rows = [build_experiment_tray_insert_row(relation) for relation in experiment_trays if normalize_text(relation.get("experiment_code"))]
    cursor.execute("DELETE FROM biz_experiment_tray")
    if not rows:
        return
    cursor.executemany(
        """
        INSERT INTO biz_experiment_tray (experiment_no, task_no, tray_no, created_at, updated_at)
        VALUES (%(experiment_no)s, %(task_no)s, %(tray_no)s, %(created_at)s, %(updated_at)s)
        """,
        rows,
    )


def replace_experiment_samples(cursor, experiment_samples: list[dict[str, Any]]) -> None:
    rows = [
        build_experiment_sample_insert_row(relation)
        for relation in experiment_samples
        if normalize_text(relation.get("experiment_code")) and normalize_text(relation.get("sample_code"))
    ]
    cursor.execute("DELETE FROM biz_experiment_sample")
    if not rows:
        return
    cursor.executemany(
        """
        INSERT INTO biz_experiment_sample (experiment_no, task_no, sample_no, created_at, updated_at)
        VALUES (%(experiment_no)s, %(task_no)s, %(sample_no)s, %(created_at)s, %(updated_at)s)
        """,
        rows,
    )


def replace_experiment_run_trays(cursor, experiment_run_trays: list[dict[str, Any]]) -> None:
    rows = [
        build_experiment_run_tray_insert_row(relation)
        for relation in experiment_run_trays
        if normalize_text(relation.get("run_no") or relation.get("runNo"))
        and normalize_text(relation.get("tray_code") or relation.get("tray_no"))
    ]
    cursor.execute("DELETE FROM biz_experiment_run_tray")
    if not rows:
        return
    cursor.executemany(
        """
        INSERT INTO biz_experiment_run_tray (
          run_no, task_no, experiment_no, tray_no, run_tray_status,
          started_at, ended_at, created_at, updated_at
        ) VALUES (
          %(run_no)s, %(task_no)s, %(experiment_no)s, %(tray_no)s, %(run_tray_status)s,
          %(started_at)s, %(ended_at)s, %(created_at)s, %(updated_at)s
        )
        ON DUPLICATE KEY UPDATE
          task_no = VALUES(task_no),
          experiment_no = VALUES(experiment_no),
          run_tray_status = VALUES(run_tray_status),
          started_at = VALUES(started_at),
          ended_at = VALUES(ended_at),
          updated_at = VALUES(updated_at)
        """,
        rows,
    )


def replace_experiments(cursor, experiments: list[dict[str, Any]]) -> None:
    rows = [build_experiment_insert_row(experiment) for experiment in experiments if normalize_text(experiment.get("experiment_code"))]
    cursor.execute("DELETE FROM biz_experiment")
    if not rows:
        return
    task_nos = sorted({row["task_no"] for row in rows if row["task_no"]})
    task_map: dict[str, int] = {}
    if task_nos:
        placeholders = ", ".join(["%s"] * len(task_nos))
        cursor.execute(
            f"SELECT task_id, task_no FROM biz_task WHERE task_no IN ({placeholders})",
            task_nos,
        )
        task_map = {row["task_no"]: row["task_id"] for row in cursor.fetchall()}
    cursor.executemany(
        """
        INSERT INTO biz_experiment (
          experiment_no, task_id, task_no, experiment_name, required_device, priority,
          planned_hours, experiment_status, unscheduled_since, created_at, updated_at
        ) VALUES (
          %(experiment_no)s, %(task_id)s, %(task_no)s, %(experiment_name)s, %(required_device)s, %(priority)s,
          %(planned_hours)s, %(experiment_status)s, %(unscheduled_since)s, %(created_at)s, %(updated_at)s
        )
        ON DUPLICATE KEY UPDATE
          task_id = VALUES(task_id),
          task_no = VALUES(task_no),
          experiment_name = VALUES(experiment_name),
          required_device = VALUES(required_device),
          priority = VALUES(priority),
          planned_hours = VALUES(planned_hours),
          experiment_status = VALUES(experiment_status),
          unscheduled_since = VALUES(unscheduled_since),
          updated_at = VALUES(updated_at)
        """,
        [{**row, "task_id": task_map.get(row["task_no"])} for row in rows],
    )


def replace_tasks(cursor, tasks: list[dict[str, Any]], *, prune: bool = True) -> None:
    rows = [build_task_insert_row(task) for task in tasks if normalize_text(task.get("code"))]
    if prune:
        delete_missing_rows(
            cursor,
            table_name="biz_task",
            marker_column="source_system",
            key_column="task_no",
            incoming_keys=[row["task_no"] for row in rows],
            marker_value=STORAGE_MARKER,
        )
    if not rows:
        return
    cursor.executemany(
        """
        INSERT INTO biz_task (
          task_no, task_source_type, source_system, task_name, client_name, contact_name, contact_phone,
          task_type, sample_type, priority, sample_count, tray_limit, task_status, transfer_status, arrival_time, due_time,
          required_device, conditions_text, attachment_path, remark, created_at, updated_at
        ) VALUES (
          %(task_no)s, %(task_source_type)s, %(source_system)s, %(task_name)s, %(client_name)s, %(contact_name)s, %(contact_phone)s,
          %(task_type)s, %(sample_type)s, %(priority)s, %(sample_count)s, %(tray_limit)s, %(task_status)s, %(transfer_status)s, %(arrival_time)s, %(due_time)s,
          %(required_device)s, %(conditions_text)s, %(attachment_path)s, %(remark)s, %(created_at)s, %(updated_at)s
        )
        ON DUPLICATE KEY UPDATE
          task_source_type = VALUES(task_source_type),
          source_system = VALUES(source_system),
          task_name = VALUES(task_name),
          client_name = VALUES(client_name),
          contact_name = VALUES(contact_name),
          contact_phone = VALUES(contact_phone),
          task_type = VALUES(task_type),
          sample_type = VALUES(sample_type),
          priority = VALUES(priority),
          sample_count = VALUES(sample_count),
          tray_limit = VALUES(tray_limit),
          task_status = VALUES(task_status),
          transfer_status = VALUES(transfer_status),
          arrival_time = VALUES(arrival_time),
          due_time = VALUES(due_time),
          required_device = VALUES(required_device),
          conditions_text = VALUES(conditions_text),
          attachment_path = VALUES(attachment_path),
          remark = VALUES(remark),
          updated_at = VALUES(updated_at)
        """,
        rows,
    )


def replace_schedules(cursor, schedules: list[dict[str, Any]]) -> None:
    rows = [build_schedule_insert_row(schedule) for schedule in schedules if normalize_text(schedule.get("id"))]
    delete_missing_rows(
        cursor,
        table_name="biz_schedule",
        marker_column="schedule_type",
        key_column="schedule_no",
        incoming_keys=[row["schedule_no"] for row in rows],
        marker_value=STORAGE_MARKER,
    )
    if not rows:
        return
    task_nos = sorted({row["task_no"] for row in rows if row["task_no"]})
    task_map: dict[str, int] = {}
    if task_nos:
        placeholders = ", ".join(["%s"] * len(task_nos))
        cursor.execute(
            f"SELECT task_id, task_no FROM biz_task WHERE task_no IN ({placeholders})",
            task_nos,
        )
        task_map = {row["task_no"]: row["task_id"] for row in cursor.fetchall()}
    lab_lookup_values = sorted({
        value
        for row in rows
        for value in (row.get("device_name"), row.get("lab_code"))
        if normalize_text(value)
    })
    lab_map: dict[str, int] = {}
    if lab_lookup_values:
        placeholders = ", ".join(["%s"] * len(lab_lookup_values))
        cursor.execute(
            f"""
            SELECT lab_id, lab_code, lab_name
            FROM md_lab
            WHERE COALESCE(status, 1) = 1
              AND (lab_name IN ({placeholders}) OR lab_code IN ({placeholders}))
            """,
            [*lab_lookup_values, *lab_lookup_values],
        )
        for row in cursor.fetchall():
            lab_id = row.get("lab_id")
            if lab_id is None:
                continue
            lab_name = normalize_text(row.get("lab_name"))
            lab_code = normalize_text(row.get("lab_code"))
            if lab_name:
                lab_map[lab_name] = lab_id
            if lab_code:
                lab_map[lab_code] = lab_id
    cursor.executemany(
        """
        INSERT INTO biz_schedule (
          schedule_no, task_id, task_no, experiment_no, schedule_type, lab_id, equipment_id, temp_room_id,
          device_name, schedule_start_time, schedule_end_time, planned_hours, schedule_status,
          is_retention, created_by, remark
        ) VALUES (
          %(schedule_no)s, %(task_id)s, %(task_no)s, %(experiment_no)s, %(schedule_type)s, %(lab_id)s, NULL, NULL,
          %(device_name)s, %(schedule_start_time)s, %(schedule_end_time)s, %(planned_hours)s, %(schedule_status)s,
          %(is_retention)s, NULL, %(remark)s
        )
        ON DUPLICATE KEY UPDATE
          task_id = VALUES(task_id),
          task_no = VALUES(task_no),
          experiment_no = VALUES(experiment_no),
          schedule_type = VALUES(schedule_type),
          lab_id = VALUES(lab_id),
          device_name = VALUES(device_name),
          schedule_start_time = VALUES(schedule_start_time),
          schedule_end_time = VALUES(schedule_end_time),
          planned_hours = VALUES(planned_hours),
          schedule_status = VALUES(schedule_status),
          is_retention = VALUES(is_retention),
          remark = VALUES(remark)
        """,
        [
            {
                **row,
                "task_id": task_map.get(row["task_no"]),
                "lab_id": lab_map.get(row.get("lab_code")) or row.get("lab_id") or lab_map.get(row["device_name"]),
            }
            for row in rows
        ],
    )


def replace_experiment_runs(cursor, experiment_runs: list[dict[str, Any]], *, replace_trays: bool = True) -> None:
    rows = [
        build_experiment_run_insert_row(run)
        for run in experiment_runs
        if normalize_text(run.get("run_no")) or normalize_text(run.get("id"))
    ]
    cursor.execute("DELETE FROM biz_experiment_run")
    if rows:
        cursor.executemany(
            """
            INSERT INTO biz_experiment_run (
              run_no, schedule_no, task_no, experiment_no, device_name, planned_hours,
              run_status, started_at, planned_end_at, ended_at, created_at, updated_at
            ) VALUES (
              %(run_no)s, %(schedule_no)s, %(task_no)s, %(experiment_no)s, %(device_name)s, %(planned_hours)s,
              %(run_status)s, %(started_at)s, %(planned_end_at)s, %(ended_at)s, %(created_at)s, %(updated_at)s
            )
            ON DUPLICATE KEY UPDATE
              schedule_no = VALUES(schedule_no),
              task_no = VALUES(task_no),
              experiment_no = VALUES(experiment_no),
              device_name = VALUES(device_name),
              planned_hours = VALUES(planned_hours),
              run_status = VALUES(run_status),
              started_at = VALUES(started_at),
              planned_end_at = VALUES(planned_end_at),
              ended_at = VALUES(ended_at),
              updated_at = VALUES(updated_at)
            """,
            rows,
        )


def replace_devices(cursor, devices: list[dict[str, Any]]) -> None:
    rows = [build_device_insert_row(device) for device in devices if normalize_text(device.get("code"))]
    delete_missing_rows(
        cursor,
        table_name="md_equipment",
        marker_column="manufacturer",
        key_column="equipment_code",
        incoming_keys=[row["equipment_code"] for row in rows],
        marker_value=STORAGE_MARKER,
    )
    if not rows:
        return
    cursor.executemany(
        """
        INSERT INTO md_equipment (
          equipment_code, equipment_name, equipment_type, test_type_id, lab_id, model_no,
          manufacturer, status, maintenance_start_at, maintenance_end_at, maintenance_type,
          maintenance_note, acquisition_enabled, next_calibration_date, manager_user_id,
          location_desc, remark
        ) VALUES (
          %(equipment_code)s, %(equipment_name)s, %(equipment_type)s, NULL, NULL, %(model_no)s,
          %(manufacturer)s, %(status)s, %(maintenance_start_at)s, %(maintenance_end_at)s,
          %(maintenance_type)s, %(maintenance_note)s, %(acquisition_enabled)s, %(next_calibration_date)s, NULL,
          %(location_desc)s, %(remark)s
        )
        ON DUPLICATE KEY UPDATE
          equipment_name = VALUES(equipment_name),
          equipment_type = VALUES(equipment_type),
          model_no = VALUES(model_no),
          manufacturer = VALUES(manufacturer),
          status = VALUES(status),
          maintenance_start_at = VALUES(maintenance_start_at),
          maintenance_end_at = VALUES(maintenance_end_at),
          maintenance_type = VALUES(maintenance_type),
          maintenance_note = VALUES(maintenance_note),
          acquisition_enabled = VALUES(acquisition_enabled),
          next_calibration_date = VALUES(next_calibration_date),
          location_desc = VALUES(location_desc),
          remark = VALUES(remark)
        """,
        rows,
    )


def replace_streams(cursor, streams: list[dict[str, Any]]) -> None:
    rows = [build_stream_insert_row(stream) for stream in streams if normalize_text(stream.get("id"))]
    delete_missing_rows(
        cursor,
        table_name="biz_data_stream",
        marker_column="remark",
        key_column="stream_no",
        incoming_keys=[row["stream_no"] for row in rows],
        marker_value=STORAGE_MARKER,
    )
    if not rows:
        return
    cursor.executemany(
        """
        INSERT INTO biz_data_stream (
          stream_no, task_id, task_no, equipment_id, equipment_code, device_name,
          last_packet_time, quality_value, stream_status, reported_flag, remark
        ) VALUES (
          %(stream_no)s, NULL, %(task_no)s, NULL, %(equipment_code)s, %(device_name)s,
          %(last_packet_time)s, %(quality_value)s, %(stream_status)s, %(reported_flag)s, %(remark)s
        )
        ON DUPLICATE KEY UPDATE
          task_no = VALUES(task_no),
          equipment_code = VALUES(equipment_code),
          device_name = VALUES(device_name),
          last_packet_time = VALUES(last_packet_time),
          quality_value = VALUES(quality_value),
          stream_status = VALUES(stream_status),
          reported_flag = VALUES(reported_flag),
          remark = VALUES(remark)
        """,
        rows,
    )
