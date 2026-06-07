import { describe, expect, test } from "vitest";

import {
  applyLaboratoryTaskStep,
  buildLaboratoryWorkbenchView,
  buildLaboratorySummary,
  buildLaboratoryProgressMessage,
  buildLaboratoryWorkflowFromTask,
  buildSaltSprayLaboratoryView,
  completeLaboratoryComparison,
  completeLaboratoryInstallation,
  confirmLaboratoryExperiment,
  createLaboratoryWorkflow,
  getLaboratoryActionState,
  getLaboratoryOperationLock,
  revertLaboratoryTaskToPreviousStableState,
  revertLaboratoryTaskToPreDispatch,
  resetLaboratoryExperimentTrays,
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
  test("buildLaboratoryWorkbenchView filters non-salt laboratories by schedule device", () => {
    const view = buildLaboratoryWorkbenchView({
      experiments: [
        { task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", experiment_name: "振动试验" },
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验" },
      ],
      labName: "振动一室",
      now: NOW,
      samples: [
        {
          code: "SYLU-2026-04-102-SP-001",
          location: "振动一室",
          owner: "周工",
          status: "送至实验室",
          task_code: "SYLU-2026-04-102",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-ZD-001" }],
        },
      ],
      schedules: [
        {
          id: "schedule-vibration",
          task_code: "SYLU-2026-04-102",
          experiment_code: "SYLU-2026-04-102-A",
          device: "振动一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-salt",
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-04-102", name: "振动连接器", test_type: "振动试验" },
        { code: "SYLU-2026-04-101", name: "盐雾连接器", test_type: "盐雾试验" },
      ],
    });

    expect(view.labName).toBe("振动一室");
    expect(view.scheduleRows.map((row) => row.taskCode)).toEqual(["SYLU-2026-04-102"]);
    expect(view.allScheduleRows.map((row) => row.device)).toEqual(["振动一室", "盐雾试验室"]);
    expect(view.currentTask).toEqual(expect.objectContaining({
      taskCode: "SYLU-2026-04-102",
      experimentName: "振动试验",
      owner: "周工",
    }));
  });

  test("buildLaboratoryProgressMessage uses the selected lab name when no task exists", () => {
    expect(buildLaboratoryProgressMessage(createLaboratoryWorkflow(), null, "冲击一室")).toBe("当前冲击一室暂无排程");
  });

  test("buildLaboratoryWorkbenchView matches schedules by lab code before display device text", () => {
    const view = buildLaboratoryWorkbenchView({
      experiments: [
        { task_code: "TASK-SALT", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" },
      ],
      labCode: "LAB_SALT",
      labName: "盐雾试验室",
      now: NOW,
      samples: [
        {
          code: "SP-SALT-001",
          location: "盐雾试验室",
          owner: "周工",
          status: "送至实验室",
          task_code: "TASK-SALT",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-SALT-001" }],
        },
      ],
      schedules: [
        {
          id: "schedule-salt",
          task_code: "TASK-SALT",
          experiment_code: "EXP-SALT",
          device: "Salt Spray Lab",
          lab_code: "LAB_SALT",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      tasks: [{ code: "TASK-SALT", name: "盐雾连接器", test_type: "盐雾试验" }],
    });

    expect(view.scheduleRows.map((row) => row.taskCode)).toEqual(["TASK-SALT"]);
    expect(view.currentTask).toEqual(expect.objectContaining({ taskCode: "TASK-SALT" }));
  });

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

  test("buildSaltSprayLaboratoryView removes completed experiments from the task list before their planned end time", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-05-005", experiment_code: "SYLU-2026-05-005-A", tray_code: "SYLU-2026-05-005-TP-001" },
        { task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-A", tray_code: "SYLU-2026-05-006-TP-001" },
      ],
      experiments: [
        { task_code: "SYLU-2026-05-005", experiment_code: "SYLU-2026-05-005-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-A", experiment_name: "盐雾试验" },
      ],
      now: new Date("2026-05-05T09:00:00.000Z"),
      samples: [
        {
          code: "SYLU-2026-05-005-SP-001",
          task_code: "SYLU-2026-05-005",
          status: "实验已完成",
          trays: [{ quantity: 1, status: "实验已完成", tray_code: "SYLU-2026-05-005-TP-001" }],
        },
        {
          code: "SYLU-2026-05-006-SP-001",
          task_code: "SYLU-2026-05-006",
          status: "实验准备就绪",
          trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "SYLU-2026-05-006-TP-001" }],
        },
      ],
      schedules: [
        {
          id: "schedule-005",
          task_code: "SYLU-2026-05-005",
          experiment_code: "SYLU-2026-05-005-A",
          device: "盐雾试验室",
          start_at: "2026-05-05T08:00:00.000Z",
          end_at: "2026-05-05T12:00:00.000Z",
        },
        {
          id: "schedule-006",
          task_code: "SYLU-2026-05-006",
          experiment_code: "SYLU-2026-05-006-A",
          device: "盐雾试验室",
          start_at: "2026-05-05T09:30:00.000Z",
          end_at: "2026-05-05T12:30:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-05-005", name: "盐雾已完成", test_type: "盐雾试验" },
        { code: "SYLU-2026-05-006", name: "盐雾待执行", test_type: "盐雾试验" },
      ],
    });

    expect(view.scheduleRows.map((row) => row.taskCode)).toEqual(["SYLU-2026-05-006"]);
    expect(view.currentTask).toEqual(expect.objectContaining({ taskCode: "SYLU-2026-05-006" }));
  });

  test("buildLaboratoryWorkbenchView treats manufacturer-returned run trays as terminal for the current experiment", () => {
    const taskCode = "SYLU-2026-06-021";
    const experimentCode = `${taskCode}-A`;
    const view = buildLaboratoryWorkbenchView({
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
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "温度冲击试验" },
      ],
      labName: "温度冲击一室",
      now: NOW,
      samples: [],
      schedules: [
        {
          id: "schedule-returned",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "温度冲击一室",
          start_at: "2026-06-06T12:00:00+08:00",
          end_at: "2026-06-06T15:00:00+08:00",
        },
      ],
      tasks: [{ code: taskCode, name: "厂家回收任务", test_type: "温度冲击试验" }],
    });

    expect(view.scheduleRows).toEqual([]);
    expect(view.currentTask).toBeNull();
  });

  test("buildLaboratoryWorkbenchView removes manufacturer-returned trays from an unfinished laboratory experiment", () => {
    const taskCode = "SYLU-2026-06-022";
    const experimentCode = `${taskCode}-A`;
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: `${taskCode}-TP-001`,
          run_tray_status: "厂家收回",
          updated_at: "2026-06-06T12:13:02+08:00",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: `${taskCode}-TP-001` },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: `${taskCode}-TP-002` },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "冲击试验" },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: `${taskCode}-TP-001`, status: "厂家收回", quantity: 1 }],
        },
        {
          code: `${taskCode}-SP-002`,
          task_code: taskCode,
          location: "冲击一室",
          status: "已到达实验室",
          trays: [{ tray_code: `${taskCode}-TP-002`, status: "已到达实验室", quantity: 1 }],
        },
      ],
      schedules: [
        {
          id: "schedule-partial-returned",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击一室",
          start_at: "2026-06-06T12:00:00+08:00",
          end_at: "2026-06-06T15:00:00+08:00",
        },
      ],
      tasks: [{ code: taskCode, name: "部分回收任务", test_type: "冲击试验" }],
    });

    expect(view.currentTask?.trayCodes).toEqual([`${taskCode}-TP-002`]);
    expect(view.currentExperimentTrayRows.map((row) => row.trayCode)).toEqual([`${taskCode}-TP-002`]);
    expect(validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scheduleRows: view.scheduleRows,
      allScheduleRows: view.allScheduleRows,
      scanCode: `${taskCode}-TP-001`,
    })).toEqual(expect.objectContaining({
      ok: false,
      message: "未匹配到任务",
    }));
  });

  test("buildLaboratoryWorkbenchView removes sample-only returned trays from an unfinished laboratory experiment", () => {
    const taskCode = "SYLU-2026-06-023";
    const experimentCode = `${taskCode}-A`;
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: `${taskCode}-TP-001` },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: `${taskCode}-TP-002` },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "霉菌试验" },
      ],
      labName: "霉菌试验室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: `${taskCode}-TP-001`, status: "厂家收回", quantity: 1 }],
        },
        {
          code: `${taskCode}-SP-002`,
          task_code: taskCode,
          location: "霉菌试验室",
          status: "已到达实验室",
          trays: [{ tray_code: `${taskCode}-TP-002`, status: "已到达实验室", quantity: 1 }],
        },
      ],
      schedules: [
        {
          id: "schedule-sample-only-returned",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "霉菌试验室",
          start_at: "2026-06-06T12:00:00+08:00",
          end_at: "2026-06-06T15:00:00+08:00",
        },
      ],
      tasks: [{ code: taskCode, name: "旧快照部分回收任务", test_type: "霉菌试验" }],
    });

    expect(view.currentTask?.trayCodes).toEqual([`${taskCode}-TP-002`]);
    expect(view.currentExperimentTrayRows.map((row) => row.trayCode)).toEqual([`${taskCode}-TP-002`]);
    expect(validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scheduleRows: view.scheduleRows,
      allScheduleRows: view.allScheduleRows,
      scanCode: `${taskCode}-TP-001`,
    })).toEqual(expect.objectContaining({
      ok: false,
      message: "未匹配到任务",
    }));
  });

  test("buildLaboratoryWorkbenchView keeps scoped trays visible when only experiment global status is completed", () => {
    const taskCode = "TASK-GLOBAL-LAB";
    const experimentCode = "EXP-IMPACT";
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: "TP-001" },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "冲击试验", status: "实验已完成" },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          task_code: taskCode,
          status: "已到达实验室",
          trays: [{ tray_code: "TP-001", status: "已到达实验室", quantity: 1 }],
        },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击一室",
          start_at: "2026-04-02T09:00:00.000Z",
          end_at: "2026-04-02T12:00:00.000Z",
        },
      ],
      tasks: [{ code: taskCode, name: "全局状态污染任务", test_type: "冲击试验" }],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      experimentCode,
      taskCode,
      trayCodes: ["TP-001"],
    }));
  });

  test("buildLaboratoryWorkbenchView does not remove every tray from sample-level returned status", () => {
    const taskCode = "TASK-MULTI-RETURN";
    const experimentCode = "EXP-MOLD";
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: "TP-001" },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: "TP-002" },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "霉菌试验" },
      ],
      labName: "霉菌试验室",
      now: NOW,
      samples: [
        {
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [
            { tray_code: "TP-001", status: "厂家收回", quantity: 1 },
            { tray_code: "TP-002", status: "已到达实验室", quantity: 1 },
          ],
        },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "霉菌试验室",
          start_at: "2026-04-02T09:00:00.000Z",
          end_at: "2026-04-02T12:00:00.000Z",
        },
      ],
      tasks: [{ code: taskCode, name: "多托盘样品回收污染", test_type: "霉菌试验" }],
    });

    expect(view.currentExperimentTrayRows.map((row) => row.trayCode)).toEqual(["TP-002"]);
  });

  test("buildLaboratoryWorkbenchView does not apply unscoped completion history to every tray", () => {
    const taskCode = "TASK-HISTORY-COMPLETE";
    const experimentCode = "EXP-MOLD";
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: "TP-001" },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: "TP-002" },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "霉菌试验" },
      ],
      labName: "霉菌试验室",
      now: NOW,
      samples: [
        {
          task_code: taskCode,
          location: "霉菌试验室",
          status: "实验准备就绪",
          trays: [
            { tray_code: "TP-001", status: "实验已完成", quantity: 1 },
            { tray_code: "TP-002", status: "实验准备就绪", quantity: 1 },
          ],
          history: [
            { detail: `${taskCode} / 霉菌试验 / 实验已完成`, status: "实验已完成", time: "2026-06-06T12:13:02+08:00" },
          ],
        },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "霉菌试验室",
          start_at: "2026-04-02T09:00:00.000Z",
          end_at: "2026-04-02T12:00:00.000Z",
        },
      ],
      tasks: [{ code: taskCode, name: "完成历史污染", test_type: "霉菌试验" }],
    });

    expect(view.currentExperimentTrayRows.map((row) => [row.trayCode, row.trayStatus])).toContainEqual(["TP-002", "实验准备就绪"]);
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

  test("buildSaltSprayLaboratoryView keeps tray flow at the initial state when the lab has no task", () => {
    const view = buildSaltSprayLaboratoryView({
      experiments: [],
      now: NOW,
      samples: [
        {
          code: "SP-001",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ tray_code: "TP-001", quantity: 1, status: "送至实验室" }],
        },
      ],
      schedules: [],
      tasks: [],
    });

    expect(view.currentTask).toBeNull();
    expect(view.selectedTrayRow).toBeNull();
    expect(view.currentTaskFlow.currentStatus).toBe("待排程");
    expect(view.selectedTrayFlow.currentStatus).toBe("当前状态：样品运输中");
    expect(view.selectedTrayFlow.steps[0]).toEqual(expect.objectContaining({
      active: true,
      label: "样品运输中",
      reached: false,
    }));
    expect(view.selectedTrayFlow.steps[5]).toEqual(expect.objectContaining({
      active: false,
      label: "已到达实验室",
      reached: false,
    }));
  });

  test("workflow gating waits for host fixture ready before confirm", () => {
    const initial = createLaboratoryWorkflow();
    const compared = completeLaboratoryComparison(initial);
    const installed = completeLaboratoryInstallation(compared);
    const fixtureReady = { ...installed, fixtureReadyDone: true };
    const confirmed = confirmLaboratoryExperiment(fixtureReady);

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
      canMarkReady: false,
    });
    expect(getLaboratoryActionState(fixtureReady)).toEqual({
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

  test("installed tray rows require fixtureReady before ready action unlocks", () => {
    const waiting = buildLaboratoryWorkflowFromTask({
      trayRows: [{ fixtureReady: false, trayCode: "TP-001", trayStatus: "工装夹具安装" }],
    });
    const ready = buildLaboratoryWorkflowFromTask({
      trayRows: [{ fixtureReady: true, trayCode: "TP-001", trayStatus: "工装夹具安装" }],
    });

    expect(getLaboratoryActionState(waiting).canMarkReady).toBe(false);
    expect(getLaboratoryActionState(ready).canMarkReady).toBe(true);
    expect(buildLaboratoryProgressMessage(waiting, { taskCode: "SYLU-2026-04-101" })).toBe("当前任务已完成夹具安装，等待上位机确认夹具安装完成");
    expect(buildLaboratoryProgressMessage(ready, { taskCode: "SYLU-2026-04-101" })).toBe("夹具安装完成，可确认实验准备就绪");
  });

  test("operation lock blocks another task while a lab task is past comparison and before reset", () => {
    const lockedRow = {
      experimentKey: "SYLU-2026-04-101::SYLU-2026-04-101-A",
      experimentName: "盐雾试验-A",
      taskCode: "SYLU-2026-04-101",
      trayRows: [{ trayCode: "TP-001", trayStatus: "已到达实验室" }],
    };
    const otherRow = {
      experimentKey: "SYLU-2026-04-201::SYLU-2026-04-201-A",
      experimentName: "盐雾试验-B",
      taskCode: "SYLU-2026-04-201",
      trayRows: [{ trayCode: "TP-101", trayStatus: "送至实验室" }],
    };

    expect(getLaboratoryOperationLock([lockedRow, otherRow], otherRow)).toEqual(expect.objectContaining({
      active: true,
      experimentKey: "SYLU-2026-04-101::SYLU-2026-04-101-A",
      taskCode: "SYLU-2026-04-101",
    }));
    expect(getLaboratoryOperationLock([lockedRow, otherRow], lockedRow)).toEqual({ active: false });
    expect(getLaboratoryOperationLock([{ ...lockedRow, trayRows: [{ trayCode: "TP-001", trayStatus: "送至实验室" }] }, otherRow], otherRow)).toEqual({ active: false });
  });

  test("defaults to the prepared task, otherwise the earliest scheduled task", () => {
    const baseInput = {
      experimentTrays: [
        { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", tray_code: "TP-401" },
        { task_code: "SYLU-2026-04-402", experiment_code: "SYLU-2026-04-402-A", tray_code: "TP-402" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", experiment_name: "盐雾试验-A" },
        { task_code: "SYLU-2026-04-402", experiment_code: "SYLU-2026-04-402-A", experiment_name: "盐雾试验-B" },
      ],
      labName: "盐雾试验室",
      now: new Date("2026-04-02T12:30:00.000Z"),
      schedules: [
        {
          id: "schedule-401",
          task_code: "SYLU-2026-04-401",
          experiment_code: "SYLU-2026-04-401-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-402",
          task_code: "SYLU-2026-04-402",
          experiment_code: "SYLU-2026-04-402-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T12:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-04-401", name: "早排程任务", test_type: "盐雾试验-A" },
        { code: "SYLU-2026-04-402", name: "晚排程任务", test_type: "盐雾试验-B" },
      ],
    };

    expect(buildSaltSprayLaboratoryView({
      ...baseInput,
      samples: [
        {
          code: "SP-401",
          status: "送至实验室",
          task_code: "SYLU-2026-04-401",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-401" }],
        },
        {
          code: "SP-402",
          status: "送至实验室",
          task_code: "SYLU-2026-04-402",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-402" }],
        },
      ],
    }).currentTask.taskCode).toBe("SYLU-2026-04-401");

    expect(buildSaltSprayLaboratoryView({
      ...baseInput,
      samples: [
        {
          code: "SP-401",
          status: "送至实验室",
          task_code: "SYLU-2026-04-401",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-401" }],
        },
        {
          code: "SP-402",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-402",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-402" }],
        },
      ],
    }).currentTask.taskCode).toBe("SYLU-2026-04-402");
  });

  test("buildSaltSprayLaboratoryView unlocks ready when loaded tray has fixture_ready", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-002" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验-A" },
      ],
      now: NOW,
      samples: [
        {
          code: "SYLU-2026-04-101-SP-001",
          location: "盐雾试验室",
          status: "工装夹具安装",
          task_code: "SYLU-2026-04-101",
          trays: [{ quantity: 1, status: "工装夹具安装", tray_code: "TP-001", fixture_ready: true }],
        },
        {
          code: "SYLU-2026-04-101-SP-002",
          location: "盐雾试验室",
          status: "送至实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-002" }],
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-04-101", name: "盐雾连接器", test_type: "盐雾试验" }],
    });

    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(view.currentTask)).canMarkReady).toBe(true);
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

  test("buildSaltSprayLaboratoryView selects a specific experiment when one task has multiple salt spray schedules", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", tray_code: "TP-A" },
        { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", tray_code: "TP-B" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", experiment_name: "盐雾试验-A" },
        { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", experiment_name: "盐雾试验-B" },
      ],
      now: NOW,
      samples: [
        {
          code: "SP-A",
          task_code: "SYLU-2026-04-301",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-A" }],
        },
        {
          code: "SP-B",
          task_code: "SYLU-2026-04-301",
          trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-B" }],
        },
      ],
      schedules: [
        {
          id: "schedule-a",
          task_code: "SYLU-2026-04-301",
          experiment_code: "SYLU-2026-04-301-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-b",
          task_code: "SYLU-2026-04-301",
          experiment_code: "SYLU-2026-04-301-B",
          device: "盐雾试验室",
          start_at: "2026-04-02T12:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
      selectedTaskCode: "SYLU-2026-04-301::SYLU-2026-04-301-B",
      tasks: [{ code: "SYLU-2026-04-301", name: "同任务多盐雾", test_type: "盐雾试验-A / 盐雾试验-B" }],
    });

    expect(view.currentTask).toEqual(
      expect.objectContaining({
        experimentCode: "SYLU-2026-04-301-B",
        experimentName: "盐雾试验-B",
        taskCode: "SYLU-2026-04-301",
        trayCodes: ["TP-B"],
      }),
    );
    expect(view.selectedTrayRow).toEqual(expect.objectContaining({ trayCode: "TP-B" }));
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

  test("buildSaltSprayLaboratoryView compresses completed experiments for a shared tray across three experiments when completion history exists", () => {
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
          history: [
            {
              time: "2026-04-02T10:30:00.000Z",
              detail: "SYLU-2026-04-501 / A实验 / 实验已完成",
            },
          ],
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
      "送至盐雾试验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "B实验进行中",
      "C实验未完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
  });

  test("buildLaboratoryWorkbenchView keeps a shared tray's next laboratory task scheduled after the previous experiment completed", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-701", experiment_code: "SYLU-2026-04-701-A", tray_code: "TP-SHARED-701" },
        { task_code: "SYLU-2026-04-701", experiment_code: "SYLU-2026-04-701-B", tray_code: "TP-SHARED-701" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-701", experiment_code: "SYLU-2026-04-701-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-04-701", experiment_code: "SYLU-2026-04-701-B", experiment_name: "冲击试验" },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: "SP-701",
          location: "盐雾试验室",
          owner: "赵工",
          status: "实验已完成",
          task_code: "SYLU-2026-04-701",
          trays: [{ quantity: 1, status: "实验已完成", tray_code: "TP-SHARED-701" }],
        },
      ],
      schedules: [
        {
          id: "schedule-701-impact",
          task_code: "SYLU-2026-04-701",
          experiment_code: "SYLU-2026-04-701-B",
          device: "冲击一室",
          start_at: "2026-04-02T11:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-04-701", name: "共享托盘任务", test_type: "盐雾试验 / 冲击试验" },
      ],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      experimentName: "冲击试验",
      taskCode: "SYLU-2026-04-701",
    }));
    expect(view.currentTaskFlow.currentStatus).toBe("已排程");
  });

  test("buildLaboratoryWorkbenchView keeps a shared tray's next task until that experiment code is completed", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-702", experiment_code: "SYLU-2026-04-702-A", tray_code: "TP-SHARED-702" },
        { task_code: "SYLU-2026-04-702", experiment_code: "SYLU-2026-04-702-B", tray_code: "TP-SHARED-702" },
      ],
      experiments: [
        {
          experiment_code: "SYLU-2026-04-702-A",
          experiment_name: "高低温湿热试验-A",
          status: "实验已完成",
          task_code: "SYLU-2026-04-702",
        },
        {
          experiment_code: "SYLU-2026-04-702-B",
          experiment_name: "高低温湿热试验-B",
          status: "已排程",
          task_code: "SYLU-2026-04-702",
        },
      ],
      labName: "高低温湿热二室",
      now: NOW,
      samples: [
        {
          code: "SP-702",
          history: [
            {
              detail: "SYLU-2026-04-702 / 高低温湿热试验-A / 实验已完成",
              time: "2026-04-02T10:30:00.000Z",
            },
          ],
          location: "高低温湿热一室",
          owner: "赵工",
          status: "实验已完成",
          task_code: "SYLU-2026-04-702",
          trays: [{ quantity: 1, status: "实验已完成", tray_code: "TP-SHARED-702" }],
        },
      ],
      schedules: [
        {
          id: "schedule-702-thermal-b",
          task_code: "SYLU-2026-04-702",
          experiment_code: "SYLU-2026-04-702-B",
          device: "高低温湿热二室",
          start_at: "2026-04-02T11:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-04-702", name: "共享托盘连续实验任务", test_type: "高低温湿热试验-A / 高低温湿热试验-B" },
      ],
    });

    expect(view.scheduleRows).toHaveLength(1);
    expect(view.currentTask).toEqual(expect.objectContaining({
      experimentCode: "SYLU-2026-04-702-B",
      taskCode: "SYLU-2026-04-702",
    }));
    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(view.currentTask))).toEqual({
      canCompare: true,
      canInstallSample: false,
      canMarkReady: false,
    });
  });

  test("buildLaboratoryWorkbenchView hides returned shared-tray experiment schedules", () => {
    const taskCode = "SYLU-2026-06-021";
    const baseInput = {
      experimentRunTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: `${taskCode}-TP-001`, run_tray_status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: `${taskCode}-TP-002`, run_tray_status: "实验已完成" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: `${taskCode}-TP-001` },
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: `${taskCode}-TP-003` },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: `${taskCode}-TP-002` },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: `${taskCode}-TP-004` },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", status: "实验进行中" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", status: "实验进行中" },
      ],
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "厂家收回",
          status: "厂家收回",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "厂家收回", tray_code: `${taskCode}-TP-001` }],
        },
        {
          code: `${taskCode}-SP-002`,
          location: "厂家收回",
          status: "厂家收回",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "厂家收回", tray_code: `${taskCode}-TP-002` }],
        },
        {
          code: `${taskCode}-SP-003`,
          location: "厂家收回",
          status: "厂家收回",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "厂家收回", tray_code: `${taskCode}-TP-003` }],
        },
        {
          code: `${taskCode}-SP-004`,
          location: "厂家收回",
          status: "厂家收回",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "厂家收回", tray_code: `${taskCode}-TP-004` }],
        },
      ],
      schedules: [
        {
          id: "schedule-021-a",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          device: "冲击二室",
          start_at: "2026-06-05T08:00:00.000Z",
          end_at: "2026-06-05T12:00:00.000Z",
        },
        {
          id: "schedule-021-b",
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          device: "温度冲击二室",
          start_at: "2026-06-05T13:00:00.000Z",
          end_at: "2026-06-05T17:00:00.000Z",
        },
      ],
      tasks: [
        { code: taskCode, name: "厂家回收任务", test_type: "冲击试验 / 温度冲击试验" },
      ],
    };

    expect(buildLaboratoryWorkbenchView({ ...baseInput, labName: "冲击二室" }).currentTask).toBeNull();
    expect(buildLaboratoryWorkbenchView({ ...baseInput, labName: "温度冲击二室" }).currentTask).toBeNull();
  });

  test("buildLaboratoryWorkbenchView keeps an unsampled scheduled tray at the initial flow state", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-801", experiment_code: "SYLU-2026-04-801-A", tray_code: "TP-UNARRIVED-801" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-801", experiment_code: "SYLU-2026-04-801-A", experiment_name: "盐雾试验" },
      ],
      labName: "盐雾试验室",
      now: NOW,
      samples: [],
      schedules: [
        {
          id: "schedule-801-salt",
          task_code: "SYLU-2026-04-801",
          experiment_code: "SYLU-2026-04-801-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T11:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-04-801", name: "未到货排程任务", test_type: "盐雾试验" },
      ],
    });

    expect(view.currentTaskFlow.currentStatus).toBe("已排程");
    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：TP-UNARRIVED-801 | 当前状态：样品运输中");
    expect(view.selectedTrayFlow.steps.find((step) => step.key === "in_transit")).toEqual(expect.objectContaining({
      active: true,
      reached: false,
    }));
    expect(view.selectedTrayFlow.steps.find((step) => step.key === "arrived_lab")).toEqual(expect.objectContaining({
      active: false,
      reached: false,
    }));
  });

  test("buildLaboratoryWorkbenchView uses the unified tray lifecycle after a lab reset restores a tray to staging", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-A", tray_code: "SYLU-2026-05-001-TP-003" },
      ],
      experiments: [
        { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-A", experiment_name: "盐雾试验" },
      ],
      labName: "盐雾试验室",
      now: NOW,
      samples: [
        {
          code: "SYLU-2026-05-001-SP-003",
          flow_status: "已到达暂存间",
          history: [
            { action: "任务切换撤回", detail: "SYLU-2026-05-001 / 盐雾试验 / 撤回至已到达暂存间", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-05-19T10:50:00.000Z" },
            { action: "任务比对", location: "盐雾试验室", status: "已到达实验室", time: "2026-05-19T10:40:00.000Z" },
            { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-05-19T10:20:00.000Z" },
            { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-05-19T09:50:00.000Z" },
            { action: "送至暂存间", location: "恒温恒湿间（暂存间）", status: "送至暂存间", time: "2026-05-19T09:30:00.000Z" },
            { action: "任务样品入库", location: "接驳区", status: "到货", time: "2026-05-19T09:00:00.000Z" },
          ],
          location: "恒温恒湿间（暂存间）",
          owner: "赵工",
          status: "已到达暂存间",
          task_code: "SYLU-2026-05-001",
          trays: [{ quantity: 1, status: "已到达暂存间", tray_code: "SYLU-2026-05-001-TP-003" }],
        },
      ],
      schedules: [
        {
          id: "schedule-202605001-salt",
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-A",
          device: "盐雾试验室",
          start_at: "2026-05-19T10:00:00.000Z",
          end_at: "2026-05-19T12:00:00.000Z",
        },
      ],
      selectedTrayCode: "SYLU-2026-05-001-TP-003",
      tasks: [
        { code: "SYLU-2026-05-001", name: "重置回暂存间任务", test_type: "盐雾试验" },
      ],
    });

    expect(view.selectedTrayFlow.currentStatus).toBe(
      "当前托盘：SYLU-2026-05-001-TP-003 | 当前状态：已到达暂存间",
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至暂存间")).toEqual(expect.objectContaining({
      reached: true,
    }));
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "已到达暂存间")).toEqual(expect.objectContaining({
      active: true,
      reached: false,
    }));
    expect(view.selectedTrayFlow.steps.find((step) => step.key === "sent_to_lab")).toEqual(expect.objectContaining({
      active: false,
      label: "送至盐雾试验室",
      reached: false,
    }));
  });

  test("buildLaboratoryWorkbenchView keeps tray flow based on tray status when sample status is ahead", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-502", experiment_code: "SYLU-2026-04-502-A", tray_code: "TP-LAG" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-502", experiment_code: "SYLU-2026-04-502-A", experiment_name: "温度冲击试验" },
      ],
      labName: "温度冲击一室",
      now: NOW,
      samples: [
        {
          code: "SYLU-2026-04-502-SP-001",
          flow_status: "已到达实验室",
          location: "温度冲击一室",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-502",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-LAG" }],
        },
      ],
      schedules: [
        {
          id: "schedule-202604502-temp",
          task_code: "SYLU-2026-04-502",
          experiment_code: "SYLU-2026-04-502-A",
          device: "温度冲击一室",
          start_at: "2026-04-02T10:00:00.000Z",
          end_at: "2026-04-02T12:00:00.000Z",
        },
      ],
      selectedTrayCode: "TP-LAG",
      tasks: [
        { code: "SYLU-2026-04-502", name: "温度冲击", test_type: "温度冲击试验" },
      ],
    });

    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：TP-LAG | 当前状态：送至温度冲击一室");
    expect(view.selectedTrayFlow.steps.find((step) => step.key === "sent_to_lab")).toEqual(expect.objectContaining({
      active: true,
      label: "送至温度冲击一室",
    }));
  });

  test("buildSaltSprayLaboratoryView exposes running experiment countdown data for the current salt spray task", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentRuns: [
        {
          run_no: "run-601",
          task_code: "SYLU-2026-04-601",
          experiment_code: "SYLU-2026-04-601-A",
          device: "盐雾试验室",
          tray_codes: ["TP-601", "TP-602"],
          status: "实验进行中",
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
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

  test("buildSaltSprayLaboratoryView uses the active experiment run for batch countdown timing", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentRuns: [
        {
          id: "run-601-first",
          run_no: "run-601-first",
          schedule_id: "schedule-601",
          task_code: "SYLU-2026-04-601",
          experiment_code: "SYLU-2026-04-601-A",
          device: "盐雾试验室",
          tray_codes: ["TP-601"],
          status: "实验已完成",
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T11:00:00.000Z",
          ended_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "run-601-second",
          run_no: "run-601-second",
          schedule_id: "schedule-601",
          task_code: "SYLU-2026-04-601",
          experiment_code: "SYLU-2026-04-601-A",
          device: "盐雾试验室",
          tray_codes: ["TP-602"],
          status: "实验进行中",
          started_at: "2026-04-02T10:30:00.000Z",
          planned_end_at: "2026-04-02T12:30:00.000Z",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-04-601", experiment_code: "SYLU-2026-04-601-A", tray_code: "TP-601" },
        { task_code: "SYLU-2026-04-601", experiment_code: "SYLU-2026-04-601-A", tray_code: "TP-602" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-601", experiment_code: "SYLU-2026-04-601-A", experiment_name: "盐雾试验" },
      ],
      now: new Date("2026-04-02T11:30:00.000Z"),
      samples: [
        {
          code: "SP-601-1",
          location: "恒温恒湿间（暂存间）",
          owner: "王工",
          status: "已到达暂存间",
          task_code: "SYLU-2026-04-601",
          trays: [{ quantity: 1, status: "已到达暂存间", tray_code: "TP-601" }],
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
        trayCodes: ["TP-602"],
        countdownLabel: "01:00:00",
        startDateTimeLabel: toDisplayedDateTime("2026-04-02T10:30:00.000Z"),
        endDateTimeLabel: toDisplayedDateTime("2026-04-02T12:30:00.000Z"),
      }),
    );
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
      samples: [
        {
          code: "SP-001",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ tray_code: "TP-001", quantity: 1, status: "送至实验室" }],
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

  test("validateLaboratoryTrayScan rejects current task trays that already completed the experiment", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-002" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验-A" },
      ],
      now: NOW,
      samples: [
        {
          code: "SP-001",
          owner: "王工",
          status: "实验已完成",
          task_code: "SYLU-2026-04-101",
          trays: [{ tray_code: "TP-001", quantity: 1, status: "实验已完成" }],
        },
        {
          code: "SP-002",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ tray_code: "TP-002", quantity: 1, status: "送至实验室" }],
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
      ],
      tasks: [{ code: "SYLU-2026-04-101", name: "盐雾连接器-A", test_type: "盐雾试验" }],
    });

    const completedTray = validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scanCode: "TP-001",
      scheduleRows: view.scheduleRows,
    });
    const waitingTray = validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scanCode: "TP-002",
      scheduleRows: view.scheduleRows,
    });

    expect(completedTray).toEqual(expect.objectContaining({
      guidance: "TP-001 已完成实验，无需再次比对。",
      message: "托盘已完成实验",
      ok: false,
      tone: "error",
      trayCode: "TP-001",
    }));
    expect(waitingTray).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode: "TP-002",
    }));
  });

  test("validateLaboratoryTrayScan allows a tray completed in a previous experiment for the next scheduled experiment", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", tray_code: "TP-301" },
        { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", tray_code: "TP-301" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-301",
          experiment_code: "SYLU-2026-04-301-A",
          experiment_name: "盐雾试验",
          status: "实验已完成",
        },
        {
          task_code: "SYLU-2026-04-301",
          experiment_code: "SYLU-2026-04-301-B",
          experiment_name: "高低温湿热试验",
          status: "已排程",
        },
      ],
      labName: "高低温湿热一室",
      now: NOW,
      samples: [
        {
          code: "SP-301",
          location: "盐雾试验室",
          owner: "王工",
          status: "实验已完成",
          task_code: "SYLU-2026-04-301",
          trays: [{ tray_code: "TP-301", quantity: 1, status: "实验已完成" }],
        },
      ],
      schedules: [
        {
          id: "schedule-301-b",
          task_code: "SYLU-2026-04-301",
          experiment_code: "SYLU-2026-04-301-B",
          device: "高低温湿热一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-04-301", name: "复合实验任务", test_type: "盐雾试验 / 高低温湿热试验" }],
    });

    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-301",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode: "TP-301",
    }));
  });

  test("validateLaboratoryTrayScan allows impact comparison after the same tray completed vibration first", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          run_no: "run-vibration-003",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-C",
          tray_code: "SYLU-2026-06-021-TP-003",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 16:29:06",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-003" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-003" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          experiment_name: "冲击试验",
          status: "实验进行中",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-C",
          experiment_name: "振动试验",
          status: "实验已完成",
        },
      ],
      labName: "冲击二室",
      now: new Date("2026-06-05T16:30:00+08:00"),
      samples: [
        {
          code: "SYLU-2026-06-021-SP-003",
          history: [
            {
              action: "实验任务撤回",
              detail: "SYLU-2026-06-021 / 冲击试验 / 撤回至振动试验已完成（试验间内撤回当前实验任务）",
              location: "振动二室",
              status: "实验已完成",
              time: "2026-06-05 16:29:53",
            },
            {
              action: "实验完成",
              detail: "SYLU-2026-06-021 / 振动试验 / 实验已完成",
              location: "振动二室",
              status: "实验已完成",
              time: "2026-06-05 16:29:06",
            },
          ],
          location: "振动二室",
          owner: "扫码登记",
          status: "实验已完成",
          task_code: "SYLU-2026-06-021",
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              tray_code: "SYLU-2026-06-021-TP-003",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-impact",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          device: "冲击二室",
          start_at: "2026-06-05 16:20:00",
          end_at: "2026-06-05 19:50:00",
        },
        {
          id: "schedule-vibration",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-C",
          device: "振动二室",
          start_at: "2026-06-05 16:20:00",
          end_at: "2026-06-05 19:50:00",
        },
      ],
      tasks: [{ code: "SYLU-2026-06-021", name: "复合实验任务", test_type: "冲击试验 / 振动试验" }],
    });

    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "SYLU-2026-06-021-TP-003",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode: "SYLU-2026-06-021-TP-003",
    }));
  });

  test("validateLaboratoryTrayScan allows vibration comparison after impact and temperature completed with stale impact target", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          run_no: "run-impact-005",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          tray_code: "SYLU-2026-06-021-TP-005",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 17:50:53",
        },
        {
          run_no: "run-temp-005",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          tray_code: "SYLU-2026-06-021-TP-005",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 16:26:11",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-005" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", tray_code: "SYLU-2026-06-021-TP-005" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-005" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          experiment_name: "冲击试验",
          status: "实验已完成",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          experiment_name: "温度冲击试验",
          status: "实验已完成",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-C",
          experiment_name: "振动试验",
          status: "实验进行中",
        },
      ],
      labName: "振动二室",
      now: new Date("2026-06-05T17:55:00+08:00"),
      samples: [
        {
          code: "SYLU-2026-06-021-SP-005",
          history: [],
          location: "冲击二室",
          owner: "扫码登记",
          status: "实验进行中",
          flow_status: "实验进行中",
          task_code: "SYLU-2026-06-021",
          trays: [
            {
              quantity: 1,
              status: "实验进行中",
              target_experiment_code: "SYLU-2026-06-021-A",
              target_lab: "冲击二室",
              tray_code: "SYLU-2026-06-021-TP-005",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-impact",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          device: "冲击二室",
        },
        {
          id: "schedule-temp",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          device: "温度冲击二室",
        },
        {
          id: "schedule-vibration",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-C",
          device: "振动二室",
        },
      ],
      tasks: [{ code: "SYLU-2026-06-021", name: "复合实验任务", test_type: "冲击试验 / 温度冲击试验 / 振动试验" }],
    });

    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "SYLU-2026-06-021-TP-005",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode: "SYLU-2026-06-021-TP-005",
    }));
  });

  test("buildLaboratoryWorkbenchView does not reuse a completed experiment target lab for the selected tray flow", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-A", tray_code: "SYLU-2026-06-002-TP-001" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-B", tray_code: "SYLU-2026-06-002-TP-001" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-C", tray_code: "SYLU-2026-06-002-TP-001" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-A",
          experiment_name: "振动试验",
          status: "实验已完成",
        },
        {
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-B",
          experiment_name: "盐雾试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-C",
          experiment_name: "霉菌试验",
          status: "已排程",
        },
      ],
      labName: "盐雾试验室",
      now: NOW,
      samples: [
        {
          code: "SYLU-2026-06-002-SP-001",
          history: [
            {
              action: "实验完成",
              detail: "SYLU-2026-06-002 / 振动试验 / 实验已完成",
              status: "实验已完成",
              time: "2026-06-04T01:04:34+08:00",
            },
          ],
          location: "振动一室",
          owner: "王工",
          status: "实验已完成",
          task_code: "SYLU-2026-06-002",
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              target_lab: "振动一室",
              tray_code: "SYLU-2026-06-002-TP-001",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-salt",
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-B",
          device: "盐雾试验室",
          start_at: "2026-06-04T02:00:00.000Z",
          end_at: "2026-06-04T04:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-06-002", name: "振动后盐雾任务", test_type: "振动试验 / 盐雾试验 / 霉菌试验" }],
    });

    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：SYLU-2026-06-002-TP-001 | 当前状态：振动试验已完成");
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至盐雾试验室")).toBeUndefined();
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至振动一室")).toBeUndefined();
  });

  test("buildLaboratoryWorkbenchView keeps selected tray flow on the completed experiment until the current lab flow actually starts", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", tray_code: "SYLU-2026-06-001-TP-002" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-B", tray_code: "SYLU-2026-06-001-TP-002" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-C", tray_code: "SYLU-2026-06-001-TP-002" },
      ],
      experimentRuns: [
        {
          run_no: "run-salt-002",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-C",
          device: "盐雾试验室",
          tray_codes: ["SYLU-2026-06-001-TP-002"],
          status: "实验已完成",
          started_at: "2026-06-05 08:48:28",
          ended_at: "2026-06-05 10:54:41",
        },
        {
          run_no: "run-mold-002",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          device: "霉菌试验室",
          tray_codes: ["SYLU-2026-06-001-TP-002"],
          status: "实验已完成",
          started_at: "2026-06-05 08:48:28",
          ended_at: "2026-06-05 11:03:23",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "run-salt-002",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-C",
          tray_code: "SYLU-2026-06-001-TP-002",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 10:54:41",
        },
        {
          run_no: "run-mold-002",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          tray_code: "SYLU-2026-06-001-TP-002",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 11:03:23",
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          experiment_name: "冲击试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          experiment_name: "霉菌试验",
          status: "实验已完成",
        },
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-C",
          experiment_name: "盐雾试验",
          status: "实验已完成",
        },
      ],
      labName: "冲击一室",
      now: new Date("2026-06-05T11:10:00.000Z"),
      samples: [
        {
          code: "SYLU-2026-06-001-SP-003",
          history: [
            {
              action: "实验完成",
              detail: "SYLU-2026-06-001 / 盐雾试验 / 实验已完成",
              location: "盐雾试验室",
              status: "实验已完成",
              time: "2026-06-05 10:54:41",
            },
            {
              action: "实验完成",
              detail: "SYLU-2026-06-001 / 霉菌试验 / 实验已完成",
              location: "霉菌试验室",
              status: "实验已完成",
              time: "2026-06-05 11:03:23",
            },
          ],
          location: "冲击一室",
          owner: "王工",
          status: "实验已完成",
          task_code: "SYLU-2026-06-001",
          trays: [
            {
              quantity: 2,
              status: "实验已完成",
              tray_code: "SYLU-2026-06-001-TP-002",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-salt",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-C",
          device: "盐雾试验室",
          start_at: "2026-06-05 08:48:00",
          end_at: "2026-06-05 10:54:00",
        },
        {
          id: "schedule-mold",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          device: "霉菌试验室",
          start_at: "2026-06-05 08:48:00",
          end_at: "2026-06-05 11:03:00",
        },
        {
          id: "schedule-impact",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          device: "冲击一室",
          start_at: "2026-06-05 10:48:00",
          end_at: "2026-06-05 14:18:00",
        },
      ],
      selectedTrayCode: "SYLU-2026-06-001-TP-002",
      tasks: [{ code: "SYLU-2026-06-001", name: "复合实验任务", test_type: "冲击试验 / 霉菌试验 / 盐雾试验" }],
    });

    expect(view.currentTask.experimentCode).toBe("SYLU-2026-06-001-A");
    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：SYLU-2026-06-001-TP-002 | 当前状态：送至外观检测间");
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
    const appearanceDispatchSteps = view.selectedTrayFlow.steps.filter((step) => step.label === "送至外观检测间");
    expect(appearanceDispatchSteps.at(0)).toEqual(expect.objectContaining({ active: false, reached: true }));
    expect(appearanceDispatchSteps.some((step) => step.active)).toBe(true);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至冲击一室")).toBeUndefined();
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至实验室")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
  });

  test("buildLaboratoryWorkbenchView treats mqtt run-tray completions as other experiment context without sample history", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", tray_code: "SYLU-2026-06-001-TP-003" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-B", tray_code: "SYLU-2026-06-001-TP-003" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-C", tray_code: "SYLU-2026-06-001-TP-003" },
      ],
      experimentRunTrays: [
        {
          run_no: "run-mold-003",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          tray_code: "SYLU-2026-06-001-TP-003",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 11:03:23",
        },
        {
          run_no: "run-salt-003",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-C",
          tray_code: "SYLU-2026-06-001-TP-003",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 10:54:41",
        },
      ],
      experiments: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", experiment_name: "冲击试验", status: "已排程" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-B", experiment_name: "霉菌试验", status: "实验已完成" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-C", experiment_name: "盐雾试验", status: "实验已完成" },
      ],
      labName: "冲击一室",
      now: new Date("2026-06-05T11:10:00.000Z"),
      samples: [
        {
          code: "SYLU-2026-06-001-SP-004",
          history: [],
          location: "霉菌试验室",
          owner: "王工",
          status: "实验已完成",
          task_code: "SYLU-2026-06-001",
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              tray_code: "SYLU-2026-06-001-TP-003",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-impact",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          device: "冲击一室",
          start_at: "2026-06-05 10:48:00",
          end_at: "2026-06-05 14:18:00",
        },
      ],
      selectedTrayCode: "SYLU-2026-06-001-TP-003",
      tasks: [{ code: "SYLU-2026-06-001", name: "复合实验任务", test_type: "冲击试验 / 霉菌试验 / 盐雾试验" }],
    });

    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：SYLU-2026-06-001-TP-003 | 当前状态：送至外观检测间");
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
    const appearanceDispatchSteps = view.selectedTrayFlow.steps.filter((step) => step.label === "送至外观检测间");
    expect(appearanceDispatchSteps.at(0)).toEqual(expect.objectContaining({ active: false, reached: true }));
    expect(appearanceDispatchSteps.some((step) => step.active)).toBe(true);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至冲击一室")).toBeUndefined();
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至实验室")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
  });

  test("validateLaboratoryTrayScan rejects a shared tray already completed for the current experiment", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-B", tray_code: "TP-001" },
        { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-A", tray_code: "TP-002" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-A",
          experiment_name: "振动试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-B",
          experiment_name: "盐雾试验",
          status: "已排程",
        },
      ],
      labName: "振动一室",
      now: NOW,
      samples: [
        {
          code: "SP-001",
          history: [
            {
              action: "实验完成",
              detail: "SYLU-2026-05-001 / 振动试验 / 实验已完成",
              time: "2026-05-25T14:55:28.000Z",
            },
          ],
          location: "振动一室",
          owner: "王工",
          status: "实验已完成",
          task_code: "SYLU-2026-05-001",
          trays: [{ tray_code: "TP-001", quantity: 1, status: "实验已完成" }],
        },
        {
          code: "SP-002",
          history: [],
          location: "振动一室",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-05-001",
          trays: [{ tray_code: "TP-002", quantity: 1, status: "送至实验室" }],
        },
      ],
      schedules: [
        {
          id: "schedule-vibration",
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-A",
          device: "振动一室",
          start_at: "2026-05-25T14:55:00.000Z",
          end_at: "2026-05-25T18:25:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-05-001", name: "双托盘任务", test_type: "振动试验 / 盐雾试验" }],
    });

    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-001",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "托盘已完成实验",
      ok: false,
      tone: "error",
      trayCode: "TP-001",
    }));
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-002",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode: "TP-002",
    }));
  });

  test("keeps compare available when a shared tray completed a previous experiment and enters the next one", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-302", experiment_code: "SYLU-2026-04-302-A", tray_code: "TP-302" },
        { task_code: "SYLU-2026-04-302", experiment_code: "SYLU-2026-04-302-B", tray_code: "TP-302" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-302",
          experiment_code: "SYLU-2026-04-302-A",
          experiment_name: "盐雾试验",
          status: "实验已完成",
        },
        {
          task_code: "SYLU-2026-04-302",
          experiment_code: "SYLU-2026-04-302-B",
          experiment_name: "高低温湿热试验",
          status: "已排程",
        },
      ],
      labName: "高低温湿热一室",
      now: NOW,
      samples: [
        {
          code: "SP-302",
          location: "盐雾试验室",
          owner: "王工",
          status: "实验已完成",
          task_code: "SYLU-2026-04-302",
          trays: [{ tray_code: "TP-302", quantity: 1, status: "实验已完成" }],
        },
      ],
      schedules: [
        {
          id: "schedule-302-b",
          task_code: "SYLU-2026-04-302",
          experiment_code: "SYLU-2026-04-302-B",
          device: "高低温湿热一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-04-302", name: "复合实验任务", test_type: "盐雾试验 / 高低温湿热试验" }],
    });

    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: true,
      canInstallSample: false,
      canMarkReady: false,
    });
  });

  test("keeps other labs locked when a shared tray is dispatched to a specific lab before any experiment completes", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-303", experiment_code: "SYLU-2026-04-303-A", tray_code: "TP-303" },
        { task_code: "SYLU-2026-04-303", experiment_code: "SYLU-2026-04-303-B", tray_code: "TP-303" },
        { task_code: "SYLU-2026-04-303", experiment_code: "SYLU-2026-04-303-C", tray_code: "TP-303" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-303",
          experiment_code: "SYLU-2026-04-303-A",
          experiment_name: "盐雾试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-04-303",
          experiment_code: "SYLU-2026-04-303-B",
          experiment_name: "高低温湿热试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-04-303",
          experiment_code: "SYLU-2026-04-303-C",
          experiment_name: "振动试验",
          status: "已排程",
        },
      ],
      labName: "高低温湿热一室",
      now: NOW,
      samples: [
        {
          code: "SP-303",
          location: "盐雾试验室",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-04-303",
          trays: [
            {
              tray_code: "TP-303",
              quantity: 1,
              status: "送至实验室",
              target_lab: "盐雾试验室",
              target_experiment_code: "SYLU-2026-04-303-A",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-303-a",
          task_code: "SYLU-2026-04-303",
          experiment_code: "SYLU-2026-04-303-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-303-b",
          task_code: "SYLU-2026-04-303",
          experiment_code: "SYLU-2026-04-303-B",
          device: "高低温湿热一室",
          start_at: "2026-04-02T11:30:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
        {
          id: "schedule-303-c",
          task_code: "SYLU-2026-04-303",
          experiment_code: "SYLU-2026-04-303-C",
          device: "振动一室",
          start_at: "2026-04-02T13:30:00.000Z",
          end_at: "2026-04-02T15:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-04-303", name: "复合实验任务", test_type: "盐雾试验 / 高低温湿热试验 / 振动试验" }],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      device: "高低温湿热一室",
      experimentCode: "SYLU-2026-04-303-B",
    }));
    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(view.currentTask))).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    });
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-303",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      guidance: "TP-303 已出库至盐雾试验室，请在高低温湿热一室出库后再比对。",
      message: "托盘未送达当前试验间",
      ok: false,
      tone: "error",
      trayCode: "TP-303",
    }));
    expect(view.selectedTrayFlow.steps.find((step) => step.key === "route-0-2")?.label).toBe("送至盐雾试验室");
  });

  test("uses tray target lab when task trays are dispatched to different laboratories", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", tray_code: "TP-A" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-B", tray_code: "TP-B" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-C", tray_code: "TP-C" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          experiment_name: "盐雾试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          experiment_name: "霉菌试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-C",
          experiment_name: "高低温湿热试验",
          status: "已排程",
        },
      ],
      labName: "盐雾试验室",
      now: NOW,
      samples: [
        {
          code: "SP-601",
          location: "霉菌试验室",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-06-001",
          trays: [
            {
              tray_code: "TP-A",
              quantity: 1,
              status: "送至实验室",
              target_lab: "盐雾试验室",
              target_experiment_code: "SYLU-2026-06-001-A",
            },
            {
              tray_code: "TP-B",
              quantity: 1,
              status: "送至实验室",
              target_lab: "霉菌试验室",
              target_experiment_code: "SYLU-2026-06-001-B",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-601-a",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          device: "盐雾试验室",
          start_at: "2026-06-01T09:30:00.000Z",
          end_at: "2026-06-01T11:00:00.000Z",
        },
        {
          id: "schedule-601-b",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          device: "霉菌试验室",
          start_at: "2026-06-01T11:30:00.000Z",
          end_at: "2026-06-01T13:00:00.000Z",
        },
        {
          id: "schedule-601-c",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-C",
          device: "高低温湿热一室",
          start_at: "2026-06-01T13:30:00.000Z",
          end_at: "2026-06-01T15:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-06-001", name: "复合实验任务", test_type: "盐雾试验 / 霉菌试验 / 高低温湿热试验" }],
    });

    expect(view.currentTask.trayRows).toEqual([
      expect.objectContaining({
        currentLocation: "盐雾试验室",
        targetExperimentCode: "SYLU-2026-06-001-A",
        targetLab: "盐雾试验室",
        trayCode: "TP-A",
      }),
    ]);
    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(view.currentTask))).toEqual({
      canCompare: true,
      canInstallSample: false,
      canMarkReady: false,
    });
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-A",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode: "TP-A",
    }));
  });

  test("keeps compare available for the tray dispatched to the current lab when shared experiment rows include other labs", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "TP-002" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", tray_code: "TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", tray_code: "TP-002" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          experiment_name: "冲击试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          experiment_name: "温度冲击试验",
          status: "已排程",
        },
      ],
      labName: "冲击一室",
      now: new Date("2026-06-03T11:30:00.000Z"),
      samples: [
        {
          code: "SP-001",
          location: "冲击一室",
          status: "送至实验室",
          task_code: "SYLU-2026-06-021",
          trays: [
            {
              tray_code: "TP-001",
              quantity: 1,
              status: "送至实验室",
              target_lab: "冲击一室",
            },
          ],
        },
        {
          code: "SP-002",
          location: "温度冲击一室",
          status: "送至实验室",
          task_code: "SYLU-2026-06-021",
          trays: [
            {
              tray_code: "TP-002",
              quantity: 1,
              status: "送至实验室",
              target_lab: "温度冲击一室",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-021-a",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          device: "冲击一室",
          start_at: "2026-06-04T00:00:00.000Z",
          end_at: "2026-06-04T03:30:00.000Z",
        },
        {
          id: "schedule-021-b",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          device: "温度冲击一室",
          start_at: "2026-06-04T00:00:00.000Z",
          end_at: "2026-06-04T03:30:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-06-021", name: "复合实验任务", test_type: "冲击试验 / 温度冲击试验" }],
    });

    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(view.currentTask))).toEqual({
      canCompare: true,
      canInstallSample: false,
      canMarkReady: false,
    });
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-001",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode: "TP-001",
    }));
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-002",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "托盘未送达当前试验间",
      ok: false,
      trayCode: "TP-002",
    }));
  });

  test("blocks comparison in another laboratory while the same trays are running a different experiment", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          id: "run-mold-001",
          run_no: "run-mold-001",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          device: "霉菌试验室",
          tray_codes: ["TP-001", "TP-003"],
          status: "实验进行中",
          started_at: "2026-06-05 09:00:00",
          planned_end_at: "2026-06-05 11:00:00",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "run-mold-001",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          tray_code: "TP-001",
          run_tray_status: "实验进行中",
          started_at: "2026-06-05 09:00:00",
        },
        {
          run_no: "run-mold-001",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          tray_code: "TP-003",
          run_tray_status: "实验进行中",
          started_at: "2026-06-05 09:00:00",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", tray_code: "TP-003" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-B", tray_code: "TP-001" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-B", tray_code: "TP-003" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          experiment_name: "盐雾试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          experiment_name: "霉菌试验",
          status: "实验进行中",
        },
      ],
      labName: "盐雾试验室",
      now: new Date("2026-06-05T09:30:00.000Z"),
      samples: [
        {
          code: "SP-001",
          location: "盐雾试验室",
          status: "送至实验室",
          task_code: "SYLU-2026-06-001",
          trays: [
            {
              tray_code: "TP-001",
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: "SYLU-2026-06-001-A",
              target_lab: "盐雾试验室",
            },
          ],
        },
        {
          code: "SP-003",
          location: "盐雾试验室",
          status: "送至实验室",
          task_code: "SYLU-2026-06-001",
          trays: [
            {
              tray_code: "TP-003",
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: "SYLU-2026-06-001-A",
              target_lab: "盐雾试验室",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-salt-001",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          device: "盐雾试验室",
          start_at: "2026-06-05 09:00:00",
          end_at: "2026-06-05 11:00:00",
        },
        {
          id: "schedule-mold-001",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          device: "霉菌试验室",
          start_at: "2026-06-05 09:00:00",
          end_at: "2026-06-05 11:00:00",
        },
      ],
      tasks: [{ code: "SYLU-2026-06-001", name: "复合实验任务", test_type: "盐雾试验 / 霉菌试验" }],
    });

    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(view.currentTask.experimentCode).toBe("SYLU-2026-06-001-A");
    expect(workflow.hasActiveOtherExperimentRun).toBe(true);
    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    });
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-001",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "托盘正在其他实验中",
      ok: false,
      trayCode: "TP-001",
    }));
  });

  test("keeps a partially completed salt-spray batch visible when another tray completed a different experiment", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", tray_code: "TP-002" },
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-B", tray_code: "TP-002" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          experiment_name: "盐雾试验",
          status: "实验进行中",
        },
        {
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-B",
          experiment_name: "霉菌试验",
          status: "实验已完成",
        },
      ],
      labName: "盐雾试验室",
      now: NOW,
      samples: [
        {
          code: "SP-001",
          location: "盐雾试验室",
          status: "实验已完成",
          task_code: "SYLU-2026-06-001",
          trays: [{ tray_code: "TP-001", quantity: 1, status: "实验已完成", target_lab: "盐雾试验室" }],
          history: [
            { detail: "SYLU-2026-06-001 / 盐雾试验 / 实验已完成", status: "实验已完成", time: "2026-06-03T10:00:00.000Z" },
          ],
        },
        {
          code: "SP-002",
          location: "霉菌试验室",
          status: "实验已完成",
          task_code: "SYLU-2026-06-001",
          trays: [{ tray_code: "TP-002", quantity: 1, status: "实验已完成", target_lab: "霉菌试验室" }],
          history: [
            { detail: "SYLU-2026-06-001 / 霉菌试验 / 实验已完成", status: "实验已完成", time: "2026-06-03T09:30:00.000Z" },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-salt",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          device: "盐雾试验室",
          start_at: "2026-06-04T00:00:00.000Z",
          end_at: "2026-06-04T03:30:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-06-001", name: "复合实验任务", test_type: "盐雾试验 / 霉菌试验" }],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      experimentCode: "SYLU-2026-06-001-A",
      taskCode: "SYLU-2026-06-001",
    }));
    expect(view.currentTask.trayRows).toEqual([
      expect.objectContaining({ completedForCurrentExperiment: false, trayCode: "TP-002" }),
    ]);
    expect(view.currentTask.allTrayRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ completedForCurrentExperiment: true, trayCode: "TP-001", trayStatus: "实验已完成" }),
      expect.objectContaining({ completedForCurrentExperiment: false, trayCode: "TP-002" }),
    ]));
    expect(view.currentTask.trayRows.find((row) => row.trayCode === "TP-002")?.trayStatus).not.toBe("实验已完成");
  });

  test("allows impact comparison when later experiments completed before the current impact experiment", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-A", tray_code: "SYLU-2026-06-003-TP-001" },
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-A", tray_code: "SYLU-2026-06-003-TP-002" },
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-A", tray_code: "SYLU-2026-06-003-TP-003" },
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-B", tray_code: "SYLU-2026-06-003-TP-001" },
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-B", tray_code: "SYLU-2026-06-003-TP-002" },
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-B", tray_code: "SYLU-2026-06-003-TP-003" },
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-C", tray_code: "SYLU-2026-06-003-TP-001" },
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-C", tray_code: "SYLU-2026-06-003-TP-002" },
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-C", tray_code: "SYLU-2026-06-003-TP-003" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-003",
          experiment_code: "SYLU-2026-06-003-A",
          experiment_name: "冲击试验",
          status: "实验进行中",
        },
        {
          task_code: "SYLU-2026-06-003",
          experiment_code: "SYLU-2026-06-003-B",
          experiment_name: "四综合试验",
          status: "实验已完成",
        },
        {
          task_code: "SYLU-2026-06-003",
          experiment_code: "SYLU-2026-06-003-C",
          experiment_name: "盐雾试验",
          status: "实验已完成",
        },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: "SYLU-2026-06-003-SP-001",
          history: [
            { detail: "SYLU-2026-06-003 / 冲击试验 / 实验已完成", status: "实验已完成", time: "2026-06-04T00:08:13+08:00" },
          ],
          location: "盐雾试验室",
          status: "实验已完成",
          task_code: "SYLU-2026-06-003",
          trays: [{ quantity: 1, status: "实验已完成", target_lab: "冲击一室", tray_code: "SYLU-2026-06-003-TP-001" }],
        },
        {
          code: "SYLU-2026-06-003-SP-008",
          history: [
            { detail: "SYLU-2026-06-003 / 盐雾试验 / 实验已完成", status: "实验已完成", time: "2026-06-04T00:13:04+08:00" },
            { detail: "SYLU-2026-06-003 / 四综合试验 / 实验已完成", status: "实验已完成", time: "2026-06-04T00:09:48+08:00" },
          ],
          location: "盐雾试验室",
          status: "实验已完成",
          task_code: "SYLU-2026-06-003",
          trays: [{ quantity: 1, status: "实验已完成", target_lab: "四综合实验室", tray_code: "SYLU-2026-06-003-TP-002" }],
        },
      ],
      schedules: [
        {
          id: "schedule-impact",
          task_code: "SYLU-2026-06-003",
          experiment_code: "SYLU-2026-06-003-A",
          device: "冲击一室",
          start_at: "2026-06-04T08:00:00+08:00",
          end_at: "2026-06-04T11:30:00+08:00",
        },
      ],
      tasks: [{ code: "SYLU-2026-06-003", name: "演示任务003", test_type: "冲击试验 / 四综合试验 / 盐雾试验" }],
    });

    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(view.currentTask))).toEqual({
      canCompare: true,
      canInstallSample: false,
      canMarkReady: false,
    });
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "SYLU-2026-06-003-TP-002",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode: "SYLU-2026-06-003-TP-002",
    }));
  });

  test("keeps per-laboratory progress independent for shared trays before an experiment completes", () => {
    const baseInput = {
      experimentTrays: [
        { task_code: "SYLU-2026-04-304", experiment_code: "SYLU-2026-04-304-A", tray_code: "TP-304" },
        { task_code: "SYLU-2026-04-304", experiment_code: "SYLU-2026-04-304-B", tray_code: "TP-304" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-304",
          experiment_code: "SYLU-2026-04-304-A",
          experiment_name: "盐雾试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-04-304",
          experiment_code: "SYLU-2026-04-304-B",
          experiment_name: "高低温湿热试验",
          status: "已排程",
        },
      ],
      now: NOW,
      schedules: [
        {
          id: "schedule-304-a",
          task_code: "SYLU-2026-04-304",
          experiment_code: "SYLU-2026-04-304-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-304-b",
          task_code: "SYLU-2026-04-304",
          experiment_code: "SYLU-2026-04-304-B",
          device: "高低温湿热一室",
          start_at: "2026-04-02T11:30:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-04-304", name: "复合实验任务", test_type: "盐雾试验 / 高低温湿热试验" }],
    };

    const comparedInA = {
      code: "SP-304",
      history: [
        {
          action: "任务比对",
          detail: "SYLU-2026-04-304 / 盐雾试验 / 已到达实验室",
          location: "盐雾试验室",
          status: "已到达实验室",
          time: "2026-04-02T10:00:00.000Z",
        },
      ],
      location: "盐雾试验室",
      owner: "王工",
      status: "已到达实验室",
      task_code: "SYLU-2026-04-304",
      trays: [{ tray_code: "TP-304", quantity: 1, status: "已到达实验室" }],
    };
    const installedInA = {
      ...comparedInA,
      history: [
        {
          action: "样品安装",
          detail: "SYLU-2026-04-304 / 盐雾试验 / 工装夹具安装",
          location: "盐雾试验室",
          status: "工装夹具安装",
          time: "2026-04-02T10:10:00.000Z",
        },
        ...comparedInA.history,
      ],
      status: "工装夹具安装",
      trays: [{ tray_code: "TP-304", quantity: 1, status: "工装夹具安装", fixture_ready: true }],
    };

    const aView = buildSaltSprayLaboratoryView({ ...baseInput, labName: "盐雾试验室", samples: [comparedInA] });
    const bViewAfterACompare = buildSaltSprayLaboratoryView({ ...baseInput, labName: "高低温湿热一室", samples: [comparedInA] });
    const bViewAfterAInstall = buildSaltSprayLaboratoryView({ ...baseInput, labName: "高低温湿热一室", samples: [installedInA] });

    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(aView.currentTask))).toEqual(expect.objectContaining({
      canInstallSample: true,
    }));
    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(bViewAfterACompare.currentTask))).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    });
    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(bViewAfterAInstall.currentTask))).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    });
  });

  test("does not project a previous shared-tray running experiment onto the next laboratory", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          id: "run-vibration",
          run_no: "run-vibration",
          task_code: "TASK-RUN-SCOPE",
          experiment_code: "EXP-VIB",
          device: "振动二室",
          tray_codes: ["TP-RUN-SCOPE"],
          status: "实验进行中",
          started_at: "2026-04-02T09:00:00.000Z",
          planned_end_at: "2026-04-02T10:30:00.000Z",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-RUN-SCOPE", experiment_code: "EXP-VIB", tray_code: "TP-RUN-SCOPE" },
        { task_code: "TASK-RUN-SCOPE", experiment_code: "EXP-TEMP", tray_code: "TP-RUN-SCOPE" },
      ],
      experiments: [
        {
          task_code: "TASK-RUN-SCOPE",
          experiment_code: "EXP-VIB",
          experiment_name: "振动实验",
          status: "实验进行中",
        },
        {
          task_code: "TASK-RUN-SCOPE",
          experiment_code: "EXP-TEMP",
          experiment_name: "温度冲击实验",
          status: "已排程",
        },
      ],
      labName: "温度冲击二室",
      now: NOW,
      samples: [
        {
          code: "SP-RUN-SCOPE",
          history: [
            {
              action: "开始实验",
              detail: "TASK-RUN-SCOPE / 振动实验 / 实验进行中 / 托盘：TP-RUN-SCOPE",
              location: "振动二室",
              status: "实验进行中",
              time: "2026-04-02T09:00:00.000Z",
            },
          ],
          location: "振动二室",
          owner: "王工",
          status: "实验进行中",
          task_code: "TASK-RUN-SCOPE",
          trays: [
            {
              quantity: 1,
              status: "实验进行中",
              target_experiment_code: "EXP-VIB",
              target_lab: "振动二室",
              tray_code: "TP-RUN-SCOPE",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-run-vibration",
          task_code: "TASK-RUN-SCOPE",
          experiment_code: "EXP-VIB",
          device: "振动二室",
          start_at: "2026-04-02T09:00:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
        },
        {
          id: "schedule-run-temp",
          task_code: "TASK-RUN-SCOPE",
          experiment_code: "EXP-TEMP",
          device: "温度冲击二室",
          start_at: "2026-04-02T11:00:00.000Z",
          end_at: "2026-04-02T12:30:00.000Z",
        },
      ],
      tasks: [{ code: "TASK-RUN-SCOPE", name: "共享托盘运行态任务", test_type: "振动实验 / 温度冲击实验" }],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      experimentCode: "EXP-TEMP",
      experimentName: "温度冲击实验",
    }));
    expect(view.runningExperiment.active).toBe(false);
    expect(view.currentTaskStatus).not.toBe("实验进行中");
    expect(view.currentTask.trayRows[0]).toEqual(expect.objectContaining({
      trayCode: "TP-RUN-SCOPE",
      trayStatus: "送至实验室",
    }));
    expect(view.selectedTrayFlow.currentStatus).not.toContain("温度冲击实验进行中");
    expect(buildLaboratoryProgressMessage(view.currentTaskFlow, view.currentTask, "温度冲击二室")).not.toContain("已进入实验进行中");
    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(view.currentTask))).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    });
  });

  test("does not project a same-laboratory active run from another experiment onto the selected experiment", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          id: "run-same-lab-a",
          run_no: "run-same-lab-a",
          task_code: "TASK-SAME-LAB",
          experiment_code: "EXP-A",
          device: "综合一室",
          tray_codes: ["TP-SAME-LAB"],
          status: "实验进行中",
          started_at: "2026-04-02T09:00:00.000Z",
          planned_end_at: "2026-04-02T10:30:00.000Z",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-SAME-LAB", experiment_code: "EXP-A", tray_code: "TP-SAME-LAB" },
        { task_code: "TASK-SAME-LAB", experiment_code: "EXP-B", tray_code: "TP-SAME-LAB" },
      ],
      experiments: [
        { task_code: "TASK-SAME-LAB", experiment_code: "EXP-A", experiment_name: "A实验", status: "实验进行中" },
        { task_code: "TASK-SAME-LAB", experiment_code: "EXP-B", experiment_name: "B实验", status: "已排程" },
      ],
      labName: "综合一室",
      now: NOW,
      samples: [
        {
          code: "SP-SAME-LAB",
          history: [
            {
              action: "开始实验",
              detail: "TASK-SAME-LAB / A实验 / 实验进行中 / 托盘：TP-SAME-LAB",
              location: "综合一室",
              status: "实验进行中",
              time: "2026-04-02T09:00:00.000Z",
            },
          ],
          location: "综合一室",
          owner: "王工",
          status: "实验进行中",
          task_code: "TASK-SAME-LAB",
          trays: [
            {
              quantity: 1,
              status: "实验进行中",
              target_experiment_code: "EXP-A",
              target_lab: "综合一室",
              tray_code: "TP-SAME-LAB",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-same-lab-a",
          task_code: "TASK-SAME-LAB",
          experiment_code: "EXP-A",
          device: "综合一室",
          start_at: "2026-04-02T09:00:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
        },
        {
          id: "schedule-same-lab-b",
          task_code: "TASK-SAME-LAB",
          experiment_code: "EXP-B",
          device: "综合一室",
          start_at: "2026-04-02T11:00:00.000Z",
          end_at: "2026-04-02T12:30:00.000Z",
        },
      ],
      selectedTaskCode: "TASK-SAME-LAB::EXP-B",
      tasks: [{ code: "TASK-SAME-LAB", name: "同室共享托盘任务", test_type: "A实验 / B实验" }],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      experimentCode: "EXP-B",
      experimentName: "B实验",
    }));
    expect(view.runningExperiment.active).toBe(false);
    expect(view.currentTaskStatus).not.toBe("实验进行中");
    expect(view.currentTask.trayRows[0].trayStatus).not.toBe("实验进行中");
    expect(view.selectedTrayFlow.currentStatus).not.toContain("B实验进行中");
    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(view.currentTask))).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    });
  });

  test("does not open running state from stale sample running text without an active run", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "TASK-STALE-RUN", experiment_code: "EXP-SALT", tray_code: "TP-STALE-RUN" },
      ],
      experiments: [
        { task_code: "TASK-STALE-RUN", experiment_code: "EXP-SALT", experiment_name: "盐雾试验", status: "已排程" },
      ],
      labName: "盐雾试验室",
      now: NOW,
      samples: [
        {
          code: "SP-STALE-RUN",
          location: "盐雾试验室",
          status: "实验进行中",
          task_code: "TASK-STALE-RUN",
          trays: [{ tray_code: "TP-STALE-RUN", quantity: 1, status: "实验进行中", target_lab: "盐雾试验室" }],
        },
      ],
      schedules: [
        {
          id: "schedule-stale-run",
          task_code: "TASK-STALE-RUN",
          experiment_code: "EXP-SALT",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:00:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
        },
      ],
      tasks: [{ code: "TASK-STALE-RUN", name: "陈旧运行态任务", test_type: "盐雾试验" }],
    });

    expect(view.runningExperiment.active).toBe(false);
    expect(view.currentTaskStatus).not.toBe("实验进行中");
  });

  test("hides run-tray completed schedules even when sample tray status has not refreshed yet", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          run_no: "RUN-COMPLETE-ONLY",
          task_code: "TASK-COMPLETE-ONLY",
          experiment_code: "EXP-SALT",
          tray_code: "TP-COMPLETE-ONLY",
          run_tray_status: "实验已完成",
          ended_at: "2026-04-02T10:30:00.000Z",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-COMPLETE-ONLY", experiment_code: "EXP-SALT", tray_code: "TP-COMPLETE-ONLY" },
      ],
      experiments: [
        { task_code: "TASK-COMPLETE-ONLY", experiment_code: "EXP-SALT", experiment_name: "盐雾试验", status: "实验进行中" },
      ],
      labName: "盐雾试验室",
      now: NOW,
      samples: [
        {
          code: "SP-COMPLETE-ONLY",
          location: "盐雾试验室",
          status: "送至实验室",
          task_code: "TASK-COMPLETE-ONLY",
          trays: [{ tray_code: "TP-COMPLETE-ONLY", quantity: 1, status: "送至实验室", target_lab: "盐雾试验室" }],
        },
      ],
      schedules: [
        {
          id: "schedule-complete-only",
          task_code: "TASK-COMPLETE-ONLY",
          experiment_code: "EXP-SALT",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:00:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
        },
      ],
      tasks: [{ code: "TASK-COMPLETE-ONLY", name: "托盘明细完成任务", test_type: "盐雾试验" }],
    });

    expect(view.currentTask).toBeNull();
    expect(view.scheduleRows).toEqual([]);
    expect(view.allScheduleRows).toEqual([]);
  });

  test("uses active mqtt run state in selected tray flow when tray status is still ready", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          id: "run-impact",
          run_no: "run-impact",
          task_code: "TASK-MQTT-RUN",
          experiment_code: "EXP-IMPACT",
          device: "冲击一室",
          tray_codes: ["TP-MQTT-RUN-001"],
          status: "实验进行中",
          started_at: "2026-06-04T13:55:06+08:00",
          planned_end_at: "2026-06-04T17:23:00+08:00",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-MQTT-RUN", experiment_code: "EXP-IMPACT", tray_code: "TP-MQTT-RUN-001" },
        { task_code: "TASK-MQTT-RUN", experiment_code: "EXP-VIB", tray_code: "TP-MQTT-RUN-001" },
      ],
      experiments: [
        { task_code: "TASK-MQTT-RUN", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", status: "实验准备就绪" },
        { task_code: "TASK-MQTT-RUN", experiment_code: "EXP-VIB", experiment_name: "振动试验", status: "已排程" },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: "SP-MQTT-RUN-001",
          location: "冲击一室",
          owner: "王工",
          status: "实验准备就绪",
          task_code: "TASK-MQTT-RUN",
          trays: [
            {
              quantity: 1,
              status: "实验准备就绪",
              target_experiment_code: "EXP-IMPACT",
              target_lab: "冲击一室",
              tray_code: "TP-MQTT-RUN-001",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-impact",
          task_code: "TASK-MQTT-RUN",
          experiment_code: "EXP-IMPACT",
          device: "冲击一室",
          start_at: "2026-06-04T13:00:00+08:00",
          end_at: "2026-06-04T17:23:00+08:00",
        },
        {
          id: "schedule-vib",
          task_code: "TASK-MQTT-RUN",
          experiment_code: "EXP-VIB",
          device: "振动一室",
          start_at: "2026-06-04T18:00:00+08:00",
          end_at: "2026-06-04T20:00:00+08:00",
        },
      ],
      tasks: [{ code: "TASK-MQTT-RUN", name: "MQTT运行态任务", test_type: "冲击试验 / 振动试验" }],
    });

    expect(view.currentTaskStatus).toBe("任务进行中");
    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：TP-MQTT-RUN-001 | 当前状态：冲击试验进行中");
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "冲击试验进行中")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "实验准备就绪")).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
  });

  test("does not reopen compare when the current shared-tray experiment is already completed", () => {
    const workflow = buildLaboratoryWorkflowFromTask({
      experimentCode: "SYLU-2026-04-302-B",
      status: "实验已完成",
      trayRows: [
        {
          displayStatus: "实验已完成",
          experimentCodes: ["SYLU-2026-04-302-A", "SYLU-2026-04-302-B"],
          trayCode: "TP-302",
          trayStatus: "实验已完成",
        },
      ],
    });

    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    });
  });

  test.each(["已入库", "到货", ""])(
    "validateLaboratoryTrayScan rejects current task trays that have not been dispatched from transfer area: %s",
    (trayStatus) => {
      const view = buildSaltSprayLaboratoryView({
        experimentTrays: [
          { task_code: "SYLU-2026-05-701", experiment_code: "SYLU-2026-05-701-A", tray_code: "TP-NOT-DISPATCHED" },
        ],
        experiments: [
          { task_code: "SYLU-2026-05-701", experiment_code: "SYLU-2026-05-701-A", experiment_name: "盐雾试验" },
        ],
        now: NOW,
        samples: [
          {
            code: "SP-NOT-DISPATCHED",
            location: "接驳区",
            owner: "王工",
            status: trayStatus,
            task_code: "SYLU-2026-05-701",
            trays: [{ tray_code: "TP-NOT-DISPATCHED", quantity: 1, status: trayStatus }],
          },
        ],
        schedules: [
          {
            id: "schedule-not-dispatched",
            task_code: "SYLU-2026-05-701",
            experiment_code: "SYLU-2026-05-701-A",
            device: "盐雾试验室",
            start_at: "2026-05-13T09:00:00.000Z",
            end_at: "2026-05-13T11:00:00.000Z",
          },
        ],
        tasks: [{ code: "SYLU-2026-05-701", name: "未出库任务", test_type: "盐雾试验" }],
      });

      expect(validateLaboratoryTrayScan({
        currentTask: view.currentTask,
        scanCode: "TP-NOT-DISPATCHED",
        scheduleRows: view.scheduleRows,
      })).toEqual(expect.objectContaining({
        guidance: "请先在接驳间完成出库并送至实验室。",
        message: "托盘尚未出库",
        ok: false,
        tone: "error",
        trayCode: "TP-NOT-DISPATCHED",
      }));
    },
  );

  test("validateLaboratoryTrayScan points to staging when the current tray is still in staging", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-05-702", experiment_code: "SYLU-2026-05-702-A", tray_code: "TP-STAGING" },
      ],
      experiments: [
        { task_code: "SYLU-2026-05-702", experiment_code: "SYLU-2026-05-702-A", experiment_name: "盐雾试验" },
      ],
      now: NOW,
      samples: [
        {
          code: "SP-STAGING",
          location: "恒温恒湿间（暂存间）",
          owner: "王工",
          status: "已到达暂存间",
          task_code: "SYLU-2026-05-702",
          trays: [{ tray_code: "TP-STAGING", quantity: 1, status: "已到达暂存间" }],
        },
      ],
      schedules: [
        {
          id: "schedule-staging",
          task_code: "SYLU-2026-05-702",
          experiment_code: "SYLU-2026-05-702-A",
          device: "盐雾试验室",
          start_at: "2026-05-13T09:00:00.000Z",
          end_at: "2026-05-13T11:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-05-702", name: "暂存间未出库任务", test_type: "盐雾试验" }],
    });

    const result = validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scanCode: "TP-STAGING",
      scheduleRows: view.scheduleRows,
    });

    expect(result).toEqual(expect.objectContaining({
      guidance: "请先在暂存间完成出库并送至实验室。",
      message: "托盘尚未出库",
      ok: false,
      tone: "error",
      trayCode: "TP-STAGING",
    }));
    expect(result.guidance).not.toContain("接驳间");
  });

  test("validateLaboratoryTrayScan rejects a reset tray whose unified lifecycle is back in staging", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-05-703", experiment_code: "SYLU-2026-05-703-A", tray_code: "TP-RESET-STAGING" },
      ],
      experiments: [
        { task_code: "SYLU-2026-05-703", experiment_code: "SYLU-2026-05-703-A", experiment_name: "盐雾试验" },
      ],
      now: NOW,
      samples: [
        {
          code: "SP-RESET-STAGING",
          flow_status: "已到达暂存间",
          history: [
            { action: "任务切换撤回", detail: "SYLU-2026-05-703 / 盐雾试验 / 撤回至已到达暂存间", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-05-13T10:00:00.000Z" },
          ],
          location: "恒温恒湿间（暂存间）",
          owner: "王工",
          status: "已到达暂存间",
          task_code: "SYLU-2026-05-703",
          trays: [{ tray_code: "TP-RESET-STAGING", quantity: 1, status: "已到达暂存间" }],
        },
      ],
      schedules: [
        {
          id: "schedule-reset-staging",
          task_code: "SYLU-2026-05-703",
          experiment_code: "SYLU-2026-05-703-A",
          device: "盐雾试验室",
          start_at: "2026-05-13T09:00:00.000Z",
          end_at: "2026-05-13T11:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-05-703", name: "重置回暂存间任务", test_type: "盐雾试验" }],
    });

    expect(validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scanCode: "TP-RESET-STAGING",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      guidance: "请先在暂存间完成出库并送至实验室。",
      message: "托盘尚未出库",
      ok: false,
      tone: "error",
      trayCode: "TP-RESET-STAGING",
    }));
  });

  test("validateLaboratoryTrayScan rejects current task trays that already passed comparison", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验-A" },
      ],
      now: NOW,
      samples: [
        {
          code: "SP-001",
          owner: "王工",
          status: "工装夹具安装",
          task_code: "SYLU-2026-04-101",
          trays: [{ tray_code: "TP-001", quantity: 1, status: "工装夹具安装" }],
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
      ],
      tasks: [{ code: "SYLU-2026-04-101", name: "盐雾连接器-A", test_type: "盐雾试验" }],
    });

    expect(validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scanCode: "TP-001",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      guidance: "TP-001 当前状态为工装夹具安装，已完成任务比对，无需再次比对。",
      message: "托盘已完成比对",
      ok: false,
      tone: "error",
      trayCode: "TP-001",
    }));
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

  test("buildLaboratoryWorkflowFromTask locks compare and install once any tray has entered installation", () => {
    const workflow = buildLaboratoryWorkflowFromTask({
      trayRows: [
        { trayCode: "TP-001", trayStatus: "工装夹具安装" },
        { trayCode: "TP-002", trayStatus: "送至实验室" },
      ],
    });

    expect(workflow).toEqual({
      comparisonDone: false,
      experimentConfirmed: false,
      hasCompared: true,
      hasInstalled: true,
      installationDone: false,
    });
    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    });
  });

  test("buildLaboratoryWorkflowFromTask allows compare after a partial tray experiment is completed", () => {
    const workflow = buildLaboratoryWorkflowFromTask({
      trayRows: [
        { trayCode: "TP-001", trayStatus: "实验已完成" },
        { trayCode: "TP-002", trayStatus: "送至实验室" },
      ],
    });

    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: true,
      canInstallSample: false,
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

  test("applyLaboratoryTaskStep does not downgrade completed trays back to comparison", () => {
    const updatedSamples = applyLaboratoryTaskStep({
      currentTask: {
        device: "振动一室",
        experimentName: "振动试验",
        taskCode: "SYLU-2026-05-001",
        trayCodes: ["TP-001", "TP-002"],
      },
      historyAction: "任务比对",
      nextStatus: "已到达实验室",
      now: "2026-05-25T15:05:00.000Z",
      targetTrayCodes: ["TP-001", "TP-002"],
      samples: [
        {
          code: "SP-001",
          flow_status: "实验已完成",
          history: [{ action: "实验完成", detail: "SYLU-2026-05-001 / 振动试验 / 实验已完成" }],
          location: "振动一室",
          owner: "王工",
          status: "实验已完成",
          task_code: "SYLU-2026-05-001",
          trays: [{ quantity: 1, status: "实验已完成", tray_code: "TP-001" }],
        },
        {
          code: "SP-002",
          flow_status: "送至实验室",
          history: [],
          location: "振动一室",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-05-001",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-002" }],
        },
      ],
    });

    expect(updatedSamples[0]).toEqual(expect.objectContaining({
      flow_status: "实验已完成",
      status: "实验已完成",
      trays: [expect.objectContaining({ status: "实验已完成", tray_code: "TP-001" })],
    }));
    expect(updatedSamples[0].history).toHaveLength(1);
    expect(updatedSamples[1]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "TP-002" })],
    }));
  });

  test("resetLaboratoryExperimentTrays only resets trays for the current task and experiment", () => {
    const updatedSamples = resetLaboratoryExperimentTrays({
      currentTask: {
        device: "盐雾试验室",
        experimentCode: "SYLU-2026-04-301-B",
        experimentName: "盐雾试验",
        taskCode: "SYLU-2026-04-301",
        trayCodes: ["TP-301-B"],
      },
      now: "2026-04-02T10:40:00.000Z",
      samples: [
        {
          code: "SYLU-2026-04-301-SP-001",
          flow_status: "已到达实验室",
          history: [],
          location: "高低温湿热一室",
          owner: "赵工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-301",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-301-A" }],
        },
        {
          code: "SYLU-2026-04-301-SP-002",
          flow_status: "实验准备就绪",
          history: [],
          location: "盐雾试验室",
          owner: "赵工",
          status: "实验准备就绪",
          task_code: "SYLU-2026-04-301",
          trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-301-B" }],
        },
        {
          code: "SYLU-2026-04-301-SP-003",
          flow_status: "工装夹具安装",
          history: [],
          location: "盐雾试验室",
          owner: "赵工",
          status: "工装夹具安装",
          task_code: "SYLU-2026-04-301",
          trays: [
            { quantity: 1, status: "工装夹具安装", tray_code: "TP-301-B" },
            { quantity: 1, status: "实验准备就绪", tray_code: "TP-301-C" },
          ],
        },
        {
          code: "SYLU-2026-04-401-SP-001",
          flow_status: "实验准备就绪",
          history: [],
          location: "盐雾试验室",
          owner: "王工",
          status: "实验准备就绪",
          task_code: "SYLU-2026-04-401",
          trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-401-A" }],
        },
      ],
    });

    expect(updatedSamples[0]).toEqual(expect.objectContaining({
      code: "SYLU-2026-04-301-SP-001",
      status: "已到达实验室",
      trays: [expect.objectContaining({ tray_code: "TP-301-A", status: "已到达实验室" })],
    }));
    expect(updatedSamples[1]).toEqual(expect.objectContaining({
      code: "SYLU-2026-04-301-SP-002",
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ tray_code: "TP-301-B", status: "送至实验室" })],
    }));
    expect(updatedSamples[1].history[0]).toEqual(expect.objectContaining({
      action: "实验任务重置",
      detail: "SYLU-2026-04-301 / 盐雾试验 / 送至实验室",
      status: "送至实验室",
    }));
    expect(updatedSamples[2]).toEqual(expect.objectContaining({
      code: "SYLU-2026-04-301-SP-003",
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: expect.arrayContaining([
        expect.objectContaining({ tray_code: "TP-301-B", status: "送至实验室" }),
        expect.objectContaining({ tray_code: "TP-301-C", status: "实验准备就绪" }),
      ]),
    }));
    expect(updatedSamples[3]).toEqual(expect.objectContaining({
      code: "SYLU-2026-04-401-SP-001",
      status: "实验准备就绪",
      trays: [expect.objectContaining({ tray_code: "TP-401-A", status: "实验准备就绪" })],
    }));
  });

  test("revertLaboratoryTaskToPreDispatch restores each tray to its pre-outbound location from history", () => {
    const updatedSamples = revertLaboratoryTaskToPreDispatch({
      currentTask: {
        device: "盐雾试验室",
        experimentCode: "SYLU-2026-04-501-A",
        experimentName: "盐雾试验",
        taskCode: "SYLU-2026-04-501",
        trayCodes: ["TP-STAGING", "TP-INTAKE"],
      },
      now: "2026-04-02T10:50:00.000Z",
      samples: [
        {
          code: "SYLU-2026-04-501-SP-001",
          flow_status: "已到达实验室",
          history: [
            { action: "任务比对", location: "盐雾试验室", status: "已到达实验室", time: "2026-04-02T10:40:00.000Z" },
            { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T10:20:00.000Z" },
            { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T09:10:00.000Z" },
          ],
          location: "盐雾试验室",
          owner: "王工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-501",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-STAGING" }],
        },
        {
          code: "SYLU-2026-04-501-SP-002",
          flow_status: "工装夹具安装",
          history: [
            { action: "样品安装", location: "盐雾试验室", status: "工装夹具安装", time: "2026-04-02T10:45:00.000Z" },
            { action: "接驳区扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T10:20:00.000Z" },
            { action: "任务样品入库", location: "接驳区", status: "到货", time: "2026-04-02T08:30:00.000Z" },
          ],
          location: "盐雾试验室",
          owner: "王工",
          status: "工装夹具安装",
          task_code: "SYLU-2026-04-501",
          trays: [{ quantity: 1, status: "工装夹具安装", tray_code: "TP-INTAKE" }],
        },
        {
          code: "SYLU-2026-04-502-SP-001",
          flow_status: "实验准备就绪",
          history: [],
          location: "盐雾试验室",
          owner: "李工",
          status: "实验准备就绪",
          task_code: "SYLU-2026-04-502",
          trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-B" }],
        },
      ],
    });

    expect(updatedSamples[0]).toEqual(expect.objectContaining({
      flow_status: "已到达暂存间",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      trays: [expect.objectContaining({ status: "已到达暂存间", tray_code: "TP-STAGING" })],
    }));
    expect(updatedSamples[0].history[0]).toEqual(expect.objectContaining({
      action: "任务切换撤回",
      detail: "SYLU-2026-04-501 / 盐雾试验 / 撤回至已到达暂存间",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
    }));
    expect(updatedSamples[1]).toEqual(expect.objectContaining({
      flow_status: "到货",
      location: "接驳区",
      status: "到货",
      trays: [expect.objectContaining({ status: "到货", tray_code: "TP-INTAKE" })],
    }));
    expect(updatedSamples[2]).toEqual(expect.objectContaining({
      flow_status: "实验准备就绪",
      location: "盐雾试验室",
      status: "实验准备就绪",
      trays: [expect.objectContaining({ status: "实验准备就绪", tray_code: "TP-B" })],
    }));
  });

  test("revertLaboratoryTaskToPreviousStableState restores a switched task to the previous completed experiment", () => {
    const updatedSamples = revertLaboratoryTaskToPreviousStableState({
      currentTask: {
        device: "冲击一室",
        experimentCode: "TASK-700-B",
        experimentName: "冲击试验",
        taskCode: "TASK-700",
        trayCodes: ["TP-700"],
      },
      now: "2026-04-02T11:00:00.000Z",
      samples: [
        {
          code: "TASK-700-SP-001",
          flow_status: "实验准备就绪",
          history: [
            { action: "实验确认", location: "冲击一室", status: "实验准备就绪", time: "2026-04-02T10:45:00.000Z" },
            { action: "任务比对", location: "冲击一室", status: "已到达实验室", time: "2026-04-02T10:35:00.000Z" },
            { action: "实验完成", detail: "TASK-700 / 盐雾试验 / 实验已完成", location: "盐雾试验室", status: "实验已完成", time: "2026-04-02T09:30:00.000Z" },
            { action: "暂存间扫码出库", location: "冲击一室", status: "送至实验室", time: "2026-04-02T10:20:00.000Z" },
            { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T09:10:00.000Z" },
          ],
          location: "冲击一室",
          owner: "王工",
          status: "实验准备就绪",
          task_code: "TASK-700",
          trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-700" }],
        },
      ],
    });

    expect(updatedSamples[0]).toEqual(expect.objectContaining({
      flow_status: "实验已完成",
      location: "盐雾试验室",
      status: "实验已完成",
      trays: [expect.objectContaining({ status: "实验已完成", tray_code: "TP-700" })],
    }));
    expect(updatedSamples[0].history[0]).toEqual(expect.objectContaining({
      action: "任务切换撤回",
      detail: "TASK-700 / 冲击试验 / 撤回至盐雾试验已完成",
      location: "盐雾试验室",
      status: "实验已完成",
    }));
  });

  test("revertLaboratoryTaskToPreviousStableState restores to staging arrival before current lab dispatch", () => {
    const updatedSamples = revertLaboratoryTaskToPreviousStableState({
      currentTask: {
        device: "振动一室",
        experimentCode: "TASK-701-B",
        experimentName: "振动试验",
        taskCode: "TASK-701",
        trayCodes: ["TP-701"],
      },
      now: "2026-04-02T12:00:00.000Z",
      samples: [
        {
          code: "TASK-701-SP-001",
          flow_status: "已到达实验室",
          history: [
            { action: "任务比对", detail: "TASK-701 / 振动试验 / 已到达实验室", location: "振动一室", status: "已到达实验室", time: "2026-04-02T11:35:00.000Z" },
            { action: "暂存间扫码出库", detail: "TP-701 -> 振动一室", location: "振动一室", status: "送至实验室", time: "2026-04-02T11:20:00.000Z" },
            { action: "暂存间扫码入库", detail: "TP-701 已到达暂存间", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T11:10:00.000Z" },
            { action: "实验完成", detail: "TASK-701 / 冲击试验 / 实验已完成", location: "冲击一室", status: "实验已完成", time: "2026-04-02T10:30:00.000Z" },
          ],
          location: "振动一室",
          owner: "王工",
          status: "已到达实验室",
          task_code: "TASK-701",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-701" }],
        },
      ],
    });

    expect(updatedSamples[0]).toEqual(expect.objectContaining({
      flow_status: "已到达暂存间",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      trays: [expect.objectContaining({ status: "已到达暂存间", tray_code: "TP-701" })],
    }));
    expect(updatedSamples[0].history[0]).toEqual(expect.objectContaining({
      action: "任务切换撤回",
      detail: "TASK-701 / 振动试验 / 撤回至已到达暂存间",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
    }));
  });

  test("revertLaboratoryTaskToPreviousStableState restores to appearance inspection storage before current lab dispatch", () => {
    const updatedSamples = revertLaboratoryTaskToPreviousStableState({
      currentTask: {
        device: "高低温湿热一室",
        experimentCode: "TASK-702-D",
        experimentName: "高低温湿热试验",
        taskCode: "TASK-702",
        trayCodes: ["TP-702"],
      },
      now: "2026-06-06T22:10:00.000Z",
      samples: [
        {
          code: "TASK-702-SP-001",
          flow_status: "已到达实验室",
          history: [
            { action: "任务比对", detail: "TASK-702 / 高低温湿热试验 / 已到达实验室", location: "高低温湿热一室", status: "已到达实验室", time: "2026-06-06T22:00:00.000Z" },
            { action: "外观检测间扫码出库", detail: "TP-702 送至 高低温湿热一室", location: "高低温湿热一室", status: "送至实验室", time: "2026-06-06T21:50:00.000Z" },
            { action: "外观检测间扫码入库", detail: "TP-702 外观检测间存放", location: "外观检测间", status: "外观检测间存放", time: "2026-06-06T21:40:00.000Z" },
            { action: "实验完成", detail: "TASK-702 / 霉菌试验 / 实验已完成", location: "霉菌试验室", status: "实验已完成", time: "2026-06-06T21:30:00.000Z" },
          ],
          location: "高低温湿热一室",
          owner: "王工",
          status: "已到达实验室",
          task_code: "TASK-702",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-702" }],
        },
      ],
    });

    expect(updatedSamples[0]).toEqual(expect.objectContaining({
      flow_status: "外观检测间存放",
      location: "外观检测间",
      status: "外观检测间存放",
      trays: [expect.objectContaining({ status: "外观检测间存放", tray_code: "TP-702" })],
    }));
    expect(updatedSamples[0].history[0]).toEqual(expect.objectContaining({
      action: "任务切换撤回",
      detail: "TASK-702 / 高低温湿热试验 / 撤回至外观检测间存放",
      location: "外观检测间",
      status: "外观检测间存放",
    }));
  });

  test("buildLaboratoryWorkbenchView shows the current experiment flow after a shared tray moves from impact to temperature shock", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: "TASK-SHARED", experiment_code: "EXP-IMPACT", tray_code: "TP-SHARED" },
        { task_code: "TASK-SHARED", experiment_code: "EXP-TEMP", tray_code: "TP-SHARED" },
      ],
      experiments: [
        {
          experiment_code: "EXP-IMPACT",
          experiment_name: "冲击试验",
          status: "已排程",
          task_code: "TASK-SHARED",
        },
        {
          experiment_code: "EXP-TEMP",
          experiment_name: "温度冲击试验",
          status: "已排程",
          task_code: "TASK-SHARED",
        },
      ],
      labName: "温度冲击一室",
      now: new Date("2026-06-04T12:45:00.000Z"),
      samples: [
        {
          code: "SP-SHARED",
          flow_status: "实验准备就绪",
          history: [
            {
              action: "实验完成",
              detail: "TASK-SHARED / 冲击试验 / 实验已完成",
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-06-04T11:00:00.000Z",
            },
            {
              action: "暂存间扫码出库",
              detail: "TP-SHARED -> 温度冲击一室",
              location: "温度冲击一室",
              status: "送至实验室",
              time: "2026-06-04T12:00:00.000Z",
            },
            {
              action: "任务比对",
              detail: "TASK-SHARED / 温度冲击试验 / 已到达实验室",
              location: "温度冲击一室",
              status: "已到达实验室",
              time: "2026-06-04T12:10:00.000Z",
            },
            {
              action: "样品安装",
              detail: "TASK-SHARED / 温度冲击试验 / 工装夹具安装",
              location: "温度冲击一室",
              status: "工装夹具安装",
              time: "2026-06-04T12:20:00.000Z",
            },
            {
              action: "实验确认",
              detail: "TASK-SHARED / 温度冲击试验 / 实验准备就绪",
              location: "温度冲击一室",
              status: "实验准备就绪",
              time: "2026-06-04T12:40:00.000Z",
            },
          ],
          location: "温度冲击一室",
          status: "实验准备就绪",
          task_code: "TASK-SHARED",
          trays: [
            {
              quantity: 1,
              status: "实验准备就绪",
              target_experiment_code: "EXP-TEMP",
              target_lab: "温度冲击一室",
              tray_code: "TP-SHARED",
            },
          ],
        },
      ],
      schedules: [
        {
          device: "冲击一室",
          end_at: "2026-06-04T12:00:00.000Z",
          experiment_code: "EXP-IMPACT",
          start_at: "2026-06-04T08:00:00.000Z",
          task_code: "TASK-SHARED",
        },
        {
          device: "温度冲击一室",
          end_at: "2026-06-04T16:00:00.000Z",
          experiment_code: "EXP-TEMP",
          start_at: "2026-06-04T12:30:00.000Z",
          task_code: "TASK-SHARED",
        },
      ],
      tasks: [{ code: "TASK-SHARED", name: "共享托盘任务", test_type: "冲击试验 / 温度冲击试验" }],
    });

    expect(view.currentTask.experimentCode).toBe("EXP-TEMP");
    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：TP-SHARED | 当前状态：实验准备就绪");
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至温度冲击一室")).toEqual(
      expect.objectContaining({ reached: true })
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至冲击一室")).toBeUndefined();
  });

  test("buildLaboratoryWorkbenchView keeps the next lab dispatch active after a completed experiment tray leaves post-test staging", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT",
          task_code: "TASK-STAGING-NEXT",
          experiment_code: "EXP-IMPACT",
          tray_code: "TP-STAGING-NEXT",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 14:53:33",
        },
      ],
      experimentRuns: [
        {
          run_no: "RUN-IMPACT",
          task_code: "TASK-STAGING-NEXT",
          experiment_code: "EXP-IMPACT",
          device: "冲击二室",
          status: "实验已完成",
          ended_at: "2026-06-05 14:53:33",
          tray_codes: ["TP-STAGING-NEXT"],
        },
      ],
      experimentTrays: [
        { task_code: "TASK-STAGING-NEXT", experiment_code: "EXP-IMPACT", tray_code: "TP-STAGING-NEXT" },
        { task_code: "TASK-STAGING-NEXT", experiment_code: "EXP-TEMP", tray_code: "TP-STAGING-NEXT" },
      ],
      experiments: [
        {
          experiment_code: "EXP-IMPACT",
          experiment_name: "冲击试验",
          status: "实验进行中",
          task_code: "TASK-STAGING-NEXT",
        },
        {
          experiment_code: "EXP-TEMP",
          experiment_name: "温度冲击试验",
          status: "已排程",
          task_code: "TASK-STAGING-NEXT",
        },
      ],
      labName: "温度冲击二室",
      samples: [
        {
          code: "SP-STAGING-NEXT",
          flow_status: "送至实验室",
          history: [
            {
              action: "暂存间扫码出库",
              detail: "TP-STAGING-NEXT 送至 温度冲击二室",
              location: "温度冲击二室",
              status: "送至实验室",
              time: "2026-06-05 14:55:01",
            },
            {
              action: "暂存间扫码入库",
              detail: "TP-STAGING-NEXT 已到达暂存间",
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-06-05 14:54:58",
            },
            {
              action: "实验完成",
              detail: "TASK-STAGING-NEXT / 冲击试验 / 实验已完成",
              location: "冲击二室",
              status: "实验已完成",
              time: "2026-06-05 14:53:33",
            },
            {
              action: "送至实验室",
              detail: "TP-STAGING-NEXT -> 冲击二室",
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-05 14:50:53",
            },
          ],
          location: "温度冲击二室",
          status: "送至实验室",
          task_code: "TASK-STAGING-NEXT",
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: "EXP-TEMP",
              target_lab: "温度冲击二室",
              tray_code: "TP-STAGING-NEXT",
              updated_at: "2026-06-05 14:55:01",
            },
          ],
        },
      ],
      schedules: [
        {
          device: "冲击二室",
          experiment_code: "EXP-IMPACT",
          start_at: "2026-06-05 14:46:00",
          task_code: "TASK-STAGING-NEXT",
        },
        {
          device: "温度冲击二室",
          experiment_code: "EXP-TEMP",
          start_at: "2026-06-05 14:47:00",
          task_code: "TASK-STAGING-NEXT",
        },
      ],
      selectedTrayCode: "TP-STAGING-NEXT",
      tasks: [{ code: "TASK-STAGING-NEXT", name: "共享托盘任务", test_type: "冲击试验 / 温度冲击试验" }],
    });

    expect(view.currentTask.experimentCode).toBe("EXP-TEMP");
    expect(view.selectedTrayRow).toEqual(expect.objectContaining({
      completedForOtherExperiment: true,
      completedForCurrentExperiment: false,
      targetExperimentCode: "EXP-TEMP",
    }));
    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：TP-STAGING-NEXT | 当前状态：送至温度冲击二室");
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-06-05 14:53:33" }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至温度冲击二室")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-05 14:55:01" }),
    );
  });

  test("blocks mold comparison when a tray completed impact and has been dispatched to temperature shock", () => {
    const taskCode = "SYLU-2026-06-022";
    const trayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          run_no: "run-impact-002",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          status: "实验已完成",
          started_at: "2026-06-05 18:54:19",
          ended_at: "2026-06-05 18:54:27",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      experiments: [
        {
          experiment_code: `${taskCode}-A`,
          experiment_name: "冲击试验",
          status: "实验进行中",
          task_code: taskCode,
        },
        {
          experiment_code: `${taskCode}-B`,
          experiment_name: "霉菌试验",
          status: "已排程",
          task_code: taskCode,
        },
        {
          experiment_code: `${taskCode}-C`,
          experiment_name: "温度冲击试验",
          status: "已排程",
          task_code: taskCode,
        },
      ],
      labName: "霉菌试验室",
      samples: [
        {
          code: `${taskCode}-SP-007`,
          flow_status: "送至实验室",
          history: [
            {
              action: "暂存间扫码出库",
              detail: `${trayCode} 送至 温度冲击一室`,
              location: "温度冲击一室",
              status: "送至实验室",
              time: "2026-06-05 18:55:08",
            },
            {
              action: "暂存间扫码入库",
              detail: `${trayCode} 已到达暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-06-05 18:54:54",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 实验已完成`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-06-05 18:54:27",
            },
          ],
          location: "温度冲击一室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: `${taskCode}-C`,
              target_lab: "温度冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "霉菌试验室",
          experiment_code: `${taskCode}-B`,
          start_at: "2026-06-06 12:00:00",
          task_code: taskCode,
        },
        {
          device: "温度冲击一室",
          experiment_code: `${taskCode}-C`,
          start_at: "2026-06-07 08:00:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "复合实验任务", test_type: "冲击试验 / 霉菌试验 / 温度冲击试验" }],
    });

    expect(view.currentTask.experimentCode).toBe(`${taskCode}-B`);
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：送至温度冲击一室`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至温度冲击一室")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-05 18:55:08" }),
    );
    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(view.currentTask))).toEqual({
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    });
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "托盘未送达当前试验间",
      ok: false,
      trayCode,
    }));
  });

  test("keeps mold comparison available for a dispatched tray when another tray runs salt spray", () => {
    const taskCode = "SYLU-2026-06-022";
    const moldTrayCode = `${taskCode}-TP-001`;
    const saltTrayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-salt-002",
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          device: "盐雾试验室",
          status: "实验进行中",
          started_at: "2026-06-06 13:44:20",
          tray_codes: [saltTrayCode],
        },
      ],
      experimentRunTrays: [
        {
          run_no: "run-four-001",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: moldTrayCode,
          run_tray_status: "实验已完成",
          status: "实验已完成",
          started_at: "2026-06-06 13:42:55",
          ended_at: "2026-06-06 13:43:11",
        },
        {
          run_no: "run-four-001",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: saltTrayCode,
          run_tray_status: "实验已完成",
          status: "实验已完成",
          started_at: "2026-06-06 13:42:55",
          ended_at: "2026-06-06 13:43:11",
        },
        {
          run_no: "run-salt-002",
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          tray_code: saltTrayCode,
          run_tray_status: "实验进行中",
          status: "实验进行中",
          started_at: "2026-06-06 13:44:20",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: moldTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: saltTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: moldTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: saltTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: moldTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: saltTrayCode },
      ],
      experiments: [
        {
          experiment_code: `${taskCode}-A`,
          experiment_name: "四综合试验",
          status: "实验已完成",
          task_code: taskCode,
        },
        {
          experiment_code: `${taskCode}-B`,
          experiment_name: "盐雾试验",
          status: "实验进行中",
          task_code: taskCode,
        },
        {
          experiment_code: `${taskCode}-C`,
          experiment_name: "霉菌试验",
          status: "实验进行中",
          task_code: taskCode,
        },
      ],
      labName: "霉菌试验室",
      now: new Date("2026-06-06T13:45:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "送至实验室",
          history: [
            {
              action: "暂存间扫码出库",
              detail: `${moldTrayCode} 送至 霉菌试验室`,
              location: "霉菌试验室",
              status: "送至实验室",
              time: "2026-06-06 13:44:28",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-06-06 13:43:11",
            },
          ],
          location: "霉菌试验室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: `${taskCode}-C`,
              target_lab: "霉菌试验室",
              tray_code: moldTrayCode,
            },
          ],
        },
        {
          code: `${taskCode}-SP-002`,
          flow_status: "实验进行中",
          location: "盐雾试验室",
          status: "实验进行中",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验进行中",
              target_lab: "四综合实验室",
              tray_code: saltTrayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "霉菌试验室",
          experiment_code: `${taskCode}-C`,
          start_at: "2026-06-06 13:40:00",
          task_code: taskCode,
        },
        {
          device: "盐雾试验室",
          experiment_code: `${taskCode}-B`,
          start_at: "2026-06-06 13:40:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: moldTrayCode,
      tasks: [{ code: taskCode, name: "演示任务001", test_type: "四综合试验 / 盐雾试验 / 霉菌试验" }],
    });

    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(view.currentTask.experimentCode).toBe(`${taskCode}-C`);
    expect(view.currentTask.trayRows.find((row) => row.trayCode === moldTrayCode)).toEqual(
      expect.objectContaining({
        targetExperimentCode: `${taskCode}-C`,
        targetLab: "霉菌试验室",
        trayStatus: "送至实验室",
      }),
    );
    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: true,
      canInstallSample: false,
      canMarkReady: false,
    });
    expect(buildLaboratoryProgressMessage(workflow, view.currentTask, "霉菌试验室")).toBe(
      `当前任务 ${taskCode} 待开始任务比对`,
    );
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: moldTrayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode: moldTrayCode,
    }));
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: saltTrayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "托盘正在其他实验中",
      ok: false,
      trayCode: saltTrayCode,
    }));
  });

  test("shows staging arrival after a shared tray completes another experiment before the next lab dispatch", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-002`;
    const baseInput = {
      experimentRunTrays: [
        {
          run_no: "run-mold-002",
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          status: "实验已完成",
          started_at: "2026-06-05 19:19:42",
          ended_at: "2026-06-05 19:20:01",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      experiments: [
        {
          experiment_code: `${taskCode}-A`,
          experiment_name: "冲击试验",
          status: "已排程",
          task_code: taskCode,
        },
        {
          experiment_code: `${taskCode}-B`,
          experiment_name: "霉菌试验",
          status: "实验进行中",
          task_code: taskCode,
        },
        {
          experiment_code: `${taskCode}-C`,
          experiment_name: "温度冲击试验",
          status: "已排程",
          task_code: taskCode,
        },
      ],
      labName: "温度冲击一室",
      samples: [
        {
          code: `${taskCode}-SP-007`,
          flow_status: "已到达暂存间",
          history: [
            {
              action: "暂存间扫码入库",
              detail: `${trayCode} 已到达暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-06-05 19:20:18",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 霉菌试验 / 实验已完成`,
              location: "霉菌试验室",
              status: "实验已完成",
              time: "2026-06-05 19:20:01",
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 霉菌试验 / 已到达实验室`,
              location: "霉菌试验室",
              status: "已到达实验室",
              time: "2026-06-05 19:19:21",
            },
          ],
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达暂存间",
              target_experiment_code: `${taskCode}-B`,
              target_lab: "霉菌试验室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "冲击一室",
          experiment_code: `${taskCode}-A`,
          start_at: "2026-06-06 08:00:00",
          task_code: taskCode,
        },
        {
          device: "温度冲击一室",
          experiment_code: `${taskCode}-C`,
          start_at: "2026-06-07 08:00:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "复合实验任务", test_type: "冲击试验 / 霉菌试验 / 温度冲击试验" }],
    };

    [
      { experimentCode: `${taskCode}-A`, labName: "冲击一室" },
      { experimentCode: `${taskCode}-C`, labName: "温度冲击一室" },
    ].forEach(({ experimentCode, labName }) => {
      const view = buildLaboratoryWorkbenchView({ ...baseInput, labName });

      expect(view.currentTask.experimentCode).toBe(experimentCode);
      expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：已到达暂存间`);
      expect(view.selectedTrayFlow.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(
        expect.objectContaining({ reached: true, time: "2026-06-05 19:20:01" }),
      );
      expect(view.selectedTrayFlow.steps.find((step) => step.label === "已到达暂存间")).toEqual(
        expect.objectContaining({ active: true, time: "2026-06-05 19:20:18" }),
      );
      expect(validateLaboratoryTrayScan({
        allScheduleRows: view.allScheduleRows,
        currentTask: view.currentTask,
        scanCode: trayCode,
        scheduleRows: view.scheduleRows,
      })).toEqual(expect.objectContaining({
        message: "托盘尚未出库",
        ok: false,
        trayCode,
      }));
    });
  });

  test("revertLaboratoryTaskToPreviousStableState keeps running trays locked unless explicitly allowed", () => {
    const samples = [
      {
        code: "TASK-701-SP-001",
        flow_status: "实验进行中",
        history: [
          { action: "实验完成", detail: "TASK-701 / 盐雾试验 / 实验已完成", location: "盐雾试验室", status: "实验已完成", time: "2026-04-02T09:30:00.000Z" },
        ],
        location: "冲击一室",
        status: "实验进行中",
        task_code: "TASK-701",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-701" }],
      },
    ];
    const currentTask = {
      experimentName: "冲击试验",
      taskCode: "TASK-701",
      trayCodes: ["TP-701"],
    };

    const defaultRollback = revertLaboratoryTaskToPreviousStableState({
      currentTask,
      now: "2026-04-02T11:00:00.000Z",
      samples,
    });
    const equipmentRepairRollback = revertLaboratoryTaskToPreviousStableState({
      allowRunningRevert: true,
      currentTask,
      now: "2026-04-02T11:00:00.000Z",
      samples,
    });

    expect(defaultRollback[0].status).toBe("实验进行中");
    expect(defaultRollback[0].trays[0].status).toBe("实验进行中");
    expect(equipmentRepairRollback[0]).toEqual(expect.objectContaining({
      flow_status: "实验已完成",
      location: "盐雾试验室",
      status: "实验已完成",
      trays: [expect.objectContaining({ status: "实验已完成", tray_code: "TP-701" })],
    }));
  });
});
