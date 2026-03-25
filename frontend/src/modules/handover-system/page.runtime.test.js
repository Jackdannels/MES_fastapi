import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import TransferAreaPage from "./page.vue";

const {
  routerPush,
  routerReplace,
  logoutSessionMock,
  switchSessionModuleMock,
  printFrameDocumentWriteMock,
  printFrameDocumentCloseMock,
  printFramePrintMock,
  printFrameFocusMock,
} = vi.hoisted(() => ({
  routerPush: vi.fn(() => Promise.resolve()),
  routerReplace: vi.fn(),
  logoutSessionMock: vi.fn(() => Promise.resolve()),
  switchSessionModuleMock: vi.fn(async (moduleKey) => ({ ok: true, module: moduleKey })),
  printFrameDocumentWriteMock: vi.fn(),
  printFrameDocumentCloseMock: vi.fn(),
  printFramePrintMock: vi.fn(),
  printFrameFocusMock: vi.fn(),
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
      taskNo: "JB-2026-101",
      taskName: "连接器批次 A",
      sampleCount: 4,
      taskType: "盐雾试验 / 振动试验",
      experimentTypeText: "盐雾试验 / 振动试验",
      receivedTime: "2026-03-21 10:20",
      taskStatus: "未入库",
      taskProgress: "样品已送达，待打印条形码",
      sampleCodes: ["JB-2026-101-SP-001", "JB-2026-101-SP-002", "JB-2026-101-SP-003", "JB-2026-101-SP-004"],
      sampleCodesText: "JB-2026-101-SP-001 / JB-2026-101-SP-002 / JB-2026-101-SP-003 / JB-2026-101-SP-004",
    },
    {
      taskId: 102,
      seq: 2,
      taskNo: "JB-2026-102",
      taskName: "线束批次 E",
      sampleCount: 2,
      taskType: "耐久试验 / 通电试验",
      experimentTypeText: "耐久试验 / 通电试验",
      receivedTime: "2026-03-19 09:10",
      taskStatus: "已入库",
      taskProgress: "已确认入库",
      sampleCodes: ["JB-2026-102-SP-001", "JB-2026-102-SP-002"],
      sampleCodesText: "JB-2026-102-SP-001 / JB-2026-102-SP-002",
    },
  ],
  pendingTaskCount: 1,
  storedTaskCount: 1,
});

const createWorkspacePayload = () => ({
  allocationSaved: false,
  task: {
    taskId: 101,
    taskNo: "JB-2026-101",
    taskName: "连接器批次 A",
    taskType: "盐雾试验 / 振动试验",
    experimentTypeText: "盐雾试验 / 振动试验",
    taskStatus: "未入库",
    taskProgress: "样品已送达，待打印条形码",
    receivedTime: "2026-03-21 10:20",
    trayLimit: 2,
    printedTrayCount: 0,
  },
  assignedTrays: [
    {
      trayId: 201,
      trayNo: "JB-2026-101-TP-001",
      trayType: "标准托盘",
      trayStatus: "已预分配",
      capacity: 2,
      samples: [
        { sampleId: 1, sampleNo: "JB-2026-101-SP-001", sampleStatus: "未入库" },
        { sampleId: 2, sampleNo: "JB-2026-101-SP-002", sampleStatus: "未入库" },
      ],
      barcode: null,
      barcodeData: null,
    },
    {
      trayId: 202,
      trayNo: "JB-2026-101-TP-002",
      trayType: "标准托盘",
      trayStatus: "已预分配",
      capacity: 2,
      samples: [
        { sampleId: 3, sampleNo: "JB-2026-101-SP-003", sampleStatus: "未入库" },
        { sampleId: 4, sampleNo: "JB-2026-101-SP-004", sampleStatus: "未入库" },
      ],
      barcode: null,
      barcodeData: null,
    },
  ],
  trayInventory: [{ trayId: 203, trayNo: "STOCK-TP-003", trayType: "标准托盘", capacity: 2, currentTaskId: null }],
});

