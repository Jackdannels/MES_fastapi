import { afterEach, describe, expect, test } from "vitest";

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
import { getLegacyFallbackHits, resetLegacyFallbackHits } from "@/lib/legacyFallback";
import { formatBusinessDateTime, formatBusinessTime } from "@/lib/dateTime";

const NOW = new Date("2026-04-02T10:00:00.000Z");
const toDisplayedTime = (value) => formatBusinessTime(value);
const toDisplayedDateTime = (value) => formatBusinessDateTime(value);

describe("laboratory model", () => {
  afterEach(() => {
    resetLegacyFallbackHits();
  });

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
    expect(view.allScheduleRows.map((row) => row.device)).toEqual(expect.arrayContaining(["振动一室", "盐雾试验室"]));
    expect(view.currentTask).toEqual(expect.objectContaining({
      taskCode: "SYLU-2026-04-102",
      experimentName: "振动试验",
      owner: "周工",
    }));
  });

  test("buildLaboratoryWorkbenchView carries sub experiment code for an axis schedule row", () => {
    const view = buildLaboratoryWorkbenchView({
      experiments: [
        {
          task_code: "SYLU-2026-06-204",
          experiment_code: "SYLU-2026-06-204-A",
          experiment_name: "振动试验",
          axis_codes: ["z+", "z-"],
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-204", experiment_code: "SYLU-2026-06-204-A", tray_code: "TP-VIB-204" },
      ],
      labName: "振动一室",
      now: NOW,
      samples: [
        {
          code: "SYLU-2026-06-204-SP-001",
          location: "振动一室",
          status: "送至实验室",
          task_code: "SYLU-2026-06-204",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-VIB-204" }],
        },
      ],
      schedules: [
        {
          id: "schedule-vibration-z",
          task_code: "SYLU-2026-06-204",
          experiment_code: "SYLU-2026-06-204-A",
          device: "振动一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
          sub_experiment_code: "vibration-axis-batch-z",
          axis_codes: ["z+", "z-"],
        },
      ],
      tasks: [{ code: "SYLU-2026-06-204", name: "振动轴向任务", test_type: "振动试验" }],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      subExperimentCode: "vibration-axis-batch-z",
      sub_experiment_code: "vibration-axis-batch-z",
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

  test("buildLaboratoryWorkbenchView hides an axis schedule when every tray is completed or returned", () => {
    const taskCode = "SYLU-2026-07-028";
    const experimentCode = `${taskCode}-A`;
    const scheduleId = "schedule-impact-axis-001";
    const subExperimentCode = `${experimentCode}-AXIS-001`;
    const completedTrayCode = `${taskCode}-TP-001`;
    const returnedTrayCode = `${taskCode}-TP-002`;
    const axisCodes = ["y-", "z+", "z-"];
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          axis_codes: axisCodes,
          ended_at: "2026-07-02 15:18:00",
          experiment_code: experimentCode,
          run_no: "RUN-IMPACT-TP001",
          schedule_id: scheduleId,
          status: "实验已完成",
          sub_experiment_code: subExperimentCode,
          task_code: taskCode,
          tray_codes: [completedTrayCode],
        },
      ],
      experimentRunSteps: axisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: experimentCode,
        run_no: "RUN-IMPACT-TP001",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: subExperimentCode,
        task_code: taskCode,
      })),
      experimentRunTrays: [
        {
          ended_at: "2026-07-02 15:18:00",
          experiment_code: experimentCode,
          run_no: "RUN-IMPACT-TP001",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: subExperimentCode,
          task_code: taskCode,
          tray_code: completedTrayCode,
        },
        {
          ended_at: "2026-07-02 15:19:00",
          experiment_code: experimentCode,
          run_no: `RETURNED-${subExperimentCode}`,
          run_tray_status: "厂家收回",
          status: "厂家收回",
          task_code: taskCode,
          tray_code: returnedTrayCode,
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: completedTrayCode },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: returnedTrayCode },
      ],
      experiments: [
        {
          axis_codes: ["y-", "z+", "z-", "x+", "x-", "y+"],
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
        },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "冲击一室",
          status: "实验已完成",
          trays: [{ tray_code: completedTrayCode, status: "实验已完成", quantity: 1 }],
        },
        {
          code: `${taskCode}-SP-002`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: returnedTrayCode, status: "厂家收回", quantity: 1 }],
        },
      ],
      schedules: [
        {
          axis_codes: axisCodes,
          device: "冲击一室",
          end_at: "2026-07-02 18:48:00",
          experiment_code: experimentCode,
          id: scheduleId,
          start_at: "2026-07-02 15:18:00",
          status: "实验进行中",
          sub_experiment_code: subExperimentCode,
          task_code: taskCode,
        },
      ],
      tasks: [{ code: taskCode, name: "轴向混合终态任务", test_type: "冲击试验" }],
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

  test("buildLaboratoryWorkbenchView does not derive tray row status from sample status when tray status is missing", () => {
    resetLegacyFallbackHits();
    const taskCode = "TASK-SAMPLE-STATUS-FALLBACK";
    const experimentCode = "EXP-MOLD-FALLBACK";
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: "TP-001" },
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
          status: "已到达实验室",
          trays: [{ tray_code: "TP-001", quantity: 1 }],
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
      tasks: [{ code: taskCode, name: "样品状态旧兜底记录", test_type: "霉菌试验" }],
    });

    expect(view.currentExperimentTrayRows).toEqual([
      expect.objectContaining({
        displayStatus: "",
        trayCode: "TP-001",
        trayStatus: "",
      }),
    ]);
    expect(getLegacyFallbackHits()).toEqual([]);
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

  test("running tray from another experiment does not block installing a compared tray in the current experiment", () => {
    const view = buildLaboratoryWorkbenchView({
      experiments: [
        {
          experiment_code: "TASK-MULTI-A",
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
          status: "实验进行中",
          task_code: "TASK-MULTI",
        },
        {
          experiment_code: "TASK-MULTI-B",
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          status: "已排程",
          task_code: "TASK-MULTI",
        },
      ],
      experimentRuns: [
        {
          experiment_code: "TASK-MULTI-A",
          run_no: "RUN-SALT-001",
          status: "实验进行中",
          task_code: "TASK-MULTI",
          tray_codes: ["TASK-MULTI-TP-001"],
        },
      ],
      experimentRunTrays: [
        {
          experiment_code: "TASK-MULTI-A",
          run_no: "RUN-SALT-001",
          run_tray_status: "实验进行中",
          status: "实验进行中",
          task_code: "TASK-MULTI",
          tray_code: "TASK-MULTI-TP-001",
        },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: "TASK-MULTI-SP-001",
          history: [
            { action: "任务比对", detail: "TASK-MULTI / 盐雾试验 / 实验进行中", location: "盐雾试验室", status: "实验进行中", time: "2026-04-02T09:00:00.000Z" },
          ],
          location: "盐雾试验室",
          owner: "王工",
          status: "实验进行中",
          task_code: "TASK-MULTI",
          trays: [
            {
              quantity: 1,
              status: "实验进行中",
              target_experiment_code: "TASK-MULTI-A",
              target_lab: "盐雾试验室",
              tray_code: "TASK-MULTI-TP-001",
            },
          ],
        },
        {
          code: "TASK-MULTI-SP-002",
          history: [
            { action: "任务比对", detail: "TASK-MULTI / 冲击试验 / 已到达实验室", location: "冲击一室", status: "已到达实验室", time: "2026-04-02T09:05:00.000Z" },
          ],
          location: "冲击一室",
          owner: "王工",
          status: "已到达实验室",
          task_code: "TASK-MULTI",
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: "TASK-MULTI-B",
              target_lab: "冲击一室",
              tray_code: "TASK-MULTI-TP-002",
            },
          ],
        },
      ],
      schedules: [
        {
          device: "冲击一室",
          end_at: "2026-04-02T11:00:00.000Z",
          experiment_code: "TASK-MULTI-B",
          id: "SCH-IMPACT",
          start_at: "2026-04-02T09:00:00.000Z",
          task_code: "TASK-MULTI",
        },
        {
          device: "盐雾试验室",
          end_at: "2026-04-02T11:00:00.000Z",
          experiment_code: "TASK-MULTI-A",
          id: "SCH-SALT",
          start_at: "2026-04-02T09:00:00.000Z",
          task_code: "TASK-MULTI",
        },
      ],
      tasks: [{ code: "TASK-MULTI", name: "多实验任务", test_type: "盐雾试验 / 冲击试验" }],
    });

    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(workflow.hasComparedWaitingInstall).toBe(true);
    expect(workflow.hasInProgressPreparation).toBe(false);
    expect(getLaboratoryActionState(workflow).canInstallSample).toBe(true);
    expect(getLaboratoryOperationLock(view.allScheduleRows, view.currentTask, { name: "冲击一室" })).toEqual({ active: false });
  });

  test("compared trays in different laboratories of the same task can both install fixtures", () => {
    const taskCode = "TASK-DUAL-COMPARED";
    const impactTrayCode = `${taskCode}-TP-001`;
    const saltTrayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      experiments: [
        {
          experiment_code: `${taskCode}-A`,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          status: "已排程",
          task_code: taskCode,
        },
        {
          experiment_code: `${taskCode}-B`,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
          status: "已排程",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: impactTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: saltTrayCode },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            { action: "任务比对", detail: `${taskCode} / 冲击试验 / 已到达实验室`, location: "冲击一室", status: "已到达实验室", time: "2026-04-02T09:05:00.000Z" },
          ],
          location: "冲击一室",
          owner: "王工",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: `${taskCode}-A`,
              target_lab: "冲击一室",
              tray_code: impactTrayCode,
            },
          ],
        },
        {
          code: `${taskCode}-SP-002`,
          history: [
            { action: "任务比对", detail: `${taskCode} / 盐雾试验 / 已到达实验室`, location: "盐雾试验室", status: "已到达实验室", time: "2026-04-02T09:06:00.000Z" },
          ],
          location: "盐雾试验室",
          owner: "李工",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: `${taskCode}-B`,
              target_lab: "盐雾试验室",
              tray_code: saltTrayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "冲击一室",
          end_at: "2026-04-02T11:00:00.000Z",
          experiment_code: `${taskCode}-A`,
          id: "SCH-IMPACT-COMPARED",
          start_at: "2026-04-02T09:00:00.000Z",
          task_code: taskCode,
        },
        {
          device: "盐雾试验室",
          end_at: "2026-04-02T11:00:00.000Z",
          experiment_code: `${taskCode}-B`,
          id: "SCH-SALT-COMPARED",
          start_at: "2026-04-02T09:00:00.000Z",
          task_code: taskCode,
        },
      ],
      tasks: [{ code: taskCode, name: "双实验室已比对任务", test_type: "冲击试验 / 盐雾试验" }],
    });
    const impactTask = view.allScheduleRows.find((row) => row.experimentCode === `${taskCode}-A`);
    const saltTask = view.allScheduleRows.find((row) => row.experimentCode === `${taskCode}-B`);

    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(impactTask)).canInstallSample).toBe(true);
    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(saltTask)).canInstallSample).toBe(true);
    expect(getLaboratoryOperationLock(view.allScheduleRows, impactTask, { name: "冲击一室" })).toEqual({ active: false });
    expect(getLaboratoryOperationLock(view.allScheduleRows, saltTask, { name: "盐雾试验室" })).toEqual({ active: false });
  });

  test("compared trays without stored targets stay scoped by their current laboratory location", () => {
    const taskCode = "TASK-DUAL-NO-TARGET";
    const impactTrayCode = `${taskCode}-TP-001`;
    const saltTrayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      experiments: [
        { experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", status: "已排程", task_code: taskCode },
        { experiment_code: `${taskCode}-B`, experiment_name: "盐雾试验", status: "已排程", task_code: taskCode },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: impactTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: saltTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: impactTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: saltTrayCode },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            { action: "任务比对", detail: `${taskCode} / 冲击试验 / 已到达实验室`, location: "冲击一室", status: "已到达实验室", time: "2026-04-02T09:05:00.000Z" },
          ],
          location: "冲击一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: impactTrayCode }],
        },
        {
          code: `${taskCode}-SP-002`,
          history: [
            { action: "任务比对", detail: `${taskCode} / 盐雾试验 / 已到达实验室`, location: "盐雾试验室", status: "已到达实验室", time: "2026-04-02T09:06:00.000Z" },
          ],
          location: "盐雾试验室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: saltTrayCode }],
        },
      ],
      schedules: [
        { device: "冲击一室", experiment_code: `${taskCode}-A`, start_at: "2026-04-02T09:00:00.000Z", task_code: taskCode },
        { device: "盐雾试验室", experiment_code: `${taskCode}-B`, start_at: "2026-04-02T09:00:00.000Z", task_code: taskCode },
      ],
      tasks: [{ code: taskCode, name: "无目标字段双实验任务", test_type: "冲击试验 / 盐雾试验" }],
    });
    const impactTask = view.allScheduleRows.find((row) => row.experimentCode === `${taskCode}-A`);
    const saltTask = view.allScheduleRows.find((row) => row.experimentCode === `${taskCode}-B`);

    expect(buildLaboratoryWorkflowFromTask(impactTask).hasComparedWaitingInstall).toBe(true);
    expect(buildLaboratoryWorkflowFromTask(saltTask).hasComparedWaitingInstall).toBe(true);
    expect(getLaboratoryOperationLock(view.allScheduleRows, impactTask, { name: "冲击一室" })).toEqual({ active: false });
    expect(getLaboratoryOperationLock(view.allScheduleRows, saltTask, { name: "盐雾试验室" })).toEqual({ active: false });
  });

  test("blocks comparison in another laboratory while the shared tray is already compared in its target laboratory", () => {
    const taskCode = "SYLU-2026-07-022";
    const trayCode = `${taskCode}-TP-001`;
    const moldView = buildLaboratoryWorkbenchView({
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
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
      ],
      experimentRunTrays: [
        {
          experiment_code: `${taskCode}-A`,
          run_no: "run-impact-axis-001",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: `${taskCode}-A`, task_code: taskCode, tray_code: trayCode },
        { experiment_code: `${taskCode}-B`, task_code: taskCode, tray_code: trayCode },
      ],
      labName: "霉菌试验室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "冲击一室",
              status: "已到达实验室",
              time: "2026-07-02T10:37:25.000Z",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 5/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 5/6轴",
              time: "2026-07-02T10:36:46.000Z",
            },
          ],
          location: "冲击一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: `${taskCode}-A`,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "冲击一室",
          experiment_code: `${taskCode}-A`,
          id: "schedule-impact-axis-remaining",
          start_at: "2026-07-03T04:00:00.000Z",
          task_code: taskCode,
        },
        {
          device: "霉菌试验室",
          experiment_code: `${taskCode}-B`,
          id: "schedule-mold",
          start_at: "2026-07-03T00:00:00.000Z",
          task_code: taskCode,
        },
      ],
      tasks: [{ code: taskCode, name: "冲击后霉菌任务", test_type: "冲击试验 / 霉菌试验" }],
    });

    const result = validateLaboratoryTrayScan({
      allScheduleRows: moldView.allScheduleRows,
      currentTask: moldView.currentTask,
      scanCode: trayCode,
      scheduleRows: moldView.scheduleRows,
    });

    expect(result).toEqual(expect.objectContaining({
      guidance: `${trayCode} 已出库至冲击一室，请先出库至霉菌试验室后再比对。`,
      message: "托盘未送达当前试验间",
      ok: false,
      tone: "error",
    }));
  });

  test("operation lock blocks another task while a lab task is past comparison and before reset", () => {
    const lockedRow = {
      device: "盐雾试验室",
      experimentKey: "SYLU-2026-04-101::SYLU-2026-04-101-A",
      experimentName: "盐雾试验-A",
      taskCode: "SYLU-2026-04-101",
      trayRows: [{ trayCode: "TP-001", trayStatus: "已到达实验室" }],
    };
    const otherRow = {
      device: "盐雾试验室",
      experimentKey: "SYLU-2026-04-201::SYLU-2026-04-201-A",
      experimentName: "盐雾试验-B",
      taskCode: "SYLU-2026-04-201",
      trayRows: [{ trayCode: "TP-101", trayStatus: "送至实验室" }],
    };
    const otherLabRow = {
      device: "振动一室",
      experimentKey: "SYLU-2026-04-301::SYLU-2026-04-301-A",
      experimentName: "振动试验",
      taskCode: "SYLU-2026-04-301",
      trayRows: [{ trayCode: "TP-301", trayStatus: "已到达实验室" }],
    };

    expect(getLaboratoryOperationLock([lockedRow, otherRow], otherRow, { name: "盐雾试验室" })).toEqual(expect.objectContaining({
      active: true,
      experimentKey: "SYLU-2026-04-101::SYLU-2026-04-101-A",
      taskCode: "SYLU-2026-04-101",
    }));
    expect(getLaboratoryOperationLock([lockedRow, otherRow], lockedRow, { name: "盐雾试验室" })).toEqual({ active: false });
    expect(getLaboratoryOperationLock([{ ...lockedRow, trayRows: [{ trayCode: "TP-001", trayStatus: "送至实验室" }] }, otherRow], otherRow, { name: "盐雾试验室" })).toEqual({ active: false });
    expect(getLaboratoryOperationLock([lockedRow, otherLabRow], otherLabRow, { name: "振动一室" })).toEqual({ active: false });
  });

  test("operation lock allows every main laboratory to compare different trays at the same time", () => {
    const mainLabs = [
      "冲击二室",
      "冲击一室",
      "高低温湿热一室",
      "霉菌试验室",
      "四综合实验室",
      "温度冲击二室",
      "温度冲击一室",
      "盐雾试验室",
      "振动二室",
      "振动一室",
    ];
    const startedRows = mainLabs.map((device, index) => ({
      device,
      experimentCode: `EXP-STARTED-${index + 1}`,
      experimentKey: `TASK-STARTED-${index + 1}::EXP-STARTED-${index + 1}`,
      experimentName: `${device}进行中任务`,
      taskCode: `TASK-STARTED-${index + 1}`,
      trayRows: [{ trayCode: `TP-STARTED-${index + 1}`, trayStatus: "已到达实验室" }],
    }));

    mainLabs.forEach((device, index) => {
      const candidate = {
        device,
        experimentCode: `EXP-CANDIDATE-${index + 1}`,
        experimentKey: `TASK-CANDIDATE-${index + 1}::EXP-CANDIDATE-${index + 1}`,
        experimentName: `${device}待比对任务`,
        taskCode: `TASK-CANDIDATE-${index + 1}`,
        trayRows: [{ trayCode: `TP-CANDIDATE-${index + 1}`, trayStatus: "送至实验室" }],
      };
      const otherLabRows = startedRows.filter((row) => row.device !== device);

      expect(getLaboratoryOperationLock([...otherLabRows, candidate], candidate, { name: device })).toEqual({ active: false });
      expect(getLaboratoryOperationLock([...startedRows, candidate], candidate, { name: device })).toEqual(expect.objectContaining({
        active: true,
        taskCode: `TASK-STARTED-${index + 1}`,
      }));
    });
  });

  test("operation lock uses the current task laboratory instead of falling back to a global lock", () => {
    const saltStarted = {
      device: "盐雾试验室",
      experimentCode: "EXP-SALT-1",
      experimentKey: "TASK-SALT-1::EXP-SALT-1",
      experimentName: "盐雾试验进行中",
      taskCode: "TASK-SALT-1",
      trayRows: [{ trayCode: "TP-SALT-1", trayStatus: "已到达实验室" }],
    };
    const vibrationCandidate = {
      device: "振动一室",
      experimentCode: "EXP-VIB-1",
      experimentKey: "TASK-VIB-1::EXP-VIB-1",
      experimentName: "振动试验待比对",
      taskCode: "TASK-VIB-1",
      trayRows: [{ trayCode: "TP-VIB-1", trayStatus: "送至实验室" }],
    };

    expect(getLaboratoryOperationLock([saltStarted, vibrationCandidate], vibrationCandidate)).toEqual({ active: false });
  });

  test("operation lock blocks a different laboratory when the same tray is already in an operation stage", () => {
    const saltStarted = {
      device: "盐雾试验室",
      experimentCode: "EXP-SALT-1",
      experimentKey: "TASK-SALT-1::EXP-SALT-1",
      experimentName: "盐雾试验进行中",
      taskCode: "TASK-SALT-1",
      trayRows: [{ trayCode: "TP-001", trayStatus: "已到达实验室" }],
    };
    const vibrationSameTray = {
      device: "振动一室",
      experimentCode: "EXP-VIB-1",
      experimentKey: "TASK-VIB-1::EXP-VIB-1",
      experimentName: "振动试验待比对",
      taskCode: "TASK-VIB-1",
      trayRows: [{ trayCode: "TP-001", trayStatus: "送至实验室" }],
    };
    const vibrationDifferentTray = {
      ...vibrationSameTray,
      experimentKey: "TASK-VIB-2::EXP-VIB-2",
      taskCode: "TASK-VIB-2",
      trayRows: [{ trayCode: "TP-201", trayStatus: "送至实验室" }],
    };

    expect(getLaboratoryOperationLock([saltStarted, vibrationSameTray], vibrationSameTray, { name: "振动一室" })).toEqual(expect.objectContaining({
      active: true,
      taskCode: "TASK-SALT-1",
    }));
    expect(getLaboratoryOperationLock([saltStarted, vibrationDifferentTray], vibrationDifferentTray, { name: "振动一室" })).toEqual({ active: false });
  });

  test("operation lock ignores an old shared-tray experiment after the tray is dispatched to the current laboratory", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-004`;
    const impactGhost = {
      device: "冲击一室",
      experimentCode: `${taskCode}-A`,
      experimentKey: `${taskCode}::${taskCode}-A`,
      experimentName: "冲击试验",
      taskCode,
      trayRows: [
        {
          completedForOtherExperiment: true,
          targetExperimentCode: `${taskCode}-D`,
          targetLab: "振动一室",
          trayCode,
          trayStatus: "已到达实验室",
        },
      ],
    };
    const vibrationCurrent = {
      device: "振动一室",
      experimentCode: `${taskCode}-D`,
      experimentKey: `${taskCode}::${taskCode}-D`,
      experimentName: "振动试验",
      taskCode,
      trayRows: [
        {
          completedForOtherExperiment: true,
          targetExperimentCode: `${taskCode}-D`,
          targetLab: "振动一室",
          trayCode,
          trayStatus: "已到达实验室",
        },
      ],
    };

    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(vibrationCurrent)).canInstallSample).toBe(true);
    expect(getLaboratoryOperationLock([impactGhost, vibrationCurrent], vibrationCurrent, { name: "振动一室" })).toEqual({ active: false });
  });

  test("withdrawal does not promote a later shared-tray experiment ahead of the next schedule", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      labName: "振动一室",
      selectedTaskCode: `${taskCode}::${taskCode}-D`,
      tasks: [{ code: taskCode, name: "撤回后重进试验任务" }],
      schedules: [
        {
          id: "schedule-vibration",
          task_code: taskCode,
          experiment_code: `${taskCode}-D`,
          device: "振动一室",
          start_at: "2026-06-12 15:13:00",
          end_at: "2026-06-12 18:43:00",
        },
        {
          id: "schedule-salt",
          task_code: taskCode,
          experiment_code: `${taskCode}-C`,
          device: "盐雾试验室",
          start_at: "2026-06-12 15:13:00",
          end_at: "2026-06-12 18:43:00",
        },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "盐雾试验", status: "实验进行中" },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, experiment_name: "振动试验", status: "已排程" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, tray_code: trayCode },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "振动一室",
          owner: "周工",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: trayCode }],
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 振动试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "振动一室",
              status: "已到达实验室",
              time: "2026-06-12 15:19:15",
              tray_code: trayCode,
            },
            {
              action: "任务切换撤回",
              detail: `${taskCode} / 盐雾试验 / 撤回至冲击试验已完成（试验间内撤回当前实验任务）`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-06-12 15:19:08",
              tray_code: trayCode,
            },
            {
              action: "样品安装",
              detail: `${taskCode} / 盐雾试验 / 工装夹具安装 / 托盘：${trayCode}`,
              location: "盐雾试验室",
              status: "工装夹具安装",
              time: "2026-06-12 15:19:04",
              tray_code: trayCode,
            },
          ],
        },
      ],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(getLaboratoryActionState(workflow).canInstallSample).toBe(false);
  });

  test("operation lock ignores a withdrawn old experiment when run trays exclude the current tray", () => {
    const taskCode = "SYLU-2026-06-021";
    const saltTrayCode = `${taskCode}-TP-001`;
    const vibrationTrayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      labName: "振动一室",
      selectedTaskCode: `${taskCode}::${taskCode}-D`,
      tasks: [{ code: taskCode, name: "撤回后进入振动试验" }],
      schedules: [
        {
          id: "schedule-salt",
          task_code: taskCode,
          experiment_code: `${taskCode}-C`,
          device: "盐雾试验室",
          start_at: "2026-06-12 15:13:00",
          end_at: "2026-06-12 18:43:00",
        },
        {
          id: "schedule-vibration",
          task_code: taskCode,
          experiment_code: `${taskCode}-D`,
          device: "振动一室",
          start_at: "2026-06-12 15:13:00",
          end_at: "2026-06-12 18:43:00",
        },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "盐雾试验", status: "实验进行中" },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, experiment_name: "振动试验", status: "已排程" },
      ],
      experimentRuns: [
        {
          run_no: "run-salt-c",
          task_code: taskCode,
          experiment_code: `${taskCode}-C`,
          device: "盐雾试验室",
          status: "实验进行中",
          started_at: "2026-06-12 15:18:50",
          tray_codes: [saltTrayCode, vibrationTrayCode],
        },
      ],
      experimentRunTrays: [
        {
          run_no: "run-salt-c",
          task_code: taskCode,
          experiment_code: `${taskCode}-C`,
          tray_code: saltTrayCode,
          run_tray_status: "实验进行中",
          status: "实验进行中",
          started_at: "2026-06-12 15:18:50",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: vibrationTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: saltTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: vibrationTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, tray_code: vibrationTrayCode },
      ],
      samples: [
        {
          code: `${taskCode}-SP-002`,
          location: "振动一室",
          owner: "周工",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: `${taskCode}-D`,
              target_lab: "振动一室",
              tray_code: vibrationTrayCode,
            },
          ],
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 振动试验 / 已到达实验室 / 托盘：${vibrationTrayCode}`,
              location: "振动一室",
              status: "已到达实验室",
              time: "2026-06-12 15:19:15",
              tray_code: vibrationTrayCode,
            },
            {
              action: "任务切换撤回",
              detail: `${taskCode} / 盐雾试验 / 撤回至冲击试验已完成`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-06-12 15:19:08",
              tray_code: vibrationTrayCode,
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 盐雾试验 / 已到达实验室 / 托盘：${vibrationTrayCode}`,
              location: "盐雾试验室",
              status: "已到达实验室",
              time: "2026-06-12 15:18:45",
              tray_code: vibrationTrayCode,
            },
          ],
        },
      ],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(view.currentTask).toEqual(expect.objectContaining({
      device: "振动一室",
      experimentCode: `${taskCode}-D`,
    }));
    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: false,
      canInstallSample: true,
      canMarkReady: false,
    });
    expect(getLaboratoryOperationLock(view.allScheduleRows, view.currentTask, { name: "振动一室" })).toEqual({ active: false });
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
              tray_code: "TP-501",
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

  test("buildLaboratoryWorkbenchView keeps pre-experiment appearance storage time after a lab reset", () => {
    const taskCode = "SYLU-2026-06-023";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "四综合试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "霉菌试验" },
      ],
      labName: "霉菌试验室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "实验前外观检测间存放",
          history: [
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 霉菌试验 / 撤回至实验前外观检测间存放（试验间内撤回当前实验任务）`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 14:50:00",
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 霉菌试验 / 已到达实验室`,
              location: "霉菌试验室",
              status: "已到达实验室",
              time: "2026-06-23 14:46:00",
            },
            {
              action: "外观检测间扫码出库",
              detail: `${trayCode} 送至 霉菌试验室`,
              location: "霉菌试验室",
              status: "送至实验室",
              time: "2026-06-23 14:44:30",
            },
            {
              action: "外观检测间扫码入库",
              detail: `${trayCode} 实验前外观检测间存放`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 14:43:56",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-06-23 14:40:00",
            },
          ],
          location: "外观检测间",
          owner: "赵工",
          status: "实验前外观检测间存放",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "实验前外观检测间存放", target_experiment_code: `${taskCode}-B`, target_lab: "霉菌试验室", tray_code: trayCode }],
        },
      ],
      schedules: [
        {
          id: "schedule-mold-reset-time",
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          device: "霉菌试验室",
          start_at: "2026-06-24 12:00:00",
          end_at: "2026-06-24 15:30:00",
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "霉菌重置回外观检测任务", test_type: "霉菌试验" }],
    });

    expect(view.selectedTrayFlow.steps.find((step) => step.label === "实验前外观检测间存放")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-23 14:43:56" }),
    );
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
          planned_hours: 2,
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
          end_at: "2026-04-02T11:30:00.000Z",
          planned_hours: 2,
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

  test("buildSaltSprayLaboratoryView counts down from the scheduled estimate after the actual run start", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentRuns: [
        {
          run_no: "run-delayed-start",
          schedule_id: "schedule-delayed",
          task_code: "SYLU-2026-04-602",
          experiment_code: "SYLU-2026-04-602-A",
          device: "盐雾试验室",
          tray_codes: ["TP-602"],
          status: "实验进行中",
          started_at: "2026-04-02T10:30:00.000Z",
          planned_end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-04-602", experiment_code: "SYLU-2026-04-602-A", tray_code: "TP-602" },
      ],
      experiments: [
        { task_code: "SYLU-2026-04-602", experiment_code: "SYLU-2026-04-602-A", experiment_name: "盐雾试验" },
      ],
      now: new Date("2026-04-02T11:00:00.000Z"),
      samples: [
        {
          code: "SP-602",
          location: "盐雾试验室",
          owner: "王工",
          status: "实验进行中",
          task_code: "SYLU-2026-04-602",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-602" }],
        },
      ],
      schedules: [
        {
          id: "schedule-delayed",
          task_code: "SYLU-2026-04-602",
          experiment_code: "SYLU-2026-04-602-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:00:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-04-602", name: "延迟开始任务", test_type: "盐雾试验" }],
    });

    expect(view.runningExperiment).toEqual(expect.objectContaining({
      countdownLabel: "01:30:00",
      endDateTimeLabel: toDisplayedDateTime("2026-04-02T12:30:00.000Z"),
      remainingSeconds: 5400,
      startDateTimeLabel: toDisplayedDateTime("2026-04-02T10:30:00.000Z"),
    }));
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
      scanCode: "MES-TRAY:TP-001",
      scheduleRows: view.scheduleRows,
    });

    expect(match).toEqual(expect.objectContaining({ ok: true, tone: "success", trayCode: "TP-001" }));
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

  test("buildLaboratoryWorkbenchView keeps completed flow when comparison is allowed after impact completed", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          ended_at: "2026-06-29 13:45:27",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-COMPLETE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: ["x+", "x-", "y+", "y-", "z+", "z-"].map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-COMPLETE",
        status: "实验已完成",
        step_no: index + 1,
        task_code: taskCode,
      })),
      experimentRunTrays: [
        {
          ended_at: "2026-06-29 13:45:27",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-COMPLETE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
      ],
      labName: "振动二室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 实验已完成`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-06-29 13:45:27",
              tray_code: trayCode,
            },
          ],
          location: "冲击一室",
          status: "实验已完成",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "振动二室",
          experiment_code: vibrationExperimentCode,
          start_at: "2026-06-29 14:00:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "冲击后直送振动任务", test_type: "冲击试验 / 振动试验" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
    const scanResult = validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    });

    expect(view.currentTask.experimentCode).toBe(vibrationExperimentCode);
    expect(scanResult).toEqual(expect.objectContaining({ message: "比对正确", ok: true, trayCode }));
    expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：冲击试验已完成`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ active: true, reached: true }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至振动二室")).toEqual(
      expect.objectContaining({ active: false }),
    );
  });

  test("buildLaboratoryWorkbenchView keeps completed status after a completed experiment target", () => {
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
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至振动一室")).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
  });

  test("buildLaboratoryWorkbenchView shows axis experiment partial completion in flow status", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentRunSteps: [
        {
          run_no: "run-impact-axis-001",
          task_code: "SYLU-2026-06-330",
          experiment_code: "SYLU-2026-06-330-A",
          axis_code: "x+",
          status: "实验已完成",
        },
        {
          run_no: "run-impact-axis-001",
          task_code: "SYLU-2026-06-330",
          experiment_code: "SYLU-2026-06-330-A",
          axis_code: "x-",
          status: "待执行",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "run-impact-axis-001",
          task_code: "SYLU-2026-06-330",
          experiment_code: "SYLU-2026-06-330-A",
          tray_code: "TP-AXIS-PARTIAL",
          run_tray_status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-330", experiment_code: "SYLU-2026-06-330-A", tray_code: "TP-AXIS-PARTIAL" },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-330",
          experiment_code: "SYLU-2026-06-330-A",
          experiment_name: "冲击试验",
          status: "实验进行中",
          axis_codes: ["x+", "x-", "y+"],
        },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: "SP-AXIS-PARTIAL",
          history: [],
          location: "冲击一室",
          owner: "王工",
          status: "实验进行中",
          task_code: "SYLU-2026-06-330",
          trays: [
            {
              quantity: 1,
              status: "实验进行中",
              target_experiment_code: "SYLU-2026-06-330-A",
              target_lab: "冲击一室",
              tray_code: "TP-AXIS-PARTIAL",
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-impact-axis-partial",
          task_code: "SYLU-2026-06-330",
          experiment_code: "SYLU-2026-06-330-A",
          device: "冲击一室",
          start_at: "2026-06-05 10:00:00",
          end_at: "2026-06-05 12:00:00",
          axis_codes: ["x+", "x-"],
        },
      ],
      tasks: [{ code: "SYLU-2026-06-330", name: "多轴冲击任务", test_type: "冲击试验" }],
    });

    expect(view.currentTask.axisProgress).toEqual(expect.objectContaining({
      completedAxisCodes: ["x+"],
      remainingAxisCodes: ["x-"],
      requiredAxisCodes: ["x+", "x-"],
      statusLabel: "冲击试验部分完成 1/2轴",
    }));
    expect(view.currentTaskFlow.currentStatus).toBe("任务进行中");
    expect(view.currentTaskFlow.axisStatusLabel).toBe("冲击试验部分完成 1/2轴");
    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：TP-AXIS-PARTIAL | 当前状态：冲击试验部分完成 1/2轴");
  });

  test("buildLaboratoryWorkbenchView keeps task flow running when only one tray has completed all axes", () => {
    const taskCode = "SYLU-2026-07-021";
    const experimentCode = `${taskCode}-A`;
    const completedTrayCode = `${taskCode}-TP-001`;
    const pendingTrayCode = `${taskCode}-TP-002`;
    const firstAxisCodes = ["x+", "y+", "y-"];
    const secondAxisCodes = ["z-", "x-", "z+"];
    const allAxisCodes = [...firstAxisCodes, ...secondAxisCodes];
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-impact-axis-001",
          schedule_id: "schedule-impact-axis-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: `${experimentCode}-AXIS-001`,
          device: "冲击一室",
          status: "实验已完成",
          axis_codes: firstAxisCodes,
          tray_codes: [completedTrayCode],
        },
        {
          run_no: "run-impact-axis-002",
          schedule_id: "schedule-impact-axis-002",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: `${experimentCode}-AXIS-002`,
          device: "冲击一室",
          status: "实验已完成",
          axis_codes: secondAxisCodes,
          tray_codes: [completedTrayCode],
        },
      ],
      experimentRunSteps: [
        ...firstAxisCodes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: experimentCode,
          run_no: "run-impact-axis-001",
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: `${experimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: completedTrayCode,
        })),
        ...secondAxisCodes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: experimentCode,
          run_no: "run-impact-axis-002",
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: `${experimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_code: completedTrayCode,
        })),
      ],
      experimentRunTrays: [
        {
          run_no: "run-impact-axis-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: `${experimentCode}-AXIS-001`,
          tray_code: completedTrayCode,
          run_tray_status: "实验已完成",
          status: "实验已完成",
        },
        {
          run_no: "run-impact-axis-002",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: `${experimentCode}-AXIS-002`,
          tray_code: completedTrayCode,
          run_tray_status: "实验已完成",
          status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: completedTrayCode },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: pendingTrayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          status: "实验进行中",
          axis_codes: allAxisCodes,
        },
      ],
      labCode: "LAB_IMPACT_1",
      labName: "冲击一室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "厂家收回",
          status: "厂家收回",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "厂家收回", tray_code: completedTrayCode }],
        },
        {
          code: `${taskCode}-SP-002`,
          location: "接驳区",
          status: "到货",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "到货", tray_code: pendingTrayCode }],
        },
      ],
      schedules: [
        {
          id: "schedule-impact-axis-002",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: `${experimentCode}-AXIS-002`,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-07-03 12:00:00",
          status: "实验进行中",
          axis_codes: secondAxisCodes,
        },
      ],
      selectedTrayCode: pendingTrayCode,
      tasks: [{ code: taskCode, name: "多托盘冲击任务", test_type: "冲击试验" }],
    });

    expect(view.currentTask.axisProgress).toEqual(expect.objectContaining({
      totalStatusLabel: "冲击试验已完成 6/6轴",
    }));
    expect(view.currentTaskFlow.currentStatus).toBe("任务进行中");
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${pendingTrayCode} | 当前状态：到货`);
  });

  test("buildLaboratoryWorkbenchView removes completed axis batch schedule and selects the next axis batch as current", () => {
    const taskCode = "SYLU-2026-07-001";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const completedAxisCodes = ["x+", "x-", "y+", "y-"];
    const remainingAxisCodes = ["z+", "z-"];
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-vibration-xy",
          schedule_id: "schedule-vibration-xy",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "振动一室",
          status: "实验已完成",
          axis_codes: completedAxisCodes,
          tray_codes: [trayCode],
          started_at: "2026-06-25 08:00:00",
          ended_at: "2026-06-25 10:30:00",
        },
      ],
      experimentRunSteps: completedAxisCodes.map((axisCode) => ({
        axis_code: axisCode,
        experiment_code: experimentCode,
        run_no: "run-vibration-xy",
        status: "实验已完成",
        task_code: taskCode,
      })),
      experimentRunTrays: [
        {
          run_no: "run-vibration-xy",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "振动试验",
          status: "实验已完成",
          axis_codes: [...completedAxisCodes, ...remainingAxisCodes],
        },
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          experiment_name: "冲击试验",
          status: "已排程",
        },
      ],
      labCode: "LAB_VIBRATION_1",
      labName: "振动一室",
      now: new Date("2026-06-25T11:00:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "实验已完成",
          history: [],
          location: "振动一室",
          status: "实验已完成",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              target_experiment_code: experimentCode,
              target_lab: "振动一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-vibration-xy",
          task_code: taskCode,
          experiment_code: experimentCode,
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-06-25 08:00:00",
          end_at: "2026-06-25 10:30:00",
          axis_codes: completedAxisCodes,
        },
        {
          id: "schedule-vibration-z",
          task_code: taskCode,
          experiment_code: experimentCode,
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-06-26 08:00:00",
          end_at: "2026-06-26 10:30:00",
          axis_codes: remainingAxisCodes,
        },
        {
          id: "schedule-impact-after-vibration",
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-27 08:00:00",
          end_at: "2026-06-27 10:30:00",
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "六轴振动任务", test_type: "振动试验" }],
    });

    expect(view.scheduleRows.map((row) => row.id)).toEqual(["schedule-vibration-z"]);
    expect(view.scheduleRows[0].axisProgress).toEqual(expect.objectContaining({
      completedAxisCodes: [],
      remainingAxisCodes,
      requiredAxisCodes: remainingAxisCodes,
    }));
    expect(view.currentTask).toEqual(expect.objectContaining({
      id: "schedule-vibration-z",
      taskCode,
      experimentCode,
      axisCodes: remainingAxisCodes,
    }));
    expect(view.currentTaskFlow.currentStatus).toBe("任务进行中");
    expect(view.currentTaskFlow.axisStatusLabel).toBe("振动试验部分完成 4/6轴");
    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：SYLU-2026-07-001-TP-001 | 当前状态：振动试验部分完成 4/6轴");
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "振动试验部分完成 4/6轴")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(getLaboratoryActionState(buildLaboratoryWorkflowFromTask(view.currentTask))).toEqual({
      canCompare: true,
      canInstallSample: false,
      canMarkReady: false,
    });
  });

  test("buildLaboratoryWorkbenchView keeps whole-experiment axis progress across sub-experiment batches", () => {
    const taskCode = "SYLU-2026-07-001";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    const completedAxisCodes = ["x+", "x-", "y+"];
    const remainingAxisCodes = ["y-", "z+", "z-"];
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-impact-axis-001",
          schedule_id: "schedule-impact-axis-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          device: "冲击一室",
          status: "实验已完成",
          axis_codes: completedAxisCodes,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: completedAxisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: experimentCode,
        run_no: "run-impact-axis-001",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: firstSubExperimentCode,
        task_code: taskCode,
      })),
      experimentRunTrays: [
        {
          run_no: "run-impact-axis-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          status: "实验进行中",
          axis_codes: [...completedAxisCodes, ...remainingAxisCodes],
        },
      ],
      labCode: "LAB_IMPACT_1",
      labName: "冲击一室",
      now: new Date("2026-06-26T09:00:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "送至实验室",
          history: [],
          location: "冲击一室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: experimentCode,
              target_lab: "冲击一室",
              target_sub_experiment_code: secondSubExperimentCode,
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-impact-axis-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-25 08:00:00",
          end_at: "2026-06-25 11:30:00",
          axis_codes: completedAxisCodes,
        },
        {
          id: "schedule-impact-axis-002",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: secondSubExperimentCode,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-26 08:00:00",
          end_at: "2026-06-26 11:30:00",
          axis_codes: remainingAxisCodes,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "六轴冲击任务", test_type: "冲击试验" }],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      id: "schedule-impact-axis-002",
      subExperimentCode: secondSubExperimentCode,
    }));
    expect(view.currentTask.axisProgress).toEqual(expect.objectContaining({
      completedAxisCodes: [],
      remainingAxisCodes,
      requiredAxisCodes: remainingAxisCodes,
      totalCompletedAxisCodes: completedAxisCodes,
      totalStatusLabel: "冲击试验部分完成 3/6轴",
    }));
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：冲击试验部分完成 3/6轴`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "冲击试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至冲击一室")).toEqual(
      expect.objectContaining({ active: false }),
    );
  });

  test("buildLaboratoryWorkbenchView keeps selected tray axis status scoped to that tray", () => {
    const taskCode = "SYLU-2026-06-021";
    const experimentCode = `${taskCode}-B`;
    const tray001 = `${taskCode}-TP-001`;
    const tray002 = `${taskCode}-TP-002`;
    const allAxisCodes = ["x+", "x-", "y+", "y-", "z+", "z-"];
    const tray001AxisCodes = ["x+", "x-", "y+", "y-"];
    const tray002AxisCodes = ["x+", "x-"];
    const makeSteps = (runNo, axisCodes) => axisCodes.map((axisCode, index) => ({
      axis_code: axisCode,
      experiment_code: experimentCode,
      run_no: runNo,
      status: "实验已完成",
      step_no: index + 1,
      task_code: taskCode,
    }));
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-impact-tp001",
          schedule_id: "schedule-impact-axis",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击一室",
          status: "实验已完成",
          axis_codes: tray001AxisCodes,
          tray_codes: [tray001],
        },
        {
          run_no: "run-impact-tp002",
          schedule_id: "schedule-impact-axis",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击一室",
          status: "实验已完成",
          axis_codes: tray002AxisCodes,
          tray_codes: [tray002],
        },
      ],
      experimentRunSteps: [
        ...makeSteps("run-impact-tp001", tray001AxisCodes),
        ...makeSteps("run-impact-tp002", tray002AxisCodes),
      ],
      experimentRunTrays: [
        {
          run_no: "run-impact-tp001",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: tray001,
          run_tray_status: "实验已完成",
          status: "实验已完成",
        },
        {
          run_no: "run-impact-tp002",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: tray002,
          run_tray_status: "实验已完成",
          status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: tray001 },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: tray002 },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          status: "实验进行中",
          axis_codes: allAxisCodes,
        },
      ],
      labCode: "LAB_IMPACT_1",
      labName: "冲击一室",
      now: new Date("2026-06-28T21:00:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [],
          location: "冲击一室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [{
            quantity: 1,
            status: "送至实验室",
            target_experiment_code: experimentCode,
            target_lab: "冲击一室",
            tray_code: tray001,
          }],
        },
        {
          code: `${taskCode}-SP-002`,
          history: [],
          location: "冲击一室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [{
            quantity: 1,
            status: "送至实验室",
            target_experiment_code: experimentCode,
            target_lab: "冲击一室",
            tray_code: tray002,
          }],
        },
      ],
      schedules: [
        {
          id: "schedule-impact-axis",
          task_code: taskCode,
          experiment_code: experimentCode,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-28 20:00:00",
          end_at: "2026-06-28 22:00:00",
          axis_codes: allAxisCodes,
        },
      ],
      selectedTrayCode: tray002,
      tasks: [{ code: taskCode, name: "多托盘冲击任务", test_type: "冲击试验" }],
    });

    expect(view.currentTask.axisProgress).toEqual(expect.objectContaining({
      statusLabel: "冲击试验部分完成 2/6轴",
    }));
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${tray002} | 当前状态：冲击试验部分完成 2/6轴`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "冲击试验部分完成 2/6轴")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildLaboratoryWorkbenchView does not merge different tray axis completions into the lab task status", () => {
    const taskCode = "SYLU-2026-06-022";
    const experimentCode = `${taskCode}-B`;
    const allAxisCodes = ["x+", "x-", "y+", "y-", "z+", "z-"];
    const trayAxisPairs = [
      { trayCode: `${taskCode}-TP-001`, runNo: "run-impact-tp001", axisCodes: ["x+", "x-"] },
      { trayCode: `${taskCode}-TP-002`, runNo: "run-impact-tp002", axisCodes: ["y+", "y-"] },
      { trayCode: `${taskCode}-TP-003`, runNo: "run-impact-tp003", axisCodes: ["z+", "z-"] },
    ];
    const makeSteps = ({ runNo, axisCodes }) => axisCodes.map((axisCode, index) => ({
      axis_code: axisCode,
      experiment_code: experimentCode,
      run_no: runNo,
      status: "实验已完成",
      step_no: index + 1,
      task_code: taskCode,
    }));
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: trayAxisPairs.map(({ axisCodes, runNo, trayCode }) => ({
        run_no: runNo,
        schedule_id: "schedule-impact-axis",
        task_code: taskCode,
        experiment_code: experimentCode,
        device: "冲击一室",
        status: "实验已完成",
        axis_codes: axisCodes,
        tray_codes: [trayCode],
      })),
      experimentRunSteps: trayAxisPairs.flatMap(makeSteps),
      experimentRunTrays: trayAxisPairs.map(({ runNo, trayCode }) => ({
        run_no: runNo,
        task_code: taskCode,
        experiment_code: experimentCode,
        tray_code: trayCode,
        run_tray_status: "实验已完成",
        status: "实验已完成",
      })),
      experimentTrays: trayAxisPairs.map(({ trayCode }) => ({
        task_code: taskCode,
        experiment_code: experimentCode,
        tray_code: trayCode,
      })),
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          status: "实验进行中",
          axis_codes: allAxisCodes,
        },
      ],
      labCode: "LAB_IMPACT_1",
      labName: "冲击一室",
      now: new Date("2026-06-28T21:00:00+08:00"),
      samples: trayAxisPairs.map(({ trayCode }, index) => ({
        code: `${taskCode}-SP-00${index + 1}`,
        history: [],
        location: "冲击一室",
        status: "送至实验室",
        task_code: taskCode,
        trays: [{
          quantity: 1,
          status: "送至实验室",
          target_experiment_code: experimentCode,
          target_lab: "冲击一室",
          tray_code: trayCode,
        }],
      })),
      schedules: [
        {
          id: "schedule-impact-axis",
          task_code: taskCode,
          experiment_code: experimentCode,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-28 20:00:00",
          end_at: "2026-06-28 22:00:00",
          axis_codes: allAxisCodes,
        },
      ],
      selectedTrayCode: `${taskCode}-TP-002`,
      tasks: [{ code: taskCode, name: "多托盘冲击任务", test_type: "冲击试验" }],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({ id: "schedule-impact-axis" }));
    expect(view.currentTaskFlow.currentStatus).toBe("任务进行中");
    expect(view.currentTaskFlow.axisStatusLabel).toBe("冲击试验部分完成 2/6轴");
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${taskCode}-TP-002 | 当前状态：冲击试验部分完成 2/6轴`);
  });

  test("buildLaboratoryWorkbenchView shows total axis progress when the current sub-experiment batch is complete", () => {
    const taskCode = "SYLU-2026-06-001";
    const experimentCode = `${taskCode}-C`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-axis-x",
          schedule_id: "schedule-axis-x",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          status: "实验已完成",
          axis_codes: ["x+"],
          tray_codes: [`${taskCode}-TP-001`],
        },
      ],
      experimentRunSteps: [
        {
          run_no: "run-axis-x",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          axis_code: "x+",
          status: "实验已完成",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "run-axis-x",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          tray_code: `${taskCode}-TP-001`,
          status: "实验已完成",
          run_tray_status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: `${taskCode}-TP-001` },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: `${taskCode}-TP-002` },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "振动试验",
          status: "实验进行中",
          axis_codes: ["x+", "y+"],
        },
      ],
      labCode: "LAB_VIBRATION_1",
      labName: "振动一室",
      now: new Date("2026-06-26T12:00:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "振动一室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              tray_code: `${taskCode}-TP-001`,
              status: "送至实验室",
              target_experiment_code: experimentCode,
              target_lab: "振动一室",
              quantity: 1,
            },
          ],
        },
        {
          code: `${taskCode}-SP-002`,
          location: "接驳区",
          status: "到货",
          task_code: taskCode,
          trays: [
            {
              tray_code: `${taskCode}-TP-002`,
              status: "到货",
              quantity: 1,
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-axis-x",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-06-26 11:53:00",
          end_at: "2026-06-26 15:23:00",
          status: "实验进行中",
          axis_codes: ["x+"],
        },
        {
          id: "schedule-axis-y",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: secondSubExperimentCode,
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-06-26 15:33:00",
          end_at: "2026-06-26 19:03:00",
          status: "实验进行中",
          axis_codes: ["y+"],
        },
      ],
      selectedTrayCode: `${taskCode}-TP-001`,
      tasks: [{ code: taskCode, name: "振动任务", test_type: "振动试验" }],
    });

    expect(view.currentTask.axisProgress).toEqual(expect.objectContaining({
      statusLabel: "振动试验已完成 1/1轴",
      totalStatusLabel: "振动试验部分完成 1/2轴",
    }));
    expect(view.currentTaskFlow.currentStatus).toBe("任务进行中");
    expect(view.currentTaskFlow.axisStatusLabel).toBe("振动试验部分完成 1/2轴");
    expect(view.selectedTrayRow).toEqual(expect.objectContaining({
      completedForCurrentExperiment: false,
      trayCode: `${taskCode}-TP-002`,
      trayStatus: "到货",
    }));
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${taskCode}-TP-002 | 当前状态：到货`);
  });

  test("buildLaboratoryWorkbenchView does not show vibration partial axis status for an untested selected tray", () => {
    const taskCode = "SYLU-2026-06-021";
    const experimentCode = `${taskCode}-VIB`;
    const completedTrayCode = `${taskCode}-TP-001`;
    const untestedTrayCode = `${taskCode}-TP-004`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-vibration-z",
          schedule_id: "schedule-vibration-z",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "振动一室",
          status: "实验已完成",
          axis_codes: ["z+", "z-"],
          tray_codes: [completedTrayCode],
        },
      ],
      experimentRunSteps: [
        { run_no: "run-vibration-z", task_code: taskCode, experiment_code: experimentCode, axis_code: "z+", status: "实验已完成" },
        { run_no: "run-vibration-z", task_code: taskCode, experiment_code: experimentCode, axis_code: "z-", status: "实验已完成" },
      ],
      experimentRunTrays: [
        {
          run_no: "run-vibration-z",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: completedTrayCode,
          run_tray_status: "实验已完成",
          status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: completedTrayCode },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: untestedTrayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "振动试验",
          status: "实验进行中",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      labCode: "LAB_VIBRATION_1",
      labName: "振动一室",
      now: new Date("2026-06-27T15:00:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "振动一室",
          status: "实验进行中",
          task_code: taskCode,
          trays: [
            {
              tray_code: completedTrayCode,
              status: "实验进行中",
              target_experiment_code: experimentCode,
              target_lab: "振动一室",
              quantity: 1,
            },
          ],
        },
        {
          code: `${taskCode}-SP-004`,
          location: "振动一室",
          status: "到货",
          task_code: taskCode,
          trays: [
            {
              tray_code: untestedTrayCode,
              status: "到货",
              quantity: 1,
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-vibration-z",
          task_code: taskCode,
          experiment_code: experimentCode,
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-06-27 14:17:00",
          end_at: "2026-06-27 17:47:00",
          status: "实验进行中",
          axis_codes: ["z+", "z-"],
        },
        {
          id: "schedule-vibration-rest",
          task_code: taskCode,
          experiment_code: experimentCode,
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-06-28 12:00:00",
          end_at: "2026-06-28 15:30:00",
          status: "已排程",
          axis_codes: ["x+", "x-", "y+", "y-"],
        },
      ],
      selectedTrayCode: untestedTrayCode,
      tasks: [{ code: taskCode, name: "振动任务", test_type: "振动试验" }],
    });

    expect(view.currentTaskFlow.currentStatus).toBe("任务进行中");
    expect(view.currentTaskFlow.axisStatusLabel).toBe("振动试验部分完成 2/6轴");
    expect(view.selectedTrayRow).toEqual(expect.objectContaining({
      completedForCurrentExperiment: false,
      trayCode: untestedTrayCode,
      trayStatus: "到货",
    }));
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${untestedTrayCode} | 当前状态：到货`);
  });

  test("buildLaboratoryWorkbenchView keeps a tray visible for its unfinished sub experiment batch", () => {
    const taskCode = "SYLU-2026-06-001";
    const experimentCode = `${taskCode}-B`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    const firstTrayCode = `${taskCode}-TP-001`;
    const secondTrayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-axis-001-tray-001",
          schedule_id: "schedule-axis-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          device: "振动一室",
          status: "实验已完成",
          axis_codes: ["x+"],
          tray_codes: [firstTrayCode],
        },
        {
          run_no: "run-axis-002-tray-001",
          schedule_id: "schedule-axis-002",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: secondSubExperimentCode,
          device: "振动一室",
          status: "实验已完成",
          axis_codes: ["y-", "z+"],
          tray_codes: [firstTrayCode],
        },
        {
          run_no: "run-axis-001-tray-002",
          schedule_id: "schedule-axis-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          device: "振动一室",
          status: "实验已完成",
          axis_codes: ["x+"],
          tray_codes: [secondTrayCode],
        },
      ],
      experimentRunSteps: [
        { run_no: "run-axis-001-tray-001", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: firstSubExperimentCode, axis_code: "x+", status: "实验已完成" },
        { run_no: "run-axis-002-tray-001", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: secondSubExperimentCode, axis_code: "y-", status: "实验已完成" },
        { run_no: "run-axis-002-tray-001", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: secondSubExperimentCode, axis_code: "z+", status: "实验已完成" },
        { run_no: "run-axis-001-tray-002", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: firstSubExperimentCode, axis_code: "x+", status: "实验已完成" },
      ],
      experimentRunTrays: [
        { run_no: "run-axis-001-tray-001", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: firstSubExperimentCode, tray_code: firstTrayCode, run_tray_status: "实验已完成", status: "实验已完成" },
        { run_no: "run-axis-002-tray-001", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: secondSubExperimentCode, tray_code: firstTrayCode, run_tray_status: "实验已完成", status: "实验已完成" },
        { run_no: "run-axis-001-tray-002", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: firstSubExperimentCode, tray_code: secondTrayCode, run_tray_status: "实验已完成", status: "实验已完成" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: firstTrayCode },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: secondTrayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "振动试验",
          status: "实验进行中",
          axis_codes: ["x+", "y-", "z+"],
        },
      ],
      labCode: "LAB_VIBRATION_1",
      labName: "振动一室",
      now: new Date("2026-06-26T10:45:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "实验已完成",
          location: "振动一室",
          status: "实验已完成",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "实验已完成", tray_code: firstTrayCode }],
        },
        {
          code: `${taskCode}-SP-005`,
          flow_status: "送至实验室",
          location: "振动一室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "送至实验室", tray_code: secondTrayCode }],
        },
      ],
      schedules: [
        {
          id: "schedule-axis-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          axis_batch_no: "001",
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-06-26 08:00:00",
          end_at: "2026-06-26 10:30:00",
          axis_codes: ["x+"],
        },
        {
          id: "schedule-axis-002",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: secondSubExperimentCode,
          axis_batch_no: "002",
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-06-26 10:30:00",
          end_at: "2026-06-26 14:00:00",
          axis_codes: ["y-", "z+"],
        },
      ],
      selectedTaskCode: "schedule-axis-002",
      selectedTrayCode: secondTrayCode,
      tasks: [{ code: taskCode, name: "分轴振动任务", test_type: "振动试验" }],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      id: "schedule-axis-002",
      subExperimentCode: secondSubExperimentCode,
    }));
    expect(view.currentTask.trayRows.map((row) => row.trayCode)).toEqual([secondTrayCode]);
    expect(view.currentTask.allTrayRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ completedForCurrentExperiment: true, trayCode: firstTrayCode }),
      expect.objectContaining({ completedForCurrentExperiment: false, trayCode: secondTrayCode }),
    ]));
    expect(view.selectedTrayRow).toEqual(expect.objectContaining({
      completedForCurrentExperiment: false,
      trayCode: secondTrayCode,
      trayStatus: "送至实验室",
    }));
  });

  test("buildLaboratoryWorkbenchView shows the current lab dispatch after other experiments completed", () => {
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
    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：SYLU-2026-06-001-TP-002 | 当前状态：霉菌试验已完成");
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(
      expect.objectContaining({ active: true, reached: true }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至外观检测间")).toBeUndefined();
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至冲击一室")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
  });

  test("buildLaboratoryWorkbenchView keeps latest completed experiment flow when current lab is only an allowed next operation", () => {
    const taskCode = "TASK-ORDERLESS";
    const trayCode = "TP-ORDERLESS";
    const impactExperimentCode = "EXP-IMPACT";
    const combinedExperimentCode = "EXP-COMBINED";
    const saltExperimentCode = "EXP-SALT";
    const vibrationExperimentCode = "EXP-VIBRATION";
    const otherTrayCode = "TP-ORDERLESS-OTHER";
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 17:03:50",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-OTHER-001",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: otherTrayCode,
        },
        {
          ended_at: "2026-06-30 17:04:39",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-OTHER-002",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_code: otherTrayCode,
        },
        {
          ended_at: "2026-06-30 17:26:11",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 17:24:02",
          experiment_code: saltExperimentCode,
          run_no: "RUN-SALT-OTHER",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: otherTrayCode,
        },
        {
          ended_at: "2026-06-30 17:23:30",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-OTHER",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_code: otherTrayCode,
        },
      ],
      experimentRuns: [
        {
          axis_codes: ["x+", "x-", "y+"],
          device: "冲击一室",
          ended_at: "2026-06-30 17:03:50",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-OTHER-001",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [otherTrayCode],
        },
        {
          axis_codes: ["y-", "z+", "z-"],
          device: "冲击一室",
          ended_at: "2026-06-30 17:04:39",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-OTHER-002",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_codes: [otherTrayCode],
        },
        {
          device: "四综合实验室",
          ended_at: "2026-06-30 17:26:11",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          device: "盐雾试验室",
          ended_at: "2026-06-30 17:24:02",
          experiment_code: saltExperimentCode,
          run_no: "RUN-SALT-OTHER",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [otherTrayCode],
        },
        {
          axis_codes: ["y-", "z+", "z-"],
          device: "振动一室",
          ended_at: "2026-06-30 17:23:30",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-OTHER",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_codes: [otherTrayCode],
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: otherTrayCode },
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: otherTrayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: otherTrayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: otherTrayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          status: "实验进行中",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          status: "实验已完成",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          status: "实验进行中",
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          status: "实验进行中",
          task_code: taskCode,
        },
      ],
      labName: "冲击一室",
      samples: [
        {
          code: "SP-ORDERLESS-OTHER",
          flow_status: "厂家收回",
          history: [
            {
              action: "厂家收回",
              detail: `${otherTrayCode} 厂家收回`,
              location: "厂家收回",
              status: "厂家收回",
              time: "2026-06-30 17:25:30",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-06-30 17:24:47",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 盐雾试验 / 实验已完成`,
              location: "盐雾试验室",
              status: "实验已完成",
              time: "2026-06-30 17:24:02",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 实验已完成`,
              location: "振动一室",
              status: "实验已完成",
              time: "2026-06-30 17:23:30",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 实验已完成`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-06-30 17:04:39",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-06-30 17:03:50",
            },
            {
              action: "送至实验室",
              detail: `${otherTrayCode} -> 冲击一室`,
              location: "冲击一室",
              status: "送至实验室",
              time: "2026-06-30 17:03:33",
            },
          ],
          location: "厂家收回",
          status: "厂家收回",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "厂家收回",
              target_experiment_code: "",
              target_lab: "四综合实验室",
              tray_code: otherTrayCode,
            },
          ],
        },
        {
          code: "SP-ORDERLESS",
          flow_status: "实验已完成",
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-06-30 17:26:11",
            },
            {
              action: "任务已确认入库",
              detail: taskCode,
              location: "接驳区",
              status: "到货",
              time: "2026-06-30 17:03:28",
            },
          ],
          location: "四综合实验室",
          status: "实验已完成",
          task_code: taskCode,
          updated_at: "2026-06-30 17:34:57",
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              target_experiment_code: "",
              target_lab: "",
              tray_code: trayCode,
              updated_at: "2026-06-30 17:26:11",
            },
          ],
        },
      ],
      schedules: [
        {
          axis_batch_no: "001",
          axis_codes: ["x+", "x-", "y+"],
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          id: "schedule-impact-next",
          start_at: "2026-06-30 17:02:00",
          status: "实验进行中",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
        {
          axis_batch_no: "002",
          axis_codes: ["y-", "z+", "z-"],
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          id: "schedule-impact-future",
          start_at: "2026-07-03 12:00:00",
          status: "实验进行中",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
        {
          device: "盐雾试验室",
          experiment_code: saltExperimentCode,
          id: "schedule-salt",
          start_at: "2026-06-30 17:02:00",
          status: "实验进行中",
          task_code: taskCode,
        },
        {
          device: "四综合实验室",
          experiment_code: combinedExperimentCode,
          id: "schedule-combined-completed",
          start_at: "2026-06-30 17:02:00",
          status: "实验已完成",
          task_code: taskCode,
        },
        {
          axis_batch_no: "001",
          axis_codes: ["x+", "x-", "y+"],
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          id: "schedule-vibration",
          start_at: "2026-07-01 12:00:00",
          status: "实验进行中",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
      ],
      selectedTaskCode: taskCode,
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "无序实验任务", test_type: "冲击试验 / 四综合试验 / 盐雾试验 / 振动试验" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
    const scanResult = validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    });

    expect(view.currentTask.experimentCode).toBe(impactExperimentCode);
    expect(view.selectedTrayRow).toEqual(expect.objectContaining({
      completedForCurrentExperiment: false,
      completedForOtherExperiment: true,
      trayCode,
    }));
    expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
    expect(scanResult).toEqual(expect.objectContaining({ message: "比对正确", ok: true, trayCode }));
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：四综合试验已完成`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "四综合试验已完成")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-30 17:26:11" }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至冲击一室")).toEqual(
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

    expect(view.selectedTrayFlow.currentStatus).toBe("当前托盘：SYLU-2026-06-001-TP-003 | 当前状态：霉菌试验已完成");
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(
      expect.objectContaining({ active: true, reached: true }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至外观检测间")).toBeUndefined();
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至冲击一室")).toEqual(
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

  test("keeps compare available for a remaining tray after a withdrawn tray is redispatched to the same lab", () => {
    const taskCode = "SYLU-2026-08-001";
    const impactExperimentCode = `${taskCode}-A`;
    const vibrationExperimentCode = `${taskCode}-B`;
    const firstTrayCode = `${taskCode}-TP-001`;
    const secondTrayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: impactExperimentCode, tray_code: firstTrayCode },
        { task_code: taskCode, experiment_code: impactExperimentCode, tray_code: secondTrayCode },
        { task_code: taskCode, experiment_code: vibrationExperimentCode, tray_code: firstTrayCode },
        { task_code: taskCode, experiment_code: vibrationExperimentCode, tray_code: secondTrayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          status: "已排程",
        },
        {
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动试验",
          status: "已排程",
        },
      ],
      labCode: "LAB_IMPACT_2",
      labName: "冲击二室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "暂存间扫码出库",
              detail: `${firstTrayCode} 送至 冲击二室`,
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-23 16:09:21",
            },
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 冲击试验 / 撤回至已到达暂存间（试验间内撤回当前实验任务）`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-06-23 16:08:55",
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 冲击试验 / 已到达实验室`,
              location: "冲击二室",
              status: "已到达实验室",
              time: "2026-06-23 16:08:54",
            },
          ],
          location: "冲击二室",
          owner: "扫码登记",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击二室",
              tray_code: firstTrayCode,
            },
          ],
        },
        {
          code: `${taskCode}-SP-002`,
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 冲击试验 / 已到达实验室`,
              location: "冲击二室",
              status: "已到达实验室",
              time: "2026-06-23 16:09:36",
            },
            {
              action: "暂存间扫码出库",
              detail: `${secondTrayCode} 送至 冲击二室`,
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-23 16:09:26",
            },
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 冲击试验 / 撤回至已到达暂存间（试验间内撤回当前实验任务）`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-06-23 16:08:55",
            },
          ],
          location: "冲击二室",
          owner: "扫码登记",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击二室",
              tray_code: secondTrayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-impact",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          device: "冲击二室",
          lab_code: "LAB_IMPACT_2",
          start_at: "2026-06-23 16:08:00",
          end_at: "2026-06-23 19:38:00",
        },
        {
          id: "schedule-vibration",
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          device: "振动二室",
          lab_code: "LAB_VIBRATION_2",
          start_at: "2026-06-23 16:08:00",
          end_at: "2026-06-23 19:38:00",
        },
      ],
      tasks: [{ code: taskCode, name: "123", test_type: "冲击试验 / 振动试验" }],
    });

    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(view.currentTask.trayRows.map((row) => row.trayCode)).toEqual([firstTrayCode, secondTrayCode]);
    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: true,
      canInstallSample: true,
      canMarkReady: false,
    });
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: firstTrayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode: firstTrayCode,
    }));
  });

  test("keeps later laboratories unavailable before the first scheduled experiment completes", () => {
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

    expect(view.currentTask).toBeNull();
    expect(view.scheduleRows[0]).toEqual(expect.objectContaining({ sequenceEligible: false }));
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-303",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      guidance: "当前没有可比对的任务",
      message: "当前没有可比对的任务",
      ok: false,
      tone: "error",
    }));
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
          start_at: "2026-06-05 10:00:00",
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

    expect(view.currentTask).toBeNull();
    expect(view.scheduleRows.find((row) => row.experimentCode === "SYLU-2026-06-001-A")).toEqual(
      expect.objectContaining({ sequenceEligible: false }),
    );
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: "TP-001",
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "当前没有可比对的任务",
      ok: false,
    }));
  });

  test("blocks comparison from active run tray codes even without run-tray relation rows", () => {
    const taskCode = "SYLU-2026-06-RUN";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-impact-only",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          device: "冲击一室",
          tray_codes: [trayCode],
          status: "实验进行中",
          started_at: "2026-06-06 13:44:20",
        },
      ],
      experimentRunTrays: [],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", status: "实验进行中" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "振动试验", status: "已排程" },
      ],
      labName: "振动一室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "振动一室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: `${taskCode}-B`,
              target_lab: "振动一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          device: "冲击一室",
          status: "实验进行中",
          start_at: "2026-06-06 13:31:00",
        },
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          device: "振动一室",
          status: "已排程",
          start_at: "2026-06-06 13:30:00",
        },
      ],
      tasks: [{ code: taskCode, test_type: "冲击试验 / 振动试验" }],
    });
    expect(view.currentTask).toBeNull();
    expect(view.scheduleRows.find((row) => row.experimentCode === `${taskCode}-B`)).toEqual(
      expect.objectContaining({ sequenceEligible: false }),
    );
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "当前没有可比对的任务",
      ok: false,
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

    expect(view.currentTask).toBeNull();
    expect(view.scheduleRows[0]).toEqual(expect.objectContaining({ sequenceEligible: false }));
    expect(view.runningExperiment.active).toBe(false);
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

    expect(view.currentTask).toBeNull();
    expect(view.scheduleRows.find((row) => row.experimentCode === "EXP-B")).toEqual(
      expect.objectContaining({ sequenceEligible: false }),
    );
    expect(view.runningExperiment.active).toBe(false);
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

  test("does not reopen a running modal from a stale run-tray relation after abnormal stop", () => {
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          id: "RUN-ABNORMAL",
          run_no: "RUN-ABNORMAL",
          schedule_id: "schedule-abnormal",
          task_code: "TASK-ABNORMAL",
          experiment_code: "EXP-SALT",
          device: "盐雾试验室",
          status: "实验异常终止",
          started_at: "2026-08-31T20:10:49+08:00",
          ended_at: "2026-08-31T20:11:52+08:00",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-ABNORMAL",
          task_code: "TASK-ABNORMAL",
          experiment_code: "EXP-SALT",
          tray_code: "TP-ABNORMAL",
          run_tray_status: "实验进行中",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-ABNORMAL", experiment_code: "EXP-SALT", tray_code: "TP-ABNORMAL" },
      ],
      experiments: [
        { task_code: "TASK-ABNORMAL", experiment_code: "EXP-SALT", experiment_name: "盐雾试验", status: "实验进行中" },
      ],
      labName: "盐雾试验室",
      now: NOW,
      samples: [
        {
          code: "SP-ABNORMAL",
          location: "盐雾试验室",
          status: "等待恢复实验",
          task_code: "TASK-ABNORMAL",
          trays: [{ tray_code: "TP-ABNORMAL", quantity: 1, status: "等待恢复实验" }],
        },
      ],
      schedules: [
        {
          id: "schedule-abnormal",
          task_code: "TASK-ABNORMAL",
          experiment_code: "EXP-SALT",
          device: "盐雾试验室",
          status: "实验进行中",
          start_at: "2026-08-31T20:10:49+08:00",
          end_at: "2026-08-31T21:10:49+08:00",
        },
      ],
      tasks: [{ code: "TASK-ABNORMAL", name: "异常停止任务", test_type: "盐雾试验" }],
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

  test("validateLaboratoryTrayScan points to appearance inspection when the current tray is stocked there", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-05-704", experiment_code: "SYLU-2026-05-704-A", tray_code: "TP-APPEARANCE" },
      ],
      experiments: [
        { task_code: "SYLU-2026-05-704", experiment_code: "SYLU-2026-05-704-A", experiment_name: "盐雾试验" },
      ],
      now: NOW,
      samples: [
        {
          code: "SP-APPEARANCE",
          location: "外观检测间",
          owner: "王工",
          status: "实验后外观检测间存放",
          task_code: "SYLU-2026-05-704",
          trays: [{ tray_code: "TP-APPEARANCE", quantity: 1, status: "实验后外观检测间存放" }],
        },
      ],
      schedules: [
        {
          id: "schedule-appearance",
          task_code: "SYLU-2026-05-704",
          experiment_code: "SYLU-2026-05-704-A",
          device: "盐雾试验室",
          start_at: "2026-05-13T09:00:00.000Z",
          end_at: "2026-05-13T11:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-05-704", name: "外观检测间未出库任务", test_type: "盐雾试验" }],
    });

    const result = validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scanCode: "TP-APPEARANCE",
      scheduleRows: view.scheduleRows,
    });

    expect(result).toEqual(expect.objectContaining({
      guidance: "请先在外观检测间完成出库并送至实验室。",
      message: "托盘尚未出库",
      ok: false,
      tone: "error",
      trayCode: "TP-APPEARANCE",
    }));
    expect(result.guidance).not.toContain("接驳间");
  });

  test("validateLaboratoryTrayScan rejects appearance-stocked tray after another experiment completed", () => {
    const taskCode = "SYLU-2026-07-031";
    const trayCode = `${taskCode}-TP-002`;
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-G`, tray_code: trayCode },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-G`, experiment_name: "盐雾试验", status: "已排程" },
      ],
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "实验前外观检测间存放",
          history: [
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 盐雾试验 / 撤回至实验前外观检测间存放`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-07-24 15:03:52",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 实验已完成`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-07-24 15:03:07",
            },
          ],
          location: "外观检测间",
          status: "实验前外观检测间存放",
          task_code: taskCode,
          trays: [{ tray_code: trayCode, quantity: 5, status: "实验前外观检测间存放" }],
        },
      ],
      schedules: [
        {
          id: "schedule-salt",
          task_code: taskCode,
          experiment_code: `${taskCode}-G`,
          device: "盐雾试验室",
          start_at: "2026-07-25 12:00:00",
          end_at: "2026-07-25 15:30:00",
        },
      ],
      tasks: [{ code: taskCode, name: "复合试验任务", test_type: "冲击试验 / 盐雾试验" }],
    });

    expect(validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      guidance: "请先在外观检测间完成出库并送至实验室。",
      message: "托盘尚未出库",
      ok: false,
      trayCode,
    }));
  });

  test("validateLaboratoryTrayScan rejects current trays without structured dispatch target", () => {
    const currentTask = {
      taskCode: "SYLU-2026-05-706",
      experimentCode: "SYLU-2026-05-706-A",
      device: "盐雾试验室",
      trayCodes: ["TP-MISSING-TARGET"],
      allTrayCodes: [],
      trayRows: [
        {
          currentLocation: "盐雾试验室",
          displayStatus: "送至实验室",
          targetExperimentCode: "",
          targetLab: "",
          trayCode: "TP-MISSING-TARGET",
          trayStatus: "送至实验室",
        },
      ],
      allTrayRows: [],
    };

    const result = validateLaboratoryTrayScan({
      currentTask,
      scanCode: "TP-MISSING-TARGET",
      scheduleRows: [currentTask],
    });

    expect(result).toEqual(expect.objectContaining({
      message: "托盘未送达当前试验间",
      ok: false,
      tone: "error",
      trayCode: "TP-MISSING-TARGET",
    }));
  });

  test("validateLaboratoryTrayScan allows a canceled mold tray to compare against a new mold schedule in place", () => {
    const taskCode = "TASK-MOLD-RERUN";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const buildView = ({ location = "霉菌试验室", scheduleId = "SCHEDULE-MOLD-NEW", status = "实验已取消" } = {}) =>
      buildLaboratoryWorkbenchView({
        experimentRuns: [{
          device: "霉菌试验室",
          ended_at: "2026-09-03 09:00:00",
          experiment_code: experimentCode,
          run_no: "RUN-MOLD-CANCELED",
          schedule_id: "SCHEDULE-MOLD-OLD",
          status: "实验已取消",
          task_code: taskCode,
        }],
        experimentRunTrays: [{
          ended_at: "2026-09-03 09:00:00",
          experiment_code: experimentCode,
          run_no: "RUN-MOLD-CANCELED",
          run_tray_status: "实验已取消",
          status: "实验已取消",
          task_code: taskCode,
          tray_code: trayCode,
        }],
        experiments: [{
          experiment_code: experimentCode,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验室",
          status: "已排程",
          task_code: taskCode,
        }],
        experimentTrays: [{ experiment_code: experimentCode, task_code: taskCode, tray_code: trayCode }],
        labCode: "LAB_MOLD",
        labName: "霉菌试验室",
        now: new Date("2026-09-03T09:30:00+08:00"),
        samples: [{
          code: `${taskCode}-SP-001`,
          flow_status: status,
          history: [{
            action: "取消本次霉菌实验",
            detail: `${taskCode} / 霉菌试验 / 实验已取消 / 原因：霉菌未按预期繁殖`,
            location: "霉菌试验室",
            status: "实验已取消",
            time: "2026-09-03 09:00:00",
            tray_code: trayCode,
          }],
          location,
          status,
          task_code: taskCode,
          trays: [{ quantity: 1, status, tray_code: trayCode }],
        }],
        schedules: [{
          device: "霉菌试验室",
          end_at: "2026-09-04 10:00:00",
          experiment_code: experimentCode,
          id: scheduleId,
          lab_code: "LAB_MOLD",
          start_at: "2026-09-03 10:00:00",
          status: "已排程",
          task_code: taskCode,
        }],
        selectedTrayCode: trayCode,
        tasks: [{ code: taskCode, name: "霉菌取消后重排", test_type: "霉菌试验" }],
      });

    const view = buildView();
    expect(view.currentTask?.trayRows[0]).toEqual(expect.objectContaining({
      canceledMoldRerunEligible: true,
      canceledMoldRunNo: "RUN-MOLD-CANCELED",
      canceledMoldScheduleId: "SCHEDULE-MOLD-OLD",
      currentLocation: "霉菌试验室",
      lifecycleStatus: "实验已取消",
      trayStatus: "实验已取消",
    }));
    expect(view.selectedTrayFlow.currentStatus).toBe(
      `当前托盘：${trayCode} | 当前状态：霉菌试验已取消`,
    );
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode,
    }));

    const stagedView = buildView({ location: "恒温恒湿间（暂存间）", status: "已到达暂存间" });
    expect(validateLaboratoryTrayScan({
      allScheduleRows: stagedView.allScheduleRows,
      currentTask: stagedView.currentTask,
      scanCode: trayCode,
      scheduleRows: stagedView.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "托盘尚未出库",
      ok: false,
      trayCode,
    }));

    const staleScheduleView = buildView({ scheduleId: "SCHEDULE-MOLD-OLD" });
    expect(staleScheduleView.currentTask?.trayRows[0]?.canceledMoldRerunEligible).toBe(false);
    expect(validateLaboratoryTrayScan({
      allScheduleRows: staleScheduleView.allScheduleRows,
      currentTask: staleScheduleView.currentTask,
      scanCode: trayCode,
      scheduleRows: staleScheduleView.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "托盘尚未出库",
      ok: false,
      trayCode,
    }));
  });

  test("validateLaboratoryTrayScan accepts lab dispatch restored from latest stock-out history", () => {
    const taskCode = "SYLU-2026-06-024";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "振动试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "盐雾试验" },
      ],
      labName: "振动一室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "送至实验室",
          history: [
            {
              action: "暂存间扫码出库",
              detail: `${trayCode} 送至 振动一室`,
              location: "振动一室",
              status: "送至实验室",
              time: "2026-06-14 19:30:56",
            },
          ],
          location: "接驳区",
          owner: "王工",
          status: "送至实验室",
          task_code: taskCode,
          trays: [{ tray_code: trayCode, quantity: 1, status: "送至实验室" }],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击一室", start_at: "2026-06-18 08:00:00" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "振动一室", start_at: "2026-06-18 08:00:00" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "盐雾试验室", start_at: "2026-06-18 08:00:00" },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "复合实验任务", test_type: "冲击试验 / 振动试验 / 盐雾试验" }],
    });

    expect(view.selectedTrayRow).toEqual(expect.objectContaining({
      targetExperimentCode: `${taskCode}-B`,
      targetLab: "振动一室",
      trayStatus: "送至实验室",
    }));
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "当前没有可比对的任务",
      ok: false,
      tone: "error",
    }));
  });

  test("validateLaboratoryTrayScan accepts continuing the same axis experiment after partial completion", () => {
    const taskCode = "SYLU-2026-06-024";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "RUN-IMPACT-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击二室",
          status: "实验已完成",
          started_at: "2026-06-30 22:06:15",
          ended_at: "2026-06-30 22:06:18",
          tray_codes: [trayCode],
          sub_experiment_code: `${experimentCode}-AXIS-001`,
          axis_codes: ["y-", "z+", "z-"],
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: trayCode,
          status: "实验已完成",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-30 22:06:18",
          sub_experiment_code: `${experimentCode}-AXIS-001`,
        },
      ],
      experimentRunSteps: [
        { run_no: "RUN-IMPACT-001", task_code: taskCode, experiment_code: experimentCode, axis_code: "y-", status: "实验已完成", sub_experiment_code: `${experimentCode}-AXIS-001` },
        { run_no: "RUN-IMPACT-001", task_code: taskCode, experiment_code: experimentCode, axis_code: "z+", status: "实验已完成", sub_experiment_code: `${experimentCode}-AXIS-001` },
        { run_no: "RUN-IMPACT-001", task_code: taskCode, experiment_code: experimentCode, axis_code: "z-", status: "实验已完成", sub_experiment_code: `${experimentCode}-AXIS-001` },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          status: "实验进行中",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      labName: "冲击二室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "冲击试验部分完成 3/6轴",
          history: [
            { action: "送至实验室", location: "冲击二室", status: "送至实验室", detail: `${trayCode} -> 冲击二室`, time: "2026-06-30 22:05:54" },
            { action: "任务比对", location: "冲击二室", status: "已到达实验室", detail: `${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`, time: "2026-06-30 22:06:05" },
            { action: "实验完成", location: "冲击二室", status: "冲击试验部分完成 3/6轴", detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`, time: "2026-06-30 22:06:18" },
          ],
          location: "冲击二室",
          owner: "",
          status: "冲击试验部分完成 3/6轴",
          task_code: taskCode,
          trays: [
            {
              tray_code: trayCode,
              quantity: 1,
              status: "冲击试验部分完成 3/6轴",
              target_lab: "冲击二室",
              target_experiment_code: experimentCode,
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-impact-axis-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击二室",
          start_at: "2026-07-01 08:00:00",
          end_at: "2026-07-01 11:30:00",
          status: "实验已完成",
          sub_experiment_code: `${experimentCode}-AXIS-001`,
          axis_codes: ["y-", "z+", "z-"],
        },
        {
          id: "schedule-impact-axis-002",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击二室",
          start_at: "2026-07-05 08:00:00",
          end_at: "2026-07-05 11:30:00",
          status: "已排程",
          sub_experiment_code: `${experimentCode}-AXIS-002`,
          axis_codes: ["x+", "x-", "y+"],
        },
      ],
      selectedTaskCode: "schedule-impact-axis-002",
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "轴向继续任务", test_type: "冲击试验" }],
    });

    expect(view.currentTask).toEqual(expect.objectContaining({
      id: "schedule-impact-axis-002",
      taskCode,
    }));
    expect(view.selectedTrayRow).toEqual(expect.objectContaining({
      targetExperimentCode: experimentCode,
      targetLab: "冲击二室",
      trayStatus: "冲击试验部分完成 3/6轴",
    }));
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode,
    }));
  });

  test("validateLaboratoryTrayScan ignores non-lab dispatch history when restoring target", () => {
    const taskCode = "SYLU-2026-06-025";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "振动试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "盐雾试验" },
      ],
      labName: "振动一室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "送至实验室",
          history: [
            {
              action: "暂存间扫码出库",
              detail: `${trayCode} 送至 振动一室`,
              location: "振动一室",
              status: "送至实验室",
              target_type: "staging",
              time: "2026-06-14 19:30:56",
            },
          ],
          location: "接驳区",
          owner: "王工",
          status: "送至实验室",
          task_code: taskCode,
          trays: [{ tray_code: trayCode, quantity: 1, status: "送至实验室" }],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击一室", start_at: "2026-06-18 08:00:00" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "振动一室", start_at: "2026-06-18 08:00:00" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "盐雾试验室", start_at: "2026-06-18 08:00:00" },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "振动实验任务", test_type: "振动试验" }],
    });

    expect(view.selectedTrayRow).toEqual(expect.objectContaining({
      targetExperimentCode: "",
      targetLab: "",
      trayStatus: "送至实验室",
    }));
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "当前没有可比对的任务",
      ok: false,
      tone: "error",
    }));
  });

  test("validateLaboratoryTrayScan blocks trays that must enter appearance inspection before another lab", () => {
    const view = buildSaltSprayLaboratoryView({
      experimentTrays: [
        { task_code: "SYLU-2026-05-705", experiment_code: "SYLU-2026-05-705-A", tray_code: "TP-TO-APPEARANCE" },
      ],
      experiments: [
        { task_code: "SYLU-2026-05-705", experiment_code: "SYLU-2026-05-705-A", experiment_name: "盐雾试验" },
      ],
      now: NOW,
      samples: [
        {
          code: "SP-TO-APPEARANCE",
          location: "盐雾试验室",
          owner: "王工",
          status: "送至外观检测间",
          task_code: "SYLU-2026-05-705",
          trays: [{ tray_code: "TP-TO-APPEARANCE", quantity: 1, status: "送至外观检测间" }],
        },
      ],
      schedules: [
        {
          id: "schedule-to-appearance",
          task_code: "SYLU-2026-05-705",
          experiment_code: "SYLU-2026-05-705-A",
          device: "盐雾试验室",
          start_at: "2026-05-13T09:00:00.000Z",
          end_at: "2026-05-13T11:00:00.000Z",
        },
      ],
      tasks: [{ code: "SYLU-2026-05-705", name: "待外观检测任务", test_type: "盐雾试验" }],
    });

    const result = validateLaboratoryTrayScan({
      currentTask: view.currentTask,
      scanCode: "TP-TO-APPEARANCE",
      scheduleRows: view.scheduleRows,
    });

    expect(result).toEqual(expect.objectContaining({
      guidance: "当前托盘需先进入外观检测间并完成入库，再由外观检测间出库送至实验室。",
      message: "托盘尚未出库",
      ok: false,
      tone: "error",
      trayCode: "TP-TO-APPEARANCE",
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

  test.each([
    ["到货", "接驳区"],
    ["已到达暂存间", "恒温恒湿间（暂存间）"],
    ["实验前外观检测间存放", "外观检测间"],
  ])("buildLaboratoryWorkflowFromTask disables compare when every tray is still before laboratory dispatch: %s", (trayStatus, currentLocation) => {
    const experimentCode = "EXP-PRE-DISPATCH";
    const task = {
      device: "盐雾试验室",
      experimentCode,
      trayRows: [{
        currentLocation,
        displayStatus: trayStatus,
        experimentCodes: [experimentCode],
        lifecycleLocation: currentLocation,
        lifecycleStatus: trayStatus,
        trayCode: "TP-PRE-DISPATCH",
        trayStatus,
      }],
    };

    const workflow = buildLaboratoryWorkflowFromTask(task);

    expect(workflow.hasComparableTrayWithoutActiveOtherExperiment).toBe(false);
    expect(getLaboratoryActionState(workflow).canCompare).toBe(false);
  });

  test("buildLaboratoryWorkflowFromTask keeps compare available when at least one tray reached the current laboratory", () => {
    const experimentCode = "EXP-MIXED-DISPATCH";
    const task = {
      device: "盐雾试验室",
      experimentCode,
      trayRows: [
        {
          currentLocation: "盐雾试验室",
          experimentCodes: [experimentCode],
          lifecycleLocation: "盐雾试验室",
          lifecycleStatus: "送至实验室",
          targetExperimentCode: experimentCode,
          targetLab: "盐雾试验室",
          trayCode: "TP-DISPATCHED",
          trayStatus: "送至实验室",
        },
        {
          currentLocation: "恒温恒湿间（暂存间）",
          experimentCodes: [experimentCode],
          lifecycleLocation: "恒温恒湿间（暂存间）",
          lifecycleStatus: "已到达暂存间",
          trayCode: "TP-STAGING",
          trayStatus: "已到达暂存间",
        },
      ],
    };

    const workflow = buildLaboratoryWorkflowFromTask(task);

    expect(workflow.hasComparableTrayWithoutActiveOtherExperiment).toBe(true);
    expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
  });

  test("buildLaboratoryWorkflowFromTask disables compare when only the unprocessed tray is still before dispatch", () => {
    const experimentCode = "EXP-PARTIAL-COMPARE";
    const task = {
      device: "盐雾试验室",
      experimentCode,
      trayRows: [
        {
          currentLocation: "盐雾试验室",
          experimentCodes: [experimentCode],
          lifecycleLocation: "盐雾试验室",
          lifecycleStatus: "已到达实验室",
          targetExperimentCode: experimentCode,
          targetLab: "盐雾试验室",
          trayCode: "TP-COMPARED",
          trayStatus: "已到达实验室",
        },
        {
          currentLocation: "外观检测间",
          experimentCodes: [experimentCode],
          lifecycleLocation: "外观检测间",
          lifecycleStatus: "实验前外观检测间存放",
          trayCode: "TP-APPEARANCE",
          trayStatus: "实验前外观检测间存放",
        },
      ],
    };

    const workflow = buildLaboratoryWorkflowFromTask(task);

    expect(workflow.comparisonDone).toBe(false);
    expect(workflow.hasComparableTrayWithoutActiveOtherExperiment).toBe(false);
    expect(getLaboratoryActionState(workflow).canCompare).toBe(false);
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

  test("buildLaboratoryWorkbenchView keeps compare arrival ahead of an older partial axis status", () => {
    const taskCode = "SYLU-2026-07-001";
    const experimentCode = `${taskCode}-VIB`;
    const trayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: experimentCode,
          experiment_name: "振动试验",
          task_code: taskCode,
        },
      ],
      labCode: "LAB_VIBRATION_1",
      labName: "振动一室",
      samples: [
        {
          code: `${taskCode}-SP-002`,
          flow_status: "已到达实验室",
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 3/6轴`,
              location: "振动一室",
              status: "振动试验部分完成 3/6轴",
              time: "2026-06-29 16:12:56",
              tray_code: trayCode,
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 振动试验 / 已到达实验室`,
              location: "振动一室",
              status: "已到达实验室",
              time: "2026-06-29 16:20:00",
              tray_code: trayCode,
            },
          ],
          location: "振动一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: experimentCode,
              target_lab: "振动一室",
              tray_code: trayCode,
              updated_at: "2026-06-29 16:20:00",
            },
          ],
          updated_at: "2026-06-29 16:20:00",
        },
      ],
      schedules: [
        {
          axis_codes: ["y-", "z+", "z-"],
          device: "振动一室",
          experiment_code: experimentCode,
          id: "schedule-vibration-rest",
          lab_code: "LAB_VIBRATION_1",
          start_at: "2026-06-30 12:00:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "振动任务", test_type: "振动试验" }],
    });

    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：已到达实验室`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "已到达实验室")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "振动试验部分完成 3/6轴")).not.toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildSaltSprayLaboratoryView formats schedule labels in Beijing business time", () => {
    const view = buildSaltSprayLaboratoryView({
      experiments: [
        { task_code: "SYLU-2026-07-001", experiment_code: "SYLU-2026-07-001-A", experiment_name: "盐雾试验-A" },
      ],
      now: new Date("2026-07-03T01:30:00.000Z"),
      samples: [],
      schedules: [
        {
          id: "schedule-beijing",
          task_code: "SYLU-2026-07-001",
          experiment_code: "SYLU-2026-07-001-A",
          device: "盐雾试验室",
          start_at: "2026-07-03T01:00:00.000Z",
          end_at: "2026-07-03T03:00:00.000Z",
        },
      ],
      tasks: [
        { code: "SYLU-2026-07-001", name: "盐雾连接器", test_type: "盐雾试验" },
      ],
    });

    expect(view.scheduleRows[0]).toEqual(expect.objectContaining({
      dateTimeRange: "2026-07-03 09:00 - 2026-07-03 11:00",
      endDateTimeLabel: "2026-07-03 11:00",
      startDateTimeLabel: "2026-07-03 09:00",
      timeRange: "09:00 - 11:00",
    }));
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

  test("applyLaboratoryTaskStep rewrites stale tray target to the current experiment", () => {
    const updatedSamples = applyLaboratoryTaskStep({
      currentTask: {
        device: "高低温湿热一室",
        experimentCode: "SYLU-2026-06-021-C",
        experimentName: "高低温湿热试验",
        taskCode: "SYLU-2026-06-021",
        trayCodes: ["SYLU-2026-06-021-TP-001"],
      },
      historyAction: "任务比对",
      nextStatus: "已到达实验室",
      now: "2026-06-12 13:50:58",
      samples: [
        {
          code: "SYLU-2026-06-021-SP-001",
          flow_status: "已到达实验室",
          history: [],
          location: "高低温湿热一室",
          status: "已到达实验室",
          task_code: "SYLU-2026-06-021",
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: "SYLU-2026-06-021-F",
              target_lab: "温度冲击一室",
              tray_code: "SYLU-2026-06-021-TP-001",
            },
          ],
        },
      ],
    });

    expect(updatedSamples[0].trays[0]).toEqual(expect.objectContaining({
      status: "已到达实验室",
      target_experiment_code: "SYLU-2026-06-021-C",
      target_lab: "高低温湿热一室",
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

  test("revertLaboratoryTaskToPreDispatch leaves trays unchanged when no restore snapshot exists", () => {
    const originalSample = {
      code: "SYLU-2026-04-503-SP-001",
      flow_status: "工装夹具安装",
      history: [],
      location: "盐雾试验室",
      owner: "王工",
      status: "工装夹具安装",
      task_code: "SYLU-2026-04-503",
      trays: [{ quantity: 1, status: "工装夹具安装", tray_code: "TP-NO-RESTORE" }],
    };

    const updatedSamples = revertLaboratoryTaskToPreDispatch({
      currentTask: {
        device: "盐雾试验室",
        experimentCode: "SYLU-2026-04-503-A",
        experimentName: "盐雾试验",
        taskCode: "SYLU-2026-04-503",
        trayCodes: ["TP-NO-RESTORE"],
      },
      now: "2026-04-02T10:50:00.000Z",
      samples: [originalSample],
    });

    expect(updatedSamples[0]).toEqual(originalSample);
    expect(updatedSamples[0].status).not.toBe("已到达暂存间");
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
            { action: "外观检测间扫码入库", detail: "TP-702 实验后外观检测间存放", location: "外观检测间", status: "实验后外观检测间存放", time: "2026-06-06T21:40:00.000Z" },
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
      flow_status: "实验后外观检测间存放",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      trays: [expect.objectContaining({ status: "实验后外观检测间存放", tray_code: "TP-702" })],
    }));
    expect(updatedSamples[0].history[0]).toEqual(expect.objectContaining({
      action: "任务切换撤回",
      detail: "TASK-702 / 高低温湿热试验 / 撤回至实验后外观检测间存放",
      location: "外观检测间",
      status: "实验后外观检测间存放",
    }));
  });

  test("revertLaboratoryTaskToPreviousStableState restores pre-experiment appearance storage before current lab dispatch", () => {
    const updatedSamples = revertLaboratoryTaskToPreviousStableState({
      currentTask: {
        device: "盐雾试验室",
        experimentCode: "TASK-703-B",
        experimentName: "盐雾试验",
        taskCode: "TASK-703",
        trayCodes: ["TP-703"],
      },
      now: "2026-06-06T22:10:00.000Z",
      samples: [
        {
          code: "TASK-703-SP-001",
          flow_status: "已到达实验室",
          history: [
            { action: "任务比对", detail: "TASK-703 / 盐雾试验 / 已到达实验室", location: "盐雾试验室", status: "已到达实验室", time: "2026-06-06T22:00:00.000Z" },
            { action: "外观检测间扫码出库", detail: "TP-703 送至 盐雾试验室", location: "盐雾试验室", status: "送至实验室", time: "2026-06-06T21:50:00.000Z" },
            { action: "外观检测间扫码入库", detail: "TP-703 实验前外观检测间存放", location: "外观检测间", status: "实验前外观检测间存放", time: "2026-06-06T21:40:00.000Z" },
          ],
          location: "盐雾试验室",
          owner: "王工",
          status: "已到达实验室",
          task_code: "TASK-703",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-703" }],
        },
      ],
    });

    expect(updatedSamples[0]).toEqual(expect.objectContaining({
      flow_status: "实验前外观检测间存放",
      location: "外观检测间",
      status: "实验前外观检测间存放",
      trays: [expect.objectContaining({ status: "实验前外观检测间存放", tray_code: "TP-703" })],
    }));
    expect(updatedSamples[0].history[0]).toEqual(expect.objectContaining({
      action: "任务切换撤回",
      detail: "TASK-703 / 盐雾试验 / 撤回至实验前外观检测间存放",
      location: "外观检测间",
      status: "实验前外观检测间存放",
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

  test("keeps impact comparison available when another tray in the same task is running salt spray", () => {
    const taskCode = "SYLU-2026-07-001";
    const saltTrayCode = `${taskCode}-TP-001`;
    const impactTrayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-salt-001",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          device: "盐雾试验室",
          status: "实验进行中",
          started_at: "2026-06-18 16:52:13",
          tray_codes: [saltTrayCode],
        },
      ],
      experimentRunTrays: [
        {
          run_no: "run-salt-001",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: saltTrayCode,
          run_tray_status: "实验进行中",
          status: "实验进行中",
          started_at: "2026-06-18 16:52:13",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: saltTrayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: impactTrayCode },
      ],
      experiments: [
        {
          experiment_code: `${taskCode}-A`,
          experiment_name: "盐雾试验",
          status: "实验进行中",
          task_code: taskCode,
        },
        {
          experiment_code: `${taskCode}-B`,
          experiment_name: "冲击试验",
          status: "已排程",
          task_code: taskCode,
        },
      ],
      labName: "冲击二室",
      now: new Date("2026-06-18T16:53:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "实验进行中",
          location: "盐雾试验室",
          status: "实验进行中",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验进行中",
              target_experiment_code: `${taskCode}-A`,
              target_lab: "盐雾试验室",
              tray_code: saltTrayCode,
            },
          ],
        },
        {
          code: `${taskCode}-SP-002`,
          flow_status: "送至实验室",
          history: [
            {
              action: "暂存间扫码出库",
              detail: `${impactTrayCode} 送至 冲击二室`,
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-18 16:52:30",
            },
          ],
          location: "冲击二室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: `${taskCode}-B`,
              target_lab: "冲击二室",
              tray_code: impactTrayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "冲击二室",
          experiment_code: `${taskCode}-B`,
          start_at: "2026-06-18 16:30:00",
          task_code: taskCode,
        },
        {
          device: "盐雾试验室",
          experiment_code: `${taskCode}-A`,
          start_at: "2026-06-18 16:30:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: impactTrayCode,
      tasks: [{ code: taskCode, name: "冲击盐雾任务", test_type: "盐雾试验 / 冲击试验" }],
    });

    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(view.currentTask.experimentCode).toBe(`${taskCode}-B`);
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${impactTrayCode} | 当前状态：送至冲击二室`);
    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: true,
      canInstallSample: false,
      canMarkReady: false,
    });
    expect(validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: impactTrayCode,
      scheduleRows: view.scheduleRows,
    })).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode: impactTrayCode,
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

      if (experimentCode === `${taskCode}-C`) {
        expect(view.currentTask).toBeNull();
        expect(view.scheduleRows[0]).toEqual(expect.objectContaining({ sequenceEligible: false }));
        return;
      }
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

  test("allows installation when current experiment comparison history overrides stale tray target", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          tray_code: trayCode,
          status: "实验已完成",
        },
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-F`,
          tray_code: trayCode,
          status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-F`, tray_code: trayCode },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "霉菌试验", status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "高低温湿热试验", status: "已排程" },
        { task_code: taskCode, experiment_code: `${taskCode}-F`, experiment_name: "温度冲击试验", status: "实验已完成" },
      ],
      labCode: "LAB_HOT_HUMID",
      labName: "高低温湿热一室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "已到达实验室",
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 高低温湿热试验 / 已到达实验室`,
              location: "高低温湿热一室",
              status: "已到达实验室",
              time: "2026-06-12 13:50:58",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 温度冲击试验 / 实验已完成`,
              location: "温度冲击一室",
              status: "实验已完成",
              time: "2026-06-12 13:49:42",
              tray_code: trayCode,
            },
          ],
          location: "高低温湿热一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: `${taskCode}-F`,
              target_lab: "温度冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "高低温湿热一室",
          experiment_code: `${taskCode}-C`,
          lab_code: "LAB_HOT_HUMID",
          start_at: "2026-06-12 13:46:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "复合实验任务" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(view.currentTask.experimentCode).toBe(`${taskCode}-C`);
    expect(view.currentTask.trayRows[0]).toEqual(expect.objectContaining({
      targetExperimentCode: `${taskCode}-C`,
      targetLab: "高低温湿热一室",
      trayStatus: "已到达实验室",
    }));
    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: false,
      canInstallSample: true,
      canMarkReady: false,
    });
  });

  test("allows installation for an axis schedule when comparison history overrides stale tray target", () => {
    const taskCode = "SYLU-2026-08-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const vibrationExperimentCode = `${taskCode}-D`;
    const view = buildLaboratoryWorkbenchView({
      experimentTrays: [
        { task_code: taskCode, experiment_code: impactExperimentCode, tray_code: trayCode },
        { task_code: taskCode, experiment_code: vibrationExperimentCode, tray_code: trayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          status: "已排程",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
        {
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          status: "已排程",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      labCode: "LAB_VIBRATION_1",
      labName: "振动一室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "已到达实验室",
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 振动试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "振动一室",
              status: "已到达实验室",
              time: "2026-07-01 16:16:05",
              tray_code: trayCode,
            },
          ],
          location: "振动一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-vibration-axis",
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-07-01 15:30:00",
          end_at: "2026-07-01 18:00:00",
          axis_codes: ["x+", "x-", "y+"],
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "振动冲击任务", test_type: "冲击试验 / 振动试验" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(view.currentTask.experimentCode).toBe(vibrationExperimentCode);
    expect(view.currentTask.trayRows[0]).toEqual(expect.objectContaining({
      currentExperimentHistoryStatus: "已到达实验室",
      targetExperimentCode: vibrationExperimentCode,
      targetLab: "振动一室",
      trayStatus: "已到达实验室",
    }));
    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: false,
      canInstallSample: true,
      canMarkReady: false,
    });
  });

  test("allows installing an impact schedule after comparing a tray whose stale target points to a partially completed vibration experiment", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          run_no: "run-vibration-axis",
          schedule_id: "schedule-vibration-z",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          device: "振动一室",
          status: "实验已完成",
          axis_codes: ["z+", "z-"],
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: [
        { run_no: "run-vibration-axis", task_code: taskCode, experiment_code: `${taskCode}-A`, axis_code: "z+", status: "实验已完成" },
        { run_no: "run-vibration-axis", task_code: taskCode, experiment_code: `${taskCode}-A`, axis_code: "z-", status: "实验已完成" },
      ],
      experimentRunTrays: [
        {
          run_no: "run-vibration-axis",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          status: "实验已完成",
          run_tray_status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          experiment_name: "振动试验",
          status: "实验已完成",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          experiment_name: "冲击试验",
          status: "已排程",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      labCode: "LAB_IMPACT_1",
      labName: "冲击一室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "已到达实验室",
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 冲击试验 / 已到达实验室`,
              location: "冲击一室",
              status: "已到达实验室",
              time: "2026-06-25 10:39:46",
            },
            {
              action: "开始实验",
              detail: `${taskCode} / 振动试验 / 实验进行中 / 托盘：${trayCode}`,
              location: "振动一室",
              status: "实验进行中",
              time: "2026-06-24 19:17:09",
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 振动试验 / 已到达实验室`,
              location: "振动一室",
              status: "已到达实验室",
              time: "2026-06-24 19:16:56",
            },
          ],
          location: "冲击一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: `${taskCode}-A`,
              target_lab: "振动一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-impact-z",
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-25 08:00:00",
          end_at: "2026-06-25 11:30:00",
          axis_codes: ["z+", "z-"],
        },
        {
          id: "schedule-vibration-z",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-06-25 08:00:00",
          end_at: "2026-06-25 11:30:00",
          axis_codes: ["z+", "z-"],
        },
        {
          id: "schedule-vibration-y",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          lab_code: "LAB_VIBRATION_1",
          device: "振动一室",
          start_at: "2026-06-26 08:00:00",
          end_at: "2026-06-26 11:30:00",
          axis_codes: ["y+"],
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "振动冲击任务", test_type: "振动试验 / 冲击试验" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
    const operationLock = getLaboratoryOperationLock(view.allScheduleRows, view.currentTask, {
      code: "LAB_IMPACT_1",
      name: "冲击一室",
    });

    expect(view.currentTask.experimentCode).toBe(`${taskCode}-B`);
    expect(view.currentTask.trayRows[0]).toEqual(expect.objectContaining({
      targetExperimentCode: `${taskCode}-B`,
      targetLab: "冲击一室",
      trayStatus: "已到达实验室",
    }));
    expect(operationLock).toEqual({ active: false });
    expect(getLaboratoryActionState(workflow)).toEqual({
      canCompare: false,
      canInstallSample: true,
      canMarkReady: false,
    });
  });

  test("allows direct comparison in another lab after a later experiment completed while an axis experiment remains partial", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const combinedExperimentCode = `${taskCode}-COMBINED`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          axis_codes: ["y+", "z+"],
          ended_at: "2026-06-28 10:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-06-28 11:00:00",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: [
        {
          axis_code: "y+",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
        {
          axis_code: "z+",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-28 10:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-28 11:00:00",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["y+", "z+", "x+", "x-", "y-", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
          task_code: taskCode,
        },
        {
          axis_codes: ["y+", "z+", "x+", "x-", "y-", "z-"],
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
      ],
      labCode: "LAB_VIBRATION_2",
      labName: "振动二室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / ${"四综合试验"} / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-06-28 11:00:00",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / ${"冲击试验"} / 冲击试验部分完成 2/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 2/6轴",
              time: "2026-06-28 10:00:00",
              tray_code: trayCode,
            },
          ],
          location: "四综合实验室",
          status: "冲击试验部分完成 2/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 2/6轴",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击二室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "振动二室",
          experiment_code: vibrationExperimentCode,
          lab_code: "LAB_VIBRATION_2",
          axis_codes: ["y-", "z-"],
          start_at: "2026-06-28 12:00:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "轴向后续试验任务" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
    const scanResult = validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    });

    expect(view.currentTask.experimentCode).toBe(vibrationExperimentCode);
    expect(scanResult).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode,
    }));
    expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：四综合试验已完成`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "四综合试验已完成")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至振动二室")).not.toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("allows direct vibration comparison after tray 002 completed only part of impact axes", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-002`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          axis_codes: ["y+", "z+"],
          ended_at: "2026-06-28 10:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-TP002-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: [
        {
          axis_code: "y+",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-TP002-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
        {
          axis_code: "z+",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-TP002-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-28 10:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-TP002-PARTIAL",
          run_tray_status: "冲击试验部分完成 2/6轴",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["y+", "z+", "x+", "x-", "y-", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击二室",
          task_code: taskCode,
        },
        {
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
      ],
      labCode: "LAB_VIBRATION_2",
      labName: "振动二室",
      samples: [
        {
          code: `${taskCode}-SP-002`,
          location: "冲击二室",
          status: "冲击试验部分完成 2/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 2/6轴",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "振动二室",
          experiment_code: vibrationExperimentCode,
          lab_code: "LAB_VIBRATION_2",
          start_at: "2026-06-28 12:00:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "轴向直送振动任务" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
    const scanResult = validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    });

    expect(view.currentTask.experimentCode).toBe(vibrationExperimentCode);
    expect(scanResult).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode,
    }));
    expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
  });

  test("keeps partial vibration flow instead of inventing current lab dispatch", () => {
    const taskCode = "SYLU-2026-06-022";
    const trayCode = `${taskCode}-TP-001`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const moldExperimentCode = `${taskCode}-MOLD`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          axis_codes: ["z+", "z-"],
          ended_at: "2026-06-29 18:30:00",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: [
        {
          axis_code: "z+",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
        {
          axis_code: "z-",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-29 18:30:00",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-PARTIAL",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: moldExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
        {
          experiment_code: moldExperimentCode,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验室",
          task_code: taskCode,
        },
      ],
      labCode: "LAB_MOLD",
      labName: "霉菌试验室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 2/6轴`,
              location: "振动二室",
              status: "振动试验部分完成 2/6轴",
              time: "2026-06-29 18:30:00",
              tray_code: trayCode,
            },
          ],
          location: "振动二室",
          status: "振动试验部分完成 2/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "振动试验部分完成 2/6轴",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "霉菌试验室",
          experiment_code: moldExperimentCode,
          lab_code: "LAB_MOLD",
          start_at: "2026-07-03 08:00:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "振动后霉菌任务", test_type: "振动试验 / 霉菌试验" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
    const scanResult = validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    });

    expect(scanResult).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode,
    }));
    expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：振动试验部分完成 2/6轴`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "振动试验部分完成 2/6轴")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至霉菌试验室")).not.toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("keeps partial impact flow when completed physical tray status has no dispatch target", () => {
    const taskCode = "SYLU-2026-06-021";
    const impactExperimentCode = `${taskCode}-A`;
    const combinedExperimentCode = `${taskCode}-B`;
    const moldExperimentCode = `${taskCode}-C`;
    const saltExperimentCode = `${taskCode}-D`;
    const buildInput = (trayCode) => ({
      experimentRuns: [
        {
          axis_codes: ["z+", "z-"],
          ended_at: "2026-06-30 14:54:41",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: [
        {
          axis_code: "z+",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
        {
          axis_code: "z-",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 14:54:41",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: moldExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合试验",
          task_code: taskCode,
        },
        {
          experiment_code: moldExperimentCode,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
          task_code: taskCode,
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 2/6轴`,
              location: "冲击二室",
              status: "冲击试验部分完成 2/6轴",
              time: "2026-06-30 14:54:41",
              tray_code: trayCode,
            },
          ],
          location: "冲击二室",
          status: "实验已完成",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              tray_code: trayCode,
            },
          ],
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "021复现任务", test_type: "冲击试验 / 四综合试验 / 霉菌试验 / 盐雾试验" }],
    });
    const labCases = [
      { experimentCode: combinedExperimentCode, labCode: "LAB_COMBINED", labName: "四综合实验室" },
      { experimentCode: saltExperimentCode, labCode: "LAB_SALT", labName: "盐雾试验室" },
      { experimentCode: moldExperimentCode, labCode: "LAB_MOLD", labName: "霉菌试验室" },
    ];

    [`${taskCode}-TP-001`, "TP-001"].forEach((trayCode) => {
      labCases.forEach(({ experimentCode, labCode, labName }) => {
        const view = buildLaboratoryWorkbenchView({
          ...buildInput(trayCode),
          labCode,
          labName,
          schedules: [
            {
              device: labName,
              experiment_code: experimentCode,
              lab_code: labCode,
              start_at: "2026-06-30 14:52:00",
              task_code: taskCode,
            },
          ],
        });
        const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
        const scanResult = validateLaboratoryTrayScan({
          allScheduleRows: view.allScheduleRows,
          currentTask: view.currentTask,
          scanCode: trayCode,
          scheduleRows: view.scheduleRows,
        });

        expect(scanResult).toEqual(expect.objectContaining({
          message: "比对正确",
          ok: true,
          trayCode,
        }));
        expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
        expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：冲击试验部分完成 2/6轴`);
        expect(view.selectedTrayFlow.steps.find((step) => step.label === "冲击试验部分完成 2/6轴")).toEqual(
          expect.objectContaining({ active: true }),
        );
        expect(view.selectedTrayFlow.steps.find((step) => step.label === `送至${labName}`)).not.toEqual(
          expect.objectContaining({ active: true }),
        );
      });
    });
  });

  test("keeps laboratory tray flow independent from current impact context after later mold completion", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-003`;
    const impactExperimentCode = `${taskCode}-A`;
    const moldExperimentCode = `${taskCode}-B`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;

    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          axis_codes: ["z+", "z-"],
          ended_at: "2026-06-30 20:17:03",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-06-30 20:27:03",
          experiment_code: moldExperimentCode,
          run_no: "RUN-MOLD-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: ["z+", "z-"].map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactSubExperimentCode,
        task_code: taskCode,
      })),
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 20:17:03",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 20:27:03",
          experiment_code: moldExperimentCode,
          run_no: "RUN-MOLD-DONE",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: moldExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          task_code: taskCode,
        },
        {
          experiment_code: moldExperimentCode,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验",
          task_code: taskCode,
        },
      ],
      labCode: "LAB_IMPACT_2",
      labName: "冲击二室",
      samples: [
        {
          code: `${taskCode}-SP-003`,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 霉菌试验 / 实验已完成`,
              location: "霉菌试验室",
              status: "实验已完成",
              time: "2026-06-30 20:27:03",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 2/6轴`,
              location: "冲击二室",
              status: "冲击试验部分完成 2/6轴",
              time: "2026-06-30 20:17:03",
              tray_code: trayCode,
            },
          ],
          location: "霉菌试验室",
          status: "实验已完成",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: ["z+", "z-"],
          device: "冲击二室",
          experiment_code: impactExperimentCode,
          lab_code: "LAB_IMPACT_2",
          start_at: "2026-07-01 08:00:00",
          status: "实验进行中",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
        },
        {
          axis_codes: ["y+", "y-"],
          device: "冲击二室",
          experiment_code: impactExperimentCode,
          lab_code: "LAB_IMPACT_2",
          start_at: "2026-07-02 08:00:00",
          status: "已排程",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "021复现任务", test_type: "冲击试验 / 霉菌试验" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
    const scanResult = validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    });
    const labels = view.selectedTrayFlow.steps.map((step) => step.label);

    expect(scanResult).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode,
    }));
    expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
    expect(labels).toEqual([
      "样品运输中",
      "到货",
      "冲击试验部分完成 2/6轴",
      "霉菌试验已完成",
      "送至暂存间",
      "已到达暂存间",
      "待继续冲击试验：剩余 4/6轴",
      "厂家收回",
    ]);
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：霉菌试验已完成`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "冲击试验部分完成 2/6轴")).toEqual(
      expect.objectContaining({ active: false, reached: true, time: "2026-06-30 20:17:03" }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-30 20:27:03" }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "待继续冲击试验：剩余 4/6轴")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
  });

  test("keeps the authoritative vibration dispatch after another laboratory withdraws to an earlier axis completion", () => {
    const taskCode = "SYLU-2026-07-029";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const hotHumidExperimentCode = `${taskCode}-B`;
    const vibrationExperimentCode = `${taskCode}-G`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          ended_at: "2026-07-20 18:48:13",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-COMPLETED",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-20 18:48:13",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-COMPLETED",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [impactExperimentCode, hotHumidExperimentCode, vibrationExperimentCode].map((experimentCode) => ({
        experiment_code: experimentCode,
        task_code: taskCode,
        tray_code: trayCode,
      })),
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          task_code: taskCode,
        },
        { experiment_code: hotHumidExperimentCode, experiment_name: "高低温湿热试验", task_code: taskCode },
        { experiment_code: vibrationExperimentCode, experiment_name: "振动试验", task_code: taskCode },
      ],
      labCode: "LAB_HOT_HUMID",
      labName: "高低温湿热一室",
      now: new Date("2026-07-20T19:00:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "暂存间扫码出库",
              detail: `${trayCode} 送至 振动一室`,
              location: "振动一室",
              status: "送至实验室",
              time: "2026-07-20 18:51:21",
              tray_code: trayCode,
            },
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 高低温湿热试验 / 撤回至冲击试验已完成（试验间内撤回当前实验任务）`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-07-20 18:48:35",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 实验已完成`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-07-20 18:48:13",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 4/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 4/6轴",
              time: "2026-07-20 18:44:35",
              tray_code: trayCode,
            },
          ],
          location: "振动一室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              status: "送至实验室",
              target_experiment_code: vibrationExperimentCode,
              target_lab: "振动一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          device: "高低温湿热一室",
          experiment_code: hotHumidExperimentCode,
          lab_code: "LAB_HOT_HUMID",
          start_at: "2026-07-21 08:00:00",
          task_code: taskCode,
        },
        {
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          lab_code: "LAB_VIBRATION_1",
          start_at: "2026-07-21 08:00:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, test_type: "冲击试验 / 高低温湿热试验 / 振动试验" }],
    });

    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：送至振动一室`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "送至振动一室")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("keeps latest completed normal experiment active in laboratory tray flow before current salt starts", () => {
    const taskCode = "SYLU-2026-11-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const combinedExperimentCode = `${taskCode}-B`;
    const saltExperimentCode = `${taskCode}-C`;
    const vibrationExperimentCode = `${taskCode}-D`;

    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          axis_codes: ["x+", "x-", "y+"],
          ended_at: "2026-07-01 18:59:41",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-DONE",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-07-01 19:01:41",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-01 18:59:41",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-DONE",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-07-01 19:01:41",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: ["x+", "x-", "y+"].map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-DONE",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
        task_code: taskCode,
      })),
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
          task_code: taskCode,
        },
        {
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          task_code: taskCode,
        },
      ],
      labCode: "LAB_SALT",
      labName: "盐雾试验室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-07-01 19:01:41",
              tray_code: trayCode,
            },
            {
              action: "实验准备",
              detail: `${taskCode} / 四综合试验 / 实验准备就绪 / 托盘：${trayCode}`,
              location: "四综合实验室",
              status: "实验准备就绪",
              time: "2026-07-01 19:01:38",
              tray_code: trayCode,
            },
            {
              action: "工装夹具安装",
              detail: `${taskCode} / 四综合试验 / 工装夹具安装 / 托盘：${trayCode}`,
              location: "四综合实验室",
              status: "工装夹具安装",
              time: "2026-07-01 19:01:34",
              tray_code: trayCode,
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 四综合试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "四综合实验室",
              status: "已到达实验室",
              time: "2026-07-01 19:01:38",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-01 18:59:41",
              tray_code: trayCode,
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 冲击试验 / 到货 / 托盘：${trayCode}`,
              location: "冲击一室",
              status: "到货",
              time: "2026-07-01 18:36:12",
              tray_code: trayCode,
            },
            {
              action: "样品运输中",
              detail: `${trayCode} 样品运输中`,
              location: "接驳间",
              status: "样品运输中",
              time: "2026-07-01 18:35:21",
              tray_code: trayCode,
            },
          ],
          location: "四综合实验室",
          status: "冲击试验部分完成 3/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 3/6轴",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: ["y-", "z+", "z-"],
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          lab_code: "LAB_IMPACT_1",
          start_at: "2026-07-01 21:00:00",
          status: "已排程",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
        {
          device: "盐雾试验室",
          experiment_code: saltExperimentCode,
          lab_code: "LAB_SALT",
          start_at: "2026-07-01 19:20:00",
          status: "已排程",
          task_code: taskCode,
        },
        {
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          lab_code: "LAB_VIBRATION_1",
          start_at: "2026-07-01 20:00:00",
          status: "已排程",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "盐雾试验任务", test_type: "盐雾试验" }],
    });

    expect(view.currentTask.experimentCode).toBe(saltExperimentCode);
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：四综合试验已完成`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "冲击试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ active: false, reached: true, time: "2026-07-01 18:59:41" }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "四综合试验已完成")).toEqual(
      expect.objectContaining({ active: true, time: "2026-07-01 19:01:41" }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "盐雾试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
  });

  test("blocks stale impact comparison while a partial-axis tray is targeted to mold", () => {
    const taskCode = "SYLU-2026-07-027";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-B`;
    const moldExperimentCode = `${taskCode}-A`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const input = {
      experimentRuns: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+"],
          ended_at: "2026-07-01 17:32:04",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-5",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: ["x+", "x-", "y+", "y-", "z+"].map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-5",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactSubExperimentCode,
        task_code: taskCode,
      })),
      experimentRunTrays: [
        {
          ended_at: "2026-07-01 17:32:04",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-5",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: moldExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          task_code: taskCode,
        },
        {
          experiment_code: moldExperimentCode,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验",
          task_code: taskCode,
        },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 霉菌试验 / 撤回至冲击试验部分完成（试验间内撤回当前实验任务）`,
              location: "冲击一室",
              status: "冲击试验部分完成 5/6轴",
              time: "2026-07-01 17:39:21",
              tray_code: trayCode,
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 霉菌试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "霉菌试验室",
              status: "已到达实验室",
              time: "2026-07-01 17:37:35",
              tray_code: trayCode,
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "冲击一室",
              status: "已到达实验室",
              time: "2026-07-01 17:37:25",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 5/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 5/6轴",
              time: "2026-07-01 17:32:04",
              tray_code: trayCode,
            },
          ],
          location: "冲击一室",
          status: "冲击试验部分完成 5/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 5/6轴",
              target_experiment_code: moldExperimentCode,
              target_lab: "霉菌试验室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: ["z-"],
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          start_at: "2026-07-04 12:00:00",
          status: "已排程",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
        {
          device: "霉菌试验室",
          experiment_code: moldExperimentCode,
          start_at: "2026-07-04 08:00:00",
          status: "已排程",
          task_code: taskCode,
        },
      ],
      selectedTaskCode: `${impactExperimentCode}-AXIS-002`,
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "027复现任务", test_type: "霉菌试验 / 冲击试验" }],
    };
    const view = buildLaboratoryWorkbenchView(input);
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
    const scanResult = validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    });

    expect(scanResult).toEqual(expect.objectContaining({
      ok: false,
      tone: "error",
    }));
    expect(getLaboratoryActionState(workflow).canCompare).toBe(false);

    const moldView = buildLaboratoryWorkbenchView({ ...input, labName: "霉菌试验室", selectedTaskCode: "" });
    const moldScanResult = validateLaboratoryTrayScan({
      allScheduleRows: moldView.allScheduleRows,
      currentTask: moldView.currentTask,
      scanCode: trayCode,
      scheduleRows: moldView.scheduleRows,
    });
    expect(moldScanResult).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode,
    }));
  });

  test("keeps remaining impact axis schedule visible after the shared tray is dispatched to mold", () => {
    const taskCode = "SYLU-2026-07-021";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const moldExperimentCode = `${taskCode}-B`;
    const impactCompletedSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const impactRemainingSubExperimentCode = `${impactExperimentCode}-AXIS-002`;
    const input = {
      experimentRuns: [
        {
          axis_codes: ["x+", "x-", "y+", "y-"],
          ended_at: "2026-07-03 20:51:50",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-Z",
          status: "实验已完成",
          sub_experiment_code: impactCompletedSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: ["x+", "x-", "y+", "y-"].map((axisCode, index) => ({
        axis_code: axisCode,
        ended_at: "2026-07-03 20:51:50",
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-Z",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactCompletedSubExperimentCode,
        task_code: taskCode,
      })),
      experimentRunTrays: [
        {
          ended_at: "2026-07-03 20:51:50",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-Z",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: impactCompletedSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: moldExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          status: "实验进行中",
          task_code: taskCode,
        },
        {
          experiment_code: moldExperimentCode,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验",
          status: "已排程",
          task_code: taskCode,
        },
      ],
      now: new Date("2026-07-03T21:00:00.000+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "外观检测间扫码出库",
              detail: `${trayCode} 送至 霉菌试验室`,
              location: "霉菌试验室",
              status: "送至实验室",
              time: "2026-07-03 20:53:12",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 2/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 2/6轴",
              time: "2026-07-03 20:51:50",
              tray_code: trayCode,
            },
          ],
          location: "霉菌试验室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: moldExperimentCode,
              target_lab: "霉菌试验室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: ["z+", "z-"],
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          lab_code: "LAB_IMPACT_1",
          start_at: "2026-07-04 12:00:00",
          status: "已排程",
          sub_experiment_code: impactRemainingSubExperimentCode,
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+", "y-"],
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          lab_code: "LAB_IMPACT_1",
          start_at: "2026-07-04 08:00:00",
          status: "实验已完成",
          sub_experiment_code: impactCompletedSubExperimentCode,
          task_code: taskCode,
        },
        {
          device: "霉菌试验室",
          experiment_code: moldExperimentCode,
          lab_code: "LAB_MOLD",
          start_at: "2026-07-05 08:00:00",
          status: "已排程",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "测试实验07021", test_type: "冲击试验 / 霉菌试验" }],
    };

    const impactView = buildLaboratoryWorkbenchView({ ...input, labName: "冲击一室" });
    expect(impactView.scheduleRows.map((row) => row.subExperimentCode)).toContain(impactRemainingSubExperimentCode);
    expect(impactView.scheduleRows.map((row) => row.taskCode)).toContain(taskCode);
    expect(impactView.currentTask).toBeNull();
    expect(impactView.currentExperimentTrayRows.map((row) => row.trayCode)).toContain(trayCode);
    expect(impactView.selectedTrayRow).toEqual(expect.objectContaining({
      targetExperimentCode: moldExperimentCode,
      targetLab: "霉菌试验室",
      trayCode,
    }));
    expect(impactView.selectedTrayFlow.currentStatus).toContain(`当前托盘：${trayCode}`);
    expect(impactView.currentTaskFlow.currentStatus).toBe("待排程");
    expect(impactView.currentTaskFlow.axisStatusLabel).toBe("");

    const moldView = buildLaboratoryWorkbenchView({ ...input, labName: "霉菌试验室" });
    expect(moldView.scheduleRows.map((row) => row.experimentCode)).toContain(moldExperimentCode);
    expect(moldView.scheduleRows[0].trayRows.map((row) => row.trayCode)).toContain(trayCode);
  });

  test("buildLaboratoryWorkbenchView keeps running time before restored partial-axis tray flow", () => {
    const taskCode = "SYLU-2026-12-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const combinedExperimentCode = `${taskCode}-C`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const completedAxisCodes = ["x+", "x-", "y+"];
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          axis_codes: completedAxisCodes,
          ended_at: "2026-07-01 18:11:23",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          started_at: "2026-07-01 18:11:19",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-01 18:11:23",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          started_at: "2026-07-01 18:11:19",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: completedAxisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        ended_at: "2026-07-01 18:11:23",
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactSubExperimentCode,
        task_code: taskCode,
      })),
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合试验",
          task_code: taskCode,
        },
      ],
      labName: "冲击一室",
      now: NOW,
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 四综合试验 / 撤回至冲击试验部分完成（试验间内撤回当前实验任务）`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-01 18:12:20",
            },
            {
              action: "开始实验",
              detail: `${taskCode} / 冲击试验 / 实验进行中 / 托盘：${trayCode}`,
              location: "冲击一室",
              status: "实验进行中",
              time: "2026-07-01 18:11:19",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-01 18:11:23",
            },
          ],
          location: "冲击一室",
          status: "冲击试验部分完成 3/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 3/6轴",
              target_experiment_code: combinedExperimentCode,
              target_lab: "四综合实验室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: completedAxisCodes,
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          id: "schedule-impact-axis-001",
          start_at: "2026-07-02 08:00:00",
          status: "实验进行中",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
        },
        {
          axis_codes: ["y-", "z+", "z-"],
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          id: "schedule-impact-axis-002",
          start_at: "2026-07-03 08:00:00",
          status: "已排程",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
      ],
      selectedTaskCode: "schedule-impact-axis-002",
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "012复现任务", test_type: "冲击试验 / 四综合试验" }],
    });

    expect(view.selectedTrayFlow.steps.find((step) => step.label === "冲击试验进行中")).toEqual(
      expect.objectContaining({ time: "2026-07-01 18:11:19" }),
    );
  });

  test("allows returning to impact comparison after partial vibration axes are completed", () => {
    const taskCode = "SYLU-2026-07-001";
    const completedTrayCode = `${taskCode}-TP-001`;
    const trayCode = `${taskCode}-TP-002`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const impactRemainingAxes = ["y-", "z+", "z-"];
    const completedAxes = ["x+", "x-", "y+"];
    const allAxes = ["x+", "x-", "y+", "y-", "z+", "z-"];
    const input = {
      experimentRuns: [
        {
          axis_codes: completedAxes,
          ended_at: "2026-06-29 15:39:54",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-TP001-FIRST",
          schedule_id: "schedule-impact-first",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [completedTrayCode],
        },
        {
          axis_codes: impactRemainingAxes,
          ended_at: "2026-06-29 16:10:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-TP001-REMAINING",
          schedule_id: "schedule-impact-remaining",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_codes: [completedTrayCode],
        },
        {
          axis_codes: completedAxes,
          ended_at: "2026-06-29 16:20:15",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-TP001-FIRST",
          schedule_id: "schedule-vibration-first",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [completedTrayCode],
        },
        {
          axis_codes: impactRemainingAxes,
          ended_at: "2026-06-29 16:35:00",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-TP001-REMAINING",
          schedule_id: "schedule-vibration-remaining",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_codes: [completedTrayCode],
        },
        {
          axis_codes: completedAxes,
          ended_at: "2026-06-29 16:39:54",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          schedule_id: "schedule-impact-first",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: completedAxes,
          ended_at: "2026-06-29 16:40:15",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-PARTIAL",
          schedule_id: "schedule-vibration-first",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: [
        ...allAxes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: completedAxes.includes(axisCode) ? "RUN-IMPACT-TP001-FIRST" : "RUN-IMPACT-TP001-REMAINING",
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: completedAxes.includes(axisCode)
            ? `${impactExperimentCode}-AXIS-001`
            : `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        })),
        ...allAxes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: completedAxes.includes(axisCode) ? "RUN-VIBRATION-TP001-FIRST" : "RUN-VIBRATION-TP001-REMAINING",
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: completedAxes.includes(axisCode)
            ? `${vibrationExperimentCode}-AXIS-001`
            : `${vibrationExperimentCode}-AXIS-002`,
          task_code: taskCode,
        })),
        ...completedAxes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
        ...completedAxes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-PARTIAL",
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-29 15:39:54",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-TP001-FIRST",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: completedTrayCode,
        },
        {
          ended_at: "2026-06-29 16:10:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-TP001-REMAINING",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_code: completedTrayCode,
        },
        {
          ended_at: "2026-06-29 16:20:15",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-TP001-FIRST",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: completedTrayCode,
        },
        {
          ended_at: "2026-06-29 16:35:00",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-TP001-REMAINING",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_code: completedTrayCode,
        },
        {
          ended_at: "2026-06-29 16:39:54",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-29 16:40:15",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-PARTIAL",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: completedTrayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: completedTrayCode },
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: allAxes,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          axis_codes: allAxes,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          task_code: taskCode,
        },
      ],
      labCode: "LAB_IMPACT_1",
      labName: "冲击一室",
      samples: [
        {
          code: `${taskCode}-SP-002`,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 3/6轴`,
              location: "振动一室",
              status: "振动试验部分完成 3/6轴",
              time: "2026-06-29 16:40:15",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-06-29 16:39:54",
              tray_code: trayCode,
            },
          ],
          location: "振动一室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              target_experiment_code: vibrationExperimentCode,
              target_lab: "振动一室",
              tray_code: completedTrayCode,
            },
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: vibrationExperimentCode,
              target_lab: "振动一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: impactRemainingAxes,
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          id: "schedule-vibration-remaining",
          lab_code: "LAB_VIBRATION_1",
          start_at: "2026-06-30 13:00:00",
          status: "实验进行中",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
        {
          axis_codes: impactRemainingAxes,
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          id: "schedule-impact-remaining",
          lab_code: "LAB_IMPACT_1",
          start_at: "2026-06-30 12:00:00",
          status: "实验进行中",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "冲击回补轴向任务", test_type: "冲击试验 / 振动试验" }],
    };
    const view = buildLaboratoryWorkbenchView(input);
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
    const scanResult = validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    });

    expect(view.currentTask.experimentCode).toBe(impactExperimentCode);
    expect(view.currentTask.axisProgress).toEqual(expect.objectContaining({
      statusLabel: "",
      totalStatusLabel: "冲击试验部分完成 3/6轴",
    }));
    expect(view.currentTaskFlow.currentStatus).toBe("任务进行中");
    expect(view.currentTaskFlow.axisStatusLabel).toBe("冲击试验部分完成 3/6轴");
    expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
    expect(scanResult).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode,
    }));

    const installedInput = structuredClone(input);
    const installedSample = installedInput.samples[0];
    installedSample.location = "冲击一室";
    installedSample.status = "工装夹具安装";
    installedSample.flow_status = "工装夹具安装";
    installedSample.history.unshift(
      {
        action: "样品安装",
        detail: `${taskCode} / 冲击试验 / 工装夹具安装 / 托盘：${trayCode}`,
        location: "冲击一室",
        status: "工装夹具安装",
        time: "2026-06-29 16:56:30",
        tray_code: trayCode,
      },
      {
        action: "任务比对",
        detail: `${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`,
        location: "冲击一室",
        status: "已到达实验室",
        time: "2026-06-29 16:56:26",
        tray_code: trayCode,
      },
    );
    const installedTray = installedSample.trays.find((tray) => tray.tray_code === trayCode);
    installedTray.status = "工装夹具安装";
    installedTray.target_experiment_code = impactExperimentCode;
    installedTray.target_lab = "冲击一室";
    installedTray.fixture_ready = true;
    installedTray.fixtureReady = true;

    const installedView = buildLaboratoryWorkbenchView(installedInput);
    const installedWorkflow = buildLaboratoryWorkflowFromTask(installedView.currentTask);

    expect(installedView.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：工装夹具安装`);
    expect(installedView.selectedTrayFlow.steps.find((step) => step.label === "工装夹具安装")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(getLaboratoryActionState(installedWorkflow).canMarkReady).toBe(true);
  });

  test("allows direct vibration comparison after other experiments completed even when salt spray remains unfinished", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const saltExperimentCode = `${taskCode}-A`;
    const impactExperimentCode = `${taskCode}-B`;
    const combinedExperimentCode = `${taskCode}-C`;
    const vibrationExperimentCode = `${taskCode}-D`;
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          ended_at: "2026-06-28 21:13:01",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-28 21:14:27",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击二室",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
      ],
      labCode: "LAB_VIBRATION_2",
      labName: "振动二室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "四综合实验室",
          owner: "扫码登记",
          status: "实验已完成",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: ["y-", "z-"],
          device: "振动二室",
          experiment_code: vibrationExperimentCode,
          lab_code: "LAB_VIBRATION_2",
          start_at: "2026-07-03 08:00:00",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "跨实验直送振动任务", test_type: "盐雾试验 / 冲击试验 / 四综合试验 / 振动试验" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);
    const scanResult = validateLaboratoryTrayScan({
      allScheduleRows: view.allScheduleRows,
      currentTask: view.currentTask,
      scanCode: trayCode,
      scheduleRows: view.scheduleRows,
    });

    expect(view.currentTask.experimentCode).toBe(vibrationExperimentCode);
    expect(scanResult).toEqual(expect.objectContaining({
      message: "比对正确",
      ok: true,
      trayCode,
    }));
    expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
  });

  test("keeps selected tray at current vibration arrival after earlier vibration partial and later impact completion", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-002`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const firstAxisCodes = ["x+", "x-", "y+"];
    const remainingAxisCodes = ["y-", "z+", "z-"];
    const allAxisCodes = [...firstAxisCodes, ...remainingAxisCodes];
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          ended_at: "2026-06-29 09:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-29 10:00:00",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-29 11:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-REMAINING",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRuns: [
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-06-29 09:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-06-29 10:00:00",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: remainingAxisCodes,
          ended_at: "2026-06-29 11:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-REMAINING",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: [
        ...firstAxisCodes.map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          task_code: taskCode,
        })),
        ...firstAxisCodes.map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          task_code: taskCode,
        })),
        ...remainingAxisCodes.map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-REMAINING",
          status: "实验已完成",
          task_code: taskCode,
        })),
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: allAxisCodes,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          axis_codes: allAxisCodes,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
      ],
      labName: "振动二室",
      samples: [
        {
          code: `${taskCode}-SP-002`,
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 振动试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "振动二室",
              status: "已到达实验室",
              time: "2026-06-29 11:30:00",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验已完成`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-06-29 11:00:00",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 3/6轴`,
              location: "振动二室",
              status: "振动试验部分完成 3/6轴",
              time: "2026-06-29 10:00:00",
              tray_code: trayCode,
            },
          ],
          location: "振动二室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: vibrationExperimentCode,
              target_lab: "振动二室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: remainingAxisCodes,
          device: "振动二室",
          experiment_code: vibrationExperimentCode,
          id: "schedule-vibration-remaining",
          status: "实验进行中",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "轴向回补任务", test_type: "冲击试验 / 振动试验" }],
    });

    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：已到达实验室`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "振动试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ reached: true, active: false }),
    );
  });

  test("keeps current impact arrival after historical partial axes and staging route", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const saltExperimentCode = `${taskCode}-SALT`;
    const combinedExperimentCode = `${taskCode}-COMBINED`;
    const impactFirstSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const impactRemainingSubExperimentCode = `${impactExperimentCode}-AXIS-002`;
    const vibrationSubExperimentCode = `${vibrationExperimentCode}-AXIS-001`;
    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 21:03:04",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 21:03:23",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRuns: [
        {
          axis_codes: ["x+", "x-", "y+"],
          ended_at: "2026-06-30 21:03:04",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: ["x+", "x-", "y+"],
          ended_at: "2026-06-30 21:03:23",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          sub_experiment_code: vibrationSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合试验室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      labName: "冲击一室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "冲击一室",
              status: "已到达实验室",
              time: "2026-06-30 21:03:38",
              tray_code: trayCode,
            },
            {
              action: "暂存间扫码出库",
              detail: `${trayCode} 送至 冲击一室`,
              location: "冲击一室",
              status: "送至实验室",
              time: "2026-06-30 21:02:46",
              tray_code: trayCode,
            },
            {
              action: "暂存间扫码入库",
              detail: `${trayCode} 已到达暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-06-30 21:02:42",
              tray_code: trayCode,
            },
            {
              action: "实验准备就绪",
              detail: `${taskCode} / 冲击试验 / 实验准备就绪`,
              location: "冲击一室",
              status: "实验准备就绪",
              time: "2026-06-30 21:03:18",
              tray_code: trayCode,
            },
            {
              action: "工装夹具安装",
              detail: `${taskCode} / 冲击试验 / 工装夹具安装`,
              location: "冲击一室",
              status: "工装夹具安装",
              time: "2026-06-30 21:03:15",
              tray_code: trayCode,
            },
            {
              action: "实验开始",
              detail: `${taskCode} / 冲击试验 / 实验进行中`,
              location: "冲击一室",
              status: "实验进行中",
              time: "2026-06-30 21:03:00",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 3/6轴`,
              location: "振动一室",
              status: "振动试验部分完成 3/6轴",
              time: "2026-06-30 21:03:23",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-06-30 21:03:04",
              tray_code: trayCode,
            },
          ],
          location: "冲击一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 3/6轴",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: ["y-", "z+", "z-"],
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          id: "schedule-impact-remaining",
          status: "实验进行中",
          sub_experiment_code: impactRemainingSubExperimentCode,
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "轴向回补任务", test_type: "冲击试验 / 振动试验 / 盐雾试验 / 四综合试验" }],
    });

    const labels = view.selectedTrayFlow.steps.map((step) => step.label);
    expect(labels.filter((label) => label === "冲击试验部分完成 3/6轴")).toHaveLength(1);
    expect(labels.indexOf("冲击试验部分完成 3/6轴")).toBeLessThan(labels.indexOf("振动试验部分完成 3/6轴"));
    expect(labels.indexOf("振动试验部分完成 3/6轴")).toBeLessThan(labels.indexOf("送至冲击一室"));
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：已到达实验室`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "已到达实验室")).toEqual(
      expect.objectContaining({ active: true }),
    );
    ["工装夹具安装", "实验准备就绪", "冲击试验进行中"].forEach((label) => {
      expect(view.selectedTrayFlow.steps.find((step) => step.label === label)).toEqual(
        expect.objectContaining({ active: false, reached: false }),
      );
    });
  });

  test("hides an axis continuation from the current lab when the tray is dispatched to another unfinished experiment", () => {
    const taskCode = "SYLU-2026-08-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const combinedExperimentCode = `${taskCode}-B`;
    const saltExperimentCode = `${taskCode}-C`;
    const impactFirstSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const impactRemainingSubExperimentCode = `${impactExperimentCode}-AXIS-002`;

    const view = buildLaboratoryWorkbenchView({
      experimentRunTrays: [
        {
          ended_at: "2026-07-03 15:40:11",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-07-03 15:40:47",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRuns: [
        {
          axis_codes: ["x+", "x-", "y+"],
          ended_at: "2026-07-03 15:40:11",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          schedule_id: "schedule-impact-axis-001",
          status: "实验已完成",
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-07-03 15:40:47",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunSteps: ["x+", "x-", "y+"].map((axisCode) => ({
        axis_code: axisCode,
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-FIRST",
        status: "实验已完成",
        task_code: taskCode,
      })),
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          status: "实验进行中",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
          status: "实验已完成",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
          status: "已排程",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      labName: "冲击一室",
      now: new Date("2026-07-03T15:42:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "暂存间扫码出库",
              detail: `${trayCode} 送至 盐雾试验室`,
              location: "盐雾试验室",
              status: "送至实验室",
              time: "2026-07-03 15:41:08",
              tray_code: trayCode,
            },
            {
              action: "暂存间扫码入库",
              detail: `${trayCode} 已到达暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-07-03 15:41:01",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-07-03 15:40:47",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-03 15:40:11",
              tray_code: trayCode,
            },
          ],
          location: "盐雾试验室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: saltExperimentCode,
              target_lab: "盐雾试验室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: ["y-", "z+", "z-"],
          device: "冲击一室",
          end_at: "2026-07-04 15:30:00",
          experiment_code: impactExperimentCode,
          id: "schedule-impact-axis-002",
          start_at: "2026-07-04 12:00:00",
          status: "已排程",
          sub_experiment_code: impactRemainingSubExperimentCode,
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "复合环境任务", test_type: "冲击试验 / 四综合试验 / 盐雾试验" }],
    });

    expect(view.scheduleRows).toHaveLength(1);
    expect(view.currentTask).toBeNull();
    expect(view.currentExperimentTrayRows.map((row) => row.trayCode)).toContain(trayCode);
    expect(view.selectedTrayRow).toEqual(expect.objectContaining({
      targetExperimentCode: saltExperimentCode,
      targetLab: "盐雾试验室",
      trayCode,
    }));
    expect(view.selectedTrayFlow.currentStatus).toContain(`当前托盘：${trayCode}`);
    expect(view.selectedTrayFlow.currentStatus).not.toBe("当前状态：样品运输中");
  });

  test.each([
    {
      experimentName: "冲击试验",
      labName: "冲击一室",
      omitsTargetFields: false,
      targetExperimentName: "盐雾试验",
      targetLab: "盐雾试验室",
    },
    {
      experimentName: "振动试验",
      labName: "振动一室",
      omitsTargetFields: false,
      targetExperimentName: "霉菌试验",
      targetLab: "霉菌试验室",
    },
    {
      experimentName: "冲击试验",
      labName: "冲击一室",
      omitsTargetFields: true,
      targetExperimentName: "盐雾试验",
      targetLab: "盐雾试验室",
    },
  ])(
    "does not revive a started $experimentName axis continuation after the tray is dispatched to $targetLab",
    ({ experimentName, labName, omitsTargetFields, targetExperimentName, targetLab }) => {
      const taskCode = "SYLU-2026-08-001";
      const trayCode = `${taskCode}-TP-001`;
      const axisExperimentCode = `${taskCode}-A`;
      const targetExperimentCode = `${taskCode}-C`;
      const firstSubExperimentCode = `${axisExperimentCode}-AXIS-001`;
      const remainingSubExperimentCode = `${axisExperimentCode}-AXIS-002`;
      const completedAxes = ["x+", "x-", "y+"];
      const remainingAxes = ["y-", "z+", "z-"];

      const view = buildLaboratoryWorkbenchView({
        experimentRunTrays: [
          {
            ended_at: "2026-07-03 15:40:11",
            experiment_code: axisExperimentCode,
            run_no: "RUN-AXIS-FIRST",
            run_tray_status: "实验已完成",
            task_code: taskCode,
            tray_code: trayCode,
          },
        ],
        experimentRuns: [
          {
            axis_codes: completedAxes,
            ended_at: "2026-07-03 15:40:11",
            experiment_code: axisExperimentCode,
            run_no: "RUN-AXIS-FIRST",
            schedule_id: "schedule-axis-001",
            status: "实验已完成",
            sub_experiment_code: firstSubExperimentCode,
            task_code: taskCode,
            tray_codes: [trayCode],
          },
        ],
        experimentRunSteps: completedAxes.map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: axisExperimentCode,
          run_no: "RUN-AXIS-FIRST",
          status: "实验已完成",
          task_code: taskCode,
        })),
        experiments: [
          {
            axis_codes: [...completedAxes, ...remainingAxes],
            experiment_code: axisExperimentCode,
            experiment_name: experimentName,
            required_device: labName,
            status: "实验进行中",
            task_code: taskCode,
          },
          {
            experiment_code: targetExperimentCode,
            experiment_name: targetExperimentName,
            required_device: targetLab,
            status: "已排程",
            task_code: taskCode,
          },
        ],
        experimentTrays: [
          { experiment_code: axisExperimentCode, task_code: taskCode, tray_code: trayCode },
          { experiment_code: targetExperimentCode, task_code: taskCode, tray_code: trayCode },
        ],
        labName,
        now: new Date("2026-07-04T12:30:00+08:00"),
        samples: [
          {
            code: `${taskCode}-SP-001`,
            history: [
              {
                action: "外观检测间扫码出库",
                detail: `${trayCode} 送至 ${targetLab}`,
                location: targetLab,
                status: "送至实验室",
                ...(omitsTargetFields ? {} : { target_experiment_code: targetExperimentCode, target_lab: targetLab }),
                time: "2026-07-03 15:41:20",
                tray_code: trayCode,
              },
              {
                action: "外观检测间扫码入库",
                detail: `${trayCode} 实验后外观检测间存放`,
                location: "外观检测间",
                status: "实验后外观检测间存放",
                time: "2026-07-03 15:41:10",
                tray_code: trayCode,
              },
              {
                action: "暂存间扫码入库",
                detail: `${trayCode} 已到达暂存间`,
                location: "恒温恒湿间（暂存间）",
                status: "已到达暂存间",
                time: "2026-07-03 15:41:01",
                tray_code: trayCode,
              },
              {
                action: "实验完成",
                detail: `${taskCode} / ${experimentName} / ${experimentName}部分完成 3/6轴`,
                location: labName,
                status: `${experimentName}部分完成 3/6轴`,
                time: "2026-07-03 15:40:11",
                tray_code: trayCode,
              },
            ],
            location: targetLab,
            status: "送至实验室",
            task_code: taskCode,
            trays: [
              {
                quantity: 1,
                status: "送至实验室",
                ...(omitsTargetFields ? {} : { target_experiment_code: targetExperimentCode, target_lab: targetLab }),
                tray_code: trayCode,
              },
            ],
          },
        ],
        schedules: [
          {
            axis_codes: remainingAxes,
            device: labName,
            end_at: "2026-07-04 15:30:00",
            experiment_code: axisExperimentCode,
            id: "schedule-axis-002",
            start_at: "2026-07-04 12:00:00",
            status: "已排程",
            sub_experiment_code: remainingSubExperimentCode,
            task_code: taskCode,
          },
        ],
        selectedTrayCode: trayCode,
        tasks: [{ code: taskCode, name: "轴向转后续任务", test_type: `${experimentName} / ${targetExperimentName}` }],
      });

      expect(view.scheduleRows).toHaveLength(1);
      expect(view.currentTask).toBeNull();
      expect(view.currentExperimentTrayRows.map((row) => row.trayCode)).toContain(trayCode);
      expect(view.selectedTrayRow).toEqual(expect.objectContaining({
        targetLab,
        trayCode,
      }));
      if (!omitsTargetFields) {
        expect(view.selectedTrayRow?.targetExperimentCode).toBe(targetExperimentCode);
      }
      expect(view.selectedTrayFlow.currentStatus).toContain(`当前托盘：${trayCode}`);
      expect(view.selectedTrayFlow.currentStatus).not.toBe("当前状态：样品运输中");
    },
  );

  test("uses current laboratory axis status instead of stale same-count partial axis status", () => {
    const taskCode = "SYLU-2026-08-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const vibrationExperimentCode = `${taskCode}-D`;
    const firstAxisCodes = ["x+", "x-", "y+"];
    const remainingAxisCodes = ["y-", "z+", "z-"];
    const allAxisCodes = [...firstAxisCodes, ...remainingAxisCodes];
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-07-01 16:04:18",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-07-01 16:38:35",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-01 16:04:18",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-07-01 16:38:35",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: [
        ...firstAxisCodes.map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          task_code: taskCode,
        })),
        ...firstAxisCodes.map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          task_code: taskCode,
        })),
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          axis_codes: allAxisCodes,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          axis_codes: allAxisCodes,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          task_code: taskCode,
        },
      ],
      labCode: "LAB_VIBRATION_1",
      labName: "振动一室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 3/6轴`,
              location: "振动一室",
              status: "振动试验部分完成 3/6轴",
              time: "2026-07-01 16:38:35",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-01 16:04:18",
              tray_code: trayCode,
            },
          ],
          location: "振动一室",
          status: "振动试验部分完成 3/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 3/6轴",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: remainingAxisCodes,
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          id: "schedule-vibration-remaining",
          lab_code: "LAB_VIBRATION_1",
          start_at: "2026-07-02 12:00:00",
          status: "已排程",
          task_code: taskCode,
        },
      ],
      selectedTrayCode: trayCode,
      tasks: [{ code: taskCode, name: "轴向回补任务", test_type: "冲击试验 / 振动试验" }],
    });

    expect(view.currentTask.experimentCode).toBe(vibrationExperimentCode);
    expect(view.selectedTrayFlow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：振动试验部分完成 3/6轴`);
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "冲击试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ reached: true, active: false }),
    );
    expect(view.selectedTrayFlow.steps.find((step) => step.label === "振动试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildLaboratoryWorkbenchView resets current task flow when completed lab schedules leave no current task", () => {
    const taskCode = "SYLU-2026-09-001";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          ended_at: "2026-07-06 10:30:00",
          experiment_code: experimentCode,
          run_no: "RUN-SALT-COMPLETE",
          schedule_id: "schedule-salt-complete",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-06 10:30:00",
          experiment_code: experimentCode,
          run_no: "RUN-SALT-COMPLETE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: experimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experiments: [
        {
          experiment_code: experimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
          status: "实验已完成",
          task_code: taskCode,
        },
      ],
      labName: "盐雾试验室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "盐雾试验室",
          status: "实验已完成",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "实验已完成", tray_code: trayCode }],
        },
      ],
      schedules: [
        {
          device: "盐雾试验室",
          experiment_code: experimentCode,
          id: "schedule-salt-complete",
          start_at: "2026-07-06 08:30:00",
          status: "实验已完成",
          task_code: taskCode,
        },
      ],
      tasks: [{ code: taskCode, name: "完成后空闲任务", test_type: "盐雾试验" }],
    });

    expect(view.currentTask).toBeNull();
    expect(view.scheduleRows).toHaveLength(0);
    expect(view.currentTaskFlow.currentStatus).toBe("待排程");
    expect(view.currentTaskFlow.axisStatusLabel).toBe("");
  });

  test("buildLaboratoryWorkbenchView falls back to default task when selected axis schedule is no longer displayed", () => {
    const taskCode = "SYLU-2026-09-002";
    const experimentCode = `${taskCode}-A`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-X`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-Y`;
    const firstTrayCode = `${taskCode}-TP-001`;
    const secondTrayCode = `${taskCode}-TP-002`;
    const view = buildLaboratoryWorkbenchView({
      experimentRuns: [
        {
          ended_at: "2026-07-06 10:30:00",
          experiment_code: experimentCode,
          run_no: "RUN-X-001",
          schedule_id: "schedule-axis-x",
          status: "实验已完成",
          sub_experiment_code: firstSubExperimentCode,
          task_code: taskCode,
          tray_codes: [firstTrayCode, secondTrayCode],
        },
      ],
      experimentRunSteps: [
        {
          axis_code: "x+",
          experiment_code: experimentCode,
          run_no: "RUN-X-001",
          status: "实验已完成",
          sub_experiment_code: firstSubExperimentCode,
          task_code: taskCode,
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-06 10:30:00",
          experiment_code: experimentCode,
          run_no: "RUN-X-001",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: firstSubExperimentCode,
          task_code: taskCode,
          tray_code: firstTrayCode,
        },
        {
          ended_at: "2026-07-06 10:30:00",
          experiment_code: experimentCode,
          run_no: "RUN-X-001",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: firstSubExperimentCode,
          task_code: taskCode,
          tray_code: secondTrayCode,
        },
      ],
      experimentTrays: [
        { experiment_code: experimentCode, task_code: taskCode, tray_code: firstTrayCode },
        { experiment_code: experimentCode, task_code: taskCode, tray_code: secondTrayCode },
      ],
      experiments: [
        {
          axis_codes: ["x+", "y+"],
          experiment_code: experimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          status: "实验进行中",
          task_code: taskCode,
        },
      ],
      labName: "振动一室",
      now: new Date("2026-07-06T11:00:00+08:00"),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "振动一室",
          status: "振动试验部分完成 1/2轴",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "振动试验部分完成 1/2轴", tray_code: firstTrayCode }],
        },
        {
          code: `${taskCode}-SP-002`,
          location: "振动一室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "送至实验室", tray_code: secondTrayCode }],
        },
      ],
      schedules: [
        {
          axis_codes: ["x+"],
          device: "振动一室",
          experiment_code: experimentCode,
          id: "schedule-axis-x",
          start_at: "2026-07-06 08:30:00",
          status: "实验已完成",
          sub_experiment_code: firstSubExperimentCode,
          task_code: taskCode,
        },
        {
          axis_codes: ["y+"],
          device: "振动一室",
          experiment_code: experimentCode,
          id: "schedule-axis-y",
          start_at: "2026-07-06 10:30:00",
          status: "已排程",
          sub_experiment_code: secondSubExperimentCode,
          task_code: taskCode,
        },
      ],
      selectedTaskCode: "schedule-axis-x",
      selectedTrayCode: secondTrayCode,
      tasks: [{ code: taskCode, name: "同室分轴任务", test_type: "振动试验" }],
    });
    const workflow = buildLaboratoryWorkflowFromTask(view.currentTask);

    expect(view.scheduleRows.map((row) => row.id)).toEqual(["schedule-axis-y"]);
    expect(view.currentTask).toEqual(expect.objectContaining({
      id: "schedule-axis-y",
      subExperimentCode: secondSubExperimentCode,
    }));
    expect(getLaboratoryActionState(workflow).canCompare).toBe(true);
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
