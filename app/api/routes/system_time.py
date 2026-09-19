import ipaddress
import secrets
from typing import Literal

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.time_utils import BEIJING_TZ, now_business_datetime
from app.api.auth_session import refresh_auth_session, require_auth_session
from app.services.integration_status import lims_connection_status, upper_computer_connection_status


router = APIRouter(prefix="/api/system", tags=["system-time"])


def authorize_lims_communication(request):
    token = request.app.state.settings.LIMS_HTTP_TOKEN
    if token:
        if not secrets.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
            raise HTTPException(401, "Invalid LIMS bearer token")
    else:
        try:
            local = bool(request.client and ipaddress.ip_address(request.client.host).is_loopback)
        except ValueError:
            local = False
        if not local:
            raise HTTPException(403, "Remote LIMS monitoring requires a token")


class CommunicationAction(BaseModel):
    action: Literal["check", "acknowledge"]


@router.get("/lims-communication")
def read_lims_communication(request: Request):
    authorize_lims_communication(request)
    try:
        payload = request.app.state.lims_communication_runtime.status()
    except Exception:
        raise HTTPException(503, "通讯保障状态存储不可用") from None
    return JSONResponse(payload, headers={"Cache-Control": "no-store"})


@router.post("/lims-communication", status_code=202)
def control_lims_communication(payload: CommunicationAction, request: Request):
    authorize_lims_communication(request)
    runtime = request.app.state.lims_communication_runtime
    if not runtime.enabled:
        raise HTTPException(409, "通讯保障未启用")
    runtime.repository.command(payload.action)
    return {"ok": True, "message": "操作已排队；故障重试仍遵守既定间隔，不会提前或清零"}


@router.get("/integrations")
def read_integration_status(request: Request):
    # Independent of readiness: a failed peer must not disable core MES pages.
    lims = lims_connection_status(request.app.state)
    return JSONResponse(
        content={"lims": lims, "upper_computer": upper_computer_connection_status(request.app.state)},
        headers={"Cache-Control": "no-store"},
    )


@router.get("/time")
def read_system_time() -> dict[str, int | str]:
    current = now_business_datetime().replace(tzinfo=BEIJING_TZ)
    return {
        "epochMs": int(current.timestamp() * 1000),
        "iso": current.isoformat(timespec="milliseconds"),
        "timeZone": "Asia/Shanghai",
    }


@router.post("/integrations/lims/acknowledge", status_code=202)
def acknowledge_lims_alarm_from_central(request: Request):
    session = refresh_auth_session(require_auth_session(request))
    if session.get("module") != "central":
        raise HTTPException(403, "仅中控会话可以确认通讯告警")
    origin = request.headers.get("origin")
    allowed_origins = {item.strip().rstrip("/") for item in request.app.state.settings.FRONTEND_ORIGINS.split(",")}
    allowed_origins.add(str(request.base_url).rstrip("/"))
    if origin and origin.rstrip("/") not in allowed_origins:
        raise HTTPException(403, "不允许的请求来源")
    runtime = request.app.state.lims_communication_runtime
    if not runtime.enabled:
        raise HTTPException(409, "通讯保障未启用")
    try:
        runtime.repository.command("acknowledge")
    except Exception:
        raise HTTPException(503, "告警确认暂不可用，请稍后重试") from None
    return {"ok": True, "message": "确认请求已提交，等待后台处理；不清除故障或停止重试"}


@router.get("/discovery")
def read_mes_discovery() -> dict[str, int | str]:
    return {
        "service": "MES_FASTAPI",
        "apiVersion": 1,
        "frontendPort": 5173,
    }
