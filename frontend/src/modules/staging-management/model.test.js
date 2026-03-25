import { describe, expect, test } from "vitest";

import {
  applyZancunInventoryAction,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunScanDetail,
  createZancunOverviewRows,
} from "./model";

describe("staging-management model", () => {
  test("builds metrics from overview rows", () => {
    const metrics = buildZancunMetrics(createZancunOverviewRows());

    expect(metrics).toEqual({
      pendingStockInCount: 2,
      pendingStockOutCount: 3,
      totalQuantity: 24,
    });
  });

  test("filters overview rows by query, sample type, and status", () => {
    const view = buildZancunOverviewView({
      filters: {
        query: "王工",
        sampleType: "温度冲击试验",
        status: "待出库",
      },
      rows: createZancunOverviewRows(),
    });

    expect(view.rows.map((row) => row.trayCode)).toEqual(["WDC-2026-008-TP-001"]);
    expect(view.totalCount).toBe(1);
  });

  test("sorts and paginates overview rows", () => {
    const view = buildZancunOverviewView({
      page: 2,
      pageSize: 6,
      rows: createZancunOverviewRows(),
      sort: {
        direction: "desc",
        key: "quantity",
      },
    });

    expect(view.pageCount).toBe(2);
    expect(view.currentPage).toBe(2);
    expect(view.rows.map((row) => row.quantity)).toEqual([1, 1]);
  });

  test("builds scan detail for stock in and stock out actions", () => {
    const stockInDetail = buildZancunScanDetail(createZancunOverviewRows(), "ZD-2026-003-TP-001", "stockIn");
    const stockOutDetail = buildZancunScanDetail(createZancunOverviewRows(), "WDC-2026-008-TP-001", "stockOut");

    expect(stockInDetail.nextStatus).toBe("已入库");
    expect(stockOutDetail.nextStatus).toBe("已出库");
    expect(stockOutDetail.trayCode).toBe("WDC-2026-008-TP-001");
  });

  test("applies inventory actions to the overview rows", () => {
    const stockInResult = applyZancunInventoryAction({
      payload: {
        code: "ZD-2026-003-TP-001",
        mode: "stockIn",
      },
      rows: createZancunOverviewRows(),
    });
    const stockOutResult = applyZancunInventoryAction({
      payload: {
        code: "WDC-2026-008-TP-001",
        mode: "stockOut",
      },
      rows: createZancunOverviewRows(),
    });

    const stockInRow = stockInResult.rows.find((row) => row.trayCode === "ZD-2026-003-TP-001");
    const stockOutRow = stockOutResult.rows.find((row) => row.trayCode === "WDC-2026-008-TP-001");
    const metrics = buildZancunMetrics(stockOutResult.rows);

    expect(stockInRow?.status).toBe("已入库");
    expect(stockOutRow?.status).toBe("已出库");
    expect(stockOutRow?.location).toBe("已完成出库");
    expect(metrics.totalQuantity).toBe(18);
  });
});
