from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import time
from typing import Literal
from urllib import request as http
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


class Probe(BaseModel):
    check_id: str = Field(min_length=1, max_length=128)
    schema_version: Literal[1]
    reply_routing_key: str = Field(pattern=r"^lims\.communication\.probe\.[a-f0-9]{32}$")


class Identity(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    digest: str = Field(pattern=r"^[a-f0-9]{64}$")


class Reconcile(BaseModel):
    check_id: str = Field(min_length=1, max_length=128)
    schema_version: Literal[1]
    events: list[Identity] = Field(max_length=100)
    dispatch_after: int = Field(ge=0)
    limit: int = Field(default=100, ge=1, le=100)


class Confirmation(Identity):
    outcome: Literal["received", "failed"]


class Resume(BaseModel):
    check_id: str = Field(min_length=1, max_length=128)
    schema_version: Literal[1]
    confirmed: list[Confirmation] = Field(max_length=100)
    replay: list[str] = Field(max_length=100)


class Faults(BaseModel):
    http_503: bool = False
    http_timeout: bool = False
    rabbit_blocked: bool = False
    drop_ack: bool = False
    omit_next_event: bool = False


class Action(BaseModel):
    action: Literal["check", "acknowledge"]


class NoRedirect(http.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def local_operator(request):
    try:
        local = bool(request.client and ipaddress.ip_address(request.client.host).is_loopback)
    except ValueError:
        local = False
    origin = request.headers.get("origin")
    if not local or (origin and urlsplit(origin).netloc != request.url.netloc):
        raise HTTPException(403, "通讯保障操作仅允许本机同源页面")


def register_communication_routes(app, simulator, authorize, fault_check, token, env):
    def result(check_id, **fields):
        return {"ok": True, "check_id": check_id, "schema_version": 1, **fields}

    def mes_request(action=None):
        base = os.environ.get("LIMS_MES_BASE_URL", str(env.get("LIMS_MES_BASE_URL") or "http://127.0.0.1:8000")).rstrip("/")
        parsed = urlsplit(base)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise HTTPException(503, "MES 状态地址配置无效")
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if token():
            headers["Authorization"] = f"Bearer {token()}"
        req = http.Request(base + "/api/system/lims-communication", headers=headers,
                           data=json.dumps({"action": action}).encode() if action else None,
                           method="POST" if action else "GET")
        try:
            with http.build_opener(NoRedirect).open(req, timeout=5) as response:
                return json.loads(response.read(1024 * 1024 + 1))
        except Exception:
            raise HTTPException(503, "无法读取 MES 通讯保障状态，请检查 MES 服务和地址/令牌配置") from None

    @app.post("/api/mes/communication/probe")
    async def probe(payload: Probe, request: Request):
        authorize(request)
        await fault_check()
        sent = False
        current = simulator()
        if current.rabbit and not current.communication.faults().get("rabbit_blocked"):
            try:
                await asyncio.wait_for(current.rabbit.publish_probe(payload.check_id, payload.reply_routing_key), timeout=3)
                sent = True
            except Exception:
                pass
        return result(payload.check_id, rabbit_sent=sent)

    @app.post("/api/mes/communication/reconcile")
    async def reconcile(payload: Reconcile, request: Request):
        authorize(request)
        await fault_check()
        current = simulator()
        events = await asyncio.to_thread(current.inbox.reconcile, [item.model_dump() for item in payload.events])
        manifest = await asyncio.to_thread(current.communication.manifest, payload.dispatch_after, payload.limit)
        return result(payload.check_id, events=events, **manifest)

    @app.post("/api/mes/communication/resume")
    async def resume(payload: Resume, request: Request):
        authorize(request)
        await fault_check()
        current = simulator()
        try:
            await asyncio.to_thread(current.communication.confirm, [item.model_dump() for item in payload.confirmed])
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        # Bound the whole request, not 100 consecutive five-second publication waits.
        published = 0
        deadline = time.monotonic() + 3
        for identity in payload.replay:
            if time.monotonic() >= deadline:
                break
            await asyncio.to_thread(current.communication.replay, identity)
            if await current.publish_pending(identity, timeout=max(.1, deadline - time.monotonic())):
                published += 1
            else:
                break
        return result(payload.check_id, published=published)

    @app.get("/api/communication")
    def communication_status():
        current = simulator()
        try:
            mes = mes_request()
            error = ""
        except HTTPException as exc:
            mes, error = None, str(exc.detail)
        return JSONResponse({"mes": mes, "error": error, "dispatch": current.communication.summary(),
                             "faults": current.communication.faults()}, headers={"Cache-Control": "no-store"})

    @app.post("/api/communication/action")
    def communication_action(payload: Action, request: Request):
        local_operator(request)
        return mes_request(payload.action)

    @app.post("/api/communication/faults")
    def communication_faults(payload: Faults, request: Request):
        local_operator(request)
        simulator().communication.set_faults(payload.model_dump())
        return {"ok": True, "faults": payload.model_dump()}
