from datetime import datetime

from app.core.mysql_operational_samples import load_operational_samples


class Cursor:
    def __init__(self, batches):
        self.batches = list(batches)
        self.executed = []

    def execute(self, statement, params):
        self.executed.append((" ".join(statement.split()), list(params)))

    def fetchall(self):
        return self.batches.pop(0)


def test_operational_sample_loader_keeps_workflow_fields_without_reading_event_history() -> None:
    updated_at = datetime(2026, 8, 4, 12, 30)
    cursor = Cursor([
        [{
            "sample_id": 1,
            "sample_no": "TASK-001-SP-001",
            "task_no": "TASK-001",
            "sample_type": "金属件",
            "location_desc": "振动一室",
            "sample_status": "实验进行中",
            "flow_status": "实验进行中",
            "updated_at": updated_at,
        }],
        [{
            "sample_id": 1,
            "tray_no": "TASK-001-TP-001",
            "quantity": 2,
            "tray_item_status": "实验进行中",
            "test_state": "",
            "tray_status": "",
            "fixture_ready": 1,
            "target_sub_experiment_code": "EXP-VIB",
            "updated_at": updated_at,
        }],
    ])

    samples = load_operational_samples(cursor)

    assert len(cursor.executed) == 2
    assert all("biz_sample_event" not in statement for statement, _params in cursor.executed)
    assert samples == [{
        "id": "TASK-001-SP-001",
        "code": "TASK-001-SP-001",
        "sample_code": "TASK-001-SP-001",
        "task_code": "TASK-001",
        "sample_type": "金属件",
        "location": "振动一室",
        "current_location": "振动一室",
        "status": "实验进行中",
        "flow_status": "实验进行中",
        "updated_at": updated_at,
        "trays": [{
            "id": "TASK-001-TP-001",
            "tray_code": "TASK-001-TP-001",
            "quantity": 2,
            "status": "实验进行中",
            "fixture_ready": True,
            "fixtureReady": True,
            "target_experiment_code": "EXP-VIB",
            "targetExperimentCode": "EXP-VIB",
            "updated_at": updated_at,
        }],
        "history": [],
    }]


def test_operational_sample_loader_pushes_task_scope_into_sample_query() -> None:
    cursor = Cursor([[],])

    assert load_operational_samples(cursor, task_codes={" TASK-002 ", "TASK-001"}) == []

    statement, params = cursor.executed[0]
    assert "t.task_no IN (%s, %s)" in statement
    assert params[1:] == ["TASK-001", "TASK-002"]
