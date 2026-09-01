from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import AliasChoices, BaseModel, Field, field_validator

from app.core.axis_codes import sort_axis_codes
from app.core.config import settings
from app.core.storage_backend import get_storage_backend
from app.core.master_data import (
    LAB_INTERFACE_MQTT,
    LAB_INTERFACE_OPERATION_EXPERIMENT_END_REQUEST,
    LAB_INTERFACE_OPERATION_EXPERIMENT_END,
    LAB_INTERFACE_OPERATION_EXPERIMENT_READY,
    LAB_INTERFACE_OPERATION_EXPERIMENT_START,
    LAB_INTERFACE_OPERATION_FIXTURE_READY,
    LAB_INTERFACE_OPERATION_SAMPLE_INSTALL,
    require_laboratory_interface,
)
from app.services.experiment_schedule_sequence import (
    ExperimentScheduleSequenceError,
    assert_common_next_scheduled_step,
)
from app.services.fixture_installations import mark_fixture_installation_failed, normalize_tray_codes, register_pending_fixture_installation
from app.services.laboratory_operations import read_laboratory_task_payload
from app.services.mq_event_processor import (
    MySQLMqEventRepository,
    generated_run_no,
    now_iso,
    process_laboratory_event,
    storage_completion_snapshot,
)
from app.services.mq_publisher import publish_laboratory_command
from app.services.mq_runtime import default_mq_runtime
from app.services.storage_update_bus import publish_storage_update
from app.services.appearance_inspection import validate_mid_experiment_trays_ready_for_resume
from app.services.salt_spray_pause import (
    PAUSED,
    RUNNING,
    SALT_LAB_CODE,
    TERMINATION_TYPES,
)


router = APIRouter(prefix="/api/mq", tags=["mq"])
MAX_SAMPLE_COUNT = 99


class FixtureInstallRequest(BaseModel):
    task_code: str = Field(min_length=1)
    lab_code: str = Field(min_length=1)
    experiment_code: str = ""
    sub_experiment_code: str = Field(default="", validation_alias=AliasChoices("sub_experiment_code", "subExperimentCode"))
    schedule_id: str = Field(default="", validation_alias=AliasChoices("schedule_id", "scheduleId", "schedule_no", "scheduleNo"))
    sample_type: str = ""
    sample_count: int = Field(ge=0, le=MAX_SAMPLE_COUNT)
    fixture_install_id: str = Field(default="", validation_alias=AliasChoices("fixture_install_id", "fixtureInstallId"))
    tray_codes: list[str] = Field(default_factory=list, validation_alias=AliasChoices("tray_codes", "trayCodes"))

    @field_validator("task_code", "lab_code", "experiment_code", "sub_experiment_code", "schedule_id", "sample_type", mode="before")
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
    tray_codes: list[str] = Field(default_factory=list, validation_alias=AliasChoices("tray_codes", "trayCodes"))
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

    @field_validator("tray_codes", mode="before")
    @classmethod
    def normalize_trays(cls, value: Any) -> list[str]:
        raw_values = value.replace("，", ",").split(",") if isinstance(value, str) else value
        return normalize_tray_codes(raw_values)


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


class SaltPauseRequest(BaseModel):
    task_code: str = Field(min_length=1)
    lab_code: str = Field(min_length=1)
    experiment_code: str = Field(min_length=1)
    run_no: str = Field(min_length=1, validation_alias=AliasChoices("run_no", "runNo"))
    inspection_tray_codes: list[str] = Field(default_factory=list, validation_alias=AliasChoices("inspection_tray_codes", "inspectionTrayCodes"))
    pause_reason: str = Field(min_length=1, max_length=500, validation_alias=AliasChoices("pause_reason", "pauseReason"))

    @field_validator("task_code", "lab_code", "experiment_code", "run_no", "pause_reason", mode="before")
    @classmethod
    def trim_pause_text(cls, value: Any) -> str:
        return str(value or "").strip()

    @field_validator("inspection_tray_codes", mode="before")
    @classmethod
    def normalize_pause_trays(cls, value: Any) -> list[str]:
        return normalize_tray_codes(value.replace("，", ",").split(",") if isinstance(value, str) else value)


class SaltResumeRequest(BaseModel):
    task_code: str = Field(min_length=1)
    lab_code: str = Field(min_length=1)
    experiment_code: str = Field(min_length=1)
    run_no: str = Field(min_length=1, validation_alias=AliasChoices("run_no", "runNo"))
    pause_no: str = Field(min_length=1, validation_alias=AliasChoices("pause_no", "pauseNo"))

    @field_validator("task_code", "lab_code", "experiment_code", "run_no", "pause_no", mode="before")
    @classmethod
    def trim_resume_text(cls, value: Any) -> str:
        return str(value or "").strip()


