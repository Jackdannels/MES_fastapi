import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TaskOverviewToolbar from "./TaskOverviewToolbar.vue";

const mountToolbar = (props = {}) =>
  mount(TaskOverviewToolbar, {
    props: {
      customEndDate: "",
      customStartDate: "",
      isTrayCounterAlert: false,
      keyword: "",
      overviewCounterLabel: "已排期/总任务数",
      overviewCounterValue: "1/2",
      testTypeFilter: "",
      testTypeOptions: ["冲击试验", "振动试验"],
      timeFilter: "all",
      viewMode: "task",
      ...props,
    },
  });

describe("TaskOverviewToolbar", () => {
  test("defers keyword updates until composition ends and trims the committed value", async () => {
    const wrapper = mountToolbar();
    const input = wrapper.find('input[placeholder="按任务编号/任务类型/样品编号筛选"]');

    await input.trigger("compositionstart");
    input.element.value = " TASK-001 ";
    await input.trigger("input");

    expect(wrapper.emitted("update:keyword")).toBeUndefined();

    await input.trigger("compositionend");

    expect(wrapper.emitted("update:keyword")).toEqual([["TASK-001"]]);
  });

  test("emits view mode and refresh actions", async () => {
    const wrapper = mountToolbar();

    await wrapper.findAll("button.tab-btn")[1].trigger("click");
    await wrapper.find("button.action-btn.secondary").trigger("click");

    expect(wrapper.emitted("update:viewMode")).toEqual([["tray"]]);
    expect(wrapper.emitted("refresh")).toEqual([[]]);
  });

  test("shows custom range inputs and emits filter updates", async () => {
    const wrapper = mountToolbar({
      timeFilter: "custom",
      customStartDate: "2026-03-01",
      customEndDate: "2026-03-10",
    });

    const inputs = wrapper.findAll('input[type="date"]');
    await wrapper.find('input[placeholder="按任务编号/任务类型/样品编号筛选"]').setValue(" TASK-001 ");
    await wrapper.findAll("select.search-input")[1].setValue("振动试验");
    await inputs[0].setValue("2026-03-02");
    await inputs[1].setValue("2026-03-09");

    expect(inputs).toHaveLength(2);
    expect(wrapper.emitted("update:keyword")).toEqual([["TASK-001"]]);
    expect(wrapper.emitted("update:testTypeFilter")).toEqual([["振动试验"]]);
    expect(wrapper.emitted("update:customStartDate")).toEqual([["2026-03-02"]]);
    expect(wrapper.emitted("update:customEndDate")).toEqual([["2026-03-09"]]);
  });
});
