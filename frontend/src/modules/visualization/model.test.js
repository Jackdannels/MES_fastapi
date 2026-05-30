import { describe, expect, test } from "vitest";

import { buildLabProcessPanels, buildLabScheduleThreeDayView, buildStagingSamplesView } from "./model";

describe("visualization model", () => {
  test("builds lab panels from real tray flow data grouped by laboratory", () => {
    const panels = buildLabProcessPanels({
      labNames: ["振动一室", "高低温湿热一室"],
      tasks: [
        { code: "TASK-001", name: "真实流程任务" },
        { code: "TASK-002", name: "温湿热任务" },
      ],
      experiments: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: "TASK-002", experiment_code: "EXP-HUM", experiment_name: "高低温湿热试验", required_device: "高低温湿热一室" },
      ],
      experimentTrays: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", tray_code: "TRAY-VIB-001" },
        { task_code: "TASK-002", experiment_code: "EXP-HUM", tray_code: "TRAY-HUM-001" },
      ],
      schedules: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", device: "振动一室", status: "实验进行中" },
        { task_code: "TASK-002", experiment_code: "EXP-HUM", device: "高低温湿热一室", status: "实验已完成" },
      ],
      samples: [
        {
          code: "SAMPLE-001",
          task_code: "TASK-001",
          location: "振动一室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-VIB-001", status: "实验进行中", quantity: 2 }],
          history: [
            { status: "到货", time: "2026-05-22T09:00:00" },
            { detail: "TASK-001 / 振动试验 / 实验进行中", time: "2026-05-22T10:00:00" },
          ],
        },
        {
          code: "SAMPLE-002",
          task_code: "TASK-002",
          location: "高低温湿热一室",
          status: "实验已完成",
          trays: [{ tray_code: "TRAY-HUM-001", status: "实验已完成", quantity: 1 }],
          history: [
            { status: "到货", time: "2026-05-22T09:30:00" },
            { detail: "TASK-002 / 高低温湿热试验 / 实验已完成", time: "2026-05-22T12:00:00" },
          ],
        },
      ],
    });

    expect(panels).toHaveLength(2);
    expect(panels[0]).toMatchObject({
      name: "振动一室",
      sampleCount: 1,
      taskCount: 1,
      trayCount: 1,
    });
    expect(panels[0].trays[0].trayCode).toBe("TRAY-VIB-001");
    expect(panels[0].trays[0].taskCode).toBe("TASK-001");
    expect(panels[0].trays[0].steps.map((step) => step.label)).toEqual(
      expect.arrayContaining(["样品运输中", "到货", "振动试验进行中"]),
    );
    expect(panels[1].trays[0].status).toContain("高低温湿热试验");
    expect(panels[1].trays[0].steps.some((step) => step.label === "高低温湿热试验已完成")).toBe(true);
  });

  test("keeps lab preparation steps pending when a staging tray is returned by manufacturer", () => {
    const panels = buildLabProcessPanels({
      labNames: ["振动一室"],
      experiments: [
        {
          task_code: "SYLU-2026-05-021",
          experiment_code: "SYLU-2026-05-021-VIB",
          experiment_name: "振动试验",
          required_device: "振动一室",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-05-021",
          experiment_code: "SYLU-2026-05-021-VIB",
          tray_code: "SYLU-2026-05-021-TP-001",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-05-021-SP-001",
          task_code: "SYLU-2026-05-021",
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-05-021-TP-001", status: "厂家收回", quantity: 1 }],
          history: [
            { time: "2026-05-30T13:21:01+08:00", status: "样品运输中" },
            { time: "2026-05-30T13:28:35+08:00", status: "送至暂存间" },
            { time: "2026-05-30T13:59:28+08:00", status: "已到达暂存间" },
            { time: "2026-05-30T13:59:33+08:00", status: "厂家收回" },
          ],
        },
      ],
    });

    const steps = panels[0].trays[0].steps;
    expect(panels[0].trays[0].status).toBe("厂家收回");
    expect(steps.find((step) => step.label === "送至振动一室")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(steps.find((step) => step.label === "实验准备就绪")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(steps.find((step) => step.label === "振动试验进行中")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(steps.find((step) => step.label === "振动试验已完成")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(steps.find((step) => step.label === "厂家收回")).toEqual(expect.objectContaining({ active: true }));
  });

  test("builds a three-day laboratory schedule view from real schedule data", () => {
    const view = buildLabScheduleThreeDayView({
      labNames: ["振动一室", "盐雾试验室"],
      now: new Date("2026-05-23T10:00:00+08:00"),
      tasks: [
        { code: "TASK-001", name: "振动任务", test_type: "振动试验" },
        { code: "TASK-002", name: "盐雾任务", test_type: "盐雾试验" },
        { code: "TASK-003", name: "跨天任务", test_type: "盐雾试验" },
      ],
      experiments: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: "TASK-002", experiment_code: "EXP-SALT", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: "TASK-003", experiment_code: "EXP-NIGHT", experiment_name: "跨天盐雾", required_device: "盐雾试验室" },
      ],
      experimentTrays: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", tray_code: "TP-001" },
        { task_code: "TASK-002", experiment_code: "EXP-SALT", tray_code: "TP-002" },
        { task_code: "TASK-003", experiment_code: "EXP-NIGHT", tray_code: "TP-003" },
      ],
      samples: [
        {
          code: "SP-001",
          task_code: "TASK-001",
          status: "实验进行中",
          trays: [{ tray_code: "TP-001", status: "实验进行中", quantity: 1 }],
        },
      ],
      schedules: [
        {
          id: "schedule-today",
          task_code: "TASK-001",
          experiment_code: "EXP-VIB",
          device: "振动一室",
          start_at: "2026-05-23T08:00:00+08:00",
          end_at: "2026-05-23T12:00:00+08:00",
          status: "已排程",
        },
        {
          id: "schedule-tomorrow",
          task_code: "TASK-002",
          experiment_code: "EXP-SALT",
          device: "盐雾试验室",
          start_at: "2026-05-24T12:00:00+08:00",
          end_at: "2026-05-24T18:00:00+08:00",
          status: "已排程",
        },
        {
          id: "schedule-cross-day",
          task_code: "TASK-003",
          experiment_code: "EXP-NIGHT",
          device: "盐雾试验室",
          start_at: "2026-05-24T20:00:00+08:00",
          end_at: "2026-05-25T09:00:00+08:00",
          status: "已排程",
        },
        {
          id: "schedule-retention",
          task_code: "TASK-RETENTION",
          experiment_code: "EXP-RETENTION",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-05-23T08:00:00+08:00",
          end_at: "2026-05-23T09:00:00+08:00",
          status: "暂存间存放",
        },
        {
          id: "schedule-outside",
          task_code: "TASK-004",
          experiment_code: "EXP-OUTSIDE",
          device: "振动一室",
          start_at: "2026-05-26T08:00:00+08:00",
          end_at: "2026-05-26T12:00:00+08:00",
          status: "已排程",
        },
      ],
    });

    expect(view.days.map((day) => day.label)).toEqual(["5/23", "5/24", "5/25"]);
    expect(view.days.map((day) => day.key)).toEqual(["2026-05-23", "2026-05-24", "2026-05-25"]);
    expect(view.summary.total).toBe(3);
    expect(view.summary.running).toBe(1);
    expect(view.summary.conflicts).toBe(0);
    expect(view.dayCounts.map((day) => day.count)).toEqual([1, 2, 1]);
    expect(view.rows.map((row) => row.device)).toEqual(["振动一室", "盐雾试验室"]);
    expect(view.rows[0].slots[0]).toEqual(expect.objectContaining({
      displayMode: "single",
      label: "TASK-001",
      state: "running",
    }));
    expect(view.rows[1].slots.flatMap((slot) => slot.items.map((item) => item.experimentLabel))).toEqual(
      expect.arrayContaining(["盐雾试验", "跨天盐雾"]),
    );
    expect(JSON.stringify(view)).not.toContain("TASK-004");
    expect(JSON.stringify(view)).not.toContain("暂存间");
  });

  test("marks visualization schedule idle slots as maintenance or disabled from device state", () => {
    const view = buildLabScheduleThreeDayView({
      devices: [
        { code: "冲击一室", status: "维护/校准" },
        { code: "冲击二室", status: "停用" },
      ],
      labNames: ["冲击一室", "冲击二室"],
      now: new Date("2026-05-23T10:00:00+08:00"),
      schedules: [],
    });

    expect(view.rows.find((row) => row.device === "冲击一室")?.slots[0]).toEqual(expect.objectContaining({
      label: "维护中",
      state: "maintenance",
    }));
    expect(view.rows.find((row) => row.device === "冲击二室")?.slots[0]).toEqual(expect.objectContaining({
      label: "停用",
      state: "disabled",
    }));
  });

  test("builds staging sample board grouped by task and tray with capacity metrics", () => {
    const view = buildStagingSamplesView({
      capacity: 100,
      tasks: [
        { code: "TASK-STAGING-001", name: "盐雾暂存任务", test_type: "盐雾试验" },
        { code: "TASK-STAGING-002", name: "霉菌暂存任务", test_type: "霉菌试验" },
      ],
      experiments: [
        { task_code: "TASK-STAGING-001", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" },
        { task_code: "TASK-STAGING-002", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-STAGING-001", experiment_code: "EXP-SALT", tray_code: "TRAY-SALT-001" },
        { task_code: "TASK-STAGING-002", experiment_code: "EXP-MOLD", tray_code: "TRAY-MOLD-001" },
        { task_code: "TASK-STAGING-002", experiment_code: "EXP-MOLD", tray_code: "TRAY-MOLD-002" },
      ],
      stagingEvents: [
        { tray_code: "TRAY-SALT-001", task_code: "TASK-STAGING-001", action: "stock_in", time: "2026-05-28T08:00:00+08:00" },
        { tray_code: "TRAY-MOLD-001", task_code: "TASK-STAGING-002", action: "stock_in", time: "2026-05-28T08:05:00+08:00" },
        { tray_code: "TRAY-MOLD-002", task_code: "TASK-STAGING-002", action: "stock_out", time: "2026-05-28T08:10:00+08:00" },
      ],
      samples: [
        ...Array.from({ length: 6 }, (_, index) => ({
          code: `SALT-SAMPLE-00${index + 1}`,
          task_code: "TASK-STAGING-001",
          location: "恒温恒湿间（暂存间）",
          status: "已入库",
          trays: [{ tray_code: "TRAY-SALT-001", status: "已入库", quantity: 1 }],
        })),
        {
          code: "MOLD-SAMPLE-001",
          task_code: "TASK-STAGING-002",
          location: "恒温恒湿间（暂存间）",
          status: "放置实验后暂存间",
          trays: [{ tray_code: "TRAY-MOLD-001", status: "放置实验后暂存间", quantity: 1 }],
        },
        {
          code: "MOLD-SAMPLE-OUT",
          task_code: "TASK-STAGING-002",
          location: "已完成出库",
          status: "已出库",
          trays: [{ tray_code: "TRAY-MOLD-002", status: "已出库", quantity: 1 }],
        },
      ],
    });

    expect(view.summary).toEqual({
      moldRemaining: 99,
      moldTrayCount: 1,
      saltSprayRemaining: 99,
      saltSprayTrayCount: 1,
      totalSampleCount: 7,
      totalTaskCount: 2,
      totalTrayCount: 2,
      trayRemaining: 7,
      usedSystemTrayCount: 3,
    });
    expect(view.tasks.map((task) => task.taskCode)).toEqual(["TASK-STAGING-001", "TASK-STAGING-002"]);
    expect(view.tasks[0]).toMatchObject({
      sampleCount: 6,
      taskName: "盐雾暂存任务",
      trayCount: 1,
    });
    expect(view.tasks[0].trays[0]).toMatchObject({
      experimentType: "盐雾试验",
      overflowSampleCount: 1,
      sampleCount: 6,
      status: "已入库",
      trayCode: "TRAY-SALT-001",
      visibleSampleCodes: ["SALT-SAMPLE-001", "SALT-SAMPLE-002", "SALT-SAMPLE-003", "SALT-SAMPLE-004", "SALT-SAMPLE-005"],
    });
    expect(view.tasks[0].trays[0].sampleCodes).toContain("SALT-SAMPLE-006");
    expect(JSON.stringify(view)).not.toContain("MOLD-SAMPLE-OUT");
  });

  test("calculates staging tray remaining from the project-wide used tray count", () => {
    const view = buildStagingSamplesView({
      samples: [
        {
          code: "SAMPLE-LAB-001",
          task_code: "TASK-LAB-001",
          location: "盐雾试验室",
          status: "送至实验室",
          trays: [{ tray_code: "PROJECT-TP-001", status: "送至实验室", quantity: 1 }],
        },
        {
          code: "SAMPLE-DONE-001",
          task_code: "TASK-DONE-001",
          location: "冲击一室",
          status: "实验已完成",
          trays: [{ tray_code: "PROJECT-TP-002", status: "实验已完成", quantity: 1 }],
        },
      ],
      stagingEvents: [],
    });

    expect(view.summary.totalTrayCount).toBe(0);
    expect(view.summary.usedSystemTrayCount).toBe(2);
    expect(view.summary.trayRemaining).toBe(8);
  });
});
