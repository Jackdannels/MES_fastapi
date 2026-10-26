import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { beforeEach, describe, expect, test, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  listFailedTestDataExports: vi.fn(),
  listTestDataTasks: vi.fn(),
  openTestDataExperimentFolder: vi.fn(),
  openTestDataTaskFolder: vi.fn(),
  readTestDataSettings: vi.fn(),
  retryFailedTestDataExports: vi.fn(),
  selectTestDataDirectory: vi.fn(),
  shareTestDataExperiment: vi.fn(),
  shareTestDataTask: vi.fn(),
  updateTestDataSettings: vi.fn(),
}));

vi.mock("@/lib/testDataApi", () => apiMocks);

import { useDataPage } from "./useDataPage";

const TestHarness = defineComponent({
  setup() {
    return useDataPage();
  },
  render() {
    return null;
  },
});

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
};

describe("useDataPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.readTestDataSettings.mockResolvedValue({
      defaultPath: "C:\\Desktop\\MES试验数据",
      detail: "目录可写",
      savePath: "D:\\MES",
      writable: true,
    });
    apiMocks.listFailedTestDataExports.mockResolvedValue({ items: [], failedCount: 0 });
    apiMocks.listTestDataTasks.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 });
    apiMocks.updateTestDataSettings.mockResolvedValue({
      defaultPath: "C:\\Desktop\\MES试验数据",
      detail: "目录可写",
      savePath: "E:\\Reports",
      writable: true,
    });
    apiMocks.retryFailedTestDataExports.mockResolvedValue({ ok: true });
    apiMocks.selectTestDataDirectory.mockResolvedValue({ savePath: "F:\\TrialData", cancelled: false });
    apiMocks.openTestDataExperimentFolder.mockResolvedValue({ ok: true });
    apiMocks.openTestDataTaskFolder.mockResolvedValue({ ok: true });
    apiMocks.shareTestDataExperiment.mockResolvedValue({ url: "http://192.168.1.10/api/test-data/share/token" });
    apiMocks.shareTestDataTask.mockResolvedValue({ url: "http://192.168.1.10/api/test-data/share/task-token" });
  });

  test("loads settings and saves a newly checked directory", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.savePath).toBe("D:\\MES");
    expect(wrapper.vm.pathStatusLabel).toBe("目录可写");

    wrapper.vm.savePath = " E:\\Reports ";
    await wrapper.vm.saveSettings();

    expect(apiMocks.updateTestDataSettings).toHaveBeenCalledWith("E:\\Reports");
    expect(wrapper.vm.savePath).toBe("E:\\Reports");
    expect(wrapper.vm.settingsSuccess).toBe("目录可写");
  });

  test("ties the writable badge to the checked path and keeps the saved path visible for a new draft", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);
    expect(wrapper.vm.activePath).toBe("D:\\MES");

    wrapper.vm.savePath = "E:\\Reports";
    await settle(wrapper);
    expect(wrapper.vm.pathIsDirty).toBe(true);
    expect(wrapper.vm.pathStatusLabel).toBe("未保存 · 待检测");
    expect(wrapper.vm.pathStatusClass["is-writable"]).toBe(false);
    expect(wrapper.vm.activePath).toBe("D:\\MES");
    expect(apiMocks.updateTestDataSettings).not.toHaveBeenCalled();

    wrapper.vm.savePath = " D:\\MES ";
    await settle(wrapper);
    expect(wrapper.vm.pathStatusLabel).toBe("目录可写");
    expect(wrapper.vm.pathIsDirty).toBe(false);
    wrapper.vm.savePath = "E:\\Reports";
    await wrapper.vm.saveSettings();
    expect(wrapper.vm.activePath).toBe("E:\\Reports");
    expect(wrapper.vm.pathIsDirty).toBe(false);
    expect(wrapper.vm.pathStatusClass["is-writable"]).toBe(true);
    wrapper.unmount();
  });

  test("does not carry a rejected draft result onto another draft or the previously saved directory", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);
    apiMocks.updateTestDataSettings.mockRejectedValueOnce(new Error("没有写入权限"));
    wrapper.vm.savePath = "E:\\Rejected";
    await wrapper.vm.saveSettings();
    expect(wrapper.vm.pathStatusLabel).toBe("目录不可写");
    expect(wrapper.vm.activePath).toBe("D:\\MES");

    wrapper.vm.savePath = "F:\\NewDraft";
    await settle(wrapper);
    expect(wrapper.vm.pathStatusLabel).toBe("未保存 · 待检测");
    expect(wrapper.vm.settingsError).toBe("");
    wrapper.vm.savePath = "D:\\MES";
    await settle(wrapper);
    expect(wrapper.vm.pathStatusLabel).toBe("目录可写");
    wrapper.vm.savePath = "";
    await wrapper.vm.saveSettings();
    wrapper.vm.savePath = "D:\\MES";
    await settle(wrapper);
    expect(wrapper.vm.pathStatusLabel).toBe("目录可写");
    wrapper.unmount();
  });

  test("retries one failed PDF and refreshes the failure list", async () => {
    apiMocks.listFailedTestDataExports
      .mockResolvedValueOnce({
        failedCount: 1,
        items: [{ exportKey: "one", sampleCode: "SP-001", status: "failed" }],
      })
      .mockResolvedValueOnce({ failedCount: 0, items: [] });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.failedCount).toBe(1);
    await wrapper.vm.retryFailed("one");

    expect(apiMocks.retryFailedTestDataExports).toHaveBeenCalledWith(["one"]);
    expect(wrapper.vm.failedExports).toEqual([]);
    expect(wrapper.vm.failedCount).toBe(0);
  });

  test("selects a host folder and loads task experiment progress", async () => {
    apiMocks.listTestDataTasks.mockResolvedValue({
      page: 1,
      pageSize: 5,
      total: 1,
      items: [{ taskCode: "TASK-001", totalExperimentCount: 2, completedExperimentCount: 1 }],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.taskOutputs[0]).toEqual(expect.objectContaining({ taskCode: "TASK-001", progressPercent: 50 }));
    expect(apiMocks.listTestDataTasks).toHaveBeenCalledWith({ page: 1, pageSize: 5, query: "" });
    expect(wrapper.vm.isTaskExpanded("TASK-001")).toBe(false);
    wrapper.vm.toggleTaskExpansion("TASK-001");
    expect(wrapper.vm.isTaskExpanded("TASK-001")).toBe(true);
    wrapper.vm.toggleTaskExpansion("TASK-002");
    expect(wrapper.vm.isTaskExpanded("TASK-001")).toBe(false);
    expect(wrapper.vm.isTaskExpanded("TASK-002")).toBe(true);
    await wrapper.vm.browseDirectory();
    expect(apiMocks.selectTestDataDirectory).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.savePath).toBe("F:\\TrialData");
  });

  test("toggles details immediately on a single activation and ignores the second click of a double-click", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.handleTaskClick("TASK-001", { detail: 1 });
    expect(wrapper.vm.isTaskExpanded("TASK-001")).toBe(true);
    wrapper.vm.handleTaskClick("TASK-001", { detail: 2 });
    expect(wrapper.vm.isTaskExpanded("TASK-001")).toBe(true);

    wrapper.vm.handleTaskClick("TASK-002", { detail: 1 });
    expect(wrapper.vm.isTaskExpanded("TASK-001")).toBe(false);
    expect(wrapper.vm.isTaskExpanded("TASK-002")).toBe(true);
    wrapper.vm.handleTaskClick("TASK-002", { detail: 0 });
    expect(wrapper.vm.isTaskExpanded("TASK-002")).toBe(false);
    expect(apiMocks.listTestDataTasks).toHaveBeenCalledTimes(1);
  });

  test("opens task and experiment folders and exposes manually copyable share URLs", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    await wrapper.vm.openExperimentFolder("TASK-001", "VIBRATION");
    await wrapper.vm.copyExperimentUrl("TASK-001", "VIBRATION");
    await wrapper.vm.openTaskFolder("TASK-001");
    await wrapper.vm.copyTaskUrl("TASK-001");

    expect(apiMocks.openTestDataExperimentFolder).toHaveBeenCalledWith("TASK-001", "VIBRATION");
    expect(apiMocks.shareTestDataExperiment).toHaveBeenCalledWith("TASK-001", "VIBRATION");
    expect(apiMocks.openTestDataTaskFolder).toHaveBeenCalledWith("TASK-001");
    expect(apiMocks.shareTestDataTask).toHaveBeenCalledWith("TASK-001");
    expect(wrapper.vm.shareFallbackUrl).toBe("http://192.168.1.10/api/test-data/share/task-token");
    expect(wrapper.vm.taskActionSuccess).toContain("手动复制");
  });
});
