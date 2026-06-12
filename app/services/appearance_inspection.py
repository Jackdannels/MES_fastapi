from __future__ import annotations

from typing import Any


APPEARANCE_INSPECTION_LOCATION = "外观检测间"
APPEARANCE_INSPECTION_DISPATCH_STATUS = "送至外观检测间"
APPEARANCE_INSPECTION_STOCKED_STATUS = "外观检测间存放"
PRE_EXPERIMENT_APPEARANCE_STATUS = "实验前外观检测存放"
APPEARANCE_REQUIRED_KEYWORDS = ("盐雾", "霉菌")

HANDOVER_LOCATION_KEYWORDS = ("接驳区",)
HANDOVER_STORED_STATUSES = {"到货", "已入库"}
STAGING_LOCATION_KEYWORD = "暂存间"
STAGING_STORED_STATUSES = {"已到达暂存间", "放置实验后暂存间"}


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def experiment_requires_appearance_inspection(experiment_name: Any, experiment: dict[str, Any] | None = None) -> bool:
    texts = [
        experiment_name,
        (experiment or {}).get("experiment_name"),
        (experiment or {}).get("experiment_type"),
        (experiment or {}).get("test_type"),
        (experiment or {}).get("required_device"),
    ]
    joined = " / ".join(normalize_text(text) for text in texts if normalize_text(text))
    return any(keyword in joined for keyword in APPEARANCE_REQUIRED_KEYWORDS)


def experiment_name_by_code(experiments: Any, experiment_code: Any) -> str:
    normalized_code = normalize_text(experiment_code)
    if not normalized_code:
        return ""
    for experiment in experiments if isinstance(experiments, list) else []:
        if not isinstance(experiment, dict):
            continue
        if normalize_text(experiment.get("experiment_code") or experiment.get("experiment_no")) != normalized_code:
            continue
        return (
            normalize_text(experiment.get("experiment_name"))
            or normalize_text(experiment.get("experiment_type"))
            or normalize_text(experiment.get("test_type"))
            or normalize_text(experiment.get("required_device"))
        )
    return ""


def target_requires_appearance_inspection(
    *,
    target_lab: Any,
    target_experiment_code: Any,
    experiments: Any,
) -> bool:
    target_lab_name = normalize_text(target_lab)
    if any(keyword in target_lab_name for keyword in APPEARANCE_REQUIRED_KEYWORDS):
        return True
    experiment_name = experiment_name_by_code(experiments, target_experiment_code)
    return experiment_requires_appearance_inspection(experiment_name)


def source_is_handover_or_staging(*, source_location: Any, source_status: Any) -> bool:
    location = normalize_text(source_location)
    status = normalize_text(source_status)
    if location == APPEARANCE_INSPECTION_LOCATION or status in {
        PRE_EXPERIMENT_APPEARANCE_STATUS,
        APPEARANCE_INSPECTION_DISPATCH_STATUS,
        APPEARANCE_INSPECTION_STOCKED_STATUS,
    }:
        return False
    if any(keyword in location for keyword in HANDOVER_LOCATION_KEYWORDS) or status in HANDOVER_STORED_STATUSES:
        return True
    return STAGING_LOCATION_KEYWORD in location or status in STAGING_STORED_STATUSES


def should_route_pre_experiment_appearance(
    *,
    source_location: Any,
    source_status: Any,
    target_lab: Any,
    target_experiment_code: Any,
    experiments: Any,
) -> bool:
    return source_is_handover_or_staging(source_location=source_location, source_status=source_status) and target_requires_appearance_inspection(
        target_lab=target_lab,
        target_experiment_code=target_experiment_code,
        experiments=experiments,
    )

