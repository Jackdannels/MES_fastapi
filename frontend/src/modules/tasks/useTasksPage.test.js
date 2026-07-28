import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const routeState = vi.hoisted(() => ({ hash: "" }));
const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  persistSnapshot: vi.fn(),
  readMasterTestTypes: vi.fn(),
  readTasks: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  resetTasks: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: mocks.loadSnapshot,
    persistSnapshot: mocks.persistSnapshot,
  }),
}));

vi.mock("@/lib/masterDataApi", () => ({
  readMasterTestTypes: mocks.readMasterTestTypes,
}));

vi.mock("@/lib/tasksApi", () => ({
  createTask: mocks.createTask,
  deleteTask: mocks.deleteTask,
  readTasks: mocks.readTasks,
  resetTasks: mocks.resetTasks,
  updateTask: mocks.updateTask,
}));

import { STORAGE_KEYS } from "@/lib/storageKeys";
import { useTasksPage } from "./useTasksPage";

const TestHarness = defineComponent({
  setup() {
    return useTasksPage();
  },
  render() {
    return null;
  },
});

const task = {
  id: "task-preserve-refresh",
  code: "SYLU-2026-04-901",
  name: "刷新保留任务",
  sample_count: 1,
  test_type: "冲击试验",
  test_types: ["冲击试验"],
  status: "待排程",
};

const buildSnapshot = () => ({
  [STORAGE_KEYS.schedules]: [],
  [STORAGE_KEYS.samples]: [
    {
      id: "sample-preserve-refresh",
      code: "CUSTOM-SAMPLE-901",
      task_code: task.code,
      status: "到货",
    },
  ],
  [STORAGE_KEYS.streams]: [],
  [STORAGE_KEYS.experiments]: [],
  [STORAGE_KEYS.experiment_trays]: [],
  [STORAGE_KEYS.experiment_samples]: [],
  [STORAGE_KEYS.experiment_runs]: [],
  [STORAGE_KEYS.experiment_run_trays]: [],
});

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

