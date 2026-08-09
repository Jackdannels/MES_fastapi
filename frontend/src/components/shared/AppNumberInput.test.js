import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import AppNumberInput from "./AppNumberInput.vue";

describe("AppNumberInput", () => {
  test("renders themed step controls and emits clamped numeric updates", async () => {
    const wrapper = mount(AppNumberInput, {
      props: {
        modelValue: "2",
        min: 1,
        max: 3,
        step: 1,
      },
    });

    expect(wrapper.classes()).toContain("app-number-input");
    expect(wrapper.find('[data-testid="number-step-up"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="number-step-down"]').exists()).toBe(true);

    await wrapper.get('[data-testid="number-step-up"]').trigger("click");
    await wrapper.setProps({ modelValue: "3" });
    await wrapper.get('[data-testid="number-step-up"]').trigger("click");
    await wrapper.get('[data-testid="number-step-down"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["3"], ["3"], ["2"]]);
  });

  test("supports decimal steps without changing text input semantics", async () => {
    const wrapper = mount(AppNumberInput, {
      props: {
        modelValue: "0.5",
        min: 0.5,
        max: 2,
        step: 0.5,
        name: "planned_hours",
      },
    });

    expect(wrapper.get("input").attributes("type")).toBe("number");
    expect(wrapper.get("input").attributes("name")).toBe("planned_hours");

    await wrapper.get('[data-testid="number-step-up"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["1"]]);
  });

  test("supports different increment and decrement steps", async () => {
    const wrapper = mount(AppNumberInput, {
      props: {
        modelValue: "0.5",
        min: 0.1,
        step: 0.1,
        stepDown: 0.1,
        stepUp: 0.5,
      },
    });

    await wrapper.get('[data-testid="number-step-down"]').trigger("click");
    await wrapper.get('[data-testid="number-step-up"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["0.4"], ["1"]]);
  });

  test("places touch controls on both sides of the field in horizontal mode", async () => {
    const wrapper = mount(AppNumberInput, {
      props: {
        controlsLayout: "horizontal",
        modelValue: "2",
        min: 1,
        max: 3,
      },
    });

    expect(wrapper.classes()).toContain("is-horizontal");
    expect(wrapper.find(".app-number-input__controls").exists()).toBe(false);
    expect(wrapper.findAll("button").map((button) => button.attributes("aria-label"))).toEqual(["减少", "增加"]);
  });

  test("clamps typed values to the configured maximum", async () => {
    const wrapper = mount(AppNumberInput, {
      props: {
        modelValue: "",
        min: 1,
        max: 99,
        step: 1,
      },
    });

    await wrapper.get("input").setValue("100");

    expect(wrapper.emitted("update:modelValue")).toEqual([["99"]]);
  });
});
