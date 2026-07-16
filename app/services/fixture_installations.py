from __future__ import annotations

from typing import Any

from app.core.mysql_storage_codecs import normalize_text
from app.core.storage_backend import get_storage_backend
from app.db.session import get_connection
from app.services.laboratory_operations import (
    apply_laboratory_task_operation,
    operation_resource_keys,
    run_atomic_laboratory_operation,
)


PENDING = "PENDING"
READY = "READY"
SUPERSEDED = "SUPERSEDED"
FAILED = "FAILED"
FIXTURE_INSTALLATION_COLUMNS = (
    "fixture_install_id",
    "tray_no",
    "task_no",
    "experiment_no",
    "lab_code",
    "status",
)


def normalize_tray_codes(value: Any) -> list[str]:
    raw_values = value if isinstance(value, list) else []
    return list(dict.fromkeys(normalize_text(item) for item in raw_values if normalize_text(item)))


def normalize_fixture_installation_row(row: Any) -> dict[str, Any] | None:
    if isinstance(row, dict):
        return row
    if isinstance(row, (tuple, list)) and len(row) >= len(FIXTURE_INSTALLATION_COLUMNS):
        return dict(zip(FIXTURE_INSTALLATION_COLUMNS, row))
    return None


def register_pending_fixture_installation(
    *,
    fixture_install_id: str,
    task_code: str,
    experiment_code: str,
    lab_code: str,
    tray_codes: list[str],
) -> None:
    normalized_id = normalize_text(fixture_install_id)
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_lab_code = normalize_text(lab_code)
    normalized_tray_codes = normalize_tray_codes(tray_codes)
    if not all((normalized_id, normalized_task_code, normalized_experiment_code, normalized_lab_code)):
        raise ValueError("fixture_install_id、task_code、experiment_code 和 lab_code 均不能为空")
    if not normalized_tray_codes:
        raise ValueError("tray_codes 不能为空")

    placeholders = ", ".join(["%s"] * len(normalized_tray_codes))
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                UPDATE biz_fixture_install_pending
                SET status = '{SUPERSEDED}', updated_at = NOW()
                WHERE task_no = %s
                  AND experiment_no = %s
                  AND lab_code = %s
                  AND tray_no IN ({placeholders})
                  AND status IN ('{PENDING}', '{READY}')
                """,
                (normalized_task_code, normalized_experiment_code, normalized_lab_code, *normalized_tray_codes),
            )
            cursor.executemany(
                """
                INSERT INTO biz_fixture_install_pending (
                  fixture_install_id, tray_no, task_no, experiment_no, lab_code, status, requested_at
                ) VALUES (%s, %s, %s, %s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE
                  task_no = VALUES(task_no),
                  experiment_no = VALUES(experiment_no),
                  lab_code = VALUES(lab_code),
                  status = VALUES(status),
                  requested_at = NOW(),
                  ready_at = NULL
                """,
                [
                    (
                        normalized_id,
                        tray_code,
                        normalized_task_code,
                        normalized_experiment_code,
                        normalized_lab_code,
                        PENDING,
                    )
                    for tray_code in normalized_tray_codes
                ],
            )
        connection.commit()


def find_fixture_installation(fixture_install_id: str) -> dict[str, Any] | None:
    normalized_id = normalize_text(fixture_install_id)
    if not normalized_id:
        return None
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT fixture_install_id, tray_no, task_no, experiment_no, lab_code, status
                FROM biz_fixture_install_pending
                WHERE fixture_install_id = %s
                ORDER BY tray_no
                """,
                (normalized_id,),
            )
            rows = cursor.fetchall()
    if not rows:
        return None
    normalized_rows = [normalized for row in rows if (normalized := normalize_fixture_installation_row(row)) is not None]
    if not normalized_rows:
        return None
    first = normalized_rows[0]
    return {
        "fixture_install_id": normalize_text(first.get("fixture_install_id")),
        "task_code": normalize_text(first.get("task_no")),
        "experiment_code": normalize_text(first.get("experiment_no")),
        "lab_code": normalize_text(first.get("lab_code")),
        "status": normalize_text(first.get("status")),
        "tray_codes": [
            normalize_text(row.get("tray_no"))
            for row in normalized_rows
            if normalize_text(row.get("tray_no"))
        ],
    }


def mark_fixture_installation_ready(fixture_install_id: str) -> bool:
    normalized_id = normalize_text(fixture_install_id)
    if not normalized_id:
        return False
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE biz_fixture_install_pending
                SET status = %s, ready_at = NOW(), updated_at = NOW()
                WHERE fixture_install_id = %s
                  AND status = %s
                """,
                (READY, normalized_id, PENDING),
            )
            changed = bool(cursor.rowcount)
        connection.commit()
    return changed


def mark_fixture_installation_failed(fixture_install_id: str) -> None:
    normalized_id = normalize_text(fixture_install_id)
    if not normalized_id:
        return
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE biz_fixture_install_pending
                SET status = %s, updated_at = NOW()
                WHERE fixture_install_id = %s
                  AND status = %s
                """,
                (FAILED, normalized_id, PENDING),
            )
        connection.commit()


def apply_pending_fixture_ready(installation: dict[str, Any], occurred_at: str) -> dict[str, Any]:
    task_code = normalize_text(installation.get("task_code"))
    experiment_code = normalize_text(installation.get("experiment_code"))
    lab_code = normalize_text(installation.get("lab_code"))
    tray_codes = normalize_tray_codes(installation.get("tray_codes"))
    return run_atomic_laboratory_operation(
        storage=get_storage_backend(),
        operation=lambda snapshot: apply_laboratory_task_operation(
            snapshot,
            operation_type="fixtureReady",
            task_code=task_code,
            experiment_code=experiment_code,
            lab_name=lab_code,
            tray_codes=tray_codes,
            occurred_at=occurred_at,
        ),
        publish_storage_update=None,
        resource_keys=operation_resource_keys(lab_code=lab_code, tray_codes=tray_codes),
    )
