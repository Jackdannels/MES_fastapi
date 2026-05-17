import { afterEach, describe, expect, test, vi } from "vitest";

import {
  buildFilterOptions,
  buildTaskCode,
  buildTaskEditForm,
  buildTaskMetrics,
  buildTaskRows,
  createTaskIntakeForm,
  createTaskRecord,
  updateTaskRecord,
  validateTaskSampleCount,
} from "./model";

describe("tasks model", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("orders task rows by task code ascending by default", () => {
    const rows = buildTaskRows(
      [
        { id: "task-3", code: "SYLU-2026-03-003", name: "任务三", status: "待排程" },
        { id: "task-1", code: "SYLU-2026-03-001", name: "任务一", status: "待排程" },
        { id: "task-2", code: "SYLU-2026-03-002", name: "任务二", status: "待排程" },
      ],
      [],
    );

    expect(rows.map((row) => row.code)).toEqual([
      "SYLU-2026-03-001",
      "SYLU-2026-03-002",
      "SYLU-2026-03-003",
    ]);
  });

  test("marks a task as running when any tray is sent to the lab", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "SYLU-2026-03-001", name: "冲击试验", status: "待排程" }],
      [{ id: "schedule-1", task_code: "SYLU-2026-03-001", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" }],
      [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          status: "送至实验室",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "送至实验室", quantity: 1 }],
        },
      ],
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        code: "SYLU-2026-03-001",
        displayStatus: "已排程",
      }),
    );
  });

  test("keeps a task scheduled when trays are only in fixture installation", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "SYLU-2026-03-001", name: "冲击试验", status: "待排程" }],
      [{ id: "schedule-1", task_code: "SYLU-2026-03-001", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" }],
      [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          status: "工装夹具安装",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "工装夹具安装", quantity: 1 }],
        },
      ],
    );

    expect(rows[0].displayStatus).toBe("已排程");
  });

  test("marks a task as running when any tray enters in-progress status", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "SYLU-2026-03-001", name: "冲击试验", status: "待排程" }],
      [],
      [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          status: "实验进行中",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "实验进行中", quantity: 1 }],
        },
      ],
    );

    expect(rows[0].displayStatus).toBe("任务进行中");
  });

  test("keeps a partially completed task running and annotates the completed experiment count", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "SYLU-2026-03-001", name: "冲击试验", status: "待排程" }],
      [{ id: "schedule-1", task_code: "SYLU-2026-03-001", device: "冲击一室", start_at: "2099-03-20T08:00:00.000Z", end_at: "2099-03-20T10:00:00.000Z" }],
      [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "实验已完成", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-001-SP-002",
          task_code: "SYLU-2026-03-001",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "实验准备就绪", quantity: 1 }],
        },
      ],
      [
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", experiment_name: "冲击试验A", status: "实验已经完成" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-B", experiment_name: "冲击试验B", status: "待排程" },
      ],
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        displayStatus: "任务进行中",
        displayStatusLabel: "任务进行中（已完成1个实验）",
      }),
    );
  });

  test("marks a task completed only when all trays are in complete or post-complete states", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "SYLU-2026-03-001", name: "冲击试验", status: "待排程" }],
      [],
      [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "实验已完成", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-001-SP-002",
          task_code: "SYLU-2026-03-001",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "厂家收回", quantity: 1 }],
        },
      ],
    );

    expect(rows[0].displayStatus).toBe("任务已完成");
  });

  test("hides a task from active intake rows when all trays are returned to the manufacturer", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "SYLU-2026-03-001", name: "冲击试验", status: "实验已经完成" }],
      [],
      [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "厂家收回", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-001-SP-002",
          task_code: "SYLU-2026-03-001",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "厂家收回", quantity: 1 }],
        },
      ],
    );

    expect(rows).toEqual([]);
  });

  test("keeps a task waiting when trays are only staged in the temporary room before experiment", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "SYLU-2026-03-001", name: "冲击试验", status: "待排程" }],
      [],
      [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          status: "已到达暂存间",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "已到达暂存间", quantity: 1 }],
        },
      ],
    );

    expect(rows[0].displayStatus).toBe("待排程");
  });

  test("keeps a formally scheduled task scheduled when its trays are temporarily staged", () => {
    const rows = buildTaskRows(
      [{ id: "task-1", code: "SYLU-2026-05-023", name: "盐雾试验", status: "待排程" }],
      [
        {
          id: "schedule-lab-1",
          task_code: "SYLU-2026-05-023",
          experiment_code: "SYLU-2026-05-023-A",
          device: "盐雾试验室",
          start_at: "2026-05-13T09:00:00.000Z",
          end_at: "2026-05-13T11:00:00.000Z",
        },
      ],
      [
        {
          code: "SYLU-2026-05-023-SP-001",
          task_code: "SYLU-2026-05-023",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [{ tray_code: "SYLU-2026-05-023-TP-001", status: "已到达暂存间", quantity: 1 }],
        },
      ],
    );

    expect(rows[0]).toEqual(expect.objectContaining({
      code: "SYLU-2026-05-023",
      displayStatus: "已排程",
    }));
  });

  test("ignores legacy temporary staging schedule records instead of marking the task scheduled", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "SYLU-2026-04-105",
          name: "高低温湿热试验",
          source: "外部委托",
          status: "待排程",
          test_type: "高低温湿热试验",
        },
      ],
      [
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-04-105",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-03-11T09:31:00.000Z",
          end_at: "2026-03-17T09:31:00.000Z",
          status: "暂存间存放",
        },
      ],
      Date.parse("2026-03-17T10:00:00.000Z"),
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        code: "SYLU-2026-04-105",
        displayStatus: "待排程",
      }),
    );

    expect(buildTaskMetrics(rows)).toEqual(
      expect.objectContaining({
        retentionCount: 0,
        unscheduledCount: 1,
        unscheduledLabel: 1,
      }),
    );
  });

  test("ignores stale legacy temporary staging schedule status values", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "SYLU-2026-04-107",
          name: "温度冲击试验",
          source: "外部委托",
          status: "待排程",
          test_type: "温度冲击试验",
        },
      ],
      [
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-04-107",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-03-11T06:45:13.827Z",
          end_at: "2026-03-11T06:45:13.827Z",
          status: "已排程",
        },
      ],
      Date.parse("2026-03-17T10:00:00.000Z"),
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        code: "SYLU-2026-04-107",
        displayStatus: "待排程",
      }),
    );

    expect(buildTaskMetrics(rows)).toEqual(
      expect.objectContaining({
        retentionCount: 0,
        unscheduledCount: 1,
        unscheduledLabel: 1,
      }),
    );
  });

  test("createTaskRecord leaves arrival_at empty until samples are confirmed into storage", () => {
    const task = createTaskRecord(
      {
        code: "SYLU-2026-03-001",
        name: "冲击试验-批次A",
        source: "内部新增",
        sample_count: "2",
        sample_type: "结构件",
        test_type: "冲击试验",
        required_device: "冲击试验",
        arrival_at: "2026-03-18T12:30",
      },
      [],
    );

    expect(task.arrival_at).toBe("");
  });

  test("createTaskIntakeForm starts with an empty experiment type array", () => {
    expect(createTaskIntakeForm()).toEqual(
      expect.objectContaining({
        test_type: "",
        test_types: [],
      }),
    );
  });

  test("validateTaskSampleCount requires an integer from 1 to 99", () => {
    expect(validateTaskSampleCount("")).toBe("请填写样品数量");
    expect(validateTaskSampleCount("1.5")).toBe("样品数量必须为整数");
    expect(validateTaskSampleCount("0")).toBe("样品数量至少为 1");
    expect(validateTaskSampleCount("-1")).toBe("样品数量至少为 1");
    expect(validateTaskSampleCount("100")).toBe("样品数量最多为 99");
    expect(validateTaskSampleCount("1")).toBe("");
    expect(validateTaskSampleCount("3")).toBe("");
  });

  test("createTaskRecord derives test_type from the selected experiment array in order", () => {
    const task = createTaskRecord(
      {
        code: "SYLU-2026-03-001",
        name: "多实验任务",
        source: "内部新增",
        sample_count: "2",
        sample_type: "结构件",
        test_type: "",
        test_types: ["冲击试验", "盐雾试验", "温度冲击试验"],
      },
      [],
    );

    expect(task).toEqual(
      expect.objectContaining({
        test_type: "冲击试验 / 盐雾试验 / 温度冲击试验",
        required_device: "冲击试验 / 盐雾试验 / 温度冲击试验",
      }),
    );
  });

  test("updateTaskRecord derives test_type from the edited experiment array in order", () => {
    const result = updateTaskRecord(
      [
        {
          id: "task-1",
          code: "SYLU-2026-03-001",
          name: "旧任务",
          status: "待排程",
          sample_count: "2",
          sample_type: "结构件",
          test_type: "冲击试验",
          test_types: ["冲击试验"],
          required_device: "冲击试验",
        },
      ],
      {
        id: "task-1",
        code: "SYLU-2026-03-001",
        name: "旧任务",
        priority: "高",
        sample_count: "2",
        sample_type: "结构件",
        source: "内部新增",
        status: "待排程",
        test_type: "冲击试验",
        test_types: ["盐雾试验", "霉菌试验"],
      },
    );

    expect(result.tasks[0]).toEqual(
      expect.objectContaining({
        required_device: "盐雾试验 / 霉菌试验",
        test_type: "盐雾试验 / 霉菌试验",
        test_types: ["盐雾试验", "霉菌试验"],
      }),
    );
  });

  test("updateTaskRecord keeps experiment types when only the task name changes", () => {
    const result = updateTaskRecord(
      [
        {
          id: "task-1",
          code: "SYLU-2026-03-001",
          name: "旧任务",
          status: "待排程",
          sample_count: "2",
          test_type: "盐雾试验",
          test_types: ["盐雾试验"],
          required_device: "盐雾试验",
        },
      ],
      {
        id: "task-1",
        code: "SYLU-2026-03-001",
        name: "只改任务名称",
        priority: "高",
        sample_count: "2",
        source: "外部委托",
        status: "待排程",
        test_type: "盐雾试验",
        test_types: ["盐雾试验"],
      },
    );

    expect(result.tasks[0]).toEqual(
      expect.objectContaining({
        name: "只改任务名称",
        required_device: "盐雾试验",
        test_type: "盐雾试验",
        test_types: ["盐雾试验"],
      }),
    );
  });

  test("updateTaskRecord preserves stored arrival_at instead of taking manual form input", () => {
    const result = updateTaskRecord(
      [
        {
          id: "task-1",
          code: "SYLU-2026-03-001",
          name: "冲击试验-批次A",
          arrival_at: "2026-03-18 08:00",
          status: "待排程",
        },
      ],
      {
        id: "task-1",
        code: "SYLU-2026-03-001",
        name: "冲击试验-批次B",
        arrival_at: "2026-03-18T13:45",
        status: "待排程",
      },
    );

    expect(result.tasks[0].arrival_at).toBe("2026-03-18 08:00");
  });

  test("buildTaskRows and buildTaskEditForm preserve second precision for arrival time", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "SYLU-2026-03-001",
          name: "冲击试验-批次A",
          arrival_at: "2026-03-18 09:14:45",
          status: "待排程",
        },
      ],
      [],
    );

    expect(rows[0].arrivalAt).toBe("2026-03-18 09:14:45");
    expect(buildTaskEditForm(rows[0]).arrival_at).toBe("2026-03-18T09:14:45");
  });

  test("buildTaskRows summarizes all experiment types for a task", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "SYLU-2026-03-001",
          name: "三实验任务",
          status: "待排程",
          sample_count: 6,
          test_type: "温度冲击",
        },
      ],
      [],
      [],
      [
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", experiment_type: "温度冲击" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-B", experiment_type: "振动" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-C", experiment_type: "盐雾" },
      ],
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        experimentCount: 3,
        experimentSummary: "温度冲击 / 振动 / 盐雾",
        testType: "温度冲击 / 振动 / 盐雾",
      }),
    );
  });

  test("buildTaskRows does not mix experiment names into the experiment type summary", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "SYLU-2026-03-001",
          name: "演示任务001",
          status: "待排程",
          sample_count: 6,
          test_type: "盐雾试验",
        },
      ],
      [],
      [],
      [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          experiment_name: "演示任务001-A",
        },
      ],
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        experimentSummary: "盐雾试验",
        testType: "盐雾试验",
      }),
    );
  });

  test("buildTaskRows removes duplicate experiment types from legacy task summaries", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "SYLU-2026-03-001",
          name: "重复实验任务",
          status: "待排程",
          sample_count: 6,
          test_type: "冲击试验 / 盐雾试验 / 冲击试验",
        },
      ],
      [],
      [],
      [],
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        experimentCount: 2,
        experimentSummary: "冲击试验 / 盐雾试验",
        testType: "冲击试验 / 盐雾试验",
      }),
    );
  });

  test("buildFilterOptions exposes only atomic experiment types sorted without combined summaries", () => {
    const options = buildFilterOptions([
      {
        testType: "冲击试验 / 盐雾试验 / 冲击试验",
      },
      {
        testType: "高低温湿热试验 / 霉菌试验",
      },
    ]);

    expect(options.testTypeOptions).toEqual([
      "冲击试验",
      "高低温湿热试验",
      "霉菌试验",
      "盐雾试验",
    ]);
    expect(options.testTypeOptions).not.toContain("冲击试验 / 盐雾试验 / 冲击试验");
    expect(options.testTypeOptions).not.toContain("高低温湿热试验 / 霉菌试验");
  });

  test("buildTaskCode generates the next monthly SYLU sequence", () => {
    expect(
      buildTaskCode(
        "冲击试验",
        [
          { code: "SYLU-2026-03-001" },
          { code: "SYLU-2026-03-003" },
          { code: "SYLU-2026-02-007" },
        ],
        "2026-03-27T09:15:00",
      ),
    ).toBe("SYLU-2026-03-004");
  });

  test("buildTaskCode counts returned archived task codes when generating the next sequence", () => {
    expect(
      buildTaskCode(
        "振动试验",
        [
          { code: "SYLU-2026-05-001", status: "厂家收回", transfer_status: "厂家收回" },
          { code: "SYLU-2026-05-002", status: "待排程" },
        ],
        "2026-05-13T09:15:00",
      ),
    ).toBe("SYLU-2026-05-003");
  });

  test("createTaskRecord auto-generates a SYLU code when the form code is empty", () => {
    const task = createTaskRecord(
      {
        code: "",
        name: "冲击试验-批次A",
        source: "内部新增",
        sample_count: "2",
        sample_type: "结构件",
        test_type: "冲击试验",
        due_at: "2026-03-18T12:30",
      },
      [
        { code: "SYLU-2026-03-001" },
        { code: "SYLU-2026-03-002" },
      ],
    );

    expect(task.code).toBe("SYLU-2026-03-003");
  });

  test("createTaskRecord defaults an empty due_at to Beijing creation time plus 72 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T03:30:00.000Z"));

    const task = createTaskRecord(
      {
        code: "SYLU-2026-04-001",
        name: "无期望完成时间任务",
        source: "内部新增",
        sample_count: "2",
        sample_type: "结构件",
        test_type: "",
        test_types: ["盐雾试验"],
        due_at: "",
      },
      [],
    );

    expect(task.due_at).toBe("2026-04-25 11:30");
  });
});


