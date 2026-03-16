import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";

import App from "./App.vue";

const { routeState, routerReplace, logoutSessionMock } = vi.hoisted(() => ({
  routeState: {
    meta: { module: "central", title: "任务/托盘总览" },
    name: "task-overview",
    path: "/task-overview",
  },
  routerReplace: vi.fn(),
  logoutSessionMock: vi.fn(() => Promise.resolve()),
}));

const reactiveRoute = reactive(routeState);

vi.mock("vue-router", () => ({
  useRoute: () => reactiveRoute,
  useRouter: () => ({
    push: vi.fn(() => Promise.resolve()),
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
    reactiveRoute.meta = { module: "central", title: "任务/托盘总览" };
    reactiveRoute.name = "task-overview";
    reactiveRoute.path = "/task-overview";
    routerReplace.mockReset();
    logoutSessionMock.mockClear();
    vi.clearAllMocks();
  });

  test("renders central shell for samples route", async () => {
    reactiveRoute.meta = { module: "central", title: "样品管理" };
    reactiveRoute.name = "samples";
    reactiveRoute.path = "/samples";

    mountApp();
    await nextTick();

    expect(wrapper.text()).toContain("样品管理");
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

  test("logout delegates to backend session cleanup before routing to login", async () => {
    mountApp();

    const buttons = wrapper.findAll('button[type="button"]');
    await buttons[buttons.length - 1].trigger("click");
    await Promise.resolve();

    expect(logoutSessionMock).toHaveBeenCalledTimes(1);
    expect(routerReplace).toHaveBeenCalledWith("/login");
  });
});
