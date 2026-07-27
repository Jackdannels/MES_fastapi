import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { beforeEach, describe, expect, test, vi } from "vitest";

import DataPage from "./page.vue";

const saveSettingsMock = vi.fn();
const retryFailedMock = vi.fn();
const retryAllFailedMock = vi.fn();
const browseDirectoryMock = vi.fn();
const openExperimentFolderMock = vi.fn();
const openTaskFolderMock = vi.fn();
const copyExperimentUrlMock = vi.fn();
const copyTaskUrlMock = vi.fn();
const searchTaskOutputsMock = vi.fn();
const savePath = ref("C:\\Users\\tester\\Desktop\\MES试验数据");
const failedExports = ref([]);
const taskOutputs = ref([]);
const expandedTaskCode = ref("");
const tasksLoading = ref(false);
const tasksTotal = ref(0);
const toggleTaskExpansionMock = vi.fn((taskCode) => {
  expandedTaskCode.value = expandedTaskCode.value === taskCode ? "" : taskCode;
});
const handleTaskClickMock = vi.fn((taskCode) => {
  if (expandedTaskCode.value === taskCode) {
    expandedTaskCode.value = "";
  }
});

vi.mock("./useDataPage", () => ({
  useDataPage: () => ({
    browseDirectory: browseDirectoryMock,
    copyExperimentUrl: copyExperimentUrlMock,
    copyTaskUrl: copyTaskUrlMock,
    defaultPath: ref("C:\\Users\\tester\\Desktop\\MES试验数据"),
    directorySelecting: ref(false),
    expandedTaskCode,
    exportsError: ref(""),
    exportsLoading: ref(false),
    failedCount: computed(() => failedExports.value.length),
    failedExports,
    goToTaskPage: vi.fn(),
    handleTaskClick: handleTaskClickMock,
    handleTaskDoubleClick: toggleTaskExpansionMock,
    isOpeningExperiment: () => false,
    isOpeningTask: () => false,
    isRetrying: () => false,
    isSharingExperiment: () => false,
    isSharingTask: () => false,
    isTaskExpanded: (taskCode) => expandedTaskCode.value === taskCode,
    openExperimentFolder: openExperimentFolderMock,
    openTaskFolder: openTaskFolderMock,
    pathStatusClass: computed(() => ({ "is-writable": true })),
    pathStatusLabel: ref("目录可写"),
    retryAllFailed: retryAllFailedMock,
    retryFailed: retryFailedMock,
    retryingAll: ref(false),
    savePath,
    saveSettings: saveSettingsMock,
    searchTaskOutputs: searchTaskOutputsMock,
    shareFallbackUrl: ref(""),
    settingsError: ref(""),
    settingsLoading: ref(false),
    settingsSaving: ref(false),
    settingsSuccess: ref(""),
    taskActionError: ref(""),
    taskActionSuccess: ref(""),
    taskOutputs,
    tasksError: ref(""),
    tasksLoading,
    tasksPage: ref(1),
    tasksPageCount: ref(1),
    tasksQuery: ref(""),
    tasksTotal,
    toggleTaskExpansion: toggleTaskExpansionMock,
  }),
}));

