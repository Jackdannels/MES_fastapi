from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Protocol

from app.core.master_data import (
    LAB_INTERFACE_MQTT,
    LAB_INTERFACE_OPERATION_EXPERIMENT_END,
    LAB_INTERFACE_OPERATION_EXPERIMENT_START,
    LAB_INTERFACE_OPERATION_FIXTURE_READY,
    require_laboratory_interface,
)
from app.core.storage_backend import get_storage_backend, normalize_storage_payload
from app.db.session import get_connection
from app.services.attendance_service import get_attendance_service, should_finish_work_interval_for_completion
from app.services.experiment_segments import record_sub_experiment_code
from app.services.fixture_installations import (
    PENDING as FIXTURE_INSTALL_PENDING,
    READY as FIXTURE_INSTALL_READY,
    apply_pending_fixture_ready,
    find_fixture_installation,
    mark_fixture_installation_ready,
)
from app.services.laboratory_axis_steps import (
    complete_storage_laboratory_axis_step,
    mark_storage_laboratory_axis_adjustment_ready,
    restore_storage_laboratory_axis_adjustment,
    start_storage_laboratory_axis_step,
)
from app.services.laboratory_completion import (
    complete_storage_laboratory_experiment,
)
from app.services.laboratory_operations import (
    acquire_laboratory_storage_commit_lock,
    merge_scoped_samples,
    read_laboratory_task_payload,
    scope_snapshot_samples_for_experiment as scope_laboratory_samples_for_experiment,
    write_laboratory_updates,
)
from app.services.laboratory_start import start_storage_laboratory_experiment
from app.services.schedule_cascade_runtime import apply_run_schedule_cascade, run_forecast_end_at
from app.services.storage_update_bus import publish_storage_update
from app.services.test_data_reports import archive_completion_reports
from app.services.mq_event_protocol import (
    ACK_MESSAGE_TYPE,
    BEIJING_TZ,
    EVENT_TYPES,
    EVENT_TYPE_BY_TOPIC_SUFFIX,
    PROTOCOL_NAME,
    event_type_from_topic,
    first_text,
    generated_message_id,
    generated_run_no,
    mysql_datetime_text,
    normalize_text,
    parse_beijing_datetime,
    parse_float,
    topic_lab_code,
)


logger = logging.getLogger(__name__)


class MqEventRepository(Protocol):
    def message_exists(self, message_id: str) -> bool: ...

    def record_message(self, message: dict[str, Any]) -> int: ...

    def record_event(self, event: dict[str, Any]) -> None: ...

    def record_result(self, result: dict[str, Any]) -> None: ...

    def find_run_by_no(self, run_no: str) -> dict[str, Any] | None: ...

    def find_active_run_by_lab(self, lab_code: str) -> dict[str, Any] | None: ...

    def find_current_context_by_lab(
        self,
        lab_code: str,
        candidate_statuses: list[str],
        context_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None: ...

    def start_run_for_context(self, context: dict[str, Any], occurred_at: str, run_no: str = "") -> dict[str, Any]: ...

    def mark_run_started(self, run_no: str, occurred_at: str) -> None: ...

    def mark_axis_adjustment_ready(self, run_no: str, axis_code: str, occurred_at: str) -> None: ...

    def mark_axis_step_started(self, run_no: str, axis_code: str, occurred_at: str) -> None: ...

    def mark_run_ended(
        self,
        run_no: str,
        occurred_at: str,
        axis_code: str = "",
        next_axis_code: str = "",
        sub_experiment_code: str = "",
    ) -> None: ...


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


def run_axis_codes(run: dict[str, Any] | None) -> list[str]:
    value = (run or {}).get("axis_codes") or (run or {}).get("axisCodes") or (run or {}).get("axis_codes_json")
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            decoded = value.replace("，", ",").split(",")
        value = decoded
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        axis_code = normalize_text(item)
        if axis_code and axis_code not in result:
            result.append(axis_code)
    return result


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
        "experiment_run_steps": [dict(item) for item in normalized.get("mes.experiment_run_steps", []) if isinstance(item, dict)],
        "experiment_trays": [dict(item) for item in normalized.get("mes.experiment_trays", []) if isinstance(item, dict)],
        "experiment_samples": [dict(item) for item in normalized.get("mes.experiment_samples", []) if isinstance(item, dict)],
        "staging_events": [dict(item) for item in normalized.get("mes.staging_events", []) if isinstance(item, dict)],
    }


