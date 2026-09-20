"""Append-only consumable accounting, shared by every workflow storage writer.

The private snapshot is row-locked and committed in the SAME transaction as the
experiment state. It is deliberately not a writable /api/storage key.
"""
from __future__ import annotations

import json
from typing import Any

from app.core.time_utils import now_business_text

RESOURCE_LEDGER_KEY = "mes.resource_inventory"
RESOURCE_NAMES = {"salt": "盐雾", "mold": "霉菌"}
BASE_QUANTITY = 100
CONSUMPTION_PER_RUN = {"salt": 10, "mold": 20}
PENDING_STATUSES = {"", "待排程", "已排程", "待开始", "待实验", "实验准备就绪", "待确认"}


def text(value: Any) -> str:
    return str(value or "").strip()


def resource_for_run(run: dict) -> str:
    device = text(run.get("device") or run.get("device_name"))
    return next((key for key, name in RESOURCE_NAMES.items() if name in device), "")


def consumption_entries(runs: list[dict], relations: list[dict]) -> list[dict]:
    """Charge the fixed recipe once per run, regardless of tray/message count."""
    relations_by_run: dict[str, list[dict]] = {}
    for relation in relations:
        relations_by_run.setdefault(text(relation.get("run_no")), []).append(relation)
    entries: dict[str, dict] = {}
    for run in runs:
        run_no = text(run.get("run_no"))
        resource = resource_for_run(run)
        if not run_no or not resource:
            continue
        status = text(run.get("status") or run.get("run_status"))
        if status in PENDING_STATUSES:
            continue
        linked = relations_by_run.get(run_no, [])
        if not linked:
            linked = [{"tray_code": code} for code in run.get("tray_codes", [])]
        started = text(run.get("started_at")) or next(
            (text(relation.get("started_at")) for relation in linked if text(relation.get("started_at"))), "",
        )
        if not started:
            continue
        entry_id = json.dumps([resource, run_no], ensure_ascii=False, separators=(",", ":"))
        entries[entry_id] = {
            "id": entry_id, "kind": "consume", "resource": resource,
            "quantity": CONSUMPTION_PER_RUN[resource], "run_no": run_no, "time": started,
        }
    return list(entries.values())


def merge_consumption(ledger: list[dict], candidates: list[dict]) -> list[dict]:
    result = list(ledger)
    seen = {entry.get("id") for entry in ledger}
    # Existing per-tray debits remain historical facts. A replay of a legacy run
    # must not charge its new run-level recipe on top of the recorded quantity.
    seen_runs = {(entry.get("resource"), entry.get("run_no")) for entry in ledger if entry.get("kind") == "consume"}
    for entry in candidates:
        run_key = (entry["resource"], entry["run_no"])
        if entry["id"] not in seen and run_key not in seen_runs:
            result.append(entry)
            seen.add(entry["id"])
            seen_runs.add(run_key)
    return result


def inventory_summary(ledger: list[dict]) -> dict:
    resources = []
    for key, name in RESOURCE_NAMES.items():
        used = sum(row["quantity"] for row in ledger if row.get("resource") == key and row.get("kind") == "consume")
        added = sum(row["quantity"] for row in ledger if row.get("resource") == key and row.get("kind") == "replenish")
        balance = BASE_QUANTITY + added - used
        resources.append({
            "key": key, "name": name, "capacity": BASE_QUANTITY,
            "remaining": max(0, balance), "used": used, "replenished": added,
            "deficit": max(0, -balance),
        })
    records = sorted(
        (row for row in ledger if row.get("kind") == "replenish"),
        key=lambda row: row["time"], reverse=True,
    )[:50]
    return {"resources": resources, "records": records}


def append_replenishment(ledger: list[dict], *, resource: str, quantity: int, request_id: str, note: str, operator: str) -> list[dict]:
    if resource not in RESOURCE_NAMES or type(quantity) is not int or not 1 <= quantity <= 10000:
        raise ValueError("补充数量必须为 1–10000 的整数，且仅支持盐雾、霉菌")
    entry_id = f"replenish:{request_id}"
    existing = next((row for row in ledger if row.get("id") == entry_id), None)
    if existing:
        if (existing["resource"], existing["quantity"], existing["note"], existing["operator"]) != (resource, quantity, note, operator):
            raise ValueError("此请求编号已用于其他补充记录，请刷新后重试")
        return ledger
    before = next(row for row in inventory_summary(ledger)["resources"] if row["key"] == resource)
    return [*ledger, {
        "id": entry_id, "kind": "replenish", "resource": resource, "quantity": quantity,
        "before": before["remaining"], "after": max(0, before["remaining"] - before["deficit"] + quantity),
        "note": note, "operator": operator, "time": now_business_text(),
    }]


