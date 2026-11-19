import { flushPromises, mount } from "@vue/test-utils";
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
  ],
  trayInventory: [{ trayId: 203, trayNo: "STOCK-TP-003", trayType: "标准托盘", capacity: 2, currentTaskId: null }],
});

const settle = async (wrapper) => {
  await flushPromises();
  await wrapper.vm.$nextTick();
  await flushPromises();
  await wrapper.vm.$nextTick();
};

const samplePageResponse = (samples = [], taskOptions = []) => ({
  currentPage: 1,
  samples,
  statusOptions: Array.from(new Set(samples.map((sample) => sample.status).filter(Boolean))),
  taskOptions,
  totalCount: samples.length,
  totalPages: 1,
});

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
      if (url.includes("/api/samples/page")) {
        return { ok: true, status: 200, json: async () => samplePageResponse() };
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

  test("keeps flow and staging panels without embedding the pre-allocation workbench", async () => {
    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    const tabs = wrapper.get('[data-testid="samples-page-tabs"]');
    expect(tabs.findAll("button").map((button) => button.text())).toEqual(["样品流转", "暂存间"]);
    expect(tabs.get('[data-testid="samples-tab-flow"]').attributes("aria-pressed")).toBe("true");
    await tabs.get('[data-testid="samples-tab-staging"]').trigger("click");
    expect(wrapper.get('[data-testid="samples-staging-panel"]').element.style.display).not.toBe("none");
    expect(wrapper.get('[data-testid="samples-flow-panel"]').element.style.display).toBe("none");
    expect(wrapper.get('[data-testid="samples-management-panel"]').classes()).toContain("samples-management-panel--grouped");
    await tabs.get('[data-testid="samples-tab-flow"]').trigger("click");
    expect(wrapper.text()).not.toContain("样品预分装");
    expect(wrapper.text()).not.toContain("总任务清单");
    expect(wrapper.text()).toContain("样品流转与状态");
    expect(wrapper.text()).toContain("暂存间样品");
    expect(wrapper.text()).not.toContain("样品全生命周期追踪");
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
      if (url.includes("/api/samples/page")) {
        const samples = url.includes("view=staging") ? [] : [
          {
            id: "current-1",
            code: "SYLU-2026-03-002-SP-001",
            task_code: "SYLU-2026-03-002",
            location: "接驳区",
            status: "到货",
            trayCodes: [],
          },
        ];
        return {
          ok: true,
          status: 200,
          json: async () => samplePageResponse(samples, ["SYLU-2026-03-002"]),
        };
      }
      if (url.includes("/api/storage")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            "mes.samples": [
              { id: "legacy-1", code: "SYLU-2026-04-101-SP-001", task_code: "SYLU-2026-04-101", location: "接驳区", status: "到货", trays: [] },
              { id: "legacy-2", code: "SYLU-2026-04-102-SP-001", task_code: "SYLU-2026-04-102", location: "接驳区", status: "到货", trays: [] },
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
    expect(taskOptions).not.toContain("SYLU-2026-04-101");
    expect(taskOptions).not.toContain("SYLU-2026-04-102");
    expect(wrapper.text()).not.toContain("SYLU-2026-04-101-SP-001");
    expect(wrapper.text()).not.toContain("SYLU-2026-04-102-SP-001");
  });

  test("groups samples across API pages in each view and follows the selected tray and task", async () => {
    const task = "SYLU-2026-03-021";
    const unassignedTask = "SYLU-2026-03-022";
    const tray = task + "-TP-001";
    const otherTray = task + "-TP-002";
    const stagingLocation = "恒温恒湿间（暂存间）";
    const stored = Array.from({ length: 7 }, (_, index) => ({
      id: "staging-" + index,
      code: task + "-SP-00" + (index + 1),
      task_code: task,
      location: stagingLocation,
      status: "已到达暂存间",
      trayCodes: index === 0 ? [tray, otherTray] : [tray],
    }));
    const unassigned = {
      id: "awaiting-tray",
      code: unassignedTask + "-SP-001",
      task_code: unassignedTask,
      location: "接驳区",
      status: "到货",
      trayCodes: [],
    };
    const rawSamples = [...stored, unassigned].map((sample) => ({
      ...sample,
      trays: sample.trayCodes.map((code) => ({ tray_code: code, quantity: 1, status: sample.status })),
    }));
    const fetchSpy = vi.fn(async (input) => {
      const url = new URL(String(input), "http://localhost");
      let payload;
      if (url.pathname === "/api/samples/page") {
        const staging = url.searchParams.get("view") === "staging";
        const page = Number(url.searchParams.get("page"));
        const pageRows = page === 1 ? stored.slice(0, 4) : [...stored.slice(4), ...(staging ? [] : [unassigned])];
        const taskOptions = staging ? [task] : [task, unassignedTask];
        const query = url.searchParams.get("query");
        payload = query
          ? samplePageResponse([...stored, unassigned].filter((sample) => sample.code === query), taskOptions)
          : { ...samplePageResponse(pageRows, taskOptions), currentPage: page, totalPages: 2, totalCount: staging ? 7 : 8 };
      } else if (url.pathname === "/api/tasks") {
        payload = [{ code: task, status: "已排程" }, { code: unassignedTask, status: "待排程" }];
      } else if (url.pathname.startsWith("/api/storage")) {
        payload = { "mes.samples": rawSamples };
      } else {
        throw new Error("Unhandled fetch: " + url);
      }
      return { ok: true, status: 200, json: async () => payload };
    });
    vi.stubGlobal("fetch", fetchSpy);
    const wrapper = mount(SamplesPage);
    try {
      await settle(wrapper);
      const flow = wrapper.get('[data-testid="samples-flow-panel"]');
      const totals = flow.get('[data-testid="samples-flow-totals"]');
      const totalValues = () => totals.findAll("dd").map((entry) => entry.text());
      expect(totals.findAll("dt").map((entry) => entry.text()))
        .toEqual(["任务总数", "已分配托盘任务数", "样品总数"]);
      expect(totalValues()).toEqual(["2", "1", "8"]);
      expect(flow.findAll(".sample-task-choice")).toHaveLength(2);
      expect(flow.findAll(".sample-task-choice").map((button) => button.attributes("data-assigned")))
        .toEqual(["true", "false"]);
      expect(flow.findAll(".sample-group-view-flow")).toHaveLength(2);
      expect(flow.findAll(".sample-group-item")[1].find(".sample-group-view-flow").exists()).toBe(false);
      expect(flow.findAll(".sample-group-sample-table th").map((cell) => cell.text()))
        .toEqual(["样品编号", "当前位置", "状态"]);
      expect(flow.find(".sample-group-sample-table tbody button").exists()).toBe(false);
      expect(flow.get(".sample-task-choice strong").text()).toBe(task);
      expect(flow.get(".sample-task-choice").text()).toContain("2 个托盘 · 7 件样品");
      expect(flow.get(".sample-group-tray-choice strong").text()).toBe(tray);
      expect(flow.findAll('[data-testid="samples-group-sample-row"]')).toHaveLength(7);
      expect(flow.get('[data-testid="samples-group-task-step-scheduled"]').attributes("aria-current")).toBe("step");
      expect(flow.get('[data-testid="samples-group-tray-flow"] [aria-current="step"]').text()).toContain("已到达暂存间");
      await flow.get('[data-testid="samples-flow-search"]').setValue(stored[1].code);
      await settle(wrapper);
      expect(flow.get(".sample-task-choice").attributes("aria-expanded")).toBe("true");
      expect(flow.get(".sample-task-choice").text()).toContain("1 个匹配托盘");
      expect(flow.get('[data-testid="samples-group-sample-count"]').text()).toBe("匹配 1 条 / 全盘 7 条");
      expect(flow.findAll('[data-testid="samples-group-sample-row"]')).toHaveLength(1);
      const viewAll = flow.get('[data-testid="samples-group-view-all"]');
      await viewAll.trigger("click");
      expect(flow.findAll('[data-testid="samples-group-sample-row"]')).toHaveLength(7);
      expect(totalValues()).toEqual(["1", "1", "1"]);
      await viewAll.trigger("click");
      expect(flow.findAll('[data-testid="samples-group-sample-row"]')).toHaveLength(1);
      await flow.get('[data-testid="samples-flow-search"]').setValue("");
      await settle(wrapper);
      await flow.findAll(".sample-task-choice")[1].trigger("click");
      expect(flow.get('[data-testid="samples-group-selected-code"]').text()).toBe("未关联托盘");
      expect(flow.find('[data-testid="samples-group-tray-flow"]').exists()).toBe(false);
      expect(flow.find('[data-testid="samples-group-task-flow"]').exists()).toBe(true);
      expect(flow.findAll('[data-testid="samples-group-sample-row"]')).toHaveLength(1);
      expect(totalValues()).toEqual(["2", "1", "8"]);

      await flow.get('[data-testid="samples-flow-search"]').setValue(unassigned.code);
      await settle(wrapper);
      expect(totalValues()).toEqual(["1", "0", "1"]);

      await wrapper.get('[data-testid="samples-tab-staging"]').trigger("click");
      await settle(wrapper);
      const staging = wrapper.get('[data-testid="samples-staging-panel"]');
      expect(staging.find('[data-testid="samples-flow-totals"]').exists()).toBe(false);
      expect(staging.findAll(".sample-task-choice")).toHaveLength(1);
      expect(staging.findAll('[data-testid="samples-group-sample-row"]')).toHaveLength(7);
      expect(staging.get(".sample-task-choice strong").text()).toBe(task);
      expect(staging.findAll(".sample-group-tray-choice")[1].get("strong").text()).toBe(otherTray);
      await staging.findAll(".sample-group-view-flow")[1].trigger("click");
      expect(staging.get('[data-testid="samples-group-selected-code"]').text()).toBe(otherTray);
      const dialog = staging.get('[data-testid="sample-tray-flow-dialog"] [role="dialog"]');
      expect(dialog.get(".modal-header strong").text()).toBe("统一托盘流程图 · " + otherTray);
      expect(dialog.get(".sample-flow-unified--timed").exists()).toBe(true);
      await dialog.get(".modal-close").trigger("click");
      expect(staging.find('[data-testid="sample-tray-flow-dialog"] [role="dialog"]').exists()).toBe(false);
      const reads = fetchSpy.mock.calls.map(([input]) => new URL(String(input), "http://localhost"));
      expect(reads.some((url) => url.searchParams.get("page") === "2" && url.searchParams.get("view") === "staging")).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  test("opens only one task at a time and finds the matching tray after searching", async () => {
    const firstTask = "SYLUN-2026-11-001";
    const secondTask = "SYLUN-2026-11-002";
    const records = [firstTask, secondTask].flatMap((task, taskIndex) =>
      [1, 2, ...(taskIndex ? [0] : [])].map((tray) => ({
        code: `${task}-SP-00${tray || 3}`,
        task_code: task,
        status: "样品运输中",
        trays: tray ? [{ tray_code: `${task}-TP-00${tray}`, quantity: 1, status: "样品运输中" }] : [],
      })),
    );
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input), "http://localhost");
      let body = {};
      if (url.pathname === "/api/samples/page") {
        const query = url.searchParams.get("query") || "";
        const matching = records.map((sample) => ({ ...sample, trayCodes: sample.trays.map((tray) => tray.tray_code) }))
          .filter((sample) => [sample.code, ...sample.trayCodes].some((code) => code.includes(query)));
        body = samplePageResponse(url.searchParams.get("view") === "staging" ? [] : matching, [firstTask, secondTask]);
      } else if (url.pathname === "/api/tasks") {
        body = [firstTask, secondTask].map((code) => ({ code, status: "待排程" }));
      } else if (url.pathname.startsWith("/api/storage")) {
        body = { "mes.samples": records };
      }
      return { ok: true, status: 200, json: async () => body };
    }));
    const wrapper = mount(SamplesPage);
    try {
      await settle(wrapper);
      const flow = wrapper.get('[data-testid="samples-flow-panel"]');
      const tasks = () => flow.findAll(".sample-task-choice");
      const expanded = () => tasks().map((button) => button.attributes("aria-expanded"));
      expect(expanded()).toEqual(["true", "false"]);
      await tasks()[1].trigger("click");
      expect(expanded()).toEqual(["false", "true"]);
      expect(tasks()[1].text()).toContain("含未分配样品");
      const children = flow.findAll(".sample-group-item")[1].findAll(".sample-group-tray-choice");
      expect(children[2].text()).toContain("未关联托盘");
      await children[2].trigger("click");
      expect(flow.get('[data-testid="samples-group-selected-code"]').text()).toBe("未关联托盘");
      await tasks()[1].trigger("click");
      expect(expanded()).toEqual(["false", "false"]);
      await tasks()[1].trigger("click");
      expect(expanded()).toEqual(["false", "true"]);
      expect(children[2].attributes("aria-pressed")).toBe("true");

      const targetTray = secondTask + "-TP-002";
      await flow.get('[data-testid="samples-flow-search"]').setValue(targetTray);
      await settle(wrapper);
      expect(expanded()).toEqual(["true"]);
      expect(flow.get('[data-testid="samples-group-selected-code"]').text()).toBe(targetTray);
      expect(flow.get(".sample-group-tray-choice").attributes("aria-pressed")).toBe("true");
    } finally {
      wrapper.unmount();
    }
  });

  test("tray flow receives experiment runs from the page and shows the active running experiment", async () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = "SYLU-2026-06-021-TP-001";
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => createBootstrapPayload() };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => createWorkspacePayload() };
      }
      if (url.includes("/api/samples/page")) {
        const samples = url.includes("view=staging") ? [] : [
          {
            id: `${taskCode}-SP-001`,
            code: `${taskCode}-SP-001`,
            task_code: taskCode,
            location: "冲击一室",
            status: "实验进行中",
            trayCodes: [trayCode],
          },
        ];
        return { ok: true, status: 200, json: async () => samplePageResponse(samples, [taskCode]) };
      }
      if (url.includes("/api/storage")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            "mes.experiment_runs": [
              {
                run_no: "RUN-IMPACT-001",
                task_code: taskCode,
                experiment_code: `${taskCode}-A`,
                tray_codes: [trayCode],
                status: "实验进行中",
                started_at: "2026-06-04T19:33:56+08:00",
              },
            ],
            "mes.experiment_run_trays": [
              {
                run_no: "RUN-IMPACT-001",
                task_code: taskCode,
                experiment_code: `${taskCode}-A`,
                tray_code: trayCode,
                run_tray_status: "实验进行中",
                started_at: "2026-06-04T19:33:56+08:00",
              },
            ],
            "mes.experiment_trays": [
              { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
              { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
            ],
            "mes.experiments": [
              { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", required_device: "冲击试验", status: "实验准备就绪" },
              { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", required_device: "温度冲击试验", status: "已排程" },
            ],
            "mes.samples": [
              {
                code: `${taskCode}-SP-001`,
                task_code: taskCode,
                location: "冲击一室",
                status: "实验进行中",
                trays: [{ tray_code: trayCode, status: "实验进行中", quantity: 1 }],
                history: [
                  {
                    action: "实验确认",
                    detail: `${taskCode} / 冲击试验 / 实验准备就绪`,
                    location: "冲击一室",
                    status: "实验准备就绪",
                    time: "2026-06-04T19:33:54+08:00",
                  },
                ],
              },
            ],
            "mes.schedules": [
              { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击一室", status: "实验进行中" },
            ],
          }),
        };
      }
      if (url.includes("/api/tasks")) {
        return {
          ok: true,
          status: 200,
          json: async () => ([{ id: 1, code: taskCode, name: "当前任务", test_type: "冲击试验", sample_count: 1 }]),
        };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(SamplesPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-flow-panel"] .sample-group-view-flow').trigger("click");
    await settle(wrapper);

    const trayFlowCard = wrapper.get('[data-testid="samples-flow-panel"] .sample-tray-flow-dialog');
    const runningStep = trayFlowCard.get('[data-testid="samples-tray-flow-step-experiment-current-0"]');
    expect(runningStep.text()).toContain("冲击试验进行中");
    expect(runningStep.text()).toContain("2026-06-04 19:33:56");
    expect(runningStep.classes()).toContain("current");
    expect(trayFlowCard.get('[data-testid="samples-tray-flow-step-route-0-5"]').classes()).toContain("reached");
  });

  test("mid-experiment appearance stays current and skipped staging nodes stay green without times", async () => {
    const taskCode = "SYLU-2026-10-001";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/transfer-area/bootstrap")) {
        return { ok: true, status: 200, json: async () => createBootstrapPayload() };
      }
      if (url.includes("/api/transfer-area/tasks/101/workspace")) {
        return { ok: true, status: 200, json: async () => createWorkspacePayload() };
      }
      if (url.includes("/api/samples/page")) {
        const samples = url.includes("view=staging") ? [] : [{
          code: `${taskCode}-SP-001`,
          location: "外观检测间",
          status: "中途外观检查中",
          task_code: taskCode,
          trayCodes: [trayCode],
          trays: [{ quantity: 1, status: "中途外观检查中", tray_code: trayCode }],
        }];
        return { ok: true, status: 200, json: async () => samplePageResponse(samples, [taskCode]) };
      }
      if (url.includes("/api/storage")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            "mes.experiment_run_pauses": [{
              inspection_tray_codes: [trayCode],
              lab_code: "LAB_SALT",
              pause_no: "PAUSE-1",
              run_no: "RUN-SALT-1",
              status: "实验暂停",
            }],
            "mes.experiment_runs": [{
              device: "盐雾试验室",
              experiment_code: experimentCode,
              run_no: "RUN-SALT-1",
              status: "实验暂停",
              task_code: taskCode,
            }],
            "mes.experiment_run_trays": [{
              experiment_code: experimentCode,
              run_no: "RUN-SALT-1",
              run_tray_status: "实验进行中",
              task_code: taskCode,
              tray_code: trayCode,
            }],
            "mes.experiment_trays": [{ experiment_code: experimentCode, task_code: taskCode, tray_code: trayCode }],
            "mes.experiments": [{
              experiment_code: experimentCode,
              experiment_name: "盐雾试验",
              required_device: "盐雾试验室",
              task_code: taskCode,
            }],
            "mes.samples": [{
              code: `${taskCode}-SP-001`,
              flow_status: "中途外观检查中",
              location: "外观检测间",
              status: "中途外观检查中",
              task_code: taskCode,
              trays: [{ quantity: 1, status: "中途外观检查中", tray_code: trayCode }],
            }],
            "mes.schedules": [{ device: "盐雾试验室", experiment_code: experimentCode, status: "实验暂停", task_code: taskCode }],
            "mes.staging_events": [{
              action: "stock_in",
              appearance_phase: "mid_experiment",
              pause_no: "PAUSE-1",
              room: "appearance",
              run_no: "RUN-SALT-1",
              time: "2026-09-04 14:30:00",
              tray_code: trayCode,
            }],
          }),
        };
      }
      if (url.includes("/api/tasks")) {
        return { ok: true, status: 200, json: async () => [{ code: taskCode, name: "盐雾暂停任务", test_type: "盐雾试验" }] };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));

    const wrapper = mount(SamplesPage);
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-flow-panel"] .sample-group-view-flow').trigger("click");
    await settle(wrapper);

    const trayFlowCard = wrapper.get('[data-testid="samples-flow-panel"] .sample-tray-flow-dialog');
    expect(trayFlowCard.text()).toContain("盐雾试验进行中（暂停）");
    expect(trayFlowCard.text()).toContain("中途外观检测");
    expect(trayFlowCard.get('[data-testid^="samples-tray-flow-step-salt-spray-mid-appearance-"]').classes())
      .toContain("current");
    const flowSteps = trayFlowCard.findAll('[data-testid^="samples-tray-flow-step-"]');
    for (const label of ["送至暂存间", "已到达暂存间"]) {
      const step = flowSteps.find((entry) => entry.get(".sample-flow-label").text() === label);
      expect(step?.classes()).toContain("reached");
      expect(step?.get(".sample-flow-time").text()).toBe("-");
      expect(step?.attributes("title")).toBe("推导节点，暂无实际时间记录");
    }
    const pausedStep = flowSteps
      .find((step) => step.text().includes("盐雾试验进行中（暂停）"));
    expect(pausedStep?.classes()).toContain("pause-reset");
    expect(pausedStep?.classes()).not.toContain("reached");
  });
});