def scope_snapshot_samples_for_experiment(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    tray_codes: list[str],
) -> dict[str, list[dict[str, Any]]]:
    return scope_laboratory_samples_for_experiment(
        snapshot,
        task_code=task_code,
        experiment_code=experiment_code,
        tray_codes=tray_codes,
    )


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
    publish_storage_update([
            "mes.experiments",
            "mes.experiment_runs",
            "mes.experiment_run_trays",
            "mes.experiment_run_steps",
            "mes.samples",
            "mes.schedules",
            "mes.conflicts",
    ])


def apply_mqtt_schedule_cascade(
    storage: Any,
    experiment_runs: list[dict[str, Any]],
    *,
    run_no: str,
    new_end_at: str = "",
    reason: str,
) -> dict[str, Any]:
    normalized_run_no = normalize_text(run_no)
    run = next(
        (
            item
            for item in experiment_runs
            if normalize_text(item.get("run_no") or item.get("runNo") or item.get("id")) == normalized_run_no
        ),
        None,
    )
    if run is None:
        return {"changed": False, "skipped_reason": "run_not_found"}
    boundary = normalize_text(new_end_at) or run_forecast_end_at(run)
    try:
        return apply_run_schedule_cascade(
            storage,
            run,
            new_end_at=boundary,
            reason=reason,
        )
    except Exception as exc:
        logger.exception("Failed to cascade MQTT schedules for run=%s", normalized_run_no)
        return {"changed": False, "error": str(exc)}


