import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";

import PickerOnlyInput from "./PickerOnlyInput.vue";

describe("PickerOnlyInput", () => {
  test("shows localized empty date hints instead of browser default date text", () => {
    const dateInput = mount(PickerOnlyInput, {
      props: {
        initialCalendarDate: "2026-06-01",
        modelValue: "",
        type: "date",
      },
    });
    const dateTimeInput = mount(PickerOnlyInput, {
      props: {
        modelValue: "",
        type: "datetime-local",
      },
    });

    expect(dateInput.get("input").attributes("type")).toBe("text");
    expect(dateInput.get(".picker-only-input__hint").text()).toBe("年 / 月 / 日");
    expect(dateTimeInput.get("input").attributes("data-format-hint")).toBe("年 / 月 / 日 --:--");
  });

  test("uses a custom empty hint instead of the date format hint when provided", () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        emptyHint: "确认入库后自动回写",
        modelValue: "",
        type: "date",
      },
    });

    expect(wrapper.get(".picker-only-input__hint").text()).toBe("确认入库后自动回写");
    expect(wrapper.get("input").attributes("data-format-hint")).toBe("确认入库后自动回写");
  });

  test("opens a themed calendar for date values and emits the selected day", async () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        modelValue: "",
        type: "date",
      },
    });

    await wrapper.get("input").trigger("click");

    expect(wrapper.get(".picker-only-calendar").exists()).toBe(true);
    expect(wrapper.get(".picker-only-calendar__month").text()).toMatch(/\d{4}年\d{1,2}月/);

    await wrapper.get('[data-date-value="2026-06-15"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["2026-06-15"]]);
  });

  test("blocks manual text entry while still emitting picker changes", async () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        modelValue: "2026-03-01",
        type: "date",
      },
    });
    const input = wrapper.get("input");

    const beforeInput = new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: "2" });
    input.element.dispatchEvent(beforeInput);
    await wrapper.vm.$nextTick();

    expect(beforeInput.defaultPrevented).toBe(true);

    await input.trigger("paste");
    await input.trigger("drop");
    input.element.value = "2026-03-02";
    await input.trigger("input");

    expect(wrapper.emitted("update:modelValue")).toEqual([["2026-03-02"]]);
  });

  test("opens the native picker when clicked if the browser supports it", async () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        modelValue: "08:30",
        type: "time",
      },
    });
    const input = wrapper.get("input");
    input.element.showPicker = vi.fn();

    await input.trigger("click");

    expect(input.element.showPicker).toHaveBeenCalledOnce();
  });

  test("does not open or emit when the field is externally readonly", async () => {
    const wrapper = mount(PickerOnlyInput, {
      attrs: {
        readonly: true,
      },
      props: {
        modelValue: "",
        type: "date",
      },
    });

    await wrapper.get("input").trigger("click");

    expect(wrapper.find(".picker-only-calendar").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });
});
