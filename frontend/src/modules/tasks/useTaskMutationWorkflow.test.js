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

  const createSampleCodeWorkflow = (draftCodes, { storageConfirmed = false, countLocked = false, draftCount = "2" } = {}) => {
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
    const recordSavedSampleCount = vi.fn();
    const sampleCodesWarning = ref("");
    const editForm = ref({ ...originalTask, sample_count: draftCount });
    mocks.updateTask.mockImplementation(async (_id, updates) => ({
      ...originalTask,
      sample_count: updates.sample_count ?? originalTask.sample_count,
    }));

    const { saveSampleCodes } = useTaskMutationWorkflow({
      buildFailureMessage: (message) => message,
      closeSampleCodesEditor,
      editForm,
      isTaskDetailLocked: ref(false),
      loadError: ref(""),
      loadTasksPage,
      persistRelated,
      rawSamples: ref([
        { code: "SYLU-2026-07-001-SP-001", task_code: originalTask.code },
        { code: "SYLU-2026-07-001-SP-002", task_code: originalTask.code },
      ]),
      rawTasks,
      recordSavedSampleCount,
      sampleCountChanged: (original, edited) => original.sample_count !== edited.sample_count,
      sampleCodesDraft: ref(draftCodes.join("\n")),
      sampleCodesWarning,
      taskSampleCountLocked: vi.fn(() => countLocked),
      taskStorageConfirmed: vi.fn(() => storageConfirmed),
    });

    return {
      closeSampleCodesEditor,
      editForm,
      loadTasksPage,
      originalTask,
      persistRelated,
      recordSavedSampleCount,
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
        sample_codes: nextCodes,
      }),
    );
    expect(mocks.updateTask.mock.calls[0][1]).not.toHaveProperty("sample_count");
    expect(workflow.persistRelated).not.toHaveBeenCalled();
    expect(workflow.closeSampleCodesEditor).toHaveBeenCalledTimes(1);
    expect(workflow.recordSavedSampleCount).toHaveBeenCalledWith("2");
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

  test("rejects saving sample codes when handover receipt is confirmed while the editor is open", async () => {
    const workflow = createSampleCodeWorkflow(
      ["SYLU-2026-07-001-SP-010", "SYLU-2026-07-001-SP-011"],
      { storageConfirmed: true },
    );

    await workflow.saveSampleCodes();

    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(workflow.closeSampleCodesEditor).not.toHaveBeenCalled();
    expect(workflow.sampleCodesWarning.value).toBe("该任务样品已在接驳间确认收货，不允许修改样品编号，请先重新入库");
  });

  test("rejects a pending quantity change when pre-allocation locks the sample count", async () => {
    const workflow = createSampleCodeWorkflow(["CUSTOM-001", "CUSTOM-002", "CUSTOM-003"], {
      countLocked: true,
      draftCount: "3",
    });

    await workflow.saveSampleCodes();

    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(workflow.editForm.value.sample_count).toBe("3");
    expect(workflow.sampleCodesWarning.value).toContain("已保存预接驳托盘");
  });

  test("uses the draft quantity in the mismatch warning and preserves it for a retry", async () => {
    const workflow = createSampleCodeWorkflow(["CUSTOM-001", "CUSTOM-002"], { draftCount: "3" });

    await workflow.saveSampleCodes();

    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(workflow.closeSampleCodesEditor).not.toHaveBeenCalled();
    expect(workflow.editForm.value.sample_count).toBe("3");
    expect(workflow.sampleCodesWarning.value).toBe("样品编号数量必须与样品数量一致（当前 3 个）");
  });

  test("keeps the quantity draft when the combined save fails and allows a retry", async () => {
    const workflow = createSampleCodeWorkflow(["CUSTOM-001", "CUSTOM-002", "CUSTOM-003"], { draftCount: "3" });
    mocks.updateTask.mockRejectedValueOnce(new Error("save failed"));

    await workflow.saveSampleCodes();

    expect(workflow.editForm.value.sample_count).toBe("3");
    expect(workflow.recordSavedSampleCount).not.toHaveBeenCalled();
    expect(workflow.closeSampleCodesEditor).not.toHaveBeenCalled();

    await workflow.saveSampleCodes();

    expect(mocks.updateTask).toHaveBeenCalledTimes(2);
    expect(workflow.recordSavedSampleCount).toHaveBeenCalledWith("3");
    expect(workflow.closeSampleCodesEditor).toHaveBeenCalledTimes(1);
  });
});
