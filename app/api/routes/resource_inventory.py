from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.api.routes.terminal_control import require_central_manager
from app.core.storage_backend import get_storage_backend
from app.services.resource_inventory import RESOURCE_LEDGER_KEY
from app.services.storage_update_bus import publish_storage_update

router = APIRouter(prefix="/api/device-resources", tags=["device-resources"])


class ReplenishmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resource: Literal["salt", "mold"]
    quantity: StrictInt = Field(ge=1, le=10000)
    request_id: UUID
    note: str = Field(default="", max_length=120)


@router.get("")
def resource_inventory():
    # Same read-only visibility as the visualization storage snapshot.
    return get_storage_backend().read_resource_inventory()


@router.post("/replenishments")
def replenish_resource(payload: ReplenishmentRequest, request: Request):
    session = require_central_manager(request)
    try:
        result = get_storage_backend().replenish_resource_inventory(
            resource=payload.resource, quantity=payload.quantity,
            request_id=str(payload.request_id), note=payload.note.strip(),
            operator=str(session.get("username") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    publish_storage_update([RESOURCE_LEDGER_KEY])
    return result
