import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import SamplesPage from "./page.vue";

const { routerPush, routerReplace } = vi.hoisted(() => ({
  routerPush: vi.fn(() => Promise.resolve()),
  routerReplace: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
  }),
}));

let storageState = {};

const createStorageStub = () => ({
  getItem: (key) => (Object.prototype.hasOwnProperty.call(storageState, key) ? storageState[key] : null),
  setItem: (key, value) => {
    storageState[key] = String(value);
  },
  removeItem: (key) => {
    delete storageState[key];
  },
});

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
  ],
  trayInventory: [{ trayId: 203, trayNo: "STOCK-TP-003", trayType: "标准托盘", capacity: 2, currentTaskId: null }],
});

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

describe("SamplesPage runtime", () => {
  beforeEach(() => {
    storageState = {};
    vi.stubGlobal("localStorage", createStorageStub());
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
      if (url.includes("/api/storage")) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes("/api/tasks")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));
    vi.stubGlobal("open", vi.fn(() => ({
      document: { write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    storageState = {};
    routerPush.mockReset();
    routerReplace.mockReset();
  });

  test("renders pre-allocation workbench and keeps flow/staging panels while removing lifecycle trace", async () => {
    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("样品预分装");
    expect(wrapper.text()).toContain("样品流转与状态");
    expect(wrapper.text()).toContain("暂存间派发");
    expect(wrapper.text()).not.toContain("样品全生命周期追踪");
    expect(wrapper.text()).toContain("SYLU-2026-03-101");
    expect(wrapper.text()).not.toContain("SYLU-2026-03-102");
  });

  test("pre-allocation detail hides confirm storage and uses reallocate label", async () => {
    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="transfer-task-row-101"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("任务样品分配管理");
    expect(wrapper.text()).not.toContain("确认入库");
    expect(wrapper.text()).toContain("重新分配");
    expect(wrapper.get('[data-testid="transfer-save-trays"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="transfer-print-barcodes"]').exists()).toBe(true);
  });

  test("samples flow task filter removes orphan legacy task codes that are no longer in the current task list", async () => {
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
      if (url.includes("/api/storage")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            "mes.samples": [
              { id: "legacy-1", code: "CJ-2026-001-SP-001", task_code: "CJ-2026-001", location: "接驳区", status: "到货", trays: [] },
              { id: "legacy-2", code: "SZH-2026-001-SP-001", task_code: "SZH-2026-001", location: "接驳区", status: "到货", trays: [] },
              { id: "current-1", code: "SYLU-2026-03-002-SP-001", task_code: "SYLU-2026-03-002", location: "接驳区", status: "到货", trays: [] },
            ],
          }),
        };
      }
      if (url.includes("/api/tasks")) {
        return {
          ok: true,
          status: 200,
          json: async () => ([
            { id: 1, code: "SYLU-2026-03-002", name: "当前任务", test_type: "振动试验", sample_count: 1 },
            { id: 2, code: "SYLU-2026-03-003", name: "当前任务 B", test_type: "冲击试验", sample_count: 2 },
          ]),
        };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    const taskOptions = wrapper.get('[data-testid="samples-flow-task-filter"]').findAll("option").map((node) => node.text());
    expect(taskOptions).toContain("SYLU-2026-03-002");
    expect(taskOptions).not.toContain("SYLU-2026-03-003");
    expect(taskOptions).not.toContain("CJ-2026-001");
    expect(taskOptions).not.toContain("SZH-2026-001");
    expect(wrapper.text()).not.toContain("CJ-2026-001-SP-001");
    expect(wrapper.text()).not.toContain("SZH-2026-001-SP-001");
  });
});
