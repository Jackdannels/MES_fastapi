import { ref } from "vue";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTask: vi.fn(),
}));

vi.mock("@/lib/tasksApi", () => ({
  deleteTask: vi.fn(),
  updateTask: mocks.updateTask,
}));

import { useTaskMutationWorkflow } from "./useTaskMutationWorkflow";

describe("useTaskMutationWorkflow", () => {
  beforeEach(() => {
    mocks.updateTask.mockReset();
  });

  const createSampleCodeWorkflow = (draftCodes) => {
    const originalTask = {
      id: "task-001",
      code: "SYLU-2026-07-001",
      sample_count: 2,
      test_types: ["盐雾试验"],
    };
    const rawTasks = ref([originalTask]);
    const persistRelated = vi.fn(() => Promise.resolve());
    const loadTasksPage = vi.fn(() => Promise.resolve());
    const closeSampleCodesEditor = vi.fn();
    const sampleCodesWarning = ref("");
    mocks.updateTask.mockResolvedValue({ ...originalTask });

    const { saveSampleCodes } = useTaskMutationWorkflow({
      buildFailureMessage: (message) => message,
      closeSampleCodesEditor,
      editForm: ref({ ...originalTask, sample_count: String(originalTask.sample_count) }),
      loadError: ref(""),
      loadTasksPage,
      persistRelated,
      rawSamples: ref([
        { code: "SYLU-2026-07-001-SP-001", task_code: originalTask.code },
        { code: "SYLU-2026-07-001-SP-002", task_code: originalTask.code },
      ]),
      rawTasks,
      sampleCodesDraft: ref(draftCodes.join("\n")),
      sampleCodesWarning,
      taskDetailSampleCodes: ref([
        "SYLU-2026-07-001-SP-001",
        "SYLU-2026-07-001-SP-002",
      ]),
      taskSampleCountLocked: vi.fn(() => false),
    });

    return {
      closeSampleCodesEditor,
      loadTasksPage,
      originalTask,
      persistRelated,
      sampleCodesWarning,
      saveSampleCodes,
    };
  };

  test("saves edited sample codes through the task API without writing a storage snapshot", async () => {
    const nextCodes = [
      "SYLU-2026-07-001-SP-010",
      "SYLU-2026-07-001-SP-011",
    ];
    const workflow = createSampleCodeWorkflow(nextCodes);

    await workflow.saveSampleCodes();

    expect(mocks.updateTask).toHaveBeenCalledTimes(1);
    expect(mocks.updateTask).toHaveBeenCalledWith(
      workflow.originalTask.id,
      expect.objectContaining({
        sample_count: workflow.originalTask.sample_count,
        sample_codes: nextCodes,
      }),
    );
    expect(workflow.persistRelated).not.toHaveBeenCalled();
    expect(workflow.closeSampleCodesEditor).toHaveBeenCalledTimes(1);
    expect(workflow.loadTasksPage).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      label: "增加",
      codes: ["CUSTOM-001", "CUSTOM-002", "SYLU-2026-07-001-SP-001"],
    },
    {
      label: "减少",
      codes: ["CUSTOM-001"],
    },
  ])("rejects $label sample-code rows so identifier editing cannot change sample quantity", async ({ codes }) => {
    const workflow = createSampleCodeWorkflow(codes);

    await workflow.saveSampleCodes();

    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(workflow.persistRelated).not.toHaveBeenCalled();
    expect(workflow.closeSampleCodesEditor).not.toHaveBeenCalled();
    expect(workflow.loadTasksPage).not.toHaveBeenCalled();
    expect(workflow.sampleCodesWarning.value).toBe("样品编号数量必须与样品数量一致（当前 2 个）");
  });
});
