import { describe, expect, test } from "vitest";

import {
  applyLaboratoryTaskStep,
  buildLaboratorySummary,
  buildLaboratoryProgressMessage,
  buildLaboratoryWorkflowFromTask,
  buildSaltSprayLaboratoryView,
  completeLaboratoryComparison,
  completeLaboratoryInstallation,
  confirmLaboratoryExperiment,
  createLaboratoryWorkflow,
  getLaboratoryActionState,
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
          location: "接驳区",
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
});
