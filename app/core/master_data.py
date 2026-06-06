from __future__ import annotations

from typing import Any


DEFAULT_TEST_TYPES: tuple[dict[str, Any], ...] = (
    {"test_type_code": "CJ", "test_type_name": "冲击试验", "test_category": "力学试验", "default_duration_hour": None, "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"test_type_code": "ZD", "test_type_name": "振动试验", "test_category": "力学试验", "default_duration_hour": None, "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"test_type_code": "SZH", "test_type_name": "四综合试验", "test_category": "综合试验", "default_duration_hour": None, "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"test_type_code": "WDC", "test_type_name": "温度冲击试验", "test_category": "环境试验", "default_duration_hour": None, "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"test_type_code": "GDW", "test_type_name": "高低温湿热试验", "test_category": "环境试验", "default_duration_hour": None, "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"test_type_code": "YW", "test_type_name": "盐雾试验", "test_category": "环境试验", "default_duration_hour": None, "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"test_type_code": "MJ", "test_type_name": "霉菌试验", "test_category": "环境试验", "default_duration_hour": None, "status": 1, "remark": "FRONTEND_MASTER_DATA"},
)

DEFAULT_LABS: tuple[dict[str, Any], ...] = (
    {"lab_code": "LAB_IMPACT_1", "lab_name": "冲击一室", "lab_type": "实验室", "test_type_code": "CJ", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "LAB_IMPACT_2", "lab_name": "冲击二室", "lab_type": "实验室", "test_type_code": "CJ", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "LAB_VIBRATION_1", "lab_name": "振动一室", "lab_type": "实验室", "test_type_code": "ZD", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "LAB_VIBRATION_2", "lab_name": "振动二室", "lab_type": "实验室", "test_type_code": "ZD", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "LAB_COMPREHENSIVE", "lab_name": "四综合实验室", "lab_type": "实验室", "test_type_code": "SZH", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "LAB_TEMP_SHOCK_1", "lab_name": "温度冲击一室", "lab_type": "实验室", "test_type_code": "WDC", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "LAB_TEMP_SHOCK_2", "lab_name": "温度冲击二室", "lab_type": "实验室", "test_type_code": "WDC", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "LAB_HOT_HUMID", "lab_name": "高低温湿热一室", "lab_type": "实验室", "test_type_code": "GDW", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "LAB_SALT", "lab_name": "盐雾试验室", "lab_type": "实验室", "test_type_code": "YW", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "LAB_MOLD", "lab_name": "霉菌试验室", "lab_type": "实验室", "test_type_code": "MJ", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "AREA_STAGING_PRE", "lab_name": "恒温恒湿间（暂存间）", "lab_type": "暂存间", "test_type_code": None, "capacity": 0, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "AREA_STAGING_POST", "lab_name": "恒温恒湿间（实验后暂存间）", "lab_type": "暂存间", "test_type_code": None, "capacity": 0, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "AREA_APPEARANCE", "lab_name": "外观检测间", "lab_type": "检测间", "test_type_code": None, "capacity": 0, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "AREA_UNBOX", "lab_name": "拆箱操作间", "lab_type": "操作区", "test_type_code": None, "capacity": 0, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
    {"lab_code": "AREA_OUTDOOR_HANDOVER", "lab_name": "室外接驳区", "lab_type": "接驳区", "test_type_code": None, "capacity": 0, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
)

TEST_TYPE_NAME_BY_CODE = {row["test_type_code"]: row["test_type_name"] for row in DEFAULT_TEST_TYPES}


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def serialize_test_type(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("test_type_id"),
        "code": normalize_text(row.get("test_type_code")),
        "name": normalize_text(row.get("test_type_name")),
        "category": normalize_text(row.get("test_category")),
        "defaultDurationHour": row.get("default_duration_hour"),
        "status": row.get("status", 1),
        "remark": normalize_text(row.get("remark")),
    }


def is_legacy_seed_test_type(row: dict[str, Any]) -> bool:
    code = normalize_text(row.get("test_type_code")).upper()
    name = normalize_text(row.get("test_type_name"))
    return code.startswith("TT_") and name not in set(TEST_TYPE_NAME_BY_CODE.values())


def is_legacy_seed_lab(row: dict[str, Any]) -> bool:
    code = normalize_text(row.get("test_type_code")).upper()
    name = normalize_text(row.get("test_type_name"))
    return code.startswith("TT_") and name not in set(TEST_TYPE_NAME_BY_CODE.values())


def serialize_lab(row: dict[str, Any]) -> dict[str, Any]:
    test_type_code = normalize_text(row.get("test_type_code"))
    return {
        "id": row.get("lab_id"),
        "code": normalize_text(row.get("lab_code")),
        "name": normalize_text(row.get("lab_name")),
        "type": normalize_text(row.get("lab_type")),
        "testTypeId": row.get("test_type_id"),
        "testTypeCode": test_type_code,
        "testTypeName": normalize_text(row.get("test_type_name")) or TEST_TYPE_NAME_BY_CODE.get(test_type_code, ""),
        "capacity": row.get("capacity"),
        "locationDesc": normalize_text(row.get("location_desc")),
        "status": row.get("status", 1),
        "remark": normalize_text(row.get("remark")),
    }
