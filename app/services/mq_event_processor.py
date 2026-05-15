from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Protocol

from app.db.session import get_connection


PROTOCOL_NAME = "MES_LAB_MQTT"
ACK_MESSAGE_TYPE = "EVENT_ACK"

EVENT_TYPES = {
    "FIXTURE_READY",
    "EXPERIMENT_STARTED",
    "EXPERIMENT_ENDED",
    "EXPERIMENT_RESULT",
}


class MqEventRepository(Protocol):
    def message_exists(self, message_id: str) -> bool: ...

    def record_message(self, message: dict[str, Any]) -> int: ...

    def record_event(self, event: dict[str, Any]) -> None: ...

    def record_result(self, result: dict[str, Any]) -> None: ...

    def mark_experiment_started(self, task_no: str, experiment_no: str, occurred_at: str) -> None: ...

    def mark_experiment_ended(self, task_no: str, experiment_no: str, occurred_at: str) -> None: ...


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def build_ack(correlation_id: str, status: str, error_code: str = "", error_message: str = "") -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_NAME,
        "version": "1.0",
        "messageType": ACK_MESSAGE_TYPE,
        "messageId": f"MES-ACK-{correlation_id}" if correlation_id else "",
        "correlationId": correlation_id,
        "status": status,
        "errorCode": error_code,
        "errorMessage": error_message,
        "processedAt": now_iso(),
    }


def require_text(payload: dict[str, Any], key: str) -> str:
    value = normalize_text(payload.get(key))
    if not value:
        raise ValueError(f"{key} is required")
    return value


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


def process_laboratory_event(
    topic: str,
    payload: dict[str, Any],
    *,
    repository: MqEventRepository | None = None,
) -> dict[str, Any]:
    repo = repository or MySQLMqEventRepository()
    message_id = require_text(payload, "messageId")
    message_type = normalize_text(payload.get("messageType") or payload.get("event"))
    if message_type not in EVENT_TYPES:
        raise ValueError(f"Unsupported messageType: {message_type}")
    if repo.message_exists(message_id):
        return build_ack(message_id, "DUPLICATE")

    task_no = require_text(payload, "taskId")
    lab_code = require_text(payload, "labId")
    experiment_no = normalize_text(payload.get("experimentId"))
    occurred_at = normalize_text(payload.get("occurredAt") or payload.get("time"))
    correlation_id = normalize_text(payload.get("correlationId"))
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
        if message_type in {"EXPERIMENT_STARTED", "EXPERIMENT_ENDED"} and not experiment_no:
            raise ValueError("experimentId is required")
        repo.record_event(
            {
                "event_type": message_type,
                "task_no": task_no,
                "experiment_no": experiment_no,
                "lab_code": lab_code,
                "success_id": normalize_text(payload.get("successId")),
                "event_time": occurred_at,
                "message_id": message_id,
                "message_log_id": message_log_id,
                "payload": payload,
            }
        )

    if message_type == "EXPERIMENT_STARTED":
        repo.mark_experiment_started(task_no, experiment_no, occurred_at)
    elif message_type == "EXPERIMENT_ENDED":
        repo.mark_experiment_ended(task_no, experiment_no, occurred_at)
    elif message_type == "EXPERIMENT_RESULT":
        if not experiment_no:
            raise ValueError("experimentId is required")
        result_package = payload.get("resultPackage")
        if not isinstance(result_package, dict):
            raise ValueError("resultPackage is required")
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

    return build_ack(message_id, "PROCESSED")
