import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";

import ProcessPage from "./page.vue";

const mocks = vi.hoisted(() => ({
  activeFilter: null,
  allLabs: null,
  closeTaskDrawer: vi.fn(),
  openTaskOverview: vi.fn(),
  processActionMessage: null,
  reset() {
    if (mocks.activeFilter) {
      mocks.activeFilter.value = "overview";
    }
    mocks.closeTaskDrawer.mockClear();
    mocks.openTaskOverview.mockClear();
    mocks.selectTaskTray.mockClear();
    mocks.startExperiment.mockClear();
  },
  selectTaskTray: vi.fn(),
  setActiveFilter(value) {
    if (mocks.activeFilter) {
      mocks.activeFilter.value = value;
    }
  },
  startExperiment: vi.fn(),
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
      status: "实验中",
      statusClass: "is-running",
      targetExperiment: "冲击试验",
      taskCode: "CJ-2026-001",
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
      selectedTaskDetail: ref({
        canStartExperiment: false,
        code: "CJ-2026-001",
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
        status: "实验中",
        testType: "冲击试验",
        trayCodes: ["TRAY-001", "TRAY-002", "TRAY-003", "TRAY-004"],
        trayCount: 4,
        trayRows: [],
        traySummary: "TRAY-001, TRAY-002, TRAY-003 +1",
      }),
      selectTaskTray: mocks.selectTaskTray,
      setActiveFilter: mocks.setActiveFilter,
      startExperiment: mocks.startExperiment,
      taskDrawerOpen: mocks.taskDrawerOpen,
      visibleLabCards: mocks.visibleLabCards,
    }),
  };
});

describe("ProcessPage runtime", () => {
  test("renders overview filter cards, start action, and a right-side tray flow column inside the task drawer", async () => {
    mocks.reset();
    const wrapper = mount(ProcessPage);

    expect(wrapper.text()).toContain("试验过程管控");
    expect(wrapper.text()).toContain("总览");
    expect(wrapper.text()).toContain("实验中");
    expect(wrapper.text()).toContain("已排程");
    expect(wrapper.text()).toContain("空闲");
    expect(wrapper.findAll(".process-control-summary-item")).toHaveLength(4);
    expect(wrapper.find(".process-control-summary-item.is-active").text()).toContain("总览");
    expect(wrapper.text()).toContain("冲击一室");
    expect(wrapper.text()).toContain("盐雾试验室");
    expect(wrapper.text()).toContain("当前开始进行2个托盘，剩余1个托盘。");
    expect(wrapper.get("[data-testid='process-start-button-冲击一室']").attributes("disabled")).toBeUndefined();

    await wrapper.get("button.action-btn.secondary").trigger("click");

    expect(mocks.openTaskOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "冲击一室",
        taskCode: "CJ-2026-001",
      })
    );
    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.find(".process-task-modal-content").exists()).toBe(true);
    expect(wrapper.find(".process-task-drawer-layout").exists()).toBe(true);
    expect(wrapper.find(".process-task-drawer-main").exists()).toBe(true);
    expect(wrapper.find(".process-task-drawer-side").exists()).toBe(true);
    expect(wrapper.text()).toContain("任务摘要");
    expect(wrapper.text()).toContain("试验任务详情");
    expect(wrapper.text()).toContain("CJ-2026-001");
    expect(wrapper.text()).toContain("冲击试验任务");
    expect(wrapper.text()).not.toContain("批次A");
    expect(wrapper.get(".process-task-code-headline").text()).toBe("CJ-2026-001");
    expect(wrapper.get(".process-task-name-subtitle").text()).toBe("冲击试验任务");
    expect(wrapper.text()).toContain("4");
    expect(wrapper.text()).not.toContain("托盘摘要");
    expect(wrapper.findAll(".process-task-tray-chip")).toHaveLength(4);
    expect(wrapper.get(".process-task-tray-chip-list").classes()).toContain("is-single-column");
    expect(wrapper.get(".process-task-tray-chip-list").classes()).toContain("is-dense");
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-001']").classes()).toContain("process-task-tray-chip-emphasis");
    expect(wrapper.find("[data-testid='process-selected-tray-summary']").exists()).toBe(false);
    expect(wrapper.text()).toContain("当前实验托盘");
    expect(wrapper.text()).toContain("待下一轮托盘");
    expect(wrapper.text()).toContain("统一托盘流程图");
    expect(wrapper.text()).toContain("样品编号");
    expect(wrapper.text()).not.toContain("补充信息");
    expect(wrapper.text()).toContain("TRAY-001");
    expect(wrapper.text()).toContain("TRAY-003");
    expect(wrapper.text()).toContain("当前托盘：TRAY-001 | 当前状态：已到达实验室");
    expect(wrapper.get("[data-testid='process-selected-tray-sample-list']").text()).toContain("SP-001");
    expect(wrapper.findAll("[data-testid^='process-selected-tray-sample-item-']")).toHaveLength(1);
    expect(wrapper.get("[data-testid='process-tray-chip-TRAY-001']").classes()).toContain("is-selected");

    await wrapper.get("[data-testid='process-tray-chip-TRAY-002']").trigger("click");

    expect(mocks.selectTaskTray).toHaveBeenCalledWith("TRAY-002");
  });

  test("switches visible labs by summary filter, disables idle actions, and supports tray/start actions", async () => {
    mocks.reset();
    const wrapper = mount(ProcessPage);

    await wrapper.get("[data-testid='process-start-button-冲击一室']").trigger("click");

    expect(mocks.startExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "冲击一室",
        taskCode: "CJ-2026-001",
      })
    );

    await wrapper.get("[data-testid='process-tray-button-TRAY-003']").trigger("click");

    expect(mocks.selectTaskTray).toHaveBeenCalledWith("TRAY-003");

    const filterButtons = wrapper.findAll(".process-control-summary-item");
    await filterButtons[1].trigger("click");

    expect(wrapper.findAll(".process-lab-card")).toHaveLength(1);
    expect(wrapper.get(".process-lab-name").text()).toBe("冲击一室");

    await filterButtons[3].trigger("click");

    expect(wrapper.findAll(".process-lab-card")).toHaveLength(1);
    expect(wrapper.get(".process-lab-name").text()).toBe("盐雾试验室");
    expect(wrapper.get("[data-testid='process-task-button-盐雾试验室']").attributes("disabled")).toBeDefined();
    expect(wrapper.get("[data-testid='process-start-button-盐雾试验室']").attributes("disabled")).toBeDefined();
  });
});
