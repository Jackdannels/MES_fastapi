import { afterEach, describe, expect, test, vi } from "vitest";
import { isDesktopZoomAvailable, requestDesktopZoom, subscribeDesktopZoom } from "./desktopZoom";

const levels = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
function host() {
  window.__MES_DESKTOP__ = { module: "test", testClient: true, pageZoomSupported: true, version: "1.8.0" };
  const bridge = new EventTarget();
  bridge.postMessage = vi.fn();
  window.chrome = { webview: bridge };
  return bridge;
}
afterEach(() => { delete window.__MES_DESKTOP__; delete window.chrome; });

describe("desktop page zoom bridge", () => {
  test("requires a capable test host and does not enable zoom controls on other clients", () => {
    expect(isDesktopZoomAvailable()).toBe(false);
    host();
    expect(isDesktopZoomAvailable()).toBe(true);
    for (const module of ["central", "laboratory", "staging"]) {
      window.__MES_DESKTOP__.module = module;
      expect(isDesktopZoomAvailable()).toBe(false);
    }
    window.__MES_DESKTOP__.module = "test";
    delete window.__MES_DESKTOP__.pageZoomSupported;
    expect(isDesktopZoomAvailable()).toBe(false);
  });

  test("only sends known commands and waits for the host's actual ratio", () => {
    const bridge = host();
    for (const action of ["get", "in", "out", "reset"]) expect(requestDesktopZoom(action)).toBe(true);
    expect(requestDesktopZoom("set:999")).toBe(false);
    expect(bridge.postMessage.mock.calls.flat()).toEqual(["mes-client-zoom:get", "mes-client-zoom:in", "mes-client-zoom:out", "mes-client-zoom:reset"]);
    delete window.__MES_DESKTOP__;
    expect(requestDesktopZoom("in")).toBe(false);
  });

  test("receives valid host state, copies levels and removes its listener on disposal", () => {
    const bridge = host(), listener = vi.fn();
    const unsubscribe = subscribeDesktopZoom(listener);
    const data = { type: "mes-client-zoom", percent: 125, levels };
    bridge.dispatchEvent(new MessageEvent("message", { data }));
    expect(listener).toHaveBeenCalledWith({ percent: 125, levels });
    expect(listener.mock.calls[0][0].levels).not.toBe(levels);
    unsubscribe();
    bridge.dispatchEvent(new MessageEvent("message", { data }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("ignores unrelated and invalid host state", () => {
    const bridge = host(), listener = vi.fn();
    const unsubscribe = subscribeDesktopZoom(listener);
    for (const data of [null, {}, { type: "other", percent: 125, levels },
      { type: "mes-client-zoom", percent: "125", levels }, { type: "mes-client-zoom", percent: 250, levels },
      { type: "mes-client-zoom", percent: 125, levels: [50, 125, 100, 200] },
      { type: "mes-client-zoom", percent: 125, levels: [50, 100, 100, 125, 200] }]) {
      bridge.dispatchEvent(new MessageEvent("message", { data }));
    }
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
