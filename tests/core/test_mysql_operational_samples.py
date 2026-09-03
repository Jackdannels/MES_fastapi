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


def test_operational_sample_loader_includes_only_flow_milestone_history() -> None:
    updated_at = datetime(2026, 8, 4, 12, 30)
    dispatched_at = datetime(2026, 8, 4, 12, 0)
    compared_at = datetime(2026, 8, 4, 12, 10)
    installed_at = datetime(2026, 8, 4, 12, 20)
    ready_at = datetime(2026, 8, 4, 12, 25)
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
        [
            {
                "event_id": 14,
                "sample_id": 1,
                "sample_no": "TASK-001-SP-001",
                "action_type": "实验确认",
                "location_desc": "振动一室",
                "owner_name": "操作员甲",
                "sample_status": "实验准备就绪",
                "detail": "TASK-001 / 振动试验 / 实验准备就绪 / 托盘：TASK-001-TP-001",
                "event_time": ready_at,
            },
            {
                "event_id": 13,
                "sample_id": 1,
                "sample_no": "TASK-001-SP-001",
                "action_type": "样品安装",
                "location_desc": "振动一室",
                "owner_name": "操作员甲",
                "sample_status": "工装夹具安装",
                "detail": "TASK-001 / 振动试验 / 工装夹具安装 / 托盘：TASK-001-TP-001",
                "event_time": installed_at,
            },
            {
                "event_id": 12,
                "sample_id": 1,
                "sample_no": "TASK-001-SP-001",
                "action_type": "任务比对",
                "location_desc": "振动一室",
                "owner_name": "操作员甲",
                "sample_status": "已到达实验室",
                "detail": "TASK-001 / 振动试验 / 已到达实验室 / 托盘：TASK-001-TP-001",
                "event_time": compared_at,
            },
            {
                "event_id": 11,
                "sample_id": 1,
                "sample_no": "TASK-001-SP-001",
                "action_type": "暂存间扫码出库",
                "location_desc": "振动一室",
                "owner_name": "操作员甲",
                "sample_status": "送至实验室",
                "detail": "TASK-001-TP-001 送至 振动一室",
                "event_time": dispatched_at,
            },
        ],
    ])

    samples = load_operational_samples(cursor)

    assert len(cursor.executed) == 3
    event_statement, event_params = cursor.executed[2]
    assert "FROM biz_sample_event" in event_statement
    assert "action_type IN" in event_statement
    assert "sample_status IN" in event_statement
    assert event_params[0] == 1
    assert "任务比对" in event_params
    assert "工装夹具安装" in event_params
    assert "实验准备就绪" in event_params
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
        "history": [
            {
                "id": "14",
                "time": "2026-08-04 12:25:00",
                "action": "实验确认",
                "location": "振动一室",
                "owner": "操作员甲",
                "status": "实验准备就绪",
                "detail": "TASK-001 / 振动试验 / 实验准备就绪 / 托盘：TASK-001-TP-001",
            },
            {
                "id": "13",
                "time": "2026-08-04 12:20:00",
                "action": "样品安装",
                "location": "振动一室",
                "owner": "操作员甲",
                "status": "工装夹具安装",
                "detail": "TASK-001 / 振动试验 / 工装夹具安装 / 托盘：TASK-001-TP-001",
            },
            {
                "id": "12",
                "time": "2026-08-04 12:10:00",
                "action": "任务比对",
                "location": "振动一室",
                "owner": "操作员甲",
                "status": "已到达实验室",
                "detail": "TASK-001 / 振动试验 / 已到达实验室 / 托盘：TASK-001-TP-001",
            },
            {
                "id": "11",
                "time": "2026-08-04 12:00:00",
                "action": "暂存间扫码出库",
                "location": "振动一室",
                "owner": "操作员甲",
                "status": "送至实验室",
                "detail": "TASK-001-TP-001 送至 振动一室",
            },
        ],
    }]


def test_operational_sample_loader_pushes_task_scope_into_sample_query() -> None:
    cursor = Cursor([[],])

    assert load_operational_samples(cursor, task_codes={" TASK-002 ", "TASK-001"}) == []

    statement, params = cursor.executed[0]
    assert "t.task_no IN (%s, %s)" in statement
    assert params[1:] == ["TASK-001", "TASK-002"]