describe("DataPage runtime", () => {
  beforeEach(() => {
    failedExports.value = [];
    taskOutputs.value = [];
    expandedTaskCode.value = "";
    tasksLoading.value = false;
    tasksTotal.value = 0;
    savePath.value = "C:\\Users\\tester\\Desktop\\MES试验数据";
    vi.clearAllMocks();
  });

  test("renders the save directory and delegates save-and-check", async () => {
    const wrapper = mount(DataPage);

    expect(wrapper.text()).toContain("试验数据保存设置");
    expect(wrapper.get('[data-testid="data-save-path"]').element.value).toBe("C:\\Users\\tester\\Desktop\\MES试验数据");
    expect(wrapper.get('[data-testid="data-path-status"]').text()).toContain("目录可写");
    expect(wrapper.text()).not.toContain("采集监控");
    expect(wrapper.text()).not.toContain("数据校验与报告");

    await wrapper.get("form").trigger("submit");
    expect(saveSettingsMock).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-testid="data-browse-directory"]').trigger("click");
    expect(browseDirectoryMock).toHaveBeenCalledTimes(1);
  });

  test("keeps task actions visible while experiment details require a double-click", async () => {
    taskOutputs.value = [{
      taskCode: "TASK-001",
      totalExperimentCount: 4,
      completedExperimentCount: 2,
      progressPercent: 50,
      successfulPdfCount: 8,
      missingPdfCount: 1,
      failedPdfCount: 0,
      canOpen: true,
      canShare: true,
      experiments: [{
        experimentCode: "VIBRATION",
        experimentName: "振动试验",
        status: "completed",
        pdfCount: 8,
        successfulPdfCount: 8,
        missingPdfCount: 0,
        failedPdfCount: 0,
        canOpen: true,
        canShare: true,
      }],
    }];
    const wrapper = mount(DataPage);

    const toggle = wrapper.get('[data-testid="data-task-toggle-TASK-001"]');
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.text()).not.toContain("试验完成 2/4");
    expect(wrapper.text()).not.toContain("振动试验");
    expect(wrapper.find('[data-testid="data-open-TASK-001-VIBRATION"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="data-task-open-TASK-001"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="data-task-url-TASK-001"]').exists()).toBe(true);

    await wrapper.get('[data-testid="data-task-open-TASK-001"]').trigger("click");
    await wrapper.get('[data-testid="data-task-url-TASK-001"]').trigger("click");
    expect(openTaskFolderMock).toHaveBeenCalledWith("TASK-001");
    expect(copyTaskUrlMock).toHaveBeenCalledWith("TASK-001");

    await toggle.trigger("click");
    expect(wrapper.text()).not.toContain("试验完成 2/4");

    await toggle.trigger("dblclick");
    expect(toggleTaskExpansionMock).toHaveBeenCalledWith("TASK-001");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.text()).toContain("试验完成 2/4");
    expect(wrapper.text()).toContain("50%");
    expect(wrapper.text()).toContain("8 成功");
    expect(wrapper.text()).toContain("振动试验");

    await toggle.trigger("click");
    expect(handleTaskClickMock).toHaveBeenCalledWith("TASK-001");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.text()).not.toContain("振动试验");

    await toggle.trigger("dblclick");

    await wrapper.get('[data-testid="data-open-TASK-001-VIBRATION"]').trigger("click");
    await wrapper.get('[data-testid="data-url-TASK-001-VIBRATION"]').trigger("click");
    expect(openExperimentFolderMock).toHaveBeenCalledWith("TASK-001", "VIBRATION");
    expect(copyExperimentUrlMock).toHaveBeenCalledWith("TASK-001", "VIBRATION");

    await toggle.trigger("keydown", { key: "Enter" });
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.text()).not.toContain("振动试验");
  });

  test("keeps task rows and pagination mounted while another page is loading", async () => {
    taskOutputs.value = [{
      taskCode: "TASK-001",
      canOpen: true,
      canShare: true,
      experiments: [],
    }];
    tasksTotal.value = 10;
    const wrapper = mount(DataPage);

    tasksLoading.value = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="data-task-list"]').text()).toContain("TASK-001");
    expect(wrapper.get('[data-testid="data-tasks-refreshing"]').text()).toContain("正在读取任务数据");
    expect(wrapper.get('[aria-label="任务数据分页"]').exists()).toBe(true);
  });

  test("shows failed exports and delegates individual and bulk retries", async () => {
    failedExports.value = [{
      axisCode: "X+",
      endedAt: "2026-07-27T10:00:00",
      error: "目录无写入权限",
      experimentCode: "VIBRATION",
      experimentName: "振动试验",
      exportKey: "run-1:X+:SP-001",
      sampleCode: "SP-001",
      startedAt: "2026-07-27T09:40:00",
      taskCode: "SYLU-2026-07-029",
    }];
    const wrapper = mount(DataPage);

    expect(wrapper.text()).toContain("SYLU-2026-07-029");
    expect(wrapper.text()).toContain("SP-001");
    expect(wrapper.text()).toContain("X+轴向");
    expect(wrapper.text()).toContain("目录无写入权限");

    await wrapper.get('[data-testid="data-retry-run-1:X+:SP-001"]').trigger("click");
    await wrapper.get('[data-testid="data-retry-all"]').trigger("click");

    expect(retryFailedMock).toHaveBeenCalledWith("run-1:X+:SP-001");
    expect(retryAllFailedMock).toHaveBeenCalledTimes(1);
  });
});
