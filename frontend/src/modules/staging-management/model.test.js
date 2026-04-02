import { describe, expect, test } from "vitest";

import {
  applyZancunInventoryAction,
  buildZancunRowsFromSnapshot,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunScanDetail,
} from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";

const TODAY = "2026-04-01T12:00:00";

const createSnapshot = () => ({
  [STORAGE_KEYS.tasks]: [
    { id: "task-101", code: "SYLU-2026-04-101", test_type: "温度冲击试验", sample_type: "结构件", source: "外部委托" },
    { id: "task-102", code: "SYLU-2026-04-102", test_type: "振动试验", sample_type: "组件", source: "内部新增" },
    { id: "task-103", code: "SYLU-2026-04-103", test_type: "盐雾试验", sample_type: "整机", source: "外部委托" },
    { id: "task-104", code: "SYLU-2026-04-104", test_type: "冲击试验", sample_type: "组件", source: "内部新增" },
    { id: "task-105", code: "SYLU-2026-04-105", test_type: "霉菌试验", sample_type: "粉末", source: "内部新增" },
    { id: "task-106", code: "SYLU-2026-04-106", test_type: "高低温湿热试验", sample_type: "线缆", source: "外部委托" },
  ],
  [STORAGE_KEYS.samples]: [
    {
      id: "sample-101",
      code: "SYLU-2026-04-101-SP-001",
      task_code: "SYLU-2026-04-101",
      owner: "王工",
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      trays: [{ tray_code: "SYLU-2026-04-101-TP-001", status: "送至暂存间", quantity: 2 }],
    },
    {
      id: "sample-102",
      code: "SYLU-2026-04-102-SP-001",
      task_code: "SYLU-2026-04-102",
      owner: "李工",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      trays: [{ tray_code: "SYLU-2026-04-102-TP-001", status: "已到达暂存间", quantity: 1 }],
    },
    {
      id: "sample-103",
      code: "SYLU-2026-04-103-SP-001",
      task_code: "SYLU-2026-04-103",
      owner: "周工",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      trays: [{ tray_code: "SYLU-2026-04-103-TP-001", status: "已到达暂存间", quantity: 3 }],
    },
    {
      id: "sample-104",
      code: "SYLU-2026-04-104-SP-001",
      task_code: "SYLU-2026-04-104",
      owner: "赵工",
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      trays: [{ tray_code: "SYLU-2026-04-104-TP-001", status: "送至暂存间", quantity: 1 }],
    },
    {
      id: "sample-105",
      code: "SYLU-2026-04-105-SP-001",
      task_code: "SYLU-2026-04-105",
      owner: "韩工",
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      trays: [{ tray_code: "SYLU-2026-04-105-TP-001", status: "送至暂存间", quantity: 1 }],
    },
    {
      id: "sample-106",
      code: "SYLU-2026-04-106-SP-001",
      task_code: "SYLU-2026-04-106",
      owner: "陈工",
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      trays: [{ tray_code: "SYLU-2026-04-106-TP-001", status: "送至暂存间", quantity: 1 }],
    },
  ],
  [STORAGE_KEYS.staging_events]: [
    {
      id: "evt-102-in",
      tray_code: "SYLU-2026-04-102-TP-001",
      task_code: "SYLU-2026-04-102",
      action: "stock_in",
      time: "2026-04-01T08:30:00",
      operator: "暂存员A",
    },
    {
      id: "evt-103-in",
      tray_code: "SYLU-2026-04-103-TP-001",
      task_code: "SYLU-2026-04-103",
      action: "stock_in",
      time: "2026-03-31T17:40:00",
      operator: "暂存员A",
    },
    {
      id: "evt-103-out",
      tray_code: "SYLU-2026-04-103-TP-001",
      task_code: "SYLU-2026-04-103",
      action: "stock_out",
      time: "2026-04-01T10:10:00",
      operator: "暂存员B",
    },
  ],
});

