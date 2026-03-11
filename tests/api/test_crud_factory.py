from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest


def test_generated_crud_router_supports_full_lifecycle():
    from app.api.routes.crud_factory import build_crud_router

    app = FastAPI()
    app.include_router(build_crud_router("/widgets", "widgets", "Widget"))
    client = TestClient(app)

    created = client.post("/widgets", json={"name": "A"}).json()
    fetched = client.get(f"/widgets/{created['id']}")
    updated = client.put(f"/widgets/{created['id']}", json={"status": "inactive"}).json()
    deleted = client.delete(f"/widgets/{created['id']}")
    missing = client.get(f"/widgets/{created['id']}")

    assert fetched.status_code == 200
    assert fetched.json()["name"] == "A"
    assert updated["status"] == "inactive"
    assert deleted.status_code == 204
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Widget not found"}


@pytest.mark.parametrize(
    ("prefix", "name"),
    [
        ("/person", "Person A"),
        ("/customer", "Customer A"),
        ("/companydepartment", "Department A"),
        ("/permissions", "Permission A"),
        ("/productcatalog", "Catalog A"),
        ("/yt_barcode", "Barcode A"),
        ("/yt_file", "File A"),
        ("/yt_object", "Object A"),
        ("/yt_timesheet", "Timesheet A"),
    ],
)
def test_placeholder_routes_use_shared_crud_behavior(client, prefix, name):
    created = client.post(prefix, json={"name": name})
    assert created.status_code == 201

    item_id = created.json()["id"]
    fetched = client.get(f"{prefix}/{item_id}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == name
