import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { beforeEach, describe, expect, test, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  listFailedTestDataExports: vi.fn(),
  readTestDataSettings: vi.fn(),
  retryFailedTestDataExports: vi.fn(),
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
    apiMocks.updateTestDataSettings.mockResolvedValue({
      defaultPath: "C:\\Desktop\\MES试验数据",
      detail: "目录可写",
      savePath: "E:\\Reports",
      writable: true,
    });
    apiMocks.retryFailedTestDataExports.mockResolvedValue({ ok: true });
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
});
