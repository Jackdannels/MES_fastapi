import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";

import ProcessPage from "./page.vue";

const mocks = vi.hoisted(() => ({
  activeFilter: null,
  allLabs: null,
  closeTaskDrawer: vi.fn(),
  openTaskOverview: vi.fn(),
  processActionMessage: null,
  createSelectedTaskDetail() {
    return {
      availableTasks: [
        {
          experimentName: "冲击试验",
          scheduleTime: "03/10 09:30 - 03/10 10:30",
          sampleCount: 12,
          status: "实验进行中",
          taskCode: "SYLU-2026-03-001",
          taskName: "冲击试验任务",
        },
        {
          experimentName: "冲击试验",
          scheduleTime: "03/11 09:30 - 03/11 10:30",
          sampleCount: 8,
          status: "已排程",
          taskCode: "SYLU-2026-03-002",
          taskName: "冲击试验任务二",
        },
      ],
      canStartExperiment: false,
      code: "SYLU-2026-03-001",
      completedTrayRows: [],
      displayName: "冲击试验任务",
      labName: "冲击一室",
      name: "冲击试验任务 批次A",
      readyTrayCount: 1,
      remainingTrayCount: 2,
      remainingTrayRows: [
        {
          flowStatus: "实验准备就绪",
          locationSummary: "冲击一室",
          ownerSummary: "王五",
          sampleCodes: ["SP-003", "SP-004"],
          sampleCount: 2,
          sampleSummary: "SP-003、SP-004",
          status: "实验准备就绪",
          trayCode: "TRAY-003",
        },
        {
          flowStatus: "已到达实验室",
          locationSummary: "冲击一室",
          ownerSummary: "赵六",
          sampleCodes: ["SP-005"],
          sampleCount: 1,
          sampleSummary: "SP-005",
          status: "已到达实验室",
          trayCode: "TRAY-004",
        },
      ],
      runningTrayCount: 2,
      runningTrayRows: [
        {
          flowStatus: "实验进行中",
          locationSummary: "冲击一室",
          ownerSummary: "张三",
          sampleCodes: ["SP-001"],
          sampleCount: 1,
          sampleSummary: "SP-001",
          status: "实验进行中",
          trayCode: "TRAY-001",
        },
        {
          flowStatus: "实验进行中",
          locationSummary: "冲击一室",
          ownerSummary: "李四",
          sampleCodes: ["SP-002"],
          sampleCount: 1,
          sampleSummary: "SP-002",
          status: "实验进行中",
          trayCode: "TRAY-002",
        },
      ],
      scheduleTime: "03/10 09:30 - 03/10 10:30",
      selectedTrayCode: "TRAY-001",
      selectedTrayFlow: {
        currentStatus: "当前托盘：TRAY-001 | 当前状态：已到达实验室",
        steps: [
          { active: false, key: "in_transit", label: "样品运输中", reached: true },
          { active: false, key: "arrived", label: "到货", reached: true },
          { active: false, key: "sent_to_staging", label: "送至暂存间", reached: true },
          { active: false, key: "arrived_staging", label: "已到达暂存间", reached: true },
          { active: false, key: "sent_to_lab", label: "送至实验室", reached: true },
          { active: true, key: "arrived_lab", label: "已到达实验室", reached: false },
        ],
      },
      selectedTraySummary: {
        flowStatus: "已到达实验室",
        locationSummary: "冲击一室",
        ownerSummary: "张三",
        sampleCodes: ["SP-001"],
        sampleCount: 1,
        sampleSummary: "SP-001",
        status: "实验进行中",
        trayCode: "TRAY-001",
      },
      startDisabledReason: "当前批次实验未结束",
      status: "实验进行中",
      testType: "冲击试验",
      trayCodes: ["TRAY-001", "TRAY-002", "TRAY-003", "TRAY-004"],
      trayCount: 4,
      trayRows: [],
      traySummary: "TRAY-001, TRAY-002, TRAY-003 +1",
    };
  },
  reset() {
    if (mocks.activeFilter) {
      mocks.activeFilter.value = "overview";
    }
    mocks.closeTaskDrawer.mockClear();
    mocks.openTaskOverview.mockClear();
    mocks.selectTaskTray.mockClear();
    mocks.setSelectedTaskForLab.mockClear();
    if (mocks.selectedTaskDetail) {
      mocks.selectedTaskDetail.value = mocks.createSelectedTaskDetail();
    }
  },
  selectTaskTray: vi.fn(),
  selectedTaskDetail: null,
  setSelectedTaskForLab: vi.fn(),
  setActiveFilter(value) {
    if (mocks.activeFilter) {
      mocks.activeFilter.value = value;
    }
  },
  taskDrawerOpen: null,
  visibleLabCards: null,
}));

