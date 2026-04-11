import { describe, expect, test } from "vitest";

import {
  applyLaboratoryTaskStep,
  buildLaboratorySummary,
  buildLaboratoryWorkflowFromTask,
  buildSaltSprayLaboratoryView,
  completeLaboratoryComparison,
  completeLaboratoryInstallation,
  confirmLaboratoryExperiment,
  createLaboratoryWorkflow,
  getLaboratoryActionState,
  validateLaboratoryTrayScan,
} from "./model";

const NOW = new Date("2026-04-02T10:00:00.000Z");
const toDisplayedTime = (value) => {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const toDisplayedDateTime = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${toDisplayedTime(value)}`;
};

describe("laboratory model", () => {
  test("buildSaltSprayLaboratoryView keeps only 盐雾试验室 schedules and prioritizes the active one", () => {
    const view = buildSaltSprayLaboratoryView({
      experiments: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", experiment_name: "振动试验" },
      ],
      now: NOW,
      samples: [
        {
          code: "SYLU-2026-04-101-SP-001",
          location: "盐雾试验室",
          owner: "王工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ quantity: 2, tray_code: "TP-001" }],
        },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-2",
          task_code: "SYLU-2026-04-201",
          experiment_code: "SYLU-2026-04-201-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T12:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
        {
          id: "schedule-3",
          task_code: "SYLU-2026-04-102",
          experiment_code: "SYLU-2026-04-102-A",
          device: "振动一室",
          start_at: "2026-04-02T09:00:00.000Z",
          end_at: "2026-04-02T10:00:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-04-101", name: "盐雾连接器", test_type: "盐雾试验" },
        { code: "SYLU-2026-04-201", name: "盐雾壳体", test_type: "盐雾试验" },
        { code: "SYLU-2026-04-102", name: "振动连接器", test_type: "振动试验" },
      ],
    });

    expect(view.labName).toBe("盐雾试验室");
    expect(view.scheduleRows).toHaveLength(2);
    expect(view.scheduleRows.map((row) => row.taskCode)).toEqual(["SYLU-2026-04-101", "SYLU-2026-04-201"]);
    expect(view.currentTask).toEqual(
      expect.objectContaining({
        taskCode: "SYLU-2026-04-101",
        experimentName: "盐雾试验",
        owner: "王工",
      }),
    );
  });

  test("buildLaboratorySummary counts today's salt-spray schedules and overdue undone tasks", () => {
    const summary = buildLaboratorySummary([
      { endAt: "2026-04-02T08:30:00.000Z", startAt: "2026-04-02T07:00:00.000Z", taskCode: "A" },
      { endAt: "2026-04-02T11:30:00.000Z", startAt: "2026-04-02T10:30:00.000Z", taskCode: "B" },
      { endAt: "2026-04-03T11:30:00.000Z", startAt: "2026-04-03T10:30:00.000Z", taskCode: "C" },
    ], NOW);

    expect(summary).toEqual({
      todayPendingCount: 2,
      todayUndoneCount: 1,
    });
  });

  test("workflow gating follows compare then install then confirm", () => {
    const initial = createLaboratoryWorkflow();
    const compared = completeLaboratoryComparison(initial);
    const installed = completeLaboratoryInstallation(compared);
    const confirmed = confirmLaboratoryExperiment(installed);

    expect(getLaboratoryActionState(initial)).toEqual({
      canCompare: true,
      canInstallSample: false,
      canMarkReady: false,
    });
    expect(getLaboratoryActionState(compared)).toEqual({
      canCompare: false,
      canInstallSample: true,
      canMarkReady: false,
    });
    expect(getLaboratoryActionState(installed)).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: true,
    });
    expect(confirmed.experimentConfirmed).toBe(true);
    expect(confirmed.comparisonDone).toBe(true);
    expect(confirmed.installationDone).toBe(true);
    expect(getLaboratoryActionState(confirmed)).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    });
  });

  test("buildSaltSprayLaboratoryView supports selecting a later scheduled task and exposes detailed tray rows", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", tray_code: "TP-101" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验-A" },
        { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", experiment_name: "盐雾试验-B" },
      ],
      now: NOW,
      samples: [
        { code: "SP-001", owner: "王工", task_code: "SYLU-2026-04-101", trays: [{ tray_code: "TP-001", quantity: 1 }] },
        { code: "SP-101", owner: "李工", task_code: "SYLU-2026-04-201", trays: [{ tray_code: "TP-101", quantity: 1 }] },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-2",
          task_code: "SYLU-2026-04-201",
          experiment_code: "SYLU-2026-04-201-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T12:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
      selectedTaskCode: "SYLU-2026-04-201",
      tasks: [
        { code: "SYLU-2026-04-101", name: "盐雾连接器-A", test_type: "盐雾试验" },
        { code: "SYLU-2026-04-201", name: "盐雾连接器-B", test_type: "盐雾试验" },
      ],
    });

    expect(view.currentTask).toEqual(
      expect.objectContaining({
        taskCode: "SYLU-2026-04-201",
        experimentName: "盐雾试验-B",
        trayCodes: ["TP-101"],
      }),
    );
    expect(view.scheduleRows[0]).toEqual(
      expect.objectContaining({
        endTimeLabel: toDisplayedTime("2026-04-02T11:00:00.000Z"),
        startTimeLabel: toDisplayedTime("2026-04-02T09:30:00.000Z"),
        trayRows: [expect.objectContaining({ trayCode: "TP-001" })],
      }),
    );
  });

  test("buildSaltSprayLaboratoryView keeps task flow scheduled until any tray truly starts the experiment", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", tray_code: "TP-HOT-1" },
        { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-B", tray_code: "TP-SALT-1" },
        { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-B", tray_code: "TP-SALT-2" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", experiment_name: "高低温湿热试验" },
        { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-B", experiment_name: "盐雾试验" },
      ],
      now: NOW,
      samples: [
        {
          code: "SP-HOT-1",
          location: "高低温湿热一室",
          owner: "赵工",
          status: "实验准备就绪",
          task_code: "SYLU-2026-04-401",
          trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-HOT-1" }],
        },
        {
          code: "SP-SALT-1",
          location: "接驳区",
          owner: "赵工",
          status: "到货",
          task_code: "SYLU-2026-04-401",
          trays: [{ quantity: 1, status: "到货", tray_code: "TP-SALT-1" }],
        },
        {
          code: "SP-SALT-2",
          location: "接驳区",
          owner: "赵工",
          status: "到货",
          task_code: "SYLU-2026-04-401",
          trays: [{ quantity: 1, status: "到货", tray_code: "TP-SALT-2" }],
        },
      ],
      schedules: [
        {
          id: "schedule-hot",
          task_code: "SYLU-2026-04-401",
          experiment_code: "SYLU-2026-04-401-A",
          device: "高低温湿热一室",
          start_at: "2026-04-02T07:00:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
        },
        {
          id: "schedule-salt",
          task_code: "SYLU-2026-04-401",
          experiment_code: "SYLU-2026-04-401-B",
          device: "盐雾试验室",
          start_at: "2026-04-02T11:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
      selectedTrayCode: "TP-SALT-2",
      tasks: [
        { code: "SYLU-2026-04-401", name: "复合任务", test_type: "高低温湿热试验 / 盐雾试验" },
      ],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      taskCode: "SYLU-2026-04-401",
      experimentName: "盐雾试验",
    }));
    expect(view.currentTaskFlow).toEqual(expect.objectContaining({
      currentStatus: "已排程",
    }));
    expect(view.currentExperimentTrayRows.map((row) => row.trayCode)).toEqual(["TP-SALT-1", "TP-SALT-2"]);
    expect(view.selectedTrayRow).toEqual(expect.objectContaining({ trayCode: "TP-SALT-2" }));
    expect(view.selectedTrayFlow.currentStatus).toContain("TP-SALT-2");
  });

  test("buildSaltSprayLaboratoryView compresses completed experiments for a shared tray across three experiments", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", tray_code: "TP-501" },
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-B", tray_code: "TP-501" },
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-C", tray_code: "TP-501" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", experiment_name: "A实验" },
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-B", experiment_name: "B实验" },
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-C", experiment_name: "C实验" },
      ],
      now: NOW,
      samples: [
        {
          code: "SP-501",
          location: "盐雾试验室",
          owner: "赵工",
          status: "实验准备就绪",
          task_code: "SYLU-2026-04-501",
          trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-501" }],
        },
      ],
      schedules: [
        {
          id: "schedule-501",
          task_code: "SYLU-2026-04-501",
          experiment_code: "SYLU-2026-04-501-B",
          device: "盐雾试验室",
          start_at: "2026-04-02T11:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
      selectedTrayCode: "TP-501",
      tasks: [
        { code: "SYLU-2026-04-501", name: "三实验任务", test_type: "A / B / C" },
      ],
    });

    expect(view.selectedTrayFlow.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "A实验已完成",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "B实验进行中",
      "C实验未完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
  });

  test("buildSaltSprayLaboratoryView exposes running experiment countdown data for the current salt spray task", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-601", experiment_code: "SYLU-2026-04-601-A", tray_code: "TP-601" },
        { task_code: "SYLU-2026-04-601", experiment_code: "SYLU-2026-04-601-A", tray_code: "TP-602" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-601", experiment_code: "SYLU-2026-04-601-A", experiment_name: "盐雾试验" },
      ],
      now: NOW,
      samples: [
        {
          code: "SP-601-1",
          location: "盐雾试验室",
          owner: "王工",
          status: "实验进行中",
          task_code: "SYLU-2026-04-601",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-601" }],
        },
        {
          code: "SP-601-2",
          location: "盐雾试验室",
          owner: "王工",
          status: "实验进行中",
          task_code: "SYLU-2026-04-601",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-602" }],
        },
      ],
      schedules: [
        {
          id: "schedule-601",
          task_code: "SYLU-2026-04-601",
          experiment_code: "SYLU-2026-04-601-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-04-601", name: "盐雾运行任务", test_type: "盐雾试验" }],
    });

    expect(view.runningExperiment).toEqual(
      expect.objectContaining({
        active: true,
        taskCode: "SYLU-2026-04-601",
        experimentName: "盐雾试验",
        trayCodes: ["TP-601", "TP-602"],
        sampleCodes: ["SP-601-1", "SP-601-2"],
        countdownLabel: "01:00:00",
        startDateTimeLabel: toDisplayedDateTime("2026-04-02T09:30:00.000Z"),
        endDateTimeLabel: toDisplayedDateTime("2026-04-02T11:00:00.000Z"),
      }),
    );
    expect(view.runningExperiment.remainingSeconds).toBe(3600);
    expect(view.runningExperiment.overdue).toBe(false);
  });

  test("validateLaboratoryTrayScan rejects trays from another scheduled task and returns guidance", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", tray_code: "TP-101" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验-A" },
        { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", experiment_name: "盐雾试验-B" },
      ],
      now: NOW,
      samples: [],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-2",
          task_code: "SYLU-2026-04-201",
          experiment_code: "SYLU-2026-04-201-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T12:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-04-101", name: "盐雾连接器-A", test_type: "盐雾试验" },
        { code: "SYLU-2026-04-201", name: "盐雾连接器-B", test_type: "盐雾试验" },
      ],
    });

    const mismatch = validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scanCode: "TP-101",
      scheduleRows: view.scheduleRows,
    });
    const match = validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scanCode: "TP-001",
      scheduleRows: view.scheduleRows,
    });

    expect(match).toEqual(expect.objectContaining({ ok: true, tone: "success" }));
    expect(mismatch).toEqual(
      expect.objectContaining({
        guidance: "当前任务并非优先所选任务。该托盘可前往：盐雾试验室",
        matchedRows: [expect.objectContaining({ device: "盐雾试验室", taskCode: "SYLU-2026-04-201" })],
        ok: false,
        tone: "error",
      }),
    );
  });

  test("validateLaboratoryTrayScan lists all allowed laboratories when a tray belongs to multiple experiments", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", tray_code: "TP-301" },
        { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-B", tray_code: "TP-301" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验-A" },
        { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", experiment_name: "高低温湿热试验" },
        { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-B", experiment_name: "盐雾试验" },
      ],
      now: NOW,
      samples: [
        { code: "SP-301", owner: "李工", task_code: "SYLU-2026-04-201", trays: [{ tray_code: "TP-301", quantity: 1 }] },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-2",
          task_code: "SYLU-2026-04-201",
          experiment_code: "SYLU-2026-04-201-A",
          device: "高低温湿热一室",
          start_at: "2026-04-02T12:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
        {
          id: "schedule-3",
          task_code: "SYLU-2026-04-201",
          experiment_code: "SYLU-2026-04-201-B",
          device: "盐雾试验室",
          start_at: "2026-04-02T13:30:00.000Z",
          end_at: "2026-04-02T15:00:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-04-101", name: "当前任务", test_type: "盐雾试验" },
        { code: "SYLU-2026-04-201", name: "复合任务", test_type: "高低温湿热试验 / 盐雾试验" },
      ],
    });

    const mismatch = validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-301",
      scheduleRows: view.scheduleRows,
    });

    expect(mismatch).toEqual(
      expect.objectContaining({
        guidance: "当前任务并非优先所选任务。该托盘可前往：高低温湿热一室、盐雾试验室",
        ok: false,
        tone: "error",
      }),
    );
  });

  test("buildSaltSprayLaboratoryView exposes full datetime labels for recent task cards", () => {
    const view = buildSaltSprayLaboratoryView({
      experiments: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验-A" },
      ],
      now: NOW,
      samples: [],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-04-101", name: "盐雾连接器", test_type: "盐雾试验" },
      ],
    });

    expect(view.scheduleRows[0]).toEqual(
      expect.objectContaining({
        dateTimeRange: `${toDisplayedDateTime("2026-04-02T09:30:00.000Z")} - ${toDisplayedDateTime("2026-04-02T11:00:00.000Z")}`,
        endDateTimeLabel: toDisplayedDateTime("2026-04-02T11:00:00.000Z"),
        startDateTimeLabel: toDisplayedDateTime("2026-04-02T09:30:00.000Z"),
      }),
    );
  });

  test("buildLaboratoryWorkflowFromTask derives persisted progress from tray statuses", () => {
    expect(buildLaboratoryWorkflowFromTask({
      trayRows: [{ trayCode: "TP-001", trayStatus: "已到达实验室" }],
    })).toEqual({
      comparisonDone: true,
      experimentConfirmed: false,
      hasCompared: true,
      hasInstalled: false,
      installationDone: false,
    });

    expect(buildLaboratoryWorkflowFromTask({
      trayRows: [{ trayCode: "TP-001", trayStatus: "工装夹具安装" }],
    })).toEqual({
      comparisonDone: true,
      experimentConfirmed: false,
      hasCompared: true,
      hasInstalled: true,
      installationDone: true,
    });

    expect(buildLaboratoryWorkflowFromTask({
      trayRows: [{ trayCode: "TP-001", trayStatus: "实验准备就绪" }],
    })).toEqual({
      comparisonDone: true,
      experimentConfirmed: true,
      hasCompared: true,
      hasInstalled: true,
      installationDone: true,
    });
  });

  test("buildLaboratoryWorkflowFromTask keeps compare available while another tray is still waiting to be compared", () => {
    const workflow = buildLaboratoryWorkflowFromTask({
      trayRows: [
        { trayCode: "TP-001", trayStatus: "已到达实验室" },
        { trayCode: "TP-002", trayStatus: "送至实验室" },
      ],
    });

    expect(workflow).toEqual({
      comparisonDone: false,
      experimentConfirmed: false,
      hasCompared: true,
      hasInstalled: false,
      installationDone: false,
    });
    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: true,
      canInstallSample: true,
      canMarkReady: false,
    });
  });

  test("applyLaboratoryTaskStep only updates the targeted trays for the current task", () => {
    const updatedSamples = applyLaboratoryTaskStep({
      currentTask: {
        device: "盐雾试验室",
        experimentName: "盐雾试验-A",
        taskCode: "SYLU-2026-04-101",
        trayCodes: ["TP-001", "TP-002"],
      },
      historyAction: "实验确认",
      nextStatus: "实验准备就绪",
      now: "2026-04-02T10:30:00.000Z",
      targetTrayCodes: ["TP-001"],
      samples: [
        {
          code: "SYLU-2026-04-101-SP-001",
          flow_status: "已到达实验室",
          history: [],
          location: "盐雾试验室",
          owner: "王工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-001" }],
        },
        {
          code: "SYLU-2026-04-101-SP-002",
          flow_status: "到货",
          history: [],
          location: "接驳区",
          owner: "王工",
          status: "到货",
          task_code: "SYLU-2026-04-101",
          trays: [{ quantity: 1, status: "到货", tray_code: "TP-002" }],
        },
        {
          code: "SYLU-2026-04-201-SP-001",
          flow_status: "已到达实验室",
          history: [],
          location: "振动一室",
          owner: "李工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-201",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-101" }],
        },
      ],
    });

    expect(updatedSamples[0]).toEqual(expect.objectContaining({
      flow_status: "实验准备就绪",
      location: "盐雾试验室",
      status: "实验准备就绪",
      trays: [expect.objectContaining({ status: "实验准备就绪", tray_code: "TP-001" })],
    }));
    expect(updatedSamples[0].history[0]).toEqual(expect.objectContaining({
      action: "实验确认",
      detail: "SYLU-2026-04-101 / 盐雾试验-A / 实验准备就绪",
      status: "实验准备就绪",
    }));
    expect(updatedSamples[1]).toEqual(expect.objectContaining({
      flow_status: "到货",
      location: "接驳区",
      status: "到货",
      trays: [expect.objectContaining({ status: "到货", tray_code: "TP-002" })],
    }));
    expect(updatedSamples[2].status).toBe("已到达实验室");
    expect(updatedSamples[2].trays[0].status).toBe("已到达实验室");
  });
});
