from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from typing import Any, Protocol

from app.db.session import get_connection
from app.services.laboratory_completion import (
    COMPLETED_STATUS,
    COMPLETION_ACTION,
    experiment_trays_are_completed,
    completion_history_detail,
)


PROTOCOL_NAME = "MES_LAB_MQTT"
ACK_MESSAGE_TYPE = "EVENT_ACK"

EVENT_TYPES = {
    "FIXTURE_READY",
    "EXPERIMENT_STARTED",
    "EXPERIMENT_ENDED",
    "EXPERIMENT_RESULT",
}
EVENT_TYPE_BY_TOPIC_SUFFIX = {
    "fixture-ready": "FIXTURE_READY",
    "experiment-started": "EXPERIMENT_STARTED",
    "experiment-ended": "EXPERIMENT_ENDED",
    "experiment-result": "EXPERIMENT_RESULT",
}
EVENT_TIME_KEYS = {
    "FIXTURE_READY": ("fixture_ready_at",),
    "EXPERIMENT_STARTED": ("started_at",),
    "EXPERIMENT_ENDED": ("ended_at",),
    "EXPERIMENT_RESULT": ("result_at",),
}
BEIJING_TZ = timezone(timedelta(hours=8))


class MqEventRepository(Protocol):
    def message_exists(self, message_id: str) -> bool: ...

    def record_message(self, message: dict[str, Any]) -> int: ...

    def record_event(self, event: dict[str, Any]) -> None: ...

    def record_result(self, result: dict[str, Any]) -> None: ...

    def mark_experiment_started(self, task_no: str, experiment_no: str, occurred_at: str) -> None: ...

    def mark_experiment_ended(self, task_no: str, experiment_no: str, occurred_at: str) -> None: ...

    def find_active_run_by_lab(self, lab_code: str) -> dict[str, Any] | None: ...

    def find_current_context_by_lab(self, lab_code: str, candidate_statuses: list[str]) -> dict[str, Any] | None: ...

    def start_run_for_context(self, context: dict[str, Any], occurred_at: str) -> dict[str, Any]: ...

    def mark_run_started(self, run_no: str, occurred_at: str) -> None: ...

    def mark_run_ended(self, run_no: str, occurred_at: str) -> None: ...


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def now_iso() -> str:
    return datetime.now(BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S")


def build_ack(correlation_id: str, status: str, error_code: str = "", error_message: str = "") -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_NAME,
        "version": "2.0",
        "message_type": ACK_MESSAGE_TYPE,
        "message_id": f"MES-ACK-{correlation_id}" if correlation_id else "",
        "correlation_id": correlation_id,
        "status": status,
        "error_code": error_code,
        "error_message": error_message,
        "processed_at": now_iso(),
    }


def require_text(payload: dict[str, Any], key: str) -> str:
    value = normalize_text(payload.get(key))
    if not value:
        raise ValueError(f"{key} is required")
    return value


def event_type_from_topic(topic: str) -> str:
    suffix = normalize_text(topic).rstrip("/").split("/")[-1]
    return EVENT_TYPE_BY_TOPIC_SUFFIX.get(suffix, "")


def topic_lab_code(topic: str) -> str:
    parts = [part for part in normalize_text(topic).split("/") if part]
    for index, part in enumerate(parts):
        if part == "labs" and index + 1 < len(parts):
            return parts[index + 1]
    return ""


