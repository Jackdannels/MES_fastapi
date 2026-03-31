import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import TransferWorkbench from "./TransferWorkbench.vue";

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
      taskProgress: "样品已送达，待打印条形码",
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
      taskStatus: "已入库",
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
    taskProgress: "样品已送达，待打印条形码",
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
    taskStatus: "已入库",
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
      trayStatus: "已入库",
      capacity: 2,
      experimentLabels: ["冲击试验"],
      experimentCodes: ["SYLU-2026-03-102-A"],
      samples: [
        { sampleId: 11, sampleNo: "SYLU-2026-03-102-SP-001", sampleStatus: "已入库" },
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
    trayStatus: "已入库",
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
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "条形码已生成", barcodes: [], workspace: pendingWorkspace }) };
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
    expect(actionTexts).toEqual(["任务总览", "样品出库", "退出登录"]);
    expect(wrapper.get('[data-testid="handover-nav-overview"]').classes()).toContain("is-active");
    expect(wrapper.find('[data-testid="transfer-dispatch-panel"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("总任务清单");

    await wrapper.get('[data-testid="handover-nav-dispatch"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="handover-nav-dispatch"]').classes()).toContain("is-active");
    expect(wrapper.find('[data-testid="transfer-dispatch-panel"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("请扫描托盘条码");

    await wrapper.get('[data-testid="handover-nav-overview"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="handover-nav-overview"]').classes()).toContain("is-active");
    expect(wrapper.find('[data-testid="transfer-dispatch-panel"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("总任务清单");
  });

  test("handover dispatch view scans a tray, shows preferred destinations, and submits dispatch", async () => {
    const wrapper = mount(TransferWorkbench, {
      props: {
        mode: "handover",
      },
    });
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-nav-dispatch"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-dispatch-panel"]').exists()).toBe(true);
    await wrapper.get('[data-testid="transfer-dispatch-scan-input"]').setValue("SYLU-2026-03-102-TP-001");
    await wrapper.get('[data-testid="transfer-dispatch-scan-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102-TP-001");
    expect(wrapper.text()).toContain("恒温恒湿间（暂存间）");
    expect(wrapper.text()).toContain("振动一室");
    expect(wrapper.text()).toContain("优先送达");

    await wrapper.get('[data-testid="transfer-dispatch-destination-1"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-102-TP-001已标记为送至实验室");
    expect(wrapper.text()).toContain("当前状态：送至实验室");
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

    expect(wrapper.text()).toContain("样品预分装");
    expect(wrapper.get(".transfer-overview-page-title").classes()).toContain("transfer-overview-page-title--compact");
    expect(wrapper.text()).toContain("未入库");
    expect(wrapper.text()).toContain("已入库");
    expect(wrapper.text()).toContain("全部");
    expect(wrapper.text()).not.toContain("确认入库");

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("支持鼠标拖拽样品到托盘");
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
});