class SaltStopRequest(SaltResumeRequest):
    termination_type: str = Field(validation_alias=AliasChoices("termination_type", "terminationType"))
    termination_reason: str = Field(min_length=1, max_length=500, validation_alias=AliasChoices("termination_reason", "terminationReason"))

    @field_validator("termination_type", "termination_reason", mode="before")
    @classmethod
    def trim_stop_text(cls, value: Any) -> str:
        return str(value or "").strip()


def _salt_run_or_error(request: SaltPauseRequest | SaltResumeRequest) -> tuple[MySQLMqEventRepository, dict[str, Any]]:
    if request.lab_code != SALT_LAB_CODE:
        raise HTTPException(status_code=422, detail="盐雾暂停控制仅支持 LAB_SALT")
    repository = MySQLMqEventRepository()
    run = repository.find_run_by_no(request.run_no) or {}
    if not run:
        raise HTTPException(status_code=404, detail="实验运行不存在")
    if str(run.get("lab_code") or "").strip() != SALT_LAB_CODE:
        raise HTTPException(status_code=409, detail="实验运行不属于盐雾试验室")
    if str(run.get("task_no") or "").strip() != request.task_code or str(run.get("experiment_no") or "").strip() != request.experiment_code:
        raise HTTPException(status_code=409, detail="实验运行上下文不匹配")
    return repository, run


def _reject_pending_salt_command(repository: MySQLMqEventRepository, run_no: str) -> None:
    finder = getattr(repository, "find_pending_salt_command", None)
    pending = finder(run_no) if callable(finder) else {}
    if pending:
        raise HTTPException(status_code=409, detail="当前实验已有等待上位机确认的控制命令")


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