class MySQLMqEventRepository:
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
                      task_no, experiment_no, sub_experiment_code, qos, retain_flag, payload_json, process_status,
                      error_code, error_message, received_at, processed_at
                    ) VALUES (
                      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
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
                        message.get("sub_experiment_code") or None,
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
                      event_type, task_no, experiment_no, sub_experiment_code, lab_code, success_id,
                      event_time, message_id, message_log_id, payload_json
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        event.get("event_type"),
                        event.get("task_no"),
                        event.get("experiment_no") or None,
                        event.get("sub_experiment_code") or None,
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
                      task_no, experiment_no, sub_experiment_code, lab_code, result_time, conclusion, summary,
                      result_payload_json, message_id, message_log_id, status
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        result.get("task_no"),
                        result.get("experiment_no"),
                        result.get("sub_experiment_code") or None,
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
                      er.sub_experiment_code,
                      er.axis_codes_json,
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

    def find_run_by_no(self, run_no: str) -> dict[str, Any] | None:
        normalized_run_no = normalize_text(run_no)
        if not normalized_run_no:
            return None
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                      er.run_no,
                      er.task_no,
                      er.experiment_no,
                      er.sub_experiment_code,
                      er.axis_codes_json,
                      er.device_name,
                      er.run_status
                    FROM biz_experiment_run er
                    WHERE er.run_no = %s
                    LIMIT 1
                    """,
                    (normalized_run_no,),
                )
                row = cursor_row_as_dict(cursor)
        return row

    def find_current_context_by_lab(
        self,
        lab_code: str,
        candidate_statuses: list[str],
        context_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        normalized_lab_code = normalize_text(lab_code)
        statuses = [normalize_text(status) for status in candidate_statuses if normalize_text(status)]
        if not normalized_lab_code or not statuses:
            return None
        preferred_payload = context_payload if isinstance(context_payload, dict) else {}
        with get_connection() as connection:
            with connection.cursor() as cursor:
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
                    (normalized_lab_code,),
                )
                command_rows = cursor_rows_as_dicts(cursor)
                command_row = command_rows[0] if command_rows else {}
                task_no = normalize_text(command_row.get("task_no"))
                command_experiment_no = normalize_text(command_row.get("experiment_no"))
                payload_json = command_row.get("payload_json")
                try:
                    command_payload = json.loads(payload_json) if isinstance(payload_json, str) else payload_json if isinstance(payload_json, dict) else {}
                except json.JSONDecodeError:
                    command_payload = {}
                command_schedule_no = first_text(preferred_payload, "schedule_id", "scheduleId", "schedule_no", "scheduleNo") or first_text(
                    command_payload,
                    "schedule_id",
                    "scheduleId",
                    "schedule_no",
                    "scheduleNo",
                )
                command_sub_experiment_code = first_text(
                    preferred_payload,
                    "sub_experiment_code",
                    "subExperimentCode",
                    "sub_experiment_no",
                    "subExperimentNo",
                ) or first_text(
                    command_payload,
                    "sub_experiment_code",
                    "subExperimentCode",
                    "sub_experiment_no",
                    "subExperimentNo",
                )
                if not task_no:
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
                      )
                      AND lab.lab_code = %s
                    ORDER BY tr.tray_no ASC, sm.sample_no ASC
                    """,
                    [
                        task_no,
                        *statuses,
                        *statuses,
                        normalized_lab_code,
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

                completed_schedule_statuses = ["实验已完成", "实验完成", "实验已经完成"]
                completed_status_placeholders = ", ".join(["%s"] * len(completed_schedule_statuses))
                tray_placeholders = ", ".join(["%s"] * len(tray_nos))
                schedule_params = [task_no]
                schedule_filters = [
                    "s.task_no = %s",
                    f"""
                    (
                      COALESCE(s.schedule_status, '') NOT IN ({completed_status_placeholders})
                      OR (
                        COALESCE(s.sub_experiment_code, '') <> ''
                        AND NOT EXISTS (
                          SELECT 1
                          FROM biz_experiment_run_tray completed_rt
                          WHERE completed_rt.task_no = s.task_no
                            AND completed_rt.experiment_no = s.experiment_no
                            AND COALESCE(completed_rt.sub_experiment_code, '') = COALESCE(s.sub_experiment_code, '')
                            AND completed_rt.tray_no IN ({tray_placeholders})
                            AND COALESCE(completed_rt.run_tray_status, '') IN ({completed_status_placeholders})
                        )
                      )
                    )
                    """,
                ]
                schedule_params.extend(completed_schedule_statuses)
                schedule_params.extend(tray_nos)
                schedule_params.extend(completed_schedule_statuses)
                if command_experiment_no:
                    schedule_filters.append("s.experiment_no = %s")
                    schedule_params.append(command_experiment_no)
                    schedule_filters.append("(schedule_lab.lab_code = %s OR schedule_lab.lab_code IS NULL)")
                else:
                    schedule_filters.append("schedule_lab.lab_code = %s")
                schedule_params.append(normalized_lab_code)
                if command_schedule_no:
                    schedule_filters.append("s.schedule_no = %s")
                    schedule_params.append(command_schedule_no)
                if command_sub_experiment_code:
                    schedule_filters.append("COALESCE(s.sub_experiment_code, '') = %s")
                    schedule_params.append(command_sub_experiment_code)
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
                    LEFT JOIN md_lab schedule_lab
                      ON schedule_lab.lab_id = s.lab_id
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
            if command_sub_experiment_code:
                context["sub_experiment_code"] = command_sub_experiment_code
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

    def _storage_snapshot_for_run(
        self,
        storage: Any,
        run_no: str,
    ) -> tuple[dict[str, list[dict[str, Any]]], str]:
        if callable(getattr(storage, "read_task_scope", None)):
            persisted_run = self.find_run_by_no(run_no) or {}
            task_no = normalize_text(persisted_run.get("task_no") or persisted_run.get("task_code"))
            if not task_no:
                raise ValueError(f"experiment run is required for run_no: {run_no}")
            return storage_completion_snapshot(read_laboratory_task_payload(storage, task_no)), task_no
        snapshot = storage_completion_snapshot(storage.read_all())
        run = run_context_from_snapshot(snapshot, run_no)
        return snapshot, normalize_text(run.get("task_code") or run.get("task_no"))

    def start_run_for_context(self, context: dict[str, Any], occurred_at: str, run_no: str = "") -> dict[str, Any]:
        task_no = normalize_text(context.get("task_no"))
        experiment_no = normalize_text(context.get("experiment_no"))
        sub_experiment_code = record_sub_experiment_code(context)
        device_name = normalize_text(context.get("device_name"))
        schedule_no = normalize_text(context.get("schedule_no"))
        tray_nos = [normalize_text(tray_no) for tray_no in context.get("tray_nos") or [] if normalize_text(tray_no)]
        if not task_no or not experiment_no or not tray_nos:
            raise ValueError("ready experiment context is incomplete")

        started_at = mysql_datetime_text(occurred_at)
        started_dt = parse_beijing_datetime(started_at)
        planned_hours = parse_float(context.get("planned_hours"))
        planned_end_at = ""
        if started_dt is not None and planned_hours > 0:
            planned_end_at = (started_dt + timedelta(hours=planned_hours)).strftime("%Y-%m-%d %H:%M:%S")
        if not planned_end_at:
            planned_end_at = mysql_datetime_text(context.get("schedule_end_time"))
        run_no = normalize_text(run_no) or generated_run_no()
        storage = get_storage_backend()
        with acquire_laboratory_storage_commit_lock():
            snapshot = storage_completion_snapshot(read_laboratory_task_payload(storage, task_no))
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
                sub_experiment_code=sub_experiment_code,
                run_no=run_no,
                lab_name=device_name,
                schedule_id=schedule_no,
                tray_codes=tray_nos,
                started_at=started_at,
                planned_hours=planned_hours,
                planned_end_at=planned_end_at,
            )
            updates = {
                    "mes.tasks": result["tasks"],
                    "mes.samples": merge_scoped_samples(snapshot["samples"], result["samples"]),
                    "mes.schedules": result["schedules"],
                    "mes.experiments": result["experiments"],
                    "mes.experiment_runs": result["experimentRuns"],
                    "mes.experiment_run_trays": result["experimentRunTrays"],
                    "mes.experiment_run_steps": result.get("experimentRunSteps", []),
                }
            write_laboratory_updates(
                storage,
                updates,
                scoped_samples=result["samples"],
                task_codes={task_no},
            )
            apply_mqtt_schedule_cascade(
                storage,
                result["experimentRuns"],
                run_no=run_no,
                reason="实验实际开始时间变化",
            )
        return {
            "run_no": run_no,
            "task_no": task_no,
            "experiment_no": experiment_no,
            "sub_experiment_code": sub_experiment_code,
            "device_name": device_name,
            "run_status": "实验进行中",
        }

    def mark_run_started(self, run_no: str, occurred_at: str) -> None:
        storage = get_storage_backend()
        with acquire_laboratory_storage_commit_lock():
            snapshot, task_scope = self._storage_snapshot_for_run(storage, run_no)
            run = run_context_from_snapshot(snapshot, run_no)
            task_no = normalize_text(run.get("task_code") or run.get("task_no"))
            task_scope = task_scope or task_no
            experiment_no = normalize_text(run.get("experiment_code") or run.get("experiment_no"))
            sub_experiment_code = record_sub_experiment_code(run)
            tray_codes = [
                normalize_text(item.get("tray_code") or item.get("tray_no"))
                for item in snapshot.get("experiment_run_trays", [])
                if normalize_text(item.get("run_no") or item.get("runNo")) == normalize_text(run_no)
                and normalize_text(item.get("tray_code") or item.get("tray_no"))
            ]
            if not tray_codes:
                raise ValueError("experiment_run_trays are required for experiment start")
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
                sub_experiment_code=sub_experiment_code,
                run_no=run_no,
                lab_name=normalize_text(run.get("device") or run.get("device_name")),
                schedule_id=normalize_text(run.get("schedule_id") or run.get("schedule_no")),
                tray_codes=tray_codes,
                started_at=occurred_at,
                planned_hours=run.get("planned_hours"),
                planned_end_at=normalize_text(run.get("planned_end_at")),
            )
            updates = {
                    "mes.tasks": result["tasks"],
                    "mes.samples": merge_scoped_samples(snapshot["samples"], result["samples"]),
                    "mes.schedules": result["schedules"],
                    "mes.experiments": result["experiments"],
                    "mes.experiment_runs": result["experimentRuns"],
                    "mes.experiment_run_trays": result["experimentRunTrays"],
                    "mes.experiment_run_steps": result.get("experimentRunSteps", snapshot.get("experiment_run_steps", [])),
                }
            write_laboratory_updates(
                storage,
                updates,
                scoped_samples=result["samples"],
                task_codes={task_scope} if task_scope else None,
            )
            apply_mqtt_schedule_cascade(
                storage,
                result["experimentRuns"],
                run_no=run_no,
                reason="实验实际开始时间变化",
            )

    def mark_run_ended(
        self,
        run_no: str,
        occurred_at: str,
        axis_code: str = "",
        next_axis_code: str = "",
        sub_experiment_code: str = "",
    ) -> None:
        storage = get_storage_backend()
        with acquire_laboratory_storage_commit_lock():
            snapshot, task_scope = self._storage_snapshot_for_run(storage, run_no)
            run = run_context_from_snapshot(snapshot, run_no)
            task_no = normalize_text(run.get("task_code") or run.get("task_no"))
            task_scope = task_scope or task_no
            experiment_no = normalize_text(run.get("experiment_code") or run.get("experiment_no"))
            sub_experiment_code = normalize_text(sub_experiment_code) or record_sub_experiment_code(run)
            tray_codes = [
                normalize_text(item.get("tray_code") or item.get("tray_no"))
                for item in snapshot.get("experiment_run_trays", [])
                if normalize_text(item.get("run_no") or item.get("runNo")) == normalize_text(run_no)
                and normalize_text(item.get("task_code") or item.get("task_no")) == task_no
                and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == experiment_no
                and normalize_text(item.get("tray_code") or item.get("tray_no"))
            ]
            if not tray_codes:
                raise ValueError("experiment_run_trays are required for experiment completion")
            scoped_snapshot = scope_snapshot_samples_for_experiment(
                snapshot,
                task_code=task_no,
                experiment_code=experiment_no,
                tray_codes=tray_codes,
            )
            normalized_axis_code = normalize_text(axis_code)
            if normalized_axis_code:
                result = complete_storage_laboratory_axis_step(
                    scoped_snapshot,
                    task_code=task_no,
                    experiment_code=experiment_no,
                    sub_experiment_code=sub_experiment_code,
                    run_no=run_no,
                    axis_code=normalized_axis_code,
                    next_axis_code=next_axis_code,
                    completed_at=occurred_at,
                )
            else:
                result = complete_storage_laboratory_experiment(
                    scoped_snapshot,
                    task_code=task_no,
                    experiment_code=experiment_no,
                    sub_experiment_code=sub_experiment_code,
                    run_no=run_no,
                    tray_codes=tray_codes,
                    completed_at=occurred_at,
                )
            updates = {
                    "mes.samples": merge_scoped_samples(snapshot["samples"], result["samples"]),
                    "mes.experiments": result["experiments"],
                    "mes.schedules": result["schedules"],
                    "mes.experiment_runs": result["experimentRuns"],
                    "mes.experiment_run_trays": result["experimentRunTrays"],
                    "mes.experiment_run_steps": result.get("experimentRunSteps", snapshot.get("experiment_run_steps", [])),
                }
            write_laboratory_updates(
                storage,
                updates,
                scoped_samples=result["samples"],
                task_codes={task_no},
            )
            apply_mqtt_schedule_cascade(
                storage,
                result["experimentRuns"],
                run_no=run_no,
                new_end_at=occurred_at,
                reason="实验实际结束时间变化",
            )
        try:
            archive_completion_reports(
                snapshot=scoped_snapshot,
                result=result,
                task_code=task_no,
                experiment_code=experiment_no,
                run_no=run_no,
                axis_code=normalized_axis_code,
                completed_at=occurred_at,
            )
        except Exception:
            # MQTT completion acknowledgement reflects the persisted physical event;
            # unexpected archive errors must not change its completion semantics.
            logger.exception(
                "Failed to archive MQTT completion reports for task=%s experiment=%s run=%s axis=%s",
                task_no,
                experiment_no,
                run_no,
                normalized_axis_code,
            )

    def mark_axis_adjustment_ready(self, run_no: str, axis_code: str, occurred_at: str) -> None:
        storage = get_storage_backend()
        with acquire_laboratory_storage_commit_lock():
            snapshot, task_no = self._storage_snapshot_for_run(storage, run_no)
            run_context_from_snapshot(snapshot, run_no)
            result = mark_storage_laboratory_axis_adjustment_ready(
                snapshot,
                run_no=run_no,
                axis_code=axis_code,
                occurred_at=occurred_at,
            )
            write_laboratory_updates(
                storage,
                {"mes.experiment_run_steps": result["experimentRunSteps"]},
                task_codes={task_no} if task_no else None,
            )

    def restore_axis_adjustment(self, run_no: str, axis_code: str, occurred_at: str) -> None:
        storage = get_storage_backend()
        with acquire_laboratory_storage_commit_lock():
            snapshot, task_no = self._storage_snapshot_for_run(storage, run_no)
            run_context_from_snapshot(snapshot, run_no)
            result = restore_storage_laboratory_axis_adjustment(
                snapshot,
                run_no=run_no,
                axis_code=axis_code,
                occurred_at=occurred_at,
            )
            write_laboratory_updates(
                storage,
                {"mes.experiment_run_steps": result["experimentRunSteps"]},
                task_codes={task_no} if task_no else None,
            )

    def mark_axis_step_started(self, run_no: str, axis_code: str, occurred_at: str) -> None:
        storage = get_storage_backend()
        with acquire_laboratory_storage_commit_lock():
            snapshot, task_no = self._storage_snapshot_for_run(storage, run_no)
            run_context_from_snapshot(snapshot, run_no)
            result = start_storage_laboratory_axis_step(
                snapshot,
                run_no=run_no,
                axis_code=axis_code,
                started_at=occurred_at,
            )
            write_laboratory_updates(
                storage,
                {"mes.experiment_run_steps": result["experimentRunSteps"]},
                task_codes={task_no} if task_no else None,
            )


