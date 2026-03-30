import { describe, expect, test, vi } from "vitest";

import { useProcessLabs } from "./useProcessLabs";

// 过程管控页的风险点在于：实验室卡片、抽屉详情和托盘汇总必须来自同一份快照口径。
describe("useProcessLabs", () => {
  test("loads lab cards and opens task detail drawer in place", async () => {
    // 这里覆盖“卡片加载 -> 原地打开抽屉 -> 汇总托盘数”的完整主流程。
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-10T10:30:00Z",
          start_at: "2026-03-10T09:30:00Z",
          task_code: "TASK-001",
        },
        {
          device: "Lab-B",
          end_at: "2026-03-10T13:00:00Z",
          start_at: "2026-03-10T12:00:00Z",
          task_code: "TASK-002",
        },
      ],
      "mes.tasks": [
        {
          code: "TASK-001",
          name: "Impact Campaign Batch A",
          priority: "High",
          required_device: "Rig-A",
          sample_count: 12,
          source: "External",
          status: "Running",
          test_type: "Impact Test",
        },
        {
          code: "TASK-002",
          test_type: "Vibration Test",
        },
      ],
      "mes.samples": [
        {
          code: "S-001",
          task_code: "TASK-001",
          trays: [{ tray_code: "TRAY-001", quantity: 1 }],
        },
        {
          code: "S-002",
          task_code: "TASK-001",
          trays: [
            { tray_code: "TRAY-002", quantity: 1 },
            { tray_code: "TRAY-003", quantity: 1 },
            { tray_code: "TRAY-004", quantity: 1 },
          ],
        },
      ],
    }));
    const navigate = vi.fn();
    const {
      activeFilter,
      idleCount,
      labCards,
      loadLabStatus,
      loading,
      openTaskOverview,
      overviewCount,
      runningCount,
      scheduledCount,
      setActiveFilter,
      selectedTaskDetail,
      taskDrawerOpen,
      visibleLabCards,
      closeTaskDrawer,
    } = useProcessLabs({
      autoLoad: false,
      labs: [
        { name: "Lab-A", testType: "Impact Test" },
        { name: "Lab-B", testType: "Vibration Test" },
        { name: "Lab-C", testType: "Salt Spray Test" },
      ],
      loadSnapshot,
      navigate,
      now: Date.parse("2026-03-10T10:00:00Z"),
    });

    await loadLabStatus();

    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    expect(loading.value).toBe(false);
    expect(activeFilter.value).toBe("overview");
    expect(labCards.value).toHaveLength(3);
    expect(overviewCount.value).toBe(3);
    expect(runningCount.value).toBe(1);
    expect(scheduledCount.value).toBe(2);
    expect(idleCount.value).toBe(1);
    expect(visibleLabCards.value).toHaveLength(3);

    setActiveFilter("idle");

    expect(visibleLabCards.value).toEqual([
      expect.objectContaining({
        name: "Lab-C",
        status: "空闲",
        statusClass: "is-idle",
      }),
    ]);

    setActiveFilter("scheduled");

    expect(visibleLabCards.value).toHaveLength(2);
    expect(visibleLabCards.value.map((lab) => lab.name)).toEqual(["Lab-A", "Lab-B"]);

    openTaskOverview(labCards.value[0]);

    expect(navigate).not.toHaveBeenCalled();
    expect(taskDrawerOpen.value).toBe(true);
    expect(selectedTaskDetail.value).toMatchObject({
      code: "TASK-001",
      name: "Impact Campaign Batch A",
      displayName: "Impact Campaign",
      priority: "High",
      requiredDevice: "Rig-A",
      sampleCount: 12,
      source: "External",
      status: "Running",
      testType: "Impact Test",
      trayCount: 4,
      traySummary: "TRAY-001, TRAY-002, TRAY-003 +1",
    });
    expect(selectedTaskDetail.value.trayCodes).toEqual(["TRAY-001", "TRAY-002", "TRAY-003", "TRAY-004"]);
    expect(selectedTaskDetail.value.runningTrayRows).toEqual([]);
    expect(selectedTaskDetail.value.remainingTrayRows.map((row) => row.trayCode)).toEqual([
      "TRAY-001",
      "TRAY-002",
      "TRAY-003",
      "TRAY-004",
    ]);

    closeTaskDrawer();

    expect(taskDrawerOpen.value).toBe(false);
    expect(selectedTaskDetail.value).toBe(null);
  });

  test("starts only ready trays, persists updates, and reports started and remaining tray counts", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-11T10:30:00Z",
          start_at: "2026-03-11T09:30:00Z",
          task_code: "TASK-001",
        },
      ],
      "mes.tasks": [{ code: "TASK-001", name: "Task A", status: "已排程", test_type: "Impact Test" }],
      "mes.samples": [
        {
          code: "S-001",
          task_code: "TASK-001",
          location: "Lab-A",
          owner: "张三",
          status: "实验准备就绪",
          trays: [{ tray_code: "TRAY-READY-1", status: "实验准备就绪", quantity: 1 }],
          history: [],
        },
        {
          code: "S-002",
          task_code: "TASK-001",
          location: "Lab-A",
          owner: "李四",
          status: "实验准备就绪",
          trays: [{ tray_code: "TRAY-READY-2", status: "实验准备就绪", quantity: 1 }],
          history: [],
        },
        {
          code: "S-003",
          task_code: "TASK-001",
          location: "Lab-A",
          owner: "王五",
          status: "已到达实验室",
          trays: [{ tray_code: "TRAY-WAIT", status: "已到达实验室", quantity: 1 }],
          history: [],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, openTaskOverview, processActionMessage, selectedTaskDetail, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "Lab-A", testType: "Impact Test" }],
      loadSnapshot,
      now: Date.parse("2026-03-11T08:00:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();

    expect(labCards.value[0]).toMatchObject({
      canStartExperiment: true,
      readyTrayCount: 2,
      runningTrayCount: 0,
      remainingTrayCount: 3,
    });

    openTaskOverview(labCards.value[0]);

    expect(selectedTaskDetail.value.runningTrayRows).toEqual([]);
    expect(selectedTaskDetail.value.remainingTrayRows.map((row) => row.trayCode)).toEqual([
      "TRAY-READY-1",
      "TRAY-READY-2",
      "TRAY-WAIT",
    ]);

    await startExperiment(labCards.value[0]);

    expect(persistSnapshot).toHaveBeenCalledTimes(1);
    const persisted = persistSnapshot.mock.calls[0][0];
    expect(persisted["mes.tasks"]).toEqual([expect.objectContaining({ code: "TASK-001", status: "实验中" })]);
    expect(persisted["mes.samples"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "S-001",
          status: "实验进行中",
          trays: [expect.objectContaining({ tray_code: "TRAY-READY-1", status: "实验进行中" })],
        }),
        expect.objectContaining({
          code: "S-002",
          status: "实验进行中",
          trays: [expect.objectContaining({ tray_code: "TRAY-READY-2", status: "实验进行中" })],
        }),
        expect.objectContaining({
          code: "S-003",
          status: "已到达实验室",
          trays: [expect.objectContaining({ tray_code: "TRAY-WAIT", status: "已到达实验室" })],
        }),
      ]),
    );
    expect(processActionMessage.value).toBe("当前开始进行2个托盘，剩余1个托盘。");
    expect(labCards.value[0]).toMatchObject({
      canStartExperiment: false,
      readyTrayCount: 0,
      runningTrayCount: 2,
      remainingTrayCount: 1,
    });
    expect(selectedTaskDetail.value.runningTrayRows.map((row) => row.trayCode)).toEqual(["TRAY-READY-1", "TRAY-READY-2"]);
    expect(selectedTaskDetail.value.remainingTrayRows.map((row) => row.trayCode)).toEqual(["TRAY-WAIT"]);
  });

  test("disables start experiment when any tray is already running", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-11T10:30:00Z",
          start_at: "2026-03-11T09:30:00Z",
          task_code: "TASK-001",
        },
      ],
      "mes.tasks": [{ code: "TASK-001", name: "Task A", status: "实验中", test_type: "Impact Test" }],
      "mes.samples": [
        {
          code: "S-001",
          task_code: "TASK-001",
          location: "Lab-A",
          owner: "张三",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-RUNNING", status: "实验进行中", quantity: 1 }],
          history: [],
        },
        {
          code: "S-002",
          task_code: "TASK-001",
          location: "Lab-A",
          owner: "李四",
          status: "实验准备就绪",
          trays: [{ tray_code: "TRAY-READY", status: "实验准备就绪", quantity: 1 }],
          history: [],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "Lab-A", testType: "Impact Test" }],
      loadSnapshot,
      now: Date.parse("2026-03-11T08:00:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();

    expect(labCards.value[0]).toMatchObject({
      canStartExperiment: false,
      readyTrayCount: 1,
      runningTrayCount: 1,
      startDisabledReason: "当前批次实验未结束",
    });

    await startExperiment(labCards.value[0]);

    expect(persistSnapshot).not.toHaveBeenCalled();
  });

  test("keeps a lab card running when any tray is still in the active experiment chain", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-11T10:30:00Z",
          start_at: "2026-03-11T09:30:00Z",
          task_code: "TASK-001",
        },
      ],
      "mes.tasks": [{ code: "TASK-001", test_type: "Impact Test", status: "已排程" }],
      "mes.samples": [
        {
          code: "S-001",
          task_code: "TASK-001",
          status: "实验准备就绪",
          trays: [{ tray_code: "TRAY-001", status: "实验准备就绪", quantity: 1 }],
        },
      ],
    }));
    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "Lab-A", testType: "Impact Test" }],
      loadSnapshot,
      now: Date.parse("2026-03-11T08:00:00Z"),
    });

    await loadLabStatus();

    expect(labCards.value[0]).toMatchObject({
      name: "Lab-A",
      status: "实验中",
      statusClass: "is-running",
    });
  });

  test("keeps a lab card running when a tray is in in-progress status", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-11T10:30:00Z",
          start_at: "2026-03-11T09:30:00Z",
          task_code: "TASK-001",
        },
      ],
      "mes.tasks": [{ code: "TASK-001", test_type: "Impact Test", status: "已排程" }],
      "mes.samples": [
        {
          code: "S-001",
          task_code: "TASK-001",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-001", status: "实验进行中", quantity: 1 }],
        },
      ],
    }));
    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "Lab-A", testType: "Impact Test" }],
      loadSnapshot,
      now: Date.parse("2026-03-11T08:00:00Z"),
    });

    await loadLabStatus();

    expect(labCards.value[0]).toMatchObject({
      name: "Lab-A",
      status: "实验中",
      statusClass: "is-running",
    });
  });

  test("marks a lab card completed only when all trays reach complete or post-complete states", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-10T10:30:00Z",
          start_at: "2026-03-10T09:30:00Z",
          task_code: "TASK-001",
        },
      ],
      "mes.tasks": [{ code: "TASK-001", test_type: "Impact Test", status: "已排程" }],
      "mes.samples": [
        {
          code: "S-001",
          task_code: "TASK-001",
          status: "实验已完成",
          trays: [{ tray_code: "TRAY-001", status: "实验已完成", quantity: 1 }],
        },
        {
          code: "S-002",
          task_code: "TASK-001",
          status: "厂家收回",
          trays: [{ tray_code: "TRAY-002", status: "厂家收回", quantity: 1 }],
        },
      ],
    }));
    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "Lab-A", testType: "Impact Test" }],
      loadSnapshot,
      now: Date.parse("2026-03-10T12:00:00Z"),
    });

    await loadLabStatus();

    expect(labCards.value[0]).toMatchObject({
      name: "Lab-A",
      status: "空闲",
      statusClass: "is-idle",
    });
  });

  test("builds tray flow from shared flow status instead of raw tray status", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "接样实验室",
          end_at: "2026-03-10T10:30:00Z",
          start_at: "2026-03-10T09:30:00Z",
          task_code: "TASK-001",
        },
      ],
      "mes.tasks": [{ code: "TASK-001", name: "Task A", test_type: "Impact Test" }],
      "mes.samples": [
        {
          code: "S-001",
          task_code: "TASK-001",
          location: "接驳区",
          owner: "张三",
          status: "已入库",
          trays: [{ tray_code: "TRAY-001", status: "已入库", quantity: 1 }],
        },
      ],
    }));
    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "接样实验室", testType: "Impact Test" }],
      loadSnapshot,
      now: Date.parse("2026-03-10T10:00:00Z"),
    });

    await loadLabStatus();
    openTaskOverview(labCards.value[0]);

    expect(selectedTaskDetail.value.selectedTraySummary).toMatchObject({
      flowStatus: "到货",
      status: "到货",
      trayCode: "TRAY-001",
    });
    expect(selectedTaskDetail.value.selectedTrayFlow.currentStatus).toBe("当前托盘：TRAY-001 | 当前状态：到货");
    expect(selectedTaskDetail.value.selectedTrayFlow.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "arrived", active: true, label: "到货" }),
        expect.objectContaining({ key: "in_transit", reached: true, label: "样品运输中" }),
      ]),
    );
  });

  test("falls back to experiment tray relations when samples do not carry tray bindings", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "冲击一室",
          end_at: "2026-03-29T11:30:00Z",
          start_at: "2026-03-29T08:00:00Z",
          task_code: "SYLU-2026-03-001",
        },
      ],
      "mes.tasks": [
        {
          code: "SYLU-2026-03-001",
          name: "温度冲击试验",
          sample_count: 6,
          status: "已排程",
          test_type: "温度冲击试验",
        },
      ],
      "mes.experiment_trays": [
        { id: "rel-1", task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", tray_code: "SYLU-2026-03-001-TP-001" },
        { id: "rel-2", task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", tray_code: "SYLU-2026-03-001-TP-002" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-03-001-SP-001",
          location: "接驳区",
          status: "样品运输中",
          task_code: "SYLU-2026-03-001",
        },
        {
          code: "SYLU-2026-03-001-SP-002",
          location: "接驳区",
          status: "样品运输中",
          task_code: "SYLU-2026-03-001",
        },
      ],
    }));
    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "冲击一室", testType: "温度冲击试验" }],
      loadSnapshot,
      now: Date.parse("2026-03-29T09:00:00Z"),
    });

    await loadLabStatus();
    openTaskOverview(labCards.value[0]);

    expect(selectedTaskDetail.value).toMatchObject({
      trayCount: 2,
      traySummary: "SYLU-2026-03-001-TP-001, SYLU-2026-03-001-TP-002",
    });
    expect(selectedTaskDetail.value.trayRows.map((row) => row.trayCode)).toEqual([
      "SYLU-2026-03-001-TP-001",
      "SYLU-2026-03-001-TP-002",
    ]);
    expect(selectedTaskDetail.value.selectedTraySummary).toMatchObject({
      flowStatus: "样品运输中",
      status: "样品运输中",
      trayCode: "SYLU-2026-03-001-TP-001",
    });
  });

  test("falls back to transfer workspace trays when storage snapshots do not yet carry tray relations", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "振动一室",
          end_at: "2026-03-29T11:30:00Z",
          start_at: "2026-03-29T08:00:00Z",
          task_code: "SYLU-2026-03-001",
        },
      ],
      "mes.tasks": [
        {
          code: "SYLU-2026-03-001",
          name: "温度冲击试验",
          sample_count: 6,
          status: "已排程",
          test_type: "温度冲击试验",
          tray_codes: [],
        },
      ],
      "mes.experiment_trays": [],
      "mes.samples": [
        {
          code: "SYLU-2026-03-001-SP-001",
          location: "接驳区",
          status: "样品运输中",
          task_code: "SYLU-2026-03-001",
          trays: [],
        },
      ],
    }));
    const loadTransferWorkspace = vi.fn(async () => ({
      assignedTrays: [
        {
          trayNo: "SYLU-2026-03-001-TP-001",
          trayStatus: "已预分配",
          samples: [
            { sampleNo: "SYLU-2026-03-001-SP-001", sampleStatus: "未入库" },
            { sampleNo: "SYLU-2026-03-001-SP-002", sampleStatus: "未入库" },
          ],
        },
        {
          trayNo: "SYLU-2026-03-001-TP-002",
          trayStatus: "已预分配",
          samples: [
            { sampleNo: "SYLU-2026-03-001-SP-003", sampleStatus: "未入库" },
          ],
        },
      ],
    }));
    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "振动一室", testType: "振动试验" }],
      loadSnapshot,
      loadTransferWorkspace,
      now: Date.parse("2026-03-29T09:00:00Z"),
    });

    await loadLabStatus();
    await openTaskOverview(labCards.value[0]);

    expect(loadTransferWorkspace).toHaveBeenCalledWith("SYLU-2026-03-001");
    expect(selectedTaskDetail.value).toMatchObject({
      trayCount: 2,
      traySummary: "SYLU-2026-03-001-TP-001, SYLU-2026-03-001-TP-002",
    });
    expect(selectedTaskDetail.value.trayRows.map((row) => row.trayCode)).toEqual([
      "SYLU-2026-03-001-TP-001",
      "SYLU-2026-03-001-TP-002",
    ]);
    expect(selectedTaskDetail.value.selectedTraySummary).toMatchObject({
      sampleSummary: "SYLU-2026-03-001-SP-001、SYLU-2026-03-001-SP-002",
      trayCode: "SYLU-2026-03-001-TP-001",
    });
  });
});
