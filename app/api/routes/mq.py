from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import AliasChoices, BaseModel, Field, field_validator

from app.core.axis_codes import sort_axis_codes
from app.core.config import settings
from app.core.master_data import (
    LAB_INTERFACE_MQTT,
    LAB_INTERFACE_OPERATION_EXPERIMENT_END,
    LAB_INTERFACE_OPERATION_EXPERIMENT_START,
    LAB_INTERFACE_OPERATION_FIXTURE_READY,
    require_laboratory_interface,
)
from app.services.mq_event_processor import MySQLMqEventRepository, generated_run_no, now_iso, process_laboratory_event
from app.services.fixture_installations import mark_fixture_installation_failed, normalize_tray_codes, register_pending_fixture_installation
from app.services.mq_publisher import publish_laboratory_command
from app.services.mq_runtime import default_mq_runtime
from app.services.storage_update_bus import publish_storage_update


router = APIRouter(prefix="/api/mq", tags=["mq"])
MAX_SAMPLE_COUNT = 99


class FixtureInstallRequest(BaseModel):
    task_code: str = Field(min_length=1)
    lab_code: str = Field(min_length=1)
    experiment_code: str = ""
    sample_type: str = ""
    sample_count: int = Field(ge=0, le=MAX_SAMPLE_COUNT)
    fixture_install_id: str = Field(default="", validation_alias=AliasChoices("fixture_install_id", "fixtureInstallId"))
    tray_codes: list[str] = Field(default_factory=list, validation_alias=AliasChoices("tray_codes", "trayCodes"))

    @field_validator("task_code", "lab_code", "experiment_code", "sample_type", mode="before")
    @classmethod
    def trim_text(cls, value: Any) -> str:
        return str(value or "").strip()

    @field_validator("tray_codes", mode="before")
    @classmethod
    def normalize_trays(cls, value: Any) -> list[str]:
        raw_values = value.replace("，", ",").split(",") if isinstance(value, str) else value
        return normalize_tray_codes(raw_values)


class ReadyRequest(BaseModel):
    task_code: str = Field(min_length=1)
    lab_code: str = Field(min_length=1)
    experiment_code: str = ""
    sub_experiment_code: str = Field(default="", validation_alias=AliasChoices("sub_experiment_code", "subExperimentCode", "sub_experiment_no", "subExperimentNo"))
    run_no: str = Field(default="", validation_alias=AliasChoices("run_no", "runNo"))
    schedule_id: str = Field(default="", validation_alias=AliasChoices("schedule_id", "scheduleId", "schedule_no", "scheduleNo"))
    axis_codes: list[str] = Field(default_factory=list, validation_alias=AliasChoices("axis_codes", "axisCodes"))
    axis_batch_no: str = Field(default="", validation_alias=AliasChoices("axis_batch_no", "axisBatchNo"))
    current_axis_code: str = Field(default="", validation_alias=AliasChoices("current_axis_code", "currentAxisCode", "axis_code", "axisCode"))
    axis_adjustment_ready: bool = Field(
        default=False,
        validation_alias=AliasChoices("axis_adjustment_ready", "axisAdjustmentReady"),
    )

    @field_validator("task_code", "lab_code", "experiment_code", "sub_experiment_code", "run_no", "schedule_id", "axis_batch_no", "current_axis_code", mode="before")
    @classmethod
    def trim_text(cls, value: Any) -> str:
        return str(value or "").strip()

    @field_validator("axis_codes", mode="before")
    @classmethod
    def normalize_axis_codes(cls, value: Any) -> list[str]:
        raw_values = value
        if isinstance(value, str):
            raw_values = value.replace("，", ",").split(",")
        if not isinstance(raw_values, list):
            return []
        axis_codes: list[str] = []
        for item in raw_values:
            axis_code = str(item or "").strip()
            if axis_code and axis_code not in axis_codes:
                axis_codes.append(axis_code)
        return sort_axis_codes(axis_codes)


class ExperimentEndRequest(BaseModel):
    task_code: str = Field(min_length=1)
    lab_code: str = Field(min_length=1)
    experiment_code: str = Field(min_length=1)
    sub_experiment_code: str = Field(default="", validation_alias=AliasChoices("sub_experiment_code", "subExperimentCode"))
    run_no: str = Field(min_length=1, validation_alias=AliasChoices("run_no", "runNo"))
    axis_code: str = Field(default="", validation_alias=AliasChoices("axis_code", "axisCode"))
    next_axis_code: str = Field(default="", validation_alias=AliasChoices("next_axis_code", "nextAxisCode"))

    @field_validator(
        "task_code",
        "lab_code",
        "experiment_code",
        "sub_experiment_code",
        "run_no",
        "axis_code",
        "next_axis_code",
        mode="before",
    )
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


