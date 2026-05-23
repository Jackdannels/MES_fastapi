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
    expect(cards[0].text()).toContain("振动一室");
    expect(cards[0].text()).toContain("高低温湿热一室");
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
    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("振动一室");
    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("高低温湿热一室");
    expect(wrapper.find('[data-testid="visual-single-preview"]').find(".visual-preview-header").exists()).toBe(false);
    expect(wrapper.find('[data-testid="visual-single-preview"]').find(".visual-lab-switch").exists()).toBe(false);

    await wrapper.get('[data-testid="visual-lab-cycle-primary"]').trigger("click");

    const picker = wrapper.get('[data-testid="visual-lab-picker"]');

    expect(picker.text()).toContain("选择上方试验间");
    expect(picker.text()).toContain("盐雾试验室");
    expect(picker.text()).not.toContain("高低温湿热一室");

    const saltOption = wrapper.findAll('[data-testid="visual-lab-picker-option"]').find((option) => option.text().includes("盐雾试验室"));
    expect(saltOption).toBeTruthy();
    await saltOption.trigger("click");

    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("盐雾试验室");
    expect(wrapper.find('[data-testid="visual-lab-picker"]').exists()).toBe(false);
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

  test("opens the eight-screen combined preview from the page action", async () => {
    const wrapper = mountPage();

    await wrapper.get('[data-testid="visual-combined-preview-open"]').trigger("click");

    expect(wrapper.find('[data-testid="visual-combined-preview"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="visual-combined-screen"]')).toHaveLength(8);
  });
});