def process_laboratory_event(
    topic: str,
    payload: dict[str, Any],
    *,
    repository: MqEventRepository | None = None,
    received_at: str = "",
) -> dict[str, Any]:
    repo = repository or MySQLMqEventRepository()
    message_type = normalize_text(payload.get("message_type") or payload.get("event")) or event_type_from_topic(topic)
    if message_type not in EVENT_TYPES:
        raise ValueError(f"Unsupported event type: {message_type}")
    lab_code = first_text(payload, "lab_code") or topic_lab_code(topic)
    if not lab_code:
        raise ValueError("lab_code is required")
    interface_operation = {
        "FIXTURE_READY": LAB_INTERFACE_OPERATION_FIXTURE_READY,
        "EXPERIMENT_STARTED": LAB_INTERFACE_OPERATION_EXPERIMENT_START,
        "EXPERIMENT_ENDED": LAB_INTERFACE_OPERATION_EXPERIMENT_END,
    }.get(message_type, "")
    require_laboratory_interface(
        LAB_INTERFACE_MQTT,
        operation=interface_operation,
        lab_code=lab_code,
    )
    # MES receive time is the authoritative business timestamp. The original
    # upper-computer timestamp remains in payload_json for auditing.
    occurred_at = normalize_text(received_at) or now_iso()
    message_id = first_text(payload, "message_id") or generated_message_id(message_type, lab_code, occurred_at)
    if repo.message_exists(message_id):
        return build_ack(message_id, "DUPLICATE")

    context = None
    fixture_installation = None
    fixture_install_id = ""
    if message_type == "FIXTURE_READY":
        fixture_install_id = first_text(payload, "fixture_install_id", "fixtureInstallId")
        if not fixture_install_id:
            return build_ack(message_id, "REJECTED", "FIXTURE_INSTALL_ID_REQUIRED", "fixture-ready 必须携带 fixture_install_id")
        fixture_installation = find_fixture_installation(fixture_install_id)
        if not fixture_installation:
            return build_ack(message_id, "REJECTED", "FIXTURE_INSTALL_ID_INVALID", "fixture_install_id 不存在")
        if fixture_installation["status"] not in {FIXTURE_INSTALL_PENDING, FIXTURE_INSTALL_READY}:
            return build_ack(message_id, "REJECTED", "FIXTURE_INSTALL_ID_INACTIVE", "fixture_install_id 已失效")
        for field, payload_key in (("lab_code", "lab_code"), ("task_code", "task_code"), ("experiment_code", "experiment_code")):
            received_value = first_text(payload, payload_key, "labCode" if field == "lab_code" else "taskCode" if field == "task_code" else "experimentCode")
            if received_value and received_value != fixture_installation[field]:
                return build_ack(message_id, "REJECTED", "FIXTURE_INSTALL_CONTEXT_MISMATCH", "fixture_install_id 上下文不匹配")
        if lab_code != fixture_installation["lab_code"]:
            return build_ack(message_id, "REJECTED", "FIXTURE_INSTALL_CONTEXT_MISMATCH", "fixture_install_id 上下文不匹配")
        context = {
            "task_no": fixture_installation["task_code"],
            "experiment_no": fixture_installation["experiment_code"],
            "schedule_id": fixture_installation["schedule_id"],
            "sub_experiment_code": fixture_installation["sub_experiment_code"],
        }
    payload_run_no = first_text(payload, "run_no", "runNo")
    payload_sub_experiment_code = first_text(payload, "sub_experiment_code", "subExperimentCode", "sub_experiment_no", "subExperimentNo")
    payload_axis_code = first_text(payload, "axis_code", "axisCode", "current_axis_code", "currentAxisCode")
    payload_next_axis_code = first_text(payload, "next_axis_code", "nextAxisCode")
    if message_type == "EXPERIMENT_RESULT" and not payload_run_no:
        raise ValueError("run_no is required for experiment result")
    run = None
    if message_type in {"EXPERIMENT_ENDED", "EXPERIMENT_RESULT"}:
        run = repo.find_run_by_no(payload_run_no) if payload_run_no else repo.find_active_run_by_lab(lab_code)
    created_run_from_context = False
    started_existing_axis = False
    if message_type == "EXPERIMENT_STARTED":
        if payload_run_no and payload_axis_code:
            run = repo.find_run_by_no(payload_run_no)
            started_existing_axis = bool(run and run_axis_codes(run))
        if started_existing_axis:
            context = run
        else:
            context = repo.find_current_context_by_lab(lab_code, ["实验准备就绪"], payload)
            if context:
                run = repo.start_run_for_context(context, occurred_at, payload_run_no)
                created_run_from_context = True
            else:
                return build_ack(
                    message_id,
                    "REJECTED",
                    "READY_CONTEXT_REQUIRED",
                    f"ready experiment context is required for lab_code: {lab_code}",
                )
    if message_type == "EXPERIMENT_ENDED" and not run:
        raise ValueError(f"active experiment run is required for lab_code: {lab_code}")
    if message_type == "EXPERIMENT_RESULT" and not run:
        raise ValueError(f"experiment run is required for lab_code: {lab_code}")
    if message_type == "EXPERIMENT_ENDED" and run_axis_codes(run) and not payload_axis_code:
        raise ValueError("axis_code is required for axis-aware experiment end")
    context_task_no = normalize_text((run or {}).get("task_no")) or normalize_text((context or {}).get("task_no"))
    authoritative_context = created_run_from_context or started_existing_axis or message_type in {"EXPERIMENT_ENDED", "EXPERIMENT_RESULT"}
    if fixture_installation:
        task_no = fixture_installation["task_code"]
    elif authoritative_context:
        task_no = context_task_no or first_text(payload, "task_code")
    else:
        task_no = first_text(payload, "task_code") or context_task_no
    if not task_no:
        raise ValueError("task_code is required")
    context_experiment_no = normalize_text((run or {}).get("experiment_no")) or normalize_text((context or {}).get("experiment_no"))
    if fixture_installation:
        experiment_no = fixture_installation["experiment_code"]
    elif authoritative_context:
        experiment_no = context_experiment_no or first_text(payload, "experiment_code")
    else:
        experiment_no = first_text(payload, "experiment_code") or context_experiment_no
    context_sub_experiment_code = record_sub_experiment_code(run or {}) or record_sub_experiment_code(context or {})
    sub_experiment_code = context_sub_experiment_code or payload_sub_experiment_code
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
            "sub_experiment_code": sub_experiment_code,
            "qos": None,
            "retain_flag": False,
            "payload": payload,
            "process_status": "PROCESSED",
            "error_code": "",
            "error_message": "",
        }
    )

    if message_type in {"FIXTURE_READY", "EXPERIMENT_STARTED", "EXPERIMENT_ENDED"}:
        event_record = {
            "event_type": message_type,
            "task_no": task_no,
            "experiment_no": experiment_no,
            "sub_experiment_code": sub_experiment_code,
            "lab_code": lab_code,
            "success_id": first_text(payload, "success_id", "success_sig", "successSig"),
            "event_time": occurred_at,
            "message_id": message_id,
            "message_log_id": message_log_id,
            "payload": payload,
        }
        if run_no:
            event_record["run_no"] = run_no
        repo.record_event(event_record)

    if message_type == "FIXTURE_READY" and fixture_installation and fixture_installation["status"] == FIXTURE_INSTALL_PENDING:
        apply_pending_fixture_ready(fixture_installation, occurred_at)
        mark_fixture_installation_ready(fixture_install_id)
    elif message_type == "EXPERIMENT_STARTED":
        if started_existing_axis:
            repo.mark_axis_step_started(run_no, payload_axis_code, occurred_at)
        elif not created_run_from_context:
            repo.mark_run_started(run_no, occurred_at)
        get_attendance_service().start_work_interval(
            lab_code=lab_code,
            lab_name=normalize_text((run or {}).get("device_name") or (run or {}).get("device")),
            run_no=run_no,
            task_code=task_no,
            experiment_code=experiment_no,
            source="mqtt",
            started_at=occurred_at,
        )
    elif message_type == "EXPERIMENT_ENDED":
        repo.mark_run_ended(run_no, occurred_at, payload_axis_code, payload_next_axis_code, sub_experiment_code)
        if should_finish_work_interval_for_completion(axis_code=payload_axis_code, next_axis_code=payload_next_axis_code):
            get_attendance_service().finish_work_interval(
                run_no=run_no,
                lab_code=lab_code,
                ended_at=occurred_at,
            )
    elif message_type == "EXPERIMENT_RESULT":
        result_package = payload.get("result_package")
        if not isinstance(result_package, dict):
            raise ValueError("result_package is required")
        repo.record_result(
            {
                "task_no": task_no,
                "experiment_no": experiment_no,
                "sub_experiment_code": sub_experiment_code,
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
