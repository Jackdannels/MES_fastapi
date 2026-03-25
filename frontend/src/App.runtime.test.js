import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";

import App from "./App.vue";

const { routeState, routerPush, routerReplace, logoutSessionMock, switchSessionModuleMock } = vi.hoisted(() => ({
  routeState: {
    meta: { module: "central", title: "任务/托盘总览" },
    name: "task-overview",
    path: "/task-overview",
  },
  routerPush: vi.fn(() => Promise.resolve()),
  routerReplace: vi.fn(),
  logoutSessionMock: vi.fn(() => Promise.resolve()),
  switchSessionModuleMock: vi.fn(async (moduleKey) => ({ ok: true, module: moduleKey })),
}));

const reactiveRoute = reactive(routeState);

vi.mock("vue-router", () => ({
  useRoute: () => reactiveRoute,
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
  }),
}));

vi.mock("@/auth", () => ({
  logoutSession: logoutSessionMock,
  resolveModuleHome: (moduleKey) => ({
    central: "/",
    handover: "/handover-system",
    visual: "/visualization",
    staging: "/staging-management",
  })[moduleKey] || "/",
  readAuthSession: () => ({ module: "central" }),
  switchSessionModule: switchSessionModuleMock,
}));

let wrapper;

const mountApp = () => {
  wrapper = mount(App, {
    global: {
      stubs: {
        RouterLink: true,
        RouterView: {
          template: '<div data-testid="router-view-stub">Route Outlet</div>',
        },
      },
    },
  });
  return wrapper;
};

describe("App runtime boundary", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    reactiveRoute.meta = { module: "central", title: "任务/托盘总览" };
    reactiveRoute.name = "task-overview";
    reactiveRoute.path = "/task-overview";
    routerPush.mockReset();
    routerReplace.mockReset();
    logoutSessionMock.mockClear();
    switchSessionModuleMock.mockClear();
    vi.clearAllMocks();
  });

  test("renders central shell for samples route", async () => {
    reactiveRoute.meta = { module: "central", title: "样品/托盘管理" };
    reactiveRoute.name = "samples";
    reactiveRoute.path = "/samples";

    mountApp();
    await nextTick();

    expect(wrapper.text()).toContain("样品/托盘管理");
  });

  test("renders handover routes without the shared shell", async () => {
    reactiveRoute.meta = { module: "handover", title: "接驳区系统", subtitle: "处理接驳区到样确认、托盘分装与交接。" };
    reactiveRoute.name = "handover-system";
    reactiveRoute.path = "/handover-system";

    mountApp();
    await nextTick();

    expect(wrapper.get('[data-testid="router-view-stub"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("七二四新火工区信息化中控管理系统");
    expect(wrapper.text()).not.toContain("实验室中控管理");
    expect(wrapper.text()).not.toContain("处理中控");
    expect(wrapper.text()).not.toContain("退出登录");
  });

  test("renders staging routes in the standalone module shell", async () => {
    reactiveRoute.meta = { module: "staging", title: "暂存间系统", subtitle: "管理暂存间样品入库、出库与总览。" };
    reactiveRoute.name = "staging-management";
    reactiveRoute.path = "/staging-management";

    mountApp();
    await nextTick();

    expect(wrapper.text()).toContain("七二四新火工区信息化中控管理系统");
    expect(wrapper.text()).toContain("暂存间系统");
    expect(wrapper.text()).toContain("退出登录");
    expect(wrapper.text()).not.toContain("实验室中控管理");
    expect(wrapper.text()).not.toContain("中控中心");
    expect(wrapper.text()).not.toContain("新建任务");
    expect(wrapper.text()).not.toContain("查看排程");
  });

  test("renders central shell for vue-native routes", async () => {
    reactiveRoute.meta = { module: "central", title: "任务/托盘总览" };

    mountApp();
    await nextTick();

    expect(wrapper.text()).toContain("任务/托盘总览");
  });

  test("updates page title area when navigating across central routes", async () => {
    reactiveRoute.meta = { module: "central", title: "试验数据", subtitle: "自动采集、校验与固定模板报告。" };

    mountApp();
    await nextTick();

    expect(wrapper.text()).toContain("试验数据");

    reactiveRoute.name = "devices";
    reactiveRoute.path = "/devices";
    reactiveRoute.meta = { module: "central", title: "设备资源", subtitle: "设备台账、校准状态与 Modbus 点位配置。" };
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("设备资源");
  });

  test("switches between central routes without bridge side effects", async () => {
    reactiveRoute.meta = { module: "central", title: "任务受理" };
    reactiveRoute.name = "tasks";
    reactiveRoute.path = "/tasks";

    mountApp();
    await nextTick();
    await nextTick();

    reactiveRoute.name = "schedule";
    reactiveRoute.path = "/schedule";
    reactiveRoute.meta = { module: "central", title: "排程看板" };
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("排程看板");
  });

  test("renders sidebar and header actions with utf-8 chinese labels", async () => {
    reactiveRoute.meta = { module: "central", title: "中控总览", subtitle: "任务、设备与数据流的实时概览。" };
    reactiveRoute.name = "dashboard";
    reactiveRoute.path = "/";

    mountApp();
    await nextTick();

    const text = wrapper.text();
    expect(text).toContain("七二四新火工区信息化中控管理系统");
    expect(text).toContain("实验室中控管理");
    expect(text).toContain("中控中心");
    expect(text).toContain("中控总览");
    expect(text).toContain("新建任务");
    expect(text).toContain("刷新");
    expect(text).toContain("退出登录");
    expect(text).toContain("自动采集");
    expect(text).toContain("固定报告");
  });

  test("opens the exit dialog instead of logging out immediately", async () => {
    mountApp();

    await wrapper.get('[data-testid="app-logout"]').trigger("click");
    await Promise.resolve();

    expect(wrapper.text()).toContain("切换其他界面");
    expect(logoutSessionMock).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  test("switches to another module without clearing the current session", async () => {
    mountApp();

    await wrapper.get('[data-testid="app-logout"]').trigger("click");
    await wrapper.get('[data-testid="module-exit-select"]').setValue("visual");
    await wrapper.get('[data-testid="module-exit-switch"]').trigger("click");
    await Promise.resolve();

    expect(logoutSessionMock).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
    expect(switchSessionModuleMock).toHaveBeenCalledWith("visual");
    expect(routerPush).toHaveBeenCalledWith("/visualization");
  });

  test("full logout still delegates to backend session cleanup before routing to login", async () => {
    mountApp();

    await wrapper.get('[data-testid="app-logout"]').trigger("click");
    await wrapper.get('[data-testid="module-exit-logout"]').trigger("click");
    await Promise.resolve();

    expect(logoutSessionMock).toHaveBeenCalledTimes(1);
    expect(routerReplace).toHaveBeenCalledWith("/login");
  });
});
