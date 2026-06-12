import { describe, expect, test } from "vitest";

import { buildDashboardViewModel } from "./model";

describe("dashboard model", () => {
  test("orders task queue rows by task code ascending by default", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        { code: "SYLU-2026-03-003", source: "外部委托", status: "待排程" },
        { code: "SYLU-2026-03-001", source: "外部委托", status: "待排程" },
        { code: "SYLU-2026-03-002", source: "内部新增", status: "待排程" },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.taskRows.map((row) => row.code)).toEqual([
      "SYLU-2026-03-001",
      "SYLU-2026-03-002",
      "SYLU-2026-03-003",
    ]);
  });

  test("treats retention-only schedules as unscheduled without a staging note suffix", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-105",
          source: "外部委托",
          status: "待排程",
        },
      ],
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-04-105",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-03-11T09:31:00.000Z",
          end_at: "2026-03-17T09:31:00.000Z",
          status: "厂家收回",
        },
      ],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.summaryCards.scheduledCount).toBe(0);
    expect(viewModel.summaryCards.unscheduledCount).toBe(1);
    expect(viewModel.taskRows[0]).toEqual(
      expect.objectContaining({
        code: "SYLU-2026-04-105",
        status: "待排程",
      }),
    );
  });

  test("keeps retention-device tasks unscheduled even when the stored task status is stale", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-107",
          source: "外部委托",
          status: "厂家收回",
        },
      ],
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-04-107",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-03-11T06:45:13.827Z",
          end_at: "2026-03-11T06:45:13.827Z",
          status: "已排程",
        },
      ],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.summaryCards.scheduledCount).toBe(0);
    expect(viewModel.summaryCards.unscheduledCount).toBe(1);
    expect(viewModel.taskRows[0]).toEqual(
      expect.objectContaining({
        code: "SYLU-2026-04-107",
        status: "待排程",
      }),
    );
  });

  test("classifies schedules by lab code before stale retention display text", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        { code: "TASK-FORMAL", source: "外部委托", status: "待排程" },
        { code: "TASK-STORAGE", source: "外部委托", status: "待排程" },
      ],
      schedules: [
        {
          id: "formal-with-stale-name",
          task_code: "TASK-FORMAL",
          experiment_code: "TASK-FORMAL-A",
          device: "恒温恒湿间（暂存间）",
          lab_code: "LAB_SALT",
          status: "已排程",
        },
        {
          id: "storage-with-stale-name",
          task_code: "TASK-STORAGE",
          device: "冲击一室",
          lab_code: "AREA_STAGING_PRE",
          status: "已排程",
        },
      ],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.summaryCards.scheduledCount).toBe(1);
    expect(viewModel.summaryCards.unscheduledCount).toBe(1);
    expect(viewModel.taskRows).toEqual([
      expect.objectContaining({ code: "TASK-FORMAL", status: "已排程" }),
      expect.objectContaining({ code: "TASK-STORAGE", status: "待排程" }),
    ]);
  });

  test("hides manufacturer-returned tasks from the central dashboard", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "ICP-2026-001",
          source: "外部委托",
          status: "厂家收回",
        },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.summaryCards.unscheduledCount).toBe(0);
    expect(viewModel.taskRows).toEqual([]);
  });

  test("hides returned tasks from unscheduled experiment timers", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-119",
          source: "内部新增",
          status: "厂家收回",
          transfer_status: "厂家收回",
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-119",
          experiment_code: "SYLU-2026-04-119-A",
          experiment_name: "振动试验",
          unscheduled_since: "2026-03-16T07:30:00.000Z",
        },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.unscheduledExperimentItems).toEqual([]);
  });

  test("treats all-returned task samples as terminal even when task and schedules are stale", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-06-021",
          source: "外部委托",
          status: "待排程",
          transfer_status: "已入库",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-001",
          task_code: "SYLU-2026-06-021",
          status: "厂家收回",
          flow_status: "厂家收回",
          location: "厂家收回",
          history: [{ action: "任务已确认入库", time: "2026-06-12T13:40:00.000Z" }],
          trays: [
            { tray_code: "SYLU-2026-06-021-TP-001", status: "厂家收回" },
          ],
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          experiment_name: "冲击试验",
          status: "待排程",
          unscheduled_since: "2026-06-12T13:40:00.000Z",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          experiment_name: "霉菌试验",
          status: "待排程",
          unscheduled_since: "2026-06-12T13:40:00.000Z",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          device: "冲击一室",
          status: "已排程",
        },
      ],
      devices: [{ code: "冲击一室", status: "可用" }],
      streams: [],
      now: Date.parse("2026-06-12T14:10:00.000Z"),
    });

    expect(viewModel.summaryCards.intakeCount).toBe(0);
    expect(viewModel.summaryCards.scheduledCount).toBe(0);
    expect(viewModel.summaryCards.unscheduledCount).toBe(0);
    expect(viewModel.summaryCards.deviceCount).toBe(0);
    expect(viewModel.taskRows).toEqual([]);
    expect(viewModel.unscheduledExperimentItems).toEqual([]);
    expect(viewModel.deviceItems).toEqual([
      expect.objectContaining({ code: "冲击一室", status: "可用" }),
    ]);
  });

  test("counts formal schedules once per task instead of once per schedule record", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-201",
          source: "外部委托",
          status: "待排程",
        },
        {
          code: "SYLU-2026-04-202",
          source: "内部新增",
          status: "待排程",
        },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-04-201",
          experiment_code: "SYLU-2026-04-201-A",
          device: "冲击一室",
          start_at: "2026-03-17T12:00:00.000Z",
          end_at: "2026-03-17T14:00:00.000Z",
        },
        {
          id: "schedule-2",
          task_code: "SYLU-2026-04-201",
          experiment_code: "SYLU-2026-04-201-B",
          device: "冲击二室",
          start_at: "2026-03-17T15:00:00.000Z",
          end_at: "2026-03-17T17:00:00.000Z",
        },
      ],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.summaryCards.scheduledCount).toBe(1);
    expect(viewModel.summaryCards.unscheduledCount).toBe(1);
  });

  test("counts running experiments from experiment status instead of active scheduled tasks", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-301",
          source: "外部委托",
          status: "已排程",
        },
        {
          code: "SYLU-2026-04-302",
          source: "内部新增",
          status: "已排程",
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-301",
          experiment_code: "SYLU-2026-04-301-A",
          experiment_name: "冲击试验",
          status: "已排程",
        },
        {
          task_code: "SYLU-2026-04-302",
          experiment_code: "SYLU-2026-04-302-A",
          experiment_name: "振动试验",
          status: "实验中",
        },
        {
          task_code: "SYLU-2026-04-302",
          experiment_code: "SYLU-2026-04-302-B",
          experiment_name: "盐雾试验",
          status: "实验进行中",
        },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-04-301",
          experiment_code: "SYLU-2026-04-301-A",
          device: "冲击一室",
          start_at: "2026-03-17T08:00:00.000Z",
          end_at: "2026-03-17T12:00:00.000Z",
        },
      ],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.summaryCards.deviceCount).toBe(2);
  });

  test("adds device status dot classes from the resolved device state", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [],
      experiments: [],
      streams: [],
      devices: [
        { code: "LAB-AVAILABLE", status: "可用" },
        { code: "LAB-MAINTAIN", status: "维修" },
        { code: "LAB-CARE", status: "保养" },
        { code: "LAB-DISABLED", status: "停用" },
        { code: "LAB-RUNNING", status: "可用" },
      ],
      schedules: [
        {
          device: "LAB-RUNNING",
          start_at: "2026-03-17T09:00:00.000Z",
          end_at: "2026-03-17T11:00:00.000Z",
        },
      ],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.deviceItems).toEqual([
      expect.objectContaining({ code: "LAB-AVAILABLE", status: "可用", dotClass: "timeline-dot--available" }),
      expect.objectContaining({ code: "LAB-MAINTAIN", status: "维修", dotClass: "timeline-dot--attention" }),
      expect.objectContaining({ code: "LAB-CARE", status: "保养", dotClass: "timeline-dot--attention" }),
      expect.objectContaining({ code: "LAB-DISABLED", status: "维修", dotClass: "timeline-dot--attention" }),
      expect.objectContaining({ code: "LAB-RUNNING", status: "可用", dotClass: "timeline-dot--available" }),
    ]);
  });

  test("marks devices running only when the scheduled experiment has really started", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [],
      streams: [],
      devices: [
        { code: "LAB-ACTIVE-SCHEDULE", status: "可用" },
        { code: "LAB-ACTUAL-RUNNING", status: "可用" },
      ],
      experiments: [
        {
          task_code: "TASK-ACTIVE",
          experiment_code: "TASK-ACTIVE-A",
          status: "已排程",
        },
        {
          task_code: "TASK-RUNNING",
          experiment_code: "TASK-RUNNING-A",
          status: "实验进行中",
        },
      ],
      schedules: [
        {
          task_code: "TASK-ACTIVE",
          experiment_code: "TASK-ACTIVE-A",
          device: "LAB-ACTIVE-SCHEDULE",
          start_at: "2026-03-17T09:00:00.000Z",
          end_at: "2026-03-17T11:00:00.000Z",
        },
        {
          task_code: "TASK-RUNNING",
          experiment_code: "TASK-RUNNING-A",
          device: "LAB-ACTUAL-RUNNING",
          start_at: "2026-03-17T09:00:00.000Z",
          end_at: "2026-03-17T11:00:00.000Z",
        },
      ],
      samples: [
        {
          task_code: "TASK-RUNNING",
          location: "LAB-ACTUAL-RUNNING",
          status: "实验进行中",
          trays: [{ tray_code: "TP-RUNNING-001", status: "实验进行中" }],
        },
      ],
      experimentTrays: [
        {
          task_code: "TASK-RUNNING",
          experiment_code: "TASK-RUNNING-A",
          tray_code: "TP-RUNNING-001",
        },
      ],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.deviceItems).toEqual([
      expect.objectContaining({ code: "LAB-ACTIVE-SCHEDULE", status: "可用", dotClass: "timeline-dot--available" }),
      expect.objectContaining({ code: "LAB-ACTUAL-RUNNING", status: "工作中", dotClass: "timeline-dot--running" }),
    ]);
  });

  test("does not mark a device working when only experiment status is stale running", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [],
      streams: [],
      devices: [{ code: "盐雾试验室", status: "可用" }],
      experiments: [
        {
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-B",
          status: "实验进行中",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-B",
          device: "盐雾试验室",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-05-001",
          location: "恒温恒湿间（暂存间)",
          status: "已到达暂存间",
          trays: [{ tray_code: "TP-001", status: "已到达暂存间" }],
        },
        {
          task_code: "SYLU-2026-05-001",
          location: "接驳区",
          status: "到货",
          trays: [{ tray_code: "TP-002", status: "到货" }],
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-B", tray_code: "TP-001" },
        { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-B", tray_code: "TP-002" },
      ],
    });

    expect(viewModel.deviceItems).toEqual([
      expect.objectContaining({ code: "盐雾试验室", status: "可用", dotClass: "timeline-dot--available" }),
    ]);
  });

  test("marks a device working from an active experiment run even before sample refresh arrives", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [],
      streams: [],
      devices: [{ code: "盐雾试验室", status: "可用" }],
      experiments: [
        {
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-B",
          status: "实验进行中",
        },
      ],
      experimentRuns: [
        {
          run_no: "run-salt-second",
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-B",
          device: "盐雾试验室",
          tray_codes: ["TP-002"],
          status: "实验进行中",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-B",
          device: "盐雾试验室",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-05-001",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TP-002", status: "实验准备就绪" }],
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-B", tray_code: "TP-002" },
      ],
    });

    expect(viewModel.deviceItems).toEqual([
      expect.objectContaining({ code: "盐雾试验室", status: "工作中", dotClass: "timeline-dot--running" }),
    ]);
  });

  test("matches active experiment runs by device name when dashboard device code is different", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [],
      streams: [],
      devices: [{ code: "LAB_TEMP_2", name: "温度冲击二室", status: "可用" }],
      experiments: [],
      experimentRuns: [
        {
          run_no: "run-temp-second",
          task_code: "TASK-TEMP",
          experiment_code: "TASK-TEMP-B",
          device: "温度冲击二室",
          tray_codes: ["TP-TEMP-002"],
          status: "实验进行中",
        },
      ],
      schedules: [],
      samples: [],
      experimentTrays: [],
    });

    expect(viewModel.deviceItems).toEqual([
      expect.objectContaining({ code: "LAB_TEMP_2", status: "工作中", dotClass: "timeline-dot--running" }),
    ]);
  });

  test("does not keep a device working from stale tray status after runs are completed", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [],
      streams: [],
      devices: [{ code: "盐雾试验室", status: "可用" }],
      experimentRuns: [
        {
          run_no: "run-salt-old",
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-B",
          device: "盐雾试验室",
          tray_codes: ["TP-002"],
          status: "实验已完成",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-B",
          device: "盐雾试验室",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-05-001",
          location: "盐雾试验室",
          status: "实验进行中",
          trays: [{ tray_code: "TP-002", status: "实验进行中" }],
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-B", tray_code: "TP-002" },
      ],
    });

    expect(viewModel.deviceItems).toEqual([
      expect.objectContaining({ code: "盐雾试验室", status: "可用", dotClass: "timeline-dot--available" }),
    ]);
  });

  test("does not keep a device running for a manufacturer-returned task with stale running experiment status", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "TASK-RETURNED-RUNNING",
          source: "外部委托",
          status: "厂家收回",
          transfer_status: "厂家收回",
        },
      ],
      streams: [],
      devices: [{ code: "LAB-RETURNED", status: "可用" }],
      experiments: [
        {
          task_code: "TASK-RETURNED-RUNNING",
          experiment_code: "TASK-RETURNED-RUNNING-A",
          status: "实验进行中",
        },
      ],
      schedules: [
        {
          task_code: "TASK-RETURNED-RUNNING",
          experiment_code: "TASK-RETURNED-RUNNING-A",
          device: "LAB-RETURNED",
          start_at: "2026-05-31T09:00:00.000Z",
          end_at: "2026-05-31T11:00:00.000Z",
        },
      ],
      now: Date.parse("2026-05-31T10:00:00.000Z"),
    });

    expect(viewModel.taskRows).toEqual([]);
    expect(viewModel.deviceItems).toEqual([
      expect.objectContaining({ code: "LAB-RETURNED", status: "可用", dotClass: "timeline-dot--available" }),
    ]);
  });

  test("replaces data channel output with unscheduled experiment timers", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-109",
          source: "外部委托",
          status: "待排程",
          transfer_status: "已入库",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-04-109",
          history: [{ action: "任务已确认入库", time: "2026-03-17T07:45:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-04-109-TP-001", status: "到货" }],
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-109",
          experiment_code: "SYLU-2026-04-109-A",
          experiment_name: "振动试验",
          unscheduled_since: "2026-03-17T07:45:00.000Z",
        },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-04-109",
        experimentCode: "SYLU-2026-04-109-A",
        experimentLabel: "振动试验",
        elapsedLabel: "02:15:00",
        isOverdue: false,
      }),
    ]);
  });

  test("marks overdue timers when unscheduled duration exceeds 24 hours", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-110",
          source: "内部新增",
          status: "待排程",
          transfer_status: "已入库",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-04-110",
          history: [{ action: "任务已确认入库", time: "2026-03-16T08:30:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-04-110-TP-001", status: "到货" }],
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-110",
          experiment_code: "SYLU-2026-04-110-B",
          experiment_name: "冲击试验",
          unscheduled_since: "2026-03-16T08:30:00.000Z",
        },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-04-110",
        elapsedLabel: "25:30:00",
        isOverdue: true,
      }),
    ]);
  });

  test("starts unscheduled timers from transfer confirmation history instead of exception time", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-122",
          source: "外部委托",
          status: "待排程",
          transfer_status: "到货",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-04-122",
          history: [{ action: "任务已确认入库", time: "2026-03-17T07:30:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-04-122-TP-001", status: "到货" }],
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-122",
          experiment_code: "SYLU-2026-04-122-A",
          experiment_name: "冲击试验",
          status: "待排程",
          unscheduled_since: "2026-03-17T09:30:00.000Z",
        },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-04-122",
        experimentCode: "SYLU-2026-04-122-A",
        elapsedLabel: "02:30:00",
      }),
    ]);
  });

  test("shows only arrived experiments without a formal schedule in the unscheduled timer list", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-112",
          source: "内部新增",
          status: "待排程",
          transfer_status: "已入库",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-04-112",
          history: [{ action: "任务已确认入库", time: "2026-03-16T07:30:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-04-112-TP-001", status: "到货" }],
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-112",
          experiment_code: "SYLU-2026-04-112-A",
          experiment_name: "盐雾试验",
          unscheduled_since: "2026-03-16T08:30:00.000Z",
        },
        {
          task_code: "SYLU-2026-04-112",
          experiment_code: "SYLU-2026-04-112-B",
          experiment_name: "振动试验",
          unscheduled_since: "2026-03-16T07:30:00.000Z",
        },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-04-112",
          experiment_code: "SYLU-2026-04-112-A",
          device: "盐雾试验室",
          start_at: "2026-03-17T12:00:00.000Z",
          end_at: "2026-03-17T16:00:00.000Z",
        },
      ],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-04-112",
        experimentCode: "SYLU-2026-04-112-B",
        experimentLabel: "振动试验",
        elapsedLabel: "26:30:00",
        isOverdue: true,
      }),
    ]);
  });

  test("uses arrived sample state as fallback for abnormal schedules when task transfer status is missing", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-121",
          source: "外部委托",
          status: "待排程",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-04-121",
          history: [{ action: "任务已确认入库", time: "2026-03-17T09:30:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-04-121-TP-001", status: "到货" }],
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-121",
          experiment_code: "SYLU-2026-04-121-A",
          experiment_name: "霉菌试验",
          status: "待排程",
          unscheduled_since: "2026-03-17T09:30:00.000Z",
        },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-04-121",
        experimentCode: "SYLU-2026-04-121-A",
        elapsedLabel: "00:30:00",
      }),
    ]);
  });

  test("shows pending abnormal schedule experiments even when arrival fields are stale", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-05-009",
          source: "外部委托",
          status: "待排程",
          transfer_status: "未入库",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-05-009",
          history: [{ action: "任务已确认入库", time: "2026-05-22T18:00:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-05-009-TP-001", status: "到货" }],
        },
      ],
      conflicts: [
        {
          id: "schedule-exception-9",
          type: "schedule_missed_start",
          status: "pending",
          task_code: "SYLU-2026-05-009",
          experiment_code: "SYLU-2026-05-009-A",
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-05-009",
          experiment_code: "SYLU-2026-05-009-A",
          experiment_name: "冲击试验",
          status: "待排程",
          unscheduled_since: "2026-05-22T18:00:00.000Z",
        },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-05-22T19:05:00.000Z"),
    });

    expect(viewModel.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-05-009",
        experimentCode: "SYLU-2026-05-009-A",
        elapsedLabel: "01:05:00",
      }),
    ]);
  });

  test("keeps acknowledged abnormal schedule experiments in timers when they remain unscheduled", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-05-010",
          source: "外部委托",
          status: "待排程",
          transfer_status: "未入库",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-05-010",
          history: [{ action: "任务已确认入库", time: "2026-05-22T18:00:00.000Z" }],
          status: "运输中",
          trays: [{ tray_code: "SYLU-2026-05-010-TP-001", status: "运输中" }],
        },
      ],
      conflicts: [
        {
          id: "schedule-exception-10",
          type: "schedule_missed_start",
          status: "acknowledged",
          task_code: "SYLU-2026-05-010",
          experiment_code: "SYLU-2026-05-010-A",
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-05-010",
          experiment_code: "SYLU-2026-05-010-A",
          experiment_name: "冲击试验",
          status: "待排程",
        },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-05-22T19:05:00.000Z"),
    });

    expect(viewModel.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-05-010",
        experimentCode: "SYLU-2026-05-010-A",
        elapsedLabel: "01:05:00",
      }),
    ]);
  });

  test("ignores unscheduled timers for tasks that are not yet confirmed in transfer storage", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-111",
          source: "内部新增",
          status: "待排程",
          transfer_status: "未入库",
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-04-111",
          experiment_code: "SYLU-2026-04-111-A",
          experiment_name: "盐雾试验",
          unscheduled_since: "2026-03-16T08:30:00.000Z",
        },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.unscheduledExperimentItems).toEqual([]);
  });
});


