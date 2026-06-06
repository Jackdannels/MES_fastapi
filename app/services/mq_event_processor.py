from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from typing import Any, Protocol

from app.core.storage_backend import get_storage_backend, normalize_storage_payload
from app.db.session import get_connection
from app.services.laboratory_completion import (
    complete_storage_laboratory_experiment,
)
from app.services.laboratory_start import start_storage_laboratory_experiment


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


def storage_completion_snapshot(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    normalized = normalize_storage_payload(payload)
    return {
        "tasks": [dict(item) for item in normalized.get("mes.tasks", []) if isinstance(item, dict)],
        "samples": [dict(item) for item in normalized.get("mes.samples", []) if isinstance(item, dict)],
        "schedules": [dict(item) for item in normalized.get("mes.schedules", []) if isinstance(item, dict)],
        "experiments": [dict(item) for item in normalized.get("mes.experiments", []) if isinstance(item, dict)],
        "experiment_runs": [dict(item) for item in normalized.get("mes.experiment_runs", []) if isinstance(item, dict)],
        "experiment_run_trays": [dict(item) for item in normalized.get("mes.experiment_run_trays", []) if isinstance(item, dict)],
        "experiment_trays": [dict(item) for item in normalized.get("mes.experiment_trays", []) if isinstance(item, dict)],
        "experiment_samples": [dict(item) for item in normalized.get("mes.experiment_samples", []) if isinstance(item, dict)],
        "staging_events": [dict(item) for item in normalized.get("mes.staging_events", []) if isinstance(item, dict)],
    }


def sample_code(sample: dict[str, Any]) -> str:
    return normalize_text(sample.get("code") or sample.get("sample_code") or sample.get("sampleCode") or sample.get("id"))


def sample_identity(sample: dict[str, Any]) -> tuple[str, str]:
    return (
        normalize_text(sample.get("task_code") or sample.get("taskCode") or sample.get("task_no") or sample.get("taskNo")),
        sample_code(sample),
    )


def sample_tray_codes(sample: dict[str, Any]) -> set[str]:
    return {
        normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))
        for tray in sample.get("trays", [])
        if isinstance(tray, dict)
        and normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))
    }


def tray_target_experiment_code(tray: dict[str, Any]) -> str:
    return normalize_text(
        tray.get("target_experiment_code")
        or tray.get("targetExperimentCode")
        or tray.get("experiment_code")
        or tray.get("experimentCode")
        or tray.get("experiment_no")
        or tray.get("experimentNo")
    )


