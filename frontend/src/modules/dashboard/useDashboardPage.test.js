import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dashboardModelBuild: vi.fn(),
  loadSnapshot: vi.fn(),
  requestedSnapshotKeys: [],
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: (keys) => {
    mocks.requestedSnapshotKeys.push(keys);
    return { loadSnapshot: mocks.loadSnapshot };
  },
}));

vi.mock("./model", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildDashboardViewModel: (...args) => {
      mocks.dashboardModelBuild();
      return actual.buildDashboardViewModel(...args);
    },
  };
});

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
    mocks.dashboardModelBuild.mockClear();
    mocks.requestedSnapshotKeys.length = 0;
    mocks.loadSnapshot.mockResolvedValue({
      "mes.tasks": [{ code: "SYLU-2026-04-109", source: "外部委托", status: "待排程", transfer_status: "已入库" }],
      "mes.schedules": [],
      "mes.devices": [],
      "mes.samples": [
        {
          task_code: "SYLU-2026-04-109",
          history: [{ action: "任务已确认入库", time: "2026-03-17T07:45:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-04-109-TP-001", status: "到货" }],
        },
      ],
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

  test("reloads only samples when sample state changes in another work area", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.samples": [
        {
          task_code: "SYLU-2026-04-109",
          history: [{ action: "任务已确认入库", time: "2026-03-17T07:45:00.000Z" }],
          status: "送至暂存间",
          trays: [{ tray_code: "SYLU-2026-04-109-TP-001", status: "送至暂存间" }],
        },
      ],
    });

    window.dispatchEvent(new CustomEvent("mes:samples-updated"));
    await settle(wrapper);

    expect(mocks.requestedSnapshotKeys).toContainEqual(["mes.samples"]);
  });

  test("updates the one-second clock without rebuilding the full dashboard model", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(mocks.dashboardModelBuild).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    await settle(wrapper);

    expect(wrapper.vm.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-04-109",
        elapsedLabel: "02:15:10",
      }),
    ]);
    expect(mocks.dashboardModelBuild).toHaveBeenCalledTimes(1);
  });

  test("reloads dashboard data when storage snapshot updates are broadcast", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.experiments": [
        {
          task_code: "SYLU-2026-04-109",
          experiment_code: "SYLU-2026-04-109-A",
          experiment_name: "盐雾试验",
          unscheduled_since: "2026-03-17T09:40:00.000Z",
        },
      ],
    });

    window.dispatchEvent(new CustomEvent("mes:snapshot-updated", { detail: { keys: ["mes.experiments"] } }));
    vi.advanceTimersByTime(100);
    await settle(wrapper);

    expect(mocks.loadSnapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.requestedSnapshotKeys).toContainEqual(["mes.experiments"]);
    expect(wrapper.vm.unscheduledExperimentItems).toHaveLength(1);
  });

  test("loads pending exception experiments into unscheduled timers", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.tasks": [{ code: "SYLU-2026-05-009", source: "外部委托", status: "待排程", transfer_status: "未入库" }],
      "mes.schedules": [],
      "mes.conflicts": [
        {
          id: "schedule-exception-9",
          type: "schedule_missed_start",
          status: "pending",
          task_code: "SYLU-2026-05-009",
          experiment_code: "SYLU-2026-05-009-A",
        },
      ],
      "mes.devices": [],
      "mes.samples": [
        {
          task_code: "SYLU-2026-05-009",
          history: [{ action: "任务已确认入库", time: "2026-03-17T09:05:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-05-009-TP-001", status: "到货" }],
        },
      ],
      "mes.streams": [],
      "mes.experiments": [
        {
          task_code: "SYLU-2026-05-009",
          experiment_code: "SYLU-2026-05-009-A",
          experiment_name: "冲击试验",
          status: "待排程",
          unscheduled_since: "2026-03-17T09:05:00.000Z",
        },
      ],
    });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.unscheduledExperimentItems).toEqual([
      expect.objectContaining({
        taskCode: "SYLU-2026-05-009",
        experimentCode: "SYLU-2026-05-009-A",
        elapsedLabel: "00:55:00",
      }),
    ]);
  });

  test.each([
    [
      "samples-updated",
      async () => {
        window.dispatchEvent(new CustomEvent("mes:samples-updated"));
      },
    ],
    [
      "storage snapshot update",
      async () => {
        window.dispatchEvent(new CustomEvent("mes:snapshot-updated", { detail: { keys: ["mes.experiments"] } }));
        vi.advanceTimersByTime(100);
      },
    ],
  ])("keeps existing dashboard data when a %s refresh returns missing or malformed snapshot collections", async (_label, triggerRefresh) => {
    const initialSnapshot = {
      "mes.tasks": [{ code: "SYLU-2026-04-122", source: "外部委托", status: "待排程", transfer_status: "到货" }],
      "mes.schedules": [],
      "mes.devices": [],
      "mes.samples": [
        {
          task_code: "SYLU-2026-04-122",
          history: [{ action: "任务已确认入库", time: "2026-03-17T09:50:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-04-122-TP-001", status: "到货" }],
        },
      ],
      "mes.streams": [],
      "mes.experiments": [
        {
          task_code: "SYLU-2026-04-122",
          experiment_code: "SYLU-2026-04-122-A",
          experiment_name: "振动试验",
          unscheduled_since: "2026-03-17T09:50:00.000Z",
        },
      ],
    };
    mocks.loadSnapshot.mockResolvedValueOnce(initialSnapshot);
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    try {
      expect(wrapper.vm.unscheduledExperimentItems).toEqual([
        expect.objectContaining({
          taskCode: "SYLU-2026-04-122",
          elapsedLabel: "00:10:00",
        }),
      ]);

      mocks.loadSnapshot.mockClear();
      mocks.loadSnapshot.mockResolvedValue({
        "mes.experiments": { stale: true },
      });

      await triggerRefresh();
      await settle(wrapper);

      expect(mocks.loadSnapshot).toHaveBeenCalled();
      expect(wrapper.vm.unscheduledExperimentItems).toEqual([
        expect.objectContaining({
          taskCode: "SYLU-2026-04-122",
          elapsedLabel: "00:10:00",
        }),
      ]);
    } finally {
      wrapper.unmount();
    }
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
