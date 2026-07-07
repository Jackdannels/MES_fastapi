import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useLoginForm } from "./useLoginForm";

describe("useLoginForm", () => {
  const storageState = {};

  beforeEach(() => {
    Object.keys(storageState).forEach((key) => {
      delete storageState[key];
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(storageState, key) ? storageState[key] : null)),
        removeItem: vi.fn((key) => {
          delete storageState[key];
        }),
        setItem: vi.fn((key, value) => {
          storageState[key] = String(value);
        }),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, mode: "mqtt", subscriber_running: true }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("starts with the demo credentials and redirects to the explicit redirect path on success", async () => {
    const login = vi.fn(async () => ({ module: "visual", ok: true }));
    const navigate = vi.fn();
    const resolveHome = vi.fn(() => "/visualization");
    const form = useLoginForm({
      login,
      navigate,
      redirectPath: "/process",
      resolveModuleHome: resolveHome,
    });

    expect(form.username.value).toBe("admin");
    expect(form.password.value).toBe("123");
    expect(form.moduleKey.value).toBe("central");
    expect(form.submitting.value).toBe(false);

    await form.submitLogin();

    expect(login).toHaveBeenCalledWith("admin", "123", "central");
    expect(resolveHome).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/process");
    expect(form.submitting.value).toBe(false);
    expect(form.errorMessage.value).toBe("");
  });

  test("surfaces backend errors and does not navigate on failure", async () => {
    const login = vi.fn(async () => ({ ok: false, message: "Invalid credentials" }));
    const navigate = vi.fn();
    const form = useLoginForm({
      login,
      navigate,
      redirectPath: "",
      resolveModuleHome: vi.fn(() => "/"),
    });

    form.username.value = "bad";
    form.password.value = "bad";

    await form.submitLogin();

    expect(navigate).not.toHaveBeenCalled();
    expect(form.errorMessage.value).toBe("Invalid credentials");
    expect(form.submitting.value).toBe(false);
  });

  test("navigates to the handover module home when login succeeds without redirect", async () => {
    const login = vi.fn(async () => ({ module: "handover", ok: true }));
    const navigate = vi.fn();
    const resolveHome = vi.fn(() => "/handover-system");
    const form = useLoginForm({
      login,
      navigate,
      redirectPath: "",
      resolveModuleHome: resolveHome,
    });

    form.username.value = "handover";
    form.password.value = "123";
    form.moduleKey.value = "handover";

    await form.submitLogin();

    expect(login).toHaveBeenCalledWith("handover", "123", "handover");
    expect(resolveHome).toHaveBeenCalledWith("handover");
    expect(navigate).toHaveBeenCalledWith("/handover-system");
  });

  test("syncs MQTT mode before navigating after login", async () => {
    const login = vi.fn(async () => ({ module: "central", ok: true }));
    const navigate = vi.fn();
    const form = useLoginForm({
      login,
      navigate,
      redirectPath: "",
      resolveModuleHome: vi.fn(() => "/central"),
    });

    await form.submitLogin();

    expect(fetch).toHaveBeenCalledWith("/api/mq/interface-mode", expect.objectContaining({
      body: JSON.stringify({ mode: "mqtt" }),
      method: "POST",
    }));
    expect(navigate).toHaveBeenCalledWith("/central");
  });

  test("shows a sync error when the backend runtime mode update fails", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: async () => ({ detail: "MQTT 连接失败" }),
    });
    const form = useLoginForm({
      login: vi.fn(async () => ({ module: "central", ok: true })),
      navigate: vi.fn(),
      redirectPath: "",
      resolveModuleHome: vi.fn(() => "/"),
    });

    await form.submitLogin();

    expect(form.errorMessage.value).toBe("MQTT 连接失败");
  });

  test("navigates to the selected laboratory when the laboratory module succeeds", async () => {
    const login = vi.fn(async () => ({ module: "laboratory", ok: true }));
    const navigate = vi.fn();
    const form = useLoginForm({
      login,
      navigate,
      redirectPath: "",
      resolveModuleHome: vi.fn(() => "/laboratory"),
    });

    form.moduleKey.value = "laboratory";
    form.selectedLabName.value = "冲击一室";

    await form.submitLogin();

    expect(login).toHaveBeenCalledWith("admin", "123", "laboratory");
    expect(navigate).toHaveBeenCalledWith({
      path: "/laboratory",
      query: { lab: "冲击一室" },
    });
  });
});
