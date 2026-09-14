from copy import deepcopy
from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.routes import test_data as test_data_route
from app.services import test_data_access


class MemoryStorage:
    def __init__(self, values=None):
        self.values = deepcopy(values or {})

    def read(self, key):
        return deepcopy(self.values.get(key, []))

    def write(self, key, value):
        self.values[key] = deepcopy(value)


def test_settings_api_validates_and_persists_save_path(client, tmp_path, monkeypatch):
    storage = MemoryStorage()
    monkeypatch.setattr(test_data_route, "get_storage_backend", lambda: storage)

    response = client.put("/api/test-data/settings", json={"savePath": str(tmp_path / "reports")})
    assert response.status_code == 200
    assert response.json()["writable"] is True
    assert response.json()["savePath"].endswith("reports")

    read_response = client.get("/api/test-data/settings")
    assert read_response.status_code == 200
    assert read_response.json()["savePath"] == response.json()["savePath"]

    invalid_response = client.put("/api/test-data/settings", json={"savePath": "relative/path"})
    assert invalid_response.status_code == 400


def test_exports_api_lists_failures_and_retries_selected_keys(client, monkeypatch):
    storage = MemoryStorage(
        {
            "mes.test_data_exports": [
                {"exportKey": "RUN|x+|SP-1", "status": "failed", "updatedAt": "2026-07-27 10:00:00"},
                {"exportKey": "RUN|x+|SP-2", "status": "success", "updatedAt": "2026-07-27 09:00:00"},
            ]
        }
    )
    monkeypatch.setattr(test_data_route, "get_storage_backend", lambda: storage)

    response = client.get("/api/test-data/exports", params={"status": "failed"})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["failedCount"] == 1

    captured = {}

    def fake_retry(*, export_keys, storage):
        captured["exportKeys"] = list(export_keys)
        return {"ok": True, "attempted": 1, "succeeded": 1, "failed": 0, "items": [], "error": ""}

    monkeypatch.setattr(test_data_route, "retry_failed_exports", fake_retry)
    retry_response = client.post(
        "/api/test-data/retry-failed",
        json={"exportKeys": ["RUN|x+|SP-1"]},
    )
    assert retry_response.status_code == 200
    assert retry_response.json()["succeeded"] == 1
    assert captured["exportKeys"] == ["RUN|x+|SP-1"]


def _task_data_storage(tmp_path):
    report = tmp_path / "TASK-1" / "振动试验" / "X轴向" / "2026-07-27 09.40-10.00" / "SP-1.pdf"
    report.parent.mkdir(parents=True)
    report.write_bytes(b"%PDF-1.4\n% test\n")
    return MemoryStorage(
        {
            "mes.test_data_settings": [{"savePath": str(tmp_path)}],
            "mes.tasks": [{"code": "TASK-1", "name": "任务一"}],
            "mes.experiments": [
                {
                    "task_code": "TASK-1",
                    "experiment_code": "EXP-VIB",
                    "experiment_name": "振动试验",
                    "status": "实验已完成",
                    "axis_codes": ["x", "y+"],
                },
                {
                    "task_code": "TASK-1",
                    "experiment_code": "EXP-SALT",
                    "experiment_name": "盐雾试验",
                    "status": "实验进行中",
                },
            ],
            "mes.experiment_samples": [
                {"task_code": "TASK-1", "experiment_code": "EXP-VIB", "sample_code": "SP-1"},
                {"task_code": "TASK-1", "experiment_code": "EXP-VIB", "sample_code": "SP-2"},
            ],
            "mes.test_data_exports": [
                {
                    "exportKey": "RUN-1|x|SP-1",
                    "taskCode": "TASK-1",
                    "experimentCode": "EXP-VIB",
                    "experimentName": "振动试验",
                    "axisCode": "x",
                    "sampleCode": "SP-1",
                    "status": "success",
                    "filePath": str(report),
                    "relativePath": str(report.relative_to(tmp_path)),
                    "updatedAt": "2026-07-27 10:00:00",
                }
            ],
            "mes.test_data_shares": [],
        }
    )


def test_task_data_api_counts_completed_experiments_separately_from_pdf_health(client, tmp_path, monkeypatch):
    storage = _task_data_storage(tmp_path)
    monkeypatch.setattr(test_data_route, "get_storage_backend", lambda: storage)

    response = client.get("/api/test-data/tasks", params={"query": "TASK-1", "pageSize": 10})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    task = payload["items"][0]
    assert task["completedExperimentCount"] == 1
    assert task["totalExperimentCount"] == 2
    assert task["progressPercent"] == 50
    assert task["folderAvailable"] is True
    vibration = task["experiments"][0]
    assert vibration["successfulPdfCount"] == 1
    assert vibration["missingPdfCount"] == 3
    assert vibration["folderAvailable"] is True


