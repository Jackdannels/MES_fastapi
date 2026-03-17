import { describe, expect, test } from "vitest";

import { applyRouteFiltersState, buildOverviewMetrics, filterTaskOverviewRows } from "./useTaskOverview";

// 这些 helper 测试主要保护任务总览页的筛选口径、顶部计数和路由恢复逻辑。
describe("useTaskOverview helpers", () => {
  test("filters rows by keyword, type, and custom date range", () => {
    // 自定义日期区间允许开始和结束倒置，过滤逻辑仍应正确命中任务。
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
      customEndDate: "2026-03-01",
      customStartDate: "2026-03-10",
      keyword: "task-001",
      rows,
      testTypeFilter: "冲击试验",
      timeFilter: "custom",
      now: new Date("2026-03-10T12:00:00Z"),
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].taskCode).toBe("TASK-001");
  });

  test("builds overview metrics for task and tray modes", () => {
    const taskMetrics = buildOverviewMetrics({
      filteredRows: [{ scheduleCount: 1 }, { scheduleCount: 0 }],
      trayOverviewRows: [],
      trayOverviewTotal: 10,
      viewMode: "task",
    });
    const trayMetrics = buildOverviewMetrics({
      filteredRows: [],
      trayOverviewRows: [{ targetExperiment: "未分配" }, { targetExperiment: "冲击试验" }],
      trayOverviewTotal: 2,
      viewMode: "tray",
    });

    expect(taskMetrics.overviewCounterValue).toBe("1/2");
    expect(taskMetrics.isTrayCounterAlert).toBe(false);
    expect(trayMetrics.overviewCounterLabel).toBe("剩余托盘/总托盘数");
    expect(trayMetrics.overviewCounterValue).toBe("1/2");
    expect(trayMetrics.isTrayCounterAlert).toBe(true);
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
