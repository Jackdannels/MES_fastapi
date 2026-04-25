import { describe, expect, test } from "vitest";

import {
  applyZancunInventoryAction,
  buildZancunInventorySections,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunRowsFromSnapshot,
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
  [STORAGE_KEYS.experiments]: [
    { id: "exp-102-a", task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", experiment_name: "振动试验", required_device: "振动一室" },
    { id: "exp-102-b", task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-B", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
  ],
  [STORAGE_KEYS.experiment_trays]: [
    { id: "rel-102-a", task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", tray_code: "SYLU-2026-04-102-TP-001" },
    { id: "rel-102-b", task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-B", tray_code: "SYLU-2026-04-102-TP-001" },
  ],
  [STORAGE_KEYS.schedules]: [
    {
      id: "schedule-102-staging",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-A",
      experiment_name: "振动试验",
      device: "恒温恒湿间（暂存间）",
      start_at: "2026-04-01T06:00:00",
      end_at: "2026-04-01T07:00:00",
    },
    {
      id: "schedule-102-lab",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-A",
      experiment_name: "振动试验",
      device: "振动一室",
      start_at: "2026-04-01T13:00:00",
      end_at: "2026-04-01T16:00:00",
    },
    {
      id: "schedule-102-next-lab",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-B",
      experiment_name: "盐雾试验",
      device: "盐雾试验室",
      start_at: "2026-04-02T09:00:00",
      end_at: "2026-04-02T12:00:00",
    },
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
      totalQuantity: 1,
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
    expect(stockOutDetail.targetLab).toBe("振动一室");
  });

  test("splits planned inbound and actual staging trays into separate sections", () => {
    const rows = buildZancunRowsFromSnapshot(createSnapshot(), { now: TODAY });
    const sections = buildZancunInventorySections(rows);

    expect(sections.plannedInboundRows.map((row) => row.trayCode)).toContain("SYLU-2026-04-101-TP-001");
    expect(sections.plannedInboundRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-04-102-TP-001");
    expect(sections.currentStagingRows.map((row) => row.trayCode)).toContain("SYLU-2026-04-102-TP-001");
    expect(sections.currentStagingRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-04-101-TP-001");
  });

  test("stock-out detail resolves the next formal lab and excludes staging destinations", () => {
    const rows = buildZancunRowsFromSnapshot(createSnapshot(), { now: TODAY });
    const detail = buildZancunScanDetail(rows, "SYLU-2026-04-102-TP-001", "stockOut");

    expect(detail.targetLab).toBe("振动一室");
    expect(detail.targetLab).not.toContain("暂存间");
    expect(detail.targetExperimentName).toBe("振动试验");
  });

  test("marks unscheduled fallback destinations as unavailable stock-out targets", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.schedules] = snapshot[STORAGE_KEYS.schedules].filter(
      (schedule) => schedule.experiment_code !== "SYLU-2026-04-102-A" || schedule.device.includes("暂存间"),
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const detail = buildZancunScanDetail(rows, "SYLU-2026-04-102-TP-001", "stockOut");
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-102-TP-001",
        mode: "stockOut",
        targetLab: detail.targetLab,
      },
      snapshot,
    });

    expect(detail).toEqual(
      expect.objectContaining({
        targetLab: "振动一室",
        targetUnavailableReason: "当前实验未排程，仅作为托底目标，暂不可出库。",
        targetIsFallback: true,
      }),
    );
    expect(result.error).toBe("当前实验未排程，仅作为托底目标，暂不可出库。");
  });

  test("treats experiment-completed trays as valid staging stock-in candidates", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-107",
      code: "SYLU-2026-04-107-SP-001",
      task_code: "SYLU-2026-04-103",
      owner: "周工",
      location: "盐雾试验室",
      status: "实验已完成",
      trays: [{ tray_code: "SYLU-2026-04-107-TP-001", status: "实验已完成", quantity: 1 }],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const completedRow = rows.find((row) => row.trayCode === "SYLU-2026-04-107-TP-001");
    const detail = buildZancunScanDetail(rows, "SYLU-2026-04-107-TP-001", "stockIn");

    expect(completedRow).toMatchObject({
      trayCode: "SYLU-2026-04-107-TP-001",
      status: "待入库",
      location: "盐雾试验室",
    });
    expect(detail.found).toBe(true);
    expect(detail.nextStatus).toBe("已入库");
  });

  test("moves trays back to planned inbound after lab completion even when the last staging event was stock-out", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-108",
      code: "SYLU-2026-04-108-SP-001",
      task_code: "SYLU-2026-04-103",
      owner: "周工",
      location: "盐雾试验室",
      status: "实验已完成",
      trays: [{ tray_code: "SYLU-2026-04-108-TP-001", status: "实验已完成", quantity: 1 }],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-108-out",
      tray_code: "SYLU-2026-04-108-TP-001",
      task_code: "SYLU-2026-04-103",
      action: "stock_out",
      time: "2026-04-01T09:10:00",
      operator: "暂存员B",
      target_lab: "盐雾试验室",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const sections = buildZancunInventorySections(rows);
    const completedRow = rows.find((row) => row.trayCode === "SYLU-2026-04-108-TP-001");

    expect(completedRow).toMatchObject({
      trayCode: "SYLU-2026-04-108-TP-001",
      status: "待入库",
      location: "盐雾试验室",
    });
    expect(sections.plannedInboundRows.map((row) => row.trayCode)).toContain("SYLU-2026-04-108-TP-001");
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
        targetLab: "振动一室",
      },
      snapshot: createSnapshot(),
    });

    const stockInRows = buildZancunRowsFromSnapshot(stockInResult.snapshot, { now: TODAY });
    const stockOutRows = buildZancunRowsFromSnapshot(stockOutResult.snapshot, { now: TODAY });
    const stockInRow = stockInRows.find((row) => row.trayCode === "SYLU-2026-04-101-TP-001");
    const stockOutRow = stockOutRows.find((row) => row.trayCode === "SYLU-2026-04-102-TP-001");
    const stockOutSample = stockOutResult.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === "SYLU-2026-04-102-SP-001");
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
      target_lab: "振动一室",
    });
    expect(stockOutSample).toMatchObject({
      location: "振动一室",
      status: "送至实验室",
      flow_status: "送至实验室",
    });
    expect(metrics.stockedOutTodayCount).toBe(2);
  });

  test("requires a selected target lab before stock-out writes an event", () => {
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-102-TP-001",
        mode: "stockOut",
      },
      snapshot: createSnapshot(),
    });

    expect(result.error).toBe("请选择目标实验室后再出库。");
    expect(result.snapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_out")).toHaveLength(1);
  });

  test("manufacturer return writes returned status even when mapped experiments remain unfinished", () => {
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-102-TP-001",
        mode: "manufacturerReturn",
      },
      snapshot: createSnapshot(),
    });

    const updatedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === "SYLU-2026-04-102-SP-001");

    expect(result.error).toBe("");
    expect(result.snapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "manufacturer_return",
      target_lab: "厂家收回",
      tray_code: "SYLU-2026-04-102-TP-001",
    });
    expect(updatedSample).toMatchObject({
      location: "厂家收回",
      status: "厂家收回",
      flow_status: "厂家收回",
    });
  });

  test("syncs fully completed tray samples into post-experiment staging on stock-in", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-103-a",
      task_code: "SYLU-2026-04-103",
      experiment_code: "SYLU-2026-04-103-A",
      experiment_name: "盐雾试验",
      required_device: "盐雾试验室",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-103-b",
      task_code: "SYLU-2026-04-103",
      experiment_code: "SYLU-2026-04-103-B",
      experiment_name: "四综合试验",
      required_device: "四综合试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-103-a",
      task_code: "SYLU-2026-04-103",
      experiment_code: "SYLU-2026-04-103-A",
      tray_code: "SYLU-2026-04-107-TP-001",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-103-b",
      task_code: "SYLU-2026-04-103",
      experiment_code: "SYLU-2026-04-103-B",
      tray_code: "SYLU-2026-04-107-TP-001",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-107",
      code: "SYLU-2026-04-107-SP-001",
      task_code: "SYLU-2026-04-103",
      owner: "周工",
      location: "盐雾试验室",
      status: "实验已完成",
      trays: [{ tray_code: "SYLU-2026-04-107-TP-001", status: "实验已完成", quantity: 1 }],
      history: [
        { detail: "SYLU-2026-04-103 / 盐雾试验 / 实验已完成", time: "2026-04-01T09:30:00" },
        { detail: "SYLU-2026-04-103 / 四综合试验 / 实验已完成", time: "2026-04-01T10:30:00" },
      ],
    });

    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-107-TP-001",
        mode: "stockIn",
      },
      snapshot,
    });

    const updatedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === "SYLU-2026-04-107-SP-001");

    expect(result.error).toBe("");
    expect(updatedSample).toMatchObject({
      location: "恒温恒湿间（暂存间）",
      status: "放置实验后暂存间",
      flow_status: "放置实验后暂存间",
    });
    expect(updatedSample?.trays).toContainEqual(
      expect.objectContaining({
        tray_code: "SYLU-2026-04-107-TP-001",
        status: "放置实验后暂存间",
      }),
    );

    const updatedRows = buildZancunRowsFromSnapshot(result.snapshot, { now: TODAY });
    const updatedSections = buildZancunInventorySections(updatedRows);
    const updatedRow = updatedRows.find((row) => row.trayCode === "SYLU-2026-04-107-TP-001");
    expect(updatedRow?.status).toBe("放置实验后暂存间");
    expect(updatedSections.currentStagingRows.map((row) => row.trayCode)).toContain("SYLU-2026-04-107-TP-001");
  });

  test("does not fall back to task-level experiment types for fully completed mapped trays", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-001",
      code: "SYLU-2026-03-001",
      test_type: "高低温湿热试验 / 盐雾试验 / 四综合试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-001-a",
        task_code: "SYLU-2026-03-001",
        experiment_code: "SYLU-2026-03-001-A",
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
      {
        id: "exp-001-b",
        task_code: "SYLU-2026-03-001",
        experiment_code: "SYLU-2026-03-001-B",
        experiment_name: "四综合试验",
        required_device: "四综合试验室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      {
        id: "rel-001-a",
        task_code: "SYLU-2026-03-001",
        experiment_code: "SYLU-2026-03-001-A",
        tray_code: "SYLU-2026-03-001-TP-002",
      },
      {
        id: "rel-001-b",
        task_code: "SYLU-2026-03-001",
        experiment_code: "SYLU-2026-03-001-B",
        tray_code: "SYLU-2026-03-001-TP-002",
      },
    );
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-001",
      code: "SYLU-2026-03-001-SP-002",
      task_code: "SYLU-2026-03-001",
      owner: "周工",
      location: "恒温恒湿间（暂存间）",
      status: "放置实验后暂存间",
      trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "放置实验后暂存间", quantity: 4 }],
      history: [
        { detail: "SYLU-2026-03-001 / 四综合试验 / 实验已完成", time: "2026-04-01T10:30:00" },
        { detail: "SYLU-2026-03-001 / 盐雾试验 / 实验已完成", time: "2026-04-01T09:30:00" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-001-in",
      tray_code: "SYLU-2026-03-001-TP-002",
      task_code: "SYLU-2026-03-001",
      action: "stock_in",
      time: "2026-04-01T11:00:00",
      operator: "暂存员A",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const detail = buildZancunScanDetail(rows, "SYLU-2026-03-001-TP-002", "stockOut");
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-03-001-TP-002",
        mode: "stockOut",
        targetLab: "冲击一室",
      },
      snapshot,
    });

    expect(detail).toMatchObject({
      status: "放置实验后暂存间",
      targetExperimentName: "",
      targetLab: "",
    });
    expect(result.error).toBe("该托盘已完成全部实验，当前应保留在暂存间。");
    expect(result.snapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_out" && event.tray_code === "SYLU-2026-03-001-TP-002")).toHaveLength(0);
  });
});