def test_task_data_api_naturally_sorts_full_task_codes_before_pagination(client, tmp_path, monkeypatch):
    task_codes = [f"SYLU-2026-09-{sequence:03d}" for sequence in range(12, 0, -1)]
    storage = MemoryStorage(
        {
            "mes.test_data_settings": [{"savePath": str(tmp_path)}],
            "mes.tasks": [{"code": task_code} for task_code in task_codes],
            "mes.experiments": [],
            "mes.experiment_samples": [],
        }
    )
    monkeypatch.setattr(test_data_route, "get_storage_backend", lambda: storage)

    first_page = client.get("/api/test-data/tasks", params={"page": 1, "pageSize": 5})
    second_page = client.get("/api/test-data/tasks", params={"page": 2, "pageSize": 5})

    assert first_page.status_code == 200
    assert [item["taskCode"] for item in first_page.json()["items"]] == [
        "SYLU-2026-09-001",
        "SYLU-2026-09-002",
        "SYLU-2026-09-003",
        "SYLU-2026-09-004",
        "SYLU-2026-09-005",
    ]
    assert [item["taskCode"] for item in second_page.json()["items"]] == [
        "SYLU-2026-09-006",
        "SYLU-2026-09-007",
        "SYLU-2026-09-008",
        "SYLU-2026-09-009",
        "SYLU-2026-09-010",
    ]


@pytest.mark.parametrize(
    ("selection", "cancelled"),
    [("C:\\MES\\reports", False), ("", True)],
)
def test_select_directory_api_returns_native_picker_result(client, monkeypatch, selection, cancelled):
    storage = MemoryStorage({"mes.test_data_settings": []})
    monkeypatch.setattr(test_data_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        test_data_route,
        "select_test_data_directory",
        lambda _initial: {"savePath": selection, "cancelled": cancelled},
    )

    response = client.post("/api/test-data/select-directory")

    assert response.status_code == 200
    assert response.json() == {"savePath": selection, "cancelled": cancelled}


def test_host_file_operations_reject_non_loopback_clients():
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/test-data/select-directory",
            "headers": [],
            "client": ("192.168.110.20", 50000),
            "server": ("192.168.110.15", 8000),
            "scheme": "http",
            "query_string": b"",
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        test_data_route._require_loopback(request)

    assert exc_info.value.status_code == 403


def test_open_folder_api_only_opens_resolved_task_and_experiment_folders(client, tmp_path, monkeypatch):
    storage = _task_data_storage(tmp_path)
    opened = []
    monkeypatch.setattr(test_data_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(test_data_access.os, "startfile", lambda path: opened.append(Path(path)))

    response = client.post("/api/test-data/tasks/TASK-1/experiments/EXP-VIB/open-folder")
    task_response = client.post("/api/test-data/tasks/TASK-1/open-folder")

    assert response.status_code == 200
    assert task_response.status_code == 200
    assert opened == [
        (tmp_path / "TASK-1" / "振动试验").resolve(),
        (tmp_path / "TASK-1").resolve(),
    ]


def test_share_api_uses_current_same_host_browser_origin_in_auto_mode(client, tmp_path, monkeypatch):
    storage = _task_data_storage(tmp_path)
    monkeypatch.setattr(test_data_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(test_data_route.settings, "TEST_DATA_PUBLIC_BASE_URL", "auto")

    response = client.post(
        "/api/test-data/tasks/TASK-1/experiments/EXP-VIB/share",
        headers={
            "host": "192.168.110.77:8000",
            "origin": "http://192.168.110.77:5173",
        },
    )

    assert response.status_code == 200
    assert response.json()["url"].startswith("http://192.168.110.77:5173/api/test-data/share/")


def test_share_api_uses_browser_origin_when_dev_proxy_targets_loopback(client, tmp_path, monkeypatch):
    storage = _task_data_storage(tmp_path)
    monkeypatch.setattr(test_data_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(test_data_route.settings, "TEST_DATA_PUBLIC_BASE_URL", "auto")

    response = client.post(
        "/api/test-data/tasks/TASK-1/experiments/EXP-VIB/share",
        headers={
            "host": "127.0.0.1:8000",
            "origin": "http://192.168.110.77:5173",
        },
    )

    assert response.status_code == 200
    assert response.json()["url"].startswith("http://192.168.110.77:5173/api/test-data/share/")


def test_share_url_auto_mode_ignores_cross_host_origin_and_raw_proxy_headers():
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/test-data/tasks/TASK-1/share",
            "headers": [
                (b"host", b"mes-lab.local:15173"),
                (b"origin", b"https://attacker.example"),
                (b"x-forwarded-host", b"attacker.example"),
                (b"x-forwarded-proto", b"https"),
            ],
            "client": ("192.168.110.20", 50000),
            "server": ("mes-lab.local", 15173),
            "scheme": "http",
            "query_string": b"",
        }
    )

    assert test_data_route.resolve_test_data_public_base_url(request, "") == "http://mes-lab.local:15173"

    loopback_request = Request(
        {
            **request.scope,
            "headers": [
                (b"host", b"127.0.0.1:8000"),
                (b"origin", b"https://attacker.example"),
            ],
            "server": ("127.0.0.1", 8000),
        }
    )
    assert test_data_route.resolve_test_data_public_base_url(loopback_request, "") == "http://127.0.0.1:8000"


def test_share_url_explicit_https_deployment_address_overrides_request():
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/test-data/tasks/TASK-1/share",
            "headers": [(b"host", b"192.168.110.77:8000")],
            "client": ("192.168.110.20", 50000),
            "server": ("192.168.110.77", 8000),
            "scheme": "http",
            "query_string": b"",
        }
    )

    assert (
        test_data_route.resolve_test_data_public_base_url(request, "https://mes.example.com")
        == "https://mes.example.com"
    )


