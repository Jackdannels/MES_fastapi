from datetime import datetime

import pytest

from app.services.mq_event_protocol import event_type_from_topic
from app.services.mq_publisher import build_laboratory_topic
from app.services.salt_spray_pause import inspection_tray_codes, shifted_planned_end
from app.core.mysql_storage_status import EXPERIMENT_RUNNING_STATUSES
from app.services.device_running_repair import RUNNING_EXPERIMENT_STATUSES
from app.services.laboratory_run_lifecycle import RUNNING_STATUSES


def test_salt_pause_protocol_topics_are_explicit_and_lab_scoped():
    assert build_laboratory_topic("PAUSE_REQUEST", "LAB_SALT").endswith("/LAB_SALT/commands/experiment-pause-request")
    assert build_laboratory_topic("RESUME_REQUEST", "LAB_SALT").endswith("/LAB_SALT/commands/experiment-resume-request")
    assert build_laboratory_topic("STOP_REQUEST", "LAB_SALT").endswith("/LAB_SALT/commands/experiment-stop-request")
    assert event_type_from_topic("mes/v1/labs/LAB_SALT/events/experiment-paused") == "EXPERIMENT_PAUSED"
    assert event_type_from_topic("mes/v1/labs/LAB_SALT/events/experiment-resumed") == "EXPERIMENT_RESUMED"
    assert event_type_from_topic("mes/v1/labs/LAB_SALT/events/experiment-stopped") == "EXPERIMENT_STOPPED"


def test_resume_shifts_forecast_once_by_closed_pause_duration():
    assert shifted_planned_end("2026-08-12 14:00:00", 30 * 60) == "2026-08-12 14:30:00"
    assert shifted_planned_end("", 30 * 60) == ""


def test_pause_inspection_trays_are_normalized_without_duplicates():
    assert inspection_tray_codes({"inspectionTrayCodes": [" TP-1 ", "TP-1", "TP-2"]}) == ["TP-1", "TP-2"]


def test_paused_run_remains_an_active_resource_for_status_and_repair_flows():
    assert "实验暂停" in EXPERIMENT_RUNNING_STATUSES
    assert "实验暂停" in RUNNING_EXPERIMENT_STATUSES
    assert "实验暂停" in RUNNING_STATUSES
