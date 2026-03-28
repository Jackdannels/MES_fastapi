import { describe, expect, test } from "vitest";

import {
  RETENTION_DEVICE,
  STATUS_SCHEDULED,
  STATUS_WAITING,
  buildConflictRows,
  buildExperimentOptions,
  buildGanttRows,
  buildRetentionInternalRows,
  createScheduleRecord,
  formatDateTime,
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

  test("buildGanttRows treats 13:00 end time as occupying the afternoon slot", () => {
    const result = buildGanttRows({
      schedules: [
        {
          id: "schedule-1",
          task_code: "CJ-2026-001",
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
        { id: "schedule-1", task_code: "CJ-2026-001", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" },
        { id: "schedule-2", task_code: "CJ-2026-002", device: "冲击一室", start_at: "2099-03-20T09:00:00.000Z", end_at: "2099-03-20T11:00:00.000Z" },
        { id: "schedule-3", task_code: "CJ-2026-003", device: RETENTION_DEVICE, start_at: "2099-03-20T09:00:00.000Z", end_at: "2099-03-20T11:00:00.000Z" },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ id: "schedule-2", device: "冲击一室" }));
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

  test("createScheduleRecord rewrites retention entries when a retained task is sent to a lab", () => {
    // 暂存间记录转正式实验室时必须复用原记录，而不是新增第二条排程。
    const result = createScheduleRecord({
      form: {
        device: "冲击一室",
        schedule_date: "2099-03-20",
        task_code: "CJ-2026-001",
        time_slot: "morning",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "CJ-2026-001",
          device: RETENTION_DEVICE,
          start_at: "2099-03-19T08:00:00.000Z",
          end_at: "2099-03-19T08:00:00.000Z",
          status: "暂存间存放",
        },
      ],
      streams: [],
      tasks: [{ code: "CJ-2026-001", status: "暂存间存放", test_type: "冲击试验" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0]).toEqual(expect.objectContaining({ id: "schedule-retention-1", device: "冲击一室" }));
    expect(result.tasks[0].status).toBe("已排程");
  });

  test("createScheduleRecord keeps experiment_code when rewriting a retention entry into a lab schedule", () => {
    const result = createScheduleRecord({
      form: {
        device: "冲击一室",
        experiment_code: "CJ-2026-001-B",
        schedule_date: "2099-03-20",
        task_code: "CJ-2026-001",
        time_slot: "morning",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "CJ-2026-001",
          experiment_code: "CJ-2026-001-A",
          device: RETENTION_DEVICE,
          start_at: "2099-03-19T08:00:00.000Z",
          end_at: "2099-03-19T08:00:00.000Z",
          status: "暂存间存放",
        },
      ],
      streams: [],
      tasks: [{ code: "CJ-2026-001", status: "暂存间存放", test_type: "冲击试验" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules[0]).toEqual(
      expect.objectContaining({
        experiment_code: "CJ-2026-001-B",
        id: "schedule-retention-1",
      }),
    );
  });

  test("buildGanttRows and buildRetentionInternalRows preserve visible schedule board state", () => {
    // 同时覆盖正式排程看板与暂存面板，避免两套视图口径漂移。
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }],
      schedules: [{ id: "schedule-1", task_code: "CJ-2026-001", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" }],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });
    const retentionRows = buildRetentionInternalRows({
      tasks: [{ code: "WDC-2026-001", name: "温度冲击-批次B", test_type: "温度冲击试验" }],
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "WDC-2026-001",
          device: RETENTION_DEVICE,
          start_at: "2099-03-20T07:30:00.000Z",
          end_at: "2099-03-20T07:30:00.000Z",
          status: "暂存间存放",
        },
      ],
      samples: [{ task_code: "WDC-2026-001", location: RETENTION_DEVICE, created_at: "2099-03-20T07:30:00.000Z" }],
      now: new Date("2099-03-20T12:30:00.000Z"),
    });

    expect(gantt.rows[0].slots.some((slot) => slot.label === "CJ-2026-001")).toBe(true);
    expect(retentionRows).toHaveLength(1);
    expect(retentionRows[0]).toEqual(expect.objectContaining({ code: "WDC-2026-001", testType: "温度冲击试验" }));
  });

  test("buildRetentionInternalRows excludes legacy sample-only rows without a retention schedule", () => {
    const retentionRows = buildRetentionInternalRows({
      tasks: [{ code: "GDW-2024-005", name: "高低温湿热试验-批次E", test_type: "高低温湿热试验", status: "待排程" }],
      schedules: [],
      samples: [{ task_code: "GDW-2024-005", location: RETENTION_DEVICE, created_at: "2099-03-20T07:30:00.000Z" }],
      now: new Date("2099-03-20T12:30:00.000Z"),
    });

    expect(retentionRows).toEqual([]);
  });

  test("buildGanttRows filters to the selected lab and preserves busy class contract", () => {
    const gantt = buildGanttRows({
      devices: [{ code: "冲击一室" }, { code: "盐雾试验室" }],
      filterDevice: "冲击一室",
      schedules: [
        { id: "schedule-1", task_code: "CJ-2026-001", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" },
        { id: "schedule-2", task_code: "YW-2026-001", device: "盐雾试验室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    expect(gantt.rows).toHaveLength(1);
    expect(gantt.rows[0].device).toBe("冲击一室");
    expect(gantt.rows[0].slots.some((slot) => slot.className.includes("busy"))).toBe(true);
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
      form: {
        device: "Lab-A",
        experiment_code: "CJ-2026-001-A",
        planned_hours: "26.5",
        schedule_date: "2099-03-20",
        task_code: "CJ-2026-001",
        time_slot: "morning",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [],
      streams: [],
      tasks: [{ code: "CJ-2026-001", status: STATUS_WAITING, test_type: "UNKNOWN" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules[0].experiment_code).toBe("CJ-2026-001-A");
    expect(result.schedules[0].planned_hours).toBe(26.5);
    expect(formatDateTime(result.schedules[0].end_at)).toContain("2099-03-21 10:30");
  });

  test("updateScheduleRecord recalculates end time when planned hours change", () => {
    const result = updateScheduleRecord({
      form: {
        device: "Lab-A",
        experiment_code: "CJ-2026-001-A",
        id: "schedule-1",
        planned_hours: "1.5",
        schedule_date: "2099-03-20",
        task_code: "CJ-2026-001",
        time_slot: "morning",
      },
      now: new Date("2099-03-10T08:00:00.000Z"),
      schedules: [
        {
          id: "schedule-1",
          task_code: "CJ-2026-001",
          experiment_code: "CJ-2026-001-A",
          device: "Lab-A",
          planned_hours: 26.5,
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-21T10:30:00.000Z",
          status: STATUS_SCHEDULED,
        },
      ],
      streams: [],
      tasks: [{ code: "CJ-2026-001", status: STATUS_SCHEDULED, test_type: "UNKNOWN" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.schedules[0].experiment_code).toBe("CJ-2026-001-A");
    expect(result.schedules[0].planned_hours).toBe(1.5);
    expect(formatDateTime(result.schedules[0].end_at)).toContain("2099-03-20 09:30");
  });

  test("buildGanttRows extends the window and emits a continuous segment for cross-day schedules", () => {
    // 超过默认 3 天窗口的长排程必须继续可见，并折叠成连续段。
    const gantt = buildGanttRows({
      devices: [{ code: "Lab-A" }],
      schedules: [
        {
          id: "schedule-1",
          task_code: "CJ-2026-001",
          device: "Lab-A",
          planned_hours: 80,
          start_at: "2099-03-20T08:00:00.000Z",
          end_at: "2099-03-23T16:00:00.000Z",
        },
      ],
      startDate: new Date("2099-03-20T00:00:00.000Z"),
    });

    const labRow = gantt.rows.find((row) => row.device === "Lab-A");

    expect(gantt.days.length).toBeGreaterThanOrEqual(4);
    expect(labRow?.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          colspan: expect.any(Number),
          label: "CJ-2026-001",
          scheduleId: "schedule-1",
          state: "busy",
        }),
      ]),
    );
    expect(labRow?.segments.find((segment) => segment.scheduleId === "schedule-1")?.colspan).toBeGreaterThan(2);
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
