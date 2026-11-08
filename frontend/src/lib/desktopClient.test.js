import { afterEach, describe, expect, test, vi } from "vitest";
import { canCloseDesktopWindow, getDesktopHome, getDesktopLaboratory, getDesktopModule, requestDesktopClose } from "./desktopClient";
import { useTransferWorkbenchExit } from "@/modules/transfer-workbench/useTransferWorkbenchExit";
import { MODULE_ROUTES } from "./moduleCatalog";
import { LAB_CODE_BY_NAME } from "./labs";
import workstations from "../../../tools/desktop-client/workstations.json";
import { buildRouteAccessDecision } from "./authRouting";
import { useLoginForm } from "@/modules/login/useLoginForm";
import { mount } from "@vue/test-utils";
import ModuleExitDialog from "@/components/shared/ModuleExitDialog.vue";
import LoginPage from "@/modules/login/page.vue";

vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: vi.fn() }) }));

afterEach(() => {
  delete window.__MES_DESKTOP__;
  delete window.chrome;
  vi.unstubAllGlobals();
});

describe("fixed desktop client", () => {
  test("keeps normal browser login and unknown hosts on the original module-selection flow", () => {
    expect(getDesktopModule()).toBe("");
    window.__MES_DESKTOP__ = { module: "laboratory", version: "1.0.0" };
    expect(getDesktopModule()).toBe("");
  });

  test("always submits the central module and navigates home for a fixed central client", async () => {
    window.__MES_DESKTOP__ = { module: "central", version: "1.0.0" };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ mode: "mqtt", subscriber_running: true }) })));
    const login = vi.fn(async () => ({ ok: true, module: "central" }));
    const navigate = vi.fn();
    const form = useLoginForm({ login, navigate, redirectPath: "/laboratory", resolveModuleHome: () => "/" });
    form.moduleKey.value = "laboratory";
    await form.submitLogin();
    expect(login).toHaveBeenCalledWith("admin", "123", "central");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  test("allows reauthentication when an old session belongs to a different module", async () => {
    window.__MES_DESKTOP__ = { module: "central", version: "1.0.0" };
    const session = { username: "admin", module: "visual" };
    expect(await buildRouteAccessDecision({ session, to: { path: "/", meta: { module: "central" } } })).toEqual({ path: "/login" });
    expect(await buildRouteAccessDecision({ session, to: { path: "/login", meta: { layout: "auth" } } })).toBe(true);
  });

  test("retains logout and cancel while removing the mode switch controls", () => {
    const wrapper = mount(ModuleExitDialog, { props: { open: true, allowModuleSwitch: false } });
    expect(wrapper.find('[data-testid="module-exit-select"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="module-exit-switch"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="module-exit-logout"]').text()).toContain("退出");
    expect(wrapper.get('[data-testid="module-exit-cancel"]').text()).toBe("取消");
    wrapper.unmount();
  });

  test("packages every canonical laboratory once and all four remaining modules", () => {
    expect(Object.fromEntries(workstations.filter((station) => station.module === "laboratory")
      .map((station) => [station.labName, station.labCode]))).toEqual(LAB_CODE_BY_NAME);
    expect(workstations.filter((station) => station.module !== "laboratory").map((station) => station.module).sort())
      .toEqual(["appearance", "handover", "staging", "visual"]);
    expect(new Set(workstations.map((station) => station.folder)).size).toBe(15);
  });

  test.each(workstations)("fixes login and routing for $folder", async (station) => {
    window.__MES_DESKTOP__ = { ...station, version: "1.6.0" };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ mode: "mqtt", subscriber_running: true }) })));
    const login = vi.fn(async () => ({ ok: true, module: station.module }));
    const navigate = vi.fn();
    const form = useLoginForm({ login, navigate, redirectPath: "/process", resolveModuleHome: () => "/" });
    form.moduleKey.value = "central";
    form.selectedLabName.value = "其他房间";
    await form.submitLogin();
    expect(login).toHaveBeenCalledWith("admin", "123", station.module);
    const home = station.module === "laboratory"
      ? { path: "/laboratory", query: { lab: station.labCode } } : MODULE_ROUTES[station.module];
    expect(navigate).toHaveBeenCalledWith(home);
    expect(getDesktopHome()).toEqual(home);
    expect(getDesktopLaboratory()).toBe(station.labName);
    expect(await buildRouteAccessDecision({ session: { module: station.module }, to: { meta: { layout: "auth" } } })).toEqual(home);
    expect(await buildRouteAccessDecision({ session: { module: station.module }, to: { meta: { module: "central" } } })).toEqual(home);
  });

  test("rejects a host with inconsistent room identity", () => {
    window.__MES_DESKTOP__ = { module: "laboratory", version: "1.6.0", labCode: "LAB_IMPACT_1", labName: "冲击二室" };
    expect(getDesktopModule()).toBe("");
    expect(getDesktopHome()).toBeNull();
  });

  test.each(workstations)("labels the $folder login without room or module selectors", (station) => {
    window.__MES_DESKTOP__ = { ...station, version: "1.6.0" };
    const wrapper = mount(LoginPage);
    expect(wrapper.get(".login-subtitle").text()).toBe(`${station.folder === "可视化管理" ? "可视化管理" : station.labName || station.folder}专用登录`);
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.find('input[autocomplete="username"]').exists()).toBe(true);
    wrapper.unmount();
  });

  test("keeps even an administrator session in the compiled room and rejects a conflicting terminal binding", async () => {
    window.__MES_DESKTOP__ = { module: "laboratory", version: "1.6.0", labCode: "LAB_HOT_HUMID_2", labName: "高低温湿热二室" };
    const home = { path: "/laboratory", query: { lab: "LAB_HOT_HUMID_2" } };
    expect(await buildRouteAccessDecision({ session: { module: "laboratory" }, to: { meta: { module: "laboratory" }, query: { lab: "LAB_SALT" } } })).toEqual(home);
    expect(await buildRouteAccessDecision({ session: { module: "laboratory" }, to: { meta: { module: "laboratory" }, query: home.query } })).toBe(true);
    expect(await buildRouteAccessDecision({ session: { module: "laboratory", terminal_auth: true, lab_name: "冲击一室" }, to: { meta: { module: "laboratory" } } })).toEqual({ path: "/login" });
    expect(await buildRouteAccessDecision({ session: { module: "laboratory", terminal_auth: true, lab_name: "冲击一室" }, to: { meta: { layout: "auth" } } })).toBe(true);
  });

  test.each(workstations)("uses automatic entry and native close for $folder", async (station) => {
    window.__MES_DESKTOP__ = { ...station, version: "1.7.0", autoLogin: true, canCloseWindow: true };
    const postMessage = vi.fn();
    window.chrome = { webview: { postMessage } };
    const wrapper = mount(LoginPage);
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.get('[data-testid="desktop-auto-login"]').text()).toContain("正在连接");
    expect(postMessage).toHaveBeenCalledWith("mes-client-auth-required");
    expect(canCloseDesktopWindow()).toBe(true);
    expect(requestDesktopClose()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith("mes-client-close-request");
    const exit = useTransferWorkbenchExit({ replace: vi.fn() });
    exit.handleLogout();
    expect(exit.exitDialogOpen.value).toBe(false);
    wrapper.unmount();
  });

  test("does not offer the native close bridge for central management", () => {
    window.__MES_DESKTOP__ = { module: "central", version: "1.7.0", canCloseWindow: true };
    window.chrome = { webview: { postMessage: vi.fn() } };
    expect(requestDesktopClose()).toBe(false);
    expect(window.chrome.webview.postMessage).not.toHaveBeenCalled();
  });
});
