"""Boundary for generic HTTP snapshot edits; internal workflow commits do not use it."""
from typing import Any

from app.core.storage_backend import _normalize_value, normalize_experiment_status_text
from app.services.storage_atomic import generic_item_key


PUBLIC_WRITABLE_STORAGE_KEYS = frozenset({
    "mes.tasks", "mes.external_task_intakes", "mes.schedules", "mes.experiments",
    "mes.experiment_runs", "mes.experiment_run_trays", "mes.experiment_run_steps",
    "mes.experiment_trays", "mes.experiment_samples", "mes.samples", "mes.staging_events",
    "mes.devices", "mes.maintenance_records", "mes.streams", "mes.conflicts",
    "mes.test_data_settings", "mes.test_data_exports",
})
WORKFLOW_ONLY_COLLECTIONS = ("mes.experiment_runs", "mes.experiment_run_trays", "mes.experiment_run_steps")
MANAGED_STATUSES = frozenset({
    "已到达实验室", "工装夹具安装", "实验准备就绪", "试验中", "实验进行中", "实验暂停",
    "等待恢复实验", "实验已恢复", "实验已停止", "实验已完成", "实验已取消",
    "设备故障试验取消", "霉菌取消后恢复处理中", "实验异常终止",
})
MANAGED_ACTIONS = frozenset({
    "任务比对", "样品安装", "实验确认", "开始实验", "实验开始", "实验完成", "继续实验",
    "暂停实验", "异常终止实验", "取消本次霉菌实验", "设备故障试验取消",
    "继续实验任务比对", "继续实验样品安装", "继续实验准备确认",
})
DETAIL = "实验状态由实验间操作和上位机确认维护，请使用对应业务入口"


def text(value: Any) -> str:
    return str(value or "").strip()


def rows(value: Any) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def status(value: Any) -> str:
    return normalize_experiment_status_text(text(value))


def managed(value: Any) -> bool:
    value = status(value)
    return value in MANAGED_STATUSES or ("部分完成" in value and value.endswith("轴")) or value.endswith(("试验进行中", "试验已完成"))


def changed_managed_status(current: dict, incoming: dict) -> bool:
    for field in ("status", "flow_status", "flowStatus", "run_status", "run_tray_status", "tray_status", "trayStatus"):
        before, after = status(current.get(field)), status(incoming.get(field))
        if before != after and (
            managed(after)
            or (managed(before) and after in {"", "样品运输中", "运输中", "到货", "未入库"})
        ):
            return True
    return False


def validate_public_storage_keys(keys) -> None:
    if any(key not in PUBLIC_WRITABLE_STORAGE_KEYS for key in keys):
        raise ValueError("该数据仅允许系统业务流程更新")


def validate_public_storage_write(snapshot: dict[str, Any], updates: dict[str, Any]) -> None:
    for key in WORKFLOW_ONLY_COLLECTIONS:
        if key not in updates:
            continue
        before = {generic_item_key(key, row): row for row in rows(_normalize_value(key, snapshot.get(key, [])))}
        after = {generic_item_key(key, row): row for row in rows(_normalize_value(key, updates[key]))}
        if before != after:
            raise ValueError(DETAIL)

    for key in ("mes.experiments", "mes.schedules"):
        if key not in updates:
            continue
        current = {generic_item_key(key, row): row for row in rows(snapshot.get(key))}
        for row in rows(updates[key]):
            if changed_managed_status(current.get(generic_item_key(key, row), {}), row):
                raise ValueError(DETAIL)

    current_samples = {text(row.get("code") or row.get("id")): row for row in rows(_normalize_value("mes.samples", snapshot.get("mes.samples", [])))}
    for sample in rows(_normalize_value("mes.samples", updates.get("mes.samples", []))):
        current = current_samples.get(text(sample.get("code") or sample.get("id")), {})
        if changed_managed_status(current, sample):
            raise ValueError(DETAIL)
        old_trays = {text(row.get("tray_code") or row.get("trayCode")): row for row in rows(current.get("trays"))}
        for tray in rows(sample.get("trays")):
            old = old_trays.get(text(tray.get("tray_code") or tray.get("trayCode")), {})
            if changed_managed_status(old, tray):
                raise ValueError(DETAIL)
            if bool(old.get("fixture_ready") or old.get("fixtureReady")) != bool(tray.get("fixture_ready") or tray.get("fixtureReady")):
                raise ValueError(DETAIL)
        old_history = rows(current.get("history"))
        for entry in rows(sample.get("history")):
            if entry in old_history:
                continue
            action = text(entry.get("action"))
            if action in MANAGED_ACTIONS or (managed(entry.get("status")) and action not in {"样品详情更新", "备注更新"}):
                raise ValueError(DETAIL)
