import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import VisualizationPage from "./page.vue";

const { REAL_DEVICE_LEDGER, snapshotState } = vi.hoisted(() => ({
  REAL_DEVICE_LEDGER: [
    { code: "振动一室", status: "可用" },
    { code: "高低温湿热一室", status: "可用" },
    { code: "高低温湿热二室", status: "可用" },
    { code: "盐雾试验室", status: "可用" },
    { code: "冲击一室", status: "可用" },
    { code: "霉菌试验室", status: "可用" },
    { code: "四综合实验室", status: "可用" },
    { code: "冲击二室", status: "可用" },
    { code: "温度冲击二室", status: "可用" },
    { code: "温度冲击一室", status: "可用" },
    { code: "振动二室", status: "可用" },
  ],
  snapshotState: {
    attendanceSessions: [],
    refreshRegistrations: [],
    snapshot: {},
  },
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: vi.fn(() => ({
      "mes.devices": REAL_DEVICE_LEDGER,
      ...snapshotState.snapshot,
    })),
  }),
}));

vi.mock("@/composables/useStorageSnapshotRefresh", () => ({
  useStorageSnapshotRefresh: vi.fn((options) => {
    snapshotState.refreshRegistrations.push(options);
    return {
      flushPendingRefresh: vi.fn(),
      hasPendingRefresh: { value: false },
      stop: vi.fn(),
    };
  }),
}));

const mountPage = () => mount(VisualizationPage);

const buildFourActiveLabSnapshot = () => {
  const activeLabs = [
    { lab: "振动一室", task: "TASK-VIB-A", experiment: "EXP-VIB-A", tray: "TRAY-VIB-A" },
    { lab: "盐雾试验室", task: "TASK-SALT-A", experiment: "EXP-SALT-A", tray: "TRAY-SALT-A" },
    { lab: "冲击一室", task: "TASK-IMPACT-A", experiment: "EXP-IMPACT-A", tray: "TRAY-IMPACT-A" },
    { lab: "霉菌试验室", task: "TASK-MOLD-A", experiment: "EXP-MOLD-A", tray: "TRAY-MOLD-A" },
  ];
  return {
    "mes.tasks": activeLabs.map((item) => ({ code: item.task, name: `${item.lab}任务` })),
    "mes.experiments": activeLabs.map((item) => ({
      task_code: item.task,
      experiment_code: item.experiment,
      experiment_name: `${item.lab}试验`,
      required_device: item.lab,
    })),
    "mes.experiment_trays": activeLabs.map((item) => ({
      task_code: item.task,
      experiment_code: item.experiment,
      tray_code: item.tray,
    })),
    "mes.schedules": activeLabs.map((item) => ({
      task_code: item.task,
      experiment_code: item.experiment,
      device: item.lab,
      status: "实验进行中",
    })),
    "mes.samples": activeLabs.map((item) => ({
      code: `${item.task}-SAMPLE-001`,
      task_code: item.task,
      location: item.lab,
      status: "实验进行中",
      trays: [{ tray_code: item.tray, status: "实验进行中", quantity: 1 }],
    })),
  };
};

const buildSingleRunningLabSnapshot = () => ({
  "mes.tasks": [{ code: "TASK-VIS-001", name: "可视化真实任务" }],
  "mes.experiments": [
    { task_code: "TASK-VIS-001", experiment_code: "EXP-VIB", experiment_name: "振动试验", required_device: "振动一室" },
  ],
  "mes.experiment_trays": [
    { task_code: "TASK-VIS-001", experiment_code: "EXP-VIB", tray_code: "TRAY-VIS-001" },
  ],
  "mes.schedules": [
    { task_code: "TASK-VIS-001", experiment_code: "EXP-VIB", device: "振动一室", status: "实验进行中" },
  ],
  "mes.samples": [
    {
      code: "SAMPLE-VIS-001",
      task_code: "TASK-VIS-001",
      location: "振动一室",
      status: "实验进行中",
      trays: [{ tray_code: "TRAY-VIS-001", status: "实验进行中", quantity: 1 }],
      history: [
        { status: "到货", time: "2026-05-22T09:00:00+08:00" },
        { detail: "TASK-VIS-001 / 振动试验 / 实验进行中", time: "2026-05-22T10:00:00+08:00" },
      ],
    },
  ],
});

const buildCurrentLabTaskMatrixSnapshot = () => ({
  "mes.devices": [
    { code: "振动一室", name: "振动一室", status: "可用" },
    { code: "霉菌试验室", name: "霉菌试验室", status: "保养" },
    { code: "冲击一室", name: "冲击一室", status: "可用" },
    { code: "盐雾试验室", name: "盐雾试验室", status: "可用" },
    { code: "STAGING", name: "恒温恒湿间（暂存间）", status: "可用" },
    { code: "APPEARANCE", name: "外观检测间", status: "可用" },
    { code: "HANDOVER", name: "室外接驳区", status: "可用" },
  ],
  "mes.tasks": [
    { code: "TASK-RUN", name: "振动运行任务" },
    { code: "TASK-WAIT", name: "冲击待启动任务" },
  ],
  "mes.experiments": [
    { task_code: "TASK-RUN", experiment_code: "EXP-RUN", experiment_name: "振动试验", required_device: "振动一室" },
    { task_code: "TASK-WAIT", experiment_code: "EXP-WAIT", experiment_name: "冲击试验", required_device: "冲击一室" },
  ],
  "mes.experiment_runs": [
    {
      run_no: "RUN-001",
      task_code: "TASK-RUN",
      experiment_code: "EXP-RUN",
      device: "振动一室",
      status: "实验进行中",
      started_at: "2026-06-17T14:00:00+08:00",
      planned_hours: 2,
    },
  ],
  "mes.experiment_run_trays": [
    {
      run_no: "RUN-001",
      task_code: "TASK-RUN",
      experiment_code: "EXP-RUN",
      tray_code: "TRAY-RUN",
      run_tray_status: "实验进行中",
      started_at: "2026-06-17T14:00:00+08:00",
    },
  ],
  "mes.experiment_trays": [
    { task_code: "TASK-RUN", experiment_code: "EXP-RUN", tray_code: "TRAY-RUN" },
    { task_code: "TASK-WAIT", experiment_code: "EXP-WAIT", tray_code: "TRAY-WAIT" },
  ],
  "mes.schedules": [
    {
      task_code: "TASK-RUN",
      experiment_code: "EXP-RUN",
      device: "振动一室",
      status: "实验进行中",
      start_at: "2026-06-17T14:00:00+08:00",
      end_at: "2026-06-17T16:00:00+08:00",
    },
    {
      task_code: "TASK-WAIT",
      experiment_code: "EXP-WAIT",
      device: "冲击一室",
      status: "已排程",
      start_at: "2026-06-17T15:20:00+08:00",
      end_at: "2026-06-17T16:30:00+08:00",
    },
  ],
  "mes.samples": [
    {
      code: "SAMPLE-RUN",
      task_code: "TASK-RUN",
      location: "振动一室",
      status: "实验进行中",
      trays: [{ tray_code: "TRAY-RUN", status: "实验进行中", quantity: 2 }],
    },
    {
      code: "SAMPLE-WAIT",
      task_code: "TASK-WAIT",
      location: "冲击一室",
      status: "已到达实验室",
      trays: [{ tray_code: "TRAY-WAIT", status: "已到达实验室", quantity: 1 }],
    },
  ],
});

