import { describe, expect, test } from "vitest";

import {
  analyzeTaskTrayConflict,
  buildManualTimeSlotOptions,
  RETENTION_DEVICE,
  STATUS_COMPLETED,
  STATUS_SCHEDULED,
  STATUS_WAITING,
  buildConflictRows,
  buildExperimentOptions,
  buildGanttRows,
  buildLabOptions,
  buildManualTaskOptions,
  buildRetentionInternalRows,
  buildScheduleRows,
  buildScheduleRescheduleForm,
  buildTaskScheduledOverlays,
  createScheduleRecord,
  deleteScheduleRecord,
  formatDateTime,
  resolveTaskStatus,
  resolveRetentionTimeState,
  resolveScheduleTimes,
  updateScheduleRecord,
} from "./model";

// 这组测试主要保护排程页最容易回归的时间边界、暂存间迁移和甘特图契约。
describe("schedulePageModel", () => {
  test("resolveScheduleTimes keeps fixed slot boundaries", () => {
    const result = resolveScheduleTimes(
      {
        device: "冲击一室",
        schedule_date: "2099-03-20",
        time_slot: "morning",
      },
      new Date("2099-03-10T08:00:00.000Z"),
    );

    expect(result.error).toBeUndefined();
    expect(result.startTime).toBe("08:00");
    expect(result.endTime).toBe("12:00");
  });

  test("resolveScheduleTimes lets a morning slot start at the current morning time and continue into the afternoon", () => {
    const result = resolveScheduleTimes(
      {
        device: "冲击一室",
        planned_hours: 3.5,
        schedule_date: "2099-03-20",
        time_slot: "morning",
      },
      new Date("2099-03-20T11:59:00"),
    );

    expect(result.error).toBeUndefined();
    expect(result.startTime).toBe("11:59");
    expect(result.endTime).toBe("15:29");
  });

  test("resolveScheduleTimes delays afternoon slot start until ten minutes after the latest morning experiment ends", () => {
    const result = resolveScheduleTimes(
      {
        device: "盐雾试验室",
        planned_hours: 3.5,
        schedule_date: "2099-03-20",
        time_slot: "afternoon",
      },
      new Date("2099-03-20T12:30:00"),
      [
        {
          id: "schedule-1",
          task_code: "SYLU-2099-03-001",
          device: "冲击一室",
          start_at: "2099-03-20T00:00:00.000Z",
          end_at: "2099-03-20T05:40:00.000Z",
        },
      ],
    );

    expect(result.error).toBeUndefined();
    expect(result.startTime).toBe("13:50");
    expect(result.endTime).toBe("17:20");
  });

  test("resolveScheduleTimes rejects custom starts before the current time", () => {
    const result = resolveScheduleTimes(
      {
        custom_start: "09:29",
        device: "Lab-A",
        planned_hours: 1,
        schedule_date: "2099-03-20",
        time_slot: "custom",
      },
      new Date("2099-03-20T09:30:00"),
    );

    expect(result.error).toBe("自定义开始时间不能早于当前时间");
  });

  test("resolveScheduleTimes converts custom day durations to hours", () => {
    const result = resolveScheduleTimes(
      {
        custom_start: "09:30",
        device: "Lab-A",
        planned_duration_unit: "days",
        planned_hours: 2,
        schedule_date: "2099-03-20",
        time_slot: "custom",
      },
      new Date("2099-03-20T09:30:00"),
    );

    expect(result.error).toBeUndefined();
    expect(result.plannedHours).toBe(48);
    expect(formatDateTime(result.endAt)).toContain("2099-03-22 09:30");
  });

  test("resolveScheduleTimes supports half-day durations", () => {
    const result = resolveScheduleTimes(
      {
        custom_start: "09:30",
        device: "Lab-A",
        planned_duration_unit: "days",
        planned_hours: 0.5,
        schedule_date: "2099-03-20",
        time_slot: "custom",
      },
      new Date("2099-03-20T09:30:00"),
    );

    expect(result.error).toBeUndefined();
    expect(result.plannedHours).toBe(12);
    expect(formatDateTime(result.endAt)).toContain("2099-03-20 21:30");
  });

  test("buildManualTimeSlotOptions shows the earliest start time inside the active slot window", () => {
    const options = buildManualTimeSlotOptions({
      now: new Date("2099-03-20T17:07:00"),
      scheduleDate: "2099-03-20",
      schedules: [],
    });

    expect(options.find((option) => option.value === "afternoon")).toEqual(
      expect.objectContaining({
        label: expect.stringContaining("17:07"),
      }),
    );
  });

  test("buildGanttRows treats 13:00 end time as occupying the afternoon slot", () => {
    const result = buildGanttRows({
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-001",
          device: "冲击一室",
          start_at: "2099-03-18T00:00:00.000Z",
          end_at: "2099-03-18T05:00:00.000Z",
        },
      ],
      devices: [{ code: "冲击一室" }],
      days: 1,
      startDate: new Date("2099-03-18T00:00:00.000Z"),
      now: new Date("2099-03-10T08:00:00.000Z"),
    });

    const row = result.rows.find((entry) => entry.device === "冲击一室");
    expect(row?.slots[0]).toEqual(expect.objectContaining({ date: "2099-03-18", segment: "am", scheduleId: "schedule-1" }));
    expect(row?.slots[1]).toEqual(expect.objectContaining({ date: "2099-03-18", segment: "pm", scheduleId: "schedule-1" }));
  });

  test("buildConflictRows finds overlaps on the same non-retention device", () => {
    const rows = buildConflictRows({
      schedules: [
        { id: "schedule-1", task_code: "SYLU-2026-03-001", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" },
        { id: "schedule-2", task_code: "SYLU-2026-03-002", device: "冲击一室", start_at: "2099-03-20T09:00:00.000Z", end_at: "2099-03-20T11:00:00.000Z" },
        { id: "schedule-3", task_code: "SYLU-2026-03-003", device: RETENTION_DEVICE, start_at: "2099-03-20T09:00:00.000Z", end_at: "2099-03-20T11:00:00.000Z" },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ id: "schedule-2", device: "冲击一室" }));
  });

  test("buildConflictRows groups schedules by lab code before display device text", () => {
    const rows = buildConflictRows({
      schedules: [
        {
          id: "schedule-1",
          task_code: "TASK-001",
          device: "Salt Spray Lab",
          lab_code: "LAB_SALT",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T10:00:00.000Z",
        },
        {
          id: "schedule-2",
          task_code: "TASK-002",
          device: "盐雾试验室",
          lab_code: "LAB_SALT",
          start_at: "2099-03-20T09:00:00.000Z",
          end_at: "2099-03-20T11:00:00.000Z",
        },
        {
          id: "schedule-3",
          task_code: "TASK-003",
          device: "盐雾试验室",
          lab_code: "LAB_MOLD",
          start_at: "2099-03-20T09:00:00.000Z",
          end_at: "2099-03-20T11:00:00.000Z",
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ id: "schedule-2", device: "盐雾试验室" }));
  });

  test("buildLabOptions uses master lab rows for the selected test type", () => {
    const result = buildLabOptions({
      masterLabs: [
        { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验" },
        { code: "AREA_STAGING", name: RETENTION_DEVICE, type: "暂存间", testTypeName: "盐雾试验" },
        { code: "LAB_IMPACT_1", name: "冲击三室", type: "实验室", testTypeName: "冲击试验" },
      ],
      testType: "盐雾试验",
    });

    expect(result).toEqual(["盐雾试验室"]);
  });

  test("buildLabOptions falls back to static labs when master labs are unavailable", () => {
    expect(buildLabOptions({ masterLabs: [], testType: "盐雾试验" })).toContain("盐雾试验室");
  });

  test("buildLabOptions falls back to static labs when master labs have no matching test type", () => {
    const result = buildLabOptions({
      masterLabs: [{ code: "LAB_IMPACT_1", name: "冲击三室", type: "实验室", testTypeName: "冲击试验" }],
      testType: "盐雾试验",
    });

    expect(result).toContain("盐雾试验室");
    expect(result).not.toContain("冲击三室");
  });

  test("buildLabOptions preserves the selected device outside master lab candidates", () => {
    const result = buildLabOptions({
      masterLabs: [{ code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验" }],
      selectedDevice: "历史盐雾室",
      testType: "盐雾试验",
    });

    expect(result).toEqual(["盐雾试验室", "历史盐雾室"]);
  });

  test("completed experiments release same-device schedule conflict windows", () => {
    const schedules = [
      {
        id: "schedule-completed",
        task_code: "SYLU-2026-03-001",
        experiment_code: "SYLU-2026-03-001-A",
        device: "冲击一室",
        start_at: "2099-03-20T08:00:00.000Z",
        end_at: "2099-03-20T12:00:00.000Z",
      },
      {
        id: "schedule-new",
        task_code: "SYLU-2026-03-002",
        experiment_code: "SYLU-2026-03-002-A",
        device: "冲击一室",
        start_at: "2099-03-20T09:00:00.000Z",
        end_at: "2099-03-20T11:00:00.000Z",
      },
    ];
    const experimentTrays = [
      { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", tray_code: "SYLU-2026-03-001-TP-001" },
    ];
    const samples = [
      {
        code: "SYLU-2026-03-001-SP-001",
        task_code: "SYLU-2026-03-001",
        status: STATUS_COMPLETED,
        trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: STATUS_COMPLETED, quantity: 1 }],
      },
    ];

    expect(buildConflictRows({ experimentTrays, samples, schedules })).toEqual([]);
    expect(
      createScheduleRecord({
        experimentTrays,
        form: {
          custom_start: "09:00",
          device: "冲击一室",
          experiment_code: "SYLU-2026-03-002-A",
          planned_hours: 2,
          schedule_date: "2099-03-20",
          task_code: "SYLU-2026-03-002",
          time_slot: "custom",
        },
        now: new Date("2099-03-20T08:00:00"),
        samples,
        schedules: [schedules[0]],
        streams: [],
        tasks: [{ code: "SYLU-2026-03-002", test_type: "冲击试验" }],
      }).error,
    ).toBeUndefined();
  });

  test("resolveTaskStatus keeps an active schedule as scheduled until the experiment is explicitly started", () => {
    expect(
      resolveTaskStatus(
        "SYLU-2026-03-001",
        [
          {
            id: "schedule-1",
            task_code: "SYLU-2026-03-001",
            device: "冲击一室",
            start_at: "2099-03-20T08:00:00.000Z",
            end_at: "2099-03-20T10:00:00.000Z",
          },
        ],
        new Date("2099-03-20T09:00:00.000Z"),
      ),
    ).toBe(STATUS_SCHEDULED);
  });

  test("resolveTaskStatus does not mark an expired unstarted schedule as completed", () => {
    expect(
      resolveTaskStatus(
        { code: "SYLU-2026-03-001", status: STATUS_SCHEDULED },
        [
          {
            id: "schedule-1",
            task_code: "SYLU-2026-03-001",
            experiment_code: "SYLU-2026-03-001-A",
            device: "冲击一室",
            start_at: "2099-03-20T08:00:00.000Z",
            end_at: "2099-03-20T10:00:00.000Z",
          },
        ],
        [],
        new Date("2099-03-20T12:00:00.000Z"),
        [],
      ),
    ).toBe(STATUS_WAITING);
  });

  test("buildScheduleRows exposes experiment identifiers for multi-experiment scheduling", async () => {
    const { buildScheduleRows } = await import("./model");
    const rows = buildScheduleRows({
      tasks: [{ code: "SYLU-2026-03-006", name: "四综合任务", test_type: "四综合试验" }],
      experiments: [
        {
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          experiment_name: "四综合试验",
        },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          device: "四综合实验室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T12:00:00.000Z",
          status: STATUS_SCHEDULED,
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      taskCode: "SYLU-2026-03-006",
      experimentCode: "SYLU-2026-03-006-A",
      experimentLabel: "四综合试验",
    });
  });

  test("buildScheduleRows resolves row status per experiment instead of sharing one task status", async () => {
    const { buildScheduleRows } = await import("./model");
    const rows = buildScheduleRows({
      now: new Date("2099-03-20T09:30:00.000Z"),
      tasks: [{ code: "SYLU-2026-03-010", name: "多实验任务", test_type: "冲击试验" }],
      experiments: [
        {
          task_code: "SYLU-2026-03-010",
          experiment_code: "SYLU-2026-03-010-A",
          experiment_name: "冲击试验",
        },
        {
          task_code: "SYLU-2026-03-010",
          experiment_code: "SYLU-2026-03-010-B",
          experiment_name: "温度冲击试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-03-010", experiment_code: "SYLU-2026-03-010-A", tray_code: "SYLU-2026-03-010-TP-001" },
        { task_code: "SYLU-2026-03-010", experiment_code: "SYLU-2026-03-010-B", tray_code: "SYLU-2026-03-010-TP-002" },
      ],
      samples: [
        {
          code: "SYLU-2026-03-010-SP-001",
          task_code: "SYLU-2026-03-010",
          status: STATUS_COMPLETED,
          trays: [{ tray_code: "SYLU-2026-03-010-TP-001", status: STATUS_COMPLETED, quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-010-SP-002",
          task_code: "SYLU-2026-03-010",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-03-010-TP-002", status: "实验准备就绪", quantity: 1 }],
        },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-010",
          experiment_code: "SYLU-2026-03-010-A",
          device: "冲击一室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T10:00:00.000Z",
          status: STATUS_SCHEDULED,
        },
        {
          id: "schedule-2",
          task_code: "SYLU-2026-03-010",
          experiment_code: "SYLU-2026-03-010-B",
          device: "温度冲击一室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T12:00:00.000Z",
          status: STATUS_SCHEDULED,
        },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({ experimentCode: "SYLU-2026-03-010-A", rowStatus: STATUS_COMPLETED }),
      expect.objectContaining({ experimentCode: "SYLU-2026-03-010-B", rowStatus: STATUS_SCHEDULED }),
    ]);
  });

  test("buildScheduleRows prefers experiment-specific history over shared tray terminal status", async () => {
    const { buildScheduleRows } = await import("./model");
    const rows = buildScheduleRows({
      now: new Date("2099-03-20T09:30:00.000Z"),
      tasks: [{ code: "TASK-020", name: "共享托盘任务", test_type: "冲击试验" }],
      experiments: [
        { task_code: "TASK-020", experiment_code: "TASK-020-A", experiment_name: "冲击试验" },
        { task_code: "TASK-020", experiment_code: "TASK-020-B", experiment_name: "盐雾试验" },
        { task_code: "TASK-020", experiment_code: "TASK-020-C", experiment_name: "温度冲击试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-020", experiment_code: "TASK-020-A", tray_code: "TASK-020-TP-001" },
        { task_code: "TASK-020", experiment_code: "TASK-020-B", tray_code: "TASK-020-TP-001" },
        { task_code: "TASK-020", experiment_code: "TASK-020-C", tray_code: "TASK-020-TP-001" },
      ],
      samples: [
        {
          code: "TASK-020-SP-001",
          task_code: "TASK-020",
          status: STATUS_COMPLETED,
          trays: [{ tray_code: "TASK-020-TP-001", status: STATUS_COMPLETED, quantity: 1 }],
          history: [
            { action: "实验完成", detail: "TASK-020 / 盐雾试验 / 实验已完成", time: "2099-03-20T08:55:00.000Z" },
            { action: "开始实验", detail: "TASK-020 / 盐雾试验 / 实验进行中", time: "2099-03-20T08:20:00.000Z" },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-20-a",
          task_code: "TASK-020",
          experiment_code: "TASK-020-A",
          device: "冲击一室",
          start_at: "2099-03-20T09:00:00.000Z",
          end_at: "2099-03-20T11:00:00.000Z",
          status: STATUS_SCHEDULED,
        },
        {
          id: "schedule-20-b",
          task_code: "TASK-020",
          experiment_code: "TASK-020-B",
          device: "盐雾试验室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T09:00:00.000Z",
          status: STATUS_SCHEDULED,
        },
        {
          id: "schedule-20-c",
          task_code: "TASK-020",
          experiment_code: "TASK-020-C",
          device: "温度冲击一室",
          start_at: "2099-03-20T12:00:00.000Z",
          end_at: "2099-03-20T14:00:00.000Z",
          status: STATUS_SCHEDULED,
        },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({ experimentCode: "TASK-020-B", rowStatus: STATUS_COMPLETED }),
      expect.objectContaining({ experimentCode: "TASK-020-A", rowStatus: STATUS_SCHEDULED }),
      expect.objectContaining({ experimentCode: "TASK-020-C", rowStatus: STATUS_SCHEDULED }),
    ]);
  });

  test("buildExperimentOptions returns experiment-level options for the selected task", () => {
    const options = buildExperimentOptions({
      taskCode: "SYLU-2026-03-006",
      experiments: [
        {
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          experiment_name: "高低温湿热试验",
          required_device: "高温实验室",
        },
        {
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-B",
          experiment_name: "振动试验",
          required_device: "低温实验室",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          device: "高温实验室",
          status: STATUS_SCHEDULED,
        },
      ],
    });

    expect(options).toEqual([
      {
        code: "SYLU-2026-03-006-B",
        fullCode: "SYLU-2026-03-006-B",
        label: "振动试验",
        requiredDevice: "低温实验室",
        taskCode: "SYLU-2026-03-006",
      },
    ]);
  });

  test("buildExperimentOptions synthesizes a default experiment for legacy tasks without experiment records", () => {
    const options = buildExperimentOptions({
      taskCode: "SYLU-2026-03-003",
      experiments: [],
      schedules: [],
      tasks: [
        {
          code: "SYLU-2026-03-003",
          test_type: "霉菌试验",
        },
      ],
    });

    expect(options).toEqual([
      {
        code: "SYLU-2026-03-003-A",
        fullCode: "SYLU-2026-03-003-A",
        label: "霉菌试验",
        requiredDevice: "霉菌试验",
        taskCode: "SYLU-2026-03-003",
      },
    ]);
  });

  test("buildExperimentOptions splits legacy combined task types into atomic experiment-type options", () => {
    const options = buildExperimentOptions({
      taskCode: "SYLU-2026-03-003",
      experiments: [],
      schedules: [],
      tasks: [
        {
          code: "SYLU-2026-03-003",
          test_type: "冲击试验 / 盐雾试验 / 冲击试验",
          experiment_codes: ["SYLU-2026-03-003-A", "SYLU-2026-03-003-B", "SYLU-2026-03-003-C"],
        },
      ],
    });

    expect(options).toEqual([
      {
        code: "SYLU-2026-03-003-A",
        fullCode: "SYLU-2026-03-003-A",
        label: "冲击试验",
        requiredDevice: "冲击试验",
        taskCode: "SYLU-2026-03-003",
      },
      {
        code: "SYLU-2026-03-003-B",
        fullCode: "SYLU-2026-03-003-B",
        label: "盐雾试验",
        requiredDevice: "盐雾试验",
        taskCode: "SYLU-2026-03-003",
      },
    ]);
  });

  test("buildExperimentOptions hides duplicate experiment types for the selected task", () => {
    const options = buildExperimentOptions({
      taskCode: "SYLU-2026-03-006",
      experiments: [
        {
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-B",
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-C",
          experiment_name: "冲击试验",
          required_device: "冲击试验",
        },
      ],
      schedules: [],
      tasks: [],
    });

    expect(options.map((option) => option.label)).toEqual(["盐雾试验", "冲击试验"]);
  });

  test("buildExperimentOptions displays experiment type instead of experiment name", () => {
    const options = buildExperimentOptions({
      taskCode: "SYLU-2026-03-009",
      experiments: [
        {
          task_code: "SYLU-2026-03-009",
          experiment_code: "SYLU-2026-03-009-A",
          experiment_name: "高低温湿热试验2",
          required_device: "高低温湿热试验",
        },
      ],
      schedules: [],
      tasks: [],
    });

    expect(options).toEqual([
      expect.objectContaining({
        code: "SYLU-2026-03-009-A",
        label: "高低温湿热试验",
        requiredDevice: "高低温湿热试验",
      }),
    ]);
  });

  test("buildManualTaskOptions only keeps unpacking tasks that already have a saved tray plan", () => {
    const options = buildManualTaskOptions({
      activeTab: "unpacking",
      experiments: [
        { task_code: "SYLU-2026-03-010", experiment_code: "SYLU-2026-03-010-A", experiment_name: "冲击试验" },
        { task_code: "SYLU-2026-03-011", experiment_code: "SYLU-2026-03-011-A", experiment_name: "振动试验" },
        { task_code: "SYLU-2026-03-012", experiment_code: "SYLU-2026-03-012-A", experiment_name: "温度冲击试验" },
        { task_code: "SYLU-2026-03-013", experiment_code: "SYLU-2026-03-013-A", experiment_name: "盐雾试验" },
      ],
      experimentTrays: [{ task_code: "SYLU-2026-03-012", experiment_code: "SYLU-2026-03-012-A", tray_code: "SYLU-2026-03-012-TP-001" }],
      samples: [
        { task_code: "SYLU-2026-03-011", code: "SYLU-2026-03-011-SP-001", trays: ["SYLU-2026-03-011-TP-001"] },
      ],
      schedules: [],
      tasks: [
        { code: "SYLU-2026-03-010", name: "任务一", tray_codes: ["SYLU-2026-03-010-TP-001"] },
        { code: "SYLU-2026-03-011", name: "任务二" },
        { code: "SYLU-2026-03-012", name: "任务三" },
        { code: "SYLU-2026-03-013", name: "任务四", status: STATUS_WAITING },
      ],
    });

    expect(options.map((option) => option.code)).toEqual([
      "SYLU-2026-03-010",
      "SYLU-2026-03-011",
      "SYLU-2026-03-012",
    ]);
    expect(options.map((option) => option.label)).toEqual([
      "SYLU-2026-03-010",
      "SYLU-2026-03-011",
      "SYLU-2026-03-012",
    ]);
  });

  test("buildManualTaskOptions keeps tray-assigned tasks visible when another task already occupies the same experiment label", () => {
    const options = buildManualTaskOptions({
      activeTab: "unpacking",
      experiments: [
        { task_code: "SYLU-2026-03-020", experiment_code: "SYLU-2026-03-020-A", experiment_name: "冲击试验" },
        { task_code: "SYLU-2026-03-021", experiment_code: "SYLU-2026-03-021-A", experiment_name: "冲击试验" },
      ],
      experimentTrays: [],
      samples: [],
      schedules: [],
      tasks: [
        { code: "SYLU-2026-03-020", name: "无托盘任务" },
        { code: "SYLU-2026-03-021", name: "已分配托盘任务", tray_codes: ["SYLU-2026-03-021-TP-001"] },
      ],
    });

    expect(options.map((option) => option.code)).toEqual(["SYLU-2026-03-021"]);
  });

  test("active schedule views hide tasks whose assigned trays were returned", () => {
    const tasks = [
      { code: "TASK-ACTIVE", name: "活动任务", status: STATUS_WAITING, tray_codes: ["TASK-ACTIVE-TP-001"] },
      { code: "TASK-RETURNED", name: "归档任务", status: "已排程", tray_codes: ["TASK-RETURNED-TP-001"] },
    ];
    const samples = [
      {
        code: "TASK-ACTIVE-SP-001",
        task_code: "TASK-ACTIVE",
        status: "已入库",
        trays: [{ tray_code: "TASK-ACTIVE-TP-001", status: "已入库", quantity: 1 }],
      },
      {
        code: "TASK-RETURNED-SP-001",
        task_code: "TASK-RETURNED",
        status: "厂家收回",
        trays: [{ tray_code: "TASK-RETURNED-TP-001", status: "厂家收回", quantity: 1 }],
      },
    ];
    const experiments = [
      { task_code: "TASK-ACTIVE", experiment_code: "TASK-ACTIVE-A", experiment_name: "冲击试验" },
      { task_code: "TASK-RETURNED", experiment_code: "TASK-RETURNED-A", experiment_name: "盐雾试验" },
    ];
    const schedules = [
      {
        id: "schedule-active",
        task_code: "TASK-ACTIVE",
        experiment_code: "TASK-ACTIVE-A",
        device: "冲击一室",
        start_at: "2099-03-20T08:00:00.000Z",
        end_at: "2099-03-20T10:00:00.000Z",
      },
      {
        id: "schedule-returned",
        task_code: "TASK-RETURNED",
        experiment_code: "TASK-RETURNED-A",
        device: "盐雾试验室",
        start_at: "2099-03-20T08:00:00.000Z",
        end_at: "2099-03-20T10:00:00.000Z",
      },
    ];

    const rows = buildScheduleRows({ experiments, samples, schedules, tasks });
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }, { code: "盐雾试验室" }],
      experiments,
      samples,
      schedules,
      startDate: new Date("2099-03-20T00:00:00.000Z"),
      tasks,
    });
    const options = buildManualTaskOptions({ experiments, samples, schedules, tasks });

    expect(rows.map((row) => row.taskCode)).toEqual(["TASK-ACTIVE"]);
    expect(gantt.rows.flatMap((row) => row.slots.map((slot) => slot.scheduleId)).filter(Boolean)).toEqual(["schedule-active"]);
    expect(options.map((option) => option.code)).toEqual(["TASK-ACTIVE"]);
  });

  test("buildScheduleRescheduleForm maps a stored schedule back into the top scheduling form", () => {
    expect(
      buildScheduleRescheduleForm({
        device: "振动一室",
        experiment_code: "SYLU-2026-03-008-B",
        planned_hours: 3.5,
        start_at: "2026-03-31T00:00:00.000Z",
        end_at: "2026-03-31T03:30:00.000Z",
        task_code: "SYLU-2026-03-008",
      }),
    ).toEqual({
      custom_end: "11:30",
      custom_start: "08:00",
      device: "振动一室",
      experiment_code: "SYLU-2026-03-008-B",
      lab_code: "",
      lab_id: "",
      planned_duration_unit: "hours",
      planned_hours: 3.5,
      schedule_date: "2026-03-31",
      task_code: "SYLU-2026-03-008",
      time_slot: "morning",
    });

    expect(
      buildScheduleRescheduleForm({
        device: "冲击一室",
        experiment_code: "SYLU-2026-03-008-C",
        planned_hours: 2.5,
        start_at: "2026-03-31T01:15:00.000Z",
        end_at: "2026-03-31T03:45:00.000Z",
        task_code: "SYLU-2026-03-008",
      }),
    ).toEqual({
      custom_end: "11:45",
      custom_start: "09:15",
      device: "冲击一室",
      experiment_code: "SYLU-2026-03-008-C",
      lab_code: "",
      lab_id: "",
      planned_duration_unit: "hours",
      planned_hours: 2.5,
      schedule_date: "2026-03-31",
      task_code: "SYLU-2026-03-008",
      time_slot: "custom",
    });
  });

  test("buildScheduleRescheduleForm maps whole-day durations back into days", () => {
    expect(
      buildScheduleRescheduleForm({
        device: "Lab-A",
        experiment_code: "SYLU-2026-03-008-C",
        planned_hours: 96,
        start_at: "2026-03-31T07:05:00.000Z",
        end_at: "2026-04-04T07:05:00.000Z",
        task_code: "SYLU-2026-03-008",
      }),
    ).toEqual(
      expect.objectContaining({
        custom_start: "15:05",
        planned_duration_unit: "days",
        planned_hours: 4,
        time_slot: "custom",
      }),
    );
  });

  test("buildScheduleRescheduleForm maps half-day durations back into days", () => {
    expect(
      buildScheduleRescheduleForm({
        device: "Lab-A",
        experiment_code: "SYLU-2026-03-008-C",
        planned_hours: 12,
        start_at: "2026-03-31T07:05:00.000Z",
        end_at: "2026-03-31T19:05:00.000Z",
        task_code: "SYLU-2026-03-008",
      }),
    ).toEqual(
      expect.objectContaining({
        planned_duration_unit: "days",
        planned_hours: 0.5,
        time_slot: "custom",
      }),
    );
  });

  test("buildTaskScheduledOverlays returns other formal schedules for the selected task", () => {
    const overlays = buildTaskScheduledOverlays({
      experimentCode: "SYLU-2026-03-006-B",
      experimentTrays: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-002" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-003" },
      ],
      experiments: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "冲击试验" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "振动试验" },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          device: "冲击一室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T12:00:00.000Z",
        },
        {
          id: "schedule-2",
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-B",
          device: "振动一室",
          start_at: "2099-03-21T12:00:00.000Z",
          end_at: "2099-03-21T18:00:00.000Z",
        },
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-C",
          device: RETENTION_DEVICE,
          start_at: "2099-03-22T08:00:00.000Z",
          end_at: "2099-03-22T08:00:00.000Z",
        },
      ],
      taskCode: "SYLU-2026-03-006",
    });

    expect(overlays).toEqual([
      expect.objectContaining({
        device: "冲击一室",
        experimentCode: "SYLU-2026-03-006-A",
        experimentLabel: "冲击试验",
        scheduleId: "schedule-1",
        trayNos: ["SYLU-2026-03-006-TP-001", "SYLU-2026-03-006-TP-002"],
        traySummary: "SYLU-2026-03-006-TP-001 / SYLU-2026-03-006-TP-002",
      }),
    ]);
  });

  test("analyzeTaskTrayConflict reports a partial conflict when only some trays overlap", () => {
    const result = analyzeTaskTrayConflict({
      candidate: {
        end_at: "2099-03-20T11:00:00.000Z",
        experiment_code: "SYLU-2026-03-006-B",
        start_at: "2099-03-20T09:00:00.000Z",
        task_code: "SYLU-2026-03-006",
      },
      experimentTrays: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-002" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-002" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-003" },
      ],
      experiments: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "冲击试验" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "振动试验" },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          device: "冲击一室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T12:00:00.000Z",
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        level: "partial",
        conflictTrayNos: ["SYLU-2026-03-006-TP-002"],
      }),
    );
    expect(result?.conflictSchedules).toEqual([
      expect.objectContaining({
        experimentLabel: "冲击试验",
        trayNos: ["SYLU-2026-03-006-TP-001", "SYLU-2026-03-006-TP-002"],
      }),
    ]);
  });

  test("analyzeTaskTrayConflict reports a full conflict when all trays overlap", () => {
    const result = analyzeTaskTrayConflict({
      candidate: {
        end_at: "2099-03-20T11:00:00.000Z",
        experiment_code: "SYLU-2026-03-006-C",
        start_at: "2099-03-20T09:00:00.000Z",
        task_code: "SYLU-2026-03-006",
      },
      experimentTrays: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-002" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", tray_code: "SYLU-2026-03-006-TP-001" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", tray_code: "SYLU-2026-03-006-TP-002" },
      ],
      experiments: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "冲击试验" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", experiment_name: "温度冲击试验" },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          device: "冲击一室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T12:00:00.000Z",
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        level: "full",
        conflictTrayNos: ["SYLU-2026-03-006-TP-001", "SYLU-2026-03-006-TP-002"],
      }),
    );
  });

  test("analyzeTaskTrayConflict ignores historical schedules that do not have tray relations", () => {
    const result = analyzeTaskTrayConflict({
      candidate: {
        end_at: "2099-03-20T11:00:00.000Z",
        experiment_code: "SYLU-2026-03-006-B",
        start_at: "2099-03-20T09:00:00.000Z",
        task_code: "SYLU-2026-03-006",
      },
      experimentTrays: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-002" },
      ],
      experiments: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "冲击试验" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "振动试验" },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          device: "冲击一室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T12:00:00.000Z",
        },
      ],
    });

    expect(result).toBe(null);
  });

  test("analyzeTaskTrayConflict ignores completed sibling experiment schedules", () => {
    const result = analyzeTaskTrayConflict({
      candidate: {
        end_at: "2099-03-20T11:00:00.000Z",
        experiment_code: "SYLU-2026-03-006-B",
        start_at: "2099-03-20T09:00:00.000Z",
        task_code: "SYLU-2026-03-006",
      },
      experimentTrays: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-001" },
      ],
      experiments: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "冲击试验" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "振动试验" },
      ],
      samples: [
        {
          code: "SYLU-2026-03-006-SP-001",
          task_code: "SYLU-2026-03-006",
          status: STATUS_COMPLETED,
          trays: [{ tray_code: "SYLU-2026-03-006-TP-001", status: STATUS_COMPLETED, quantity: 1 }],
          history: [
            { action: "实验完成", detail: "SYLU-2026-03-006 / 冲击试验 / 实验已完成", time: "2099-03-20T08:30:00.000Z" },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          device: "冲击一室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T12:00:00.000Z",
        },
      ],
    });

    expect(result).toBe(null);
  });

  test("createScheduleRecord rewrites retention entries when a retained task is sent to a lab", () => {
    // 暂存间记录转正式实验室时必须复用原记录，而不是新增第二条排程。
    const result = createScheduleRecord({
      form: {
        device: "冲击一室",
        schedule_date: "2099-03-20",
        task_code: "SYLU-2026-03-001",
        time_slot: "morning",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-03-001",
          device: RETENTION_DEVICE,
          start_at: "2099-03-19T08:00:00.000Z",
          end_at: "2099-03-19T08:00:00.000Z",
          status: "暂存间存放",
        },
      ],
      streams: [],
      tasks: [{ code: "SYLU-2026-03-001", status: "暂存间存放", test_type: "冲击试验" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0]).toEqual(expect.objectContaining({ id: "schedule-retention-1", device: "冲击一室" }));
    expect(result.tasks[0].status).toBe("已排程");
  });

  test("createScheduleRecord stores laboratory identity fields with the display device name", () => {
    const result = createScheduleRecord({
      form: {
        device: "盐雾试验室",
        experiment_code: "SYLU-2026-03-001-A",
        lab_code: "LAB_SALT",
        lab_id: 9,
        schedule_date: "2099-03-20",
        task_code: "SYLU-2026-03-001",
        time_slot: "morning",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [],
      streams: [],
      tasks: [{ code: "SYLU-2026-03-001", status: "待排程", test_type: "盐雾试验" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules[0]).toEqual(
      expect.objectContaining({
        device: "盐雾试验室",
        lab_code: "LAB_SALT",
        lab_id: 9,
      }),
    );
  });

  test("createScheduleRecord carries laboratory identity when rewriting retention into a lab schedule", () => {
    const result = createScheduleRecord({
      form: {
        device: "冲击一室",
        experiment_code: "SYLU-2026-03-001-B",
        lab_code: "LAB_IMPACT_1",
        lab_id: 4,
        schedule_date: "2099-03-20",
        task_code: "SYLU-2026-03-001",
        time_slot: "morning",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-03-001",
          device: RETENTION_DEVICE,
          start_at: "2099-03-19T08:00:00.000Z",
          end_at: "2099-03-19T08:00:00.000Z",
          status: "暂存间存放",
        },
      ],
      streams: [],
      tasks: [{ code: "SYLU-2026-03-001", status: "暂存间存放", test_type: "冲击试验" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules[0]).toEqual(
      expect.objectContaining({
        device: "冲击一室",
        lab_code: "LAB_IMPACT_1",
        lab_id: 4,
      }),
    );
  });

  test("createScheduleRecord keeps experiment_code when rewriting a retention entry into a lab schedule", () => {
    const result = createScheduleRecord({
      form: {
        device: "冲击一室",
        experiment_code: "SYLU-2026-03-001-B",
        schedule_date: "2099-03-20",
        task_code: "SYLU-2026-03-001",
        time_slot: "morning",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          device: RETENTION_DEVICE,
          start_at: "2099-03-19T08:00:00.000Z",
          end_at: "2099-03-19T08:00:00.000Z",
          status: "暂存间存放",
        },
      ],
      streams: [],
      tasks: [{ code: "SYLU-2026-03-001", status: "暂存间存放", test_type: "冲击试验" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules[0]).toEqual(
      expect.objectContaining({
        experiment_code: "SYLU-2026-03-001-B",
        id: "schedule-retention-1",
      }),
    );
  });

  test("updateScheduleRecord updates laboratory identity fields with the selected lab", () => {
    const result = updateScheduleRecord({
      form: {
        device: "冲击二室",
        experiment_code: "SYLU-2026-03-001-A",
        id: "schedule-1",
        lab_code: "LAB_IMPACT_2",
        lab_id: 5,
        schedule_date: "2099-03-20",
        task_code: "SYLU-2026-03-001",
        time_slot: "afternoon",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          device: "冲击一室",
          lab_code: "LAB_IMPACT_1",
          lab_id: 4,
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T12:00:00.000Z",
        },
      ],
      streams: [],
      tasks: [{ code: "SYLU-2026-03-001", status: "已排程", test_type: "冲击试验" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules[0]).toEqual(
      expect.objectContaining({
        device: "冲击二室",
        lab_code: "LAB_IMPACT_2",
        lab_id: 5,
      }),
    );
  });

  test("buildGanttRows and buildRetentionInternalRows preserve visible schedule board state", () => {
    // 同时覆盖正式排程看板与暂存面板，避免两套视图口径漂移。
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }],
      schedules: [{ id: "schedule-1", task_code: "SYLU-2026-03-001", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" }],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });
    const retentionRows = buildRetentionInternalRows({
      tasks: [{ code: "SYLU-2026-04-107", name: "温度冲击-批次B", test_type: "温度冲击试验" }],
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-04-107",
          device: RETENTION_DEVICE,
          start_at: "2099-03-20T07:30:00.000Z",
          end_at: "2099-03-20T07:30:00.000Z",
          status: "暂存间存放",
        },
      ],
      samples: [{ task_code: "SYLU-2026-04-107", location: RETENTION_DEVICE, created_at: "2099-03-20T07:30:00.000Z" }],
      now: new Date("2099-03-20T12:30:00.000Z"),
    });

    expect(gantt.rows[0].slots.some((slot) => slot.label === "SYLU-2026-03-001")).toBe(true);
    expect(retentionRows).toHaveLength(1);
    expect(retentionRows[0]).toEqual(expect.objectContaining({ code: "SYLU-2026-04-107", testType: "温度冲击试验" }));
  });

  test("buildRetentionInternalRows excludes legacy sample-only rows without a retention schedule", () => {
    const retentionRows = buildRetentionInternalRows({
      tasks: [{ code: "SYLU-2026-04-105", name: "高低温湿热试验-批次E", test_type: "高低温湿热试验", status: "待排程" }],
      schedules: [],
      samples: [{ task_code: "SYLU-2026-04-105", location: RETENTION_DEVICE, created_at: "2099-03-20T07:30:00.000Z" }],
      now: new Date("2099-03-20T12:30:00.000Z"),
    });

    expect(retentionRows).toEqual([]);
  });

  test("buildGanttRows filters to the selected lab and preserves busy class contract", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }, { code: "盐雾试验室" }],
      filterDevice: "冲击一室",
      schedules: [
        { id: "schedule-1", task_code: "SYLU-2026-03-001", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" },
        { id: "schedule-2", task_code: "SYLU-2026-04-108", device: "盐雾试验室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    expect(gantt.rows).toHaveLength(1);
    expect(gantt.rows[0].device).toBe("冲击一室");
    expect(gantt.rows[0].slots.some((slot) => slot.className.includes("busy"))).toBe(true);
  });

  test("buildGanttRows scopes rows to the selected task labs", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }, { code: "振动一室" }, { code: "盐雾试验室" }, { code: "四综合实验室" }],
      experiments: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", required_device: "冲击一室" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", required_device: "振动试验" },
      ],
      schedules: [
        { id: "schedule-1", task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" },
        { id: "schedule-2", task_code: "OTHER-001", experiment_code: "OTHER-001-A", device: "四综合实验室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" },
      ],
      selectedTaskCode: "SYLU-2026-03-006",
      startDate: new Date("2099-03-20T00:00:00.000Z"),
      tasks: [{ code: "SYLU-2026-03-006", test_type: "冲击试验" }],
    });

    expect(gantt.rows.map((row) => row.device)).toEqual(["冲击一室", "振动一室", "振动二室"]);
  });

  test("buildGanttRows keeps all selected task experiment labs even when an experiment is selected", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }, { code: "振动一室" }, { code: "盐雾试验室" }],
      experiments: [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", required_device: "冲击一室" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", required_device: "振动试验" },
      ],
      schedules: [
        { id: "schedule-1", task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" },
      ],
      selectedExperimentCode: "SYLU-2026-03-006-B",
      selectedTaskCode: "SYLU-2026-03-006",
      startDate: new Date("2099-03-20T00:00:00.000Z"),
      tasks: [{ code: "SYLU-2026-03-006", test_type: "冲击试验 / 振动试验" }],
    });

    expect(gantt.rows.map((row) => row.device)).toEqual(["冲击一室", "振动一室", "振动二室"]);
  });

  test("buildGanttRows scopes selected task rows with master lab data", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "盐雾试验室" }],
      experiments: [
        { task_code: "SYLU-2026-03-009", experiment_code: "SYLU-2026-03-009-A", required_device: "盐雾试验" },
      ],
      masterLabs: [
        { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验" },
        { code: "AREA_STAGING", name: RETENTION_DEVICE, type: "暂存间", testTypeName: "盐雾试验" },
      ],
      schedules: [],
      selectedTaskCode: "SYLU-2026-03-009",
      startDate: new Date("2099-03-20T00:00:00.000Z"),
      tasks: [{ code: "SYLU-2026-03-009", test_type: "盐雾试验" }],
    });

    expect(gantt.rows.map((row) => row.device)).toEqual(["盐雾试验室"]);
  });

  test("buildGanttRows places schedules on the master lab row by lab code", () => {
    const gantt = buildGanttRows({
      masterLabs: [{ code: "LAB_SALT", name: "Salt Spray Lab", type: "实验室", testTypeName: "盐雾试验" }],
      schedules: [
        {
          id: "schedule-salt",
          task_code: "TASK-SALT",
          device: "盐雾试验室",
          lab_code: "LAB_SALT",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T10:00:00.000Z",
        },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
      tasks: [{ code: "TASK-SALT", status: "已排程", test_type: "盐雾试验" }],
    });

    const saltRow = gantt.rows.find((row) => row.device === "Salt Spray Lab");
    expect(saltRow).toBeTruthy();
    expect(saltRow.slots.some((slot) => slot.scheduleId === "schedule-salt" && slot.label === "TASK-SALT")).toBe(true);
  });

  test("buildGanttRows does not add unrelated master resources to base rows", () => {
    const gantt = buildGanttRows({
      devices: [],
      masterLabs: [
        { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验" },
        { code: "AREA_DOCK", name: "室外接驳区", type: "操作区" },
      ],
      schedules: [],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    expect(gantt.rows.map((row) => row.device)).toContain("盐雾试验室");
    expect(gantt.rows.map((row) => row.device)).not.toContain("室外接驳区");
  });

  test("buildGanttRows ignores legacy idle devices when master labs are available", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "Impact Lab" }, { code: "Vibration Lab" }, { code: "Salt Spray Lab" }],
      masterLabs: [
        { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验" },
        { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验" },
      ],
      schedules: [],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    expect(gantt.rows.map((row) => row.device)).not.toEqual(
      expect.arrayContaining(["Impact Lab", "Vibration Lab", "Salt Spray Lab"]),
    );
  });

  test("buildGanttRows ignores legacy English master labs outside current test types", () => {
    const gantt = buildGanttRows({
      devices: [],
      masterLabs: [
        { code: "LAB_IMPACT", name: "Impact Lab", type: "LAB", testTypeCode: "TT_IMPACT", testTypeName: "Impact Test" },
        { code: "LAB_VIB", name: "Vibration Lab", type: "LAB", testTypeCode: "TT_VIB", testTypeName: "Vibration Test" },
        { code: "LAB_SALT_OLD", name: "Salt Spray Lab", type: "LAB", testTypeCode: "TT_SALT", testTypeName: "Salt Spray Test" },
        { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeCode: "YW", testTypeName: "盐雾试验" },
      ],
      schedules: [],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    expect(gantt.rows.map((row) => row.device)).toContain("盐雾试验室");
    expect(gantt.rows.map((row) => row.device)).not.toEqual(
      expect.arrayContaining(["Impact Lab", "Vibration Lab", "Salt Spray Lab"]),
    );
  });

  test("buildGanttRows keeps one stable color per task across labs", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }, { code: "振动一室" }],
      schedules: [
        { id: "schedule-1", task_code: "SYLU-2026-03-006", device: "冲击一室", start_at: "2099-03-20T00:00:00.000Z", end_at: "2099-03-20T02:00:00.000Z" },
        { id: "schedule-2", task_code: "SYLU-2026-03-006", device: "振动一室", start_at: "2099-03-20T00:00:00.000Z", end_at: "2099-03-20T02:00:00.000Z" },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    const firstColor = gantt.rows.find((row) => row.device === "冲击一室")?.slots.find((slot) => slot.items?.[0])?.items[0].color;
    const secondColor = gantt.rows.find((row) => row.device === "振动一室")?.slots.find((slot) => slot.items?.[0])?.items[0].color;

    expect(firstColor).toBeTruthy();
    expect(secondColor).toBe(firstColor);
  });

  test("buildGanttRows spreads task colors across many tasks to reduce visual collisions", () => {
    const devices = Array.from({ length: 12 }, (_, index) => ({ code: `实验室-${index + 1}` }));
    const schedules = Array.from({ length: 12 }, (_, index) => ({
      id: `schedule-${index + 1}`,
      task_code: `SYLU-2026-03-${String(index + 1).padStart(3, "0")}`,
      device: `实验室-${index + 1}`,
      start_at: "2099-03-20T00:00:00.000Z",
      end_at: "2099-03-20T02:00:00.000Z",
    }));

    const gantt = buildGanttRows({
      devices,
      schedules,
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    const distinctColors = new Set(
      gantt.rows
        .map((row) => row.slots.find((slot) => slot.items?.[0])?.items?.[0]?.color)
        .filter(Boolean),
    );

    expect(distinctColors.size).toBeGreaterThanOrEqual(10);
  });

  test("buildGanttRows splits two non-overlapping tasks across one half-day cell", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }],
      schedules: [
        { id: "schedule-1", task_code: "TASK-001", device: "冲击一室", start_at: "2099-03-20T00:00:00.000Z", end_at: "2099-03-20T02:00:00.000Z" },
        { id: "schedule-2", task_code: "TASK-002", device: "冲击一室", start_at: "2099-03-20T02:30:00.000Z", end_at: "2099-03-20T03:30:00.000Z" },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    expect(gantt.rows[0].slots[0]).toEqual(
      expect.objectContaining({
        displayMode: "split",
        overflowCount: 0,
        state: "split",
      }),
    );
    expect(gantt.rows[0].slots[0].items.map((item) => item.taskCode)).toEqual(["TASK-001", "TASK-002"]);
  });

  test("buildGanttRows truncates stacked cells after two tasks and reports overflow", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }],
      schedules: [
        { id: "schedule-1", task_code: "TASK-001", device: "冲击一室", start_at: "2099-03-20T00:00:00.000Z", end_at: "2099-03-20T01:00:00.000Z" },
        { id: "schedule-2", task_code: "TASK-002", device: "冲击一室", start_at: "2099-03-20T01:30:00.000Z", end_at: "2099-03-20T02:00:00.000Z" },
        { id: "schedule-3", task_code: "TASK-003", device: "冲击一室", start_at: "2099-03-20T02:30:00.000Z", end_at: "2099-03-20T03:30:00.000Z" },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    expect(gantt.rows[0].slots[0]).toEqual(
      expect.objectContaining({
        displayMode: "stacked",
        overflowCount: 1,
      }),
    );
    expect(gantt.rows[0].slots[0].items.map((item) => item.taskCode)).toEqual(["TASK-001", "TASK-002"]);
  });

  test("buildGanttRows marks exactly two non-overlapping tasks as split instead of stacked", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }],
      schedules: [
        {
          id: "schedule-1",
          task_code: "TASK-001",
          experiment_code: "TASK-001-A",
          device: "冲击一室",
          start_at: "2099-03-20T00:00:00.000Z",
          end_at: "2099-03-20T01:00:00.000Z",
        },
        {
          id: "schedule-2",
          task_code: "TASK-002",
          experiment_code: "TASK-002-B",
          device: "冲击一室",
          start_at: "2099-03-20T01:30:00.000Z",
          end_at: "2099-03-20T03:00:00.000Z",
        },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    expect(gantt.rows[0].slots[0]).toEqual(
      expect.objectContaining({
        displayMode: "split",
        overflowCount: 0,
        state: "split",
      }),
    );
  });

  test("buildGanttRows includes all experiment labels and time ranges in split cell hover text", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }],
      experiments: [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", experiment_name: "A实验" },
        { task_code: "TASK-002", experiment_code: "TASK-002-B", experiment_name: "B实验" },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "TASK-001",
          experiment_code: "TASK-001-A",
          device: "冲击一室",
          start_at: "2099-03-20T00:00:00.000Z",
          end_at: "2099-03-20T01:00:00.000Z",
        },
        {
          id: "schedule-2",
          task_code: "TASK-002",
          experiment_code: "TASK-002-B",
          device: "冲击一室",
          start_at: "2099-03-20T01:30:00.000Z",
          end_at: "2099-03-20T03:00:00.000Z",
        },
        {
          id: "schedule-3",
          task_code: "TASK-003",
          experiment_code: "TASK-003-C",
          device: "冲击一室",
          start_at: "2099-03-20T03:15:00.000Z",
          end_at: "2099-03-20T03:45:00.000Z",
        },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    expect(gantt.rows[0].slots[0].title).toContain("TASK-001 / A实验 / 2099-03-20 08:00 - 2099-03-20 09:00");
    expect(gantt.rows[0].slots[0].title).toContain("TASK-002 / B实验 / 2099-03-20 09:30 - 2099-03-20 11:00");
    expect(gantt.rows[0].slots[0].title).toContain("隐藏:");
  });

  test("buildGanttRows keeps unstarted schedules visible even after their planned end time has passed", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }],
      schedules: [
        {
          id: "schedule-1",
          task_code: "TASK-001",
          experiment_code: "TASK-001-A",
          device: "冲击一室",
          start_at: "2099-03-19T00:00:00.000Z",
          end_at: "2099-03-19T02:00:00.000Z",
        },
      ],
      startDate: new Date("2099-03-19T00:00:00.000Z"),
      now: new Date("2099-03-20T00:00:00.000Z"),
    });

    expect(gantt.rows[0].slots.some((slot) => slot.scheduleId === "schedule-1")).toBe(true);
    expect(gantt.rows[0].slots.some((slot) => slot.state !== "idle")).toBe(true);
  });

  test("buildGanttRows releases completed schedule occupancy before the planned end time", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }],
      experimentTrays: [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TASK-001-TP-001" },
      ],
      samples: [
        {
          code: "TASK-001-SP-001",
          task_code: "TASK-001",
          status: STATUS_COMPLETED,
          trays: [{ tray_code: "TASK-001-TP-001", status: STATUS_COMPLETED, quantity: 1 }],
        },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "TASK-001",
          experiment_code: "TASK-001-A",
          device: "冲击一室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T12:00:00.000Z",
        },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
      now: new Date("2099-03-20T09:00:00.000Z"),
    });

    const row = gantt.rows.find((entry) => entry.device === "冲击一室");
    expect(row?.slots.some((slot) => slot.scheduleId === "schedule-1")).toBe(false);
    expect(row?.slots.every((slot) => slot.state === "idle")).toBe(true);
  });

  test("buildGanttRows keeps the board visible after one experiment has formally started", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }, { code: "振动一室" }],
      experimentTrays: [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TASK-001-TP-001" },
      ],
      samples: [
        {
          code: "TASK-001-SP-001",
          task_code: "TASK-001",
          status: "实验进行中",
          location: "冲击一室",
          trays: [{ tray_code: "TASK-001-TP-001", status: "实验进行中", quantity: 1 }],
        },
      ],
      schedules: [
        {
          id: "schedule-1",
          task_code: "TASK-001",
          experiment_code: "TASK-001-A",
          device: "冲击一室",
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T10:00:00.000Z",
        },
        {
          id: "schedule-2",
          task_code: "TASK-002",
          experiment_code: "TASK-002-A",
          device: "振动一室",
          start_at: "2099-03-20T12:00:00.000Z",
          end_at: "2099-03-20T15:00:00.000Z",
        },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
      now: new Date("2099-03-20T09:00:00.000Z"),
    });

    const impactRow = gantt.rows.find((row) => row.device === "冲击一室");
    const vibrationRow = gantt.rows.find((row) => row.device === "振动一室");
    expect(impactRow).toBeTruthy();
    expect(vibrationRow).toBeTruthy();
    expect(impactRow?.slots.some((slot) => slot.scheduleId === "schedule-1" && slot.state === "running")).toBe(true);
    expect(vibrationRow?.slots.some((slot) => slot.scheduleId === "schedule-2")).toBe(true);
  });

  test("buildGanttRows keeps future shared-tray experiments visible when only a previous experiment completed", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "温度冲击一室" }],
      now: new Date("2099-03-20T02:00:00.000Z"),
      experiments: [
        { task_code: "TASK-030", experiment_code: "TASK-030-B", experiment_name: "盐雾试验" },
        { task_code: "TASK-030", experiment_code: "TASK-030-C", experiment_name: "温度冲击试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-030", experiment_code: "TASK-030-B", tray_code: "TASK-030-TP-001" },
        { task_code: "TASK-030", experiment_code: "TASK-030-C", tray_code: "TASK-030-TP-001" },
      ],
      samples: [
        {
          code: "TASK-030-SP-001",
          task_code: "TASK-030",
          status: STATUS_COMPLETED,
          location: "盐雾试验室",
          trays: [{ tray_code: "TASK-030-TP-001", status: STATUS_COMPLETED, quantity: 1 }],
          history: [
            { action: "实验完成", detail: "TASK-030 / 盐雾试验 / 实验已完成", time: "2099-03-20T01:00:00.000Z" },
            { action: "开始实验", detail: "TASK-030 / 盐雾试验 / 实验进行中", time: "2099-03-20T00:15:00.000Z" },
          ],
        },
      ],
      schedules: [
        {
          id: "schedule-30-b",
          task_code: "TASK-030",
          experiment_code: "TASK-030-B",
          device: "盐雾试验室",
          start_at: "2099-03-20T00:00:00.000Z",
          end_at: "2099-03-20T01:00:00.000Z",
        },
        {
          id: "schedule-30-c",
          task_code: "TASK-030",
          experiment_code: "TASK-030-C",
          device: "温度冲击一室",
          start_at: "2099-03-20T04:00:00.000Z",
          end_at: "2099-03-20T06:00:00.000Z",
        },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    const tempShockRow = gantt.rows.find((row) => row.device === "温度冲击一室");
    expect(tempShockRow?.slots.some((slot) => slot.scheduleId === "schedule-30-c")).toBe(true);
  });

  test("buildGanttRows marks idle slots as maintenance or disabled when devices are unavailable", () => {
    const gantt = buildGanttRows({
      devices: [
        { code: "冲击一室", status: "维护/校准" },
        { code: "冲击二室", status: "停用" },
        {
          code: "振动一室",
          maintenance_end_at: "2099-03-20T11:00",
          maintenance_start_at: "2099-03-20T09:00",
          status: "可用",
        },
      ],
      now: new Date("2099-03-20T07:00:00"),
      schedules: [],
      startDate: new Date("2099-03-20T00:00:00"),
      tasks: [],
    });

    expect(gantt.rows.find((row) => row.device === "冲击一室")?.slots[0]).toEqual(expect.objectContaining({
      className: expect.stringContaining("maintenance"),
      label: "维护中",
      state: "maintenance",
      title: "冲击一室维护中，暂不可排程",
    }));
    expect(gantt.rows.find((row) => row.device === "冲击二室")?.slots[0]).toEqual(expect.objectContaining({
      className: expect.stringContaining("disabled"),
      label: "停用",
      state: "disabled",
      title: "冲击二室已停用，暂不可排程",
    }));
    expect(gantt.rows.find((row) => row.device === "振动一室")?.slots[0]).toEqual(expect.objectContaining({
      label: "维护中",
      state: "maintenance",
      title: "振动一室维护中，暂不可排程",
    }));
  });

  test("resolveRetentionTimeState snaps retention scheduling to now", () => {
    const result = resolveRetentionTimeState(new Date(2099, 2, 20, 9, 15, 0));

    expect(result.schedule_date).toBe("2099-03-20");
    expect(result.time_slot).toBe("morning");
    expect(result.custom_start).toBe("09:15");
    expect(result.custom_end).toBe("09:15");
  });

  test("createScheduleRecord uses planned hours to create a cross-day schedule and stores the duration", () => {
    const result = createScheduleRecord({
      experiments: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          experiment_name: "A实验",
          unscheduled_since: "2099-03-10T07:00:00.000Z",
        },
      ],
      form: {
        device: "Lab-A",
        experiment_code: "SYLU-2026-03-001-A",
        planned_hours: "26.5",
        schedule_date: "2099-03-20",
        task_code: "SYLU-2026-03-001",
        time_slot: "morning",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [],
      streams: [],
      tasks: [{ code: "SYLU-2026-03-001", status: STATUS_WAITING, test_type: "UNKNOWN" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules[0].experiment_code).toBe("SYLU-2026-03-001-A");
    expect(result.schedules[0].planned_hours).toBe(26.5);
    expect(result.experiments[0].unscheduled_since).toBe("");
    expect(formatDateTime(result.schedules[0].end_at)).toContain("2099-03-21 10:30");
  });

  test("createScheduleRecord rejects a device that is currently in maintenance", () => {
    const result = createScheduleRecord({
      devices: [
        {
          code: "冲击一室",
          maintenance_end_at: "2099-03-20T12:00",
          maintenance_start_at: "2099-03-20T08:00",
          status: "可用",
        },
      ],
      experiments: [
        {
          task_code: "TASK-001",
          experiment_code: "TASK-001-A",
          experiment_name: "冲击试验",
        },
      ],
      form: {
        custom_start: "09:00",
        device: "冲击一室",
        experiment_code: "TASK-001-A",
        planned_hours: 1,
        schedule_date: "2099-03-20",
        task_code: "TASK-001",
        time_slot: "custom",
      },
      now: new Date("2099-03-20T07:00:00"),
      schedules: [],
      streams: [],
      tasks: [{ code: "TASK-001", status: STATUS_WAITING, test_type: "冲击试验" }],
    });

    expect(result.error).toBe("该设备处于维护状态，不可排程");
  });

  test("createScheduleRecord rejects a disabled device with a disabled-device message", () => {
    const result = createScheduleRecord({
      devices: [{ code: "冲击一室", status: "停用" }],
      experiments: [
        {
          task_code: "TASK-001",
          experiment_code: "TASK-001-A",
          experiment_name: "冲击试验",
        },
      ],
      form: {
        custom_start: "09:00",
        device: "冲击一室",
        experiment_code: "TASK-001-A",
        planned_hours: 1,
        schedule_date: "2099-03-20",
        task_code: "TASK-001",
        time_slot: "custom",
      },
      now: new Date("2099-03-20T07:00:00"),
      schedules: [],
      streams: [],
      tasks: [{ code: "TASK-001", status: STATUS_WAITING, test_type: "冲击试验" }],
    });

    expect(result.error).toBe("该设备已停用，不可排程");
  });

  test("updateScheduleRecord recalculates end time when planned hours change", () => {
    const result = updateScheduleRecord({
      experiments: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          experiment_name: "A实验",
          unscheduled_since: "",
        },
      ],
      form: {
        device: "Lab-A",
        experiment_code: "SYLU-2026-03-001-A",
        id: "schedule-1",
        planned_hours: "1.5",
        schedule_date: "2099-03-20",
        task_code: "SYLU-2026-03-001",
        time_slot: "morning",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          device: "Lab-A",
          planned_hours: 26.5,
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-21T10:30:00.000Z",
          status: STATUS_SCHEDULED,
        },
      ],
      streams: [],
      tasks: [{ code: "SYLU-2026-03-001", status: STATUS_SCHEDULED, test_type: "UNKNOWN" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules[0].experiment_code).toBe("SYLU-2026-03-001-A");
    expect(result.schedules[0].planned_hours).toBe(1.5);
    expect(formatDateTime(result.schedules[0].end_at)).toContain("2099-03-20 09:30");
  });

  test("deleteScheduleRecord restores unscheduled_since from transfer confirmation when removing the last formal schedule", () => {
    const result = deleteScheduleRecord({
      experiments: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          experiment_name: "A实验",
          unscheduled_since: "",
        },
      ],
      now: new Date("2099-03-10T08:00:00.000Z"),
      samples: [
        {
          task_code: "SYLU-2026-03-001",
          history: [{ action: "任务已确认入库", time: "2099-03-09T07:15:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "到货" }],
        },
      ],
      scheduleId: "schedule-1",
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          device: "Lab-A",
          planned_hours: 1.5,
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-20T09:30:00.000Z",
          status: STATUS_SCHEDULED,
        },
      ],
      streams: [],
      tasks: [{ code: "SYLU-2026-03-001", status: STATUS_SCHEDULED, test_type: "UNKNOWN" }],
    });

    expect(result.schedules).toEqual([]);
    expect(result.experiments[0].unscheduled_since).toBe("2099-03-09 15:15:00");
    expect(result.experiments[0].status).toBe(STATUS_WAITING);
  });

  test("buildGanttRows keeps cross-day schedules inside the fixed three-day window", () => {
    // 超过默认 3 天窗口的长排程必须继续可见，并折叠成连续段。
    const gantt = buildGanttRows({
      devices: [{ code: "Lab-A" }],
      schedules: [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-001",
          device: "Lab-A",
          planned_hours: 80,
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-23T16:00:00.000Z",
        },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    const labRow = gantt.rows.find((row) => row.device === "Lab-A");

    expect(gantt.days).toHaveLength(3);
    expect(labRow?.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          colspan: expect.any(Number),
          label: "SYLU-2026-03-001",
          scheduleId: "schedule-1",
          state: "busy",
        }),
      ]),
    );
    expect(labRow?.segments.find((segment) => segment.scheduleId === "schedule-1")?.colspan).toBe(5);
  });

  test("createManualScheduleForm keeps today morning before 12:00", async () => {
    const { createManualScheduleForm } = await import("./model");
    const result = createManualScheduleForm(new Date("2099-03-20T11:59:00"));

    expect(result.schedule_date).toBe("2099-03-20");
    expect(result.time_slot).toBe("morning");
  });

  test("createManualScheduleForm switches to today afternoon at 12:00", async () => {
    const { createManualScheduleForm } = await import("./model");
    const result = createManualScheduleForm(new Date("2099-03-20T12:00:00"));

    expect(result.schedule_date).toBe("2099-03-20");
    expect(result.time_slot).toBe("afternoon");
  });

  test("createManualScheduleForm rolls to next day morning at 18:00", async () => {
    const { createManualScheduleForm } = await import("./model");
    const result = createManualScheduleForm(new Date("2099-03-20T18:00:00"));

    expect(result.schedule_date).toBe("2099-03-21");
    expect(result.time_slot).toBe("morning");
  });
});
