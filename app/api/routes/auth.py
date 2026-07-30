from pydantic import BaseModel

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from app.api.auth_session import (
    build_auth_session,
    clear_auth_cookie,
    dump_terminal_ticket,
    load_terminal_ticket,
    refresh_auth_session,
    require_auth_session,
    set_auth_cookie,
)
from app.core.config import settings
from app.core.master_data import DEFAULT_LABS
from app.services.fixed_terminal_auth import get_fixed_terminal_auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
VALID_AUTH_MODULES = {"central", "handover", "visual", "staging", "appearance", "laboratory"}
AUTH_MODULE_ROUTES = {
    "central": "/",
    "handover": "/handover-system",
    "visual": "/visualization",
    "staging": "/staging-management",
    "appearance": "/appearance-inspection",
    "laboratory": "/laboratory",
}
LAB_CODE_BY_NAME = {
    str(lab["lab_name"]): str(lab["lab_code"])
    for lab in DEFAULT_LABS
    if lab.get("lab_type") == "实验室"
}
VALID_LAB_NAMES = set(LAB_CODE_BY_NAME)


class LoginRequest(BaseModel):
    username: str
    password: str
    module: str = "central"


class SwitchModuleRequest(BaseModel):
    module: str = "central"


class FixedTerminalRegisterRequest(BaseModel):
    username: str
    password: str
    terminal_id: str
    terminal_name: str = ""
    module: str
    lab_name: str = ""


class FixedTerminalTicketRequest(BaseModel):
    terminal_id: str
    terminal_secret: str


def fixed_terminal_target(module: str, lab_name: str = "") -> str:
    normalized_module = module if module in VALID_AUTH_MODULES else ""
    if not normalized_module:
        raise HTTPException(status_code=400, detail="Invalid module")
    if normalized_module == "laboratory":
        normalized_lab_name = str(lab_name or "").strip()
        if normalized_lab_name not in VALID_LAB_NAMES:
            raise HTTPException(status_code=400, detail="Invalid laboratory")
        return f"/laboratory?lab={LAB_CODE_BY_NAME[normalized_lab_name]}"
    return AUTH_MODULE_ROUTES[normalized_module]


def set_auth_response_headers(response: Response, *, vary_cookie: bool = False) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    if vary_cookie:
        response.headers["Vary"] = "Cookie"


def build_auth_error_response(
    *,
    status_code: int,
    detail: str,
    clear_cookie: bool = False,
    vary_cookie: bool = False,
) -> JSONResponse:
    response = JSONResponse(status_code=status_code, content={"detail": detail})
    set_auth_response_headers(response, vary_cookie=vary_cookie)
    if clear_cookie:
        clear_auth_cookie(response)
    return response


@router.post("/login")
def login(payload: LoginRequest, response: Response):
    set_auth_response_headers(response)
    if not settings.DEMO_USER or not settings.DEMO_PASSWORD:
        raise HTTPException(status_code=503, detail="Demo auth is not configured")

    if payload.username != settings.DEMO_USER or payload.password != settings.DEMO_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    module = payload.module if payload.module in VALID_AUTH_MODULES else "central"
    session = build_auth_session(username=payload.username, module=module)
    set_auth_cookie(response, session)
    return session


@router.post("/terminal/register")
def register_fixed_terminal(payload: FixedTerminalRegisterRequest, response: Response):
    set_auth_response_headers(response)
    if not settings.DEMO_USER or not settings.DEMO_PASSWORD:
        raise HTTPException(status_code=503, detail="Demo auth is not configured")
    if payload.username != settings.DEMO_USER or payload.password != settings.DEMO_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    module = payload.module if payload.module in VALID_AUTH_MODULES else ""
    lab_name = str(payload.lab_name or "").strip()
    target = fixed_terminal_target(module, lab_name)
    if module != "laboratory":
        lab_name = ""
    try:
        terminal = get_fixed_terminal_auth_service().register_terminal(
            terminal_id=payload.terminal_id,
            terminal_name=payload.terminal_name,
            module=module,
            lab_name=lab_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "ok": True,
        "terminalId": terminal["terminal_id"],
        "terminalName": terminal["terminal_name"],
        "terminalSecret": terminal["terminal_secret"],
        "module": terminal["module"],
        "labName": terminal["lab_name"],
        "target": target,
    }


@router.post("/terminal/ticket")
def create_fixed_terminal_ticket(payload: FixedTerminalTicketRequest, response: Response):
    set_auth_response_headers(response)
    try:
        terminal = get_fixed_terminal_auth_service().authenticate_terminal(
            terminal_id=payload.terminal_id,
            terminal_secret=payload.terminal_secret,
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return {
        "ticket": dump_terminal_ticket(terminal),
        "target": fixed_terminal_target(str(terminal.get("module") or ""), str(terminal.get("lab_name") or "")),
    }


@router.get("/terminal/consume")
def consume_fixed_terminal_ticket(ticket: str):
    ticket_payload = load_terminal_ticket(ticket)
    try:
        terminal = get_fixed_terminal_auth_service().get_active_terminal(str(ticket_payload.get("terminal_id") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    if (
        str(terminal.get("module") or "") != str(ticket_payload.get("module") or "")
        or str(terminal.get("lab_name") or "") != str(ticket_payload.get("lab_name") or "")
    ):
        raise HTTPException(status_code=401, detail="Terminal binding changed")
    target = fixed_terminal_target(str(terminal.get("module") or ""), str(terminal.get("lab_name") or ""))
    response = RedirectResponse(url=target, status_code=302)
    set_auth_response_headers(response)
    session = {
        **build_auth_session(username=f"terminal:{terminal['terminal_id']}", module=terminal["module"]),
        "terminal_auth": True,
        "terminal_id": terminal["terminal_id"],
        "terminal_name": terminal["terminal_name"],
        "lab_name": terminal["lab_name"],
    }
    set_auth_cookie(response, session)
    return response


@router.get("/session")
def read_session(request: Request, response: Response):
    set_auth_response_headers(response, vary_cookie=True)
    try:
        session = require_auth_session(request)
        refreshed = refresh_auth_session(session)
    except HTTPException as exc:
        if exc.status_code == 401:
            return build_auth_error_response(
                status_code=401,
                detail=str(exc.detail),
                clear_cookie=True,
                vary_cookie=True,
            )
        return build_auth_error_response(
            status_code=exc.status_code,
            detail=str(exc.detail),
            vary_cookie=True,
        )
    set_auth_cookie(response, refreshed)
    return refreshed


@router.post("/switch-module")
def switch_module(payload: SwitchModuleRequest, request: Request, response: Response):
    set_auth_response_headers(response, vary_cookie=True)
    try:
        session = require_auth_session(request)
        refreshed = refresh_auth_session(session)
    except HTTPException as exc:
        if exc.status_code == 401:
            return build_auth_error_response(
                status_code=401,
                detail=str(exc.detail),
                clear_cookie=True,
                vary_cookie=True,
            )
        return build_auth_error_response(
            status_code=exc.status_code,
            detail=str(exc.detail),
            vary_cookie=True,
        )

    module = payload.module if payload.module in VALID_AUTH_MODULES else ""
    if not module:
        raise HTTPException(status_code=400, detail="Invalid module")
    if refreshed.get("terminal_auth"):
        raise HTTPException(status_code=403, detail="Fixed terminal cannot switch module")

    updated_session = {
        **refreshed,
        "module": module,
    }
    set_auth_cookie(response, updated_session)
    return updated_session


@router.post("/logout", status_code=204)
def logout(response: Response):
    set_auth_response_headers(response, vary_cookie=True)
    clear_auth_cookie(response)