vi.mock("./useProcessLabs", async () => {
  const { computed, ref } = await import("vue");

  mocks.activeFilter = ref("overview");
  mocks.allLabs = ref([
    {
      canStartExperiment: true,
      hasTask: true,
      name: "冲击一室",
      readyTrayCount: 2,
      remainingTrayCount: 1,
      runningTrayCount: 1,
      scheduleTime: "03/10 09:30 - 03/10 10:30",
      startDisabledReason: "",
      status: "实验进行中",
      statusClass: "is-running",
      targetExperiment: "冲击试验",
      taskCode: "SYLU-2026-03-001",
      testType: "冲击试验",
    },
    {
      canStartExperiment: false,
      hasTask: false,
      name: "盐雾试验室",
      readyTrayCount: 0,
      remainingTrayCount: 0,
      runningTrayCount: 0,
      scheduleTime: "暂无排程",
      startDisabledReason: "当前无任务",
      status: "空闲",
      statusClass: "is-idle",
      targetExperiment: "未分配",
      taskCode: "-",
      testType: "盐雾试验",
    },
  ]);
  mocks.processActionMessage = ref("当前开始进行2个托盘，剩余1个托盘。");
  mocks.taskDrawerOpen = ref(true);
  mocks.visibleLabCards = computed(() => {
    if (mocks.activeFilter.value === "running") {
      return mocks.allLabs.value.filter((lab) => lab.statusClass === "is-running");
    }
    if (mocks.activeFilter.value === "scheduled") {
      return mocks.allLabs.value.filter((lab) => lab.statusClass === "is-running" || lab.statusClass === "is-scheduled");
    }
    if (mocks.activeFilter.value === "idle") {
      return mocks.allLabs.value.filter((lab) => lab.statusClass === "is-idle");
    }
    return mocks.allLabs.value;
  });

  mocks.selectedTaskDetail = ref(mocks.createSelectedTaskDetail());

  return {
    PROCESS_FILTERS: {
      idle: "idle",
      overview: "overview",
      running: "running",
      scheduled: "scheduled",
    },
    useProcessLabs: () => ({
      activeFilter: mocks.activeFilter,
      closeTaskDrawer: mocks.closeTaskDrawer,
      idleCount: computed(() => mocks.allLabs.value.filter((lab) => lab.statusClass === "is-idle").length),
      labCards: mocks.allLabs,
      loading: ref(false),
      openTaskOverview: mocks.openTaskOverview,
      overviewCount: computed(() => mocks.allLabs.value.length),
      processActionMessage: mocks.processActionMessage,
      runningCount: computed(() => mocks.allLabs.value.filter((lab) => lab.statusClass === "is-running").length),
      scheduledCount: computed(
        () => mocks.allLabs.value.filter((lab) => lab.statusClass === "is-running" || lab.statusClass === "is-scheduled").length
      ),
      selectedTaskDetail: mocks.selectedTaskDetail,
      selectTaskTray: mocks.selectTaskTray,
      setSelectedTaskForLab: mocks.setSelectedTaskForLab,
      setActiveFilter: mocks.setActiveFilter,
      taskDrawerOpen: mocks.taskDrawerOpen,
      visibleLabCards: mocks.visibleLabCards,
    }),
  };
});

