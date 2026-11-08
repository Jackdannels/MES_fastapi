import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import SidebarSystemInfo from "./SidebarSystemInfo.vue";
import { version } from "../../../package.json";

afterEach(() => {
  delete window.__MES_DESKTOP__;
  delete window.chrome;
  vi.useRealTimers();
});

describe("SidebarSystemInfo", () => {
  test("shows the installed client version and physical LAN addresses", () => {
    window.__MES_DESKTOP__ = { module: "central", version: "1.4.0", localIpAddresses: ["192.168.110.25", "192.168.110.25", "10.0.0.8"] };
    const wrapper = mount(SidebarSystemInfo);
    expect(wrapper.get('[data-testid="sidebar-system-version"]').text()).toBe("v1.4.0");
    expect(wrapper.get('[data-testid="sidebar-lan-ip"]').text()).toBe("192.168.110.25 / 10.0.0.8");
    expect(wrapper.text()).toContain("本机局域网 IP");
    wrapper.unmount();
  });

  test("refreshes IP information and releases its timer and bridge listener", async () => {
    vi.useFakeTimers();
    window.__MES_DESKTOP__ = { module: "central", version: "1.4.0", localIpAddresses: [] };
    const bridge = { addEventListener: vi.fn(), removeEventListener: vi.fn(), postMessage: vi.fn() };
    window.chrome = { webview: bridge };
    const wrapper = mount(SidebarSystemInfo);
    expect(wrapper.text()).toContain("未检测到局域网地址");
    const receive = bridge.addEventListener.mock.calls[0][1];
    receive({ data: { type: "mes-client-host-info", version: "1.4.0", localIpAddresses: ["192.168.110.26"] } });
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="sidebar-lan-ip"]').text()).toBe("192.168.110.26");
    vi.advanceTimersByTime(30000);
    expect(bridge.postMessage).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect(bridge.removeEventListener).toHaveBeenCalledWith("message", receive);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("labels a normal browser endpoint as the service address instead of claiming a local NIC IP", () => {
    const wrapper = mount(SidebarSystemInfo);
    expect(wrapper.text()).toContain("服务地址");
    expect(wrapper.get('[data-testid="sidebar-system-version"]').text()).toBe(`v${version}`);
    wrapper.unmount();
  });
});
