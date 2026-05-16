import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";

import PickerOnlyInput from "./PickerOnlyInput.vue";

describe("PickerOnlyInput", () => {
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
});
