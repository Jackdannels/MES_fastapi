from pydantic import BaseModel

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from app.api.auth_session import (
    build_auth_session,
    clear_auth_cookie,
    refresh_auth_session,
    require_auth_session,
    set_auth_cookie,
)
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str
    module: str = "central"


class SwitchModuleRequest(BaseModel):
    module: str = "central"


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

    module = payload.module if payload.module in {"central", "handover", "visual", "staging"} else "central"
    session = build_auth_session(username=payload.username, module=module)
    set_auth_cookie(response, session)
    return session


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

    module = payload.module if payload.module in {"central", "handover", "visual", "staging"} else ""
    if not module:
        raise HTTPException(status_code=400, detail="Invalid module")

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
