from __future__ import annotations

from typing import Any

from app.core.mysql_storage_codecs import SAMPLE_META_PREFIX, normalize_text
from app.core.storage_backend import normalize_experiment_status_text


def load_operational_samples(cursor: Any, *, task_codes: set[str] | None = None) -> list[dict[str, Any]]:
    """Load the bounded sample projection consumed by dashboard and visualization reads."""

    normalized_task_codes = sorted({normalize_text(code) for code in (task_codes or set()) if normalize_text(code)})
    task_scope = ""
    params: list[Any] = [f"{SAMPLE_META_PREFIX}%"]
    if normalized_task_codes:
        placeholders = ", ".join(["%s"] * len(normalized_task_codes))
        task_scope = f" AND t.task_no IN ({placeholders})"
        params.extend(normalized_task_codes)

    cursor.execute(
        f"""
        SELECT s.sample_id, s.sample_no, t.task_no, s.sample_type, s.location_desc,
               s.sample_status, s.flow_status, s.updated_at
        FROM biz_sample s
        LEFT JOIN biz_task t ON t.task_id = s.task_id
        WHERE s.remark LIKE %s{task_scope}
        ORDER BY s.created_at DESC, s.sample_no DESC
        """,
        params,
    )
    sample_rows = cursor.fetchall()
    if not sample_rows:
        return []

    sample_ids = [row["sample_id"] for row in sample_rows]
    placeholders = ", ".join(["%s"] * len(sample_ids))
    cursor.execute(
        f"""
        SELECT ti.sample_id, tr.tray_no, ti.quantity, ti.status AS tray_item_status,
               tr.test_state, tr.tray_status, tr.fixture_ready,
               tr.target_sub_experiment_code, ti.updated_at
        FROM biz_tray_item ti
        INNER JOIN biz_tray tr ON tr.tray_id = ti.tray_id
        WHERE ti.sample_id IN ({placeholders})
        ORDER BY ti.created_at DESC, tr.tray_no ASC
        """,
        sample_ids,
    )
    trays_by_sample: dict[Any, list[dict[str, Any]]] = {}
    for row in cursor.fetchall():
        tray_code = normalize_text(row.get("tray_no"))
        if not tray_code:
            continue
        target_experiment_code = normalize_text(row.get("target_sub_experiment_code"))
        fixture_ready = bool(row.get("fixture_ready"))
        trays_by_sample.setdefault(row.get("sample_id"), []).append({
            "id": tray_code,
            "tray_code": tray_code,
            "quantity": int(row.get("quantity") or 0),
            "status": normalize_experiment_status_text(
                row.get("tray_item_status") or row.get("test_state") or row.get("tray_status")
            ),
            "fixture_ready": fixture_ready,
            "fixtureReady": fixture_ready,
            "target_experiment_code": target_experiment_code,
            "targetExperimentCode": target_experiment_code,
            "updated_at": row.get("updated_at"),
        })

    samples: list[dict[str, Any]] = []
    for row in sample_rows:
        sample_code = normalize_text(row.get("sample_no"))
        location = normalize_text(row.get("location_desc"))
        samples.append({
            "id": sample_code,
            "code": sample_code,
            "sample_code": sample_code,
            "task_code": normalize_text(row.get("task_no")),
            "sample_type": normalize_text(row.get("sample_type")),
            "location": location,
            "current_location": location,
            "status": normalize_experiment_status_text(row.get("sample_status")),
            "flow_status": normalize_experiment_status_text(row.get("flow_status")),
            "updated_at": row.get("updated_at"),
            "trays": trays_by_sample.get(row.get("sample_id"), []),
            "history": [],
        })
    return samples


__all__ = ["load_operational_samples"]
