import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TaskOverviewToolbar from "./TaskOverviewToolbar.vue";

const mountToolbar = (props = {}) =>
  mount(TaskOverviewToolbar, {
    props: {
      customEndDate: "",
      customStartDate: "",
      experimentCounterLabel: "已排程总实验数",
      experimentCounterValue: "3/5",
      isTrayCounterAlert: false,
      keyword: "",
      currentTaskPage: 1,
      overviewCounterLabel: "已排程/总任务数",
      overviewCounterValue: "1/2",
      taskPageCount: 3,
      taskScheduleFilter: "all",
      trayTaskFilter: "",
      trayTaskOptions: ["SYLU-2026-03-101", "SYLU-2026-03-102"],
      testTypeFilter: "",
      testTypeOptions: ["冲击试验", "振动试验"],
      timeFilter: "all",
      viewMode: "task",
      ...props,
    },
  });

describe("TaskOverviewToolbar", () => {
  test("renders primary module cards on the left without the legacy text heading", () => {
    const wrapper = mountToolbar();

    expect(wrapper.find(".task-overview-heading").exists()).toBe(false);
    expect(wrapper.find(".task-overview-module-cards").exists()).toBe(true);
    expect(wrapper.findAll(".task-overview-module-card")).toHaveLength(2);
    expect(wrapper.findAll(".task-overview-module-card b")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("从任务和托盘两个视角跟踪");
  });

  test("renders compact centered blue metric cards without helper descriptions", () => {
    const wrapper = mountToolbar();

    expect(wrapper.findAll(".task-overview-schedule-card")).toHaveLength(3);
    expect(wrapper.findAll(".task-overview-schedule-card").every((node) => node.classes().includes("is-blue-tint"))).toBe(true);
    expect(wrapper.text()).toContain("已排程/总任务数");
    expect(wrapper.text()).toContain("已排程总实验数");
    expect(wrapper.text()).toContain("3/5");
    expect(wrapper.text()).not.toContain("默认显示所有任务");
    expect(wrapper.text()).not.toContain("点击后仅显示已排程任务");
  });

  test("shows only one counter card in tray mode", () => {
    const wrapper = mountToolbar({
      experimentCounterLabel: "",
      experimentCounterValue: "",
      overviewCounterLabel: "剩余托盘/总托盘数",
      overviewCounterValue: "1/20",
      viewMode: "tray",
    });

    expect(wrapper.findAll(".task-overview-schedule-card")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("已排程总实验数");
  });

  test("shows tray task filter in tray mode and emits its update", async () => {
    const wrapper = mountToolbar({
      experimentCounterLabel: "",
      experimentCounterValue: "",
      overviewCounterLabel: "剩余托盘/总托盘数",
      overviewCounterValue: "1/20",
      viewMode: "tray",
    });

    const taskSelect = wrapper.get('[data-testid="task-overview-tray-task-filter"]');
    expect(taskSelect.text()).toContain("全部任务");
    expect(taskSelect.text()).toContain("SYLU-2026-03-101");

    await taskSelect.setValue("SYLU-2026-03-102");

    expect(wrapper.emitted("update:trayTaskFilter")).toEqual([["SYLU-2026-03-102"]]);
  });

  test("defers keyword updates until composition ends and trims the committed value", async () => {
    const wrapper = mountToolbar();
    const input = wrapper.find('input[placeholder="按任务编号、任务类型或样品编号筛选"]');

    await input.trigger("compositionstart");
    input.element.value = " TASK-001 ";
    await input.trigger("input");

    expect(wrapper.emitted("update:keyword")).toBeUndefined();

    await input.trigger("compositionend");

    expect(wrapper.emitted("update:keyword")).toEqual([["TASK-001"]]);
  });

  test("emits view mode and refresh actions", async () => {
    const wrapper = mountToolbar();

    await wrapper.findAll(".task-overview-module-card")[1].trigger("click");
    await wrapper.find("button.action-btn.secondary").trigger("click");

    expect(wrapper.emitted("update:viewMode")).toEqual([["tray"]]);
    expect(wrapper.emitted("refresh")).toEqual([[]]);
  });

  test("emits schedule filter cycle from the scheduled task card", async () => {
    const wrapper = mountToolbar({ taskScheduleFilter: "all" });

    await wrapper.get('[data-testid="task-overview-schedule-cycle"]').trigger("click");

    expect(wrapper.emitted("cycle-task-schedule-filter")).toEqual([[]]);
  });

  test("places pagination in the filter toolbar", async () => {
    const wrapper = mountToolbar({ currentTaskPage: 2, taskPageCount: 4 });

    expect(wrapper.find(".task-overview-toolbar-pagination").exists()).toBe(true);
    expect(wrapper.find(".task-overview-actions .task-list-pagination").exists()).toBe(true);

    await wrapper.find('.task-overview-toolbar-pagination [data-page="3"]').trigger("click");

    expect(wrapper.emitted("change-task-page")).toEqual([[3]]);
  });

  test("shows custom range inputs and emits filter updates", async () => {
    const wrapper = mountToolbar({
      timeFilter: "custom",
      customStartDate: "2026-03-01",
      customEndDate: "2026-03-10",
    });

    const inputs = wrapper.findAll('input[type="date"]');
    await wrapper.find('input[placeholder="按任务编号、任务类型或样品编号筛选"]').setValue(" TASK-001 ");
    await wrapper.findAll("select.search-input")[1].setValue("振动试验");
    await inputs[0].setValue("2026-03-02");
    await inputs[1].setValue("2026-03-09");

    expect(inputs).toHaveLength(2);
    expect(inputs[0].attributes("max")).toBe("2026-03-10");
    expect(inputs[1].attributes("min")).toBe("2026-03-01");
    expect(wrapper.emitted("update:keyword")).toEqual([["TASK-001"]]);
    expect(wrapper.emitted("update:testTypeFilter")).toEqual([["振动试验"]]);
    expect(wrapper.emitted("update:customStartDate")).toEqual([["2026-03-02"]]);
    expect(wrapper.emitted("update:customEndDate")).toEqual([["2026-03-09"]]);
  });
});
