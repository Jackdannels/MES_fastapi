import { describe, expect, test } from "vitest";

import {
  applyRouteFiltersState,
  buildOverviewMetrics,
  buildTrayTaskFilterOptions,
  cycleTaskScheduleFilter,
  filterTaskOverviewRows,
  filterTrayOverviewRows,
} from "./useTaskOverview";

// 这些 helper 测试主要保护任务总览页的筛选口径、顶部计数和路由恢复逻辑。
describe("useTaskOverview helpers", () => {
  test("filters rows by keyword, type, and custom date range", () => {
    const rows = [
      {
        currentStatus: "进行中",
        sampleCodes: ["TASK-001-SP-001"],
        scheduleLabel: "已排程",
        taskCode: "TASK-001",
        taskType: "冲击试验",
        timeValue: "2026-03-08T10:00:00Z",
        trays: [{ trayCode: "TRAY-001" }],
      },
      {
        currentStatus: "已完成",
        sampleCodes: ["TASK-002-SP-001"],
        scheduleLabel: "未排程",
        taskCode: "TASK-002",
        taskType: "振动试验",
        timeValue: "2026-02-10T10:00:00Z",
        trays: [{ trayCode: "TRAY-002" }],
      },
    ];

    const filtered = filterTaskOverviewRows({
      customEndDate: "2026-03-10",
      customStartDate: "2026-03-01",
      keyword: "task-001",
      rows,
      testTypeFilter: "冲击试验",
      timeFilter: "custom",
      now: new Date("2026-03-10T12:00:00Z"),
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].taskCode).toBe("TASK-001");
  });

  test("rejects an inverted custom date range instead of swapping it", () => {
    const rows = [
      {
        currentStatus: "进行中",
        sampleCodes: ["TASK-001-SP-001"],
        scheduleLabel: "已排程",
        taskCode: "TASK-001",
        taskType: "冲击试验",
        timeValue: "2026-03-08T10:00:00Z",
        trays: [{ trayCode: "TRAY-001" }],
      },
    ];

    const filtered = filterTaskOverviewRows({
      customEndDate: "2026-03-01",
      customStartDate: "2026-03-10",
      keyword: "",
      rows,
      testTypeFilter: "",
      timeFilter: "custom",
      now: new Date("2026-03-10T12:00:00Z"),
    });

    expect(filtered).toEqual([]);
  });

  test("filters rows by experiment summary when task type is absent", () => {
    const rows = [
      {
        currentStatus: "待排程",
        experimentSummary: "温度冲击 / 振动 / 盐雾",
        sampleCodes: [],
        scheduleLabel: "未排程",
        taskCode: "TASK-003",
        taskType: "",
        timeValue: "2026-03-08T10:00:00Z",
        trays: [],
      },
    ];

    const filtered = filterTaskOverviewRows({
      customEndDate: "",
      customStartDate: "",
      keyword: "振动",
      rows,
      testTypeFilter: "",
      timeFilter: "all",
      now: new Date("2026-03-10T12:00:00Z"),
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].taskCode).toBe("TASK-003");
  });

  test("filters rows by atomic experiment type when the task summary contains multiple experiment types", () => {
    const rows = [
      {
        currentStatus: "待排程",
        experimentSummary: "盐雾试验 / 冲击试验 / 霉菌试验",
        sampleCodes: [],
        scheduleLabel: "未排程",
        taskCode: "TASK-004",
        taskType: "盐雾试验 / 冲击试验 / 霉菌试验",
        timeValue: "2026-03-08T10:00:00Z",
        trays: [],
      },
      {
        currentStatus: "待排程",
        experimentSummary: "高低温湿热试验 / 四综合试验",
        sampleCodes: [],
        scheduleLabel: "未排程",
        taskCode: "TASK-005",
        taskType: "高低温湿热试验 / 四综合试验",
        timeValue: "2026-03-08T12:00:00Z",
        trays: [],
      },
    ];

    const filtered = filterTaskOverviewRows({
      customEndDate: "",
      customStartDate: "",
      keyword: "",
      rows,
      testTypeFilter: "冲击试验",
      timeFilter: "all",
      now: new Date("2026-03-10T12:00:00Z"),
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].taskCode).toBe("TASK-004");
  });

  test("builds overview metrics for task and tray modes", () => {
    const taskMetrics = buildOverviewMetrics({
      filteredRows: [
        { scheduleCount: 1, scheduledExperimentCount: 2, eligibleExperimentCount: 3 },
        { scheduleCount: 0, scheduledExperimentCount: 0, eligibleExperimentCount: 2 },
      ],
      trayOverviewRows: [],
      trayOverviewTotal: 10,
      viewMode: "task",
    });
    const trayMetrics = buildOverviewMetrics({
      filteredRows: [],
      trayOverviewRows: [
        { hasTray: true, targetExperiment: "冲击试验" },
        { hasTray: true, targetExperiment: "盐雾试验" },
        { hasTray: true, targetExperiment: "振动试验" },
        { hasTray: false, targetExperiment: "未分配" },
      ],
      trayOverviewTotal: 10,
      viewMode: "tray",
    });

    expect(taskMetrics.overviewCounterLabel).toBe("已排程/总任务数");
    expect(taskMetrics.overviewCounterValue).toBe("1/2");
    expect(taskMetrics.experimentCounterLabel).toBe("已排程总实验数");
    expect(taskMetrics.experimentCounterValue).toBe("2/5");
    expect(taskMetrics.isTrayCounterAlert).toBe(false);
    expect(trayMetrics.overviewCounterLabel).toBe("已用托盘/总托盘数");
    expect(trayMetrics.overviewCounterValue).toBe("3/10");
    expect(trayMetrics.experimentCounterLabel).toBe("");
    expect(trayMetrics.experimentCounterValue).toBe("");
    expect(trayMetrics.isTrayCounterAlert).toBe(false);
  });

  test("alerts when the global tray remainder is almost exhausted", () => {
    const trayMetrics = buildOverviewMetrics({
      filteredRows: [],
      trayOverviewRows: Array.from({ length: 9 }, (_, index) => ({
        hasTray: true,
        targetExperiment: `实验${index + 1}`,
      })),
      trayOverviewTotal: 10,
      viewMode: "tray",
    });

    expect(trayMetrics.overviewCounterValue).toBe("9/10");
    expect(trayMetrics.remainingTrayCount).toBe(1);
    expect(trayMetrics.isTrayCounterAlert).toBe(true);
  });

  test("filters rows by schedule filter and cycles task schedule filter states", () => {
    const rows = [
      { scheduleCount: 1, scheduleLabel: "已排程", taskCode: "TASK-001", taskType: "冲击试验", timeValue: "2026-03-08T10:00:00Z" },
      { scheduleCount: 0, scheduleLabel: "未排程", taskCode: "TASK-002", taskType: "振动试验", timeValue: "2026-03-08T10:00:00Z" },
    ];

    expect(cycleTaskScheduleFilter("all")).toBe("scheduled");
    expect(cycleTaskScheduleFilter("scheduled")).toBe("unscheduled");
    expect(cycleTaskScheduleFilter("unscheduled")).toBe("all");
    expect(filterTaskOverviewRows({
      customEndDate: "",
      customStartDate: "",
      keyword: "",
      rows,
      scheduleFilter: "scheduled",
      testTypeFilter: "",
      timeFilter: "all",
      now: new Date("2026-03-10T12:00:00Z"),
    }).map((row) => row.taskCode)).toEqual(["TASK-001"]);
    expect(filterTaskOverviewRows({
      customEndDate: "",
      customStartDate: "",
      keyword: "",
      rows,
      scheduleFilter: "unscheduled",
      testTypeFilter: "",
      timeFilter: "all",
      now: new Date("2026-03-10T12:00:00Z"),
    }).map((row) => row.taskCode)).toEqual(["TASK-002"]);
  });

  test("filters tray rows by keyword, experiment type, and selected task", () => {
    const rows = [
      {
        slotCode: "01",
        trayCode: "SYLU-2026-03-101-TP-001",
        taskCode: "SYLU-2026-03-101",
        targetExperiment: "盐雾试验",
        currentLocation: "接驳区",
        currentStatus: "未入库",
      },
      {
        slotCode: "02",
        trayCode: "SYLU-2026-03-102-TP-001",
        taskCode: "SYLU-2026-03-102",
        targetExperiment: "冲击试验",
        currentLocation: "冲击一室",
        currentStatus: "实验进行中",
      },
      {
        slotCode: "03",
        trayCode: "空托盘位",
        taskCode: "-",
        targetExperiment: "未分配",
        currentLocation: "-",
        currentStatus: "空闲",
      },
    ];

    expect(filterTrayOverviewRows({
      keyword: "tp-001",
      rows,
      taskFilter: "SYLU-2026-03-101",
      testTypeFilter: "盐雾试验",
    }).map((row) => row.taskCode)).toEqual(["SYLU-2026-03-101"]);
    expect(filterTrayOverviewRows({
      keyword: "冲击一室",
      rows,
      taskFilter: "",
      testTypeFilter: "",
    }).map((row) => row.taskCode)).toEqual(["SYLU-2026-03-102"]);
  });

  test("builds tray task filter options from occupied task rows only", () => {
    expect(buildTrayTaskFilterOptions([
      { taskCode: "SYLU-2026-03-102" },
      { taskCode: "-" },
      { taskCode: "SYLU-2026-03-101" },
      { taskCode: "SYLU-2026-03-102" },
    ])).toEqual(["SYLU-2026-03-101", "SYLU-2026-03-102"]);
  });

  test("applies route filters without dropping existing values", () => {
    // 路由 query 既可以切换视图，也可以覆盖当前选中任务和试验类型。
    const nextState = applyRouteFiltersState({
      routeQuery: {
        task: "TASK-002",
        testType: "振动试验",
      },
      selectedTaskCode: "TASK-001",
      testTypeFilter: "",
      viewMode: "tray",
    });

    expect(nextState.viewMode).toBe("task");
    expect(nextState.testTypeFilter).toBe("振动试验");
    expect(nextState.selectedTaskCode).toBe("TASK-002");
  });
});