def require_mqtt_laboratory(lab_code: str, *, operation: str = "") -> None:
    try:
        require_laboratory_interface(LAB_INTERFACE_MQTT, operation=operation, lab_code=lab_code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
    require_mqtt_laboratory(request.lab_code, operation=LAB_INTERFACE_OPERATION_FIXTURE_READY)
    payload = {
        "task_code": request.task_code,
        "lab_code": request.lab_code,
        "experiment_code": request.experiment_code,
        "sample_type": request.sample_type,
        "sample_count": request.sample_count,
        "fixture_install_id": request.fixture_install_id,
        "tray_codes": request.tray_codes,
    }
    missing_fields = [
        field_name
        for field_name, value in (
            ("fixture_install_id", request.fixture_install_id),
            ("tray_codes", request.tray_codes),
            ("experiment_code", request.experiment_code),
        )
        if not value
    ]
    if missing_fields:
        raise HTTPException(
            status_code=422,
            detail=f"夹具安装命令缺少：{', '.join(missing_fields)}。请刷新实验室页面后重新下发。",
        )
    try:
        register_pending_fixture_installation(
            fixture_install_id=request.fixture_install_id,
            task_code=request.task_code,
            experiment_code=request.experiment_code,
            lab_code=request.lab_code,
            tray_codes=request.tray_codes,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"夹具安装待确认记录创建失败：{exc}") from exc
    try:
        result = publish_laboratory_command("INSTALL_FIXTURE", payload)
    except RuntimeError as exc:
        mark_fixture_installation_failed(request.fixture_install_id)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not result.get("published"):
        mark_fixture_installation_failed(request.fixture_install_id)
    return {"ok": True, "payload": payload, **result}


@router.post("/laboratory/ready")
def publish_ready(request: ReadyRequest) -> dict[str, Any]:
    require_mqtt_laboratory(request.lab_code, operation=LAB_INTERFACE_OPERATION_EXPERIMENT_START)
    axis_repository = None
    if request.axis_adjustment_ready:
        if not request.run_no or not request.current_axis_code:
            raise HTTPException(status_code=422, detail="轴向调整完成必须携带 run_no 和 current_axis_code")
        axis_repository = MySQLMqEventRepository()
        try:
            axis_repository.mark_axis_adjustment_ready(
                request.run_no,
                request.current_axis_code,
                now_iso(),
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    payload = {
        "task_code": request.task_code,
        "lab_code": request.lab_code,
        "experiment_code": request.experiment_code,
        "run_no": request.run_no or generated_run_no(),
    }
    if request.sub_experiment_code:
        payload["sub_experiment_code"] = request.sub_experiment_code
    if request.schedule_id:
        payload["schedule_id"] = request.schedule_id
    if request.axis_codes:
        payload["axis_codes"] = request.axis_codes
    if request.axis_batch_no:
        payload["axis_batch_no"] = request.axis_batch_no
    if request.current_axis_code:
        payload["current_axis_code"] = request.current_axis_code
    try:
        result = publish_laboratory_command("READY", payload)
    except RuntimeError as exc:
        if axis_repository is not None:
            axis_repository.restore_axis_adjustment(request.run_no, request.current_axis_code, now_iso())
            publish_storage_update(["mes.experiment_run_steps"])
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if axis_repository is not None:
        if not result.get("published"):
            axis_repository.restore_axis_adjustment(request.run_no, request.current_axis_code, now_iso())
        publish_storage_update(["mes.experiment_run_steps"])
    return {"ok": True, "payload": payload, **result}


@router.post("/laboratory/end-request")
def publish_experiment_end_request(request: ExperimentEndRequest) -> dict[str, Any]:
    require_mqtt_laboratory(request.lab_code, operation=LAB_INTERFACE_OPERATION_EXPERIMENT_END)
    payload = {
        "task_code": request.task_code,
        "lab_code": request.lab_code,
        "experiment_code": request.experiment_code,
        "run_no": request.run_no,
    }
    for key, value in (
        ("sub_experiment_code", request.sub_experiment_code),
        ("axis_code", request.axis_code),
        ("next_axis_code", request.next_axis_code),
    ):
        if value:
            payload[key] = value
    try:
        result = publish_laboratory_command("END_REQUEST", payload)
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