describe("staging-management model", () => {
  test("builds staging rows from the real snapshot and keeps the latest SYLU task codes", () => {
    const rows = buildZancunRowsFromSnapshot(createSnapshot(), { now: TODAY });
    const waitingRow = rows.find((row) => row.trayCode === "SYLU-2026-04-101-TP-001");
    const stockedInRow = rows.find((row) => row.trayCode === "SYLU-2026-04-102-TP-001");
    const stockedOutRow = rows.find((row) => row.trayCode === "SYLU-2026-04-103-TP-001");

    expect(waitingRow).toMatchObject({
      taskCode: "SYLU-2026-04-101",
      status: "待入库",
      quantity: 2,
    });
    expect(stockedInRow).toMatchObject({
      taskCode: "SYLU-2026-04-102",
      status: "已入库",
    });
    expect(stockedOutRow).toMatchObject({
      taskCode: "SYLU-2026-04-103",
      status: "已出库",
    });
  });

  test("builds metrics from tray rows and staging events", () => {
    const rows = buildZancunRowsFromSnapshot(createSnapshot(), { now: TODAY });
    const metrics = buildZancunMetrics({
      now: TODAY,
      rows,
      stagingEvents: createSnapshot()[STORAGE_KEYS.staging_events],
    });

    expect(metrics).toEqual({
      stockedInTodayCount: 1,
      stockedOutTodayCount: 1,
      totalQuantity: 6,
    });
  });

  test("filters overview rows by metric mode and paginates in 5-row viewports", () => {
    const rows = buildZancunRowsFromSnapshot(createSnapshot(), { now: TODAY });
    const view = buildZancunOverviewView({
      filters: {
        metricMode: "stockedOutToday",
      },
      now: TODAY,
      page: 1,
      pageSize: 5,
      rows,
      stagingEvents: createSnapshot()[STORAGE_KEYS.staging_events],
    });

    expect(view.rows.map((row) => row.trayCode)).toEqual(["SYLU-2026-04-103-TP-001"]);
    expect(view.totalCount).toBe(1);

    const pagedView = buildZancunOverviewView({
      filters: {
        metricMode: "all",
      },
      now: TODAY,
      page: 2,
      pageSize: 5,
      rows,
      stagingEvents: createSnapshot()[STORAGE_KEYS.staging_events],
      sort: {
        direction: "asc",
        key: "trayCode",
      },
    });

    expect(pagedView.pageCount).toBe(2);
    expect(pagedView.currentPage).toBe(2);
    expect(pagedView.rows).toHaveLength(1);
  });

  test("builds scan detail for stock in and stock out actions", () => {
    const rows = buildZancunRowsFromSnapshot(createSnapshot(), { now: TODAY });
    const stockInDetail = buildZancunScanDetail(rows, "SYLU-2026-04-101-TP-001", "stockIn");
    const stockOutDetail = buildZancunScanDetail(rows, "SYLU-2026-04-102-TP-001", "stockOut");

    expect(stockInDetail.nextStatus).toBe("已入库");
    expect(stockOutDetail.nextStatus).toBe("已出库");
    expect(stockOutDetail.trayCode).toBe("SYLU-2026-04-102-TP-001");
  });

  test("applies inventory actions by appending staging events instead of mutating static rows", () => {
    const stockInResult = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-101-TP-001",
        mode: "stockIn",
      },
      snapshot: createSnapshot(),
    });
    const stockOutResult = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-102-TP-001",
        mode: "stockOut",
      },
      snapshot: createSnapshot(),
    });

    const stockInRows = buildZancunRowsFromSnapshot(stockInResult.snapshot, { now: TODAY });
    const stockOutRows = buildZancunRowsFromSnapshot(stockOutResult.snapshot, { now: TODAY });
    const stockInRow = stockInRows.find((row) => row.trayCode === "SYLU-2026-04-101-TP-001");
    const stockOutRow = stockOutRows.find((row) => row.trayCode === "SYLU-2026-04-102-TP-001");
    const metrics = buildZancunMetrics({
      now: TODAY,
      rows: stockOutRows,
      stagingEvents: stockOutResult.snapshot[STORAGE_KEYS.staging_events],
    });

    expect(stockInRow?.status).toBe("已入库");
    expect(stockOutRow?.status).toBe("已出库");
    expect(stockOutRow?.location).toBe("已完成出库");
    expect(stockInResult.snapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      tray_code: "SYLU-2026-04-101-TP-001",
      action: "stock_in",
    });
    expect(stockOutResult.snapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      tray_code: "SYLU-2026-04-102-TP-001",
      action: "stock_out",
    });
    expect(metrics.stockedOutTodayCount).toBe(2);
  });
});
