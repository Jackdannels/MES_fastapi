from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
from threading import Lock
from typing import Any, Callable, Protocol

from app.db.schema_version import require_schema_version
from app.db.session import get_connection
from app.services.fixed_terminal_auth import FixedTerminalAuthService, get_fixed_terminal_auth_service, normalize_text


VALID_TERMINAL_ACTIONS = {"reload", "shutdown", "restart"}
ONLINE_WINDOW = timedelta(seconds=30)
PAGE_ACTIVE_WINDOW = timedelta(seconds=45)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def format_utc(value: datetime | None) -> str:
    if value is None:
        return ""
    normalized = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return normalized.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def normalize_ip(value: Any) -> str:
    normalized = normalize_text(value)
    try:
        return str(ip_address(normalized))
    except ValueError:
        return ""


class TerminalControlRepository(Protocol):
    def record_heartbeat(self, runtime: dict[str, Any]) -> datetime | None: ...

    def record_page(self, terminal_id: str, ip_address: str, path: str, title: str, seen_at: datetime) -> None: ...

    def list_runtime(self) -> list[dict[str, Any]]: ...

    def create_command(self, command: dict[str, Any]) -> dict[str, Any]: ...

    def claim_command(self, terminal_id: str, allow_reload: bool, allow_power: bool, claimed_at: datetime) -> dict[str, Any] | None: ...

    def complete_command(self, command_id: int, terminal_id: str, success: bool, message: str, completed_at: datetime) -> bool: ...

    def latest_commands(self) -> dict[str, dict[str, Any]]: ...