describe("ProcessPage runtime", () => {
  test("renders overview filter cards without manual start action and keeps a right-side tray flow column inside the task drawer", async () => {
    mocks.reset();
    const wrapper = mount(ProcessPage);

    expect(wrapper.text()).toContain("试验过程管控");
    expect(wrapper.text()).toContain("总览");
    expect(wrapper.text()).toContain("实验进行中");
    expect(wrapper.text()).toContain("已排程");
    expect(wrapper.text()).toContain("空闲");
    expect(wrapper.findAll(".process-control-summary-item")).toHaveLength(4);
    expect(wrapper.find(".process-control-summary-item.is-active").text()).toContain("总览");
    expect(wrapper.text()).toContain("冲击一室");
    expect(wrapper.text()).toContain("盐雾试验室");
    expect(wrapper.text()).toContain("当前开始进行2个托盘，剩余1个托盘。");
    expect(wrapper.find("[data-testid='process-start-button-冲击一室']").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("开始实验确认");

    await wrapper.get("button.action-btn.secondary").trigger("click");

    expect(mocks.openTaskOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "冲击一室",
        taskCode: "SYLU-2026-03-001",
      })
    );
    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.find(".process-task-modal-content").exists()).toBe(true);
    expect(wrapper.find(".process-task-detail-grid").exists()).toBe(true);
    expect(wrapper.find(".process-task-overview-panel").exists()).toBe(true);
    expect(wrapper.find(".process-task-tray-panel").exists()).toBe(true);
    expect(wrapper.find(".process-task-flow-card").exists()).toBe(true);
    expect(wrapper.text()).toContain("任务摘要");
    expect(wrapper.text()).toContain("试验任务详情");
    expect(wrapper.text()).toContain("SYLU-2026-03-001");
    expect(wrapper.text()).toContain("冲击试验任务");
    expect(wrapper.text()).not.toContain("批次A");
    expect(wrapper.get(".process-task-code-headline").text()).toBe("SYLU-2026-03-001");
    expect(wrapper.get(".process-task-name-subtitle").text()).toBe("冲击试验任务");
    expect(wrapper.text()).toContain("4");
    expect(wrapper.text()).not.toContain("托盘摘要");
    expect(wrapper.findAll(".process-task-tray-chip")).toHaveLength(4);
    expect(wrapper.get(".process-task-tray-chip-list").classes()).toContain("is-single-column");
    expect(wrapper.get(".process-task-tray-chip-list").classes()).toContain("is-dense");
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-001']").classes()).toContain("process-task-tray-chip-emphasis");
    expect(wrapper.find("[data-testid='process-selected-tray-summary']").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("当前实验托盘");
    expect(wrapper.text()).not.toContain("待下一轮托盘");
    expect(wrapper.text()).toContain("统一托盘流程图");
    expect(wrapper.text()).toContain("样品编号");
    expect(wrapper.text()).not.toContain("补充信息");
    expect(wrapper.text()).toContain("TRAY-001");
    expect(wrapper.text()).toContain("TRAY-003");
    const trayFlowCard = wrapper.get("[data-testid='process-tray-flow-card']").text();
    expect(trayFlowCard).toContain("统一托盘流程图");
    expect(trayFlowCard).not.toContain("当前托盘");
    expect(trayFlowCard).not.toContain("当前位置");
    expect(trayFlowCard).not.toContain("责任人");
    expect(trayFlowCard).not.toContain("样品：");
    expect(wrapper.get("[data-testid='process-selected-tray-sample-list']").text()).toContain("SP-001");
    expect(wrapper.findAll("[data-testid^='process-selected-tray-sample-item-']")).toHaveLength(1);
    const sampleCodeCard = wrapper.get("[data-testid='process-sample-code-card']");
    expect(sampleCodeCard.text()).toContain("样品编号");
    expect(sampleCodeCard.text()).not.toContain("待下一轮托盘");
    expect(sampleCodeCard.element.parentElement.classList.contains("process-task-detail-grid")).toBe(true);
    expect(wrapper.get(".process-task-overview-panel").find("[data-testid='process-selected-tray-sample-list']").exists()).toBe(false);
    expect(wrapper.get(".process-task-overview-panel").text()).not.toContain("实验概览");
    expect(wrapper.get(".process-task-overview-panel").text()).not.toContain("试验类型");
    expect(wrapper.get(".process-task-overview-panel").text()).not.toContain("实验室");
    expect(wrapper.get(".process-task-overview-panel").text()).toContain("排程时间");
    expect(wrapper.get(".process-task-overview-panel").text()).toContain("样品数量");
    expect(wrapper.get(".process-task-overview-panel").text()).toContain("托盘数量");
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-001']").classes()).toContain("is-selected");
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-001']").classes()).toContain("is-current-experiment");
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-001']").text()).toContain("当前实验");
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-002']").classes()).toContain("is-current-experiment");
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-003']").classes()).not.toContain("is-current-experiment");
    expect(wrapper.find(".process-task-tray-row").exists()).toBe(false);

    await wrapper.get("[data-testid='process-tray-chip-TRAY-002']").trigger("click");

    expect(mocks.selectTaskTray).toHaveBeenCalledWith("TRAY-002");
  });

  test("removes waiting tray content while keeping the sample number card independent of waiting tray data", () => {
    mocks.reset();
    const detail = mocks.createSelectedTaskDetail();
    detail.remainingTrayCount = 3;
    detail.remainingTrayRows = [
      ...detail.remainingTrayRows,
      {
        sampleCodes: ["SP-006"],
        status: "已到达实验室",
        trayCode: "TRAY-005",
      },
    ];
    mocks.selectedTaskDetail.value = detail;

    const wrapper = mount(ProcessPage);

    expect(wrapper.get("[data-testid='process-sample-code-card']").text()).toContain("SP-001");
    expect(wrapper.text()).not.toContain("待下一轮托盘");
    expect(wrapper.find("[data-testid='process-remaining-tray-grid']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='process-remaining-tray-count']").exists()).toBe(false);
  });

  test("switches visible labs by summary filter, disables idle task actions, and supports tray selection", async () => {
    mocks.reset();
    const wrapper = mount(ProcessPage);

    expect(wrapper.find("[data-testid='process-start-button-冲击一室']").exists()).toBe(false);

    await wrapper.get("[data-testid='process-tray-chip-TRAY-003']").trigger("click");

    expect(mocks.selectTaskTray).toHaveBeenCalledWith("TRAY-003");

    const filterButtons = wrapper.findAll(".process-control-summary-item");
    await filterButtons[1].trigger("click");

    expect(wrapper.findAll(".process-lab-card")).toHaveLength(1);
    expect(wrapper.get(".process-lab-name").text()).toBe("冲击一室");

    await filterButtons[3].trigger("click");

    expect(wrapper.findAll(".process-lab-card")).toHaveLength(1);
    expect(wrapper.get(".process-lab-name").text()).toBe("盐雾试验室");
    expect(wrapper.get("[data-testid='process-task-button-盐雾试验室']").attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-testid='process-start-button-盐雾试验室']").exists()).toBe(false);
  });

  test("shows all trays and samples inside the fixed scrollable cards", () => {
    mocks.reset();
    const trayRows = Array.from({ length: 8 }, (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return {
        flowStatus: index < 4 ? "实验进行中" : "实验准备就绪",
        locationSummary: "冲击一室",
        ownerSummary: "王五",
        sampleCodes: [`SP-${number}-A`, `SP-${number}-B`],
        sampleCount: 2,
        sampleSummary: `SP-${number}-A、SP-${number}-B`,
        status: index < 4 ? "实验进行中" : "实验准备就绪",
        trayCode: `TRAY-${number}`,
      };
    });
    mocks.selectedTaskDetail.value = {
      ...mocks.createSelectedTaskDetail(),
      remainingTrayRows: trayRows.slice(4),
      runningTrayRows: trayRows.slice(0, 4),
      selectedTraySummary: {
        ...mocks.createSelectedTaskDetail().selectedTraySummary,
        sampleCodes: Array.from({ length: 16 }, (_, index) => `SP-LONG-${index + 1}`),
        sampleSummary: "SP-LONG-1、SP-LONG-2、SP-LONG-3、SP-LONG-4、SP-LONG-5、SP-LONG-6、SP-LONG-7、SP-LONG-8、SP-LONG-9 +7",
      },
      trayCodes: trayRows.map((row) => row.trayCode),
      trayCount: trayRows.length,
      trayRows,
    };

    const wrapper = mount(ProcessPage);

    expect(wrapper.findAll(".process-task-tray-chip")).toHaveLength(8);
    expect(wrapper.find("[data-testid='process-tray-chip-TRAY-008']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='process-show-all-trays-count']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='process-show-all-trays']").exists()).toBe(false);
    expect(wrapper.findAll("[data-testid^='process-selected-tray-sample-item-']")).toHaveLength(16);
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-001']").classes()).toContain("is-current-experiment");
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-004']").classes()).toContain("is-current-experiment");
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-005']").classes()).not.toContain("is-current-experiment");
    const sampleCard = wrapper.get("[data-testid='process-sample-code-card']");
    expect(sampleCard.text()).toContain("SP-LONG-9");
    expect(sampleCard.text()).toContain("SP-LONG-10");
    expect(sampleCard.text()).toContain("SP-LONG-16");
    expect(sampleCard.text()).not.toContain("+7");
    expect(sampleCard.text()).not.toContain("查看全部");
    expect(sampleCard.find("[data-testid='process-show-all-samples']").exists()).toBe(false);
  });

  test("renders every tray in the scrollable overview without overflow controls", () => {
    mocks.reset();
    const trayRows = Array.from({ length: 6 }, (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return {
        sampleCodes: [`SP-${number}`],
        status: "实验准备就绪",
        trayCode: `TRAY-${number}`,
      };
    });
    mocks.selectedTaskDetail.value = {
      ...mocks.createSelectedTaskDetail(),
      trayCodes: trayRows.map((row) => row.trayCode),
      trayCount: trayRows.length,
      trayRows,
    };

    const wrapper = mount(ProcessPage);

    expect(wrapper.findAll(".process-task-tray-chip")).toHaveLength(6);
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-006']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='process-show-all-trays-count']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='process-show-all-trays']").exists()).toBe(false);
  });

  test("supports selecting the current lab task from a selector modal without a manual start modal", async () => {
    mocks.reset();
    const wrapper = mount(ProcessPage);

    const switchEntry = wrapper.get("[data-testid='process-open-task-selector']");
    expect(switchEntry.text()).toContain("任务切换");
    expect(switchEntry.text()).toContain("当前任务");
    expect(switchEntry.text()).toContain("SYLU-2026-03-001");
    expect(switchEntry.text()).toContain("冲击试验");
    expect(wrapper.find("[data-testid='process-start-button-冲击一室']").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("开始实验确认");
    expect(wrapper.find("#process-start-modal").exists()).toBe(false);

    await switchEntry.trigger("click");

    const selectionModal = wrapper.get('[data-testid="process-task-selection-modal"].is-open');
    expect(selectionModal.text()).toContain("任务切换");
    expect(selectionModal.text()).toContain("选择任务后，详情内容将同步切换");
    expect(selectionModal.text()).not.toContain("任务选择");
    const currentOption = wrapper.get("[data-testid='process-select-task-SYLU-2026-03-001']");
    expect(currentOption.attributes("aria-current")).toBe("true");
    expect(currentOption.text()).toContain("当前任务");
    expect(currentOption.text()).toContain("冲击试验任务");
    expect(currentOption.text()).toContain("实验进行中");
    expect(currentOption.text()).toContain("样品 12 个");

    await wrapper.get("[data-testid='process-select-task-SYLU-2026-03-002']").trigger("click");

    expect(mocks.setSelectedTaskForLab).toHaveBeenCalledWith("冲击一室", "SYLU-2026-03-002");
    expect(wrapper.find('[data-testid="process-task-selection-modal"].is-open').exists()).toBe(false);
  });
});
