import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { useProcessLabs } from "./useProcessLabs";
import { HOST_INTERFACE_MODE_STORAGE_KEY, HOST_INTERFACE_MODES } from "@/lib/hostInterfaceMode";
import { SNAPSHOT_UPDATED_EVENT } from "@/lib/storageApi";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

const flushStorageRefresh = async () => {
  vi.advanceTimersByTime(100);
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
};

const masterDataMocks = vi.hoisted(() => ({
  readMasterLabs: vi.fn(async () => []),
}));

vi.mock("@/lib/masterDataApi", () => ({
  readMasterLabs: masterDataMocks.readMasterLabs,
}));

// 过程管控页的风险点在于：实验室卡片、抽屉详情和托盘汇总必须来自同一份快照口径。
describe("useProcessLabs", () => {
  beforeEach(() => {
    masterDataMocks.readMasterLabs.mockReset();
    masterDataMocks.readMasterLabs.mockResolvedValue([]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  });

  test("uses enabled formal master labs for process cards when explicit labs are not provided", async () => {
    masterDataMocks.readMasterLabs.mockResolvedValue([
      { code: "LAB_CUSTOM", name: "自定义疲劳实验室", type: "实验室", testTypeName: "疲劳试验", status: 1 },
      { code: "AREA_STAGING_PRE", name: "恒温恒湿间（暂存间）", type: "暂存间", testTypeName: "", status: 1 },
      { code: "LAB_DISABLED", name: "停用实验室", type: "实验室", testTypeName: "盐雾试验", status: 0 },
    ]);
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "自定义疲劳实验室",
          end_at: "2026-03-10T13:00:00Z",
          start_at: "2026-03-10T12:00:00Z",
          task_code: "TASK-CUSTOM",
        },
      ],
      "mes.tasks": [{ code: "TASK-CUSTOM", test_type: "疲劳试验" }],
      "mes.experiments": [],
      "mes.experiment_trays": [],
      "mes.samples": [],
    }));

    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      loadSnapshot,
      now: Date.parse("2026-03-10T10:00:00Z"),
    });

    await loadLabStatus();

    expect(masterDataMocks.readMasterLabs).toHaveBeenCalledTimes(1);
    expect(labCards.value).toEqual([
      expect.objectContaining({
        name: "自定义疲劳实验室",
        statusClass: "is-scheduled",
        taskCode: "TASK-CUSTOM",
        testType: "疲劳试验",
      }),
    ]);
  });

  test("keeps canonical salt spray lab when master labs are present but incomplete", async () => {
    masterDataMocks.readMasterLabs.mockResolvedValue([
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ]);
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [],
      "mes.tasks": [],
      "mes.experiments": [],
      "mes.experiment_trays": [],
      "mes.samples": [],
    }));

    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      loadSnapshot,
    });

    await loadLabStatus();

    expect(labCards.value.map((lab) => lab.name)).toContain("冲击一室");
    expect(labCards.value.map((lab) => lab.name)).toContain("盐雾试验室");
  });

  test("does not duplicate canonical labs when master labs already include them", async () => {
    masterDataMocks.readMasterLabs.mockResolvedValue([
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ]);
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [],
      "mes.tasks": [],
      "mes.experiments": [],
      "mes.experiment_trays": [],
      "mes.samples": [],
    }));

    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      loadSnapshot,
    });

    await loadLabStatus();

    expect(labCards.value.filter((lab) => lab.name === "盐雾试验室")).toHaveLength(1);
  });

  test("does not read master labs when explicit process labs are provided", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [],
      "mes.tasks": [],
      "mes.experiments": [],
      "mes.experiment_trays": [],
      "mes.samples": [],
    }));

    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "显式实验室", testType: "显式试验" }],
      loadSnapshot,
    });

    await loadLabStatus();

    expect(masterDataMocks.readMasterLabs).not.toHaveBeenCalled();
    expect(labCards.value.map((lab) => lab.name)).toEqual(["显式实验室"]);
  });

  test("falls back to static process labs when master labs cannot be loaded", async () => {
    masterDataMocks.readMasterLabs.mockRejectedValue(new Error("offline"));
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [],
      "mes.tasks": [],
      "mes.experiments": [],
      "mes.experiment_trays": [],
      "mes.samples": [],
    }));

    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      loadSnapshot,
    });

    await loadLabStatus();

    expect(masterDataMocks.readMasterLabs).toHaveBeenCalledTimes(1);
    expect(labCards.value.map((lab) => lab.name)).toContain("盐雾试验室");
    expect(labCards.value.length).toBeGreaterThan(1);
  });

  test("falls back to static process labs when master labs contain no formal laboratory", async () => {
    masterDataMocks.readMasterLabs.mockResolvedValue([
      { code: "AREA_STAGING_PRE", name: "恒温恒湿间（暂存间）", type: "暂存间", testTypeName: "", status: 1 },
    ]);
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [],
      "mes.tasks": [],
      "mes.experiments": [],
      "mes.experiment_trays": [],
      "mes.samples": [],
    }));

    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      loadSnapshot,
    });

    await loadLabStatus();

    expect(labCards.value.map((lab) => lab.name)).toContain("盐雾试验室");
    expect(labCards.value.length).toBeGreaterThan(1);
  });

  test("reloads lab status when sample progress changes are broadcast", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [],
      "mes.tasks": [],
      "mes.experiments": [],
      "mes.experiment_trays": [],
      "mes.samples": [],
    }));
    const Harness = {
      setup() {
        useProcessLabs({
          autoLoad: true,
          labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
          loadSnapshot,
        });
        return {};
      },
      template: "<div />",
    };

    const wrapper = mount(Harness);
    await Promise.resolve();
    await nextTick();

    expect(loadSnapshot).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await Promise.resolve();
    await nextTick();

    expect(loadSnapshot).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await Promise.resolve();

    expect(loadSnapshot).toHaveBeenCalledTimes(2);
  });

  test("reloads lab status when a cross-window storage update marker changes", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [],
      "mes.tasks": [],
      "mes.experiments": [],
      "mes.experiment_trays": [],
      "mes.samples": [],
    }));
    const Harness = {
      setup() {
        useProcessLabs({
          autoLoad: true,
          labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
          loadSnapshot,
        });
        return {};
      },
      template: "<div />",
    };

    const wrapper = mount(Harness);
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(loadSnapshot).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    window.dispatchEvent(new StorageEvent("storage", { key: "mes:snapshot-updated-at", newValue: "2026-04-01T12:00:00.000Z" }));
    await flushStorageRefresh();

    expect(loadSnapshot).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "1" }));
    await flushStorageRefresh();

    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    wrapper.unmount();
  });

  test("enables start experiment when laboratory ready writes a storage snapshot update", async () => {
    const loadSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        "mes.devices": [],
        "mes.schedules": [
          {
            device: "盐雾试验室",
            experiment_code: "TASK-READY-A",
            start_at: "2026-03-10T09:00:00Z",
            end_at: "2026-03-10T11:00:00Z",
            task_code: "TASK-READY",
          },
        ],
        "mes.tasks": [{ code: "TASK-READY", name: "准备就绪任务", test_type: "盐雾试验" }],
        "mes.experiments": [
          {
            task_code: "TASK-READY",
            experiment_code: "TASK-READY-A",
            experiment_name: "盐雾试验",
          },
        ],
        "mes.experiment_trays": [
          { task_code: "TASK-READY", experiment_code: "TASK-READY-A", tray_code: "TP-READY-001" },
        ],
        "mes.samples": [
          {
            code: "SP-READY-001",
            task_code: "TASK-READY",
            status: "工装夹具安装",
            flow_status: "工装夹具安装",
            location: "盐雾试验室",
            trays: [{ tray_code: "TP-READY-001", status: "工装夹具安装", quantity: 1 }],
          },
        ],
      })
      .mockResolvedValueOnce({
        "mes.devices": [],
        "mes.schedules": [
          {
            device: "盐雾试验室",
            experiment_code: "TASK-READY-A",
            start_at: "2026-03-10T09:00:00Z",
            end_at: "2026-03-10T11:00:00Z",
            task_code: "TASK-READY",
          },
        ],
        "mes.tasks": [{ code: "TASK-READY", name: "准备就绪任务", test_type: "盐雾试验" }],
        "mes.experiments": [
          {
            task_code: "TASK-READY",
            experiment_code: "TASK-READY-A",
            experiment_name: "盐雾试验",
          },
        ],
        "mes.experiment_trays": [
          { task_code: "TASK-READY", experiment_code: "TASK-READY-A", tray_code: "TP-READY-001" },
        ],
        "mes.samples": [
          {
            code: "SP-READY-001",
            task_code: "TASK-READY",
            status: "实验准备就绪",
            flow_status: "实验准备就绪",
            location: "盐雾试验室",
            trays: [{ tray_code: "TP-READY-001", status: "实验准备就绪", quantity: 1 }],
          },
        ],
      });
    let exposed = null;
    const Harness = {
      setup() {
        exposed = useProcessLabs({
          autoLoad: true,
          labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
          loadSnapshot,
          now: Date.parse("2026-03-10T09:30:00Z"),
        });
        return {};
      },
      template: "<div />",
    };

    const wrapper = mount(Harness);
    await Promise.resolve();
    await nextTick();

    expect(exposed.labCards.value[0]).toEqual(expect.objectContaining({
      canStartExperiment: false,
      readyTrayCount: 0,
    }));

    vi.useFakeTimers();
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: { keys: ["mes.samples"] } }));
    await flushStorageRefresh();

    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(exposed.labCards.value[0]).toEqual(expect.objectContaining({
      canStartExperiment: true,
      readyTrayCount: 1,
    }));
    vi.useRealTimers();
    wrapper.unmount();
  });

  test("enables start experiment for impact lab when laboratory ready writes a storage snapshot update", async () => {
    const eventSources = [];
    class MockEventSource {
      constructor(url, options) {
        this.url = url;
        this.options = options;
        this.listeners = {};
        this.close = vi.fn();
        eventSources.push(this);
      }

      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }
    }
    vi.stubGlobal("EventSource", MockEventSource);
    const createSnapshot = (status) => ({
      "mes.devices": [],
      "mes.schedules": [
        {
          id: "schedule-impact",
          device: "冲击一室",
          experiment_code: "SYLU-2026-04-501-A",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
          task_code: "SYLU-2026-04-501",
        },
      ],
      "mes.tasks": [{ code: "SYLU-2026-04-501", name: "冲击连接器", test_type: "冲击试验" }],
      "mes.experiments": [
        {
          task_code: "SYLU-2026-04-501",
          experiment_code: "SYLU-2026-04-501-A",
          experiment_name: "冲击试验",
        },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", tray_code: "TP-CJ-001" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-04-501-SP-001",
          task_code: "SYLU-2026-04-501",
          location: "冲击一室",
          status,
          flow_status: status,
          trays: [{ tray_code: "TP-CJ-001", status, quantity: 1 }],
        },
      ],
    });
    const loadSnapshot = vi
      .fn()
      .mockResolvedValueOnce(createSnapshot("工装夹具安装"))
      .mockResolvedValueOnce(createSnapshot("实验准备就绪"));
    let exposed = null;
    const Harness = {
      setup() {
        exposed = useProcessLabs({
          autoLoad: true,
          labs: [{ name: "冲击一室", testType: "冲击试验" }],
          loadSnapshot,
          now: Date.parse("2026-04-02T10:00:00.000Z"),
        });
        return {};
      },
      template: "<div />",
    };

    const wrapper = mount(Harness);
    await Promise.resolve();
    await nextTick();

    expect(eventSources[0]).toEqual(expect.objectContaining({
      options: { withCredentials: true },
    }));
    expect(exposed.labCards.value.find((lab) => lab.name === "冲击一室")).toEqual(expect.objectContaining({
      canStartExperiment: false,
      readyTrayCount: 0,
    }));

    vi.useFakeTimers();
    eventSources[0].listeners.message({
      data: JSON.stringify({ keys: ["mes.samples"], updatedAt: "2026-04-02T10:00:00.000Z" }),
    });
    await flushStorageRefresh();

    expect(exposed.labCards.value.find((lab) => lab.name === "冲击一室")).toEqual(expect.objectContaining({
      canStartExperiment: true,
      experimentCode: "SYLU-2026-04-501-A",
      readyTrayCount: 1,
      targetExperiment: "冲击试验",
      taskCode: "SYLU-2026-04-501",
    }));
    vi.useRealTimers();
    wrapper.unmount();
  });

  test("enables start experiment for a ready open-ended schedule after its start time", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.devices": [],
      "mes.schedules": [
        {
          device: "盐雾试验室",
          experiment_code: "TASK-OPEN-A",
          start_at: "2026-03-10T09:00:00Z",
          task_code: "TASK-OPEN",
        },
      ],
      "mes.tasks": [{ code: "TASK-OPEN", name: "无结束时间任务", test_type: "盐雾试验" }],
      "mes.experiments": [
        {
          task_code: "TASK-OPEN",
          experiment_code: "TASK-OPEN-A",
          experiment_name: "盐雾试验",
        },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-OPEN", experiment_code: "TASK-OPEN-A", tray_code: "TP-OPEN-001" },
      ],
      "mes.samples": [
        {
          code: "SP-OPEN-001",
          task_code: "TASK-OPEN",
          status: "实验准备就绪",
          flow_status: "实验准备就绪",
          location: "盐雾试验室",
          trays: [{ tray_code: "TP-OPEN-001", status: "实验准备就绪", quantity: 1 }],
        },
      ],
    }));

    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-03-10T09:30:00Z"),
    });

    await loadLabStatus();

    expect(labCards.value[0]).toEqual(expect.objectContaining({
      canStartExperiment: true,
      readyTrayCount: 1,
      statusClass: "is-scheduled",
      taskCode: "TASK-OPEN",
    }));
  });

  test("keeps ready state when an older lab status load returns after a newer one", async () => {
    const createSnapshot = (status) => ({
      "mes.devices": [],
      "mes.schedules": [
        {
          device: "盐雾试验室",
          experiment_code: "TASK-RACE-A",
          start_at: "2026-03-10T09:00:00Z",
          end_at: "2026-03-10T11:00:00Z",
          task_code: "TASK-RACE",
        },
      ],
      "mes.tasks": [{ code: "TASK-RACE", name: "乱序刷新任务", test_type: "盐雾试验" }],
      "mes.experiments": [
        {
          task_code: "TASK-RACE",
          experiment_code: "TASK-RACE-A",
          experiment_name: "盐雾试验",
        },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-RACE", experiment_code: "TASK-RACE-A", tray_code: "TP-RACE-001" },
      ],
      "mes.samples": [
        {
          code: "SP-RACE-001",
          task_code: "TASK-RACE",
          status,
          flow_status: status,
          location: "盐雾试验室",
          trays: [{ tray_code: "TP-RACE-001", status, quantity: 1 }],
        },
      ],
    });
    const resolvers = [];
    const loadSnapshot = vi.fn(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));
    const { labCards, loadLabStatus } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-03-10T09:30:00Z"),
    });

    const olderLoad = loadLabStatus();
    const newerLoad = loadLabStatus();

    resolvers[1](createSnapshot("实验准备就绪"));
    await newerLoad;
    expect(labCards.value[0]).toEqual(expect.objectContaining({
      canStartExperiment: true,
      readyTrayCount: 1,
    }));

    resolvers[0](createSnapshot("工装夹具安装"));
    await olderLoad;
    expect(labCards.value[0]).toEqual(expect.objectContaining({
      canStartExperiment: true,
      readyTrayCount: 1,
    }));
  });

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
      "mes.experiments": [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", experiment_name: "Impact Test", status: "已排程" },
      ],
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
      remainingTrayCount: 1,
    });

    openTaskOverview(labCards.value[0]);

    expect(selectedTaskDetail.value.runningTrayRows).toEqual([]);
    expect(selectedTaskDetail.value.remainingTrayRows.map((row) => row.trayCode)).toEqual(["TRAY-WAIT"]);

    await startExperiment(labCards.value[0]);

    expect(persistSnapshot).toHaveBeenCalledTimes(1);
    const persisted = persistSnapshot.mock.calls[0][0];
    expect(persisted["mes.tasks"]).toEqual([expect.objectContaining({ code: "TASK-001", status: "任务进行中" })]);
    expect(persisted["mes.schedules"]).toEqual([
      expect.objectContaining({
        id: "schedule-1",
        status: "实验进行中",
        start_at: "2026-03-11T09:30:00Z",
        end_at: "2026-03-11T10:30:00Z",
        updated_at: "2026-03-11 16:00:00",
      }),
    ]);
    expect(persisted["mes.experiments"]).toEqual([
      expect.objectContaining({
        task_code: "TASK-001",
        experiment_code: "TASK-001-A",
        status: "实验进行中",
        updated_at: "2026-03-11 16:00:00",
      }),
    ]);
    expect(persisted["mes.experiment_runs"]).toEqual([
      expect.objectContaining({
        schedule_id: "schedule-1",
        task_code: "TASK-001",
        experiment_code: "TASK-001-A",
        device: "Lab-A",
        tray_codes: ["TRAY-READY-1", "TRAY-READY-2"],
        status: "实验进行中",
        started_at: "2026-03-11 16:00:00",
        planned_hours: 2,
        planned_end_at: "2026-03-11 18:00:00",
      }),
    ]);
    expect(persisted["mes.experiment_run_trays"]).toEqual([
      expect.objectContaining({
        task_code: "TASK-001",
        experiment_code: "TASK-001-A",
        tray_code: "TRAY-READY-1",
        run_tray_status: "实验进行中",
        started_at: "2026-03-11 16:00:00",
      }),
      expect.objectContaining({
        task_code: "TASK-001",
        experiment_code: "TASK-001-A",
        tray_code: "TRAY-READY-2",
        run_tray_status: "实验进行中",
        started_at: "2026-03-11 16:00:00",
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

  test("starts a second ready tray batch through experiment runs without overwriting the planned schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T01:40:00Z"));
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-salt-1",
          device: "盐雾试验室",
          end_at: "2026-05-31T14:14:31Z",
          experiment_code: "TASK-SALT-A",
          planned_hours: 3.5,
          start_at: "2026-05-31T10:44:31Z",
          status: "实验进行中",
          task_code: "TASK-SALT",
        },
      ],
      "mes.tasks": [{ code: "TASK-SALT", name: "盐雾分批任务", status: "任务进行中", test_type: "盐雾试验" }],
      "mes.experiments": [
        { task_code: "TASK-SALT", experiment_code: "TASK-SALT-A", experiment_name: "盐雾试验", status: "实验进行中" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-SALT", experiment_code: "TASK-SALT-A", tray_code: "TASK-SALT-TP-001" },
        { task_code: "TASK-SALT", experiment_code: "TASK-SALT-A", tray_code: "TASK-SALT-TP-002" },
      ],
      "mes.experiment_runs": [
        {
          id: "run-first",
          run_no: "run-first",
          schedule_id: "schedule-salt-1",
          task_code: "TASK-SALT",
          experiment_code: "TASK-SALT-A",
          device: "盐雾试验室",
          tray_codes: ["TASK-SALT-TP-001"],
          status: "实验已完成",
          started_at: "2026-05-31T10:44:31Z",
          ended_at: "2026-05-31T14:14:31Z",
        },
      ],
      "mes.experiment_run_trays": [
        {
          id: "run-first:TASK-SALT-TP-001",
          run_no: "run-first",
          task_code: "TASK-SALT",
          experiment_code: "TASK-SALT-A",
          tray_code: "TASK-SALT-TP-001",
          run_tray_status: "实验已完成",
          status: "实验已完成",
        },
      ],
      "mes.samples": [
        {
          code: "SP-001",
          task_code: "TASK-SALT",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [{ tray_code: "TASK-SALT-TP-001", status: "已到达暂存间", quantity: 1 }],
        },
        {
          code: "SP-002",
          task_code: "TASK-SALT",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TASK-SALT-TP-002", status: "实验准备就绪", quantity: 1 }],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-06-01T01:40:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();

    expect(labCards.value[0]).toMatchObject({
      canStartExperiment: true,
      experimentCode: "TASK-SALT-A",
      remainingTrayCount: 0,
      readyTrayCount: 1,
      statusClass: "is-scheduled",
      taskCode: "TASK-SALT",
    });

    await startExperiment(labCards.value[0]);

    const persisted = persistSnapshot.mock.calls[0][0];
    expect(persisted["mes.schedules"]).toEqual([
      expect.objectContaining({
        id: "schedule-salt-1",
        start_at: "2026-05-31T10:44:31Z",
        end_at: "2026-05-31T14:14:31Z",
      }),
    ]);
    expect(persisted["mes.experiment_runs"]).toEqual([
      expect.objectContaining({ id: "run-first", status: "实验已完成" }),
      expect.objectContaining({
        schedule_id: "schedule-salt-1",
        task_code: "TASK-SALT",
        experiment_code: "TASK-SALT-A",
        device: "盐雾试验室",
        tray_codes: ["TASK-SALT-TP-002"],
        status: "实验进行中",
        started_at: "2026-06-01 09:40:00",
        planned_end_at: "2026-06-01 13:10:00",
      }),
    ]);
    expect(persisted["mes.experiment_run_trays"]).toEqual([
      expect.objectContaining({
        run_no: "run-first",
        tray_code: "TASK-SALT-TP-001",
        run_tray_status: "实验已完成",
      }),
      expect.objectContaining({
        task_code: "TASK-SALT",
        experiment_code: "TASK-SALT-A",
        tray_code: "TASK-SALT-TP-002",
        run_tray_status: "实验进行中",
        started_at: "2026-06-01 09:40:00",
      }),
    ]);
    expect(persisted["mes.samples"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SP-001",
          trays: [expect.objectContaining({ tray_code: "TASK-SALT-TP-001", status: "已到达暂存间" })],
        }),
        expect.objectContaining({
          code: "SP-002",
          status: "实验进行中",
          trays: [expect.objectContaining({ tray_code: "TASK-SALT-TP-002", status: "实验进行中" })],
        }),
      ]),
    );
    vi.useRealTimers();
  });

  test("starting an experiment only updates samples from the selected task when tray codes overlap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T08:00:00Z"));
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-a",
          device: "盐雾试验室",
          end_at: "2026-03-11T10:00:00Z",
          experiment_code: "TASK-A-EXP",
          start_at: "2026-03-11T08:00:00Z",
          task_code: "TASK-A",
        },
        {
          id: "schedule-b",
          device: "盐雾试验室",
          end_at: "2026-03-11T11:00:00Z",
          experiment_code: "TASK-B-EXP",
          start_at: "2026-03-11T08:30:00Z",
          task_code: "TASK-B",
        },
      ],
      "mes.tasks": [
        { code: "TASK-A", name: "任务A", status: "已排程", test_type: "盐雾试验" },
        { code: "TASK-B", name: "任务B", status: "已排程", test_type: "盐雾试验" },
      ],
      "mes.experiments": [
        { task_code: "TASK-A", experiment_code: "TASK-A-EXP", experiment_name: "盐雾试验-A" },
        { task_code: "TASK-B", experiment_code: "TASK-B-EXP", experiment_name: "盐雾试验-B" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-A", experiment_code: "TASK-A-EXP", tray_code: "TP-SHARED" },
        { task_code: "TASK-B", experiment_code: "TASK-B-EXP", tray_code: "TP-SHARED" },
      ],
      "mes.samples": [
        {
          code: "SP-A",
          task_code: "TASK-A",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TP-SHARED", status: "实验准备就绪", quantity: 1 }],
          history: [],
        },
        {
          code: "SP-B",
          task_code: "TASK-B",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TP-SHARED", status: "实验准备就绪", quantity: 1 }],
          history: [],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, setSelectedTaskForLab, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-03-11T08:00:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();
    setSelectedTaskForLab("盐雾试验室", "TASK-B", "TASK-B-EXP");
    await startExperiment(labCards.value[0]);

    const persistedSamples = persistSnapshot.mock.calls[0][0]["mes.samples"];
    expect(persistedSamples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SP-A",
          status: "实验准备就绪",
          trays: [expect.objectContaining({ tray_code: "TP-SHARED", status: "实验准备就绪" })],
        }),
        expect.objectContaining({
          code: "SP-B",
          status: "实验进行中",
          trays: [expect.objectContaining({ tray_code: "TP-SHARED", status: "实验进行中" })],
        }),
      ]),
    );
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
          experiment_code: "TASK-001-A",
          start_at: "2026-03-11T09:30:00Z",
          task_code: "TASK-001",
        },
      ],
      "mes.tasks": [{ code: "TASK-001", name: "Task A", status: "实验中", test_type: "Impact Test" }],
      "mes.experiment_runs": [
        {
          run_no: "RUN-TASK-001-A",
          task_code: "TASK-001",
          experiment_code: "TASK-001-A",
          device: "Lab-A",
          tray_codes: ["TRAY-RUNNING"],
          status: "实验进行中",
        },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TRAY-RUNNING" },
        { task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TRAY-READY" },
      ],
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

  test("treats a tray as startable when one sample row has advanced to ready", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "盐雾试验室",
          end_at: "2026-03-11T10:30:00Z",
          experiment_code: "TASK-001-A",
          id: "schedule-1",
          start_at: "2026-03-11T09:30:00Z",
          task_code: "TASK-001",
        },
      ],
      "mes.tasks": [{ code: "TASK-001", name: "Task A", status: "已排程", test_type: "盐雾试验" }],
      "mes.experiment_trays": [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TRAY-MIXED" },
      ],
      "mes.samples": [
        {
          code: "S-001",
          task_code: "TASK-001",
          location: "盐雾试验室",
          status: "已到达实验室",
          trays: [{ tray_code: "TRAY-MIXED", status: "已到达实验室", quantity: 1 }],
        },
        {
          code: "S-002",
          task_code: "TASK-001",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TRAY-MIXED", status: "实验准备就绪", quantity: 1 }],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-03-11T08:00:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();

    expect(labCards.value[0]).toMatchObject({
      canStartExperiment: true,
      readyTrayCount: 1,
      startDisabledReason: "",
    });

    await startExperiment(labCards.value[0]);

    expect(persistSnapshot).toHaveBeenCalledTimes(1);
    expect(persistSnapshot.mock.calls[0][0]["mes.samples"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "S-001",
          status: "实验进行中",
          trays: [expect.objectContaining({ tray_code: "TRAY-MIXED", status: "实验进行中" })],
        }),
        expect.objectContaining({
          code: "S-002",
          status: "实验进行中",
          trays: [expect.objectContaining({ tray_code: "TRAY-MIXED", status: "实验进行中" })],
        }),
      ]),
    );
  });

  test("allows a ready scheduled tray to start even when its location label is not the lab display name", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-021",
          device: "盐雾试验室",
          end_at: "2026-05-21T12:00:00Z",
          experiment_code: "SYLU-2026-05-021-A",
          start_at: "2026-05-21T08:00:00Z",
          task_code: "SYLU-2026-05-021",
        },
      ],
      "mes.tasks": [{ code: "SYLU-2026-05-021", status: "任务进行中", test_type: "盐雾试验" }],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-05-021", experiment_code: "SYLU-2026-05-021-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-05-021", experiment_code: "SYLU-2026-05-021-A", tray_code: "TP-002" },
      ],
      "mes.samples": [
        {
          code: "SP-001",
          task_code: "SYLU-2026-05-021",
          location: "盐雾一室",
          status: "送至实验室",
          trays: [{ tray_code: "TP-001", status: "送至实验室", quantity: 1 }],
        },
        {
          code: "SP-002",
          task_code: "SYLU-2026-05-021",
          location: "盐雾一室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TP-002", status: "实验准备就绪", quantity: 1 }],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-05-21T09:00:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();
    await openTaskOverview(labCards.value[0]);

    expect(selectedTaskDetail.value.readyTrayRows.map((row) => row.trayCode)).toEqual(["TP-002"]);
    expect(labCards.value[0]).toMatchObject({
      canStartExperiment: true,
      readyTrayCount: 1,
      remainingTrayCount: 1,
      startDisabledReason: "",
    });

    await startExperiment(labCards.value[0]);

    expect(persistSnapshot).toHaveBeenCalledTimes(1);
    const persistedSamples = persistSnapshot.mock.calls[0][0]["mes.samples"];
    expect(persistedSamples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SP-001",
          status: "送至实验室",
          trays: [expect.objectContaining({ tray_code: "TP-001", status: "送至实验室" })],
        }),
        expect.objectContaining({
          code: "SP-002",
          status: "实验进行中",
          trays: [expect.objectContaining({ tray_code: "TP-002", status: "实验进行中" })],
        }),
      ]),
    );
  });

  test("keeps a lab card scheduled when trays are only ready but not explicitly started", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-11T10:30:00Z",
          experiment_code: "TASK-001-A",
          start_at: "2026-03-11T09:30:00Z",
          task_code: "TASK-001",
        },
      ],
      "mes.tasks": [{ code: "TASK-001", test_type: "Impact Test", status: "已排程" }],
      "mes.experiment_trays": [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TRAY-001" },
      ],
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

  test("excludes manufacturer-returned completed trays from remaining count while another tray is ready", async () => {
    const taskCode = "SYLU-2026-06-021";
    const experimentCode = `${taskCode}-A`;
    const trayCodes = [
      `${taskCode}-TP-001`,
      `${taskCode}-TP-002`,
      `${taskCode}-TP-003`,
      `${taskCode}-TP-004`,
    ];
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "冲击一室",
          end_at: "2026-06-06T12:00:00+08:00",
          experiment_code: experimentCode,
          start_at: "2026-06-06T08:00:00+08:00",
          task_code: taskCode,
        },
      ],
      "mes.tasks": [{ code: taskCode, status: "任务进行中", test_type: "冲击试验" }],
      "mes.experiments": [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "冲击试验", status: "实验准备就绪" },
      ],
      "mes.experiment_trays": trayCodes.map((trayCode) => ({
        task_code: taskCode,
        experiment_code: experimentCode,
        tray_code: trayCode,
      })),
      "mes.experiment_run_trays": [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          run_no: "RUN-IMPACT-001",
          run_tray_status: "厂家收回",
          tray_code: trayCodes[0],
        },
      ],
      "mes.samples": [
        {
          code: `${taskCode}-SP-001`,
          history: [
            { detail: `${taskCode} / 冲击试验 / 实验已完成`, status: "实验已完成", time: "2026-06-06T09:20:00+08:00" },
            { action: "厂家收回", status: "厂家收回", time: "2026-06-06T09:30:00+08:00" },
          ],
          location: "冲击一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [{ tray_code: trayCodes[0], status: "已到达实验室", quantity: 1 }],
        },
        {
          code: `${taskCode}-SP-002`,
          history: [
            {
              action: "实验确认",
              detail: `${taskCode} / 冲击试验 / 实验准备就绪`,
              location: "冲击一室",
              status: "实验准备就绪",
              time: "2026-06-06T09:40:00+08:00",
            },
          ],
          location: "冲击一室",
          status: "实验准备就绪",
          task_code: taskCode,
          trays: [{ tray_code: trayCodes[1], status: "实验准备就绪", quantity: 1 }],
        },
        {
          code: `${taskCode}-SP-003`,
          location: "冲击一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [{ tray_code: trayCodes[2], status: "已到达实验室", quantity: 1 }],
        },
        {
          code: `${taskCode}-SP-004`,
          location: "冲击一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [{ tray_code: trayCodes[3], status: "已到达实验室", quantity: 1 }],
        },
      ],
    }));
    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "冲击一室", testType: "冲击试验" }],
      loadSnapshot,
      now: Date.parse("2026-06-06T09:45:00+08:00"),
    });

    await loadLabStatus();
    await openTaskOverview(labCards.value[0]);

    expect(labCards.value[0]).toMatchObject({
      readyTrayCount: 1,
      remainingTrayCount: 2,
    });
    expect(selectedTaskDetail.value.readyTrayRows.map((row) => row.trayCode)).toEqual([trayCodes[1]]);
    expect(selectedTaskDetail.value.remainingTrayRows.map((row) => row.trayCode)).toEqual([trayCodes[2], trayCodes[3]]);
    expect(selectedTaskDetail.value.completedTrayRows.map((row) => row.trayCode)).toEqual([trayCodes[0]]);

    window.localStorage.getItem.mockImplementation((key) => (key === HOST_INTERFACE_MODE_STORAGE_KEY ? HOST_INTERFACE_MODES.mqtt : null));
    const {
      labCards: mqttLabCards,
      loadLabStatus: loadMqttLabStatus,
      openTaskOverview: openMqttTaskOverview,
      selectedTaskDetail: mqttSelectedTaskDetail,
    } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "冲击一室", testType: "冲击试验" }],
      loadSnapshot,
      now: Date.parse("2026-06-06T09:45:00+08:00"),
    });

    await loadMqttLabStatus();
    await openMqttTaskOverview(mqttLabCards.value[0]);

    expect(mqttLabCards.value[0]).toMatchObject({
      canStartExperiment: false,
      readyTrayCount: 1,
      remainingTrayCount: 2,
      startDisabledReason: "MQTT模式下等待上位机发送实验开始信号",
    });
    expect(mqttSelectedTaskDetail.value.remainingTrayRows.map((row) => row.trayCode)).toEqual([trayCodes[2], trayCodes[3]]);
  });

  test("keeps a lab card running when a tray is in in-progress status", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-11T10:30:00Z",
          experiment_code: "TASK-001-A",
          start_at: "2026-03-11T09:30:00Z",
          task_code: "TASK-001",
        },
      ],
      "mes.tasks": [{ code: "TASK-001", test_type: "Impact Test", status: "已排程" }],
      "mes.experiment_runs": [
        {
          run_no: "RUN-TASK-001-A",
          task_code: "TASK-001",
          experiment_code: "TASK-001-A",
          device: "Lab-A",
          tray_codes: ["TRAY-001"],
          status: "实验进行中",
        },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TRAY-001" },
      ],
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
      "mes.experiment_runs": [
        {
          run_no: "RUN-2026-03-001-A",
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          device: "冲击一室",
          tray_codes: ["SYLU-2026-03-001-TP-001"],
          status: "实验进行中",
        },
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
      remainingTrayCount: 0,
    });

    await openTaskOverview(labCards.value[0]);
    setSelectedTaskForLab("盐雾试验室", "SYLU-2026-03-006");

    expect(labCards.value[0]).toMatchObject({
      taskCode: "SYLU-2026-03-006",
      readyTrayCount: 1,
      remainingTrayCount: 0,
      targetExperiment: "盐雾试验",
    });
    expect(selectedTaskDetail.value).toMatchObject({
      code: "SYLU-2026-03-006",
      trayCodes: ["SYLU-2026-03-006-TP-001"],
      remainingTrayCount: 0,
      readyTrayCount: 1,
    });
    expect(selectedTaskDetail.value.trayCodes).not.toContain("SYLU-2026-03-006-TP-002");
  });

  test("removes completed experiments from the process task switch list", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-005",
          device: "盐雾试验室",
          end_at: "2026-05-05T12:00:00Z",
          experiment_code: "SYLU-2026-05-005-A",
          start_at: "2026-05-05T08:00:00Z",
          task_code: "SYLU-2026-05-005",
        },
        {
          id: "schedule-006",
          device: "盐雾试验室",
          end_at: "2026-05-05T13:00:00Z",
          experiment_code: "SYLU-2026-05-006-A",
          start_at: "2026-05-05T09:30:00Z",
          task_code: "SYLU-2026-05-006",
        },
      ],
      "mes.tasks": [
        { code: "SYLU-2026-05-005", name: "任务005", status: "已排程", test_type: "盐雾试验" },
        { code: "SYLU-2026-05-006", name: "任务006", status: "已排程", test_type: "盐雾试验" },
      ],
      "mes.experiments": [
        { task_code: "SYLU-2026-05-005", experiment_code: "SYLU-2026-05-005-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-A", experiment_name: "盐雾试验" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-05-005", experiment_code: "SYLU-2026-05-005-A", tray_code: "SYLU-2026-05-005-TP-001" },
        { task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-A", tray_code: "SYLU-2026-05-006-TP-001" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-05-005-SP-001",
          task_code: "SYLU-2026-05-005",
          location: "盐雾试验室",
          status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-05-005-TP-001", status: "实验已完成", quantity: 1 }],
        },
        {
          code: "SYLU-2026-05-006-SP-001",
          task_code: "SYLU-2026-05-006",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-05-006-TP-001", status: "实验准备就绪", quantity: 1 }],
        },
      ],
    }));

    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      now: Date.parse("2026-05-05T09:00:00Z"),
    });

    await loadLabStatus();
    await openTaskOverview(labCards.value[0]);

    expect(selectedTaskDetail.value.availableTasks.map((task) => task.taskCode)).toEqual(["SYLU-2026-05-006"]);
  });

  test("defaults the process card to a ready experiment when the current schedule is not startable", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-a",
          device: "盐雾试验室",
          end_at: "2026-04-03T11:00:00Z",
          experiment_code: "SYLU-2026-04-701-A",
          start_at: "2026-04-03T08:00:00Z",
          task_code: "SYLU-2026-04-701",
        },
        {
          id: "schedule-b",
          device: "盐雾试验室",
          end_at: "2026-04-03T13:00:00Z",
          experiment_code: "SYLU-2026-04-701-B",
          start_at: "2026-04-03T12:00:00Z",
          task_code: "SYLU-2026-04-701",
        },
      ],
      "mes.tasks": [
        { code: "SYLU-2026-04-701", name: "同任务多实验", status: "已排程", test_type: "盐雾试验-A / 盐雾试验-B" },
      ],
      "mes.experiments": [
        { task_code: "SYLU-2026-04-701", experiment_code: "SYLU-2026-04-701-A", experiment_name: "盐雾试验-A" },
        { task_code: "SYLU-2026-04-701", experiment_code: "SYLU-2026-04-701-B", experiment_name: "盐雾试验-B" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-04-701", experiment_code: "SYLU-2026-04-701-A", tray_code: "TP-A" },
        { task_code: "SYLU-2026-04-701", experiment_code: "SYLU-2026-04-701-B", tray_code: "TP-B" },
      ],
      "mes.samples": [
        {
          code: "SP-A",
          task_code: "SYLU-2026-04-701",
          location: "盐雾试验室",
          status: "已到达实验室",
          trays: [{ tray_code: "TP-A", status: "已到达实验室", quantity: 1 }],
        },
        {
          code: "SP-B",
          task_code: "SYLU-2026-04-701",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TP-B", status: "实验准备就绪", quantity: 1 }],
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

    expect(labCards.value[0]).toMatchObject({
      canStartExperiment: true,
      experimentCode: "SYLU-2026-04-701-B",
      readyTrayCount: 1,
      targetExperiment: "盐雾试验-B",
    });

    await openTaskOverview(labCards.value[0]);

    expect(selectedTaskDetail.value).toMatchObject({
      activeExperimentCode: "SYLU-2026-04-701-B",
      readyTrayCount: 1,
      targetExperiment: "盐雾试验-B",
      trayCodes: ["TP-B"],
    });
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

  test("blocks manual experiment start in mqtt mode and waits for the upper computer event", async () => {
    window.localStorage.getItem.mockImplementation((key) => (key === HOST_INTERFACE_MODE_STORAGE_KEY ? HOST_INTERFACE_MODES.mqtt : null));
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
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-03-005", experiment_code: "SYLU-2026-03-005-A", tray_code: "SYLU-2026-03-005-TP-001" },
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
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const {
      labCards,
      loadLabStatus,
      openStartExperimentModal,
      processActionMessage,
      startExperiment,
      startExperimentModalOpen,
    } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "盐雾试验室", testType: "盐雾试验" }],
      loadSnapshot,
      persistSnapshot,
    });

    await loadLabStatus();

    expect(labCards.value[0].readyTrayCount).toBe(1);
    expect(labCards.value[0].canStartExperiment).toBe(false);
    expect(labCards.value[0].startDisabledReason).toBe("MQTT模式下等待上位机发送实验开始信号");

    await openStartExperimentModal(labCards.value[0]);
    await startExperiment(labCards.value[0]);

    expect(startExperimentModalOpen.value).toBe(false);
    expect(processActionMessage.value).toBe("MQTT模式下等待上位机发送实验开始信号");
    expect(persistSnapshot).not.toHaveBeenCalled();
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
      "mes.experiment_runs": [
        {
          run_no: "RUN-SALT-002",
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          device: "盐雾试验室",
          tray_codes: ["SYLU-2026-03-002-TP-001", "SYLU-2026-03-002-TP-002"],
          status: "实验进行中",
        },
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

    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail } = useProcessLabs({
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

    await openTaskOverview(labCards.value.find((card) => card.name === "高低温湿热一室"));

    expect(selectedTaskDetail.value.activeExperimentCode).toBe("SYLU-2026-03-002-B");
    expect(selectedTaskDetail.value.runningTrayRows).toEqual([]);
    expect(selectedTaskDetail.value.selectedTrayFlow.currentStatus).not.toContain("高低温湿热试验进行中");
  });

  test("blocks other laboratories from starting a shared tray that is ready in the current experiment", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          id: "schedule-salt",
          device: "盐雾试验室",
          end_at: "2026-04-09T13:35:38Z",
          experiment_code: "SYLU-2026-03-006-A",
          start_at: "2026-04-09T10:05:38Z",
          task_code: "SYLU-2026-03-006",
        },
        {
          id: "schedule-vibration",
          device: "振动一室",
          end_at: "2026-04-10T07:30:00Z",
          experiment_code: "SYLU-2026-03-006-B",
          start_at: "2026-04-10T04:00:00Z",
          task_code: "SYLU-2026-03-006",
        },
      ],
      "mes.tasks": [{ code: "SYLU-2026-03-006", name: "任务006", status: "已排程", test_type: "盐雾试验 / 振动试验" }],
      "mes.experiments": [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "振动试验" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-001" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-03-006-SP-001",
          task_code: "SYLU-2026-03-006",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-03-006-TP-001", status: "实验准备就绪", quantity: 1 }],
          history: [
            {
              action: "实验确认",
              detail: "SYLU-2026-03-006 / 盐雾试验 / 实验准备就绪",
              status: "实验准备就绪",
              time: "2026-04-09T10:30:00Z",
            },
          ],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, setSelectedTaskForLab, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [
        { name: "盐雾试验室", testType: "盐雾试验" },
        { name: "振动一室", testType: "振动试验" },
      ],
      loadSnapshot,
      now: Date.parse("2026-04-09T18:30:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();
    const vibrationCard = labCards.value.find((card) => card.name === "振动一室");

    expect(vibrationCard).toMatchObject({
      canStartExperiment: false,
      readyTrayCount: 0,
      startDisabledReason: "托盘正在其他实验中，不能开始当前实验",
      status: "已排程",
      statusClass: "is-scheduled",
    });

    setSelectedTaskForLab("振动一室", "SYLU-2026-03-006", "SYLU-2026-03-006-B");
    await startExperiment(labCards.value.find((card) => card.name === "振动一室"));

    expect(persistSnapshot).not.toHaveBeenCalled();
  });

  test("does not allow restarting impact after the shared tray is ready for temperature shock", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "冲击一室",
          end_at: "2026-06-04T16:00:00Z",
          experiment_code: "EXP-IMPACT",
          start_at: "2026-06-04T08:00:00Z",
          task_code: "TASK-SHARED",
        },
        {
          device: "温度冲击一室",
          end_at: "2026-06-04T16:00:00Z",
          experiment_code: "EXP-TEMP",
          start_at: "2026-06-04T12:30:00Z",
          task_code: "TASK-SHARED",
        },
      ],
      "mes.tasks": [{ code: "TASK-SHARED", name: "共享托盘任务", status: "已排程", test_type: "冲击试验 / 温度冲击试验" }],
      "mes.experiments": [
        { task_code: "TASK-SHARED", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", status: "已排程" },
        { task_code: "TASK-SHARED", experiment_code: "EXP-TEMP", experiment_name: "温度冲击试验", status: "已排程" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-SHARED", experiment_code: "EXP-IMPACT", tray_code: "TP-SHARED" },
        { task_code: "TASK-SHARED", experiment_code: "EXP-TEMP", tray_code: "TP-SHARED" },
      ],
      "mes.samples": [
        {
          code: "SP-SHARED",
          history: [
            {
              action: "实验完成",
              detail: "TASK-SHARED / 冲击试验 / 实验已完成",
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-06-04T11:00:00Z",
            },
            {
              action: "实验确认",
              detail: "TASK-SHARED / 温度冲击试验 / 实验准备就绪",
              location: "温度冲击一室",
              status: "实验准备就绪",
              time: "2026-06-04T12:40:00Z",
            },
          ],
          location: "冲击一室",
          status: "实验准备就绪",
          task_code: "TASK-SHARED",
          trays: [
            {
              quantity: 1,
              status: "实验准备就绪",
              target_experiment_code: "EXP-TEMP",
              target_lab: "温度冲击一室",
              tray_code: "TP-SHARED",
            },
          ],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, setSelectedTaskForLab, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [
        { name: "冲击一室", testType: "冲击试验" },
        { name: "温度冲击一室", testType: "温度冲击试验" },
      ],
      loadSnapshot,
      now: Date.parse("2026-06-04T12:45:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();

    const impactCard = labCards.value.find((card) => card.name === "冲击一室");
    const tempCard = labCards.value.find((card) => card.name === "温度冲击一室");
    expect(impactCard).toMatchObject({
      canStartExperiment: false,
      readyTrayCount: 0,
    });
    expect(tempCard).toMatchObject({
      canStartExperiment: true,
      readyTrayCount: 1,
    });

    setSelectedTaskForLab("冲击一室", "TASK-SHARED", "EXP-IMPACT");
    await startExperiment(impactCard);

    expect(persistSnapshot).not.toHaveBeenCalled();
  });

  test("does not treat temperature shock ready history as impact ready for the same tray", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "冲击二室",
          end_at: "2026-06-05T18:16:00+08:00",
          experiment_code: "SYLU-2026-06-021-A",
          start_at: "2026-06-05T14:46:00+08:00",
          task_code: "SYLU-2026-06-021",
        },
        {
          device: "温度冲击二室",
          end_at: "2026-06-05T18:17:00+08:00",
          experiment_code: "SYLU-2026-06-021-B",
          start_at: "2026-06-05T14:47:00+08:00",
          task_code: "SYLU-2026-06-021",
        },
      ],
      "mes.tasks": [{ code: "SYLU-2026-06-021", name: "复合任务", status: "已排程", test_type: "冲击试验 / 温度冲击试验" }],
      "mes.experiments": [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", experiment_name: "冲击试验", status: "已排程" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", experiment_name: "温度冲击试验", status: "已排程" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-005" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", tray_code: "SYLU-2026-06-021-TP-005" },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-06-021-SP-005",
          history: [
            {
              action: "实验确认",
              detail: "SYLU-2026-06-021 / 温度冲击试验 / 实验准备就绪",
              location: "温度冲击二室",
              status: "实验准备就绪",
              time: "2026-06-05T15:37:51+08:00",
            },
            {
              action: "送至实验室",
              detail: "SYLU-2026-06-021-TP-005 -> 温度冲击二室",
              location: "温度冲击二室",
              status: "送至实验室",
              time: "2026-06-05T14:50:57+08:00",
            },
          ],
          location: "温度冲击二室",
          status: "实验准备就绪",
          task_code: "SYLU-2026-06-021",
          trays: [
            {
              quantity: 1,
              status: "实验准备就绪",
              target_experiment_code: "SYLU-2026-06-021-B",
              target_lab: "温度冲击二室",
              tray_code: "SYLU-2026-06-021-TP-005",
            },
          ],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, setSelectedTaskForLab, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [
        { name: "冲击二室", testType: "冲击试验" },
        { name: "温度冲击二室", testType: "温度冲击试验" },
      ],
      loadSnapshot,
      now: Date.parse("2026-06-05T15:38:00+08:00"),
      persistSnapshot,
    });

    await loadLabStatus();

    const impactCard = labCards.value.find((card) => card.name === "冲击二室");
    const tempShockCard = labCards.value.find((card) => card.name === "温度冲击二室");
    expect(impactCard).toMatchObject({
      canStartExperiment: false,
      readyTrayCount: 0,
    });
    expect(tempShockCard).toMatchObject({
      canStartExperiment: true,
      readyTrayCount: 1,
    });

    setSelectedTaskForLab("冲击二室", "SYLU-2026-06-021", "SYLU-2026-06-021-A");
    await startExperiment(impactCard);

    expect(persistSnapshot).not.toHaveBeenCalled();
  });

  test("starts all ready trays in the current laboratory even when previous target fields are stale", async () => {
    const readyTrayCodes = [
      "SYLU-2026-06-021-TP-001",
      "SYLU-2026-06-021-TP-004",
      "SYLU-2026-06-021-TP-005",
    ];
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "温度冲击二室",
          end_at: "2026-06-05T19:19:00+08:00",
          experiment_code: "SYLU-2026-06-021-B",
          id: "schedule-temp-shock",
          planned_hours: 3.5,
          start_at: "2026-06-05T15:49:00+08:00",
          task_code: "SYLU-2026-06-021",
        },
      ],
      "mes.tasks": [
        {
          code: "SYLU-2026-06-021",
          name: "复合任务",
          status: "任务进行中",
          test_type: "冲击试验 / 温度冲击试验 / 振动试验",
        },
      ],
      "mes.experiments": [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", experiment_name: "冲击试验", status: "实验进行中" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", experiment_name: "温度冲击试验", status: "已排程" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-004" },
        ...readyTrayCodes.map((trayCode) => ({
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          tray_code: trayCode,
        })),
      ],
      "mes.samples": readyTrayCodes.map((trayCode, index) => ({
        code: `SYLU-2026-06-021-SP-${String(index + 1).padStart(3, "0")}`,
        history: [
          {
            action: "实验确认",
            detail: "SYLU-2026-06-021 / 温度冲击试验 / 实验准备就绪",
            location: "温度冲击二室",
            status: "实验准备就绪",
            time: "2026-06-05T15:53:47+08:00",
          },
        ],
        location: "温度冲击二室",
        status: "实验准备就绪",
        task_code: "SYLU-2026-06-021",
        trays: [
          {
            quantity: 1,
            status: "实验准备就绪",
            target_experiment_code: trayCode.endsWith("005") ? "SYLU-2026-06-021-B" : "SYLU-2026-06-021-A",
            target_lab: trayCode.endsWith("005") ? "温度冲击二室" : "冲击二室",
            tray_code: trayCode,
          },
        ],
      })),
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, setSelectedTaskForLab, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [{ name: "温度冲击二室", testType: "温度冲击试验" }],
      loadSnapshot,
      now: Date.parse("2026-06-05T15:54:00+08:00"),
      persistSnapshot,
    });

    await loadLabStatus();

    const tempShockCard = labCards.value.find((card) => card.name === "温度冲击二室");
    expect(tempShockCard).toMatchObject({
      canStartExperiment: true,
      readyTrayCount: 3,
    });

    setSelectedTaskForLab("温度冲击二室", "SYLU-2026-06-021", "SYLU-2026-06-021-B");
    await startExperiment(tempShockCard);

    expect(persistSnapshot).toHaveBeenCalledTimes(1);
    const persistedPayload = persistSnapshot.mock.calls[0][0];
    expect(persistedPayload["mes.experiment_runs"][0]).toEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-06-021-B",
      tray_codes: readyTrayCodes,
    }));
    expect(persistedPayload["mes.experiment_run_trays"].map((row) => row.tray_code)).toEqual(readyTrayCodes);
    expect(
      persistedPayload["mes.samples"].flatMap((sample) => sample.trays).map((tray) => ({
        status: tray.status,
        targetExperimentCode: tray.target_experiment_code,
        targetLab: tray.target_lab,
        trayCode: tray.tray_code,
      })),
    ).toEqual(readyTrayCodes.map((trayCode) => ({
      status: "实验进行中",
      targetExperimentCode: undefined,
      targetLab: undefined,
      trayCode,
    })));
  });

  test("shows selected tray flow by tray target lab instead of the old laboratory schedule", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "冲击一室",
          end_at: "2026-06-04T16:00:00Z",
          experiment_code: "EXP-IMPACT",
          start_at: "2026-06-04T08:00:00Z",
          task_code: "TASK-SHARED",
        },
        {
          device: "温度冲击一室",
          end_at: "2026-06-04T16:00:00Z",
          experiment_code: "EXP-TEMP",
          start_at: "2026-06-04T12:30:00Z",
          task_code: "TASK-SHARED",
        },
      ],
      "mes.tasks": [{ code: "TASK-SHARED", name: "共享托盘任务", status: "已排程", test_type: "冲击试验 / 温度冲击试验" }],
      "mes.experiments": [
        { task_code: "TASK-SHARED", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", status: "已排程" },
        { task_code: "TASK-SHARED", experiment_code: "EXP-TEMP", experiment_name: "温度冲击试验", status: "已排程" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-SHARED", experiment_code: "EXP-IMPACT", tray_code: "TP-SHARED" },
        { task_code: "TASK-SHARED", experiment_code: "EXP-TEMP", tray_code: "TP-SHARED" },
      ],
      "mes.samples": [
        {
          code: "SP-SHARED",
          history: [],
          location: "冲击一室",
          status: "送至实验室",
          task_code: "TASK-SHARED",
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_lab: "温度冲击一室",
              tray_code: "TP-SHARED",
            },
          ],
        },
      ],
    }));
    const { labCards, loadLabStatus, openTaskOverview, selectedTaskDetail, setSelectedTaskForLab } = useProcessLabs({
      autoLoad: false,
      labs: [
        { name: "冲击一室", testType: "冲击试验" },
        { name: "温度冲击一室", testType: "温度冲击试验" },
      ],
      loadSnapshot,
      now: Date.parse("2026-06-04T12:45:00Z"),
    });

    await loadLabStatus();
    setSelectedTaskForLab("冲击一室", "TASK-SHARED", "EXP-IMPACT");
    await openTaskOverview(labCards.value.find((card) => card.name === "冲击一室"));

    expect(selectedTaskDetail.value.selectedTrayFlow.currentStatus).toBe("当前托盘：TP-SHARED | 当前状态：送至温度冲击一室");
    expect(selectedTaskDetail.value.selectedTrayFlow.status).toBe("送至温度冲击一室");
    expect(selectedTaskDetail.value.selectedTrayFlow.canonicalStatus).toBe("送至实验室");
  });

  test("blocks old laboratory start when only tray target lab points to the next experiment", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "冲击一室",
          end_at: "2026-06-04T12:00:00Z",
          experiment_code: "EXP-IMPACT",
          start_at: "2026-06-04T08:00:00Z",
          task_code: "TASK-SHARED",
        },
        {
          device: "温度冲击一室",
          end_at: "2026-06-04T16:00:00Z",
          experiment_code: "EXP-TEMP",
          start_at: "2026-06-04T12:30:00Z",
          task_code: "TASK-SHARED",
        },
      ],
      "mes.tasks": [{ code: "TASK-SHARED", name: "共享托盘任务", status: "已排程", test_type: "冲击试验 / 温度冲击试验" }],
      "mes.experiments": [
        { task_code: "TASK-SHARED", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", status: "已排程" },
        { task_code: "TASK-SHARED", experiment_code: "EXP-TEMP", experiment_name: "温度冲击试验", status: "已排程" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-SHARED", experiment_code: "EXP-IMPACT", tray_code: "TP-SHARED" },
        { task_code: "TASK-SHARED", experiment_code: "EXP-TEMP", tray_code: "TP-SHARED" },
      ],
      "mes.samples": [
        {
          code: "SP-SHARED",
          history: [],
          location: "",
          status: "实验准备就绪",
          task_code: "TASK-SHARED",
          trays: [
            {
              quantity: 1,
              status: "实验准备就绪",
              target_lab: "温度冲击一室",
              tray_code: "TP-SHARED",
            },
          ],
        },
      ],
    }));
    const persistSnapshot = vi.fn(async () => {});
    const { labCards, loadLabStatus, setSelectedTaskForLab, startExperiment } = useProcessLabs({
      autoLoad: false,
      labs: [
        { name: "冲击一室", testType: "冲击试验" },
        { name: "温度冲击一室", testType: "温度冲击试验" },
      ],
      loadSnapshot,
      now: Date.parse("2026-06-04T12:45:00Z"),
      persistSnapshot,
    });

    await loadLabStatus();

    const impactCard = labCards.value.find((card) => card.name === "冲击一室");
    const tempCard = labCards.value.find((card) => card.name === "温度冲击一室");
    expect(impactCard).toMatchObject({
      canStartExperiment: false,
      readyTrayCount: 0,
    });
    expect(tempCard).toMatchObject({
      canStartExperiment: true,
      readyTrayCount: 1,
    });

    setSelectedTaskForLab("冲击一室", "TASK-SHARED", "EXP-IMPACT");
    await startExperiment(impactCard);

    expect(persistSnapshot).not.toHaveBeenCalled();
  });

  test("builds a compressed multi-experiment tray flow for the selected process task without auto-completing earlier experiments", async () => {
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
      "送至暂存间",
      "已到达暂存间",
      "送至盐雾试验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "B实验进行中",
      "A实验未完成",
      "C实验未完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
  });

  test("uses mqtt experiment run state in selected tray flow when process samples still report ready", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "盐雾试验室",
          end_at: "2026-04-03T11:30:00Z",
          experiment_code: "SYLU-2026-03-006-A",
          start_at: "2026-04-03T08:00:00Z",
          task_code: "SYLU-2026-03-006",
        },
      ],
      "mes.tasks": [{ code: "SYLU-2026-03-006", name: "任务006", status: "实验进行中", test_type: "盐雾试验" }],
      "mes.experiments": [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "盐雾试验", status: "实验准备就绪" },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
      ],
      "mes.experiment_runs": [
        {
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          tray_codes: ["SYLU-2026-03-006-TP-001"],
          status: "实验进行中",
          started_at: "2026-04-03 08:30:00",
        },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-03-006-SP-001",
          task_code: "SYLU-2026-03-006",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-03-006-TP-001", status: "实验准备就绪", quantity: 1 }],
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

    expect(selectedTaskDetail.value.selectedTrayFlow.currentStatus).toBe(
      "当前托盘：SYLU-2026-03-006-TP-001 | 当前状态：盐雾试验进行中",
    );
    expect(selectedTaskDetail.value.selectedTrayFlow.steps.find((step) => step.label === "盐雾试验进行中")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });
});
