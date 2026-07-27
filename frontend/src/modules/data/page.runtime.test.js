import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { beforeEach, describe, expect, test, vi } from "vitest";

import DataPage from "./page.vue";

const saveSettingsMock = vi.fn();
const retryFailedMock = vi.fn();
const retryAllFailedMock = vi.fn();
const savePath = ref("C:\\Users\\tester\\Desktop\\MES试验数据");
const failedExports = ref([]);

vi.mock("./useDataPage", () => ({
  useDataPage: () => ({
    defaultPath: ref("C:\\Users\\tester\\Desktop\\MES试验数据"),
    exportsError: ref(""),
    exportsLoading: ref(false),
    failedCount: computed(() => failedExports.value.length),
    failedExports,
    isRetrying: () => false,
    pathStatusClass: computed(() => ({ "is-writable": true })),
    pathStatusLabel: ref("目录可写"),
    retryAllFailed: retryAllFailedMock,
    retryFailed: retryFailedMock,
    retryingAll: ref(false),
    savePath,
    saveSettings: saveSettingsMock,
    settingsError: ref(""),
    settingsLoading: ref(false),
    settingsSaving: ref(false),
    settingsSuccess: ref(""),
  }),
}));

describe("DataPage runtime", () => {
  beforeEach(() => {
    failedExports.value = [];
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
