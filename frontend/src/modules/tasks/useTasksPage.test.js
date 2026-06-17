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

  test("rejects sample count edits after storage is confirmed with selected experiments", async () => {
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
      expect(wrapper.vm.editWarning).toBe("该任务样品已在接驳区确认到货，不允许更改样品数量");
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
});
