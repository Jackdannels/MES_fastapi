from __future__ import annotations

import hashlib
import hmac
import secrets
from copy import deepcopy
from threading import Lock
from typing import Any, Protocol

from app.db.schema_version import require_schema_version
from app.db.session import get_connection


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def terminal_secret_hash(secret: str) -> str:
    return hashlib.sha256(normalize_text(secret).encode("utf-8")).hexdigest()


class FixedTerminalRepository(Protocol):
    def upsert_terminal(self, terminal: dict[str, Any]) -> dict[str, Any]: ...

    def find_terminal(self, terminal_id: str) -> dict[str, Any] | None: ...

    def list_terminals(self) -> list[dict[str, Any]]: ...

    def mark_authenticated(self, terminal_id: str) -> None: ...


class InMemoryFixedTerminalRepository:
    def __init__(self) -> None:
        self._lock = Lock()
        self._terminals: dict[str, dict[str, Any]] = {}

    def upsert_terminal(self, terminal: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            normalized = deepcopy(terminal)
            normalized["active"] = True
            self._terminals[normalize_text(terminal.get("terminal_id"))] = normalized
            return deepcopy(normalized)

    def find_terminal(self, terminal_id: str) -> dict[str, Any] | None:
        with self._lock:
            terminal = self._terminals.get(normalize_text(terminal_id))
            return deepcopy(terminal) if terminal else None

    def list_terminals(self) -> list[dict[str, Any]]:
        with self._lock:
            return [deepcopy(terminal) for terminal in self._terminals.values()]

    def mark_authenticated(self, terminal_id: str) -> None:
        return None


class MySQLFixedTerminalRepository:
    def __init__(self) -> None:
        self._schema_lock = Lock()
        self._schema_ready = False

    def _ensure_schema(self) -> None:
        if self._schema_ready:
            return
        with self._schema_lock:
            if self._schema_ready:
                return
            with get_connection() as connection:
                with connection.cursor() as cursor:
                    require_schema_version(cursor)
            self._schema_ready = True

    def upsert_terminal(self, terminal: dict[str, Any]) -> dict[str, Any]:
        self._ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO sys_fixed_terminal (
                      terminal_id, terminal_name, secret_hash, bound_module, bound_lab_name, active
                    ) VALUES (%s, %s, %s, %s, %s, 1)
                    ON DUPLICATE KEY UPDATE
                      terminal_name = VALUES(terminal_name),
                      secret_hash = VALUES(secret_hash),
                      bound_module = VALUES(bound_module),
                      bound_lab_name = VALUES(bound_lab_name),
                      active = 1,
                      updated_at = NOW()
                    """,
                    (
                        terminal["terminal_id"],
                        terminal["terminal_name"],
                        terminal["secret_hash"],
                        terminal["module"],
                        terminal["lab_name"],
                    ),
                )
            connection.commit()
        return self.find_terminal(terminal["terminal_id"]) or {}

    def find_terminal(self, terminal_id: str) -> dict[str, Any] | None:
        self._ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT terminal_id, terminal_name, secret_hash,
                           bound_module AS module, bound_lab_name AS lab_name, active
                    FROM sys_fixed_terminal
                    WHERE terminal_id = %s
                    """,
                    (normalize_text(terminal_id),),
                )
                row = cursor.fetchone()
        if not row:
            return None
        if isinstance(row, dict):
            return dict(row)
        return dict(zip(("terminal_id", "terminal_name", "secret_hash", "module", "lab_name", "active"), row))

    def list_terminals(self) -> list[dict[str, Any]]:
        self._ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT terminal_id, terminal_name, secret_hash,
                           bound_module AS module, bound_lab_name AS lab_name, active
                    FROM sys_fixed_terminal
                    WHERE active = 1
                    ORDER BY terminal_name, terminal_id
                    """
                )
                rows = cursor.fetchall()
        if not rows:
            return []
        if isinstance(rows[0], dict):
            return [dict(row) for row in rows]
        columns = ("terminal_id", "terminal_name", "secret_hash", "module", "lab_name", "active")
        return [dict(zip(columns, row)) for row in rows]

    def mark_authenticated(self, terminal_id: str) -> None:
        self._ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE sys_fixed_terminal SET last_authenticated_at = NOW() WHERE terminal_id = %s",
                    (normalize_text(terminal_id),),
                )
            connection.commit()


class FixedTerminalAuthService:
    def __init__(self, repository: FixedTerminalRepository | None = None) -> None:
        self.repository = repository or MySQLFixedTerminalRepository()

    def register_terminal(
        self,
        *,
        terminal_id: str,
        terminal_name: str,
        module: str,
        lab_name: str = "",
    ) -> dict[str, Any]:
        normalized_id = normalize_text(terminal_id)
        normalized_name = normalize_text(terminal_name) or normalized_id
        normalized_module = normalize_text(module)
        normalized_lab_name = normalize_text(lab_name)
        if not normalized_id:
            raise ValueError("terminal_id is required")
        secret = secrets.token_urlsafe(32)
        terminal = self.repository.upsert_terminal(
            {
                "terminal_id": normalized_id,
                "terminal_name": normalized_name,
                "secret_hash": terminal_secret_hash(secret),
                "module": normalized_module,
                "lab_name": normalized_lab_name,
                "active": True,
            }
        )
        return {**terminal, "terminal_secret": secret}

    def authenticate_terminal(self, *, terminal_id: str, terminal_secret: str) -> dict[str, Any]:
        terminal = self.get_active_terminal(terminal_id)
        supplied_hash = terminal_secret_hash(terminal_secret)
        if not hmac.compare_digest(normalize_text(terminal.get("secret_hash")), supplied_hash):
            raise ValueError("invalid terminal credentials")
        self.repository.mark_authenticated(normalize_text(terminal_id))
        return terminal

    def get_active_terminal(self, terminal_id: str) -> dict[str, Any]:
        terminal = self.repository.find_terminal(normalize_text(terminal_id))
        if not terminal or not bool(terminal.get("active")):
            raise ValueError("terminal is not registered or disabled")
        return terminal

    def list_active_terminals(self) -> list[dict[str, Any]]:
        return [terminal for terminal in self.repository.list_terminals() if bool(terminal.get("active"))]


_fixed_terminal_auth_service: FixedTerminalAuthService | None = None


def get_fixed_terminal_auth_service() -> FixedTerminalAuthService:
    global _fixed_terminal_auth_service
    if _fixed_terminal_auth_service is None:
        _fixed_terminal_auth_service = FixedTerminalAuthService()
    return _fixed_terminal_auth_service


def set_fixed_terminal_auth_service_for_tests(service: FixedTerminalAuthService | None) -> None:
    global _fixed_terminal_auth_service
    _fixed_terminal_auth_service = service
