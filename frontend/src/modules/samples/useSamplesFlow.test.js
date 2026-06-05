import { mount } from "@vue/test-utils";
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
          task_code: "TASK-RUN",
          experiment_code: "EXP-RUN",
          tray_codes: ["TP-RUN-001"],
          status: "实验进行中",
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
});
