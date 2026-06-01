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

    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：TP-LAG | 当前状态：送至实验室");
    expect(view.selectedTrayFlow.steps.find((step) => step.key === "sent_to_lab")).toEqual(expect.objectContaining({
      active: true,
      label: "送至温度冲击一室",
    }));
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
          trays: [{ tray_code: "TP-303", quantity: 1, status: "送至实验室" }],
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
