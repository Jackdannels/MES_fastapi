import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: mocks.loadSnapshot,
  }),
}));

import { useDashboardPage } from "./useDashboardPage";

const TestHarness = defineComponent({
  setup() {
    return useDashboardPage();
  },
  render() {
    return null;
  },
});

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

describe("useDashboardPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T10:00:00.000Z"));
    mocks.loadSnapshot.mockResolvedValue({
      "mes.tasks": [{ code: "SYLU-2026-04-109", source: "外部委托", status: "待排程", transfer_status: "已入库" }],
      "mes.schedules": [],
      "mes.devices": [],
      "mes.streams": [],
      "mes.experiments": [
        {
          task_code: "SYLU-2026-04-109",
          experiment_code: "SYLU-2026-04-109-A",
          experiment_name: "振动试验",
          unscheduled_since: "2026-03-17T07:45:00.000Z",
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.loadSnapshot.mockReset();
  });

  test("loads unscheduled experiment timers and refreshes elapsed duration every second", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-04-109",
        elapsedLabel: "02:15:00",
      }),
    ]);

    vi.advanceTimersByTime(1000);
    await settle(wrapper);

    expect(wrapper.vm.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-04-109",
        elapsedLabel: "02:15:01",
      }),
    ]);
  });

  test("surfaces snapshot load failures without throwing an unhandled rejection", async () => {
    mocks.loadSnapshot.mockRejectedValueOnce(new Error("offline"));

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.loadError).toContain("总览数据加载失败");
    expect(wrapper.vm.pagedTaskRows).toEqual([]);
    expect(wrapper.vm.summaryCards).toEqual(
      expect.objectContaining({
        intakeCount: 0,
        scheduledCount: 0,
      }),
    );
  });
});
