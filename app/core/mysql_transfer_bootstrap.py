from __future__ import annotations

from typing import Any

from app.core.mysql_storage_codecs import SAMPLE_META_PREFIX, normalize_text
from app.core.storage_backend import normalize_experiment_status_text


TRANSFER_HISTORY_ACTIONS = ("样品分装托盘", "任务已确认入库", "任务重新载装", "任务重新入库")


def load_transfer_bootstrap_samples(cursor: Any) -> list[dict[str, Any]]:
    """Load only the sample fields consumed by the transfer overview."""

    history_placeholders = ", ".join(["%s"] * len(TRANSFER_HISTORY_ACTIONS))
    cursor.execute(
        f"""
        SELECT s.sample_id, s.sample_no, t.task_no, s.sample_status, s.flow_status,
               ti.quantity AS tray_quantity, ti.status AS tray_item_status,
               tr.tray_no, tr.test_state, tr.tray_status,
               EXISTS (
                 SELECT 1
                 FROM biz_sample_event transfer_event
                 WHERE transfer_event.sample_id = s.sample_id
                   AND transfer_event.action_type IN ({history_placeholders})
               ) AS has_transfer_history
        FROM biz_sample s
        LEFT JOIN biz_task t ON t.task_id = s.task_id
        LEFT JOIN biz_tray_item ti ON ti.sample_id = s.sample_id
        LEFT JOIN biz_tray tr ON tr.tray_id = ti.tray_id
        WHERE s.remark LIKE %s
        ORDER BY s.created_at DESC, s.sample_no DESC, tr.tray_no ASC
        """,
        [*TRANSFER_HISTORY_ACTIONS, f"{SAMPLE_META_PREFIX}%"],
    )
    rows = cursor.fetchall()
    samples_by_id: dict[Any, dict[str, Any]] = {}
    ordered_ids: list[Any] = []
    for row in rows:
        sample_id = row.get("sample_id")
        sample = samples_by_id.get(sample_id)
        if sample is None:
            sample_code = normalize_text(row.get("sample_no"))
            sample = {
                "id": sample_code,
                "code": sample_code,
                "task_code": normalize_text(row.get("task_no")),
                "status": normalize_experiment_status_text(row.get("sample_status")),
                "flow_status": normalize_experiment_status_text(row.get("flow_status")),
                "trays": [],
                "history": ([{"action": TRANSFER_HISTORY_ACTIONS[0]}] if bool(row.get("has_transfer_history")) else []),
            }
            samples_by_id[sample_id] = sample
            ordered_ids.append(sample_id)

        tray_code = normalize_text(row.get("tray_no"))
        if not tray_code:
            continue
        sample["trays"].append({
            "id": tray_code,
            "tray_code": tray_code,
            "sample_code": sample["code"],
            "quantity": int(row.get("tray_quantity") or 0),
            "status": normalize_experiment_status_text(
                row.get("tray_item_status") or row.get("test_state") or row.get("tray_status")
            ),
        })

    return [samples_by_id[sample_id] for sample_id in ordered_ids]


__all__ = ["load_transfer_bootstrap_samples"]
