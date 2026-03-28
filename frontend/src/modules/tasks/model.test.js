import { describe, expect, test } from "vitest";

import { buildTaskCode, buildTaskEditForm, buildTaskMetrics, buildTaskRows, createTaskRecord, updateTaskRecord } from "./model";

describe("tasks model", () => {
  test("marks a task as running when any tray is sent to the lab", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "CJ-2026-001", name: "冲击试验", status: "待排程" }],
      [],
      [
        {
          code: "CJ-2026-001-SP-001",
          task_code: "CJ-2026-001",
          status: "送至实验室",
          trays: [{ tray_code: "CJ-2026-001-TP-001", status: "送至实验室", quantity: 1 }],
        },
      ],
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        code: "CJ-2026-001",
        displayStatus: "实验中",
      }),
    );
  });

  test("marks a task as running when any tray enters fixture installation", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "CJ-2026-001", name: "冲击试验", status: "待排程" }],
      [],
      [
        {
          code: "CJ-2026-001-SP-001",
          task_code: "CJ-2026-001",
          status: "工装夹具安装",
          trays: [{ tray_code: "CJ-2026-001-TP-001", status: "工装夹具安装", quantity: 1 }],
        },
      ],
    );

    expect(rows[0].displayStatus).toBe("实验中");
  });

  test("marks a task as running when any tray enters in-progress status", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "CJ-2026-001", name: "冲击试验", status: "待排程" }],
      [],
      [
        {
          code: "CJ-2026-001-SP-001",
          task_code: "CJ-2026-001",
          status: "实验进行中",
          trays: [{ tray_code: "CJ-2026-001-TP-001", status: "实验进行中", quantity: 1 }],
        },
      ],
    );

    expect(rows[0].displayStatus).toBe("实验中");
  });

  test("keeps a task running when one tray is complete and another tray is still active", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "CJ-2026-001", name: "冲击试验", status: "待排程" }],
      [],
      [
        {
          code: "CJ-2026-001-SP-001",
          task_code: "CJ-2026-001",
          status: "实验已完成",
          trays: [{ tray_code: "CJ-2026-001-TP-001", status: "实验已完成", quantity: 1 }],
        },
        {
          code: "CJ-2026-001-SP-002",
          task_code: "CJ-2026-001",
          status: "实验准备就绪",
          trays: [{ tray_code: "CJ-2026-001-TP-002", status: "实验准备就绪", quantity: 1 }],
        },
      ],
    );

    expect(rows[0].displayStatus).toBe("实验中");
  });

  test("marks a task completed only when all trays are in complete or post-complete states", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "CJ-2026-001", name: "冲击试验", status: "待排程" }],
      [],
      [
        {
          code: "CJ-2026-001-SP-001",
          task_code: "CJ-2026-001",
          status: "实验已完成",
          trays: [{ tray_code: "CJ-2026-001-TP-001", status: "实验已完成", quantity: 1 }],
        },
        {
          code: "CJ-2026-001-SP-002",
          task_code: "CJ-2026-001",
          status: "厂家收回",
          trays: [{ tray_code: "CJ-2026-001-TP-002", status: "厂家收回", quantity: 1 }],
        },
      ],
    );

    expect(rows[0].displayStatus).toBe("实验已经完成");
  });

  test("marks a task as returned only when all trays are returned to the manufacturer", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "CJ-2026-001", name: "冲击试验", status: "实验已经完成" }],
      [],
      [
        {
          code: "CJ-2026-001-SP-001",
          task_code: "CJ-2026-001",
          status: "厂家收回",
          trays: [{ tray_code: "CJ-2026-001-TP-001", status: "厂家收回", quantity: 1 }],
        },
        {
          code: "CJ-2026-001-SP-002",
          task_code: "CJ-2026-001",
          status: "厂家收回",
          trays: [{ tray_code: "CJ-2026-001-TP-002", status: "厂家收回", quantity: 1 }],
        },
      ],
    );

    expect(rows[0].displayStatus).toBe("厂家收回");
  });

  test("keeps a task waiting when trays are only staged in the temporary room before experiment", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "CJ-2026-001", name: "冲击试验", status: "待排程" }],
      [],
      [
        {
          code: "CJ-2026-001-SP-001",
          task_code: "CJ-2026-001",
          status: "已到达暂存间",
          trays: [{ tray_code: "CJ-2026-001-TP-001", status: "已到达暂存间", quantity: 1 }],
        },
      ],
    );

    expect(rows[0].displayStatus).toBe("待排程");
  });

  test("treats retention-only schedules as unscheduled instead of returned", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "GDW-2024-005",
          name: "高低温湿热试验",
          source: "外部委托",
          status: "待排程",
          test_type: "高低温湿热试验",
        },
      ],
      [
        {
          id: "schedule-retention-1",
          task_code: "GDW-2024-005",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-03-11T09:31:00.000Z",
          end_at: "2026-03-17T09:31:00.000Z",
          status: "暂存间存放",
        },
      ],
      Date.parse("2026-03-17T10:00:00.000Z"),
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        code: "GDW-2024-005",
        displayStatus: "待排程",
      }),
    );

    expect(buildTaskMetrics(rows)).toEqual(
      expect.objectContaining({
        retentionCount: 0,
        unscheduledCount: 1,
        unscheduledLabel: "1（暂存间存放0）",
      }),
    );
  });

  test("treats retention devices as unscheduled even when the stored schedule status is stale", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "WDC-2026-001",
          name: "温度冲击试验",
          source: "外部委托",
          status: "待排程",
          test_type: "温度冲击试验",
        },
      ],
      [
        {
          id: "schedule-retention-1",
          task_code: "WDC-2026-001",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-03-11T06:45:13.827Z",
          end_at: "2026-03-11T06:45:13.827Z",
          status: "已排程",
        },
      ],
      Date.parse("2026-03-17T10:00:00.000Z"),
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        code: "WDC-2026-001",
        displayStatus: "待排程",
      }),
    );

    expect(buildTaskMetrics(rows)).toEqual(
      expect.objectContaining({
        retentionCount: 0,
        unscheduledCount: 1,
        unscheduledLabel: "1（暂存间存放0）",
      }),
    );
  });

  test("createTaskRecord leaves arrival_at empty until samples are confirmed into storage", () => {
    const task = createTaskRecord(
      {
        code: "CJ-2026-001",
        name: "冲击试验-批次A",
        source: "内部新增",
        sample_count: "2",
        sample_type: "结构件",
        test_type: "冲击试验",
        required_device: "冲击试验",
        arrival_at: "2026-03-18T12:30",
      },
      [],
    );

    expect(task.arrival_at).toBe("");
  });

  test("updateTaskRecord preserves stored arrival_at instead of taking manual form input", () => {
    const result = updateTaskRecord(
      [
        {
          id: "task-1",
          code: "CJ-2026-001",
          name: "冲击试验-批次A",
          arrival_at: "2026-03-18 08:00",
          status: "待排程",
        },
      ],
      {
        id: "task-1",
        code: "CJ-2026-001",
        name: "冲击试验-批次B",
        arrival_at: "2026-03-18T13:45",
        status: "待排程",
      },
    );

    expect(result.tasks[0].arrival_at).toBe("2026-03-18 08:00");
  });

  test("buildTaskRows and buildTaskEditForm preserve second precision for arrival time", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "CJ-2026-001",
          name: "冲击试验-批次A",
          arrival_at: "2026-03-18 09:14:45",
          status: "待排程",
        },
      ],
      [],
    );

    expect(rows[0].arrivalAt).toBe("2026-03-18 09:14:45");
    expect(buildTaskEditForm(rows[0]).arrival_at).toBe("2026-03-18T09:14:45");
  });

  test("buildTaskRows summarizes all experiment types for a task", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "SYLU-2026-03-001",
          name: "三实验任务",
          status: "待排程",
          sample_count: 6,
          test_type: "温度冲击",
        },
      ],
      [],
      [],
      [
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", experiment_type: "温度冲击" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-B", experiment_type: "振动" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-C", experiment_type: "盐雾" },
      ],
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        experimentCount: 3,
        experimentSummary: "温度冲击 / 振动 / 盐雾",
        testType: "温度冲击 / 振动 / 盐雾",
      }),
    );
  });

  test("buildTaskCode generates the next monthly SYLU sequence", () => {
    expect(
      buildTaskCode(
        "冲击试验",
        [
          { code: "SYLU-2026-03-001" },
          { code: "SYLU-2026-03-003" },
          { code: "SYLU-2026-02-007" },
        ],
        "2026-03-27T09:15:00",
      ),
    ).toBe("SYLU-2026-03-004");
  });

  test("createTaskRecord auto-generates a SYLU code when the form code is empty", () => {
    const task = createTaskRecord(
      {
        code: "",
        name: "冲击试验-批次A",
        source: "内部新增",
        sample_count: "2",
        sample_type: "结构件",
        test_type: "冲击试验",
        due_at: "2026-03-18T12:30",
      },
      [
        { code: "SYLU-2026-03-001" },
        { code: "SYLU-2026-03-002" },
      ],
    );

    expect(task.code).toBe("SYLU-2026-03-003");
  });
});
