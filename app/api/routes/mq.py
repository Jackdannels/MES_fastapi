from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

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
