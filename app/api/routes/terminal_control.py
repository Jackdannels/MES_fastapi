from pydantic import BaseModel

from fastapi import APIRouter, HTTPException, Request, status

from app.api.auth_session import refresh_auth_session, require_auth_session
from app.services.terminal_control import format_utc, get_terminal_control_service


router = APIRouter(prefix="/api/terminal-control", tags=["terminal-control"])


class TerminalHeartbeatRequest(BaseModel):
    terminalId: str
    terminalSecret: str
    machineName: str = ""
    ipAddress: str = ""
    configuredPath: str = ""
    agentVersion: str = ""
    allowReload: bool = False
    allowPower: bool = False


class TerminalPageRequest(BaseModel):
    path: str
    title: str = ""


class TerminalCommandRequest(BaseModel):
    action: str


class TerminalCommandCompletionRequest(BaseModel):
    terminalId: str
    terminalSecret: str
    success: bool
    message: str = ""


def client_ip(request: Request) -> str:
    return str(request.client.host if request.client else "").strip()


def require_central_manager(request: Request) -> dict:
    session = refresh_auth_session(require_auth_session(request))
    if session.get("terminal_auth") or str(session.get("module") or "") != "central":
        raise HTTPException(status_code=403, detail="Central management session required")
    return session


@router.post("/heartbeat")
def terminal_heartbeat(payload: TerminalHeartbeatRequest, request: Request):
    try:
        heartbeat = get_terminal_control_service().heartbeat(
            terminal_id=payload.terminalId,
            terminal_secret=payload.terminalSecret,
            ip_address=client_ip(request),
            reported_ip=payload.ipAddress,
            machine_name=payload.machineName,
            configured_path=payload.configuredPath,
            agent_version=payload.agentVersion,
            allow_reload=payload.allowReload,
            allow_power=payload.allowPower,
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    command = heartbeat["command"]
    return {
        "ok": True,
        "command": None if not command else {
            "commandId": int(command["command_id"]),
            "action": str(command["action"]),
        },
        "pageActive": bool(heartbeat["page_active"]),
        "lastPageSeenAt": format_utc(heartbeat["last_page_seen_at"]),
    }


@router.post("/page")
def record_terminal_page(payload: TerminalPageRequest, request: Request):
    session = refresh_auth_session(require_auth_session(request))
    if not session.get("terminal_auth") or not str(session.get("terminal_id") or "").strip():
        raise HTTPException(status_code=403, detail="Fixed terminal session required")
    try:
        get_terminal_control_service().record_page(
            str(session["terminal_id"]),
            "",
            payload.path,
            payload.title,
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return {"ok": True}


@router.get("/terminals")
def list_terminals(request: Request):
    require_central_manager(request)
    return {"items": get_terminal_control_service().list_terminals()}


@router.post("/terminals/{terminal_id}/commands", status_code=status.HTTP_202_ACCEPTED)
def queue_terminal_command(terminal_id: str, payload: TerminalCommandRequest, request: Request):
    session = require_central_manager(request)
    try:
        command = get_terminal_control_service().queue_command(terminal_id, payload.action, str(session.get("username") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"commandId": int(command["command_id"]), "terminalId": terminal_id, "action": command["action"]}


@router.post("/commands/batch", status_code=status.HTTP_202_ACCEPTED)
def queue_terminal_batch(payload: TerminalCommandRequest, request: Request):
    session = require_central_manager(request)
    try:
        commands = get_terminal_control_service().queue_batch(payload.action, str(session.get("username") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "action": payload.action,
        "queuedCount": len(commands),
        "terminalIds": [str(command["terminal_id"]) for command in commands],
    }


@router.post("/commands/{command_id}/complete")
def complete_terminal_command(command_id: int, payload: TerminalCommandCompletionRequest):
    try:
        get_terminal_control_service().complete_command(
            command_id=command_id,
            terminal_id=payload.terminalId,
            terminal_secret=payload.terminalSecret,
            success=payload.success,
            message=payload.message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}
