"""Read-only peer observations. Broker connectivity alone is not peer health."""
from __future__ import annotations

import json
from urllib import request

from app.services.laboratory_telemetry import laboratory_telemetry_store
from app.services.lims_http import _NoRedirect


def _result(state: str, detail: str) -> dict:
    return {"state": state, "detail": detail}


def probe_lims_peer(url: str) -> bool:
    # No credentials, redirects, business messages, or arbitrary browser URLs.
    req = request.Request(url, headers={"Accept": "application/json"})
    with request.build_opener(_NoRedirect).open(req, timeout=3) as response:
        payload = json.loads(response.read(65537))
        if response.status != 200 or not isinstance(payload, dict) or type(payload.get("connected")) is not bool:
            raise ValueError("Invalid peer status")
        return payload["connected"]


def lims_connection_status(app_state) -> dict:
    monitor = getattr(app_state, "lims_communication_runtime", None)
    if monitor is not None and monitor.enabled:
        try:
            state = monitor.status()
        except Exception:
            return _result("unknown", "通讯保障状态存储不可用，连接无法确认")
        if not state["running"] or state["stale"] or state["runtime_error"]:
            return _result("unknown", state["runtime_error"] or "通讯保障未运行或状态已过期")
        connection = {"online": "online", "offline": "offline", "syncing": "partial"}.get(state["phase"], "unknown")
        result = _result(connection, state["detail"])
        # Explicit UI projection, without credentials, peer URLs or message bodies.
        result["alert_details"] = {key: state.get(key) for key in (
            "phase", "alarm", "acknowledged", "retry_count", "fault_since", "last_check_at",
            "last_success_at", "next_check_at", "server_time", "retry_interval_seconds", "http", "rabbitmq",
        )}
        result["alert_details"]["history"] = [
            {key: row.get(key) for key in ("at", "kind", "detail", "retry_count")}
            for row in state.get("history", [])[:10] if isinstance(row, dict)
        ]
        if state["alarm"] != "none":
            result["alert"] = f"{'严重' if state['alarm'] == 'critical' else '普通'}告警 · 已重试 {state['retry_count']} 次"
            result["alert_severity"] = state["alarm"]
        return result
    settings = app_state.settings
    if not settings.LIMS_HEALTH_URL:
        return _result("unknown", "未配置 LIMS 对端状态接口，不能仅凭 RabbitMQ 连接判断在线")
    try:
        peer_connected = probe_lims_peer(settings.LIMS_HEALTH_URL)
    except ValueError:
        return _result("unknown", "LIMS 状态响应无效，连接未确认")
    except Exception:
        return _result("offline", "LIMS 对端状态接口不可达或请求失败")
    runtime = getattr(app_state, "lims_rabbit_runtime", None)
    local = runtime.status() if runtime else {}
    if not peer_connected or not local.get("connected"):
        return _result("offline", "LIMS 或 MES 的 RabbitMQ 链路未连接")
    return _result("online", "LIMS 对端状态探测与 MES 接收链路正常；不代表数据同步已完成")


def upper_computer_connection_status(app_state) -> dict:
    runtime = getattr(app_state, "mq_runtime", None)
    status = runtime.status() if runtime else {}
    if not status.get("mqtt_enabled"):
        return _result("unknown", "MQTT 未启用，无法确认上位机连接")
    if not status.get("subscriber_running"):
        return _result("offline", "MES 的 MQTT 接收链路未连接")
    items = laboratory_telemetry_store.list()
    if not items:
        return _result("unknown", "尚未收到上位机 MQTT 遥测，不能仅凭消息服务连接判断在线")
    online = sum(item.get("connection_status") == "online" for item in items)
    detail = f"已观测的 {len(items)} 个试验间中 {online} 个遥测正常；超时按遥测阈值判定"
    if online == len(items):
        return _result("online", detail)
    if online:
        return _result("partial", detail)
    if all(item.get("connection_status") == "offline" for item in items):
        return _result("offline", detail)
    return _result("unknown", "上位机遥测延迟或恢复确认中；" + detail)
