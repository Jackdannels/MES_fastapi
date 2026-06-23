import { enableAutoUnmount, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  persistSnapshot: vi.fn(),
  readTasks: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: mocks.loadSnapshot,
    persistSnapshot: mocks.persistSnapshot,
  }),
}));

vi.mock("@/lib/tasksApi", () => ({
  readTasks: mocks.readTasks,
  updateTask: mocks.updateTask,
}));

import { useSamplesFlow } from "./useSamplesFlow";

const TestHarness = defineComponent({
  setup() {
    return useSamplesFlow();
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

describe("useSamplesFlow", () => {
  beforeEach(() => {
    mocks.readTasks.mockResolvedValue([]);
    mocks.loadSnapshot.mockResolvedValue({
      "mes.samples": [],
      "mes.experiments": [],
      "mes.experiment_runs": [],
      "mes.experiment_trays": [],
      "mes.schedules": [],
    });
    mocks.persistSnapshot.mockResolvedValue(undefined);
    mocks.updateTask.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.loadSnapshot.mockReset();
    mocks.persistSnapshot.mockReset();
    mocks.readTasks.mockReset();
    mocks.updateTask.mockReset();
  });

  test("clears loading and surfaces a warning when the snapshot load fails", async () => {
    mocks.loadSnapshot.mockRejectedValueOnce(new Error("offline"));

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.warning).toContain("样品数据加载失败");
    expect(wrapper.vm.sampleRows).toEqual([]);
  });

  test("keeps archived task samples in storage while hiding them from the active sample flow", async () => {
    mocks.readTasks.mockResolvedValueOnce([{ code: "TASK-ACTIVE", name: "活动任务" }]);
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.samples": [
        {
          code: "TASK-ACTIVE-SP-001",
          task_code: "TASK-ACTIVE",
          status: "已入库",
          trays: [{ tray_code: "TASK-ACTIVE-TP-001", status: "已入库", quantity: 1 }],
        },
        {
          code: "TASK-RETURNED-SP-001",
          task_code: "TASK-RETURNED",
          status: "厂家收回",
          trays: [{ tray_code: "TASK-RETURNED-TP-001", status: "厂家收回", quantity: 1 }],
        },
      ],
      "mes.experiments": [],
      "mes.experiment_runs": [],
      "mes.experiment_trays": [],
      "mes.schedules": [],
    });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
    expect(wrapper.vm.rawSamples.map((sample) => sample.code)).toEqual([
      "TASK-ACTIVE-SP-001",
      "TASK-RETURNED-SP-001",
    ]);
    expect(wrapper.vm.sampleRows.map((sample) => sample.code)).toEqual(["TASK-ACTIVE-SP-001"]);
    expect(wrapper.vm.taskOptions).toEqual(["TASK-ACTIVE"]);
  });

  test("opens sample detail with the same tray flow data as the bound tray", async () => {
    mocks.readTasks.mockResolvedValueOnce([{ code: "TASK-001", name: "任务A", test_type: "盐雾试验" }]);
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.samples": [
        {
          code: "SP-001",
          task_code: "TASK-001",
          status: "实验进行中",
          trays: [{ tray_code: "TP-001", status: "实验进行中", quantity: 1 }],
          history: [{ action: "托盘状态更新", status: "实验进行中", time: "2026-04-28T11:31:20+08:00" }],
        },
      ],
      "mes.experiments": [{ task_code: "TASK-001", experiment_code: "EXP-001", experiment_type: "盐雾试验" }],
      "mes.experiment_runs": [],
      "mes.experiment_trays": [{ task_code: "TASK-001", experiment_code: "EXP-001", tray_code: "TP-001" }],
      "mes.schedules": [],
    });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openDetailDrawer("SP-001");
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.detailDrawerOpen).toBe(true);
    expect(wrapper.vm.detailSampleTrayCode).toBe("TP-001");
    expect(wrapper.vm.detailSampleTrayFlow.currentStatus).toBe("当前托盘：TP-001 | 当前状态：盐雾试验进行中");
    expect(wrapper.vm.detailSampleTrayFlow.steps.find((step) => step.key === "running")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("opens sample detail using the task-scoped tray row instead of a same-code tray from another task", async () => {
    mocks.readTasks.mockResolvedValueOnce([
      { code: "TASK-OLD", name: "旧任务", test_type: "盐雾试验" },
      { code: "TASK-CURRENT", name: "当前任务", test_type: "冲击试验" },
    ]);
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.samples": [
        {
          code: "SP-OLD",
          task_code: "TASK-OLD",
          location: "外观检测间",
          status: "实验前外观检测间存放",
          trays: [{ tray_code: "TP-001", status: "实验前外观检测间存放", quantity: 1 }],
        },
        {
          code: "SP-CURRENT",
          task_code: "TASK-CURRENT",
          location: "接驳区",
          status: "到货",
          trays: [{ tray_code: "TP-001", status: "到货", quantity: 1 }],
        },
      ],
      "mes.experiments": [],
      "mes.experiment_runs": [],
      "mes.experiment_trays": [],
      "mes.schedules": [],
    });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openDetailDrawer("SP-CURRENT");
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.detailSampleTrayFlow.currentStatus).toBe("当前托盘：TP-001 | 当前状态：到货");
  });

  test("opens sample detail without falling back to sample-level status for tray flow", async () => {
    mocks.readTasks.mockResolvedValueOnce([{ code: "TASK-SAMPLE-STATUS", name: "样品状态任务" }]);
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.samples": [
        {
          code: "SP-SAMPLE-STATUS",
          task_code: "TASK-SAMPLE-STATUS",
          location: "冲击一室",
          status: "实验进行中",
          trays: [{ tray_code: "TP-SAMPLE-STATUS", quantity: 1 }],
        },
      ],
      "mes.experiments": [],
      "mes.experiment_runs": [],
      "mes.experiment_trays": [],
      "mes.schedules": [],
    });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openDetailDrawer("SP-SAMPLE-STATUS");
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.detailSampleTrayFlow.currentStatus).toBe("当前托盘：TP-SAMPLE-STATUS | 当前状态：样品运输中");
    expect(wrapper.vm.detailSampleTrayFlow.steps.find((step) => step.key === "running")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
  });

  test("loads experiment runs for tray flow runtime times", async () => {
    mocks.readTasks.mockResolvedValueOnce([{ code: "TASK-RUN", name: "运行任务" }]);
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.samples": [
        {
          code: "SP-RUN-001",
          task_code: "TASK-RUN",
          location: "冲击一室",
          status: "实验进行中",
          trays: [{ tray_code: "TP-RUN-001", status: "实验进行中", quantity: 1 }],
        },
      ],
      "mes.experiments": [
        { task_code: "TASK-RUN", experiment_code: "EXP-RUN", experiment_name: "冲击试验", status: "实验进行中" },
        { task_code: "TASK-RUN", experiment_code: "EXP-NEXT", experiment_name: "振动试验", status: "已排程" },
      ],
      "mes.experiment_runs": [
        {
          run_no: "RUN-TP-RUN-001",
          task_code: "TASK-RUN",
          experiment_code: "EXP-RUN",
          tray_codes: ["TP-RUN-001"],
          status: "实验进行中",
          started_at: "2026-06-04T19:12:09+08:00",
        },
      ],
      "mes.experiment_run_trays": [
        {
          run_no: "RUN-TP-RUN-001",
          task_code: "TASK-RUN",
          experiment_code: "EXP-RUN",
          tray_code: "TP-RUN-001",
          run_tray_status: "实验进行中",
          started_at: "2026-06-04T19:12:09+08:00",
        },
      ],
      "mes.experiment_trays": [
        { task_code: "TASK-RUN", experiment_code: "EXP-RUN", tray_code: "TP-RUN-001" },
        { task_code: "TASK-RUN", experiment_code: "EXP-NEXT", tray_code: "TP-RUN-001" },
      ],
      "mes.schedules": [],
    });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.rawExperimentRuns).toHaveLength(1);
    wrapper.vm.openDetailDrawer("SP-RUN-001");
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.detailSampleTrayFlow.steps.find((step) => step.label === "冲击试验进行中")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-04T19:12:09+08:00" }),
    );
  });

  test("keeps sample rows visible without blocking loading while realtime refresh is pending", async () => {
    let resolveRefresh = null;
    mocks.readTasks.mockResolvedValue([{ code: "TASK-LIVE", name: "实时任务" }]);
    mocks.loadSnapshot
      .mockResolvedValueOnce({
        "mes.samples": [
          {
            code: "SP-LIVE-001",
            task_code: "TASK-LIVE",
            status: "到货",
            trays: [{ tray_code: "TP-LIVE-001", status: "到货", quantity: 1 }],
          },
        ],
        "mes.experiments": [],
        "mes.experiment_runs": [],
        "mes.experiment_run_trays": [],
        "mes.experiment_trays": [],
        "mes.schedules": [],
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = () => resolve({
          "mes.samples": [],
          "mes.experiments": [],
          "mes.experiment_runs": [],
          "mes.experiment_run_trays": [],
          "mes.experiment_trays": [],
          "mes.schedules": [],
        });
      }));

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.sampleRows.map((row) => row.code)).toEqual(["SP-LIVE-001"]);

    window.dispatchEvent(new CustomEvent("mes:samples-updated"));
    await settle(wrapper);

    expect(mocks.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.sampleRows.map((row) => row.code)).toEqual(["SP-LIVE-001"]);

    resolveRefresh();
    await settle(wrapper);
  });

  test("keeps sample rows visible without blocking loading while storage snapshot refresh is pending", async () => {
    vi.useFakeTimers();
    let resolveRefresh = null;
    mocks.readTasks.mockResolvedValue([{ code: "TASK-STORAGE", name: "存储任务" }]);
    mocks.loadSnapshot
      .mockResolvedValueOnce({
        "mes.samples": [
          {
            code: "SP-STORAGE-001",
            task_code: "TASK-STORAGE",
            status: "到货",
            trays: [{ tray_code: "TP-STORAGE-001", status: "到货", quantity: 1 }],
          },
        ],
        "mes.experiments": [],
        "mes.experiment_runs": [],
        "mes.experiment_run_trays": [],
        "mes.experiment_trays": [],
        "mes.schedules": [],
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = () => resolve({
          "mes.samples": [],
          "mes.experiments": [],
          "mes.experiment_runs": [],
          "mes.experiment_run_trays": [],
          "mes.experiment_trays": [],
          "mes.schedules": [],
        });
      }));

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.sampleRows.map((row) => row.code)).toEqual(["SP-STORAGE-001"]);

    window.dispatchEvent(new CustomEvent("mes:snapshot-updated", { detail: { keys: ["mes.samples"] } }));
    vi.advanceTimersByTime(100);
    await settle(wrapper);

    expect(mocks.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.sampleRows.map((row) => row.code)).toEqual(["SP-STORAGE-001"]);

    resolveRefresh();
    await settle(wrapper);
  });

  test("preserves current raw data when a background refresh omits keys or returns non-arrays", async () => {
    mocks.readTasks
      .mockResolvedValueOnce([{ code: "TASK-KEEP", name: "保留任务" }])
      .mockResolvedValueOnce({ error: "bad tasks" });
    mocks.loadSnapshot
      .mockResolvedValueOnce({
        "mes.samples": [{ code: "SP-KEEP-001", task_code: "TASK-KEEP", status: "到货" }],
        "mes.experiments": [{ task_code: "TASK-KEEP", experiment_code: "EXP-KEEP" }],
        "mes.experiment_runs": [{ run_no: "RUN-KEEP", task_code: "TASK-KEEP" }],
        "mes.experiment_run_trays": [{ run_no: "RUN-KEEP", tray_code: "TP-KEEP-001" }],
        "mes.experiment_trays": [{ task_code: "TASK-KEEP", tray_code: "TP-KEEP-001" }],
        "mes.schedules": [{ task_code: "TASK-KEEP", lab: "冲击一室" }],
      })
      .mockResolvedValueOnce({
        "mes.samples": { error: "bad samples" },
        "mes.experiments": "bad experiments",
      });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    window.dispatchEvent(new CustomEvent("mes:samples-updated"));
    await settle(wrapper);

    expect(wrapper.vm.rawTasks).toEqual([{ code: "TASK-KEEP", name: "保留任务" }]);
    expect(wrapper.vm.rawSamples.map((sample) => sample.code)).toEqual(["SP-KEEP-001"]);
    expect(wrapper.vm.rawExperiments).toEqual([{ task_code: "TASK-KEEP", experiment_code: "EXP-KEEP" }]);
    expect(wrapper.vm.rawExperimentRuns).toEqual([{ run_no: "RUN-KEEP", task_code: "TASK-KEEP" }]);
    expect(wrapper.vm.rawExperimentRunTrays).toEqual([{ run_no: "RUN-KEEP", tray_code: "TP-KEEP-001" }]);
    expect(wrapper.vm.rawExperimentTrays).toEqual([{ task_code: "TASK-KEEP", tray_code: "TP-KEEP-001" }]);
    expect(wrapper.vm.rawSchedules).toEqual([{ task_code: "TASK-KEEP", lab: "冲击一室" }]);
  });

  test("allows a background refresh to replace existing raw data with real empty arrays", async () => {
    mocks.readTasks
      .mockResolvedValueOnce([{ code: "TASK-CLEAR", name: "清空任务" }])
      .mockResolvedValueOnce([]);
    mocks.loadSnapshot
      .mockResolvedValueOnce({
        "mes.samples": [{ code: "SP-CLEAR-001", task_code: "TASK-CLEAR", status: "到货" }],
        "mes.experiments": [{ task_code: "TASK-CLEAR", experiment_code: "EXP-CLEAR" }],
        "mes.experiment_runs": [{ run_no: "RUN-CLEAR", task_code: "TASK-CLEAR" }],
        "mes.experiment_run_trays": [{ run_no: "RUN-CLEAR", tray_code: "TP-CLEAR-001" }],
        "mes.experiment_trays": [{ task_code: "TASK-CLEAR", tray_code: "TP-CLEAR-001" }],
        "mes.schedules": [{ task_code: "TASK-CLEAR", lab: "振动一室" }],
      })
      .mockResolvedValueOnce({
        "mes.samples": [],
        "mes.experiments": [],
        "mes.experiment_runs": [],
        "mes.experiment_run_trays": [],
        "mes.experiment_trays": [],
        "mes.schedules": [],
      });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    window.dispatchEvent(new CustomEvent("mes:samples-updated"));
    await settle(wrapper);

    expect(wrapper.vm.rawTasks).toEqual([]);
    expect(wrapper.vm.rawSamples).toEqual([]);
    expect(wrapper.vm.rawExperiments).toEqual([]);
    expect(wrapper.vm.rawExperimentRuns).toEqual([]);
    expect(wrapper.vm.rawExperimentRunTrays).toEqual([]);
    expect(wrapper.vm.rawExperimentTrays).toEqual([]);
    expect(wrapper.vm.rawSchedules).toEqual([]);
  });
});

enableAutoUnmount(afterEach);
