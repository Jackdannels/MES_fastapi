from uuid import uuid4

import pytest

from app.api.routes import resource_inventory as routes
from app.services.resource_inventory import append_replenishment, inventory_summary


@pytest.fixture
def backend(monkeypatch):
    class Backend:
        ledger = []
        def read_resource_inventory(self): return inventory_summary(self.ledger)
        def replenish_resource_inventory(self, **kwargs):
            self.ledger = append_replenishment(self.ledger, **kwargs)
            return self.read_resource_inventory()
    instance = Backend()
    monkeypatch.setattr(routes, "get_storage_backend", lambda: instance)
    monkeypatch.setattr(routes, "publish_storage_update", lambda keys: None)
    return instance


def test_inventory_read_and_central_replenishment_replay(client, backend):
    assert client.get("/api/device-resources").json()["resources"][0]["remaining"] == 100
    body = {"resource": "salt", "quantity": 20, "request_id": str(uuid4()), "note": "批次A"}
    assert client.post("/api/device-resources/replenishments", json=body).status_code == 401
    assert client.post("/auth/login", json={"username": "test-admin", "password": "test-password", "module": "central"}).status_code == 200
    for _ in range(2):
        response = client.post("/api/device-resources/replenishments", json=body)
        assert response.status_code == 200, response.text
        assert response.json()["resources"][0]["remaining"] == 120
    assert len(response.json()["records"]) == 1
    assert response.json()["records"][0]["operator"] == "test-admin"
    assert client.post("/api/device-resources/replenishments", json={**body, "quantity": 21}).status_code == 409


@pytest.mark.parametrize("change", [{"resource": "tray"}, {"quantity": 0}, {"quantity": 1.5}, {"quantity": True}, {"quantity": "20"}, {"quantity": 10001}, {"request_id": "bad"}, {"note": "a" * 121}])
def test_invalid_replenishment_never_changes_inventory(client, backend, change):
    body = {"resource": "salt", "quantity": 20, "request_id": str(uuid4()), **change}
    assert client.post("/api/device-resources/replenishments", json=body).status_code == 422
    assert backend.ledger == []


def test_non_central_session_cannot_replenish(client, backend):
    client.post("/auth/login", json={"username": "test-admin", "password": "test-password", "module": "visual"})
    assert client.post("/api/device-resources/replenishments", json={"resource": "mold", "quantity": 5, "request_id": str(uuid4())}).status_code == 403
    assert backend.ledger == []
