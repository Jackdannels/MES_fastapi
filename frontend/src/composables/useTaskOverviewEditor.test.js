import { describe, expect, test, vi } from "vitest";

import { STORAGE_KEYS } from "@/lib/storageKeys";
import { useTaskOverviewEditor } from "./useTaskOverviewEditor";

const createEditor = (overrides = {}) => {
  const loadSnapshot = overrides.loadSnapshot || vi.fn();
  const persistSnapshot = overrides.persistSnapshot || vi.fn(() => Promise.resolve());
  const replaceOverview = overrides.replaceOverview || vi.fn();

  const editor = useTaskOverviewEditor({
    loadSnapshot,
    persistSnapshot,
    replaceOverview,
  });

  return {
    ...editor,
    loadSnapshot,
    persistSnapshot,
    replaceOverview,
  };
};

describe("useTaskOverviewEditor", () => {
  test("saveEdit accepts semicolon-delimited sample codes", async () => {
    const snapshot = {
      [STORAGE_KEYS.tasks]: [{ code: "TASK-001", test_type: "旧类型", name: "旧类型", required_device: "旧类型", sample_count: 1 }],
      [STORAGE_KEYS.samples]: [{ id: "sample-1", code: "TASK-001-SP-001", task_code: "TASK-001", trays: [] }],
      [STORAGE_KEYS.schedules]: [],
      [STORAGE_KEYS.streams]: [],
    };
    const { openEdit, editForm, saveEdit, persistSnapshot } = createEditor({
      loadSnapshot: vi.fn(async () => snapshot),
    });

    openEdit({
      taskCode: "TASK-001",
      taskType: "旧类型",
      sampleCount: 1,
      sampleCodes: ["TASK-001-SP-001"],
    });
    editForm.value.taskType = "新类型";
    editForm.value.sampleCount = 3;
    editForm.value.sampleCodesText = "TASK-001-SP-020; TASK-001-SP-021；TASK-001-SP-022";

    await saveEdit("TASK-001");

    expect(persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        [STORAGE_KEYS.samples]: expect.arrayContaining([
          expect.objectContaining({ code: "TASK-001-SP-020", task_code: "TASK-001" }),
          expect.objectContaining({ code: "TASK-001-SP-021", task_code: "TASK-001" }),
          expect.objectContaining({ code: "TASK-001-SP-022", task_code: "TASK-001" }),
        ]),
      })
    );
  });

  test("saveEdit updates task and sample data, then refreshes the overview", async () => {
    const snapshot = {
      [STORAGE_KEYS.tasks]: [
        { code: "TASK-001", test_type: "旧类型", name: "旧类型", required_device: "旧类型", sample_count: 1, status: "待排程" },
      ],
      [STORAGE_KEYS.samples]: [{ id: "sample-1", code: "TASK-001-SP-001", task_code: "TASK-001", trays: [] }],
      [STORAGE_KEYS.schedules]: [{ id: "schedule-1", task_code: "TASK-001" }],
      [STORAGE_KEYS.streams]: [],
    };
    const { openEdit, editForm, saveEdit, persistSnapshot, replaceOverview, loadSnapshot } = createEditor({
      loadSnapshot: vi.fn(async () => snapshot),
    });

    openEdit({
      taskCode: "TASK-001",
      taskType: "旧类型",
      sampleCount: 1,
      sampleCodes: ["TASK-001-SP-001"],
    });
    editForm.value.taskType = "新类型";
    editForm.value.sampleCount = 2;
    editForm.value.sampleCodesText = "TASK-001-SP-010\nTASK-001-SP-011";

    await saveEdit("TASK-001");

    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    expect(persistSnapshot).toHaveBeenCalledTimes(1);
    expect(persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        [STORAGE_KEYS.tasks]: [
          expect.objectContaining({
            code: "TASK-001",
            test_type: "新类型",
            sample_count: 2,
          }),
        ],
        [STORAGE_KEYS.samples]: expect.arrayContaining([
          expect.objectContaining({ code: "TASK-001-SP-010", task_code: "TASK-001" }),
          expect.objectContaining({ code: "TASK-001-SP-011", task_code: "TASK-001" }),
        ]),
      })
    );
    expect(replaceOverview).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ code: "TASK-001", test_type: "新类型" })]),
      expect.arrayContaining([expect.objectContaining({ task_code: "TASK-001" })]),
      snapshot[STORAGE_KEYS.schedules]
    );
  });

  test("confirmDeleteTask removes task-linked tasks, samples, schedules, and streams after confirmation", async () => {
    const snapshot = {
      [STORAGE_KEYS.tasks]: [
        { code: "TASK-001", test_type: "A" },
        { code: "TASK-002", test_type: "B" },
      ],
      [STORAGE_KEYS.samples]: [
        { id: "sample-1", code: "TASK-001-SP-001", task_code: "TASK-001" },
        { id: "sample-2", code: "TASK-002-SP-001", task_code: "TASK-002" },
      ],
      [STORAGE_KEYS.schedules]: [
        { id: "schedule-1", task_code: "TASK-001" },
        { id: "schedule-2", task_code: "TASK-002" },
      ],
      [STORAGE_KEYS.streams]: [
        { id: "stream-1", task_code: "TASK-001" },
        { id: "stream-2", task_code: "TASK-002" },
      ],
    };
    const { requestDeleteTask, confirmDeleteTask, deleteConfirm, persistSnapshot, replaceOverview } = createEditor({
      loadSnapshot: vi.fn(async () => snapshot),
    });

    await requestDeleteTask("TASK-001");

    expect(deleteConfirm.value).toEqual({
      taskCode: "TASK-001",
      sampleCount: 1,
      scheduleCount: 1,
      streamCount: 1,
    });

    await confirmDeleteTask("TASK-001");

    expect(persistSnapshot).toHaveBeenCalledWith({
      [STORAGE_KEYS.tasks]: [{ code: "TASK-002", test_type: "B" }],
      [STORAGE_KEYS.samples]: [{ id: "sample-2", code: "TASK-002-SP-001", task_code: "TASK-002" }],
      [STORAGE_KEYS.schedules]: [{ id: "schedule-2", task_code: "TASK-002" }],
      [STORAGE_KEYS.streams]: [{ id: "stream-2", task_code: "TASK-002" }],
    });
    expect(replaceOverview).toHaveBeenCalledWith(
      [{ code: "TASK-002", test_type: "B" }],
      [{ id: "sample-2", code: "TASK-002-SP-001", task_code: "TASK-002" }],
      [{ id: "schedule-2", task_code: "TASK-002" }]
    );
  });

  test("handleGlobalClick clears selection and editing when clicking outside the overview root", () => {
    const { handleCardClick, openEdit, handleGlobalClick, selectedTaskCode, editingTaskCode } = createEditor();
    const row = {
      taskCode: "TASK-001",
      taskType: "类型A",
      sampleCount: 1,
      sampleCodes: ["TASK-001-SP-001"],
    };
    const root = document.createElement("section");
    const outside = document.createElement("button");

    handleCardClick(row);
    openEdit(row);
    handleGlobalClick({ target: outside }, root);

    expect(selectedTaskCode.value).toBe("");
    expect(editingTaskCode.value).toBe("");
  });

  test("handleGlobalClick keeps the current editor open when clicking inside the active editor", () => {
    const { handleCardClick, openEdit, handleGlobalClick, selectedTaskCode, editingTaskCode } = createEditor();
    const row = {
      taskCode: "TASK-001",
      taskType: "类型A",
      sampleCount: 1,
      sampleCodes: ["TASK-001-SP-001"],
    };
    const root = document.createElement("section");
    const card = document.createElement("article");
    card.className = "task-overview-card";
    card.setAttribute("data-task-code", "TASK-001");
    const editor = document.createElement("div");
    editor.className = "task-overview-editor";
    const input = document.createElement("input");

    editor.appendChild(input);
    card.appendChild(editor);
    root.appendChild(card);

    handleCardClick(row);
    openEdit(row);
    handleGlobalClick({ target: input }, root);

    expect(selectedTaskCode.value).toBe("TASK-001");
    expect(editingTaskCode.value).toBe("TASK-001");
  });
});
