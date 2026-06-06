from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from typing import Any

from app.core.config import Settings, settings
from app.db.session import get_connection
from app.services.mq_event_processor import MySQLMqEventRepository, normalize_text


COMMAND_TOPICS = {
    "INSTALL_FIXTURE": "fixture-install",
    "READY": "experiment-ready",
}
BEIJING_TZ = timezone(timedelta(hours=8))


def now_message_text() -> str:
    return datetime.now(BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S.%f")


def build_laboratory_topic(command: str, lab_code: str, app_settings: Settings = settings) -> str:
    topic_name = COMMAND_TOPICS.get(command, command.lower().replace("_", "-"))
    prefix = str(app_settings.MQTT_TOPIC_PREFIX or "mes/v1").strip().strip("/")
    normalized_lab_code = str(lab_code or "").strip()
    return f"{prefix}/labs/{normalized_lab_code}/commands/{topic_name}"


def publish_laboratory_command(command: str, payload: dict[str, Any], app_settings: Settings = settings) -> dict[str, Any]:
    topic = build_laboratory_topic(command, str(payload.get("lab_code") or ""), app_settings)
    result = publish_mqtt_json(topic, payload, app_settings)
    record_laboratory_command(command, topic, payload, result)
    return result


def record_laboratory_command(command: str, topic: str, payload: dict[str, Any], publish_result: dict[str, Any]) -> None:
    lab_code = normalize_text(payload.get("lab_code"))
    task_no = normalize_text(payload.get("task_code"))
    if not lab_code:
        return
    message_id = f"MES-{command}-{lab_code}-{task_no or 'NO_TASK'}-{now_message_text()}"
    try:
        MySQLMqEventRepository().record_message(
            {
                "message_id": message_id,
                "direction": "MES_TO_HOST",
                "topic": topic,
                "message_type": command,
                "correlation_id": "",
                "lab_code": lab_code,
                "task_no": task_no,
                "experiment_no": normalize_text(payload.get("experiment_code")),
                "qos": None,
                "retain_flag": False,
                "payload": payload,
                "process_status": "PROCESSED" if publish_result.get("published") else "SKIPPED",
                "error_code": "",
                "error_message": normalize_text(publish_result.get("reason")),
            }
        )
        bind_laboratory_context(payload)
    except Exception:
        return


def bind_laboratory_context(payload: dict[str, Any]) -> None:
    lab_code = normalize_text(payload.get("lab_code"))
    task_no = normalize_text(payload.get("task_code"))
    experiment_no = normalize_text(payload.get("experiment_code"))
    if not lab_code or not task_no:
        return
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT lab_id
                FROM md_lab
                WHERE lab_code = %s
                LIMIT 1
                """,
                (lab_code,),
            )
            row = cursor.fetchone()
            lab_id = row.get("lab_id") if isinstance(row, dict) else row[0] if row else None
            if not lab_id:
                return
            experiment_join = ""
            experiment_filter = ""
            params: tuple[Any, ...]
            if experiment_no:
                experiment_join = """
                JOIN biz_experiment_tray et
                  ON et.task_no = task.task_no
                 AND et.tray_no = tr.tray_no
                """
                experiment_filter = "AND et.experiment_no = %s"
                params = (lab_id, task_no, experiment_no)
            else:
                params = (lab_id, task_no)
            cursor.execute(
                f"""
                UPDATE biz_tray tr
                JOIN biz_tray_item ti ON ti.tray_id = tr.tray_id
                JOIN biz_sample sm ON sm.sample_id = ti.sample_id
                JOIN biz_task task ON task.task_id = sm.task_id
                {experiment_join}
                SET tr.current_lab_id = %s
                WHERE task.task_no = %s
                  {experiment_filter}
                  AND (
                    ti.status IN (
                      '已到达实验室',
                      '工装夹具安装',
                      '实验准备就绪',
                      '实验进行中'
                    )
                    OR tr.test_state IN (
                      '已到达实验室',
                      '工装夹具安装',
                      '实验准备就绪',
                      '实验进行中'
                    )
                    OR (
                      COALESCE(ti.status, '') = ''
                      AND COALESCE(tr.test_state, '') = ''
                      AND (
                        sm.sample_status IN (
                          '已到达实验室',
                          '工装夹具安装',
                          '实验准备就绪',
                          '实验进行中'
                        )
                        OR sm.flow_status IN (
                          '已到达实验室',
                          '工装夹具安装',
                          '实验准备就绪',
                          '实验进行中'
                        )
                      )
                    )
                  )
                """,
                params,
            )
        connection.commit()


def publish_mqtt_json(topic: str, payload: dict[str, Any], app_settings: Settings = settings) -> dict[str, Any]:
    if not app_settings.MQTT_ENABLED:
        return {
            "published": False,
            "reason": "disabled",
            "topic": topic,
        }

    try:
        import paho.mqtt.client as mqtt
    except ImportError as exc:
        raise RuntimeError("paho-mqtt is required when MQTT_ENABLED=true") from exc

    client = mqtt.Client()
    username = str(app_settings.MQTT_USERNAME or "").strip()
    if username:
        client.username_pw_set(username, str(app_settings.MQTT_PASSWORD or ""))

    payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    loop_started = False
    try:
        client.connect(str(app_settings.MQTT_HOST), int(app_settings.MQTT_PORT), keepalive=60)
        client.loop_start()
        loop_started = True
        result = client.publish(topic, payload_text, qos=int(app_settings.MQTT_QOS), retain=False)
        result.wait_for_publish(timeout=10)
    finally:
        if loop_started:
            client.loop_stop()
        client.disconnect()

    return {
        "published": result.rc == 0,
        "reason": "" if result.rc == 0 else f"publish_rc_{result.rc}",
        "topic": topic,
    }
