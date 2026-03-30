import { describe, expect, test } from "vitest";

import { buildTaskRows, buildTrayOverviewRows } from "./model";

describe("taskOverviewModel", () => {
  test("buildTaskRows aggregates tasks, samples, trays, and schedules", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "TASK-2",
          test_type: "Shock",
          status: "Queued",
          sample_count: 2,
          created_at: "2026-03-10T08:00:00Z",
        },
      ],
      samples: [
        {
          task_code: "TASK-2",
          code: "S-002",
          trays: [
            { tray_code: "TRAY-02", quantity: 2 },
            { tray_code: "TRAY-02", quantity: 1 },
          ],
        },
        {
          task_code: "TASK-2",
          code: "S-001",
          trays: [{ tray_code: "TRAY-01", quantity: 1 }],
        },
      ],
      schedules: [
        { task_code: "TASK-2", status: "Running", start_at: "2026-03-10T09:00:00Z" },
        { task_code: "TASK-2", status: "Running", start_at: "2026-03-10T10:00:00Z" },
      ],
      scheduledLabel: "Scheduled",
      unscheduledLabel: "Unscheduled",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskCode: "TASK-2",
      taskType: "Shock",
      currentStatus: "Queued",
      scheduleLabel: "Scheduled",
      sampleCount: 2,
      scheduleCount: 2,
    });
    expect(rows[0].sampleCodes).toEqual(["S-001", "S-002"]);
    expect(rows[0].trays).toEqual([
      expect.objectContaining({ trayCode: "TRAY-01", sampleCodes: ["S-001"], totalQuantity: 1 }),
      expect.objectContaining({ trayCode: "TRAY-02", sampleCodes: ["S-002"], totalQuantity: 3 }),
    ]);
  });

  test("buildTaskRows includes experiment counts and summary labels for multi-experiment tasks", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "SZH-2026-006",
          test_type: "四综合试验",
          status: "待排程",
          sample_count: 1,
        },
      ],
      experiments: [
        { task_code: "SZH-2026-006", experiment_code: "SZH-2026-006-A", experiment_name: "A实验", status: "待排程" },
        { task_code: "SZH-2026-006", experiment_code: "SZH-2026-006-B", experiment_name: "B实验", status: "实验已经完成" },
      ],
      samples: [{ task_code: "SZH-2026-006", code: "SZH-2026-006-SP-001", trays: [] }],
      schedules: [{ task_code: "SZH-2026-006", experiment_code: "SZH-2026-006-A", status: "已排程", device: "四综合实验室" }],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskCode: "SZH-2026-006",
      experimentCount: 2,
      experimentSummary: "A实验 / B实验",
    });
    expect(rows[0].experiments).toEqual([
      expect.objectContaining({ experimentCode: "SZH-2026-006-A", experimentName: "A实验", displayStatus: "已排程" }),
      expect.objectContaining({ experimentCode: "SZH-2026-006-B", experimentName: "B实验", displayStatus: "实验完成" }),
    ]);
  });

  test("buildTrayOverviewRows fills empty tray slots and uses latest schedule device", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "TASK-1", test_type: "Thermal" }],
      samples: [
        {
          task_code: "TASK-1",
          trays: [{ tray_code: "TRAY-A" }],
        },
      ],
      schedules: [
        { task_code: "TASK-1", device: "Lab-1", start_at: "2026-03-10T08:00:00Z" },
        { task_code: "TASK-1", device: "Lab-2", start_at: "2026-03-10T09:00:00Z" },
      ],
      totalSlots: 3,
      scheduledLabel: "Scheduled",
      unscheduledLabel: "Unscheduled",
      unassignedExperimentLabel: "Unassigned",
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      slotCode: "TP-001",
      trayCode: "TRAY-A",
      taskCode: "TASK-1",
      targetExperiment: "Thermal",
      scheduleStatus: "Scheduled",
      lab: "Lab-2",
    });
    expect(rows[1]).toMatchObject({
      slotCode: "TP-002",
      trayCode: "TP-002",
      taskCode: "-",
      targetExperiment: "Unassigned",
      scheduleStatus: "Unscheduled",
    });
  });

  test("buildTrayOverviewRows ignores orphan tray rows whose task no longer exists", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "SYLU-2026-03-001", test_type: "温度冲击试验" }],
      samples: [
        { task_code: "CJ-2026-001", trays: [{ tray_code: "CJ-2026-001-TP-001" }] },
        { task_code: "SYLU-2026-03-001", trays: [{ tray_code: "SYLU-2026-03-001-TP-001" }] },
      ],
      schedules: [],
      totalSlots: 2,
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
      unassignedExperimentLabel: "未分配",
    });

    expect(rows[0].trayCode).toBe("SYLU-2026-03-001-TP-001");
    expect(rows[1].taskCode).toBe("-");
  });

  test("buildTaskRows keeps retention-only tasks unscheduled", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "WDC-2026-001",
          test_type: "温度冲击试验",
          status: "暂存间排放",
          sample_count: 1,
          created_at: "2026-03-10T08:00:00Z",
        },
      ],
      samples: [],
      schedules: [
        {
          task_code: "WDC-2026-001",
          device: "恒温恒湿间（暂存间）",
          status: "已排程",
          start_at: "2026-03-10T09:00:00Z",
        },
      ],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      currentStatus: "待排程",
      scheduleCount: 0,
      scheduleLabel: "未排程",
      taskCode: "WDC-2026-001",
    });
  });

  test("buildTaskRows ignores orphan sample-only legacy task codes when no task record exists", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "SYLU-2026-03-001",
          test_type: "温度冲击试验",
          status: "待排程",
        },
      ],
      samples: [
        { task_code: "SYLU-2026-03-001", code: "SYLU-2026-03-001-SP-001", trays: [] },
        { task_code: "CJ-2026-001", code: "CJ-2026-001-SP-001", trays: [] },
      ],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].taskCode).toBe("SYLU-2026-03-001");
  });

  test("buildTaskRows prefers arrival_at over created_at for overview time", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "CJ-2026-001",
          test_type: "冲击试验",
          created_at: "2026-03-10T08:00:00Z",
          arrival_at: "2026-03-18 09:14",
        },
      ],
      samples: [],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows[0].timeValue).toBe("2026-03-18 09:14");
  });

  test("buildTaskRows marks overview rows running when any tray is in the active experiment chain", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "CJ-2026-001", test_type: "冲击试验", status: "待排程" }],
      samples: [
        {
          task_code: "CJ-2026-001",
          code: "CJ-2026-001-SP-001",
          status: "已到达实验室",
          trays: [{ tray_code: "CJ-2026-001-TP-001", status: "已到达实验室", quantity: 1 }],
        },
      ],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows[0].currentStatus).toBe("实验中");
  });

  test("buildTaskRows keeps overview rows incomplete until every tray reaches a post-complete state", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "CJ-2026-001", test_type: "冲击试验", status: "待排程" }],
      samples: [
        {
          task_code: "CJ-2026-001",
          code: "CJ-2026-001-SP-001",
          status: "实验已完成",
          trays: [{ tray_code: "CJ-2026-001-TP-001", status: "实验已完成", quantity: 1 }],
        },
        {
          task_code: "CJ-2026-001",
          code: "CJ-2026-001-SP-002",
          status: "放置实验后暂存间",
          trays: [{ tray_code: "CJ-2026-001-TP-002", status: "放置实验后暂存间", quantity: 1 }],
        },
      ],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows[0].currentStatus).toBe("实验完成");
  });
});