class InMemoryTerminalControlRepository:
    def __init__(self) -> None:
        self._lock = Lock()
        self._runtime: dict[str, dict[str, Any]] = {}
        self._commands: list[dict[str, Any]] = []
        self._next_command_id = 1

    def record_heartbeat(self, runtime: dict[str, Any]) -> datetime | None:
        with self._lock:
            terminal_id = normalize_text(runtime.get("terminal_id"))
            previous = self._runtime.get(terminal_id, {})
            self._runtime[terminal_id] = {**previous, **deepcopy(runtime)}
            return normalize_datetime(previous.get("last_page_seen_at"))

    def record_page(self, terminal_id: str, ip_address: str, path: str, title: str, seen_at: datetime) -> None:
        with self._lock:
            previous = self._runtime.get(terminal_id, {"terminal_id": terminal_id})
            self._runtime[terminal_id] = {
                **previous,
                "ip_address": ip_address or previous.get("ip_address", ""),
                "current_path": path,
                "current_title": title,
                "last_page_seen_at": seen_at,
            }

    def list_runtime(self) -> list[dict[str, Any]]:
        with self._lock:
            return [deepcopy(value) for value in self._runtime.values()]

    def create_command(self, command: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            created = {**deepcopy(command), "command_id": self._next_command_id, "status": "queued"}
            self._next_command_id += 1
            self._commands.append(created)
            return deepcopy(created)

    def claim_command(self, terminal_id: str, allow_reload: bool, allow_power: bool, claimed_at: datetime) -> dict[str, Any] | None:
        with self._lock:
            for command in self._commands:
                if command["terminal_id"] != terminal_id or command["status"] != "queued":
                    continue
                action = command["action"]
                if (action == "reload" and not allow_reload) or (action in {"shutdown", "restart"} and not allow_power):
                    continue
                command["status"] = "dispatched"
                command["dispatched_at"] = claimed_at
                return deepcopy(command)
        return None

    def complete_command(self, command_id: int, terminal_id: str, success: bool, message: str, completed_at: datetime) -> bool:
        with self._lock:
            for command in self._commands:
                if (
                    command["command_id"] != command_id
                    or command["terminal_id"] != terminal_id
                    or command["status"] != "dispatched"
                ):
                    continue
                command["status"] = "completed" if success else "failed"
                command["message"] = message
                command["completed_at"] = completed_at
                return True
        return False

    def latest_commands(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            latest: dict[str, dict[str, Any]] = {}
            for command in self._commands:
                latest[command["terminal_id"]] = deepcopy(command)
            return latest


class MySQLTerminalControlRepository:
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

    def record_heartbeat(self, runtime: dict[str, Any]) -> datetime | None:
        self._ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO sys_terminal_runtime (
                      terminal_id, machine_name, ip_address, configured_path, current_path,
                      agent_version, allow_reload, allow_power, last_seen_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                      machine_name = VALUES(machine_name), ip_address = VALUES(ip_address),
                      configured_path = VALUES(configured_path),
                      current_path = IF(current_path = '', VALUES(current_path), current_path),
                      agent_version = VALUES(agent_version), allow_reload = VALUES(allow_reload),
                      allow_power = VALUES(allow_power), last_seen_at = VALUES(last_seen_at)
                    """,
                    (
                        runtime["terminal_id"], runtime["machine_name"], runtime["ip_address"],
                        runtime["configured_path"], runtime["configured_path"], runtime["agent_version"],
                        int(runtime["allow_reload"]), int(runtime["allow_power"]), runtime["last_seen_at"],
                    ),
                )
                cursor.execute(
                    "SELECT last_page_seen_at FROM sys_terminal_runtime WHERE terminal_id = %s",
                    (runtime["terminal_id"],),
                )
                row = cursor.fetchone()
            connection.commit()
        if not row:
            return None
        if isinstance(row, dict):
            return normalize_datetime(row.get("last_page_seen_at"))
        return normalize_datetime(row[0])

    def record_page(self, terminal_id: str, ip_address: str, path: str, title: str, seen_at: datetime) -> None:
        self._ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO sys_terminal_runtime (terminal_id, ip_address, current_path, current_title, last_page_seen_at)
                    VALUES (%s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE ip_address = IF(VALUES(ip_address) = '', ip_address, VALUES(ip_address)), current_path = VALUES(current_path),
                      current_title = VALUES(current_title), last_page_seen_at = VALUES(last_page_seen_at)
                    """,
                    (terminal_id, ip_address, path, title, seen_at),
                )
            connection.commit()

    def list_runtime(self) -> list[dict[str, Any]]:
        self._ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM sys_terminal_runtime")
                rows = cursor.fetchall()
                columns = [column[0] for column in cursor.description]
        if not rows:
            return []
        return [dict(row) if isinstance(row, dict) else dict(zip(columns, row)) for row in rows]

    def create_command(self, command: dict[str, Any]) -> dict[str, Any]:
        self._ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO sys_terminal_command (terminal_id, action, requested_by, created_at) VALUES (%s, %s, %s, %s)",
                    (command["terminal_id"], command["action"], command["requested_by"], command["created_at"]),
                )
                command_id = int(cursor.lastrowid)
            connection.commit()
        return {**command, "command_id": command_id, "status": "queued"}

    def claim_command(self, terminal_id: str, allow_reload: bool, allow_power: bool, claimed_at: datetime) -> dict[str, Any] | None:
        self._ensure_schema()
        allowed_actions = []
        if allow_reload:
            allowed_actions.append("reload")
        if allow_power:
            allowed_actions.extend(("shutdown", "restart"))
        if not allowed_actions:
            return None
        placeholders = ",".join(["%s"] * len(allowed_actions))
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT command_id, terminal_id, action FROM sys_terminal_command WHERE terminal_id = %s AND status = 'queued' AND action IN ({placeholders}) ORDER BY command_id LIMIT 1 FOR UPDATE",
                    (terminal_id, *allowed_actions),
                )
                row = cursor.fetchone()
                if not row:
                    connection.commit()
                    return None
                command = dict(row) if isinstance(row, dict) else dict(zip(("command_id", "terminal_id", "action"), row))
                cursor.execute(
                    "UPDATE sys_terminal_command SET status = 'dispatched', dispatched_at = %s WHERE command_id = %s AND status = 'queued'",
                    (claimed_at, command["command_id"]),
                )
            connection.commit()
        return command

    def complete_command(self, command_id: int, terminal_id: str, success: bool, message: str, completed_at: datetime) -> bool:
        self._ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE sys_terminal_command SET status = %s, message = %s, completed_at = %s WHERE command_id = %s AND terminal_id = %s AND status = 'dispatched'",
                    ("completed" if success else "failed", message, completed_at, command_id, terminal_id),
                )
                updated = cursor.rowcount > 0
            connection.commit()
        return updated

    def latest_commands(self) -> dict[str, dict[str, Any]]:
        self._ensure_schema()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT command_id, terminal_id, action, status, requested_by, message,
                           created_at, dispatched_at, completed_at
                    FROM sys_terminal_command command_row
                    WHERE command_id = (SELECT MAX(command_id) FROM sys_terminal_command WHERE terminal_id = command_row.terminal_id)
                    """
                )
                rows = cursor.fetchall()
                columns = [column[0] for column in cursor.description]
        return {
            str(row["terminal_id"]): row
            for row in (dict(row) if isinstance(row, dict) else dict(zip(columns, row)) for row in rows)
        }


class TerminalControlService:
    def __init__(
        self,
        repository: TerminalControlRepository | None = None,
        auth_service: FixedTerminalAuthService | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.repository = repository or MySQLTerminalControlRepository()
        self.auth_service = auth_service
        self.clock = clock or utc_now

    def _auth(self) -> FixedTerminalAuthService:
        return self.auth_service or get_fixed_terminal_auth_service()

    def authenticate(self, terminal_id: str, terminal_secret: str) -> dict[str, Any]:
        return self._auth().authenticate_terminal(terminal_id=terminal_id, terminal_secret=terminal_secret)

    def heartbeat(self, *, terminal_id: str, terminal_secret: str, ip_address: str, reported_ip: str, machine_name: str,
                  configured_path: str, agent_version: str, allow_reload: bool, allow_power: bool) -> dict[str, Any]:
        terminal = self.authenticate(terminal_id, terminal_secret)
        now = self.clock()
        last_page_seen_at = self.repository.record_heartbeat({
            "terminal_id": terminal["terminal_id"],
            "machine_name": normalize_text(machine_name),
            "ip_address": normalize_ip(reported_ip) or normalize_text(ip_address),
            "configured_path": normalize_text(configured_path),
            "agent_version": normalize_text(agent_version),
            "allow_reload": bool(allow_reload),
            "allow_power": bool(allow_power),
            "last_seen_at": now,
        })
        return {
            "command": self.repository.claim_command(terminal["terminal_id"], bool(allow_reload), bool(allow_power), now),
            "last_page_seen_at": last_page_seen_at,
            "page_active": bool(last_page_seen_at and now - last_page_seen_at <= PAGE_ACTIVE_WINDOW),
        }

    def record_page(self, terminal_id: str, ip_address: str, path: str, title: str) -> None:
        self._auth().get_active_terminal(terminal_id)
        self.repository.record_page(terminal_id, normalize_text(ip_address), normalize_text(path)[:1024], normalize_text(title)[:255], self.clock())

    def list_terminals(self) -> list[dict[str, Any]]:
        now = self.clock()
        runtime_by_id = {normalize_text(item.get("terminal_id")): item for item in self.repository.list_runtime()}
        commands_by_id = self.repository.latest_commands()
        items = []
        for terminal in self._auth().list_active_terminals():
            terminal_id = normalize_text(terminal.get("terminal_id"))
            runtime = runtime_by_id.get(terminal_id, {})
            last_seen = normalize_datetime(runtime.get("last_seen_at"))
            current_path = normalize_text(runtime.get("current_path")) or normalize_text(runtime.get("configured_path"))
            items.append({
                "terminalId": terminal_id,
                "terminalName": normalize_text(terminal.get("terminal_name")),
                "machineName": normalize_text(runtime.get("machine_name")),
                "ipAddress": normalize_text(runtime.get("ip_address")),
                "module": normalize_text(terminal.get("module")),
                "labName": normalize_text(terminal.get("lab_name")),
                "currentPath": current_path,
                "currentTitle": normalize_text(runtime.get("current_title")),
                "agentVersion": normalize_text(runtime.get("agent_version")),
                "allowReload": bool(runtime.get("allow_reload")),
                "allowPower": bool(runtime.get("allow_power")),
                "online": bool(last_seen and now - last_seen <= ONLINE_WINDOW),
                "lastSeenAt": format_utc(last_seen),
                "lastCommand": self._format_command(commands_by_id.get(terminal_id)),
            })
        return sorted(items, key=lambda item: (not item["online"], item["ipAddress"], item["terminalName"]))

    def queue_command(self, terminal_id: str, action: str, requested_by: str) -> dict[str, Any]:
        normalized_action = self._validate_action(action)
        terminal = next((item for item in self.list_terminals() if item["terminalId"] == terminal_id), None)
        if terminal is None:
            raise ValueError("Terminal is not registered or disabled")
        if not terminal["online"]:
            raise RuntimeError("Terminal is offline")
        if normalized_action == "reload" and not terminal["allowReload"]:
            raise RuntimeError("Terminal does not allow remote reload")
        if normalized_action in {"shutdown", "restart"} and not terminal["allowPower"]:
            raise RuntimeError("Terminal does not allow remote power control")
        return self.repository.create_command({
            "terminal_id": terminal_id,
            "action": normalized_action,
            "requested_by": normalize_text(requested_by),
            "created_at": self.clock(),
        })

    def queue_batch(self, action: str, requested_by: str) -> list[dict[str, Any]]:
        normalized_action = self._validate_action(action)
        eligible = [
            terminal for terminal in self.list_terminals()
            if terminal["online"] and (
                (normalized_action == "reload" and terminal["allowReload"])
                or (normalized_action in {"shutdown", "restart"} and terminal["allowPower"])
            )
        ]
        return [self.queue_command(terminal["terminalId"], normalized_action, requested_by) for terminal in eligible]

    def complete_command(self, *, command_id: int, terminal_id: str, terminal_secret: str, success: bool, message: str) -> None:
        terminal = self.authenticate(terminal_id, terminal_secret)
        if not self.repository.complete_command(command_id, terminal["terminal_id"], bool(success), normalize_text(message)[:512], self.clock()):
            raise ValueError("Command was not found or is not dispatched to this terminal")

    @staticmethod
    def _validate_action(action: str) -> str:
        normalized = normalize_text(action).lower()
        if normalized not in VALID_TERMINAL_ACTIONS:
            raise ValueError("Invalid terminal action")
        return normalized

    @staticmethod
    def _format_command(command: dict[str, Any] | None) -> dict[str, Any] | None:
        if not command:
            return None
        return {
            "commandId": int(command["command_id"]),
            "action": normalize_text(command.get("action")),
            "status": normalize_text(command.get("status")),
            "message": normalize_text(command.get("message")),
            "createdAt": format_utc(normalize_datetime(command.get("created_at"))),
        }


_terminal_control_service: TerminalControlService | None = None


def get_terminal_control_service() -> TerminalControlService:
    global _terminal_control_service
    if _terminal_control_service is None:
        _terminal_control_service = TerminalControlService()
    return _terminal_control_service


def set_terminal_control_service_for_tests(service: TerminalControlService | None) -> None:
    global _terminal_control_service
    _terminal_control_service = service
