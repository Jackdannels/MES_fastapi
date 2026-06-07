from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import AliasChoices, BaseModel, Field, field_validator

from app.core.config import settings
from app.services.mq_event_processor import generated_run_no, process_laboratory_event
from app.services.mq_publisher import publish_laboratory_command
from app.services.mq_runtime import default_mq_runtime


router = APIRouter(prefix="/api/mq", tags=["mq"])


class FixtureInstallRequest(BaseModel):
    task_code: str = Field(min_length=1)
    lab_code: str = Field(min_length=1)
    experiment_code: str = ""
    sample_type: str = ""
    sample_count: int = Field(ge=0)

    @field_validator("task_code", "lab_code", "experiment_code", "sample_type", mode="before")
    @classmethod
    def trim_text(cls, value: Any) -> str:
        return str(value or "").strip()


class ReadyRequest(BaseModel):
    task_code: str = Field(min_length=1)
    lab_code: str = Field(min_length=1)
    experiment_code: str = ""
    run_no: str = Field(default="", validation_alias=AliasChoices("run_no", "runNo"))

    @field_validator("task_code", "lab_code", "experiment_code", "run_no", mode="before")
    @classmethod
    def trim_text(cls, value: Any) -> str:
        return str(value or "").strip()


class InterfaceModeRequest(BaseModel):
    mode: str = Field(min_length=1)

    @field_validator("mode", mode="before")
    @classmethod
    def trim_mode(cls, value: Any) -> str:
        return str(value or "").strip().lower()


def get_mq_runtime(request: Request):
    return getattr(request.app.state, "mq_runtime", default_mq_runtime)


@router.get("/interface-mode")
def get_interface_mode(request: Request) -> dict[str, Any]:
    return get_mq_runtime(request).status()


@router.post("/interface-mode")
def set_interface_mode(request: Request, payload: InterfaceModeRequest) -> dict[str, Any]:
    try:
        return get_mq_runtime(request).set_mode(payload.mode)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"MQTT 启动失败：{exc}") from exc


@router.post("/laboratory/fixture-install")
def publish_fixture_install(request: FixtureInstallRequest) -> dict[str, Any]:
    payload = {
        "task_code": request.task_code,
        "lab_code": request.lab_code,
        "experiment_code": request.experiment_code,
        "sample_type": request.sample_type,
        "sample_count": request.sample_count,
    }
    try:
        result = publish_laboratory_command("INSTALL_FIXTURE", payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "payload": payload, **result}


@router.post("/laboratory/ready")
def publish_ready(request: ReadyRequest) -> dict[str, Any]:
    payload = {
        "task_code": request.task_code,
        "lab_code": request.lab_code,
        "experiment_code": request.experiment_code,
        "run_no": request.run_no or generated_run_no(),
    }
    try:
        result = publish_laboratory_command("READY", payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "payload": payload, **result}


@router.post("/laboratory/events/{event_name}")
def receive_laboratory_event(event_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    lab_code = str(payload.get("lab_code") or "").strip()
    if not lab_code:
        raise HTTPException(status_code=422, detail="lab_code is required")
    topic = f"{str(settings.MQTT_TOPIC_PREFIX or 'mes/v1').strip().strip('/')}/labs/{lab_code}/events/{event_name}"
    try:
        return process_laboratory_event(topic, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
