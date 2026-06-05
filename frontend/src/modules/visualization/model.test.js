import { describe, expect, test } from "vitest";

import { buildLabProcessPanels, buildLabScheduleThreeDayView, buildStagingSamplesView, getVisualizationLabNames } from "./model";

describe("visualization model", () => {
  test("uses only real device ledger entries as visualization laboratories", () => {
    expect(getVisualizationLabNames()).toEqual([]);
    expect(getVisualizationLabNames([
      { code: "盐雾试验室", name: "盐雾试验箱" },
      { code: "冲击一室", name: "冲击试验系统-1" },
      { code: "", name: "霉菌试验室" },
    ])).toEqual(["盐雾试验室", "冲击一室", "霉菌试验室"]);
    expect(buildLabProcessPanels({ samples: [] })).toEqual([]);
  });

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
    expect(panels[1].trays).toEqual([]);
    expect(panels[1]).toMatchObject({
      sampleCount: 0,
      taskCount: 0,
      trayCount: 0,
    });
  });

  test("uses tray target lab instead of future experiment relations for lab process ownership", () => {
    const panels = buildLabProcessPanels({
      labNames: ["冲击一室", "振动一室"],
      experiments: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", experiment_name: "冲击试验", required_device: "冲击一室" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-001" },
      ],
      schedules: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", device: "冲击一室" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", device: "振动一室" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-001",
          task_code: "SYLU-2026-06-021",
          location: "冲击一室",
          status: "送至实验室",
          trays: [
            {
              tray_code: "SYLU-2026-06-021-TP-001",
              status: "送至实验室",
              target_lab: "冲击一室",
              quantity: 1,
            },
          ],
        },
      ],
    });

    expect(panels.find((panel) => panel.name === "冲击一室")?.trays.map((tray) => tray.trayCode)).toEqual([
      "SYLU-2026-06-021-TP-001",
    ]);
    expect(panels.find((panel) => panel.name === "冲击一室")?.trays[0].steps.some((step) => step.label === "送至冲击一室" && step.active)).toBe(true);
    expect(panels.find((panel) => panel.name === "振动一室")?.trays).toEqual([]);
  });

  test("keeps planned future lab flow identical to the actual active mqtt tray flow", () => {
    const panels = buildLabProcessPanels({
      labNames: ["冲击一室", "振动一室"],
      experiments: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", experiment_name: "冲击试验", required_device: "冲击一室" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-001" },
      ],
      schedules: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", device: "冲击一室" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", device: "振动一室" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-001",
          task_code: "SYLU-2026-06-021",
          location: "冲击一室",
          status: "实验进行中",
          trays: [
            {
              tray_code: "SYLU-2026-06-021-TP-001",
              status: "实验进行中",
              target_lab: "冲击一室",
              target_experiment_code: "SYLU-2026-06-021-A",
              quantity: 1,
            },
          ],
        },
      ],
    });

    const impactSteps = panels.find((panel) => panel.name === "冲击一室")?.trays[0].steps || [];
    const vibrationTrays = panels.find((panel) => panel.name === "振动一室")?.trays || [];

    expect(vibrationTrays).toEqual([]);
    expect(impactSteps.find((step) => step.label === "冲击试验进行中")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(impactSteps.map((step) => step.label)).not.toContain("送至振动一室");
  });

  test("uses mqtt experiment run state when tray samples still report ready", () => {
    const panels = buildLabProcessPanels({
      labNames: ["冲击一室", "振动一室"],
      experimentRuns: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          tray_codes: ["SYLU-2026-06-021-TP-001"],
          status: "实验进行中",
          started_at: "2026-06-04T13:55:06+08:00",
        },
      ],
      experiments: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", experiment_name: "冲击试验", required_device: "冲击一室", status: "实验准备就绪" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", experiment_name: "振动试验", required_device: "振动一室", status: "已排程" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-001" },
      ],
      schedules: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", device: "冲击一室", status: "实验准备就绪" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", device: "振动一室", status: "已排程" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-001",
          task_code: "SYLU-2026-06-021",
          location: "冲击一室",
          status: "实验准备就绪",
          trays: [
            {
              tray_code: "SYLU-2026-06-021-TP-001",
              status: "实验准备就绪",
              target_lab: "冲击一室",
              target_experiment_code: "SYLU-2026-06-021-A",
              quantity: 1,
            },
          ],
        },
      ],
    });

    const impactTray = panels.find((panel) => panel.name === "冲击一室")?.trays[0];
    expect(impactTray?.status).toBe("冲击试验进行中");
    expect(impactTray?.steps.find((step) => step.label === "冲击试验进行中")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(impactTray?.steps.find((step) => step.label === "实验准备就绪")).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
  });

  test("keeps visualization flow on the tray current experiment after another experiment completed", () => {
    const taskCode = "SYLU-2026-06-001";
    const trayCode = "SYLU-2026-06-001-TP-002";
    const panels = buildLabProcessPanels({
      labNames: ["盐雾试验室", "四综合实验室", "振动一室"],
      experiments: [
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-A", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-B", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-C", experiment_name: "四综合试验", required_device: "四综合实验室" },
      ],
      experimentRuns: [
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-001-C",
          tray_codes: [trayCode],
          status: "实验已完成",
          ended_at: "2026-06-05 00:34:38",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-A", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-B", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-C", tray_code: trayCode },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-A", device: "盐雾试验室", start_at: "2026-06-05 08:00:00" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-B", device: "振动一室", start_at: "2026-06-05 09:00:00" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-C", device: "四综合实验室", start_at: "2026-06-05 10:00:00" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-001-SP-005",
          task_code: taskCode,
          location: "盐雾试验室",
          status: "已到达实验室",
          trays: [
            {
              tray_code: trayCode,
              status: "已到达实验室",
              target_lab: "四综合实验室",
              quantity: 1,
            },
          ],
          history: [
            { detail: `${taskCode} / 四综合试验 / 实验已完成`, status: "实验已完成", time: "2026-06-05 00:34:38" },
            { detail: `${taskCode} / 盐雾试验 / 已到达实验室`, status: "已到达实验室", location: "盐雾试验室", time: "2026-06-05 00:43:50" },
          ],
        },
      ],
    });

    const saltTray = panels.find((panel) => panel.name === "盐雾试验室")?.trays.find((tray) => tray.trayCode === trayCode);
    const comprehensiveTray = panels.find((panel) => panel.name === "四综合实验室")?.trays.find((tray) => tray.trayCode === trayCode);

    expect(saltTray?.steps.map((step) => step.label)).toContain("送至盐雾试验室");
    expect(saltTray?.steps.map((step) => step.label)).not.toContain("送至四综合实验室");
    expect(saltTray?.steps.find((step) => step.label === "已到达实验室")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(comprehensiveTray).toBeUndefined();
  });

  test("shows scheduled tray information in each target lab until that lab experiment completes", () => {
    const panels = buildLabProcessPanels({
      labNames: ["冲击一室", "温度冲击一室", "振动一室"],
      experiments: [
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", required_device: "冲击试验" },
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-TEMP", experiment_name: "温度冲击试验", required_device: "温度冲击试验" },
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-VIB", experiment_name: "振动试验", required_device: "振动试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-IMPACT", tray_code: "TP-SCHEDULED-001" },
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-IMPACT", tray_code: "TP-SCHEDULED-002" },
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-TEMP", tray_code: "TP-SCHEDULED-001" },
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-TEMP", tray_code: "TP-SCHEDULED-002" },
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-VIB", tray_code: "TP-SCHEDULED-001" },
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-VIB", tray_code: "TP-SCHEDULED-002" },
      ],
      schedules: [
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-IMPACT", device: "冲击一室", status: "已排程" },
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-TEMP", device: "温度冲击一室", status: "已排程" },
        { task_code: "TASK-SCHEDULED-001", experiment_code: "EXP-VIB", device: "振动一室", status: "已排程" },
      ],
      samples: [
        {
          code: "SP-SCHEDULED-001",
          task_code: "TASK-SCHEDULED-001",
          location: "",
          status: "运输中",
          trays: [{ tray_code: "TP-SCHEDULED-001", status: "未入库", quantity: 1 }],
          history: [
            { detail: "TASK-SCHEDULED-001 / 振动试验 / 实验已完成", status: "实验已完成", time: "2026-06-04T10:00:00+08:00" },
          ],
        },
        {
          code: "SP-SCHEDULED-002",
          task_code: "TASK-SCHEDULED-001",
          location: "",
          status: "运输中",
          trays: [{ tray_code: "TP-SCHEDULED-002", status: "未入库", quantity: 1 }],
        },
      ],
    });

    expect(panels.find((panel) => panel.name === "冲击一室")?.trays.map((tray) => tray.trayCode)).toEqual([
      "TP-SCHEDULED-001",
      "TP-SCHEDULED-002",
    ]);
    expect(panels.find((panel) => panel.name === "温度冲击一室")?.trays.map((tray) => tray.trayCode)).toEqual([
      "TP-SCHEDULED-001",
      "TP-SCHEDULED-002",
    ]);
    expect(panels.find((panel) => panel.name === "振动一室")?.trays.map((tray) => tray.trayCode)).toEqual([
      "TP-SCHEDULED-002",
    ]);
    const vibrationSteps = panels.find((panel) => panel.name === "振动一室")?.trays[0].steps || [];
    expect(vibrationSteps.map((step) => step.label)).toEqual(
      expect.arrayContaining([
        "样品运输中",
        "到货",
        "送至暂存间",
        "已到达暂存间",
        "送至冲击一室",
        "已到达实验室",
        "工装夹具安装",
        "实验准备就绪",
        "振动试验未完成",
        "放置实验后暂存间",
        "厂家收回",
      ]),
    );
    expect(vibrationSteps.find((step) => step.label === "样品运输中")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(vibrationSteps.find((step) => step.label === "振动试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(vibrationSteps.map((step) => step.label)).not.toContain("送至振动一室");
  });

  test("uses the next unfinished experiment lab after a tray completes the previous experiment", () => {
    const panels = buildLabProcessPanels({
      labNames: ["振动一室", "盐雾试验室", "霉菌试验室"],
      experiments: [
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-A", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-B", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-C", experiment_name: "霉菌试验", required_device: "霉菌试验室" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-A", tray_code: "SYLU-2026-06-002-TP-001" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-B", tray_code: "SYLU-2026-06-002-TP-001" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-C", tray_code: "SYLU-2026-06-002-TP-001" },
      ],
      schedules: [
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-A", device: "振动一室" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-B", device: "盐雾试验室" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-C", device: "霉菌试验室" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-002-SP-001",
          task_code: "SYLU-2026-06-002",
          location: "振动一室",
          status: "实验已完成",
          trays: [
            {
              tray_code: "SYLU-2026-06-002-TP-001",
              status: "实验已完成",
              target_lab: "振动一室",
              quantity: 1,
            },
          ],
          history: [
            { detail: "SYLU-2026-06-002 / 振动试验 / 实验已完成", status: "实验已完成", time: "2026-06-04T01:04:34+08:00" },
          ],
        },
      ],
    });

    expect(panels.find((panel) => panel.name === "振动一室")?.trays).toEqual([]);
    expect(panels.find((panel) => panel.name === "盐雾试验室")?.trays.map((tray) => tray.trayCode)).toEqual([
      "SYLU-2026-06-002-TP-001",
    ]);
    expect(panels.find((panel) => panel.name === "盐雾试验室")?.trays[0].steps.map((step) => step.label)).toEqual(
      expect.arrayContaining(["振动试验已完成", "送至盐雾试验室", "盐雾试验未完成"]),
    );
  });

  test("keeps post-test staging dispatch on the mqtt target experiment lab", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = "SYLU-2026-06-021-TP-004";
    const panels = buildLabProcessPanels({
      labNames: ["温度冲击二室", "振动二室"],
      experiments: [
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-A", experiment_name: "冲击试验", required_device: "冲击二室" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-B", experiment_name: "温度冲击试验", required_device: "温度冲击二室" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-C", experiment_name: "振动试验", required_device: "振动二室" },
      ],
      experimentRuns: [
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-021-A",
          tray_codes: [trayCode],
          status: "实验已完成",
          ended_at: "2026-06-05 14:53:33",
        },
      ],
      experimentRunTrays: [
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-021-A",
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 14:53:33",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-A", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-B", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-C", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-B", tray_code: "SYLU-2026-06-021-TP-002" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-003" },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-A", device: "冲击二室" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-B", device: "温度冲击二室" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-C", device: "振动二室" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-004",
          task_code: taskCode,
          location: "恒温恒湿间（暂存间）",
          status: "送至实验室",
          trays: [
            {
              tray_code: trayCode,
              status: "送至实验室",
              target_lab: "温度冲击二室",
              target_experiment_code: "SYLU-2026-06-021-B",
              quantity: 1,
              updated_at: "2026-06-05 14:55:01",
            },
          ],
          history: [
            { detail: `${taskCode} / 冲击试验 / 实验已完成`, status: "实验已完成", time: "2026-06-05 14:53:33" },
            { detail: `${trayCode} -> 恒温恒湿间（实验后暂存间）`, status: "放置实验后暂存间", location: "恒温恒湿间（实验后暂存间）", time: "2026-06-05 14:54:58" },
            { detail: `${trayCode} -> 温度冲击二室`, status: "送至实验室", location: "恒温恒湿间（暂存间）", time: "2026-06-05 14:55:01" },
          ],
        },
        {
          code: "SYLU-2026-06-021-SP-002",
          task_code: taskCode,
          status: "送至实验室",
          trays: [
            {
              tray_code: "SYLU-2026-06-021-TP-002",
              status: "送至实验室",
              target_lab: "温度冲击二室",
              target_experiment_code: "SYLU-2026-06-021-B",
              quantity: 1,
            },
          ],
        },
        {
          code: "SYLU-2026-06-021-SP-003",
          task_code: taskCode,
          status: "送至实验室",
          trays: [
            {
              tray_code: "SYLU-2026-06-021-TP-003",
              status: "送至实验室",
              target_lab: "振动二室",
              target_experiment_code: "SYLU-2026-06-021-C",
              quantity: 1,
            },
          ],
        },
      ],
    });

    const tempShockTray = panels.find((panel) => panel.name === "温度冲击二室")?.trays.find((tray) => tray.trayCode === trayCode);
    const vibrationTrays = panels.find((panel) => panel.name === "振动二室")?.trays.map((tray) => tray.trayCode);

    expect(tempShockTray?.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ reached: true }),
    );
    expect(tempShockTray?.steps.find((step) => step.label === "送至温度冲击二室")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(tempShockTray?.steps.map((step) => step.label)).not.toContain("送至振动二室");
    expect(vibrationTrays).toEqual(["SYLU-2026-06-021-TP-003"]);
  });

  test("keeps same tray code from different tasks as separate lab tray rows", () => {
    const panels = buildLabProcessPanels({
      labNames: ["振动一室"],
      experiments: [
        { task_code: "TASK-VIS-A", experiment_code: "EXP-VIB-A", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: "TASK-VIS-B", experiment_code: "EXP-VIB-B", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      experimentTrays: [
        { task_code: "TASK-VIS-A", experiment_code: "EXP-VIB-A", tray_code: "TP-001" },
        { task_code: "TASK-VIS-B", experiment_code: "EXP-VIB-B", tray_code: "TP-001" },
      ],
      schedules: [
        { task_code: "TASK-VIS-A", experiment_code: "EXP-VIB-A", device: "振动一室" },
        { task_code: "TASK-VIS-B", experiment_code: "EXP-VIB-B", device: "振动一室" },
      ],
      samples: [
        {
          code: "SP-VIS-A",
          task_code: "TASK-VIS-A",
          location: "",
          status: "运输中",
          trays: [{ tray_code: "TP-001", status: "运输中", quantity: 1 }],
        },
        {
          code: "SP-VIS-B",
          task_code: "TASK-VIS-B",
          location: "",
          status: "运输中",
          trays: [{ tray_code: "TP-001", status: "运输中", quantity: 1 }],
        },
      ],
    });

    expect(panels.find((panel) => panel.name === "振动一室")?.trays).toEqual([
      expect.objectContaining({ taskCode: "TASK-VIS-A", trayCode: "TP-001" }),
      expect.objectContaining({ taskCode: "TASK-VIS-B", trayCode: "TP-001" }),
    ]);
  });

  test("keeps tray visible when only the experiment global status is completed but the tray is not completed", () => {
    const panels = buildLabProcessPanels({
      labNames: ["振动一室"],
      experiments: [
        {
          task_code: "TASK-GLOBAL-COMPLETE",
          experiment_code: "EXP-VIB",
          experiment_name: "振动试验",
          required_device: "振动一室",
          status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-GLOBAL-COMPLETE", experiment_code: "EXP-VIB", tray_code: "TP-001" },
      ],
      schedules: [
        { task_code: "TASK-GLOBAL-COMPLETE", experiment_code: "EXP-VIB", device: "振动一室" },
      ],
      samples: [
        {
          code: "SP-GLOBAL-COMPLETE",
          task_code: "TASK-GLOBAL-COMPLETE",
          location: "振动一室",
          status: "已到达实验室",
          trays: [{ tray_code: "TP-001", status: "已到达实验室", quantity: 1 }],
        },
      ],
    });

    expect(panels.find((panel) => panel.name === "振动一室")?.trays).toEqual([
      expect.objectContaining({ taskCode: "TASK-GLOBAL-COMPLETE", trayCode: "TP-001" }),
    ]);
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
      currentTrayCount: 1,
      moldRemaining: 99,
      moldTrayCount: 1,
      plannedTrayCount: 0,
      postTestTrayCount: 1,
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

  test("only marks trays sent to staging as planned staging samples", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-HANDOVER-001", name: "未接驳任务", test_type: "振动试验" }],
      experiments: [
        { task_code: "TASK-HANDOVER-001", experiment_code: "EXP-VIB", experiment_name: "振动试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-HANDOVER-001", experiment_code: "EXP-VIB", tray_code: "TP-HANDOVER-001" },
        { task_code: "TASK-HANDOVER-001", experiment_code: "EXP-VIB", tray_code: "TP-HANDOVER-002" },
      ],
      samples: [
        {
          code: "SP-HANDOVER-001",
          task_code: "TASK-HANDOVER-001",
          location: "恒温恒湿间（暂存间）",
          status: "送至暂存间",
          trays: [{ tray_code: "TP-HANDOVER-001", status: "送至暂存间", quantity: 1 }],
        },
        {
          code: "SP-HANDOVER-002",
          task_code: "TASK-HANDOVER-001",
          location: "室外接驳区",
          status: "到货",
          trays: [{ tray_code: "TP-HANDOVER-002", status: "到货", quantity: 1 }],
        },
      ],
      stagingEvents: [],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0].trays).toHaveLength(1);
    expect(view.tasks[0].trays[0]).toEqual(
      expect.objectContaining({
        stagingKind: "planned",
        stagingKindLabel: "计划进入暂存间",
        status: "送至暂存间",
        trayCode: "TP-HANDOVER-001",
      }),
    );
    expect(JSON.stringify(view)).not.toContain("TP-HANDOVER-002");
    expect(view.summary.currentTrayCount).toBe(0);
    expect(view.summary.plannedTrayCount).toBe(1);
    expect(view.summary.postTestTrayCount).toBe(0);
  });

  test("separates current staging, planned staging, and post-test staging trays", () => {
    const view = buildStagingSamplesView({
      tasks: [
        { code: "TASK-STAGING-KINDS", name: "暂存分类任务", test_type: "盐雾试验" },
      ],
      samples: [
        {
          code: "SP-CURRENT",
          task_code: "TASK-STAGING-KINDS",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [{ tray_code: "TP-CURRENT", status: "已到达暂存间", quantity: 1 }],
        },
        {
          code: "SP-PLANNED",
          task_code: "TASK-STAGING-KINDS",
          location: "室外接驳区",
          status: "送至暂存间",
          trays: [{ tray_code: "TP-PLANNED", status: "送至暂存间", quantity: 1 }],
        },
        {
          code: "SP-POST",
          task_code: "TASK-STAGING-KINDS",
          location: "恒温恒湿间（实验后暂存间）",
          status: "放置实验后暂存间",
          trays: [{ tray_code: "TP-POST", status: "放置实验后暂存间", quantity: 1 }],
        },
      ],
    });

    const trays = view.tasks[0].trays;
    expect(trays.map((tray) => [tray.trayCode, tray.stagingKind, tray.stagingKindLabel])).toEqual([
      ["TP-CURRENT", "current", "实际在暂存间"],
      ["TP-PLANNED", "planned", "计划进入暂存间"],
      ["TP-POST", "post-test", "实验后暂存间"],
    ]);
    expect(view.summary.currentTrayCount).toBe(1);
    expect(view.summary.plannedTrayCount).toBe(1);
    expect(view.summary.postTestTrayCount).toBe(1);
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
