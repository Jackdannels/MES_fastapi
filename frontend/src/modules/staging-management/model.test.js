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

  test("stock-out detail lists all non-staging target labs and recommends the nearest scheduled lab", () => {
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
        scheduled: true,
        targetExperimentCode: "SYLU-2026-04-102-B",
        targetLab: "盐雾试验室",
      }),
      expect.objectContaining({
        preferred: false,
        scheduled: true,
        targetExperimentCode: "SYLU-2026-04-102-A",
        targetLab: "振动一室",
      }),
    ]);
    expect(detail.targetDestinations.map((destination) => destination.targetLab)).not.toContain("恒温恒湿间（暂存间）");
    expect(detail.targetLab).toBe("盐雾试验室");
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
      targetExperimentCode: "SYLU-2026-04-102-B",
      targetLab: "盐雾试验室",
      targetLabCode: "LAB_SALT",
      targetLabId: 9,
    }));
    expect(detail).toEqual(expect.objectContaining({
      targetLab: "振动一室",
      targetLabCode: "LAB_VIBRATION_1",
      targetLabId: 11,
    }));
  });

  test("marks unscheduled fallback destinations as unavailable stock-out targets", () => {
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

    expect(detail).toEqual(
      expect.objectContaining({
        targetLab: "振动一室",
        targetUnavailableReason: "当前实验未排程，仅作为托底目标，暂不可出库。",
        targetIsFallback: true,
      }),
    );
    expect(result.error).toBe("当前实验未排程，仅作为托底目标，暂不可出库。");
  });

  test("stock-out detail keeps scheduled targets selectable when another target is unscheduled", () => {
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
      expect.objectContaining({
        scheduled: false,
        targetExperimentCode: "SYLU-2026-04-102-A",
        targetIsFallback: true,
        targetLab: "振动一室",
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
      status: "外观检测间存放",
      flow_status: "外观检测间存放",
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
        { detail: "SYLU-2026-06-022-TP-003 外观检测间存放", status: "外观检测间存放", time: "2026-06-07T16:05:51" },
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

  test("fully completed trays waiting for post-experiment staging are marked as planned staging", () => {
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
      inboundKind: "post-experiment",
      inboundKindLabel: "计划暂存",
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
      status: "外观检测间存放",
      trays: [{ tray_code: "SYLU-2026-04-122-TP-001", status: "外观检测间存放", quantity: 1 }],
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
        status: "外观检测间存放",
        trays: [{ tray_code: "SYLU-2026-04-123-TP-001", status: "外观检测间存放", quantity: 1 }],
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

    expect(row?.status).toBe("到货");
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
      status: "外观检测间存放",
      flow_status: "外观检测间存放",
      trays: [{ tray_code: "SYLU-2026-04-130-TP-001", status: "外观检测间存放", quantity: 1 }],
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
        status: "放置实验后暂存间",
        trays: [{ tray_code: `${taskCode}-TP-003`, status: "放置实验后暂存间", quantity: 1 }],
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

  test("treats a stale running tray as post-experiment inbound when all assigned run-trays are completed", () => {
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
    expect(result.error).toBe("");
    expect(result.row).toEqual(expect.objectContaining({ status: "放置实验后暂存间" }));
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
