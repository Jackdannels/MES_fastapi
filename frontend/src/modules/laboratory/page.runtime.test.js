import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import LaboratoryPage from "./page.vue";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/useSampleIntake";

let wrapper;
let pageHeader;
let headerActions;
let masterLabsState;
let snapshotState;
let storageGetSnapshotOverride;
const WITHDRAWABLE_LAB_STATUSES = new Set(["已到达实验室", "工装夹具安装", "实验准备就绪"]);
const { routeState } = vi.hoisted(() => ({
  routeState: {
    query: {},
  },
}));
const reactiveRoute = reactive(routeState);

vi.mock("vue-router", () => ({
  useRoute: () => reactiveRoute,
}));

const toDisplayedTime = (value) => {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const toDisplayedDateTime = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${toDisplayedTime(value)}`;
};
const flushPageUpdates = async (cycles = 4) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
  await nextTick();
};
const storageGetCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/storage") && (options.method || "GET") === "GET");
const storagePutCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/storage") && (options.method || "GET") === "PUT");
const masterLabsGetCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/master/labs") && (options.method || "GET") === "GET");
const waitForInitialLaboratoryLoad = async (storageCount, masterLabCount) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    if (storageGetCalls().length >= storageCount && masterLabsGetCalls().length >= masterLabCount) {
      await flushPageUpdates();
      return;
    }
  }
  expect(storageGetCalls()).toHaveLength(storageCount);
  expect(masterLabsGetCalls()).toHaveLength(masterLabCount);
};
const waitForStorageGetCount = async (count) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    if (storageGetCalls().length >= count) {
      return;
    }
  }
  expect(storageGetCalls()).toHaveLength(count);
};
const waitForStoragePutCount = async (count) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    if (storagePutCalls().length >= count) {
      return;
    }
  }
  expect(storagePutCalls()).toHaveLength(count);
};
const waitForSamplesUpdatedEvent = async (spy, count) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    if (spy.mock.calls.filter(([event]) => event?.type === SAMPLES_UPDATED_EVENT).length >= count) {
      await flushPageUpdates();
      return;
    }
  }
  expect(spy.mock.calls.filter(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toHaveLength(count);
};
const createSnapshot = () => ({
  [STORAGE_KEYS.tasks]: [
    { code: "SYLU-2026-04-101", name: "盐雾连接器", test_type: "盐雾试验" },
    { code: "SYLU-2026-04-201", name: "盐雾壳体", test_type: "盐雾试验" },
    { code: "SYLU-2026-04-301", name: "复合环境任务", test_type: "高低温湿热试验 / 盐雾试验" },
    { code: "SYLU-2026-04-102", name: "振动连接器", test_type: "振动试验" },
  ],
  [STORAGE_KEYS.experiments]: [
    { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验-A" },
    { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", experiment_name: "盐雾试验-B" },
    { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", experiment_name: "高低温湿热试验" },
    { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", experiment_name: "盐雾试验" },
    { task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", experiment_name: "振动试验" },
  ],
  [STORAGE_KEYS.experiment_trays]: [
    { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
    { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-002" },
    { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", tray_code: "TP-101" },
    { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", tray_code: "TP-301" },
    { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", tray_code: "TP-301" },
  ],
  [STORAGE_KEYS.samples]: [
    {
      code: "SYLU-2026-04-101-SP-001",
      location: "盐雾试验室",
      owner: "王工",
      status: "已到达实验室",
      task_code: "SYLU-2026-04-101",
      trays: [
        { quantity: 2, status: "到货", tray_code: "TP-001" },
        { quantity: 2, status: "到货", tray_code: "TP-002" },
      ],
    },
    {
      code: "SYLU-2026-04-201-SP-001",
      location: "盐雾试验室",
      owner: "李工",
      status: "已到达实验室",
      task_code: "SYLU-2026-04-201",
      trays: [{ quantity: 1, tray_code: "TP-101" }],
    },
    {
      code: "SYLU-2026-04-301-SP-001",
      location: "接驳区",
      owner: "赵工",
      status: "送至实验室",
      task_code: "SYLU-2026-04-301",
      trays: [{ quantity: 1, tray_code: "TP-301" }],
    },
  ],
  [STORAGE_KEYS.schedules]: [
    {
      id: "schedule-1",
      task_code: "SYLU-2026-04-101",
      experiment_code: "SYLU-2026-04-101-A",
      device: "盐雾试验室",
      start_at: "2026-04-02T09:30:00.000Z",
      end_at: "2026-04-02T11:00:00.000Z",
    },
    {
      id: "schedule-3",
      task_code: "SYLU-2026-04-201",
      experiment_code: "SYLU-2026-04-201-A",
      device: "盐雾试验室",
      start_at: "2026-04-02T12:00:00.000Z",
      end_at: "2026-04-02T13:00:00.000Z",
    },
    {
      id: "schedule-2",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-A",
      device: "振动一室",
      start_at: "2026-04-02T09:30:00.000Z",
      end_at: "2026-04-02T11:00:00.000Z",
    },
    {
      id: "schedule-4",
      task_code: "SYLU-2026-04-301",
      experiment_code: "SYLU-2026-04-301-A",
      device: "高低温湿热一室",
      start_at: "2026-04-02T10:30:00.000Z",
      end_at: "2026-04-02T12:00:00.000Z",
    },
    {
      id: "schedule-5",
      task_code: "SYLU-2026-04-301",
      experiment_code: "SYLU-2026-04-301-B",
      device: "盐雾试验室",
      start_at: "2026-04-02T12:30:00.000Z",
      end_at: "2026-04-02T14:00:00.000Z",
    },
  ],
});

const mountPage = async () => {
  const expectedStorageGetCalls = storageGetCalls().length + 1;
  const expectedMasterLabsGetCalls = masterLabsGetCalls().length + 1;
  pageHeader = document.createElement("header");
  pageHeader.className = "page-header";
  pageHeader.innerHTML = `
    <div>
      <div class="eyebrow">盐雾试验室操作台</div>
      <h1>盐雾试验室操作台</h1>
      <p class="subtitle">查看盐雾试验室当前任务与实验准备流程。</p>
    </div>
    <div class="header-actions">
      <button class="action-btn secondary" type="button">刷新</button>
      <span class="header-actions-before-logout"></span>
      <button class="action-btn secondary" data-testid="app-logout" type="button">退出登录</button>
    </div>
  `;
  document.body.appendChild(pageHeader);
  headerActions = pageHeader.querySelector(".header-actions");

  wrapper = mount(LaboratoryPage, { attachTo: document.body });
  await waitForInitialLaboratoryLoad(expectedStorageGetCalls, expectedMasterLabsGetCalls);
  return wrapper;
};

const mountPageInsideShell = async () => {
  const expectedStorageGetCalls = storageGetCalls().length + 1;
  const expectedMasterLabsGetCalls = masterLabsGetCalls().length + 1;
  const Shell = {
    components: { LaboratoryPage },
    template: `
      <div>
        <header class="page-header">
          <div>
            <div class="eyebrow">盐雾试验室操作台</div>
            <h1>盐雾试验室操作台</h1>
            <p class="subtitle">查看盐雾试验室当前任务与实验准备流程。</p>
          </div>
          <div class="header-actions">
            <span class="header-actions-before-logout"></span>
            <button class="action-btn secondary" data-testid="app-logout" type="button">退出登录</button>
          </div>
        </header>
        <LaboratoryPage />
      </div>
    `,
  };
  wrapper = mount(Shell, { attachTo: document.body });
  await waitForInitialLaboratoryLoad(expectedStorageGetCalls, expectedMasterLabsGetCalls);
  return wrapper;
};

describe("LaboratoryPage runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T10:00:00.000Z"));
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });
    snapshotState = createSnapshot();
    masterLabsState = [];
    storageGetSnapshotOverride = null;
    reactiveRoute.query = {};
    vi.stubGlobal("fetch", vi.fn(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/master/labs")) {
        return { ok: true, status: 200, json: async () => masterLabsState };
      }
      if (url.includes("/api/laboratory/") && url.includes("/withdraw-current")) {
        const match = url.match(/\/api\/laboratory\/tasks\/([^/]+)\/experiments\/([^/]+)\/withdraw-current/);
        const taskCode = decodeURIComponent(match?.[1] || "");
        const experimentCode = decodeURIComponent(match?.[2] || "");
        const trayCodes = new Set(
          (snapshotState[STORAGE_KEYS.experiment_trays] || [])
            .filter((entry) => entry.task_code === taskCode && entry.experiment_code === experimentCode)
            .map((entry) => entry.tray_code),
        );
        snapshotState = {
          ...snapshotState,
          [STORAGE_KEYS.samples]: (snapshotState[STORAGE_KEYS.samples] || []).map((sample) => {
            if (sample.task_code !== taskCode || !Array.isArray(sample.trays)) {
              return sample;
            }
            const touchesCurrentExperiment = sample.trays.some((tray) => trayCodes.has(tray.tray_code));
            if (!touchesCurrentExperiment) {
              return sample;
            }
            const withdrawableTrayCodes = new Set(
              sample.trays
                .filter((tray) => trayCodes.has(tray.tray_code) && WITHDRAWABLE_LAB_STATUSES.has(String(tray.status || sample.status || "").trim()))
                .map((tray) => tray.tray_code),
            );
            if (withdrawableTrayCodes.size === 0) {
              return sample;
            }
            return {
              ...sample,
              flow_status: "到货",
              location: "接驳区",
              status: "到货",
              trays: sample.trays.map((tray) =>
                withdrawableTrayCodes.has(tray.tray_code)
                  ? { ...tray, fixtureReady: undefined, fixture_ready: undefined, status: "到货" }
                  : tray,
              ),
            };
          }),
        };
        return { ok: true, status: 200, json: async () => ({ ok: true, samples: snapshotState[STORAGE_KEYS.samples] }) };
      }
      if (url.includes("/api/storage")) {
        if ((options.method || "GET") === "PUT") {
          const payload = JSON.parse(String(options.body || "{}"));
          snapshotState = {
            ...snapshotState,
            ...payload,
          };
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        const snapshot = typeof storageGetSnapshotOverride === "function" ? storageGetSnapshotOverride() : snapshotState;
        return { ok: true, status: 200, json: async () => snapshot };
      }
      if (url.includes("/api/mq/laboratory")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, published: false }) };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    pageHeader?.remove();
    pageHeader = undefined;
    headerActions = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("locks laboratory actions when the selected lab is under maintenance", async () => {
    masterLabsState = [
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.devices]: [
        { code: "盐雾试验室", name: "盐雾试验室", status: "维护/校准" },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-101-SP-001",
          location: "盐雾试验室",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.text()).toContain("设备维护中，禁止实验室操作");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
  });

  test("uses the laboratory query to render and publish commands for a non-salt workbench", async () => {
    reactiveRoute.query = { lab: "冲击一室" };
    masterLabsState = [
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.samples]: [
        ...createSnapshot()[STORAGE_KEYS.samples],
        {
          code: "SYLU-2026-04-501-SP-001",
          location: "冲击一室",
          owner: "周工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-501",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-CJ-001" }],
        },
      ],
      [STORAGE_KEYS.tasks]: [
        ...createSnapshot()[STORAGE_KEYS.tasks],
        { code: "SYLU-2026-04-501", name: "冲击连接器", test_type: "冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        ...createSnapshot()[STORAGE_KEYS.experiments],
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", experiment_name: "冲击试验" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        ...createSnapshot()[STORAGE_KEYS.experiment_trays],
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", tray_code: "TP-CJ-001" },
      ],
      [STORAGE_KEYS.schedules]: [
        ...createSnapshot()[STORAGE_KEYS.schedules],
        {
          id: "schedule-impact",
          task_code: "SYLU-2026-04-501",
          experiment_code: "SYLU-2026-04-501-A",
          device: "冲击一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.text()).toContain("冲击一室操作台");
    expect(mounted.text()).toContain("SYLU-2026-04-501");
    expect(mounted.text()).not.toContain("SYLU-2026-04-101");

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-CJ-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();
    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await flushPageUpdates();

    const fixtureInstallCall = fetch.mock.calls.findLast(([input]) => String(input).includes("/api/mq/laboratory/fixture-install"));
    expect(JSON.parse(String(fixtureInstallCall[1].body))).toEqual(expect.objectContaining({
      labId: "LAB_IMPACT_1",
      taskId: "SYLU-2026-04-501",
    }));
    expect(window.localStorage.setItem).toHaveBeenCalledWith("mes_laboratory_selected_lab_v1", "冲击一室");
  });

  test("renders the salt-spray laboratory console and excludes other laboratory tasks", async () => {
    const mounted = await mountPage();

    expect(mounted.text()).toContain("盐雾试验室操作台");
    expect(mounted.text()).toContain("今日实验排程数量");
    expect(mounted.text()).toContain("SYLU-2026-04-101");
    expect(mounted.text()).toContain("盐雾试验-A");
    expect(mounted.text()).toContain(toDisplayedDateTime("2026-04-02T09:30:00.000Z"));
    expect(mounted.text()).toContain(toDisplayedDateTime("2026-04-02T11:00:00.000Z"));
    expect(mounted.text()).not.toContain("SYLU-2026-04-102");
    expect(mounted.find('[data-testid="laboratory-reset-task"]').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-reset-task"]').text()).toContain("重置实验室任务");
    expect(mounted.find(".laboratory-control-header .pill").exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
    expect(mounted.get(".laboratory-recent-task__head").text()).toContain("SYLU-2026-04-101");
  });

  test("uses the canonical salt-spray master lab to filter laboratory schedules", async () => {
    masterLabsState = [
      { code: "LAB_SALT", name: "盐雾试验室（东区）", type: "实验室", testTypeName: "盐雾试验", status: 1 },
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-001", name: "盐雾东区任务", test_type: "盐雾试验" },
        { code: "SYLU-2026-06-002", name: "旧盐雾任务", test_type: "盐雾试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-A", experiment_name: "盐雾试验" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", tray_code: "TP-SALT-2" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-A", tray_code: "TP-SALT-OLD" },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-001-SP-001",
          location: "盐雾试验室（东区）",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-06-001",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-SALT-2" }],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-master-salt",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          device: "盐雾试验室（东区）",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-old-salt",
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T12:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.text()).toContain("盐雾试验室（东区）操作台");
    expect(mounted.text()).toContain("SYLU-2026-06-001");
    expect(mounted.text()).not.toContain("SYLU-2026-06-002");
  });

  test("disables comparison and shows guidance when the salt-spray lab has no tasks", async () => {
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.schedules]: [],
    };
    const mounted = await mountPage();

    expect(mounted.text()).toContain("当前盐雾试验室暂无任务");
    expect(mounted.text()).toContain("请先在排程看板安排任务");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(false);

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    await nextTick();

    expect(mounted.get('[data-testid="laboratory-task-list-modal"]').text()).toContain("当前实验室暂无任务");
  });

  test("reloads flow state when sample progress changes are broadcast", async () => {
    await mountPage();

    expect(storageGetCalls()).toHaveLength(1);

    snapshotState = {
      ...snapshotState,
      [STORAGE_KEYS.samples]: snapshotState[STORAGE_KEYS.samples].map((sample) =>
        sample.task_code === "SYLU-2026-04-101"
          ? {
              ...sample,
              status: "工装夹具安装",
              trays: sample.trays.map((tray) => ({ ...tray, status: "工装夹具安装" })),
            }
          : sample,
      ),
    };

    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await waitForStorageGetCount(2);

    expect(storageGetCalls()).toHaveLength(2);
  });

  test("does not teleport any schedule button into the laboratory header actions", async () => {
    const mounted = await mountPage();

    const scheduleButton = document.body.querySelector('[data-testid="laboratory-open-schedule"]');
    expect(scheduleButton).toBeNull();

    const headerButtons = Array.from(headerActions.querySelectorAll("button")).map((button) => String(button.textContent || "").trim());
    expect(headerButtons).toContain("刷新");
    expect(headerButtons).toContain("退出登录");
    expect(headerButtons).not.toContain("查看排程");
    expect(mounted.find('[data-testid="laboratory-schedule-modal"].is-open').exists()).toBe(false);
  });

  test("shows a disabled header display-modal button when no experiment is running", async () => {
    await mountPage();

    const displayButton = document.body.querySelector('[data-testid="laboratory-show-running-modal"]');
    const logoutButton = document.body.querySelector('[data-testid="app-logout"]');
    const headerButtons = Array.from(headerActions.querySelectorAll("button")).map((button) => String(button.textContent || "").trim());

    expect(headerButtons).toEqual(["刷新", "显示弹窗", "退出登录"]);
    expect(displayButton?.getAttribute("disabled")).not.toBeNull();
    expect(logoutButton?.previousElementSibling?.querySelector('[data-testid="laboratory-show-running-modal"]')).toBe(displayButton);
  });

  test("mounts the header display-modal button when the page and shell render together", async () => {
    await mountPageInsideShell();

    const displayButton = document.body.querySelector('[data-testid="laboratory-show-running-modal"]');
    const logoutButton = document.body.querySelector('[data-testid="app-logout"]');

    expect(displayButton?.textContent?.trim()).toBe("显示弹窗");
    expect(displayButton?.getAttribute("disabled")).not.toBeNull();
    expect(logoutButton?.previousElementSibling?.querySelector('[data-testid="laboratory-show-running-modal"]')).toBe(displayButton);
  });

  test("shows detailed task rows, allows selecting the next task, and updates the current task after confirmation", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");

    expect(mounted.find('[data-testid="laboratory-task-list-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-task-row-SYLU-2026-04-101"]').classes()).toContain("is-current");
    expect(mounted.text()).toContain("TP-001");
    expect(mounted.text()).toContain("TP-002");
    expect(mounted.text()).toContain("TP-101");
    expect(mounted.text()).toContain(toDisplayedTime("2026-04-02T12:00:00.000Z"));
    expect(mounted.text()).toContain(toDisplayedTime("2026-04-02T13:00:00.000Z"));

    await mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-task-row-SYLU-2026-04-201"]').classes()).toContain("is-pending");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");

    expect(mounted.text()).toContain("SYLU-2026-04-201 / 盐雾试验-B");
    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-task-row-SYLU-2026-04-201"]').classes()).toContain("is-current");
  });

  test("locks task actions after switching away from a task that has completed comparison", async () => {
    snapshotState[STORAGE_KEYS.samples][0] = {
      ...snapshotState[STORAGE_KEYS.samples][0],
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [
        { quantity: 2, status: "送至实验室", tray_code: "TP-001" },
        { quantity: 2, status: "送至实验室", tray_code: "TP-002" },
      ],
    };
    snapshotState[STORAGE_KEYS.samples][1] = {
      ...snapshotState[STORAGE_KEYS.samples][1],
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-101" }],
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    await mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]').trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await flushPageUpdates();

    expect(mounted.text()).toContain("SYLU-2026-04-201 / 盐雾试验-B");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await flushPageUpdates();
    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(false);
  });

  test("collapses many task-list trays and opens a full tray detail modal", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiment_trays] = Array.from({ length: 7 }, (_, index) => ({
      task_code: "SYLU-2026-04-101",
      experiment_code: "SYLU-2026-04-101-A",
      tray_code: `TP-${String(index + 1).padStart(3, "0")}`,
    }));
    snapshotState[STORAGE_KEYS.samples] = snapshotState[STORAGE_KEYS.experiment_trays].map((entry, index) => ({
      code: `SYLU-2026-04-101-SP-${String(index + 1).padStart(3, "0")}`,
      location: "盐雾试验室",
      owner: "王工",
      status: "已到达实验室",
      task_code: "SYLU-2026-04-101",
      trays: [{ quantity: 1, status: "到货", tray_code: entry.tray_code }],
    }));

    const mounted = await mountPage();
    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");

    const currentRow = mounted.get('[data-testid="laboratory-task-row-SYLU-2026-04-101"]');
    const trayList = currentRow.get(".laboratory-task-tray-list");
    expect(trayList.findAll(".laboratory-tray-chip")).toHaveLength(3);
    expect(trayList.text()).toContain("+4");
    expect(trayList.text()).toContain("查看全部");
    expect(trayList.text()).not.toContain("TP-007");

    await currentRow.get('[data-testid="laboratory-task-row-show-all-SYLU-2026-04-101"]').trigger("click");

    expect(mounted.find('[data-testid="laboratory-full-content-modal"].is-open').exists()).toBe(true);
    expect(mounted.findAll("[data-testid^='laboratory-full-tray-row-']")).toHaveLength(7);
    expect(mounted.text()).toContain("TP-007");
    expect(mounted.text()).toContain("SYLU-2026-04-101-SP-007");
  });

  test("compares trays against the current task and shows green/red feedback", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples][0] = {
      ...snapshotState[STORAGE_KEYS.samples][0],
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: snapshotState[STORAGE_KEYS.samples][0].trays.map((tray) => ({
        ...tray,
        status: "送至实验室",
      })),
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-101");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对不正确");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("当前任务并非优先所选任务");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("盐雾试验室");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').attributes("data-tone")).toBe("error");
    expect(mounted.get('[data-testid="laboratory-compare-scan-input"]').element.value).toBe("");

    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').attributes("data-tone")).toBe("success");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeUndefined();
  });

  test("closes the compare modal after each completed tray during consecutive tray comparisons", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples][0] = {
      ...snapshotState[STORAGE_KEYS.samples][0],
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: snapshotState[STORAGE_KEYS.samples][0].trays.map((tray) => ({
        ...tray,
        status: "送至实验室",
      })),
    };
    const storageWrites = [];
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/storage")) {
        if ((options.method || "GET") === "PUT") {
          const payload = JSON.parse(String(options.body || "{}"));
          snapshotState = {
            ...snapshotState,
            ...payload,
          };
          return new Promise((resolve) => {
            storageWrites.push(() => resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }));
          });
        }
        return { ok: true, status: 200, json: async () => snapshotState };
      }
      if (url.includes("/api/mq/laboratory")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, published: false }) };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(false);
    storageWrites.shift()();
    await nextTick();
    await nextTick();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-002");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(false);
    storageWrites.shift()();
    await nextTick();
    await nextTick();
  });

  test("keeps the prepared task in place and blocks next-task operations after switching", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T09:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T08:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [
          { quantity: 1, status: "送至实验室", tray_code: "TP-001" },
          { quantity: 1, status: "送至实验室", tray_code: "TP-002" },
        ],
      },
      {
        code: "SYLU-2026-04-201-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T11:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T10:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "李工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-201",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-101" }],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await nextTick();
    await nextTick();

    expect(snapshotState[STORAGE_KEYS.samples][0].trays).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "已到达实验室", tray_code: "TP-001" }),
        expect.objectContaining({ status: "送至实验室", tray_code: "TP-002" }),
      ]),
    );

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    await mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]').trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();

    expect(mounted.text()).toContain("SYLU-2026-04-201 / 盐雾试验-B");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await nextTick();
    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(false);

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      location: "盐雾试验室",
      status: "已到达实验室",
      trays: expect.arrayContaining([
        expect.objectContaining({ status: "已到达实验室", tray_code: "TP-001" }),
        expect.objectContaining({ status: "送至实验室", tray_code: "TP-002" }),
      ]),
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ status: "送至实验室", tray_code: "TP-101" })],
    }));
  });

  test("keeps the first prepared task locked when switching through unprepared tasks", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      ...snapshotState[STORAGE_KEYS.tasks],
      { code: "SYLU-2026-04-401", name: "盐雾端子", test_type: "盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      ...snapshotState[STORAGE_KEYS.experiments],
      { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", experiment_name: "盐雾试验-C" },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      ...snapshotState[STORAGE_KEYS.experiment_trays],
      { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", tray_code: "TP-401" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      ...snapshotState[STORAGE_KEYS.schedules],
      {
        id: "schedule-6",
        task_code: "SYLU-2026-04-401",
        experiment_code: "SYLU-2026-04-401-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T14:30:00.000Z",
        end_at: "2026-04-02T15:00:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T09:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T08:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-201-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T11:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T10:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "李工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-201",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-101" }],
      },
      {
        code: "SYLU-2026-04-401-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T14:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T13:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "周工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-401",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-401" }],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await nextTick();
    await nextTick();

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    await mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]').trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    await mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-401"]').trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();

    expect(mounted.text()).toContain("SYLU-2026-04-401 / 盐雾试验-C");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await nextTick();
    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(false);

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      location: "盐雾试验室",
      status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "TP-001" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      location: "盐雾试验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ status: "送至实验室", tray_code: "TP-101" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][2]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ status: "送至实验室", tray_code: "TP-401" })],
    }));
  });

  test("blocks additional compared tasks until the prepared task is reset", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      ...snapshotState[STORAGE_KEYS.tasks],
      { code: "SYLU-2026-04-401", name: "盐雾端子", test_type: "盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      ...snapshotState[STORAGE_KEYS.experiments],
      { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", experiment_name: "盐雾试验-C" },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      ...snapshotState[STORAGE_KEYS.experiment_trays],
      { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", tray_code: "TP-401" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      ...snapshotState[STORAGE_KEYS.schedules],
      {
        id: "schedule-6",
        task_code: "SYLU-2026-04-401",
        experiment_code: "SYLU-2026-04-401-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T14:30:00.000Z",
        end_at: "2026-04-02T15:00:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T09:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T08:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-201-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T11:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T10:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "李工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-201",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-101" }],
      },
      {
        code: "SYLU-2026-04-401-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T14:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T13:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "周工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-401",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-401" }],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await nextTick();
    await nextTick();

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    await mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]').trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();

    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    await mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-401"]').trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();

    expect(mounted.text()).toContain("SYLU-2026-04-401 / 盐雾试验-C");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      location: "盐雾试验室",
      status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "TP-001" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      location: "盐雾试验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ status: "送至实验室", tray_code: "TP-101" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][2]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ status: "送至实验室", tray_code: "TP-401" })],
    }));
  });

  test("does not allow shared trays completed in the current experiment to be added to comparison", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiments] = [
      ...snapshotState[STORAGE_KEYS.experiments],
      {
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-B",
        experiment_name: "高低温湿热试验",
        status: "已排程",
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      ...snapshotState[STORAGE_KEYS.experiment_trays],
      { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-B", tray_code: "TP-001" },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        history: [
          {
            action: "实验完成",
            detail: "SYLU-2026-04-101 / 盐雾试验-A / 实验已完成",
            status: "实验已完成",
            time: "2026-04-02T10:30:00.000Z",
          },
        ],
        location: "盐雾试验室",
        owner: "王工",
        status: "实验已完成",
        flow_status: "实验已完成",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验已完成", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-101-SP-002",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-002" }],
      },
    ];

    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("托盘已完成实验");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("TP-001 已完成实验，无需再次比对。");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').attributes("data-tone")).toBe("error");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-002");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "实验已完成",
      status: "实验已完成",
      trays: [expect.objectContaining({ status: "实验已完成", tray_code: "TP-001" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "TP-002" })],
    }));
  });

  test("auto focuses the compare scan input when the compare modal opens", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await nextTick();

    expect(document.activeElement).toBe(mounted.get('[data-testid="laboratory-compare-scan-input"]').element);
  });

  test("compare feedback lists all allowed laboratories when another tray belongs to multiple experiments", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-301");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("当前任务并非优先所选任务");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("高低温湿热一室");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("盐雾试验室");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').attributes("data-tone")).toBe("error");
  });

  test("opens double confirmation modals for withdrawal and warns before withdrawing the current experiment trays", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-101",
        trays: [
          { quantity: 1, status: "已到达实验室", tray_code: "TP-001" },
          { quantity: 1, status: "已到达实验室", tray_code: "TP-002" },
        ],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-reset-task"]').trigger("click");
    expect(mounted.find('[data-testid="laboratory-reset-confirm-modal"].is-open').exists()).toBe(true);
    expect(mounted.text()).toContain("是否撤回当前任务下当前实验对应托盘？");
    expect(mounted.get('[data-testid="laboratory-reset-confirm-modal"] .form-actions').classes()).toContain("form-actions--touch");

    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-reset-danger-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-reset-danger-modal"]').text()).toContain("危险操作确认");
    expect(mounted.get('[data-testid="laboratory-reset-danger-modal"]').text()).toContain("撤回后仅影响当前实验对应托盘");
    expect(mounted.get('[data-testid="laboratory-reset-danger-modal"] .form-actions').classes()).toContain("form-actions--touch");
  });

  test("disables the reset button while the current experiment is running", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];

    const mounted = await mountPage();

    expect(mounted.get('[data-testid="laboratory-reset-task"]').attributes("disabled")).toBeDefined();
  });

  test("disables the reset button after the current experiment is completed", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验已完成",
        flow_status: "实验已完成",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验已完成", tray_code: "TP-001" }],
      },
    ];

    const mounted = await mountPage();

    expect(mounted.get('[data-testid="laboratory-reset-task"]').attributes("disabled")).toBeDefined();
  });

  test("withdraws only the current salt-spray experiment trays after double confirmation", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      { code: "SYLU-2026-04-301", name: "复合环境任务", test_type: "高低温湿热试验 / 盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", experiment_name: "高低温湿热试验" },
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", experiment_name: "盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", tray_code: "TP-301-A" },
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", tray_code: "TP-301-B" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-salt",
        task_code: "SYLU-2026-04-301",
        experiment_code: "SYLU-2026-04-301-B",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:30:00.000Z",
        end_at: "2026-04-02T11:00:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-301-SP-001",
        location: "高低温湿热一室",
        owner: "赵工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-301",
        trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-301-A" }],
      },
      {
        code: "SYLU-2026-04-301-SP-002",
        location: "盐雾试验室",
        owner: "赵工",
        status: "实验准备就绪",
        flow_status: "实验准备就绪",
        task_code: "SYLU-2026-04-301",
        trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-301-B" }],
      },
    ];

    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-reset-task"]').trigger("click");
    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await nextTick();
    await mounted.get('[data-testid="laboratory-reset-danger-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 1);

    expect(snapshotState[STORAGE_KEYS.samples]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SYLU-2026-04-301-SP-001",
          status: "已到达实验室",
          trays: [expect.objectContaining({ tray_code: "TP-301-A", status: "已到达实验室" })],
        }),
        expect.objectContaining({
          code: "SYLU-2026-04-301-SP-002",
          location: "接驳区",
          status: "到货",
          flow_status: "到货",
          trays: [expect.objectContaining({ tray_code: "TP-301-B", status: "到货" })],
        }),
      ]),
    );
    const withdrawCall = fetch.mock.calls.find(([input]) => String(input).includes("/api/laboratory/tasks/SYLU-2026-04-301/experiments/SYLU-2026-04-301-B/withdraw-current"));
    expect(withdrawCall).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeUndefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
    expect(dispatchEventSpy.mock.calls.filter(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toHaveLength(1);
  });

  test("keeps the withdrawn tray state from the reset response when storage reload is stale", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-001" }],
      },
    ];

    const mounted = await mountPage();
    const staleSnapshot = JSON.parse(JSON.stringify(snapshotState));
    storageGetSnapshotOverride = () => staleSnapshot;

    await mounted.get('[data-testid="laboratory-reset-task"]').trigger("click");
    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await nextTick();
    await mounted.get('[data-testid="laboratory-reset-danger-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 1);

    expect(mounted.find('[data-testid="laboratory-reset-danger-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).toContain("到货");
  });

  test("opens compare for a next-lab task after the shared tray completed a previous experiment", async () => {
    reactiveRoute.query = { lab: "高低温湿热一室" };
    masterLabsState = [
      { code: "LAB_HOT", name: "高低温湿热一室", type: "实验室", testTypeName: "高低温湿热试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      { code: "SYLU-2026-04-302", name: "复合环境任务", test_type: "盐雾试验 / 高低温湿热试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      {
        task_code: "SYLU-2026-04-302",
        experiment_code: "SYLU-2026-04-302-A",
        experiment_name: "盐雾试验",
        status: "实验已完成",
      },
      {
        task_code: "SYLU-2026-04-302",
        experiment_code: "SYLU-2026-04-302-B",
        experiment_name: "高低温湿热试验",
        status: "已排程",
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-302", experiment_code: "SYLU-2026-04-302-A", tray_code: "TP-302" },
      { task_code: "SYLU-2026-04-302", experiment_code: "SYLU-2026-04-302-B", tray_code: "TP-302" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-302-b",
        task_code: "SYLU-2026-04-302",
        experiment_code: "SYLU-2026-04-302-B",
        device: "高低温湿热一室",
        start_at: "2026-04-02T09:30:00.000Z",
        end_at: "2026-04-02T11:00:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-302-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验已完成",
        flow_status: "实验已完成",
        task_code: "SYLU-2026-04-302",
        trays: [{ quantity: 1, status: "实验已完成", tray_code: "TP-302" }],
      },
    ];

    const mounted = await mountPage();

    expect(mounted.text()).toContain("高低温湿热一室操作台");
    expect(mounted.text()).toContain("SYLU-2026-04-302");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeUndefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-302");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");

    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      location: "高低温湿热一室",
      status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "TP-302" })],
    }));
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();
  });

  test("enables reset after a next-lab comparison while another shared tray only records the completed previous experiment", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    reactiveRoute.query = { lab: "温度冲击一室" };
    masterLabsState = [
      { code: "LAB_TEMP_SHOCK", name: "温度冲击一室", type: "实验室", testTypeName: "温度冲击试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      { code: "SYLU-2026-05-001", name: "综合台试验", test_type: "盐雾试验 / 温度冲击试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      {
        task_code: "SYLU-2026-05-001",
        experiment_code: "SYLU-2026-05-001-A",
        experiment_name: "盐雾试验",
        status: "实验已完成",
      },
      {
        task_code: "SYLU-2026-05-001",
        experiment_code: "SYLU-2026-05-001-B",
        experiment_name: "温度冲击试验",
        status: "已排程",
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-A", tray_code: "SYLU-2026-05-001-TP-001" },
      { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-B", tray_code: "SYLU-2026-05-001-TP-001" },
      { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-B", tray_code: "SYLU-2026-05-001-TP-002" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-temp-shock",
        task_code: "SYLU-2026-05-001",
        experiment_code: "SYLU-2026-05-001-B",
        device: "温度冲击一室",
        start_at: "2026-05-21T08:00:00.000Z",
        end_at: "2026-05-21T11:30:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-05-001-SP-001",
        history: [
          { detail: "SYLU-2026-05-001 / 盐雾试验 / 实验已完成", status: "实验已完成", time: "2026-05-20T22:19:29.000Z" },
        ],
        location: "盐雾试验室",
        owner: "王工",
        status: "实验已完成",
        flow_status: "实验已完成",
        task_code: "SYLU-2026-05-001",
        trays: [{ quantity: 1, status: "实验已完成", tray_code: "SYLU-2026-05-001-TP-001" }],
      },
      {
        code: "SYLU-2026-05-001-SP-002",
        history: [
          { action: "盐雾实验完成", detail: "SYLU-2026-05-001 / 盐雾试验 / 实验已完成", status: "实验已完成", time: "2026-05-20T22:19:29.000Z" },
          { action: "送至实验室", location: "温度冲击一室", status: "送至实验室", time: "2026-05-20T22:18:48.000Z" },
        ],
        location: "温度冲击一室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-05-001",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "SYLU-2026-05-001-TP-002" }],
      },
    ];

    const mounted = await mountPage();

    expect(mounted.get('[data-testid="laboratory-reset-task"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("SYLU-2026-05-001-TP-002");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");

    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      location: "温度冲击一室",
      status: "已到达实验室",
      flow_status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "SYLU-2026-05-001-TP-002" })],
    }));
    expect(mounted.get('[data-testid="laboratory-reset-task"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-reset-task"]').trigger("click");
    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await nextTick();
    await mounted.get('[data-testid="laboratory-reset-danger-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 2);

    expect(mounted.find('[data-testid="laboratory-reset-danger-modal"].is-open').exists()).toBe(false);
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      status: "实验已完成",
      flow_status: "实验已完成",
      trays: [expect.objectContaining({ status: "实验已完成", tray_code: "SYLU-2026-05-001-TP-001" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      location: "接驳区",
      status: "到货",
      flow_status: "到货",
      trays: [expect.objectContaining({ status: "到货", tray_code: "SYLU-2026-05-001-TP-002" })],
    }));
  });

  test("persists compare, install, and ready steps into sample tray statuses and keeps progress after remount", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-101-SP-002",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-002" }],
      },
    ];
    let mounted = await mountPage();
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await nextTick();
    await nextTick();

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      status: "已到达实验室",
      trays: expect.arrayContaining([expect.objectContaining({ status: "已到达实验室", tray_code: "TP-001" })]),
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: expect.arrayContaining([expect.objectContaining({ status: "送至实验室", tray_code: "TP-002" })]),
    }));
    expect(mounted.text()).toContain("当前任务已完成部分托盘比对，可继续比对或开始样品安装");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeUndefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();
    expect(mounted.get('[data-testid="laboratory-reset-task"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();
    await nextTick();

    const fixtureInstallCall = fetch.mock.calls.find(([input]) => String(input).includes("/api/mq/laboratory/fixture-install"));
    expect(fixtureInstallCall).toBeDefined();
    expect(JSON.parse(String(fixtureInstallCall[1].body))).toEqual({
      labId: "salt-spray-lab-01",
      sampleCount: 1,
      sampleType: "",
      taskId: "SYLU-2026-04-101",
    });
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "工装夹具安装",
      status: "工装夹具安装",
      trays: expect.arrayContaining([expect.objectContaining({ status: "工装夹具安装", tray_code: "TP-001" })]),
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: expect.arrayContaining([expect.objectContaining({ status: "送至实验室", tray_code: "TP-002" })]),
    }));
    expect(mounted.text()).toContain("当前任务已完成夹具安装，等待上位机确认夹具安装完成");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await nextTick();
    expect(mounted.find('[data-testid="laboratory-install-modal"].is-open').exists()).toBe(false);
    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-countdown"]').text()).toBe("3");
    vi.advanceTimersByTime(3000);
    await flushPageUpdates();
    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(false);
    expect(mounted.find('[data-testid="laboratory-fixture-success-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-fixture-success-modal"]').text()).toContain("上位机已确认夹具安装完成");
    vi.advanceTimersByTime(1000);
    await flushPageUpdates();
    expect(mounted.find('[data-testid="laboratory-fixture-success-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-ready"]').trigger("click");
    await mounted.get('[data-testid="laboratory-ready-confirm"]').trigger("click");
    await nextTick();
    await nextTick();

    const readyCall = fetch.mock.calls.find(([input]) => String(input).includes("/api/mq/laboratory/ready"));
    expect(readyCall).toBeDefined();
    expect(JSON.parse(String(readyCall[1].body))).toEqual({
      labId: "salt-spray-lab-01",
      taskId: "SYLU-2026-04-101",
    });
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "实验准备就绪",
      status: "实验准备就绪",
      trays: expect.arrayContaining([expect.objectContaining({ status: "实验准备就绪", tray_code: "TP-001" })]),
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: expect.arrayContaining([expect.objectContaining({ status: "送至实验室", tray_code: "TP-002" })]),
    }));
    expect(mounted.text()).toContain("当前任务已确认实验准备就绪");
    expect(dispatchEventSpy.mock.calls.filter(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toHaveLength(4);

    mounted.unmount();
    wrapper = undefined;

    mounted = await mountPage();
    expect(mounted.text()).toContain("当前任务已有托盘完成样品安装，待确认已安装托盘准备就绪");
  });

  test("shows fixture countdown immediately while install persistence is still pending", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-101-SP-002",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-002" }],
      },
    ];
    let releaseStorageWrite = () => {};
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/storage")) {
        if ((options.method || "GET") === "PUT") {
          const payload = JSON.parse(String(options.body || "{}"));
          snapshotState = {
            ...snapshotState,
            ...payload,
          };
          return new Promise((resolve) => {
            releaseStorageWrite = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
          });
        }
        return { ok: true, status: 200, json: async () => snapshotState };
      }
      if (url.includes("/api/mq/laboratory")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, published: false }) };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await flushPageUpdates();

    expect(mounted.find('[data-testid="laboratory-install-modal"].is-open').exists()).toBe(false);
    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-countdown"]').text()).toBe("3");

    releaseStorageWrite();
    await flushPageUpdates();
  });

  test("renders dual flow panels and allows switching trays within the current experiment", async () => {
    const mounted = await mountPage();

    expect(mounted.get('[data-testid="laboratory-task-flow"]').text()).toContain("任务流程图");
    expect(mounted.find('[data-testid="laboratory-task-flow-status"]').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-tray-flow"]').text()).toContain("托盘流程图");
    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).toContain("TP-001");
    expect(mounted.get('[data-testid="laboratory-tray-flow-list"]').classes()).toContain("laboratory-flow-steps--tray");
    const firstTrayStep = mounted.get('[data-testid="laboratory-tray-flow-step-in_transit"]');
    expect(firstTrayStep.element.children[0].className).toBe("laboratory-flow-label");
    expect(firstTrayStep.element.children[1].className).toBe("laboratory-flow-time");
    expect(firstTrayStep.get(".laboratory-flow-time").attributes("title")).toBe(
      firstTrayStep.get(".laboratory-flow-time").text(),
    );
    expect(mounted.get('[data-testid="laboratory-tray-flow-step-in_transit"]').classes()).toContain("is-reached");
    expect(mounted.get('[data-testid="laboratory-tray-flow-step-arrived"]').classes()).toContain("is-active");

    await mounted.get('[data-testid="laboratory-tray-tab-TP-002"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).toContain("TP-002");
    expect(mounted.get('[data-testid="laboratory-tray-tab-TP-002"]').classes()).toContain("is-active");
    expect(mounted.get('[data-testid="laboratory-tray-flow-step-in_transit"]').classes()).toContain("is-reached");
    expect(mounted.get('[data-testid="laboratory-tray-flow-step-arrived"]').classes()).toContain("is-active");
  });

  test("shows a floating running modal, allows temporary hide, and restores it from the overview button", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-101-SP-002",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-002" }],
      },
    ];

    const mounted = await mountPage();
    const findRunningModal = () => document.body.querySelector('[data-testid="laboratory-running-modal"]');
    const findRunningBackdrop = () => document.body.querySelector('[data-testid="laboratory-running-backdrop"]');

    expect(document.body.querySelector('[data-testid="laboratory-show-running-modal"]')?.getAttribute("disabled")).toBeNull();
    expect(document.body.querySelectorAll(".modal.is-open")).toHaveLength(0);
    expect(findRunningModal()?.textContent || "").toContain("SYLU-2026-04-101");
    expect(findRunningModal()?.textContent || "").toContain("TP-001");
    expect(findRunningModal()?.textContent || "").toContain("TP-002");
    expect(findRunningModal()?.textContent || "").toContain("SYLU-2026-04-101-SP-001");
    expect((document.body.querySelector('[data-testid="laboratory-running-countdown"]')?.textContent || "")).toContain("01:00:00");
    expect(document.body.querySelector('[data-testid="laboratory-open-schedule"]')?.getAttribute("disabled")).not.toBeNull();
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-view-tasks"]').attributes("disabled")).toBeUndefined();

    findRunningBackdrop()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(findRunningModal()).toBeNull();

    document.body.querySelector('[data-testid="laboratory-show-running-modal"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(findRunningModal()).not.toBeNull();

    document.body.querySelector('[data-testid="laboratory-complete-experiment"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(document.body.querySelector('[data-testid="laboratory-complete-confirm-modal"]')).toBeNull();
    expect(findRunningModal()?.textContent || "").toContain("确认后将把当前盐雾试验-A更新为实验已完成");
    expect(findRunningModal()?.textContent || "").toContain("SYLU-2026-04-101");
    expect(findRunningModal()?.textContent || "").toContain("TP-001");
  });

  test("collapses oversized running modal content and exposes all trays and samples on demand", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiment_trays] = Array.from({ length: 7 }, (_, index) => ({
      task_code: "SYLU-2026-04-101",
      experiment_code: "SYLU-2026-04-101-A",
      tray_code: `TP-${String(index + 1).padStart(3, "0")}`,
    }));
    snapshotState[STORAGE_KEYS.samples] = Array.from({ length: 7 }, (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return {
        code: `SYLU-2026-04-101-SP-${number}`,
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: `TP-${number}` }],
      };
    });

    const mounted = await mountPage();
    const runningModal = () => document.body.querySelector('[data-testid="laboratory-running-modal"]');

    expect(runningModal()?.querySelectorAll('[data-testid^="laboratory-running-tray-chip-"]')).toHaveLength(3);
    expect(runningModal()?.querySelectorAll('[data-testid^="laboratory-running-sample-chip-"]')).toHaveLength(5);
    expect(runningModal()?.textContent || "").toContain("+4");
    expect(runningModal()?.textContent || "").toContain("+2");
    expect(runningModal()?.textContent || "").not.toContain("TP-007");

    runningModal()?.querySelector('[data-testid="laboratory-running-show-all"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-full-content-modal"].is-open').exists()).toBe(true);
    expect(mounted.findAll("[data-testid^='laboratory-full-tray-row-']")).toHaveLength(7);
    expect(mounted.text()).toContain("TP-007");
    expect(mounted.text()).toContain("SYLU-2026-04-101-SP-007");

    mounted.get('[data-testid="laboratory-full-content-modal"] .modal-close').trigger("click");
    await nextTick();
    runningModal()?.querySelector('[data-testid="laboratory-complete-experiment"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(runningModal()?.textContent || "").toContain("托盘 7 个");
    expect(runningModal()?.textContent || "").toContain("样品 7 个");
    expect(runningModal()?.textContent || "").not.toContain("TP-007、");
  });

  test("automatically completes the running experiment in storage when the countdown reaches zero", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiments] = snapshotState[STORAGE_KEYS.experiments].map((experiment) =>
      experiment.experiment_code === "SYLU-2026-04-101-A"
        ? { ...experiment, status: "实验进行中" }
        : experiment,
    );
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:59:58.000Z",
        end_at: "2026-04-02T10:00:01.000Z",
        status: "实验进行中",
      },
    ];

    const mounted = await mountPage();

    expect(mounted.find('[data-testid="laboratory-complete-confirm-modal"].is-open').exists()).toBe(false);

    vi.advanceTimersByTime(2000);
    await nextTick();
    await nextTick();
    await waitForStoragePutCount(1);

    expect(document.body.querySelector('[data-testid="laboratory-complete-confirm-modal"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("实验已完成");
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").not.toContain("实验已超时");
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "实验已完成",
      status: "实验已完成",
      trays: [expect.objectContaining({ status: "实验已完成", tray_code: "TP-001" })],
    }));
    expect(snapshotState[STORAGE_KEYS.experiments]).toContainEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-101-A",
      status: "实验已完成",
    }));
    expect(snapshotState[STORAGE_KEYS.schedules]).toContainEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-101-A",
      status: "实验已完成",
    }));
  });

  test("does not force the overview modal back open when the experiment becomes overdue while the modal is hidden", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:59:58.000Z",
        end_at: "2026-04-02T10:00:01.000Z",
      },
    ];

    await mountPage();

    document.body.querySelector('[data-testid="laboratory-running-backdrop"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeNull();

    vi.advanceTimersByTime(2_000);
    await nextTick();
    await nextTick();

    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeNull();
  });

  test("restores the running modal after 10 seconds of inactivity when it was hidden", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];

    await mountPage();
    const findRunningModal = () => document.body.querySelector('[data-testid="laboratory-running-modal"]');

    document.body.querySelector('[data-testid="laboratory-running-backdrop"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(findRunningModal()).toBeNull();

    vi.advanceTimersByTime(10_000);
    await nextTick();
    await nextTick();

    expect(findRunningModal()).not.toBeNull();
  });

  test("shows the running countdown when an external process start pushes the selected impact lab snapshot update", async () => {
    const eventSources = [];
    class MockEventSource {
      constructor(url, options) {
        this.url = url;
        this.options = options;
        this.listeners = {};
        this.close = vi.fn();
        eventSources.push(this);
      }

      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }
    }
    vi.stubGlobal("EventSource", MockEventSource);
    reactiveRoute.query = { lab: "冲击一室" };
    masterLabsState = [
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-04-501", name: "冲击连接器", test_type: "冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", experiment_name: "冲击试验" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", tray_code: "TP-CJ-001" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-impact",
          task_code: "SYLU-2026-04-501",
          experiment_code: "SYLU-2026-04-501-A",
          device: "冲击一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-501-SP-001",
          location: "冲击一室",
          owner: "周工",
          status: "实验准备就绪",
          flow_status: "实验准备就绪",
          task_code: "SYLU-2026-04-501",
          trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-CJ-001" }],
        },
      ],
    };

    await mountPage();

    expect(eventSources[0]).toEqual(expect.objectContaining({
      options: { withCredentials: true },
    }));
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeNull();

    snapshotState = {
      ...snapshotState,
      [STORAGE_KEYS.samples]: [
        {
          ...snapshotState[STORAGE_KEYS.samples][0],
          status: "实验进行中",
          flow_status: "实验进行中",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-CJ-001" }],
        },
      ],
    };
    const expectedStorageGetCalls = storageGetCalls().length + 1;
    eventSources[0].listeners.message({
      data: JSON.stringify({ keys: [STORAGE_KEYS.samples], updatedAt: "2026-04-02T10:00:00.000Z" }),
    });
    await waitForStorageGetCount(expectedStorageGetCalls);

    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("SYLU-2026-04-501");
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("TP-CJ-001");
    expect(document.body.querySelector('[data-testid="laboratory-running-countdown"]')?.textContent || "").toContain("01:00:00");
  });

  test("does not restore the running modal while pointer activity continues during the 10-second idle window", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];

    await mountPage();
    const findRunningModal = () => document.body.querySelector('[data-testid="laboratory-running-modal"]');

    document.body.querySelector('[data-testid="laboratory-running-backdrop"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(findRunningModal()).toBeNull();

    vi.advanceTimersByTime(9_000);
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await nextTick();

    vi.advanceTimersByTime(1_500);
    await nextTick();
    await nextTick();

    expect(findRunningModal()).toBeNull();

    vi.advanceTimersByTime(10_000);
    await nextTick();
    await nextTick();

    expect(findRunningModal()).not.toBeNull();
  });

  test("completes only the current salt spray experiment trays and hides the running modal after confirmation", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      { code: "SYLU-2026-04-301", name: "复合环境任务", test_type: "高低温湿热试验 / 盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", experiment_name: "高低温湿热试验" },
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", experiment_name: "盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", tray_code: "TP-301-A" },
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", tray_code: "TP-301-B" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-salt",
        task_code: "SYLU-2026-04-301",
        experiment_code: "SYLU-2026-04-301-B",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:30:00.000Z",
        end_at: "2026-04-02T11:00:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-301-SP-001",
        location: "高低温湿热一室",
        owner: "赵工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-301",
        trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-301-A" }],
      },
      {
        code: "SYLU-2026-04-301-SP-002",
        location: "盐雾试验室",
        owner: "赵工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-301",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-301-B" }],
      },
    ];

    await mountPage();
    const findRunningModal = () => document.body.querySelector('[data-testid="laboratory-running-modal"]');

    document.body.querySelector('[data-testid="laboratory-complete-experiment"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    document.body.querySelector('[data-testid="laboratory-complete-experiment-confirm"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    await nextTick();
    await waitForStoragePutCount(1);

    expect(snapshotState[STORAGE_KEYS.samples]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SYLU-2026-04-301-SP-001",
          status: "已到达实验室",
          trays: [expect.objectContaining({ tray_code: "TP-301-A", status: "已到达实验室" })],
        }),
        expect.objectContaining({
          code: "SYLU-2026-04-301-SP-002",
          status: "实验已完成",
          flow_status: "实验已完成",
          trays: [expect.objectContaining({ tray_code: "TP-301-B", status: "实验已完成" })],
        }),
      ]),
    );
    expect(findRunningModal()).toBeNull();
    expect(dispatchEventSpy.mock.calls.filter(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toHaveLength(1);
  });
});
