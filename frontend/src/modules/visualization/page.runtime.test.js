import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";

import VisualizationPage from "./page.vue";

const { REAL_DEVICE_LEDGER, snapshotState } = vi.hoisted(() => ({
  REAL_DEVICE_LEDGER: [
    { code: "振动一室", status: "可用" },
    { code: "高低温湿热一室", status: "可用" },
    { code: "盐雾试验室", status: "可用" },
    { code: "冲击一室", status: "可用" },
    { code: "霉菌试验室", status: "可用" },
    { code: "四综合实验室", status: "可用" },
    { code: "冲击二室", status: "可用" },
    { code: "温度冲击二室", status: "可用" },
    { code: "温度冲击一室", status: "可用" },
    { code: "振动二室", status: "可用" },
  ],
  snapshotState: {
    refreshRegistrations: [],
    snapshot: {},
  },
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: vi.fn(() => ({
      "mes.devices": REAL_DEVICE_LEDGER,
      ...snapshotState.snapshot,
    })),
  }),
}));

vi.mock("@/composables/useStorageSnapshotRefresh", () => ({
  useStorageSnapshotRefresh: vi.fn((options) => {
    snapshotState.refreshRegistrations.push(options);
    return {
      flushPendingRefresh: vi.fn(),
      hasPendingRefresh: { value: false },
      stop: vi.fn(),
    };
  }),
}));

const mountPage = () => mount(VisualizationPage);

const buildFourActiveLabSnapshot = () => {
  const activeLabs = [
    { lab: "振动一室", task: "TASK-VIB-A", experiment: "EXP-VIB-A", tray: "TRAY-VIB-A" },
    { lab: "盐雾试验室", task: "TASK-SALT-A", experiment: "EXP-SALT-A", tray: "TRAY-SALT-A" },
    { lab: "冲击一室", task: "TASK-IMPACT-A", experiment: "EXP-IMPACT-A", tray: "TRAY-IMPACT-A" },
    { lab: "霉菌试验室", task: "TASK-MOLD-A", experiment: "EXP-MOLD-A", tray: "TRAY-MOLD-A" },
  ];
  return {
    "mes.tasks": activeLabs.map((item) => ({ code: item.task, name: `${item.lab}任务` })),
    "mes.experiments": activeLabs.map((item) => ({
      task_code: item.task,
      experiment_code: item.experiment,
      experiment_name: `${item.lab}试验`,
      required_device: item.lab,
    })),
    "mes.experiment_trays": activeLabs.map((item) => ({
      task_code: item.task,
      experiment_code: item.experiment,
      tray_code: item.tray,
    })),
    "mes.schedules": activeLabs.map((item) => ({
      task_code: item.task,
      experiment_code: item.experiment,
      device: item.lab,
      status: "实验进行中",
    })),
    "mes.samples": activeLabs.map((item) => ({
      code: `${item.task}-SAMPLE-001`,
      task_code: item.task,
      location: item.lab,
      status: "实验进行中",
      trays: [{ tray_code: item.tray, status: "实验进行中", quantity: 1 }],
    })),
  };
};

const buildSingleRunningLabSnapshot = () => ({
  "mes.tasks": [{ code: "TASK-VIS-001", name: "可视化真实任务" }],
  "mes.experiments": [
    { task_code: "TASK-VIS-001", experiment_code: "EXP-VIB", experiment_name: "振动试验", required_device: "振动一室" },
  ],
  "mes.experiment_trays": [
    { task_code: "TASK-VIS-001", experiment_code: "EXP-VIB", tray_code: "TRAY-VIS-001" },
  ],
  "mes.schedules": [
    { task_code: "TASK-VIS-001", experiment_code: "EXP-VIB", device: "振动一室", status: "实验进行中" },
  ],
  "mes.samples": [
    {
      code: "SAMPLE-VIS-001",
      task_code: "TASK-VIS-001",
      location: "振动一室",
      status: "实验进行中",
      trays: [{ tray_code: "TRAY-VIS-001", status: "实验进行中", quantity: 1 }],
      history: [
        { status: "到货", time: "2026-05-22T09:00:00+08:00" },
        { detail: "TASK-VIS-001 / 振动试验 / 实验进行中", time: "2026-05-22T10:00:00+08:00" },
      ],
    },
  ],
});