def test_share_api_lists_downloads_and_builds_zip_without_exposing_outside_root(client, tmp_path, monkeypatch):
    storage = _task_data_storage(tmp_path)
    outside = tmp_path.parent / "outside.pdf"
    outside.write_bytes(b"outside")
    exports = storage.values["mes.test_data_exports"]
    exports.append(
        {
            **exports[0],
            "exportKey": "RUN-1|x|OUTSIDE",
            "sampleCode": "OUTSIDE",
            "filePath": str(outside),
        }
    )
    monkeypatch.setattr(test_data_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(test_data_route.settings, "TEST_DATA_PUBLIC_BASE_URL", "http://192.168.110.15:8000")

    share_response = client.post("/api/test-data/tasks/TASK-1/experiments/EXP-VIB/share")
    assert share_response.status_code == 200
    share = share_response.json()
    assert share["url"].startswith("http://192.168.110.15:8000/api/test-data/share/")

    page = client.get(f"/api/test-data/share/{share['token']}")
    assert page.status_code == 200
    assert "SP-1.pdf" in page.text
    assert "OUTSIDE" not in page.text

    export_key = quote("RUN-1|x|SP-1", safe="")
    download = client.get(f"/api/test-data/share/{share['token']}/files/{export_key}")
    assert download.status_code == 200
    assert download.content.startswith(b"%PDF")

    archive = client.get(f"/api/test-data/share/{share['token']}/archive.zip")
    assert archive.status_code == 200
    assert archive.content.startswith(b"PK")

    rejected = client.get(f"/api/test-data/share/{share['token']}/files/RUN-1%7Cx%7COUTSIDE")
    assert rejected.status_code == 404

    salt_report = tmp_path / "TASK-1" / "盐雾试验" / "2026-07-27 10.00-11.00" / "SP-2.pdf"
    salt_report.parent.mkdir(parents=True)
    salt_report.write_bytes(b"%PDF-1.4\n% salt\n")
    exports.append(
        {
            **exports[0],
            "exportKey": "RUN-2||SP-2",
            "experimentCode": "EXP-SALT",
            "experimentName": "盐雾试验",
            "axisCode": "",
            "sampleCode": "SP-2",
            "filePath": str(salt_report),
            "relativePath": str(salt_report.relative_to(tmp_path)),
        }
    )
    task_share_response = client.post("/api/test-data/tasks/TASK-1/share")
    assert task_share_response.status_code == 200
    task_share = task_share_response.json()
    assert task_share["experimentCode"] == ""

    task_page = client.get(f"/api/test-data/share/{task_share['token']}")
    assert task_page.status_code == 200
    assert "SP-1.pdf" in task_page.text
    assert "SP-2.pdf" in task_page.text

    task_archive = client.get(f"/api/test-data/share/{task_share['token']}/archive.zip")
    assert task_archive.status_code == 200
    assert "TASK-1.zip" in task_archive.headers["content-disposition"]