def read_ledger(cursor: Any, *, lock: bool = False) -> tuple[list[dict], bool]:
    if lock:
        cursor.execute(
            "INSERT INTO app_storage_snapshot (storage_key, payload_json) VALUES (%s, %s) "
            "ON DUPLICATE KEY UPDATE storage_key=VALUES(storage_key)",
            (RESOURCE_LEDGER_KEY, "[]"),
        )
    cursor.execute(
        "SELECT payload_json FROM app_storage_snapshot WHERE storage_key=%s" + (" FOR UPDATE" if lock else ""),
        (RESOURCE_LEDGER_KEY,),
    )
    row = cursor.fetchone()
    payload = json.loads(row["payload_json"]) if row else []
    if not isinstance(payload, list):
        raise ValueError("资源库存记录格式错误，请联系管理员")
    initialized = any(item.get("kind") == "initialized" for item in payload)
    return payload, initialized


def load_existing_usage(cursor: Any) -> list[dict]:
    # Preserve recorded historical starts on first use; pending runs do not consume.
    cursor.execute("""
        SELECT er.run_no, er.device_name, er.run_status, er.started_at,
               rt.tray_no, rt.started_at AS tray_started_at
        FROM biz_experiment_run er
        INNER JOIN biz_experiment_run_tray rt ON rt.run_no=er.run_no
        WHERE er.device_name LIKE %s OR er.device_name LIKE %s
    """, ("%盐雾%", "%霉菌%"))
    entries = []
    for row in cursor.fetchall():
        entries.extend(consumption_entries([row], [{
            "run_no": row["run_no"], "tray_no": row["tray_no"], "started_at": row.get("tray_started_at"),
        }]))
    return entries


def write_ledger(cursor: Any, ledger: list[dict]) -> None:
    cursor.execute(
        "UPDATE app_storage_snapshot SET payload_json=%s, updated_at=CURRENT_TIMESTAMP WHERE storage_key=%s",
        (json.dumps(ledger, ensure_ascii=False), RESOURCE_LEDGER_KEY),
    )


def reset_resource_inventory(cursor: Any) -> None:
    """Explicit system reset only, in the same transaction as workflow reset.

    Retain an initialization marker so an empty inventory never bootstraps
    pre-reset history. Ordinary task deletion must NOT reset this ledger.
    """
    read_ledger(cursor, lock=True)
    write_ledger(cursor, [{"id": "initialized:v1", "kind": "initialized"}])


def capture_resource_consumption(cursor: Any, updates: dict) -> None:
    if not {"mes.experiment_runs", "mes.experiment_run_trays"}.intersection(updates):
        return
    ledger, initialized = read_ledger(cursor, lock=True)
    if not initialized:
        ledger = merge_consumption(ledger, load_existing_usage(cursor))
        ledger.append({"id": "initialized:v1", "kind": "initialized"})
    runs = updates.get("mes.experiment_runs", [])
    relations = updates.get("mes.experiment_run_trays", [])
    # A partial relation-only write still uses the authoritative stored run.
    missing_runs = sorted({text(row.get("run_no")) for row in relations} - {text(row.get("run_no")) for row in runs} - {""})
    if missing_runs:
        placeholders = ",".join(["%s"] * len(missing_runs))
        cursor.execute(
            f"SELECT run_no, device_name, run_status, started_at FROM biz_experiment_run WHERE run_no IN ({placeholders})",
            missing_runs,
        )
        runs = [*runs, *cursor.fetchall()]
    updated = merge_consumption(ledger, consumption_entries(runs, relations))
    if not initialized or updated != ledger:
        write_ledger(cursor, updated)


def read_inventory(cursor: Any) -> dict:
    ledger, initialized = read_ledger(cursor)
    if not initialized:
        ledger = merge_consumption(ledger, load_existing_usage(cursor))
    return inventory_summary(ledger)


def replenish_inventory(cursor: Any, **kwargs: Any) -> dict:
    ledger, initialized = read_ledger(cursor, lock=True)
    if not initialized:
        ledger = merge_consumption(ledger, load_existing_usage(cursor))
        ledger.append({"id": "initialized:v1", "kind": "initialized"})
    updated = append_replenishment(ledger, **kwargs)
    if not initialized or updated != ledger:
        write_ledger(cursor, updated)
    return inventory_summary(updated)
