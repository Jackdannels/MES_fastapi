def test_mqtt_and_completion_facades_reexport_pure_rules():
    from app.services import laboratory_completion, laboratory_completion_rules
    from app.services import mq_event_processor, mq_event_protocol

    assert mq_event_processor.event_type_from_topic is mq_event_protocol.event_type_from_topic
    assert mq_event_processor.parse_beijing_datetime is mq_event_protocol.parse_beijing_datetime
    assert laboratory_completion.required_axis_codes_for_completion is laboratory_completion_rules.required_axis_codes_for_completion
    assert laboratory_completion.experiment_status_for_completed_trays is laboratory_completion_rules.experiment_status_for_completed_trays


def test_laboratory_snapshot_adapter_keeps_storage_mapping_explicit():
    from app.services.laboratory_snapshot_adapter import snapshot_from_storage_payload

    snapshot = snapshot_from_storage_payload({"mes.tasks": [{"code": "TASK-1"}], "mes.samples": None})

    assert snapshot["tasks"] == [{"code": "TASK-1"}]
    assert snapshot["samples"] == []
    assert set(snapshot) == {
        "tasks",
        "samples",
        "schedules",
        "experiments",
        "experiment_runs",
        "experiment_run_trays",
        "experiment_run_steps",
        "experiment_trays",
        "experiment_samples",
        "staging_events",
    }
