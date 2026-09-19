import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CriticalAlarmIndicator from "./CriticalAlarmIndicator.vue";
import source from "./CriticalAlarmIndicator.vue?raw";

const critical = () => ({
  state: "offline", detail: "HTTP 通讯失败", alert_severity: "critical", alert: "严重告警 · 已重试 3 次",
  alert_details: { phase: "offline", alarm: "critical", retry_count: 3, retry_interval_seconds: 10,
    fault_since: 100, server_time: 145, next_check_at: 150, last_check_at: 140, acknowledged: false,
    http: "offline", rabbitmq: "online", history: [{ at: 140, kind: "critical", detail: "连续三次重试失败" }] },
});
let wrapper;
const find = (selector) => document.querySelector(selector);
const open = async () => {
  await wrapper.get('[data-testid="critical-alarm-trigger"]').trigger("click");
  await flushPromises();
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, message: "等待后台确认" }) }));
});
afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const setup = (status = critical()) => { wrapper = mount(CriticalAlarmIndicator, { props: { status }, attachTo: document.body }); };

test("only a critical alarm displays the global entry, not ordinary or unknown status", async () => {
  setup(null);
  expect(wrapper.find("button").exists()).toBe(false);
  await wrapper.setProps({ status: { state: "partial", alert_severity: "warning" } });
  expect(wrapper.find("button").exists()).toBe(false);
  await wrapper.setProps({ status: critical() });
  expect(wrapper.get("button").text()).toBe("严重告警 1");
  expect(find('[role="dialog"]')).toBeNull();
});

test("opens centered details without fetching again; supports Escape, focus trap and return focus", async () => {
  setup();
  await open();
  const dialog = find('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.classList.contains("critical-alarm-content")).toBe(true);
  expect(dialog.textContent).toContain("3 次 / 每 10 秒");
  expect(dialog.textContent).toContain("0 分 45 秒");
  expect(dialog.textContent).toContain("5 秒");
  expect(fetch).not.toHaveBeenCalled();
  const closeButton = find(".critical-alarm-modal .modal-close");
  const lastButton = find('[data-testid="close-critical-alarm"]');
  expect(document.activeElement).toBe(closeButton);
  closeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(lastButton);
  lastButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(closeButton);
  closeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flushPromises();
  expect(find('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(wrapper.get("button").element);
  expect(document.body.style.overflow).toBe("");
});

test("acknowledgement posts once with session cookie and does not locally clear critical status", async () => {
  setup(); await open();
  find('[data-testid="acknowledge-critical-alarm"]').click();
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/system/integrations/lims/acknowledge"), expect.objectContaining({ method: "POST", credentials: "include" }));
  expect(find('[data-testid="acknowledge-critical-alarm"]').disabled).toBe(true);
  expect(find('[role="dialog"]').textContent).toContain("等待后台确认");
  expect(wrapper.find('[data-testid="critical-alarm-trigger"]').exists()).toBe(true);
  await wrapper.setProps({ status: { ...critical(), alert_details: { ...critical().alert_details, acknowledged: true } } });
  expect(find('[role="dialog"]').textContent).toContain("已知悉，等待故障恢复");
});

test("failed acknowledgement remains retryable and does not pretend success", async () => {
  fetch.mockResolvedValue({ ok: false, json: async () => ({ detail: "会话已过期" }) });
  setup(); await open();
  find('[data-testid="acknowledge-critical-alarm"]').click(); await flushPromises();
  expect(find('[role="dialog"]').textContent).toContain("会话已过期");
  expect(find('[data-testid="acknowledge-critical-alarm"]').disabled).toBe(false);
});

test("unknown data does not claim recovery; actual recovery hides badge but leaves open details readable", async () => {
  setup(); await open();
  await wrapper.setProps({ status: null });
  expect(find('[role="dialog"]').textContent).toContain("告警状态未确认");
  expect(find('[data-testid="acknowledge-critical-alarm"]').disabled).toBe(true);
  await wrapper.setProps({ status: { state: "online", detail: "检测正常", alert_details: { phase: "online", alarm: "none" } } });
  expect(wrapper.find('[data-testid="critical-alarm-trigger"]').exists()).toBe(false);
  expect(find('[role="dialog"]').textContent).toContain("通讯已恢复");
});

test("uses a responsive centered modal and reduced-motion fallback, never a side drawer", () => {
  expect(source).toMatch(/\.modal\.critical-alarm-modal\s*\{[^}]*align-items: center; justify-content: center/);
  expect(source).toContain("width: min(680px, calc(100vw - 32px))");
  expect(source).toContain("max-height: calc(100dvh - 32px)");
  expect(source).toMatch(/prefers-reduced-motion: reduce[^}]*animation: none/);
  expect(source).not.toContain("drawer");
});
