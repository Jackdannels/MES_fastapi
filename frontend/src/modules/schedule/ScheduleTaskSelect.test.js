import { mount } from "@vue/test-utils";
import { compileStyle, parse } from "@vue/compiler-sfc";
import { afterEach, describe, expect, test } from "vitest";

import ScheduleTaskSelect from "./ScheduleTaskSelect.vue";
import componentSource from "./ScheduleTaskSelect.vue?raw";

const options = [
  { code: "TASK-M", label: "TASK-M", priority: "中" },
  { code: "TASK-H", label: "TASK-H", priority: "高" },
  { code: "TASK-L", label: "TASK-L", priority: "低" },
  { code: "TASK-U", label: "TASK-U", priority: "" },
];
const wrappers = [];
function render(props = {}) {
  const wrapper = mount(ScheduleTaskSelect, {
    attachTo: document.body,
    props: {
      id: "task-selector",
      options,
      "onUpdate:modelValue": (modelValue) => wrapper.setProps({ modelValue }),
      ...props,
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); });

describe("ScheduleTaskSelect priority labels", () => {
  test("keeps light-theme priority tokens scoped to the selector after Vue CSS compilation", () => {
    const { descriptor } = parse(componentSource);
    const result = compileStyle({ source: descriptor.styles[0].content, id: "data-v-priority", scoped: true });
    expect(result.errors).toEqual([]);
    expect(result.code).toContain(':root[data-theme="light"] .schedule-task-select {');
    expect(result.code).not.toContain(':root[data-theme="light"] {');
  });

  test("shows scheme B priority rows and text badges without sorting the task options", async () => {
    const wrapper = render({ modelValue: "TASK-M" });
    expect(wrapper.get('[role="combobox"]').text()).toContain("中优先级");
    await wrapper.get('[role="combobox"]').trigger("click");
    const rows = wrapper.findAll('[role="option"]');
    expect(rows.map((row) => row.get(".schedule-task-select__code").text())).toEqual([
      "请选择已接收任务", "TASK-M", "TASK-H", "TASK-L", "TASK-U",
    ]);
    expect(rows[1].get(".priority-medium").text()).toBe("中优先级");
    expect(rows[2].get(".priority-high").text()).toBe("高优先级");
    expect(rows[3].get(".priority-low").text()).toBe("低优先级");
    expect(rows[4].get(".priority-unknown").text()).toBe("优先级未设置");
    expect(rows[0].classes().some((name) => name.startsWith("priority-row-"))).toBe(false);
    expect(rows[1].classes()).toContain("priority-row-medium");
    expect(rows[2].classes()).toContain("priority-row-high");
    expect(rows[3].classes()).toContain("priority-row-low");
    expect(rows[4].classes()).toContain("priority-row-unknown");
    expect(rows[1].attributes("aria-selected")).toBe("true");
  });

  test("uses theme-aware row tints and keeps them when the keyboard or pointer highlights an option", () => {
    const { descriptor } = parse(componentSource);
    const css = descriptor.styles[0].content;
    for (const priority of ["high", "medium", "low"]) {
      expect(css).toContain(`.priority-row-${priority} { --priority-row-color: var(--priority-${priority}-text); --priority-row-bg: var(--priority-${priority}-bg); }`);
    }
    expect(css).toContain("border-left: 3px solid var(--priority-row-color, transparent)");
    expect(css).toContain("background: var(--priority-row-bg, transparent)");
    expect(css).toMatch(/\.schedule-task-select__option\.is-active\s*\{\s*background: var\(--priority-row-bg,/);
    expect(css).not.toMatch(/\.priority-row-unknown\s*\{/);
  });

  test("warns only about higher eligible priorities and does not block choosing a low task", async () => {
    const wrapper = render({ modelValue: "TASK-M" });
    expect(wrapper.get('[role="status"]').text()).toContain("1 项更高优先级");
    await wrapper.get('[role="combobox"]').trigger("click");
    await wrapper.findAll('[role="option"]')[3].trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([["TASK-L"]]);
    expect(wrapper.get('select[name="task_code"]').element.value).toBe("TASK-L");
    expect(wrapper.get('[role="combobox"]').text()).toContain("低优先级");
    expect(wrapper.get('[role="status"]').text()).toContain("2 项更高优先级");
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    await wrapper.setProps({ modelValue: "TASK-H" });
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    await wrapper.setProps({ modelValue: "TASK-U" });
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    await wrapper.setProps({ modelValue: "TASK-M", options: options.map((option) => ({ ...option, priority: "中" })) });
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  test("supports keyboard navigation, selection, escape and tab without submitting a form", async () => {
    const wrapper = render();
    const trigger = wrapper.get('[role="combobox"]');
    trigger.element.focus();
    await trigger.trigger("keydown", { key: "ArrowDown" });
    expect(trigger.attributes("aria-activedescendant")).toBe("task-selector-option-1");
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await trigger.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")).toEqual([["TASK-H"]]);
    expect(trigger.attributes("type")).toBe("button");
    await trigger.trigger("keydown", { key: " " });
    await trigger.trigger("keydown", { key: "End" });
    expect(trigger.attributes("aria-activedescendant")).toBe("task-selector-option-4");
    await trigger.trigger("keydown", { key: "Home" });
    expect(trigger.attributes("aria-activedescendant")).toBe("task-selector-option-0");
    await trigger.trigger("keydown", { key: "Escape" });
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger("click");
    await trigger.trigger("keydown", { key: "Tab" });
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  });

  test("supports task-code typeahead", async () => {
    const wrapper = render();
    const trigger = wrapper.get('[role="combobox"]');
    for (const key of "TASK-L") await trigger.trigger("keydown", { key });
    await trigger.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")).toEqual([["TASK-L"]]);
  });

  test("closes on outside pointer and focus leaving the control", async () => {
    const wrapper = render();
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger("click");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    await trigger.trigger("click");
    await trigger.trigger("focusout", { relatedTarget: document.body });
    expect(trigger.attributes("aria-expanded")).toBe("false");
  });

  test("clears selection through the placeholder and follows external resets", async () => {
    const wrapper = render({ modelValue: "TASK-L" });
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger("click");
    await wrapper.findAll('[role="option"]')[0].trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([[""]]);
    expect(trigger.find(".schedule-task-select__badge").exists()).toBe(false);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    await wrapper.setProps({ modelValue: "TASK-H" });
    await trigger.trigger("click");
    await wrapper.setProps({ modelValue: "" });
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(trigger.text()).toContain("请选择已接收任务");
  });

  test("closes stale options on refresh and presents empty state without a guessed priority", async () => {
    const wrapper = render({ modelValue: "TASK-M" });
    await wrapper.get('[role="combobox"]').trigger("click");
    await wrapper.setProps({ options: [] });
    const trigger = wrapper.get('[role="combobox"]');
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(trigger.element.disabled).toBe(true);
    expect(trigger.text()).toContain("暂无已接收任务");
    expect(wrapper.find(".schedule-task-select__badge").exists()).toBe(false);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  test("reactively updates priority labels while retaining the selected task code", async () => {
    const wrapper = render({ modelValue: "TASK-M" });
    await wrapper.setProps({ options: options.map((option) => option.code === "TASK-M" ? { ...option, priority: "高" } : option) });
    expect(wrapper.get('[role="combobox"]').text()).toContain("高优先级");
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.get('select[name="task_code"]').element.value).toBe("TASK-M");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });
});