def scope_snapshot_samples_for_experiment(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    tray_codes: list[str],
) -> dict[str, list[dict[str, Any]]]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    scoped_tray_codes = {normalize_text(code) for code in tray_codes if normalize_text(code)}
    if not normalized_task_code or not normalized_experiment_code or not scoped_tray_codes:
        return snapshot

    experiment_sample_codes = {
        normalize_text(item.get("sample_code") or item.get("sampleCode") or item.get("sample_no") or item.get("sampleNo"))
        for item in snapshot.get("experiment_samples", [])
        if normalize_text(item.get("task_code") or item.get("taskCode") or item.get("task_no") or item.get("taskNo")) == normalized_task_code
        and normalize_text(
            item.get("experiment_code")
            or item.get("experimentCode")
            or item.get("experiment_no")
            or item.get("experimentNo")
        ) == normalized_experiment_code
        and normalize_text(item.get("sample_code") or item.get("sampleCode") or item.get("sample_no") or item.get("sampleNo"))
    }
    has_task_sample_relations = any(
        normalize_text(item.get("task_code") or item.get("taskCode") or item.get("task_no") or item.get("taskNo")) == normalized_task_code
        and normalize_text(item.get("sample_code") or item.get("sampleCode") or item.get("sample_no") or item.get("sampleNo"))
        for item in snapshot.get("experiment_samples", [])
    )

    experiments_by_tray: dict[str, set[str]] = {}
    for item in snapshot.get("experiment_trays", []):
        relation_task_code = normalize_text(item.get("task_code") or item.get("taskCode") or item.get("task_no") or item.get("taskNo"))
        tray_code = normalize_text(item.get("tray_code") or item.get("trayCode") or item.get("tray_no") or item.get("trayNo"))
        experiment_no = normalize_text(
            item.get("experiment_code")
            or item.get("experimentCode")
            or item.get("experiment_no")
            or item.get("experimentNo")
        )
        if relation_task_code == normalized_task_code and tray_code in scoped_tray_codes and experiment_no:
            experiments_by_tray.setdefault(tray_code, set()).add(experiment_no)

    eligible_sample_codes: set[str] = set()
    explicit_tray_codes: set[str] = set()
    fallback_sample_codes_by_tray: dict[str, set[str]] = {}
    for sample in snapshot.get("samples", []):
        if normalize_text(sample.get("task_code") or sample.get("taskCode") or sample.get("task_no") or sample.get("taskNo")) != normalized_task_code:
            continue
        current_sample_code = sample_code(sample)
        matching_tray_codes = sample_tray_codes(sample).intersection(scoped_tray_codes)
        if not matching_tray_codes:
            continue
        if current_sample_code in experiment_sample_codes:
            eligible_sample_codes.add(current_sample_code)
            explicit_tray_codes.update(matching_tray_codes)
            continue
        for tray in sample.get("trays", []):
            if not isinstance(tray, dict):
                continue
            tray_code = normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))
            if tray_code not in matching_tray_codes:
                continue
            target_experiment_code = tray_target_experiment_code(tray)
            if target_experiment_code == normalized_experiment_code:
                eligible_sample_codes.add(current_sample_code)
                explicit_tray_codes.add(tray_code)
            elif not target_experiment_code:
                fallback_sample_codes_by_tray.setdefault(tray_code, set()).add(current_sample_code)

    if not has_task_sample_relations:
        for tray_code, fallback_sample_codes in fallback_sample_codes_by_tray.items():
            assigned_experiments = experiments_by_tray.get(tray_code, set())
            if tray_code in explicit_tray_codes:
                continue
            if assigned_experiments and assigned_experiments != {normalized_experiment_code}:
                continue
            eligible_sample_codes.update(code for code in fallback_sample_codes if code)

    scoped_samples = [
        dict(sample)
        for sample in snapshot.get("samples", [])
        if sample_code(sample) in eligible_sample_codes
    ]
    return {**snapshot, "samples": scoped_samples}


