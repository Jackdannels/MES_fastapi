from app.core.mysql_transfer_bootstrap import load_transfer_bootstrap_samples


class Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.executed = []

    def execute(self, statement, params):
        self.executed.append((" ".join(statement.split()), list(params)))

    def fetchall(self):
        return self.rows


def test_transfer_bootstrap_loader_uses_one_narrow_query_without_full_history_payload() -> None:
    cursor = Cursor([
        {
            "sample_id": 1,
            "sample_no": "TASK-001-SP-001",
            "task_no": "TASK-001",
            "sample_status": "实验进行中",
            "flow_status": "实验进行中",
            "tray_quantity": 1,
            "tray_item_status": "实验进行中",
            "tray_no": "TASK-001-TP-001",
            "test_state": "实验进行中",
            "tray_status": "实验进行中",
            "has_transfer_history": 1,
        },
        {
            "sample_id": 2,
            "sample_no": "TASK-001-SP-002",
            "task_no": "TASK-001",
            "sample_status": "到货",
            "flow_status": "到货",
            "tray_quantity": None,
            "tray_item_status": None,
            "tray_no": None,
            "test_state": None,
            "tray_status": None,
            "has_transfer_history": 0,
        },
    ])

    samples = load_transfer_bootstrap_samples(cursor)

    assert len(cursor.executed) == 1
    assert "FROM biz_sample_event transfer_event" in cursor.executed[0][0]
    assert "event_time" not in cursor.executed[0][0]
    assert samples == [
        {
            "id": "TASK-001-SP-001",
            "code": "TASK-001-SP-001",
            "task_code": "TASK-001",
            "status": "实验进行中",
            "flow_status": "实验进行中",
            "trays": [{
                "id": "TASK-001-TP-001",
                "tray_code": "TASK-001-TP-001",
                "sample_code": "TASK-001-SP-001",
                "quantity": 1,
                "status": "实验进行中",
            }],
            "history": [{"action": "样品分装托盘"}],
        },
        {
            "id": "TASK-001-SP-002",
            "code": "TASK-001-SP-002",
            "task_code": "TASK-001",
            "status": "到货",
            "flow_status": "到货",
            "trays": [],
            "history": [],
        },
    ]