describe("useTasksPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    routeState.hash = "";
    mocks.readTasks.mockResolvedValue([task]);
    mocks.loadSnapshot.mockResolvedValue(buildSnapshot());
    mocks.persistSnapshot.mockResolvedValue(undefined);
    mocks.readMasterTestTypes.mockResolvedValue([{ name: "冲击试验" }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    routeState.hash = "";
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
        window.dispatchEvent(new CustomEvent("mes:snapshot-updated", { detail: { keys: [STORAGE_KEYS.samples] } }));
        vi.advanceTimersByTime(100);
      },
    ],
  ])("keeps existing related data when a %s refresh returns missing or malformed snapshot collections", async (_label, triggerRefresh) => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    try {
      wrapper.vm.openTaskDrawer(wrapper.vm.taskRows[0]);
      await settle(wrapper);
      expect(wrapper.vm.taskDetailSampleCodes).toEqual(["CUSTOM-SAMPLE-901"]);

      mocks.loadSnapshot.mockClear();
      mocks.loadSnapshot.mockResolvedValue({
        [STORAGE_KEYS.samples]: { stale: true },
      });

      await triggerRefresh();
      await settle(wrapper);

      expect(mocks.loadSnapshot).toHaveBeenCalled();
      expect(wrapper.vm.taskDetailSampleCodes).toEqual(["CUSTOM-SAMPLE-901"]);
    } finally {
      wrapper.unmount();
    }
  });

  test("rejects sample count edits after handover confirms arrival", async () => {
    const confirmedTask = {
      ...task,
      sample_count: 2,
      transfer_status: "到货",
      test_types: ["冲击试验"],
      test_type: "冲击试验",
    };
    mocks.readTasks.mockResolvedValue([confirmedTask]);
    mocks.loadSnapshot.mockResolvedValue({
      ...buildSnapshot(),
      [STORAGE_KEYS.experiments]: [
        {
          id: "EXP-CONFIRMED-A",
          task_code: confirmedTask.code,
          experiment_code: "EXP-CONFIRMED-A",
          experiment_name: "冲击试验",
        },
      ],
      [STORAGE_KEYS.samples]: [
        { id: "sample-1", code: `${confirmedTask.code}-SP-001`, task_code: confirmedTask.code, status: "到货" },
        { id: "sample-2", code: `${confirmedTask.code}-SP-002`, task_code: confirmedTask.code, status: "到货" },
      ],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    try {
      wrapper.vm.openTaskDrawer(wrapper.vm.taskRows[0]);
      await settle(wrapper);
      wrapper.vm.editForm.sample_count = "3";

      await wrapper.vm.updateTask();
      await settle(wrapper);

      expect(mocks.updateTask).not.toHaveBeenCalled();
      expect(wrapper.vm.isTaskSampleCountLocked).toBe(true);
      expect(wrapper.vm.editWarning).toBe("该任务已保存预接驳托盘或已确认到货，请先重新入库后再修改样品数量");
    } finally {
      wrapper.unmount();
    }
  });

  test("locks sample count after pre-allocation save and unlocks after re-entry reset", async () => {
    const preallocatedTask = {
      ...task,
      sample_count: 2,
      transfer_status: "未入库",
      tray_codes: [`${task.code}-TP-001`],
    };
    const preallocatedSamples = [1, 2].map((index) => ({
      id: `sample-${index}`,
      code: `${task.code}-SP-${String(index).padStart(3, "0")}`,
      task_code: task.code,
      status: "运输中",
      trays: [{ tray_code: `${task.code}-TP-001`, status: "未入库" }],
    }));
    mocks.readTasks.mockResolvedValue([preallocatedTask]);
    mocks.loadSnapshot.mockResolvedValue({
      ...buildSnapshot(),
      [STORAGE_KEYS.samples]: preallocatedSamples,
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    try {
      wrapper.vm.openTaskDrawer(wrapper.vm.taskRows[0]);
      await settle(wrapper);
      expect(wrapper.vm.isTaskSampleCountLocked).toBe(true);

      wrapper.vm.editForm.sample_count = "3";
      await wrapper.vm.updateTask();
      await settle(wrapper);

      expect(mocks.updateTask).not.toHaveBeenCalled();
      expect(wrapper.vm.editWarning).toBe("该任务已保存预接驳托盘或已确认到货，请先重新入库后再修改样品数量");

      mocks.readTasks.mockResolvedValue([{ ...preallocatedTask, tray_codes: [] }]);
      mocks.loadSnapshot.mockResolvedValue({
        ...buildSnapshot(),
        [STORAGE_KEYS.samples]: preallocatedSamples.map((sample) => ({
          ...sample,
          status: "运输中",
          flow_status: "运输中",
          trays: [],
        })),
      });
      wrapper.vm.editForm.sample_count = "2";
      window.dispatchEvent(new CustomEvent("mes:samples-updated"));
      await settle(wrapper);

      expect(wrapper.vm.isTaskSampleCountLocked).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  test("updates only the task name after a task is completed", async () => {
    const completedTask = {
      ...task,
      name: "完成任务旧名称",
      sample_count: "2",
      sample_type: "金属件",
      test_types: ["冲击试验"],
      test_type: "冲击试验",
      status: "任务已完成",
    };
    mocks.readTasks.mockResolvedValue([completedTask]);
    mocks.loadSnapshot.mockResolvedValue({
      ...buildSnapshot(),
      [STORAGE_KEYS.experiments]: [
        {
          id: "EXP-COMPLETED-A",
          task_code: completedTask.code,
          experiment_code: "EXP-COMPLETED-A",
          experiment_name: "冲击试验",
          status: "实验已完成",
        },
      ],
      [STORAGE_KEYS.samples]: [
        { id: "sample-1", code: `${completedTask.code}-SP-001`, task_code: completedTask.code, status: "实验已完成" },
        { id: "sample-2", code: `${completedTask.code}-SP-002`, task_code: completedTask.code, status: "实验已完成" },
      ],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    try {
      wrapper.vm.openTaskDrawer(wrapper.vm.taskRows[0]);
      await settle(wrapper);
      wrapper.vm.editForm.name = "完成任务新名称";
      wrapper.vm.editForm.sample_count = "3";
      wrapper.vm.editForm.sample_type = "复合材料";
      wrapper.vm.editForm.test_types = ["盐雾试验"];
      wrapper.vm.editForm.remark = "不应保存的备注";

      await wrapper.vm.updateTask();
      await settle(wrapper);

      expect(mocks.updateTask).toHaveBeenCalledWith(
        completedTask.id,
        expect.objectContaining({
          name: "完成任务新名称",
          sample_count: "2",
          sample_type: "金属件",
          test_types: ["冲击试验"],
          test_type: "冲击试验",
        }),
      );
      expect(mocks.updateTask.mock.calls[0][1]).not.toMatchObject({
        remark: "不应保存的备注",
      });
      expect(mocks.updateTask.mock.calls[0][1]).not.toHaveProperty("updated_at");
      expect(mocks.persistSnapshot).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });

  test("updates only the task name while a task is running", async () => {
    const runningTask = {
      ...task,
      name: "进行中任务",
      source: "外部委托",
      priority: "中",
      sample_type: "金属件",
      due_at: "2026-06-20 18:00",
      test_types: ["盐雾试验"],
      test_type: "盐雾试验",
      status: "任务进行中",
    };
    mocks.readTasks.mockResolvedValue([runningTask]);
    mocks.loadSnapshot.mockResolvedValue({
      ...buildSnapshot(),
      [STORAGE_KEYS.experiment_runs]: [
        {
          task_code: runningTask.code,
          experiment_code: `${runningTask.code}-A`,
          status: "实验进行中",
        },
      ],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    try {
      wrapper.vm.openTaskDrawer(wrapper.vm.taskRows[0]);
      await settle(wrapper);
      wrapper.vm.editForm.name = "进行中任务-修改";
      wrapper.vm.editForm.source = "内部新增";
      wrapper.vm.editForm.priority = "高";
      wrapper.vm.editForm.sample_type = "复合材料";
      wrapper.vm.editForm.due_at = "2026-06-21 18:00";
      wrapper.vm.editForm.test_types = ["冲击试验"];

      await wrapper.vm.updateTask();
      await settle(wrapper);

      expect(wrapper.vm.isRunningTaskDetail).toBe(true);
      expect(wrapper.vm.isTaskDetailLocked).toBe(true);
      expect(mocks.updateTask).toHaveBeenCalledWith(
        runningTask.id,
        expect.objectContaining({
          name: "进行中任务-修改",
          source: "外部委托",
          priority: "中",
          sample_type: "金属件",
          due_at: "2026-06-20 18:00",
          test_types: ["盐雾试验"],
          test_type: "盐雾试验",
        }),
      );
      expect(mocks.updateTask.mock.calls[0][1]).not.toHaveProperty("updated_at");
      expect(mocks.persistSnapshot).not.toHaveBeenCalled();
      expect(wrapper.vm.editWarning).toBe("");
    } finally {
      wrapper.unmount();
    }
  });

  test("blocks deleting a task while one of its experiments is running", async () => {
    mocks.loadSnapshot.mockResolvedValue({
      ...buildSnapshot(),
      [STORAGE_KEYS.experiment_runs]: [
        {
          task_code: task.code,
          experiment_code: `${task.code}-A`,
          status: "实验进行中",
        },
      ],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    try {
      wrapper.vm.openTaskDrawer(wrapper.vm.taskRows[0]);
      await settle(wrapper);

      await wrapper.vm.deleteTask();
      await settle(wrapper);

      expect(wrapper.vm.editWarning).toBe("任务存在进行中的实验，不能删除任务");
      expect(mocks.deleteTask).not.toHaveBeenCalled();
      expect(mocks.persistSnapshot).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });

  test("opens axis picker before selecting impact experiment and submits the selected axes", async () => {
    mocks.readTasks.mockResolvedValue([]);
    mocks.loadSnapshot.mockResolvedValue({
      ...buildSnapshot(),
      [STORAGE_KEYS.samples]: [],
    });
    mocks.readMasterTestTypes.mockResolvedValue([{ name: "冲击试验" }, { name: "盐雾试验" }]);
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    try {
      wrapper.vm.openIntakeModal();
      wrapper.vm.intakeForm.name = "轴向选择任务";
      wrapper.vm.intakeForm.contact = "张三";
      wrapper.vm.intakeForm.contact_info = "13800001234";
      wrapper.vm.intakeForm.sample_count = "2";

      wrapper.vm.openIntakeExperimentPicker();
      wrapper.vm.toggleIntakeExperimentType("冲击试验");
      await settle(wrapper);

      expect(wrapper.vm.intakeExperimentDraft).toEqual([]);
      expect(wrapper.vm.intakeAxisModalOpen).toBe(true);
      expect(wrapper.vm.intakeAxisPickerType).toBe("冲击试验");
      expect(wrapper.vm.intakeAxisPickerCodes).toEqual(["x+", "x-", "y+", "y-", "z+", "z-"]);

      wrapper.vm.toggleIntakeAxisCode("x-");
      wrapper.vm.toggleIntakeAxisCode("y+");
      wrapper.vm.toggleIntakeAxisCode("y-");
      wrapper.vm.toggleIntakeAxisCode("z+");
      wrapper.vm.toggleIntakeAxisCode("z-");
      wrapper.vm.confirmIntakeAxisPicker();
      await settle(wrapper);

      expect(wrapper.vm.intakeAxisModalOpen).toBe(false);
      expect(wrapper.vm.intakeExperimentDraft).toEqual(["冲击试验"]);
      expect(wrapper.vm.intakeExperimentDraftAxisSummary).toBe("冲击试验（X+）");

      wrapper.vm.confirmIntakeExperimentPicker();
      await wrapper.vm.submitTask();
      await settle(wrapper);

      expect(mocks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          test_types: ["冲击试验"],
          axis_codes_by_test_type: {
            冲击试验: ["x+"],
          },
        }),
      );
    } finally {
      wrapper.unmount();
    }
  });

  test("rejects an intake due time earlier than the frozen business time", async () => {
    vi.setSystemTime(new Date("2026-07-23T01:00:00.000Z"));
    mocks.readTasks.mockResolvedValue([]);
    mocks.loadSnapshot.mockResolvedValue({
      ...buildSnapshot(),
      [STORAGE_KEYS.samples]: [],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    try {
      wrapper.vm.openIntakeModal();
      wrapper.vm.intakeForm.name = "过去完成时间任务";
      wrapper.vm.intakeForm.contact = "张三";
      wrapper.vm.intakeForm.contact_info = "13800001234";
      wrapper.vm.intakeForm.sample_count = "1";
      wrapper.vm.intakeForm.test_types = ["冲击试验"];
      wrapper.vm.intakeForm.due_at = "2026-07-23 08:59";

      await wrapper.vm.submitTask();

      expect(wrapper.vm.intakeWarning).toBe("期望完成时间不能早于当前时间");
      expect(mocks.createTask).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });
});