def first_text(payload: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = normalize_text(payload.get(key))
        if value:
            return value
    return ""


def event_time(payload: dict[str, Any], message_type: str) -> str:
    return first_text(payload, *EVENT_TIME_KEYS.get(message_type, ())) or now_iso()


def generated_message_id(message_type: str, lab_code: str, occurred_at: str) -> str:
    return f"HOST-{message_type}-{lab_code}-{occurred_at}"


def parse_beijing_datetime(value: Any) -> datetime | None:
    normalized = normalize_text(value)
    if not normalized:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(BEIJING_TZ).replace(tzinfo=None)
    return parsed


def mysql_datetime_text(value: Any) -> str:
    parsed = parse_beijing_datetime(value)
    if parsed is not None:
        return parsed.strftime("%Y-%m-%d %H:%M:%S")
    return normalize_text(value)


def parse_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def cursor_rows_as_dicts(cursor: Any) -> list[dict[str, Any]]:
    rows = cursor.fetchall()
    if not rows:
        return []
    first = rows[0]
    if isinstance(first, dict):
        return [dict(row) for row in rows]
    columns = [column[0] for column in (cursor.description or [])]
    return [dict(zip(columns, row)) for row in rows]


def cursor_row_as_dict(cursor: Any) -> dict[str, Any] | None:
    row = cursor.fetchone()
    if not row:
        return None
    if isinstance(row, dict):
        return dict(row)
    columns = [column[0] for column in (cursor.description or [])]
    return dict(zip(columns, row))


def publish_realtime_update() -> None:
    try:
        from app.api.routes.storage import publish_storage_update
    except Exception:
        return
    publish_storage_update([
        "mes.experiments",
        "mes.experiment_runs",
        "mes.samples",
        "mes.schedules",
    ])


class MySQLMqEventRepository:
    def lab_candidates(self, cursor: Any, lab_code: str) -> list[str]:
        normalized_lab_code = normalize_text(lab_code)
        if not normalized_lab_code:
            return []
        cursor.execute(
            """
            SELECT lab_name
            FROM md_lab
            WHERE lab_code = %s
            LIMIT 1
            """,
            (normalized_lab_code,),
        )
        lab_row = cursor.fetchone() or {}
        lab_name = normalize_text(lab_row.get("lab_name") if isinstance(lab_row, dict) else lab_row[0] if lab_row else "")
        candidates = [normalized_lab_code]
        if lab_name and lab_name not in candidates:
            candidates.append(lab_name)
        return candidates

    def message_exists(self, message_id: str) -> bool:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1 FROM biz_mq_message_log WHERE message_id = %s LIMIT 1", (message_id,))
                return cursor.fetchone() is not None

    def record_message(self, message: dict[str, Any]) -> int:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO biz_mq_message_log (
                      message_id, direction, topic, message_type, correlation_id, lab_code,
                      task_no, experiment_no, qos, retain_flag, payload_json, process_status,
                      error_code, error_message, received_at, processed_at
                    ) VALUES (
                      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                    )
                    """,
                    (
                        message.get("message_id"),
                        message.get("direction"),
                        message.get("topic"),
                        message.get("message_type"),
                        message.get("correlation_id"),
                        message.get("lab_code"),
                        message.get("task_no"),
                        message.get("experiment_no"),
                        message.get("qos"),
                        1 if message.get("retain_flag") else 0,
                        json.dumps(message.get("payload") or {}, ensure_ascii=False),
                        message.get("process_status"),
                        message.get("error_code"),
                        message.get("error_message"),
                    ),
                )
                message_log_id = int(cursor.lastrowid or 0)
            connection.commit()
        return message_log_id

    def record_event(self, event: dict[str, Any]) -> None:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO biz_experiment_event (
                      event_type, task_no, experiment_no, lab_code, success_id,
                      event_time, message_id, message_log_id, payload_json
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        event.get("event_type"),
                        event.get("task_no"),
                        event.get("experiment_no") or None,
                        event.get("lab_code") or None,
                        event.get("success_id") or None,
                        event.get("event_time") or None,
                        event.get("message_id") or None,
                        event.get("message_log_id") or None,
                        json.dumps(event.get("payload") or {}, ensure_ascii=False),
                    ),
                )
            connection.commit()

    def record_result(self, result: dict[str, Any]) -> None:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO biz_experiment_result (
                      task_no, experiment_no, lab_code, result_time, conclusion, summary,
                      result_payload_json, message_id, message_log_id, status
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        result.get("task_no"),
                        result.get("experiment_no"),
                        result.get("lab_code") or None,
                        result.get("result_time"),
                        result.get("conclusion") or None,
                        result.get("summary") or None,
                        json.dumps(result.get("result_payload") or {}, ensure_ascii=False),
                        result.get("message_id") or None,
                        result.get("message_log_id") or None,
                        result.get("status") or "RECEIVED",
                    ),
                )
            connection.commit()

    def mark_experiment_started(self, task_no: str, experiment_no: str, occurred_at: str) -> None:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE biz_experiment
                    SET actual_start_time = %s,
                        experiment_status = '实验进行中',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE task_no = %s AND experiment_no = %s
                    """,
                    (occurred_at, task_no, experiment_no),
                )
            connection.commit()

    def mark_experiment_ended(self, task_no: str, experiment_no: str, occurred_at: str) -> None:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE biz_experiment
                    SET actual_end_time = %s,
                        experiment_status = '实验已完成',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE task_no = %s AND experiment_no = %s
                    """,
                    (occurred_at, task_no, experiment_no),
                )
            connection.commit()

    def find_active_run_by_lab(self, lab_code: str) -> dict[str, Any] | None:
        normalized_lab_code = normalize_text(lab_code)
        if not normalized_lab_code:
            return None
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                      er.run_no,
                      er.task_no,
                      er.experiment_no,
                      er.device_name,
                      er.run_status
                    FROM biz_experiment_run er
                    JOIN biz_experiment_run_tray ert
                      ON ert.run_no = er.run_no
                    JOIN biz_tray tr
                      ON tr.tray_no = ert.tray_no
                    JOIN md_lab lab
                      ON lab.lab_id = tr.current_lab_id
                    WHERE lab.lab_code = %s
                      AND COALESCE(er.run_status, '') <> '实验已完成'
                    ORDER BY
                      CASE WHEN er.run_status = '实验进行中' THEN 0 ELSE 1 END,
                      er.started_at DESC,
                      er.created_at DESC,
                      er.run_no DESC
                    LIMIT 1
                    """,
                    (normalized_lab_code,),
                )
                row = cursor_row_as_dict(cursor)
        return row

    def find_current_context_by_lab(self, lab_code: str, candidate_statuses: list[str]) -> dict[str, Any] | None:
        statuses = [normalize_text(status) for status in candidate_statuses if normalize_text(status)]
        if not statuses:
            return None
        with get_connection() as connection:
            with connection.cursor() as cursor:
                lab_candidates = self.lab_candidates(cursor, lab_code)
                if not lab_candidates:
                    return None
                cursor.execute(
                    """
                    SELECT task_no, experiment_no, payload_json
                    FROM biz_mq_message_log
                    WHERE direction = 'MES_TO_HOST'
                      AND lab_code = %s
                      AND message_type IN ('INSTALL_FIXTURE', 'READY')
                    ORDER BY created_at DESC, message_log_id DESC
                    LIMIT 1
                    """,
                    (normalize_text(lab_code),),
                )
                command_rows = cursor_rows_as_dicts(cursor)
                command_row = command_rows[0] if command_rows else {}
                task_no = normalize_text(command_row.get("task_no"))
                command_experiment_no = normalize_text(command_row.get("experiment_no"))
                if not task_no:
                    payload_json = command_row.get("payload_json")
                    try:
                        command_payload = json.loads(payload_json) if isinstance(payload_json, str) else payload_json if isinstance(payload_json, dict) else {}
                    except json.JSONDecodeError:
                        command_payload = {}
                    task_no = normalize_text(command_payload.get("task_code"))
                    command_experiment_no = command_experiment_no or normalize_text(command_payload.get("experiment_code"))
                if not task_no:
                    return None

                status_placeholders = ", ".join(["%s"] * len(statuses))
                cursor.execute(
                    f"""
                    SELECT
                      tr.tray_no,
                      sm.sample_no,
                      sm.location_desc,
                      tr.current_lab_id
                    FROM biz_tray tr
                    JOIN biz_tray_item ti
                      ON ti.tray_id = tr.tray_id
                    JOIN biz_sample sm
                      ON sm.sample_id = ti.sample_id
                    JOIN biz_task task
                      ON task.task_id = sm.task_id
                    LEFT JOIN md_lab lab
                      ON lab.lab_id = tr.current_lab_id
                    WHERE task.task_no = %s
                      AND (
                        ti.status IN ({status_placeholders})
                        OR sm.sample_status IN ({status_placeholders})
                        OR sm.flow_status IN ({status_placeholders})
                        OR tr.test_state IN ({status_placeholders})
                      )
                      AND lab.lab_code = %s
                    ORDER BY tr.tray_no ASC, sm.sample_no ASC
                    """,
                    [
                        task_no,
                        *statuses,
                        *statuses,
                        *statuses,
                        *statuses,
                        normalize_text(lab_code),
                    ],
                )
                tray_sample_rows = cursor_rows_as_dicts(cursor)
                tray_nos = []
                sample_nos = []
                location_names = []
                for row in tray_sample_rows:
                    tray_no = normalize_text(row.get("tray_no"))
                    sample_no = normalize_text(row.get("sample_no"))
                    location_name = normalize_text(row.get("location_desc"))
                    if tray_no and tray_no not in tray_nos:
                        tray_nos.append(tray_no)
                    if sample_no and sample_no not in sample_nos:
                        sample_nos.append(sample_no)
                    if location_name and location_name not in location_names:
                        location_names.append(location_name)
                if not tray_nos:
                    return None

                schedule_params = [task_no]
                schedule_filters = ["s.task_no = %s", "COALESCE(s.schedule_status, '') NOT IN ('实验已完成', '实验完成', '实验已经完成')"]
                if command_experiment_no:
                    schedule_filters.append("s.experiment_no = %s")
                    schedule_params.append(command_experiment_no)
                device_names = []
                for candidate in [*lab_candidates, *location_names]:
                    if candidate and candidate not in device_names:
                        device_names.append(candidate)
                if device_names:
                    device_placeholders = ", ".join(["%s"] * len(device_names))
                    schedule_filters.append(f"s.device_name IN ({device_placeholders})")
                    schedule_params.extend(device_names)
                tray_placeholders = ", ".join(["%s"] * len(tray_nos))
                cursor.execute(
                    f"""
                    SELECT
                      s.schedule_no,
                      s.task_no,
                      s.experiment_no,
                      s.device_name,
                      s.planned_hours,
                      s.schedule_end_time
                    FROM biz_schedule s
                    JOIN biz_experiment_tray et
                      ON et.task_no = s.task_no AND et.experiment_no = s.experiment_no
                    WHERE {" AND ".join(schedule_filters)}
                      AND et.tray_no IN ({tray_placeholders})
                    ORDER BY s.schedule_start_time DESC, s.schedule_no DESC
                    """,
                    [*schedule_params, *tray_nos],
                )
                rows = cursor_rows_as_dicts(cursor)
        if not rows:
            return None

        contexts: dict[tuple[str, str, str, str], dict[str, Any]] = {}
        for row in rows:
            task_no = normalize_text(row.get("task_no"))
            experiment_no = normalize_text(row.get("experiment_no"))
            schedule_no = normalize_text(row.get("schedule_no"))
            device_name = normalize_text(row.get("device_name"))
            if not task_no or not experiment_no:
                continue
            key = (task_no, experiment_no, schedule_no, device_name)
            context = contexts.setdefault(
                key,
                {
                    "task_no": task_no,
                    "experiment_no": experiment_no,
                    "schedule_no": schedule_no,
                    "device_name": device_name,
                    "planned_hours": row.get("planned_hours"),
                    "schedule_end_time": row.get("schedule_end_time"),
                    "tray_nos": list(tray_nos),
                    "sample_nos": list(sample_nos),
                },
            )

        if not contexts:
            return None
        if len(contexts) > 1:
            raise ValueError(f"multiple experiment contexts found for lab_code: {lab_code}")
        return next(iter(contexts.values()))

    def start_run_for_context(self, context: dict[str, Any], occurred_at: str) -> dict[str, Any]:
        task_no = normalize_text(context.get("task_no"))
        experiment_no = normalize_text(context.get("experiment_no"))
        device_name = normalize_text(context.get("device_name"))
        schedule_no = normalize_text(context.get("schedule_no"))
        tray_nos = [normalize_text(tray_no) for tray_no in context.get("tray_nos") or [] if normalize_text(tray_no)]
        sample_nos = [normalize_text(sample_no) for sample_no in context.get("sample_nos") or [] if normalize_text(sample_no)]
        if not task_no or not experiment_no or not tray_nos:
            raise ValueError("ready experiment context is incomplete")

        started_at = mysql_datetime_text(occurred_at)
        started_dt = parse_beijing_datetime(started_at)
        planned_hours = parse_float(context.get("planned_hours"))
        planned_end_at = mysql_datetime_text(context.get("schedule_end_time"))
        if not planned_end_at and started_dt is not None and planned_hours > 0:
            planned_end_at = (started_dt + timedelta(hours=planned_hours)).strftime("%Y-%m-%d %H:%M:%S")
        run_no = f"run-{datetime.now(BEIJING_TZ).strftime('%Y%m%d%H%M%S%f')}"

        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO biz_experiment_run (
                      run_no, schedule_no, task_no, experiment_no, device_name,
                      planned_hours, run_status, started_at, planned_end_at, ended_at,
                      created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, '实验进行中', %s, %s, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON DUPLICATE KEY UPDATE
                      run_status = '实验进行中',
                      started_at = COALESCE(started_at, VALUES(started_at)),
                      planned_end_at = VALUES(planned_end_at),
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (run_no, schedule_no, task_no, experiment_no, device_name, planned_hours or None, started_at, planned_end_at or None),
                )
                tray_rows = [
                    (run_no, task_no, experiment_no, tray_no, started_at)
                    for tray_no in tray_nos
                ]
                cursor.executemany(
                    """
                    INSERT INTO biz_experiment_run_tray (
                      run_no, task_no, experiment_no, tray_no, run_tray_status,
                      started_at, ended_at, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, '实验进行中', %s, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON DUPLICATE KEY UPDATE
                      run_tray_status = '实验进行中',
                      started_at = COALESCE(started_at, VALUES(started_at)),
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    tray_rows,
                )
                tray_placeholders = ", ".join(["%s"] * len(tray_nos))
                cursor.execute(
                    f"""
                    UPDATE biz_tray_item ti
                    JOIN biz_tray tr ON tr.tray_id = ti.tray_id
                    JOIN biz_sample sm ON sm.sample_id = ti.sample_id
                    LEFT JOIN biz_task task ON task.task_id = sm.task_id
                    SET ti.status = '实验进行中',
                        ti.updated_at = CURRENT_TIMESTAMP
                    WHERE tr.tray_no IN ({tray_placeholders})
                      AND (task.task_no = %s OR task.task_no IS NULL)
                    """,
                    [*tray_nos, task_no],
                )
                cursor.execute(
                    f"""
                    UPDATE biz_tray
                    SET test_state = '实验进行中',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE tray_no IN ({tray_placeholders})
                    """,
                    tray_nos,
                )
                if sample_nos:
                    sample_placeholders = ", ".join(["%s"] * len(sample_nos))
                    cursor.execute(
                        f"""
                        UPDATE biz_sample sm
                        LEFT JOIN biz_task task ON task.task_id = sm.task_id
                        SET sm.sample_status = '实验进行中',
                            sm.flow_status = '实验进行中',
                            sm.updated_at = CURRENT_TIMESTAMP
                        WHERE sm.sample_no IN ({sample_placeholders})
                          AND (task.task_no = %s OR task.task_no IS NULL)
                        """,
                        [*sample_nos, task_no],
                    )
                    cursor.execute(
                        f"""
                        SELECT sm.sample_id, sm.sample_no, task.task_id
                        FROM biz_sample sm
                        LEFT JOIN biz_task task ON task.task_id = sm.task_id
                        WHERE sm.sample_no IN ({sample_placeholders})
                        """,
                        sample_nos,
                    )
                    sample_rows = cursor_rows_as_dicts(cursor)
                    event_rows = [
                        (
                            row.get("sample_id"),
                            row.get("sample_no"),
                            row.get("task_id"),
                            task_no,
                            "开始实验",
                            device_name,
                            "实验进行中",
                            f"{task_no} / {experiment_no} / 实验进行中 / 托盘：{'、'.join(tray_nos)}",
                            started_at,
                        )
                        for row in sample_rows
                        if row.get("sample_id")
                    ]
                    if event_rows:
                        cursor.executemany(
                            """
                            INSERT INTO biz_sample_event (
                              sample_id, sample_no, task_id, task_no, action_type,
                              location_desc, owner_name, sample_status, detail, event_time, created_at
                            ) VALUES (%s, %s, %s, %s, %s, %s, NULL, %s, %s, %s, CURRENT_TIMESTAMP)
                            """,
                            event_rows,
                        )
                cursor.execute(
                    """
                    UPDATE biz_task
                    SET task_status = '任务进行中',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE task_no = %s
                    """,
                    (task_no,),
                )
                cursor.execute(
                    """
                    UPDATE biz_schedule
                    SET schedule_status = '实验进行中',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE task_no = %s AND experiment_no = %s AND (%s = '' OR schedule_no = %s)
                    """,
                    (task_no, experiment_no, schedule_no, schedule_no),
                )
                cursor.execute(
                    """
                    UPDATE biz_experiment
                    SET actual_start_time = %s,
                        experiment_status = '实验进行中',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE task_no = %s AND experiment_no = %s
                    """,
                    (started_at, task_no, experiment_no),
                )
            connection.commit()
        return {
            "run_no": run_no,
            "task_no": task_no,
            "experiment_no": experiment_no,
            "device_name": device_name,
            "run_status": "实验进行中",
        }

    def mark_run_started(self, run_no: str, occurred_at: str) -> None:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE biz_experiment_run
                    SET run_status = '实验进行中',
                        started_at = COALESCE(started_at, %s),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE run_no = %s
                    """,
                    (occurred_at, run_no),
                )
                cursor.execute(
                    """
                    UPDATE biz_experiment_run_tray
                    SET run_tray_status = '实验进行中',
                        started_at = COALESCE(started_at, %s),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE run_no = %s
                    """,
                    (occurred_at, run_no),
                )
            connection.commit()

    def mark_run_ended(self, run_no: str, occurred_at: str) -> None:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT task_no, experiment_no
                    FROM biz_experiment_run
                    WHERE run_no = %s
                    LIMIT 1
                    """,
                    (run_no,),
                )
                row = cursor.fetchone() or {}
                cursor.execute(
                    """
                    SELECT tray_no
                    FROM biz_experiment_run_tray
                    WHERE run_no = %s
                    ORDER BY tray_no ASC
                    """,
                    (run_no,),
                )
                tray_rows = cursor_rows_as_dicts(cursor)
                tray_nos = [normalize_text(item.get("tray_no")) for item in tray_rows if normalize_text(item.get("tray_no"))]
                cursor.execute(
                    """
                    UPDATE biz_experiment_run
                    SET run_status = '实验已完成',
                        ended_at = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE run_no = %s
                    """,
                    (occurred_at, run_no),
                )
                cursor.execute(
                    """
                    UPDATE biz_experiment_run_tray
                    SET run_tray_status = '实验已完成',
                        ended_at = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE run_no = %s
                    """,
                    (occurred_at, run_no),
                )
                task_no = normalize_text(row.get("task_no") if isinstance(row, dict) else row[0] if row else "")
                experiment_no = normalize_text(row.get("experiment_no") if isinstance(row, dict) else row[1] if row else "")
                all_experiment_trays_completed = False
                if task_no and experiment_no:
                    cursor.execute(
                        """
                        SELECT tray_no
                        FROM biz_experiment_tray
                        WHERE task_no = %s AND experiment_no = %s
                        ORDER BY tray_no ASC
                        """,
                        (task_no, experiment_no),
                    )
                    scoped_rows = cursor_rows_as_dicts(cursor)
                    scoped_tray_nos = {
                        normalize_text(item.get("tray_no"))
                        for item in scoped_rows
                        if normalize_text(item.get("tray_no"))
                    }
                    cursor.execute(
                        """
                        SELECT DISTINCT tray_no
                        FROM biz_experiment_run_tray
                        WHERE task_no = %s
                          AND experiment_no = %s
                          AND run_tray_status IN ('实验已完成', '实验完成', '实验已经完成', '放置实验后暂存间', '厂家收回', '已到达暂存间')
                        ORDER BY tray_no ASC
                        """,
                        (task_no, experiment_no),
                    )
                    completed_rows = cursor_rows_as_dicts(cursor)
                    completed_tray_nos = {
                        normalize_text(item.get("tray_no"))
                        for item in completed_rows
                        if normalize_text(item.get("tray_no"))
                    }
                    all_experiment_trays_completed = experiment_trays_are_completed(scoped_tray_nos, completed_tray_nos)
                if all_experiment_trays_completed:
                    cursor.execute(
                        """
                        UPDATE biz_experiment
                        SET actual_end_time = %s,
                            experiment_status = '实验已完成',
                            updated_at = CURRENT_TIMESTAMP
                        WHERE task_no = %s AND experiment_no = %s
                        """,
                        (occurred_at, task_no, experiment_no),
                    )
                    cursor.execute(
                        """
                        UPDATE biz_schedule
                        SET schedule_status = '实验已完成',
                            updated_at = CURRENT_TIMESTAMP
                        WHERE task_no = %s AND experiment_no = %s
                        """,
                        (task_no, experiment_no),
                    )
                if task_no and tray_nos:
                    tray_placeholders = ", ".join(["%s"] * len(tray_nos))
                    cursor.execute(
                        f"""
                        UPDATE biz_tray_item ti
                        JOIN biz_tray tr ON tr.tray_id = ti.tray_id
                        JOIN biz_sample sm ON sm.sample_id = ti.sample_id
                        LEFT JOIN biz_task task ON task.task_id = sm.task_id
                        SET ti.status = '实验已完成',
                            ti.updated_at = CURRENT_TIMESTAMP
                        WHERE tr.tray_no IN ({tray_placeholders})
                          AND (task.task_no = %s OR task.task_no IS NULL)
                        """,
                        [*tray_nos, task_no],
                    )
                    cursor.execute(
                        f"""
                        UPDATE biz_tray
                        SET test_state = '实验已完成',
                            updated_at = CURRENT_TIMESTAMP
                        WHERE tray_no IN ({tray_placeholders})
                        """,
                        tray_nos,
                    )
                    cursor.execute(
                        f"""
                        UPDATE biz_sample sm
                        JOIN biz_tray_item ti ON ti.sample_id = sm.sample_id
                        JOIN biz_tray tr ON tr.tray_id = ti.tray_id
                        LEFT JOIN biz_task task ON task.task_id = sm.task_id
                        SET sm.sample_status = '实验已完成',
                            sm.flow_status = '实验已完成',
                            sm.updated_at = CURRENT_TIMESTAMP
                        WHERE tr.tray_no IN ({tray_placeholders})
                          AND (task.task_no = %s OR task.task_no IS NULL)
                        """,
                        [*tray_nos, task_no],
                    )
                    cursor.execute(
                        f"""
                        SELECT DISTINCT
                          sm.sample_id,
                          sm.sample_no,
                          task.task_id,
                          COALESCE(exp.experiment_name, exp.experiment_no, %s) AS experiment_name
                        FROM biz_sample sm
                        JOIN biz_tray_item ti ON ti.sample_id = sm.sample_id
                        JOIN biz_tray tr ON tr.tray_id = ti.tray_id
                        LEFT JOIN biz_task task ON task.task_id = sm.task_id
                        LEFT JOIN biz_experiment exp
                          ON exp.task_no = %s AND exp.experiment_no = %s
                        WHERE tr.tray_no IN ({tray_placeholders})
                          AND (task.task_no = %s OR task.task_no IS NULL)
                        ORDER BY sm.sample_no ASC
                        """,
                        [experiment_no, task_no, experiment_no, *tray_nos, task_no],
                    )
                    sample_rows = cursor_rows_as_dicts(cursor)
                    event_rows = [
                        {
                            "sample_id": row.get("sample_id"),
                            "sample_no": normalize_text(row.get("sample_no")),
                            "task_id": row.get("task_id"),
                            "task_no": task_no,
                            "action_type": COMPLETION_ACTION,
                            "sample_status": COMPLETED_STATUS,
                            "detail": completion_history_detail(task_no, normalize_text(row.get("experiment_name")) or experiment_no),
                            "event_time": occurred_at,
                        }
                        for row in sample_rows
                        if row.get("sample_id") and normalize_text(row.get("sample_no"))
                    ]
                    if event_rows:
                        cursor.executemany(
                            """
                            INSERT INTO biz_sample_event (
                              sample_id, sample_no, task_id, task_no, action_type,
                              location_desc, owner_name, sample_status, detail, event_time, created_at
                            ) VALUES (
                              %(sample_id)s, %(sample_no)s, %(task_id)s, %(task_no)s, %(action_type)s,
                              NULL, NULL, %(sample_status)s, %(detail)s, %(event_time)s, CURRENT_TIMESTAMP
                            )
                            """,
                            event_rows,
                        )
            connection.commit()


def process_laboratory_event(
    topic: str,
    payload: dict[str, Any],
    *,
    repository: MqEventRepository | None = None,
) -> dict[str, Any]:
    repo = repository or MySQLMqEventRepository()
    message_type = normalize_text(payload.get("message_type") or payload.get("event")) or event_type_from_topic(topic)
    if message_type not in EVENT_TYPES:
        raise ValueError(f"Unsupported event type: {message_type}")
    lab_code = first_text(payload, "lab_code") or topic_lab_code(topic)
    if not lab_code:
        raise ValueError("lab_code is required")
    occurred_at = event_time(payload, message_type)
    message_id = first_text(payload, "message_id") or generated_message_id(message_type, lab_code, occurred_at)
    if repo.message_exists(message_id):
        return build_ack(message_id, "DUPLICATE")

    context = None
    run = repo.find_active_run_by_lab(lab_code) if message_type in {"EXPERIMENT_ENDED", "EXPERIMENT_RESULT"} else None
    created_run_from_context = False
    if message_type == "FIXTURE_READY" and not first_text(payload, "task_code"):
        context = repo.find_current_context_by_lab(lab_code, ["工装夹具安装"])
        if not context:
            raise ValueError(f"fixture install context is required for lab_code: {lab_code}")
    if message_type == "EXPERIMENT_STARTED":
        context = repo.find_current_context_by_lab(lab_code, ["实验准备就绪"])
        if context:
            run = repo.start_run_for_context(context, occurred_at)
            created_run_from_context = True
        else:
            return build_ack(
                message_id,
                "REJECTED",
                "READY_CONTEXT_REQUIRED",
                f"ready experiment context is required for lab_code: {lab_code}",
            )
    if message_type in {"EXPERIMENT_ENDED", "EXPERIMENT_RESULT"} and not run:
        raise ValueError(f"active experiment run is required for lab_code: {lab_code}")
    task_no = first_text(payload, "task_code") or normalize_text((run or {}).get("task_no")) or normalize_text((context or {}).get("task_no"))
    if not task_no:
        raise ValueError("task_code is required")
    experiment_no = first_text(payload, "experiment_code") or normalize_text((run or {}).get("experiment_no")) or normalize_text((context or {}).get("experiment_no"))
    run_no = normalize_text((run or {}).get("run_no"))
    correlation_id = first_text(payload, "correlation_id", "correlationId")
    message_log_id = repo.record_message(
        {
            "message_id": message_id,
            "direction": "HOST_TO_MES",
            "topic": topic,
            "message_type": message_type,
            "correlation_id": correlation_id,
            "lab_code": lab_code,
            "task_no": task_no,
            "experiment_no": experiment_no,
            "qos": None,
            "retain_flag": False,
            "payload": payload,
            "process_status": "PROCESSED",
            "error_code": "",
            "error_message": "",
        }
    )

    if message_type in {"FIXTURE_READY", "EXPERIMENT_STARTED", "EXPERIMENT_ENDED"}:
        repo.record_event(
            {
                "event_type": message_type,
                "task_no": task_no,
                "experiment_no": experiment_no,
                "lab_code": lab_code,
                "success_id": first_text(payload, "success_id"),
                "event_time": occurred_at,
                "message_id": message_id,
                "message_log_id": message_log_id,
                "payload": payload,
            }
        )

    if message_type == "EXPERIMENT_STARTED":
        if not created_run_from_context:
            repo.mark_run_started(run_no, occurred_at)
        if experiment_no and not created_run_from_context:
            repo.mark_experiment_started(task_no, experiment_no, occurred_at)
    elif message_type == "EXPERIMENT_ENDED":
        repo.mark_run_ended(run_no, occurred_at)
    elif message_type == "EXPERIMENT_RESULT":
        result_package = payload.get("result_package")
        if not isinstance(result_package, dict):
            raise ValueError("result_package is required")
        repo.record_result(
            {
                "task_no": task_no,
                "experiment_no": experiment_no,
                "lab_code": lab_code,
                "result_time": occurred_at,
                "conclusion": normalize_text(result_package.get("conclusion")),
                "summary": normalize_text(result_package.get("summary")),
                "result_payload": result_package,
                "message_id": message_id,
                "message_log_id": message_log_id,
                "status": "RECEIVED",
            }
        )

    publish_realtime_update()
    return build_ack(message_id, "PROCESSED")