const createPrintedWorkspace = (workspacePayload) => ({
  ...workspacePayload,
  allocationSaved: true,
  task: { ...workspacePayload.task, taskProgress: "条形码已打印，待确认入库", printedTrayCount: 2 },
  assignedTrays: workspacePayload.assignedTrays.map((tray, index) => ({
    ...tray,
    trayStatus: "待入库",
    barcode: {
      barcodeId: 901 + index,
      objectId: tray.trayId,
      barcodeNo: tray.trayNo,
      barcodeContent: `TRAY|TASK:JB-2026-101|TRAY:${tray.trayNo}|LOAD:${tray.samples.length}`,
    },
  })),
});

const createStoredWorkspace = (printedWorkspace) => ({
  ...printedWorkspace,
  allocationSaved: true,
  task: { ...printedWorkspace.task, taskStatus: "已入库", taskProgress: "已确认入库" },
  assignedTrays: printedWorkspace.assignedTrays.map((tray) => ({
    ...tray,
    trayStatus: "已入库",
    samples: tray.samples.map((sample) => ({ ...sample, sampleStatus: "已入库" })),
  })),
});

const createReloadedWorkspace = (workspacePayload) => ({
  ...workspacePayload,
  allocationSaved: true,
  task: { ...workspacePayload.task, taskStatus: "未入库", taskProgress: "样品已送达，待打印条形码", printedTrayCount: 0 },
  assignedTrays: workspacePayload.assignedTrays.map((tray) => ({
    ...tray,
    trayStatus: "已预分配",
    barcode: null,
    barcodeData: null,
    samples: tray.samples.map((sample) => ({ ...sample, sampleStatus: "未入库" })),
  })),
});

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

