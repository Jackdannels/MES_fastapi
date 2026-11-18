from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.services.terminal_enrollment import EnrollmentError, get_terminal_enrollment_service, stations

router = APIRouter(prefix="/enrollment")


class EnrollmentRequest(BaseModel):
    requestId: str = Field(max_length=32)
    token: str = Field(max_length=128)
    deviceId: str = Field(max_length=80)
    machineName: str = Field(default="", max_length=128)
    stationId: str = Field(max_length=64)


class PollRequest(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class ReviewRequest(BaseModel):
    approve: bool
    stationId: str = ""


class CleanupRequest(BaseModel):
    terminalIds: list[str] = Field(min_length=1, max_length=1000)


def call(action):
    try:
        return action(get_terminal_enrollment_service())
    except EnrollmentError as error:
        raise HTTPException(status_code=error.status, detail=str(error)) from error


def manager(request):
    from app.api.routes.terminal_control import require_central_manager
    return require_central_manager(request)


@router.get("/catalog")
def catalog(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {"items": stations()}


@router.post("/requests")
def submit(payload: EnrollmentRequest, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return call(lambda service: service.submit(request_id=payload.requestId, token=payload.token, device_id=payload.deviceId,
                machine_name=payload.machineName, station_id=payload.stationId, ip_address=request.client.host if request.client else ""))


@router.post("/requests/{request_id}/poll")
def poll(request_id: str, payload: PollRequest, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return call(lambda service: service.poll(request_id, payload.token, request.client.host if request.client else ""))


@router.post("/requests/{request_id}/package")
def client_package(request_id: str, payload: PollRequest):
    result = call(lambda service: service.poll(request_id, payload.token))
    if result["status"] != "issued":
        raise HTTPException(status_code=403, detail="申请尚未批准或绑定已失效。")
    path, _ = call(lambda service: service.package(result["assignedStation"]))
    return FileResponse(path, media_type="application/zip", filename=path.name, headers={"Cache-Control": "no-store"})


@router.get("/requests")
def list_requests(request: Request):
    manager(request)
    return {"items": call(lambda service: service.list_requests())}


@router.post("/requests/{request_id}/review")
def review(request_id: str, payload: ReviewRequest, request: Request):
    session = manager(request)
    return call(lambda service: service.review(request_id, payload.approve, payload.stationId, str(session.get("username") or "")))


@router.post("/terminals/{terminal_id}/reset")
def reset(terminal_id: str, request: Request):
    session = manager(request)
    return call(lambda service: service.reset(terminal_id, str(session.get("username") or "")))


@router.delete("/terminals/{terminal_id}")
def delete(terminal_id: str, request: Request):
    session = manager(request)
    return call(lambda service: service.reset(terminal_id, str(session.get("username") or ""), True))


@router.get("/legacy-preview")
def legacy_preview(request: Request):
    manager(request)
    return {"items": call(lambda service: service.legacy_preview())}


@router.post("/legacy-cleanup")
def cleanup(payload: CleanupRequest, request: Request):
    session = manager(request)
    return call(lambda service: service.cleanup(payload.terminalIds, str(session.get("username") or "")))