describe("VisualizationPage runtime", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/visualization");
    snapshotState.attendanceSessions = [];
    snapshotState.refreshRegistrations = [];
    snapshotState.snapshot = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("/api/attendance/lab-sessions")) {
          return {
            ok: true,
            json: () => snapshotState.attendanceSessions,
          };
        }
        if (String(url).includes("/api/storage")) {
          return {
            ok: true,
            json: () => ({
              "mes.devices": REAL_DEVICE_LEDGER,
              ...snapshotState.snapshot,
            }),
          };
        }
        throw new Error(`Unhandled request: ${String(url)}`);
      }),
    );
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/visualization");
    vi.unstubAllGlobals();
  });

  test("subscribes to realtime snapshot updates for visualization data", () => {
    mountPage();

    expect(snapshotState.refreshRegistrations).toHaveLength(1);
    expect(snapshotState.refreshRegistrations[0].keys).toEqual(expect.arrayContaining([
      "mes.tasks",
      "mes.samples",
      "mes.experiments",
      "mes.experiment_runs",
      "mes.experiment_trays",
      "mes.schedules",
      "mes.devices",
      "mes.staging_events",
    ]));
  });

  test("reads only changed visualization keys during a regular realtime refresh", async () => {
    mountPage();
    await Promise.resolve();

    await snapshotState.refreshRegistrations[0].refresh(["mes.samples", "mes.schedules"]);
    await Promise.resolve();

    const storageReadUrl = fetch.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("/api/storage?keys="));
    const requestedKeys = new URL(storageReadUrl, "http://localhost")
      .searchParams.get("keys")
      .split(",")
      .sort();
    expect(requestedKeys).toEqual(["mes.samples", "mes.schedules"]);
    expect(new URL(storageReadUrl, "http://localhost").searchParams.get("profile")).toBe("visualization");
  });

  test("keeps the visible board data when a background refresh omits array snapshot keys", async () => {
    snapshotState.snapshot = buildSingleRunningLabSnapshot();
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[0].trigger("click");
    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TRAY-VIS-001");

    snapshotState.snapshot = {
      "mes.samples": "not-an-array",
    };
    await snapshotState.refreshRegistrations[0].refresh();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const storageReadUrl = fetch.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("/api/storage?keys="));
    const requestedKeys = new URL(storageReadUrl, "http://localhost")
      .searchParams.get("keys")
      .split(",")
      .sort();
    expect(requestedKeys).toEqual([
      "mes.devices",
      "mes.experiment_run_pauses",
      "mes.experiment_run_steps",
      "mes.experiment_run_trays",
      "mes.experiment_runs",
      "mes.experiment_trays",
      "mes.experiments",
      "mes.samples",
      "mes.schedules",
      "mes.staging_events",
      "mes.tasks",
    ]);

    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TRAY-VIS-001");
    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toContain("运行任务1");
    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toContain("托盘流程1");
  });

  test("renders eight non-interactive screen thumbnails", async () => {
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    const cards = wrapper.findAll('[data-testid="visual-screen-card"]');

    expect(cards).toHaveLength(8);
    expect(cards[0].attributes("aria-label")).toContain("实验室流程监控屏");
    expect(cards[0].findAll(".visual-lab-panel")).toHaveLength(2);
    expect(cards[0].find("select").exists()).toBe(false);
    expect(cards[0].find('[data-testid="visual-lab-select"]').exists()).toBe(false);
  });

  test("renders the seventh screen as an eleven-room status monitor without carrier telemetry for hot-humid room two", async () => {
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const seventhCard = wrapper.findAll('[data-testid="visual-screen-card"]')[6];
    const labCards = seventhCard.findAll(".visual-lab-status-card");
    const hostlessLab = labCards.find((card) => card.text().includes("高低温湿热二室"));

    expect(seventhCard.text()).toContain("试验间状态监测屏");
    expect(labCards).toHaveLength(11);
    expect(hostlessLab?.text()).toContain("无搬运设备");
    expect(seventhCard.findAll(".visual-lab-status-metric.is-unavailable")).toHaveLength(2);
  });

  test("renders current laboratory login information on the fourth screen cards", async () => {
    snapshotState.attendanceSessions = [
      {
        active: true,
        employeeName: "王工",
        labName: "四综合实验室",
        loggedInAt: "2026-07-05T09:12:00+08:00",
        username: "wanggong",
      },
    ];
    const wrapper = mountPage();
    await Promise.resolve();
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const currentTaskScreen = wrapper.findAll('[data-testid="visual-screen-card"]')[3];
    expect(currentTaskScreen.text()).toContain("四综合实验室");
    expect(currentTaskScreen.text()).toContain("王工");
    expect(currentTaskScreen.text()).toContain("09:12登录");
  });

  test("keeps the normal eight-screen page when a retired standalone screen query is present", async () => {
    window.history.pushState({}, "", "/visualization?screen=current-lab-tasks");
    snapshotState.attendanceSessions = [
      {
        active: true,
        employeeName: "王工",
        labName: "四综合实验室",
        loggedInAt: "2026-07-05T09:12:00+08:00",
      },
    ];
    const wrapper = mountPage();
    await Promise.resolve();
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".visualization-toolbar").exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="visual-screen-card"]')).toHaveLength(8);
    expect(wrapper.find('[data-testid="visual-current-lab-standalone"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="visual-screen-card"]')[3].text()).toContain("王工");
  });

  test("uses screens one and five together to show the four most active laboratory process panels", async () => {
    snapshotState.snapshot = buildFourActiveLabSnapshot();
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll('[data-testid="visual-screen-card"]');
    const firstScreenLabNames = cards[0].findAll(".visual-lab-name").map((name) => name.text());
    const fifthScreenLabNames = cards[4].findAll(".visual-lab-name").map((name) => name.text());
    const displayedLabNames = [...firstScreenLabNames, ...fifthScreenLabNames];

    expect(cards[4].text()).toContain("实验室流程监控屏B组");
    expect(cards[4].findAll(".visual-lab-panel")).toHaveLength(2);
    expect(firstScreenLabNames).toEqual(["振动一室", "盐雾试验室"]);
    expect(fifthScreenLabNames).toEqual(["冲击一室", "霉菌试验室"]);
    expect(new Set(displayedLabNames).size).toBe(4);
    expect(cards[4].text()).not.toContain("今日任务计划总览屏");
    expect(cards[4].text()).not.toContain("SYLU-2026-0524-001");

    await cards[4].trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    expect(preview.findAll(".visual-lab-panel")).toHaveLength(2);
    expect(preview.text()).toContain("冲击一室");
    expect(preview.text()).toContain("霉菌试验室");
    expect(preview.text()).toContain("TRAY-IMPACT-A");
    expect(preview.text()).toContain("TRAY-MOLD-A");
  });

  test("renders the third-screen today task plan from real schedule snapshot data", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-18T10:00:00+08:00"));
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-REAL-001", name: "真实任务001", test_type: "冲击试验" },
        { code: "TASK-REAL-002", name: "真实任务002", test_type: "振动试验" },
      ],
      "mes.experiments": [
        { task_code: "TASK-REAL-001", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", required_device: "冲击一室" },
        { task_code: "TASK-REAL-001", experiment_code: "EXP-SALT", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: "TASK-REAL-002", experiment_code: "EXP-VIB", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-REAL-001", experiment_code: "EXP-IMPACT", tray_code: "REAL-TP-001" },
        { task_code: "TASK-REAL-001", experiment_code: "EXP-IMPACT", tray_code: "REAL-TP-002" },
        { task_code: "TASK-REAL-002", experiment_code: "EXP-VIB", tray_code: "REAL-TP-003" },
      ],
      "mes.schedules": [
        {
          task_code: "TASK-REAL-001",
          experiment_code: "EXP-IMPACT",
          device: "冲击一室",
          start_at: "2026-06-18T09:00:00+08:00",
          end_at: "2026-06-18T11:30:00+08:00",
          status: "已排程",
        },
        {
          task_code: "TASK-REAL-001",
          experiment_code: "EXP-SALT",
          device: "盐雾试验室",
          start_at: "2026-06-18T13:00:00+08:00",
          end_at: "2026-06-18T16:00:00+08:00",
          status: "已排程",
        },
        {
          task_code: "TASK-REAL-002",
          experiment_code: "EXP-VIB",
          device: "振动一室",
          start_at: "2026-06-18T15:00:00+08:00",
          end_at: "2026-06-18T17:30:00+08:00",
          status: "已排程",
        },
      ],
      "mes.samples": [
        {
          code: "SAMPLE-REAL-001",
          task_code: "TASK-REAL-001",
          trays: [{ tray_code: "REAL-TP-001", quantity: 2 }],
        },
        {
          code: "SAMPLE-REAL-002",
          task_code: "TASK-REAL-001",
          trays: [{ tray_code: "REAL-TP-002", quantity: 3 }],
        },
        {
          code: "SAMPLE-REAL-003",
          task_code: "TASK-REAL-002",
          trays: [{ tray_code: "REAL-TP-003", quantity: 1 }],
        },
      ],
    };

    try {
      const wrapper = mountPage();
      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const thirdCard = wrapper.findAll('[data-testid="visual-screen-card"]')[2];

      expect(thirdCard.text()).toContain("今日任务计划总览屏");
      expect(thirdCard.text()).toContain("实验数量");
      expect(thirdCard.text()).not.toContain("实验计划");
      expect(thirdCard.text()).toContain("TASK-REAL-001");
      expect(thirdCard.text()).toContain("冲击试验");
      expect(thirdCard.text()).not.toContain("SYLU-2026-0524-001");

      await thirdCard.trigger("click");

      const previewText = wrapper.find('[data-testid="visual-single-preview"]').text();
      expect(previewText).toContain("真实数据");
      expect(previewText).toContain("任务编号");
      expect(previewText).toContain("TASK-REAL-001");
      expect(previewText).toContain("09:00-11:30");
      expect(previewText).toContain("13:00-16:00");
      expect(previewText).toContain("冲击一室");
      expect(previewText).toContain("盐雾试验室");
      const preview = wrapper.find('[data-testid="visual-single-preview"]');
      const trayChips = preview.findAll('[data-testid="visual-task-plan-tray-chip"]');
      expect(trayChips.map((chip) => chip.text())).toEqual(expect.arrayContaining(["REAL-TP-001", "REAL-TP-002"]));
      expect(previewText).not.toContain("REAL-TP-001 / REAL-TP-002");
      expect(previewText).toContain("待分配托盘");
      expect(previewText).toContain("5件");
      expect(previewText).toContain("1件");
      expect(previewText).not.toContain("TP-001 / TP-002");
    } finally {
      vi.useRealTimers();
    }
  });

  test("renders screen four as the current laboratory task matrix with running-only countdown bars", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-17T14:45:00+08:00"));
    snapshotState.snapshot = buildCurrentLabTaskMatrixSnapshot();

    try {
      const wrapper = mountPage();
      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const fourthCard = wrapper.findAll('[data-testid="visual-screen-card"]')[3];

      expect(fourthCard.text()).toContain("试验间当前任务状态屏");
      expect(fourthCard.text()).toContain("已排程");
      expect(fourthCard.text()).not.toContain("有任务");
      expect(fourthCard.find(".metric-scheduled").text()).toContain("1");
      expect(fourthCard.find(".metric-repair").text()).toContain("0");
      expect(fourthCard.find(".metric-running").text()).toContain("1");
      expect(fourthCard.find(".metric-upkeep").text()).toContain("1");
      expect(fourthCard.text()).toContain("TASK-RUN");
      expect(fourthCard.text()).toContain("TASK-WAIT");
      expect(fourthCard.text()).toContain("保养");
      expect(fourthCard.text()).toContain("计划时间");
      expect(fourthCard.text()).toContain("2026-06-17 15:20 - 2026-06-17 16:30");
      expect(fourthCard.findAll('[data-testid="lab-matrix-card"]')).toHaveLength(4);
      expect(fourthCard.text()).toContain("盐雾试验室");
      expect(fourthCard.text()).not.toContain("暂存间");
      expect(fourthCard.text()).not.toContain("外观检测间");
      expect(fourthCard.text()).not.toContain("接驳");

      const runningCard = fourthCard.find('[data-lab-name="振动一室"]');
      const maintenanceCard = fourthCard.find('[data-lab-name="霉菌试验室"]');
      const waitingCard = fourthCard.find('[data-lab-name="冲击一室"]');

      expect(runningCard.classes()).toContain("running");
      expect(runningCard.find('[data-testid="lab-matrix-countdown"]').exists()).toBe(true);
      expect(runningCard.text()).toContain("01:15:00");
      expect(maintenanceCard.classes()).toContain("upkeep");
      expect(maintenanceCard.classes()).not.toContain("repair");
      expect(maintenanceCard.find('[data-testid="lab-matrix-countdown"]').exists()).toBe(false);
      expect(waitingCard.classes()).toContain("planned");
      expect(waitingCard.find('[data-testid="lab-matrix-countdown"]').exists()).toBe(false);
      expect(waitingCard.find(".tray-row").text()).toContain("TRAY-WAIT");
      expect(waitingCard.find(".tray-row").text()).toContain("1件");
      expect(waitingCard.find(".total").text()).toContain("托盘 1，样品 1");
    } finally {
      vi.useRealTimers();
    }
  });

  test("auto-enables tray looping only when the rendered tray list overflows its viewport", async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
    window.cancelAnimationFrame = vi.fn();

    try {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          return this.classList?.contains("tray-list") ? 120 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get() {
          return this.classList?.contains("tray-viewport") ? 60 : 0;
        },
      });

      snapshotState.snapshot = buildCurrentLabTaskMatrixSnapshot();
      const overflowingWrapper = mountPage();
      await Promise.resolve();
      await overflowingWrapper.vm.$nextTick();
      await overflowingWrapper.vm.$nextTick();

      const overflowingPanel = overflowingWrapper
        .findAll('[data-testid="visual-screen-card"]')[3]
        .find('[data-lab-name="冲击一室"] .tray-panel');
      expect(overflowingPanel.classes()).toContain("is-scrollable");
      expect(overflowingPanel.text()).toContain("循环播放");
      overflowingWrapper.unmount();

      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          return this.classList?.contains("tray-list") ? 40 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get() {
          return this.classList?.contains("tray-viewport") ? 60 : 0;
        },
      });

      const fittingWrapper = mountPage();
      await Promise.resolve();
      await fittingWrapper.vm.$nextTick();
      await fittingWrapper.vm.$nextTick();

      const fittingPanel = fittingWrapper
        .findAll('[data-testid="visual-screen-card"]')[3]
        .find('[data-lab-name="冲击一室"] .tray-panel');
      expect(fittingPanel.classes()).not.toContain("is-scrollable");
      expect(fittingPanel.text()).not.toContain("循环播放");
      fittingWrapper.unmount();
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      } else {
        delete HTMLElement.prototype.scrollHeight;
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      } else {
        delete HTMLElement.prototype.clientHeight;
      }
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  test("compresses laboratory process flow steps in thumbnails", async () => {
    snapshotState.snapshot = buildSingleRunningLabSnapshot();
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const firstCard = wrapper.findAll('[data-testid="visual-screen-card"]')[0];
    const thumbnailSteps = firstCard.findAll(".visual-flow-step");

    await firstCard.trigger("click");

    const expandedSteps = wrapper.find('[data-testid="visual-single-preview"]').findAll(".visual-flow-step");
    expect(expandedSteps.length).toBeGreaterThan(9);
    expect(thumbnailSteps.length).toBeLessThan(expandedSteps.length);
    expect(thumbnailSteps.length).toBeLessThanOrEqual(9);
  });

  test("excludes laboratories already shown on the companion lab process screen when switching screen five", async () => {
    snapshotState.snapshot = buildFourActiveLabSnapshot();
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[4].trigger("click");
    await wrapper.get('[data-testid="visual-lab-cycle-primary"]').trigger("click");

    const picker = wrapper.get('[data-testid="visual-lab-picker"]');
    const optionText = picker.text();
    expect(optionText).toContain("冲击一室");
    expect(optionText).toContain("高低温湿热一室");
    expect(optionText).toContain("高低温湿热二室");
    expect(optionText).not.toContain("振动一室");
    expect(optionText).not.toContain("盐雾试验室");
    expect(optionText).not.toContain("霉菌试验室");

    const replacement = wrapper.findAll('[data-testid="visual-lab-picker-option"]').find((option) => option.text().includes("高低温湿热一室"));
    expect(replacement).toBeTruthy();
    await replacement.trigger("click");

    const fifthPreviewText = wrapper.find('[data-testid="visual-single-preview"]').text();
    expect(fifthPreviewText).toContain("高低温湿热一室");
    expect(fifthPreviewText).toContain("霉菌试验室");
    expect(fifthPreviewText).not.toContain("振动一室");
    expect(fifthPreviewText).not.toContain("盐雾试验室");
  });

  test("renders an operations summary and numbered screen metadata", () => {
    const wrapper = mountPage();

    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toContain("在线屏幕");
    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toContain("8/8");
    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toMatch(/监控试验间\d+/);
    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toContain("运行任务0");
    expect(wrapper.get('[data-testid="visual-operations-summary"]').text()).toContain("托盘流程0");

    const cards = wrapper.findAll('[data-testid="visual-screen-card"]');

    expect(cards[0].text()).toContain("01");
    expect(cards[0].text()).toContain("运行中");
    expect(cards[7].text()).toContain("08");
  });

  test("opens a single-screen enlargement and switches labs through an in-screen picker", async () => {
    const wrapper = mountPage();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[0].trigger("click");

    expect(wrapper.find('[data-testid="visual-single-preview"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="visual-single-preview"]').findAll(".visual-lab-panel")).toHaveLength(2);
    expect(wrapper.find('[data-testid="visual-single-preview"]').find(".visual-preview-header").exists()).toBe(false);
    expect(wrapper.find('[data-testid="visual-single-preview"]').find(".visual-lab-switch").exists()).toBe(false);

    await wrapper.get('[data-testid="visual-lab-cycle-primary"]').trigger("click");

    const picker = wrapper.get('[data-testid="visual-lab-picker"]');

    expect(picker.text()).toContain("选择上方试验间");

    const nextOption = wrapper.findAll('[data-testid="visual-lab-picker-option"]').find((option) => !option.classes().includes("is-selected"));
    expect(nextOption).toBeTruthy();
    const nextLabName = nextOption.find("span").text();
    await nextOption.trigger("click");

    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain(nextLabName);
    const selectedLabNames = wrapper.find('[data-testid="visual-single-preview"]').findAll(".visual-lab-name").map((name) => name.text());
    expect(new Set(selectedLabNames).size).toBe(selectedLabNames.length);
    expect(wrapper.find('[data-testid="visual-lab-picker"]').exists()).toBe(false);
  });

  test("prioritizes laboratories with active task information on the first screen", async () => {
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-SALT-001", name: "盐雾优先任务" },
        { code: "TASK-MOLD-001", name: "霉菌优先任务" },
      ],
      "mes.experiments": [
        { task_code: "TASK-SALT-001", experiment_code: "EXP-SALT", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: "TASK-MOLD-001", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验", required_device: "霉菌试验室" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-SALT-001", experiment_code: "EXP-SALT", tray_code: "TRAY-SALT-001" },
        { task_code: "TASK-MOLD-001", experiment_code: "EXP-MOLD", tray_code: "TRAY-MOLD-001" },
      ],
      "mes.schedules": [
        { task_code: "TASK-SALT-001", experiment_code: "EXP-SALT", device: "盐雾试验室", status: "实验进行中" },
        { task_code: "TASK-MOLD-001", experiment_code: "EXP-MOLD", device: "霉菌试验室", status: "实验进行中" },
      ],
      "mes.samples": [
        {
          code: "SAMPLE-SALT-001",
          task_code: "TASK-SALT-001",
          location: "盐雾试验室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-SALT-001", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SAMPLE-MOLD-001",
          task_code: "TASK-MOLD-001",
          location: "霉菌试验室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-MOLD-001", status: "实验进行中", quantity: 1 }],
        },
      ],
    };
    const wrapper = mountPage();

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const firstCardText = wrapper.findAll('[data-testid="visual-screen-card"]')[0].text();
    expect(firstCardText).toContain("盐雾试验室");
    expect(firstCardText).toContain("霉菌试验室");
    expect(firstCardText).not.toContain("振动一室");
    expect(firstCardText).not.toContain("高低温湿热一室");
  });

  test("closes the single-screen enlargement when clicking the blank overlay only", async () => {
    const wrapper = mountPage();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[4].trigger("click");
    expect(wrapper.find('[data-testid="visual-single-preview"]').exists()).toBe(true);

    await wrapper.get(".visual-preview-shell").trigger("click");
    expect(wrapper.find('[data-testid="visual-single-preview"]').exists()).toBe(true);

    await wrapper.get('[data-testid="visual-single-preview"]').trigger("click");
    expect(wrapper.find('[data-testid="visual-single-preview"]').exists()).toBe(false);
  });

  test("does not render demo task or tray identifiers when no real snapshot data exists", async () => {
    const wrapper = mountPage();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.findAll('[data-testid="visual-screen-card"]')[0].trigger("click");

    const previewText = wrapper.find('[data-testid="visual-single-preview"]').text();
    const summaryText = wrapper.get('[data-testid="visual-operations-summary"]').text();

    expect(previewText).toContain("暂无托盘");
    expect(previewText).not.toContain("SYLU-2026-0522");
    expect(previewText).not.toContain("TRAY-DEMO");
    expect(summaryText).toContain("运行任务0");
    expect(summaryText).toContain("托盘流程0");
  });

  test("renders real tray flow for selected labs in the first screen", async () => {
    snapshotState.snapshot = buildSingleRunningLabSnapshot();
    const wrapper = mountPage();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.findAll('[data-testid="visual-screen-card"]')[0].trigger("click");

    const previewText = wrapper.find('[data-testid="visual-single-preview"]').text();

    expect(previewText).toContain("TRAY-VIS-001");
    expect(previewText).toContain("TASK-VIS-001");
    const flowHead = wrapper.find('[data-testid="visual-single-preview"] .visual-tray-flow-head');
    expect(flowHead.get("strong").text()).toBe("任务编号：TASK-VIS-001");
    expect(flowHead.get("span").text()).toBe("托盘编号：TRAY-VIS-001");
    expect(previewText).toContain("样品运输中");
    expect(previewText).toContain("振动试验进行中");
    expect(previewText).toContain("到货");
    expect(previewText).not.toContain("05-22 10:00:00");
    expect(previewText).not.toContain("+08:00");
    expect(previewText).not.toContain("任务下发");
    expect(previewText).not.toContain("样品 / 托盘");
    expect(previewText).not.toContain("当前状态");
    expect(previewText).not.toContain("运行正常");

    const flowSteps = wrapper.findAll('[data-testid="visual-single-preview"] .visual-flow-step');
    const runningStep = flowSteps.find((step) => step.get("strong").text() === "振动试验进行中");
    const stagingStep = flowSteps.find((step) => step.get("strong").text() === "送至暂存间");
    expect(runningStep?.classes()).toContain("is-active");
    expect(runningStep?.attributes("title")).toBe("05-22 10:00:00");
    expect(stagingStep?.classes()).toContain("is-inferred");
    expect(stagingStep?.attributes("title")).toBe("推导节点，暂无实际时间记录");
  });

  test("switches tasks and trays inside the enlarged first screen", async () => {
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-LAB-A", name: "振动任务A" },
        { code: "TASK-LAB-B", name: "振动任务B" },
      ],
      "mes.experiments": [
        { task_code: "TASK-LAB-A", experiment_code: "EXP-LAB-A", experiment_name: "振动试验A", required_device: "振动一室" },
        { task_code: "TASK-LAB-B", experiment_code: "EXP-LAB-B", experiment_name: "振动试验B", required_device: "振动一室" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-LAB-A", experiment_code: "EXP-LAB-A", tray_code: "TRAY-A-001" },
        { task_code: "TASK-LAB-A", experiment_code: "EXP-LAB-A", tray_code: "TRAY-A-002" },
        { task_code: "TASK-LAB-B", experiment_code: "EXP-LAB-B", tray_code: "TRAY-B-001" },
      ],
      "mes.schedules": [
        { task_code: "TASK-LAB-A", experiment_code: "EXP-LAB-A", device: "振动一室", status: "实验进行中" },
        { task_code: "TASK-LAB-B", experiment_code: "EXP-LAB-B", device: "振动一室", status: "实验准备就绪" },
      ],
      "mes.samples": [
        {
          code: "SAMPLE-A-001",
          task_code: "TASK-LAB-A",
          location: "振动一室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-A-001", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SAMPLE-A-002",
          task_code: "TASK-LAB-A",
          location: "振动一室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TRAY-A-002", status: "实验准备就绪", quantity: 1 }],
        },
        {
          code: "SAMPLE-B-001",
          task_code: "TASK-LAB-B",
          location: "振动一室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TRAY-B-001", status: "实验准备就绪", quantity: 1 }],
        },
      ],
    };
    const wrapper = mountPage();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.findAll('[data-testid="visual-screen-card"]')[0].trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    expect(preview.find(".visual-board").classes()).toContain("is-layout-a");
    expect(preview.find('[data-testid="visual-lab-layout-option"]').exists()).toBe(false);

    expect(preview.text()).toContain("任务切换");
    expect(preview.text()).toContain("托盘切换");
    expect(preview.text()).toContain("TRAY-A-001");
    expect(preview.text()).toContain("任务编号：TASK-LAB-A");
    expect(preview.text()).toContain("托盘编号：TRAY-A-001");

    const taskB = preview.findAll('[data-testid="visual-lab-task-option"]').find((option) => option.text().includes("TASK-LAB-B"));
    expect(taskB).toBeTruthy();
    await taskB.trigger("click");
    expect(preview.text()).toContain("任务编号：TASK-LAB-B");
    expect(preview.text()).toContain("TRAY-B-001");
    expect(preview.text()).toContain("托盘编号：TRAY-B-001");

    const taskA = preview.findAll('[data-testid="visual-lab-task-option"]').find((option) => option.text().includes("TASK-LAB-A"));
    expect(taskA).toBeTruthy();
    await taskA.trigger("click");

    const trayA2 = preview.findAll('[data-testid="visual-lab-tray-option"]').find((option) => option.text().includes("TRAY-A-002"));
    expect(trayA2).toBeTruthy();
    await trayA2.trigger("click");
    expect(preview.text()).toContain("托盘编号：TRAY-A-002");
  });

  test("renders the second screen as a real three-day laboratory schedule view", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T10:00:00+08:00"));
    snapshotState.snapshot = {
      "mes.tasks": [{ code: "TASK-SCH-001", name: "三日排程任务", test_type: "振动试验" }],
      "mes.experiments": [
        { task_code: "TASK-SCH-001", experiment_code: "EXP-SCH-VIB", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-SCH-001", experiment_code: "EXP-SCH-VIB", tray_code: "TP-SCH-001" },
      ],
      "mes.schedules": [
        {
          id: "schedule-sch-001",
          axis_codes: ["x+", "y-", "z+"],
          task_code: "TASK-SCH-001",
          experiment_code: "EXP-SCH-VIB",
          device: "振动一室",
          start_at: "2026-05-23T08:00:00+08:00",
          end_at: "2026-05-23T12:00:00+08:00",
          status: "已排程",
        },
        {
          id: "schedule-sch-outside",
          task_code: "TASK-SCH-OUTSIDE",
          experiment_code: "EXP-SCH-OUTSIDE",
          device: "振动一室",
          start_at: "2026-05-26T08:00:00+08:00",
          end_at: "2026-05-26T12:00:00+08:00",
          status: "已排程",
        },
      ],
      "mes.samples": [
        {
          code: "SP-SCH-001",
          task_code: "TASK-SCH-001",
          status: "实验进行中",
          trays: [{ tray_code: "TP-SCH-001", status: "实验进行中", quantity: 1 }],
        },
      ],
    };

    try {
      const wrapper = mountPage();

      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const secondCard = wrapper.findAll('[data-testid="visual-screen-card"]')[1];
      expect(secondCard.text()).toContain("三日实验室排期屏");
      expect(secondCard.text()).toContain("5/23");
      expect(secondCard.text()).toContain("5/24");
      expect(secondCard.text()).toContain("5/25");
      expect(secondCard.text()).not.toContain("今天");
      expect(secondCard.text()).not.toContain("明天");
      expect(secondCard.text()).not.toContain("后天");
      expect(secondCard.find(".visual-schedule-days").exists()).toBe(false);
      const periodHeaders = secondCard.findAll(".visual-schedule-grid-head:not(.visual-schedule-lab-head)");
      expect(periodHeaders).toHaveLength(6);
      expect(periodHeaders[0].get("strong").text()).toBe("5/23 上午");
      expect(periodHeaders[0].get("small").text()).toBe("1 项");
      expect(periodHeaders[1].get("strong").text()).toBe("5/23 下午");
      expect(periodHeaders[1].get("small").text()).toBe("0 项");
      expect(secondCard.text()).toContain("TASK-SCH-001");
      expect(secondCard.text()).not.toContain("12 台设备");
      expect(secondCard.text()).not.toContain("TASK-SCH-OUTSIDE");

      await secondCard.trigger("click");

      const previewText = wrapper.find('[data-testid="visual-single-preview"]').text();
      expect(wrapper.get(".visual-schedule-grid").attributes("style")).toContain("--visual-schedule-row-count");
      expect(wrapper.find('[data-testid="visual-single-preview"] .visual-schedule-days').exists()).toBe(false);
      expect(previewText).not.toContain("振动试验");
      expect(previewText).not.toContain("X+ / Y- / Z+");
      expect(previewText).toContain("08:00-12:00");
      expect(previewText).toContain("进行中");
      expect(previewText).not.toContain("已排程");
      const runningSlot = wrapper.find('[data-testid="visual-single-preview"] .visual-schedule-slot.state-running');
      expect(runningSlot.exists()).toBe(true);
      expect(runningSlot.find(".visual-schedule-slot-state").exists()).toBe(false);
      expect(runningSlot.find(".visual-schedule-task strong").text()).toBe("TASK-SCH-001");
      expect(runningSlot.find(".visual-schedule-task small").text()).toBe("08:00-12:00");
      expect(runningSlot.find(".visual-schedule-task span").exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("shows maintenance devices as maintenance in the enlarged schedule screen", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T10:00:00+08:00"));
    snapshotState.snapshot = {
      "mes.devices": [
        { code: "冲击一室", name: "冲击一室", status: "维修" },
      ],
      "mes.experiment_trays": [],
      "mes.experiments": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.tasks": [],
    };

    try {
      const wrapper = mountPage();

      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const secondCard = wrapper.findAll('[data-testid="visual-screen-card"]')[1];
      expect(secondCard.text()).toContain("三日实验室排期屏");
      expect(secondCard.text()).toContain("维修中");

      await secondCard.trigger("click");

      const preview = wrapper.find('[data-testid="visual-single-preview"]');
      expect(preview.text()).toContain("冲击一室");
      expect(preview.text()).toContain("维修中");
      expect(preview.find(".visual-schedule-slot.state-maintenance").exists()).toBe(true);
      expect(preview.find(".visual-schedule-slot.state-maintenance").text()).toBe("维修中");
    } finally {
      vi.useRealTimers();
    }
  });

  test("rotates overlapping schedules one at a time with a breathing progress rail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T10:00:00+08:00"));
    snapshotState.snapshot = {
      "mes.experiment_trays": [],
      "mes.experiments": [
        { task_code: "TASK-ROT-001", experiment_code: "EXP-ROT-001", experiment_name: "振动试验" },
        { task_code: "TASK-ROT-002", experiment_code: "EXP-ROT-002", experiment_name: "温度冲击试验" },
        { task_code: "TASK-ROT-003", experiment_code: "EXP-ROT-003", experiment_name: "高低温试验" },
      ],
      "mes.samples": [],
      "mes.schedules": [
        { id: "schedule-rot-001", task_code: "TASK-ROT-001", experiment_code: "EXP-ROT-001", device: "振动一室", start_at: "2026-05-23T08:00:00+08:00", end_at: "2026-05-23T09:00:00+08:00", status: "已排程" },
        { id: "schedule-rot-002", task_code: "TASK-ROT-002", experiment_code: "EXP-ROT-002", device: "振动一室", start_at: "2026-05-23T09:00:00+08:00", end_at: "2026-05-23T10:00:00+08:00", status: "已排程" },
        { id: "schedule-rot-003", task_code: "TASK-ROT-003", experiment_code: "EXP-ROT-003", device: "振动一室", start_at: "2026-05-23T10:00:00+08:00", end_at: "2026-05-23T11:00:00+08:00", status: "已排程" },
      ],
      "mes.tasks": [
        { code: "TASK-ROT-001", name: "轮播任务一", test_type: "振动试验" },
        { code: "TASK-ROT-002", name: "轮播任务二", test_type: "温度冲击试验" },
        { code: "TASK-ROT-003", name: "轮播任务三", test_type: "高低温试验" },
      ],
    };

    try {
      const wrapper = mountPage();
      await Promise.resolve();
      await wrapper.vm.$nextTick();
      await wrapper.findAll('[data-testid="visual-screen-card"]')[1].trigger("click");

      const rotatingSlot = wrapper.find('[data-testid="visual-single-preview"] .visual-schedule-slot.has-rotating-items');
      expect(rotatingSlot.exists()).toBe(true);
      expect(rotatingSlot.findAll(".visual-schedule-task")).toHaveLength(1);
      expect(rotatingSlot.findAll(".visual-schedule-cycle-light")).toHaveLength(3);
      expect(rotatingSlot.text()).toContain("TASK-ROT-001");

      await vi.advanceTimersByTimeAsync(4200);
      await wrapper.vm.$nextTick();

      expect(rotatingSlot.text()).toContain("TASK-ROT-002");
      expect(rotatingSlot.findAll(".visual-schedule-cycle-light.is-active")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("shows maintenance conflicts in the enlarged schedule screen", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T10:00:00+08:00"));
    snapshotState.snapshot = {
      "mes.devices": [
        {
          code: "冲击一室",
          name: "冲击一室",
          status: "可用",
          maintenance_start_at: "2026-05-26T08:00:00+08:00",
          maintenance_end_at: "",
        },
      ],
      "mes.experiment_trays": [],
      "mes.experiments": [
        { task_code: "TASK-MAINT-CONFLICT", experiment_code: "EXP-MAINT-CONFLICT", experiment_name: "冲击试验", required_device: "冲击一室" },
      ],
      "mes.samples": [],
      "mes.schedules": [
        {
          id: "schedule-maint-conflict",
          task_code: "TASK-MAINT-CONFLICT",
          experiment_code: "EXP-MAINT-CONFLICT",
          device: "冲击一室",
          start_at: "2026-05-26T09:00:00+08:00",
          end_at: "2026-05-26T11:00:00+08:00",
          status: "已排程",
        },
      ],
      "mes.tasks": [{ code: "TASK-MAINT-CONFLICT", status: "已排程", test_type: "冲击试验" }],
    };

    try {
      const wrapper = mountPage();

      await Promise.resolve();
      await wrapper.vm.$nextTick();

      await wrapper.findAll('[data-testid="visual-screen-card"]')[1].trigger("click");

      const preview = wrapper.find('[data-testid="visual-single-preview"]');
      expect(preview.text()).toContain("维修冲突");
      expect(preview.find(".visual-schedule-slot.state-maintenance-conflict").exists()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("switches the enlarged schedule screen date window with arrow buttons", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T10:00:00+08:00"));
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-SCH-001", name: "今日任务", test_type: "振动试验" },
        { code: "TASK-SCH-026", name: "后移窗口任务", test_type: "振动试验" },
      ],
      "mes.experiments": [
        { task_code: "TASK-SCH-001", experiment_code: "EXP-SCH-VIB", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: "TASK-SCH-026", experiment_code: "EXP-SCH-NEXT", experiment_name: "后移窗口振动", required_device: "振动一室" },
      ],
      "mes.experiment_trays": [],
      "mes.schedules": [
        {
          id: "schedule-sch-001",
          task_code: "TASK-SCH-001",
          experiment_code: "EXP-SCH-VIB",
          device: "振动一室",
          start_at: "2026-05-23T08:00:00+08:00",
          end_at: "2026-05-23T12:00:00+08:00",
          status: "已排程",
        },
        {
          id: "schedule-sch-026",
          task_code: "TASK-SCH-026",
          experiment_code: "EXP-SCH-NEXT",
          device: "振动一室",
          start_at: "2026-05-26T08:00:00+08:00",
          end_at: "2026-05-26T12:00:00+08:00",
          status: "已排程",
        },
      ],
      "mes.samples": [],
    };

    try {
      const wrapper = mountPage();

      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const secondCard = wrapper.findAll('[data-testid="visual-screen-card"]')[1];
      expect(secondCard.find('[data-testid="visual-schedule-next"]').exists()).toBe(false);

      await secondCard.trigger("click");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TASK-SCH-001");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).not.toContain("TASK-SCH-026");

      await wrapper.get('[data-testid="visual-schedule-next"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TASK-SCH-026");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("5/26");

      await wrapper.get('[data-testid="visual-schedule-today"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TASK-SCH-001");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("5/23");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).not.toContain("TASK-SCH-026");

      await wrapper.get('[data-testid="visual-schedule-next"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TASK-SCH-026");

      await wrapper.get('[data-testid="visual-schedule-prev"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TASK-SCH-001");
    } finally {
      vi.useRealTimers();
    }
  });

  test("renders the fifth screen as the secondary laboratory process board", async () => {
    snapshotState.snapshot = buildFourActiveLabSnapshot();
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    const fifthCard = wrapper.findAll('[data-testid="visual-screen-card"]')[4];

    expect(fifthCard.text()).toContain("实验室流程监控屏B组");
    expect(fifthCard.findAll(".visual-lab-panel")).toHaveLength(2);
    expect(fifthCard.text()).toContain("冲击一室");
    expect(fifthCard.text()).toContain("霉菌试验室");
    expect(fifthCard.text()).toContain("TRAY-IMPACT-A");
    expect(fifthCard.text()).toContain("TRAY-MOLD-A");
    expect(fifthCard.text()).not.toContain("今日任务计划总览屏");
    expect(fifthCard.text()).not.toContain("SYLU-2026-0524-001");
    expect(fifthCard.text()).not.toContain("合格率趋势屏");
    expect(fifthCard.text()).not.toContain("97.3%");

    await fifthCard.trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    const previewText = preview.text();
    expect(preview.find(".visual-board").classes()).toContain("is-layout-a");
    expect(preview.findAll(".visual-lab-panel")).toHaveLength(2);
    expect(previewText).toContain("任务切换");
    expect(previewText).toContain("托盘切换");
    expect(previewText).toContain("冲击一室");
    expect(previewText).toContain("霉菌试验室");
    expect(previewText).toContain("任务编号：TASK-IMPACT-A");
    expect(previewText).toContain("任务编号：TASK-MOLD-A");
  });

  test("renders the sixth screen as a staging sample board with task tray switching and full sample codes", async () => {
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-STAGING-001", name: "盐雾暂存任务", test_type: "盐雾试验" },
        { code: "TASK-STAGING-002", name: "霉菌暂存任务", test_type: "霉菌试验" },
      ],
      "mes.experiments": [
        { task_code: "TASK-STAGING-001", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" },
        { task_code: "TASK-STAGING-002", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-STAGING-001", experiment_code: "EXP-SALT", tray_code: "TRAY-SALT-001" },
        { task_code: "TASK-STAGING-002", experiment_code: "EXP-MOLD", tray_code: "TRAY-MOLD-001" },
      ],
      "mes.staging_events": [
        { tray_code: "TRAY-SALT-001", task_code: "TASK-STAGING-001", action: "stock_in", time: "2026-05-28T08:00:00+08:00" },
        { tray_code: "TRAY-MOLD-001", task_code: "TASK-STAGING-002", action: "stock_in", time: "2026-05-28T08:05:00+08:00" },
      ],
      "mes.samples": [
        ...Array.from({ length: 6 }, (_, index) => ({
          code: `SALT-SAMPLE-00${index + 1}`,
          task_code: "TASK-STAGING-001",
          location: "恒温恒湿间（暂存间）",
          status: "已入库",
          trays: [{ tray_code: "TRAY-SALT-001", status: "已入库", quantity: 1 }],
        })),
        {
          code: "MOLD-SAMPLE-001",
          task_code: "TASK-STAGING-002",
          location: "恒温恒湿间（暂存间）",
          status: "实验后暂存间存放",
          trays: [{ tray_code: "TRAY-MOLD-001", status: "实验后暂存间存放", quantity: 1 }],
        },
      ],
    };
    const wrapper = mountPage();

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const sixthCard = wrapper.findAll('[data-testid="visual-screen-card"]')[5];
    expect(sixthCard.text()).toContain("暂存间/外观检测间样品信息屏");
    expect(sixthCard.text()).toContain("托盘剩余");

    await sixthCard.trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    expect(preview.text()).toContain("任务切换");
    expect(preview.text()).toContain("托盘切换");
    expect(preview.text()).toContain("TASK-STAGING-001");
    expect(preview.text()).toContain("TRAY-SALT-001");
    expect(preview.text()).toContain("SALT-SAMPLE-005");
    expect(preview.text()).toContain("SALT-SAMPLE-006");
    expect(preview.find('[data-testid="visual-staging-all-samples"]').exists()).toBe(false);
    expect(preview.get('[data-testid="visual-staging-overview"]').text()).toContain("当前任务2");
    expect(preview.get('[data-testid="visual-staging-overview"]').text()).toContain("暂存托盘2");
    expect(preview.get('[data-testid="visual-staging-overview"]').text()).toContain("样品总数7");
    expect(preview.text()).toContain("托盘剩余8");
    expect(preview.text()).toContain("已用托盘 2");
    expect(preview.text()).toContain("盐雾剩余99");
    expect(preview.text()).toContain("已用盐量 1");
    expect(preview.text()).not.toContain("盐雾托盘");
    expect(preview.text()).toContain("霉菌剩余99");
    expect(preview.text()).toContain("已用菌体 1");
    expect(preview.text()).not.toContain("霉菌托盘");
    expect(preview.findAll('[data-testid="visual-staging-capacity-card"]')[0].findAll(".visual-staging-capacity-tick")).toHaveLength(10);
    expect(preview.findAll('[data-testid="visual-staging-capacity-card"]')[0].findAll(".visual-staging-capacity-tick.is-active")).toHaveLength(8);

    await wrapper.findAll('[data-testid="visual-staging-task-option"]')[1].trigger("click");

    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("TRAY-MOLD-001");
    expect(wrapper.find('[data-testid="visual-single-preview"]').text()).toContain("MOLD-SAMPLE-001");
  });

  test("auto-enables staging sample looping only when the rendered sample list overflows", async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
    window.cancelAnimationFrame = vi.fn();

    snapshotState.snapshot = {
      "mes.tasks": [{ code: "TASK-STAGING-SCROLL", name: "大量样品暂存任务", test_type: "四综合试验" }],
      "mes.experiments": [{ task_code: "TASK-STAGING-SCROLL", experiment_code: "EXP-COMBO", experiment_name: "四综合试验" }],
      "mes.experiment_trays": [{ task_code: "TASK-STAGING-SCROLL", experiment_code: "EXP-COMBO", tray_code: "TRAY-SCROLL-001" }],
      "mes.staging_events": [{ tray_code: "TRAY-SCROLL-001", task_code: "TASK-STAGING-SCROLL", action: "stock_in", time: "2026-05-28T08:00:00+08:00" }],
      "mes.samples": Array.from({ length: 12 }, (_, index) => ({
        code: `LONG-STAGING-SAMPLE-${String(index + 1).padStart(3, "0")}`,
        task_code: "TASK-STAGING-SCROLL",
        location: "恒温恒湿间（暂存间）",
        status: "已入库",
        trays: [{ tray_code: "TRAY-SCROLL-001", status: "已入库", quantity: 1 }],
      })),
    };

    try {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          return this.classList?.contains("visual-staging-sample-grid") ? 180 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get() {
          return this.classList?.contains("visual-staging-sample-viewport") ? 80 : 0;
        },
      });

      const overflowingWrapper = mountPage();
      await Promise.resolve();
      await overflowingWrapper.vm.$nextTick();
      await overflowingWrapper.findAll('[data-testid="visual-screen-card"]')[5].trigger("click");
      await overflowingWrapper.vm.$nextTick();
      await overflowingWrapper.vm.$nextTick();

      const overflowingPreview = overflowingWrapper.find('[data-testid="visual-single-preview"]');
      expect(overflowingPreview.find(".visual-staging-sample-wrap").classes()).toContain("is-scrollable");
      expect(overflowingPreview.find(".visual-staging-sample-grid").classes()).toContain("is-looping");
      expect(overflowingPreview.text()).toContain("自动循环播放");
      expect(overflowingPreview.findAll(".visual-staging-sample-code")).toHaveLength(24);
      overflowingWrapper.unmount();

      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          return this.classList?.contains("visual-staging-sample-grid") ? 60 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get() {
          return this.classList?.contains("visual-staging-sample-viewport") ? 80 : 0;
        },
      });

      const fittingWrapper = mountPage();
      await Promise.resolve();
      await fittingWrapper.vm.$nextTick();
      await fittingWrapper.findAll('[data-testid="visual-screen-card"]')[5].trigger("click");
      await fittingWrapper.vm.$nextTick();
      await fittingWrapper.vm.$nextTick();

      const fittingPreview = fittingWrapper.find('[data-testid="visual-single-preview"]');
      expect(fittingPreview.find(".visual-staging-sample-wrap").classes()).not.toContain("is-scrollable");
      expect(fittingPreview.find(".visual-staging-sample-grid").classes()).not.toContain("is-looping");
      expect(fittingPreview.text()).not.toContain("自动循环播放");
      expect(fittingPreview.findAll(".visual-staging-sample-code")).toHaveLength(12);
      fittingWrapper.unmount();
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      } else {
        delete HTMLElement.prototype.scrollHeight;
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      } else {
        delete HTMLElement.prototype.clientHeight;
      }
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  test("renders staging legend and distinct staging kind styles", async () => {
    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-STAGING-KINDS", name: "暂存分类任务", test_type: "盐雾试验" },
      ],
      "mes.samples": [
        {
          code: "SP-CURRENT",
          task_code: "TASK-STAGING-KINDS",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [{ tray_code: "TP-CURRENT", status: "已到达暂存间", quantity: 1 }],
        },
        {
          code: "SP-PLANNED",
          task_code: "TASK-STAGING-KINDS",
          location: "室外接驳区",
          status: "送至暂存间",
          trays: [{ tray_code: "TP-PLANNED", status: "送至暂存间", quantity: 1 }],
        },
        {
          code: "SP-POST",
          task_code: "TASK-STAGING-KINDS",
          location: "恒温恒湿间（实验后暂存间）",
          status: "实验后暂存间存放",
          trays: [{ tray_code: "TP-POST", status: "实验后暂存间存放", quantity: 1 }],
        },
      ],
    };
    const wrapper = mountPage();

    await Promise.resolve();
    await wrapper.vm.$nextTick();
    await wrapper.findAll('[data-testid="visual-screen-card"]')[5].trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    const overview = preview.get('[data-testid="visual-staging-overview"]');
    const kindSummary = preview.get('[data-testid="visual-staging-kind-summary"]');
    expect(overview.text()).toContain("暂存间存放/计划暂存/实验后暂存间存放/外观检测间存放");
    expect(kindSummary.text()).toContain("1/1/1/0");
    expect(kindSummary.find(".kind-planned").exists()).toBe(true);
    expect(kindSummary.find(".kind-allowed").exists()).toBe(false);
    expect(kindSummary.find(".kind-post-test").exists()).toBe(true);
    expect(preview.find('[data-testid="visual-staging-legend"]').exists()).toBe(false);

    const trayOptions = preview.findAll('[data-testid="visual-staging-tray-option"]');
    expect(trayOptions.some((option) => option.classes().includes("kind-planned"))).toBe(true);
    expect(trayOptions.some((option) => option.classes().includes("kind-post-test"))).toBe(true);

    await trayOptions.find((option) => option.text().includes("TP-POST"))?.trigger("click");

    expect(preview.find(".visual-staging-tray-detail").classes()).toContain("kind-post-test");
    expect(preview.find(".visual-staging-sample-code").classes()).toContain("kind-post-test");
  });

  test("shows a red warning marker when tray remaining is at or below ten percent", async () => {
    snapshotState.snapshot = {
      "mes.tasks": [{ code: "TASK-STAGING-LOW", name: "低库存暂存任务", test_type: "盐雾试验" }],
      "mes.experiments": [{ task_code: "TASK-STAGING-LOW", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" }],
      "mes.experiment_trays": [{ task_code: "TASK-STAGING-LOW", experiment_code: "EXP-SALT", tray_code: "LOW-TP-001" }],
      "mes.staging_events": [{ tray_code: "LOW-TP-001", task_code: "TASK-STAGING-LOW", action: "stock_in", time: "2026-05-28T08:00:00+08:00" }],
      "mes.samples": Array.from({ length: 9 }, (_, index) => ({
        code: `LOW-SAMPLE-${String(index + 1).padStart(3, "0")}`,
        task_code: index === 0 ? "TASK-STAGING-LOW" : `TASK-USED-${index}`,
        location: index === 0 ? "恒温恒湿间（暂存间）" : "盐雾试验室",
        status: index === 0 ? "已入库" : "实验进行中",
        trays: [{ tray_code: `LOW-TP-${String(index + 1).padStart(3, "0")}`, status: index === 0 ? "已入库" : "实验进行中", quantity: 1 }],
      })),
    };
    const wrapper = mountPage();

    await Promise.resolve();
    await wrapper.vm.$nextTick();
    await wrapper.findAll('[data-testid="visual-screen-card"]')[5].trigger("click");

    const trayCapacityCard = wrapper.find('[data-testid="visual-single-preview"]').findAll('[data-testid="visual-staging-capacity-card"]')[0];
    expect(trayCapacityCard.text()).toContain("托盘剩余1");
    expect(trayCapacityCard.findAll(".visual-staging-capacity-tick.is-active")).toHaveLength(1);
    expect(trayCapacityCard.get('[data-testid="visual-staging-capacity-alert"]').text()).toContain("!");
    expect(trayCapacityCard.text()).toContain("托盘库存不足");
  });

  test("applies low-stock segmented warnings to salt spray and mold remaining metrics", async () => {
    const saltTrays = Array.from({ length: 90 }, (_, index) => `SALT-LOW-${String(index + 1).padStart(3, "0")}`);
    const moldTrays = Array.from({ length: 90 }, (_, index) => `MOLD-LOW-${String(index + 1).padStart(3, "0")}`);

    snapshotState.snapshot = {
      "mes.tasks": [
        { code: "TASK-SALT-LOW", name: "盐雾低余量任务", test_type: "盐雾试验" },
        { code: "TASK-MOLD-LOW", name: "霉菌低余量任务", test_type: "霉菌试验" },
      ],
      "mes.experiments": [
        { task_code: "TASK-SALT-LOW", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" },
        { task_code: "TASK-MOLD-LOW", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
      ],
      "mes.experiment_trays": [
        ...saltTrays.map((tray_code) => ({ task_code: "TASK-SALT-LOW", experiment_code: "EXP-SALT", tray_code })),
        ...moldTrays.map((tray_code) => ({ task_code: "TASK-MOLD-LOW", experiment_code: "EXP-MOLD", tray_code })),
      ],
      "mes.staging_events": [
        ...saltTrays.map((tray_code) => ({ tray_code, task_code: "TASK-SALT-LOW", action: "stock_in", time: "2026-05-28T08:00:00+08:00" })),
        ...moldTrays.map((tray_code) => ({ tray_code, task_code: "TASK-MOLD-LOW", action: "stock_in", time: "2026-05-28T08:00:00+08:00" })),
      ],
      "mes.samples": [
        ...saltTrays.map((tray_code, index) => ({
          code: `SALT-LOW-SAMPLE-${String(index + 1).padStart(3, "0")}`,
          task_code: "TASK-SALT-LOW",
          location: "恒温恒湿间（暂存间）",
          status: "已入库",
          trays: [{ tray_code, status: "已入库", quantity: 1 }],
        })),
        ...moldTrays.map((tray_code, index) => ({
          code: `MOLD-LOW-SAMPLE-${String(index + 1).padStart(3, "0")}`,
          task_code: "TASK-MOLD-LOW",
          location: "恒温恒湿间（暂存间）",
          status: "已入库",
          trays: [{ tray_code, status: "已入库", quantity: 1 }],
        })),
      ],
    };
    const wrapper = mountPage();

    await Promise.resolve();
    await wrapper.vm.$nextTick();
    await wrapper.findAll('[data-testid="visual-screen-card"]')[5].trigger("click");

    const capacityCards = wrapper.find('[data-testid="visual-single-preview"]').findAll('[data-testid="visual-staging-capacity-card"]');
    const saltCapacityCard = capacityCards[1];
    const moldCapacityCard = capacityCards[2];

    expect(saltCapacityCard.text()).toContain("盐雾剩余10");
    expect(saltCapacityCard.findAll(".visual-staging-capacity-tick")).toHaveLength(10);
    expect(saltCapacityCard.findAll(".visual-staging-capacity-tick.is-active")).toHaveLength(1);
    expect(saltCapacityCard.get('[data-testid="visual-staging-capacity-alert"]').text()).toContain("!");
    expect(saltCapacityCard.text()).toContain("已用盐量 90");
    expect(saltCapacityCard.text()).toContain("盐量库存不足");
    expect(saltCapacityCard.text()).not.toContain("盐雾托盘");

    expect(moldCapacityCard.text()).toContain("霉菌剩余10");
    expect(moldCapacityCard.findAll(".visual-staging-capacity-tick")).toHaveLength(10);
    expect(moldCapacityCard.findAll(".visual-staging-capacity-tick.is-active")).toHaveLength(1);
    expect(moldCapacityCard.get('[data-testid="visual-staging-capacity-alert"]').text()).toContain("!");
    expect(moldCapacityCard.text()).toContain("已用菌体 90");
    expect(moldCapacityCard.text()).toContain("菌体库存不足");
    expect(moldCapacityCard.text()).not.toContain("霉菌托盘");
  });

  test("renders the eighth screen as a full laboratory analysis board with single-row custom time filters", async () => {
    const wrapper = mountPage();
    await Promise.resolve();
    await wrapper.vm.$nextTick();
    const eighthCard = wrapper.findAll('[data-testid="visual-screen-card"]')[7];

    expect(eighthCard.text()).toContain("设备状态与产品统计屏");
    expect(eighthCard.text()).toContain("今日");
    expect(eighthCard.text()).toContain("本周");
    expect(eighthCard.text()).toContain("本月");
    expect(eighthCard.text()).toContain("年初至今");
    expect(eighthCard.text()).toContain("自定义");
    expect(eighthCard.find('[data-testid="visual-analysis-filter-row"]').exists()).toBe(true);
    expect(eighthCard.findAll('[data-testid="visual-analysis-custom-mode"]')).toHaveLength(0);
    [
      "振动一室",
      "高低温湿热一室",
      "高低温湿热二室",
      "盐雾试验室",
      "冲击一室",
      "霉菌试验室",
      "四综合实验室",
      "冲击二室",
      "温度冲击二室",
      "温度冲击一室",
      "振动二室",
    ].forEach((labName) => {
      expect(eighthCard.text()).toContain(labName);
    });
    expect(eighthCard.text()).toContain("试验间");
    expect(eighthCard.text()).toContain("11");

    await eighthCard.trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    expect(preview.find(".visual-analysis-board").exists()).toBe(true);
    expect(preview.text()).toContain("年初至今 · 2026-01-01 至 2026-05-28");
    expect(preview.findAll('[data-testid="visual-analysis-filter-row"] .visual-analysis-time-chip')).toHaveLength(5);

    await preview.get('[data-testid="visual-analysis-custom-trigger"]').trigger("click");

    const menu = preview.get('[data-testid="visual-analysis-custom-menu"]');
    expect(menu.text()).toContain("按天");
    expect(menu.text()).toContain("按月");
    expect(menu.text()).toContain("按年");
    expect(menu.text()).toContain("时间段");
    expect(menu.findAll('[data-testid="visual-analysis-custom-mode"]')).toHaveLength(4);
  });

  test("updates the eighth screen analysis data when time filters and custom modes are selected", async () => {
    const wrapper = mountPage();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[7].trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    expect(preview.text()).toContain("年初至今 · 2026-01-01 至 2026-05-28");
    expect(preview.get(".visual-analysis-pie-total").text()).toBe("487");

    const monthButton = preview.findAll(".visual-analysis-time-chip").find((button) => button.text() === "本月");
    expect(monthButton).toBeTruthy();
    await monthButton.trigger("click");

    expect(preview.text()).toContain("本月 · 2026-05-01 至 2026-05-28");
    expect(preview.get(".visual-analysis-pie-total").text()).toBe("331");
    expect(monthButton.classes()).toContain("is-active");

    await preview.get('[data-testid="visual-analysis-custom-trigger"]').trigger("click");
    const customMonth = preview.findAll('[data-testid="visual-analysis-custom-mode"]').find((row) => row.text().includes("按月"));
    expect(customMonth).toBeTruthy();
    await customMonth.trigger("click");

    expect(preview.text()).toContain("自定义 · 按月 · 2026-05");
    expect(preview.get(".visual-analysis-pie-total").text()).toBe("331");
    expect(preview.get('[data-testid="visual-analysis-custom-trigger"]').classes()).toContain("is-active");
  });

  test("uses vivid diverse pie colors and matching custom filter button styling on the eighth screen", async () => {
    const wrapper = mountPage();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[7].trigger("click");

    const preview = wrapper.find('[data-testid="visual-single-preview"]');
    const customTrigger = preview.get('[data-testid="visual-analysis-custom-trigger"]');
    const regularButton = preview.findAll(".visual-analysis-time-chip").find((button) => button.text() === "本月");
    const sliceColors = preview.findAll(".visual-analysis-pie-slice").map((slice) => slice.attributes("fill"));

    expect(customTrigger.classes()).toContain("visual-analysis-time-chip");
    expect(customTrigger.classes()).not.toContain("is-subtle");
    expect(customTrigger.classes().filter((className) => className.startsWith("is-"))).toEqual(regularButton.classes().filter((className) => className.startsWith("is-")));
    expect(new Set(sliceColors).size).toBeGreaterThanOrEqual(10);
    expect(sliceColors).toEqual(expect.arrayContaining(["#f97316", "#ef4444", "#a855f7", "#eab308"]));
  });

  test("opens calendar-only custom date controls without manual typing on the eighth screen", async () => {
    const wrapper = mountPage();

    await wrapper.findAll('[data-testid="visual-screen-card"]')[7].trigger("click");
    const preview = wrapper.find('[data-testid="visual-single-preview"]');

    await preview.get('[data-testid="visual-analysis-custom-trigger"]').trigger("click");

    const menu = preview.get('[data-testid="visual-analysis-custom-menu"]');
    expect(menu.findAll("input")).toHaveLength(0);
    expect(preview.get('[data-testid="visual-analysis-day-picker"]').classes()).toContain("is-calendar");
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').classes()).toContain("visual-analysis-calendar-wheel-panel");
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').findAll(".visual-analysis-calendar-wheel")).toHaveLength(3);
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').text()).toContain("2026");
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').text()).toContain("5月");
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').text()).toContain("28日");
    expect(preview.find('[data-testid="visual-analysis-day-grid"]').exists()).toBe(false);
    expect(preview.get('[data-testid="visual-analysis-calendar-date-wheel"]').findAll(".visual-analysis-calendar-arrow")).toHaveLength(6);
    await preview.get('[data-testid="visual-analysis-calendar-day-up"]').trigger("click");
    expect(preview.text()).toContain("自定义 · 按天 · 2026-05-27");
    await preview.get('[data-testid="visual-analysis-calendar-day-down"]').trigger("click");
    expect(preview.text()).toContain("自定义 · 按天 · 2026-05-28");

    const wheelDayUp = async () => {
      await preview
        .get('[data-testid="visual-analysis-calendar-day-wheel"]')
        .get(".visual-analysis-calendar-wheel-options")
        .trigger("wheel", { deltaY: -120 });
    };
    await wheelDayUp();
    expect(preview.text()).toContain("自定义 · 按天 · 2026-05-28");
    await wheelDayUp();
    expect(preview.text()).toContain("自定义 · 按天 · 2026-05-27");

    for (let index = 0; index < 2; index += 1) {
      await preview.get('[data-testid="visual-analysis-calendar-year-wheel"]').trigger("wheel", { deltaY: 120 });
    }
    for (let index = 0; index < 4; index += 1) {
      await preview.get('[data-testid="visual-analysis-calendar-month-wheel"]').trigger("wheel", { deltaY: -120 });
    }
    for (let index = 0; index < 24; index += 1) {
      await preview.get('[data-testid="visual-analysis-calendar-day-wheel"]').trigger("wheel", { deltaY: -120 });
    }
    expect(preview.text()).toContain("自定义 · 按天 · 2027-03-15");

    const customMonth = preview.findAll('[data-testid="visual-analysis-custom-mode"]').find((row) => row.text().includes("按月"));
    await customMonth.trigger("click");
    expect(preview.find('[data-testid="visual-analysis-day-grid"]').exists()).toBe(false);
    const monthGrid = preview.get('[data-testid="visual-analysis-month-grid"]');
    expect(monthGrid.findAll("button").map((button) => button.text())).toEqual(expect.arrayContaining(["1月", "5月", "12月"]));

    const customYear = preview.findAll('[data-testid="visual-analysis-custom-mode"]').find((row) => row.text().includes("按年"));
    await customYear.trigger("click");
    expect(preview.find('[data-testid="visual-analysis-month-grid"]').exists()).toBe(false);
    const yearGrid = preview.get('[data-testid="visual-analysis-year-grid"]');
    expect(yearGrid.findAll("button").map((button) => button.text())).toEqual(expect.arrayContaining(["2024", "2025", "2026", "2027"]));

    const customRange = preview.findAll('[data-testid="visual-analysis-custom-mode"]').find((row) => row.text().includes("时间段"));
    await customRange.trigger("click");
    expect(preview.get('[data-testid="visual-analysis-range-grid"]').classes()).toContain("is-range");
    expect(preview.findAll('[data-testid="visual-analysis-calendar-range"]')).toHaveLength(4);
    expect(preview.get('[data-testid="visual-analysis-range-grid"]').get('[data-testid="visual-analysis-calendar-date-wheel"]').findAll(".visual-analysis-calendar-wheel")).toHaveLength(3);

    await preview.get('[data-testid="visual-analysis-calendar-range"]').trigger("click");
    for (let index = 0; index < 2; index += 1) {
      await preview.get('[data-testid="visual-analysis-range-grid"]').get('[data-testid="visual-analysis-calendar-year-wheel"]').trigger("wheel", { deltaY: -120 });
    }
    for (let index = 0; index < 6; index += 1) {
      await preview.get('[data-testid="visual-analysis-range-grid"]').get('[data-testid="visual-analysis-calendar-month-wheel"]').trigger("wheel", { deltaY: -120 });
    }
    expect(preview.get('[data-testid="visual-analysis-range-grid"]').get('[data-testid="visual-analysis-calendar-day-wheel"]').findAll(".visual-analysis-calendar-wheel-track button")).toHaveLength(28);

    for (let index = 0; index < 28; index += 1) {
      await preview.get('[data-testid="visual-analysis-range-grid"]').get('[data-testid="visual-analysis-calendar-day-wheel"]').trigger("wheel", { deltaY: 120 });
    }
    expect(preview.text()).toContain("自定义 · 时间段 · 2025-02-15 至 2026-05-28");
  });

  test("opens the eight-screen combined preview from the page action", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T10:00:00+08:00"));

    try {
      const wrapper = mountPage();

      await wrapper.get('[data-testid="visual-combined-preview-open"]').trigger("click");

      expect(wrapper.find('[data-testid="visual-combined-preview"]').exists()).toBe(true);
      expect(wrapper.get('[data-testid="visual-combined-shell"]').classes()).toContain("is-fullscreen-merge");
      expect(wrapper.get('[data-testid="visual-combined-shell"]').attributes("style") || "").toContain("--visual-combined-scale");
      expect(wrapper.get('[data-testid="visual-combined-preview-close"]').text()).toContain("关闭");
      expect(wrapper.findAll('[data-testid="visual-combined-screen"]')).toHaveLength(8);
      wrapper.findAll('[data-testid="visual-combined-screen"]').forEach((screen, index) => {
        const board = index === 3 ? screen.find(".visual-lab-matrix-screen") : screen.find(".visual-board");
        expect(board.exists()).toBe(true);
        expect(board.classes()).not.toContain("is-compact");
        expect(board.classes()).not.toContain("is-merge-preview");
        expect(screen.find('[data-testid="visual-combined-stage"]').exists()).toBe(true);
        expect(screen.find('[data-testid="visual-combined-stage-scale"]').exists()).toBe(true);
        expect(screen.find('[data-testid="visual-combined-stage-scale"]').attributes("style")).toContain("--visual-stage-width: 1920px");
        expect(screen.find('[data-testid="visual-combined-stage-scale"]').attributes("style")).toContain("--visual-stage-height: 1080px");
      });

      const secondCombinedScreen = wrapper.findAll('[data-testid="visual-combined-screen"]')[1];
      expect(secondCombinedScreen.findAll(".visual-schedule-lab-name").length).toBeGreaterThan(5);
      expect(wrapper.find('[data-testid="visual-lab-cycle-primary"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="visual-schedule-today"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="visual-schedule-prev"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="visual-schedule-next"]').exists()).toBe(true);
      await wrapper.get('[data-testid="visual-lab-cycle-primary"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-combined-lab-picker"]').exists()).toBe(true);
      await wrapper.get(".visual-lab-picker-close").trigger("click");
      await wrapper.get('[data-testid="visual-schedule-next"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-combined-preview"]').text()).toContain("5/26");

      const fifthCombinedScreen = wrapper.findAll('[data-testid="visual-combined-screen"]')[4];
      expect(fifthCombinedScreen.text()).toContain("LAB PROCESS");
      expect(fifthCombinedScreen.text()).toContain("实验室流程监控屏B组");
      expect(fifthCombinedScreen.findAll(".visual-lab-panel")).toHaveLength(2);
      expect(fifthCombinedScreen.text()).not.toContain("今日任务计划总览屏");

      await wrapper.get('[data-testid="visual-combined-preview-close"]').trigger("click");
      expect(wrapper.find('[data-testid="visual-combined-preview"]').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
