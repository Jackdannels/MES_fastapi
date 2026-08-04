from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.mysql_storage_codecs import SAMPLE_META_PREFIX, decode_sample_meta, normalize_text
from app.db.session import get_connection


RETURNED_STATUS = "厂家收回"


@dataclass(frozen=True)
class SampleSummaryPage:
    current_page: int
    samples: tuple[dict[str, Any], ...]
    status_options: tuple[str, ...]
    task_options: tuple[str, ...]
    total_count: int
    total_pages: int


def _first_value(row: Any, default: Any = None) -> Any:
    if isinstance(row, dict):
        return next(iter(row.values()), default)
    if isinstance(row, (list, tuple)) and row:
        return row[0]
    return default


def _rows(cursor: Any) -> list[dict[str, Any]]:
    rows = cursor.fetchall()
    if rows and isinstance(rows[0], dict):
        return [dict(row) for row in rows]
    columns = [column[0] for column in (cursor.description or [])]
    return [dict(zip(columns, row)) for row in rows]


def _page(total_count: int, requested_page: int, page_size: int) -> tuple[int, int, int]:
    total_pages = max(1, (total_count + page_size - 1) // page_size)
    current_page = min(max(requested_page, 1), total_pages)
    return current_page, total_pages, (current_page - 1) * page_size


class MySQLSamplePageQueryRepository:
    _BASE_FILTER = """
        s.remark LIKE %s
        AND (
          t.task_id IS NULL
          OR (
            COALESCE(t.transfer_status, '') <> %s
            AND COALESCE(t.task_status, '') <> %s
          )
        )
    """

    @staticmethod
    def _search_clause(query: str) -> tuple[str, list[Any]]:
        normalized = normalize_text(query)
        if not normalized:
            return "", []
        pattern = f"%{normalized}%"
        return (
            """
            AND (
              s.sample_no LIKE %s
              OR COALESCE(t.task_no, '') LIKE %s
              OR COALESCE(s.location_desc, '') LIKE %s
              OR COALESCE(s.sample_status, '') LIKE %s
              OR COALESCE(s.flow_status, '') LIKE %s
              OR COALESCE(s.remark, '') LIKE %s
              OR EXISTS (
                SELECT 1
                FROM biz_tray_item search_item
                INNER JOIN biz_tray search_tray ON search_tray.tray_id = search_item.tray_id
                WHERE search_item.sample_id = s.sample_id
                  AND search_tray.tray_no LIKE %s
              )
            )
            """,
            [pattern] * 7,
        )

    @staticmethod
    def _summary(row: dict[str, Any]) -> dict[str, Any]:
        metadata = decode_sample_meta(row.get("remark"))
        sample_code = normalize_text(row.get("sample_no"))
        tray_codes = [
            value
            for value in (normalize_text(item) for item in normalize_text(row.get("tray_codes")).split("\n"))
            if value
        ]
        return {
            "id": sample_code,
            "code": sample_code,
            "task_code": normalize_text(row.get("task_no")),
            "location": normalize_text(row.get("location_desc")),
            "owner": metadata["owner"],
            "status": normalize_text(row.get("sample_status")),
            "flow_status": normalize_text(row.get("flow_status")),
            "trayCodes": tray_codes,
        }

    def list_samples(
        self,
        *,
        page: int,
        page_size: int,
        query: str = "",
        task_code: str = "",
        status: str = "",
        sort_key: str = "code",
        sort_direction: str = "asc",
        locations: tuple[str, ...] = (),
    ) -> SampleSummaryPage:
        search_sql, search_params = self._search_clause(query)
        task_sql = ""
        task_params: list[Any] = []
        if normalize_text(task_code):
            task_sql = " AND t.task_no = %s"
            task_params.append(normalize_text(task_code))
        status_sql = ""
        status_params: list[Any] = []
        if normalize_text(status):
            status_sql = " AND s.sample_status = %s"
            status_params.append(normalize_text(status))
        normalized_locations = tuple(normalize_text(location) for location in locations if normalize_text(location))
        location_sql = ""
        location_params: list[Any] = []
        if normalized_locations:
            location_sql = f" AND s.location_desc IN ({', '.join(['%s'] * len(normalized_locations))})"
            location_params.extend(normalized_locations)
        filter_sql = f"{self._BASE_FILTER}{search_sql}{task_sql}{status_sql}{location_sql}"
        params = [
            f"{SAMPLE_META_PREFIX}%",
            RETURNED_STATUS,
            RETURNED_STATUS,
            *search_params,
            *task_params,
            *status_params,
            *location_params,
        ]
        order_columns = {
            "code": "s.sample_no",
            "task_code": "t.task_no",
            "trayCodesText": "tray_codes",
            "location": "s.location_desc",
            "status": "s.sample_status",
        }
        order_column = order_columns.get(normalize_text(sort_key), "s.sample_no")
        order_direction = "DESC" if normalize_text(sort_direction).lower() == "desc" else "ASC"
        order_sql = f"{order_column} {order_direction}"
        if order_column != "s.sample_no":
            order_sql = f"{order_sql}, s.sample_no ASC"

        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT COUNT(*) AS total_count
                    FROM biz_sample s
                    LEFT JOIN biz_task t ON t.task_id = s.task_id
                    WHERE {filter_sql}
                    """,
                    params,
                )
                total_count = int(_first_value(cursor.fetchone(), 0) or 0)
                current_page, total_pages, offset = _page(total_count, page, page_size)
                cursor.execute(
                    f"""
                    SELECT s.sample_id, s.sample_no, t.task_no, s.location_desc,
                           s.sample_status, s.flow_status, s.remark,
                           GROUP_CONCAT(DISTINCT tray.tray_no ORDER BY tray.tray_no SEPARATOR '\n') AS tray_codes
                    FROM biz_sample s
                    LEFT JOIN biz_task t ON t.task_id = s.task_id
                    LEFT JOIN biz_tray_item tray_item ON tray_item.sample_id = s.sample_id
                    LEFT JOIN biz_tray tray ON tray.tray_id = tray_item.tray_id
                    WHERE {filter_sql}
                    GROUP BY s.sample_id, s.sample_no, t.task_no, s.location_desc,
                             s.sample_status, s.flow_status, s.remark
                    ORDER BY {order_sql}
                    LIMIT %s OFFSET %s
                    """,
                    [*params, page_size, offset],
                )
                samples = tuple(self._summary(row) for row in _rows(cursor))
                facet_params = [f"{SAMPLE_META_PREFIX}%", RETURNED_STATUS, RETURNED_STATUS, *location_params]
                cursor.execute(
                    f"""
                    SELECT DISTINCT t.task_no, s.sample_status
                    FROM biz_sample s
                    LEFT JOIN biz_task t ON t.task_id = s.task_id
                    WHERE {self._BASE_FILTER}{location_sql}
                    ORDER BY t.task_no ASC, s.sample_status ASC
                    """,
                    facet_params,
                )
                facet_rows = _rows(cursor)

        return SampleSummaryPage(
            current_page=current_page,
            samples=samples,
            status_options=tuple(sorted({normalize_text(row.get("sample_status")) for row in facet_rows if normalize_text(row.get("sample_status"))})),
            task_options=tuple(sorted({normalize_text(row.get("task_no")) for row in facet_rows if normalize_text(row.get("task_no"))})),
            total_count=total_count,
            total_pages=total_pages,
        )

    def find_task_code(self, sample_identifier: str) -> str:
        normalized = normalize_text(sample_identifier)
        if not normalized:
            return ""
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT t.task_no
                    FROM biz_sample s
                    LEFT JOIN biz_task t ON t.task_id = s.task_id
                    WHERE s.remark LIKE %s
                      AND (CAST(s.sample_id AS CHAR) = %s OR s.sample_no = %s)
                    LIMIT 1
                    """,
                    (f"{SAMPLE_META_PREFIX}%", normalized, normalized),
                )
                row = cursor.fetchone()
        if isinstance(row, dict):
            return normalize_text(row.get("task_no"))
        if isinstance(row, (list, tuple)) and row:
            return normalize_text(row[0])
        return ""


def get_sample_page_query_repository() -> MySQLSamplePageQueryRepository:
    return MySQLSamplePageQueryRepository()


__all__ = ["MySQLSamplePageQueryRepository", "SampleSummaryPage", "get_sample_page_query_repository"]
