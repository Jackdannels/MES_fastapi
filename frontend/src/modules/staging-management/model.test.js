import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  applyZancunInventoryAction,
  buildZancunInventorySections,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunRowsFromSnapshot,
  buildZancunScanDetail,
} from "./model";
import * as stagingModelPublicApi from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { getLegacyFallbackHits, resetLegacyFallbackHits } from "@/lib/legacyFallback";

const TODAY = "2026-04-01T12:00:00";

const createSnapshot = () => ({
  [STORAGE_KEYS.devices]: [],
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
  test("keeps the staging model public compatibility exports stable while splitting internals", () => {
    expect(Object.keys(stagingModelPublicApi).sort()).toEqual([
      "applyZancunInventoryAction",
      "buildZancunInventorySections",
      "buildZancunMetrics",
      "buildZancunOverviewView",
      "buildZancunRowsFromSnapshot",
      "buildZancunScanDetail",
    ]);
  });

  test("indexes staging events once when building rows instead of scanning all events per tray", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/stagingRowsModel.js"), "utf8");
    const buildRowsSource = source.slice(
      source.indexOf("function buildZancunRowsFromSnapshot"),
      source.indexOf("function buildZancunInventorySections"),
    );

    expect(buildRowsSource).toContain("allEventMap");
    expect(buildRowsSource).not.toContain("collectTrayStorageEvents(stagingEvents, row.trayCode)");
  });

  test("looks up tray storage events once during inventory actions", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/stagingActionModel.js"), "utf8");
    const actionSource = source.slice(
      source.indexOf("function applyZancunInventoryAction"),
      source.indexOf("export {"),
    );
    const directLookups = actionSource.match(/collectTrayStorageEvents\(nextSnapshot\[STAGING_EVENTS_KEY\], normalizedCode\)/g) || [];

    expect(directLookups).toHaveLength(1);
  });

  afterEach(() => {
    resetLegacyFallbackHits();
  });

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
      status: "到货",
    });
    expect(stockedOutRow).toMatchObject({
      taskCode: "SYLU-2026-04-103",
      status: "已出库",
    });
  });

  test("does not treat handover arrivals as current staging inventory", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-handover",
      code: "SYLU-2026-06-021",
      test_type: "冲击试验 / 盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-handover",
      code: "SYLU-2026-06-021-SP-002",
      task_code: "SYLU-2026-06-021",
      owner: "周工",
      location: "接驳区",
      status: "到货",
      flow_status: "到货",
      trays: [{ tray_code: "SYLU-2026-06-021-TP-002", status: "到货", quantity: 1 }],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });

    expect(rows.map((row) => row.trayCode)).not.toContain("SYLU-2026-06-021-TP-002");
  });

  test("does not treat legacy stocked status as current staging inventory", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.samples].push({
      code: "SYLU-2026-06-200-SP-001",
      flow_status: "已入库",
      location: "恒温恒湿间（暂存间）",
      status: "已入库",
      task_code: "SYLU-2026-06-200",
      trays: [{ quantity: 1, status: "已入库", tray_code: "SYLU-2026-06-200-TP-001" }],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const sections = buildZancunInventorySections(rows);

    expect(sections.currentStagingRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-06-200-TP-001");
  });

  test("labels stocked staging trays with their latest completed experiment source", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-staged-after-salt",
      code: taskCode,
      test_type: "霉菌试验 / 四综合试验 / 高低温湿热试验 / 盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-staged-after-salt",
      task_code: taskCode,
      experiment_code: `${taskCode}-D`,
      experiment_name: "盐雾试验",
      required_device: "盐雾试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-staged-after-salt",
      task_code: taskCode,
      experiment_code: `${taskCode}-D`,
      tray_code: trayCode,
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-staged-after-salt",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      flow_status: "已到达暂存间",
      trays: [{ tray_code: trayCode, status: "已到达暂存间", quantity: 1 }],
      history: [
        { detail: `${taskCode} / 盐雾试验 / 实验已完成`, status: "实验已完成", time: "2026-06-10T09:30:00+08:00" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-staged-after-salt-in",
      tray_code: trayCode,
      task_code: taskCode,
      action: "stock_in",
      time: "2026-06-10T10:00:00+08:00",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const row = rows.find((item) => item.trayCode === trayCode);

    expect(row).toEqual(expect.objectContaining({
      status: "到货",
      statusLabel: "放置暂存间",
    }));
  });

  test("keeps direct handover trays labeled as arrival in staging", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-022";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-handover-arrival",
      code: taskCode,
      test_type: "冲击试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-handover-arrival",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "接驳区",
      status: "到货",
      flow_status: "到货",
      trays: [{ tray_code: trayCode, status: "到货", quantity: 1 }],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-handover-arrival-in",
      tray_code: trayCode,
      task_code: taskCode,
      action: "stock_in",
      time: "2026-06-10T10:00:00+08:00",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const row = rows.find((item) => item.trayCode === trayCode);

    expect(row).toEqual(expect.objectContaining({
      status: "到货",
      statusLabel: "放置暂存间",
    }));
  });

  test("shows the latest completed experiment label when multiple experiments are complete", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-024";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-multi-complete",
      code: taskCode,
      test_type: "盐雾试验 / 霉菌试验 / 振动试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-multi-complete-a",
        task_code: taskCode,
        experiment_code: `${taskCode}-A`,
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
      {
        id: "exp-multi-complete-b",
        task_code: taskCode,
        experiment_code: `${taskCode}-B`,
        experiment_name: "霉菌试验",
        required_device: "霉菌试验室",
      },
      {
        id: "exp-multi-complete-c",
        task_code: taskCode,
        experiment_code: `${taskCode}-C`,
        experiment_name: "振动试验",
        required_device: "振动一室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-multi-complete-a", task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
      { id: "rel-multi-complete-b", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      { id: "rel-multi-complete-c", task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode, run_tray_status: "实验已完成", completed_at: "2026-06-10T08:30:00+08:00" },
      { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode, run_tray_status: "实验已完成", completed_at: "2026-06-10T09:30:00+08:00" },
    ];
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-multi-complete",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      flow_status: "已到达暂存间",
      trays: [{ tray_code: trayCode, status: "已到达暂存间", quantity: 1 }],
      history: [
        { detail: `${taskCode} / 盐雾试验 / 实验已完成`, status: "实验已完成", time: "2026-06-10T08:30:00+08:00" },
        { detail: `${taskCode} / 霉菌试验 / 实验已完成`, status: "实验已完成", time: "2026-06-10T09:30:00+08:00" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-multi-complete-in",
      tray_code: trayCode,
      task_code: taskCode,
      action: "stock_in",
      time: "2026-06-10T10:00:00+08:00",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const row = rows.find((item) => item.trayCode === trayCode);

    expect(row).toEqual(expect.objectContaining({
      status: "到货",
      statusLabel: "放置暂存间",
    }));
  });

  test("shows completed trays in staging as arrived instead of arrival", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-post-staging",
      code: "SYLU-2026-06-023",
      test_type: "盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-post-staging",
      code: "SYLU-2026-06-023-SP-002",
      task_code: "SYLU-2026-06-023",
      owner: "周工",
      location: "恒温恒湿间（暂存间）",
      status: "实验后暂存间存放",
      flow_status: "实验后暂存间存放",
      trays: [{ tray_code: "SYLU-2026-06-023-TP-002", status: "实验后暂存间存放", quantity: 1 }],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const row = rows.find((item) => item.trayCode === "SYLU-2026-06-023-TP-002");
    const sections = buildZancunInventorySections(rows);

    expect(row).toEqual(expect.objectContaining({
      status: "已到达暂存间",
      statusLabel: "实验后暂存",
      isPostExperimentInbound: true,
    }));
    expect(sections.currentStagingRows.map((item) => item.trayCode)).toContain("SYLU-2026-06-023-TP-002");
    expect(sections.plannedInboundRows.map((item) => item.trayCode)).not.toContain("SYLU-2026-06-023-TP-002");
  });

  test("shows tray-mapped experiment types instead of every task experiment on staging rows", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-003",
      code: "SYLU-2026-05-003",
      test_type: "盐雾试验 / 霉菌试验 / 四综合试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-003-a",
        task_code: "SYLU-2026-05-003",
        experiment_code: "SYLU-2026-05-003-A",
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
      {
        id: "exp-003-b",
        task_code: "SYLU-2026-05-003",
        experiment_code: "SYLU-2026-05-003-B",
        experiment_name: "霉菌试验",
        required_device: "霉菌试验室",
      },
      {
        id: "exp-003-c",
        task_code: "SYLU-2026-05-003",
        experiment_code: "SYLU-2026-05-003-C",
        experiment_name: "四综合试验",
        required_device: "四综合试验室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-003-b",
      task_code: "SYLU-2026-05-003",
      experiment_code: "SYLU-2026-05-003-B",
      tray_code: "SYLU-2026-05-003-TP-002",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-003",
      code: "SYLU-2026-05-003-SP-001",
      task_code: "SYLU-2026-05-003",
      owner: "周工",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      trays: [{ tray_code: "SYLU-2026-05-003-TP-002", status: "已到达暂存间", quantity: 4 }],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-003-in",
      tray_code: "SYLU-2026-05-003-TP-002",
      task_code: "SYLU-2026-05-003",
      action: "stock_in",
      time: "2026-04-01T09:00:00",
      operator: "暂存员A",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const row = rows.find((item) => item.trayCode === "SYLU-2026-05-003-TP-002");

    expect(row?.sampleType).toBe("霉菌试验");
  });

  test("builds metrics from current tray rows instead of sample quantities", () => {
    const snapshot = createSnapshot();
    const stockedTray = snapshot[STORAGE_KEYS.samples].find((sample) => sample.task_code === "SYLU-2026-04-102");
    stockedTray.trays = stockedTray.trays.map((tray) => ({ ...tray, quantity: 7 }));
    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const metrics = buildZancunMetrics({
      now: TODAY,
      rows,
      stagingEvents: snapshot[STORAGE_KEYS.staging_events],
    });

    expect(metrics.totalTrayCount).toBe(1);
    expect(metrics.totalQuantity).toBeUndefined();
  });

  test("filters overview rows by metric mode and paginates in 4-row viewports", () => {
    const rows = buildZancunRowsFromSnapshot(createSnapshot(), { now: TODAY });
    const view = buildZancunOverviewView({
      filters: {
        metricMode: "stockedOutToday",
      },
      now: TODAY,
      page: 1,
      pageSize: 4,
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
      pageSize: 4,
      rows,
      stagingEvents: createSnapshot()[STORAGE_KEYS.staging_events],
      sort: {
        direction: "asc",
        key: "trayCode",
      },
    });

    expect(pagedView.pageCount).toBe(2);
    expect(pagedView.currentPage).toBe(2);
    expect(pagedView.rows).toHaveLength(2);
  });

  test("builds scan detail for stock in and stock out actions", () => {
    const rows = buildZancunRowsFromSnapshot(createSnapshot(), { now: TODAY });
    const stockInDetail = buildZancunScanDetail(rows, "SYLU-2026-04-101-TP-001", "stockIn");
    const stockOutDetail = buildZancunScanDetail(rows, "SYLU-2026-04-102-TP-001", "stockOut");

    expect(stockInDetail.nextStatus).toBe("到货");
    expect(stockOutDetail.nextStatus).toBe("已出库");
    expect(stockOutDetail.trayCode).toBe("SYLU-2026-04-102-TP-001");
    expect(stockOutDetail.targetLab).toBe("振动一室");
  });

  test("accepts prefixed tray QR payloads for staging scan detail and stock in", () => {
    const snapshot = createSnapshot();
    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const detail = buildZancunScanDetail(rows, "MES-TRAY:SYLU-2026-04-101-TP-001", "stockIn", { room: "staging" });
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: "MES-TRAY:SYLU-2026-04-101-TP-001", mode: "stockIn", room: "staging" },
      room: "staging",
      snapshot,
    });

    expect(detail).toEqual(expect.objectContaining({
      found: true,
      trayCode: "SYLU-2026-04-101-TP-001",
    }));
    expect(result.error).toBe("");
    expect(result.row).toEqual(expect.objectContaining({
      trayCode: "SYLU-2026-04-101-TP-001",
    }));
    expect(result.snapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_in",
      room: "staging",
      tray_code: "SYLU-2026-04-101-TP-001",
    });
  });

  test("splits planned inbound and actual staging trays into separate sections", () => {
    const rows = buildZancunRowsFromSnapshot(createSnapshot(), { now: TODAY });
    const sections = buildZancunInventorySections(rows);

    expect(sections.plannedInboundRows.map((row) => row.trayCode)).toContain("SYLU-2026-04-101-TP-001");
    expect(sections.plannedInboundRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-04-102-TP-001");
    expect(sections.currentStagingRows.map((row) => row.trayCode)).toContain("SYLU-2026-04-102-TP-001");
    expect(sections.currentStagingRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-04-101-TP-001");
  });

  test("uses appearance room as source when appearance stock-out targets staging", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-appearance-to-staging",
      code: "TASK-APPEARANCE-TO-STAGING",
      test_type: "盐雾试验",
      source: "外部委托",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-to-staging",
      code: "SP-APPEARANCE-TO-STAGING",
      task_code: "TASK-APPEARANCE-TO-STAGING",
      owner: "赵工",
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      trays: [{ tray_code: "TP-APPEARANCE-TO-STAGING", status: "送至暂存间", quantity: 1 }],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      action: "stock_out",
      room: "appearance",
      target_lab: "恒温恒湿间（暂存间）",
      target_type: "staging",
      task_code: "TASK-APPEARANCE-TO-STAGING",
      time: "2026-04-01T11:10:00",
      tray_code: "TP-APPEARANCE-TO-STAGING",
    });

    const row = buildZancunRowsFromSnapshot(snapshot, { now: TODAY })
      .find((item) => item.trayCode === "TP-APPEARANCE-TO-STAGING");

    expect(row).toEqual(expect.objectContaining({
      source: "外观检测间",
      status: "待入库",
    }));
  });

  test("keeps appearance room as the source after the tray is stocked into staging", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-appearance-stocked-staging",
      code: "TASK-APPEARANCE-STOCKED-STAGING",
      test_type: "盐雾试验",
      source: "外部委托",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-stocked-staging",
      code: "SP-APPEARANCE-STOCKED-STAGING",
      task_code: "TASK-APPEARANCE-STOCKED-STAGING",
      owner: "赵工",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      trays: [{ tray_code: "TP-APPEARANCE-STOCKED-STAGING", status: "已到达暂存间", quantity: 1 }],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        action: "stock_out",
        room: "appearance",
        target_lab: "恒温恒湿间（暂存间）",
        target_type: "staging",
        task_code: "TASK-APPEARANCE-STOCKED-STAGING",
        time: "2026-04-01T11:10:00",
        tray_code: "TP-APPEARANCE-STOCKED-STAGING",
      },
      {
        action: "stock_in",
        room: "staging",
        task_code: "TASK-APPEARANCE-STOCKED-STAGING",
        time: "2026-04-01T11:15:00",
        tray_code: "TP-APPEARANCE-STOCKED-STAGING",
      },
    );

    const row = buildZancunRowsFromSnapshot(snapshot, { now: TODAY })
      .find((item) => item.trayCode === "TP-APPEARANCE-STOCKED-STAGING");

    expect(row).toEqual(expect.objectContaining({
      source: "外观检测间",
      status: "到货",
    }));
  });

  test("does not treat manufacturer-returned unfinished appearance experiments as appearance planned inbound", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.experiment_run_trays] ||= [];
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-returned-before-mold",
      code: "TASK-RETURNED-BEFORE-MOLD",
      test_type: "霉菌试验",
      source: "外部委托",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-returned-before-mold",
      task_code: "TASK-RETURNED-BEFORE-MOLD",
      experiment_code: "EXP-MOLD-UNFINISHED",
      experiment_name: "霉菌试验",
      required_device: "霉菌试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-returned-before-mold",
      task_code: "TASK-RETURNED-BEFORE-MOLD",
      experiment_code: "EXP-MOLD-UNFINISHED",
      tray_code: "TP-RETURNED-BEFORE-MOLD",
    });
    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      task_code: "TASK-RETURNED-BEFORE-MOLD",
      experiment_code: "EXP-MOLD-UNFINISHED",
      tray_code: "TP-RETURNED-BEFORE-MOLD",
      status: "厂家收回",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-returned-before-mold",
      code: "SP-RETURNED-BEFORE-MOLD",
      task_code: "TASK-RETURNED-BEFORE-MOLD",
      owner: "赵工",
      location: "厂家收回",
      status: "厂家收回",
      flow_status: "送至外观检测间",
      trays: [{ tray_code: "TP-RETURNED-BEFORE-MOLD", status: "送至外观检测间", quantity: 1 }],
    });

    const appearanceRows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });

    expect(appearanceRows.map((row) => row.trayCode)).not.toContain("TP-RETURNED-BEFORE-MOLD");
  });

  test("stock-out detail resolves the next formal lab and excludes staging destinations", () => {
    const rows = buildZancunRowsFromSnapshot(createSnapshot(), { now: TODAY });
    const detail = buildZancunScanDetail(rows, "SYLU-2026-04-102-TP-001", "stockOut");

    expect(detail.targetLab).toBe("振动一室");
    expect(detail.targetLab).not.toContain("暂存间");
    expect(detail.targetExperimentName).toBe("振动试验");
  });

  test("stock-out detail exposes only the earliest unfinished scheduled lab", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.schedules] = snapshot[STORAGE_KEYS.schedules].map((schedule) => (
      schedule.id === "schedule-102-next-lab"
        ? { ...schedule, start_at: "2026-04-01T12:30:00", end_at: "2026-04-01T15:30:00" }
        : schedule
    ));

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const detail = buildZancunScanDetail(rows, "SYLU-2026-04-102-TP-001", "stockOut");

    expect(detail.targetDestinations).toEqual([
      expect.objectContaining({
        preferred: true,
        scheduleId: "schedule-102-next-lab",
        scheduled: true,
        targetExperimentCode: "SYLU-2026-04-102-B",
        targetLab: "盐雾试验室",
      }),
    ]);
    expect(detail.targetDestinations.map((destination) => destination.targetLab)).not.toContain("恒温恒湿间（暂存间）");
    expect(detail.targetLab).toBe("盐雾试验室");
  });

  test("same experiment schedules advance by exact schedule id", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-04-102";
    const experimentCode = "SYLU-2026-04-102-A";
    const trayCode = "SYLU-2026-04-102-TP-001";
    snapshot[STORAGE_KEYS.schedules] = [
      { id: "schedule-segment-1", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: "SEG-1", device: "振动一室", start_at: "2026-04-01T09:00:00" },
      { id: "schedule-segment-2", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: "SEG-2", device: "振动二室", start_at: "2026-04-01T10:00:00" },
    ];
    snapshot[STORAGE_KEYS.experiment_runs] = [
      { run_no: "run-segment-1", schedule_id: "schedule-segment-1", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: "SEG-1" },
    ];
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      { run_no: "run-segment-1", task_code: taskCode, experiment_code: experimentCode, sub_experiment_code: "SEG-1", tray_code: trayCode, run_tray_status: "实验已完成" },
    ];

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const detail = buildZancunScanDetail(rows, trayCode, "stockOut");

    expect(detail.targetDestinations).toEqual([
      expect.objectContaining({
        scheduleId: "schedule-segment-2",
        subExperimentCode: "SEG-2",
        targetLab: "振动二室",
      }),
    ]);
  });

  test.each([
    { maintenanceType: "计划维修", status: "维修" },
    { maintenanceType: "计划保养", status: "保养" },
  ])("blocks stock-out to a lab that is currently under $status", ({ maintenanceType, status }) => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.devices] = [
      {
        code: "振动一室",
        maintenance_end_at: "2026-04-01T13:30:00",
        maintenance_start_at: "2026-04-01T11:30:00",
        maintenance_type: maintenanceType,
        name: "振动试验系统-1",
        status,
      },
    ];

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const detail = buildZancunScanDetail(rows, "SYLU-2026-04-102-TP-001", "stockOut");
    const vibrationDestination = detail.targetDestinations.find((destination) => destination.targetLab === "振动一室");
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: detail.trayCode,
        mode: "stockOut",
        targetExperimentCode: vibrationDestination.targetExperimentCode,
        targetLab: vibrationDestination.targetLab,
      },
      snapshot,
    });

    expect(vibrationDestination).toEqual(expect.objectContaining({
      preferred: true,
      targetAvailable: false,
      targetUnavailableReason: expect.stringContaining(`正在${status}`),
    }));
    expect(vibrationDestination.targetUnavailableReason).toContain("2026-04-01 13:30");
    expect(result.error).toBe(vibrationDestination.targetUnavailableReason);
  });

  test("stock-out detail keeps scheduled target lab identity fields for exact matching", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.schedules] = snapshot[STORAGE_KEYS.schedules].map((schedule) => (
      schedule.id === "schedule-102-next-lab"
        ? { ...schedule, lab_code: "LAB_SALT", lab_id: 9 }
        : schedule.id === "schedule-102-lab"
        ? { ...schedule, lab_code: "LAB_VIBRATION_1", lab_id: 11 }
        : schedule
    ));

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const detail = buildZancunScanDetail(rows, "SYLU-2026-04-102-TP-001", "stockOut");

    expect(detail.targetDestinations).toContainEqual(expect.objectContaining({
      scheduleId: "schedule-102-lab",
      targetExperimentCode: "SYLU-2026-04-102-A",
      targetLab: "振动一室",
      targetLabCode: "LAB_VIBRATION_1",
      targetLabId: 11,
    }));
    expect(detail).toEqual(expect.objectContaining({
      targetLab: "振动一室",
      targetLabCode: "LAB_VIBRATION_1",
      targetLabId: 11,
    }));
  });

  test("does not derive stock-out destinations from unscheduled required devices", () => {
    resetLegacyFallbackHits();
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.schedules] = snapshot[STORAGE_KEYS.schedules].filter(
      (schedule) => schedule.device.includes("暂存间"),
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

    expect(detail).toEqual(expect.objectContaining({
      targetDestinations: [],
      targetIsFallback: false,
      targetLab: "",
      targetUnavailableReason: "",
    }));
    expect(result.error).toBe("未找到该托盘可出库的目标实验室。");
    expect(getLegacyFallbackHits()).toEqual([]);
  });

  test("does not derive stock-out destinations from task test type", () => {
    resetLegacyFallbackHits();
    const snapshot = createSnapshot();

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const detail = buildZancunScanDetail(rows, "SYLU-2026-04-101-TP-001", "stockOut");

    expect(detail).toEqual(expect.objectContaining({
      targetDestinations: [],
      targetIsFallback: false,
      targetLab: "",
    }));
    expect(getLegacyFallbackHits()).toEqual([]);
  });

  test("stock-out detail keeps only scheduled targets selectable when another target is unscheduled", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.schedules] = snapshot[STORAGE_KEYS.schedules].filter(
      (schedule) => schedule.experiment_code !== "SYLU-2026-04-102-A" || schedule.device.includes("暂存间"),
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const detail = buildZancunScanDetail(rows, "SYLU-2026-04-102-TP-001", "stockOut");

    expect(detail.targetDestinations).toEqual([
      expect.objectContaining({
        scheduled: true,
        targetExperimentCode: "SYLU-2026-04-102-B",
        targetLab: "盐雾试验室",
      }),
    ]);
    expect(detail.targetLab).toBe("盐雾试验室");
    expect(detail.targetUnavailableReason).toBe("");
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
    expect(detail.nextStatus).toBe("到货");
  });

  test("appearance inspection room stocks in only trays sent to appearance inspection", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.samples].push(
      {
        id: "sample-appearance",
        code: "SYLU-2026-04-120-SP-001",
        task_code: "SYLU-2026-04-120",
        owner: "周工",
        location: "外观检测间",
        status: "送至外观检测间",
        trays: [{ tray_code: "SYLU-2026-04-120-TP-001", status: "送至外观检测间", quantity: 1 }],
        history: [
          { detail: "SYLU-2026-04-120 / 盐雾试验 / 实验已完成", time: "2026-04-01T09:20:00" },
        ],
      },
      {
        id: "sample-vibration",
        code: "SYLU-2026-04-121-SP-001",
        task_code: "SYLU-2026-04-121",
        owner: "李工",
        location: "振动一室",
        status: "实验已完成",
        trays: [{ tray_code: "SYLU-2026-04-121-TP-001", status: "实验已完成", quantity: 1 }],
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const sections = buildZancunInventorySections(rows, { room: "appearance" });
    const stockInResult = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: "SYLU-2026-04-120-TP-001", mode: "stockIn" },
      room: "appearance",
      snapshot,
    });

    expect(rows.map((row) => row.trayCode)).toContain("SYLU-2026-04-120-TP-001");
    expect(rows.map((row) => row.trayCode)).not.toContain("SYLU-2026-04-121-TP-001");
    expect(sections.plannedInboundRows.map((row) => row.trayCode)).toEqual(["SYLU-2026-04-120-TP-001"]);
    expect(stockInResult.error).toBe("");
    expect(stockInResult.snapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_in",
      room: "appearance",
      tray_code: "SYLU-2026-04-120-TP-001",
    });
    expect(stockInResult.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === "sample-appearance")).toMatchObject({
      location: "外观检测间",
      status: "实验后外观检测间存放",
      flow_status: "实验后外观检测间存放",
    });
  });

  test("appearance inspection room excludes trays sent there after non-salt-mold experiments", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-impact",
      code: "SYLU-2026-06-021",
      test_type: "冲击试验 / 盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-impact",
      task_code: "SYLU-2026-06-021",
      experiment_code: "SYLU-2026-06-021-A",
      experiment_name: "冲击试验",
      required_device: "冲击一室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-impact",
      task_code: "SYLU-2026-06-021",
      experiment_code: "SYLU-2026-06-021-A",
      tray_code: "SYLU-2026-06-021-TP-001",
    });
    snapshot[STORAGE_KEYS.experiment_run_trays] = [];
    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      run_no: "run-impact",
      task_code: "SYLU-2026-06-021",
      experiment_code: "SYLU-2026-06-021-A",
      tray_code: "SYLU-2026-06-021-TP-001",
      run_tray_status: "实验已完成",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-impact-appearance",
      code: "SYLU-2026-06-021-SP-001",
      task_code: "SYLU-2026-06-021",
      owner: "周工",
      location: "外观检测间",
      status: "送至外观检测间",
      flow_status: "送至外观检测间",
      trays: [{ tray_code: "SYLU-2026-06-021-TP-001", status: "送至外观检测间", quantity: 1 }],
      history: [
        { detail: "SYLU-2026-06-021 / 冲击试验 / 实验已完成", time: "2026-06-07T14:20:00" },
      ],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });

    expect(rows.map((row) => row.trayCode)).not.toContain("SYLU-2026-06-021-TP-001");
  });

  test("appearance inspection room excludes pre-experiment half-state without target metadata or stock-in event", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-pre-appearance-half-state",
      code: "SYLU-2026-06-021-SP-001",
      task_code: "SYLU-2026-06-021",
      owner: "周工",
      location: "外观检测间",
      status: "实验前外观检测间存放",
      flow_status: "实验前外观检测间存放",
      trays: [
        {
          tray_code: "SYLU-2026-06-021-TP-001",
          status: "实验前外观检测间存放",
          quantity: 1,
          target_experiment_code: "",
          target_lab: "",
        },
      ],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const sections = buildZancunInventorySections(rows, { room: "appearance" });

    expect(rows.map((row) => row.trayCode)).not.toContain("SYLU-2026-06-021-TP-001");
    expect(sections.currentStagingRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-06-021-TP-001");
    expect(sections.plannedInboundRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-06-021-TP-001");
  });

  test("appearance inspection room shows second inbound after another salt or mold completion", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-repeat-appearance",
      code: "SYLU-2026-06-022",
      test_type: "霉菌试验 / 盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-repeat-mold",
        task_code: "SYLU-2026-06-022",
        experiment_code: "SYLU-2026-06-022-A",
        experiment_name: "霉菌试验",
        required_device: "霉菌试验室",
      },
      {
        id: "exp-repeat-salt",
        task_code: "SYLU-2026-06-022",
        experiment_code: "SYLU-2026-06-022-B",
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      {
        id: "rel-repeat-mold",
        task_code: "SYLU-2026-06-022",
        experiment_code: "SYLU-2026-06-022-A",
        tray_code: "SYLU-2026-06-022-TP-003",
      },
      {
        id: "rel-repeat-salt",
        task_code: "SYLU-2026-06-022",
        experiment_code: "SYLU-2026-06-022-B",
        tray_code: "SYLU-2026-06-022-TP-003",
      },
    );
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-repeat-appearance",
      code: "SYLU-2026-06-022-SP-002",
      task_code: "SYLU-2026-06-022",
      owner: "周工",
      location: "外观检测间",
      status: "送至外观检测间",
      flow_status: "送至外观检测间",
      trays: [
        {
          tray_code: "SYLU-2026-06-022-TP-003",
          status: "送至外观检测间",
          quantity: 1,
          target_experiment_code: "SYLU-2026-06-022-B",
          target_lab: "盐雾试验室",
        },
      ],
      history: [
        { detail: "SYLU-2026-06-022 / 盐雾试验 / 实验已完成", status: "实验已完成", time: "2026-06-07T16:06:28" },
        { detail: "SYLU-2026-06-022-TP-003 送至 盐雾试验室", status: "送至实验室", time: "2026-06-07T16:05:58" },
        { detail: "SYLU-2026-06-022-TP-003 实验后外观检测间存放", status: "实验后外观检测间存放", time: "2026-06-07T16:05:51" },
        { detail: "SYLU-2026-06-022 / 霉菌试验 / 实验已完成", status: "实验已完成", time: "2026-06-07T15:48:09" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "evt-repeat-appearance-in",
        tray_code: "SYLU-2026-06-022-TP-003",
        task_code: "SYLU-2026-06-022",
        room: "appearance",
        action: "stock_in",
        time: "2026-06-07T16:05:51",
      },
      {
        id: "evt-repeat-appearance-out",
        tray_code: "SYLU-2026-06-022-TP-003",
        task_code: "SYLU-2026-06-022",
        room: "appearance",
        action: "stock_out",
        time: "2026-06-07T16:05:58",
        target_lab: "盐雾试验室",
        target_experiment_code: "SYLU-2026-06-022-B",
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const sections = buildZancunInventorySections(rows, { room: "appearance" });
    const row = rows.find((item) => item.trayCode === "SYLU-2026-06-022-TP-003");

    expect(row?.status).toBe("待入库");
    expect(sections.plannedInboundRows.map((item) => item.trayCode)).toContain("SYLU-2026-06-022-TP-003");
  });

  test("appearance inspection room ignores earlier salt or mold completion after a later non-appearance experiment", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-appearance-latest",
      code: "SYLU-2026-06-031",
      test_type: "盐雾试验 / 冲击试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-appearance-latest-salt",
        task_code: "SYLU-2026-06-031",
        experiment_code: "SYLU-2026-06-031-A",
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
      {
        id: "exp-appearance-latest-impact",
        task_code: "SYLU-2026-06-031",
        experiment_code: "SYLU-2026-06-031-B",
        experiment_name: "冲击试验",
        required_device: "冲击一室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      {
        id: "rel-appearance-latest-salt",
        task_code: "SYLU-2026-06-031",
        experiment_code: "SYLU-2026-06-031-A",
        tray_code: "SYLU-2026-06-031-TP-001",
      },
      {
        id: "rel-appearance-latest-impact",
        task_code: "SYLU-2026-06-031",
        experiment_code: "SYLU-2026-06-031-B",
        tray_code: "SYLU-2026-06-031-TP-001",
      },
    );
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-latest",
      code: "SYLU-2026-06-031-SP-001",
      task_code: "SYLU-2026-06-031",
      owner: "周工",
      location: "外观检测间",
      status: "送至外观检测间",
      flow_status: "送至外观检测间",
      trays: [{ tray_code: "SYLU-2026-06-031-TP-001", status: "送至外观检测间", quantity: 1 }],
      history: [
        { detail: "SYLU-2026-06-031 / 盐雾试验 / 实验已完成", status: "实验已完成", time: "2026-06-07T10:00:00" },
        { detail: "SYLU-2026-06-031 / 冲击试验 / 实验已完成", status: "实验已完成", time: "2026-06-07T11:00:00" },
      ],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });

    expect(rows.map((row) => row.trayCode)).not.toContain("SYLU-2026-06-031-TP-001");
  });

  test.each([
    ["salt-spray", "SYLU-2026-06-027", "盐雾试验", "盐雾试验室"],
    ["mold", "SYLU-2026-06-028", "霉菌试验", "霉菌试验室"],
  ])("appearance inspection room lists a single %s tray after lab completion and staging does not relist it", (_caseName, taskCode, experimentName, requiredDevice) => {
    const snapshot = createSnapshot();
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: `task-appearance-single-${_caseName}`,
      code: taskCode,
      test_type: experimentName,
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: `exp-appearance-single-${_caseName}`,
      task_code: taskCode,
      experiment_code: `${taskCode}-A`,
      experiment_name: experimentName,
      required_device: requiredDevice,
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: `rel-appearance-single-${_caseName}`,
      task_code: taskCode,
      experiment_code: `${taskCode}-A`,
      tray_code: trayCode,
    });
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      ...(snapshot[STORAGE_KEYS.experiment_run_trays] || []),
      { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode, run_tray_status: "实验已完成", updated_at: "2026-06-11T16:24:48" },
    ];
    snapshot[STORAGE_KEYS.samples].push({
      id: `sample-appearance-single-${_caseName}`,
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "外观检测间",
      status: "送至外观检测间",
      flow_status: "送至外观检测间",
      trays: [{ tray_code: trayCode, status: "送至外观检测间", quantity: 1 }],
      history: [
        { detail: `${taskCode} / ${experimentName} / 实验已完成`, status: "实验已完成", time: "2026-06-11T16:24:48" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: `evt-appearance-single-${_caseName}-out`,
      tray_code: trayCode,
      task_code: taskCode,
      action: "stock_out",
      time: "2026-06-11T16:17:58",
      operator: "暂存员B",
      target_lab: requiredDevice,
    });

    const appearanceRows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const appearanceSections = buildZancunInventorySections(appearanceRows, { room: "appearance" });
    const stagingRows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "staging" });
    const stagingSections = buildZancunInventorySections(stagingRows, { room: "staging" });
    const stockInResult = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: trayCode, mode: "stockIn" },
      room: "appearance",
      snapshot,
    });

    expect(appearanceSections.plannedInboundRows).toContainEqual(expect.objectContaining({
      inboundKindLabel: "计划入库",
      status: "待入库",
      trayCode,
    }));
    expect(stagingSections.plannedInboundRows.map((row) => row.trayCode)).not.toContain(trayCode);
    expect(stagingSections.currentStagingRows.map((row) => row.trayCode)).not.toContain(trayCode);
    expect(stockInResult.error).toBe("");
    expect(stockInResult.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === `sample-appearance-single-${_caseName}`)).toMatchObject({
      location: "外观检测间",
      status: "实验后外观检测间存放",
      flow_status: "实验后外观检测间存放",
    });
  });

  test("fully completed trays waiting for post-experiment staging are marked as allowed staging", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-032";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-post-plan",
      code: taskCode,
      test_type: "振动试验 / 冲击试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      { id: "exp-post-plan-a", task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "振动试验", required_device: "振动一室" },
      { id: "exp-post-plan-b", task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "冲击试验", required_device: "冲击一室" },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-post-plan-a", task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
      { id: "rel-post-plan-b", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      ...(snapshot[STORAGE_KEYS.experiment_run_trays] || []),
      { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode, run_tray_status: "实验已完成" },
      { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode, run_tray_status: "实验已完成" },
    ];
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-post-plan",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "冲击一室",
      status: "实验已完成",
      flow_status: "实验已完成",
      trays: [{ tray_code: trayCode, status: "实验已完成", quantity: 1 }],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "staging" });
    const row = rows.find((item) => item.trayCode === trayCode);

    expect(row).toEqual(expect.objectContaining({
      inboundKind: "allowed",
      inboundKindLabel: "允许暂存",
      isPostExperimentInbound: true,
      status: "待入库",
    }));
  });

  test("appearance inspection room can stock out to staging after inspection storage", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-out",
      code: "SYLU-2026-04-122-SP-001",
      task_code: "SYLU-2026-04-122",
      owner: "周工",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      trays: [{ tray_code: "SYLU-2026-04-122-TP-001", status: "实验后外观检测间存放", quantity: 1 }],
      history: [
        { detail: "SYLU-2026-04-122 / 霉菌试验 / 实验已完成", time: "2026-04-01T09:20:00" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-appearance-122-in",
      action: "stock_in",
      room: "appearance",
      task_code: "SYLU-2026-04-122",
      time: "2026-04-01T09:30:00",
      tray_code: "SYLU-2026-04-122-TP-001",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const detail = buildZancunScanDetail(rows, "SYLU-2026-04-122-TP-001", "stockOut", { room: "appearance" });
    const stagingDestination = detail.targetDestinations.find((destination) => destination.targetType === "staging");
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-122-TP-001",
        mode: "stockOut",
        targetLab: "恒温恒湿间（暂存间）",
        targetType: "staging",
      },
      room: "appearance",
      snapshot,
    });

    expect(stagingDestination).toEqual(expect.objectContaining({
      scheduled: true,
      targetLab: "恒温恒湿间（暂存间）",
      targetType: "staging",
    }));
    expect(result.error).toBe("");
    expect(result.snapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_out",
      room: "appearance",
      target_lab: "恒温恒湿间（暂存间）",
      target_type: "staging",
    });
    expect(result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === "sample-appearance-out")).toMatchObject({
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      flow_status: "送至暂存间",
    });

    const appearanceRowsAfterStockOut = buildZancunRowsFromSnapshot(result.snapshot, { now: TODAY, room: "appearance" });
    const appearanceSectionsAfterStockOut = buildZancunInventorySections(appearanceRowsAfterStockOut, { room: "appearance" });
    const appearanceRowAfterStockOut = appearanceRowsAfterStockOut.find((row) => row.trayCode === "SYLU-2026-04-122-TP-001");

    expect(appearanceSectionsAfterStockOut.plannedInboundRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-04-122-TP-001");
    expect(appearanceSectionsAfterStockOut.currentStagingRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-04-122-TP-001");
    expect(appearanceRowAfterStockOut?.status).not.toBe("待入库");
  });

  test("pre-experiment appearance stock-out only lists appearance whitelist labs plus staging", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-04-177";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-appearance-whitelist",
      code: taskCode,
      test_type: "盐雾试验 / 振动试验 / 高低温湿热试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-appearance-whitelist-salt",
        task_code: taskCode,
        experiment_code: `${taskCode}-A`,
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
      {
        id: "exp-appearance-whitelist-vibration",
        task_code: taskCode,
        experiment_code: `${taskCode}-B`,
        experiment_name: "振动试验",
        required_device: "振动一室",
      },
      {
        id: "exp-appearance-whitelist-humidity",
        task_code: taskCode,
        experiment_code: `${taskCode}-C`,
        experiment_name: "高低温湿热试验",
        required_device: "高低温湿热一室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-appearance-whitelist-salt", task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
      { id: "rel-appearance-whitelist-vibration", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      { id: "rel-appearance-whitelist-humidity", task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
    );
    snapshot[STORAGE_KEYS.schedules].push(
      {
        id: "schedule-appearance-whitelist-salt",
        task_code: taskCode,
        experiment_code: `${taskCode}-A`,
        experiment_name: "盐雾试验",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:00:00",
        end_at: "2026-04-02T12:00:00",
      },
      {
        id: "schedule-appearance-whitelist-vibration",
        task_code: taskCode,
        experiment_code: `${taskCode}-B`,
        experiment_name: "振动试验",
        device: "振动一室",
        start_at: "2026-04-02T10:00:00",
        end_at: "2026-04-02T13:00:00",
      },
      {
        id: "schedule-appearance-whitelist-humidity",
        task_code: taskCode,
        experiment_code: `${taskCode}-C`,
        experiment_name: "高低温湿热试验",
        device: "高低温湿热一室",
        start_at: "2026-04-02T11:00:00",
        end_at: "2026-04-02T14:00:00",
      },
    );
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-whitelist",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "外观检测间",
      status: "实验前外观检测间存放",
      flow_status: "实验前外观检测间存放",
      trays: [{ tray_code: trayCode, status: "实验前外观检测间存放", quantity: 1 }],
      history: [{ detail: `${taskCode} / 霉菌试验 / 实验已完成`, time: "2026-04-01T09:20:00" }],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-appearance-whitelist-in",
      action: "stock_in",
      room: "appearance",
      task_code: taskCode,
      time: "2026-04-01T09:30:00",
      tray_code: trayCode,
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const detail = buildZancunScanDetail(rows, trayCode, "stockOut", { room: "appearance" });

    expect(detail.targetDestinations.map((destination) => destination.targetLab)).toEqual([
      "盐雾试验室",
      "恒温恒湿间（暂存间）",
    ]);
    expect(detail.targetDestinations.map((destination) => destination.targetLab)).not.toContain("振动一室");
  });

  test("post-experiment appearance stock-out includes scheduled non-whitelist labs", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-04-178";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-post-appearance-next-lab",
      code: taskCode,
      test_type: "盐雾试验 / 振动试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-post-appearance-salt",
        task_code: taskCode,
        experiment_code: `${taskCode}-A`,
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
      {
        id: "exp-post-appearance-vibration",
        task_code: taskCode,
        experiment_code: `${taskCode}-B`,
        experiment_name: "振动试验",
        required_device: "振动一室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-post-appearance-salt", task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
      { id: "rel-post-appearance-vibration", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
    );
    snapshot[STORAGE_KEYS.schedules].push({
      id: "schedule-post-appearance-vibration",
      task_code: taskCode,
      experiment_code: `${taskCode}-B`,
      experiment_name: "振动试验",
      device: "振动一室",
      start_at: "2026-04-02T10:00:00",
      end_at: "2026-04-02T13:00:00",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-post-appearance-next-lab",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      flow_status: "实验后外观检测间存放",
      trays: [{ tray_code: trayCode, status: "实验后外观检测间存放", quantity: 1 }],
      history: [{ detail: `${taskCode} / 盐雾试验 / 实验已完成`, time: "2026-04-01T09:20:00" }],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-post-appearance-in",
      action: "stock_in",
      room: "appearance",
      task_code: taskCode,
      time: "2026-04-01T09:30:00",
      tray_code: trayCode,
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const detail = buildZancunScanDetail(rows, trayCode, "stockOut", { room: "appearance" });

    expect(detail.targetDestinations.map((destination) => destination.targetLab)).toEqual([
      "振动一室",
      "恒温恒湿间（暂存间）",
    ]);
  });

  test("appearance inspection room does not relist trays already dispatched back to staging", () => {
    const snapshot = createSnapshot();
    const trayCode = "SYLU-2026-04-127-TP-001";
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-stale-after-out",
      code: "SYLU-2026-04-127-SP-001",
      task_code: "SYLU-2026-04-127",
      owner: "周工",
      location: "外观检测间",
      status: "送至外观检测间",
      flow_status: "送至外观检测间",
      trays: [{ tray_code: trayCode, status: "送至外观检测间", quantity: 1 }],
      history: [
        { detail: "SYLU-2026-04-127 / 盐雾试验 / 实验已完成", time: "2026-04-01T09:20:00" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "evt-127-appearance-in",
        action: "stock_in",
        room: "appearance",
        task_code: "SYLU-2026-04-127",
        time: "2026-04-01T09:30:00",
        tray_code: trayCode,
      },
      {
        id: "evt-127-appearance-out",
        action: "stock_out",
        room: "appearance",
        target_lab: "恒温恒湿间（暂存间）",
        target_type: "staging",
        task_code: "SYLU-2026-04-127",
        time: "2026-04-01T10:00:00",
        tray_code: trayCode,
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const stockInResult = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: trayCode, mode: "stockIn" },
      room: "appearance",
      snapshot,
    });

    expect(rows.map((row) => row.trayCode)).not.toContain(trayCode);
    expect(stockInResult.error).toBe("未找到对应的入库托盘。");
  });

  test("staging room lists trays dispatched back from appearance inspection even after earlier staging stock-in", () => {
    const snapshot = createSnapshot();
    const trayCode = "SYLU-2026-04-124-TP-001";
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-back-after-stock-in",
      code: "SYLU-2026-04-124-SP-001",
      task_code: "SYLU-2026-04-124",
      owner: "周工",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      trays: [{ tray_code: trayCode, status: "实验后外观检测间存放", quantity: 1 }],
      history: [
        { detail: "SYLU-2026-04-124 / 盐雾试验 / 实验已完成", time: "2026-04-01T09:20:00" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "evt-124-staging-in",
        action: "stock_in",
        room: "staging",
        task_code: "SYLU-2026-04-124",
        time: "2026-04-01T08:30:00",
        tray_code: trayCode,
      },
      {
        id: "evt-124-appearance-in",
        action: "stock_in",
        room: "appearance",
        task_code: "SYLU-2026-04-124",
        time: "2026-04-01T09:30:00",
        tray_code: trayCode,
      },
    );

    const appearanceOut = applyZancunInventoryAction({
      now: "2026-04-01T10:00:00",
      payload: {
        code: trayCode,
        mode: "stockOut",
        targetLab: "恒温恒湿间（暂存间）",
        targetType: "staging",
      },
      room: "appearance",
      snapshot,
    });
    const stagingRows = buildZancunRowsFromSnapshot(appearanceOut.snapshot, { now: TODAY, room: "staging" });
    const stagingSections = buildZancunInventorySections(stagingRows, { room: "staging" });
    const stagingStockIn = applyZancunInventoryAction({
      now: "2026-04-01T10:05:00",
      payload: {
        code: trayCode,
        mode: "stockIn",
      },
      room: "staging",
      snapshot: appearanceOut.snapshot,
    });
    const rowsAfterStockIn = buildZancunRowsFromSnapshot(stagingStockIn.snapshot, { now: TODAY, room: "staging" });
    const sectionsAfterStockIn = buildZancunInventorySections(rowsAfterStockIn, { room: "staging" });

    expect(appearanceOut.error).toBe("");
    expect(stagingSections.currentStagingRows.map((row) => row.trayCode)).not.toContain(trayCode);
    expect(stagingSections.plannedInboundRows).toContainEqual(expect.objectContaining({
      source: "外观检测间",
      status: "待入库",
      trayCode,
    }));
    expect(stagingStockIn.error).toBe("");
    expect(stagingStockIn.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === "sample-appearance-back-after-stock-in")).toMatchObject({
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      flow_status: "已到达暂存间",
    });
    expect(sectionsAfterStockIn.currentStagingRows).toContainEqual(expect.objectContaining({
      source: "外观检测间",
      status: "到货",
      trayCode,
    }));
    expect(sectionsAfterStockIn.plannedInboundRows.map((row) => row.trayCode)).not.toContain(trayCode);
  });

  test("staging room lists trays dispatched back from appearance inspection after an earlier staging stock-out", () => {
    const snapshot = createSnapshot();
    const trayCode = "SYLU-2026-04-125-TP-001";
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-back-after-stock-out",
      code: "SYLU-2026-04-125-SP-001",
      task_code: "SYLU-2026-04-125",
      owner: "周工",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      trays: [{ tray_code: trayCode, status: "实验后外观检测间存放", quantity: 1 }],
      history: [
        { detail: "SYLU-2026-04-125 / 霉菌试验 / 实验已完成", time: "2026-04-01T09:20:00" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "evt-125-staging-in",
        action: "stock_in",
        room: "staging",
        task_code: "SYLU-2026-04-125",
        time: "2026-04-01T07:30:00",
        tray_code: trayCode,
      },
      {
        id: "evt-125-staging-out",
        action: "stock_out",
        room: "staging",
        target_lab: "盐雾试验室",
        task_code: "SYLU-2026-04-125",
        time: "2026-04-01T08:00:00",
        tray_code: trayCode,
      },
      {
        id: "evt-125-appearance-in",
        action: "stock_in",
        room: "appearance",
        task_code: "SYLU-2026-04-125",
        time: "2026-04-01T09:30:00",
        tray_code: trayCode,
      },
    );

    const appearanceOut = applyZancunInventoryAction({
      now: "2026-04-01T10:00:00",
      payload: {
        code: trayCode,
        mode: "stockOut",
        targetLab: "恒温恒湿间（暂存间）",
        targetType: "staging",
      },
      room: "appearance",
      snapshot,
    });
    const stagingRows = buildZancunRowsFromSnapshot(appearanceOut.snapshot, { now: TODAY, room: "staging" });
    const stagingSections = buildZancunInventorySections(stagingRows, { room: "staging" });

    expect(appearanceOut.error).toBe("");
    expect(stagingSections.currentStagingRows.map((row) => row.trayCode)).not.toContain(trayCode);
    expect(stagingSections.plannedInboundRows).toContainEqual(expect.objectContaining({
      source: "外观检测间",
      status: "待入库",
      trayCode,
    }));
  });

  test("staging room infers appearance source when appearance dispatch event omits target metadata", () => {
    const snapshot = createSnapshot();
    const trayCode = "SYLU-2026-04-126-TP-001";
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-back-minimal-event",
      code: "SYLU-2026-04-126-SP-001",
      task_code: "SYLU-2026-04-126",
      owner: "周工",
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      flow_status: "送至暂存间",
      trays: [{ tray_code: trayCode, status: "送至暂存间", quantity: 1 }],
      history: [
        { detail: "SYLU-2026-04-126 / 盐雾试验 / 实验已完成", time: "2026-04-01T09:20:00" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "evt-126-staging-in",
        action: "stock_in",
        room: "staging",
        task_code: "SYLU-2026-04-126",
        time: "2026-04-01T08:30:00",
        tray_code: trayCode,
      },
      {
        id: "evt-126-appearance-in",
        action: "stock_in",
        room: "appearance",
        task_code: "SYLU-2026-04-126",
        time: "2026-04-01T09:30:00",
        tray_code: trayCode,
      },
      {
        id: "evt-126-appearance-out",
        action: "stock_out",
        room: "appearance",
        task_code: "SYLU-2026-04-126",
        time: "2026-04-01T10:00:00",
        tray_code: trayCode,
      },
    );

    const stagingRows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "staging" });
    const stagingSections = buildZancunInventorySections(stagingRows, { room: "staging" });
    const stagingStockIn = applyZancunInventoryAction({
      now: "2026-04-01T10:05:00",
      payload: {
        code: trayCode,
        mode: "stockIn",
      },
      room: "staging",
      snapshot,
    });
    const rowsAfterStockIn = buildZancunRowsFromSnapshot(stagingStockIn.snapshot, { now: TODAY, room: "staging" });
    const sectionsAfterStockIn = buildZancunInventorySections(rowsAfterStockIn, { room: "staging" });

    expect(stagingSections.currentStagingRows.map((row) => row.trayCode)).not.toContain(trayCode);
    expect(stagingSections.plannedInboundRows).toContainEqual(expect.objectContaining({
      source: "外观检测间",
      status: "待入库",
      trayCode,
    }));
    expect(stagingStockIn.error).toBe("");
    expect(sectionsAfterStockIn.currentStagingRows).toContainEqual(expect.objectContaining({
      source: "外观检测间",
      status: "到货",
      trayCode,
    }));
  });

  test("appearance inspection room uses appearance wording for duplicate stock-in and premature stock-out", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.samples].push(
      {
        id: "sample-appearance-stored",
        code: "SYLU-2026-04-123-SP-001",
        task_code: "SYLU-2026-04-123",
        owner: "周工",
        location: "外观检测间",
        status: "实验后外观检测间存放",
        trays: [{ tray_code: "SYLU-2026-04-123-TP-001", status: "实验后外观检测间存放", quantity: 1 }],
        history: [
          { detail: "SYLU-2026-04-123 / 盐雾试验 / 实验已完成", time: "2026-04-01T09:20:00" },
        ],
      },
      {
        id: "sample-appearance-sent",
        code: "SYLU-2026-04-124-SP-001",
        task_code: "SYLU-2026-04-124",
        owner: "周工",
        location: "外观检测间",
        status: "送至外观检测间",
        trays: [{ tray_code: "SYLU-2026-04-124-TP-001", status: "送至外观检测间", quantity: 1 }],
        history: [
          { detail: "SYLU-2026-04-124 / 霉菌试验 / 实验已完成", time: "2026-04-01T09:20:00" },
        ],
      },
    );

    const duplicateStockIn = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: "SYLU-2026-04-123-TP-001", mode: "stockIn" },
      room: "appearance",
      snapshot,
    });
    const prematureStockOut = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: "SYLU-2026-04-124-TP-001", mode: "stockOut" },
      room: "appearance",
      snapshot,
    });

    expect(duplicateStockIn.error).toBe("该托盘已完成外观检测间扫码入库。");
    expect(prematureStockOut.error).toBe("该托盘尚未完成外观检测间扫码入库。");
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

  test("rejects stock-in for trays that have already progressed in the laboratory", () => {
    ["已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中"].forEach((labStatus, index) => {
      const snapshot = createSnapshot();
      const trayCode = `SYLU-2026-04-109-TP-00${index + 1}`;
      snapshot[STORAGE_KEYS.samples].push({
        id: `sample-109-${index}`,
        code: `SYLU-2026-04-109-SP-00${index + 1}`,
        task_code: "SYLU-2026-04-103",
        owner: "周工",
        location: "盐雾试验室",
        status: labStatus,
        flow_status: labStatus,
        trays: [{ tray_code: trayCode, status: labStatus, quantity: 1 }],
      });
      snapshot[STORAGE_KEYS.staging_events].push({
        id: `evt-109-${index}-out`,
        tray_code: trayCode,
        task_code: "SYLU-2026-04-103",
        action: "stock_out",
        time: "2026-04-01T09:10:00",
        operator: "暂存员B",
        target_lab: "盐雾试验室",
      });
      const stockInCountBefore = snapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_in").length;

      const result = applyZancunInventoryAction({
        now: "2026-04-01T13:00:00",
        payload: {
          code: trayCode,
          mode: "stockIn",
        },
        snapshot,
      });

      const updatedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === `SYLU-2026-04-109-SP-00${index + 1}`);
      expect(result.error).toBe("该托盘已进入试验间流程，不能暂存间入库。");
      expect(result.snapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_in")).toHaveLength(stockInCountBefore);
      expect(updatedSample).toMatchObject({
        location: "盐雾试验室",
        status: labStatus,
        flow_status: labStatus,
      });
      expect(updatedSample.trays[0].status).toBe(labStatus);
    });
  });

  test("withdrawn stock-out events are not counted as stocked out today", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-102-out-withdrawn",
      tray_code: "SYLU-2026-04-102-TP-001",
      task_code: "SYLU-2026-04-102",
      action: "stock_out",
      time: "2026-04-01T09:10:00",
      operator: "暂存员B",
      target_lab: "振动一室",
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-102-withdraw",
      tray_code: "SYLU-2026-04-102-TP-001",
      task_code: "SYLU-2026-04-102",
      action: "stock_out_withdraw",
      time: "2026-04-01T09:30:00",
      operator: "撤回出库",
      target_lab: "振动一室",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const metrics = buildZancunMetrics({
      now: TODAY,
      rows,
      stagingEvents: snapshot[STORAGE_KEYS.staging_events],
    });
    const row = rows.find((item) => item.trayCode === "SYLU-2026-04-102-TP-001");

    expect(row.stockOutToday).toBe(false);
    expect(metrics.stockedOutTodayCount).toBe(1);
  });

  test("withdrawn laboratory stock-out returns the tray to current staging inventory", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-102-out",
      tray_code: "SYLU-2026-04-102-TP-001",
      task_code: "SYLU-2026-04-102",
      action: "stock_out",
      time: "2026-04-01T09:10:00",
      operator: "暂存员B",
      target_lab: "振动一室",
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-102-withdraw",
      tray_code: "SYLU-2026-04-102-TP-001",
      task_code: "SYLU-2026-04-102",
      action: "stock_out_withdraw",
      time: "2026-04-01T09:30:00",
      operator: "实验任务撤回",
      target_lab: "振动一室",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const sections = buildZancunInventorySections(rows);
    const row = rows.find((item) => item.trayCode === "SYLU-2026-04-102-TP-001");

    expect(row?.status).toBe("已到达暂存间");
    expect(row?.location).toBe("恒温恒湿间（暂存间）");
    expect(sections.currentStagingRows.map((item) => item.trayCode)).toContain("SYLU-2026-04-102-TP-001");
  });

  test("sample status alone cannot return a tray to current staging inventory while stock-out is latest", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-102-out",
      tray_code: "SYLU-2026-04-102-TP-001",
      task_code: "SYLU-2026-04-102",
      action: "stock_out",
      time: "2026-04-01T09:10:00",
      operator: "暂存员B",
      target_lab: "振动一室",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const sections = buildZancunInventorySections(rows);
    const row = rows.find((item) => item.trayCode === "SYLU-2026-04-102-TP-001");

    expect(row?.status).toBe("已出库");
    expect(sections.currentStagingRows.map((item) => item.trayCode)).not.toContain("SYLU-2026-04-102-TP-001");
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

    expect(stockInRow?.status).toBe("到货");
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
    expect(stockOutSample?.trays[0]).toMatchObject({
      target_experiment_code: "SYLU-2026-04-102-A",
      target_lab: "振动一室",
    });
    expect(metrics.stockedOutTodayCount).toBe(2);
  });

  test("stock-out rejects a later scheduled salt lab while an earlier experiment remains", () => {
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-102-TP-001",
        mode: "stockOut",
        targetExperimentCode: "SYLU-2026-04-102-B",
        targetLab: "盐雾试验室",
      },
      snapshot: createSnapshot(),
    });
    expect(result.error).toBe("请选择有效的目标实验室后再出库。");
    expect(result.snapshot[STORAGE_KEYS.staging_events].at(-1)?.id).toBe("evt-103-out");
  });

  test("appearance room can stock in a tray dispatched to a mold lab as optional pre-experiment inspection", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-pre-mold-appearance",
      code: "SYLU-2026-06-021",
      test_type: "霉菌试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-pre-mold-appearance",
      task_code: "SYLU-2026-06-021",
      experiment_code: "SYLU-2026-06-021-A",
      experiment_name: "霉菌试验",
      required_device: "霉菌试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-pre-mold-appearance",
      task_code: "SYLU-2026-06-021",
      experiment_code: "SYLU-2026-06-021-A",
      tray_code: "SYLU-2026-06-021-TP-001",
    });
    snapshot[STORAGE_KEYS.schedules].push({
      id: "schedule-pre-mold-appearance",
      task_code: "SYLU-2026-06-021",
      experiment_code: "SYLU-2026-06-021-A",
      device: "霉菌试验室",
      start_at: "2026-06-28T12:00:00",
      end_at: "2026-06-28T15:30:00",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-pre-mold-appearance",
      code: "SYLU-2026-06-021-SP-001",
      task_code: "SYLU-2026-06-021",
      owner: "周工",
      location: "霉菌试验室",
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: [
        {
          tray_code: "SYLU-2026-06-021-TP-001",
          status: "送至实验室",
          quantity: 1,
          target_experiment_code: "SYLU-2026-06-021-A",
          target_lab: "霉菌试验室",
        },
      ],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const sections = buildZancunInventorySections(rows, { room: "appearance" });
    const row = rows.find((item) => item.trayCode === "SYLU-2026-06-021-TP-001");
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-06-021-TP-001",
        mode: "stockIn",
      },
      room: "appearance",
      snapshot,
    });
    const updatedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === "sample-pre-mold-appearance");

    expect(row).toEqual(expect.objectContaining({
      status: "待入库",
      targetExperimentCode: "SYLU-2026-06-021-A",
      targetLab: "霉菌试验室",
      trayCode: "SYLU-2026-06-021-TP-001",
    }));
    expect(sections.plannedInboundRows.map((item) => item.trayCode)).toContain("SYLU-2026-06-021-TP-001");
    expect(result.error).toBe("");
    expect(result.snapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_in",
      room: "appearance",
      tray_code: "SYLU-2026-06-021-TP-001",
    });
    expect(updatedSample).toMatchObject({
      location: "外观检测间",
      status: "实验前外观检测间存放",
      flow_status: "实验前外观检测间存放",
    });
    expect(updatedSample?.trays[0]).toMatchObject({
      status: "实验前外观检测间存放",
      target_experiment_code: "SYLU-2026-06-021-A",
      target_lab: "霉菌试验室",
    });
  });

  test("appearance room plans pre-inspection again after a withdrawal and post-appearance staging cycle", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-07-021";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-post-appearance-to-mold",
      code: taskCode,
      test_type: "霉菌试验 / 盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-post-appearance-mold",
        task_code: taskCode,
        experiment_code: `${taskCode}-A`,
        experiment_name: "霉菌试验",
        required_device: "霉菌试验室",
        status: "已排程",
      },
      {
        id: "exp-post-appearance-salt",
        task_code: taskCode,
        experiment_code: `${taskCode}-B`,
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
        status: "实验已完成",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-post-appearance-mold", task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
      { id: "rel-post-appearance-salt", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] ||= [];
    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      task_code: taskCode,
      experiment_code: `${taskCode}-B`,
      tray_code: trayCode,
      run_tray_status: "实验已完成",
      ended_at: "2026-07-01 16:03:01",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-post-appearance-to-mold",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "霉菌试验室",
      status: "送至实验室",
      flow_status: "送至实验室",
      history: [
        { action: "暂存间扫码出库", detail: `${trayCode} 送至 霉菌试验室`, location: "霉菌试验室", status: "送至实验室", time: "2026-07-01 16:11:41" },
        { action: "暂存间扫码入库", detail: `${trayCode} 已到达暂存间`, location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-07-01 16:11:37" },
        { action: "外观检测间扫码出库", detail: `${trayCode} 送至 恒温恒湿间（暂存间）`, location: "恒温恒湿间（暂存间）", status: "送至暂存间", time: "2026-07-01 16:11:30" },
        { action: "外观检测间扫码入库", detail: `${trayCode} 实验后外观检测间存放`, location: "外观检测间", status: "实验后外观检测间存放", time: "2026-07-01 16:10:54" },
        { action: "实验完成", detail: `${taskCode} / 盐雾试验 / 实验已完成`, location: "盐雾试验室", status: "实验已完成", time: "2026-07-01 16:03:01" },
        { action: "外观检测间扫码出库", detail: `${trayCode} 送至 盐雾试验室`, location: "盐雾试验室", status: "送至实验室", time: "2026-07-01 16:02:43" },
        { action: "外观检测间扫码入库", detail: `${trayCode} 实验前外观检测间存放`, location: "外观检测间", status: "实验前外观检测间存放", time: "2026-07-01 16:02:34" },
      ],
      trays: [
        {
          tray_code: trayCode,
          status: "送至实验室",
          quantity: 1,
          target_experiment_code: `${taskCode}-A`,
          target_lab: "霉菌试验室",
        },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      { id: "post-appearance-pre-in", tray_code: trayCode, task_code: taskCode, room: "appearance", action: "stock_in", appearance_phase: "pre_experiment", target_experiment_code: `${taskCode}-B`, time: "2026-07-01 16:02:34" },
      { id: "post-appearance-pre-out", tray_code: trayCode, task_code: taskCode, room: "appearance", action: "stock_out", appearance_phase: "pre_experiment", target_experiment_code: `${taskCode}-B`, target_lab: "盐雾试验室", target_type: "lab", time: "2026-07-01 16:02:43" },
      { id: "post-appearance-pre-withdraw", tray_code: trayCode, task_code: taskCode, room: "appearance", action: "stock_out_withdraw", target_experiment_code: `${taskCode}-B`, target_lab: "盐雾试验室", time: "2026-07-01 16:02:50" },
      { id: "post-appearance-post-in", tray_code: trayCode, task_code: taskCode, room: "appearance", action: "stock_in", appearance_phase: "post_experiment", target_experiment_code: `${taskCode}-B`, time: "2026-07-01 16:10:54" },
      { id: "post-appearance-post-out-staging", tray_code: trayCode, task_code: taskCode, room: "appearance", action: "stock_out", appearance_phase: "post_experiment", target_lab: "恒温恒湿间（暂存间）", target_type: "staging", time: "2026-07-01 16:11:30" },
      { id: "post-appearance-staging-in", tray_code: trayCode, task_code: taskCode, room: "staging", action: "stock_in", time: "2026-07-01 16:11:37" },
      { id: "post-appearance-staging-out-mold", tray_code: trayCode, task_code: taskCode, room: "staging", action: "stock_out", target_experiment_code: `${taskCode}-A`, target_lab: "霉菌试验室", target_type: "lab", time: "2026-07-01 16:11:41" },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-07-01 16:12:00", room: "appearance" });
    const row = rows.find((item) => item.trayCode === trayCode);
    const sections = buildZancunInventorySections(rows, { room: "appearance" });

    expect(row).toEqual(expect.objectContaining({ status: "待入库" }));
    expect(sections.plannedInboundRows.map((row) => row.trayCode)).toContain(trayCode);
  });

  test("appearance room can stock in a tray dispatched to a high-low temperature humidity lab as optional pre-experiment inspection", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-pre-humidity-appearance",
      code: "SYLU-2026-06-027",
      test_type: "高低温湿热试验",
      sample_type: "线缆",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-pre-humidity-appearance",
      task_code: "SYLU-2026-06-027",
      experiment_code: "SYLU-2026-06-027-A",
      experiment_name: "高低温湿热试验",
      required_device: "高低温湿热一室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-pre-humidity-appearance",
      task_code: "SYLU-2026-06-027",
      experiment_code: "SYLU-2026-06-027-A",
      tray_code: "SYLU-2026-06-027-TP-001",
    });
    snapshot[STORAGE_KEYS.schedules].push({
      id: "schedule-pre-humidity-appearance",
      task_code: "SYLU-2026-06-027",
      experiment_code: "SYLU-2026-06-027-A",
      device: "高低温湿热一室",
      start_at: "2026-06-28T12:00:00",
      end_at: "2026-06-28T15:30:00",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-pre-humidity-appearance",
      code: "SYLU-2026-06-027-SP-001",
      task_code: "SYLU-2026-06-027",
      owner: "周工",
      location: "高低温湿热一室",
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: [
        {
          tray_code: "SYLU-2026-06-027-TP-001",
          status: "送至实验室",
          quantity: 1,
          target_experiment_code: "SYLU-2026-06-027-A",
          target_lab: "高低温湿热一室",
        },
      ],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const sections = buildZancunInventorySections(rows, { room: "appearance" });
    const row = rows.find((item) => item.trayCode === "SYLU-2026-06-027-TP-001");
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-06-027-TP-001",
        mode: "stockIn",
      },
      room: "appearance",
      snapshot,
    });
    const updatedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === "sample-pre-humidity-appearance");

    expect(row).toEqual(expect.objectContaining({
      status: "待入库",
      targetExperimentCode: "SYLU-2026-06-027-A",
      targetLab: "高低温湿热一室",
      trayCode: "SYLU-2026-06-027-TP-001",
    }));
    expect(sections.plannedInboundRows.map((item) => item.trayCode)).toContain("SYLU-2026-06-027-TP-001");
    expect(result.error).toBe("");
    expect(updatedSample).toMatchObject({
      location: "外观检测间",
      status: "实验前外观检测间存放",
      flow_status: "实验前外观检测间存放",
    });
    expect(updatedSample?.trays[0]).toMatchObject({
      status: "实验前外观检测间存放",
      target_experiment_code: "SYLU-2026-06-027-A",
      target_lab: "高低温湿热一室",
    });
  });

  test("allows high-humidity pre-inspection after a completed salt pre-and-post appearance cycle", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;
    const saltExperimentCode = `${taskCode}-A`;
    const humidityExperimentCode = `${taskCode}-B`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-001-pre-inspection-cycle",
      code: taskCode,
      test_type: "盐雾试验 / 高低温湿热试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-001-salt",
        task_code: taskCode,
        experiment_code: saltExperimentCode,
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
      {
        id: "exp-001-humidity",
        task_code: taskCode,
        experiment_code: humidityExperimentCode,
        experiment_name: "高低温湿热试验",
        required_device: "高低温湿热一室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-001-salt", task_code: taskCode, experiment_code: saltExperimentCode, tray_code: trayCode },
      { id: "rel-001-humidity", task_code: taskCode, experiment_code: humidityExperimentCode, tray_code: trayCode },
    );
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-001-pre-inspection-cycle",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "高低温湿热一室",
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: [{
        tray_code: trayCode,
        status: "送至实验室",
        quantity: 1,
        target_experiment_code: humidityExperimentCode,
        target_lab: "高低温湿热一室",
      }],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "001-salt-pre-in",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_in",
        appearance_phase: "pre_experiment",
        target_experiment_code: saltExperimentCode,
        time: "2026-07-13T19:35:00",
      },
      {
        id: "001-salt-pre-out",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_out",
        appearance_phase: "pre_experiment",
        target_experiment_code: saltExperimentCode,
        target_lab: "盐雾试验室",
        target_type: "lab",
        time: "2026-07-13T19:35:30",
      },
      {
        id: "001-salt-post-in",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_in",
        appearance_phase: "post_experiment",
        target_experiment_code: saltExperimentCode,
        time: "2026-07-13T19:36:00",
      },
      {
        id: "001-salt-post-out",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_out",
        appearance_phase: "post_experiment",
        target_lab: "恒温恒湿间（暂存间）",
        target_type: "staging",
        time: "2026-07-13T19:36:20",
      },
      {
        id: "001-staging-in",
        tray_code: trayCode,
        task_code: taskCode,
        room: "staging",
        action: "stock_in",
        time: "2026-07-13T19:36:30",
      },
      {
        id: "001-humidity-dispatch",
        tray_code: trayCode,
        task_code: taskCode,
        room: "staging",
        action: "stock_out",
        target_experiment_code: humidityExperimentCode,
        target_lab: "高低温湿热一室",
        target_type: "lab",
        time: "2026-07-13T19:36:40",
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-07-13T19:37:00", room: "appearance" });
    const row = rows.find((item) => item.trayCode === trayCode);
    const result = applyZancunInventoryAction({
      now: "2026-07-13T19:37:00",
      payload: { code: trayCode, mode: "stockIn" },
      room: "appearance",
      snapshot,
    });

    expect(row).toEqual(expect.objectContaining({
      status: "待入库",
    }));
    expect(result.error).toBe("");
    expect(result.snapshot[STORAGE_KEYS.staging_events].at(-1)).toEqual(expect.objectContaining({
      action: "stock_in",
      appearance_phase: "pre_experiment",
      target_experiment_code: humidityExperimentCode,
    }));
    expect(result.row).toEqual(expect.objectContaining({ status: "实验前外观检测间存放" }));
  });

  test("appearance room can stock in a salt tray from neutral completed status", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-026";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-026",
      code: taskCode,
      test_type: "盐雾试验 / 振动试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-026-a",
        task_code: taskCode,
        experiment_code: `${taskCode}-A`,
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
      {
        id: "exp-026-b",
        task_code: taskCode,
        experiment_code: `${taskCode}-B`,
        experiment_name: "振动试验",
        required_device: "振动一室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-026-a", task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
      { id: "rel-026-b", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] ||= [];
    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      task_code: taskCode,
      experiment_code: `${taskCode}-A`,
      tray_code: trayCode,
      run_tray_status: "实验已完成",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-026-001",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "盐雾试验室",
      status: "实验已完成",
      flow_status: "实验已完成",
      trays: [{ tray_code: trayCode, status: "实验已完成", quantity: 1 }],
      history: [
        { action: "实验完成", detail: `${taskCode} / 盐雾试验 / 实验已完成`, location: "盐雾试验室", status: "实验已完成", time: "2026-06-14 10:00:00" },
      ],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const row = rows.find((item) => item.trayCode === trayCode);
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: trayCode,
        mode: "stockIn",
      },
      room: "appearance",
      snapshot,
    });

    expect(row).toEqual(expect.objectContaining({ status: "待入库" }));
    expect(result.error).toBe("");
    expect(result.snapshot[STORAGE_KEYS.staging_events].at(-1)).toEqual(expect.objectContaining({
      action: "stock_in",
      location: "外观检测间",
      room: "appearance",
      status: "实验后外观检测间存放",
    }));
    expect(result.row).toEqual(expect.objectContaining({ status: "实验后外观检测间存放" }));
    expect(result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === `${taskCode}-SP-001`)).toMatchObject({
      location: "外观检测间",
      status: "实验后外观检测间存放",
      flow_status: "实验后外观检测间存放",
      trays: [expect.objectContaining({ status: "实验后外观检测间存放" })],
    });
  });

  test("appearance room hides repeat pre-experiment stock-in after appearance dispatch to salt lab", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-repeat-pre-salt-appearance",
      code: "SYLU-2026-06-041",
      test_type: "盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-repeat-pre-salt-appearance",
      task_code: "SYLU-2026-06-041",
      experiment_code: "SYLU-2026-06-041-A",
      experiment_name: "盐雾试验",
      required_device: "盐雾试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-repeat-pre-salt-appearance",
      task_code: "SYLU-2026-06-041",
      experiment_code: "SYLU-2026-06-041-A",
      tray_code: "SYLU-2026-06-041-TP-001",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-repeat-pre-salt-appearance",
      code: "SYLU-2026-06-041-SP-001",
      task_code: "SYLU-2026-06-041",
      owner: "周工",
      location: "盐雾试验室",
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: [
        {
          tray_code: "SYLU-2026-06-041-TP-001",
          status: "送至实验室",
          quantity: 1,
          target_experiment_code: "SYLU-2026-06-041-A",
          target_lab: "盐雾试验室",
        },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "repeat-pre-salt-appearance-in",
        tray_code: "SYLU-2026-06-041-TP-001",
        task_code: "SYLU-2026-06-041",
        room: "appearance",
        action: "stock_in",
        appearance_phase: "pre_experiment",
        target_experiment_code: "SYLU-2026-06-041-A",
        time: "2026-06-06T21:40:00",
      },
      {
        id: "repeat-pre-salt-appearance-out",
        tray_code: "SYLU-2026-06-041-TP-001",
        task_code: "SYLU-2026-06-041",
        room: "appearance",
        action: "stock_out",
        appearance_phase: "pre_experiment",
        target_lab: "盐雾试验室",
        target_experiment_code: "SYLU-2026-06-041-A",
        target_type: "lab",
        time: "2026-06-06T21:50:00",
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const sections = buildZancunInventorySections(rows, { room: "appearance" });
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-06-041-TP-001",
        mode: "stockIn",
      },
      room: "appearance",
      snapshot,
    });

    expect(rows).toContainEqual(expect.objectContaining({
      status: "已出库",
      trayCode: "SYLU-2026-06-041-TP-001",
    }));
    expect(sections.plannedInboundRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-06-041-TP-001");
    expect(result.error).toBe("该托盘未送至外观检测间，不能外观检测间入库。");
  });

  test("appearance room hides repeat pre-experiment stock-in after appearance dispatch through staging", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-042";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-repeat-pre-mold-staging",
      code: taskCode,
      test_type: "霉菌试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-repeat-pre-mold-staging",
      task_code: taskCode,
      experiment_code: experimentCode,
      experiment_name: "霉菌试验",
      required_device: "霉菌试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-repeat-pre-mold-staging",
      task_code: taskCode,
      experiment_code: experimentCode,
      tray_code: trayCode,
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-repeat-pre-mold-staging",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "霉菌试验室",
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: [{
        tray_code: trayCode,
        status: "送至实验室",
        quantity: 1,
        target_experiment_code: experimentCode,
        target_lab: "霉菌试验室",
      }],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "repeat-pre-mold-staging-appearance-in",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_in",
        appearance_phase: "pre_experiment",
        target_experiment_code: experimentCode,
        time: "2026-06-06T22:40:00",
      },
      {
        id: "repeat-pre-mold-staging-appearance-out",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_out",
        appearance_phase: "pre_experiment",
        target_lab: "恒温恒湿间（暂存间）",
        target_type: "staging",
        time: "2026-06-06T22:41:00",
      },
      {
        id: "repeat-pre-mold-staging-in",
        tray_code: trayCode,
        task_code: taskCode,
        room: "staging",
        action: "stock_in",
        time: "2026-06-06T22:42:00",
      },
      {
        id: "repeat-pre-mold-staging-out",
        tray_code: trayCode,
        task_code: taskCode,
        room: "staging",
        action: "stock_out",
        target_experiment_code: experimentCode,
        target_lab: "霉菌试验室",
        target_type: "lab",
        time: "2026-06-06T22:43:00",
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const sections = buildZancunInventorySections(rows, { room: "appearance" });
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: trayCode, mode: "stockIn" },
      room: "appearance",
      snapshot,
    });

    expect(rows).toContainEqual(expect.objectContaining({ status: "已出库", trayCode }));
    expect(sections.plannedInboundRows.map((row) => row.trayCode)).not.toContain(trayCode);
    expect(result.error).toBe("该托盘未送至外观检测间，不能外观检测间入库。");
  });

  test("appearance withdrawal from staging dispatch restores post-experiment appearance storage instead of old pre-experiment storage", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-023";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-appearance-withdraw-staging-dispatch",
      code: taskCode,
      test_type: "霉菌试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-appearance-withdraw-mold",
      task_code: taskCode,
      experiment_code: `${taskCode}-A`,
      experiment_name: "霉菌试验",
      required_device: "霉菌试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-appearance-withdraw-mold",
      task_code: taskCode,
      experiment_code: `${taskCode}-A`,
      tray_code: trayCode,
    });
    snapshot[STORAGE_KEYS.experiment_run_trays] ||= [];
    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      task_code: taskCode,
      experiment_code: `${taskCode}-A`,
      tray_code: trayCode,
      run_tray_status: "实验已完成",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-withdraw-staging-dispatch",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "扫码登记",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      flow_status: "实验后外观检测间存放",
      history: [
        {
          action: "外观检测间扫码入库",
          detail: `${trayCode} 实验前外观检测间存放`,
          location: "外观检测间",
          status: "实验前外观检测间存放",
          time: "2026-06-30 21:56:55",
        },
        {
          action: "外观检测间扫码出库",
          detail: `${trayCode} 送至 霉菌试验室`,
          location: "霉菌试验室",
          status: "送至实验室",
          time: "2026-06-30 21:56:59",
        },
        {
          action: "实验完成",
          detail: `${taskCode} / 霉菌试验 / 实验已完成`,
          location: "霉菌试验室",
          status: "实验已完成",
          time: "2026-06-30 21:57:20",
        },
        {
          action: "外观检测间扫码入库",
          detail: `${trayCode} 实验后外观检测间存放`,
          location: "外观检测间",
          status: "实验后外观检测间存放",
          time: "2026-06-30 21:57:26",
        },
        {
          action: "外观检测间扫码出库",
          detail: `${trayCode} 送至 恒温恒湿间（暂存间）`,
          location: "恒温恒湿间（暂存间）",
          status: "送至暂存间",
          time: "2026-06-30 21:57:34",
        },
        {
          action: "撤回出库",
          detail: `${trayCode} 撤回出库至实验后外观检测间存放`,
          location: "外观检测间",
          status: "实验后外观检测间存放",
          time: "2026-06-30 21:57:40",
        },
      ],
      trays: [
        {
          tray_code: trayCode,
          status: "实验后外观检测间存放",
          quantity: 1,
          target_experiment_code: `${taskCode}-A`,
          target_lab: "霉菌试验室",
        },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "appearance-withdraw-pre-in",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_in",
        time: "2026-06-30 21:56:55",
      },
      {
        id: "appearance-withdraw-pre-out",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_out",
        appearance_phase: "pre_experiment",
        target_experiment_code: `${taskCode}-A`,
        target_lab: "霉菌试验室",
        target_type: "lab",
        time: "2026-06-30 21:56:59",
      },
      {
        id: "appearance-withdraw-post-in",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_in",
        time: "2026-06-30 21:57:26",
      },
      {
        id: "appearance-withdraw-post-out-to-staging",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_out",
        target_lab: "恒温恒湿间（暂存间）",
        target_type: "staging",
        time: "2026-06-30 21:57:34",
      },
      {
        id: "appearance-withdraw-post-out-to-staging-withdrawn",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_out_withdraw",
        target_lab: "恒温恒湿间（暂存间）",
        time: "2026-06-30 21:57:40",
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-30 21:58:00", room: "appearance" });

    expect(rows.find((row) => row.trayCode === trayCode)).toEqual(expect.objectContaining({
      status: "实验后外观检测间存放",
      statusLabel: "实验后外观检测间存放",
      trayCode,
    }));
  });

  test("appearance room uses the latest withdrawal restore status after multiple lab withdrawals", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-withdrawn-appearance",
      code: taskCode,
      test_type: "四综合试验 / 霉菌试验 / 盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-withdrawn-mold",
        task_code: taskCode,
        experiment_code: `${taskCode}-B`,
        experiment_name: "霉菌试验",
        required_device: "霉菌试验室",
      },
      {
        id: "exp-withdrawn-salt",
        task_code: taskCode,
        experiment_code: `${taskCode}-C`,
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-withdrawn-mold", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      { id: "rel-withdrawn-salt", task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
    );
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-withdrawn-appearance",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "扫码登记",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      flow_status: "实验后外观检测间存放",
      history: [
        {
          action: "实验任务撤回",
          detail: `${taskCode} / 盐雾试验 / 撤回至实验后外观检测间存放（试验间内撤回当前实验任务）`,
          location: "外观检测间",
          status: "实验后外观检测间存放",
          time: "2026-06-23 16:27:27",
        },
        {
          action: "实验任务撤回",
          detail: `${taskCode} / 霉菌试验 / 撤回至实验前外观检测间存放（试验间内撤回当前实验任务）`,
          location: "外观检测间",
          status: "实验前外观检测间存放",
          time: "2026-06-23 16:27:05",
        },
        {
          action: "外观检测间扫码入库",
          detail: `${trayCode} 实验前外观检测间存放`,
          location: "外观检测间",
          status: "实验前外观检测间存放",
          time: "2026-06-23 16:26:51",
        },
      ],
      trays: [
        {
          tray_code: trayCode,
          status: "实验后外观检测间存放",
          quantity: 1,
          target_experiment_code: `${taskCode}-C`,
          target_lab: "盐雾试验室",
        },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "withdrawn-appearance-in",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_in",
        time: "2026-06-23 16:26:51",
      },
      {
        id: "withdrawn-appearance-out-mold",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_out",
        target_experiment_code: `${taskCode}-B`,
        target_lab: "霉菌试验室",
        target_type: "lab",
        time: "2026-06-23 16:26:54",
      },
      {
        id: "withdrawn-appearance-return-mold",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_out_withdraw",
        target_experiment_code: `${taskCode}-B`,
        target_lab: "霉菌试验室",
        time: "2026-06-23 16:27:05",
      },
      {
        id: "withdrawn-appearance-out-salt",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_out",
        target_experiment_code: `${taskCode}-C`,
        target_lab: "盐雾试验室",
        target_type: "lab",
        time: "2026-06-23 16:27:12",
      },
      {
        id: "withdrawn-appearance-return-salt",
        tray_code: trayCode,
        task_code: taskCode,
        room: "appearance",
        action: "stock_out_withdraw",
        target_experiment_code: `${taskCode}-C`,
        target_lab: "盐雾试验室",
        time: "2026-06-23 16:27:27",
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-23 16:28:00", room: "appearance" });
    const sections = buildZancunInventorySections(rows, { room: "appearance" });

    expect(rows.find((row) => row.trayCode === trayCode)).toEqual(expect.objectContaining({
      status: "实验后外观检测间存放",
      statusLabel: "实验后外观检测间存放",
      trayCode,
    }));
    expect(sections.currentStagingRows.map((row) => row.trayCode)).toContain(trayCode);
  });

  test("appearance room does not use sample status when tray status is missing", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-pre-mold-appearance-missing-tray-status",
      code: "SYLU-2026-06-022",
      test_type: "霉菌试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-pre-mold-appearance-missing-tray-status",
      task_code: "SYLU-2026-06-022",
      experiment_code: "SYLU-2026-06-022-A",
      experiment_name: "霉菌试验",
      required_device: "霉菌试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-pre-mold-appearance-missing-tray-status",
      task_code: "SYLU-2026-06-022",
      experiment_code: "SYLU-2026-06-022-A",
      tray_code: "SYLU-2026-06-022-TP-001",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-pre-mold-appearance-missing-tray-status",
      code: "SYLU-2026-06-022-SP-001",
      task_code: "SYLU-2026-06-022",
      owner: "周工",
      location: "霉菌试验室",
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: [
        {
          tray_code: "SYLU-2026-06-022-TP-001",
          quantity: 1,
          target_experiment_code: "SYLU-2026-06-022-A",
          target_lab: "霉菌试验室",
        },
      ],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const sections = buildZancunInventorySections(rows, { room: "appearance" });

    expect(rows.map((row) => row.trayCode)).not.toContain("SYLU-2026-06-022-TP-001");
    expect(sections.plannedInboundRows.map((row) => row.trayCode)).not.toContain("SYLU-2026-06-022-TP-001");
  });

  test("pre-experiment appearance stock-in preserves the original lab target when the room destination differs", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-pre-mold-appearance-unscheduled",
      code: "SYLU-2026-06-031",
      test_type: "霉菌试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-pre-mold-appearance-unscheduled",
      task_code: "SYLU-2026-06-031",
      experiment_code: "SYLU-2026-06-031-A",
      experiment_name: "霉菌试验",
      required_device: "",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-pre-mold-appearance-unscheduled",
      task_code: "SYLU-2026-06-031",
      experiment_code: "SYLU-2026-06-031-A",
      tray_code: "SYLU-2026-06-031-TP-001",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-pre-mold-appearance-unscheduled",
      code: "SYLU-2026-06-031-SP-001",
      task_code: "SYLU-2026-06-031",
      owner: "周工",
      location: "霉菌试验室",
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: [
        {
          tray_code: "SYLU-2026-06-031-TP-001",
          status: "送至实验室",
          quantity: 1,
          target_experiment_code: "SYLU-2026-06-031-A",
          target_lab: "霉菌试验室",
        },
      ],
    });

    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-06-031-TP-001",
        mode: "stockIn",
      },
      room: "appearance",
      snapshot,
    });
    const updatedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === "sample-pre-mold-appearance-unscheduled");
    const rowsAfterStockIn = buildZancunRowsFromSnapshot(result.snapshot, { now: TODAY, room: "appearance" });
    const sectionsAfterStockIn = buildZancunInventorySections(rowsAfterStockIn, { room: "appearance" });

    expect(result.error).toBe("");
    expect(result.snapshot[STORAGE_KEYS.staging_events].at(-1)).toEqual(expect.objectContaining({
      action: "stock_in",
      location: "外观检测间",
      room: "appearance",
      status: "实验前外观检测间存放",
    }));
    expect(updatedSample?.trays[0]).toMatchObject({
      status: "实验前外观检测间存放",
      target_experiment_code: "SYLU-2026-06-031-A",
      target_lab: "霉菌试验室",
    });
    expect(sectionsAfterStockIn.currentStagingRows).toContainEqual(expect.objectContaining({
      status: "实验前外观检测间存放",
      trayCode: "SYLU-2026-06-031-TP-001",
    }));
  });

  test("pre-experiment appearance ignores stale target metadata and exposes only the next schedule", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.experiments] = snapshot[STORAGE_KEYS.experiments].map((experiment) => (
      experiment.experiment_code === "SYLU-2026-04-102-A"
        ? { ...experiment, experiment_name: "霉菌试验", required_device: "霉菌试验室" }
        : experiment
    ));
    snapshot[STORAGE_KEYS.schedules] = snapshot[STORAGE_KEYS.schedules].map((schedule) => {
      if (schedule.id === "schedule-102-lab") {
        return { ...schedule, device: "霉菌试验室", experiment_name: "霉菌试验" };
      }
      return schedule;
    });
    snapshot[STORAGE_KEYS.samples] = snapshot[STORAGE_KEYS.samples].map((sample) => (
      sample.code === "SYLU-2026-04-102-SP-001"
        ? {
            ...sample,
            flow_status: "实验前外观检测间存放",
            location: "外观检测间",
            status: "实验前外观检测间存放",
            trays: sample.trays.map((tray) => ({
              ...tray,
              status: "实验前外观检测间存放",
              target_experiment_code: "SYLU-2026-04-102-B",
              target_lab: "盐雾试验室",
            })),
          }
        : sample
    ));

    const row = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" })
      .find((item) => item.trayCode === "SYLU-2026-04-102-TP-001");

    expect(row?.targetDestinations.map((destination) => destination.targetLab)).toEqual([
      "霉菌试验室",
      "恒温恒湿间（暂存间）",
    ]);
    expect(row?.targetDestinations[0]).toMatchObject({
      preferred: true,
      targetAvailable: true,
      targetExperimentCode: "SYLU-2026-04-102-A",
      targetLab: "霉菌试验室",
      targetUnavailableReason: "",
    });
    expect(row?.targetLab).toBe("霉菌试验室");
  });

  test("stock-out selects a destination by lab code when display names differ", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.schedules] = snapshot[STORAGE_KEYS.schedules].map((schedule) => (
      schedule.id === "schedule-102-lab"
        ? { ...schedule, device: "振动试验一室", lab_code: "LAB_VIBRATION_1", lab_id: 11 }
        : schedule
    ));

    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-102-TP-001",
        mode: "stockOut",
        targetLab: "振动一室",
        targetLabCode: "LAB_VIBRATION_1",
      },
      snapshot,
    });
    const stockOutSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === "SYLU-2026-04-102-SP-001");

    expect(result.error).toBe("");
    expect(result.snapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_out",
      target_lab: "振动试验一室",
      target_lab_code: "LAB_VIBRATION_1",
      target_lab_id: 11,
    });
    expect(stockOutSample).toMatchObject({
      location: "振动试验一室",
      status: "送至实验室",
    });
    expect(stockOutSample?.trays[0]).toMatchObject({
      target_lab: "振动试验一室",
      target_lab_code: "LAB_VIBRATION_1",
      target_lab_id: 11,
    });
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

  test("appearance inspection room rejects manufacturer return", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-return",
      code: "SYLU-2026-04-130-SP-001",
      task_code: "SYLU-2026-04-130",
      owner: "周工",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      flow_status: "实验后外观检测间存放",
      trays: [{ tray_code: "SYLU-2026-04-130-TP-001", status: "实验后外观检测间存放", quantity: 1 }],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-appearance-return-in",
      tray_code: "SYLU-2026-04-130-TP-001",
      task_code: "SYLU-2026-04-130",
      room: "appearance",
      action: "stock_in",
      time: "2026-04-01T11:00:00",
    });

    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-130-TP-001",
        mode: "manufacturerReturn",
        room: "appearance",
      },
      room: "appearance",
      snapshot,
    });

    expect(result.error).toBe("外观检测间不允许厂家收回，请先出库至下一去向。");
    expect(result.snapshot[STORAGE_KEYS.staging_events].some((event) => event.action === "manufacturer_return")).toBe(false);
  });

  test("manufacturer return marks the task archived when every assigned tray is returned", () => {
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-102-TP-001",
        mode: "manufacturerReturn",
      },
      snapshot: createSnapshot(),
    });

    const updatedTask = result.snapshot[STORAGE_KEYS.tasks].find((task) => task.code === "SYLU-2026-04-102");

    expect(updatedTask).toMatchObject({
      status: "厂家收回",
      transfer_status: "厂家收回",
    });
  });

  test("manufacturer return prunes schedules for experiments whose scoped trays are completed or returned", () => {
    const taskCode = "SYLU-2026-06-021";
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-021",
      code: taskCode,
      test_type: "冲击试验 / 温度冲击试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      { id: "exp-021-a", task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", required_device: "冲击二室" },
      { id: "exp-021-b", task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", required_device: "温度冲击二室" },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-021-a-1", task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: `${taskCode}-TP-001` },
      { id: "rel-021-a-3", task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: `${taskCode}-TP-003` },
      { id: "rel-021-b-2", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: `${taskCode}-TP-002` },
      { id: "rel-021-b-4", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: `${taskCode}-TP-004` },
    );
    snapshot[STORAGE_KEYS.schedules].push(
      { id: "schedule-021-a", task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", device: "冲击二室" },
      { id: "schedule-021-b", task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", device: "温度冲击二室" },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      ...(snapshot[STORAGE_KEYS.experiment_run_trays] || []),
      { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: `${taskCode}-TP-001`, run_tray_status: "实验已完成" },
      { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: `${taskCode}-TP-002`, run_tray_status: "实验已完成" },
    ];
    snapshot[STORAGE_KEYS.samples].push(
      {
        id: "sample-021-1",
        code: `${taskCode}-SP-001`,
        task_code: taskCode,
        location: "冲击二室",
        status: "实验已完成",
        trays: [{ tray_code: `${taskCode}-TP-001`, status: "实验已完成", quantity: 1 }],
      },
      {
        id: "sample-021-2",
        code: `${taskCode}-SP-002`,
        task_code: taskCode,
        location: "温度冲击二室",
        status: "实验已完成",
        trays: [{ tray_code: `${taskCode}-TP-002`, status: "实验已完成", quantity: 1 }],
      },
      {
        id: "sample-021-3",
        code: `${taskCode}-SP-003`,
        task_code: taskCode,
        location: "恒温恒湿间（实验后暂存间）",
        status: "实验后暂存间存放",
        trays: [{ tray_code: `${taskCode}-TP-003`, status: "实验后暂存间存放", quantity: 1 }],
      },
      {
        id: "sample-021-4",
        code: `${taskCode}-SP-004`,
        task_code: taskCode,
        location: "厂家收回",
        status: "厂家收回",
        trays: [{ tray_code: `${taskCode}-TP-004`, status: "厂家收回", quantity: 1 }],
      },
    );
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "evt-021-3-in",
        action: "stock_in",
        task_code: taskCode,
        time: "2026-06-05T12:30:00",
        tray_code: `${taskCode}-TP-003`,
      },
      {
        id: "evt-021-4-return",
        action: "manufacturer_return",
        task_code: taskCode,
        target_lab: "厂家收回",
        time: "2026-06-05T12:31:00",
        tray_code: `${taskCode}-TP-004`,
      },
    );

    const result = applyZancunInventoryAction({
      now: "2026-06-05T12:35:00",
      payload: {
        code: `${taskCode}-TP-003`,
        mode: "manufacturerReturn",
      },
      snapshot,
    });

    expect(result.error).toBe("");
    expect(result.snapshot[STORAGE_KEYS.schedules].map((schedule) => schedule.id)).not.toEqual(
      expect.arrayContaining(["schedule-021-a", "schedule-021-b"]),
    );
    expect(result.snapshot[STORAGE_KEYS.experiments]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ experiment_code: `${taskCode}-A`, status: "实验已完成" }),
        expect.objectContaining({ experiment_code: `${taskCode}-B`, status: "实验已完成" }),
      ]),
    );
  });

  test("rejects stock-in after a tray has been returned to manufacturer", () => {
    const returnedResult = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-102-TP-001",
        mode: "manufacturerReturn",
      },
      snapshot: createSnapshot(),
    });
    const stockInCountBefore = returnedResult.snapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_in").length;

    const result = applyZancunInventoryAction({
      now: "2026-04-01T13:00:00",
      payload: {
        code: "SYLU-2026-04-102-TP-001",
        mode: "stockIn",
      },
      snapshot: returnedResult.snapshot,
    });

    const updatedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === "SYLU-2026-04-102-SP-001");

    expect(result.error).toBe("该托盘已厂家收回，不能再次入库。");
    expect(result.snapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_in")).toHaveLength(stockInCountBefore);
    expect(updatedSample).toMatchObject({
      location: "厂家收回",
      status: "厂家收回",
      flow_status: "厂家收回",
    });
  });

  test("allows stock-in for another tray from the same task after one tray was returned", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-107",
      code: "SYLU-2026-04-107",
      test_type: "盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.samples].push(
      {
        id: "sample-107-a",
        code: "SYLU-2026-04-107-SP-001",
        task_code: "SYLU-2026-04-107",
        owner: "吴工",
        location: "恒温恒湿间（暂存间）",
        status: "已到达暂存间",
        trays: [{ tray_code: "SYLU-2026-04-107-TP-001", status: "已到达暂存间", quantity: 1 }],
      },
      {
        id: "sample-107-b",
        code: "SYLU-2026-04-107-SP-002",
        task_code: "SYLU-2026-04-107",
        owner: "吴工",
        location: "恒温恒湿间（暂存间）",
        status: "送至暂存间",
        trays: [{ tray_code: "SYLU-2026-04-107-TP-002", status: "送至暂存间", quantity: 1 }],
      },
    );
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-107-in",
      tray_code: "SYLU-2026-04-107-TP-001",
      task_code: "SYLU-2026-04-107",
      action: "stock_in",
      time: "2026-04-01T09:30:00",
      operator: "暂存员A",
    });

    const returnedResult = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-04-107-TP-001",
        mode: "manufacturerReturn",
      },
      snapshot,
    });
    const result = applyZancunInventoryAction({
      now: "2026-04-01T13:00:00",
      payload: {
        code: "SYLU-2026-04-107-TP-002",
        mode: "stockIn",
      },
      snapshot: returnedResult.snapshot,
    });

    const stockedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === "SYLU-2026-04-107-SP-002");

    expect(result.error).toBe("");
    expect(stockedSample).toMatchObject({
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      trays: [expect.objectContaining({ tray_code: "SYLU-2026-04-107-TP-002", status: "已到达暂存间" })],
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
      location: "恒温恒湿间（实验后暂存间）",
      status: "实验后暂存间存放",
      flow_status: "实验后暂存间存放",
    });
    expect(updatedSample?.trays).toContainEqual(
      expect.objectContaining({
        tray_code: "SYLU-2026-04-107-TP-001",
        status: "实验后暂存间存放",
      }),
    );

    const updatedRows = buildZancunRowsFromSnapshot(result.snapshot, { now: TODAY });
    const updatedSections = buildZancunInventorySections(updatedRows);
    const updatedRow = updatedRows.find((row) => row.trayCode === "SYLU-2026-04-107-TP-001");
    expect(updatedRow?.status).toBe("实验后暂存间存放");
    expect(updatedSections.currentStagingRows.map((row) => row.trayCode)).toContain("SYLU-2026-04-107-TP-001");
  });

  test("syncs partially completed tray samples into normal staging on stock-in", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-025",
      code: "SYLU-2026-06-025",
      test_type: "盐雾试验 / 振动试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-025-a",
        task_code: "SYLU-2026-06-025",
        experiment_code: "SYLU-2026-06-025-A",
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
      {
        id: "exp-025-b",
        task_code: "SYLU-2026-06-025",
        experiment_code: "SYLU-2026-06-025-B",
        experiment_name: "振动试验",
        required_device: "振动一室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      {
        id: "rel-025-a-001",
        task_code: "SYLU-2026-06-025",
        experiment_code: "SYLU-2026-06-025-A",
        tray_code: "SYLU-2026-06-025-TP-001",
      },
      {
        id: "rel-025-b-001",
        task_code: "SYLU-2026-06-025",
        experiment_code: "SYLU-2026-06-025-B",
        tray_code: "SYLU-2026-06-025-TP-001",
      },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] ||= [];
    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      run_no: "run-salt-001",
      task_code: "SYLU-2026-06-025",
      experiment_code: "SYLU-2026-06-025-A",
      tray_code: "SYLU-2026-06-025-TP-001",
      run_tray_status: "实验已完成",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-025-001",
      code: "SYLU-2026-06-025-SP-001",
      task_code: "SYLU-2026-06-025",
      owner: "周工",
      location: "盐雾试验室",
      status: "实验已完成",
      flow_status: "实验已完成",
      trays: [{ tray_code: "SYLU-2026-06-025-TP-001", status: "实验已完成", quantity: 1 }],
      history: [
        { detail: "SYLU-2026-06-025 / 盐雾试验 / 实验已完成", time: "2026-06-14 10:00:00" },
      ],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "staging" });
    const row = rows.find((item) => item.trayCode === "SYLU-2026-06-025-TP-001");
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: "SYLU-2026-06-025-TP-001",
        mode: "stockIn",
      },
      snapshot,
    });

    expect(row).toEqual(expect.objectContaining({ isPostExperimentInbound: false, status: "待入库" }));
    expect(result.error).toBe("");
    expect(result.row).toEqual(expect.objectContaining({ status: "到货" }));
    const updatedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === "SYLU-2026-06-025-SP-001");
    expect(updatedSample).toEqual(expect.objectContaining({
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      flow_status: "已到达暂存间",
    }));
    expect(updatedSample?.trays[0]).toEqual(expect.objectContaining({
      status: "已到达暂存间",
    }));
  });

  test("allows partial-axis vibration completion into post-experiment staging and scan lookup", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const experimentCode = `${taskCode}-VIB`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-axis-partial-staging",
      code: taskCode,
      test_type: "振动试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-axis-partial-vibration",
      task_code: taskCode,
      experiment_code: experimentCode,
      experiment_name: "振动试验",
      required_device: "振动一室",
      axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-axis-partial-vibration",
      task_code: taskCode,
      experiment_code: experimentCode,
      tray_code: trayCode,
    });
    snapshot[STORAGE_KEYS.schedules].push({
      id: "schedule-axis-partial-z",
      task_code: taskCode,
      experiment_code: experimentCode,
      experiment_name: "振动试验",
      device: "振动一室",
      start_at: "2026-06-21T09:00:00",
      end_at: "2026-06-21T12:00:00",
      axis_codes: ["z+", "z-"],
      sub_experiment_code: firstSubExperimentCode,
    }, {
      id: "schedule-axis-partial-xy",
      task_code: taskCode,
      experiment_code: experimentCode,
      experiment_name: "振动试验",
      device: "振动一室",
      start_at: "2026-06-22T09:00:00",
      end_at: "2026-06-22T12:00:00",
      axis_codes: ["x+", "x-", "y+", "y-"],
      sub_experiment_code: secondSubExperimentCode,
    });
    snapshot[STORAGE_KEYS.experiment_run_trays] ||= [];
    snapshot[STORAGE_KEYS.experiment_runs] ||= [];
    snapshot[STORAGE_KEYS.experiment_runs].push({
      run_no: "run-axis-partial-z",
      schedule_id: "schedule-axis-partial-z",
      task_code: taskCode,
      experiment_code: experimentCode,
      sub_experiment_code: firstSubExperimentCode,
    });
    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      run_no: "run-axis-partial-z",
      task_code: taskCode,
      experiment_code: experimentCode,
      sub_experiment_code: firstSubExperimentCode,
      tray_code: trayCode,
      run_tray_status: "实验已完成",
      ended_at: "2026-06-21T12:00:00",
    });
    snapshot[STORAGE_KEYS.experiment_run_steps] = [
      {
        run_no: "run-axis-partial-z",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
        axis_code: "z+",
        step_no: 1,
        status: "实验已完成",
      },
      {
        run_no: "run-axis-partial-z",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
        axis_code: "z-",
        step_no: 2,
        status: "实验已完成",
      },
    ];
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-axis-partial-staging",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "振动一室",
      status: "实验已完成",
      flow_status: "实验已完成",
      trays: [{ tray_code: trayCode, status: "实验已完成", quantity: 1 }],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "staging" });
    const row = rows.find((item) => item.trayCode === trayCode);
    const scanDetail = buildZancunScanDetail(rows, trayCode, "stockIn", { room: "staging" });

    expect(row).toEqual(expect.objectContaining({
      inboundKind: "allowed",
      inboundKindLabel: "允许暂存",
      isPartialAxisInbound: true,
      isPostExperimentInbound: false,
      status: "待入库",
      trayCode,
    }));
    expect(scanDetail).toEqual(expect.objectContaining({
      found: true,
      isPartialAxisInbound: true,
      isPostExperimentInbound: false,
      status: "待入库",
      trayCode,
    }));

    const stockInResult = applyZancunInventoryAction({
      now: TODAY,
      payload: {
        code: trayCode,
        mode: "stockIn",
      },
      snapshot,
    });
    const stockOutResult = applyZancunInventoryAction({
      now: "2026-06-22T09:00:00",
      payload: {
        code: trayCode,
        mode: "stockOut",
        targetExperimentCode: experimentCode,
        targetLab: "振动一室",
      },
      snapshot: stockInResult.snapshot,
    });

    expect(stockInResult.error).toBe("");
    expect(stockInResult.row).toEqual(expect.objectContaining({
      isPartialAxisInbound: true,
      status: "已到达暂存间",
      statusLabel: "已到达暂存间",
      targetScheduleStartAt: "2026-06-22T09:00:00",
    }));
    expect(stockOutResult.error).toBe("");
    const updatedSample = stockOutResult.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === `${taskCode}-SP-001`);
    expect(updatedSample).toEqual(expect.objectContaining({
      location: "振动一室",
      status: "送至实验室",
      flow_status: "送至实验室",
    }));
    expect(updatedSample?.trays[0]).toEqual(expect.objectContaining({
      status: "送至实验室",
      target_experiment_code: experimentCode,
      target_lab: "振动一室",
    }));

    const afterStockOutRows = buildZancunRowsFromSnapshot(stockOutResult.snapshot, { now: TODAY, room: "staging" });
    const afterStockOutSections = buildZancunInventorySections(afterStockOutRows, { room: "staging" });
    expect(afterStockOutSections.plannedInboundRows.map((item) => item.trayCode)).not.toContain(trayCode);
  });

  test("stocks a completed axis sub-experiment into post-experiment staging when total axes remain", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;
    const experimentCode = `${taskCode}-A`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: taskCode,
      code: taskCode,
      test_type: "冲击试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: experimentCode,
      task_code: taskCode,
      experiment_code: experimentCode,
      experiment_name: "冲击试验",
      required_device: "冲击试验",
      status: "实验已完成",
      axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-current-axis",
      task_code: taskCode,
      experiment_code: experimentCode,
      tray_code: trayCode,
    });
    snapshot[STORAGE_KEYS.schedules].push(
      {
        id: "schedule-current-axis-xy",
        task_code: taskCode,
        experiment_code: experimentCode,
        experiment_name: "冲击试验",
        device: "冲击一室",
        start_at: "2026-06-25 15:08:00",
        end_at: "2026-06-25 18:38:00",
        status: "实验已完成",
        axis_codes: ["x+", "x-", "y+", "y-"],
        sub_experiment_code: firstSubExperimentCode,
      },
      {
        id: "schedule-current-axis-z",
        task_code: taskCode,
        experiment_code: experimentCode,
        experiment_name: "冲击试验",
        device: "冲击一室",
        start_at: "2026-06-26 08:00:00",
        end_at: "2026-06-26 11:30:00",
        status: "已排程",
        axis_codes: ["z+", "z-"],
        sub_experiment_code: secondSubExperimentCode,
      },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      {
        run_no: "RUN-CURRENT-AXIS-XY",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
        tray_code: trayCode,
        status: "实验已完成",
        run_tray_status: "实验已完成",
        ended_at: "2026-06-25 15:14:11",
      },
    ];
    snapshot[STORAGE_KEYS.experiment_runs] = [
      {
        run_no: "RUN-CURRENT-AXIS-XY",
        schedule_id: "schedule-current-axis-xy",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
      },
    ];
    snapshot[STORAGE_KEYS.experiment_run_steps] = ["x+", "x-", "y+", "y-"].map((axisCode, index) => ({
      run_no: "RUN-CURRENT-AXIS-XY",
      task_code: taskCode,
      experiment_code: experimentCode,
      sub_experiment_code: firstSubExperimentCode,
      axis_code: axisCode,
      step_no: index + 1,
      status: "实验已完成",
    }));
    snapshot[STORAGE_KEYS.samples].push({
      id: `${taskCode}-SP-001`,
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "冲击一室",
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: [
        {
          tray_code: trayCode,
          status: "送至实验室",
          target_experiment_code: experimentCode,
          target_lab: "冲击一室",
          quantity: 1,
        },
      ],
      history: [],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-25 15:30:22", room: "staging" });
    const row = rows.find((item) => item.trayCode === trayCode);
    const stockInResult = applyZancunInventoryAction({
      now: "2026-06-25 15:30:22",
      payload: {
        code: trayCode,
        mode: "stockIn",
      },
      snapshot,
    });

    expect(row).toEqual(expect.objectContaining({
      isPartialAxisInbound: true,
      isPostExperimentInbound: false,
      status: "待入库",
      statusLabel: "待入库",
      targetScheduleStartAt: "2026-06-26 08:00:00",
    }));
    expect(row?.targetDestinations.map((destination) => destination.targetScheduleStartAt)).toEqual(["2026-06-26 08:00:00"]);
    expect(stockInResult.error).toBe("");
    const updatedSample = stockInResult.snapshot[STORAGE_KEYS.samples].find((sample) => sample.code === `${taskCode}-SP-001`);
    expect(updatedSample).toEqual(expect.objectContaining({
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      flow_status: "已到达暂存间",
    }));
    expect(updatedSample?.trays[0]).toEqual(expect.objectContaining({
      status: "已到达暂存间",
    }));
  });

  test("lists a live-shaped completed axis batch without staging events as post-experiment inbound", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-001";
    const trayCode = `${taskCode}-TP-001`;
    const experimentCode = `${taskCode}-C`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: taskCode,
      code: taskCode,
      test_type: "振动试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: experimentCode,
      task_code: taskCode,
      experiment_code: experimentCode,
      experiment_name: "振动试验",
      required_device: "振动试验",
      status: "实验进行中",
      axis_codes: ["x+", "y+"],
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-live-axis",
      task_code: taskCode,
      experiment_code: experimentCode,
      tray_code: trayCode,
    });
    snapshot[STORAGE_KEYS.schedules].push(
      {
        id: "schedule-live-axis-x",
        task_code: taskCode,
        experiment_code: experimentCode,
        experiment_name: "振动试验",
        device: "振动一室",
        start_at: "2026-06-26 11:53:00",
        end_at: "2026-06-26 15:23:00",
        status: "实验进行中",
        axis_codes: ["x+"],
        sub_experiment_code: firstSubExperimentCode,
      },
      {
        id: "schedule-live-axis-y",
        task_code: taskCode,
        experiment_code: experimentCode,
        experiment_name: "振动试验",
        device: "振动一室",
        start_at: "2026-06-26 15:33:00",
        end_at: "2026-06-26 19:03:00",
        status: "实验进行中",
        axis_codes: ["y+"],
        sub_experiment_code: secondSubExperimentCode,
      },
    );
    snapshot[STORAGE_KEYS.experiment_runs] = [
      {
        run_no: "run-live-axis-x",
        schedule_id: "schedule-live-axis-x",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
        status: "实验已完成",
        axis_codes: ["x+"],
        tray_codes: [trayCode],
        started_at: "2026-06-26 11:55:43",
        ended_at: "2026-06-26 11:55:46",
      },
    ];
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      {
        run_no: "run-live-axis-x",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
        tray_code: trayCode,
        status: "实验已完成",
        run_tray_status: "实验已完成",
        started_at: "2026-06-26 11:55:43",
        ended_at: "2026-06-26 11:55:46",
      },
    ];
    snapshot[STORAGE_KEYS.experiment_run_steps] = [
      {
        run_no: "run-live-axis-x",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
        axis_code: "x+",
        step_no: 1,
        status: "实验已完成",
      },
    ];
    snapshot[STORAGE_KEYS.samples].push({
      id: `${taskCode}-SP-001`,
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "振动一室",
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: [
        {
          tray_code: trayCode,
          status: "送至实验室",
          target_experiment_code: experimentCode,
          target_lab: "振动一室",
          quantity: 1,
        },
      ],
      history: [],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-26 12:00:00", room: "staging" });
    const row = rows.find((item) => item.trayCode === trayCode);
    const stockInResult = applyZancunInventoryAction({
      now: "2026-06-26 12:00:00",
      payload: { code: trayCode, mode: "stockIn" },
      snapshot,
    });

    expect(row).toEqual(expect.objectContaining({
      isPartialAxisInbound: true,
      isPostExperimentInbound: false,
      status: "待入库",
      targetScheduleStartAt: "2026-06-26 15:33:00",
    }));
    expect(stockInResult.error).toBe("");
    expect(stockInResult.row).toEqual(expect.objectContaining({
      isPartialAxisInbound: true,
      status: "已到达暂存间",
      statusLabel: "已到达暂存间",
    }));
  });

  test("treats a stale running tray as allowed staging inbound when all assigned run-trays are completed", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-021",
      code: "SYLU-2026-06-021",
      test_type: "冲击试验 / 振动试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-021-a",
        task_code: "SYLU-2026-06-021",
        experiment_code: "SYLU-2026-06-021-A",
        experiment_name: "冲击试验",
        required_device: "冲击二室",
      },
      {
        id: "exp-021-c",
        task_code: "SYLU-2026-06-021",
        experiment_code: "SYLU-2026-06-021-C",
        experiment_name: "振动试验",
        required_device: "振动二室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      {
        id: "rel-021-a-003",
        task_code: "SYLU-2026-06-021",
        experiment_code: "SYLU-2026-06-021-A",
        tray_code: "SYLU-2026-06-021-TP-003",
      },
      {
        id: "rel-021-c-003",
        task_code: "SYLU-2026-06-021",
        experiment_code: "SYLU-2026-06-021-C",
        tray_code: "SYLU-2026-06-021-TP-003",
      },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      {
        run_no: "run-impact-003",
        task_code: "SYLU-2026-06-021",
        experiment_code: "SYLU-2026-06-021-A",
        tray_code: "SYLU-2026-06-021-TP-003",
        run_tray_status: "实验已完成",
      },
      {
        run_no: "run-vibration-003",
        task_code: "SYLU-2026-06-021",
        experiment_code: "SYLU-2026-06-021-C",
        tray_code: "SYLU-2026-06-021-TP-003",
        run_tray_status: "实验已完成",
      },
    ];
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-021-003",
      code: "SYLU-2026-06-021-SP-003",
      task_code: "SYLU-2026-06-021",
      owner: "周工",
      location: "冲击二室",
      status: "实验进行中",
      flow_status: "实验进行中",
      trays: [
        {
          tray_code: "SYLU-2026-06-021-TP-003",
          status: "实验进行中",
          target_experiment_code: "SYLU-2026-06-021-A",
          target_lab: "冲击二室",
          quantity: 1,
        },
      ],
      history: [],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "evt-021-003-in",
        tray_code: "SYLU-2026-06-021-TP-003",
        task_code: "SYLU-2026-06-021",
        action: "stock_in",
        time: "2026-06-05 17:49:11",
      },
      {
        id: "evt-021-003-out",
        tray_code: "SYLU-2026-06-021-TP-003",
        task_code: "SYLU-2026-06-021",
        action: "stock_out",
        target_experiment_code: "SYLU-2026-06-021-A",
        target_lab: "冲击二室",
        time: "2026-06-05 17:49:14",
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-05 17:55:00" });
    const row = rows.find((item) => item.trayCode === "SYLU-2026-06-021-TP-003");
    const result = applyZancunInventoryAction({
      now: "2026-06-05 17:55:00",
      payload: {
        code: "SYLU-2026-06-021-TP-003",
        mode: "stockIn",
      },
      snapshot,
    });

    expect(row).toEqual(expect.objectContaining({ isPostExperimentInbound: true, status: "待入库" }));
    expect(row).toEqual(expect.objectContaining({
      inboundKind: "allowed",
      inboundKindLabel: "允许暂存",
    }));
    expect(result.error).toBe("");
    expect(result.row).toEqual(expect.objectContaining({ status: "实验后暂存间存放" }));
    const updatedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) =>
      sample.trays?.some((tray) => tray.tray_code === "SYLU-2026-06-021-TP-003"),
    );
    expect(updatedSample).toEqual(expect.objectContaining({
      location: "恒温恒湿间（实验后暂存间）",
      status: "实验后暂存间存放",
      flow_status: "实验后暂存间存放",
    }));
    expect(updatedSample?.trays[0]).toEqual(expect.objectContaining({
      status: "实验后暂存间存放",
    }));
  });

  test("allows partial-axis staging until a newer axis attempt is compared or started", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const vibrationExperimentCode = `${taskCode}-VIB`;
    const firstSubExperimentCode = `${vibrationExperimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${vibrationExperimentCode}-AXIS-002`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-axis-021",
      code: taskCode,
      test_type: "振动试验 / 冲击试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-axis-021-vib",
        task_code: taskCode,
        experiment_code: vibrationExperimentCode,
        experiment_name: "振动试验",
        required_device: "振动二室",
        axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
      },
      {
        id: "exp-axis-021-impact",
        task_code: taskCode,
        experiment_code: `${taskCode}-IMP`,
        experiment_name: "冲击试验",
        required_device: "冲击二室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      {
        id: "rel-axis-021-vib",
        task_code: taskCode,
        experiment_code: vibrationExperimentCode,
        tray_code: trayCode,
      },
      {
        id: "rel-axis-021-impact",
        task_code: taskCode,
        experiment_code: `${taskCode}-IMP`,
        tray_code: trayCode,
      },
    );
    snapshot[STORAGE_KEYS.schedules].push(
      {
        id: "schedule-axis-021-vib-first",
        task_code: taskCode,
        experiment_code: vibrationExperimentCode,
        experiment_name: "振动试验",
        device: "振动二室",
        start_at: "2026-06-21 08:00:00",
        end_at: "2026-06-21 10:00:00",
        status: "实验已完成",
        axis_codes: ["z+", "z-"],
        sub_experiment_code: firstSubExperimentCode,
      },
      {
        id: "schedule-axis-021-vib-second",
        task_code: taskCode,
        experiment_code: vibrationExperimentCode,
        experiment_name: "振动试验",
        device: "振动二室",
        start_at: "2026-06-22 08:00:00",
        end_at: "2026-06-22 12:00:00",
        status: "已排程",
        axis_codes: ["x+", "x-", "y+", "y-"],
        sub_experiment_code: secondSubExperimentCode,
      },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      {
        run_no: "RUN-VIB-Z",
        task_code: taskCode,
        experiment_code: vibrationExperimentCode,
        sub_experiment_code: firstSubExperimentCode,
        tray_code: trayCode,
        run_tray_status: "实验已完成",
        ended_at: "2026-06-21 10:00:00",
      },
    ];
    snapshot[STORAGE_KEYS.experiment_run_steps] = [
      { run_no: "RUN-VIB-Z", task_code: taskCode, experiment_code: vibrationExperimentCode, sub_experiment_code: firstSubExperimentCode, axis_code: "z+", status: "实验已完成" },
      { run_no: "RUN-VIB-Z", task_code: taskCode, experiment_code: vibrationExperimentCode, sub_experiment_code: firstSubExperimentCode, axis_code: "z-", status: "实验已完成" },
    ];
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-axis-021",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "振动二室",
      status: "实验进行中",
      flow_status: "实验进行中",
      trays: [
        {
          tray_code: trayCode,
          status: "实验进行中",
          target_experiment_code: vibrationExperimentCode,
          target_sub_experiment_code: firstSubExperimentCode,
          target_lab: "振动二室",
          quantity: 1,
        },
      ],
      history: [
        { action: "实验完成", detail: `${taskCode} / 振动试验 / 振动试验部分完成 2/6轴`, status: "振动试验部分完成 2/6轴", time: "2026-06-21 10:00:00" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "evt-axis-021-in",
        tray_code: trayCode,
        task_code: taskCode,
        action: "stock_in",
        time: "2026-06-21 07:55:00",
      },
      {
        id: "evt-axis-021-out",
        tray_code: trayCode,
        task_code: taskCode,
        action: "stock_out",
        target_experiment_code: vibrationExperimentCode,
        target_sub_experiment_code: firstSubExperimentCode,
        target_lab: "振动二室",
        time: "2026-06-21 08:00:00",
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-21 10:00:00", room: "staging" });
    const row = rows.find((item) => item.trayCode === trayCode);
    const scanDetail = buildZancunScanDetail(rows, trayCode, "stockIn", { room: "staging" });

    expect(row).toEqual(expect.objectContaining({
      isPartialAxisInbound: true,
      isPostExperimentInbound: false,
      status: "待入库",
    }));
    expect(scanDetail).toEqual(expect.objectContaining({
      found: true,
      status: "待入库",
    }));

    snapshot[STORAGE_KEYS.samples].at(-1).history.unshift(
      { action: "任务比对", detail: `${taskCode} / 振动试验 / 已到达实验室`, status: "已到达实验室", time: "2026-06-21 10:01:00" },
    );
    const comparedRows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-21 10:01:01", room: "staging" });
    const comparedRow = comparedRows.find((item) => item.trayCode === trayCode);
    expect(comparedRow).toEqual(expect.objectContaining({
      inboundKind: "",
      isPartialAxisInbound: false,
    }));
    expect(buildZancunInventorySections(comparedRows, { room: "staging" }).plannedInboundRows.map((item) => item.trayCode)).not.toContain(trayCode);

    snapshot[STORAGE_KEYS.samples].at(-1).history.unshift(
      { action: "实验任务撤回", detail: `${taskCode} / 振动试验 / 撤回至部分完成`, status: "振动试验部分完成 2/6轴", time: "2026-06-21 10:02:00" },
    );
    const withdrawnRows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-21 10:02:01", room: "staging" });
    expect(withdrawnRows.find((item) => item.trayCode === trayCode)).toEqual(expect.objectContaining({
      inboundKind: "allowed",
      isPartialAxisInbound: true,
      status: "待入库",
    }));

    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      run_no: "RUN-VIB-REMAINING",
      task_code: taskCode,
      experiment_code: vibrationExperimentCode,
      sub_experiment_code: secondSubExperimentCode,
      tray_code: trayCode,
      run_tray_status: "实验进行中",
      started_at: "2026-06-21 10:03:00",
    });
    const runningRows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-21 10:03:01", room: "staging" });
    expect(runningRows.find((item) => item.trayCode === trayCode)).toEqual(expect.objectContaining({
      inboundKind: "",
      isPartialAxisInbound: false,
    }));
  });

  test("shows only the active scheduled lab after partial impact or vibration completion", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-07-003";
    const trayCode = `${taskCode}-TP-001`;
    const vibrationExperimentCode = `${taskCode}-VIB`;
    const saltExperimentCode = `${taskCode}-SALT`;
    const finishedSubExperimentCode = `${vibrationExperimentCode}-AXIS-001`;
    const remainingSubExperimentCode = `${vibrationExperimentCode}-AXIS-002`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-partial-axis-other-lab",
      code: taskCode,
      test_type: "振动试验 / 盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-partial-axis-other-lab-vib",
        task_code: taskCode,
        experiment_code: vibrationExperimentCode,
        experiment_name: "振动试验",
        required_device: "振动二室",
        axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
      },
      {
        id: "exp-partial-axis-other-lab-salt",
        task_code: taskCode,
        experiment_code: saltExperimentCode,
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-partial-axis-other-lab-vib", task_code: taskCode, experiment_code: vibrationExperimentCode, tray_code: trayCode },
      { id: "rel-partial-axis-other-lab-salt", task_code: taskCode, experiment_code: saltExperimentCode, tray_code: trayCode },
    );
    snapshot[STORAGE_KEYS.schedules].push(
      {
        id: "schedule-partial-axis-other-lab-vib-done",
        task_code: taskCode,
        experiment_code: vibrationExperimentCode,
        experiment_name: "振动试验",
        device: "振动二室",
        start_at: "2026-06-29 08:00:00",
        end_at: "2026-06-29 10:00:00",
        status: "实验已完成",
        axis_codes: ["x+", "x-", "y+"],
        sub_experiment_code: finishedSubExperimentCode,
      },
      {
        id: "schedule-partial-axis-other-lab-vib-remaining",
        task_code: taskCode,
        experiment_code: vibrationExperimentCode,
        experiment_name: "振动试验",
        device: "振动二室",
        start_at: "2026-06-30 08:00:00",
        end_at: "2026-06-30 10:00:00",
        status: "已排程",
        axis_codes: ["y-", "z+", "z-"],
        sub_experiment_code: remainingSubExperimentCode,
      },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      ...(snapshot[STORAGE_KEYS.experiment_run_trays] || []),
      {
        run_no: "run-partial-axis-other-lab",
        task_code: taskCode,
        experiment_code: vibrationExperimentCode,
        sub_experiment_code: finishedSubExperimentCode,
        tray_code: trayCode,
        run_tray_status: "实验已完成",
        ended_at: "2026-06-29 10:00:00",
      },
    ];
    snapshot[STORAGE_KEYS.experiment_run_steps] = [
      ...(snapshot[STORAGE_KEYS.experiment_run_steps] || []),
      ...["x+", "x-", "y+"].map((axisCode, index) => ({
        run_no: "run-partial-axis-other-lab",
        task_code: taskCode,
        experiment_code: vibrationExperimentCode,
        sub_experiment_code: finishedSubExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
    ];
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-partial-axis-other-lab",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "振动二室",
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: [{
        tray_code: trayCode,
        status: "送至实验室",
        target_experiment_code: vibrationExperimentCode,
        target_sub_experiment_code: finishedSubExperimentCode,
        target_lab: "振动二室",
        quantity: 1,
      }],
      history: [],
    });
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "evt-partial-axis-other-lab-in",
        tray_code: trayCode,
        task_code: taskCode,
        room: "staging",
        action: "stock_in",
        time: "2026-06-29 07:55:00",
      },
      {
        id: "evt-partial-axis-other-lab-out",
        tray_code: trayCode,
        task_code: taskCode,
        room: "staging",
        action: "stock_out",
        target_experiment_code: vibrationExperimentCode,
        target_sub_experiment_code: finishedSubExperimentCode,
        target_lab: "振动二室",
        time: "2026-06-29 08:00:00",
      },
    );

    const stockInResult = applyZancunInventoryAction({
      now: "2026-06-29 10:10:00",
      payload: { code: trayCode, mode: "stockIn", room: "staging" },
      room: "staging",
      snapshot,
    });
    const rows = buildZancunRowsFromSnapshot(stockInResult.snapshot, { now: "2026-06-29 10:11:00", room: "staging" });
    const stagedRow = rows.find((row) => row.trayCode === trayCode);
    const stockOutResult = applyZancunInventoryAction({
      now: "2026-06-29 10:12:00",
      payload: {
        code: trayCode,
        mode: "stockOut",
        room: "staging",
        targetExperimentCode: saltExperimentCode,
        targetLab: "盐雾试验室",
      },
      room: "staging",
      snapshot: stockInResult.snapshot,
    });

    expect(stockInResult.error).toBe("");
    expect(stagedRow?.targetDestinations.map((destination) => destination.targetLab)).toEqual(["振动二室"]);
    expect(stagedRow?.targetDestinations.every((destination) => destination.scheduled)).toBe(true);
    expect(stockOutResult.error).toBe("请选择有效的目标实验室后再出库。");
    expect(stockOutResult.snapshot[STORAGE_KEYS.staging_events]).toHaveLength(
      stockInResult.snapshot[STORAGE_KEYS.staging_events].length,
    );
    const updatedSample = stockOutResult.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === "sample-partial-axis-other-lab");
    expect(updatedSample?.trays[0]).toEqual(expect.objectContaining({
      target_experiment_code: vibrationExperimentCode,
      target_lab: "振动二室",
    }));
  });

  test("stocks fully completed axis tray into post-experiment staging before sibling trays finish", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-07-001";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const siblingTrayCode = `${taskCode}-TP-002`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-axis-first-finished",
      code: taskCode,
      test_type: "冲击试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-axis-first-finished",
      task_code: taskCode,
      experiment_code: experimentCode,
      experiment_name: "冲击试验",
      required_device: "冲击一室",
      status: "实验进行中",
      axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
    });
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-axis-first-finished", task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      { id: "rel-axis-sibling-running", task_code: taskCode, experiment_code: experimentCode, tray_code: siblingTrayCode },
    );
    snapshot[STORAGE_KEYS.schedules].push(
      {
        id: "schedule-axis-first-001",
        task_code: taskCode,
        experiment_code: experimentCode,
        device: "冲击一室",
        status: "实验已完成",
        sub_experiment_code: firstSubExperimentCode,
        axis_codes: ["x+", "x-", "y+"],
      },
      {
        id: "schedule-axis-first-002",
        task_code: taskCode,
        experiment_code: experimentCode,
        device: "冲击一室",
        status: "实验已完成",
        sub_experiment_code: secondSubExperimentCode,
        axis_codes: ["y-", "z+", "z-"],
      },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      ...(snapshot[STORAGE_KEYS.experiment_run_trays] || []),
      {
        run_no: "run-axis-first-001",
        task_code: taskCode,
        experiment_code: experimentCode,
        tray_code: trayCode,
        run_tray_status: "实验已完成",
        sub_experiment_code: firstSubExperimentCode,
        ended_at: "2026-06-26 18:16:33",
      },
      {
        run_no: "run-axis-first-002",
        task_code: taskCode,
        experiment_code: experimentCode,
        tray_code: trayCode,
        run_tray_status: "实验已完成",
        sub_experiment_code: secondSubExperimentCode,
        ended_at: "2026-06-26 18:16:53",
      },
    ];
    snapshot[STORAGE_KEYS.experiment_run_steps] = [
      ...["x+", "x-", "y+"].map((axisCode, index) => ({
        run_no: "run-axis-first-001",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
      ...["y-", "z+", "z-"].map((axisCode, index) => ({
        run_no: "run-axis-first-002",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: secondSubExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
    ];
    snapshot[STORAGE_KEYS.samples].push(
      {
        id: "sample-axis-first-finished",
        code: `${taskCode}-SP-001`,
        task_code: taskCode,
        owner: "扫码登记",
        location: "冲击一室",
        status: "送至实验室",
        flow_status: "送至实验室",
        trays: [{
          tray_code: trayCode,
          status: "送至实验室",
          target_experiment_code: experimentCode,
          target_lab: "冲击一室",
          quantity: 1,
        }],
        history: [],
      },
      {
        id: "sample-axis-sibling-running",
        code: `${taskCode}-SP-002`,
        task_code: taskCode,
        owner: "扫码登记",
        location: "冲击一室",
        status: "实验进行中",
        flow_status: "实验进行中",
        trays: [{
          tray_code: siblingTrayCode,
          status: "实验进行中",
          target_experiment_code: experimentCode,
          target_lab: "冲击一室",
          quantity: 1,
        }],
        history: [],
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-26 18:30:00", room: "staging" });
    const row = rows.find((item) => item.trayCode === trayCode);
    const result = applyZancunInventoryAction({
      now: "2026-06-26 18:30:00",
      payload: { code: trayCode, mode: "stockIn", room: "staging" },
      room: "staging",
      snapshot,
    });
    const updatedSample = result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === "sample-axis-first-finished");

    expect(row).toEqual(expect.objectContaining({
      isPartialAxisInbound: false,
      isPostExperimentInbound: true,
      status: "待入库",
    }));
    expect(result.error).toBe("");
    expect(updatedSample).toMatchObject({
      location: "恒温恒湿间（实验后暂存间）",
      status: "实验后暂存间存放",
      flow_status: "实验后暂存间存放",
    });
    expect(updatedSample.trays[0]).toEqual(expect.objectContaining({
      status: "实验后暂存间存放",
    }));
  });

  test("treats fully completed split axis schedules with stale running schedule status as post-experiment staging", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-07-001";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-axis-stale-running",
      code: taskCode,
      test_type: "振动试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-axis-stale-running",
      task_code: taskCode,
      experiment_code: experimentCode,
      experiment_name: "振动试验",
      required_device: "振动一室",
      status: "实验进行中",
      axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-axis-stale-running",
      task_code: taskCode,
      experiment_code: experimentCode,
      tray_code: trayCode,
    });
    snapshot[STORAGE_KEYS.schedules].push(
      {
        id: "schedule-axis-stale-001",
        task_code: taskCode,
        experiment_code: experimentCode,
        device: "振动一室",
        status: "实验进行中",
        sub_experiment_code: firstSubExperimentCode,
        axis_codes: ["x+", "x-", "y+"],
      },
      {
        id: "schedule-axis-stale-002",
        task_code: taskCode,
        experiment_code: experimentCode,
        device: "振动一室",
        status: "实验进行中",
        sub_experiment_code: secondSubExperimentCode,
        axis_codes: ["y-", "z+", "z-"],
      },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      {
        run_no: "run-axis-stale-001",
        task_code: taskCode,
        experiment_code: experimentCode,
        tray_code: trayCode,
        run_tray_status: "实验已完成",
        sub_experiment_code: firstSubExperimentCode,
        ended_at: "2026-06-30 21:41:35",
      },
      {
        run_no: "run-axis-stale-002",
        task_code: taskCode,
        experiment_code: experimentCode,
        tray_code: trayCode,
        run_tray_status: "实验已完成",
        sub_experiment_code: secondSubExperimentCode,
        ended_at: "2026-06-30 21:59:52",
      },
    ];
    snapshot[STORAGE_KEYS.experiment_run_steps] = [
      ...["x+", "x-", "y+"].map((axisCode, index) => ({
        run_no: "run-axis-stale-001",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
      ...["y-", "z+", "z-"].map((axisCode, index) => ({
        run_no: "run-axis-stale-002",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: secondSubExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
    ];
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-axis-stale-running",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "扫码登记",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      flow_status: "已到达暂存间",
      trays: [{
        tray_code: trayCode,
        status: "已到达暂存间",
        target_experiment_code: experimentCode,
        target_lab: "振动一室",
        quantity: 1,
      }],
      history: [
        { action: "实验完成", detail: `${taskCode} / 振动试验 / 实验已完成`, location: "振动一室", status: "实验已完成", time: "2026-06-30 21:59:52" },
        { action: "暂存间扫码入库", detail: `${trayCode} 已到达暂存间`, location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-06-30 22:00:01" },
      ],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-axis-stale-running-in",
      action: "stock_in",
      room: "staging",
      task_code: taskCode,
      time: "2026-06-30 22:00:01",
      tray_code: trayCode,
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-30 22:10:00", room: "staging" });
    const row = rows.find((item) => item.trayCode === trayCode);

    expect(row).toEqual(expect.objectContaining({
      isPartialAxisInbound: false,
      isPostExperimentInbound: true,
      status: "已到达暂存间",
      statusLabel: "实验后暂存",
    }));
  });

  test("keeps a single scheduled axis tray visible for staging stock-in when sibling trays remain unfinished", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-07-002";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const siblingTrayCode = `${taskCode}-TP-002`;
    const subExperimentCode = `${experimentCode}-AXIS-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-axis-single-schedule",
      code: taskCode,
      test_type: "振动试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-axis-single-schedule",
      task_code: taskCode,
      experiment_code: experimentCode,
      experiment_name: "振动试验",
      required_device: "振动二室",
      status: "实验进行中",
      axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
    });
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-axis-single-schedule-001", task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      { id: "rel-axis-single-schedule-002", task_code: taskCode, experiment_code: experimentCode, tray_code: siblingTrayCode },
    );
    snapshot[STORAGE_KEYS.schedules].push({
      id: "schedule-axis-single-schedule",
      task_code: taskCode,
      experiment_code: experimentCode,
      experiment_name: "振动试验",
      device: "振动二室",
      start_at: "2026-06-26 17:02:00",
      end_at: "2026-06-26 20:32:00",
      status: "实验进行中",
      sub_experiment_code: subExperimentCode,
      axis_codes: ["z+", "z-"],
      axis_batch_no: "001",
    });
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      ...(snapshot[STORAGE_KEYS.experiment_run_trays] || []),
      {
        run_no: "run-axis-single-schedule",
        task_code: taskCode,
        experiment_code: experimentCode,
        tray_code: trayCode,
        run_tray_status: "实验已完成",
        sub_experiment_code: subExperimentCode,
        ended_at: "2026-06-26 18:16:33",
      },
    ];
    snapshot[STORAGE_KEYS.experiment_run_steps] = [
      ...["z+", "z-"].map((axisCode, index) => ({
        run_no: "run-axis-single-schedule",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: subExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
    ];
    snapshot[STORAGE_KEYS.samples].push(
      {
        id: "sample-axis-single-schedule-completed",
        code: `${taskCode}-SP-001`,
        task_code: taskCode,
        owner: "扫码登记",
        location: "振动二室",
        status: "送至实验室",
        flow_status: "送至实验室",
        trays: [{
          tray_code: trayCode,
          status: "送至实验室",
          target_experiment_code: experimentCode,
          target_sub_experiment_code: subExperimentCode,
          target_lab: "振动二室",
          quantity: 1,
        }],
        history: [],
      },
      {
        id: "sample-axis-single-schedule-sibling",
        code: `${taskCode}-SP-002`,
        task_code: taskCode,
        owner: "扫码登记",
        location: "振动二室",
        status: "实验准备就绪",
        flow_status: "实验准备就绪",
        trays: [{
          tray_code: siblingTrayCode,
          status: "实验准备就绪",
          target_experiment_code: experimentCode,
          target_sub_experiment_code: subExperimentCode,
          target_lab: "振动二室",
          quantity: 1,
        }],
        history: [],
      },
    );
    snapshot[STORAGE_KEYS.staging_events].push(
      {
        id: "evt-axis-single-schedule-in",
        tray_code: trayCode,
        task_code: taskCode,
        room: "staging",
        action: "stock_in",
        time: "2026-06-26 17:00:00",
      },
      {
        id: "evt-axis-single-schedule-out",
        tray_code: trayCode,
        task_code: taskCode,
        room: "staging",
        action: "stock_out",
        target_experiment_code: experimentCode,
        target_sub_experiment_code: subExperimentCode,
        target_lab: "振动二室",
        time: "2026-06-26 17:02:00",
      },
    );

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-26 18:30:00", room: "staging" });
    const row = rows.find((item) => item.trayCode === trayCode);
    const sections = buildZancunInventorySections(rows, { room: "staging" });
    const scanDetail = buildZancunScanDetail(rows, trayCode, "stockIn", { room: "staging" });
    const stockInResult = applyZancunInventoryAction({
      now: "2026-06-26 18:30:00",
      payload: { code: trayCode, mode: "stockIn", room: "staging" },
      room: "staging",
      snapshot,
    });

    expect(row).toEqual(expect.objectContaining({
      inboundKind: "allowed",
      status: "待入库",
    }));
    expect(sections.plannedInboundRows.map((item) => item.trayCode)).toContain(trayCode);
    expect(scanDetail).toEqual(expect.objectContaining({
      found: true,
      status: "待入库",
    }));
    expect(stockInResult.error).toBe("");
    expect(stockInResult.row).toEqual(expect.objectContaining({
      status: "已到达暂存间",
    }));
  });

  test("offers both appearance planning and post-experiment staging for completed appearance-eligible trays", () => {
    const snapshot = createSnapshot();
    const taskCode = "SYLU-2026-06-031";
    const trayCode = `${taskCode}-TP-001`;
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-salt-final",
      code: taskCode,
      test_type: "冲击试验 / 盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push(
      {
        id: "exp-salt-final-impact",
        task_code: taskCode,
        experiment_code: `${taskCode}-A`,
        experiment_name: "冲击试验",
        required_device: "冲击一室",
      },
      {
        id: "exp-salt-final-salt",
        task_code: taskCode,
        experiment_code: `${taskCode}-B`,
        experiment_name: "盐雾试验",
        required_device: "盐雾试验室",
      },
    );
    snapshot[STORAGE_KEYS.experiment_trays].push(
      { id: "rel-salt-final-a", task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
      { id: "rel-salt-final-b", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
    );
    snapshot[STORAGE_KEYS.experiment_run_trays] = [
      ...(snapshot[STORAGE_KEYS.experiment_run_trays] || []),
      {
        task_code: taskCode,
        experiment_code: `${taskCode}-A`,
        tray_code: trayCode,
        run_tray_status: "实验已完成",
        ended_at: "2026-06-05 10:00:00",
      },
      {
        task_code: taskCode,
        experiment_code: `${taskCode}-B`,
        tray_code: trayCode,
        run_tray_status: "实验已完成",
        ended_at: "2026-06-05 12:00:00",
      },
    ];
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-salt-final",
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: "周工",
      location: "盐雾试验室",
      status: "实验已完成",
      flow_status: "实验已完成",
      trays: [{ tray_code: trayCode, status: "实验已完成", quantity: 1 }],
      history: [
        { detail: `${taskCode} / 盐雾试验 / 实验已完成`, time: "2026-06-05 12:00:00" },
        { detail: `${taskCode} / 冲击试验 / 实验已完成`, time: "2026-06-05 10:00:00" },
      ],
    });

    const stagingRows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "staging" });
    const appearanceRows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const stagingSections = buildZancunInventorySections(stagingRows, { room: "staging" });
    const appearanceSections = buildZancunInventorySections(appearanceRows, { room: "appearance" });

    expect(stagingSections.plannedInboundRows).toContainEqual(expect.objectContaining({
      inboundKind: "allowed",
      inboundKindLabel: "允许暂存",
      isPostExperimentInbound: true,
      status: "待入库",
      trayCode,
    }));
    expect(appearanceSections.plannedInboundRows).toContainEqual(expect.objectContaining({
      inboundKind: "appearance",
      inboundKindLabel: "计划入库",
      status: "待入库",
      trayCode,
    }));

    const stagingStockInResult = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: trayCode, mode: "stockIn" },
      room: "staging",
      snapshot,
    });

    expect(stagingStockInResult.error).toBe("");
    expect(stagingStockInResult.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === "sample-salt-final")).toMatchObject({
      location: "恒温恒湿间（实验后暂存间）",
      status: "实验后暂存间存放",
      flow_status: "实验后暂存间存放",
    });
  });

  test("appearance room cannot stock in a tray already stored in post-experiment staging", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.experiment_run_trays] ||= [];
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-post-staging-appearance-blocked",
      code: "TASK-POST-STAGING-APPEARANCE-BLOCKED",
      test_type: "盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-post-staging-salt",
      task_code: "TASK-POST-STAGING-APPEARANCE-BLOCKED",
      experiment_code: "EXP-POST-STAGING-SALT",
      experiment_name: "盐雾试验",
      required_device: "盐雾试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-post-staging-salt",
      task_code: "TASK-POST-STAGING-APPEARANCE-BLOCKED",
      experiment_code: "EXP-POST-STAGING-SALT",
      tray_code: "TP-POST-STAGING-APPEARANCE-BLOCKED",
    });
    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      task_code: "TASK-POST-STAGING-APPEARANCE-BLOCKED",
      experiment_code: "EXP-POST-STAGING-SALT",
      tray_code: "TP-POST-STAGING-APPEARANCE-BLOCKED",
      run_tray_status: "实验已完成",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-post-staging-appearance-blocked",
      code: "SP-POST-STAGING-APPEARANCE-BLOCKED",
      task_code: "TASK-POST-STAGING-APPEARANCE-BLOCKED",
      owner: "周工",
      location: "恒温恒湿间（暂存间）",
      status: "实验后暂存间存放",
      flow_status: "实验后暂存间存放",
      trays: [{ tray_code: "TP-POST-STAGING-APPEARANCE-BLOCKED", status: "实验后暂存间存放", quantity: 1 }],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: "TP-POST-STAGING-APPEARANCE-BLOCKED", mode: "stockIn" },
      room: "appearance",
      snapshot,
    });

    expect(rows.map((row) => row.trayCode)).not.toContain("TP-POST-STAGING-APPEARANCE-BLOCKED");
    expect(result.error).toBe("未找到对应的入库托盘。");
  });

  test("appearance room can stock in a completed tray after post-staging stock-out targets appearance", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.experiment_run_trays] ||= [];
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-post-staging-appearance-after-out",
      code: "TASK-POST-STAGING-APPEARANCE-AFTER-OUT",
      test_type: "盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-post-staging-appearance-after-out",
      task_code: "TASK-POST-STAGING-APPEARANCE-AFTER-OUT",
      experiment_code: "EXP-POST-STAGING-APPEARANCE-AFTER-OUT",
      experiment_name: "盐雾试验",
      required_device: "盐雾试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-post-staging-appearance-after-out",
      task_code: "TASK-POST-STAGING-APPEARANCE-AFTER-OUT",
      experiment_code: "EXP-POST-STAGING-APPEARANCE-AFTER-OUT",
      tray_code: "TP-POST-STAGING-APPEARANCE-AFTER-OUT",
    });
    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      task_code: "TASK-POST-STAGING-APPEARANCE-AFTER-OUT",
      experiment_code: "EXP-POST-STAGING-APPEARANCE-AFTER-OUT",
      tray_code: "TP-POST-STAGING-APPEARANCE-AFTER-OUT",
      run_tray_status: "实验已完成",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-post-staging-appearance-after-out",
      code: "SP-POST-STAGING-APPEARANCE-AFTER-OUT",
      task_code: "TASK-POST-STAGING-APPEARANCE-AFTER-OUT",
      owner: "周工",
      location: "恒温恒湿间（暂存间）",
      status: "实验后暂存间存放",
      flow_status: "实验后暂存间存放",
      trays: [{ tray_code: "TP-POST-STAGING-APPEARANCE-AFTER-OUT", status: "实验后暂存间存放", quantity: 1 }],
    });
    snapshot[STORAGE_KEYS.staging_events].push({
      id: "evt-post-staging-appearance-after-out",
      action: "stock_out",
      room: "staging",
      target_type: "appearance",
      target_lab: "外观检测间",
      task_code: "TASK-POST-STAGING-APPEARANCE-AFTER-OUT",
      time: "2026-06-12T09:00:00",
      tray_code: "TP-POST-STAGING-APPEARANCE-AFTER-OUT",
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY, room: "appearance" });
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: "TP-POST-STAGING-APPEARANCE-AFTER-OUT", mode: "stockIn" },
      room: "appearance",
      snapshot,
    });

    expect(rows).toContainEqual(expect.objectContaining({
      status: "待入库",
      trayCode: "TP-POST-STAGING-APPEARANCE-AFTER-OUT",
    }));
    expect(result.error).toBe("");
    expect(result.snapshot[STORAGE_KEYS.samples].find((sample) => sample.id === "sample-post-staging-appearance-after-out")).toMatchObject({
      location: "外观检测间",
      status: "实验后外观检测间存放",
      flow_status: "实验后外观检测间存放",
    });
  });

  test("staging room cannot stock in a tray already stored in appearance room", () => {
    const snapshot = createSnapshot();
    snapshot[STORAGE_KEYS.experiment_run_trays] ||= [];
    snapshot[STORAGE_KEYS.tasks].push({
      id: "task-appearance-staging-blocked",
      code: "TASK-APPEARANCE-STAGING-BLOCKED",
      test_type: "盐雾试验",
      sample_type: "组件",
      source: "内部新增",
    });
    snapshot[STORAGE_KEYS.experiments].push({
      id: "exp-appearance-salt",
      task_code: "TASK-APPEARANCE-STAGING-BLOCKED",
      experiment_code: "EXP-APPEARANCE-SALT",
      experiment_name: "盐雾试验",
      required_device: "盐雾试验室",
    });
    snapshot[STORAGE_KEYS.experiment_trays].push({
      id: "rel-appearance-salt",
      task_code: "TASK-APPEARANCE-STAGING-BLOCKED",
      experiment_code: "EXP-APPEARANCE-SALT",
      tray_code: "TP-APPEARANCE-STAGING-BLOCKED",
    });
    snapshot[STORAGE_KEYS.experiment_run_trays].push({
      task_code: "TASK-APPEARANCE-STAGING-BLOCKED",
      experiment_code: "EXP-APPEARANCE-SALT",
      tray_code: "TP-APPEARANCE-STAGING-BLOCKED",
      run_tray_status: "实验已完成",
    });
    snapshot[STORAGE_KEYS.samples].push({
      id: "sample-appearance-staging-blocked",
      code: "SP-APPEARANCE-STAGING-BLOCKED",
      task_code: "TASK-APPEARANCE-STAGING-BLOCKED",
      owner: "周工",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      flow_status: "实验后外观检测间存放",
      trays: [{ tray_code: "TP-APPEARANCE-STAGING-BLOCKED", status: "实验后外观检测间存放", quantity: 1 }],
    });

    const rows = buildZancunRowsFromSnapshot(snapshot, { now: TODAY });
    const result = applyZancunInventoryAction({
      now: TODAY,
      payload: { code: "TP-APPEARANCE-STAGING-BLOCKED", mode: "stockIn" },
      snapshot,
    });

    expect(rows.map((row) => row.trayCode)).not.toContain("TP-APPEARANCE-STAGING-BLOCKED");
    expect(result.error).toBe("未找到对应的入库托盘。");
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
      status: "实验后暂存间存放",
      trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "实验后暂存间存放", quantity: 4 }],
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
      status: "实验后暂存间存放",
      targetExperimentName: "",
      targetLab: "",
    });
    expect(result.error).toBe("该托盘已完成全部实验，当前应保留在暂存间。");
    expect(result.snapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_out" && event.tray_code === "SYLU-2026-03-001-TP-002")).toHaveLength(0);
  });
});
