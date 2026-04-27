import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";

import App from "./App.vue";
import { getNavigationModules } from "@/modules";

const { routeState, routerPush, routerReplace, logoutSessionMock, switchSessionModuleMock, loadSnapshotMock } = vi.hoisted(() => ({
  routeState: {
    meta: { module: "central", title: "任务/托盘总览" },
    name: "task-overview",
    path: "/task-overview",
    query: {},
    hash: "",
  },
  routerPush: vi.fn(() => Promise.resolve()),
  routerReplace: vi.fn(),
  logoutSessionMock: vi.fn(() => Promise.resolve()),
  switchSessionModuleMock: vi.fn(async (moduleKey) => ({ ok: true, module: moduleKey })),
  loadSnapshotMock: vi.fn(async () => ({ "mes.tasks": [], "mes.experiments": [] })),
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
    laboratory: "/laboratory",
  })[moduleKey] || "/",
  readAuthSession: () => ({ module: "central" }),
  switchSessionModule: switchSessionModuleMock,
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: loadSnapshotMock,
  }),
}));

let wrapper;

const mountApp = () => {
  wrapper = mount(App, {
    global: {
      stubs: {
        RouterLink: {
          props: ["to"],
          template: '<a class="router-link-stub"><slot /></a>',
        },
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
    reactiveRoute.query = {};
    reactiveRoute.hash = "";
    routerPush.mockReset();
    routerReplace.mockReset();
    logoutSessionMock.mockClear();
    switchSessionModuleMock.mockClear();
    loadSnapshotMock.mockReset();
    loadSnapshotMock.mockResolvedValue({ "mes.tasks": [], "mes.experiments": [] });
    vi.clearAllMocks();
  });

  test("renders central shell for samples route", async () => {
    reactiveRoute.meta = { module: "central", title: "样品/托盘信息" };
    reactiveRoute.name = "samples";
    reactiveRoute.path = "/samples";

    mountApp();
    await nextTick();

    expect(wrapper.text()).toContain("样品/托盘信息");
    expect(wrapper.text()).not.toContain("样品/托盘管理");
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

    expect(wrapper.text()).toContain("暂存间系统");
    expect(wrapper.text()).toContain("退出登录");
    expect(wrapper.find(".sidebar").exists()).toBe(false);
    expect(wrapper.find(".nav-link").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("实验室中控管理");
    expect(wrapper.text()).not.toContain("中控中心");
    expect(wrapper.text()).not.toContain("新建任务");
    expect(wrapper.text()).not.toContain("查看排程");
  });

  test("renders laboratory routes in the standalone module shell", async () => {
    reactiveRoute.meta = { module: "laboratory", title: "盐雾试验室操作台", subtitle: "查看盐雾试验室当前任务与实验准备流程。" };
    reactiveRoute.name = "laboratory";
    reactiveRoute.path = "/laboratory";

    mountApp();
    await nextTick();

    expect(wrapper.text()).toContain("盐雾试验室操作台");
    expect(wrapper.text()).toContain("退出登录");
    expect(wrapper.text()).toContain("七二四新火工区信息化中控管理系统");
    expect(wrapper.find(".sidebar").exists()).toBe(true);
    expect(wrapper.find(".nav-link").exists()).toBe(true);
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

  test("shows the task reset action only on the tasks route", async () => {
    reactiveRoute.meta = { module: "central", title: "任务受理" };
    reactiveRoute.name = "tasks";
    reactiveRoute.path = "/tasks";

    mountApp();
    await nextTick();
    await nextTick();

    expect(wrapper.find('[data-testid="open-task-reset"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="open-task-intake"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("查看排程");

    reactiveRoute.meta = { module: "central", title: "中控总览" };
    reactiveRoute.name = "dashboard";
    reactiveRoute.path = "/";
    await nextTick();
    await nextTick();

    expect(wrapper.find('[data-testid="open-task-reset"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="open-task-intake"]').exists()).toBe(false);
  });

  test("renders central sidebar and header actions with utf-8 chinese labels", async () => {
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
    expect(wrapper.find(".sidebar").exists()).toBe(true);
    expect(wrapper.find(".nav-link").exists()).toBe(true);
    expect(text).not.toContain("新建任务");
    expect(text).not.toContain("查看排程");
    expect(text).toContain("刷新");
    expect(text).toContain("退出登录");
    expect(text).toContain("自动采集");
    expect(text).toContain("固定报告");
  });

  test("renders central sidebar with task intake before task overview", async () => {
    const navLabels = getNavigationModules("central").map((item) => item.route.meta?.title);
    expect(navLabels.indexOf("任务受理")).toBeGreaterThan(-1);
    expect(navLabels.indexOf("任务/托盘总览")).toBeGreaterThan(-1);
    expect(navLabels.indexOf("任务受理")).toBeLessThan(navLabels.indexOf("任务/托盘总览"));
  });

  test("renders central sidebar with pre-allocation, renamed samples, and task history entries", async () => {
    const navLabels = getNavigationModules("central").map((item) => item.route.meta?.title);

    expect(navLabels).toContain("样品预接驳");
    expect(navLabels).toContain("样品/托盘信息");
    expect(navLabels).toContain("历史任务数据");
    expect(navLabels).not.toContain("样品/托盘管理");
    expect(navLabels.indexOf("任务/托盘总览")).toBeLessThan(navLabels.indexOf("样品预接驳"));
    expect(navLabels.indexOf("样品预接驳")).toBeLessThan(navLabels.indexOf("排程看板"));
    expect(navLabels.indexOf("系统信息")).toBeLessThan(navLabels.indexOf("历史任务数据"));
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

  test("shows a red dot on the task overview menu item when any experiment is overdue", async () => {
    reactiveRoute.meta = { module: "central", title: "中控总览" };
    reactiveRoute.name = "dashboard";
    reactiveRoute.path = "/";
    loadSnapshotMock.mockResolvedValue({
      "mes.tasks": [
        {
          code: "SYLU-2026-03-011",
          transfer_status: "已入库",
        },
      ],
      "mes.experiments": [
        {
          task_code: "SYLU-2026-03-011",
          experiment_code: "SYLU-2026-03-011-A",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
      ],
    });

    mountApp();
    await nextTick();
    await nextTick();

    const navText = wrapper.findAll(".nav-link").find((node) => node.text().includes("任务/托盘总览"));

    expect(navText.exists()).toBe(true);
    expect(navText.find(".nav-alert-dot").exists()).toBe(true);
  });

  test("does not show a red dot when overdue experiments belong to tasks that are not yet stored", async () => {
    reactiveRoute.meta = { module: "central", title: "中控总览" };
    reactiveRoute.name = "dashboard";
    reactiveRoute.path = "/";
    loadSnapshotMock.mockResolvedValue({
      "mes.tasks": [
        {
          code: "SYLU-2026-03-012",
          transfer_status: "未入库",
        },
      ],
      "mes.experiments": [
        {
          task_code: "SYLU-2026-03-012",
          experiment_code: "SYLU-2026-03-012-A",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
      ],
    });

    mountApp();
    await nextTick();
    await nextTick();

    const navText = wrapper.findAll(".nav-link").find((node) => node.text().includes("任务/托盘总览"));

    expect(navText.exists()).toBe(true);
    expect(navText.find(".nav-alert-dot").exists()).toBe(false);
  });

  test("does not show a red dot when the overdue experiment already has a formal schedule", async () => {
    reactiveRoute.meta = { module: "central", title: "中控总览" };
    reactiveRoute.name = "dashboard";
    reactiveRoute.path = "/";
    loadSnapshotMock.mockResolvedValue({
      "mes.tasks": [
        {
          code: "SYLU-2026-03-013",
          transfer_status: "已入库",
        },
      ],
      "mes.schedules": [
        {
          id: "schedule-1",
          task_code: "SYLU-2026-03-013",
          experiment_code: "SYLU-2026-03-013-A",
          device: "冲击一室",
          start_at: "2026-03-17T12:00:00.000Z",
          end_at: "2026-03-17T15:00:00.000Z",
        },
      ],
      "mes.experiments": [
        {
          task_code: "SYLU-2026-03-013",
          experiment_code: "SYLU-2026-03-013-A",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
      ],
    });

    mountApp();
    await nextTick();
    await nextTick();

    const navText = wrapper.findAll(".nav-link").find((node) => node.text().includes("任务/托盘总览"));

    expect(navText.exists()).toBe(true);
    expect(navText.find(".nav-alert-dot").exists()).toBe(false);
  });

  test("clicking the task overview nav routes to the lowest overdue task when the red dot is active", async () => {
    reactiveRoute.meta = { module: "central", title: "中控总览" };
    reactiveRoute.name = "dashboard";
    reactiveRoute.path = "/";
    loadSnapshotMock.mockResolvedValue({
      "mes.tasks": [
        { code: "SYLU-2026-03-003", transfer_status: "已入库" },
        { code: "SYLU-2026-03-002", transfer_status: "已入库" },
      ],
      "mes.schedules": [],
      "mes.experiments": [
        {
          task_code: "SYLU-2026-03-003",
          experiment_code: "SYLU-2026-03-003-B",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
      ],
    });

    mountApp();
    await nextTick();
    await nextTick();

    const navLink = wrapper.findAll(".nav-link").find((node) => node.text().includes("任务/托盘总览"));

    expect(navLink.exists()).toBe(true);

    await navLink.trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      path: "/task-overview",
      query: { highlightTask: "SYLU-2026-03-002" },
    });
  });
});
