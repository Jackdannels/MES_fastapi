"""LAN enrollment and revocation; all decisions and credentials commit together.

The bounded enrollment document has its own app_storage_snapshot key. MySQL
locks that row while updating terminal authentication/runtime rows in the same
transaction, so approval/claim/reset cannot resurrect a revoked credential.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
from pathlib import Path
import re
from threading import RLock

from app.core.config import settings
from app.core.master_data import DEFAULT_LABS
from app.db.session import get_connection
from app.services.fixed_terminal_auth import terminal_secret_hash

STORAGE_KEY = "mes.terminal.enrollment.v1"
PACKAGE_ROOT = Path(__file__).resolve().parents[1] / "assets/terminal-clients"


class EnrollmentError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now_utc():
    return datetime.now(timezone.utc)


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def stations():
    rooms = [dict(id=lab["lab_code"], label=lab["lab_name"], module="laboratory", labName=lab["lab_name"],
                  target="/laboratory?lab=" + lab["lab_code"], folder=lab["lab_name"], executable="MES" + lab["lab_name"] + ".exe")
             for lab in DEFAULT_LABS if lab.get("lab_type") == "实验室"]
    for module, label, path in (("visual", "可视化管理", "/visualization"), ("handover", "接驳区系统", "/handover-system"),
                                ("staging", "暂存间系统", "/staging-management"), ("appearance", "外观检测间系统", "/appearance-inspection")):
        rooms.append(dict(id=module, label=label, module=module, labName="", target=path,
                          folder=label, executable="MES" + label + ".exe"))
    return rooms


class SQLUnit:
    def __init__(self, cursor, state):
        self.cursor, self.state = cursor, state

    def terminal(self, terminal_id):
        self.cursor.execute("SELECT terminal_id,terminal_name,secret_hash,bound_module AS module,bound_lab_name AS lab_name,active FROM sys_fixed_terminal WHERE terminal_id=%s FOR UPDATE", (terminal_id,))
        row = self.cursor.fetchone()
        return dict(zip(("terminal_id", "terminal_name", "secret_hash", "module", "lab_name", "active"), row)) if row and not isinstance(row, dict) else row

    def terminals(self):
        self.cursor.execute("SELECT terminal_id FROM sys_fixed_terminal ORDER BY terminal_id")
        return [row["terminal_id"] if isinstance(row, dict) else row[0] for row in self.cursor.fetchall()]

    def runtime(self, terminal_id):
        self.cursor.execute("SELECT last_seen_at FROM sys_terminal_runtime WHERE terminal_id=%s FOR UPDATE", (terminal_id,))
        row = self.cursor.fetchone()
        return (row.get("last_seen_at") if isinstance(row, dict) else row[0]) if row else None

    def write(self, terminal):
        self.cursor.execute("""INSERT INTO sys_fixed_terminal(terminal_id,terminal_name,secret_hash,bound_module,bound_lab_name,active)
            VALUES(%s,%s,%s,%s,%s,1) ON DUPLICATE KEY UPDATE terminal_name=VALUES(terminal_name),secret_hash=VALUES(secret_hash),
            bound_module=VALUES(bound_module),bound_lab_name=VALUES(bound_lab_name),active=1,updated_at=NOW()""",
            (terminal["terminal_id"], terminal["terminal_name"], terminal["secret_hash"], terminal["module"], terminal["lab_name"]))

    def revoke(self, terminal_id, delete=False):
        if delete:
            self.cursor.execute("DELETE FROM sys_fixed_terminal WHERE terminal_id=%s", (terminal_id,))
        else:
            self.cursor.execute("UPDATE sys_fixed_terminal SET active=0,updated_at=NOW() WHERE terminal_id=%s", (terminal_id,))
        self.cursor.execute("DELETE FROM sys_terminal_runtime WHERE terminal_id=%s", (terminal_id,))
        self.cursor.execute("DELETE FROM sys_terminal_command WHERE terminal_id=%s", (terminal_id,))


class MySQLEnrollmentRepository:
    @contextmanager
    def transaction(self):
        with get_connection() as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.execute("INSERT INTO app_storage_snapshot(storage_key,payload_json) VALUES(%s,%s) ON DUPLICATE KEY UPDATE storage_key=VALUES(storage_key)",
                                   (STORAGE_KEY, '{"requests":{},"audit":[]}'))
                    cursor.execute("SELECT payload_json FROM app_storage_snapshot WHERE storage_key=%s FOR UPDATE", (STORAGE_KEY,))
                    row = cursor.fetchone()
                    state = json.loads(row["payload_json"] if isinstance(row, dict) else row[0])
                    before = json.dumps(state, sort_keys=True)
                    yield SQLUnit(cursor, state)
                    if json.dumps(state, sort_keys=True) != before:
                        cursor.execute("UPDATE app_storage_snapshot SET payload_json=%s WHERE storage_key=%s", (json.dumps(state, ensure_ascii=False), STORAGE_KEY))
                connection.commit()
            except BaseException:
                connection.rollback()
                raise


class MemoryUnit:
    def __init__(self, state, auth, control):
        self.state, self.auth, self.control = state, auth, control

    def terminal(self, terminal_id):
        return self.auth.find_terminal(terminal_id)

    def terminals(self):
        return [terminal["terminal_id"] for terminal in self.auth.list_terminals()]

    def runtime(self, terminal_id):
        return next((row.get("last_seen_at") for row in self.control.list_runtime() if row["terminal_id"] == terminal_id), None)

    def write(self, terminal):
        self.auth.upsert_terminal(terminal)

    def revoke(self, terminal_id, delete=False):
        with self.auth._lock:
            if delete:
                self.auth._terminals.pop(terminal_id, None)
            elif terminal_id in self.auth._terminals:
                self.auth._terminals[terminal_id]["active"] = False
        with self.control._lock:
            self.control._runtime.pop(terminal_id, None)
            self.control._commands = [row for row in self.control._commands if row["terminal_id"] != terminal_id]


class InMemoryEnrollmentRepository:
    def __init__(self, auth, control):
        self.auth, self.control = auth, control
        self.state = {"requests": {}, "audit": []}
        self.lock = RLock()

    @contextmanager
    def transaction(self):
        with self.lock:
            before = deepcopy(self.state)
            try:
                yield MemoryUnit(self.state, self.auth, self.control)
            except BaseException:
                self.state = before
                raise


class TerminalEnrollmentService:
    def __init__(self, repository=None, package_root=None, clock=None, signing_key=None):
        self.repository = repository or MySQLEnrollmentRepository()
        self.package_root = Path(package_root) if package_root is not None else PACKAGE_ROOT
        self.clock = clock or now_utc
        self.signing_key = signing_key

    def station(self, identifier):
        result = next((row for row in stations() if row["id"] == identifier), None)
        if result is None:
            raise EnrollmentError("请选择有效的工位。")
        return result

    def package(self, identifier):
        self.station(identifier)
        path = self.package_root / (identifier + ".zip")
        if not path.is_file():
            raise EnrollmentError("该工位的客户端包尚未准备好，请联系管理员重新构建客户端包。", 409)
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        return path, digest

    def _public(self, request):
        return {key: value for key, value in request.items() if key != "tokenHash"}

    def _audit(self, unit, operation, actor, **fields):
        unit.state["audit"].append(dict(operation=operation, actor=actor, at=stamp(self.clock()), **fields))
        unit.state["audit"] = unit.state["audit"][-500:]

    def _request(self, unit, request_id, token=None):
        request = unit.state["requests"].get(request_id)
        if not request or (token is not None and not hmac.compare_digest(request["tokenHash"], terminal_secret_hash(token))):
            raise EnrollmentError("申请不存在或申请凭据不正确，请重新提交申请。", 403)
        if request["status"] in {"pending", "approved"} and self.clock() - datetime.fromisoformat(request["createdAt"].replace("Z", "+00:00")) > timedelta(hours=24):
            request["status"] = "expired"
        return request

    def submit(self, *, request_id, token, device_id, machine_name, station_id, ip_address):
        if not re.fullmatch(r"[a-f0-9]{32}", request_id) or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
            raise EnrollmentError("申请编号或凭据格式错误。")
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", device_id):
            raise EnrollmentError("设备标识格式错误。")
        self.station(station_id)
        with self.repository.transaction() as unit:
            if request_id in unit.state["requests"]:
                request = self._request(unit, request_id, token)
                if request["deviceId"] != device_id or request["requestedStation"] != station_id:
                    raise EnrollmentError("不能修改已提交的申请。", 409)
                return self._public(request)
            active = [row for row in unit.state["requests"].values() if row["status"] == "pending"
                      and self.clock() - datetime.fromisoformat(row["createdAt"].replace("Z", "+00:00")) < timedelta(hours=24)]
            if len(active) >= 500 or sum(row["deviceId"] == device_id for row in active) >= 5 or sum(row["ipAddress"] == ip_address for row in active) >= 50:
                raise EnrollmentError("待处理申请过多，请等待管理员处理。", 429)
            # Retain managed issued requests for reset/revocation; discard old
            # denied/expired requests only after their audit records are saved.
            removable = [key for key, row in unit.state["requests"].items() if row["status"] in {"denied", "expired", "deleted"}]
            if len(unit.state["requests"]) >= 1000 and removable:
                del unit.state["requests"][removable[0]]
            if len(unit.state["requests"]) >= 1000:
                raise EnrollmentError("申请历史已满，请联系管理员处理。", 429)
            request = dict(requestId=request_id, requestCode="5826-" + request_id[:8].upper(), tokenHash=terminal_secret_hash(token),
                           deviceId=device_id, machineName=machine_name.strip()[:128] or "未命名电脑", ipAddress=ip_address[:64],
                           requestedStation=station_id, assignedStation="", status="pending", createdAt=stamp(self.clock()),
                           terminalId="enrolled-" + request_id, reviewedBy="", reviewedAt="")
            unit.state["requests"][request_id] = request
            self._audit(unit, "request", "terminal", requestId=request_id)
            return self._public(request)

    def review(self, request_id, approve, station_id, actor):
        with self.repository.transaction() as unit:
            request = self._request(unit, request_id)
            if request["status"] != "pending":
                raise EnrollmentError("该申请已处理或过期，请刷新列表。", 409)
            if approve:
                self.package(station_id)
                request["assignedStation"] = station_id
            request.update(status="approved" if approve else "denied", reviewedBy=actor, reviewedAt=stamp(self.clock()))
            self._audit(unit, "approve" if approve else "deny", actor, requestId=request_id)
            return self._public(request)

    def poll(self, request_id, token, ip_address=""):
        with self.repository.transaction() as unit:
            request = self._request(unit, request_id, token)
            if ip_address:
                request["ipAddress"] = ip_address[:64]
            response = self._public(request)
            if request["status"] not in {"approved", "issued"}:
                return response
            key = self.signing_key if self.signing_key is not None else settings.SESSION_SECRET_KEY
            if not key:
                raise EnrollmentError("服务器尚未配置会话密钥。", 503)
            secret = hmac.new(str(key).encode(), ("terminal-enrollment-v1|" + request_id + "|" + token).encode(), hashlib.sha256).hexdigest()
            station = self.station(request["assignedStation"])
            path, checksum = self.package(station["id"])
            if request["status"] == "approved":
                unit.write(dict(terminal_id=request["terminalId"], terminal_name=request["machineName"] + " - " + station["label"],
                                secret_hash=terminal_secret_hash(secret), module=station["module"], lab_name=station["labName"], active=True))
                request["status"] = "issued"
                self._audit(unit, "claim", "terminal", requestId=request_id)
            terminal = unit.terminal(request["terminalId"])
            if not terminal or not terminal["active"] or not hmac.compare_digest(terminal["secret_hash"], terminal_secret_hash(secret)):
                request["status"] = "reset"
                return self._public(request)
            return {**self._public(request), "binding": dict(terminalId=request["terminalId"], terminalSecret=secret,
                    module=station["module"], labName=station["labName"], target=station["target"]), "station": station,
                    "packageSha256": checksum, "packageSize": path.stat().st_size}

    def list_requests(self):
        with self.repository.transaction() as unit:
            for key in list(unit.state["requests"]):
                self._request(unit, key)
            return sorted([self._public(row) for row in unit.state["requests"].values()], key=lambda row: row["createdAt"], reverse=True)

    def reset(self, terminal_id, actor, delete=False):
        with self.repository.transaction() as unit:
            if not unit.terminal(terminal_id):
                raise EnrollmentError("终端不存在，请刷新列表。", 404)
            unit.revoke(terminal_id, delete)
            for request in unit.state["requests"].values():
                if request["terminalId"] == terminal_id:
                    request["status"] = "deleted" if delete else "reset"
            self._audit(unit, "delete" if delete else "reset", actor, terminalId=terminal_id)
        return {"ok": True}

    def legacy_preview(self):
        with self.repository.transaction() as unit:
            return self._legacy(unit)

    def _legacy(self, unit):
        managed = {row["terminalId"] for row in unit.state["requests"].values()}
        result = []
        for identifier in unit.terminals():
            if identifier in managed:
                continue
            last = unit.runtime(identifier)
            if last:
                last = last.replace(tzinfo=timezone.utc) if last.tzinfo is None else last
                if self.clock() - last <= timedelta(seconds=30):
                    continue
            terminal = unit.terminal(identifier)
            result.append(dict(terminalId=identifier, terminalName=terminal["terminal_name"]))
        return result

    def cleanup(self, terminal_ids, actor):
        if not terminal_ids or len(terminal_ids) > 1000 or len(set(terminal_ids)) != len(terminal_ids):
            raise EnrollmentError("请先预览并选择需要清理的历史终端。")
        with self.repository.transaction() as unit:
            allowed = {row["terminalId"] for row in self._legacy(unit)}
            if not set(terminal_ids) <= allowed:
                raise EnrollmentError("部分终端已上线或已通过新流程绑定，请重新预览。", 409)
            for identifier in terminal_ids:
                unit.revoke(identifier, True)
            self._audit(unit, "cleanup", actor, terminalIds=terminal_ids)
        return {"ok": True, "removedCount": len(terminal_ids)}


_service = None


def get_terminal_enrollment_service():
    global _service
    if _service is None:
        _service = TerminalEnrollmentService()
    return _service


def set_terminal_enrollment_service_for_tests(service):
    global _service
    _service = service
