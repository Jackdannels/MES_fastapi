import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import StagingManagementPage from "./page.vue";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

let wrapper;
let headerActions;
let remoteSnapshot;

const settlePage = async (target) => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await target.vm.$nextTick();
  }
};

const createSnapshot = () => ({
  [STORAGE_KEYS.tasks]: [
    { id: "task-101", code: "SYLU-2026-04-101", test_type: "温度冲击试验", sample_type: "结构件", source: "外部委托" },
    { id: "task-102", code: "SYLU-2026-04-102", test_type: "振动试验", sample_type: "组件", source: "内部新增" },
    { id: "task-103", code: "SYLU-2026-04-103", test_type: "盐雾试验", sample_type: "整机", source: "外部委托" },
    { id: "task-104", code: "SYLU-2026-04-104", test_type: "冲击试验", sample_type: "组件", source: "内部新增" },
    { id: "task-105", code: "SYLU-2026-04-105", test_type: "霉菌试验", sample_type: "粉末", source: "内部新增" },
    { id: "task-106", code: "SYLU-2026-04-106", test_type: "高低温湿热试验", sample_type: "线缆", source: "外部委托" },
  ],
  [STORAGE_KEYS.experiments]: [
    { id: "exp-102-a", task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", experiment_name: "振动试验", required_device: "振动一室" },
  ],
  [STORAGE_KEYS.experiment_trays]: [
    { id: "rel-102-a", task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", tray_code: "SYLU-2026-04-102-TP-001" },
  ],
  [STORAGE_KEYS.schedules]: [
    {
      id: "schedule-102-staging",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-A",
      experiment_name: "振动试验",
      device: "恒温恒湿间（暂存间）",
      start_at: "2026-04-01T06:00:00",
      end_at: "2026-04-01T07:00:00",
    },
    {
      id: "schedule-102-lab",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-A",
      experiment_name: "振动试验",
      device: "振动一室",
      start_at: "2026-04-01T13:00:00",
      end_at: "2026-04-01T16:00:00",
    },
  ],
  [STORAGE_KEYS.samples]: [
    {
      id: "sample-101",
      code: "SYLU-2026-04-101-SP-001",
      task_code: "SYLU-2026-04-101",
      owner: "王工",
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      trays: [{ tray_code: "SYLU-2026-04-101-TP-001", status: "送至暂存间", quantity: 2 }],
    },
    {
      id: "sample-102",
      code: "SYLU-2026-04-102-SP-001",
      task_code: "SYLU-2026-04-102",
      owner: "李工",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      trays: [{ tray_code: "SYLU-2026-04-102-TP-001", status: "已到达暂存间", quantity: 1 }],
    },
    {
      id: "sample-103",
      code: "SYLU-2026-04-103-SP-001",
      task_code: "SYLU-2026-04-103",
      owner: "周工",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      trays: [{ tray_code: "SYLU-2026-04-103-TP-001", status: "已到达暂存间", quantity: 3 }],
    },
    {
      id: "sample-104",
      code: "SYLU-2026-04-104-SP-001",
      task_code: "SYLU-2026-04-104",
      owner: "赵工",
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      trays: [{ tray_code: "SYLU-2026-04-104-TP-001", status: "送至暂存间", quantity: 1 }],
    },
    {
      id: "sample-105",
      code: "SYLU-2026-04-105-SP-001",
      task_code: "SYLU-2026-04-105",
      owner: "韩工",
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      trays: [{ tray_code: "SYLU-2026-04-105-TP-001", status: "送至暂存间", quantity: 1 }],
    },
    {
      id: "sample-106",
      code: "SYLU-2026-04-106-SP-001",
      task_code: "SYLU-2026-04-106",
      owner: "陈工",
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      trays: [{ tray_code: "SYLU-2026-04-106-TP-001", status: "送至暂存间", quantity: 1 }],
    },
  ],
  [STORAGE_KEYS.staging_events]: [
    { id: "evt-102-in", tray_code: "SYLU-2026-04-102-TP-001", task_code: "SYLU-2026-04-102", action: "stock_in", time: "2026-04-01T08:30:00", operator: "暂存员A" },
    { id: "evt-103-in", tray_code: "SYLU-2026-04-103-TP-001", task_code: "SYLU-2026-04-103", action: "stock_in", time: "2026-03-31T17:40:00", operator: "暂存员A" },
    { id: "evt-103-out", tray_code: "SYLU-2026-04-103-TP-001", task_code: "SYLU-2026-04-103", action: "stock_out", time: "2026-04-01T10:10:00", operator: "暂存员B" },
  ],
});

const createTrayFixture = (sequence, { status = "送至暂存间", quantity = 1 } = {}) => {
  const paddedSequence = String(sequence).padStart(3, "0");
  const taskCode = `SYLU-2026-04-${paddedSequence}`;
  const trayCode = `${taskCode}-TP-001`;

  return {
    sample: {
      id: `sample-${paddedSequence}`,
      code: `${taskCode}-SP-001`,
      task_code: taskCode,
      owner: `测试员${paddedSequence}`,
      location: "恒温恒湿间（暂存间）",
      status,
      trays: [{ tray_code: trayCode, status, quantity }],
    },
    task: {
      id: `task-${paddedSequence}`,
      code: taskCode,
      test_type: "回归测试",
      sample_type: "组件",
      source: "内部新增",
    },
  };
};

const withExtraTrayFixtures = (snapshot, fixtures) => {
  const createdFixtures = fixtures.map((fixture) => createTrayFixture(fixture.sequence, fixture));
  return {
    ...snapshot,
    [STORAGE_KEYS.tasks]: [
      ...snapshot[STORAGE_KEYS.tasks],
      ...createdFixtures.map((fixture) => fixture.task),
    ],
    [STORAGE_KEYS.samples]: [
      ...snapshot[STORAGE_KEYS.samples],
      ...createdFixtures.map((fixture) => fixture.sample),
    ],
  };
};

const mountPage = async () => {
  headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  headerActions.innerHTML = `
    <button class="action-btn secondary" type="button">刷新</button>
    <button class="action-btn secondary" type="button">退出登录</button>
  `;
  document.body.appendChild(headerActions);

  wrapper = mount(StagingManagementPage, {
    attachTo: document.body,
  });
  await settlePage(wrapper);
  return wrapper;
};

describe("StagingManagementPage runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T12:00:00"));
    const store = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem(key) {
          return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
          store.set(key, String(value));
        },
        removeItem(key) {
          store.delete(key);
        },
        clear() {
          store.clear();
        },
      },
    });
    remoteSnapshot = createSnapshot();
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options = {}) => {
        if (String(url).includes("/api/storage") && (!options.method || options.method === "GET")) {
          return { ok: true, json: async () => remoteSnapshot };
        }
        if (String(url).includes("/api/storage") && options.method === "PUT") {
          const body = JSON.parse(options.body);
          remoteSnapshot = {
            ...remoteSnapshot,
            ...body,
          };
          return { ok: true, json: async () => ({ ok: true }) };
        }
        throw new Error(`Unhandled request: ${String(url)}`);
      }),
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    headerActions?.remove();
    headerActions = undefined;
    vi.useRealTimers();
  });

  test("renders real SYLU task codes in the two-column tray panel", async () => {
    const mounted = await mountPage();

    expect(mounted.text()).toContain("SYLU-2026-04-101");
    expect(mounted.text()).toContain("暂存间中样品数量1");
    expect(mounted.text()).toContain("今日到货1");
    expect(mounted.text()).toContain("今日已出库1");
    expect(mounted.findAll('[data-testid="zancun-current-staging-row"]')).toHaveLength(1);
    expect(mounted.findAll('[data-testid="zancun-planned-inbound-row"]')).toHaveLength(4);
    expect(mounted.text()).toContain("SYLU-2026-04-105-TP-001");
    expect(mounted.text()).toContain("SYLU-2026-04-106-TP-001");
  });

  test("refreshes staging rows when tray data changes elsewhere", async () => {
    const mounted = await mountPage();

    expect(mounted.text()).toContain("暂存间中样品数量1");
    expect(mounted.get('[data-testid="zancun-current-staging-column"]').text()).not.toContain("SYLU-2026-04-101-TP-001");

    remoteSnapshot = {
      ...remoteSnapshot,
      [STORAGE_KEYS.samples]: remoteSnapshot[STORAGE_KEYS.samples].map((sample) =>
        sample.code === "SYLU-2026-04-101-SP-001"
          ? {
              ...sample,
              status: "已到达暂存间",
              flow_status: "已到达暂存间",
              trays: sample.trays.map((tray) => ({ ...tray, status: "已到达暂存间" })),
            }
          : sample,
      ),
      [STORAGE_KEYS.staging_events]: [
        ...remoteSnapshot[STORAGE_KEYS.staging_events],
        {
          id: "evt-101-withdraw",
          tray_code: "SYLU-2026-04-101-TP-001",
          task_code: "SYLU-2026-04-101",
          action: "stock_out_withdraw",
          time: "2026-04-01T12:05:00",
        },
      ],
    };

    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await settlePage(mounted);

    expect(mounted.get('[data-testid="zancun-current-staging-column"]').text()).toContain("当前在库 2");
    expect(mounted.get('[data-testid="zancun-current-staging-column"]').text()).toContain("SYLU-2026-04-101-TP-001");
  });

  test("renders planned inbound and actual staging trays in separate columns", async () => {
    const mounted = await mountPage();
    const plannedColumn = mounted.get('[data-testid="zancun-planned-inbound-column"]');
    const currentColumn = mounted.get('[data-testid="zancun-current-staging-column"]');

    expect(plannedColumn.text()).toContain("允许暂存");
    expect(currentColumn.text()).toContain("暂存间样品");
    expect(plannedColumn.text()).toContain("SYLU-2026-04-101-TP-001");
    expect(plannedColumn.text()).not.toContain("SYLU-2026-04-102-TP-001");
    expect(currentColumn.text()).toContain("SYLU-2026-04-102-TP-001");
    expect(currentColumn.text()).not.toContain("SYLU-2026-04-101-TP-001");
  });

  test("inventory column totals are counted from all filtered rows instead of the visible page", async () => {
    remoteSnapshot = withExtraTrayFixtures(createSnapshot(), [
      { sequence: 107, status: "送至暂存间" },
      { sequence: 108, status: "送至暂存间" },
      { sequence: 109, status: "已到达暂存间" },
      { sequence: 110, status: "已到达暂存间" },
    ]);

    const mounted = await mountPage();

    expect(mounted.get('[data-testid="zancun-current-staging-column"] .pill').text()).toBe("当前在库 3");
    expect(mounted.get('[data-testid="zancun-planned-inbound-column"] .pill').text()).toBe("允许暂存 6");
  });

  test("inventory columns render four fixed slots with empty placeholders on short pages", async () => {
    const mounted = await mountPage();
    const currentColumn = mounted.get('[data-testid="zancun-current-staging-column"]');
    const plannedColumn = mounted.get('[data-testid="zancun-planned-inbound-column"]');

    expect(currentColumn.findAll(".zancun-console-slot")).toHaveLength(4);
    expect(plannedColumn.findAll(".zancun-console-slot")).toHaveLength(4);
  });

  test("current staging and planned inbound lists paginate independently", async () => {
    remoteSnapshot = withExtraTrayFixtures(createSnapshot(), [
      { sequence: 107, status: "送至暂存间" },
      { sequence: 108, status: "送至暂存间" },
      { sequence: 109, status: "已到达暂存间" },
      { sequence: 110, status: "已到达暂存间" },
      { sequence: 111, status: "已到达暂存间" },
      { sequence: 112, status: "已到达暂存间" },
      { sequence: 113, status: "已到达暂存间" },
    ]);
    const mounted = await mountPage();
    const currentColumn = mounted.get('[data-testid="zancun-current-staging-column"]');
    const plannedColumn = mounted.get('[data-testid="zancun-planned-inbound-column"]');

    expect(currentColumn.text()).toContain("SYLU-2026-04-111-TP-001");
    expect(currentColumn.text()).not.toContain("SYLU-2026-04-112-TP-001");
    expect(plannedColumn.text()).toContain("SYLU-2026-04-101-TP-001");
    expect(plannedColumn.text()).not.toContain("SYLU-2026-04-108-TP-001");

    await currentColumn.get('[data-testid="zancun-current-staging-pagination"] [data-page="next"]').trigger("click");

    expect(currentColumn.text()).toContain("SYLU-2026-04-112-TP-001");
    expect(currentColumn.text()).toContain("SYLU-2026-04-113-TP-001");
    expect(plannedColumn.text()).toContain("SYLU-2026-04-101-TP-001");
    expect(plannedColumn.text()).not.toContain("SYLU-2026-04-108-TP-001");

    await plannedColumn.get('[data-testid="zancun-planned-inbound-pagination"] [data-page="next"]').trigger("click");

    expect(plannedColumn.text()).toContain("SYLU-2026-04-108-TP-001");
    expect(currentColumn.text()).toContain("SYLU-2026-04-113-TP-001");
  });

  test("planned inbound list backfills from the next page after one tray is stocked in", async () => {
    remoteSnapshot = withExtraTrayFixtures(createSnapshot(), [
      { sequence: 107, status: "送至暂存间" },
      { sequence: 108, status: "送至暂存间" },
    ]);
    const mounted = await mountPage();

    expect(mounted.get('[data-testid="zancun-planned-inbound-column"]').text()).not.toContain("SYLU-2026-04-108-TP-001");

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-101-TP-001");
    await mounted.get('[data-testid="zancun-scan-submit"]').trigger("click");

    const plannedColumn = mounted.get('[data-testid="zancun-planned-inbound-column"]');
    expect(plannedColumn.findAll(".zancun-console-slot")).toHaveLength(4);
    expect(plannedColumn.text()).not.toContain("SYLU-2026-04-101-TP-001");
    expect(plannedColumn.text()).toContain("SYLU-2026-04-107-TP-001");
    expect(plannedColumn.text()).not.toContain("SYLU-2026-04-108-TP-001");
  });

  test("clicking KPI cards filters the inventory columns without opening scan modals", async () => {
    const mounted = await mountPage();
    const summaryBar = mounted.get('[data-testid="zancun-current-view"]');

    expect(summaryBar.text()).toContain("当前查看");
    expect(summaryBar.text()).toContain("全部托盘");

    await mounted.get('[data-testid="zancun-metric-stocked-out"]').trigger("click");

    expect(mounted.text()).toContain("当前页暂无暂存间样品");
    expect(mounted.text()).toContain("当前页暂无允许暂存托盘");
    expect(mounted.text()).not.toContain("SYLU-2026-04-101-TP-001");
    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);
    expect(summaryBar.text()).toContain("今日已出库");

    await mounted.get('[data-testid="zancun-metric-active"]').trigger("click");

    expect(mounted.text()).toContain("SYLU-2026-04-101-TP-001");
    expect(mounted.text()).not.toContain("SYLU-2026-04-103-TP-001");
    expect(summaryBar.text()).toContain("暂存间中样品数量");
  });

  test("tray rows are display-only and scan buttons open directly into focused edit mode", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-planned-inbound-row"]').trigger("click");
    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    const input = mounted.get('[data-testid="zancun-scan-code"]').element;

    expect(document.activeElement).toBe(input);
    expect(input.readOnly).toBe(false);
    expect(mounted.get('[data-testid="zancun-scan-submit"]').text()).toBe("入库");
    expect(mounted.get('[data-testid="zancun-scan-complete"]').text()).toBe("入库完成");
    expect(mounted.get('[data-testid="zancun-scan-modal"] .form-actions').classes()).toContain("form-actions--touch");
  });

  test("stock-in scan batches trays from the inline button before closing from the footer", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-101-TP-001");
    await mounted.get('[data-testid="zancun-scan-submit"]').trigger("click");

    expect(mounted.text()).toContain("今日到货2");
    expect(mounted.get('[data-testid="zancun-scan-modal"]').classes()).toContain("is-open");
    expect(mounted.get('[data-testid="zancun-scan-code"]').element.value).toBe("");
    expect(document.activeElement).toBe(mounted.get('[data-testid="zancun-scan-code"]').element);
    await Promise.resolve();
    await mounted.vm.$nextTick();

    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-104-TP-001");
    await mounted.get('[data-testid="zancun-scan-submit"]').trigger("click");

    expect(mounted.text()).toContain("今日到货3");
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_in" && event.time.startsWith("2026-04-01"))).toHaveLength(3);
    expect(mounted.find('[data-testid="zancun-detail-modal"].is-open').exists()).toBe(false);
    expect(mounted.find('[data-testid="zancun-destination-modal"].is-open').exists()).toBe(false);

    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);
  });

  test("stock-in scan rejects trays that have already been returned to manufacturer", async () => {
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.staging_events]: [
        ...createSnapshot()[STORAGE_KEYS.staging_events],
        {
          id: "evt-102-return",
          tray_code: "SYLU-2026-04-102-TP-001",
          task_code: "SYLU-2026-04-102",
          action: "manufacturer_return",
          time: "2026-04-01T11:30:00",
          target_lab: "厂家收回",
        },
      ],
    };
    const stockInCountBefore = remoteSnapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_in").length;
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="zancun-scan-modal"]').classes()).toContain("is-open");
    expect(mounted.get('[data-testid="zancun-scan-modal"]').text()).toContain("该托盘已厂家收回，不能再次入库。");
    expect(mounted.get('[data-testid="zancun-scan-code"]').element.value).toBe("");
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_in")).toHaveLength(stockInCountBefore);
  });

  test("stock-out scan only writes outbound state after selecting a target lab", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    expect(mounted.find('[data-testid="zancun-detail-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="zancun-destination-modal"]').classes()).toContain("is-open");
    expect(mounted.get('[data-testid="zancun-destination-modal"]').text()).toContain("选择目标实验室");
    expect(mounted.get('[data-testid="zancun-destination-modal"]').text()).toContain("振动一室");
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_out")).toHaveLength(1);

    await mounted.get('[data-testid="zancun-destination-submit-0"]').trigger("click");

    expect(mounted.text()).toContain("今日已出库2");
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_out",
      target_lab: "振动一室",
      tray_code: "SYLU-2026-04-102-TP-001",
    });
  });

  test("stock-out scan returns to waiting scan state after one tray is dispatched", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");
    await mounted.get('[data-testid="zancun-destination-submit-0"]').trigger("click");
    await Promise.resolve();
    await mounted.vm.$nextTick();

    expect(mounted.find('[data-testid="zancun-destination-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="zancun-scan-modal"]').classes()).toContain("is-open");
    expect(mounted.get('[data-testid="zancun-scan-code"]').element.value).toBe("");
    expect(document.activeElement).toBe(mounted.get('[data-testid="zancun-scan-code"]').element);
  });

  test("stock-out scan opens target lab selection instead of the staging room detail", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    const destinationModal = mounted.get('[data-testid="zancun-destination-modal"]');
    expect(destinationModal.text()).toContain("选择目标实验室");
    expect(destinationModal.text()).toContain("振动一室");
    expect(destinationModal.text()).toContain("送至振动一室");
    expect(destinationModal.text()).not.toContain("恒温恒湿间（暂存间）");
  });

  test("stock-out destination modal lists multiple target labs and highlights the nearest schedule", async () => {
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.experiments]: [
        ...createSnapshot()[STORAGE_KEYS.experiments],
        { id: "exp-102-b", task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-B", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        ...createSnapshot()[STORAGE_KEYS.experiment_trays],
        { id: "rel-102-b", task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-B", tray_code: "SYLU-2026-04-102-TP-001" },
      ],
      [STORAGE_KEYS.schedules]: [
        ...createSnapshot()[STORAGE_KEYS.schedules],
        {
          id: "schedule-102-b",
          task_code: "SYLU-2026-04-102",
          experiment_code: "SYLU-2026-04-102-B",
          experiment_name: "盐雾试验",
          device: "盐雾试验室",
          start_at: "2026-04-01T12:30:00",
          end_at: "2026-04-01T15:30:00",
        },
      ],
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    const cards = mounted.findAll('[data-testid^="zancun-destination-card-"]');
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain("盐雾试验室");
    expect(cards[0].text()).toContain("推荐");
    expect(cards[1].text()).toContain("振动一室");
    expect(mounted.get('[data-testid="zancun-destination-submit-0"]').attributes("disabled")).toBeUndefined();
  });

  test("stock-out scan shows fallback lab as disabled when the experiment is not scheduled", async () => {
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.schedules]: createSnapshot()[STORAGE_KEYS.schedules].filter(
        (schedule) => schedule.experiment_code !== "SYLU-2026-04-102-A" || schedule.device.includes("暂存间"),
      ),
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    const destinationModal = mounted.get('[data-testid="zancun-destination-modal"]');
    expect(destinationModal.classes()).toContain("is-open");
    expect(destinationModal.text()).toContain("当前实验未排程，仅作为托底目标，暂不可出库。");
    expect(destinationModal.get('[data-testid="zancun-destination-submit-0"]').attributes("disabled")).toBeDefined();
  });

  test("manufacturer return opens a danger confirmation modal when experiments remain unfinished", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");
    await mounted.get('[data-testid="zancun-manufacturer-return"]').trigger("click");

    expect(mounted.get('[data-testid="zancun-manufacturer-return-card"]').classes()).toContain("is-danger");
    expect(mounted.get('[data-testid="zancun-return-danger-modal"]').classes()).toContain("is-open");
    expect(mounted.get('[data-testid="zancun-return-danger-modal"]').text()).toContain("危险操作确认");
    expect(mounted.get('[data-testid="zancun-return-danger-modal"]').text()).toContain("该托盘中样品尚有未完成实验，是否立即厂家收回！");
    expect(mounted.get('[data-testid="zancun-return-danger-modal"] .form-actions').classes()).toContain("form-actions--touch");
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].some((event) => event.action === "manufacturer_return")).toBe(false);
  });

  test("stock-out scan lets post-experiment staging trays return to manufacturer without warning styling", async () => {
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        ...createSnapshot()[STORAGE_KEYS.tasks],
        {
          id: "task-001",
          code: "SYLU-2026-03-001",
          test_type: "高低温湿热试验 / 盐雾试验 / 四综合试验",
          sample_type: "组件",
          source: "内部新增",
        },
      ],
      [STORAGE_KEYS.experiments]: [
        ...createSnapshot()[STORAGE_KEYS.experiments],
        {
          id: "exp-001-a",
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        ...createSnapshot()[STORAGE_KEYS.experiment_trays],
        {
          id: "rel-001-a",
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          tray_code: "SYLU-2026-03-001-TP-002",
        },
      ],
      [STORAGE_KEYS.samples]: [
        ...createSnapshot()[STORAGE_KEYS.samples],
        {
          id: "sample-001",
          code: "SYLU-2026-03-001-SP-002",
          task_code: "SYLU-2026-03-001",
          owner: "周工",
          location: "恒温恒湿间（暂存间）",
          status: "放置实验后暂存间",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "放置实验后暂存间", quantity: 4 }],
          history: [{ detail: "SYLU-2026-03-001 / 盐雾试验 / 实验已完成", time: "2026-04-01T09:30:00" }],
        },
      ],
      [STORAGE_KEYS.staging_events]: [
        ...createSnapshot()[STORAGE_KEYS.staging_events],
        {
          id: "evt-001-in",
          tray_code: "SYLU-2026-03-001-TP-002",
          task_code: "SYLU-2026-03-001",
          action: "stock_in",
          time: "2026-04-01T11:00:00",
          operator: "暂存员A",
        },
      ],
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-03-001-TP-002");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="zancun-destination-modal"]').classes()).toContain("is-open");
    expect(mounted.get('[data-testid="zancun-manufacturer-return-card"]').classes()).toContain("is-safe");
    expect(mounted.get('[data-testid="zancun-manufacturer-return"]').classes()).toContain("is-safe");
    expect(mounted.text()).not.toContain("送至冲击一室");

    await mounted.get('[data-testid="zancun-manufacturer-return"]').trigger("click");

    expect(remoteSnapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "manufacturer_return",
      target_lab: "厂家收回",
      tray_code: "SYLU-2026-03-001-TP-002",
    });
  });

  test("allows stock-in for fully completed trays and shows post-experiment staging", async () => {
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.samples]: [
        ...createSnapshot()[STORAGE_KEYS.samples],
        {
          id: "sample-107",
          code: "SYLU-2026-04-107-SP-001",
          task_code: "SYLU-2026-04-103",
          owner: "周工",
          location: "盐雾试验室",
          status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-04-107-TP-001", status: "实验已完成", quantity: 1 }],
        },
      ],
    };

    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-107-TP-001");
    await mounted.get('[data-testid="zancun-scan-submit"]').trigger("click");

    const updatedSample = remoteSnapshot[STORAGE_KEYS.samples].find((sample) => sample.code === "SYLU-2026-04-107-SP-001");

    expect(updatedSample).toMatchObject({
      location: "恒温恒湿间（暂存间）",
      status: "放置实验后暂存间",
      flow_status: "放置实验后暂存间",
    });
    expect(updatedSample?.trays).toContainEqual(
      expect.objectContaining({
        tray_code: "SYLU-2026-04-107-TP-001",
        status: "放置实验后暂存间",
      }),
    );
    await mounted.get('[data-testid="zancun-console-search"]').setValue("SYLU-2026-04-107-TP-001");

    expect(mounted.text()).toContain("SYLU-2026-04-107-TP-001");
    expect(mounted.text()).toContain("放置实验后暂存间");
    expect(dispatchEventSpy.mock.calls.some(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toBe(true);
  });
});
