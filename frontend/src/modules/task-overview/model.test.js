import { describe, expect, test } from "vitest";

import { buildTaskRows, buildTrayOverviewRows } from "./model";

describe("taskOverviewModel", () => {
  test("buildTaskRows aggregates tasks, samples, trays, and schedules by task-level formal schedule presence", () => {
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
      scheduleCount: 1,
    });
    expect(rows[0].sampleCodes).toEqual(["S-001", "S-002"]);
    expect(rows[0].trays).toEqual([
      expect.objectContaining({ trayCode: "TRAY-01", sampleCodes: ["S-001"], totalQuantity: 1 }),
      expect.objectContaining({ trayCode: "TRAY-02", sampleCodes: ["S-002"], totalQuantity: 3 }),
    ]);
  });

  test("buildTaskRows keeps large sample lists lightweight while preserving count and search text", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "SYLU-2026-06-099",
          test_type: "冲击试验",
          status: "待排程",
          sample_count: 99,
        },
      ],
      samples: Array.from({ length: 99 }, (_, index) => ({
        task_code: "SYLU-2026-06-099",
        code: `SYLU-2026-06-099-SP-${String(index + 1).padStart(3, "0")}`,
        trays: [],
      })),
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows[0].sampleCount).toBe(99);
    expect(rows[0].sampleCodes).toHaveLength(99);
    expect(rows[0].sampleCodePreview.length).toBeLessThan(99);
    expect(rows[0].sampleCodePreview).toContain("SYLU-2026-06-099-SP-001");
    expect(rows[0].sampleCodeSearchText).toContain("SYLU-2026-06-099-SP-099");
  });

  test("buildTaskRows includes experiment counts and summary labels for multi-experiment tasks", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "SYLU-2026-03-006",
          test_type: "四综合试验",
          status: "待排程",
          sample_count: 1,
        },
      ],
      experiments: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "A实验", status: "待排程" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "B实验", status: "实验已经完成" },
      ],
      samples: [{ task_code: "SYLU-2026-03-006", code: "SYLU-2026-03-006-SP-001", trays: [] }],
      schedules: [{ task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", status: "已排程", device: "四综合实验室" }],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskCode: "SYLU-2026-03-006",
      experimentCount: 2,
      experimentSummary: "A实验 / B实验",
      eligibleExperimentCount: 2,
      scheduledExperimentCount: 2,
    });
    expect(rows[0].experiments).toEqual([
      expect.objectContaining({ experimentCode: "SYLU-2026-03-006-A", experimentName: "A实验", displayStatus: "已排程" }),
      expect.objectContaining({ experimentCode: "SYLU-2026-03-006-B", experimentName: "B实验", displayStatus: "实验已完成" }),
    ]);
  });

  test("buildTaskRows displays the concrete type for a single experiment record", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "SYLU-2026-03-021",
          test_type: "盐雾试验",
          status: "待排程",
          sample_count: 1,
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-03-021",
          experiment_code: "SYLU-2026-03-021-A",
          experiment_type: "盐雾试验",
          status: "待排程",
        },
      ],
      samples: [],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
    });

    expect(rows[0]).toMatchObject({
      experimentCount: 1,
      experimentSummary: "盐雾试验",
    });
    expect(rows[0].experiments).toEqual([
      expect.objectContaining({
        experimentCode: "SYLU-2026-03-021-A",
        experimentName: "盐雾试验",
      }),
    ]);
  });

  test("buildTaskRows keeps unscheduled sibling experiments waiting even when the task status is already marked scheduled", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "SYLU-2026-03-020",
          test_type: "盐雾试验 / 振动试验",
          status: "已排程",
          sample_count: 2,
          transfer_status: "已入库",
        },
      ],
      experiments: [
        { task_code: "SYLU-2026-03-020", experiment_code: "SYLU-2026-03-020-A", experiment_name: "盐雾试验", status: "" },
        { task_code: "SYLU-2026-03-020", experiment_code: "SYLU-2026-03-020-B", experiment_name: "振动试验", status: "" },
      ],
      samples: [],
      schedules: [
        { task_code: "SYLU-2026-03-020", experiment_code: "SYLU-2026-03-020-A", status: "已排程", device: "盐雾试验室" },
      ],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        eligibleExperimentCount: 2,
        scheduledExperimentCount: 1,
      }),
    );
    expect(rows[0].experiments).toEqual([
      expect.objectContaining({ experimentCode: "SYLU-2026-03-020-A", displayStatus: "已排程" }),
      expect.objectContaining({ experimentCode: "SYLU-2026-03-020-B", displayStatus: "待排程" }),
    ]);
  });

  test("buildTaskRows excludes manufacturer-returned tasks from active overview rows", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "SYLU-2026-03-099", test_type: "冲击试验", status: "厂家收回" }],
      experiments: [
        { task_code: "SYLU-2026-03-099", experiment_code: "SYLU-2026-03-099-A", experiment_name: "A实验", status: "实验已完成" },
        { task_code: "SYLU-2026-03-099", experiment_code: "SYLU-2026-03-099-B", experiment_name: "B实验", status: "实验进行中" },
      ],
      samples: [],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
    });

    expect(rows).toEqual([]);
  });

  test("buildTaskRows removes duplicate experiment types from overview summaries", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "SYLU-2026-03-006",
          test_type: "盐雾试验 / 冲击试验 / 盐雾试验",
          status: "待排程",
          sample_count: 1,
        },
      ],
      experiments: [],
      samples: [{ task_code: "SYLU-2026-03-006", code: "SYLU-2026-03-006-SP-001", trays: [] }],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows[0]).toMatchObject({
      taskType: "盐雾试验 / 冲击试验",
      experimentSummary: "盐雾试验 / 冲击试验",
    });
  });

  test("buildTaskRows keeps experiment names separate from experiment type summaries", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "SYLU-2026-03-099",
          test_type: "盐雾试验 / 振动试验",
          status: "待排程",
          sample_count: 1,
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-03-099",
          experiment_code: "SYLU-2026-03-099-A",
          experiment_name: "A实验",
          required_device: "盐雾试验",
          status: "待排程",
        },
        {
          task_code: "SYLU-2026-03-099",
          experiment_code: "SYLU-2026-03-099-B",
          experiment_name: "新增实验名称",
          required_device: "振动试验",
          status: "待排程",
        },
      ],
      samples: [{ task_code: "SYLU-2026-03-099", code: "SYLU-2026-03-099-SP-001", trays: [] }],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows[0]).toMatchObject({
      experimentSummary: "盐雾试验 / 振动试验",
      taskType: "盐雾试验 / 振动试验",
    });
    expect(rows[0].experiments).toEqual([
      expect.objectContaining({ experimentName: "A实验", requiredDevice: "盐雾试验" }),
      expect.objectContaining({ experimentName: "新增实验名称", requiredDevice: "振动试验" }),
    ]);
  });

  test("buildTrayOverviewRows fills empty tray slots and shows current status fields", () => {
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
      currentLocation: "-",
      currentStatus: "样品运输中",
    });
    expect(rows[1]).toMatchObject({
      slotCode: "TP-002",
      trayCode: "TP-002",
      taskCode: "-",
      targetExperiment: "Unassigned",
      currentLocation: "-",
      currentStatus: "-",
    });
  });

  test("buildTrayOverviewRows shows strict current location instead of scheduled lab", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "TASK-1", test_type: "冲击试验" }],
      samples: [
        {
          code: "SAMPLE-1",
          task_code: "TASK-1",
          location: "接驳区",
          status: "已接收",
          trays: [{ tray_code: "TRAY-A", status: "已接收" }],
        },
      ],
      schedules: [
        {
          task_code: "TASK-1",
          device: "冲击一室",
          status: "已排程",
          start_at: "2026-03-10T09:00:00Z",
        },
      ],
      totalSlots: 1,
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
      unassignedExperimentLabel: "未分配",
    });

    expect(rows[0]).toMatchObject({
      currentLocation: "接驳区",
      currentStatus: "到货",
    });
    expect(rows[0]).not.toHaveProperty("scheduleStatus");
    expect(rows[0].lab).toBeUndefined();
  });

  test("buildTrayOverviewRows displays laboratory codes as Chinese names", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "TASK-LAB-NAME", test_type: "冲击试验" }],
      samples: [
        {
          code: "SAMPLE-LAB-NAME",
          task_code: "TASK-LAB-NAME",
          location: "LAB_IMPACT_2",
          status: "已到达实验室",
          trays: [{ tray_code: "TRAY-LAB-NAME", status: "已到达实验室" }],
        },
      ],
      totalSlots: 1,
      unassignedExperimentLabel: "未分配",
    });

    expect(rows[0].currentLocation).toBe("冲击二室");
  });

  test("buildTrayOverviewRows keeps each tray directed to its own target lab instead of the task latest schedule", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "TASK-MULTI-LAB", test_type: "冲击试验 / 温度冲击试验 / 振动试验", status: "已排程" }],
      experiments: [
        { task_code: "TASK-MULTI-LAB", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", status: "已排程" },
        { task_code: "TASK-MULTI-LAB", experiment_code: "EXP-TEMP", experiment_name: "温度冲击试验", status: "已排程" },
        { task_code: "TASK-MULTI-LAB", experiment_code: "EXP-VIBRATION", experiment_name: "振动试验", status: "已排程" },
      ],
      experimentTrays: [
        { task_code: "TASK-MULTI-LAB", experiment_code: "EXP-IMPACT", tray_code: "TP-001" },
        { task_code: "TASK-MULTI-LAB", experiment_code: "EXP-TEMP", tray_code: "TP-002" },
        { task_code: "TASK-MULTI-LAB", experiment_code: "EXP-VIBRATION", tray_code: "TP-001" },
        { task_code: "TASK-MULTI-LAB", experiment_code: "EXP-VIBRATION", tray_code: "TP-002" },
      ],
      samples: [
        {
          task_code: "TASK-MULTI-LAB",
          code: "SP-001",
          location: "冲击一室",
          status: "送至实验室",
          trays: [
            {
              tray_code: "TP-001",
              quantity: 1,
              status: "送至实验室",
              target_lab: "冲击一室",
              target_experiment_code: "EXP-IMPACT",
            },
          ],
        },
        {
          task_code: "TASK-MULTI-LAB",
          code: "SP-002",
          location: "温度冲击一室",
          status: "送至实验室",
          trays: [
            {
              tray_code: "TP-002",
              quantity: 1,
              status: "送至实验室",
              target_lab: "温度冲击一室",
              target_experiment_code: "EXP-TEMP",
            },
          ],
        },
      ],
      schedules: [
        {
          task_code: "TASK-MULTI-LAB",
          experiment_code: "EXP-IMPACT",
          device: "冲击一室",
          start_at: "2026-06-04 08:00:00",
        },
        {
          task_code: "TASK-MULTI-LAB",
          experiment_code: "EXP-TEMP",
          device: "温度冲击一室",
          start_at: "2026-06-04 10:00:00",
        },
        {
          task_code: "TASK-MULTI-LAB",
          experiment_code: "EXP-VIBRATION",
          device: "振动一室",
          start_at: "2026-06-04 12:00:00",
        },
      ],
      totalSlots: 2,
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
      unassignedExperimentLabel: "未分配",
    });

    expect(rows.map((row) => row.currentStatus)).toEqual(["送至冲击一室", "送至温度冲击一室"]);
    expect(rows.map((row) => row.canonicalStatus)).toEqual(["送至实验室", "送至实验室"]);
    expect(rows.map((row) => row.currentStatus)).not.toContain("送至振动一室");
  });

  test("buildTrayOverviewRows shows tray-assigned experiments instead of the full task experiment list", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "SYLU-2026-06-021", test_type: "冲击试验 / 温度冲击试验 / 振动试验", status: "已排程" }],
      experiments: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", experiment_name: "冲击试验", status: "已排程" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", experiment_name: "温度冲击试验", status: "已排程" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", experiment_name: "振动试验", status: "已排程" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", tray_code: "SYLU-2026-06-021-TP-002" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-002" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-003" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-003" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-004" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", tray_code: "SYLU-2026-06-021-TP-004" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-004" },
      ],
      samples: [
        { task_code: "SYLU-2026-06-021", code: "SP-001", status: "送至暂存间", trays: [{ tray_code: "SYLU-2026-06-021-TP-001" }] },
        { task_code: "SYLU-2026-06-021", code: "SP-002", status: "送至暂存间", trays: [{ tray_code: "SYLU-2026-06-021-TP-002" }] },
        { task_code: "SYLU-2026-06-021", code: "SP-003", status: "送至暂存间", trays: [{ tray_code: "SYLU-2026-06-021-TP-003" }] },
        { task_code: "SYLU-2026-06-021", code: "SP-004", status: "送至实验室", location: "冲击二室", trays: [{ tray_code: "SYLU-2026-06-021-TP-004" }] },
      ],
      schedules: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", device: "冲击二室" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", device: "温度冲击二室" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", device: "振动二室" },
      ],
      totalSlots: 4,
      unassignedExperimentLabel: "未分配",
    });

    expect(rows.map((row) => row.targetExperiment)).toEqual([
      "冲击试验 / 温度冲击试验",
      "温度冲击试验 / 振动试验",
      "冲击试验 / 振动试验",
      "冲击试验 / 温度冲击试验 / 振动试验",
    ]);
  });

  test("buildTrayOverviewRows derives tray experiment from target lab when tray target experiment code is missing", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "TASK-TARGET-LAB", test_type: "冲击试验 / 振动试验", status: "已排程" }],
      experiments: [
        { task_code: "TASK-TARGET-LAB", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", status: "已排程" },
        { task_code: "TASK-TARGET-LAB", experiment_code: "EXP-VIBRATION", experiment_name: "振动试验", status: "已排程" },
      ],
      experimentTrays: [
        { task_code: "TASK-TARGET-LAB", experiment_code: "EXP-IMPACT", tray_code: "TP-001" },
        { task_code: "TASK-TARGET-LAB", experiment_code: "EXP-VIBRATION", tray_code: "TP-001" },
      ],
      samples: [
        {
          task_code: "TASK-TARGET-LAB",
          code: "SP-001",
          location: "冲击一室",
          status: "送至实验室",
          trays: [
            {
              tray_code: "TP-001",
              quantity: 1,
              status: "送至实验室",
              target_lab: "冲击一室",
            },
          ],
        },
      ],
      schedules: [
        {
          task_code: "TASK-TARGET-LAB",
          experiment_code: "EXP-IMPACT",
          device: "冲击一室",
          start_at: "2026-06-04 08:00:00",
        },
        {
          task_code: "TASK-TARGET-LAB",
          experiment_code: "EXP-VIBRATION",
          device: "振动一室",
          start_at: "2026-06-04 12:00:00",
        },
      ],
      totalSlots: 1,
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
      unassignedExperimentLabel: "未分配",
    });

    expect(rows[0].currentStatus).toBe("送至冲击一室");
    expect(rows[0].canonicalStatus).toBe("送至实验室");
  });

  test("buildTrayOverviewRows ignores orphan tray rows whose task no longer exists", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "SYLU-2026-03-001", test_type: "温度冲击试验" }],
      samples: [
        { task_code: "SYLU-2026-04-101", trays: [{ tray_code: "SYLU-2026-04-101-TP-001" }] },
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

  test("buildTrayOverviewRows keeps the same tray code from different tasks as separate tray rows", () => {
    const rows = buildTrayOverviewRows({
      tasks: [
        { code: "TASK-A", test_type: "振动试验" },
        { code: "TASK-B", test_type: "盐雾试验" },
      ],
      samples: [
        { task_code: "TASK-A", location: "振动一室", trays: [{ tray_code: "TP-001", status: "已到达实验室" }] },
        { task_code: "TASK-B", location: "盐雾试验室", trays: [{ tray_code: "TP-001", status: "已到达实验室" }] },
      ],
      totalSlots: 3,
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
      unassignedExperimentLabel: "未分配",
    });

    expect(rows.filter((row) => row.trayCode === "TP-001" && row.hasTray)).toEqual([
      expect.objectContaining({ taskCode: "TASK-A", currentLocation: "振动一室" }),
      expect.objectContaining({ taskCode: "TASK-B", currentLocation: "盐雾试验室" }),
    ]);
  });

  test("buildTrayOverviewRows resets returned task trays back to unassigned slots", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "SYLU-2026-03-001", test_type: "盐雾试验 / 四综合试验", status: "厂家收回", transfer_status: "厂家收回" }],
      samples: [
        {
          task_code: "SYLU-2026-03-001",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "厂家收回" }],
        },
        {
          task_code: "SYLU-2026-03-001",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "厂家收回" }],
        },
      ],
      schedules: [],
      totalSlots: 2,
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
      unassignedExperimentLabel: "未分配",
    });

    expect(rows).toEqual([
      expect.objectContaining({
        slotCode: "TP-001",
        trayCode: "TP-001",
        taskCode: "-",
        targetExperiment: "未分配",
      }),
      expect.objectContaining({
        slotCode: "TP-002",
        trayCode: "TP-002",
        taskCode: "-",
        targetExperiment: "未分配",
      }),
    ]);
  });

  test("buildTrayOverviewRows releases returned trays while keeping active trays occupied", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "SYLU-2026-03-002", test_type: "冲击试验", status: "任务进行中" }],
      samples: [
        {
          code: "SP-001",
          task_code: "SYLU-2026-03-002",
          status: "实验进行中",
          location: "冲击一室",
          trays: [{ tray_code: "TP-ACTIVE", status: "实验进行中" }],
        },
        {
          code: "SP-002",
          task_code: "SYLU-2026-03-002",
          status: "厂家收回",
          location: "厂家收回",
          trays: [{ tray_code: "TP-RETURNED", status: "厂家收回" }],
        },
      ],
      schedules: [],
      totalSlots: 2,
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
      unassignedExperimentLabel: "未分配",
    });

    expect(rows.map((row) => row.trayCode)).toEqual(["TP-ACTIVE", "TP-002"]);
    expect(rows[0]).toMatchObject({ hasTray: true, taskCode: "SYLU-2026-03-002" });
    expect(rows[1]).toMatchObject({ hasTray: false, taskCode: "-", targetExperiment: "未分配" });
  });

  test("buildTaskRows keeps retention-only tasks unscheduled", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "SYLU-2026-04-107",
          test_type: "温度冲击试验",
          status: "暂存间排放",
          sample_count: 1,
          created_at: "2026-03-10T08:00:00Z",
        },
      ],
      samples: [],
      schedules: [
        {
          task_code: "SYLU-2026-04-107",
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
      taskCode: "SYLU-2026-04-107",
    });
  });

  test("buildTaskRows classifies formal and retention schedules by lab code before stale display text", () => {
    const rows = buildTaskRows({
      tasks: [
        { code: "TASK-FORMAL", test_type: "盐雾试验", status: "待排程" },
        { code: "TASK-STORAGE", test_type: "冲击试验", status: "待排程" },
      ],
      experiments: [
        { task_code: "TASK-FORMAL", experiment_code: "TASK-FORMAL-A", experiment_name: "盐雾试验", status: "待排程" },
        { task_code: "TASK-STORAGE", experiment_code: "TASK-STORAGE-A", experiment_name: "冲击试验", status: "待排程" },
      ],
      samples: [],
      schedules: [
        {
          task_code: "TASK-FORMAL",
          experiment_code: "TASK-FORMAL-A",
          device: "恒温恒湿间（暂存间）",
          lab_code: "LAB_SALT",
          status: "已排程",
        },
        {
          task_code: "TASK-STORAGE",
          experiment_code: "TASK-STORAGE-A",
          device: "冲击一室",
          lab_code: "AREA_STAGING_PRE",
          status: "已排程",
        },
      ],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
    });

    expect(rows).toEqual([
      expect.objectContaining({
        taskCode: "TASK-FORMAL",
        scheduleCount: 1,
        retentionCount: 0,
        currentStatus: "已排程",
      }),
      expect.objectContaining({
        taskCode: "TASK-STORAGE",
        scheduleCount: 0,
        retentionCount: 1,
        currentStatus: "待排程",
      }),
    ]);
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
        { task_code: "SYLU-2026-04-101", code: "SYLU-2026-04-101-SP-001", trays: [] },
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
          code: "SYLU-2026-03-001",
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

  test("buildTaskRows keeps overview rows scheduled until a tray explicitly enters the running state", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "SYLU-2026-03-001", test_type: "冲击试验", status: "待排程" }],
      samples: [
        {
          task_code: "SYLU-2026-03-001",
          code: "SYLU-2026-03-001-SP-001",
          status: "已到达实验室",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "已到达实验室", quantity: 1 }],
        },
      ],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows[0].currentStatus).toBe("待排程");
  });

  test("buildTaskRows keeps overview rows incomplete until every tray reaches a post-complete state", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "SYLU-2026-03-001", test_type: "冲击试验", status: "待排程" }],
      samples: [
        {
          task_code: "SYLU-2026-03-001",
          code: "SYLU-2026-03-001-SP-001",
          status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "实验已完成", quantity: 1 }],
        },
        {
          task_code: "SYLU-2026-03-001",
          code: "SYLU-2026-03-001-SP-002",
          status: "实验后暂存间存放",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "实验后暂存间存放", quantity: 1 }],
        },
      ],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows[0].currentStatus).toBe("任务已完成");
  });

  test("buildTaskRows marks overdue waiting experiments after 24 hours", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "SYLU-2026-03-011", test_type: "振动试验", status: "待排程", transfer_status: "到货" }],
      experiments: [
        {
          task_code: "SYLU-2026-03-011",
          experiment_code: "SYLU-2026-03-011-A",
          experiment_name: "振动试验",
          status: "待排程",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
      ],
      samples: [],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
      now: Date.parse("2026-03-11T09:00:00.000Z"),
    });

    expect(rows[0].experiments).toEqual([
      expect.objectContaining({
        experimentCode: "SYLU-2026-03-011-A",
        displayStatus: "待排程",
        isOverdueWaiting: true,
      }),
    ]);
  });

  test("buildTaskRows does not mark waiting experiments overdue before transfer arrival is confirmed", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "SYLU-2026-03-012", test_type: "振动试验", status: "待排程", transfer_status: "未入库" }],
      experiments: [
        {
          task_code: "SYLU-2026-03-012",
          experiment_code: "SYLU-2026-03-012-A",
          experiment_name: "振动试验",
          status: "待排程",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
      ],
      samples: [],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
      now: Date.parse("2026-03-11T09:00:00.000Z"),
    });

    expect(rows[0].experiments).toEqual([
      expect.objectContaining({
        experimentCode: "SYLU-2026-03-012-A",
        displayStatus: "待排程",
        isOverdueWaiting: false,
      }),
    ]);
  });

  test("buildTaskRows keeps partially completed tasks in running state with a completed-count label", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "SYLU-2026-03-013", test_type: "振动试验", status: "待排程" }],
      experiments: [
        {
          task_code: "SYLU-2026-03-013",
          experiment_code: "SYLU-2026-03-013-A",
          experiment_name: "振动试验A",
          status: "实验已经完成",
        },
        {
          task_code: "SYLU-2026-03-013",
          experiment_code: "SYLU-2026-03-013-B",
          experiment_name: "振动试验B",
          status: "待排程",
        },
      ],
      samples: [],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        currentStatus: "任务进行中",
        currentStatusLabel: "任务进行中（已完成1个实验）",
      }),
    );
  });

  test("buildTaskRows hides tasks whose assigned trays have all been returned", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "TASK-RETURNED", test_type: "盐雾试验", status: "厂家收回" }],
      experiments: [{ task_code: "TASK-RETURNED", experiment_code: "TASK-RETURNED-A", experiment_name: "盐雾试验" }],
      samples: [
        {
          task_code: "TASK-RETURNED",
          code: "SP-001",
          status: "厂家收回",
          trays: [{ tray_code: "TP-001", status: "厂家收回", quantity: 1 }],
        },
      ],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
    });

    expect(rows).toEqual([]);
  });

  test("buildTaskRows releases returned trays from active task tray summaries", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "TASK-MIXED", test_type: "冲击试验", status: "任务进行中" }],
      samples: [
        {
          code: "SP-001",
          task_code: "TASK-MIXED",
          status: "实验进行中",
          location: "冲击一室",
          trays: [{ tray_code: "TP-ACTIVE", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SP-002",
          task_code: "TASK-MIXED",
          status: "厂家收回",
          location: "厂家收回",
          trays: [{ tray_code: "TP-RETURNED", status: "厂家收回", quantity: 1 }],
        },
      ],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "未排程",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].trays.map((tray) => tray.trayCode)).toEqual(["TP-ACTIVE"]);
    expect(rows[0]).toEqual(expect.objectContaining({
      originalTrayCount: 2,
      returnedTrayCount: 1,
      unfinishedTrayCount: 1,
    }));
    expect(rows[0].returnedTrayCodes).toEqual(["TP-RETURNED"]);
  });

  test("buildTaskRows restores missed sibling experiments to waiting when only another shared-tray experiment has history", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "SYLU-2026-03-001", test_type: "盐雾试验 / 冲击试验 / 温度冲击试验", status: "待排程" }],
      experiments: [
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", experiment_name: "盐雾试验", status: "实验已完成" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-B", experiment_name: "冲击试验", status: "实验进行中" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-C", experiment_name: "温度冲击试验", status: "实验进行中" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", tray_code: "SYLU-2026-03-001-TP-001" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", tray_code: "SYLU-2026-03-001-TP-002" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-B", tray_code: "SYLU-2026-03-001-TP-001" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-B", tray_code: "SYLU-2026-03-001-TP-002" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-C", tray_code: "SYLU-2026-03-001-TP-001" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-C", tray_code: "SYLU-2026-03-001-TP-002" },
      ],
      samples: [
        {
          task_code: "SYLU-2026-03-001",
          code: "SYLU-2026-03-001-SP-001",
          status: "实验已完成",
          trays: [
            { tray_code: "SYLU-2026-03-001-TP-001", status: "实验已完成", quantity: 1 },
          ],
          history: [
            { time: "2026-04-14T23:27:00.000Z", detail: "SYLU-2026-03-001 / 盐雾试验 / 实验进行中" },
            { time: "2026-04-15T02:57:00.000Z", detail: "SYLU-2026-03-001 / 盐雾试验 / 实验已完成" },
          ],
        },
        {
          task_code: "SYLU-2026-03-001",
          code: "SYLU-2026-03-001-SP-002",
          status: "实验已完成",
          trays: [
            { tray_code: "SYLU-2026-03-001-TP-002", status: "实验已完成", quantity: 1 },
          ],
          history: [
            { time: "2026-04-14T23:30:00.000Z", detail: "SYLU-2026-03-001 / 盐雾试验 / 实验进行中" },
            { time: "2026-04-15T02:59:00.000Z", detail: "SYLU-2026-03-001 / 盐雾试验 / 实验已完成" },
          ],
        },
      ],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        currentStatus: "任务进行中",
        currentStatusLabel: "任务进行中（已完成1个实验）",
        scheduledExperimentCount: 1,
      }),
    );
    expect(rows[0].experiments).toEqual([
      expect.objectContaining({ experimentCode: "SYLU-2026-03-001-A", displayStatus: "实验已完成" }),
      expect.objectContaining({ experimentCode: "SYLU-2026-03-001-B", displayStatus: "待排程" }),
      expect.objectContaining({ experimentCode: "SYLU-2026-03-001-C", displayStatus: "待排程" }),
    ]);
  });

  test("buildTaskRows does not treat legacy stored status as transfer arrival", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "SYLU-2026-03-013", test_type: "振动试验", status: "待排程", transfer_status: "已入库" }],
      experiments: [
        {
          task_code: "SYLU-2026-03-013",
          experiment_code: "SYLU-2026-03-013-A",
          experiment_name: "振动试验",
          status: "待排程",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
      ],
      samples: [],
      schedules: [],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
      now: Date.parse("2026-03-11T09:00:00.000Z"),
    });

    expect(rows[0].experiments[0]).toEqual(expect.objectContaining({
      experimentCode: "SYLU-2026-03-013-A",
      isOverdueWaiting: false,
    }));
  });

  test("buildTaskRows labels running experiments with completed tray progress", () => {
    const rows = buildTaskRows({
      tasks: [{ code: "SYLU-2026-05-021", test_type: "冲击试验", status: "实验进行中" }],
      experiments: [
        { task_code: "SYLU-2026-05-021", experiment_code: "SYLU-2026-05-021-B", experiment_name: "冲击试验", status: "实验进行中" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-021", experiment_code: "SYLU-2026-05-021-B", tray_code: "SYLU-2026-05-021-TP-001" },
        { task_code: "SYLU-2026-05-021", experiment_code: "SYLU-2026-05-021-B", tray_code: "SYLU-2026-05-021-TP-003" },
      ],
      samples: [
        {
          task_code: "SYLU-2026-05-021",
          code: "SYLU-2026-05-021-SP-001",
          status: "实验进行中",
          trays: [{ tray_code: "SYLU-2026-05-021-TP-001", status: "实验进行中", quantity: 1 }],
          history: [
            { time: "2026-05-30T13:34:34.000Z", detail: "SYLU-2026-05-021 / 冲击试验 / 实验进行中" },
          ],
        },
        {
          task_code: "SYLU-2026-05-021",
          code: "SYLU-2026-05-021-SP-003",
          status: "实验后暂存间存放",
          trays: [{ tray_code: "SYLU-2026-05-021-TP-003", status: "实验后暂存间存放", quantity: 1 }],
          history: [
            { time: "2026-05-30T13:34:34.000Z", detail: "SYLU-2026-05-021 / 冲击试验 / 实验进行中" },
            { time: "2026-05-30T13:37:58.000Z", detail: "SYLU-2026-05-021 / 冲击试验 / 实验已完成" },
          ],
        },
      ],
      schedules: [{ task_code: "SYLU-2026-05-021", experiment_code: "SYLU-2026-05-021-B", status: "实验进行中", device: "冲击一室" }],
      scheduledLabel: "已排程",
      unscheduledLabel: "待排程",
    });

    expect(rows[0].experiments[0]).toEqual(
      expect.objectContaining({
        displayStatus: "实验进行中",
        displayStatusLabel: "实验进行中（已完成 1/2 托盘）",
        trayProgress: {
          completedCount: 1,
          totalCount: 2,
        },
      }),
    );
    expect(rows[0].currentStatus).toBe("任务进行中");
  });

  test("buildTrayOverviewRows prefers tray-scoped run status over parent run status", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "TASK-TRAY", test_type: "盐雾试验" }],
      experiments: [
        {
          task_code: "TASK-TRAY",
          experiment_code: "TASK-TRAY-A",
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-TRAY", experiment_code: "TASK-TRAY-A", tray_code: "TP-001" },
        { task_code: "TASK-TRAY", experiment_code: "TASK-TRAY-A", tray_code: "TP-002" },
      ],
      experimentRuns: [
        {
          id: "run-shared",
          run_no: "run-shared",
          task_code: "TASK-TRAY",
          experiment_code: "TASK-TRAY-A",
          tray_codes: ["TP-001", "TP-002"],
          status: "实验已完成",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "run-shared",
          task_code: "TASK-TRAY",
          experiment_code: "TASK-TRAY-A",
          tray_code: "TP-001",
          run_tray_status: "实验已完成",
        },
        {
          run_no: "run-shared",
          task_code: "TASK-TRAY",
          experiment_code: "TASK-TRAY-A",
          tray_code: "TP-002",
          run_tray_status: "实验进行中",
        },
      ],
      samples: [
        { task_code: "TASK-TRAY", code: "SP-001", location: "盐雾试验室", status: "实验进行中", trays: [{ tray_code: "TP-001", status: "实验进行中" }] },
        { task_code: "TASK-TRAY", code: "SP-002", location: "盐雾试验室", status: "实验进行中", trays: [{ tray_code: "TP-002", status: "实验进行中" }] },
      ],
      schedules: [{ task_code: "TASK-TRAY", experiment_code: "TASK-TRAY-A", device: "盐雾试验室" }],
      totalSlots: 2,
      unassignedExperimentLabel: "未分配",
    });

    expect(rows.find((row) => row.trayCode === "TP-002")).toEqual(
      expect.objectContaining({
        currentStatus: "盐雾试验进行中",
      }),
    );
  });

  test("buildTrayOverviewRows keeps axis experiments partial when only some required axes are completed", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "TASK-AXIS", test_type: "振动试验 / 冲击试验" }],
      experiments: [
        {
          task_code: "TASK-AXIS",
          experiment_code: "EXP-VIB",
          experiment_name: "振动试验",
          required_device: "振动二室",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
        {
          task_code: "TASK-AXIS",
          experiment_code: "EXP-IMPACT",
          experiment_name: "冲击试验",
          required_device: "冲击二室",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-AXIS", experiment_code: "EXP-VIB", tray_code: "TP-AXIS" },
        { task_code: "TASK-AXIS", experiment_code: "EXP-IMPACT", tray_code: "TP-AXIS" },
      ],
      experimentRuns: [
        {
          run_no: "RUN-VIB-Z",
          task_code: "TASK-AXIS",
          experiment_code: "EXP-VIB",
          tray_codes: ["TP-AXIS"],
          axis_codes: ["z+", "z-"],
          status: "实验已完成",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-VIB-Z",
          task_code: "TASK-AXIS",
          experiment_code: "EXP-VIB",
          tray_code: "TP-AXIS",
          run_tray_status: "实验已完成",
        },
      ],
      experimentRunSteps: [
        { run_no: "RUN-VIB-Z", task_code: "TASK-AXIS", experiment_code: "EXP-VIB", axis_code: "z+", status: "实验已完成" },
        { run_no: "RUN-VIB-Z", task_code: "TASK-AXIS", experiment_code: "EXP-VIB", axis_code: "z-", status: "实验已完成" },
      ],
      samples: [
        {
          task_code: "TASK-AXIS",
          code: "SP-AXIS",
          location: "振动二室",
          status: "实验进行中",
          trays: [{ tray_code: "TP-AXIS", status: "实验进行中", quantity: 1 }],
        },
      ],
      schedules: [
        { task_code: "TASK-AXIS", experiment_code: "EXP-VIB", device: "振动二室", start_at: "2026-06-21T08:00:00" },
        { task_code: "TASK-AXIS", experiment_code: "EXP-IMPACT", device: "冲击二室", start_at: "2026-06-22T08:00:00" },
      ],
      totalSlots: 1,
      unassignedExperimentLabel: "未分配",
    });

    expect(rows[0]).toEqual(expect.objectContaining({
      currentStatus: "振动试验部分完成 2/6轴",
    }));
  });
});


