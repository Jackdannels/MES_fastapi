import { describe, expect, test } from "vitest";

import * as visualizationModelPublicApi from "./model";
import { buildLabProcessPanels, buildLabScheduleThreeDayView, buildStagingSamplesView, buildTodayTaskPlanView, getVisualizationLabNames } from "./model";
import {
  buildLabProcessPanels as buildLabProcessPanelsFromLabProcessModel,
  getVisualizationLabNames as getVisualizationLabNamesFromLabProcessModel,
} from "./labProcessModel";
import { buildLabScheduleThreeDayView as buildLabScheduleThreeDayViewFromScheduleThreeDayModel } from "./scheduleThreeDayModel";
import { buildStagingSamplesView as buildStagingSamplesViewFromStagingSamplesModel } from "./stagingSamplesModel";
import { buildTodayTaskPlanView as buildTodayTaskPlanViewFromTodayTaskPlanModel } from "./todayTaskPlanModel";

describe("visualization model", () => {
  test("keeps the visualization model public compatibility exports stable", () => {
    expect(Object.keys(visualizationModelPublicApi).sort()).toEqual([
      "buildLabCurrentTaskMatrixView",
      "buildLabProcessPanels",
      "buildLabScheduleThreeDayView",
      "buildStagingSamplesView",
      "buildTodayTaskPlanView",
      "getVisualizationLabNames",
    ].sort());
    expect(typeof visualizationModelPublicApi.buildLabCurrentTaskMatrixView).toBe("function");
    expect(visualizationModelPublicApi.buildLabProcessPanels).toBe(buildLabProcessPanelsFromLabProcessModel);
    expect(visualizationModelPublicApi.getVisualizationLabNames).toBe(getVisualizationLabNamesFromLabProcessModel);
    expect(visualizationModelPublicApi.buildLabScheduleThreeDayView).toBe(buildLabScheduleThreeDayViewFromScheduleThreeDayModel);
    expect(visualizationModelPublicApi.buildStagingSamplesView).toBe(buildStagingSamplesViewFromStagingSamplesModel);
    expect(visualizationModelPublicApi.buildTodayTaskPlanView).toBe(buildTodayTaskPlanViewFromTodayTaskPlanModel);
  });

  test("buildTodayTaskPlanView summarizes today's real schedules by experiment count", () => {
    const view = buildTodayTaskPlanView({
      now: new Date("2026-06-18T10:00:00+08:00"),
      tasks: [
        { code: "TASK-REAL-001", test_type: "结构试验" },
        { code: "TASK-REAL-002", test_type: "环境试验" },
      ],
      experiments: [
        { task_code: "TASK-REAL-001", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", required_device: "冲击一室" },
        { task_code: "TASK-REAL-001", experiment_code: "EXP-SALT", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: "TASK-REAL-002", experiment_code: "EXP-VIB", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      experimentTrays: [
        { task_code: "TASK-REAL-001", experiment_code: "EXP-IMPACT", tray_code: "REAL-TP-001" },
        { task_code: "TASK-REAL-001", experiment_code: "EXP-IMPACT", tray_code: "REAL-TP-002" },
        { task_code: "TASK-REAL-002", experiment_code: "EXP-VIB", tray_code: "REAL-TP-003" },
      ],
      schedules: [
        {
          task_code: "TASK-REAL-001",
          experiment_code: "EXP-IMPACT",
          device: "冲击一室",
          start_at: "2026-06-18T09:00:00+08:00",
          end_at: "2026-06-18T11:30:00+08:00",
        },
        {
          task_code: "TASK-REAL-001",
          experiment_code: "EXP-SALT",
          device: "盐雾试验室",
          start_at: "2026-06-18T13:00:00+08:00",
          end_at: "2026-06-18T16:00:00+08:00",
        },
        {
          task_code: "TASK-REAL-002",
          experiment_code: "EXP-VIB",
          device: "振动一室",
          start_at: "2026-06-18T15:00:00+08:00",
          end_at: "2026-06-18T17:30:00+08:00",
        },
        {
          task_code: "TASK-OLD",
          experiment_code: "EXP-OLD",
          device: "冲击一室",
          start_at: "2026-06-17T15:00:00+08:00",
          end_at: "2026-06-17T17:30:00+08:00",
        },
      ],
      samples: [
        { task_code: "TASK-REAL-001", trays: [{ tray_code: "REAL-TP-001", quantity: 2 }] },
        { task_code: "TASK-REAL-001", trays: [{ tray_code: "REAL-TP-002", quantity: 3 }] },
        { task_code: "TASK-REAL-002", trays: [{ tray_code: "REAL-TP-003", quantity: 1 }] },
      ],
    });

    expect(view.summary).toMatchObject({
      assigned: 2,
      experiments: 3,
      pending: 1,
      samples: 6,
      tasks: 2,
    });
    expect(view.tasks.map((task) => task.taskCode)).toEqual(["TASK-REAL-001", "TASK-REAL-002"]);
    expect(view.tasks[0].experiments.map((experiment) => experiment.time)).toEqual(["09:00-11:30", "13:00-16:00"]);
    expect(view.tasks[0].experiments[0].trays).toEqual(["REAL-TP-001", "REAL-TP-002"]);
    expect(view.tasks[0].experiments[0].sampleCount).toBe(5);
    expect(view.tasks[0].experiments[1].trays).toEqual([]);
  });

  test("buildLabCurrentTaskMatrixView syncs current tasks and device statuses from shared system models", () => {
    const view = visualizationModelPublicApi.buildLabCurrentTaskMatrixView({
      labNames: ["振动一室", "霉菌试验室", "冲击一室"],
      now: new Date("2026-06-17T14:45:00+08:00"),
      devices: [
        { code: "振动一室", name: "振动一室", status: "可用" },
        { code: "霉菌试验室", name: "霉菌试验室", status: "保养" },
        { code: "冲击一室", name: "冲击一室", status: "可用" },
      ],
      tasks: [
        { code: "TASK-RUN", name: "振动运行任务" },
        { code: "TASK-WAIT", name: "冲击待启动任务" },
      ],
      experiments: [
        { task_code: "TASK-RUN", experiment_code: "EXP-RUN", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: "TASK-WAIT", experiment_code: "EXP-WAIT", experiment_name: "冲击试验", required_device: "冲击一室" },
      ],
      experimentRuns: [
        {
          run_no: "RUN-001",
          task_code: "TASK-RUN",
          experiment_code: "EXP-RUN",
          device: "振动一室",
          status: "实验进行中",
          started_at: "2026-06-17T14:00:00+08:00",
          planned_hours: 2,
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-001",
          task_code: "TASK-RUN",
          experiment_code: "EXP-RUN",
          tray_code: "TRAY-RUN",
          run_tray_status: "实验进行中",
          started_at: "2026-06-17T14:00:00+08:00",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-RUN", experiment_code: "EXP-RUN", tray_code: "TRAY-RUN" },
        { task_code: "TASK-WAIT", experiment_code: "EXP-WAIT", tray_code: "TRAY-WAIT" },
      ],
      schedules: [
        {
          task_code: "TASK-RUN",
          experiment_code: "EXP-RUN",
          device: "振动一室",
          status: "实验进行中",
          start_at: "2026-06-17T14:00:00+08:00",
          end_at: "2026-06-17T16:00:00+08:00",
        },
        {
          task_code: "TASK-WAIT",
          experiment_code: "EXP-WAIT",
          device: "冲击一室",
          status: "已排程",
          start_at: "2026-06-17T15:20:00+08:00",
          end_at: "2026-06-17T16:30:00+08:00",
        },
      ],
      samples: [
        {
          code: "SAMPLE-RUN",
          task_code: "TASK-RUN",
          location: "振动一室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-RUN", status: "实验进行中", quantity: 2 }],
        },
        {
          code: "SAMPLE-WAIT",
          task_code: "TASK-WAIT",
          location: "冲击一室",
          status: "已到达实验室",
          trays: [{ tray_code: "TRAY-WAIT", status: "已到达实验室", quantity: 1 }],
        },
      ],
    });

    const runningLab = view.labs.find((lab) => lab.labName === "振动一室");
    const maintenanceLab = view.labs.find((lab) => lab.labName === "霉菌试验室");
    const waitingLab = view.labs.find((lab) => lab.labName === "冲击一室");

    expect(runningLab).toEqual(expect.objectContaining({
      countdown: expect.objectContaining({
        active: true,
        progressPercent: 38,
        remainingLabel: "01:15:00",
      }),
      statusLabel: "实验进行中",
      statusTone: "running",
      taskCode: "TASK-RUN",
    }));
    expect(maintenanceLab).toEqual(expect.objectContaining({
      countdown: expect.objectContaining({ active: false }),
      statusLabel: "保养",
      statusTone: "upkeep",
      taskCode: "-",
    }));
    expect(waitingLab).toEqual(expect.objectContaining({
      countdown: expect.objectContaining({ active: false }),
      planTimeLabel: "2026-06-17 15:20 - 2026-06-17 16:30",
      startAt: "2026-06-17 15:20",
      endAt: "2026-06-17 16:30",
      statusLabel: "已排程",
      statusTone: "scheduled",
      taskCode: "TASK-WAIT",
    }));
  });

  test("buildLabCurrentTaskMatrixView assigns repair and upkeep tones to the supported maintenance states", () => {
    const view = visualizationModelPublicApi.buildLabCurrentTaskMatrixView({
      labNames: ["维修一室", "维修二室", "保养试验室"],
      now: new Date("2026-06-17T14:45:00+08:00"),
      devices: [
        { code: "维修一室", name: "维修一室", status: "维修" },
        { code: "维修二室", name: "维修二室", status: "维修" },
        { code: "保养试验室", name: "保养试验室", status: "保养" },
      ],
      tasks: [],
      schedules: [],
      experiments: [],
      experimentRuns: [],
      experimentRunSteps: [],
      experimentRunTrays: [],
      experimentTrays: [],
      samples: [],
    });

    expect(view.labs.map((lab) => [lab.labName, lab.statusLabel, lab.statusTone])).toEqual([
      ["维修一室", "维修", "repair"],
      ["维修二室", "维修", "repair"],
      ["保养试验室", "保养", "upkeep"],
    ]);
    expect(view.counts.repair).toBe(2);
    expect(view.counts.maintenance).toBeUndefined();
    expect(view.counts.upkeep).toBe(1);
  });

  test("buildLabCurrentTaskMatrixView scopes running lab trays to the active experiment run", () => {
    const view = visualizationModelPublicApi.buildLabCurrentTaskMatrixView({
      labNames: ["振动一室"],
      now: new Date("2026-06-17T13:10:00+08:00"),
      devices: [
        { code: "振动一室", name: "振动一室", status: "工作中" },
      ],
      tasks: [
        { code: "SYLU-2026-06-001", name: "演示任务001" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-VIB",
          experiment_name: "振动试验",
          required_device: "振动一室",
        },
      ],
      experimentRuns: [
        {
          run_no: "RUN-VIB-001",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-VIB",
          device: "振动一室",
          status: "实验进行中",
          started_at: "2026-06-17T12:56:00+08:00",
          planned_hours: 1,
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-VIB-001",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-VIB",
          tray_code: "SYLU-2026-06-001-TP-002",
          run_tray_status: "实验进行中",
          started_at: "2026-06-17T12:56:00+08:00",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-VIB", tray_code: "SYLU-2026-06-001-TP-001" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-VIB", tray_code: "SYLU-2026-06-001-TP-002" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-VIB", tray_code: "SYLU-2026-06-001-TP-003" },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-VIB",
          device: "振动一室",
          status: "实验进行中",
          start_at: "2026-06-17T12:56:00+08:00",
          end_at: "2026-06-17T13:56:00+08:00",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-001-SP-001",
          task_code: "SYLU-2026-06-001",
          location: "振动一室",
          status: "已到达实验室",
          trays: [{ tray_code: "SYLU-2026-06-001-TP-001", status: "已到达实验室", quantity: 1 }],
        },
        {
          code: "SYLU-2026-06-001-SP-005",
          task_code: "SYLU-2026-06-001",
          location: "振动一室",
          status: "实验进行中",
          trays: [{ tray_code: "SYLU-2026-06-001-TP-002", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SYLU-2026-06-001-SP-009",
          task_code: "SYLU-2026-06-001",
          location: "振动一室",
          status: "已到达实验室",
          trays: [{ tray_code: "SYLU-2026-06-001-TP-003", status: "已到达实验室", quantity: 1 }],
        },
      ],
    });

    const runningLab = view.labs[0];

    expect(runningLab.statusTone).toBe("running");
    expect(runningLab.trayCodes).toEqual(["SYLU-2026-06-001-TP-002"]);
    expect(runningLab.sampleCount).toBe(1);
  });

  test("buildLabCurrentTaskMatrixView exposes per-tray sample counts and lab totals", () => {
    const view = visualizationModelPublicApi.buildLabCurrentTaskMatrixView({
      labNames: ["冲击一室"],
      now: new Date("2026-06-17T14:45:00+08:00"),
      devices: [
        { code: "冲击一室", name: "冲击一室", status: "可用" },
      ],
      tasks: [
        { code: "TASK-MULTI-TRAY", name: "多托盘任务" },
      ],
      experiments: [
        {
          task_code: "TASK-MULTI-TRAY",
          experiment_code: "EXP-IMPACT",
          experiment_name: "冲击试验",
          required_device: "冲击一室",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-MULTI-TRAY", experiment_code: "EXP-IMPACT", tray_code: "TASK-MULTI-TRAY-TP-001" },
        { task_code: "TASK-MULTI-TRAY", experiment_code: "EXP-IMPACT", tray_code: "TASK-MULTI-TRAY-TP-002" },
      ],
      schedules: [
        {
          task_code: "TASK-MULTI-TRAY",
          experiment_code: "EXP-IMPACT",
          device: "冲击一室",
          status: "已排程",
          start_at: "2026-06-17T15:20:00+08:00",
          end_at: "2026-06-17T16:30:00+08:00",
        },
      ],
      samples: [
        {
          code: "SP-001",
          task_code: "TASK-MULTI-TRAY",
          location: "冲击一室",
          status: "已到达实验室",
          trays: [{ tray_code: "TASK-MULTI-TRAY-TP-001", status: "已到达实验室", quantity: 1 }],
        },
        {
          code: "SP-002",
          task_code: "TASK-MULTI-TRAY",
          location: "冲击一室",
          status: "已到达实验室",
          trays: [{ tray_code: "TASK-MULTI-TRAY-TP-001", status: "已到达实验室", quantity: 1 }],
        },
        {
          code: "SP-003",
          task_code: "TASK-MULTI-TRAY",
          location: "冲击一室",
          status: "已到达实验室",
          trays: [{ tray_code: "TASK-MULTI-TRAY-TP-002", status: "已到达实验室", quantity: 1 }],
        },
      ],
    });

    const lab = view.labs[0];

    expect(lab.trayItems).toEqual([
      { sampleCount: 2, sampleLabel: "2件", trayCode: "TASK-MULTI-TRAY-TP-001" },
      { sampleCount: 1, sampleLabel: "1件", trayCode: "TASK-MULTI-TRAY-TP-002" },
    ]);
    expect(lab.trayCount).toBe(2);
    expect(lab.sampleCount).toBe(3);
    expect(lab.traySummaryLabel).toBe("托盘 2，样品 3");
  });

  test("buildLabCurrentTaskMatrixView marks near-finish running labs and completed labs as urgent orange", () => {
    const view = visualizationModelPublicApi.buildLabCurrentTaskMatrixView({
      labNames: ["盐雾试验室", "四综合实验室"],
      now: new Date("2026-06-17T14:45:00+08:00"),
      devices: [
        { code: "盐雾试验室", name: "盐雾试验室", status: "可用" },
        { code: "四综合实验室", name: "四综合实验室", status: "可用" },
      ],
      tasks: [
        { code: "TASK-NEAR", name: "盐雾临近完成任务" },
        { code: "TASK-DONE", name: "四综合完成任务" },
      ],
      experiments: [
        { task_code: "TASK-NEAR", experiment_code: "EXP-NEAR", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: "TASK-DONE", experiment_code: "EXP-DONE", experiment_name: "四综合试验", required_device: "四综合实验室", status: "实验已完成" },
      ],
      experimentRuns: [
        {
          run_no: "RUN-NEAR",
          task_code: "TASK-NEAR",
          experiment_code: "EXP-NEAR",
          device: "盐雾试验室",
          status: "实验进行中",
          started_at: "2026-06-17T13:55:00+08:00",
          planned_hours: 1.25,
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-NEAR",
          task_code: "TASK-NEAR",
          experiment_code: "EXP-NEAR",
          tray_code: "TRAY-NEAR",
          run_tray_status: "实验进行中",
          started_at: "2026-06-17T13:55:00+08:00",
        },
        {
          run_no: "RUN-DONE",
          task_code: "TASK-DONE",
          experiment_code: "EXP-DONE",
          tray_code: "TRAY-DONE",
          run_tray_status: "实验已完成",
          updated_at: "2026-06-17T14:30:00+08:00",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-NEAR", experiment_code: "EXP-NEAR", tray_code: "TRAY-NEAR" },
        { task_code: "TASK-DONE", experiment_code: "EXP-DONE", tray_code: "TRAY-DONE" },
      ],
      schedules: [
        {
          task_code: "TASK-NEAR",
          experiment_code: "EXP-NEAR",
          device: "盐雾试验室",
          status: "实验进行中",
          start_at: "2026-06-17T13:55:00+08:00",
          end_at: "2026-06-17T15:10:00+08:00",
        },
        {
          task_code: "TASK-DONE",
          experiment_code: "EXP-DONE",
          device: "四综合实验室",
          status: "实验已完成",
          start_at: "2026-06-17T12:00:00+08:00",
          end_at: "2026-06-17T14:30:00+08:00",
        },
      ],
      samples: [
        {
          code: "SAMPLE-NEAR",
          task_code: "TASK-NEAR",
          location: "盐雾试验室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-NEAR", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SAMPLE-DONE",
          task_code: "TASK-DONE",
          location: "四综合实验室",
          status: "实验已完成",
          trays: [{ tray_code: "TRAY-DONE", status: "实验已完成", quantity: 1 }],
        },
      ],
    });

    expect(view.labs.find((lab) => lab.labName === "盐雾试验室")).toEqual(expect.objectContaining({
      countdown: expect.objectContaining({
        active: true,
        remainingLabel: "00:25:00",
      }),
      shouldBlink: true,
      statusLabel: "实验进行中",
      statusTone: "running",
    }));
    expect(view.labs.find((lab) => lab.labName === "四综合实验室")).toEqual(expect.objectContaining({
      countdown: expect.objectContaining({ active: false }),
      shouldBlink: false,
      statusLabel: "实验已完成",
      statusTone: "completed",
      taskCode: "TASK-DONE",
    }));
  });

  test("buildLabCurrentTaskMatrixView includes all experiment rooms and excludes staging appearance and handover rooms", () => {
    const view = visualizationModelPublicApi.buildLabCurrentTaskMatrixView({
      labNames: [
        "振动一室",
        "盐雾试验室",
        "霉菌试验室",
        "冲击一室",
        "高低温湿热一室",
        "高低温湿热二室",
        "恒温恒湿间（暂存间）",
        "外观检测间",
        "室外接驳区",
      ],
      devices: [
        { code: "振动一室", name: "振动一室", status: "可用" },
        { code: "盐雾试验室", name: "盐雾试验室", status: "可用" },
        { code: "霉菌试验室", name: "霉菌试验室", status: "可用" },
        { code: "冲击一室", name: "冲击一室", status: "可用" },
        { code: "高低温湿热一室", name: "高低温湿热一室", status: "可用" },
        { code: "高低温湿热二室", name: "高低温湿热二室", status: "可用" },
        { code: "STAGING", name: "恒温恒湿间（暂存间）", status: "可用" },
        { code: "APPEARANCE", name: "外观检测间", status: "可用" },
        { code: "HANDOVER", name: "室外接驳区", status: "可用" },
      ],
    });

    expect(view.labs.map((lab) => lab.labName)).toEqual([
      "振动一室",
      "盐雾试验室",
      "霉菌试验室",
      "冲击一室",
      "高低温湿热一室",
      "高低温湿热二室",
    ]);
    expect(JSON.stringify(view)).not.toContain("暂存间");
    expect(JSON.stringify(view)).not.toContain("外观检测间");
    expect(JSON.stringify(view)).not.toContain("接驳");
  });

  test("uses only real device ledger entries as visualization laboratories", () => {
    expect(getVisualizationLabNames()).toEqual([]);
    expect(getVisualizationLabNames([
      { code: "盐雾试验室", name: "盐雾试验箱" },
      { code: "冲击一室", name: "冲击试验系统-1" },
      { code: "", name: "霉菌试验室" },
    ])).toEqual(["盐雾试验室", "冲击一室", "霉菌试验室"]);
    expect(buildLabProcessPanels({ samples: [] })).toEqual([]);
  });

  test("backfills the second hot-humid room for visualization lab names from legacy device ledgers", () => {
    expect(getVisualizationLabNames([
      { code: "高低温湿热一室", name: "高低温湿热系统" },
    ])).toEqual(["高低温湿热一室", "高低温湿热二室"]);
  });

  test("builds lab panels from real tray flow data grouped by laboratory", () => {
    const panels = buildLabProcessPanels({
      labNames: ["振动一室", "高低温湿热一室", "高低温湿热二室"],
      tasks: [
        { code: "TASK-001", name: "真实流程任务" },
        { code: "TASK-002", name: "温湿热任务" },
        { code: "TASK-003", name: "温湿热二室任务" },
      ],
      experiments: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: "TASK-002", experiment_code: "EXP-HUM", experiment_name: "高低温湿热试验", required_device: "高低温湿热一室" },
        { task_code: "TASK-003", experiment_code: "EXP-HUM-2", experiment_name: "高低温湿热试验", required_device: "高低温湿热二室" },
      ],
      experimentTrays: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", tray_code: "TRAY-VIB-001" },
        { task_code: "TASK-002", experiment_code: "EXP-HUM", tray_code: "TRAY-HUM-001" },
        { task_code: "TASK-003", experiment_code: "EXP-HUM-2", tray_code: "TRAY-HUM-002" },
      ],
      schedules: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", device: "振动一室", status: "实验进行中" },
        { task_code: "TASK-002", experiment_code: "EXP-HUM", device: "高低温湿热一室", status: "实验已完成" },
        { task_code: "TASK-003", experiment_code: "EXP-HUM-2", device: "高低温湿热二室", status: "实验进行中" },
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
        {
          code: "SAMPLE-003",
          task_code: "TASK-003",
          location: "高低温湿热二室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-HUM-002", status: "实验进行中", quantity: 1 }],
          history: [
            { status: "到货", time: "2026-05-22T09:45:00" },
            { detail: "TASK-003 / 高低温湿热试验 / 实验进行中", time: "2026-05-22T13:00:00" },
          ],
        },
      ],
    });

    expect(panels).toHaveLength(3);
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
    expect(panels[2]).toMatchObject({
      name: "高低温湿热二室",
      sampleCount: 1,
      taskCount: 1,
      trayCount: 1,
    });
    expect(panels[2].trays[0].trayCode).toBe("TRAY-HUM-002");
  });

  test("buildLabProcessPanels builds one flow per task tray even when many samples share it", () => {
    const flowCalls = [];
    const samples = Array.from({ length: 99 }, (_, index) => ({
      code: `SAMPLE-${String(index + 1).padStart(3, "0")}`,
      task_code: "TASK-BATCH",
      location: "振动一室",
      status: "实验进行中",
      trays: [{ tray_code: "TRAY-BATCH-001", status: "实验进行中", quantity: 1 }],
    }));
    const panels = buildLabProcessPanels({
      buildTrayFlow: (input) => {
        flowCalls.push(input);
        return {
          canonicalStatus: "振动试验进行中",
          status: "振动试验进行中",
          steps: [{ active: true, label: "振动试验进行中", reached: true }],
        };
      },
      labNames: ["振动一室"],
      experiments: [
        { task_code: "TASK-BATCH", experiment_code: "EXP-VIB", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      experimentTrays: [
        { task_code: "TASK-BATCH", experiment_code: "EXP-VIB", tray_code: "TRAY-BATCH-001" },
      ],
      schedules: [
        { task_code: "TASK-BATCH", experiment_code: "EXP-VIB", device: "振动一室", status: "实验进行中" },
      ],
      samples,
    });

    expect(flowCalls).toHaveLength(1);
    expect(flowCalls[0]).toEqual(expect.objectContaining({
      taskCode: "TASK-BATCH",
      trayCode: "TRAY-BATCH-001",
    }));
    expect(panels[0].trays).toEqual([
      expect.objectContaining({
        quantity: 99,
        sampleCodes: expect.arrayContaining(["SAMPLE-001", "SAMPLE-099"]),
        status: "振动试验进行中",
        trayCode: "TRAY-BATCH-001",
      }),
    ]);
  });

  test("buildLabProcessPanels matches tray relations by schedule lab code before display device text", () => {
    const panels = buildLabProcessPanels({
      labNames: [{ code: "LAB_SALT", name: "Salt Spray Lab" }],
      tasks: [{ code: "TASK-SALT", name: "盐雾任务" }],
      experiments: [
        { task_code: "TASK-SALT", experiment_code: "EXP-SALT", experiment_name: "盐雾试验", required_device: "Salt Spray Lab" },
      ],
      experimentTrays: [
        { task_code: "TASK-SALT", experiment_code: "EXP-SALT", tray_code: "TRAY-SALT-001" },
      ],
      schedules: [
        { task_code: "TASK-SALT", experiment_code: "EXP-SALT", device: "盐雾试验室", lab_code: "LAB_SALT" },
      ],
      samples: [
        {
          code: "SAMPLE-SALT-001",
          task_code: "TASK-SALT",
          location: "盐雾试验室",
          status: "送至实验室",
          trays: [{ tray_code: "TRAY-SALT-001", status: "送至实验室", quantity: 1 }],
        },
      ],
    });

    expect(panels[0]).toEqual(expect.objectContaining({ name: "Salt Spray Lab", trayCount: 1 }));
    expect(panels[0].trays[0]).toEqual(expect.objectContaining({ taskCode: "TASK-SALT", trayCode: "TRAY-SALT-001" }));
  });

  test("keeps partial-axis completed trays visible in the lab process panel until all axes finish", () => {
    const taskCode = "SYLU-2026-06-021";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const completedAxisCodes = ["X+", "X-", "Y+"];
    const remainingAxisCodes = ["Y-", "Z+", "Z-"];
    const panels = buildLabProcessPanels({
      labNames: ["冲击一室"],
      experiments: [
        {
          axis_codes: [...completedAxisCodes, ...remainingAxisCodes],
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
      ],
      experimentRuns: [
        {
          axis_codes: completedAxisCodes,
          experiment_code: experimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${experimentCode}-SUB-001`,
          task_code: taskCode,
        },
      ],
      experimentRunSteps: completedAxisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: experimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        step_order: index + 1,
        sub_experiment_code: `${experimentCode}-SUB-001`,
        task_code: taskCode,
      })),
      experimentRunTrays: [
        {
          experiment_code: experimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${experimentCode}-SUB-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: experimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      schedules: [
        {
          axis_codes: completedAxisCodes,
          device: "冲击一室",
          experiment_code: experimentCode,
          status: "实验已完成",
          sub_experiment_code: `${experimentCode}-SUB-001`,
          task_code: taskCode,
        },
        {
          axis_codes: remainingAxisCodes,
          device: "冲击一室",
          experiment_code: experimentCode,
          status: "已排程",
          sub_experiment_code: `${experimentCode}-SUB-002`,
          task_code: taskCode,
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "冲击一室",
          status: "冲击试验部分完成 3/6轴",
          task_code: taskCode,
          trays: [
            { quantity: 2, status: "冲击试验部分完成 3/6轴", tray_code: trayCode },
          ],
        },
      ],
    });

    expect(panels[0]).toEqual(expect.objectContaining({
      name: "冲击一室",
      sampleCount: 1,
      taskCount: 1,
      trayCount: 1,
    }));
    expect(panels[0].trays[0]).toEqual(expect.objectContaining({
      status: "冲击试验部分完成 3/6轴",
      taskCode,
      trayCode,
    }));
  });

  test("does not project stale target labs over partial-axis completion in lab process panels", () => {
    const taskCode = "SYLU-2026-07-001";
    const impactExperimentCode = `${taskCode}-A`;
    const vibrationExperimentCode = `${taskCode}-B`;
    const trayCode = `${taskCode}-TP-002`;
    const panels = buildLabProcessPanels({
      labNames: ["振动二室"],
      experiments: [
        {
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      schedules: [
        { device: "冲击一室", experiment_code: impactExperimentCode, status: "实验进行中", task_code: taskCode },
        { device: "振动二室", experiment_code: vibrationExperimentCode, status: "已排程", task_code: taskCode },
      ],
      samples: [
        {
          code: `${taskCode}-SP-002`,
          location: "冲击一室",
          status: "冲击试验部分完成 3/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 3/6轴",
              target_experiment_code: vibrationExperimentCode,
              target_lab: "振动二室",
              tray_code: trayCode,
            },
          ],
        },
      ],
    });

    expect(panels[0].trays[0]).toEqual(expect.objectContaining({
      status: "冲击试验部分完成 3/6轴",
      taskCode,
      trayCode,
    }));
    expect(panels[0].trays[0].steps.find((step) => step.label === "送至振动二室")).toBeUndefined();
  });

  test("removes manufacturer-returned trays from laboratory process panels for that experiment", () => {
    const taskCode = "SYLU-2026-06-021";
    const experimentCode = `${taskCode}-A`;
    const panels = buildLabProcessPanels({
      labNames: ["温度冲击一室"],
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "温度冲击试验", required_device: "温度冲击一室" },
      ],
      experimentRunTrays: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: `${taskCode}-TP-002`,
          run_tray_status: "厂家收回",
          updated_at: "2026-06-06T12:13:02+08:00",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: `${taskCode}-TP-002` },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: experimentCode, device: "温度冲击一室" },
      ],
      samples: [
        {
          code: `${taskCode}-SP-002`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: `${taskCode}-TP-002`, status: "厂家收回", quantity: 1 }],
          history: [
            { status: "实验后暂存间存放", time: "2026-06-06T12:12:23+08:00" },
            { status: "厂家收回", time: "2026-06-06T12:13:02+08:00" },
          ],
        },
      ],
    });

    expect(panels[0]).toMatchObject({
      name: "温度冲击一室",
      trayCount: 0,
    });
    expect(panels[0].trays).toEqual([]);
  });

  test("does not hide active lab tray because another tray on the same sample was returned", () => {
    const taskCode = "SYLU-2026-06-021";
    const returnedTrayCode = `${taskCode}-TP-001`;
    const activeTrayCode = `${taskCode}-TP-002`;
    const experimentCode = `${taskCode}-B`;
    const panels = buildLabProcessPanels({
      labNames: ["霉菌试验室"],
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "霉菌试验", required_device: "霉菌试验室" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: activeTrayCode },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: experimentCode, device: "霉菌试验室" },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [
            { tray_code: returnedTrayCode, status: "厂家收回", quantity: 1 },
            { tray_code: activeTrayCode, status: "实验准备就绪", target_lab: "霉菌试验室", target_experiment_code: experimentCode, quantity: 1 },
          ],
          history: [
            { status: "厂家收回", time: "2026-06-06T12:13:02+08:00" },
          ],
        },
      ],
    });

    expect(panels[0].trays).toHaveLength(1);
    expect(panels[0].trays[0]).toMatchObject({
      trayCode: activeTrayCode,
      status: "实验准备就绪",
    });
  });

  test("keeps active lab tray visible when stale sample status says returned", () => {
    const panels = buildLabProcessPanels({
      labNames: ["盐雾试验室"],
      experiments: [
        { task_code: "TASK-001", experiment_code: "EXP-A", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
      ],
      experimentTrays: [
        { task_code: "TASK-001", experiment_code: "EXP-A", tray_code: "TP-001" },
      ],
      schedules: [
        { task_code: "TASK-001", experiment_code: "EXP-A", device: "盐雾试验室" },
      ],
      samples: [
        {
          code: "SP-001",
          task_code: "TASK-001",
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: "TP-001", status: "实验准备就绪", target_lab: "盐雾试验室", target_experiment_code: "EXP-A", quantity: 1 }],
        },
      ],
    });

    expect(panels[0].trays).toHaveLength(1);
    expect(panels[0].trays[0]).toMatchObject({
      trayCode: "TP-001",
      status: "实验准备就绪",
    });
  });

  test("does not hide active lab tray because unscoped history completed the same experiment", () => {
    const taskCode = "TASK-HISTORY";
    const experimentCode = "EXP-MOLD";
    const panels = buildLabProcessPanels({
      labNames: ["霉菌试验室"],
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "霉菌试验", required_device: "霉菌试验室" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: "TP-001" },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: "TP-002" },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: experimentCode, device: "霉菌试验室" },
      ],
      samples: [
        {
          code: "SP-001",
          task_code: taskCode,
          location: "霉菌试验室",
          status: "实验准备就绪",
          trays: [
            { tray_code: "TP-001", status: "实验已完成", quantity: 1 },
            { tray_code: "TP-002", status: "实验准备就绪", target_lab: "霉菌试验室", target_experiment_code: experimentCode, quantity: 1 },
          ],
          history: [
            { detail: `${taskCode} / 霉菌试验 / 实验已完成`, status: "实验已完成", time: "2026-06-06T12:13:02+08:00" },
          ],
        },
      ],
    });

    expect(panels[0].trays.map((tray) => tray.trayCode)).toContain("TP-002");
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
    expect(panels.find((panel) => panel.name === "振动一室")?.trays.map((tray) => tray.trayCode)).toEqual([
      "SYLU-2026-06-021-TP-001",
    ]);
    expect(panels.find((panel) => panel.name === "振动一室")?.trays[0].steps.map((step) => step.label)).toContain("振动试验未完成");
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

    expect(vibrationTrays.map((tray) => tray.trayCode)).toEqual(["SYLU-2026-06-021-TP-001"]);
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
          run_no: "RUN-IMPACT-021",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          tray_codes: ["SYLU-2026-06-021-TP-001"],
          status: "实验进行中",
          started_at: "2026-06-04T13:55:06+08:00",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT-021",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          tray_code: "SYLU-2026-06-021-TP-001",
          run_tray_status: "实验进行中",
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

  test("does not treat temperature shock completion as impact completion", () => {
    const taskCode = "SYLU-2026-06-023";
    const trayCode = `${taskCode}-TP-002`;
    const panels = buildLabProcessPanels({
      labNames: ["冲击一室", "温度冲击一室"],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", required_device: "冲击试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "温度冲击试验", required_device: "温度冲击试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击一室", status: "已排程" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "温度冲击一室", status: "实验已完成" },
      ],
      experimentRunTrays: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-C`,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-06 14:11:30",
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-007`,
          task_code: taskCode,
          location: "温度冲击一室",
          status: "实验已完成",
          trays: [{ tray_code: trayCode, status: "实验已完成", quantity: 1 }],
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 温度冲击试验 / 实验已完成`,
              location: "温度冲击一室",
              status: "实验已完成",
              time: "2026-06-06 14:11:30",
            },
          ],
        },
      ],
    });

    const impactTray = panels.find((panel) => panel.name === "冲击一室")?.trays.find((tray) => tray.trayCode === trayCode);
    const temperatureTray = panels.find((panel) => panel.name === "温度冲击一室")?.trays.find((tray) => tray.trayCode === trayCode);

    expect(impactTray).toEqual(expect.objectContaining({
      trayCode,
    }));
    expect(impactTray?.steps.map((step) => step.label)).toContain("冲击试验未完成");
    expect(temperatureTray).toBeUndefined();
  });

  test("does not treat partial completed status text as completed experiment history", () => {
    const taskCode = "SYLU-2026-06-024";
    const trayCode = `${taskCode}-TP-001`;
    const panels = buildLabProcessPanels({
      labNames: ["冲击一室"],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", required_device: "冲击试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击一室", status: "已排程" },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          status: "实验已完成待确认",
          trays: [{ tray_code: trayCode, status: "实验已完成待确认", quantity: 1 }],
          history: [
            {
              action: "实验完成待确认",
              detail: `${taskCode} / 冲击试验 / 实验已完成待确认`,
              status: "实验已完成待确认",
              time: "2026-06-06 14:20:30",
            },
          ],
        },
      ],
    });

    const impactTray = panels.find((panel) => panel.name === "冲击一室")?.trays.find((tray) => tray.trayCode === trayCode);

    expect(impactTray).toEqual(expect.objectContaining({
      trayCode,
    }));
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
            {
              detail: "SYLU-2026-06-002 / 振动试验 / 实验已完成",
              status: "实验已完成",
              time: "2026-06-04T01:04:34+08:00",
              tray_code: "SYLU-2026-06-002-TP-001",
            },
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
            { detail: `${trayCode} -> 恒温恒湿间（实验后暂存间）`, status: "实验后暂存间存放", location: "恒温恒湿间（实验后暂存间）", time: "2026-06-05 14:54:58" },
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
    expect(vibrationTrays).toEqual(["SYLU-2026-06-021-TP-003", trayCode]);
  });

  test("keeps a staging-dispatched tray visible in a lab when a stale target experiment points elsewhere", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-005`;
    const panels = buildLabProcessPanels({
      labNames: ["温度冲击二室", "振动二室"],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", required_device: "温度冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "振动试验", required_device: "振动二室" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "温度冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "振动二室" },
      ],
      samples: [
        {
          code: `${taskCode}-SP-005`,
          task_code: taskCode,
          location: "恒温恒湿间（暂存间）",
          status: "送至实验室",
          trays: [
            {
              tray_code: trayCode,
              status: "送至实验室",
              target_lab: "温度冲击二室",
              target_experiment_code: `${taskCode}-C`,
              quantity: 1,
            },
          ],
        },
      ],
    });

    const tempShockTrays = panels.find((panel) => panel.name === "温度冲击二室")?.trays.map((tray) => tray.trayCode);
    const vibrationTrays = panels.find((panel) => panel.name === "振动二室")?.trays.map((tray) => tray.trayCode);

    expect(tempShockTrays).toEqual([trayCode]);
    expect(vibrationTrays).toEqual([trayCode]);
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

  test("removes lab preparation steps when a staging tray is returned by manufacturer", () => {
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

    expect(panels[0].trays).toEqual([]);
    expect(panels[0].trayCount).toBe(0);
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

  test("keeps one visualization schedule color per task and separates different tasks", () => {
    const view = buildLabScheduleThreeDayView({
      labNames: ["冲击一室", "冲击二室", "振动一室"],
      now: new Date("2026-06-29T10:00:00+08:00"),
      schedules: [
        {
          id: "schedule-impact-a",
          task_code: "SYLU-2026-06-021",
          experiment_code: "EXP-IMPACT-A",
          device: "冲击一室",
          start_at: "2026-06-29T14:00:00+08:00",
          end_at: "2026-06-29T18:00:00+08:00",
          status: "已排程",
        },
        {
          id: "schedule-impact-b",
          task_code: "SYLU-2026-06-021",
          experiment_code: "EXP-IMPACT-B",
          device: "冲击二室",
          start_at: "2026-06-30T08:00:00+08:00",
          end_at: "2026-06-30T11:30:00+08:00",
          status: "已排程",
        },
        {
          id: "schedule-vibration",
          task_code: "SYLU-2026-07-001",
          experiment_code: "EXP-VIB",
          device: "振动一室",
          start_at: "2026-06-29T14:00:00+08:00",
          end_at: "2026-06-29T18:00:00+08:00",
          status: "已排程",
        },
      ],
    });

    const task021Items = view.rows
      .flatMap((row) => row.slots)
      .flatMap((slot) => slot.items.map((item) => ({ item, slot })))
      .filter(({ item }) => item.taskCode === "SYLU-2026-06-021");
    const task07001Item = view.rows
      .flatMap((row) => row.slots)
      .flatMap((slot) => slot.items.map((item) => ({ item, slot })))
      .find(({ item }) => item.taskCode === "SYLU-2026-07-001");

    expect(task021Items).toHaveLength(2);
    expect(new Set(task021Items.map(({ item }) => item.color)).size).toBe(1);
    expect(new Set(task021Items.map(({ slot }) => slot.taskColor)).size).toBe(1);
    expect(task07001Item?.item.color).toBeTruthy();
    expect(task07001Item?.item.color).not.toBe(task021Items[0].item.color);
  });

  test("marks visualization schedule idle slots as maintenance or disabled from device state", () => {
    const view = buildLabScheduleThreeDayView({
      devices: [
        { code: "冲击一室", status: "维修" },
        { code: "冲击二室", status: "停用" },
      ],
      labNames: ["冲击一室", "冲击二室"],
      now: new Date("2026-05-23T10:00:00+08:00"),
      schedules: [],
    });

    expect(view.rows.find((row) => row.device === "冲击一室")?.slots[0]).toEqual(expect.objectContaining({
      label: "维修中",
      state: "maintenance",
    }));
    expect(view.rows.find((row) => row.device === "冲击二室")?.slots[0]).toEqual(expect.objectContaining({
      label: "停用",
      state: "disabled",
    }));
  });

  test("keeps visualization maintenance markers inside the planned maintenance window", () => {
    const view = buildLabScheduleThreeDayView({
      devices: [{
        code: "高低温湿热二室",
        maintenance_end_at: "2026-05-23T16:49:00+08:00",
        maintenance_start_at: "2026-05-23T13:49:00+08:00",
        status: "维修",
      }],
      labNames: ["高低温湿热二室"],
      now: new Date("2026-05-23T14:00:00+08:00"),
      schedules: [],
    });

    const slots = view.rows.find((row) => row.device === "高低温湿热二室")?.slots || [];
    expect(slots[0]).toEqual(expect.objectContaining({ state: "idle", label: "空闲" }));
    expect(slots[1]).toEqual(expect.objectContaining({ state: "maintenance", label: "维修中" }));
    expect(slots.slice(2).every((slot) => slot.state === "idle")).toBe(true);
  });

  test("marks lab process panel as maintenance when the matched device is unavailable", () => {
    const panels = buildLabProcessPanels({
      devices: [{ code: "冲击一室", status: "维修" }],
      labNames: ["冲击一室"],
      samples: [
        {
          code: "SAMPLE-001",
          task_code: "TASK-001",
          location: "冲击一室",
          status: "已到达实验室",
          trays: [{ tray_code: "TRAY-001", status: "已到达实验室" }],
        },
      ],
      experiments: [
        {
          task_code: "TASK-001",
          experiment_code: "EXP-001",
          experiment_name: "冲击实验",
          required_device: "冲击一室",
        },
      ],
      experimentTrays: [
        {
          task_code: "TASK-001",
          experiment_code: "EXP-001",
          tray_code: "TRAY-001",
        },
      ],
      schedules: [
        {
          task_code: "TASK-001",
          experiment_code: "EXP-001",
          device: "冲击一室",
        },
      ],
    });

    expect(panels[0]).toEqual(expect.objectContaining({
      alert: "设备维修中",
      healthLabel: "维修",
      healthState: "repair",
      state: "维修",
    }));
  });

  test("marks lab process upkeep devices as upkeep instead of maintenance", () => {
    const panels = buildLabProcessPanels({
      devices: [
        { code: "霉菌试验室", status: "保养" },
        { code: "高低温湿热二室", status: "保养" },
      ],
      labNames: ["霉菌试验室", "高低温湿热二室"],
      samples: [],
      experimentTrays: [],
      schedules: [],
    });

    expect(panels.map((panel) => [panel.name, panel.alert, panel.healthLabel, panel.healthState, panel.state])).toEqual([
      ["霉菌试验室", "设备保养中", "保养", "upkeep", "保养"],
      ["高低温湿热二室", "设备保养中", "保养", "upkeep", "保养"],
    ]);
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
          status: "已到达暂存间",
          trays: [{ tray_code: "TRAY-SALT-001", status: "已到达暂存间", quantity: 1 }],
        })),
        {
          code: "MOLD-SAMPLE-001",
          task_code: "TASK-STAGING-002",
          location: "恒温恒湿间（暂存间）",
          status: "实验后暂存间存放",
          trays: [{ tray_code: "TRAY-MOLD-001", status: "实验后暂存间存放", quantity: 1 }],
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
      allowedTrayCount: 0,
      appearancePlannedTrayCount: 0,
      appearanceTrayCount: 0,
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
      status: "已到达暂存间",
      trayCode: "TRAY-SALT-001",
      visibleSampleCodes: ["SALT-SAMPLE-001", "SALT-SAMPLE-002", "SALT-SAMPLE-003", "SALT-SAMPLE-004", "SALT-SAMPLE-005"],
    });
    expect(view.tasks[0].trays[0].sampleCodes).toContain("SALT-SAMPLE-006");
    expect(JSON.stringify(view)).not.toContain("MOLD-SAMPLE-OUT");
  });

  test("does not treat legacy stored status as current staging inventory", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-LEGACY-STORED", name: "旧入库状态任务", test_type: "盐雾试验" }],
      samples: [
        {
          code: "SP-LEGACY-STORED",
          task_code: "TASK-LEGACY-STORED",
          location: "恒温恒湿间（暂存间）",
          status: "已入库",
          trays: [{ tray_code: "TP-LEGACY-STORED", status: "已入库", quantity: 1 }],
        },
      ],
      stagingEvents: [],
    });

    expect(view.tasks).toEqual([]);
    expect(view.summary.currentTrayCount).toBe(0);
  });

  test("uses canonical staging status for stock-in events", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-STOCK-IN", name: "暂存入库任务", test_type: "盐雾试验" }],
      samples: [
        {
          code: "SP-STOCK-IN",
          task_code: "TASK-STOCK-IN",
          location: "恒温恒湿间（暂存间）",
          status: "运输中",
          trays: [{ tray_code: "TP-STOCK-IN", status: "运输中", quantity: 1 }],
        },
      ],
      stagingEvents: [
        { tray_code: "TP-STOCK-IN", task_code: "TASK-STOCK-IN", action: "stock_in", time: "2026-05-28T08:00:00+08:00" },
      ],
    });

    expect(view.tasks[0].trays[0]).toEqual(expect.objectContaining({
      stagingKind: "current",
      status: "已到达暂存间",
      trayCode: "TP-STOCK-IN",
    }));
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
        stagingKindLabel: "计划暂存",
        status: "送至暂存间",
        trayCode: "TP-HANDOVER-001",
      }),
    );
    expect(JSON.stringify(view)).not.toContain("TP-HANDOVER-002");
    expect(view.summary.currentTrayCount).toBe(0);
    expect(view.summary.plannedTrayCount).toBe(1);
    expect(view.summary.postTestTrayCount).toBe(0);
    expect(view.summary.appearanceTrayCount).toBe(0);
  });

  test("does not plan staging for handover-arrival trays that are only scheduled for lab experiments", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-004`;
    const view = buildStagingSamplesView({
      tasks: [{ code: taskCode, name: "132", test_type: "冲击试验 / 盐雾试验 / 霉菌试验 / 振动试验" }],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "盐雾试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "霉菌试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, experiment_name: "振动试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, tray_code: trayCode },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击一室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "盐雾试验室" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "霉菌试验室" },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, device: "振动一室" },
      ],
      samples: [
        {
          code: `${taskCode}-SP-005`,
          task_code: taskCode,
          location: "接驳区",
          status: "到货",
          flow_status: "到货",
          trays: [{ tray_code: trayCode, status: "到货", quantity: 1 }],
        },
        {
          code: `${taskCode}-SP-006`,
          task_code: taskCode,
          location: "接驳区",
          status: "到货",
          flow_status: "到货",
          trays: [{ tray_code: trayCode, status: "到货", quantity: 1 }],
        },
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "外观检测间",
          status: "实验后外观检测间存放",
          flow_status: "实验后外观检测间存放",
          trays: [{ tray_code: `${taskCode}-TP-001`, status: "实验后外观检测间存放", quantity: 1 }],
          history: [
            { detail: `${taskCode} / 冲击试验 / 实验已完成`, status: "实验已完成" },
            { detail: `${taskCode} / 盐雾试验 / 实验已完成`, status: "实验已完成" },
            { detail: `${taskCode} / 霉菌试验 / 实验已完成`, status: "实验已完成" },
            { detail: `${taskCode} / 振动试验 / 实验已完成`, status: "实验已完成" },
          ],
        },
      ],
      stagingEvents: [],
    });

    expect(JSON.stringify(view)).not.toContain(trayCode);
    expect(view.summary.plannedTrayCount).toBe(0);
  });

  test("removes trays from staging board after stock-out dispatches them to a laboratory", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildStagingSamplesView({
      tasks: [{ code: taskCode, name: "132", test_type: "冲击试验 / 霉菌试验 / 盐雾试验 / 振动试验" }],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "霉菌试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "盐雾试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, experiment_name: "振动试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, tray_code: trayCode },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "盐雾试验室",
          status: "送至实验室",
          flow_status: "送至实验室",
          trays: [
            {
              tray_code: trayCode,
              status: "送至实验室",
              target_experiment_code: `${taskCode}-C`,
              target_lab: "盐雾试验室",
              quantity: 1,
            },
          ],
        },
      ],
      stagingEvents: [
        {
          action: "stock_in",
          room: "staging",
          task_code: taskCode,
          time: "2026-07-01T08:00:00+08:00",
          tray_code: trayCode,
        },
        {
          action: "stock_out",
          room: "staging",
          target_experiment_code: `${taskCode}-C`,
          target_lab: "盐雾试验室",
          target_type: "lab",
          task_code: taskCode,
          time: "2026-07-01T09:00:00+08:00",
          tray_code: trayCode,
        },
      ],
    });

    expect(JSON.stringify(view.tasks)).not.toContain(trayCode);
    expect(view.summary.totalTaskCount).toBe(0);
    expect(view.summary.totalTrayCount).toBe(0);
    expect(view.summary.totalSampleCount).toBe(0);
    expect(view.summary.appearancePlannedTrayCount).toBe(0);
    expect(view.summary.plannedTrayCount).toBe(0);
  });

  test("keeps stock-out trays visible when the destination is staging", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-STOCK-OUT-STAGING", name: "转暂存任务", test_type: "盐雾试验" }],
      samples: [
        {
          code: "SP-STOCK-OUT-STAGING",
          task_code: "TASK-STOCK-OUT-STAGING",
          location: "室外接驳区",
          status: "送至暂存间",
          trays: [{ tray_code: "TP-STOCK-OUT-STAGING", status: "送至暂存间", quantity: 1 }],
        },
      ],
      stagingEvents: [
        {
          action: "stock_in",
          task_code: "TASK-STOCK-OUT-STAGING",
          time: "2026-06-06T09:00:00+08:00",
          tray_code: "TP-STOCK-OUT-STAGING",
        },
        {
          action: "stock_out",
          target_lab: "恒温恒湿间（暂存间）",
          target_type: "staging",
          task_code: "TASK-STOCK-OUT-STAGING",
          time: "2026-06-06T10:00:00+08:00",
          tray_code: "TP-STOCK-OUT-STAGING",
        },
      ],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0].trays[0]).toEqual(
      expect.objectContaining({
        stagingKind: "planned",
        stagingKindLabel: "计划暂存",
        status: "送至暂存间",
        trayCode: "TP-STOCK-OUT-STAGING",
        updatedAt: "2026-06-06T10:00:00+08:00",
      }),
    );
    expect(view.summary.plannedTrayCount).toBe(1);
  });

  test("classifies appearance stock-out to staging as planned staging", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-APPEARANCE-TO-STAGING", name: "外观转暂存", test_type: "霉菌试验" }],
      samples: [
        {
          code: "SP-APPEARANCE-TO-STAGING",
          location: "外观检测间",
          status: "送至暂存间",
          task_code: "TASK-APPEARANCE-TO-STAGING",
          trays: [{ quantity: 1, status: "送至暂存间", tray_code: "TP-APPEARANCE-TO-STAGING" }],
        },
      ],
      stagingEvents: [
        {
          action: "stock_out",
          room: "appearance",
          target_lab: "恒温恒湿间（暂存间）",
          target_type: "staging",
          task_code: "TASK-APPEARANCE-TO-STAGING",
          time: "2026-06-06T10:30:00+08:00",
          tray_code: "TP-APPEARANCE-TO-STAGING",
        },
      ],
    });

    expect(view.tasks[0].trays[0]).toEqual(
      expect.objectContaining({
        stagingKind: "planned",
        stagingKindLabel: "计划暂存",
        status: "送至暂存间",
        trayCode: "TP-APPEARANCE-TO-STAGING",
      }),
    );
    expect(view.summary.appearanceTrayCount).toBe(0);
    expect(view.summary.plannedTrayCount).toBe(1);
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
          status: "实验后暂存间存放",
          trays: [{ tray_code: "TP-POST", status: "实验后暂存间存放", quantity: 1 }],
        },
      ],
    });

    const trays = view.tasks[0].trays;
    expect(trays.map((tray) => [tray.trayCode, tray.stagingKind, tray.stagingKindLabel])).toEqual([
      ["TP-CURRENT", "current", "暂存间存放"],
      ["TP-PLANNED", "planned", "计划暂存"],
      ["TP-POST", "post-test", "实验后暂存间"],
    ]);
    expect(view.summary.currentTrayCount).toBe(1);
    expect(view.summary.plannedTrayCount).toBe(1);
    expect(view.summary.postTestTrayCount).toBe(1);
    expect(view.summary.appearanceTrayCount).toBe(0);
  });

  test("aggregates appearance inspection storage into the staging information screen", () => {
    const view = buildStagingSamplesView({
      tasks: [
        { code: "TASK-APPEARANCE", name: "外观检测任务", test_type: "盐雾试验" },
      ],
      experiments: [
        { task_code: "TASK-APPEARANCE", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-APPEARANCE", experiment_code: "EXP-SALT", tray_code: "TP-APPEARANCE" },
      ],
      samples: [
        {
          code: "SP-APPEARANCE",
          task_code: "TASK-APPEARANCE",
          location: "外观检测间",
          status: "实验后外观检测间存放",
          trays: [{ tray_code: "TP-APPEARANCE", status: "实验后外观检测间存放", quantity: 1 }],
        },
      ],
      stagingEvents: [
        {
          action: "stock_in",
          room: "appearance",
          task_code: "TASK-APPEARANCE",
          time: "2026-06-06T10:00:00+08:00",
          tray_code: "TP-APPEARANCE",
        },
      ],
    });

    expect(view.tasks[0].trays[0]).toEqual(expect.objectContaining({
      stagingKind: "appearance",
      stagingKindLabel: "实验后外观检测间存放",
      status: "实验后外观检测间存放",
      trayCode: "TP-APPEARANCE",
    }));
    expect(view.summary.appearanceTrayCount).toBe(1);
    expect(view.summary.currentTrayCount).toBe(0);
  });

  test("uses explicit appearance stock-in event status before falling back to sample state", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-APPEARANCE-EVENT-STATUS", name: "外观事件状态任务", test_type: "霉菌试验" }],
      experiments: [
        { task_code: "TASK-APPEARANCE-EVENT-STATUS", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-APPEARANCE-EVENT-STATUS", experiment_code: "EXP-MOLD", tray_code: "TP-APPEARANCE-EVENT-STATUS" },
      ],
      samples: [
        {
          code: "SP-APPEARANCE-EVENT-STATUS",
          task_code: "TASK-APPEARANCE-EVENT-STATUS",
          location: "霉菌试验室",
          status: "送至实验室",
          flow_status: "送至实验室",
          trays: [{
            tray_code: "TP-APPEARANCE-EVENT-STATUS",
            status: "送至实验室",
            target_experiment_code: "EXP-MOLD",
            target_lab: "霉菌试验室",
            quantity: 1,
          }],
        },
      ],
      stagingEvents: [
        {
          action: "stock_in",
          room: "appearance",
          status: "实验前外观检测间存放",
          task_code: "TASK-APPEARANCE-EVENT-STATUS",
          time: "2026-06-06T10:00:00+08:00",
          tray_code: "TP-APPEARANCE-EVENT-STATUS",
        },
      ],
    });

    expect(view.tasks[0].trays[0]).toEqual(expect.objectContaining({
      stagingKind: "appearance",
      stagingKindLabel: "实验前外观检测间存放",
      status: "实验前外观检测间存放",
    }));
  });

  test("infers pre-experiment appearance storage from target experiment when stock-in event lacks status", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-APPEARANCE-INFER-PRE", name: "外观推断任务", test_type: "霉菌试验" }],
      experiments: [
        { task_code: "TASK-APPEARANCE-INFER-PRE", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验", required_device: "霉菌试验室" },
      ],
      experimentTrays: [
        { task_code: "TASK-APPEARANCE-INFER-PRE", experiment_code: "EXP-MOLD", tray_code: "TP-APPEARANCE-INFER-PRE" },
      ],
      samples: [
        {
          code: "SP-APPEARANCE-INFER-PRE",
          task_code: "TASK-APPEARANCE-INFER-PRE",
          location: "霉菌试验室",
          status: "送至实验室",
          flow_status: "送至实验室",
          trays: [{
            tray_code: "TP-APPEARANCE-INFER-PRE",
            status: "送至实验室",
            target_experiment_code: "EXP-MOLD",
            target_lab: "霉菌试验室",
            quantity: 1,
          }],
        },
      ],
      stagingEvents: [
        {
          action: "stock_in",
          room: "appearance",
          task_code: "TASK-APPEARANCE-INFER-PRE",
          time: "2026-06-06T10:00:00+08:00",
          tray_code: "TP-APPEARANCE-INFER-PRE",
        },
      ],
    });

    expect(view.tasks[0].trays[0]).toEqual(expect.objectContaining({
      stagingKind: "appearance",
      stagingKindLabel: "实验前外观检测间存放",
      status: "实验前外观检测间存放",
    }));
  });

  test("does not silently default ambiguous appearance stock-in events to post-experiment storage", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-APPEARANCE-UNKNOWN", name: "外观未知任务", test_type: "冲击试验" }],
      samples: [
        {
          code: "SP-APPEARANCE-UNKNOWN",
          task_code: "TASK-APPEARANCE-UNKNOWN",
          location: "外观检测间",
          status: "送至实验室",
          flow_status: "送至实验室",
          trays: [{ tray_code: "TP-APPEARANCE-UNKNOWN", status: "送至实验室", quantity: 1 }],
        },
      ],
      stagingEvents: [
        {
          action: "stock_in",
          room: "appearance",
          task_code: "TASK-APPEARANCE-UNKNOWN",
          time: "2026-06-06T10:00:00+08:00",
          tray_code: "TP-APPEARANCE-UNKNOWN",
        },
      ],
    });

    expect(view.tasks[0].trays[0]).toEqual(expect.objectContaining({
      stagingKind: "appearance",
      stagingKindLabel: "外观检测间存放",
      status: "外观检测间存放",
    }));
  });

  test("does not show sent-to-appearance trays as planned appearance inbound", () => {
    const view = buildStagingSamplesView({
      tasks: [
        { code: "TASK-SENT-APPEARANCE", name: "霉菌完成待外观", test_type: "霉菌试验" },
      ],
      experiments: [
        { task_code: "TASK-SENT-APPEARANCE", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-SENT-APPEARANCE", experiment_code: "EXP-MOLD", tray_code: "TP-SENT-APPEARANCE" },
      ],
      samples: [
        {
          code: "SP-SENT-APPEARANCE",
          task_code: "TASK-SENT-APPEARANCE",
          location: "外观检测间",
          status: "送至外观检测间",
          flow_status: "送至外观检测间",
          trays: [{ tray_code: "TP-SENT-APPEARANCE", status: "送至外观检测间", quantity: 1 }],
        },
      ],
      stagingEvents: [],
    });

    expect(JSON.stringify(view)).not.toContain("TP-SENT-APPEARANCE");
    expect(view.summary.appearanceTrayCount).toBe(0);
    expect(view.summary.appearancePlannedTrayCount).toBe(0);
  });

  test("does not show manufacturer-returned sent-to-appearance trays as planned appearance inbound", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-RETURNED-APPEARANCE", name: "已回收外观任务", test_type: "盐雾试验" }],
      samples: [
        {
          code: "SP-RETURNED-APPEARANCE",
          task_code: "TASK-RETURNED-APPEARANCE",
          location: "厂家收回",
          status: "厂家收回",
          flow_status: "送至外观检测间",
          trays: [{ tray_code: "TP-RETURNED-APPEARANCE", status: "送至外观检测间", quantity: 1 }],
        },
      ],
      stagingEvents: [
        {
          action: "manufacturer_return",
          room: "staging",
          task_code: "TASK-RETURNED-APPEARANCE",
          time: "2026-06-07T11:00:00+08:00",
          tray_code: "TP-RETURNED-APPEARANCE",
        },
      ],
    });

    expect(JSON.stringify(view)).not.toContain("TP-RETURNED-APPEARANCE");
    expect(view.summary.appearancePlannedTrayCount).toBe(0);
  });

  test("does not show fully completed neutral trays as allowed staging inbound", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-FINISHED-STAGING", name: "全部完成任务", test_type: "冲击试验 / 振动试验" }],
      experiments: [
        { task_code: "TASK-FINISHED-STAGING", experiment_code: "EXP-SHOCK", experiment_name: "冲击试验" },
        { task_code: "TASK-FINISHED-STAGING", experiment_code: "EXP-VIB", experiment_name: "振动试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-FINISHED-STAGING", experiment_code: "EXP-SHOCK", tray_code: "TP-FINISHED-STAGING" },
        { task_code: "TASK-FINISHED-STAGING", experiment_code: "EXP-VIB", tray_code: "TP-FINISHED-STAGING" },
      ],
      experimentRunTrays: [
        { task_code: "TASK-FINISHED-STAGING", experiment_code: "EXP-SHOCK", tray_code: "TP-FINISHED-STAGING", status: "实验已完成" },
        { task_code: "TASK-FINISHED-STAGING", experiment_code: "EXP-VIB", tray_code: "TP-FINISHED-STAGING", status: "实验已完成" },
      ],
      samples: [
        {
          code: "SP-FINISHED-STAGING",
          task_code: "TASK-FINISHED-STAGING",
          location: "振动一室",
          status: "实验已完成",
          flow_status: "实验已完成",
          trays: [{ tray_code: "TP-FINISHED-STAGING", status: "实验已完成", quantity: 1 }],
        },
      ],
      stagingEvents: [],
    });

    expect(JSON.stringify(view)).not.toContain("TP-FINISHED-STAGING");
    expect(view.summary.allowedTrayCount).toBe(0);
    expect(view.summary.plannedTrayCount).toBe(0);
  });

  test("hides fully completed non-appearance trays that are only allowed staging", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-FINISHED-ALLOWED", name: "全部完成允许暂存", test_type: "冲击试验 / 振动试验" }],
      experiments: [
        { task_code: "TASK-FINISHED-ALLOWED", experiment_code: "EXP-SHOCK", experiment_name: "冲击试验" },
        { task_code: "TASK-FINISHED-ALLOWED", experiment_code: "EXP-VIB", experiment_name: "振动试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-FINISHED-ALLOWED", experiment_code: "EXP-SHOCK", tray_code: "TP-FINISHED-ALLOWED" },
        { task_code: "TASK-FINISHED-ALLOWED", experiment_code: "EXP-VIB", tray_code: "TP-FINISHED-ALLOWED" },
      ],
      experimentRunTrays: [
        { task_code: "TASK-FINISHED-ALLOWED", experiment_code: "EXP-SHOCK", tray_code: "TP-FINISHED-ALLOWED", status: "实验已完成" },
        { task_code: "TASK-FINISHED-ALLOWED", experiment_code: "EXP-VIB", tray_code: "TP-FINISHED-ALLOWED", status: "实验已完成" },
      ],
      samples: [
        {
          code: "SP-FINISHED-ALLOWED",
          task_code: "TASK-FINISHED-ALLOWED",
          location: "振动一室",
          status: "实验已完成",
          flow_status: "实验已完成",
          trays: [{ tray_code: "TP-FINISHED-ALLOWED", status: "实验已完成", quantity: 1 }],
          history: [
            { detail: "TASK-FINISHED-ALLOWED / 冲击试验 / 实验已完成", time: "2026-06-05 10:00:00" },
            { detail: "TASK-FINISHED-ALLOWED / 振动试验 / 实验已完成", time: "2026-06-05 12:00:00" },
          ],
        },
      ],
      stagingEvents: [],
    });

    expect(JSON.stringify(view)).not.toContain("TP-FINISHED-ALLOWED");
    expect(view.summary.allowedTrayCount).toBe(0);
    expect(view.summary.plannedTrayCount).toBe(0);
  });

  test("does not classify fully completed salt or mold final trays as planned staging", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "TASK-FINISHED-SALT", name: "盐雾最后完成", test_type: "冲击试验 / 盐雾试验" }],
      experiments: [
        { task_code: "TASK-FINISHED-SALT", experiment_code: "EXP-SHOCK", experiment_name: "冲击试验" },
        { task_code: "TASK-FINISHED-SALT", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-FINISHED-SALT", experiment_code: "EXP-SHOCK", tray_code: "TP-FINISHED-SALT" },
        { task_code: "TASK-FINISHED-SALT", experiment_code: "EXP-SALT", tray_code: "TP-FINISHED-SALT" },
      ],
      experimentRunTrays: [
        {
          task_code: "TASK-FINISHED-SALT",
          experiment_code: "EXP-SHOCK",
          tray_code: "TP-FINISHED-SALT",
          status: "实验已完成",
          ended_at: "2026-06-05 10:00:00",
        },
        {
          task_code: "TASK-FINISHED-SALT",
          experiment_code: "EXP-SALT",
          tray_code: "TP-FINISHED-SALT",
          status: "实验已完成",
          ended_at: "2026-06-05 12:00:00",
        },
      ],
      samples: [
        {
          code: "SP-FINISHED-SALT",
          task_code: "TASK-FINISHED-SALT",
          location: "盐雾试验室",
          status: "实验已完成",
          flow_status: "实验已完成",
          trays: [{ tray_code: "TP-FINISHED-SALT", status: "实验已完成", quantity: 1 }],
          history: [
            { detail: "TASK-FINISHED-SALT / 冲击试验 / 实验已完成", time: "2026-06-05 10:00:00" },
            { detail: "TASK-FINISHED-SALT / 盐雾试验 / 实验已完成", time: "2026-06-05 12:00:00" },
          ],
        },
      ],
      stagingEvents: [],
    });

    expect(JSON.stringify(view.tasks)).not.toContain("TP-FINISHED-SALT");
    expect(view.summary.allowedTrayCount).toBe(0);
    expect(view.summary.plannedTrayCount).toBe(0);
  });

  test("hides a fully completed neutral tray when no explicit staging dispatch exists", () => {
    const view = buildStagingSamplesView({
      tasks: [{ code: "SYLU-2026-06-022", name: "06-022任务", test_type: "冲击试验 / 霉菌试验 / 盐雾试验 / 振动试验" }],
      experiments: [
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-A", experiment_name: "冲击试验" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-B", experiment_name: "霉菌试验" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-C", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-D", experiment_name: "振动试验" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-A", tray_code: "SYLU-2026-06-022-TP-002" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-B", tray_code: "SYLU-2026-06-022-TP-002" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-C", tray_code: "SYLU-2026-06-022-TP-002" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-D", tray_code: "SYLU-2026-06-022-TP-002" },
      ],
      experimentRunTrays: [
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-A", tray_code: "SYLU-2026-06-022-TP-002", status: "实验已完成" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-B", tray_code: "SYLU-2026-06-022-TP-002", status: "实验已完成" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-C", tray_code: "SYLU-2026-06-022-TP-002", status: "实验已完成" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-D", tray_code: "SYLU-2026-06-022-TP-002", status: "实验已完成" },
      ],
      samples: [
        {
          code: "SP-007",
          task_code: "SYLU-2026-06-022",
          location: "振动一室",
          status: "实验已完成",
          flow_status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-06-022-TP-002", status: "实验已完成", quantity: 2 }],
        },
      ],
      stagingEvents: [
        {
          action: "stock_out",
          room: "appearance",
          target_lab: "振动一室",
          target_type: "lab",
          task_code: "SYLU-2026-06-022",
          time: "2026-06-11T15:11:42+08:00",
          tray_code: "SYLU-2026-06-022-TP-002",
        },
      ],
    });

    const tray = view.tasks
      .flatMap((task) => task.trays)
      .find((item) => item.trayCode === "SYLU-2026-06-022-TP-002");

    expect(tray).toBeUndefined();
    expect(view.summary.allowedTrayCount).toBe(0);
    expect(view.summary.plannedTrayCount).toBe(0);
  });

  test("does not infer planned staging from completed history when run-tray rows are missing", () => {
    const taskCode = "TASK-FINISHED-FALLBACK";
    const trayCode = "TP-FINISHED-FALLBACK";
    const view = buildStagingSamplesView({
      tasks: [{ code: taskCode, name: "缺少运行行的完成托盘", test_type: "盐雾试验" }],
      experiments: [
        { task_code: taskCode, experiment_code: "EXP-SALT-A", experiment_name: "盐雾试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: "EXP-SALT-A", tray_code: trayCode },
      ],
      samples: [
        {
          code: "SP-FINISHED-FALLBACK",
          task_code: taskCode,
          location: "振动一室",
          status: "实验已完成",
          flow_status: "实验已完成",
          trays: [{ tray_code: trayCode, status: "实验已完成", quantity: 1 }],
          history: [
            { detail: `${taskCode} / 盐雾试验 / 实验已完成`, status: "实验已完成", time: "2026-06-07T09:00:00+08:00" },
          ],
        },
      ],
      stagingEvents: [],
    });

    expect(JSON.stringify(view)).not.toContain(trayCode);
    expect(view.summary.plannedTrayCount).toBe(0);
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
    expect(view.summary.allowedTrayCount).toBe(0);
    expect(view.summary.usedSystemTrayCount).toBe(2);
    expect(view.summary.trayRemaining).toBe(8);
  });
});