def merge_scoped_samples(
    original_samples: list[dict[str, Any]],
    scoped_samples: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    scoped_by_identity = {sample_identity(sample): sample for sample in scoped_samples if sample_identity(sample)[1]}
    return [
        dict(scoped_by_identity.get(sample_identity(sample), sample))
        for sample in original_samples
    ]


def run_context_from_snapshot(snapshot: dict[str, list[dict[str, Any]]], run_no: str) -> dict[str, Any]:
    normalized_run_no = normalize_text(run_no)
    if not normalized_run_no:
        return {}
    return next(
        (
            run
            for run in snapshot.get("experiment_runs", [])
            if normalize_text(run.get("run_no") or run.get("runNo") or run.get("id")) == normalized_run_no
        ),
        {},
    )


def publish_realtime_update() -> None:
    try:
        from app.api.routes.storage import publish_storage_update
    except Exception:
        return
    publish_storage_update([
        "mes.experiments",
        "mes.experiment_runs",
        "mes.experiment_run_trays",
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
                        OR tr.test_state IN ({status_placeholders})
                        OR (
                          COALESCE(ti.status, '') = ''
                          AND COALESCE(tr.test_state, '') = ''
                          AND (
                            sm.sample_status IN ({status_placeholders})
                            OR sm.flow_status IN ({status_placeholders})
                          )
                        )
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
                sample_nos_by_tray: dict[str, list[str]] = {}
                for row in tray_sample_rows:
                    tray_no = normalize_text(row.get("tray_no"))
                    sample_no = normalize_text(row.get("sample_no"))
                    if tray_no and tray_no not in tray_nos:
                        tray_nos.append(tray_no)
                    if sample_no and sample_no not in sample_nos:
                        sample_nos.append(sample_no)
                    if tray_no and sample_no:
                        sample_list = sample_nos_by_tray.setdefault(tray_no, [])
                        if sample_no not in sample_list:
                            sample_list.append(sample_no)
                if not tray_nos:
                    return None

                schedule_params = [task_no]
                schedule_filters = ["s.task_no = %s", "COALESCE(s.schedule_status, '') NOT IN ('实验已完成', '实验完成', '实验已经完成')"]
                if command_experiment_no:
                    schedule_filters.append("s.experiment_no = %s")
                    schedule_params.append(command_experiment_no)
                device_names = []
                for candidate in lab_candidates:
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
                      s.schedule_end_time,
                      et.tray_no AS scoped_tray_no
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
                    "tray_nos": [],
                    "sample_nos": [],
                },
            )
            scoped_tray_no = normalize_text(row.get("scoped_tray_no"))
            if scoped_tray_no and scoped_tray_no not in context["tray_nos"]:
                context["tray_nos"].append(scoped_tray_no)
            for sample_no in sample_nos_by_tray.get(scoped_tray_no, []):
                if sample_no not in context["sample_nos"]:
                    context["sample_nos"].append(sample_no)

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
        if not task_no or not experiment_no or not tray_nos:
            raise ValueError("ready experiment context is incomplete")

        started_at = mysql_datetime_text(occurred_at)
        started_dt = parse_beijing_datetime(started_at)
        planned_hours = parse_float(context.get("planned_hours"))
        planned_end_at = mysql_datetime_text(context.get("schedule_end_time"))
        if not planned_end_at and started_dt is not None and planned_hours > 0:
            planned_end_at = (started_dt + timedelta(hours=planned_hours)).strftime("%Y-%m-%d %H:%M:%S")
        run_no = f"run-{datetime.now(BEIJING_TZ).strftime('%Y%m%d%H%M%S%f')}"
        storage = get_storage_backend()
        snapshot = storage_completion_snapshot(storage.read_all())
        scoped_snapshot = scope_snapshot_samples_for_experiment(
            snapshot,
            task_code=task_no,
            experiment_code=experiment_no,
            tray_codes=tray_nos,
        )
        result = start_storage_laboratory_experiment(
            scoped_snapshot,
            task_code=task_no,
            experiment_code=experiment_no,
            run_no=run_no,
            lab_name=device_name,
            schedule_id=schedule_no,
            tray_codes=tray_nos,
            started_at=started_at,
            planned_hours=planned_hours,
            planned_end_at=planned_end_at,
        )
        storage.write_many(
            {
                "mes.tasks": result["tasks"],
                "mes.samples": merge_scoped_samples(snapshot["samples"], result["samples"]),
                "mes.schedules": result["schedules"],
                "mes.experiments": result["experiments"],
                "mes.experiment_runs": result["experimentRuns"],
                "mes.experiment_run_trays": result["experimentRunTrays"],
            }
        )
        return {
            "run_no": run_no,
            "task_no": task_no,
            "experiment_no": experiment_no,
            "device_name": device_name,
            "run_status": "实验进行中",
        }

    def mark_run_started(self, run_no: str, occurred_at: str) -> None:
        storage = get_storage_backend()
        snapshot = storage_completion_snapshot(storage.read_all())
        run = run_context_from_snapshot(snapshot, run_no)
        task_no = normalize_text(run.get("task_code") or run.get("task_no"))
        experiment_no = normalize_text(run.get("experiment_code") or run.get("experiment_no"))
        tray_codes = [
            normalize_text(item.get("tray_code") or item.get("tray_no"))
            for item in snapshot.get("experiment_run_trays", [])
            if normalize_text(item.get("run_no") or item.get("runNo")) == normalize_text(run_no)
            and normalize_text(item.get("tray_code") or item.get("tray_no"))
        ]
        if not tray_codes:
            tray_codes = [normalize_text(code) for code in run.get("tray_codes", []) if normalize_text(code)]
        scoped_snapshot = scope_snapshot_samples_for_experiment(
            snapshot,
            task_code=task_no,
            experiment_code=experiment_no,
            tray_codes=tray_codes,
        )
        result = start_storage_laboratory_experiment(
            scoped_snapshot,
            task_code=task_no,
            experiment_code=experiment_no,
            run_no=run_no,
            lab_name=normalize_text(run.get("device") or run.get("device_name")),
            schedule_id=normalize_text(run.get("schedule_id") or run.get("schedule_no")),
            tray_codes=tray_codes,
            started_at=occurred_at,
            planned_hours=run.get("planned_hours"),
            planned_end_at=normalize_text(run.get("planned_end_at")),
        )
        storage.write_many(
            {
                "mes.tasks": result["tasks"],
                "mes.samples": merge_scoped_samples(snapshot["samples"], result["samples"]),
                "mes.schedules": result["schedules"],
                "mes.experiments": result["experiments"],
                "mes.experiment_runs": result["experimentRuns"],
                "mes.experiment_run_trays": result["experimentRunTrays"],
            }
        )

    def mark_run_ended(self, run_no: str, occurred_at: str) -> None:
        storage = get_storage_backend()
        snapshot = storage_completion_snapshot(storage.read_all())
        run = run_context_from_snapshot(snapshot, run_no)
        task_no = normalize_text(run.get("task_code") or run.get("task_no"))
        experiment_no = normalize_text(run.get("experiment_code") or run.get("experiment_no"))
        tray_codes = [
            normalize_text(item.get("tray_code") or item.get("tray_no"))
            for item in snapshot.get("experiment_run_trays", [])
            if normalize_text(item.get("run_no") or item.get("runNo")) == normalize_text(run_no)
            and normalize_text(item.get("task_code") or item.get("task_no")) == task_no
            and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == experiment_no
            and normalize_text(item.get("tray_code") or item.get("tray_no"))
        ]
        if not tray_codes:
            tray_codes = [normalize_text(code) for code in run.get("tray_codes", []) if normalize_text(code)]
        scoped_snapshot = scope_snapshot_samples_for_experiment(
            snapshot,
            task_code=task_no,
            experiment_code=experiment_no,
            tray_codes=tray_codes,
        )
        result = complete_storage_laboratory_experiment(
            scoped_snapshot,
            task_code=task_no,
            experiment_code=experiment_no,
            run_no=run_no,
            tray_codes=tray_codes,
            completed_at=occurred_at,
        )
        storage.write_many(
            {
                "mes.samples": merge_scoped_samples(snapshot["samples"], result["samples"]),
                "mes.experiments": result["experiments"],
                "mes.schedules": result["schedules"],
                "mes.experiment_runs": result["experimentRuns"],
                "mes.experiment_run_trays": result["experimentRunTrays"],
            }
        )


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
    context_task_no = normalize_text((run or {}).get("task_no")) or normalize_text((context or {}).get("task_no"))
    authoritative_context = created_run_from_context or message_type in {"EXPERIMENT_ENDED", "EXPERIMENT_RESULT"}
    if authoritative_context:
        task_no = context_task_no or first_text(payload, "task_code")
    else:
        task_no = first_text(payload, "task_code") or context_task_no
    if not task_no:
        raise ValueError("task_code is required")
    context_experiment_no = normalize_text((run or {}).get("experiment_no")) or normalize_text((context or {}).get("experiment_no"))
    if authoritative_context:
        experiment_no = context_experiment_no or first_text(payload, "experiment_code")
    else:
        experiment_no = first_text(payload, "experiment_code") or context_experiment_no
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
