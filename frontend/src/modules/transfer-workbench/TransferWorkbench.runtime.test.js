import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import TransferWorkbench from "./TransferWorkbench.vue";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import { SNAPSHOT_UPDATED_EVENT } from "@/lib/storageApi";

const {
  routerPush,
  routerReplace,
  logoutSessionMock,
  switchSessionModuleMock,
} = vi.hoisted(() => ({
  routerPush: vi.fn(() => Promise.resolve()),
  routerReplace: vi.fn(),
  logoutSessionMock: vi.fn(() => Promise.resolve()),
  switchSessionModuleMock: vi.fn(async (moduleKey) => ({ ok: true, module: moduleKey })),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
  }),
}));

vi.mock("@/auth", () => ({
  logoutSession: logoutSessionMock,
  resolveModuleHome: (moduleKey) => ({
    central: "/",
    handover: "/handover-system",
    visual: "/visualization",
    staging: "/staging-management",
  })[moduleKey] || "/",
  switchSessionModule: switchSessionModuleMock,
}));

const createBootstrapPayload = () => ({
  taskOverview: [
    {
      taskId: 101,
      seq: 1,
      taskNo: "SYLU-2026-03-101",
      taskName: "连接器批次 A",
      sampleCount: 4,
      taskType: "盐雾试验 / 振动试验",
      experimentTypeText: "盐雾试验 / 振动试验",
      receivedTime: "2026-03-21 10:20",
      taskStatus: "未入库",
      taskProgress: "样品已送达，待打印二维码",
      sampleCodes: ["SYLU-2026-03-101-SP-001", "SYLU-2026-03-101-SP-002"],
      sampleCodesText: "SYLU-2026-03-101-SP-001 / SYLU-2026-03-101-SP-002",
    },
    {
      taskId: 102,
      seq: 2,
      taskNo: "SYLU-2026-03-102",
      taskName: "连接器批次 B",
      sampleCount: 2,
      taskType: "冲击试验 / 振动试验",
      experimentTypeText: "冲击试验 / 振动试验",
      receivedTime: "2026-03-19 09:10",
      taskStatus: "到货",
      taskProgress: "已确认入库",
      sampleCodes: ["SYLU-2026-03-102-SP-001", "SYLU-2026-03-102-SP-002"],
      sampleCodesText: "SYLU-2026-03-102-SP-001 / SYLU-2026-03-102-SP-002",
    },
  ],
  pendingTaskCount: 1,
  storedTaskCount: 1,
});

const createWorkspacePayload = () => ({
  allocationSaved: false,
  task: {
    taskId: 101,
    taskNo: "SYLU-2026-03-101",
    taskName: "连接器批次 A",
    taskType: "盐雾试验 / 振动试验",
    experimentTypeText: "盐雾试验 / 振动试验",
    taskStatus: "未入库",
    taskProgress: "样品已送达，待打印二维码",
    receivedTime: "2026-03-21 10:20",
    trayLimit: 2,
    printedTrayCount: 0,
  },
  experiments: [
    { experimentCode: "SYLU-2026-03-101-A", experimentName: "盐雾试验", assignedTrayNos: ["SYLU-2026-03-101-TP-001"] },
    { experimentCode: "SYLU-2026-03-101-B", experimentName: "振动试验", assignedTrayNos: ["SYLU-2026-03-101-TP-002"] },
  ],
  assignedTrays: [
    {
      trayId: 201,
      trayNo: "SYLU-2026-03-101-TP-001",
      trayType: "标准托盘",
      trayStatus: "已预分配",
      capacity: 2,
      experimentLabels: ["盐雾试验"],
      experimentCodes: ["SYLU-2026-03-101-A"],
      samples: [
        { sampleId: 1, sampleNo: "SYLU-2026-03-101-SP-001", sampleStatus: "未入库" },
        { sampleId: 2, sampleNo: "SYLU-2026-03-101-SP-002", sampleStatus: "未入库" },
      ],
      barcode: null,
      barcodeData: null,
    },
    {
      trayId: 202,
      trayNo: "SYLU-2026-03-101-TP-002",
      trayType: "标准托盘",
      trayStatus: "已预分配",
      capacity: 2,
      experimentLabels: ["振动试验"],
      experimentCodes: ["SYLU-2026-03-101-B"],
      samples: [
        { sampleId: 3, sampleNo: "SYLU-2026-03-101-SP-003", sampleStatus: "未入库" },
      ],
      barcode: null,
      barcodeData: null,
    },
  ],
  trayInventory: [{ trayId: 203, trayNo: "STOCK-TP-003", trayType: "标准托盘", capacity: 2, currentTaskId: null }],
});

const createStoredWorkspace = () => ({
  allocationSaved: true,
  task: {
    taskId: 102,
    taskNo: "SYLU-2026-03-102",
    taskName: "连接器批次 B",
    taskType: "冲击试验 / 振动试验",
    experimentTypeText: "冲击试验 / 振动试验",
    taskStatus: "到货",
    taskProgress: "已确认入库",
    receivedTime: "2026-03-19 09:10",
    trayLimit: 2,
    printedTrayCount: 1,
  },
  experiments: [
    { experimentCode: "SYLU-2026-03-102-A", experimentName: "冲击试验", assignedTrayNos: ["SYLU-2026-03-102-TP-001"] },
  ],
  assignedTrays: [
    {
      trayId: 301,
      trayNo: "SYLU-2026-03-102-TP-001",
      trayType: "标准托盘",
      trayStatus: "到货",
      capacity: 2,
      experimentLabels: ["冲击试验"],
      experimentCodes: ["SYLU-2026-03-102-A"],
      samples: [
        { sampleId: 11, sampleNo: "SYLU-2026-03-102-SP-001", sampleStatus: "到货" },
      ],
      barcode: { barcodeId: 901, objectId: 301, barcodeNo: "SYLU-2026-03-102-TP-001" },
      barcodeData: null,
    },
  ],
  trayInventory: [],
});

const createStartedStoredWorkspace = () => ({
  allocationSaved: true,
  task: {
    taskId: 102,
    taskNo: "SYLU-2026-03-102",
    taskName: "连接器批次 B",
    taskType: "冲击试验 / 振动试验",
    experimentTypeText: "冲击试验 / 振动试验",
    taskStatus: "到货",
    taskProgress: "实验进行中",
    receivedTime: "2026-03-19 09:10",
    trayLimit: 2,
    printedTrayCount: 1,
    reloadBlocked: true,
    reloadBlockedReason: "该任务已有托盘开始实验，不能重新入库。",
  },
  experiments: [
    { experimentCode: "SYLU-2026-03-102-A", experimentName: "冲击试验", assignedTrayNos: ["SYLU-2026-03-102-TP-001"] },
  ],
  assignedTrays: [
    {
      trayId: 301,
      trayNo: "SYLU-2026-03-102-TP-001",
      trayType: "标准托盘",
      trayStatus: "实验进行中",
      capacity: 2,
      experimentLabels: ["冲击试验"],
      experimentCodes: ["SYLU-2026-03-102-A"],
      samples: [
        { sampleId: 11, sampleNo: "SYLU-2026-03-102-SP-001", sampleStatus: "实验进行中" },
      ],
      barcode: { barcodeId: 901, objectId: 301, barcodeNo: "SYLU-2026-03-102-TP-001" },
      barcodeData: null,
    },
  ],
  trayInventory: [],
});

const createDispatchLookupPayload = () => ({
  tray: {
    trayNo: "SYLU-2026-03-102-TP-001",
    trayStatus: "到货",
    taskNo: "SYLU-2026-03-102",
    taskName: "连接器批次 B",
    sampleCount: 2,
    experimentLabels: ["通电试验", "耐久试验"],
    experimentCodes: ["SYLU-2026-03-102-B", "SYLU-2026-03-102-A"],
  },
  destinations: [
    {
      targetType: "staging",
      targetName: "恒温恒湿间（暂存间）",
      experimentCode: "",
      experimentName: "暂存间",
      scheduled: true,
      preferred: false,
      scheduleStartAt: "",
      scheduleEndAt: "",
    },
    {
      targetType: "lab",
      targetName: "振动一室",
      experimentCode: "SYLU-2026-03-102-B",
      experimentName: "通电试验",
      scheduled: true,
      preferred: true,
      scheduleStartAt: "2026-03-20T09:00:00",
      scheduleEndAt: "2026-03-20T12:00:00",
    },
    {
      targetType: "lab",
      targetName: "冲击一室",
      experimentCode: "SYLU-2026-03-102-A",
      experimentName: "耐久试验",
      scheduled: true,
      preferred: false,
      scheduleStartAt: "2026-03-20T14:00:00",
      scheduleEndAt: "2026-03-20T16:00:00",
    },
  ],
});

const createDispatchPostedPayload = () => ({
  ok: true,
  message: "SYLU-2026-03-102-TP-001已标记为送至实验室",
  affectedSampleCount: 2,
  tray: {
    trayNo: "SYLU-2026-03-102-TP-001",
    trayStatus: "送至实验室",
    trayDisplayStatus: "振动一室",
    taskNo: "SYLU-2026-03-102",
    taskName: "连接器批次 B",
    sampleCount: 2,
    experimentLabels: ["通电试验", "耐久试验"],
    experimentCodes: ["SYLU-2026-03-102-B", "SYLU-2026-03-102-A"],
  },
  destinations: createDispatchLookupPayload().destinations,
});

