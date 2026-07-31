from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone
from threading import Lock
from typing import Any, Callable

from app.core.master_data import DEFAULT_LABS
from app.db.session import get_connection
from app.db.schema_version import require_schema_version
from app.services.attendance_security import (
    ATTENDANCE_QR_PREFIX,
    build_qr_payload,
    generate_qr_token,
    hash_password,
    hash_qr_token,
    normalize_qr_token,
    verify_password,
)
from app.services.attendance_time import (
    BEIJING_TZ,
    format_beijing,
    format_utc,
    mysql_datetime,
    normalize_text,
    now_utc,
    parse_business_datetime,
    parse_datetime,
    should_finish_work_interval_for_completion,
)


DEFAULT_USERS = (
    {"username": "zhangsan", "password": "123", "employee_name": "张三", "role_name": "试验员"},
    {"username": "lisi", "password": "123", "employee_name": "李四", "role_name": "试验组长"},
)

class AttendanceError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class InMemoryAttendanceRepository:
    def __init__(self) -> None:
        self._lock = Lock()
        self._next_user_id = 1
        self._next_session_id = 1
        self._next_interval_id = 1
        self._next_operation_log_id = 1
        self.users: dict[int, dict[str, Any]] = {}
        self.sessions: list[dict[str, Any]] = []
        self.intervals: list[dict[str, Any]] = []
        self.operation_logs: list[dict[str, Any]] = []

    def has_users(self) -> bool:
        with self._lock:
            return bool(self.users)

    def list_users(self) -> list[dict[str, Any]]:
        with self._lock:
            return [deepcopy(user) for user in self.users.values()]

    def create_user(self, user: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            normalized = deepcopy(user)
            normalized["id"] = self._next_user_id
            self._next_user_id += 1
            self.users[normalized["id"]] = normalized
            return deepcopy(normalized)

    def update_user(self, user_id: int, updates: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            user = self.users.get(user_id)
            if user is None:
                return None
            user.update(deepcopy(updates))
            return deepcopy(user)

    def delete_user(self, user_id: int) -> dict[str, Any] | None:
        with self._lock:
            user = self.users.pop(user_id, None)
            return deepcopy(user) if user else None

    def find_user_by_username(self, username: str) -> dict[str, Any] | None:
        normalized_username = normalize_text(username)
        with self._lock:
            for user in self.users.values():
                if normalize_text(user.get("username")) == normalized_username:
                    return deepcopy(user)
        return None

    def find_user_by_id(self, user_id: int) -> dict[str, Any] | None:
        with self._lock:
            user = self.users.get(user_id)
            return deepcopy(user) if user else None

    def find_user_by_qr_token_hash(self, token_hash: str) -> dict[str, Any] | None:
        normalized_hash = normalize_text(token_hash)
        if not normalized_hash:
            return None
        with self._lock:
            for user in self.users.values():
                if normalize_text(user.get("qr_token_hash")) == normalized_hash:
                    return deepcopy(user)
        return None

    def close_active_lab_session(self, lab_name: str, lab_code: str, *, reason: str, now: datetime) -> dict[str, Any] | None:
        normalized_lab_name = normalize_text(lab_name)
        normalized_lab_code = normalize_text(lab_code)
        with self._lock:
            for session in reversed(self.sessions):
                if not session.get("active"):
                    continue
                if normalized_lab_name and normalize_text(session.get("lab_name")) != normalized_lab_name:
                    continue
                if normalized_lab_code and normalize_text(session.get("lab_code")) != normalized_lab_code:
                    continue
                session.update({"active": False, "last_seen_at": now, "logged_out_at": now, "reason": reason, "work_started_at": None})
                return deepcopy(session)
        return None

    def create_session(self, session: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            normalized = deepcopy(session)
            normalized["id"] = self._next_session_id
            self._next_session_id += 1
            self.sessions.append(normalized)
            return deepcopy(normalized)

    def update_session(self, session_id: int, updates: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            for session in self.sessions:
                if int(session.get("id") or 0) == int(session_id):
                    session.update(deepcopy(updates))
                    return deepcopy(session)
        return None

    def find_active_session(self, lab_name: str = "", lab_code: str = "") -> dict[str, Any] | None:
        normalized_lab_name = normalize_text(lab_name)
        normalized_lab_code = normalize_text(lab_code)
        with self._lock:
            for session in reversed(self.sessions):
                if not session.get("active"):
                    continue
                lab_matches = normalized_lab_name and normalize_text(session.get("lab_name")) == normalized_lab_name
                code_matches = normalized_lab_code and normalize_text(session.get("lab_code")) == normalized_lab_code
                if lab_matches or code_matches:
                    return deepcopy(session)
        return None

    def list_active_sessions(self) -> list[dict[str, Any]]:
        with self._lock:
            return [deepcopy(session) for session in self.sessions if session.get("active")]

    def start_interval(self, interval: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            normalized = deepcopy(interval)
            normalized["id"] = self._next_interval_id
            self._next_interval_id += 1
            self.intervals.append(normalized)
            return deepcopy(normalized)

    def find_open_interval(self, *, run_no: str = "", lab_name: str = "", lab_code: str = "") -> dict[str, Any] | None:
        normalized_run_no = normalize_text(run_no)
        normalized_lab_name = normalize_text(lab_name)
        normalized_lab_code = normalize_text(lab_code)
        with self._lock:
            for interval in reversed(self.intervals):
                if interval.get("ended_at") is not None:
                    continue
                if normalized_run_no and normalize_text(interval.get("run_no")) == normalized_run_no:
                    return deepcopy(interval)
                if normalized_lab_name and normalize_text(interval.get("lab_name")) == normalized_lab_name:
                    return deepcopy(interval)
                if normalized_lab_code and normalize_text(interval.get("lab_code")) == normalized_lab_code:
                    return deepcopy(interval)
        return None

    def finish_interval(self, interval_id: int, *, ended_at: datetime) -> dict[str, Any] | None:
        with self._lock:
            for interval in self.intervals:
                if int(interval.get("id") or 0) == int(interval_id):
                    interval["ended_at"] = ended_at
                    return deepcopy(interval)
        return None

    def list_intervals(self) -> list[dict[str, Any]]:
        with self._lock:
            return [deepcopy(interval) for interval in self.intervals]

    def clear_intervals(self) -> int:
        with self._lock:
            count = len(self.intervals)
            self.intervals = []
            return count

    def create_operation_log(self, operation_log: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            normalized = deepcopy(operation_log)
            normalized["id"] = self._next_operation_log_id
            self._next_operation_log_id += 1
            self.operation_logs.append(normalized)
            return deepcopy(normalized)

    def list_operation_logs(self) -> list[dict[str, Any]]:
        with self._lock:
            return [deepcopy(row) for row in self.operation_logs]

    def clear_operation_logs(self) -> int:
        with self._lock:
            count = len(self.operation_logs)
            self.operation_logs = []
            return count

    def resolve_lab_name(self, lab_code: str) -> str:
        normalized = normalize_text(lab_code)
        for row in DEFAULT_LABS:
            if normalize_text(row.get("lab_code")) == normalized:
                return normalize_text(row.get("lab_name"))
        return normalized


class MySQLAttendanceRepository:
    def __init__(self) -> None:
        self._schema_ready = False

    def ensure_schema(self) -> None:
        if self._schema_ready:
            return
        with get_connection() as connection:
            with connection.cursor() as cursor:
                require_schema_version(cursor)
        self._schema_ready = True

    def _rows(self, cursor: Any) -> list[dict[str, Any]]:
        rows = cursor.fetchall()
        if rows and isinstance(rows[0], dict):
            return [dict(row) for row in rows]
        columns = [column[0] for column in (cursor.description or [])]
        return [dict(zip(columns, row)) for row in rows]

    @staticmethod
    def _first_value(row: Any, default: Any = None) -> Any:
        if isinstance(row, dict):
            return next(iter(row.values()), default)
        if isinstance(row, (list, tuple)) and row:
            return row[0]
        return default

    def _row(self, cursor: Any) -> dict[str, Any] | None:
        rows = self._rows(cursor)
        return rows[0] if rows else None

    def has_users(self) -> bool:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1 FROM sys_attendance_user LIMIT 1")
                return cursor.fetchone() is not None

    def list_users(self) -> list[dict[str, Any]]:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT user_id AS id, username, employee_name, role_name, password_hash,
                           qr_token_hash, qr_token_payload, qr_token_created_at, active
                    FROM sys_attendance_user
                    ORDER BY user_id ASC
                    """
                )
                return self._rows(cursor)

    def create_user(self, user: dict[str, Any]) -> dict[str, Any]:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO sys_attendance_user (username, employee_name, role_name, password_hash, active)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        user["username"],
                        user["employee_name"],
                        user["role_name"],
                        user["password_hash"],
                        1 if user.get("active", True) else 0,
                    ),
                )
                user_id = int(cursor.lastrowid or 0)
            connection.commit()
        return self.find_user_by_id(user_id) or {}

    def update_user(self, user_id: int, updates: dict[str, Any]) -> dict[str, Any] | None:
        self.ensure_schema()
        if not updates:
            return self.find_user_by_id(user_id)
        assignments = []
        values = []
        for key, value in updates.items():
            column = "active" if key == "active" else key
            assignments.append(f"{column} = %s")
            if key == "active":
                values.append(1 if value else 0)
            elif key.endswith("_at"):
                values.append(mysql_datetime(value))
            else:
                values.append(value)
        values.append(user_id)
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"UPDATE sys_attendance_user SET {', '.join(assignments)} WHERE user_id = %s", values)
            connection.commit()
        return self.find_user_by_id(user_id)

    def delete_user(self, user_id: int) -> dict[str, Any] | None:
        user = self.find_user_by_id(user_id)
        if user is None:
            return None
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM sys_attendance_user WHERE user_id = %s", (user_id,))
            connection.commit()
        return user

    def find_user_by_username(self, username: str) -> dict[str, Any] | None:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT user_id AS id, username, employee_name, role_name, password_hash,
                           qr_token_hash, qr_token_payload, qr_token_created_at, active
                    FROM sys_attendance_user
                    WHERE username = %s
                    LIMIT 1
                    """,
                    (normalize_text(username),),
                )
                return self._row(cursor)

    def find_user_by_id(self, user_id: int) -> dict[str, Any] | None:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT user_id AS id, username, employee_name, role_name, password_hash,
                           qr_token_hash, qr_token_payload, qr_token_created_at, active
                    FROM sys_attendance_user
                    WHERE user_id = %s
                    LIMIT 1
                    """,
                    (user_id,),
                )
                return self._row(cursor)

    def find_user_by_qr_token_hash(self, token_hash: str) -> dict[str, Any] | None:
        self.ensure_schema()
        normalized_hash = normalize_text(token_hash)
        if not normalized_hash:
            return None
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT user_id AS id, username, employee_name, role_name, password_hash,
                           qr_token_hash, qr_token_payload, qr_token_created_at, active
                    FROM sys_attendance_user
                    WHERE qr_token_hash = %s
                    LIMIT 1
                    """,
                    (normalized_hash,),
                )
                return self._row(cursor)

    def close_active_lab_session(self, lab_name: str, lab_code: str, *, reason: str, now: datetime) -> dict[str, Any] | None:
        session = self.find_active_session(lab_name=lab_name, lab_code=lab_code)
        if not session:
            return None
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE biz_lab_attendance_session
                    SET active = 0, last_seen_at = %s, logged_out_at = %s, reason = %s, work_started_at = NULL
                    WHERE session_id = %s
                    """,
                    (mysql_datetime(now), mysql_datetime(now), reason, session["id"]),
                )
            connection.commit()
        return self.find_session_by_id(int(session["id"]))

    def create_session(self, session: dict[str, Any]) -> dict[str, Any]:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO biz_lab_attendance_session (
                      username, employee_name, lab_name, lab_code, active, logged_in_at,
                      last_seen_at, logged_out_at, reason, work_started_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, %s, NULL)
                    """,
                    (
                        session["username"],
                        session["employee_name"],
                        session["lab_name"],
                        session.get("lab_code") or "",
                        1,
                        mysql_datetime(session["logged_in_at"]),
                        mysql_datetime(session["last_seen_at"]),
                        session.get("reason") or "",
                    ),
                )
                session_id = int(cursor.lastrowid or 0)
            connection.commit()
        return self.find_session_by_id(session_id) or {}

    def update_session(self, session_id: int, updates: dict[str, Any]) -> dict[str, Any] | None:
        if not updates:
            return self.find_session_by_id(session_id)
        assignments = []
        values = []
        for key, value in updates.items():
            assignments.append(f"{key} = %s")
            values.append(mysql_datetime(value) if key.endswith("_at") else value)
        values.append(session_id)
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"UPDATE biz_lab_attendance_session SET {', '.join(assignments)} WHERE session_id = %s", values)
            connection.commit()
        return self.find_session_by_id(session_id)

    def find_session_by_id(self, session_id: int) -> dict[str, Any] | None:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT session_id AS id, username, employee_name, lab_name, lab_code, active,
                           logged_in_at, last_seen_at, logged_out_at, reason, work_started_at
                    FROM biz_lab_attendance_session
                    WHERE session_id = %s
                    LIMIT 1
                    """,
                    (session_id,),
                )
                return self._row(cursor)

    def find_active_session(self, lab_name: str = "", lab_code: str = "") -> dict[str, Any] | None:
        self.ensure_schema()
        resolved_lab_name = normalize_text(lab_name) or self.resolve_lab_name(lab_code)
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT session_id AS id, username, employee_name, lab_name, lab_code, active,
                           logged_in_at, last_seen_at, logged_out_at, reason, work_started_at
                    FROM biz_lab_attendance_session
                    WHERE active = 1
                      AND ((%s <> '' AND lab_name = %s) OR (%s <> '' AND lab_code = %s))
                    ORDER BY logged_in_at DESC, session_id DESC
                    LIMIT 1
                    """,
                    (resolved_lab_name, resolved_lab_name, normalize_text(lab_code), normalize_text(lab_code)),
                )
                return self._row(cursor)

    def list_active_sessions(self) -> list[dict[str, Any]]:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT session_id AS id, username, employee_name, lab_name, lab_code, active,
                           logged_in_at, last_seen_at, logged_out_at, reason, work_started_at
                    FROM biz_lab_attendance_session
                    WHERE active = 1
                    ORDER BY logged_in_at ASC
                    """
                )
                return self._rows(cursor)

    def start_interval(self, interval: dict[str, Any]) -> dict[str, Any]:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO biz_lab_work_interval (
                      session_id, username, employee_name, lab_name, lab_code, run_no, task_no,
                      experiment_no, source, started_at, ended_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)
                    """,
                    (
                        interval.get("session_id"),
                        interval["username"],
                        interval["employee_name"],
                        interval["lab_name"],
                        interval.get("lab_code") or "",
                        interval.get("run_no") or "",
                        interval.get("task_code") or "",
                        interval.get("experiment_code") or "",
                        interval.get("source") or "",
                        mysql_datetime(interval["started_at"]),
                    ),
                )
                interval_id = int(cursor.lastrowid or 0)
            connection.commit()
        found = self.find_open_interval(run_no=interval.get("run_no") or "", lab_name=interval.get("lab_name") or "")
        return found if found and int(found.get("id") or 0) == interval_id else {**interval, "id": interval_id}

    def find_open_interval(self, *, run_no: str = "", lab_name: str = "", lab_code: str = "") -> dict[str, Any] | None:
        self.ensure_schema()
        resolved_lab_name = normalize_text(lab_name) or self.resolve_lab_name(lab_code)
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT interval_id AS id, session_id, username, employee_name, lab_name, lab_code,
                           run_no, task_no AS task_code, experiment_no AS experiment_code,
                           source, started_at, ended_at
                    FROM biz_lab_work_interval
                    WHERE ended_at IS NULL
                      AND ((%s <> '' AND run_no = %s) OR (%s <> '' AND lab_name = %s) OR (%s <> '' AND lab_code = %s))
                    ORDER BY started_at DESC, interval_id DESC
                    LIMIT 1
                    """,
                    (normalize_text(run_no), normalize_text(run_no), resolved_lab_name, resolved_lab_name, normalize_text(lab_code), normalize_text(lab_code)),
                )
                return self._row(cursor)

    def finish_interval(self, interval_id: int, *, ended_at: datetime) -> dict[str, Any] | None:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE biz_lab_work_interval SET ended_at = %s WHERE interval_id = %s",
                    (mysql_datetime(ended_at), interval_id),
                )
            connection.commit()
        return None

    def list_intervals(self) -> list[dict[str, Any]]:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT interval_id AS id, session_id, username, employee_name, lab_name, lab_code,
                           run_no, task_no AS task_code, experiment_no AS experiment_code,
                           source, started_at, ended_at
                    FROM biz_lab_work_interval
                    ORDER BY started_at ASC, interval_id ASC
                    """
                )
                return self._rows(cursor)

    def clear_intervals(self) -> int:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM biz_lab_work_interval")
                row = cursor.fetchone()
                count = int(self._first_value(row, 0) or 0)
                cursor.execute("DELETE FROM biz_lab_work_interval")
            connection.commit()
        return count

    def create_operation_log(self, operation_log: dict[str, Any]) -> dict[str, Any]:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO biz_lab_operation_log (
                      session_id, username, employee_name, lab_name, lab_code, action_name,
                      task_no, experiment_no, tray_no, run_no, source, operated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        operation_log.get("session_id"),
                        operation_log["username"],
                        operation_log["employee_name"],
                        operation_log["lab_name"],
                        operation_log.get("lab_code") or "",
                        operation_log["action"],
                        operation_log.get("task_code") or "",
                        operation_log.get("experiment_code") or "",
                        operation_log.get("tray_no") or "",
                        operation_log.get("run_no") or "",
                        operation_log.get("source") or "",
                        mysql_datetime(operation_log["operated_at"]),
                    ),
                )
                operation_log_id = int(cursor.lastrowid or 0)
            connection.commit()
        return {**operation_log, "id": operation_log_id}

    def list_operation_logs(self) -> list[dict[str, Any]]:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT operation_log_id AS id, session_id, username, employee_name, lab_name,
                           lab_code, action_name AS action, task_no AS task_code,
                           experiment_no AS experiment_code, tray_no, run_no, source, operated_at
                    FROM biz_lab_operation_log
                    ORDER BY operated_at DESC, operation_log_id DESC
                    """,
                )
                return self._rows(cursor)

    def clear_operation_logs(self) -> int:
        self.ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM biz_lab_operation_log")
                row = cursor.fetchone()
                count = int(self._first_value(row, 0) or 0)
                cursor.execute("DELETE FROM biz_lab_operation_log")
            connection.commit()
        return count

    def resolve_lab_name(self, lab_code: str) -> str:
        self.ensure_schema()
        normalized = normalize_text(lab_code)
        if not normalized:
            return ""
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT lab_name FROM md_lab WHERE lab_code = %s LIMIT 1", (normalized,))
                row = cursor.fetchone()
        if row:
            return normalize_text(self._first_value(row, ""))
        for default_lab in DEFAULT_LABS:
            if normalize_text(default_lab.get("lab_code")) == normalized:
                return normalize_text(default_lab.get("lab_name"))
        return normalized


class AttendanceService:
    def __init__(self, *, repository: Any, now: Callable[[], datetime] = now_utc) -> None:
        self.repository = repository
        self._now = now

    def ensure_seed_users(self) -> None:
        if self.repository.has_users():
            return
        for user in DEFAULT_USERS:
            self.create_user(
                username=user["username"],
                password=user["password"],
                employee_name=user["employee_name"],
                role_name=user["role_name"],
                active=True,
            )

    def serialize_user(self, user: dict[str, Any]) -> dict[str, Any]:
        return {
            "active": bool(user.get("active", True)),
            "allowedLabs": ["*"],
            "employeeName": normalize_text(user.get("employee_name")),
            "hasQrToken": bool(normalize_text(user.get("qr_token_hash"))),
            "id": user.get("id"),
            "qrTokenCreatedAt": format_beijing(parse_datetime(user.get("qr_token_created_at"))),
            "roleName": normalize_text(user.get("role_name")) or "试验员",
            "username": normalize_text(user.get("username")),
        }

    def serialize_session(self, session: dict[str, Any] | None, *, lab_name: str = "") -> dict[str, Any]:
        if not session:
            return {
                "active": False,
                "employeeName": "",
                "labName": normalize_text(lab_name),
                "lastSeenAt": None,
                "loggedInAt": None,
                "loggedOutAt": None,
                "reason": "",
                "workStartedAt": None,
                "username": "",
            }
        return {
            "active": bool(session.get("active")),
            "employeeName": normalize_text(session.get("employee_name")),
            "labName": normalize_text(session.get("lab_name")),
            "lastSeenAt": format_beijing(parse_datetime(session.get("last_seen_at"))),
            "loggedInAt": format_beijing(parse_datetime(session.get("logged_in_at"))),
            "loggedOutAt": format_beijing(parse_datetime(session.get("logged_out_at"))),
            "reason": normalize_text(session.get("reason")),
            "workStartedAt": format_beijing(parse_datetime(session.get("work_started_at"))),
            "username": normalize_text(session.get("username")),
        }

    def list_users(self) -> list[dict[str, Any]]:
        self.ensure_seed_users()
        return [self.serialize_user(user) for user in self.repository.list_users()]

    def create_user(self, *, username: str, password: str, employee_name: str, role_name: str, active: bool = True) -> dict[str, Any]:
        normalized_username = normalize_text(username)
        if not normalized_username:
            raise AttendanceError(400, "Username is required")
        if self.repository.find_user_by_username(normalized_username):
            raise AttendanceError(409, "Employee username already exists")
        user = self.repository.create_user(
            {
                "active": bool(active),
                "employee_name": normalize_text(employee_name),
                "password_hash": hash_password(password),
                "role_name": normalize_text(role_name) or "试验员",
                "username": normalized_username,
            }
        )
        return self.serialize_user(user)

    def update_user(self, user_id: int, *, password: str | None = None, employee_name: str | None = None, role_name: str | None = None, active: bool | None = None) -> dict[str, Any]:
        self.ensure_seed_users()
        updates: dict[str, Any] = {}
        if password is not None:
            updates["password_hash"] = hash_password(password)
        if employee_name is not None:
            updates["employee_name"] = normalize_text(employee_name)
        if role_name is not None:
            updates["role_name"] = normalize_text(role_name)
        if active is not None:
            updates["active"] = bool(active)
        user = self.repository.update_user(user_id, updates)
        if user is None:
            raise AttendanceError(404, "Employee account not found")
        return self.serialize_user(user)

    def reset_password(self, user_id: int, new_password: str) -> dict[str, Any]:
        if not normalize_text(new_password):
            raise AttendanceError(400, "New password is required")
        return {"ok": True, "user": self.update_user(user_id, password=new_password)}

    def reset_qr_token(self, user_id: int) -> dict[str, Any]:
        self.ensure_seed_users()
        if self.repository.find_user_by_id(user_id) is None:
            raise AttendanceError(404, "Employee account not found")
        token = generate_qr_token()
        qr_payload = build_qr_payload(token)
        token_hash = hash_qr_token(token)
        user = self.repository.update_user(
            user_id,
            {
                "qr_token_created_at": self._now(),
                "qr_token_hash": token_hash,
                "qr_token_payload": qr_payload,
            },
        )
        if user is None:
            raise AttendanceError(404, "Employee account not found")
        return {
            "ok": True,
            "qrPayload": qr_payload,
            "qrToken": token,
            "user": self.serialize_user(user),
        }

    def read_qr_token(self, user_id: int) -> dict[str, Any]:
        self.ensure_seed_users()
        user = self.repository.find_user_by_id(user_id)
        if user is None:
            raise AttendanceError(404, "Employee account not found")
        qr_payload = normalize_text(user.get("qr_token_payload"))
        if not qr_payload:
            raise AttendanceError(404, "Employee QR code not generated")
        return {
            "qrPayload": qr_payload,
            "user": self.serialize_user(user),
        }

    def delete_user(self, user_id: int) -> dict[str, Any]:
        self.ensure_seed_users()
        now = self._now()
        user = self.repository.delete_user(user_id)
        if user is None:
            raise AttendanceError(404, "Employee account not found")
        username = normalize_text(user.get("username"))
        for session in self.repository.list_active_sessions():
            if normalize_text(session.get("username")) == username:
                self.repository.close_active_lab_session(
                    normalize_text(session.get("lab_name")),
                    normalize_text(session.get("lab_code")),
                    reason="user-deleted",
                    now=now,
                )
        return {"deleted": True, "id": user_id}

    def read_lab_session(self, lab_name: str) -> dict[str, Any]:
        session = self.repository.find_active_session(lab_name=lab_name)
        if session:
            session = self.repository.update_session(int(session["id"]), {"last_seen_at": self._now()}) or session
        return self.serialize_session(session, lab_name=lab_name)

    def list_lab_sessions(self) -> list[dict[str, Any]]:
        now = self._now()
        sessions = []
        for session in self.repository.list_active_sessions():
            updated = self.repository.update_session(int(session["id"]), {"last_seen_at": now}) or session
            sessions.append(self.serialize_session(updated))
        return sessions

    def _login_user_to_lab(self, user: dict[str, Any], lab_name: str, *, lab_code: str = "") -> dict[str, Any]:
        now = self._now()
        normalized_lab_name = normalize_text(lab_name) or self.repository.resolve_lab_name(lab_code)
        normalized_lab_code = normalize_text(lab_code)
        replaced_interval = self.repository.find_open_interval(lab_name=normalized_lab_name, lab_code=normalized_lab_code)
        if replaced_interval:
            self.finish_work_interval(
                run_no=normalize_text(replaced_interval.get("run_no")),
                lab_name=normalized_lab_name,
                lab_code=normalized_lab_code,
                ended_at=now,
            )
        self.repository.close_active_lab_session(normalized_lab_name, normalized_lab_code, reason="replaced", now=now)
        session = self.repository.create_session(
            {
                "active": True,
                "employee_name": user["employee_name"],
                "lab_name": normalized_lab_name,
                "lab_code": normalized_lab_code,
                "last_seen_at": now,
                "logged_in_at": now,
                "logged_out_at": None,
                "reason": "",
                "work_started_at": None,
                "username": user["username"],
            }
        )
        self.record_operation(session, action="试验间登录", source="manual", operated_at=now)
        if replaced_interval:
            session = self.repository.update_session(int(session["id"]), {"last_seen_at": now, "work_started_at": now}) or session
            self.start_work_interval(
                normalized_lab_name,
                lab_code=normalized_lab_code,
                run_no=normalize_text(replaced_interval.get("run_no")),
                task_code=normalize_text(replaced_interval.get("task_code")),
                experiment_code=normalize_text(replaced_interval.get("experiment_code")),
                source=normalize_text(replaced_interval.get("source")) or "api",
                started_at=now,
            )
        return self.serialize_session(session, lab_name=normalized_lab_name)

    def login_lab(self, lab_name: str, *, username: str, password: str, lab_code: str = "") -> dict[str, Any]:
        self.ensure_seed_users()
        user = self.repository.find_user_by_username(username)
        if not user or not user.get("active") or not verify_password(password, normalize_text(user.get("password_hash"))):
            raise AttendanceError(401, "Invalid employee credentials")
        return self._login_user_to_lab(user, lab_name, lab_code=lab_code)

    def login_lab_by_qr(self, lab_name: str, *, qr_payload: str, lab_code: str = "") -> dict[str, Any]:
        self.ensure_seed_users()
        token_hash = hash_qr_token(qr_payload)
        user = self.repository.find_user_by_qr_token_hash(token_hash)
        if not user or not user.get("active"):
            raise AttendanceError(401, "Invalid employee QR code")
        return self._login_user_to_lab(user, lab_name, lab_code=lab_code)

    def logout_lab(self, lab_name: str, *, reason: str = "manual") -> dict[str, Any]:
        now = self._now()
        closed = self.repository.close_active_lab_session(lab_name, "", reason=reason, now=now)
        if closed:
            self.finish_work_interval(lab_name=lab_name, ended_at=now)
            self.record_operation(closed, action="试验间退出", source="manual", operated_at=now)
        return self.serialize_session(closed, lab_name=lab_name)

    def start_lab_work(self, lab_name: str) -> dict[str, Any]:
        now = self._now()
        session = self.repository.find_active_session(lab_name=lab_name)
        if not session:
            raise AttendanceError(409, "Laboratory employee login is required")
        if parse_datetime(session.get("work_started_at")) is None:
            session = self.repository.update_session(int(session["id"]), {"last_seen_at": now, "work_started_at": now}) or session
        self.start_work_interval(lab_name=lab_name, run_no=f"manual-{session['id']}", source="api", started_at=now)
        return self.serialize_session(session, lab_name=lab_name)

    def start_work_interval(
        self,
        lab_name: str = "",
        *,
        lab_code: str = "",
        run_no: str = "",
        task_code: str = "",
        experiment_code: str = "",
        source: str = "api",
        started_at: datetime | str | None = None,
    ) -> dict[str, Any] | None:
        now = parse_business_datetime(started_at) or self._now()
        normalized_lab_name = normalize_text(lab_name) or self.repository.resolve_lab_name(lab_code)
        session = self.repository.find_active_session(lab_name=normalized_lab_name, lab_code=lab_code)
        if not session:
            return None
        existing = self.repository.find_open_interval(run_no=run_no, lab_name=normalized_lab_name, lab_code=lab_code)
        if parse_datetime(session.get("work_started_at")) is None:
            session = self.repository.update_session(
                int(session["id"]),
                {"last_seen_at": now, "work_started_at": now},
            ) or session
        if existing:
            return existing
        interval = self.repository.start_interval(
            {
                "session_id": session.get("id"),
                "username": session["username"],
                "employee_name": session["employee_name"],
                "lab_name": normalized_lab_name,
                "lab_code": normalize_text(lab_code) or normalize_text(session.get("lab_code")),
                "run_no": normalize_text(run_no),
                "task_code": normalize_text(task_code),
                "experiment_code": normalize_text(experiment_code),
                "source": normalize_text(source),
                "started_at": now,
                "ended_at": None,
            }
        )
        self.record_operation(
            session,
            action="开始试验" if normalize_text(task_code) or normalize_text(experiment_code) else "开始工作",
            source=normalize_text(source) or "api",
            task_code=task_code,
            experiment_code=experiment_code,
            run_no=run_no,
            operated_at=now,
        )
        return interval

    def finish_work_interval(
        self,
        *,
        run_no: str = "",
        lab_name: str = "",
        lab_code: str = "",
        ended_at: datetime | str | None = None,
    ) -> dict[str, Any] | None:
        interval = self.repository.find_open_interval(run_no=run_no, lab_name=lab_name, lab_code=lab_code)
        if not interval:
            return None
        finished = self.repository.finish_interval(int(interval["id"]), ended_at=parse_business_datetime(ended_at) or self._now())
        session_id = interval.get("session_id")
        if session_id is not None:
            has_open_session_interval = any(
                open_interval.get("ended_at") is None
                and str(open_interval.get("session_id") or "") == str(session_id)
                for open_interval in self.repository.list_intervals()
            )
            if not has_open_session_interval:
                self.repository.update_session(int(session_id), {"work_started_at": None})
        session = self.repository.find_active_session(lab_name=normalize_text(interval.get("lab_name")), lab_code=normalize_text(interval.get("lab_code")))
        if session and normalize_text(session.get("username")) == normalize_text(interval.get("username")):
            self.record_operation(
                session,
                action="完成试验" if normalize_text(interval.get("task_code")) or normalize_text(interval.get("experiment_code")) else "结束工作",
                source=normalize_text(interval.get("source")) or "api",
                task_code=normalize_text(interval.get("task_code")),
                experiment_code=normalize_text(interval.get("experiment_code")),
                run_no=normalize_text(interval.get("run_no")),
                operated_at=parse_business_datetime(ended_at) or self._now(),
            )
        return finished

    def record_operation(
        self,
        session: dict[str, Any] | None,
        *,
        action: str,
        source: str,
        task_code: str = "",
        experiment_code: str = "",
        tray_no: str = "",
        run_no: str = "",
        operated_at: datetime | str | None = None,
    ) -> dict[str, Any] | None:
        if not session:
            return None
        username = normalize_text(session.get("username"))
        employee_name = normalize_text(session.get("employee_name"))
        lab_name = normalize_text(session.get("lab_name"))
        if not username or not employee_name or not lab_name:
            return None
        return self.repository.create_operation_log(
            {
                "session_id": session.get("id"),
                "username": username,
                "employee_name": employee_name,
                "lab_name": lab_name,
                "lab_code": normalize_text(session.get("lab_code")),
                "action": normalize_text(action),
                "task_code": normalize_text(task_code),
                "experiment_code": normalize_text(experiment_code),
                "tray_no": normalize_text(tray_no),
                "run_no": normalize_text(run_no),
                "source": normalize_text(source),
                "operated_at": parse_business_datetime(operated_at) or self._now(),
            }
        )

    def record_laboratory_workflow_operation(
        self,
        *,
        operation_type: str,
        lab_name: str = "",
        lab_code: str = "",
        task_code: str = "",
        experiment_code: str = "",
        tray_codes: list[str] | None = None,
        source: str = "api",
        operated_at: datetime | str | None = None,
    ) -> list[dict[str, Any]]:
        action = {
            "compare": "任务比对",
            "install": "安装样品",
            "ready": "确认准备就绪",
        }.get(normalize_text(operation_type))
        if not action:
            return []
        session = self.repository.find_active_session(lab_name=lab_name, lab_code=lab_code)
        if not session:
            return []
        normalized_tray_codes = list(
            dict.fromkeys(normalize_text(tray_code) for tray_code in (tray_codes or []) if normalize_text(tray_code))
        )
        logs = []
        for tray_code in normalized_tray_codes or [""]:
            operation_log = self.record_operation(
                session,
                action=action,
                source=normalize_text(source) or "api",
                task_code=task_code,
                experiment_code=experiment_code,
                tray_no=tray_code,
                operated_at=operated_at,
            )
            if operation_log:
                logs.append(operation_log)
        return logs

    def serialize_operation_log(self, operation_log: dict[str, Any]) -> dict[str, Any]:
        return {
            "action": normalize_text(operation_log.get("action")),
            "employeeName": normalize_text(operation_log.get("employee_name")),
            "experimentCode": normalize_text(operation_log.get("experiment_code")),
            "id": operation_log.get("id"),
            "labName": normalize_text(operation_log.get("lab_name")),
            "operatedAt": format_beijing(parse_datetime(operation_log.get("operated_at"))),
            "runNo": normalize_text(operation_log.get("run_no")),
            "source": normalize_text(operation_log.get("source")),
            "taskCode": normalize_text(operation_log.get("task_code")),
            "trayNo": normalize_text(operation_log.get("tray_no")),
            "username": normalize_text(operation_log.get("username")),
        }

    def list_operation_logs(
        self,
        *,
        raw_date: str | None = None,
        employee_name: str = "",
        employee_names: list[str] | None = None,
        lab_name: str = "",
        lab_names: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        report_date = self.resolve_report_date(raw_date) if raw_date else None
        normalized_employee_name = normalize_text(employee_name)
        normalized_employee_names = {normalize_text(name) for name in (employee_names or []) if normalize_text(name)}
        normalized_lab_name = normalize_text(lab_name)
        normalized_lab_names = {normalize_text(name) for name in (lab_names or []) if normalize_text(name)}
        rows = []
        for row in self.repository.list_operation_logs():
            operated_at = parse_datetime(row.get("operated_at"))
            if report_date and (operated_at is None or format_beijing(operated_at)[:10] != report_date.isoformat()):
                continue
            row_employee_name = normalize_text(row.get("employee_name"))
            row_lab_name = normalize_text(row.get("lab_name"))
            if normalized_employee_names and row_employee_name not in normalized_employee_names:
                continue
            if not normalized_employee_names and normalized_employee_name and normalized_employee_name not in row_employee_name:
                continue
            if normalized_lab_names and row_lab_name not in normalized_lab_names:
                continue
            if not normalized_lab_names and normalized_lab_name and normalized_lab_name != row_lab_name:
                continue
            rows.append(self.serialize_operation_log(row))
        return sorted(rows, key=lambda row: (row.get("operatedAt") or "", int(row.get("id") or 0)), reverse=True)

    def clear_all_sessions(self, *, reason: str = "reset") -> dict[str, int]:
        now = self._now()
        intervals = self.repository.list_intervals()
        closed_intervals = sum(1 for interval in intervals if interval.get("ended_at") is None)
        cleared_intervals = self.repository.clear_intervals()
        cleared_operation_logs = self.repository.clear_operation_logs()

        closed_sessions = 0
        for session in self.repository.list_active_sessions():
            closed = self.repository.close_active_lab_session(
                normalize_text(session.get("lab_name")),
                normalize_text(session.get("lab_code")),
                reason=reason,
                now=now,
            )
            if closed:
                closed_sessions += 1
        return {
            "clearedIntervals": cleared_intervals,
            "clearedOperationLogs": cleared_operation_logs,
            "closedIntervals": closed_intervals,
            "closedSessions": closed_sessions,
        }

    def resolve_report_date(self, raw_date: str | None) -> date:
        if not raw_date:
            return self._now().date()
        try:
            return date.fromisoformat(raw_date)
        except ValueError as exc:
            raise AttendanceError(400, "Invalid date") from exc

    def interval_seconds_for_date(self, interval: dict[str, Any], report_date: date, now: datetime) -> int:
        started_at = parse_datetime(interval.get("started_at"))
        if started_at is None:
            return 0
        ended_at = parse_datetime(interval.get("ended_at")) or now
        day_start = datetime.combine(report_date, time.min, tzinfo=timezone.utc)
        day_end = datetime.combine(report_date, time.max, tzinfo=timezone.utc)
        overlap_start = max(started_at, day_start)
        overlap_end = min(ended_at, day_end)
        return max(0, int((overlap_end - overlap_start).total_seconds()))

    def list_work_times(self, raw_date: str | None = None) -> list[dict[str, Any]]:
        self.ensure_seed_users()
        report_date = self.resolve_report_date(raw_date)
        now = self._now()
        intervals = self.repository.list_intervals()
        active_sessions = self.repository.list_active_sessions()
        active_by_username: dict[str, list[dict[str, Any]]] = {}
        for session in active_sessions:
            active_by_username.setdefault(normalize_text(session.get("username")), []).append(session)
        active_interval_counts: dict[str, int] = {}
        for interval in intervals:
            if parse_datetime(interval.get("ended_at")) is not None:
                continue
            username = normalize_text(interval.get("username"))
            if not username or report_date != now.date():
                continue
            active_interval_counts[username] = active_interval_counts.get(username, 0) + 1
        rows = []
        for user in self.repository.list_users():
            username = normalize_text(user.get("username"))
            user_intervals = [interval for interval in intervals if normalize_text(interval.get("username")) == username]
            total_seconds = sum(self.interval_seconds_for_date(interval, report_date, now) for interval in user_intervals)
            user_active_sessions = active_by_username.get(username, [])
            current_lab_names = [normalize_text(session.get("lab_name")) for session in user_active_sessions if normalize_text(session.get("lab_name"))]
            latest_login = max((parse_datetime(session.get("logged_in_at")) for session in user_active_sessions), default=None)
            rows.append(
                {
                    **self.serialize_user(user),
                    "currentLabName": "、".join(current_lab_names),
                    "currentLabNames": current_lab_names,
                    "lastLoginAt": format_beijing(latest_login),
                    "online": bool(user_active_sessions),
                    "todaySeconds": total_seconds,
                    "activeWorkIntervalCount": active_interval_counts.get(username, 0),
                    "calculatedAt": format_beijing(now),
                }
            )
        return rows


_attendance_service: AttendanceService | None = None


def build_default_attendance_service() -> AttendanceService:
    return AttendanceService(repository=MySQLAttendanceRepository())


def get_attendance_service() -> AttendanceService:
    global _attendance_service
    if _attendance_service is None:
        _attendance_service = build_default_attendance_service()
    return _attendance_service


def set_attendance_service_for_tests(service: AttendanceService | None) -> None:
    global _attendance_service
    _attendance_service = service
