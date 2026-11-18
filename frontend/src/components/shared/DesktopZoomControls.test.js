import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";
import DesktopZoomControls from "./DesktopZoomControls.vue";

let wrapper;
const levels = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
function host() {
  window.__MES_DESKTOP__ = { module: "test", testClient: true, pageZoomSupported: true, version: "1.8.0" };
  const bridge = new EventTarget();
  bridge.postMessage = vi.fn();
  window.chrome = { webview: bridge };
  return bridge;
}
async function receive(bridge, percent) {
  bridge.dispatchEvent(new MessageEvent("message", { data: { type: "mes-client-zoom", percent, levels } }));
  await nextTick();
}
afterEach(() => { wrapper?.unmount(); wrapper = null; delete window.chrome; delete window.__MES_DESKTOP__; });

describe("desktop zoom controls", () => {
  test("does not render outside a capable test client", () => {
    wrapper = mount(DesktopZoomControls);
    expect(wrapper.find('[role="group"]').exists()).toBe(false);
  });

  test("reads the host state on mount and does not invent an initial percentage", async () => {
    const bridge = host();
    wrapper = mount(DesktopZoomControls);
    expect(wrapper.find("output").text()).toBe("—");
    expect(wrapper.findAll("button").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    expect(bridge.postMessage).toHaveBeenCalledWith("mes-client-zoom:get");
    await receive(bridge, 125);
    expect(wrapper.find("output").text()).toBe("125%");
    expect(wrapper.find("output").attributes("aria-live")).toBe("polite");
  });

  test("sends buttons to the native controller and displays only acknowledged changes", async () => {
    const bridge = host();
    wrapper = mount(DesktopZoomControls);
    await receive(bridge, 125);
    await wrapper.get('[aria-label="放大页面"]').trigger("click");
    expect(bridge.postMessage).toHaveBeenLastCalledWith("mes-client-zoom:in");
    expect(wrapper.find("output").text()).toBe("125%");
    await receive(bridge, 150);
    expect(wrapper.find("output").text()).toBe("150%");
    await wrapper.get('[aria-label="缩小页面"]').trigger("click");
    expect(bridge.postMessage).toHaveBeenLastCalledWith("mes-client-zoom:out");
    await wrapper.get(".desktop-zoom__reset").trigger("click");
    expect(bridge.postMessage).toHaveBeenLastCalledWith("mes-client-zoom:reset");
  });

  test("disables reset at 100% and zoom buttons at their limits", async () => {
    const bridge = host();
    wrapper = mount(DesktopZoomControls);
    await receive(bridge, 100);
    expect(wrapper.get(".desktop-zoom__reset").attributes("disabled")).toBeDefined();
    await receive(bridge, 50);
    expect(wrapper.get('[aria-label="缩小页面"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[aria-label="放大页面"]').attributes("disabled")).toBeUndefined();
    await receive(bridge, 200);
    expect(wrapper.get('[aria-label="放大页面"]').attributes("disabled")).toBeDefined();
  });

  test("re-reads the actual ratio after page switches and cleans up old subscriptions", async () => {
    const bridge = host();
    const remove = vi.spyOn(bridge, "removeEventListener");
    wrapper = mount(DesktopZoomControls);
    await receive(bridge, 125);
    wrapper.unmount();
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
    wrapper = mount(DesktopZoomControls);
    expect(bridge.postMessage.mock.calls.filter(([message]) => message === "mes-client-zoom:get")).toHaveLength(2);
    await receive(bridge, 125);
    expect(wrapper.find("output").text()).toBe("125%");
  });
});
