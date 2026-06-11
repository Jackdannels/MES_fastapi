from __future__ import annotations

from typing import Any


def list_test_types(backend: Any) -> list[dict[str, Any]]:
    backend._ensure_schema_extensions()
    with backend._connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                  test_type_id, test_type_code, test_type_name, test_category,
                  default_duration_hour, status, remark
                FROM md_test_type
                WHERE COALESCE(status, 1) = 1
                ORDER BY test_type_id
                """
            )
            return [dict(row) for row in cursor.fetchall()]


def list_labs(backend: Any) -> list[dict[str, Any]]:
    backend._ensure_schema_extensions()
    with backend._connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                  l.lab_id, l.lab_code, l.lab_name, l.lab_type, l.test_type_id,
                  tt.test_type_code, tt.test_type_name, l.capacity, l.location_desc,
                  l.status, l.remark
                FROM md_lab l
                LEFT JOIN md_test_type tt ON tt.test_type_id = l.test_type_id
                WHERE COALESCE(l.status, 1) = 1
                ORDER BY l.lab_id
                """
            )
            return [dict(row) for row in cursor.fetchall()]