const createStagingDispatchPostedPayload = () => ({
  ok: true,
  message: "SYLU-2026-03-102-TP-001已标记为送至暂存间",
  affectedSampleCount: 2,
  tray: {
    trayNo: "SYLU-2026-03-102-TP-001",
    trayStatus: "送至暂存间",
    trayDisplayStatus: "送至暂存间",
    taskNo: "SYLU-2026-03-102",
    taskName: "连接器批次 B",
    sampleCount: 2,
    experimentLabels: ["通电试验", "耐久试验"],
    experimentCodes: ["SYLU-2026-03-102-B", "SYLU-2026-03-102-A"],
  },
  destinations: createDispatchLookupPayload().destinations,
});

const createWithdrawnDispatchPayload = () => ({
  ok: true,
  message: "SYLU-2026-03-102-TP-001已撤回出库",
  affectedSampleCount: 2,
  restoredStatus: "到货",
  restoredLocation: "接驳区",
  tray: {
    trayNo: "SYLU-2026-03-102-TP-001",
    trayStatus: "到货",
    taskNo: "SYLU-2026-03-102",
    taskName: "连接器批次 B",
    sampleCount: 2,
    experimentLabels: ["通电试验", "耐久试验"],
    experimentCodes: ["SYLU-2026-03-102-B", "SYLU-2026-03-102-A"],
  },
  destinations: createDispatchLookupPayload().destinations,
});

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