describe("VisualizationPage runtime", () => {
  beforeEach(() => {
    snapshotState.refreshRegistrations = [];
    snapshotState.snapshot = {};
  });

  test("subscribes to realtime snapshot updates for visualization data", () => {
    mountPage();

    expect(snapshotState.refreshRegistrations).toHaveLength(1);
    expect(snapshotState.refreshRegistrations[0].keys).toEqual(expect.arrayContaining([
      "mes.tasks",
      "mes.samples",
      "mes.experiments",
      "mes.experiment_runs",
      "mes.experiment_trays",
      "mes.schedules",
      "mes.devices",
      "mes.staging_events",
    ]));
  });

  test("renders eight non-interactive screen thumbnails", async () => {
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    const cards = wrapper.findAll('[data-testid="visual-screen-card"]');

    expect(cards).toHaveLength(8);
    expect(cards[0].attributes("aria-label")).toContain("实验室流程监控屏");
    expect(cards[0].findAll(".visual-lab-panel")).toHaveLength(2);
    expect(cards[0].find("select").exists()).toBe(false);
    expect(cards[0].find('[data-testid="visual-lab-select"]').exists()).toBe(false);
  });

  test("uses screens one and five together to show the four most active laboratory process panels", async () => {
    snapshotState.snapshot = buildFourActiveLabSnapshot();
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll('[data-testid="visual-screen-card"]');
    const firstScreenLabNames = cards[0].findAll(".visual-lab-name").map((name) => name.text());
    const fifthScreenLabNames = cards[4].findAll(".visual-lab-name").map((name) => name.text());
    const displayedLabNames = [...firstScreenLabNames, ...fifthScreenLabNames];

    expect(cards[4].text()).toContain("实验室流程监控屏B组");
    expect(cards[4].findAll(".visual-lab-panel")).toHaveLength(2);
    expect(firstScreenLabNames).toEqual(["振动一室", "盐雾试验室"]);
    expect(fifthScreenLabNames).toEqual(["冲击一室", "霉菌试验室"]);
    expect(new Set(displayedLabNames).size).toBe(4);
    expect(cards[4].text()).not.toContain("今日任务计划总览屏");
    expect(cards[4].text()).not.toContain("SYLU-2026-0524-001");

    await cards[4].trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    expect(preview.findAll(".visual-lab-panel")).toHaveLength(2);
    expect(preview.text()).toContain("冲击一室");
    expect(preview.text()).toContain("霉菌试验室");
    expect(preview.text()).toContain("TRAY-IMPACT-A");
    expect(preview.text()).toContain("TRAY-MOLD-A");
  });

  test("moves the original fifth-screen today task plan board onto the third screen", async () => {
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const thirdCard = wrapper.findAll('[data-testid="visual-screen-card"]')[2];

    expect(thirdCard.text()).toContain("今日任务计划总览屏");
    expect(thirdCard.text()).toContain("SYLU-2026-0524-001");
    expect(thirdCard.text()).toContain("冲击试验");
    expect(thirdCard.text()).toContain("振动试验");
    expect(thirdCard.text()).not.toContain("18 项计划");

    await thirdCard.trigger("click");

    const previewText = wrapper.find('[data-testid="visual-single-preview"]').text();
    expect(previewText).toContain("方案A");
    expect(previewText).not.toContain("方案B");
    expect(previewText).not.toContain("方案C");
    expect(previewText).toContain("任务编号");
    expect(previewText).not.toContain("任务名称");
    expect(previewText).not.toContain("结构可靠性联合验证");
    expect(previewText).toContain("SYLU-2026-0524-001");
    expect(previewText).toContain("09:00-11:30");
    expect(previewText).toContain("冲击一室");
    expect(previewText).toContain("13:00-16:00");
    expect(previewText).toContain("振动一室");
    expect(previewText).toContain("TP-001");
    expect(previewText).toContain("TP-003");
    expect(previewText).toContain("8件");
  });

  test("compresses laboratory process flow steps in thumbnails", async () => {
    snapshotState.snapshot = buildSingleRunningLabSnapshot();
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const firstCard = wrapper.findAll('[data-testid="visual-screen-card"]')[0];
    const thumbnailSteps = firstCard.findAll(".visual-flow-step");

    await firstCard.trigger("click");

    const expandedSteps = wrapper.find('[data-testid="visual-single-preview"]').findAll(".visual-flow-step");
    expect(expandedSteps.length).toBeGreaterThan(9);
    expect(thumbnailSteps.length).toBeLessThan(expandedSteps.length);
    expect(thumbnailSteps.length).toBeLessThanOrEqual(9);
  });

  test("excludes laboratories already shown on the companion lab process screen when switching screen five", async () => {
    snapshotState.snapshot = buildFourActiveLabSnapshot();
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[4].trigger("click");
    await wrapper.get('[data-testid="visual-lab-cycle-primary"]').trigger("click");

    const picker = wrapper.get('[data-testid="visual-lab-picker"]');
    const optionText = picker.text();
    expect(optionText).toContain("冲击一室");
    expect(optionText).toContain("高低温湿热一室");
    expect(optionText).not.toContain("振动一室");
    expect(optionText).not.toContain("盐雾试验室");
    expect(optionText).not.toContain("霉菌试验室");

    const replacement = wrapper.findAll('[data-testid="visual-lab-picker-option"]').find((option) => option.text().includes("高低温湿热一室"));
    expect(replacement).toBeTruthy();
    await replacement.trigger("click");

    const fifthPreviewText = wrapper.find('[data-testid="visual-single-preview"]').text();
    expect(fifthPreviewText).toContain("高低温湿热一室");
    expect(fifthPreviewText).toContain("霉菌试验室");
    expect(fifthPreviewText).not.toContain("振动一室");
    expect(fifthPreviewText).not.toContain("盐雾试验室");
  });

  test("renders an operations summary and numbered screen metadata", () => {
    const wrapper = mountPage();

    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toContain("在线屏幕");
    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toContain("8/8");
    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toMatch(/监控试验间\d+/);
    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toContain("运行任务0");
    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toContain("托盘流程0");

    const cards = wrapper.findAll('[data-testid="visual-screen-card"]');

    expect(cards[0].text()).toContain("01");
    expect(cards[0].text()).toContain("运行中");
    expect(cards[7].text()).toContain("08");
  });

  test("opens a single-screen enlargement and switches labs through an in-screen picker", async () => {
    const wrapper = mountPage();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[0].trigger("click");

    expect(wrapper.find('[data-testid="visual-single-preview"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="visual-single-preview"]').findAll(".visual-lab-panel")).toHaveLength(2);
    expect(wrapper.find('[data-testid="visual-single-preview"]').find(".visual-preview-header").exists()).toBe(false);
    expect(wrapper.find('[data-testid="visual-single-preview"]').find(".visual-lab-switch").exists()).toBe(false);

    await wrapper.get('[data-testid="visual-lab-cycle-primary"]').trigger("click");

    const picker = wrapper.get('[data-testid="visual-lab-picker"]');

    expect(picker.text()).toContain("选择上方试验间");

    const nextOption = wrapper.findAll('[data-testid="visual-lab-picker-option"]').find((option) => !option.classes().includes("is-selected"));
    expect(nextOption).toBeTruthy();
    const nextLabName = nextOption.find("span").text();
    await nextOption.trigger("click");

    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain(nextLabName);
    const selectedLabNames = wrapper.find('[data-testid="visual-single-preview"]').findAll(".visual-lab-name").map((name) => name.text());
    expect(new Set(selectedLabNames).size).toBe(selectedLabNames.length);
    expect(wrapper.find('[data-testid="visual-lab-picker"]').exists()).toBe(false);
  });

  test("prioritizes laboratories with active task information on the first screen", async () => {
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-SALT-001", name: "盐雾优先任务" },
        { code: "TASK-MOLD-001", name: "霉菌优先任务" },
      ],
      "mes.experiments": [
        { task_code: "TASK-SALT-001", experiment_code: "EXP-SALT", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: "TASK-MOLD-001", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验", required_device: "霉菌试验室" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-SALT-001", experiment_code: "EXP-SALT", tray_code: "TRAY-SALT-001" },
        { task_code: "TASK-MOLD-001", experiment_code: "EXP-MOLD", tray_code: "TRAY-MOLD-001" },
      ],
      "mes.schedules": [
        { task_code: "TASK-SALT-001", experiment_code: "EXP-SALT", device: "盐雾试验室", status: "实验进行中" },
        { task_code: "TASK-MOLD-001", experiment_code: "EXP-MOLD", device: "霉菌试验室", status: "实验进行中" },
      ],
      "mes.samples": [
        {
          code: "SAMPLE-SALT-001",
          task_code: "TASK-SALT-001",
          location: "盐雾试验室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-SALT-001", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SAMPLE-MOLD-001",
          task_code: "TASK-MOLD-001",
          location: "霉菌试验室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-MOLD-001", status: "实验进行中", quantity: 1 }],
        },
      ],
    };
    const wrapper = mountPage();

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const firstCardText = wrapper.findAll('[data-testid="visual-screen-card"]')[0].text();
    expect(firstCardText).toContain("盐雾试验室");
    expect(firstCardText).toContain("霉菌试验室");
    expect(firstCardText).not.toContain("振动一室");
    expect(firstCardText).not.toContain("高低温湿热一室");
  });

  test("closes the single-screen enlargement when clicking the blank overlay only", async () => {
    const wrapper = mountPage();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[4].trigger("click");
    expect(wrapper.find('[data-testid="visual-single-preview"]').exists()).toBe(true);

    await wrapper.get(".visual-preview-shell").trigger("click");
    expect(wrapper.find('[data-testid="visual-single-preview"]').exists()).toBe(true);

    await wrapper.get('[data-testid="visual-single-preview"]').trigger("click");
    expect(wrapper.find('[data-testid="visual-single-preview"]').exists()).toBe(false);
  });

  test("does not render demo task or tray identifiers when no real snapshot data exists", async () => {
    const wrapper = mountPage();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.findAll('[data-testid="visual-screen-card"]')[0].trigger("click");

    const previewText = wrapper.find('[data-testid="visual-single-preview"]').text();
    const summaryText = wrapper.get('[data-testid="visual-operations-summary"]').text();

    expect(previewText).toContain("暂无托盘");
    expect(previewText).not.toContain("SYLU-2026-0522");
    expect(previewText).not.toContain("TRAY-DEMO");
    expect(summaryText).toContain("运行任务0");
    expect(summaryText).toContain("托盘流程0");
  });

  test("renders real tray flow for selected labs in the first screen", async () => {
    snapshotState.snapshot = buildSingleRunningLabSnapshot();
    const wrapper = mountPage();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.findAll('[data-testid="visual-screen-card"]')[0].trigger("click");

    const previewText = wrapper.find('[data-testid="visual-single-preview"]').text();

    expect(previewText).toContain("TRAY-VIS-001");
    expect(previewText).toContain("TASK-VIS-001");
    const flowHead = wrapper.find('[data-testid="visual-single-preview"] .visual-tray-flow-head');
    expect(flowHead.get("strong").text()).toBe("任务编号：TASK-VIS-001");
    expect(flowHead.get("span").text()).toBe("托盘编号：TRAY-VIS-001");
    expect(previewText).toContain("样品运输中");
    expect(previewText).toContain("振动试验进行中");
    expect(previewText).toContain("到货");
    expect(previewText).not.toContain("05-22 10:00:00");
    expect(previewText).not.toContain("+08:00");
    expect(previewText).not.toContain("任务下发");

    const flowSteps = wrapper.findAll('[data-testid="visual-single-preview"] .visual-flow-step');
    const runningStep = flowSteps.find((step) => step.get("strong").text() === "振动试验进行中");
    const stagingStep = flowSteps.find((step) => step.get("strong").text() === "送至暂存间");
    expect(runningStep?.classes()).toContain("is-active");
    expect(runningStep?.attributes("title")).toBe("05-22 10:00:00");
    expect(stagingStep?.classes()).toContain("is-inferred");
    expect(stagingStep?.attributes("title")).toBe("推导节点，暂无实际时间记录");
  });

  test("switches tasks and trays inside the enlarged first screen", async () => {
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-LAB-A", name: "振动任务A" },
        { code: "TASK-LAB-B", name: "振动任务B" },
      ],
      "mes.experiments": [
        { task_code: "TASK-LAB-A", experiment_code: "EXP-LAB-A", experiment_name: "振动试验A", required_device: "振动一室" },
        { task_code: "TASK-LAB-B", experiment_code: "EXP-LAB-B", experiment_name: "振动试验B", required_device: "振动一室" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-LAB-A", experiment_code: "EXP-LAB-A", tray_code: "TRAY-A-001" },
        { task_code: "TASK-LAB-A", experiment_code: "EXP-LAB-A", tray_code: "TRAY-A-002" },
        { task_code: "TASK-LAB-B", experiment_code: "EXP-LAB-B", tray_code: "TRAY-B-001" },
      ],
      "mes.schedules": [
        { task_code: "TASK-LAB-A", experiment_code: "EXP-LAB-A", device: "振动一室", status: "实验进行中" },
        { task_code: "TASK-LAB-B", experiment_code: "EXP-LAB-B", device: "振动一室", status: "实验准备就绪" },
      ],
      "mes.samples": [
        {
          code: "SAMPLE-A-001",
          task_code: "TASK-LAB-A",
          location: "振动一室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-A-001", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SAMPLE-A-002",
          task_code: "TASK-LAB-A",
          location: "振动一室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TRAY-A-002", status: "实验准备就绪", quantity: 1 }],
        },
        {
          code: "SAMPLE-B-001",
          task_code: "TASK-LAB-B",
          location: "振动一室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TRAY-B-001", status: "实验准备就绪", quantity: 1 }],
        },
      ],
    };
    const wrapper = mountPage();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.findAll('[data-testid="visual-screen-card"]')[0].trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    expect(preview.find(".visual-board").classes()).toContain("is-layout-a");
    expect(preview.find('[data-testid="visual-lab-layout-option"]').exists()).toBe(false);

    expect(preview.text()).toContain("任务切换");
    expect(preview.text()).toContain("托盘切换");
    expect(preview.text()).toContain("TRAY-A-001");
    expect(preview.text()).toContain("任务编号：TASK-LAB-A");
    expect(preview.text()).toContain("托盘编号：TRAY-A-001");

    const taskB = preview.findAll('[data-testid="visual-lab-task-option"]').find((option) => option.text().includes("TASK-LAB-B"));
    expect(taskB).toBeTruthy();
    await taskB.trigger("click");
    expect(preview.text()).toContain("任务编号：TASK-LAB-B");
    expect(preview.text()).toContain("TRAY-B-001");
    expect(preview.text()).toContain("托盘编号：TRAY-B-001");

    const taskA = preview.findAll('[data-testid="visual-lab-task-option"]').find((option) => option.text().includes("TASK-LAB-A"));
    expect(taskA).toBeTruthy();
    await taskA.trigger("click");

    const trayA2 = preview.findAll('[data-testid="visual-lab-tray-option"]').find((option) => option.text().includes("TRAY-A-002"));
    expect(trayA2).toBeTruthy();
    await trayA2.trigger("click");
    expect(preview.text()).toContain("托盘编号：TRAY-A-002");
  });

  test("renders the second screen as a real three-day laboratory schedule view", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T10:00:00+08:00"));
    snapshotState.snapshot = {
      "mes.tasks": [{ code: "TASK-SCH-001", name: "三日排程任务", test_type: "振动试验" }],
      "mes.experiments": [
        { task_code: "TASK-SCH-001", experiment_code: "EXP-SCH-VIB", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-SCH-001", experiment_code: "EXP-SCH-VIB", tray_code: "TP-SCH-001" },
      ],
      "mes.schedules": [
        {
          id: "schedule-sch-001",
          task_code: "TASK-SCH-001",
          experiment_code: "EXP-SCH-VIB",
          device: "振动一室",
          start_at: "2026-05-23T08:00:00+08:00",
          end_at: "2026-05-23T12:00:00+08:00",
          status: "已排程",
        },
        {
          id: "schedule-sch-outside",
          task_code: "TASK-SCH-OUTSIDE",
          experiment_code: "EXP-SCH-OUTSIDE",
          device: "振动一室",
          start_at: "2026-05-26T08:00:00+08:00",
          end_at: "2026-05-26T12:00:00+08:00",
          status: "已排程",
        },
      ],
      "mes.samples": [
        {
          code: "SP-SCH-001",
          task_code: "TASK-SCH-001",
          status: "实验进行中",
          trays: [{ tray_code: "TP-SCH-001", status: "实验进行中", quantity: 1 }],
        },
      ],
    };

    try {
      const wrapper = mountPage();

      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const secondCard = wrapper.findAll('[data-testid="visual-screen-card"]')[1];
      expect(secondCard.text()).toContain("三日实验室排期屏");
      expect(secondCard.text()).toContain("5/23");
      expect(secondCard.text()).toContain("5/24");
      expect(secondCard.text()).toContain("5/25");
      expect(secondCard.text()).not.toContain("今天");
      expect(secondCard.text()).not.toContain("明天");
      expect(secondCard.text()).not.toContain("后天");
      secondCard.findAll(".visual-schedule-day").forEach((day) => {
        expect(day.find("span").exists()).toBe(false);
        expect(day.find("strong").exists()).toBe(true);
        expect(day.find("small").exists()).toBe(true);
      });
      expect(secondCard.text()).toContain("TASK-SCH-001");
      expect(secondCard.text()).not.toContain("12 台设备");
      expect(secondCard.text()).not.toContain("TASK-SCH-OUTSIDE");

      await secondCard.trigger("click");

      const previewText = wrapper.find('[data-testid="visual-single-preview"]').text();
      expect(wrapper.get(".visual-schedule-grid").attributes("style")).toContain("--visual-schedule-row-count");
      expect(previewText).toContain("振动试验");
      expect(previewText).toContain("08:00-12:00");
      expect(previewText).toContain("进行中");
      expect(previewText).not.toContain("已排程");
      const runningSlot = wrapper.find('[data-testid="visual-single-preview"] .visual-schedule-slot.state-running');
      expect(runningSlot.exists()).toBe(true);
      expect(runningSlot.find(".visual-schedule-slot-state").exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("shows maintenance devices as maintenance in the enlarged schedule screen", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T10:00:00+08:00"));
    snapshotState.snapshot = {
      "mes.devices": [
        { code: "冲击一室", name: "冲击一室", status: "维护/校准" },
      ],
      "mes.experiment_trays": [],
      "mes.experiments": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.tasks": [],
    };

    try {
      const wrapper = mountPage();

      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const secondCard = wrapper.findAll('[data-testid="visual-screen-card"]')[1];
      expect(secondCard.text()).toContain("三日实验室排期屏");
      expect(secondCard.text()).toContain("维护中");

      await secondCard.trigger("click");

      const preview = wrapper.find('[data-testid="visual-single-preview"]');
      expect(preview.text()).toContain("冲击一室");
      expect(preview.text()).toContain("维护中");
      expect(preview.find(".visual-schedule-slot.state-maintenance").exists()).toBe(true);
      expect(preview.find(".visual-schedule-slot.state-maintenance").text()).toBe("维护中");
    } finally {
      vi.useRealTimers();
    }
  });

  test("switches the enlarged schedule screen date window with arrow buttons", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T10:00:00+08:00"));
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-SCH-001", name: "今日任务", test_type: "振动试验" },
        { code: "TASK-SCH-026", name: "后移窗口任务", test_type: "振动试验" },
      ],
      "mes.experiments": [
        { task_code: "TASK-SCH-001", experiment_code: "EXP-SCH-VIB", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: "TASK-SCH-026", experiment_code: "EXP-SCH-NEXT", experiment_name: "后移窗口振动", required_device: "振动一室" },
      ],
      "mes.experiment_trays": [],
      "mes.schedules": [
        {
          id: "schedule-sch-001",
          task_code: "TASK-SCH-001",
          experiment_code: "EXP-SCH-VIB",
          device: "振动一室",
          start_at: "2026-05-23T08:00:00+08:00",
          end_at: "2026-05-23T12:00:00+08:00",
          status: "已排程",
        },
        {
          id: "schedule-sch-026",
          task_code: "TASK-SCH-026",
          experiment_code: "EXP-SCH-NEXT",
          device: "振动一室",
          start_at: "2026-05-26T08:00:00+08:00",
          end_at: "2026-05-26T12:00:00+08:00",
          status: "已排程",
        },
      ],
      "mes.samples": [],
    };

    try {
      const wrapper = mountPage();

      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const secondCard = wrapper.findAll('[data-testid="visual-screen-card"]')[1];
      expect(secondCard.find('[data-testid="visual-schedule-next"]').exists()).toBe(false);

      await secondCard.trigger("click");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TASK-SCH-001");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).not.toContain("TASK-SCH-026");

      await wrapper.get('[data-testid="visual-schedule-next"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TASK-SCH-026");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("5/26");

      await wrapper.get('[data-testid="visual-schedule-today"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TASK-SCH-001");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("5/23");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).not.toContain("TASK-SCH-026");

      await wrapper.get('[data-testid="visual-schedule-next"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TASK-SCH-026");

      await wrapper.get('[data-testid="visual-schedule-prev"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TASK-SCH-001");
    } finally {
      vi.useRealTimers();
    }
  });

  test("renders the fifth screen as the secondary laboratory process board", async () => {
    snapshotState.snapshot = buildFourActiveLabSnapshot();
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    const fifthCard = wrapper.findAll('[data-testid="visual-screen-card"]')[4];

    expect(fifthCard.text()).toContain("实验室流程监控屏B组");
    expect(fifthCard.findAll(".visual-lab-panel")).toHaveLength(2);
    expect(fifthCard.text()).toContain("冲击一室");
    expect(fifthCard.text()).toContain("霉菌试验室");
    expect(fifthCard.text()).toContain("TRAY-IMPACT-A");
    expect(fifthCard.text()).toContain("TRAY-MOLD-A");
    expect(fifthCard.text()).not.toContain("今日任务计划总览屏");
    expect(fifthCard.text()).not.toContain("SYLU-2026-0524-001");
    expect(fifthCard.text()).not.toContain("合格率趋势屏");
    expect(fifthCard.text()).not.toContain("97.3%");

    await fifthCard.trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    const previewText = preview.text();
    expect(preview.find(".visual-board").classes()).toContain("is-layout-a");
    expect(preview.findAll(".visual-lab-panel")).toHaveLength(2);
    expect(previewText).toContain("任务切换");
    expect(previewText).toContain("托盘切换");
    expect(previewText).toContain("冲击一室");
    expect(previewText).toContain("霉菌试验室");
    expect(previewText).toContain("任务编号：TASK-IMPACT-A");
    expect(previewText).toContain("任务编号：TASK-MOLD-A");
  });

  test("renders the sixth screen as a staging sample board with task tray switching and all-samples modal", async () => {
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-STAGING-001", name: "盐雾暂存任务", test_type: "盐雾试验" },
        { code: "TASK-STAGING-002", name: "霉菌暂存任务", test_type: "霉菌试验" },
      ],
      "mes.experiments": [
        { task_code: "TASK-STAGING-001", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" },
        { task_code: "TASK-STAGING-002", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-STAGING-001", experiment_code: "EXP-SALT", tray_code: "TRAY-SALT-001" },
        { task_code: "TASK-STAGING-002", experiment_code: "EXP-MOLD", tray_code: "TRAY-MOLD-001" },
      ],
      "mes.staging_events": [
        { tray_code: "TRAY-SALT-001", task_code: "TASK-STAGING-001", action: "stock_in", time: "2026-05-28T08:00:00+08:00" },
        { tray_code: "TRAY-MOLD-001", task_code: "TASK-STAGING-002", action: "stock_in", time: "2026-05-28T08:05:00+08:00" },
      ],
      "mes.samples": [
        ...Array.from({ length: 6 }, (_, index) => ({
          code: `SALT-SAMPLE-00${index + 1}`,
          task_code: "TASK-STAGING-001",
          location: "恒温恒湿间（暂存间）",
          status: "已入库",
          trays: [{ tray_code: "TRAY-SALT-001", status: "已入库", quantity: 1 }],
        })),
        {
          code: "MOLD-SAMPLE-001",
          task_code: "TASK-STAGING-002",
          location: "恒温恒湿间（暂存间）",
          status: "实验后暂存间存放",
          trays: [{ tray_code: "TRAY-MOLD-001", status: "实验后暂存间存放", quantity: 1 }],
        },
      ],
    };
    const wrapper = mountPage();

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const sixthCard = wrapper.findAll('[data-testid="visual-screen-card"]')[5];
    expect(sixthCard.text()).toContain("暂存间/外观检测间样品信息屏");
    expect(sixthCard.text()).toContain("托盘剩余");

    await sixthCard.trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    expect(preview.text()).toContain("任务切换");
    expect(preview.text()).toContain("托盘切换");
    expect(preview.text()).toContain("TASK-STAGING-001");
    expect(preview.text()).toContain("TRAY-SALT-001");
    expect(preview.text()).toContain("SALT-SAMPLE-005");
    expect(preview.text()).not.toContain("SALT-SAMPLE-006");
    expect(preview.text()).toContain("全部样品");
    expect(preview.get('[data-testid="visual-staging-overview"]').text()).toContain("当前任务2");
    expect(preview.get('[data-testid="visual-staging-overview"]').text()).toContain("暂存托盘2");
    expect(preview.get('[data-testid="visual-staging-overview"]').text()).toContain("样品总数7");
    expect(preview.text()).toContain("托盘剩余8");
    expect(preview.text()).toContain("已用托盘 2");
    expect(preview.text()).toContain("盐雾剩余99");
    expect(preview.text()).toContain("已用盐量 1");
    expect(preview.text()).not.toContain("盐雾托盘");
    expect(preview.text()).toContain("霉菌剩余99");
    expect(preview.text()).toContain("已用菌体 1");
    expect(preview.text()).not.toContain("霉菌托盘");
    expect(preview.findAll('[data-testid="visual-staging-capacity-card"]')[0].findAll(".visual-staging-capacity-tick")).toHaveLength(10);
    expect(preview.findAll('[data-testid="visual-staging-capacity-card"]')[0].findAll(".visual-staging-capacity-tick.is-active")).toHaveLength(8);

    await wrapper.get('[data-testid="visual-staging-all-samples"]').trigger("click");
    expect(wrapper.get('[data-testid="visual-staging-sample-modal"]').text()).toContain("SALT-SAMPLE-006");

    await wrapper.get('[data-testid="visual-staging-modal-close"]').trigger("click");
    await wrapper.findAll('[data-testid="visual-staging-task-option"]')[1].trigger("click");

    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TRAY-MOLD-001");
    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("MOLD-SAMPLE-001");
  });

  test("renders staging legend and distinct staging kind styles", async () => {
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-STAGING-KINDS", name: "暂存分类任务", test_type: "盐雾试验" },
      ],
      "mes.samples": [
        {
          code: "SP-CURRENT",
          task_code: "TASK-STAGING-KINDS",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [{ tray_code: "TP-CURRENT", status: "已到达暂存间", quantity: 1 }],
        },
        {
          code: "SP-PLANNED",
          task_code: "TASK-STAGING-KINDS",
          location: "室外接驳区",
          status: "送至暂存间",
          trays: [{ tray_code: "TP-PLANNED", status: "送至暂存间", quantity: 1 }],
        },
        {
          code: "SP-POST",
          task_code: "TASK-STAGING-KINDS",
          location: "恒温恒湿间（实验后暂存间）",
          status: "实验后暂存间存放",
          trays: [{ tray_code: "TP-POST", status: "实验后暂存间存放", quantity: 1 }],
        },
      ],
    };
    const wrapper = mountPage();

    await Promise.resolve();
    await wrapper.vm.$nextTick();
    await wrapper.findAll('[data-testid="visual-screen-card"]')[5].trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    const overview = preview.get('[data-testid="visual-staging-overview"]');
    const kindSummary = preview.get('[data-testid="visual-staging-kind-summary"]');
    expect(overview.text()).toContain("暂存间存放/计划暂存/实验后暂存/外观检测间存放");
    expect(kindSummary.text()).toContain("1/1/1/0");
    expect(kindSummary.find(".kind-planned").exists()).toBe(true);
    expect(kindSummary.find(".kind-post-test").exists()).toBe(true);
    expect(preview.find('[data-testid="visual-staging-legend"]').exists()).toBe(false);

    const trayOptions = preview.findAll('[data-testid="visual-staging-tray-option"]');
    expect(trayOptions.some((option) => option.classes().includes("kind-planned"))).toBe(true);
    expect(trayOptions.some((option) => option.classes().includes("kind-post-test"))).toBe(true);

    await trayOptions.find((option) => option.text().includes("TP-POST"))?.trigger("click");

    expect(preview.find(".visual-staging-tray-detail").classes()).toContain("kind-post-test");
    expect(preview.find(".visual-staging-sample-code").classes()).toContain("kind-post-test");
  });

  test("shows a red warning marker when tray remaining is at or below ten percent", async () => {
    snapshotState.snapshot = {
      "mes.tasks": [{ code: "TASK-STAGING-LOW", name: "低库存暂存任务", test_type: "盐雾试验" }],
      "mes.experiments": [{ task_code: "TASK-STAGING-LOW", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" }],
      "mes.experiment_trays": [{ task_code: "TASK-STAGING-LOW", experiment_code: "EXP-SALT", tray_code: "LOW-TP-001" }],
      "mes.staging_events": [{ tray_code: "LOW-TP-001", task_code: "TASK-STAGING-LOW", action: "stock_in", time: "2026-05-28T08:00:00+08:00" }],
      "mes.samples": Array.from({ length: 9 }, (_, index) => ({
        code: `LOW-SAMPLE-${String(index + 1).padStart(3, "0")}`,
        task_code: index === 0 ? "TASK-STAGING-LOW" : `TASK-USED-${index}`,
        location: index === 0 ? "恒温恒湿间（暂存间）" : "盐雾试验室",
        status: index === 0 ? "已入库" : "实验进行中",
        trays: [{ tray_code: `LOW-TP-${String(index + 1).padStart(3, "0")}`, status: index === 0 ? "已入库" : "实验进行中", quantity: 1 }],
      })),
    };
    const wrapper = mountPage();

    await Promise.resolve();
    await wrapper.vm.$nextTick();
    await wrapper.findAll('[data-testid="visual-screen-card"]')[5].trigger("click");

    const trayCapacityCard = wrapper.find('[data-testid="visual-single-preview"]').findAll('[data-testid="visual-staging-capacity-card"]')[0];
    expect(trayCapacityCard.text()).toContain("托盘剩余1");
    expect(trayCapacityCard.findAll(".visual-staging-capacity-tick.is-active")).toHaveLength(1);
    expect(trayCapacityCard.get('[data-testid="visual-staging-capacity-alert"]').text()).toContain("!");
    expect(trayCapacityCard.text()).toContain("托盘库存不足");
  });

  test("applies low-stock segmented warnings to salt spray and mold remaining metrics", async () => {
    const saltTrays = Array.from({ length: 90 }, (_, index) => `SALT-LOW-${String(index + 1).padStart(3, "0")}`);
    const moldTrays = Array.from({ length: 90 }, (_, index) => `MOLD-LOW-${String(index + 1).padStart(3, "0")}`);

    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-SALT-LOW", name: "盐雾低余量任务", test_type: "盐雾试验" },
        { code: "TASK-MOLD-LOW", name: "霉菌低余量任务", test_type: "霉菌试验" },
      ],
      "mes.experiments": [
        { task_code: "TASK-SALT-LOW", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" },
        { task_code: "TASK-MOLD-LOW", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
      ],
      "mes.experiment_trays": [
        ...saltTrays.map((tray_code) => ({ task_code: "TASK-SALT-LOW", experiment_code: "EXP-SALT", tray_code })),
        ...moldTrays.map((tray_code) => ({ task_code: "TASK-MOLD-LOW", experiment_code: "EXP-MOLD", tray_code })),
      ],
      "mes.staging_events": [
        ...saltTrays.map((tray_code) => ({ tray_code, task_code: "TASK-SALT-LOW", action: "stock_in", time: "2026-05-28T08:00:00+08:00" })),
        ...moldTrays.map((tray_code) => ({ tray_code, task_code: "TASK-MOLD-LOW", action: "stock_in", time: "2026-05-28T08:00:00+08:00" })),
      ],
      "mes.samples": [
        ...saltTrays.map((tray_code, index) => ({
          code: `SALT-LOW-SAMPLE-${String(index + 1).padStart(3, "0")}`,
          task_code: "TASK-SALT-LOW",
          location: "恒温恒湿间（暂存间）",
          status: "已入库",
          trays: [{ tray_code, status: "已入库", quantity: 1 }],
        })),
        ...moldTrays.map((tray_code, index) => ({
          code: `MOLD-LOW-SAMPLE-${String(index + 1).padStart(3, "0")}`,
          task_code: "TASK-MOLD-LOW",
          location: "恒温恒湿间（暂存间）",
          status: "已入库",
          trays: [{ tray_code, status: "已入库", quantity: 1 }],
        })),
      ],
    };
    const wrapper = mountPage();

    await Promise.resolve();
    await wrapper.vm.$nextTick();
    await wrapper.findAll('[data-testid="visual-screen-card"]')[5].trigger("click");

    const capacityCards = wrapper.find('[data-testid="visual-single-preview"]').findAll('[data-testid="visual-staging-capacity-card"]');
    const saltCapacityCard = capacityCards[1];
    const moldCapacityCard = capacityCards[2];

    expect(saltCapacityCard.text()).toContain("盐雾剩余10");
    expect(saltCapacityCard.findAll(".visual-staging-capacity-tick")).toHaveLength(10);
    expect(saltCapacityCard.findAll(".visual-staging-capacity-tick.is-active")).toHaveLength(1);
    expect(saltCapacityCard.get('[data-testid="visual-staging-capacity-alert"]').text()).toContain("!");
    expect(saltCapacityCard.text()).toContain("已用盐量 90");
    expect(saltCapacityCard.text()).toContain("盐量库存不足");
    expect(saltCapacityCard.text()).not.toContain("盐雾托盘");

    expect(moldCapacityCard.text()).toContain("霉菌剩余10");
    expect(moldCapacityCard.findAll(".visual-staging-capacity-tick")).toHaveLength(10);
    expect(moldCapacityCard.findAll(".visual-staging-capacity-tick.is-active")).toHaveLength(1);
    expect(moldCapacityCard.get('[data-testid="visual-staging-capacity-alert"]').text()).toContain("!");
    expect(moldCapacityCard.text()).toContain("已用菌体 90");
    expect(moldCapacityCard.text()).toContain("菌体库存不足");
    expect(moldCapacityCard.text()).not.toContain("霉菌托盘");
  });

  test("renders the eighth screen as a full laboratory analysis board with single-row custom time filters", async () => {
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    const eighthCard = wrapper.findAll('[data-testid="visual-screen-card"]')[7];

    expect(eighthCard.text()).toContain("设备状态与产品统计屏");
    expect(eighthCard.text()).toContain("今日");
    expect(eighthCard.text()).toContain("本周");
    expect(eighthCard.text()).toContain("本月");
    expect(eighthCard.text()).toContain("年初至今");
    expect(eighthCard.text()).toContain("自定义");
    expect(eighthCard.find('[data-testid="visual-analysis-filter-row"]').exists()).toBe(true);
    expect(eighthCard.findAll('[data-testid="visual-analysis-custom-mode"]')).toHaveLength(0);
    [
      "振动一室",
      "高低温湿热一室",
      "盐雾试验室",
      "冲击一室",
      "霉菌试验室",
      "四综合实验室",
      "冲击二室",
      "温度冲击二室",
      "温度冲击一室",
      "振动二室",
    ].forEach((labName) => {
      expect(eighthCard.text()).toContain(labName);
    });

    await eighthCard.trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    expect(preview.find(".visual-analysis-board").exists()).toBe(true);
    expect(preview.text()).toContain("年初至今 · 2026-01-01 至 2026-05-28");
    expect(preview.findAll('[data-testid="visual-analysis-filter-row"] .visual-analysis-time-chip')).toHaveLength(5);

    await preview.get('[data-testid="visual-analysis-custom-trigger"]').trigger("click");

    const menu = preview.get('[data-testid="visual-analysis-custom-menu"]');
    expect(menu.text()).toContain("按天");
    expect(menu.text()).toContain("按月");
    expect(menu.text()).toContain("按年");
    expect(menu.text()).toContain("时间段");
    expect(menu.findAll('[data-testid="visual-analysis-custom-mode"]')).toHaveLength(4);
  });

  test("updates the eighth screen analysis data when time filters and custom modes are selected", async () => {
    const wrapper = mountPage();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[7].trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    expect(preview.text()).toContain("年初至今 · 2026-01-01 至 2026-05-28");
    expect(preview.get(".visual-analysis-pie-total").text()).toBe("449");

    const monthButton = preview.findAll(".visual-analysis-time-chip").find((button) => button.text() === "本月");
    expect(monthButton).toBeTruthy();
    await monthButton.trigger("click");

    expect(preview.text()).toContain("本月 · 2026-05-01 至 2026-05-28");
    expect(preview.get(".visual-analysis-pie-total").text()).toBe("305");
    expect(monthButton.classes()).toContain("is-active");

    await preview.get('[data-testid="visual-analysis-custom-trigger"]').trigger("click");
    const customMonth = preview.findAll('[data-testid="visual-analysis-custom-mode"]').find((row) => row.text().includes("按月"));
    expect(customMonth).toBeTruthy();
    await customMonth.trigger("click");

    expect(preview.text()).toContain("自定义 · 按月 · 2026-05");
    expect(preview.get(".visual-analysis-pie-total").text()).toBe("305");
    expect(preview.get('[data-testid="visual-analysis-custom-trigger"]').classes()).toContain("is-active");
  });

  test("uses vivid diverse pie colors and matching custom filter button styling on the eighth screen", async () => {
    const wrapper = mountPage();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[7].trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    const customTrigger = preview.get('[data-testid="visual-analysis-custom-trigger"]');
    const regularButton = preview.findAll(".visual-analysis-time-chip").find((button) => button.text() === "本月");
    const sliceColors = preview.findAll(".visual-analysis-pie-slice").map((slice) => slice.attributes("fill"));

    expect(customTrigger.classes()).toContain("visual-analysis-time-chip");
    expect(customTrigger.classes()).not.toContain("is-subtle");
    expect(customTrigger.classes().filter((className) => className.startsWith("is-"))).toEqual(regularButton.classes().filter((className) => className.startsWith("is-")));
    expect(new Set(sliceColors).size).toBeGreaterThanOrEqual(10);
    expect(sliceColors).toEqual(expect.arrayContaining(["#f97316", "#ef4444", "#a855f7", "#eab308"]));
  });

  test("opens calendar-only custom date controls without manual typing on the eighth screen", async () => {
    const wrapper = mountPage();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[7].trigger("click");
    const preview = wrapper.find('[data-testid="visual-single-preview"]');

    await preview.get('[data-testid="visual-analysis-custom-trigger"]').trigger("click");

    const menu = preview.get('[data-testid="visual-analysis-custom-menu"]');
    expect(menu.findAll("input")).toHaveLength(0);
    expect(preview.get('[data-testid="visual-analysis-day-picker"]').classes()).toContain("is-calendar");
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').classes()).toContain("visual-analysis-calendar-wheel-panel");
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').findAll(".visual-analysis-calendar-wheel")).toHaveLength(3);
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').text()).toContain("2026");
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').text()).toContain("5月");
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').text()).toContain("28日");
    expect(preview.find('[data-testid="visual-analysis-day-grid"]').exists()).toBe(false);
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').findAll(".visual-analysis-calendar-arrow")).toHaveLength(6);
    await preview.get('[data-testid="visual-analysis-calendar-day-up"]').trigger("click");
    expect(preview.text()).toContain("自定义 · 按天 · 2026-05-27");
    await preview.get('[data-testid="visual-analysis-calendar-day-down"]').trigger("click");
    expect(preview.text()).toContain("自定义 · 按天 · 2026-05-28");

    const wheelDayUp = async () => {
      await preview
        .get('[data-testid="visual-analysis-calendar-day-wheel"]')
        .get(".visual-analysis-calendar-wheel-options")
        .trigger("wheel", { deltaY: -120 });
    };
    await wheelDayUp();
    expect(preview.text()).toContain("自定义 · 按天 · 2026-05-28");
    await wheelDayUp();
    expect(preview.text()).toContain("自定义 · 按天 · 2026-05-27");

    for (let index = 0; index < 2; index += 1) {
      await preview.get('[data-testid="visual-analysis-calendar-year-wheel"]').trigger("wheel", { deltaY: 120 });
    }
    for (let index = 0; index < 4; index += 1) {
      await preview.get('[data-testid="visual-analysis-calendar-month-wheel"]').trigger("wheel", { deltaY: -120 });
    }
    for (let index = 0; index < 24; index += 1) {
      await preview.get('[data-testid="visual-analysis-calendar-day-wheel"]').trigger("wheel", { deltaY: -120 });
    }
    expect(preview.text()).toContain("自定义 · 按天 · 2027-03-15");

    const customMonth = preview.findAll('[data-testid="visual-analysis-custom-mode"]').find((row) => row.text().includes("按月"));
    await customMonth.trigger("click");
    expect(preview.find('[data-testid="visual-analysis-day-grid"]').exists()).toBe(false);
    const monthGrid = preview.get('[data-testid="visual-analysis-month-grid"]');
    expect(monthGrid.findAll("button").map((button) => button.text())).toEqual(expect.arrayContaining(["1月", "5月", "12月"]));

    const customYear = preview.findAll('[data-testid="visual-analysis-custom-mode"]').find((row) => row.text().includes("按年"));
    await customYear.trigger("click");
    expect(preview.find('[data-testid="visual-analysis-month-grid"]').exists()).toBe(false);
    const yearGrid = preview.get('[data-testid="visual-analysis-year-grid"]');
    expect(yearGrid.findAll("button").map((button) => button.text())).toEqual(expect.arrayContaining(["2024", "2025", "2026", "2027"]));

    const customRange = preview.findAll('[data-testid="visual-analysis-custom-mode"]').find((row) => row.text().includes("时间段"));
    await customRange.trigger("click");
    expect(preview.get('[data-testid="visual-analysis-range-grid"]').classes()).toContain("is-range");
    expect(preview.findAll('[data-testid="visual-analysis-calendar-range"]')).toHaveLength(4);
    expect(preview.get('[data-testid="visual-analysis-range-grid"]').get('[data-testid="visual-analysis-calendar-date-wheel"]').findAll(".visual-analysis-calendar-wheel")).toHaveLength(3);

    await preview.get('[data-testid="visual-analysis-calendar-range"]').trigger("click");
    for (let index = 0; index < 2; index += 1) {
      await preview.get('[data-testid="visual-analysis-range-grid"]').get('[data-testid="visual-analysis-calendar-year-wheel"]').trigger("wheel", { deltaY: -120 });
    }
    for (let index = 0; index < 6; index += 1) {
      await preview.get('[data-testid="visual-analysis-range-grid"]').get('[data-testid="visual-analysis-calendar-month-wheel"]').trigger("wheel", { deltaY: -120 });
    }
    expect(preview.get('[data-testid="visual-analysis-range-grid"]').get('[data-testid="visual-analysis-calendar-day-wheel"]').findAll(".visual-analysis-calendar-wheel-track button")).toHaveLength(28);

    for (let index = 0; index < 28; index += 1) {
      await preview.get('[data-testid="visual-analysis-range-grid"]').get('[data-testid="visual-analysis-calendar-day-wheel"]').trigger("wheel", { deltaY: 120 });
    }
    expect(preview.text()).toContain("自定义 · 时间段 · 2025-02-15 至 2026-05-28");
  });

  test("opens the eight-screen combined preview from the page action", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T10:00:00+08:00"));

    try {
      const wrapper = mountPage();

      await wrapper.get('[data-testid="visual-combined-preview-open"]').trigger("click");

      expect(wrapper.find('[data-testid="visual-combined-preview"]').exists()).toBe(true);
      expect(wrapper.get('[data-testid="visual-combined-shell"]').classes()).toContain("is-fullscreen-merge");
      expect(wrapper.get('[data-testid="visual-combined-shell"]').attributes("style") || "").toContain("--visual-combined-scale");
      expect(wrapper.get('[data-testid="visual-combined-preview-close"]').text()).toContain("关闭");
      expect(wrapper.findAll('[data-testid="visual-combined-screen"]')).toHaveLength(8);
      wrapper.findAll('[data-testid="visual-combined-screen"]').forEach((screen) => {
        expect(screen.find(".visual-board").classes()).not.toContain("is-compact");
        expect(screen.find(".visual-board").classes()).not.toContain("is-merge-preview");
        expect(screen.find('[data-testid="visual-combined-stage"]').exists()).toBe(true);
        expect(screen.find('[data-testid="visual-combined-stage-scale"]').exists()).toBe(true);
        expect(screen.find('[data-testid="visual-combined-stage-scale"]').attributes("style")).toContain("--visual-stage-width: 1920px");
        expect(screen.find('[data-testid="visual-combined-stage-scale"]').attributes("style")).toContain("--visual-stage-height: 1080px");
      });

      const secondCombinedScreen = wrapper.findAll('[data-testid="visual-combined-screen"]')[1];
      expect(secondCombinedScreen.findAll(".visual-schedule-lab-name").length).toBeGreaterThan(5);
      expect(wrapper.find('[data-testid="visual-lab-cycle-primary"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="visual-schedule-today"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="visual-schedule-prev"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="visual-schedule-next"]').exists()).toBe(true);
      await wrapper.get('[data-testid="visual-lab-cycle-primary"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-combined-lab-picker"]').exists()).toBe(true);
      await wrapper.get(".visual-lab-picker-close").trigger("click");
      await wrapper.get('[data-testid="visual-schedule-next"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-combined-preview"]').text()).toContain("5/26");

      const fifthCombinedScreen = wrapper.findAll('[data-testid="visual-combined-screen"]')[4];
      expect(fifthCombinedScreen.text()).toContain("LAB PROCESS");
      expect(fifthCombinedScreen.text()).toContain("实验室流程监控屏B组");
      expect(fifthCombinedScreen.findAll(".visual-lab-panel")).toHaveLength(2);
      expect(fifthCombinedScreen.text()).not.toContain("今日任务计划总览屏");

      await wrapper.get('[data-testid="visual-combined-preview-close"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-combined-preview"]').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
