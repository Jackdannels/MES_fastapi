from fastapi import FastAPI
from fastapi.testclient import TestClient


class FakeMasterDataStorage:
    def list_test_types(self):
        return [
            {
                "test_type_id": 6,
                "test_type_code": "YW",
                "test_type_name": "盐雾试验",
                "test_category": "环境试验",
                "default_duration_hour": 24,
                "status": 1,
                "remark": "",
            }
        ]

    def list_labs(self):
        return [
            {
                "lab_id": 9,
                "lab_code": "LAB_SALT",
                "lab_name": "盐雾试验室",
                "lab_type": "实验室",
                "test_type_id": 6,
                "test_type_code": "YW",
                "test_type_name": "盐雾试验",
                "capacity": 4,
                "location_desc": "",
                "status": 1,
                "remark": "",
            }
        ]


def build_client(monkeypatch):
    from app.api.routes import master_data as master_data_route

    monkeypatch.setattr(master_data_route, "get_storage_backend", lambda: FakeMasterDataStorage())
    app = FastAPI()
    app.include_router(master_data_route.router)
    return TestClient(app)


def test_test_types_endpoint_falls_back_to_seed_data_when_storage_is_unavailable(monkeypatch):
    from app.api.routes import master_data as master_data_route

    monkeypatch.setattr(master_data_route, "get_storage_backend", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    app = FastAPI()
    app.include_router(master_data_route.router)

    response = TestClient(app).get("/api/master/test-types")

    assert response.status_code == 200
    assert "盐雾试验" in {item["name"] for item in response.json()}


def test_test_types_endpoint_keeps_empty_storage_result(monkeypatch):
    from app.api.routes import master_data as master_data_route

    class EmptyMasterDataStorage:
        def list_test_types(self):
            return []

    monkeypatch.setattr(master_data_route, "get_storage_backend", lambda: EmptyMasterDataStorage())
    app = FastAPI()
    app.include_router(master_data_route.router)

    response = TestClient(app).get("/api/master/test-types")

    assert response.status_code == 200
    assert response.json() == []


def test_labs_endpoint_fallback_keeps_test_type_name(monkeypatch):
    from app.api.routes import master_data as master_data_route

    monkeypatch.setattr(master_data_route, "get_storage_backend", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    app = FastAPI()
    app.include_router(master_data_route.router)

    response = TestClient(app).get("/api/master/labs")

    assert response.status_code == 200
    salt_lab = next(item for item in response.json() if item["code"] == "LAB_SALT")
    assert salt_lab["testTypeCode"] == "YW"
    assert salt_lab["testTypeName"] == "盐雾试验"


def test_labs_endpoint_fallback_includes_second_hot_humid_lab(monkeypatch):
    from app.api.routes import master_data as master_data_route

    monkeypatch.setattr(master_data_route, "get_storage_backend", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    app = FastAPI()
    app.include_router(master_data_route.router)

    response = TestClient(app).get("/api/master/labs")

    assert response.status_code == 200
    hot_humid_lab = next(item for item in response.json() if item["code"] == "LAB_HOT_HUMID_2")
    assert hot_humid_lab == {
        "id": None,
        "code": "LAB_HOT_HUMID_2",
        "name": "高低温湿热二室",
        "type": "实验室",
        "testTypeId": None,
        "testTypeCode": "GDW",
        "testTypeName": "高低温湿热试验",
        "capacity": 4,
        "locationDesc": "",
        "status": 1,
        "remark": "FRONTEND_MASTER_DATA",
    }


def test_test_types_endpoint_hides_legacy_english_seed_rows(monkeypatch):
    from app.api.routes import master_data as master_data_route

    class LegacyMixedStorage:
        def list_test_types(self):
            return [
                {"test_type_id": 1, "test_type_code": "TT_IMPACT", "test_type_name": "Impact Test", "status": 1},
                {"test_type_id": 2, "test_type_code": "YW", "test_type_name": "盐雾试验", "status": 1},
            ]

    monkeypatch.setattr(master_data_route, "get_storage_backend", lambda: LegacyMixedStorage())
    app = FastAPI()
    app.include_router(master_data_route.router)

    response = TestClient(app).get("/api/master/test-types")

    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["盐雾试验"]


def test_labs_endpoint_hides_legacy_english_seed_rows(monkeypatch):
    from app.api.routes import master_data as master_data_route

    class LegacyMixedStorage:
        def list_labs(self):
            return [
                {
                    "lab_id": 1,
                    "lab_code": "LAB_IMPACT",
                    "lab_name": "Impact Lab",
                    "lab_type": "LAB",
                    "test_type_code": "TT_IMPACT",
                    "test_type_name": "Impact Test",
                    "status": 1,
                },
                {
                    "lab_id": 9,
                    "lab_code": "LAB_SALT",
                    "lab_name": "盐雾试验室",
                    "lab_type": "实验室",
                    "test_type_code": "YW",
                    "test_type_name": "盐雾试验",
                    "status": 1,
                },
            ]

    monkeypatch.setattr(master_data_route, "get_storage_backend", lambda: LegacyMixedStorage())
    app = FastAPI()
    app.include_router(master_data_route.router)

    response = TestClient(app).get("/api/master/labs")

    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["盐雾试验室"]


def test_test_types_endpoint_returns_enabled_master_data(monkeypatch):
    client = build_client(monkeypatch)

    response = client.get("/api/master/test-types")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": 6,
            "code": "YW",
            "name": "盐雾试验",
            "category": "环境试验",
            "defaultDurationHour": 24,
            "status": 1,
            "remark": "",
        }
    ]


def test_labs_endpoint_returns_lab_master_data_with_test_type(monkeypatch):
    client = build_client(monkeypatch)

    response = client.get("/api/master/labs")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": 9,
            "code": "LAB_SALT",
            "name": "盐雾试验室",
            "type": "实验室",
            "testTypeId": 6,
            "testTypeCode": "YW",
            "testTypeName": "盐雾试验",
            "capacity": 4,
            "locationDesc": "",
            "status": 1,
            "remark": "",
        }
    ]
