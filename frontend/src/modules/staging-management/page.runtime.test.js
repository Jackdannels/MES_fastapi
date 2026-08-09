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
  [STORAGE_KEYS.devices]: [],
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

const createAppearanceOriginalPlanSnapshot = () => {
  const snapshot = createSnapshot();
  snapshot[STORAGE_KEYS.experiments] = [
    {
      id: "exp-102-a",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-A",
      experiment_name: "霉菌试验",
      required_device: "霉菌试验室",
    },
    {
      id: "exp-102-b",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-B",
      experiment_name: "盐雾试验",
      required_device: "盐雾试验室",
    },
  ];
  snapshot[STORAGE_KEYS.experiment_trays] = [
    { id: "rel-102-a", task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", tray_code: "SYLU-2026-04-102-TP-001" },
    { id: "rel-102-b", task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-B", tray_code: "SYLU-2026-04-102-TP-001" },
  ];
  snapshot[STORAGE_KEYS.schedules] = [
    {
      id: "schedule-102-a",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-A",
      experiment_name: "霉菌试验",
      device: "霉菌试验室",
      start_at: "2026-04-01T13:00:00",
      end_at: "2026-04-01T16:00:00",
    },
    {
      id: "schedule-102-b",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-B",
      experiment_name: "盐雾试验",
      device: "盐雾试验室",
      start_at: "2026-04-02T09:00:00",
      end_at: "2026-04-02T12:00:00",
    },
  ];
  snapshot[STORAGE_KEYS.samples] = snapshot[STORAGE_KEYS.samples].map((sample) => (
    sample.code === "SYLU-2026-04-102-SP-001"
      ? {
          ...sample,
          flow_status: "实验前外观检测间存放",
          location: "外观检测间",
          status: "实验前外观检测间存放",
          trays: sample.trays.map((tray) => ({
            ...tray,
            status: "实验前外观检测间存放",
            target_experiment_code: "SYLU-2026-04-102-B",
            target_lab: "盐雾试验室",
          })),
        }
      : sample
  ));
  return snapshot;
};

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

const mountPage = async (options = {}) => {
  window.history.pushState({}, "", options.room === "appearance" ? "/appearance-inspection" : "/staging-management");
  headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  headerActions.innerHTML = `
    <button class="action-btn secondary" type="button">刷新</button>
    <button class="action-btn secondary" type="button">退出登录</button>
  `;
  document.body.appendChild(headerActions);

  wrapper = mount(StagingManagementPage, {
    attachTo: document.body,
    global: {
      mocks: {
        $route: {
          meta: {
            storageRoom: options.room || "staging",
          },
        },
      },
    },
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
        if (String(url).includes("/api/storage/rooms/") && options.method === "POST") {
          const body = JSON.parse(options.body || "{}");
          const path = String(url);
          const room = decodeURIComponent(path.match(/\/rooms\/([^/]+)\//)?.[1] || "staging");
          const trayCode = decodeURIComponent(path.match(/\/trays\/([^/]+)\//)?.[1] || "");
          const isManufacturerReturn = path.endsWith("/manufacturer-return");
          const isStockIn = path.endsWith("/stock-in");
          const action = isManufacturerReturn ? "manufacturer_return" : isStockIn ? "stock_in" : "stock_out";
          const targetLab = isManufacturerReturn ? "厂家收回" : body.targetLab;
          const targetType = isManufacturerReturn ? "" : body.targetType || "lab";
          const nextStatus = isManufacturerReturn
            ? "厂家收回"
            : isStockIn
              ? body.status || "已到达暂存间"
              : targetType === "staging" || targetLab === "恒温恒湿间（暂存间）"
              ? "送至暂存间"
              : "送至实验室";
          const nextLocation = isManufacturerReturn
            ? "厂家收回"
            : isStockIn
              ? body.location || "恒温恒湿间（暂存间）"
              : targetType === "staging" || targetLab === "恒温恒湿间（暂存间）"
              ? "恒温恒湿间（暂存间）"
              : targetLab;
          remoteSnapshot = {
            ...remoteSnapshot,
            [STORAGE_KEYS.samples]: remoteSnapshot[STORAGE_KEYS.samples].map((sample) => {
              const touchesTray = sample.trays?.some((tray) => tray.tray_code === trayCode);
              if (!touchesTray) {
                return sample;
              }
              return {
                ...sample,
                location: nextLocation,
                status: nextStatus,
                flow_status: nextStatus,
                trays: sample.trays.map((tray) => tray.tray_code === trayCode
                  ? {
                      ...tray,
                      status: nextStatus,
                      ...(targetLab ? { target_lab: targetLab } : {}),
                      ...(body.targetLabCode ? { target_lab_code: body.targetLabCode } : {}),
                      ...(body.targetLabId ? { target_lab_id: body.targetLabId } : {}),
                      ...(body.targetExperimentCode ? { target_experiment_code: body.targetExperimentCode } : {}),
                      ...(targetType ? { target_type: targetType } : {}),
                    }
                  : tray),
              };
            }),
            [STORAGE_KEYS.staging_events]: [
              ...remoteSnapshot[STORAGE_KEYS.staging_events],
              {
                id: `evt-${trayCode}-${remoteSnapshot[STORAGE_KEYS.staging_events].length + 1}`,
                action,
                room,
                target_lab: targetLab,
                target_experiment_code: body.targetExperimentCode,
                target_type: targetType,
                time: "2026-04-01T12:00:00",
                tray_code: trayCode,
              },
            ],
          };
          return {
            ok: true,
            json: async () => ({
              ok: true,
              trayCode,
              updatedKeys: [STORAGE_KEYS.samples, STORAGE_KEYS.staging_events],
            }),
          };
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
    expect(mounted.get('[data-testid="zancun-current-staging-column"] h4').text()).toContain("暂存间托盘 1");
    expect(mounted.text()).not.toContain("今日到货");
    expect(mounted.text()).not.toContain("今日已出库");
    expect(mounted.findAll('[data-testid="zancun-current-staging-row"]')).toHaveLength(1);
    expect(mounted.findAll('[data-testid="zancun-planned-inbound-row"]')).toHaveLength(4);
    expect(mounted.text()).toContain("SYLU-2026-04-105-TP-001");
    expect(mounted.text()).toContain("SYLU-2026-04-106-TP-001");
  });

  test("refreshes staging rows when tray data changes elsewhere", async () => {
    const mounted = await mountPage();

    expect(mounted.get('[data-testid="zancun-current-staging-column"] h4').text()).toContain("暂存间托盘 1");
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

    expect(mounted.get('[data-testid="zancun-current-staging-column"] h4').text()).toContain("暂存间托盘 2");
    expect(mounted.get('[data-testid="zancun-current-staging-column"]').text()).toContain("SYLU-2026-04-101-TP-001");
  });

  test("keeps existing staging rows when a background refresh omits array snapshot keys", async () => {
    const mounted = await mountPage();

    expect(mounted.get('[data-testid="zancun-current-staging-column"]').text()).toContain("SYLU-2026-04-102-TP-001");

    remoteSnapshot = {
      [STORAGE_KEYS.samples]: "not-an-array",
      [STORAGE_KEYS.staging_events]: "not-an-array",
    };

    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await settlePage(mounted);

    expect(mounted.get('[data-testid="zancun-current-staging-column"]').text()).toContain("SYLU-2026-04-102-TP-001");
    expect(mounted.get('[data-testid="zancun-current-staging-column"] h4').text()).toContain("暂存间托盘 1");
    expect(mounted.get('[data-testid="zancun-planned-inbound-column"]').text()).toContain("SYLU-2026-04-101-TP-001");
  });

  test("renders planned inbound and actual staging trays in separate columns", async () => {
    const mounted = await mountPage();
    const plannedColumn = mounted.get('[data-testid="zancun-planned-inbound-column"]');
    const currentColumn = mounted.get('[data-testid="zancun-current-staging-column"]');

    expect(plannedColumn.text()).toContain("允许暂存");
    expect(currentColumn.text()).toContain("暂存间托盘");
    expect(plannedColumn.text()).toContain("SYLU-2026-04-101-TP-001");
    expect(plannedColumn.text()).not.toContain("SYLU-2026-04-102-TP-001");
    expect(currentColumn.text()).toContain("SYLU-2026-04-102-TP-001");
    expect(currentColumn.text()).not.toContain("SYLU-2026-04-101-TP-001");
  });

  test("renders partial-axis completed trays as planned inbound from runtime snapshot keys", async () => {
    const taskCode = "SYLU-2026-06-001";
    const trayCode = `${taskCode}-TP-001`;
    const experimentCode = `${taskCode}-C`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        ...createSnapshot()[STORAGE_KEYS.tasks],
        { id: taskCode, code: taskCode, test_type: "振动试验", sample_type: "组件", source: "外部委托" },
      ],
      [STORAGE_KEYS.experiments]: [
        ...createSnapshot()[STORAGE_KEYS.experiments],
        {
          id: experimentCode,
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "振动试验",
          required_device: "振动试验",
          status: "实验进行中",
          axis_codes: ["x+", "y+"],
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        ...createSnapshot()[STORAGE_KEYS.experiment_trays],
        { id: "rel-live-axis", task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      [STORAGE_KEYS.schedules]: [
        ...createSnapshot()[STORAGE_KEYS.schedules],
        {
          id: "schedule-live-axis-x",
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "振动试验",
          device: "振动一室",
          start_at: "2026-06-26 11:53:00",
          end_at: "2026-06-26 15:23:00",
          status: "实验进行中",
          axis_codes: ["x+"],
          sub_experiment_code: firstSubExperimentCode,
        },
        {
          id: "schedule-live-axis-y",
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "振动试验",
          device: "振动一室",
          start_at: "2026-06-26 15:33:00",
          end_at: "2026-06-26 19:03:00",
          status: "实验进行中",
          axis_codes: ["y+"],
          sub_experiment_code: secondSubExperimentCode,
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          run_no: "run-live-axis-x",
          schedule_id: "schedule-live-axis-x",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          status: "实验已完成",
          axis_codes: ["x+"],
          tray_codes: [trayCode],
        },
      ],
      [STORAGE_KEYS.experiment_run_trays]: [
        {
          run_no: "run-live-axis-x",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          tray_code: trayCode,
          status: "实验已完成",
          run_tray_status: "实验已完成",
        },
      ],
      [STORAGE_KEYS.experiment_run_steps]: [
        {
          run_no: "run-live-axis-x",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          axis_code: "x+",
          step_no: 1,
          status: "实验已完成",
        },
      ],
      [STORAGE_KEYS.samples]: [
        ...createSnapshot()[STORAGE_KEYS.samples],
        {
          id: `${taskCode}-SP-001`,
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          owner: "周工",
          location: "振动一室",
          status: "送至实验室",
          flow_status: "送至实验室",
          trays: [
            {
              tray_code: trayCode,
              status: "送至实验室",
              target_experiment_code: experimentCode,
              target_lab: "振动一室",
              quantity: 1,
            },
          ],
        },
      ],
    };

    const mounted = await mountPage();
    const plannedColumn = mounted.get('[data-testid="zancun-planned-inbound-column"]');

    expect(plannedColumn.text()).toContain("允许暂存托盘");
    await mounted.get('[data-testid="zancun-planned-inbound-pagination"] button[data-page="next"]').trigger("click");
    await settlePage(mounted);
    expect(plannedColumn.text()).toContain(trayCode);
  });

  test("renders latest completed experiment as the current staging tray label", async () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        ...createSnapshot()[STORAGE_KEYS.tasks],
        {
          id: "task-staged-after-salt",
          code: taskCode,
          test_type: "霉菌试验 / 四综合试验 / 高低温湿热试验 / 盐雾试验",
          sample_type: "组件",
          source: "内部新增",
        },
      ],
      [STORAGE_KEYS.experiments]: [
        ...createSnapshot()[STORAGE_KEYS.experiments],
        {
          id: "exp-staged-after-salt",
          task_code: taskCode,
          experiment_code: `${taskCode}-D`,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        ...createSnapshot()[STORAGE_KEYS.experiment_trays],
        {
          id: "rel-staged-after-salt",
          task_code: taskCode,
          experiment_code: `${taskCode}-D`,
          tray_code: trayCode,
        },
      ],
      [STORAGE_KEYS.samples]: [
        ...createSnapshot()[STORAGE_KEYS.samples],
        {
          id: "sample-staged-after-salt",
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          owner: "周工",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          flow_status: "已到达暂存间",
          trays: [{ tray_code: trayCode, status: "已到达暂存间", quantity: 1 }],
          history: [
            { detail: `${taskCode} / 盐雾试验 / 实验已完成`, status: "实验已完成", time: "2026-06-10T09:30:00+08:00" },
          ],
        },
      ],
      [STORAGE_KEYS.staging_events]: [
        ...createSnapshot()[STORAGE_KEYS.staging_events],
        {
          id: "evt-staged-after-salt-in",
          tray_code: trayCode,
          task_code: taskCode,
          action: "stock_in",
          time: "2026-06-10T10:00:00+08:00",
        },
      ],
    };

    const mounted = await mountPage();
    const currentColumn = mounted.get('[data-testid="zancun-current-staging-column"]');
    const targetRow = currentColumn.findAll('[data-testid="zancun-current-staging-row"]')
      .find((row) => row.text().includes(trayCode));

    expect(targetRow?.text()).toContain(trayCode);
    expect(targetRow?.text()).toContain(taskCode);
    expect(targetRow?.text()).toContain("样品数量 1");
    expect(targetRow?.text()).not.toContain("盐雾试验");
    expect(targetRow?.text()).not.toContain("恒温恒湿间");
    expect(targetRow?.text()).not.toContain("放置暂存间");
    expect(targetRow?.text()).not.toContain("到货");
  });

  test("inventory column totals are counted from all filtered rows instead of the visible page", async () => {
    remoteSnapshot = withExtraTrayFixtures(createSnapshot(), [
      { sequence: 107, status: "送至暂存间" },
      { sequence: 108, status: "送至暂存间" },
      { sequence: 109, status: "已到达暂存间" },
      { sequence: 110, status: "已到达暂存间" },
    ]);

    const mounted = await mountPage();

    expect(mounted.get('[data-testid="zancun-current-staging-column"] h4').text()).toBe("暂存间托盘 3");
    expect(mounted.get('[data-testid="zancun-planned-inbound-column"] h4').text()).toBe("允许暂存托盘 6");
  });

  test("inventory columns render five fixed slots with empty placeholders on short pages", async () => {
    const mounted = await mountPage();
    const currentColumn = mounted.get('[data-testid="zancun-current-staging-column"]');
    const plannedColumn = mounted.get('[data-testid="zancun-planned-inbound-column"]');

    expect(currentColumn.findAll(".zancun-console-slot")).toHaveLength(5);
    expect(plannedColumn.findAll(".zancun-console-slot")).toHaveLength(5);
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
    expect(currentColumn.text()).not.toContain("SYLU-2026-04-113-TP-001");
    expect(plannedColumn.text()).toContain("SYLU-2026-04-101-TP-001");
    expect(plannedColumn.text()).not.toContain("SYLU-2026-04-108-TP-001");

    await currentColumn.get('[data-testid="zancun-current-staging-pagination"] [data-page="next"]').trigger("click");

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
      { sequence: 109, status: "送至暂存间" },
    ]);
    const mounted = await mountPage();

    expect(mounted.get('[data-testid="zancun-planned-inbound-column"]').text()).not.toContain("SYLU-2026-04-108-TP-001");
    const getStorageCallCount = () => fetch.mock.calls.filter(([url, options = {}]) =>
      String(url).includes("/api/storage") && (!options.method || options.method === "GET")
    ).length;
    const getCallsBeforeStockIn = getStorageCallCount();

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-101-TP-001");
    await mounted.get('[data-testid="zancun-scan-submit"]').trigger("click");
    vi.advanceTimersByTime(100);
    await settlePage(mounted);

    const plannedColumn = mounted.get('[data-testid="zancun-planned-inbound-column"]');
    expect(plannedColumn.findAll(".zancun-console-slot")).toHaveLength(5);
    expect(plannedColumn.text()).not.toContain("SYLU-2026-04-101-TP-001");
    expect(plannedColumn.text()).toContain("SYLU-2026-04-107-TP-001");
    expect(plannedColumn.text()).not.toContain("SYLU-2026-04-109-TP-001");
    expect(getStorageCallCount()).toBe(getCallsBeforeStockIn);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/storage/rooms/staging/trays/SYLU-2026-04-101-TP-001/stock-in"), expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "X-MES-Update-Source": "staging-management",
        "X-MES-Update-Request-Id": expect.stringContaining("staging-management:"),
      }),
    }));
  });

  test("removes the duplicate tray metric and keeps only the two inventory columns", async () => {
    const mounted = await mountPage();

    expect(mounted.find('[data-testid="zancun-current-view"]').exists()).toBe(false);
    expect(mounted.find('[data-testid="zancun-metric-stocked-out"]').exists()).toBe(false);
    expect(mounted.find('[data-testid="zancun-metric-stocked-in"]').exists()).toBe(false);
    expect(mounted.find('[data-testid="zancun-metric-active"]').exists()).toBe(false);
    expect(mounted.find('[data-testid="zancun-console-search"]').exists()).toBe(false);
    expect(mounted.get('[data-testid="zancun-current-staging-column"] h4').text()).toBe("暂存间托盘 1");
    expect(mounted.get('[data-testid="zancun-planned-inbound-column"] h4').text()).toBe("允许暂存托盘 4");
    expect(mounted.text()).not.toContain("暂存间控制台");
    expect(mounted.text()).not.toContain("标准流程");
    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);
    expect(mounted.text()).toContain("SYLU-2026-04-101-TP-001");
  });

  test.each([
    ["staging", "暂存间托盘", "允许暂存托盘"],
    ["appearance", "外观检测间托盘", "待入库托盘"],
  ])("uses the simplified overview header in the %s room", async (room, currentTitle, plannedTitle) => {
    const mounted = await mountPage({ room });

    expect(mounted.find('[data-testid="zancun-current-view"]').exists()).toBe(false);
    expect(mounted.find('[data-testid="zancun-console-search"]').exists()).toBe(false);
    expect(mounted.get('[data-testid="zancun-current-staging-column"] h4').text()).toContain(currentTitle);
    expect(mounted.get('[data-testid="zancun-planned-inbound-column"] h4').text()).toMatch(new RegExp(`${plannedTitle} \\d+$`));
    expect(mounted.text()).not.toContain("标准流程");
  });

  test("hides page jump controls while keeping enlarged previous and next controls", async () => {
    const mounted = await mountPage();
    const paginations = mounted.findAll(".zancun-current-staging-pagination, .zancun-planned-inbound-pagination");

    expect(paginations).toHaveLength(2);
    paginations.forEach((pagination) => {
      expect(pagination.find('[data-testid="pagination-jump-input"]').exists()).toBe(false);
      expect(pagination.find('[data-testid="pagination-jump-submit"]').exists()).toBe(false);
      expect(pagination.find('[data-page="prev"]').exists()).toBe(true);
      expect(pagination.find('[data-page="next"]').exists()).toBe(true);
    });
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

  test.each(["staging", "appearance"])("renders scheme A whole-card scan actions in the %s room", async (room) => {
    const mounted = await mountPage({ room });
    const actions = mounted.findAll(".zancun-actions-grid .zancun-touch-action");
    const stockIn = mounted.get('[data-testid="zancun-stock-in"]');
    const stockOut = mounted.get('[data-testid="zancun-stock-out"]');

    expect(actions).toHaveLength(2);
    expect(actions.every((action) => action.element.tagName === "BUTTON")).toBe(true);
    expect(stockIn.text()).toContain("扫码入库");
    expect(stockIn.text()).toContain("扫描待入库托盘编号");
    expect(stockIn.attributes("aria-label")).toBe("扫码入库：扫描待入库托盘编号");
    expect(stockOut.text()).toContain("扫码出库");
    expect(stockOut.text()).toContain("扫描待出库托盘编号");
    expect(stockOut.attributes("aria-label")).toBe("扫码出库：扫描待出库托盘编号");
  });

  test("stock-in scan batches trays from the inline button before closing from the footer", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-101-TP-001");
    await mounted.get('[data-testid="zancun-scan-submit"]').trigger("click");
    await settlePage(mounted);

    expect(mounted.text()).not.toContain("今日到货");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/storage/rooms/staging/trays/SYLU-2026-04-101-TP-001/stock-in"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(mounted.get('[data-testid="zancun-scan-modal"]').classes()).toContain("is-open");
    expect(mounted.get('[data-testid="zancun-scan-code"]').element.value).toBe("");
    expect(document.activeElement).toBe(mounted.get('[data-testid="zancun-scan-code"]').element);
    await Promise.resolve();
    await mounted.vm.$nextTick();

    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-104-TP-001");
    await mounted.get('[data-testid="zancun-scan-submit"]').trigger("click");

    expect(mounted.text()).not.toContain("今日到货");
    expect(fetch.mock.calls.some(([url, options = {}]) =>
      String(url).endsWith("/api/storage") && options.method === "PUT",
    )).toBe(false);
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].filter((event) => event.action === "stock_in" && event.time.startsWith("2026-04-01"))).toHaveLength(3);
    expect(mounted.find('[data-testid="zancun-detail-modal"].is-open').exists()).toBe(false);
    expect(mounted.find('[data-testid="zancun-destination-modal"].is-open').exists()).toBe(false);

    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);
  });

  test("stock-in scan accepts tray QR payloads and persists the plain tray code", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("MES-TRAY:SYLU-2026-04-101-TP-001");
    expect(mounted.get('[data-testid="zancun-scan-code"]').element.value).toBe("SYLU-2026-04-101-TP-001");
    await mounted.get('[data-testid="zancun-scan-submit"]').trigger("click");
    await settlePage(mounted);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/storage/rooms/staging/trays/SYLU-2026-04-101-TP-001/stock-in"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_in",
      room: "staging",
      tray_code: "SYLU-2026-04-101-TP-001",
    });
    expect(mounted.text()).not.toContain("未找到对应的入库托盘。");
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
    await settlePage(mounted);

    expect(mounted.text()).not.toContain("今日已出库");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/storage/rooms/staging/trays/SYLU-2026-04-102-TP-001/stock-out"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch.mock.calls.some(([url, options = {}]) =>
      String(url).endsWith("/api/storage") && options.method === "PUT",
    )).toBe(false);
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
    await settlePage(mounted);

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

  test("stock-out destination modal exposes only the earliest unfinished schedule", async () => {
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
    expect(cards).toHaveLength(1);
    expect(cards[0].text()).toContain("盐雾试验室");
    expect(cards[0].text()).toContain("下一排程");
    expect(mounted.text()).not.toContain("振动一室");
    expect(mounted.get('[data-testid="zancun-destination-submit-0"]').attributes("disabled")).toBeUndefined();
  });

  test("stock-out destination modal warns and blocks dispatch to a lab under repair", async () => {
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.devices]: [
        {
          code: "振动一室",
          maintenance_end_at: "2027-04-01T13:30:00",
          maintenance_start_at: "2026-01-01T11:30:00",
          maintenance_type: "计划维修",
          name: "振动试验系统-1",
          status: "维修",
        },
      ],
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    const destinationModal = mounted.get('[data-testid="zancun-destination-modal"]');
    const submitButton = mounted.get('[data-testid="zancun-destination-submit-0"]');
    expect(destinationModal.text()).toContain("振动一室正在维修，暂不可送入");
    expect(destinationModal.text()).toContain("预计结束：2027-04-01 13:30");
    expect(submitButton.attributes("disabled")).toBeDefined();
    expect(submitButton.text()).toBe("送至振动一室");
  });

  test("stock-out to salt lab stays a lab dispatch and appearance stock-in can optionally store it", async () => {
    const taskCode = "SYLU-2026-04-171";
    const trayCode = `${taskCode}-TP-001`;
    const experimentCode = `${taskCode}-A`;
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        ...createSnapshot()[STORAGE_KEYS.tasks],
        { id: "task-171", code: taskCode, test_type: "盐雾试验", sample_type: "结构件", source: "内部新增" },
      ],
      [STORAGE_KEYS.experiments]: [
        ...createSnapshot()[STORAGE_KEYS.experiments],
        {
          id: "exp-171-a",
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        ...createSnapshot()[STORAGE_KEYS.experiment_trays],
        { id: "rel-171-a", task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      [STORAGE_KEYS.schedules]: [
        ...createSnapshot()[STORAGE_KEYS.schedules],
        {
          id: "schedule-171-a",
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "盐雾试验",
          device: "盐雾试验室",
          start_at: "2026-04-01T12:30:00",
          end_at: "2026-04-01T15:30:00",
        },
      ],
      [STORAGE_KEYS.samples]: [
        ...createSnapshot()[STORAGE_KEYS.samples],
        {
          id: "sample-171",
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          owner: "周工",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          flow_status: "已到达暂存间",
          trays: [{ tray_code: trayCode, status: "已到达暂存间", quantity: 1 }],
        },
      ],
      [STORAGE_KEYS.staging_events]: [
        ...createSnapshot()[STORAGE_KEYS.staging_events],
        {
          id: "evt-171-in",
          tray_code: trayCode,
          task_code: taskCode,
          action: "stock_in",
          time: "2026-04-01T11:20:00",
          operator: "暂存员A",
        },
      ],
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue(trayCode);
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");
    await mounted.get('[data-testid="zancun-destination-submit-0"]').trigger("click");
    await settlePage(mounted);

    let updatedSample = remoteSnapshot[STORAGE_KEYS.samples].find((sample) => sample.code === `${taskCode}-SP-001`);
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_out",
      target_experiment_code: experimentCode,
      target_lab: "盐雾试验室",
      target_type: "lab",
      tray_code: trayCode,
    });
    expect(updatedSample).toMatchObject({
      location: "盐雾试验室",
      status: "送至实验室",
      flow_status: "送至实验室",
    });
    expect(updatedSample.trays[0]).toMatchObject({
      status: "送至实验室",
      target_experiment_code: experimentCode,
      target_lab: "盐雾试验室",
    });

    mounted.unmount();
    wrapper = undefined;
    headerActions?.remove();
    headerActions = undefined;
    const appearanceMounted = await mountPage({ room: "appearance" });

    await appearanceMounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    await appearanceMounted.get('[data-testid="zancun-scan-code"]').setValue(trayCode);
    await appearanceMounted.get('[data-testid="zancun-scan-submit"]').trigger("click");
    await settlePage(appearanceMounted);

    updatedSample = remoteSnapshot[STORAGE_KEYS.samples].find((sample) => sample.code === `${taskCode}-SP-001`);
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_in",
      room: "appearance",
      tray_code: trayCode,
    });
    expect(updatedSample).toMatchObject({
      location: "外观检测间",
      status: "实验前外观检测间存放",
      flow_status: "实验前外观检测间存放",
    });
    expect(updatedSample.trays[0]).toMatchObject({
      status: "实验前外观检测间存放",
      target_experiment_code: experimentCode,
      target_lab: "盐雾试验室",
    });

    await appearanceMounted.get('[data-testid="zancun-scan-complete"]').trigger("click");
    await settlePage(appearanceMounted);
    await appearanceMounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await appearanceMounted.get('[data-testid="zancun-scan-code"]').setValue(trayCode);
    await appearanceMounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    const destinationModal = appearanceMounted.get('[data-testid="zancun-destination-modal"]');
    expect(destinationModal.text()).toContain("盐雾试验室");
    expect(destinationModal.text()).not.toContain("送至外观检测间");

    await appearanceMounted.get('[data-testid="zancun-destination-submit-0"]').trigger("click");
    await settlePage(appearanceMounted);

    updatedSample = remoteSnapshot[STORAGE_KEYS.samples].find((sample) => sample.code === `${taskCode}-SP-001`);
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_out",
      room: "appearance",
      target_experiment_code: experimentCode,
      target_lab: "盐雾试验室",
      target_type: "lab",
      tray_code: trayCode,
    });
    expect(updatedSample).toMatchObject({
      location: "盐雾试验室",
      status: "送至实验室",
      flow_status: "送至实验室",
    });
    expect(updatedSample.trays[0]).toMatchObject({
      status: "送至实验室",
      target_experiment_code: experimentCode,
      target_lab: "盐雾试验室",
    });
  });

  test("appearance stock-out ignores stale target metadata and keeps only the next schedule", async () => {
    remoteSnapshot = createAppearanceOriginalPlanSnapshot();
    const mounted = await mountPage({ room: "appearance" });

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    const destinationCards = mounted.findAll('[data-testid^="zancun-destination-card-"]');
    expect(destinationCards).toHaveLength(2);
    expect(destinationCards[0].text()).toContain("霉菌试验室");
    expect(destinationCards[0].text()).not.toContain("原计划");
    expect(mounted.get('[data-testid="zancun-destination-submit-0"]').attributes("disabled")).toBeUndefined();
    expect(mounted.text()).not.toContain("盐雾试验室");
    expect(mounted.find('[data-testid="zancun-destination-deviation-modal"]').exists()).toBe(false);
  });

  test("appearance stock-out can still return to staging without a deviation confirmation", async () => {
    remoteSnapshot = createAppearanceOriginalPlanSnapshot();
    const mounted = await mountPage({ room: "appearance" });

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-102-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");
    await mounted.get('[data-testid="zancun-destination-submit-1"]').trigger("click");
    await settlePage(mounted);

    expect(mounted.find('[data-testid="zancun-destination-deviation-modal"].is-open').exists()).toBe(false);
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "stock_out",
      room: "appearance",
      target_lab: "恒温恒湿间（暂存间）",
      target_type: "staging",
    });
  });

  test("stock-out scan does not show fallback lab when the experiment is not scheduled", async () => {
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
    expect(destinationModal.text()).not.toContain("当前实验未排程，仅作为托底目标，暂不可出库。");
    expect(destinationModal.find('[data-testid="zancun-destination-submit-0"]').exists()).toBe(false);
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
          status: "实验后暂存间存放",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "实验后暂存间存放", quantity: 4 }],
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

  test("stock-out scan treats all completed multi-experiment post-staging trays as safe manufacturer return", async () => {
    const taskCode = "SYLU-2026-06-022";
    const trayCode = `${taskCode}-TP-002`;
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        ...createSnapshot()[STORAGE_KEYS.tasks],
        {
          id: "task-022",
          code: taskCode,
          test_type: "霉菌试验 / 盐雾试验 / 温度冲击试验",
          sample_type: "组件",
          source: "内部新增",
        },
      ],
      [STORAGE_KEYS.experiments]: [
        ...createSnapshot()[STORAGE_KEYS.experiments],
        { id: "exp-022-a", task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "霉菌试验", required_device: "霉菌试验室" },
        { id: "exp-022-b", task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { id: "exp-022-c", task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "温度冲击试验", required_device: "温度冲击一室" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        ...createSnapshot()[STORAGE_KEYS.experiment_trays],
        { id: "rel-022-a", task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { id: "rel-022-b", task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { id: "rel-022-c", task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      [STORAGE_KEYS.experiment_run_trays]: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode, run_tray_status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode, run_tray_status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode, run_tray_status: "实验已完成" },
      ],
      [STORAGE_KEYS.samples]: [
        ...createSnapshot()[STORAGE_KEYS.samples],
        {
          id: "sample-022-007",
          code: `${taskCode}-SP-007`,
          task_code: taskCode,
          owner: "周工",
          location: "恒温恒湿间（暂存间）",
          status: "实验后暂存间存放",
          flow_status: "实验后暂存间存放",
          trays: [{ tray_code: trayCode, status: "实验后暂存间存放", quantity: 1 }],
        },
        {
          id: "sample-022-008",
          code: `${taskCode}-SP-008`,
          task_code: taskCode,
          owner: "周工",
          location: "恒温恒湿间（暂存间）",
          status: "实验后暂存间存放",
          flow_status: "实验后暂存间存放",
          trays: [{ tray_code: trayCode, status: "实验后暂存间存放", quantity: 1 }],
        },
      ],
      [STORAGE_KEYS.staging_events]: [
        ...createSnapshot()[STORAGE_KEYS.staging_events],
        {
          id: "evt-022-in",
          tray_code: trayCode,
          task_code: taskCode,
          action: "stock_in",
          time: "2026-04-01T11:00:00",
          operator: "暂存员A",
        },
      ],
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue(trayCode);
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    expect(mounted.get('[data-testid="zancun-manufacturer-return-card"]').classes()).toContain("is-safe");
    await mounted.get('[data-testid="zancun-manufacturer-return"]').trigger("click");

    expect(mounted.find('[data-testid="zancun-return-danger-modal"].is-open').exists()).toBe(false);
    expect(remoteSnapshot[STORAGE_KEYS.staging_events].at(-1)).toMatchObject({
      action: "manufacturer_return",
      tray_code: trayCode,
    });
  });

  test("appearance inspection room does not show manufacturer return action", async () => {
    remoteSnapshot = {
      ...createSnapshot(),
      [STORAGE_KEYS.samples]: [
        ...createSnapshot()[STORAGE_KEYS.samples],
        {
          id: "sample-appearance-current",
          code: "SYLU-2026-04-130-SP-001",
          task_code: "SYLU-2026-04-130",
          owner: "周工",
          location: "外观检测间",
          status: "实验后外观检测间存放",
          flow_status: "实验后外观检测间存放",
          trays: [{ tray_code: "SYLU-2026-04-130-TP-001", status: "实验后外观检测间存放", quantity: 1 }],
          history: [{ detail: "SYLU-2026-04-130 / 盐雾试验 / 实验已完成", time: "2026-04-01T10:00:00" }],
        },
      ],
      [STORAGE_KEYS.staging_events]: [
        ...createSnapshot()[STORAGE_KEYS.staging_events],
        {
          id: "evt-appearance-current-in",
          tray_code: "SYLU-2026-04-130-TP-001",
          task_code: "SYLU-2026-04-130",
          room: "appearance",
          action: "stock_in",
          time: "2026-04-01T11:00:00",
          operator: "外观员A",
        },
      ],
    };
    const mounted = await mountPage({ room: "appearance" });

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("SYLU-2026-04-130-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    expect(mounted.get('[data-testid="zancun-destination-modal"]').classes()).toContain("is-open");
    expect(mounted.find('[data-testid="zancun-manufacturer-return-card"]').exists()).toBe(false);
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
      location: "恒温恒湿间（实验后暂存间）",
      status: "实验后暂存间存放",
      flow_status: "实验后暂存间存放",
    });
    expect(updatedSample?.trays).toContainEqual(
      expect.objectContaining({
        tray_code: "SYLU-2026-04-107-TP-001",
        status: "实验后暂存间存放",
      }),
    );
    const stockedRow = mounted.findAll('[data-testid="zancun-current-staging-row"]')
      .find((row) => row.text().includes("SYLU-2026-04-107-TP-001"));

    expect(stockedRow?.text()).toContain("SYLU-2026-04-107-TP-001");
    expect(stockedRow?.text()).toContain("SYLU-2026-04-107");
    expect(stockedRow?.text()).toContain("样品数量 1");
    expect(stockedRow?.text()).not.toContain("实验后暂存");
    expect(dispatchEventSpy.mock.calls.some(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toBe(true);
  });
});
