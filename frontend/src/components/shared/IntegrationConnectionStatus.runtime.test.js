import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import IntegrationConnectionStatus from "./IntegrationConnectionStatus.vue";
import componentSource from "./IntegrationConnectionStatus.vue?raw";

let wrapper;
let visibility;
const reply = (lims, upper = lims) => ({ ok: true, json: async () => ({ lims: { state: lims }, upper_computer: { state: upper } }) });
beforeEach(() => {
  vi.useFakeTimers();
  visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("online")));
});
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("replaces hard-coded Modbus with independent real connection statuses", async () => {
  fetch.mockResolvedValue(reply("online", "partial"));
  wrapper = mount(IntegrationConnectionStatus);
  expect(wrapper.text()).toContain("检测中");
  await flushPromises();
  expect(wrapper.text()).toContain("LIMS已连接");
  expect(wrapper.text()).toContain("上位机系统部分连接");
  expect(wrapper.text()).not.toContain("Modbus");
  expect(fetch.mock.calls[0][0]).toContain("/api/system/integrations");
  expect(fetch.mock.calls[0][1].cache).toBe("no-store");
  expect(wrapper.emitted("update").at(-1)[0].lims.state).toBe("online");
});

test("polls and clears previous success on backend failure, then recovers", async () => {
  wrapper = mount(IntegrationConnectionStatus);
  await flushPromises();
  fetch.mockRejectedValueOnce(new Error("offline"));
  await vi.advanceTimersByTimeAsync(3000);
  expect(wrapper.text()).not.toContain("已连接");
  expect(wrapper.text()).toContain("未确认");
  expect(wrapper.emitted("update").at(-1)[0]).toBeNull();
  fetch.mockResolvedValue(reply("offline", "online"));
  await vi.advanceTimersByTimeAsync(3000);
  expect(wrapper.text()).toContain("LIMS未连接");
  expect(wrapper.text()).toContain("上位机系统已连接");
});

test("invalid data cannot be displayed as connected", async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  wrapper = mount(IntegrationConnectionStatus);
  await flushPromises();
  expect(wrapper.text()).not.toContain("已连接");
  expect(wrapper.text()).toContain("未确认");
});

test("shows persistent LIMS alarm without claiming the peer is online", async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ lims: { state: "offline", alert: "严重告警 · 已重试 3 次", alert_severity: "critical" }, upper_computer: { state: "online" } }) });
  wrapper = mount(IntegrationConnectionStatus);
  await flushPromises();
  expect(wrapper.text()).toContain("LIMS未连接");
  expect(wrapper.text()).toContain("严重告警 · 已重试 3 次");
  expect(wrapper.find(".integration-connection__alert--critical").exists()).toBe(true);
  expect(wrapper.text()).toContain("上位机系统已连接");
  fetch.mockResolvedValue(reply("online"));
  await vi.advanceTimersByTimeAsync(3000);
  expect(wrapper.find(".integration-connection__alert--critical").exists()).toBe(false);
});

test("ordinary warnings do not pulse and unknown status clears critical emphasis", async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ lims: { state: "offline", alert: "普通告警", alert_severity: "warning" } }) });
  wrapper = mount(IntegrationConnectionStatus);
  await flushPromises();
  expect(wrapper.find(".integration-connection__alert--critical").exists()).toBe(false);
  fetch.mockResolvedValue({ ok: true, json: async () => ({ lims: { state: "offline", alert: "严重告警", alert_severity: "critical" } }) });
  await vi.advanceTimersByTimeAsync(3000);
  expect(wrapper.find(".integration-connection__alert--critical").exists()).toBe(true);
  fetch.mockRejectedValue(new Error("unreachable"));
  await vi.advanceTimersByTimeAsync(3000);
  expect(wrapper.find(".integration-connection__alert--critical").exists()).toBe(false);
  expect(wrapper.text()).toContain("未确认");
});

test("critical emphasis pulses only its frame slowly and respects reduced motion", () => {
  expect(componentSource).toContain("integration-critical-pulse 1.6s ease-in-out infinite");
  expect(componentSource).toMatch(/prefers-reduced-motion: reduce[\s\S]*?::before\s*\{ animation: none; opacity: 1;/);
  expect(componentSource).toContain("pointer-events: none");
});

test("aborts timed-out requests and removes polling on unmount", async () => {
  fetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  wrapper = mount(IntegrationConnectionStatus);
  await vi.advanceTimersByTimeAsync(5000);
  expect(wrapper.text()).toContain("未确认");
  wrapper.unmount();
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("does not retain stale online state across background suspension", async () => {
  wrapper = mount(IntegrationConnectionStatus);
  await flushPromises();
  visibility.mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(10000);
  expect(wrapper.text()).toContain("未确认");
  expect(fetch).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  await flushPromises();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(wrapper.text()).toContain("已连接");
});
