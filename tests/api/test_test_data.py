from copy import deepcopy

from app.api.routes import test_data as test_data_route


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