def assert_mq_next_schedule(
    *,
    task_code: str,
    tray_codes: list[str],
    schedule_id: str,
    experiment_code: str,
    sub_experiment_code: str = "",
    axis_batch_no: str = "",
    axis_codes: list[str] | None = None,
    lab_code: str = "",
) -> dict[str, Any]:
    if not schedule_id or not tray_codes:
        raise HTTPException(status_code=422, detail="实验命令必须携带 schedule_id 和 tray_codes，请刷新实验室页面后重试")
    storage = get_storage_backend()
    snapshot = storage_completion_snapshot(read_laboratory_task_payload(storage, task_code))
    try:
        return assert_common_next_scheduled_step(
            snapshot,
            task_code=task_code,
            tray_codes=tray_codes,
            schedule_id=schedule_id,
            experiment_code=experiment_code,
            sub_experiment_code=sub_experiment_code,
            axis_batch_no=axis_batch_no,
            axis_codes=axis_codes,
            lab_code=lab_code,
        )
    except ExperimentScheduleSequenceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


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
    require_mqtt_laboratory(request.lab_code, operation=LAB_INTERFACE_OPERATION_SAMPLE_INSTALL)
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
    assert_mq_next_schedule(
        task_code=request.task_code,
        tray_codes=request.tray_codes,
        schedule_id=request.schedule_id,
        experiment_code=request.experiment_code,
        sub_experiment_code=request.sub_experiment_code,
        lab_code=request.lab_code,
    )
    if request.schedule_id:
        payload["schedule_id"] = request.schedule_id
    if request.sub_experiment_code:
        payload["sub_experiment_code"] = request.sub_experiment_code
    try:
        register_pending_fixture_installation(
            fixture_install_id=request.fixture_install_id,
            task_code=request.task_code,
            experiment_code=request.experiment_code,
            schedule_id=request.schedule_id,
            sub_experiment_code=request.sub_experiment_code,
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
    require_mqtt_laboratory(request.lab_code, operation=LAB_INTERFACE_OPERATION_EXPERIMENT_READY)
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
    else:
        assert_mq_next_schedule(
            task_code=request.task_code,
            tray_codes=request.tray_codes,
            schedule_id=request.schedule_id,
            experiment_code=request.experiment_code,
            sub_experiment_code=request.sub_experiment_code,
            axis_batch_no=request.axis_batch_no,
            axis_codes=request.axis_codes,
            lab_code=request.lab_code,
        )
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
    require_mqtt_laboratory(request.lab_code, operation=LAB_INTERFACE_OPERATION_EXPERIMENT_END_REQUEST)
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


@router.post("/laboratory/pause-request")
def publish_salt_pause_request(request: SaltPauseRequest) -> dict[str, Any]:
    require_mqtt_laboratory(request.lab_code, operation=LAB_INTERFACE_OPERATION_EXPERIMENT_END_REQUEST)
    repository, run = _salt_run_or_error(request)
    _reject_pending_salt_command(repository, request.run_no)
    if str(run.get("run_status") or "").strip() != RUNNING:
        raise HTTPException(status_code=409, detail="只有实验进行中的盐雾实验可以暂停")
    stored_run_trays = get_storage_backend().read("mes.experiment_run_trays")
    run_trays = sorted({
        str(row.get("tray_code") or row.get("tray_no") or "").strip()
        for row in stored_run_trays
        if str(row.get("run_no") or "").strip() == request.run_no
        and str(row.get("tray_code") or row.get("tray_no") or "").strip()
    })
    if not run_trays:
        raise HTTPException(status_code=409, detail="当前盐雾实验没有可暂停的运行托盘")
    pause_no = f"pause-{uuid4().hex}"
    payload = request.model_dump()
    payload["inspection_tray_codes"] = run_trays
    payload["pause_no"] = pause_no
    try:
        result = publish_laboratory_command("PAUSE_REQUEST", payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "pauseNo": pause_no, "payload": payload, **result}


@router.post("/laboratory/resume-request")
def publish_salt_resume_request(request: SaltResumeRequest) -> dict[str, Any]:
    require_mqtt_laboratory(request.lab_code, operation=LAB_INTERFACE_OPERATION_EXPERIMENT_END_REQUEST)
    repository, run = _salt_run_or_error(request)
    _reject_pending_salt_command(repository, request.run_no)
    if str(run.get("run_status") or "").strip() != PAUSED:
        raise HTTPException(status_code=409, detail="只有已暂停的盐雾实验可以恢复")
    storage = get_storage_backend()
    snapshot = storage.read_all()
    pause = next((row for row in snapshot.get("mes.experiment_run_pauses", []) if str(row.get("pause_no") or "").strip() == request.pause_no), None)
    if not pause or str(pause.get("status") or "").strip() != PAUSED:
        raise HTTPException(status_code=409, detail="当前实验不存在可恢复的暂停区间")
    try:
        validate_mid_experiment_trays_ready_for_resume(snapshot, pause)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    payload = request.model_dump()
    try:
        result = publish_laboratory_command("RESUME_REQUEST", payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "payload": payload, **result}


@router.post("/laboratory/stop-request")
def publish_salt_stop_request(request: SaltStopRequest) -> dict[str, Any]:
    require_mqtt_laboratory(request.lab_code, operation=LAB_INTERFACE_OPERATION_EXPERIMENT_END_REQUEST)
    repository, run = _salt_run_or_error(request)
    _reject_pending_salt_command(repository, request.run_no)
    if str(run.get("run_status") or "").strip() != PAUSED:
        raise HTTPException(status_code=409, detail="只有已暂停的盐雾实验可以停止")
    pause = next(
        (row for row in get_storage_backend().read("mes.experiment_run_pauses") if str(row.get("pause_no") or "").strip() == request.pause_no),
        None,
    )
    if not pause or str(pause.get("run_no") or "").strip() != request.run_no or str(pause.get("status") or "").strip() != PAUSED:
        raise HTTPException(status_code=409, detail="当前实验不存在可停止的暂停区间")
    if request.termination_type not in TERMINATION_TYPES:
        raise HTTPException(status_code=422, detail="termination_type 仅支持 completion_criteria 或 abnormal")
    payload = request.model_dump()
    try:
        result = publish_laboratory_command("STOP_REQUEST", payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "payload": payload, **result}


@router.post("/laboratory/events/{event_name}")
def receive_laboratory_event(event_name: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    app_settings = getattr(request.app.state, "settings", settings)
    if app_settings.APP_ENV == "prod" or not app_settings.MQTT_HTTP_EVENT_INGRESS_ENABLED:
        raise HTTPException(status_code=404, detail="Not Found")
    lab_code = str(payload.get("lab_code") or "").strip()
    if not lab_code:
        raise HTTPException(status_code=422, detail="lab_code is required")
    topic = f"{str(settings.MQTT_TOPIC_PREFIX or 'mes/v1').strip().strip('/')}/labs/{lab_code}/events/{event_name}"
    try:
        return process_laboratory_event(topic, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
