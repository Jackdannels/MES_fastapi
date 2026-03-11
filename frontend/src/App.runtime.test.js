import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";

import App from "./App.vue";
import { bootLegacyUI } from "./legacy/boot.js";

const { routeState, configState, routerReplace, logoutSessionMock } = vi.hoisted(() => ({
  routeState: {
    meta: { module: "central" },
    name: "task-overview",
    path: "/task-overview",
  },
  configState: {
    enableLegacyUiBridge: true,
  },
  routerReplace: vi.fn(),
  logoutSessionMock: vi.fn(() => Promise.resolve()),
}));

const reactiveRoute = reactive(routeState);
const legacyRouteNames = new Set(["dashboard", "tasks", "schedule", "samples", "devices", "data", "system"]);

vi.mock("./legacy/boot.js", () => ({
  bootLegacyUI: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/appConfig", () => ({
  appConfig: configState,
  shouldBridgeLegacyUi: (route) =>
    Boolean(configState.enableLegacyUiBridge && route?.meta?.legacyUi && legacyRouteNames.has(String(route?.name || ""))),
}));

vi.mock("vue-router", () => ({
  useRoute: () => reactiveRoute,
  useRouter: () => ({
    replace: routerReplace,
  }),
}));

vi.mock("@/auth", () => ({
  logoutSession: logoutSessionMock,
  readAuthSession: () => ({ module: "central" }),
}));

let wrapper;

const mountApp = () => {
  wrapper = mount(App, {
    global: {
      stubs: {
        RouterLink: true,
        RouterView: true,
      },
    },
  });
  return wrapper;
};

describe("App runtime boundary", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    reactiveRoute.meta = { module: "central" };
    reactiveRoute.name = "task-overview";
    reactiveRoute.path = "/task-overview";
    configState.enableLegacyUiBridge = true;
    routerReplace.mockReset();
    logoutSessionMock.mockClear();
    vi.clearAllMocks();
  });

  test("boots legacy ui for configured legacy routes", async () => {
    reactiveRoute.meta = { module: "central", legacyUi: true };
    reactiveRoute.name = "tasks";
    reactiveRoute.path = "/tasks";

    mountApp();

    await nextTick();

    expect(bootLegacyUI).toHaveBeenCalledTimes(1);
  });

  test("does not boot legacy ui for vue-native routes", async () => {
    mountApp();

    await nextTick();

    expect(bootLegacyUI).not.toHaveBeenCalled();
  });

  test("does not boot legacy ui when the bridge is disabled", async () => {
    reactiveRoute.meta = { module: "central", legacyUi: true };
    reactiveRoute.name = "dashboard";
    reactiveRoute.path = "/";
    configState.enableLegacyUiBridge = false;

    mountApp();

    await nextTick();

    expect(bootLegacyUI).not.toHaveBeenCalled();
  });

  test("boots legacy ui after navigating from a vue-native route to a configured legacy route", async () => {
    mountApp();

    await nextTick();

    reactiveRoute.meta = { module: "central", legacyUi: true };
    reactiveRoute.name = "schedule";
    reactiveRoute.path = "/schedule";

    await nextTick();
    await nextTick();
    await Promise.resolve();

    expect(bootLegacyUI).toHaveBeenCalledTimes(1);
  });

  test("logout delegates to backend session cleanup before routing to login", async () => {
    mountApp();

    const buttons = wrapper.findAll('button[type="button"]');
    await buttons[buttons.length - 1].trigger("click");
    await Promise.resolve();

    expect(logoutSessionMock).toHaveBeenCalledTimes(1);
    expect(routerReplace).toHaveBeenCalledWith("/login");
  });
});
