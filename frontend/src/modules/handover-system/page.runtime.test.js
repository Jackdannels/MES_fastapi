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
      taskNo: "SYLU-2026-03-101",
      taskName: "连接器批次 A",
      sampleCount: 4,
      taskType: "盐雾试验 / 振动试验",
      experimentTypeText: "盐雾试验 / 振动试验",
      receivedTime: "2026-03-21 10:20",
      taskStatus: "未入库",
      taskProgress: "样品已送达，待打印二维码",
      sampleCodes: ["SYLU-2026-03-101-SP-001", "SYLU-2026-03-101-SP-002", "SYLU-2026-03-101-SP-003", "SYLU-2026-03-101-SP-004"],
      sampleCodesText: "SYLU-2026-03-101-SP-001 / SYLU-2026-03-101-SP-002 / SYLU-2026-03-101-SP-003 / SYLU-2026-03-101-SP-004",
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
      taskStatus: "到货",
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
  assignedTrays: [
    {
      trayId: 201,
      trayNo: "SYLU-2026-03-101-TP-001",
      trayType: "标准托盘",
      trayStatus: "已预分配",
      capacity: 2,
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
      samples: [
        { sampleId: 3, sampleNo: "SYLU-2026-03-101-SP-003", sampleStatus: "未入库" },
        { sampleId: 4, sampleNo: "SYLU-2026-03-101-SP-004", sampleStatus: "未入库" },
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
  task: { ...workspacePayload.task, taskProgress: "二维码已打印，待确认入库", printedTrayCount: 2 },
  assignedTrays: workspacePayload.assignedTrays.map((tray, index) => ({
    ...tray,
    trayStatus: "待入库",
    barcode: {
      barcodeId: 901 + index,
      objectId: tray.trayId,
      barcodeNo: tray.trayNo,
      barcodeType: "QRCODE",
      barcodeContent: `MES-TRAY:${tray.trayNo}`,
    },
  })),
});

const createStoredWorkspace = (printedWorkspace) => ({
  ...printedWorkspace,
  allocationSaved: true,
  task: { ...printedWorkspace.task, taskStatus: "到货", taskProgress: "已确认入库" },
  assignedTrays: printedWorkspace.assignedTrays.map((tray) => ({
    ...tray,
    trayStatus: "到货",
    samples: tray.samples.map((sample) => ({ ...sample, sampleStatus: "到货" })),
  })),
});

const createReloadedWorkspace = (workspacePayload) => ({
  ...workspacePayload,
  allocationSaved: false,
  task: { ...workspacePayload.task, taskStatus: "未入库", taskProgress: "样品已送达，待打印二维码", printedTrayCount: 0 },
  experiments: Array.isArray(workspacePayload.experiments)
    ? workspacePayload.experiments.map((experiment) => ({
        ...experiment,
        assignedTrayNos: [],
        assignedTrayCount: 0,
      }))
    : [],
  assignedTrays: workspacePayload.assignedTrays.map((tray) => ({
    ...tray,
    trayStatus: "已预分配",
    barcode: null,
    barcodeData: null,
    experimentLabels: [],
    experimentCodes: [],
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
            message: "二维码已生成",
            barcodes: printedWorkspace.assignedTrays.map((tray) => tray.barcode),
            workspace: printedWorkspace,
          }),
        };
      }
      if (url.includes("/api/transfer-area/tasks/101/confirm-storage")) {
        bootstrapPayload.taskOverview[0] = { ...bootstrapPayload.taskOverview[0], taskStatus: "到货", taskProgress: "已确认入库" };
        bootstrapPayload.pendingTaskCount = 0;
        bootstrapPayload.storedTaskCount = 2;
        workspaceState = storedWorkspace;
        return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已确认入库", workspace: storedWorkspace }) };
      }
      if (url.includes("/api/transfer-area/tasks/101/reload")) {
        bootstrapPayload.taskOverview[0] = { ...bootstrapPayload.taskOverview[0], taskStatus: "未入库", taskProgress: "样品已送达，待打印二维码" };
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

    expect(wrapper.text()).toContain("任务编号");
    expect(wrapper.text()).toContain("SYLU-2026-03-101");
    expect(wrapper.text()).not.toContain("样品送达时间");
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

    const previewAfterSwap = wrapper.get('[data-testid="transfer-tray-preview"]').text();
    const previewTrayCodes = wrapper.findAll('[data-testid="transfer-tray-preview"] .transfer-tray-preview__code').map((node) => node.text());
    expect(previewTrayCodes).toContain("SYLU-2026-03-101-TP-001");
    expect(previewTrayCodes).toContain("SYLU-2026-03-101-TP-002");
    expect(previewAfterSwap).toContain("SYLU-2026-03-101-TP-001 | 2 / 2 | SYLU-2026-03-101-SP-002 / SYLU-2026-03-101-SP-003");
    expect(previewAfterSwap).toContain("SYLU-2026-03-101-TP-002 | 2 / 2 | SYLU-2026-03-101-SP-001 / SYLU-2026-03-101-SP-004");

    const refreshedTray0Samples = wrapper.get('[data-testid="transfer-tray-card-0"]').findAll(".sample-tray-sample-tag");
    await refreshedTray0Samples[1].trigger("click");
    await wrapper.get('[data-testid="transfer-tray-card-2"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-tray-preview"]').text()).toContain("SYLU-2026-03-101-TP-003");
  });

  test("touch-first flow supports selecting a target tray before tapping a sample", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    await wrapper.get(".transfer-use-tray-btn").trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-tray-card-2"]').trigger("click");
    await settle(wrapper);

    const tray0Samples = wrapper.get('[data-testid="transfer-tray-card-0"]').findAll(".sample-tray-sample-tag");
    await tray0Samples[0].trigger("click");
    await settle(wrapper);

    const previewText = wrapper.get('[data-testid="transfer-tray-preview"]').text();
    expect(previewText).toContain("SYLU-2026-03-101-TP-003");
    expect(previewText).toContain("SYLU-2026-03-101-SP-001");
    expect(previewText).toContain("SYLU-2026-03-101-TP-001");
    expect(previewText).toContain("SYLU-2026-03-101-SP-002");
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

    await wrapper.get('[data-testid="transfer-tray-card-1"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.findAll(".transfer-tray-card.is-active")).toHaveLength(0);
    expect(wrapper.get('[data-testid="transfer-locked-operation-hint"]').text()).toBe("托盘已保存，若想更改请重新入库");

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)").trigger("click");
    await settle(wrapper);

    expect(globalThis.__transferAreaAllocateCount()).toBe(allocateCountBeforeConfirm);

    expect(wrapper.text()).toContain("任务已确认入库");
    expect(wrapper.text()).toContain("SYLU-2026-03-101-SP-001到货");
    const reloadButton = wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(4)");
    expect(reloadButton.attributes("disabled")).toBeUndefined();

    await reloadButton.trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-101-SP-001未入库");
    expect(wrapper.findAll(".transfer-tray-experiment-tag")).toHaveLength(0);
    expect(wrapper.findAll(".transfer-tray-card.is-active")).toHaveLength(0);

    await wrapper.get(".transfer-detail-shell__top .action-btn.secondary").trigger("click");
    await settle(wrapper);

    expect(wrapper.find(".transfer-overview-status-actions .is-active").text()).toContain("未入库");
    expect(wrapper.text()).toContain("SYLU-2026-03-101");
    expect(wrapper.text()).toContain("样品已送达，待打印二维码");
  });

  test("overview status filter switches between pending and stored tasks", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-101");
    expect(wrapper.text()).not.toContain("JB-2026-102");

    await wrapper.get(".transfer-overview-status-actions button:nth-child(2)").trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("JB-2026-102");
    expect(wrapper.text()).not.toContain("SYLU-2026-03-101");
  });

  test("opens the shared exit dialog from the in-page logout action", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="handover-logout"]').trigger("click");
    await Promise.resolve();

    expect(wrapper.text()).toContain("切换其他界面");
    expect(logoutSessionMock).not.toHaveBeenCalled();
  });

  test("renders handover top nav buttons before the logout action", async () => {
    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);

    const actionTexts = wrapper.findAll(".transfer-system-actions .action-btn").map((button) => button.text());

    expect(actionTexts).toEqual(["任务总览", "样品出库", "出错样品处理", "退出登录"]);
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

  test("printed QR code document uses the tray QR payload in SVG markup", async () => {
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

    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);

    await wrapper.get(".transfer-print-all-btn").trigger("click");
    await settle(wrapper);

    const previewSvgLabel = wrapper.get(".transfer-modal__barcode svg").attributes("aria-label");

    await wrapper.get('[data-testid="barcode-modal-confirm-print"]').trigger("click");
    await settle(wrapper);

    const printedHtml = printFrameDocumentWriteMock.mock.calls.at(-1)?.[0] || "";

    expect(printedHtml).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(printedHtml).toContain("<path");
    expect(printedHtml).toContain('class="print-card-body"');
    expect(printedHtml).toContain('class="print-qr-panel"');
    expect(printedHtml).toContain('class="print-info-panel"');
    expect(printedHtml).toContain(".print-barcode svg { width: 220px; height: 220px;");
    expect(printedHtml).toContain("@media screen and (max-width: 680px)");
    expect(printedHtml).not.toContain("<h1>");
    expect(printedHtml).not.toContain(`<p>${createWorkspacePayload().task.taskNo}`);
    expect(previewSvgLabel).toBe("MES-TRAY:SYLU-2026-03-101-TP-001");
    expect(printedHtml).toContain('aria-label="MES-TRAY:SYLU-2026-03-101-TP-001"');
    expect(printedHtml).toContain("<span>内容</span>");
    expect(printedHtml).toContain("<strong>任务编号：SYLU-2026-03-101 | 样品数量：2</strong>");
    expect(printedHtml).toContain("<span>样品编号</span>");
    expect(printedHtml).toContain("<strong>SYLU-2026-03-101-SP-001 / SYLU-2026-03-101-SP-002</strong>");
  });

  test("barcode preview and print document keep experiment tag colors aligned with tray selection", async () => {
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

    const bootstrapPayload = createBootstrapPayload();
    const workspaceWithExperimentAssignments = {
      ...createWorkspacePayload(),
      allocationSaved: true,
      experiments: [
        {
          experimentCode: "SYLU-2026-03-101-A",
          experimentName: "温度冲击试验",
          assignedTrayNos: ["SYLU-2026-03-101-TP-001"],
          assignedTrayCount: 1,
        },
        {
          experimentCode: "SYLU-2026-03-101-B",
          experimentName: "冲击试验",
          assignedTrayNos: ["SYLU-2026-03-101-TP-001"],
          assignedTrayCount: 1,
        },
        {
          experimentCode: "SYLU-2026-03-101-C",
          experimentName: "振动试验",
          assignedTrayNos: ["SYLU-2026-03-101-TP-002"],
          assignedTrayCount: 1,
        },
      ],
    };
    const printedWorkspace = {
      ...workspaceWithExperimentAssignments,
      assignedTrays: workspaceWithExperimentAssignments.assignedTrays.map((tray, index) => ({
        ...tray,
        trayStatus: "待入库",
          barcode: {
            barcodeId: 980 + index,
            objectId: tray.trayId,
            barcodeNo: tray.trayNo,
            barcodeType: "QRCODE",
            barcodeContent: `MES-TRAY:${tray.trayNo}`,
          },
      })),
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => workspaceWithExperimentAssignments };
        }
        if (url.includes("/api/transfer-area/tasks/101/allocate")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, message: "托盘分配已保存", workspace: workspaceWithExperimentAssignments }),
          };
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
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    const trayTags = wrapper.get('[data-testid="transfer-tray-card-0"]').findAll(".transfer-tray-experiment-tag");
    expect(trayTags).toHaveLength(2);
    const selectedTrayTagClass = trayTags[0].attributes("class");

    await wrapper.get(".transfer-print-all-btn").trigger("click");
    await settle(wrapper);

    const modalTags = wrapper.get('[data-testid="barcode-modal"]').findAll(".transfer-tray-experiment-tag");
    expect(modalTags[0].attributes("class")).toBe(selectedTrayTagClass);

    await wrapper.get('[data-testid="barcode-modal-confirm-print"]').trigger("click");
    await settle(wrapper);

    const printedHtml = printFrameDocumentWriteMock.mock.calls.at(-1)?.[0] || "";
    expect(printedHtml).toContain("温度冲击试验");
    expect(printedHtml).toContain("--tray-experiment-color: #fca5a5;");
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
    expect(wrapper.get('[data-testid="transfer-tray-preview"]').text()).toContain(
      "SYLU-2026-03-101-TP-001 | 4 / 4 | SYLU-2026-03-101-SP-001 / SYLU-2026-03-101-SP-002 / SYLU-2026-03-101-SP-003 / SYLU-2026-03-101-SP-004",
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
          trayNo: "SYLU-2026-03-101-TP-002",
          trayType: "标准托盘",
          trayStatus: "已预分配",
          capacity: 2,
          samples: [
            { sampleId: 1, sampleNo: "SYLU-2026-03-101-SP-001", sampleStatus: "未入库" },
            { sampleId: 2, sampleNo: "SYLU-2026-03-101-SP-002", sampleStatus: "未入库" },
          ],
          barcode: null,
          barcodeData: null,
        },
        {
          trayId: 1003,
          trayNo: "SYLU-2026-03-101-TP-003",
          trayType: "标准托盘",
          trayStatus: "已预分配",
          capacity: 2,
          samples: [
            { sampleId: 3, sampleNo: "SYLU-2026-03-101-SP-003", sampleStatus: "未入库" },
            { sampleId: 4, sampleNo: "SYLU-2026-03-101-SP-004", sampleStatus: "未入库" },
          ],
          barcode: null,
          barcodeData: null,
        },
      ],
      trayInventory: [{ trayId: 203, trayNo: "STOCK-TP-004", trayType: "标准托盘", capacity: 2, currentTaskId: null }],
    };
    const editableWorkspace = {
      ...savedWorkspace,
      allocationSaved: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options = {}) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => savedWorkspace };
        }
        if (url.includes("/api/transfer-area/tasks/101/reload")) {
          expect(options.method).toBe("POST");
          return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已重新入库", workspace: editableWorkspace }) };
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(4)").trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-tray-limit-input"]').setValue("4");
    await wrapper.get('[data-testid="transfer-tray-limit-input"]').trigger("change");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-tray-preview"]').text()).toContain("SYLU-2026-03-101-TP-001");
    expect(wrapper.get('[data-testid="transfer-tray-preview"]').text()).not.toContain("SYLU-2026-03-101-TP-003");
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
    expect(wrapper.get('[data-testid="transfer-tray-preview"]').text()).not.toContain("SYLU-2026-03-101-TP-003");
    expect(wrapper.get('[data-testid="transfer-tray-preview"]').text()).toContain("SYLU-2026-03-101-SP-001");
    expect(wrapper.get('[data-testid="transfer-tray-preview"]').text()).toContain("SYLU-2026-03-101-SP-004");
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

  test("saved handover trays without experiment matching cannot be confirmed into storage", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspaceWithUnmatchedExperiments = {
      ...createWorkspacePayload(),
      allocationSaved: true,
      experiments: [
        {
          experimentCode: "SYLU-2026-03-101-A",
          experimentName: "盐雾试验",
          assignedTrayNos: [],
          assignedTrayCount: 0,
        },
        {
          experimentCode: "SYLU-2026-03-101-B",
          experimentName: "振动试验",
          assignedTrayNos: [],
          assignedTrayCount: 0,
        },
      ],
      assignedTrays: createWorkspacePayload().assignedTrays.map((tray) => ({
        ...tray,
        experimentLabels: [],
        experimentCodes: [],
      })),
    };
    const confirmStorageMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: "任务已确认入库", workspace: workspaceWithUnmatchedExperiments }),
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options = {}) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => workspaceWithUnmatchedExperiments };
        }
        if (url.includes("/api/transfer-area/tasks/101/confirm-storage")) {
          return confirmStorageMock(input, options);
        }
        throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-allocation-validation"]').text()).toBe("每个实验都必须至少分配一个托盘。");
    const confirmButton = wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)");
    expect(confirmButton.attributes("disabled")).toBeDefined();

    await confirmButton.trigger("click");
    await settle(wrapper);

    expect(confirmStorageMock).not.toHaveBeenCalled();
  });

  test("shows experiment types under the task number and returns to default edit mode from the task code or blank area", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspaceWithExperiments = {
      ...createWorkspacePayload(),
      task: {
        ...createWorkspacePayload().task,
        printedTrayCount: 0,
      },
      experiments: [
        {
          experimentCode: "SYLU-2026-03-101-A",
          experimentName: "盐雾试验",
          assignedTrayNos: [],
          assignedTrayCount: 0,
        },
        {
          experimentCode: "SYLU-2026-03-101-B",
          experimentName: "振动试验",
          assignedTrayNos: [],
          assignedTrayCount: 0,
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => workspaceWithExperiments };
        }
        if (url.includes("/api/transfer-area/tasks/101/allocate")) {
          return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: workspaceWithExperiments }) };
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-101");
    expect(wrapper.text()).toContain("盐雾试验");
    expect(wrapper.text()).toContain("振动试验");
    expect(wrapper.text()).not.toContain("任务托盘");
    expect(wrapper.get(".transfer-use-tray-btn").attributes("disabled")).toBeUndefined();

    await wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-A"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get(".transfer-use-tray-btn").attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-tray-limit-input"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-save-trays"]').attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("当前为 盐雾试验 托盘选择模式");

    await wrapper.get(".transfer-task-header__summary strong").trigger("click");
    await settle(wrapper);

    expect(wrapper.get(".transfer-use-tray-btn").attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-testid="transfer-tray-limit-input"]').attributes("disabled")).toBeUndefined();

    await wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-B"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get(".transfer-use-tray-btn").attributes("disabled")).toBeDefined();

    await wrapper.get(".transfer-detail-shell").trigger("click");
    await settle(wrapper);

    expect(wrapper.get(".transfer-use-tray-btn").attributes("disabled")).toBeUndefined();
  });

  test("experiment mode uses a check toggle and shows highlighted experiment labels below the tray title", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspaceWithExperimentAssignments = {
      ...createWorkspacePayload(),
      allocationSaved: true,
      experiments: [
        {
          experimentCode: "SYLU-2026-03-101-A",
          experimentName: "温度冲击",
          assignedTrayNos: ["SYLU-2026-03-101-TP-001"],
          assignedTrayCount: 1,
        },
        {
          experimentCode: "SYLU-2026-03-101-B",
          experimentName: "振动试验",
          assignedTrayNos: ["SYLU-2026-03-101-TP-002"],
          assignedTrayCount: 1,
        },
      ],
    };
    const editableWorkspace = {
      ...workspaceWithExperimentAssignments,
      allocationSaved: false,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options = {}) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => workspaceWithExperimentAssignments };
        }
        if (url.includes("/api/transfer-area/tasks/101/allocate")) {
          return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: workspaceWithExperimentAssignments }) };
        }
        if (url.includes("/api/transfer-area/tasks/101/reload")) {
          expect(options.method).toBe("POST");
          return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已重新入库", workspace: editableWorkspace }) };
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    const firstTray = wrapper.get('[data-testid="transfer-tray-card-0"]');
    const firstTrayTags = firstTray.findAll(".transfer-tray-experiment-tag");
    expect(firstTrayTags).toHaveLength(1);
    expect(firstTrayTags[0].text()).toBe("温度冲击");
    expect(firstTray.text()).not.toContain("实验：");
    const firstTrayInfoRow = firstTray.get(".transfer-tray-card__subhead-row");
    expect(firstTrayInfoRow.text()).toContain("托盘 #1");
    expect(firstTrayInfoRow.findAll(".transfer-tray-experiment-tag")).toHaveLength(1);

    expect(wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-A"]').attributes("aria-disabled")).toBe("true");
    expect(wrapper.find('[data-testid="transfer-tray-select-0"]').exists()).toBe(false);

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(4)").trigger("click");
    await settle(wrapper);
    expect(wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-A"]').attributes("aria-disabled")).toBe("false");

    await wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-A"]').trigger("click");
    await settle(wrapper);

    const firstToggle = wrapper.get('[data-testid="transfer-tray-select-0"]');
    expect(firstToggle.text()).toContain("✓");
    expect(firstToggle.classes()).toContain("is-selected");

    const unlockedSecondToggle = wrapper.get('[data-testid="transfer-tray-select-1"]');
    await unlockedSecondToggle.trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-tray-select-1"]').classes()).toContain("is-selected");

    await wrapper.get('[data-testid="transfer-task-code"]').trigger("click");
    await settle(wrapper);

    const secondTrayTagClasses = wrapper.get('[data-testid="transfer-tray-card-1"]').findAll(".transfer-tray-experiment-tag").map((tag) => tag.attributes("class"));
    expect(secondTrayTagClasses).toHaveLength(2);
    expect(secondTrayTagClasses[0]).not.toBe(secondTrayTagClasses[1]);
  });

  test("adding a tray clears existing experiment assignments and labels", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspaceWithExperimentAssignments = {
      ...createWorkspacePayload(),
      experiments: [
        {
          experimentCode: "SYLU-2026-03-101-A",
          experimentName: "温度冲击",
          assignedTrayNos: ["SYLU-2026-03-101-TP-001"],
          assignedTrayCount: 1,
        },
        {
          experimentCode: "SYLU-2026-03-101-B",
          experimentName: "振动",
          assignedTrayNos: ["SYLU-2026-03-101-TP-002"],
          assignedTrayCount: 1,
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => workspaceWithExperimentAssignments };
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-tray-card-0"]').text()).toContain("温度冲击");
    expect(wrapper.get('[data-testid="transfer-tray-card-1"]').text()).toContain("振动");

    await wrapper.get(".transfer-use-tray-btn").trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll('[data-testid^="transfer-tray-card-"]')).toHaveLength(3);
    expect(wrapper.findAll(".transfer-tray-experiment-tag")).toHaveLength(0);
    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeDefined();
  });

  test("moving or deleting trays clears existing experiment assignments and labels", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspaceWithThreeTrays = {
      ...createWorkspacePayload(),
      allocationSaved: true,
      trayInventory: [],
      experiments: [
        {
          experimentCode: "SYLU-2026-03-101-A",
          experimentName: "温度冲击",
          assignedTrayNos: ["SYLU-2026-03-101-TP-001"],
          assignedTrayCount: 1,
        },
        {
          experimentCode: "SYLU-2026-03-101-B",
          experimentName: "振动",
          assignedTrayNos: ["SYLU-2026-03-101-TP-002"],
          assignedTrayCount: 1,
        },
      ],
      assignedTrays: [
        {
          trayId: 201,
          trayNo: "SYLU-2026-03-101-TP-001",
          trayType: "标准托盘",
          trayStatus: "已预分配",
          capacity: 2,
          samples: [
            { sampleId: 1, sampleNo: "SYLU-2026-03-101-SP-001", sampleStatus: "未入库" },
            { sampleId: 2, sampleNo: "SYLU-2026-03-101-SP-002", sampleStatus: "未入库" },
          ],
          experimentLabels: ["温度冲击"],
          experimentCodes: ["SYLU-2026-03-101-A"],
          barcode: null,
          barcodeData: null,
        },
        {
          trayId: 202,
          trayNo: "SYLU-2026-03-101-TP-002",
          trayType: "标准托盘",
          trayStatus: "已预分配",
          capacity: 2,
          samples: [{ sampleId: 3, sampleNo: "SYLU-2026-03-101-SP-003", sampleStatus: "未入库" }],
          experimentLabels: ["振动"],
          experimentCodes: ["SYLU-2026-03-101-B"],
          barcode: null,
          barcodeData: null,
        },
        {
          trayId: 203,
          trayNo: "SYLU-2026-03-101-TP-003",
          trayType: "标准托盘",
          trayStatus: "已预分配",
          capacity: 2,
          samples: [{ sampleId: 4, sampleNo: "SYLU-2026-03-101-SP-004", sampleStatus: "未入库" }],
          experimentLabels: [],
          experimentCodes: [],
          barcode: null,
          barcodeData: null,
        },
      ],
    };
    const reloadedWorkspace = {
      ...workspaceWithThreeTrays,
      allocationSaved: false,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options = {}) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => workspaceWithThreeTrays };
        }
        if (url.includes("/api/transfer-area/tasks/101/reload")) {
          expect(options.method).toBe("POST");
          return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已重新入库", workspace: reloadedWorkspace }) };
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll(".transfer-tray-experiment-tag")).toHaveLength(2);

    const tray0Samples = wrapper.get('[data-testid="transfer-tray-card-0"]').findAll(".sample-tray-sample-tag");
    await tray0Samples[0].trigger("click");
    await wrapper.get('[data-testid="transfer-tray-card-2"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll(".transfer-tray-experiment-tag")).toHaveLength(2);
    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-allocation-validation"]').text()).toBe("有样品的托盘必须至少分配一个实验。");

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(4)").trigger("click");
    await settle(wrapper);

    const editableTray0Samples = wrapper.get('[data-testid="transfer-tray-card-0"]').findAll(".sample-tray-sample-tag");
    await editableTray0Samples[0].trigger("click");
    await wrapper.get('[data-testid="transfer-tray-card-2"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll(".transfer-tray-experiment-tag")).toHaveLength(0);
    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeDefined();

    await wrapper.get(".sample-tray-remove").trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll(".transfer-tray-experiment-tag")).toHaveLength(0);
  });

  test("reload on a pending task resets tray allocation back to the initial unassigned workspace", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const workspaceWithExperimentAssignments = {
      ...createWorkspacePayload(),
      allocationSaved: true,
      experiments: [
        {
          experimentCode: "SYLU-2026-03-101-A",
          experimentName: "温度冲击",
          assignedTrayNos: ["SYLU-2026-03-101-TP-001"],
          assignedTrayCount: 1,
        },
        {
          experimentCode: "SYLU-2026-03-101-B",
          experimentName: "振动",
          assignedTrayNos: ["SYLU-2026-03-101-TP-002"],
          assignedTrayCount: 1,
        },
      ],
      assignedTrays: createWorkspacePayload().assignedTrays.map((tray, index) => ({
        ...tray,
        experimentLabels: index === 0 ? ["温度冲击"] : ["振动"],
        experimentCodes: index === 0 ? ["SYLU-2026-03-101-A"] : ["SYLU-2026-03-101-B"],
      })),
    };
    const reloadedWorkspace = createReloadedWorkspace(workspaceWithExperimentAssignments);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options = {}) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => workspaceWithExperimentAssignments };
        }
        if (url.includes("/api/transfer-area/tasks/101/reload")) {
          expect(options.method).toBe("POST");
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, message: "任务已重新入库，已回到未入库列表", workspace: reloadedWorkspace }),
          };
        }
        throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll(".transfer-tray-experiment-tag")).toHaveLength(2);
    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeUndefined();

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(4)").trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll(".transfer-tray-experiment-tag")).toHaveLength(0);
    expect(wrapper.findAll(".transfer-tray-card.is-active")).toHaveLength(0);
    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="transfer-save-trays"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).not.toContain("当前托盘方案已保存");
    expect(wrapper.get('[data-testid="transfer-allocation-validation"]').text()).toBe("每个实验都必须至少分配一个托盘。");
    expect(wrapper.get('[data-testid="transfer-tray-card-0"]').text()).toContain("SYLU-2026-03-101-SP-001");
    expect(wrapper.text()).toContain("任务已重新入库，已回到未入库列表");
  });

  test("confirm storage after re-entry saves the reselected experiment allocation first", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const baseWorkspace = createWorkspacePayload();
    const assignedWorkspace = {
      ...baseWorkspace,
      allocationSaved: true,
      experiments: [
        {
          experimentCode: "SYLU-2026-03-101-A",
          experimentName: "温度冲击",
          assignedTrayNos: ["SYLU-2026-03-101-TP-001"],
          assignedTrayCount: 1,
        },
        {
          experimentCode: "SYLU-2026-03-101-B",
          experimentName: "振动",
          assignedTrayNos: ["SYLU-2026-03-101-TP-002"],
          assignedTrayCount: 1,
        },
      ],
      assignedTrays: baseWorkspace.assignedTrays.map((tray, index) => ({
        ...tray,
        experimentLabels: index === 0 ? ["温度冲击"] : ["振动"],
        experimentCodes: index === 0 ? ["SYLU-2026-03-101-A"] : ["SYLU-2026-03-101-B"],
      })),
    };
    const reloadedWorkspace = createReloadedWorkspace(assignedWorkspace);
    const resavedWorkspace = {
      ...assignedWorkspace,
      allocationSaved: true,
    };
    const storedWorkspace = createStoredWorkspace(resavedWorkspace);
    const requestLog = [];
    let workspaceState = assignedWorkspace;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options = {}) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => workspaceState };
        }
        if (url.includes("/api/transfer-area/tasks/101/reload")) {
          requestLog.push("reload");
          workspaceState = reloadedWorkspace;
          return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已重新入库", workspace: reloadedWorkspace }) };
        }
        if (url.includes("/api/transfer-area/tasks/101/allocate")) {
          requestLog.push("allocate");
          workspaceState = resavedWorkspace;
          return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: resavedWorkspace }) };
        }
        if (url.includes("/api/transfer-area/tasks/101/confirm-storage")) {
          requestLog.push("confirm");
          workspaceState = storedWorkspace;
          return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已确认入库", workspace: storedWorkspace }) };
        }
        throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(4)").trigger("click");
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-A"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-tray-card-0"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-experiment-tab-SYLU-2026-03-101-B"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-tray-card-1"]').trigger("click");
    await settle(wrapper);

    const confirmButton = wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(3)");
    expect(confirmButton.attributes("disabled")).toBeUndefined();

    await confirmButton.trigger("click");
    await settle(wrapper);
    await settle(wrapper);

    expect(requestLog).toEqual(["reload", "allocate", "confirm"]);
    expect(wrapper.text()).toContain("任务已确认入库");
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

    expect(wrapper.get(".transfer-print-all-btn").attributes("disabled")).toBeUndefined();
    expect(wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(2)").attributes("disabled")).toBeDefined();
    expect(wrapper.findAll(".sample-tray-remove")[0].attributes("disabled")).toBeDefined();

    await wrapper.get(".transfer-print-all-btn").trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="barcode-modal-confirm-print"]').trigger("click");
    await settle(wrapper);

    expect(printFramePrintMock).toHaveBeenCalledTimes(1);
  });

  test("handover allocation becomes read-only after saving until re-entry is clicked", async () => {
    const bootstrapPayload = createBootstrapPayload();
    const editableWorkspace = {
      ...createWorkspacePayload(),
      assignedTrays: [
        {
          ...createWorkspacePayload().assignedTrays[0],
        },
        {
          ...createWorkspacePayload().assignedTrays[1],
        },
        {
          trayId: 203,
          trayNo: "SYLU-2026-03-101-TP-003",
          trayType: "标准托盘",
          trayStatus: "已预分配",
          capacity: 2,
          samples: [],
          barcode: null,
          barcodeData: null,
        },
      ],
      trayInventory: [{ trayId: 204, trayNo: "STOCK-TP-004", trayType: "标准托盘", capacity: 2, currentTaskId: null }],
    };
    const savedWorkspace = {
      ...editableWorkspace,
      allocationSaved: true,
    };
    const reloadedWorkspace = {
      ...editableWorkspace,
      allocationSaved: false,
    };
    let workspaceState = editableWorkspace;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options = {}) => {
        const url = String(input);
        if (url.includes("/api/transfer-area/bootstrap")) {
          return { ok: true, status: 200, json: async () => bootstrapPayload };
        }
        if (url.includes("/api/transfer-area/tasks/101/workspace")) {
          return { ok: true, status: 200, json: async () => workspaceState };
        }
        if (url.includes("/api/transfer-area/tasks/101/allocate")) {
          expect(options.method).toBe("POST");
          workspaceState = savedWorkspace;
          return { ok: true, status: 200, json: async () => ({ ok: true, message: "托盘分配已保存", workspace: savedWorkspace }) };
        }
        if (url.includes("/api/transfer-area/tasks/101/reload")) {
          expect(options.method).toBe("POST");
          workspaceState = reloadedWorkspace;
          return { ok: true, status: 200, json: async () => ({ ok: true, message: "任务已重新入库", workspace: reloadedWorkspace }) };
        }
        throw new Error(`Unhandled fetch: ${url} ${options.method || "GET"}`);
      }),
    );

    const wrapper = mount(TransferAreaPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll('[data-testid^="transfer-tray-card-"]')).toHaveLength(3);
    expect(wrapper.get(".transfer-use-tray-btn").element.disabled).toBe(false);
    expect(wrapper.get('[data-testid="transfer-tray-card-2"]').text()).toContain("暂无样品");

    await wrapper.get('[data-testid="transfer-save-trays"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get(".transfer-use-tray-btn").element.disabled).toBe(true);

    const previewBeforeLockedMove = wrapper.get('[data-testid="transfer-tray-preview"]').text();
    const tray0Samples = wrapper.get('[data-testid="transfer-tray-card-0"]').findAll(".sample-tray-sample-tag");
    await tray0Samples[0].trigger("click");
    await wrapper.get('[data-testid="transfer-tray-card-2"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-tray-preview"]').text()).toBe(previewBeforeLockedMove);
    expect(wrapper.get('[data-testid="transfer-tray-card-2"]').text()).toContain("暂无样品");

    await wrapper.get(".transfer-tray-actions--top .action-btn:nth-child(4)").trigger("click");
    await settle(wrapper);

    expect(wrapper.get(".transfer-use-tray-btn").element.disabled).toBe(false);

    await wrapper.get(".transfer-use-tray-btn").trigger("click");
    await settle(wrapper);

    const unlockedTray0Samples = wrapper.get('[data-testid="transfer-tray-card-0"]').findAll(".sample-tray-sample-tag");
    await unlockedTray0Samples[0].trigger("click");
    await wrapper.get('[data-testid="transfer-tray-card-2"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="transfer-tray-card-2"]').text()).toContain("SYLU-2026-03-101-SP-001");
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
    expect(wrapper.text()).toContain("切换到到货或全部视图");

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
