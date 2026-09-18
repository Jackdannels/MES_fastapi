import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LiveClock } from "./liveClock";

vi.mock("@/lib/serverClock.js", () => ({
  serverNowDate: () => new Date(Date.now() + 60_000),
}));

describe("LiveClock", () => {
  afterEach(() => vi.useRealTimers());

  test("uses the shared server clock in Beijing time and advances across midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T15:58:59Z"));
    const wrapper = mount(LiveClock);
    expect(wrapper.text()).toBe("2026-09-18 23:59:59");
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.text()).toBe("2026-09-19 00:00:00");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-09-19T00:00:00+08:00");
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("resynchronizes on visibility changes and removes the listener on close", async () => {
    vi.useFakeTimers();
    const removeListener = vi.spyOn(document, "removeEventListener");
    const wrapper = mount(LiveClock);
    vi.setSystemTime(new Date("2026-09-19T02:30:00Z"));
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();
    expect(wrapper.text()).toBe("2026-09-19 10:31:00");
    wrapper.unmount();
    expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    removeListener.mockRestore();
    const reopened = mount(LiveClock);
    expect(reopened.text()).toBe("2026-09-19 10:31:00");
    reopened.unmount();
  });
});