describe("TransferAreaPage runtime", () => {
  beforeEach(() => {
    const bootstrapPayload = createBootstrapPayload();
    const workspacePayload = createWorkspacePayload();
    const printedWorkspace = createPrintedWorkspace(workspacePayload);
    const storedWorkspace = createStoredWorkspace(printedWorkspace);
    const reloadedWorkspace = createReloadedWorkspace(workspacePayload);
    let workspaceState = workspacePayload;
    let allocateCount = 0;

    const fetchStub = vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => bootstrapPayload };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => workspaceState };
      }
      if (url.includes("/api/transfer-area/tasks/101/allocate")) {
        allocateCount += 1;
        workspaceState = { ...workspaceState, allocationSaved: true };
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: workspaceState }) };
      }
      if (url.includes("/api/transfer-area/tasks/101/print-barcodes")) {
        workspaceState = printedWorkspace;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            message: "条形码已生成",
            barcodes: printedWorkspace.assignedTrays.map((tray) => tray.barcode),
            workspace: printedWorkspace,
          }),
        };
      }
      if (url.includes("/api/transfer-area/tasks/101/confirm-storage")) {
        bootstrapPayload.taskOverview[0] = { ...bootstrapPayload.taskOverview[0], taskStatus: "已入库", taskProgress: "已确认入库" };
        bootstrapPayload.pendingTaskCount = 0;
        bootstrapPayload.storedTaskCount = 2;
        workspaceState = storedWorkspace;
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已确认入库", workspace: storedWorkspace }) };
      }
      if (url.includes("/api/transfer-area/tasks/101/reload")) {
        bootstrapPayload.taskOverview[0] = { ...bootstrapPayload.taskOverview[0], taskStatus: "未入库", taskProgress: "样品已送达，待打印条形码" };
        bootstrapPayload.pendingTaskCount = 1;
        bootstrapPayload.storedTaskCount = 1;
        workspaceState = reloadedWorkspace;
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已重新载装，已回到未入库列表", workspace: reloadedWorkspace }) };
      }
      throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
    });

    vi.stubGlobal("fetch", fetchStub);
    globalThis.__transferAreaAllocateCount = () => allocateCount;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.__transferAreaAllocateCount;
    routerPush.mockReset();
    routerReplace.mockReset();
    logoutSessionMock.mockClear();
    switchSessionModuleMock.mockClear();
    printFrameDocumentWriteMock.mockClear();
    printFrameDocumentCloseMock.mockClear();
    printFramePrintMock.mockClear();
    printFrameFocusMock.mockClear();
    vi.restoreAllMocks();
  });

  test("detail page shows compact task info", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("任务基本信息");
    expect(wrapper.text()).toContain("样品送达时间");
    expect(wrapper.text()).toContain("已打印托盘");
  });

  test("can click samples to swap positions and place one into another tray", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    await wrapper.get(".transfer-use-tray-btn").trigger("click");
    await settle(wrapper);
    expect(wrapper.findAll('[data-testid^="transfer-tray-card-"]')).toHaveLength(3);

    const tray0Samples = wrapper.get('[data-testid="transfer-tray-card-0"]').findAll(".sample-tray-sample-tag");
    const tray1Samples = wrapper.get('[data-testid="transfer-tray-card-1"]').findAll(".sample-tray-sample-tag");
    await tray0Samples[0].trigger("click");
    await tray1Samples[0].trigger("click");
    await settle(wrapper);

    const previewAfterSwap = wrapper.get('[data-testid="transfer-tray-preview"]').element.value;
    expect(previewAfterSwap).toContain("JB-2026-101-TP-001 | 2 / 2 | JB-2026-101-SP-002 / JB-2026-101-SP-003");
    expect(previewAfterSwap).toContain("JB-2026-101-TP-002 | 2 / 2 | JB-2026-101-SP-001 / JB-2026-101-SP-004");

    const refreshedTray0Samples = wrapper.get('[data-testid="transfer-tray-card-0"]').findAll(".sample-tray-sample-tag");
    await refreshedTray0Samples[1].trigger("click");
    await wrapper.get('[data-testid="transfer-tray-card-2"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-tray-preview"]').element.value).toContain("JB-2026-101-TP-003 | 1 / 2 | JB-2026-101-SP-003");
  });

  test("confirm storage marks samples stored and reload moves task back to pending list", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    const confirmButton = wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)");
    expect(confirmButton.attributes("disabled")).toBeDefined();

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(2)").trigger("click");
    await settle(wrapper);

    const allocateCountBeforeConfirm = globalThis.__transferAreaAllocateCount();

    expect(wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)").attributes("disabled")).toBeUndefined();

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)").trigger("click");
    await settle(wrapper);

    expect(globalThis.__transferAreaAllocateCount()).toBe(allocateCountBeforeConfirm);

    expect(wrapper.text()).toContain("任务已确认入库");
    expect(wrapper.text()).toContain("状态已入库");
    expect(wrapper.text()).toContain("JB-2026-101-SP-001已入库");
    const reloadButton = wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(4)");
    expect(reloadButton.attributes("disabled")).toBeUndefined();

    await reloadButton.trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("状态未入库");
    expect(wrapper.text()).toContain("JB-2026-101-SP-001未入库");

    await wrapper.get(".transfer-detail-shell__top .action-btn.secondary").trigger("click");
    await settle(wrapper);

    expect(wrapper.find(".transfer-overview-status-actions .is-active").text()).toContain("未入库");
    expect(wrapper.text()).toContain("JB-2026-101");
    expect(wrapper.text()).toContain("样品已送达，待打印条形码");
  });

  test("overview status filter switches between pending and stored tasks", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("JB-2026-101");
    expect(wrapper.text()).not.toContain("JB-2026-102");

    await wrapper.get(".transfer-overview-status-actions button:nth-child(2)").trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("JB-2026-102");
    expect(wrapper.text()).not.toContain("JB-2026-101");
  });

  test("opens the shared exit dialog from the in-page logout action", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-logout"]').trigger("click");
    await Promise.resolve();

    expect(wrapper.text()).toContain("切换其他界面");
    expect(logoutSessionMock).not.toHaveBeenCalled();
  });

  test("switches modules from the exit dialog without logging out", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-logout"]').trigger("click");
    await wrapper.get('[data-testid="module-exit-select"]').setValue("central");
    await wrapper.get('[data-testid="module-exit-switch"]').trigger("click");
    await Promise.resolve();

    expect(logoutSessionMock).not.toHaveBeenCalled();
    expect(switchSessionModuleMock).toHaveBeenCalledWith("central");
    expect(routerPush).toHaveBeenCalledWith("/");
  });

  test("full logout from the exit dialog routes back to login after logout", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-logout"]').trigger("click");
    await wrapper.get('[data-testid="module-exit-logout"]').trigger("click");
    await Promise.resolve();

    expect(logoutSessionMock).toHaveBeenCalledTimes(1);
    expect(routerReplace).toHaveBeenCalledWith("/login");
  });

  test("confirming barcode print triggers the browser print flow", async () => {
    const originalCreateElement = document.createElement.bind(document);
    const iframe = originalCreateElement("iframe");
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: {
        open: vi.fn(),
        write: printFrameDocumentWriteMock,
        close: printFrameDocumentCloseMock,
      },
    });
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: {
        focus: printFrameFocusMock,
        print: printFramePrintMock,
      },
    });
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      if (String(tagName).toLowerCase() === "iframe") {
        return iframe;
      }
      return originalCreateElement(tagName, options);
    });

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(2)").trigger("click");
    await settle(wrapper);

    await wrapper.get(".transfer-print-all-btn").trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="barcode-modal-confirm-print"]').trigger("click");
    await settle(wrapper);

    expect(printFrameDocumentWriteMock).toHaveBeenCalled();
    expect(printFramePrintMock).toHaveBeenCalledTimes(1);
  });

  test("changing tray limit rebalances samples into the minimum tray count in sequence", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-tray-limit-input"]').setValue("4");
    await wrapper.get('[data-testid="transfer-tray-limit-input"]').trigger("change");
    await settle(wrapper);

    expect(wrapper.findAll('[data-testid^="transfer-tray-card-"]')).toHaveLength(1);
    expect(wrapper.get('[data-testid="transfer-tray-preview"]').element.value).toContain(
      "JB-2026-101-TP-001 | 4 / 4 | JB-2026-101-SP-001 / JB-2026-101-SP-002 / JB-2026-101-SP-003 / JB-2026-101-SP-004",
    );
  });

  test("saved allocations restart tray numbering from TP-001 after redistribution", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const savedWorkspace = {
      ...createWorkspacePayload(),
      allocationSaved: true,
      assignedTrays: [
        {
          trayId: 1002,
          trayNo: "JB-2026-101-TP-002",
          trayType: "标准托盘",
          trayStatus: "已预分配",
          capacity: 2,
          samples: [
            { sampleId: 1, sampleNo: "JB-2026-101-SP-001", sampleStatus: "未入库" },
            { sampleId: 2, sampleNo: "JB-2026-101-SP-002", sampleStatus: "未入库" },
          ],
          barcode: null,
          barcodeData: null,
        },
        {
          trayId: 1003,
          trayNo: "JB-2026-101-TP-003",
          trayType: "标准托盘",
          trayStatus: "已预分配",
          capacity: 2,
          samples: [
            { sampleId: 3, sampleNo: "JB-2026-101-SP-003", sampleStatus: "未入库" },
            { sampleId: 4, sampleNo: "JB-2026-101-SP-004", sampleStatus: "未入库" },
          ],
          barcode: null,
          barcodeData: null,
        },
      ],
      trayInventory: [{ trayId: 203, trayNo: "STOCK-TP-004", trayType: "标准托盘", capacity: 2, currentTaskId: null }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => savedWorkspace };
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-tray-limit-input"]').setValue("4");
    await wrapper.get('[data-testid="transfer-tray-limit-input"]').trigger("change");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-tray-preview"]').element.value).toContain("JB-2026-101-TP-001");
    expect(wrapper.get('[data-testid="transfer-tray-preview"]').element.value).not.toContain("JB-2026-101-TP-003");
  });

  test("deleting a non-empty tray rebalances samples instead of blocking deletion", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    await wrapper.get(".transfer-use-tray-btn").trigger("click");
    await settle(wrapper);

    const tray0Samples = wrapper.get('[data-testid="transfer-tray-card-0"]').findAll(".sample-tray-sample-tag");
    await tray0Samples[1].trigger("click");
    await wrapper.get('[data-testid="transfer-tray-card-2"]').trigger("click");
    await settle(wrapper);

    const removeButtons = wrapper.findAll(".sample-tray-remove");
    expect(removeButtons[2].attributes("disabled")).toBeUndefined();

    await removeButtons[2].trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll('[data-testid^="transfer-tray-card-"]')).toHaveLength(2);
    expect(wrapper.get('[data-testid="transfer-tray-preview"]').element.value).not.toContain("JB-2026-101-TP-003");
    expect(wrapper.get('[data-testid="transfer-tray-preview"]').element.value).toContain("JB-2026-101-SP-001");
    expect(wrapper.get('[data-testid="transfer-tray-preview"]').element.value).toContain("JB-2026-101-SP-004");
  });

  test("deleting when current tray count is already minimal shows a clear warning", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    const removeButtons = wrapper.findAll(".sample-tray-remove");
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons[0].attributes("disabled")).toBeUndefined();

    await removeButtons[0].trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("当前托盘数量已是最小值，不能继续删除。");
    expect(wrapper.findAll('[data-testid^="transfer-tray-card-"]')).toHaveLength(2);
  });

  test("saving trays is enough to enable confirm storage", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    const confirmButton = wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)");
    expect(confirmButton.attributes("disabled")).toBeDefined();
    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeDefined();

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(2)").trigger("click");
    await settle(wrapper);

    expect(wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(2)").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)").attributes("disabled")).toBeUndefined();
    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeUndefined();
  });

  test("stored tasks still allow printing while tray editing remains disabled", async () => {
    const originalCreateElement = document.createElement.bind(document);
    const iframe = originalCreateElement("iframe");
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: {
        open: vi.fn(),
        write: printFrameDocumentWriteMock,
        close: printFrameDocumentCloseMock,
      },
    });
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: {
        focus: printFrameFocusMock,
        print: printFramePrintMock,
      },
    });
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      if (String(tagName).toLowerCase() === "iframe") {
        return iframe;
      }
      return originalCreateElement(tagName, options);
    });

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);
    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(2)").trigger("click");
    await settle(wrapper);
    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)").trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("状态已入库");
    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeUndefined();
    expect(wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(2)").attributes("disabled")).toBeDefined();
    expect(wrapper.findAll(".sample-tray-remove")[0].attributes("disabled")).toBeDefined();

    await wrapper.get(".transfer-print-all-btn").trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="barcode-modal-confirm-print"]').trigger("click");
    await settle(wrapper);

    expect(printFramePrintMock).toHaveBeenCalledTimes(1);
  });

  test("detail footer action uses the renamed re-entry label", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("重新入库");
    expect(wrapper.text()).not.toContain("重新载入");
  });

  test("shows empty-state guidance when no tasks match the default pending filter", async () => {
    const storedOnlyPayload = createBootstrapPayload();
    storedOnlyPayload.taskOverview = [storedOnlyPayload.taskOverview[1]];
    storedOnlyPayload.pendingTaskCount = 0;
    storedOnlyPayload.storedTaskCount = 1;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => storedOnlyPayload };
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("当前筛选条件下没有任务");
    expect(wrapper.text()).toContain("切换到已入库或全部视图");

    await wrapper.get('[data-testid="transfer-empty-show-stored"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("JB-2026-102");
    expect(wrapper.text()).not.toContain("当前筛选条件下没有任务");
  });

  test("shows bootstrap load errors instead of a silent empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: false, status: 500, json: async () => ({ detail: "数据库连接失败" }) };
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("接驳任务加载失败");
    expect(wrapper.text()).toContain("数据库连接失败");
  });

  test("shows a clear tray shortage warning and blocks repartition save when no system trays are available", async () => {
    const shortageWorkspace = {
      ...createWorkspacePayload(),
      task: {
        ...createWorkspacePayload().task,
        trayLimit: 2,
        maxAssignableTrayCount: 0,
        trayCapacityExceeded: true,
        trayCapacityMessage: "系统剩余托盘不足，当前最多可分配 0 个托盘。",
      },
      trayInventory: [],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => createBootstrapPayload() };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => shortageWorkspace };
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("系统剩余托盘不足，当前最多可分配 0 个托盘。");
    expect(wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(2)").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)").attributes("disabled")).toBeDefined();
  });
});
