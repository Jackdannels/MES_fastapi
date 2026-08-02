from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from app.core.mysql_storage_codecs import STORAGE_MARKER, normalize_text
from app.db.session import get_connection


RETURNED_STATUS = "厂家收回"


@dataclass(frozen=True)
class TaskCodePage:
    current_page: int
    task_codes: tuple[str, ...]
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


def _row(cursor: Any) -> dict[str, Any]:
    row = cursor.fetchone()
    if not row:
        return {}
    if isinstance(row, dict):
        return dict(row)
    columns = [column[0] for column in (cursor.description or [])]
    return dict(zip(columns, row))


def _page(total_count: int, requested_page: int, page_size: int) -> tuple[int, int, int]:
    total_pages = max(1, (total_count + page_size - 1) // page_size)
    current_page = min(max(requested_page, 1), total_pages)
    return current_page, total_pages, (current_page - 1) * page_size


class MySQLTaskPageQueryRepository:
    _ACTIVE_FILTER = """
        t.source_system = %s
        AND COALESCE(t.transfer_status, '') <> %s
    """

    _HISTORY_FILTER = """
        t.source_system = %s
        AND (
          t.transfer_status = %s
          OR t.task_status = %s
          OR EXISTS (
            SELECT 1
            FROM biz_sample history_sample
            WHERE history_sample.task_id = t.task_id
              AND (
                history_sample.sample_status = %s
                OR history_sample.flow_status = %s
                OR history_sample.location_desc = %s
              )
          )
          OR EXISTS (
            SELECT 1
            FROM biz_tray history_tray
            WHERE history_tray.task_id = t.task_id
              AND (
                history_tray.tray_status = %s
                OR history_tray.test_state = %s
              )
          )
          OR EXISTS (
            SELECT 1
            FROM biz_sample_event history_event
            WHERE history_event.task_id = t.task_id
              AND (
                history_event.sample_status = %s
                OR history_event.action_type = %s
                OR history_event.detail LIKE %s
              )
          )
        )
    """

    _HISTORY_TIME = """
        COALESCE(
          (
            SELECT MAX(return_event.event_time)
            FROM biz_sample_event return_event
            WHERE return_event.task_id = t.task_id
              AND (
                return_event.sample_status = %s
                OR return_event.action_type = %s
                OR return_event.detail LIKE %s
              )
          ),
          t.created_at
        )
    """

    @staticmethod
    def _history_filter_params() -> list[Any]:
        return [
            STORAGE_MARKER,
            RETURNED_STATUS,
            RETURNED_STATUS,
            RETURNED_STATUS,
            RETURNED_STATUS,
            RETURNED_STATUS,
            RETURNED_STATUS,
            RETURNED_STATUS,
            RETURNED_STATUS,
            RETURNED_STATUS,
            f"%{RETURNED_STATUS}%",
        ]

    @staticmethod
    def _history_time_params() -> list[Any]:
        return [RETURNED_STATUS, RETURNED_STATUS, f"%{RETURNED_STATUS}%"]

    @staticmethod
    def _search_clause(query: str) -> tuple[str, list[Any]]:
        normalized = normalize_text(query)
        if not normalized:
            return "", []
        pattern = f"%{normalized}%"
        return (
            """
            AND (
              t.task_no LIKE %s
              OR t.task_name LIKE %s
              OR t.task_type LIKE %s
              OR t.task_status LIKE %s
              OR t.transfer_status LIKE %s
              OR EXISTS (
                SELECT 1
                FROM biz_sample search_sample
                WHERE search_sample.task_id = t.task_id
                  AND search_sample.sample_no LIKE %s
              )
              OR EXISTS (
                SELECT 1
                FROM biz_tray search_tray
                WHERE search_tray.task_id = t.task_id
                  AND search_tray.tray_no LIKE %s
              )
              OR EXISTS (
                SELECT 1
                FROM biz_experiment_tray search_experiment_tray
                WHERE search_experiment_tray.task_no = t.task_no
                  AND search_experiment_tray.tray_no LIKE %s
              )
            )
            """,
            [pattern] * 8,
        )

    def list_active_task_codes(
        self,
        *,
        page: int,
        page_size: int,
        query: str = "",
        status: str = "",
        test_type: str = "",
        sort_key: str = "code",
        sort_direction: str = "asc",
    ) -> TaskCodePage:
        search_sql, search_params = self._search_clause(query)
        status_sql = ""
        status_params: list[Any] = []
        if normalize_text(status):
            normalized_status = normalize_text(status)
            if normalized_status == "待排程":
                status_sql = " AND (t.task_status IN (%s, %s) OR t.transfer_status = %s)"
                status_params = ["待排程", "已受理", normalized_status]
            else:
                status_sql = " AND (t.task_status = %s OR t.transfer_status = %s)"
                status_params = [normalized_status, normalized_status]
        test_type_sql = ""
        test_type_params: list[Any] = []
        if normalize_text(test_type):
            test_type_sql = " AND t.task_type LIKE %s"
            test_type_params = [f"%{normalize_text(test_type)}%"]
        filter_sql = f"{self._ACTIVE_FILTER}{search_sql}{status_sql}{test_type_sql}"
        params = [STORAGE_MARKER, RETURNED_STATUS, *search_params, *status_params, *test_type_params]
        order_columns = {
            "code": "t.task_no",
            "source": "t.task_source_type",
            "sampleCount": "t.sample_count",
            "testType": "t.task_type",
            "dueAt": "t.due_time",
            "displayStatus": "t.task_status",
        }
        order_column = order_columns.get(normalize_text(sort_key), "t.task_no")
        order_direction = "DESC" if normalize_text(sort_direction).lower() == "desc" else "ASC"
        order_sql = f"{order_column} {order_direction}"
        if order_column != "t.task_no":
            order_sql = f"{order_sql}, t.task_no ASC"
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) AS total_count FROM biz_task t WHERE {filter_sql}", params)
                total_count = int(_first_value(cursor.fetchone(), 0) or 0)
                current_page, total_pages, offset = _page(total_count, page, page_size)
                cursor.execute(
                    f"""
                    SELECT t.task_no
                    FROM biz_task t
                    WHERE {filter_sql}
                    ORDER BY {order_sql}
                    LIMIT %s OFFSET %s
                    """,
                    [*params, page_size, offset],
                )
                task_codes = tuple(normalize_text(row.get("task_no")) for row in _rows(cursor))
        return TaskCodePage(current_page, tuple(code for code in task_codes if code), total_count, total_pages)

    def get_active_task_overview(self, *, test_type: str = "") -> dict[str, Any]:
        params = [STORAGE_MARKER, RETURNED_STATUS]
        status_scope_sql = ""
        status_scope_params = list(params)
        if normalize_text(test_type):
            status_scope_sql = " AND t.task_type LIKE %s"
            status_scope_params.append(f"%{normalize_text(test_type)}%")
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT
                      SUM(CASE WHEN task_source_type = '外部委托' THEN 1 ELSE 0 END) AS external_count,
                      SUM(CASE WHEN task_source_type = '内部新增' THEN 1 ELSE 0 END) AS internal_count,
                      SUM(CASE WHEN task_status IN ('待排程', '已受理') THEN 1 ELSE 0 END) AS unscheduled_count
                    FROM biz_task t
                    WHERE {self._ACTIVE_FILTER}
                    """,
                    params,
                )
                metric_row = _row(cursor)
                cursor.execute(
                    f"""
                    SELECT DISTINCT task_type, task_status
                    FROM biz_task t
                    WHERE {self._ACTIVE_FILTER}
                    ORDER BY task_type ASC, task_status ASC
                    """,
                    params,
                )
                facet_rows = _rows(cursor)
                cursor.execute(
                    f"""
                    SELECT DISTINCT task_status
                    FROM biz_task t
                    WHERE {self._ACTIVE_FILTER}{status_scope_sql}
                    ORDER BY task_status ASC
                    """,
                    status_scope_params,
                )
                status_rows = _rows(cursor)
        metric = metric_row
        statuses = {
            "待排程" if normalize_text(row.get("task_status")) == "已受理" else normalize_text(row.get("task_status"))
            for row in status_rows
            if normalize_text(row.get("task_status"))
        }
        return {
            "metrics": {
                "externalCount": int(metric.get("external_count") or 0),
                "internalCount": int(metric.get("internal_count") or 0),
                "unscheduledCount": int(metric.get("unscheduled_count") or 0),
            },
            "statusOptions": sorted(statuses),
            "testTypeOptions": sorted({normalize_text(row.get("task_type")) for row in facet_rows if normalize_text(row.get("task_type"))}),
        }

    def next_task_code(self, reference: str = "") -> str:
        try:
            reference_time = datetime.fromisoformat(normalize_text(reference).replace("Z", "+00:00")) if normalize_text(reference) else datetime.now()
        except ValueError:
            reference_time = datetime.now()
        prefix = f"SYLU-{reference_time.year:04d}-{reference_time.month:02d}-"
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT MAX(CAST(SUBSTRING_INDEX(task_no, '-', -1) AS UNSIGNED)) AS max_sequence
                    FROM biz_task
                    WHERE task_no LIKE %s
                    """,
                    (f"{prefix}%",),
                )
                max_sequence = int(_first_value(cursor.fetchone(), 0) or 0)
        return f"{prefix}{max_sequence + 1:03d}"

    def list_history_task_codes(
        self,
        *,
        page: int,
        page_size: int,
        query: str = "",
        days: int = 0,
        now: str = "",
    ) -> TaskCodePage:
        search_sql, search_params = self._search_clause(query)
        time_sql = self._HISTORY_TIME
        time_filter_sql = ""
        time_filter_params: list[Any] = []
        if days > 0:
            try:
                now_time = datetime.fromisoformat(normalize_text(now).replace("Z", "+00:00")) if normalize_text(now) else datetime.now()
            except ValueError:
                now_time = datetime.now()
            threshold = datetime.fromtimestamp((now_time - timedelta(days=days)).timestamp())
            time_filter_sql = f" AND {time_sql} >= %s"
            time_filter_params = [*self._history_time_params(), threshold]
        filter_sql = f"{self._HISTORY_FILTER}{search_sql}{time_filter_sql}"
        filter_params = [*self._history_filter_params(), *search_params, *time_filter_params]
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) AS total_count FROM biz_task t WHERE {filter_sql}", filter_params)
                total_count = int(_first_value(cursor.fetchone(), 0) or 0)
                current_page, total_pages, offset = _page(total_count, page, page_size)
                cursor.execute(
                    f"""
                    SELECT t.task_no, {time_sql} AS history_updated_at
                    FROM biz_task t
                    WHERE {filter_sql}
                    ORDER BY history_updated_at DESC, t.task_no ASC
                    LIMIT %s OFFSET %s
                    """,
                    [
                        *self._history_time_params(),
                        *filter_params,
                        page_size,
                        offset,
                    ],
                )
                task_codes = tuple(normalize_text(row.get("task_no")) for row in _rows(cursor))
        return TaskCodePage(current_page, tuple(code for code in task_codes if code), total_count, total_pages)

    def list_attendance_operations(self, task_codes: set[str]) -> list[dict[str, Any]]:
        normalized = sorted({normalize_text(code) for code in task_codes if normalize_text(code)})
        if not normalized:
            return []
        placeholders = ", ".join(["%s"] * len(normalized))
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT operation_log_id AS id, username, employee_name, lab_name,
                           action_name AS action, task_no AS task_code,
                           experiment_no AS experiment_code, tray_no, run_no,
                           source, operated_at
                    FROM biz_lab_operation_log
                    WHERE task_no IN ({placeholders})
                    ORDER BY operated_at DESC, operation_log_id DESC
                    """,
                    normalized,
                )
                return _rows(cursor)


def get_task_page_query_repository() -> MySQLTaskPageQueryRepository:
    return MySQLTaskPageQueryRepository()
