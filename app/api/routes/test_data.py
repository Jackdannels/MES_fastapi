from __future__ import annotations

import ipaddress
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from app.core.config import settings
from app.core.storage_backend import get_storage_backend
from app.services.test_data_access import (
    create_experiment_share,
    create_share_archive,
    create_task_share,
    is_loopback_client,
    list_task_data,
    open_experiment_folder,
    open_task_folder,
    render_share_page,
    resolve_shared_file,
    select_test_data_directory,
)
from app.services.test_data_reports import (
    list_export_records,
    read_test_data_settings,
    retry_failed_exports,
    update_test_data_settings,
)


router = APIRouter(prefix="/api/test-data", tags=["test-data"])


class DataSettingsRequest(BaseModel):
    savePath: str


class RetryFailedExportsRequest(BaseModel):
    exportKeys: list[str] = Field(default_factory=list)


def _validated_http_base_url(value: str, *, require_origin: bool = False) -> str:
    normalized = str(value or "").strip().rstrip("/")
    try:
        parsed = urlsplit(normalized)
        _validated_port = parsed.port
    except ValueError as exc:
        raise ValueError("试验数据下载地址格式无效") from exc
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or (require_origin and parsed.path not in {"", "/"})
    ):
        raise ValueError("试验数据下载地址必须是有效的 HTTP(S) 地址")
    # Accessing parsed.port above validates its numeric range. Preserve the
    # caller-provided host spelling, including bracketed IPv6 addresses.
    return normalized


def resolve_test_data_public_base_url(request: Request, configured_url: str = "") -> str:
    """Resolve a share URL without trusting raw proxy headers in application code.

    An explicit deployment URL wins. Otherwise, a browser Origin may supply the
    frontend port when it uses the request hostname. A private/loopback Origin is
    also allowed when a development proxy exposes only a loopback backend Host.
    Raw forwarding headers are left to trusted ASGI proxy handling.
    """

    configured = str(configured_url or "").strip()
    if configured and configured.lower() != "auto":
        return _validated_http_base_url(configured)

    request_base = _validated_http_base_url(
        f"{request.url.scheme}://{request.url.netloc}",
        require_origin=True,
    )
    origin = str(request.headers.get("origin") or "").strip()
    if not origin:
        return request_base
    try:
        origin_base = _validated_http_base_url(origin, require_origin=True)
        origin_host = urlsplit(origin_base).hostname
        request_host = request.url.hostname
    except ValueError:
        return request_base
    origin_is_local = is_loopback_client(origin_host)
    try:
        origin_ip = ipaddress.ip_address(str(origin_host or "").strip("[]"))
        origin_is_local = origin_is_local or origin_ip.is_private
    except ValueError:
        pass
    if origin_host and request_host and (
        origin_host.casefold() == request_host.casefold()
        or (is_loopback_client(request_host) and origin_is_local)
    ):
        return origin_base
    return request_base


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return read_test_data_settings(storage=get_storage_backend())


@router.put("/settings")
def put_settings(payload: DataSettingsRequest) -> dict[str, Any]:
    try:
        return update_test_data_settings(payload.savePath, storage=get_storage_backend())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/exports")
def get_exports(status: str = Query(default="")) -> dict[str, Any]:
    items = list_export_records(storage=get_storage_backend(), status=status)
    return {
        "items": items,
        "total": len(items),
        "failedCount": sum(1 for item in items if str(item.get("status") or "") == "failed"),
    }


@router.post("/retry-failed")
def retry_failed(payload: RetryFailedExportsRequest | None = None) -> dict[str, Any]:
    return retry_failed_exports(
        export_keys=(payload.exportKeys if payload else []),
        storage=get_storage_backend(),
    )


def _require_loopback(request: Request) -> None:
    host = request.client.host if request.client else ""
    if not is_loopback_client(host):
        raise HTTPException(status_code=403, detail="该功能仅允许在 MES 主机本机操作")


@router.post("/select-directory")
def select_directory(request: Request) -> dict[str, Any]:
    _require_loopback(request)
    storage = get_storage_backend()
    initial_path = read_test_data_settings(storage=storage)["savePath"]
    try:
        return select_test_data_directory(initial_path)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/tasks")
def get_task_data(
    query: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
) -> dict[str, Any]:
    return list_task_data(
        storage=get_storage_backend(),
        query=query,
        page=page,
        page_size=page_size,
    )


@router.post("/tasks/{task_code}/open-folder")
def open_task_data_folder(task_code: str, request: Request) -> dict[str, Any]:
    _require_loopback(request)
    try:
        folder = open_task_folder(storage=get_storage_backend(), task_code=task_code)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "path": str(folder)}


@router.post("/tasks/{task_code}/share")
def share_task(task_code: str, request: Request) -> dict[str, Any]:
    try:
        return create_task_share(
            storage=get_storage_backend(),
            task_code=task_code,
            public_base_url=resolve_test_data_public_base_url(
                request,
                settings.TEST_DATA_PUBLIC_BASE_URL,
            ),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/tasks/{task_code}/experiments/{experiment_code}/open-folder")
def open_folder(task_code: str, experiment_code: str, request: Request) -> dict[str, Any]:
    _require_loopback(request)
    try:
        folder = open_experiment_folder(
            storage=get_storage_backend(),
            task_code=task_code,
            experiment_code=experiment_code,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "path": str(folder)}


@router.post("/tasks/{task_code}/experiments/{experiment_code}/share")
def share_experiment(task_code: str, experiment_code: str, request: Request) -> dict[str, Any]:
    try:
        return create_experiment_share(
            storage=get_storage_backend(),
            task_code=task_code,
            experiment_code=experiment_code,
            public_base_url=resolve_test_data_public_base_url(
                request,
                settings.TEST_DATA_PUBLIC_BASE_URL,
            ),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/share/{token}", response_class=HTMLResponse)
def shared_experiment_page(token: str) -> HTMLResponse:
    try:
        page = render_share_page(storage=get_storage_backend(), token=token)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})


@router.get("/share/{token}/files/{export_key:path}")
def download_shared_file(token: str, export_key: str) -> FileResponse:
    try:
        path, file_name = resolve_shared_file(
            storage=get_storage_backend(),
            token=token,
            export_key=export_key,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, media_type="application/pdf", filename=file_name)


@router.get("/share/{token}/archive.zip")
def download_shared_archive(token: str) -> FileResponse:
    try:
        path, file_name = create_share_archive(storage=get_storage_backend(), token=token)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="application/zip",
        filename=file_name,
        background=BackgroundTask(path.unlink, missing_ok=True),
    )
