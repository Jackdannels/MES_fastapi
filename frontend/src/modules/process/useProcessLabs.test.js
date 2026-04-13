import { describe, expect, test, vi } from "vitest";

import { useProcessLabs } from "./useProcessLabs";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/useSampleIntake";

// 过程管控页的风险点在于：实验室卡片、抽屉详情和托盘汇总必须来自同一份快照口径。
describe("useProcessLabs", () => {
  test("loads lab cards and opens task detail drawer in place", async () => {
    // 这里覆盖“卡片加载 -> 原地打开抽屉 -> 汇总托盘数”的完整主流程。
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-10T10:30:00Z",
          experiment_code: "TASK-001-B",
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
      "mes.experiments": [
        { experiment_code: "TASK-001-A", experiment_name: "Impact Test", task_code: "TASK-001" },
        { experiment_code: "TASK-001-B", experiment_name: "Thermal Cycle Test", task_code: "TASK-001" },
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
    expect(runningCount.value).toBe(0);
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
      testType: "Thermal Cycle Test",
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T08:00:00Z"));
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-1",
          device: "Lab-A",
          end_at: "2026-03-11T10:30:00Z",
          experiment_code: "TASK-001-A",
          planned_hours: 2,
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
    expect(persisted["mes.tasks"]).toEqual([expect.objectContaining({ code: "TASK-001", status: "任务进行中" })]);
    expect(persisted["mes.schedules"]).toEqual([
      expect.objectContaining({
        id: "schedule-1",
        start_at: "2026-03-11T08:00:00.000Z",
        end_at: "2026-03-11T10:00:00.000Z",
      }),
    ]);
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
    vi.useRealTimers();
  });

  test("dispatches samples-updated after starting an experiment so tray management refreshes immediately", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-11T10:30:00Z",
          experiment_code: "TASK-001-A",
          id: "schedule-1",
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
          status: "实验准备就绪",
          trays: [{ tray_code: "TRAY-READY-1", status: "实验准备就绪", quantity: 1 }],
          history: [],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    const { labCards, loadLabStatus, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "Lab-A", testType: "Impact Test" }],
      loadSnapshot,
      now: Date.parse("2026-03-11T08:00:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();
    await startExperiment(labCards.value[0]);

    expect(dispatchEventSpy.mock.calls.some(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toBe(true);
    dispatchEventSpy.mockRestore();
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

  test("keeps a lab card scheduled when trays are only ready but not explicitly started", async () => {
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
      status: "已排程",
      statusClass: "is-scheduled",
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
      status: "实验进行中",
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

  test("scopes task detail trays and samples to the scheduled experiment when experiment tray mappings exist", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "冲击一室",
          end_at: "2026-04-01T15:30:00Z",
          experiment_code: "SYLU-2026-03-001-A",
          start_at: "2026-04-01T12:00:00Z",
          task_code: "SYLU-2026-03-001",
        },
      ],
      "mes.tasks": [
        {
          code: "SYLU-2026-03-001",
          name: "演示任务001",
          sample_count: 6,
          status: "已排程",
          test_type: "温度冲击试验 / 高低温湿热试验 / 盐雾试验",
        },
      ],
      "mes.experiment_trays": [
        { id: "rel-1", task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", tray_code: "SYLU-2026-03-001-TP-001" },
        { id: "rel-2", task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", tray_code: "SYLU-2026-03-001-TP-002" },
        { id: "rel-3", task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-B", tray_code: "SYLU-2026-03-001-TP-003" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-03-001-SP-001",
          location: "接驳区",
          status: "实验进行中",
          task_code: "SYLU-2026-03-001",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-001-SP-002",
          location: "接驳区",
          status: "实验进行中",
          task_code: "SYLU-2026-03-001",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-001-SP-003",
          location: "接驳区",
          status: "已到达实验室",
          task_code: "SYLU-2026-03-001",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "已到达实验室", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-001-SP-004",
          location: "接驳区",
          status: "已到达实验室",
          task_code: "SYLU-2026-03-001",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "已到达实验室", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-001-SP-005",
          location: "接驳区",
          status: "到货",
          task_code: "SYLU-2026-03-001",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-003", status: "到货", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-001-SP-006",
          location: "接驳区",
          status: "到货",
          task_code: "SYLU-2026-03-001",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-003", status: "到货", quantity: 1 }],
        },
      ],
    }));
    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "冲击一室", testType: "温度冲击试验" }],
      loadSnapshot,
      now: Date.parse("2026-04-01T13:00:00Z"),
    });

    await loadLabStatus();
    openTaskOverview(labCards.value[0]);

    expect(selectedTaskDetail.value).toMatchObject({
      sampleCount: 4,
      selectedTrayCode: "SYLU-2026-03-001-TP-001",
      trayCount: 2,
      traySummary: "SYLU-2026-03-001-TP-001, SYLU-2026-03-001-TP-002",
    });
    expect(selectedTaskDetail.value.trayCodes).toEqual([
      "SYLU-2026-03-001-TP-001",
      "SYLU-2026-03-001-TP-002",
    ]);
    expect(selectedTaskDetail.value.runningTrayRows.map((row) => row.trayCode)).toEqual(["SYLU-2026-03-001-TP-001"]);
    expect(selectedTaskDetail.value.remainingTrayRows.map((row) => row.trayCode)).toEqual(["SYLU-2026-03-001-TP-002"]);
    expect(selectedTaskDetail.value.selectedTraySummary.sampleCodes).toEqual([
      "SYLU-2026-03-001-SP-001",
      "SYLU-2026-03-001-SP-002",
    ]);
    expect(selectedTaskDetail.value.runningTrayRows[0].sampleCodes).toEqual([
      "SYLU-2026-03-001-SP-001",
      "SYLU-2026-03-001-SP-002",
    ]);
    expect(selectedTaskDetail.value.remainingTrayRows[0].sampleCodes).toEqual([
      "SYLU-2026-03-001-SP-003",
      "SYLU-2026-03-001-SP-004",
    ]);
    expect(selectedTaskDetail.value.trayCodes).not.toContain("SYLU-2026-03-001-TP-003");
  });

  test("allows switching to a later scheduled task and keeps lab counts scoped to the selected experiment", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-1",
          device: "盐雾试验室",
          end_at: "2026-04-03T11:30:00Z",
          experiment_code: "SYLU-2026-03-005-A",
          start_at: "2026-04-03T08:00:00Z",
          task_code: "SYLU-2026-03-005",
        },
        {
          id: "schedule-2",
          device: "盐雾试验室",
          end_at: "2026-04-04T11:30:00Z",
          experiment_code: "SYLU-2026-03-006-B",
          start_at: "2026-04-04T08:00:00Z",
          task_code: "SYLU-2026-03-006",
        },
      ],
      "mes.tasks": [
        { code: "SYLU-2026-03-005", name: "任务005", status: "已排程", test_type: "盐雾试验" },
        { code: "SYLU-2026-03-006", name: "任务006", status: "已排程", test_type: "盐雾试验" },
      ],
      "mes.experiments": [
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "盐雾试验" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-A", tray_code: "SYLU-2026-03-005-TP-001" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-001" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", tray_code: "SYLU-2026-03-006-TP-002" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-03-005-SP-001",
          task_code: "SYLU-2026-03-005",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-03-005-TP-001", status: "实验准备就绪", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-006-SP-001",
          task_code: "SYLU-2026-03-006",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-03-006-TP-001", status: "实验准备就绪", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-006-SP-002",
          task_code: "SYLU-2026-03-006",
          location: "盐雾试验室",
          status: "已到达实验室",
          trays: [{ tray_code: "SYLU-2026-03-006-TP-002", status: "已到达实验室", quantity: 1 }],
        },
      ],
    }));

    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail, setSelectedTaskForLab } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-04-03T09:00:00Z"),
    });

    await loadLabStatus();

    expect(labCards.value[0]).toMatchObject({
      taskCode: "SYLU-2026-03-005",
      readyTrayCount: 1,
      remainingTrayCount: 1,
    });

    await openTaskOverview(labCards.value[0]);
    setSelectedTaskForLab("盐雾试验室", "SYLU-2026-03-006");

    expect(labCards.value[0]).toMatchObject({
      taskCode: "SYLU-2026-03-006",
      readyTrayCount: 1,
      remainingTrayCount: 1,
      targetExperiment: "盐雾试验",
    });
    expect(selectedTaskDetail.value).toMatchObject({
      code: "SYLU-2026-03-006",
      trayCodes: ["SYLU-2026-03-006-TP-001"],
      remainingTrayCount: 1,
      readyTrayCount: 1,
    });
    expect(selectedTaskDetail.value.trayCodes).not.toContain("SYLU-2026-03-006-TP-002");
  });

  test("starts only ready trays from the selected experiment and leaves other experiment trays untouched", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T08:00:00Z"));
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-1",
          device: "盐雾试验室",
          end_at: "2026-04-03T11:30:00Z",
          experiment_code: "SYLU-2026-03-005-A",
          planned_hours: 3.5,
          start_at: "2026-04-03T08:00:00Z",
          task_code: "SYLU-2026-03-005",
        },
      ],
      "mes.tasks": [{ code: "SYLU-2026-03-005", name: "任务005", status: "已排程", test_type: "盐雾试验" }],
      "mes.experiments": [
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-B", experiment_name: "高低温湿热试验" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-A", tray_code: "SYLU-2026-03-005-TP-001" },
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-B", tray_code: "SYLU-2026-03-005-TP-002" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-03-005-SP-001",
          task_code: "SYLU-2026-03-005",
          location: "盐雾试验室",
          owner: "张三",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-03-005-TP-001", status: "实验准备就绪", quantity: 1 }],
          history: [],
        },
        {
          code: "SYLU-2026-03-005-SP-002",
          task_code: "SYLU-2026-03-005",
          location: "高低温湿热一室",
          owner: "李四",
          status: "已到达实验室",
          trays: [{ tray_code: "SYLU-2026-03-005-TP-002", status: "已到达实验室", quantity: 1 }],
          history: [],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const {
      currentStartableTrayRows,
      labCards,
      loadLabStatus,
      openTaskOverview,
      openStartExperimentModal,
      selectedTaskDetail,
      startExperiment,
      startExperimentModalOpen,
    } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-04-03T08:00:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();
    await openTaskOverview(labCards.value[0]);
    await openStartExperimentModal(labCards.value[0]);

    expect(startExperimentModalOpen.value).toBe(true);
    expect(currentStartableTrayRows.value.map((row) => row.trayCode)).toEqual(["SYLU-2026-03-005-TP-001"]);

    await startExperiment(labCards.value[0]);

    const persisted = persistSnapshot.mock.calls[0][0];
    expect(persisted["mes.samples"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SYLU-2026-03-005-SP-001",
          status: "实验进行中",
          trays: [expect.objectContaining({ tray_code: "SYLU-2026-03-005-TP-001", status: "实验进行中" })],
        }),
        expect.objectContaining({
          code: "SYLU-2026-03-005-SP-002",
          status: "已到达实验室",
          trays: [expect.objectContaining({ tray_code: "SYLU-2026-03-005-TP-002", status: "已到达实验室" })],
        }),
      ]),
    );
    expect(selectedTaskDetail.value.remainingTrayCount).toBe(0);
    vi.useRealTimers();
  });

  test("starts ready trays when the sample is ready but tray-level status is blank", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T08:05:00Z"));
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-1",
          device: "盐雾试验室",
          end_at: "2026-04-03T11:30:00Z",
          experiment_code: "SYLU-2026-03-002-A",
          planned_hours: 3.5,
          start_at: "2026-04-03T08:00:00Z",
          task_code: "SYLU-2026-03-002",
        },
      ],
      "mes.tasks": [{ code: "SYLU-2026-03-002", name: "任务002", status: "已排程", test_type: "盐雾试验" }],
      "mes.experiments": [
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-A", experiment_name: "盐雾试验" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-A", tray_code: "SYLU-2026-03-002-TP-001" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-03-002-SP-001",
          task_code: "SYLU-2026-03-002",
          location: "盐雾试验室",
          owner: "张三",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-001", status: "", quantity: 1 }],
          history: [],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, openStartExperimentModal, startExperiment, startExperimentModalOpen } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-04-03T08:00:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();
    await openStartExperimentModal(labCards.value[0]);

    expect(startExperimentModalOpen.value).toBe(true);

    await startExperiment(labCards.value[0]);

    const persisted = persistSnapshot.mock.calls[0][0];
    expect(persisted["mes.samples"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SYLU-2026-03-002-SP-001",
          status: "实验进行中",
          trays: [expect.objectContaining({ tray_code: "SYLU-2026-03-002-TP-001", status: "实验进行中" })],
        }),
      ]),
    );
    vi.useRealTimers();
  });

  test("keeps future experiment cards scheduled when shared trays are running only in the current laboratory", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-salt",
          device: "盐雾试验室",
          end_at: "2026-04-09T13:35:38Z",
          experiment_code: "SYLU-2026-03-002-A",
          start_at: "2026-04-09T10:05:38Z",
          task_code: "SYLU-2026-03-002",
        },
        {
          id: "schedule-thermal",
          device: "高低温湿热一室",
          end_at: "2026-04-10T07:30:00Z",
          experiment_code: "SYLU-2026-03-002-B",
          start_at: "2026-04-10T04:00:00Z",
          task_code: "SYLU-2026-03-002",
        },
        {
          id: "schedule-vibration",
          device: "振动一室",
          end_at: "2026-04-10T07:30:00Z",
          experiment_code: "SYLU-2026-03-002-C",
          start_at: "2026-04-10T04:00:00Z",
          task_code: "SYLU-2026-03-002",
        },
      ],
      "mes.tasks": [{ code: "SYLU-2026-03-002", name: "任务002", status: "实验中", test_type: "盐雾试验 / 高低温湿热试验 / 振动试验" }],
      "mes.experiments": [
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-B", experiment_name: "高低温湿热试验" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-C", experiment_name: "振动试验" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-A", tray_code: "SYLU-2026-03-002-TP-001" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-A", tray_code: "SYLU-2026-03-002-TP-002" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-B", tray_code: "SYLU-2026-03-002-TP-002" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-C", tray_code: "SYLU-2026-03-002-TP-001" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-03-002-SP-001",
          task_code: "SYLU-2026-03-002",
          location: "盐雾试验室",
          status: "实验进行中",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-001", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-002-SP-005",
          task_code: "SYLU-2026-03-002",
          location: "盐雾试验室",
          status: "实验进行中",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-002", status: "实验进行中", quantity: 1 }],
        },
      ],
    }));

    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      labs: [
        { name: "盐雾试验室", testType: "盐雾试验" },
        { name: "高低温湿热一室", testType: "高低温湿热试验" },
        { name: "振动一室", testType: "振动试验" },
      ],
      loadSnapshot,
      now: Date.parse("2026-04-09T18:30:00Z"),
    });

    await loadLabStatus();

    expect(labCards.value.find((card) => card.name === "盐雾试验室")).toMatchObject({
      runningTrayCount: 2,
      status: "实验进行中",
      statusClass: "is-running",
    });
    expect(labCards.value.find((card) => card.name === "高低温湿热一室")).toMatchObject({
      runningTrayCount: 0,
      status: "已排程",
      statusClass: "is-scheduled",
    });
    expect(labCards.value.find((card) => card.name === "振动一室")).toMatchObject({
      runningTrayCount: 0,
      status: "已排程",
      statusClass: "is-scheduled",
    });
  });

  test("builds a compressed multi-experiment tray flow for the selected process task", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-1",
          device: "盐雾试验室",
          end_at: "2026-04-03T11:30:00Z",
          experiment_code: "SYLU-2026-03-005-B",
          start_at: "2026-04-03T08:00:00Z",
          task_code: "SYLU-2026-03-005",
        },
      ],
      "mes.tasks": [{ code: "SYLU-2026-03-005", name: "任务005", status: "已排程", test_type: "盐雾试验" }],
      "mes.experiments": [
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-A", experiment_name: "A实验" },
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-B", experiment_name: "B实验" },
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-C", experiment_name: "C实验" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-A", tray_code: "SYLU-2026-03-005-TP-001" },
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-B", tray_code: "SYLU-2026-03-005-TP-001" },
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-C", tray_code: "SYLU-2026-03-005-TP-001" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-03-005-SP-001",
          task_code: "SYLU-2026-03-005",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-03-005-TP-001", status: "实验准备就绪", quantity: 1 }],
        },
      ],
    }));

    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-04-03T09:00:00Z"),
    });

    await loadLabStatus();
    await openTaskOverview(labCards.value[0]);

    expect(selectedTaskDetail.value.selectedTrayFlow.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "A实验已完成",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "B实验进行中",
      "C实验未完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
  });
});
