import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

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
    expect(dateTimeInput.get("input").attributes("type")).toBe("text");
    expect(dateTimeInput.get("input").attributes("readonly")).toBeDefined();
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
        initialCalendarDate: "2026-06-01",
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

  test("blocks manual text entry, paste, and drop", async () => {
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

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  test("opens a custom time picker and emits the confirmed hour and minute", async () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        modelValue: "08:30",
        type: "time",
      },
    });
    const input = wrapper.get("input");

    await input.trigger("click");
    expect(wrapper.findAll('.picker-only-time__field--hour [role="option"]')).toHaveLength(5);
    expect(wrapper.findAll('.picker-only-time__field--minute [role="option"]')).toHaveLength(5);
    await wrapper.get('.picker-only-time__field--hour [data-wheel-value="09"]').trigger("click");
    await wrapper.get('.picker-only-time__field--minute [data-wheel-value="31"]').trigger("click");
    await wrapper.get(".picker-only-calendar__confirm").trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["09:31"]]);
    expect(wrapper.find(".picker-only-calendar").exists()).toBe(false);
  });

  test("allows opt-in manual hour and minute entry with two-digit limits", async () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        manualTimeEntry: true,
        modelValue: "08:30",
        type: "time",
      },
    });
    const hourInput = wrapper.get('[data-testid="manual-time-hour"]');
    const minuteInput = wrapper.get('[data-testid="manual-time-minute"]');

    expect(hourInput.attributes("inputmode")).toBe("numeric");
    expect(hourInput.attributes("maxlength")).toBe("2");
    expect(minuteInput.attributes("maxlength")).toBe("2");

    await hourInput.setValue("123abc");
    expect(hourInput.element.value).toBe("12");

    await minuteInput.setValue("60");
    await minuteInput.trigger("blur");
    expect(wrapper.get(".picker-only-input__manual-hint").text()).toBe("分钟应为 00–59");
    expect(minuteInput.attributes("aria-invalid")).toBe("true");
    expect(wrapper.emitted("update:modelValue").at(-1)).toEqual(["12:60"]);

    await minuteInput.setValue("9");
    await minuteInput.trigger("blur");
    expect(minuteInput.element.value).toBe("09");
    expect(wrapper.emitted("update:modelValue").at(-1)).toEqual(["12:09"]);
  });

  test("rejects hour 24 and manual values earlier than the configured minimum", async () => {
    const wrapper = mount(PickerOnlyInput, {
      attrs: {
        min: "09:30",
      },
      props: {
        manualTimeEntry: true,
        modelValue: "10:00",
        type: "time",
      },
    });
    const hourInput = wrapper.get('[data-testid="manual-time-hour"]');
    const minuteInput = wrapper.get('[data-testid="manual-time-minute"]');

    await hourInput.setValue("24");
    await hourInput.trigger("blur");
    expect(wrapper.get(".picker-only-input__manual-hint").text()).toBe("小时应为 00–23");
    expect(wrapper.emitted("update:modelValue").at(-1)).toEqual(["24:00"]);

    await hourInput.setValue("09");
    await minuteInput.setValue("29");
    await minuteInput.trigger("blur");
    expect(wrapper.get(".picker-only-input__manual-hint").text()).toBe("开始时间不能早于 09:30");
    expect(wrapper.emitted("update:modelValue").at(-1)).toEqual(["09:29"]);
  });

  test("keeps manual fields synchronized with the existing time wheel", async () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        manualTimeEntry: true,
        modelValue: "08:30",
        type: "time",
      },
    });

    await wrapper.get(".picker-only-input__manual-trigger").trigger("click");
    await wrapper.get('.picker-only-time__field--hour [data-wheel-value="09"]').trigger("click");
    await wrapper.get('.picker-only-time__field--minute [data-wheel-value="31"]').trigger("click");
    await wrapper.get(".picker-only-calendar__confirm").trigger("click");

    expect(wrapper.get('[data-testid="manual-time-hour"]').element.value).toBe("09");
    expect(wrapper.get('[data-testid="manual-time-minute"]').element.value).toBe("31");
    expect(wrapper.emitted("update:modelValue").at(-1)).toEqual(["09:31"]);
  });

  test("closes the custom picker with Escape without changing the value", async () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        modelValue: "08:30",
        type: "time",
      },
    });

    await wrapper.get("input").trigger("click");
    await wrapper.get('[role="listbox"][aria-label="小时"]').trigger("keydown", { key: "Escape" });

    expect(wrapper.find(".picker-only-calendar").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  test("selects date and time together without using the native datetime picker", async () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        modelValue: "2026-07-17T08:00",
        type: "datetime-local",
      },
    });

    await wrapper.get("input").trigger("click");
    await wrapper.get('[data-date-value="2026-07-18"]').trigger("click");
    await wrapper.get('.picker-only-time__field--hour [data-wheel-value="09"]').trigger("click");
    await wrapper.get('.picker-only-time__field--minute [data-wheel-value="01"]').trigger("click");
    await wrapper.get(".picker-only-calendar__confirm").trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["2026-07-18T09:01"]]);
  });

  test("shows datetime values with a readable separator while preserving the emitted model format", async () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        modelValue: "2026-07-17T08:00",
        type: "datetime-local",
      },
    });

    expect(wrapper.get("input").element.value).toBe("2026-07-17 08:00");
    await wrapper.get("input").trigger("click");
    await wrapper.get(".picker-only-calendar__confirm").trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["2026-07-17T08:00"]]);
  });

  test("limits a burst of minute wheel events to one precise step", async () => {
    const wrapper = mount(PickerOnlyInput, {
      props: {
        modelValue: "08:30",
        type: "time",
      },
    });

    await wrapper.get("input").trigger("click");
    const minuteWheel = wrapper.get('[role="listbox"][aria-label="分钟"]');
    await minuteWheel.trigger("wheel", { deltaY: 120 });
    await minuteWheel.trigger("wheel", { deltaY: 120 });
    await wrapper.get(".picker-only-calendar__confirm").trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["08:31"]]);
  });

  test("disables calendar days outside the configured range", async () => {
    const wrapper = mount(PickerOnlyInput, {
      attrs: {
        min: "2026-07-10",
      },
      props: {
        initialCalendarDate: "2026-07-15",
        modelValue: "",
        type: "date",
      },
    });

    await wrapper.get("input").trigger("click");

    expect(wrapper.get('[data-date-value="2026-07-09"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-date-value="2026-07-10"]').attributes("disabled")).toBeUndefined();
  });

  test("keeps only one picker open and closes it when another control is pressed", async () => {
    const wrapper = mount(
      {
        components: { PickerOnlyInput },
        data: () => ({ endAt: "", startAt: "" }),
        template: `
          <div>
            <PickerOnlyInput v-model="startAt" data-testid="start-picker" type="datetime-local" />
            <PickerOnlyInput v-model="endAt" data-testid="end-picker" type="datetime-local" />
            <button data-testid="outside-action" type="button">其他按钮</button>
            <div data-testid="blank-area"></div>
          </div>
        `,
      },
      { attachTo: document.body },
    );
    const pickers = wrapper.findAllComponents(PickerOnlyInput);

    await wrapper.get('[data-testid="start-picker"]').trigger("click");
    expect(pickers[0].find(".picker-only-calendar").exists()).toBe(true);

    await wrapper.get('[data-testid="end-picker"]').trigger("pointerdown");
    await wrapper.get('[data-testid="end-picker"]').trigger("click");

    expect(pickers[0].find(".picker-only-calendar").exists()).toBe(false);
    expect(pickers[1].find(".picker-only-calendar").exists()).toBe(true);
    expect(wrapper.findAll(".picker-only-calendar")).toHaveLength(1);

    await wrapper.get('[data-testid="outside-action"]').trigger("pointerdown");

    expect(wrapper.find(".picker-only-calendar").exists()).toBe(false);

    await wrapper.get('[data-testid="start-picker"]').trigger("click");
    await wrapper.get('[data-testid="blank-area"]').trigger("pointerdown");

    expect(wrapper.find(".picker-only-calendar").exists()).toBe(false);
    wrapper.unmount();
  });

  test("prevents confirming a datetime earlier than the configured minimum", async () => {
    const wrapper = mount(PickerOnlyInput, {
      attrs: {
        min: "2026-07-17T15:40",
      },
      props: {
        modelValue: "2026-07-17T15:30",
        type: "datetime-local",
      },
    });

    await wrapper.get("input").trigger("click");

    expect(wrapper.get('[data-date-value="2026-07-16"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('.picker-only-time__field--minute [aria-selected="true"]').text()).toBe("40");
    await wrapper.get('.picker-only-time__field--minute [data-wheel-value="39"]').trigger("click");

    expect(wrapper.get(".picker-only-calendar__confirm").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".picker-only-time__warning").text()).toBe("所选时间超出允许范围");
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

  test("treats a bare readonly attribute as externally readonly", async () => {
    const wrapper = mount(PickerOnlyInput, {
      attrs: {
        readonly: "",
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
