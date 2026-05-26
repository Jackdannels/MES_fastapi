import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";

import VisualizationPage from "./page.vue";

const snapshotState = vi.hoisted(() => ({
  snapshot: {},
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: vi.fn(async () => snapshotState.snapshot),
  }),
}));

const mountPage = () => mount(VisualizationPage);

describe("VisualizationPage runtime", () => {
  beforeEach(() => {
    snapshotState.snapshot = {};
  });

  test("renders eight non-interactive screen thumbnails", () => {
    const wrapper = mountPage();
    const cards = wrapper.findAll('[data-testid="visual-screen-card"]');

    expect(cards).toHaveLength(8);
    expect(cards[0].attributes("aria-label")).toContain("实验室流程监控屏");
    expect(cards[0].findAll(".visual-lab-panel")).toHaveLength(2);
    expect(cards[0].find("select").exists()).toBe(false);
    expect(cards[0].find('[data-testid="visual-lab-select"]').exists()).toBe(false);
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
    snapshotState.snapshot = {
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
            { status: "到货", time: "2026-05-22T09:00:00" },
            { detail: "TASK-VIS-001 / 振动试验 / 实验进行中", time: "2026-05-22T10:00:00" },
          ],
        },
      ],
    };
    const wrapper = mountPage();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.findAll('[data-testid="visual-screen-card"]')[0].trigger("click");

    const previewText = wrapper.find('[data-testid="visual-single-preview"]').text();

    expect(previewText).toContain("TRAY-VIS-001");
    expect(previewText).toContain("TASK-VIS-001");
    expect(previewText).toContain("样品运输中");
    expect(previewText).toContain("振动试验进行中");
    expect(previewText).toContain("到货");
    expect(previewText).not.toContain("任务下发");
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

    const taskB = preview.findAll('[data-testid="visual-lab-task-option"]').find((option) => option.text().includes("TASK-LAB-B"));
    expect(taskB).toBeTruthy();
    await taskB.trigger("click");
    expect(preview.text()).toContain("TRAY-B-001");

    const taskA = preview.findAll('[data-testid="visual-lab-task-option"]').find((option) => option.text().includes("TASK-LAB-A"));
    expect(taskA).toBeTruthy();
    await taskA.trigger("click");

    const trayA2 = preview.findAll('[data-testid="visual-lab-tray-option"]').find((option) => option.text().includes("TRAY-A-002"));
    expect(trayA2).toBeTruthy();
    await trayA2.trigger("click");
    expect(preview.text()).toContain("TRAY-A-002");
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

  test("renders the fifth screen as a task-number grouped today task plan board", async () => {
    const wrapper = mountPage();
    const fifthCard = wrapper.findAll('[data-testid="visual-screen-card"]')[4];

    expect(fifthCard.text()).toContain("今日任务计划总览屏");
    expect(fifthCard.text()).toContain("SYLU-2026-0524-001");
    expect(fifthCard.text()).toContain("冲击试验");
    expect(fifthCard.text()).toContain("振动试验");
    expect(fifthCard.text()).not.toContain("合格率趋势屏");
    expect(fifthCard.text()).not.toContain("97.3%");

    await fifthCard.trigger("click");

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
      expect(fifthCombinedScreen.text()).toContain("任务编号");
      expect(fifthCombinedScreen.text()).toContain("托盘信息");
      expect(fifthCombinedScreen.text()).toContain("TP-003");

      await wrapper.get('[data-testid="visual-combined-preview-close"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-combined-preview"]').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