describe("TransferWorkbench runtime", () => {
  beforeEach(() => {
    const bootstrapPayload = createBootstrapPayload();
    const pendingWorkspace = createWorkspacePayload();
    const storedWorkspace = createStoredWorkspace();
    let dispatchLookupPayload = createDispatchLookupPayload();
    const fetchStub = vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => pendingWorkspace };
      }
      if (url.includes("/api/transfer-area/tasks/102/workspace")) {
        return { ok: true, status: 200, json: async () => storedWorkspace };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: { ...pendingWorkspace, allocationSaved: true } }) };
      }
      if (url.includes("/api/transfer-area/tasks/101/reload")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已重新分配", workspace: pendingWorkspace }) };
      }
      if (url.includes("/api/transfer-area/tasks/101/print-barcodes") || url.includes("/api/transfer-area/tasks/102/print-barcodes")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "二维码已生成", barcodes: [], workspace: pendingWorkspace }) };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch") && (options.method || "GET") === "GET") {
        return { ok: true, status: 200, json: async () => dispatchLookupPayload };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch") && options.method === "POST") {
        dispatchLookupPayload = createDispatchPostedPayload();
        return { ok: true, status: 200, json: async () => dispatchLookupPayload };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    });
    vi.stubGlobal("fetch", fetchStub);
    vi.stubGlobal("open", vi.fn(() => ({
      document: { write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    routerPush.mockReset();
    routerReplace.mockReset();
    logoutSessionMock.mockClear();
    switchSessionModuleMock.mockClear();
  });

  test("handover mode renders top nav actions and switches between overview and dispatch work views", async () => {
    const wrapper = mount(TransferWorkbench, {
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    const actionTexts = wrapper.findAll(".transfer-system-actions .action-btn").map((button) => button.text());
    expect(actionTexts).toEqual(["任务总览", "样品出库", "出错样品处理", "退出登录"]);
    expect(wrapper.get(".transfer-system-title").text()).toBe("接驳区工作台");
    expect(wrapper.find(".transfer-system-header .eyebrow").exists()).toBe(false);
    expect(wrapper.find(".transfer-system-subtitle").exists()).toBe(false);
    expect(wrapper.get(".transfer-overview-shell__head .transfer-overview-page-title").text()).toBe("接驳任务总览");
    expect(wrapper.get('[data-testid="handover-nav-overview"]').classes()).toContain("is-active");
    expect(wrapper.find('[data-testid="transfer-dispatch-panel"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("总任务清单");
    expect(wrapper.text()).not.toContain("样品送达后可调整托盘分装");
    expect(wrapper.find('[data-testid="pagination-jump-input"]').exists()).toBe(false);

    await wrapper.get('[data-testid="handover-nav-dispatch"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="handover-nav-dispatch"]').classes()).toContain("is-active");
    expect(wrapper.find('[data-testid="transfer-dispatch-panel"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("请扫描托盘二维码");

    await wrapper.get('[data-testid="handover-nav-overview"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="handover-nav-overview"]').classes()).toContain("is-active");
    expect(wrapper.find('[data-testid="transfer-dispatch-panel"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("总任务清单");
  });

  test("handover overview nav returns from a hidden task detail to the task list", async () => {
    const wrapper = mount(TransferWorkbench, {
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.get('[data-testid="transfer-task-code"]').text()).toBe("SYLU-2026-03-101");

    await wrapper.get('[data-testid="handover-nav-dispatch"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.find('[data-testid="transfer-dispatch-panel"]').exists()).toBe(true);

    await wrapper.get('[data-testid="handover-nav-overview"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.find('[data-testid="transfer-dispatch-panel"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="transfer-task-code"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("总任务清单");
    expect(wrapper.find('[data-testid="transfer-task-row-101"]').exists()).toBe(true);
  });

  test("transfer workbench waits for stage-change events instead of polling on a short timer", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");

    const wrapper = mount(TransferWorkbench, {
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(addEventListenerSpy).toHaveBeenCalledWith(SAMPLES_UPDATED_EVENT, expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith(SNAPSHOT_UPDATED_EVENT, expect.any(Function));
    expect(addEventListenerSpy).not.toHaveBeenCalledWith("focus", expect.any(Function));
  });

  test("transfer workbench refreshes when a sample stage-change event is broadcast", async () => {
    const fetchMock = fetch;
    const wrapper = mount(TransferWorkbench, {
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    const fetchCallCountBeforeEvent = fetchMock.mock.calls.length;

    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await settle(wrapper);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(fetchCallCountBeforeEvent);
  });

  test("keeps overview rows visible while realtime refresh is loading", async () => {
    let bootstrapCalls = 0;
    let resolveRefresh = null;
    vi.stubGlobal("fetch", vi.fn((input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        bootstrapCalls += 1;
        if (bootstrapCalls > 1) {
          return new Promise((resolve) => {
            resolveRefresh = () => resolve({ ok: true, status: 200, json: async () => createBootstrapPayload() });
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => createBootstrapPayload() });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    expect(wrapper.find('[data-testid="transfer-task-row-101"]').exists()).toBe(true);

    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await settle(wrapper);

    expect(wrapper.find('[data-testid="transfer-loading-state"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="transfer-task-row-101"]').exists()).toBe(true);

    resolveRefresh();
    await settle(wrapper);
  });

  test("coalesces concurrent bootstrap reloads into one request", async () => {
    let bootstrapCalls = 0;
    let resolveReload = null;
    const emptyBootstrapPayload = {
      ...createBootstrapPayload(),
      taskOverview: [],
      pendingTaskCount: 0,
      storedTaskCount: 0,
    };
    vi.stubGlobal("fetch", vi.fn((input) => {
      const url = String(input);
      if (!url.includes("/api/transfer-area/bootstrap")) {
        throw new Error(`Unhandled fetch: ${url}`);
      }
      bootstrapCalls += 1;
      if (bootstrapCalls === 1) {
        return Promise.resolve({ ok: true, status: 200, json: async () => emptyBootstrapPayload });
      }
      return new Promise((resolve) => {
        resolveReload = () => resolve({ ok: true, status: 200, json: async () => createBootstrapPayload() });
      });
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    const reloadButton = wrapper.findAll("button").find((button) => button.text() === "重新加载");
    expect(reloadButton).toBeDefined();

    const firstClick = reloadButton.trigger("click");
    const secondClick = reloadButton.trigger("click");
    await Promise.all([firstClick, secondClick]);

    expect(bootstrapCalls).toBe(2);
    resolveReload();
    await settle(wrapper);
    expect(wrapper.find('[data-testid="transfer-task-row-101"]').exists()).toBe(true);
  });

  test("does not treat legacy stored task status as arrived in the overview filter", async () => {
    const bootstrapPayload = createBootstrapPayload();
    bootstrapPayload.taskOverview = [
      {
        ...bootstrapPayload.taskOverview[0],
        taskId: 201,
        taskNo: "SYLU-2026-03-201",
        taskStatus: "已入库",
      },
    ];
    bootstrapPayload.pendingTaskCount = 0;
    bootstrapPayload.storedTaskCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-filter-stored"]').text()).toContain("0");
    await wrapper.get('[data-testid="transfer-filter-stored"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.find('[data-testid="transfer-task-row-201"]').exists()).toBe(false);
    await wrapper.get('[data-testid="transfer-filter-all"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-task-row-201"]').text()).toContain("SYLU-2026-03-201");
  });

  test("handover dispatch view scans a tray, shows preferred destinations, and submits dispatch", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    const wrapper = mount(TransferWorkbench, {
      attachTo: document.body,
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-nav-dispatch"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-dispatch-panel"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="transfer-dispatch-panel"]').classes()).toContain("transfer-dispatch-shell");
    await wrapper.get('[data-testid="transfer-dispatch-scan-input"]').setValue("MES-TRAY:SYLU-2026-03-102-TP-001");
    expect(wrapper.get('[data-testid="transfer-dispatch-scan-input"]').element.value).toBe("SYLU-2026-03-102-TP-001");
    await wrapper.get('[data-testid="transfer-dispatch-scan-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102-TP-001");
    expect(wrapper.get('[data-testid="transfer-dispatch-scan-input"]').element.value).toBe("");
    expect(document.activeElement).toBe(wrapper.get('[data-testid="transfer-dispatch-scan-input"]').element);
    const summary = wrapper.get('[data-testid="transfer-dispatch-tray-summary"]');
    expect(summary.exists()).toBe(true);
    const summaryTaskNo = summary.get('[data-testid="transfer-dispatch-summary-task-no"]');
    expect(summaryTaskNo.get("span").text()).toBe("任务编号");
    expect(summaryTaskNo.get("strong").text()).toBe("SYLU-2026-03-102");
    const experimentTags = summary.findAll(".transfer-dispatch-summary-card__experiment-tag");
    expect(experimentTags.map((tag) => tag.text())).toEqual(["通电试验", "耐久试验"]);
    const experimentToneClasses = experimentTags.map((tag) =>
      tag.classes().find((className) => className.startsWith("transfer-dispatch-summary-card__experiment-tag--tone-")),
    );
    expect(new Set(experimentToneClasses).size).toBe(2);
    expect(summary.findAll(".transfer-dispatch-summary-card__stat strong").map((stat) => stat.text())).toEqual(["2", "2"]);
    expect(summary.text()).not.toContain("托盘摘要");
    expect(summary.text()).not.toContain("待出库");
    expect(summary.text()).not.toContain("任务名称");
    expect(summary.text()).not.toContain("连接器批次 B");
    expect(summary.text()).not.toContain("关联实验");
    expect(wrapper.get('[data-testid="transfer-dispatch-destination-grid"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="transfer-dispatch-destination-card-0"]').text()).toContain("暂存间");
    expect(wrapper.get('[data-testid="transfer-dispatch-destination-card-1"]').text()).toContain("振动一室");
    expect(wrapper.get('[data-testid="transfer-dispatch-destination-card-1"]').text()).toContain("通电试验");
    expect(wrapper.get('[data-testid="transfer-dispatch-destination-badge-1"]').text()).toBe("优先送达");
    expect(wrapper.text()).toContain("恒温恒湿间（暂存间）");
    expect(wrapper.text()).toContain("振动一室");
    expect(wrapper.text()).toContain("优先送达");

    await wrapper.get('[data-testid="transfer-dispatch-destination-1"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102-TP-001已标记为送至实验室");
    expect(wrapper.text()).toContain("当前状态：振动一室");
    expect(wrapper.get('[data-testid="transfer-dispatch-scan-input"]').element.value).toBe("");
    expect(document.activeElement).toBe(wrapper.get('[data-testid="transfer-dispatch-scan-input"]').element);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch"),
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-MES-Update-Source": "transfer-workbench",
          "X-MES-Update-Request-Id": expect.stringContaining("transfer-workbench:"),
        }),
      }),
    );
    expect(fetch.mock.calls.filter(([input, options = {}]) =>
      String(input).includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch")
      && (options.method || "GET") === "GET"
    )).toHaveLength(1);
    expect(dispatchEventSpy.mock.calls.some(([event]) =>
      event?.type === SAMPLES_UPDATED_EVENT
      && event?.detail?.source === "transfer-workbench"
      && event?.detail?.reason === "dispatch"
    )).toBe(true);
    wrapper.unmount();
  });

  test("handover dispatch keeps success feedback when post-dispatch lookup is rejected", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    let dispatched = false;
    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => createBootstrapPayload() };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => createWorkspacePayload() };
      }
      if (url.includes("/api/transfer-area/tasks/102/workspace")) {
        return { ok: true, status: 200, json: async () => createStoredWorkspace() };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch") && (options.method || "GET") === "GET") {
        if (dispatched) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ detail: "该托盘当前不在接驳区，不能从接驳区出库" }),
          };
        }
        return { ok: true, status: 200, json: async () => createDispatchLookupPayload() };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch") && options.method === "POST") {
        dispatched = true;
        return { ok: true, status: 200, json: async () => createDispatchPostedPayload() };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      attachTo: document.body,
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-nav-dispatch"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-dispatch-scan-input"]').setValue("SYLU-2026-03-102-TP-001");
    await wrapper.get('[data-testid="transfer-dispatch-scan-submit"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-dispatch-destination-1"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102-TP-001已标记为送至实验室");
    expect(wrapper.text()).not.toContain("该托盘当前不在接驳区，不能从接驳区出库");
    expect(fetch.mock.calls.filter(([input, options = {}]) =>
      String(input).includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch")
      && (options.method || "GET") === "GET"
    )).toHaveLength(1);
    expect(dispatchEventSpy.mock.calls.some(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toBe(true);
    wrapper.unmount();
  });

  test("handover error sample dialog withdraws a dispatched tray back to arrived status", async () => {
    let lookupPayload = createDispatchPostedPayload();
    let workspacePayload = createStoredWorkspace();
    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => createBootstrapPayload() };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => createWorkspacePayload() };
      }
      if (url.includes("/api/transfer-area/tasks/102/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch") && options.method === "POST") {
        lookupPayload = createWithdrawnDispatchPayload();
        workspacePayload = {
          ...createStoredWorkspace(),
          task: { ...createStoredWorkspace().task, taskStatus: "到货" },
          assignedTrays: createStoredWorkspace().assignedTrays.map((tray) => ({
            ...tray,
            trayStatus: "到货",
            samples: tray.samples.map((sample) => ({ ...sample, sampleStatus: "到货" })),
          })),
        };
        return { ok: true, status: 200, json: async () => lookupPayload };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch") && (options.method || "GET") === "GET") {
        return { ok: true, status: 200, json: async () => lookupPayload };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      attachTo: document.body,
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-filter-stored"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-102"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-error-sample"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="tray-error-sample-scan-input"]').exists()).toBe(true);
    await wrapper.get('[data-testid="tray-error-sample-scan-input"]').setValue("MES-TRAY:SYLU-2026-03-102-TP-001");
    expect(wrapper.get('[data-testid="tray-error-sample-scan-input"]').element.value).toBe("SYLU-2026-03-102-TP-001");
    await wrapper.get('[data-testid="tray-error-sample-query"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="tray-error-sample-result"]').text()).toContain("振动一室");
    expect(wrapper.get('[data-testid="tray-error-sample-scan-input"]').element.value).toBe("");
    expect(document.activeElement).toBe(wrapper.get('[data-testid="tray-error-sample-scan-input"]').element);
    expect(wrapper.get('[data-testid="tray-error-sample-withdraw"]').exists()).toBe(true);

    await wrapper.get('[data-testid="tray-error-sample-withdraw"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="tray-error-sample-withdraw-modal"]').text()).toContain("是否确认撤回出库");
    await wrapper.get('[data-testid="tray-error-sample-withdraw-confirm"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102-TP-001已撤回出库");
    expect(wrapper.get('[data-testid="tray-error-sample-result"]').text()).toContain("到货");
    expect(wrapper.find('[data-testid="tray-error-sample-withdraw"]').exists()).toBe(false);
    await wrapper.get('[data-testid="tray-error-sample-dialog"] .modal-close').trigger("click");
    await settle(wrapper);

    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/api/transfer-area/bootstrap"))).toHaveLength(3);
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/api/transfer-area/tasks/102/workspace"))).toHaveLength(3);
    expect(wrapper.text()).not.toContain("到货任务仅支持查看与打印。");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch"),
      expect.objectContaining({ method: "POST" }),
    );
    wrapper.unmount();
  });

  test("handover error sample dialog uses withdraw lookup instead of dispatch lookup", async () => {
    let lookupPayload = createDispatchPostedPayload();
    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => createBootstrapPayload() };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch") && (options.method || "GET") === "GET") {
        return { ok: true, status: 200, json: async () => lookupPayload };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch") && options.method === "POST") {
        lookupPayload = createWithdrawnDispatchPayload();
        return { ok: true, status: 200, json: async () => lookupPayload };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch") && (options.method || "GET") === "GET") {
        return {
          ok: false,
          status: 400,
          json: async () => ({ detail: "该托盘当前不在接驳区，不能从接驳区出库" }),
        };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      attachTo: document.body,
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-error-sample"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="tray-error-sample-scan-input"]').setValue("SYLU-2026-03-102-TP-001");
    await wrapper.get('[data-testid="tray-error-sample-query"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="tray-error-sample-result"]').text()).toContain("振动一室");
    expect(wrapper.text()).not.toContain("该托盘当前不在接驳区，不能从接驳区出库");

    await wrapper.get('[data-testid="tray-error-sample-withdraw"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="tray-error-sample-withdraw-confirm"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102-TP-001已撤回出库");
    expect(wrapper.get('[data-testid="tray-error-sample-result"]').text()).toContain("到货");
    expect(fetch.mock.calls.some(([input, options = {}]) =>
      String(input).includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/dispatch")
      && (options.method || "GET") === "GET"
    )).toBe(false);
    wrapper.unmount();
  });

  test("handover error sample dialog withdraws a staging tray back to arrived status", async () => {
    let lookupPayload = createStagingDispatchPostedPayload();
    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => createBootstrapPayload() };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch") && options.method === "POST") {
        lookupPayload = createWithdrawnDispatchPayload();
        return { ok: true, status: 200, json: async () => lookupPayload };
      }
      if (url.includes("/api/transfer-area/trays/SYLU-2026-03-102-TP-001/withdraw-dispatch") && (options.method || "GET") === "GET") {
        return { ok: true, status: 200, json: async () => lookupPayload };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      attachTo: document.body,
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-error-sample"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="tray-error-sample-scan-input"]').setValue("SYLU-2026-03-102-TP-001");
    await wrapper.get('[data-testid="tray-error-sample-query"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="tray-error-sample-result"]').text()).toContain("送至暂存间");
    expect(wrapper.get('[data-testid="tray-error-sample-withdraw"]').exists()).toBe(true);

    await wrapper.get('[data-testid="tray-error-sample-withdraw"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="tray-error-sample-withdraw-confirm"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102-TP-001已撤回出库");
    expect(wrapper.get('[data-testid="tray-error-sample-result"]').text()).toContain("到货");
    wrapper.unmount();
  });

  test("handover dispatch view clears scan input after a failed lookup", async () => {
    const wrapper = mount(TransferWorkbench, {
      attachTo: document.body,
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-nav-dispatch"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-dispatch-scan-input"]').setValue("UNKNOWN-TRAY");
    await wrapper.get('[data-testid="transfer-dispatch-scan-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("UNKNOWN-TRAY");
    expect(wrapper.get('[data-testid="transfer-dispatch-scan-input"]').element.value).toBe("");
    wrapper.unmount();
  });

  test("handover dispatch state is reset after leaving and re-entering dispatch view", async () => {
    const wrapper = mount(TransferWorkbench, {
      attachTo: document.body,
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-nav-dispatch"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-dispatch-scan-input"]').setValue("SYLU-2026-03-102-TP-001");
    await wrapper.get('[data-testid="transfer-dispatch-scan-submit"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.find('[data-testid="transfer-dispatch-result"]').exists()).toBe(true);

    await wrapper.get('[data-testid="transfer-dispatch-destination-1"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.text()).toContain("SYLU-2026-03-102-TP-001已标记为送至实验室");

    await wrapper.get('[data-testid="handover-nav-overview"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="handover-nav-dispatch"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-dispatch-scan-input"]').element.value).toBe("");
    expect(wrapper.find('[data-testid="transfer-dispatch-result"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("SYLU-2026-03-102-TP-001已标记为送至实验室");
    wrapper.unmount();
  });

  test("handover dispatch view auto focuses the tray scan input", async () => {
    const wrapper = mount(TransferWorkbench, {
      attachTo: document.body,
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-nav-dispatch"]').trigger("click");
    await settle(wrapper);

    expect(document.activeElement).toBe(wrapper.get('[data-testid="transfer-dispatch-scan-input"]').element);

    wrapper.unmount();
  });

  test("pre-allocation mode uses clickable filter cards and hides confirm storage", async () => {
    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    expect(wrapper.text()).not.toContain("样品预分装");
    expect(wrapper.text()).not.toContain("总任务清单");
    expect(wrapper.text()).not.toContain("通过总任务清单进入任务样品分配管理");
    expect(wrapper.find(".transfer-overview-page-title").exists()).toBe(false);
    expect(wrapper.text()).toContain("未入库");
    expect(wrapper.text()).toContain("到货");
    expect(wrapper.text()).toContain("全部");
    expect(wrapper.text()).not.toContain("确认入库");

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("支持鼠标拖拽与点击快速调整托盘");
    expect(wrapper.text()).toContain("重新分配");
    expect(wrapper.text()).not.toContain("重新入库");
    expect(wrapper.get('[data-testid="transfer-save-trays"]').exists()).toBe(true);

    await wrapper.get(".transfer-detail-shell__top .action-btn.secondary").trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-filter-stored"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-102"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102");
    expect(wrapper.get('[data-testid="transfer-print-barcodes"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-testid="transfer-save-trays"]').attributes("disabled")).toBeDefined();
  });

  test("handover mode lets an unlocked task move a sample by drag and drop", async () => {
    const wrapper = mount(TransferWorkbench, {
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    const sourceSample = wrapper.get('[data-testid="transfer-tray-card-0"] .sample-tray-sample-tag');
    expect(sourceSample.attributes("draggable")).toBe("true");

    await sourceSample.trigger("dragstart");
    await wrapper.get('[data-testid="transfer-tray-card-1"]').trigger("drop");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-tray-card-0"]').text()).toContain("当前样品 1 / 2");
    expect(wrapper.get('[data-testid="transfer-tray-card-1"]').text()).toContain("当前样品 2 / 2");

    wrapper.unmount();
  });

  test("asks for confirmation before resetting a scheduled task", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspaceWithSchedules = {
      ...createWorkspacePayload(),
      allocationSaved: true,
      task: {
        ...createWorkspacePayload().task,
        hasSchedules: true,
        scheduleResetWarning: "当前任务已有排程，重新分配后将清空排程信息，需要重新排程。",
      },
    };
    const reloadedWorkspace = {
      ...createWorkspacePayload(),
      allocationSaved: false,
      task: {
        ...createWorkspacePayload().task,
        hasSchedules: false,
        scheduleResetWarning: "",
      },
    };
    const requestLog = [];

    vi.stubGlobal("confirm", vi.fn(() => {
      throw new Error("native confirm should not be used");
    }));
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspaceWithSchedules };
      }
      if (url.includes("/api/transfer-area/tasks/101/reload")) {
        requestLog.push("reload");
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已重新分配，需要重新排程。", workspace: reloadedWorkspace }) };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);
    const resetButton = wrapper.findAll("button").find((button) => button.text() === "重新分配");
    expect(resetButton).toBeTruthy();

    await resetButton.trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-schedule-reset-confirm"]').text()).toContain("当前任务已有排程");
    expect(wrapper.get('[data-testid="transfer-schedule-reset-confirm"]').text()).toContain("重新分配后将清空排程信息，需要重新排程。");
    expect(requestLog).toEqual([]);

    await wrapper.get('[data-testid="transfer-schedule-reset-cancel"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.find('[data-testid="transfer-schedule-reset-confirm"]').exists()).toBe(false);
    expect(requestLog).toEqual([]);

    await resetButton.trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-schedule-reset-submit"]').trigger("click");
    await settle(wrapper);

    expect(requestLog).toEqual(["reload"]);
  });

  test("pre-allocation overview renders compact page status and jump controls", async () => {
    const bootstrapPayload = createBootstrapPayload();
    bootstrapPayload.taskOverview = Array.from({ length: 30 }, (_, index) => ({
      ...bootstrapPayload.taskOverview[0],
      taskId: 100 + index,
      seq: index + 1,
      taskNo: `SYLU-2026-03-${String(index + 1).padStart(3, "0")}`,
    }));
    bootstrapPayload.pendingTaskCount = 30;
    bootstrapPayload.storedTaskCount = 0;

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    expect(wrapper.find(".transfer-overview-pagination .task-list-pagination").exists()).toBe(true);
    expect(wrapper.findAll(".transfer-overview-pagination [data-page]").map((node) => node.attributes("data-page"))).toEqual(["prev", "next"]);
    expect(wrapper.get('.transfer-overview-pagination [data-testid="pagination-status"]').text()).toBe("第 1 / 10 页");
    expect(wrapper.find(".transfer-overview-pagination [data-testid='pagination-jump-input']").exists()).toBe(false);
  });

  test("pre-allocation overview returns to the first page when searching from the last page", async () => {
    const bootstrapPayload = createBootstrapPayload();
    bootstrapPayload.taskOverview = Array.from({ length: 12 }, (_, index) => ({
      ...bootstrapPayload.taskOverview[0],
      taskId: 300 + index,
      seq: index + 1,
      taskNo: `SYLU-2026-03-${String(index + 1).padStart(3, "0")}`,
      taskType: index < 8 ? "目标筛选试验" : "普通试验",
      experimentTypeText: index < 8 ? "目标筛选试验" : "普通试验",
      taskStatus: "未入库",
      taskProgress: "样品已送达，待打印二维码",
    }));
    bootstrapPayload.pendingTaskCount = 12;
    bootstrapPayload.storedTaskCount = 0;

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('.transfer-overview-pagination [data-page="next"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('.transfer-overview-pagination [data-page="next"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('.transfer-overview-pagination [data-page="next"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('.transfer-overview-pagination [data-testid="pagination-status"]').text()).toBe("第 4 / 4 页");
    expect(wrapper.find('[data-testid="transfer-task-row-309"]').exists()).toBe(true);

    await wrapper.get(".search-input").setValue("目标筛选");
    await settle(wrapper);

    expect(wrapper.get('.transfer-overview-pagination [data-testid="pagination-status"]').text()).toBe("第 1 / 3 页");
    expect(wrapper.find('[data-testid="transfer-task-row-300"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="transfer-task-row-306"]').exists()).toBe(false);
  });

  test("pre-allocation overview pads the last page to keep pagination fixed", async () => {
    const bootstrapPayload = createBootstrapPayload();
    bootstrapPayload.taskOverview = Array.from({ length: 5 }, (_, index) => ({
      ...bootstrapPayload.taskOverview[0],
      taskId: 200 + index,
      seq: index + 1,
      taskNo: `SYLU-2026-03-${String(index + 1).padStart(3, "0")}`,
      taskStatus: "未入库",
    taskProgress: "样品已送达，待打印二维码",
    }));
    bootstrapPayload.pendingTaskCount = 5;
    bootstrapPayload.storedTaskCount = 0;

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    expect(wrapper.findAll(".transfer-table__body > .transfer-table__row")).toHaveLength(3);

    await wrapper.get('.transfer-overview-pagination [data-page="next"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll(".transfer-table__body > .transfer-table__row")).toHaveLength(3);
    expect(wrapper.findAll("[data-testid^='transfer-task-row-']")).toHaveLength(2);
    const placeholder = wrapper.get("[data-testid='transfer-task-placeholder-1']");
    expect(placeholder.classes()).toContain("transfer-table__row--placeholder");
    expect(placeholder.attributes("role")).toBe("presentation");
    expect(placeholder.attributes("tabindex")).toBe("-1");
  });

  test("assigns every experiment to the only tray after increasing tray limit to one-tray layout", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    let allocationRequest = null;

    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        allocationRequest = JSON.parse(String(options.body || "{}"));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            message: "托盘分配已保存",
            workspace: { ...workspacePayload, allocationSaved: true },
          }),
        };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-tray-limit-input"]').setValue("6");
    await wrapper.get('[data-testid="transfer-tray-limit-input"]').trigger("change");
    await settle(wrapper);

    expect(wrapper.findAll('[data-testid^="transfer-tray-card-"]')).toHaveLength(1);
    expect(wrapper.get('[data-testid="transfer-save-trays"]').attributes("disabled")).toBeUndefined();

    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);

    expect(allocationRequest).toEqual(expect.objectContaining({
      trayLimit: 6,
      experimentTrays: [
        { experimentCode: "SYLU-2026-03-101-A", trayIds: [1001] },
        { experimentCode: "SYLU-2026-03-101-B", trayIds: [1001] },
      ],
    }));
  });

  test("keeps the current tray layout when reducing tray limit would exceed assignable trays", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    workspacePayload.task = {
      ...workspacePayload.task,
      maxAssignableTrayCount: 2,
      remainingTrayCount: 0,
    };
    workspacePayload.trayInventory = [];

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.findAll('[data-testid^="transfer-tray-card-"]')).toHaveLength(2);

    await wrapper.get('[data-testid="transfer-tray-limit-input"]').setValue("1");
    await wrapper.get('[data-testid="transfer-tray-limit-input"]').trigger("change");
    await settle(wrapper);

    expect(wrapper.findAll('[data-testid^="transfer-tray-card-"]')).toHaveLength(2);
    expect(wrapper.get('[data-testid="transfer-tray-limit-input"]').element.value).toBe("2");
    expect(wrapper.get('[data-testid="transfer-detail-feedback"]').text()).toContain("系统剩余托盘不足，当前最多可分配 2 个托盘。");
  });

  test("blocks saving when a loaded tray has no assigned experiment", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    workspacePayload.experiments = [
      { experimentCode: "SYLU-2026-03-101-A", experimentName: "盐雾试验", assignedTrayNos: ["SYLU-2026-03-101-TP-001"] },
      { experimentCode: "SYLU-2026-03-101-B", experimentName: "振动试验", assignedTrayNos: ["SYLU-2026-03-101-TP-001"] },
      { experimentCode: "SYLU-2026-03-101-C", experimentName: "温度冲击试验", assignedTrayNos: ["SYLU-2026-03-101-TP-001"] },
    ];
    workspacePayload.assignedTrays = workspacePayload.assignedTrays.map((tray, index) => ({
      ...tray,
      experimentCodes: index === 0
        ? ["SYLU-2026-03-101-A", "SYLU-2026-03-101-B", "SYLU-2026-03-101-C"]
        : [],
      experimentLabels: index === 0
        ? ["盐雾试验", "振动试验", "温度冲击试验"]
        : [],
    }));

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        throw new Error("save should stay blocked");
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-save-trays"]').attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("有样品的托盘必须至少分配一个实验");
  });

  test("assigns all experiments to 10 trays in one batch and saves the complete matrix", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    const trayNos = Array.from({ length: 10 }, (_, index) => `SYLU-2026-03-101-TP-${String(index + 1).padStart(3, "0")}`);
    workspacePayload.task = { ...workspacePayload.task, trayLimit: 1 };
    workspacePayload.experiments = Array.from({ length: 8 }, (_, index) => ({
      experimentCode: `SYLU-2026-03-101-${String.fromCharCode(65 + index)}`,
      experimentName: `试验 ${index + 1}`,
      assignedTrayNos: [],
    }));
    workspacePayload.assignedTrays = trayNos.map((trayNo, index) => ({
      trayId: 1000 + index,
      trayNo,
      trayType: "标准托盘",
      trayStatus: "已预分配",
      capacity: 1,
      experimentLabels: [],
      experimentCodes: [],
      samples: [{ sampleId: 2000 + index, sampleNo: `SAMPLE-${index + 1}`, sampleStatus: "未入库" }],
      barcode: null,
      barcodeData: null,
    }));
    workspacePayload.trayInventory = [];
    const savedWorkspace = {
      ...workspacePayload,
      allocationSaved: true,
      experiments: workspacePayload.experiments.map((experiment) => ({ ...experiment, assignedTrayNos: trayNos })),
    };
    let allocationPayload = null;

    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        allocationPayload = JSON.parse(options.body);
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: savedWorkspace }) };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-assign-all-experiments"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll('[data-testid^="transfer-tray-card-"]')).toHaveLength(10);
    expect(wrapper.findAll(".transfer-tray-experiment-tag")).toHaveLength(80);
    expect(wrapper.get('[data-testid="transfer-save-trays"]').attributes("disabled")).toBeUndefined();

    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);

    expect(allocationPayload.experimentTrays).toEqual(workspacePayload.experiments.map((experiment) => ({
      experimentCode: experiment.experimentCode,
      trayIds: workspacePayload.assignedTrays.map((tray) => tray.trayId),
    })));
  });

  test.each([
    ["handover", {}],
    ["pre-allocation", { mode: "pre-allocation", showHeader: false }],
  ])("%s mode blocks saving when required trays exceed remaining trays", async (_label, props) => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    workspacePayload.task = {
      ...workspacePayload.task,
      remainingTrayCount: 1,
    };
    let saveAttempted = false;

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        saveAttempted = true;
        throw new Error("save should stay blocked");
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        ...props,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-save-trays"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-tray-capacity-warning"]').text()).toBe("系统剩余托盘不足，当前最多可分配 1 个托盘。");
    expect(saveAttempted).toBe(false);
  });

  test("pre-allocation mode refreshes tray capacity before saving and blocks stale over-allocation", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const initialWorkspacePayload = createWorkspacePayload();
    const refreshedWorkspacePayload = {
      ...createWorkspacePayload(),
      task: {
        ...createWorkspacePayload().task,
        remainingTrayCount: 1,
        maxAssignableTrayCount: 1,
      },
    };
    let workspaceCalls = 0;
    let saveAttempted = false;

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        workspaceCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => (workspaceCalls === 1 ? initialWorkspacePayload : refreshedWorkspacePayload),
        };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        saveAttempted = true;
        return { ok: true, status: 200, json: async () => ({ message: "保存成功", workspace: initialWorkspacePayload }) };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.get('[data-testid="transfer-save-trays"]').attributes("disabled")).toBeUndefined();

    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);

    expect(workspaceCalls).toBe(2);
    expect(saveAttempted).toBe(false);
    expect(wrapper.get('[data-testid="transfer-save-trays"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-tray-capacity-warning"]').text()).toBe("系统剩余托盘不足，当前最多可分配 1 个托盘。");
  });

  test("remaining empty tray count subtracts trays already assigned to the current task", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    workspacePayload.task = {
      ...workspacePayload.task,
      maxAssignableTrayCount: 10,
      remainingTrayCount: 10,
    };
    workspacePayload.experiments = [
      { experimentCode: "SYLU-2026-03-101-A", experimentName: "盐雾试验", assignedTrayNos: ["SYLU-2026-03-101-TP-001"] },
      { experimentCode: "SYLU-2026-03-101-B", experimentName: "振动试验", assignedTrayNos: ["SYLU-2026-03-101-TP-002"] },
      { experimentCode: "SYLU-2026-03-101-C", experimentName: "温度冲击试验", assignedTrayNos: ["SYLU-2026-03-101-TP-003"] },
    ];
    workspacePayload.assignedTrays = [
      {
        ...workspacePayload.assignedTrays[0],
        trayId: 1001,
        trayNo: "SYLU-2026-03-101-TP-001",
        experimentLabels: ["盐雾试验"],
        experimentCodes: ["SYLU-2026-03-101-A"],
      },
      {
        ...workspacePayload.assignedTrays[1],
        trayId: 1002,
        trayNo: "SYLU-2026-03-101-TP-002",
        experimentLabels: ["振动试验"],
        experimentCodes: ["SYLU-2026-03-101-B"],
      },
      {
        ...workspacePayload.assignedTrays[1],
        trayId: 1003,
        trayNo: "SYLU-2026-03-101-TP-003",
        experimentLabels: ["温度冲击试验"],
        experimentCodes: ["SYLU-2026-03-101-C"],
        samples: [
          { sampleId: 4, sampleNo: "SYLU-2026-03-101-SP-004", sampleStatus: "未入库" },
        ],
      },
    ];
    workspacePayload.trayInventory = Array.from({ length: 10 }, (_, index) => ({
      trayId: 2001 + index,
      trayNo: `STOCK-TP-${String(index + 1).padStart(3, "0")}`,
      trayType: "标准托盘",
      capacity: 2,
      currentTaskId: null,
    }));

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get(".transfer-count-chip").text()).toBe("剩余空托盘 7");
  });

  test("keeps unified sample limit capped at 16 and renders validation details as readable text", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            detail: [
              {
                loc: ["body", "trayLimit"],
                msg: "Input should be less than or equal to 16",
              },
            ],
          }),
        };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);
    const limitInput = wrapper.get('[data-testid="transfer-tray-limit-input"]');
    expect(limitInput.attributes("max")).toBe("16");

    await limitInput.setValue("16");
    await limitInput.trigger("change");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).not.toContain("[object Object]");
    expect(wrapper.text()).toContain("body.trayLimit: Input should be less than or equal to 16");
  });

  test("removes a task from the active workspace when the workspace endpoint reports it archived", async () => {
    const initialBootstrap = createBootstrapPayload();
    const archivedBootstrap = {
      ...createBootstrapPayload(),
      taskOverview: [createBootstrapPayload().taskOverview[1]],
      pendingTaskCount: 0,
      storedTaskCount: 1,
    };
    let bootstrapCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        bootstrapCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => (bootstrapCalls === 1 ? initialBootstrap : archivedBootstrap),
        };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ detail: "任务已归档" }),
        };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-101");

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.find('[data-testid="transfer-task-code"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("SYLU-2026-03-101");
    expect(wrapper.text()).toContain("任务已归档");
  });

  test.each([
    ["handover", { mode: "handover" }],
    ["pre-allocation", { embedded: true, mode: "pre-allocation", showHeader: false }],
  ])("%s mode sorts overview tasks only by task number", async (_label, props) => {
    const bootstrapPayload = createBootstrapPayload();
    bootstrapPayload.taskOverview = bootstrapPayload.taskOverview.map((task) => ({
      ...task,
      seq: task.taskId === 101 ? 2 : 1,
    }));
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, { props });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-filter-all"]').trigger("click");
    await settle(wrapper);

    const headersWithSort = wrapper.findAll(".transfer-table__head [data-sort]");
    expect(headersWithSort).toHaveLength(1);

    const taskNoHeader = wrapper.get('[data-testid="transfer-sort-task-no"]');
    expect(taskNoHeader.attributes("data-sort-dir")).toBe("");
    expect(wrapper.findAll('[data-testid^="transfer-task-row-"]').map((row) => row.text())).toEqual([
      expect.stringContaining("SYLU-2026-03-101"),
      expect.stringContaining("SYLU-2026-03-102"),
    ]);

    await taskNoHeader.trigger("click");
    await settle(wrapper);

    expect(taskNoHeader.attributes("data-sort-dir")).toBe("asc");
    expect(wrapper.findAll('[data-testid^="transfer-task-row-"]').map((row) => row.text())).toEqual([
      expect.stringContaining("SYLU-2026-03-101"),
      expect.stringContaining("SYLU-2026-03-102"),
    ]);

    await taskNoHeader.trigger("click");
    await settle(wrapper);

    expect(taskNoHeader.attributes("data-sort-dir")).toBe("desc");
    expect(wrapper.findAll('[data-testid^="transfer-task-row-"]').map((row) => row.text())).toEqual([
      expect.stringContaining("SYLU-2026-03-102"),
      expect.stringContaining("SYLU-2026-03-101"),
    ]);
  });

  test.each([
    ["handover", { mode: "handover" }],
    ["pre-allocation", { embedded: true, mode: "pre-allocation", showHeader: false }],
  ])("%s mode shows a saved-tray hint when locked actions are attempted", async (_label, props) => {
    const wrapper = mount(TransferWorkbench, { props });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    const experimentTabs = wrapper.findAll('[data-testid^="transfer-experiment-tab-"]');
    expect(experimentTabs).toHaveLength(2);
    experimentTabs.forEach((tab) => {
      expect(tab.attributes("aria-disabled")).toBe("false");
    });

    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);

    wrapper.findAll('[data-testid^="transfer-experiment-tab-"]').forEach((tab) => {
      expect(tab.attributes("aria-disabled")).toBe("true");
    });

    await wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-A"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-locked-operation-hint"]').text()).toBe("托盘已保存，若想更改请重新入库");

    await wrapper.get(".sample-tray-sample-tag").trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-locked-operation-hint"]').text()).toBe("托盘已保存，若想更改请重新入库");

    await wrapper.get(".sample-tray-remove").trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-locked-operation-hint"]').text()).toBe("托盘已保存，若想更改请重新入库");
  });

  test("pre-allocation experiment tabs and tray labels prefer experiment types over experiment names", async () => {
    const bootstrapPayload = createBootstrapPayload();
    bootstrapPayload.taskOverview[0] = {
      ...bootstrapPayload.taskOverview[0],
      taskType: "盐雾试验 / 高低温湿热试验",
      experimentTypeText: "盐雾试验 / 高低温湿热试验",
    };
    const workspacePayload = createWorkspacePayload();
    workspacePayload.task = {
      ...workspacePayload.task,
      taskType: "盐雾试验 / 高低温湿热试验",
      experimentTypeText: "盐雾试验 / 高低温湿热试验",
    };
    workspacePayload.experiments = [
      { experimentCode: "SYLU-2026-03-101-A", experimentName: "盐雾试验-A", requiredDevice: "盐雾试验", assignedTrayNos: ["SYLU-2026-03-101-TP-001"] },
      { experimentCode: "SYLU-2026-03-101-B", experimentName: "高低温湿热试验2", requiredDevice: "高低温湿热试验", assignedTrayNos: ["SYLU-2026-03-101-TP-002"] },
    ];
    workspacePayload.assignedTrays = workspacePayload.assignedTrays.map((tray, index) => ({
      ...tray,
      experimentCodes: [workspacePayload.experiments[index].experimentCode],
      experimentLabels: [workspacePayload.experiments[index].experimentName],
    }));

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-A"]').text()).toBe("盐雾试验");
    expect(wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-B"]').text()).toBe("高低温湿热试验");
    expect(wrapper.text()).not.toContain("高低温湿热试验2");
    expect(wrapper.text()).not.toContain("盐雾试验-A");
  });

  test("handover mode allows confirming a centrally pre-allocated task without a received time", async () => {
    const bootstrapPayload = {
      taskOverview: [
        {
          taskId: 201,
          seq: 1,
          taskNo: "SYLU-2026-04-201",
          taskName: "中控新增任务",
          sampleCount: 2,
          taskType: "盐雾试验",
          experimentTypeText: "盐雾试验",
          receivedTime: "",
          taskStatus: "未入库",
          taskProgress: "中控已预分配托盘，等待样品送达",
          sampleCodes: ["SYLU-2026-04-201-SP-001", "SYLU-2026-04-201-SP-002"],
          sampleCodesText: "SYLU-2026-04-201-SP-001 / SYLU-2026-04-201-SP-002",
        },
      ],
      pendingTaskCount: 1,
      storedTaskCount: 0,
    };
    const preAllocatedWorkspace = {
      allocationSaved: true,
      task: {
        taskId: 201,
        taskNo: "SYLU-2026-04-201",
        taskName: "中控新增任务",
        taskType: "盐雾试验",
        experimentTypeText: "盐雾试验",
        taskStatus: "未入库",
        taskProgress: "中控已预分配托盘，等待样品送达",
        receivedTime: "",
        trayLimit: 4,
        printedTrayCount: 0,
      },
      experiments: [
        { experimentCode: "SYLU-2026-04-201-A", experimentName: "盐雾试验", assignedTrayNos: ["SYLU-2026-04-201-TP-001"] },
      ],
      assignedTrays: [
        {
          trayId: 1001,
          trayNo: "SYLU-2026-04-201-TP-001",
          trayType: "标准托盘",
          trayStatus: "未入库",
          capacity: 4,
          experimentLabels: ["盐雾试验"],
          experimentCodes: ["SYLU-2026-04-201-A"],
          samples: [
            { sampleId: "sample-201-1", sampleNo: "SYLU-2026-04-201-SP-001", sampleStatus: "未入库" },
            { sampleId: "sample-201-2", sampleNo: "SYLU-2026-04-201-SP-002", sampleStatus: "未入库" },
          ],
          barcode: null,
          barcodeData: null,
        },
      ],
      trayInventory: [],
    };
    const confirmedWorkspace = {
      ...preAllocatedWorkspace,
      allocationSaved: true,
      task: {
        ...preAllocatedWorkspace.task,
        taskStatus: "未入库",
        taskProgress: "已确认入库",
        receivedTime: "2026-04-21 16:30",
      },
      assignedTrays: preAllocatedWorkspace.assignedTrays.map((tray) => ({
        ...tray,
        trayStatus: "未入库",
        samples: tray.samples.map((sample) => ({ ...sample, sampleStatus: "未入库" })),
      })),
    };

    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/201/workspace")) {
        return { ok: true, status: 200, json: async () => preAllocatedWorkspace };
      }
      if (url.includes("/api/transfer-area/tasks/201/confirm-storage") && options.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已确认入库", workspace: confirmedWorkspace }) };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-201"]').trigger("click");
    await settle(wrapper);

    const confirmButton = wrapper.findAll("button").find((button) => button.text() === "确认入库");
    expect(confirmButton.attributes("disabled")).toBeUndefined();

    await confirmButton.trigger("click");
    await settle(wrapper);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/transfer-area/tasks/201/confirm-storage"),
      expect.objectContaining({ method: "POST" }),
    );
    const feedback = wrapper.get('[data-testid="transfer-detail-feedback"]');
    expect(feedback.text()).toContain("任务已确认入库");
    expect(feedback.classes()).toContain("app-feedback--success");
    expect(wrapper.get('[data-testid="transfer-tray-card-0"]').text()).toContain("托盘状态 到货");
    expect(wrapper.get('[data-testid="transfer-tray-card-0"]').text()).toContain("SYLU-2026-04-201-SP-001");
    expect(wrapper.get('[data-testid="transfer-tray-card-0"]').text()).toContain("到货");
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/api/transfer-area/bootstrap"))).toHaveLength(1);

    await feedback.trigger("click");
    expect(wrapper.find('[data-testid="transfer-detail-feedback"]').exists()).toBe(false);
  });

  test("handover confirmation marks auto-allocation writes as own updates and keeps samples stored after one click", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    const savedWorkspace = { ...workspacePayload, allocationSaved: true };
    const staleConfirmedWorkspace = {
      ...savedWorkspace,
      task: {
        ...savedWorkspace.task,
        taskProgress: "已确认入库",
      },
      assignedTrays: savedWorkspace.assignedTrays.map((tray) => ({
        ...tray,
        trayStatus: "未入库",
        samples: tray.samples.map((sample) => ({ ...sample, sampleStatus: "未入库" })),
      })),
    };

    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate") && options.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: savedWorkspace }) };
      }
      if (url.includes("/api/transfer-area/tasks/101/confirm-storage") && options.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已确认入库", workspace: staleConfirmedWorkspace }) };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    const confirmButton = wrapper.findAll("button").find((button) => button.text() === "确认入库");
    await confirmButton.trigger("click");
    await settle(wrapper);
    await settle(wrapper);

    const allocateCall = fetch.mock.calls.find(([input]) => String(input).includes("/api/transfer-area/tasks/101/allocate"));
    const confirmCall = fetch.mock.calls.find(([input]) => String(input).includes("/api/transfer-area/tasks/101/confirm-storage"));
    expect(allocateCall?.[1]?.headers).toEqual(expect.objectContaining({
      "X-MES-Update-Source": "transfer-workbench",
      "X-MES-Update-Request-Id": expect.stringContaining("allocate"),
    }));
    expect(confirmCall?.[1]?.headers).toEqual(expect.objectContaining({
      "X-MES-Update-Source": "transfer-workbench",
      "X-MES-Update-Request-Id": expect.stringContaining("confirm-storage"),
    }));
    expect(wrapper.get('[data-testid="transfer-tray-card-0"]').text()).toContain("托盘状态 到货");
    expect(wrapper.get('[data-testid="transfer-tray-card-0"]').text()).toContain("到货");
  });

  test("pre-allocation mode allows printing barcodes after saving even before arrival", async () => {
    const bootstrapPayload = {
      taskOverview: [
        {
          taskId: 201,
          seq: 1,
          taskNo: "SYLU-2026-04-201",
          taskName: "中控新增任务",
          sampleCount: 2,
          taskType: "盐雾试验",
          experimentTypeText: "盐雾试验",
          receivedTime: "",
          taskStatus: "未入库",
          taskProgress: "待预接驳",
          sampleCodes: ["SYLU-2026-04-201-SP-001", "SYLU-2026-04-201-SP-002"],
          sampleCodesText: "SYLU-2026-04-201-SP-001 / SYLU-2026-04-201-SP-002",
        },
      ],
      pendingTaskCount: 1,
      storedTaskCount: 0,
    };
    const workspacePayload = {
      allocationSaved: false,
      task: {
        taskId: 201,
        taskNo: "SYLU-2026-04-201",
        taskName: "中控新增任务",
        taskType: "盐雾试验",
        experimentTypeText: "盐雾试验",
        taskStatus: "未入库",
        taskProgress: "待预接驳",
        receivedTime: "",
        trayLimit: 4,
        printedTrayCount: 0,
      },
      experiments: [
        { experimentCode: "SYLU-2026-04-201-A", experimentName: "盐雾试验", assignedTrayNos: ["SYLU-2026-04-201-TP-001"] },
      ],
      assignedTrays: [
        {
          trayId: 1001,
          trayNo: "SYLU-2026-04-201-TP-001",
          trayType: "标准托盘",
          trayStatus: "已预分配",
          capacity: 4,
          experimentLabels: ["盐雾试验"],
          experimentCodes: ["SYLU-2026-04-201-A"],
          samples: [
            { sampleId: "sample-201-1", sampleNo: "SYLU-2026-04-201-SP-001", sampleStatus: "未入库" },
            { sampleId: "sample-201-2", sampleNo: "SYLU-2026-04-201-SP-002", sampleStatus: "未入库" },
          ],
          barcode: null,
          barcodeData: null,
        },
      ],
      trayInventory: [],
    };
    const savedWorkspace = { ...workspacePayload, allocationSaved: true };
    const printedWorkspace = {
      ...savedWorkspace,
      assignedTrays: savedWorkspace.assignedTrays.map((tray) => ({
        ...tray,
        barcode: {
          barcodeId: 10001,
          objectId: tray.trayId,
          barcodeNo: tray.trayNo,
          barcodeType: "QRCODE",
          barcodeContent: `MES-TRAY:${tray.trayNo}`,
        },
      })),
    };

    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/201/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/201/allocate")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: savedWorkspace }) };
      }
      if (url.includes("/api/transfer-area/tasks/201/print-barcodes")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            message: "二维码已生成",
            barcodes: printedWorkspace.assignedTrays.map((tray) => tray.barcode),
            workspace: printedWorkspace,
          }),
        };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-201"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-print-barcodes"]').attributes("disabled")).toBeUndefined();

    await wrapper.get('[data-testid="transfer-print-barcodes"]').trigger("click");
    await settle(wrapper);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/transfer-area/tasks/201/print-barcodes"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("overview task type filter shows only atomic experiment types and matches tasks containing the selected type", async () => {
    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    const filter = wrapper.find(".transfer-overview-select");
    const optionTexts = filter.findAll("option").map((node) => node.text());
    expect(optionTexts).toContain("盐雾试验");
    expect(optionTexts).toContain("冲击试验");
    expect(optionTexts).toContain("振动试验");
    expect(optionTexts).not.toContain("盐雾试验 / 振动试验");
    expect(optionTexts).not.toContain("冲击试验 / 振动试验");

    await wrapper.get('[data-testid="transfer-filter-all"]').trigger("click");
    await settle(wrapper);

    await filter.setValue("振动试验");
    await settle(wrapper);

    const taskRows = wrapper.findAll('[data-testid^="transfer-task-row-"]');
    expect(taskRows).toHaveLength(2);
    expect(taskRows[0].text()).toContain("SYLU-2026-03-101");
    expect(taskRows[1].text()).toContain("SYLU-2026-03-102");
  });

  test("overview limits direct sample codes to twelve and opens all samples from the overflow button", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const allSampleCodes = Array.from({ length: 14 }, (_, index) =>
      `SYLU-2026-03-101-SP-${String(index + 1).padStart(3, "0")}`,
    );
    bootstrapPayload.taskOverview = [
      {
        ...bootstrapPayload.taskOverview[0],
        sampleCount: 14,
        sampleCodes: allSampleCodes.slice(0, 12),
        sampleCodePreview: allSampleCodes.slice(0, 12),
        sampleCodeSearchText: allSampleCodes.join(" "),
        sampleCodesText: "",
      },
    ];
    bootstrapPayload.pendingTaskCount = 1;
    bootstrapPayload.storedTaskCount = 0;

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    const row = wrapper.get('[data-testid="transfer-task-row-101"]');
    const visibleChips = row.findAll(".transfer-table__codes .transfer-sample-code-chip");
    expect(visibleChips).toHaveLength(12);
    expect(row.text()).toContain("SYLU-2026-03-101-SP-012");
    expect(row.text()).not.toContain("SYLU-2026-03-101-SP-013");
    expect(row.get('[data-testid="transfer-sample-code-overflow-101"]').text()).toBe("+2");

    await row.get('[data-testid="transfer-sample-code-overflow-101"]').trigger("click");
    await settle(wrapper);

    const modal = wrapper.get('[data-testid="transfer-sample-codes-modal"]');
    expect(modal.text()).toContain("SYLU-2026-03-101");
    expect(modal.findAll(".transfer-sample-code-chip")).toHaveLength(14);
    expect(modal.text()).toContain("SYLU-2026-03-101-SP-014");

    await wrapper.get(".search-input").setValue("SP-014");
    await settle(wrapper);

    expect(wrapper.find('[data-testid="transfer-task-row-101"]').exists()).toBe(true);
  });

  test("QR code preview uses the tray QR payload as the real scan value and compact summary copy", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    const printedWorkspace = {
      ...workspacePayload,
      allocationSaved: true,
      assignedTrays: workspacePayload.assignedTrays.map((tray) => ({
        ...tray,
        barcode: {
          barcodeId: 9000 + tray.trayId,
          objectId: tray.trayId,
          barcodeNo: tray.trayNo,
          barcodeType: "QRCODE",
          barcodeContent: `MES-TRAY:${tray.trayNo}`,
        },
      })),
    };

    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: { ...workspacePayload, allocationSaved: true } }) };
      }
      if (url.includes("/api/transfer-area/tasks/101/print-barcodes")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            message: "二维码已生成",
            barcodes: printedWorkspace.assignedTrays.map((tray) => tray.barcode),
            workspace: printedWorkspace,
          }),
        };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-print-barcodes"]').trigger("click");
    await settle(wrapper);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/transfer-area/tasks/101/print-barcodes"),
      expect.objectContaining({
        body: JSON.stringify({ barcodeType: "QRCODE" }),
        method: "POST",
      }),
    );
    expect(wrapper.get('[data-testid="barcode-modal"]').text()).toContain("二维码信息");
    expect(wrapper.get(".transfer-modal__barcode svg").attributes("aria-label")).toBe("MES-TRAY:SYLU-2026-03-101-TP-001");
    expect(wrapper.text()).toContain("内容：任务编号：SYLU-2026-03-101 | 样品数量：2");
    expect(wrapper.text()).toContain("样品编号：SYLU-2026-03-101-SP-001 / SYLU-2026-03-101-SP-002");
    expect(wrapper.text()).not.toContain("TRAY|TASK:");
  });

  test("barcode preview uses themed preview structure", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    const printedWorkspace = {
      ...workspacePayload,
      allocationSaved: true,
      assignedTrays: workspacePayload.assignedTrays.map((tray) => ({
        ...tray,
        barcode: {
          barcodeId: 9100 + tray.trayId,
          objectId: tray.trayId,
          barcodeNo: tray.trayNo,
          barcodeType: "QRCODE",
          barcodeContent: `MES-TRAY:${tray.trayNo}`,
        },
      })),
    };

    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: { ...workspacePayload, allocationSaved: true } }) };
      }
      if (url.includes("/api/transfer-area/tasks/101/print-barcodes")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            message: "二维码已生成",
            barcodes: printedWorkspace.assignedTrays.map((tray) => tray.barcode),
            workspace: printedWorkspace,
          }),
        };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-print-barcodes"]').trigger("click");
    await settle(wrapper);

    const modal = wrapper.get('[data-testid="barcode-modal"]');
    expect(modal.classes()).toContain("transfer-barcode-preview-modal");
    expect(modal.find(".transfer-barcode-preview-summary").exists()).toBe(true);
    expect(modal.find(".transfer-barcode-preview-card").exists()).toBe(true);
    expect(modal.find(".transfer-barcode-preview-meta").exists()).toBe(true);
    expect(modal.find(".transfer-barcode-preview-samples").exists()).toBe(true);
    expect(modal.find(".transfer-barcode-preview-code").exists()).toBe(true);
    expect(modal.find(".transfer-barcode-preview-code").classes()).toContain("transfer-barcode-preview-code--themed");
  });

  test("barcode preview truncates long sample code lists after four codes", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const sampleCodes = Array.from({ length: 16 }, (_, index) => `SYLU-2026-05-001-SP-${String(index + 1).padStart(3, "0")}`);
    const workspacePayload = createWorkspacePayload();
    workspacePayload.task.taskNo = "SYLU-2026-05-001";
    workspacePayload.task.trayLimit = 16;
    workspacePayload.experiments = workspacePayload.experiments.map((experiment) => ({
      ...experiment,
      assignedTrayNos: ["SYLU-2026-05-001-TP-001"],
    }));
    workspacePayload.assignedTrays = [
      {
        ...workspacePayload.assignedTrays[0],
        trayId: 501,
        trayNo: "SYLU-2026-05-001-TP-001",
        capacity: 16,
        experimentLabels: ["盐雾试验", "振动试验"],
        experimentCodes: ["SYLU-2026-03-101-A", "SYLU-2026-03-101-B"],
        samples: sampleCodes.map((sampleNo, index) => ({
          sampleId: index + 1,
          sampleNo,
          sampleStatus: "未入库",
        })),
      },
    ];
    const printedWorkspace = {
      ...workspacePayload,
      allocationSaved: true,
      assignedTrays: workspacePayload.assignedTrays.map((tray) => ({
        ...tray,
        barcode: {
          barcodeId: 9501,
          objectId: tray.trayId,
          barcodeNo: tray.trayNo,
          barcodeType: "QRCODE",
          barcodeContent: `MES-TRAY:${tray.trayNo}`,
        },
      })),
    };

    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: { ...workspacePayload, allocationSaved: true } }) };
      }
      if (url.includes("/api/transfer-area/tasks/101/print-barcodes")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            message: "二维码已生成",
            barcodes: printedWorkspace.assignedTrays.map((tray) => tray.barcode),
            workspace: printedWorkspace,
          }),
        };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-print-barcodes"]').trigger("click");
    await settle(wrapper);

    const modalText = wrapper.get('[data-testid="barcode-modal"]').text();
    expect(modalText).toContain("样品数：16");
    expect(modalText).toContain("SYLU-2026-05-001-SP-004 / ...");
    expect(modalText).not.toContain("SYLU-2026-05-001-SP-005");
  });

  test("started stored tasks stay visible and block re-entry in pre-allocation mode", async () => {
    const bootstrapPayload = createBootstrapPayload();
    bootstrapPayload.taskOverview[1] = {
      ...bootstrapPayload.taskOverview[1],
      taskProgress: "实验进行中",
    };
    const startedStoredWorkspace = createStartedStoredWorkspace();

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/102/workspace")) {
        return { ok: true, status: 200, json: async () => startedStoredWorkspace };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(TransferWorkbench, {
      props: {
        embedded: true,
        mode: "pre-allocation",
        showHeader: false,
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-filter-stored"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102");
    expect(wrapper.text()).toContain("实验进行中");

    await wrapper.get('[data-testid="transfer-task-row-102"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102-TP-001");
    expect(wrapper.text()).toContain("SYLU-2026-03-102-SP-001");
    expect(wrapper.text()).not.toContain("该任务已有托盘开始实验，不能重新分配。");
    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeUndefined();
    expect(wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)").attributes("disabled")).toBeDefined();
  });

  test("confirmation locks conflicting controls and reports save and storage phases", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    const savedWorkspace = { ...workspacePayload, allocationSaved: true };
    const confirmedWorkspace = {
      ...savedWorkspace,
      task: {
        ...savedWorkspace.task,
        taskStatus: "到货",
        taskProgress: "已确认入库",
      },
      assignedTrays: savedWorkspace.assignedTrays.map((tray) => ({
        ...tray,
        trayStatus: "到货",
        samples: tray.samples.map((sample) => ({ ...sample, sampleStatus: "到货" })),
      })),
    };
    let resolveAllocation;
    let resolveConfirmation;
    const allocationResponse = new Promise((resolve) => {
      resolveAllocation = resolve;
    });
    const confirmationResponse = new Promise((resolve) => {
      resolveConfirmation = resolve;
    });

    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspacePayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate") && options.method === "POST") {
        return allocationResponse;
      }
      if (url.includes("/api/transfer-area/tasks/101/confirm-storage") && options.method === "POST") {
        return confirmationResponse;
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, { props: { mode: "handover" } });
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-confirm-storage"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-storage-progress"]').text()).toContain("正在保存托盘分配（1/2）");
    expect(wrapper.get('[data-testid="transfer-confirm-storage"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-save-trays"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-reset-workspace"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-assign-all-experiments"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-A"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="handover-nav-dispatch"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get(".transfer-detail-shell__top .action-btn").attributes("disabled")).toBeDefined();

    await wrapper.get('[data-testid="transfer-confirm-storage"]').trigger("click");
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/allocate"))).toHaveLength(1);
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/confirm-storage"))).toHaveLength(0);

    resolveAllocation({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: "托盘分配已保存", workspace: savedWorkspace }),
    });
    await settle(wrapper);
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-storage-progress"]').text()).toContain("正在确认入库（2/2）");
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/confirm-storage"))).toHaveLength(1);
    expect(wrapper.get('[data-testid="transfer-tray-limit-input"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-tray-card-0"] .sample-tray-sample-tag').attributes("disabled")).toBeDefined();

    resolveConfirmation({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: "任务已确认入库", workspace: confirmedWorkspace }),
    });
    await settle(wrapper);

    expect(wrapper.find('[data-testid="transfer-storage-progress"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="transfer-detail-feedback"]').text()).toContain("任务已确认入库");
    expect(wrapper.get('[data-testid="transfer-tray-card-0"]').text()).toContain("托盘状态 到货");
  });

  test("confirmation failure releases the operation lock", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const savedWorkspace = { ...createWorkspacePayload(), allocationSaved: true };
    let resolveConfirmation;
    const confirmationResponse = new Promise((resolve) => {
      resolveConfirmation = resolve;
    });

    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => savedWorkspace };
      }
      if (url.includes("/api/transfer-area/tasks/101/confirm-storage") && options.method === "POST") {
        return confirmationResponse;
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    }));

    const wrapper = mount(TransferWorkbench, { props: { mode: "handover" } });
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-print-barcodes"]').attributes("disabled")).toBeUndefined();
    await wrapper.get('[data-testid="transfer-confirm-storage"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.get('[data-testid="transfer-storage-progress"]').text()).toContain("正在确认入库");
    expect(wrapper.get('[data-testid="transfer-print-barcodes"]').attributes("disabled")).toBeDefined();

    resolveConfirmation({
      ok: false,
      status: 500,
      json: async () => ({ message: "确认入库失败，请稍后重试" }),
    });
    await settle(wrapper);

    expect(wrapper.find('[data-testid="transfer-storage-progress"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="transfer-confirm-storage"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-testid="transfer-print-barcodes"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-testid="transfer-detail-feedback"]').text()).toContain("确认入库失败，请稍后重试");
    expect(wrapper.get('[data-testid="transfer-detail-feedback"]').classes()).toContain("app-feedback--error");
  });
});
