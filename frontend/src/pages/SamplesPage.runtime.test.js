import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import SamplesPage from "./SamplesPage.vue";

const TASKS_KEY = "mes.tasks";
const SAMPLES_KEY = "mes.samples";
const SCHEDULES_KEY = "mes.schedules";

let storageState = {};

const createStorageStub = () => ({
  getItem: (key) => (Object.prototype.hasOwnProperty.call(storageState, key) ? storageState[key] : null),
  setItem: (key, value) => {
    storageState[key] = String(value);
  },
});

const setStorage = (key, value) => {
  window.localStorage.setItem(key, JSON.stringify(value));
};

const getStorage = (key) => JSON.parse(window.localStorage.getItem(key) || "[]");

const resetStorage = () => {
  storageState = {};
};

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

describe("SamplesPage runtime", () => {
  beforeEach(() => {
    resetStorage();
    vi.stubGlobal("localStorage", createStorageStub());
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    vi.stubGlobal(
      "open",
      vi.fn(() => ({
        document: { write: vi.fn(), close: vi.fn() },
        focus: vi.fn(),
        print: vi.fn(),
        close: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStorage();
  });

  test("selecting a task populates sample count, sample codes, and tray preview from Vue state", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "4" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-process-task-select"]').setValue("SZH-2026-001");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="samples-process-count"]').text()).toBe("4");
    expect(wrapper.get('[data-testid="samples-process-codes"]').element.value).toContain("SZH-2026-001-SP-001");
    expect(wrapper.get('[data-testid="samples-process-tray-preview"]').element.value).toContain("SZH-2026-001-TP-001");
  });

  test("sample intake auto-generates code from selected task and submits into samples store", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-010", name: "任务A", sample_count: "2", status: "已受理" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="sample-intake-task"]').setValue("SZH-2026-010");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="sample-intake-code"]').element.value).toBe("SZH-2026-010-SP-001");

    await wrapper.get('[data-testid="sample-intake-submit"]').trigger("click");
    await settle(wrapper);

    const storedSamples = getStorage(SAMPLES_KEY);
    expect(storedSamples).toHaveLength(1);
    expect(storedSamples[0]).toEqual(
      expect.objectContaining({
        code: "SZH-2026-010-SP-001",
        task_code: "SZH-2026-010",
        status: "运输中",
        flow_status: "运输中",
      }),
    );
  });

  test("sample intake draft keeps button semantics and also persists a transit sample", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-011", name: "任务B", sample_count: "1" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="sample-intake-task"]').setValue("SZH-2026-011");
    await settle(wrapper);
    await wrapper.get('[data-testid="sample-intake-draft"]').trigger("click");
    await settle(wrapper);

    const storedSamples = getStorage(SAMPLES_KEY);
    expect(storedSamples).toHaveLength(1);
    expect(storedSamples[0].code).toBe("SZH-2026-011-SP-001");
    expect(storedSamples[0].status).toBe("运输中");
  });

  test("confirming storage enables tray printing and persists sample trays", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "2" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-process-task-select"]').setValue("SZH-2026-001");
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-process-store"]').trigger("click");
    await settle(wrapper);

    const storedSamples = getStorage(SAMPLES_KEY);
    expect(storedSamples).toHaveLength(2);
    expect(storedSamples[0].trays?.length).toBeGreaterThan(0);

    const printButton = wrapper.get('[data-testid="samples-process-print"]');
    expect(printButton.attributes("disabled")).toBeUndefined();

    await printButton.trigger("click");
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  test("adding a tray expands the tray list for the selected task", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "4" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-process-task-select"]').setValue("SZH-2026-001");
    await settle(wrapper);

    expect(wrapper.findAll('.sample-tray-card[data-testid^="samples-process-tray-"]')).toHaveLength(2);

    await wrapper.get('[data-testid="samples-process-add-tray"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll('.sample-tray-card[data-testid^="samples-process-tray-"]')).toHaveLength(3);
    expect(wrapper.get('[data-testid="samples-process-tray-preview"]').element.value).toContain("SZH-2026-001-TP-003");
  });

  test("print stays disabled before confirm and tray limit change rebalances trays", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "4" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-process-task-select"]').setValue("SZH-2026-001");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="samples-process-print"]').attributes("disabled")).toBeDefined();

    await wrapper.get('[data-testid="samples-process-tray-limit"]').setValue("1");
    await settle(wrapper);

    expect(wrapper.findAll('.sample-tray-card[data-testid^="samples-process-tray-"]')).toHaveLength(4);
  });

  test("deleting a tray rebalances samples and renumbers tray sequence", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "4" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-process-task-select"]').setValue("SZH-2026-001");
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-process-add-tray"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll('.sample-tray-card[data-testid^="samples-process-tray-"]')).toHaveLength(3);

    await wrapper.get('[data-testid="samples-process-delete-tray-1"]').trigger("click");
    await settle(wrapper);

    const trays = wrapper.findAll('.sample-tray-card[data-testid^="samples-process-tray-"]');
    expect(trays).toHaveLength(2);
    expect(wrapper.get('[data-testid="samples-process-tray-preview"]').element.value).toContain("SZH-2026-001-TP-001");
    expect(wrapper.get('[data-testid="samples-process-tray-preview"]').element.value).toContain("SZH-2026-001-TP-002");
    expect(wrapper.get('[data-testid="samples-process-tray-preview"]').element.value).not.toContain("SZH-2026-001-TP-003");
  });

  test("confirming storage locks repartition controls and enables restore intake", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "4" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-process-task-select"]').setValue("SZH-2026-001");
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-process-store"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="samples-process-store"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="samples-process-add-tray"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="samples-process-tray-limit"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="samples-process-restore"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("当前状态：到货");
  });

  test("restoring intake unlocks tray editing and returns flow state to repartition", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "4" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-process-task-select"]').setValue("SZH-2026-001");
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-process-store"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-process-restore"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="samples-process-store"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-testid="samples-process-add-tray"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-testid="samples-process-tray-limit"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain("当前状态：运输中");
  });

  test("restoring intake disables tray printing until storage is confirmed again", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "4" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-process-task-select"]').setValue("SZH-2026-001");
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-process-store"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-process-restore"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="samples-process-print"]').attributes("disabled")).toBeDefined();
  });

  test("flow graph renders 11 fixed steps and highlights arrival after store and transit after restore", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "4" }]);
    setStorage(SAMPLES_KEY, []);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    expect(wrapper.findAll('[data-testid^="sample-flow-step-"]')).toHaveLength(11);
    expect(wrapper.get('[data-testid="sample-flow-step-sent_to_staging"]').text()).toBe("送至暂存间");
    expect(wrapper.get('[data-testid="sample-flow-step-arrived_staging"]').text()).toBe("已到达暂存间");
    expect(wrapper.get('[data-testid="sample-flow-step-sent_to_lab"]').text()).toBe("送至实验室");
    expect(wrapper.get('[data-testid="sample-flow-step-arrived_lab"]').text()).toBe("已到达实验室");
    expect(wrapper.get('[data-testid="sample-flow-step-fixture_install"]').text()).toBe("工装夹具安装");
    expect(wrapper.get('[data-testid="sample-flow-step-ready"]').text()).toBe("实验准备就绪");
    expect(wrapper.get('[data-testid="sample-flow-step-completed"]').text()).toBe("实验已完成");
    expect(wrapper.get('[data-testid="sample-flow-step-post_test_staging"]').text()).toBe("放置实验后暂存间");

    await wrapper.get('[data-testid="samples-process-task-select"]').setValue("SZH-2026-001");
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-process-store"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="sample-flow-step-arrived"]').classes()).toContain("current");
    expect(wrapper.get('[data-testid="sample-flow-step-in_transit"]').classes()).toContain("reached");

    await wrapper.get('[data-testid="samples-process-restore"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="sample-flow-step-in_transit"]').classes()).toContain("current");
    expect(wrapper.get('[data-testid="sample-flow-step-arrived"]').classes()).not.toContain("current");
  });

  test("sample flow search and filters update rows from Vue state", async () => {
    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "2" },
      { id: "task-2", code: "SZH-2026-002", name: "任务B", sample_count: "1" },
    ]);
    setStorage(SAMPLES_KEY, [
        { id: "sample-1", code: "SP-001", task_code: "SZH-2026-001", location: "接驳区", owner: "张三", status: "到货", trays: [] },
        { id: "sample-2", code: "SP-002", task_code: "SZH-2026-002", location: "振动一室", owner: "李四", status: "已到达实验室", trays: [] },
    ]);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-flow-search"]').setValue("SP-001");
    await settle(wrapper);

    expect(wrapper.text()).toContain("SP-001");
    expect(wrapper.text()).not.toContain("SP-002");

    await wrapper.get('[data-testid="samples-flow-task-filter"]').setValue("SZH-2026-001");
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-flow-status-filter"]').setValue("到货");
    await settle(wrapper);

    const tableText = wrapper.get('[data-testid="samples-flow-panel"]').text();
    expect(tableText).toContain("SP-001");
    expect(tableText).not.toContain("SP-002");
  });

  test("batch intake updates sample rows and detail drawer saves edits", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "1" }]);
    setStorage(SAMPLES_KEY, [
      { id: "sample-1", code: "SP-001", task_code: "SZH-2026-001", location: "", owner: "", status: "运输中", history: [], trays: [] },
    ]);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-flow-open-batch"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-flow-batch-location"]').setValue("接驳区");
    await wrapper.get('[data-testid="samples-flow-batch-owner"]').setValue("王工");
    await wrapper.get('[data-testid="samples-flow-batch-codes"]').setValue("SP-001");
    await wrapper.get('[data-testid="samples-flow-batch-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("接驳区");
    expect(wrapper.text()).toContain("王工");
    expect(wrapper.text()).toContain("到货");

    await wrapper.get('[data-testid="samples-flow-detail-0"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="samples-flow-detail-status"]').setValue("工装夹具安装");
    await wrapper.get('[data-testid="samples-flow-detail-remark"]').setValue("进入实验前检查完成");
    await wrapper.get('[data-testid="samples-flow-detail-save"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("工装夹具安装");
    const storedSamples = getStorage(SAMPLES_KEY);
    expect(storedSamples[0].history[0].detail).toBe("进入实验前检查完成");
  });

  test("staging dispatch updates selected samples to target lab and arrived-lab status", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "2" }]);
    setStorage(SAMPLES_KEY, [
      {
        id: "sample-1",
        code: "SP-001",
        task_code: "SZH-2026-001",
        location: "恒温恒湿间（暂存间）",
        owner: "张三",
        status: "已到达暂存间",
        flow_status: "已到达暂存间",
        history: [],
        trays: [],
      },
      {
        id: "sample-2",
        code: "SP-002",
        task_code: "SZH-2026-001",
        location: "恒温恒湿间（暂存间）",
        owner: "李四",
        status: "已到达暂存间",
        flow_status: "已到达暂存间",
        history: [],
        trays: [],
      },
    ]);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-staging-select-0"]').setValue(true);
    await wrapper.get('[data-testid="samples-staging-target-lab"]').setValue("振动一室");
    await wrapper.get('[data-testid="samples-staging-owner"]').setValue("王工");
    await wrapper.get('[data-testid="samples-staging-submit"]').trigger("click");
    await settle(wrapper);

    const storedSamples = getStorage(SAMPLES_KEY);
    expect(storedSamples[0].location).toBe("振动一室");
    expect(storedSamples[0].owner).toBe("王工");
    expect(storedSamples[0].status).toBe("已到达实验室");
    expect(storedSamples[0].flow_status).toBe("已到达实验室");
    expect(storedSamples[0].history[0].action).toBe("暂存间派发");
    expect(wrapper.text()).toContain("SP-002");
  });

  test("staging reset clears dispatch form inputs and row selections", async () => {
    setStorage(TASKS_KEY, [{ id: "task-1", code: "SZH-2026-001", name: "任务A", sample_count: "1" }]);
    setStorage(SAMPLES_KEY, [
      {
        id: "sample-1",
        code: "SP-001",
        task_code: "SZH-2026-001",
        location: "恒温恒湿间（暂存间）",
        owner: "张三",
        status: "已到达暂存间",
        history: [],
        trays: [],
      },
    ]);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="samples-staging-select-0"]').setValue(true);
    await wrapper.get('[data-testid="samples-staging-codes"]').setValue("SP-001");
    await wrapper.get('[data-testid="samples-staging-target-lab"]').setValue("振动一室");
    await wrapper.get('[data-testid="samples-staging-owner"]').setValue("王工");
    await wrapper.get('[data-testid="samples-staging-reset"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="samples-staging-codes"]').element.value).toBe("");
    expect(wrapper.get('[data-testid="samples-staging-target-lab"]').element.value).toBe("");
    expect(wrapper.get('[data-testid="samples-staging-owner"]').element.value).toBe("");
    expect(wrapper.get('[data-testid="samples-staging-select-0"]').element.checked).toBe(false);
  });

  test("switches between sample flow and staging tabs with Vue state", async () => {
    setStorage(SAMPLES_KEY, [
      {
        id: "sample-1",
        code: "SP-001",
        task_code: "SZH-2026-001",
        location: "恒温恒湿间（暂存间）",
        owner: "张三",
        status: "已到达暂存间",
        flow_status: "已到达暂存间",
        history: [],
        trays: [],
      },
    ]);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    expect(wrapper.get('[data-testid="samples-tab-flow"]').classes()).toContain("active");
    expect(wrapper.find('[data-testid="samples-flow-panel"]').classes()).not.toContain("is-hidden");
    expect(wrapper.find('[data-testid="samples-staging-panel"]').classes()).toContain("is-hidden");

    await wrapper.get('[data-testid="samples-tab-staging"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="samples-tab-staging"]').classes()).toContain("active");
    expect(wrapper.get('[data-testid="samples-tab-flow"]').classes()).not.toContain("active");
    expect(wrapper.find('[data-testid="samples-staging-panel"]').classes()).not.toContain("is-hidden");
    expect(wrapper.find('[data-testid="samples-flow-panel"]').classes()).toContain("is-hidden");
  });

  test("sample trace query renders summary and timeline from sample history and schedule events", async () => {
    setStorage(SAMPLES_KEY, [
      {
        id: "sample-1",
        code: "SP-001",
        task_code: "SZH-2026-020",
        location: "接驳区",
        owner: "张三",
        status: "到货",
        history: [
          {
            id: "evt-2",
            time: "2026-03-16T10:00:00.000Z",
            action: "送至暂存间",
            location: "恒温恒湿间（暂存间）",
            owner: "张三",
            status: "送至暂存间",
            detail: "",
          },
          {
            id: "evt-1",
            time: "2026-03-16T08:00:00.000Z",
            action: "样品登记",
            location: "接驳区",
            owner: "张三",
            status: "运输中",
            detail: "",
          },
        ],
      },
    ]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "SZH-2026-020",
        device: "振动一室",
        start_at: "2026-03-17T01:00:00.000Z",
        end_at: "2026-03-17T05:00:00.000Z",
        status: "已排程",
      },
    ]);

    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="sample-trace-task-code"]').setValue("SZH-2026-020");
    await wrapper.get('[data-testid="sample-trace-run"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="sample-trace-summary-text"]').text()).toContain("试验序号 SZH-2026-020：样品 1 个，流转记录 4 条。");
    const timelineText = wrapper.get('[data-testid="sample-trace-timeline-list"]').text();
    expect(timelineText).toContain("SP-001 · 样品登记");
    expect(timelineText).toContain("SP-001 · 送至暂存间");
    expect(timelineText).toContain("SZH-2026-020 · 排程开始");
    expect(timelineText).toContain("SZH-2026-020 · 排程结束");
  });

  test("sample trace reset clears query and restores default prompt", async () => {
    const wrapper = mount(SamplesPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="sample-trace-task-code"]').setValue("SZH-2026-020");
    await wrapper.get('[data-testid="sample-trace-run"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="sample-trace-reset"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="sample-trace-task-code"]').element.value).toBe("");
    expect(wrapper.get('[data-testid="sample-trace-summary-text"]').text()).toBe("请输入试验序号查询样品全生命周期。");
    expect(wrapper.get('[data-testid="sample-trace-timeline-list"]').text()).toBe("");
  });
});
