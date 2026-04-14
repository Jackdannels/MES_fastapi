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
});
