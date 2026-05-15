import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";

import AppFeedback from "./AppFeedback.vue";

describe("AppFeedback", () => {
  test("renders tone-specific feedback and emits close when clicked", async () => {
    const wrapper = mount(AppFeedback, {
      props: {
        message: "任务已确认入库",
        tone: "success",
      },
    });

    expect(wrapper.text()).toContain("任务已确认入库");
    expect(wrapper.classes()).toContain("app-feedback--success");

    await wrapper.trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.find(".app-feedback").exists()).toBe(false);
  });

  test("renders nothing without a message", () => {
    const wrapper = mount(AppFeedback, {
      props: {
        message: "",
      },
    });

    expect(wrapper.find(".app-feedback").exists()).toBe(false);
  });

  test("hides itself after the default 10 seconds", async () => {
    vi.useFakeTimers();
    const wrapper = mount(AppFeedback, {
      props: {
        message: "托盘分配已保存",
        tone: "success",
      },
    });

    expect(wrapper.find(".app-feedback").exists()).toBe(true);

    vi.advanceTimersByTime(10000);
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".app-feedback").exists()).toBe(false);
    vi.useRealTimers();
  });
});
