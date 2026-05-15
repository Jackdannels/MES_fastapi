from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.core.config import settings
from app.services.mq_event_processor import process_laboratory_event
from app.services.mq_publisher import publish_laboratory_command


router = APIRouter(prefix="/api/mq", tags=["mq"])


class FixtureInstallRequest(BaseModel):
    taskId: str = Field(min_length=1)
    labId: str = Field(min_length=1)
    sampleType: str = ""
    sampleCount: int = Field(ge=0)

    @field_validator("taskId", "labId", "sampleType", mode="before")
    @classmethod
    def trim_text(cls, value: Any) -> str:
        return str(value or "").strip()


class ReadyRequest(BaseModel):
    taskId: str = Field(min_length=1)
    labId: str = Field(min_length=1)

    @field_validator("taskId", "labId", mode="before")
    @classmethod
    def trim_text(cls, value: Any) -> str:
        return str(value or "").strip()


@router.post("/laboratory/fixture-install")
def publish_fixture_install(request: FixtureInstallRequest) -> dict[str, Any]:
    payload = {
        "cmd": "INSTALL_FIXTURE",
        "taskId": request.taskId,
        "labId": request.labId,
        "sampleType": request.sampleType,
        "sampleCount": request.sampleCount,
    }
    try:
        result = publish_laboratory_command("INSTALL_FIXTURE", payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "payload": payload, **result}


@router.post("/laboratory/ready")
def publish_ready(request: ReadyRequest) -> dict[str, Any]:
    payload = {
        "cmd": "READY",
        "taskId": request.taskId,
        "labId": request.labId,
    }
    try:
        result = publish_laboratory_command("READY", payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "payload": payload, **result}


@router.post("/laboratory/events/{event_name}")
def receive_laboratory_event(event_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    lab_id = str(payload.get("labId") or "").strip()
    if not lab_id:
        raise HTTPException(status_code=422, detail="labId is required")
    topic = f"{str(settings.MQTT_TOPIC_PREFIX or 'mes/v1').strip().strip('/')}/labs/{lab_id}/events/{event_name}"
    try:
        return process_laboratory_event(topic, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
