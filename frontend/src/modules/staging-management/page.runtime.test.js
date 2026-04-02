import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import StagingManagementPage from "./page.vue";
import { STORAGE_KEYS } from "@/lib/storageKeys";

let wrapper;
let headerActions;
let remoteSnapshot;

const createSnapshot = () => ({
  [STORAGE_KEYS.tasks]: [
    { id: "task-101", code: "SYLU-2026-04-101", test_type: "温度冲击试验", sample_type: "结构件", source: "外部委托" },
    { id: "task-102", code: "SYLU-2026-04-102", test_type: "振动试验", sample_type: "组件", source: "内部新增" },
    { id: "task-103", code: "SYLU-2026-04-103", test_type: "盐雾试验", sample_type: "整机", source: "外部委托" },
    { id: "task-104", code: "SYLU-2026-04-104", test_type: "冲击试验", sample_type: "组件", source: "内部新增" },
    { id: "task-105", code: "SYLU-2026-04-105", test_type: "霉菌试验", sample_type: "粉末", source: "内部新增" },
    { id: "task-106", code: "SYLU-2026-04-106", test_type: "高低温湿热试验", sample_type: "线缆", source: "外部委托" },
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
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await Promise.resolve();
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

  test("renders real SYLU task codes in the fixed 5-row tray panel and paginates extra trays", async () => {
    const mounted = await mountPage();

    expect(mounted.text()).toContain("SYLU-2026-04-101");
    expect(mounted.text()).toContain("今日已入库1");
    expect(mounted.text()).toContain("今日已出库1");
    expect(mounted.findAll('[data-testid^="zancun-console-slot-"]')).toHaveLength(5);
    expect(mounted.text()).toContain("SYLU-2026-04-105-TP-001");
    expect(mounted.text()).not.toContain("SYLU-2026-04-106-TP-001");

    await mounted.get('[data-testid="zancun-console-next-page"]').trigger("click");

    expect(mounted.text()).toContain("SYLU-2026-04-106-TP-001");
  });

  test("clicking KPI cards only filters the middle tray panel", async () => {
    const mounted = await mountPage();
    const summaryBar = mounted.get('[data-testid="zancun-current-view"]');

    expect(summaryBar.text()).toContain("当前查看");
    expect(summaryBar.text()).toContain("全部托盘");

    await mounted.get('[data-testid="zancun-metric-stocked-out"]').trigger("click");

    expect(mounted.text()).toContain("SYLU-2026-04-103-TP-001");
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

    await mounted.get('[data-testid="zancun-console-slot-0"]').trigger("click");
    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    const input = mounted.get('[data-testid="zancun-scan-code"]').element;

    expect(document.activeElement).toBe(input);
    expect(input.readOnly).toBe(false);
  });

  test("stock-in and stock-out confirmations update today's KPI cards", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-101-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");
    await mounted.get('[data-testid="zancun-detail-confirm"]').trigger("click");

    expect(mounted.text()).toContain("今日已入库2");

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");
    await mounted.get('[data-testid="zancun-detail-confirm"]').trigger("click");

    expect(mounted.text()).toContain("今日已出库2");
  });
});
