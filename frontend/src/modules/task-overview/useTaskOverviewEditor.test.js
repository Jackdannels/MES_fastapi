import { describe, expect, test, vi } from "vitest";

import { STORAGE_KEYS } from "@/lib/storageKeys";
import { useTaskOverviewEditor } from "./useTaskOverviewEditor";

// 用一个轻量工厂把存储、刷新和编辑器实例绑在一起，便于单测覆盖保存/删除分支。
const createEditor = (overrides = {}) => {
  const loadSnapshot = overrides.loadSnapshot || vi.fn();
  const persistSnapshot = overrides.persistSnapshot || vi.fn(() => Promise.resolve());
  const replaceOverview = overrides.replaceOverview || vi.fn();
  const deleteTask = overrides.deleteTask || vi.fn(() => Promise.resolve());

  const editor = useTaskOverviewEditor({
    loadSnapshot,
    persistSnapshot,
    replaceOverview,
    deleteTask,
    experimentTypeOptions: overrides.experimentTypeOptions,
  });

  return {
    ...editor,
    deleteTask,
    loadSnapshot,
    persistSnapshot,
    replaceOverview,
  };
};

// 这里重点守护任务总览内联编辑的两个高风险点：样品编号重排和级联删除。
describe("useTaskOverviewEditor", () => {
  test("builds default experiments from provided master test type options", () => {
    const { openEdit, editForm } = createEditor({
      experimentTypeOptions: ["自定义疲劳试验", "盐雾试验"],
    });

    openEdit({
      taskCode: "TASK-001",
      taskType: "冲击试验",
      sampleCount: 1,
      sampleCodes: ["TASK-001-SP-001"],
      experiments: [],
    });

    expect(editForm.value.experiments.map((experiment) => experiment.requiredDevice)).toEqual([
      "自定义疲劳试验",
      "盐雾试验",
      "自定义疲劳试验",
    ]);
  });

  test("saveEdit accepts semicolon-delimited sample codes", async () => {
    // 用户可能用中英文分号批量粘贴样品号，这里验证解析兼容性。
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
      snapshot[STORAGE_KEYS.schedules],
      expect.arrayContaining([expect.objectContaining({ task_code: "TASK-001", experiment_code: "TASK-001-A" })]),
      [],
      [],
      [],
      []
    );
  });

  test("saveEdit rejects more than 99 pasted sample codes", async () => {
    const snapshot = {
      [STORAGE_KEYS.tasks]: [{ code: "TASK-001", test_type: "旧类型", name: "旧类型", required_device: "旧类型", sample_count: 1 }],
      [STORAGE_KEYS.samples]: [{ id: "sample-1", code: "TASK-001-SP-001", task_code: "TASK-001", trays: [] }],
      [STORAGE_KEYS.schedules]: [],
      [STORAGE_KEYS.streams]: [],
    };
    const { openEdit, editForm, saveEdit, persistSnapshot, editError } = createEditor({
      loadSnapshot: vi.fn(async () => snapshot),
    });

    openEdit({
      taskCode: "TASK-001",
      taskType: "旧类型",
      sampleCount: 1,
      sampleCodes: ["TASK-001-SP-001"],
    });
    editForm.value.sampleCount = 0;
    editForm.value.sampleCodesText = Array.from({ length: 100 }, (_, index) =>
      `TASK-001-SP-${String(index + 1).padStart(3, "0")}`
    ).join("\n");

    await saveEdit("TASK-001");

    expect(persistSnapshot).not.toHaveBeenCalled();
    expect(editError.value).toBe("样品编号最多为 99 个");
  });

  test("saveEdit rejects sample count changes after storage is confirmed with experiments", async () => {
    const snapshot = {
      [STORAGE_KEYS.tasks]: [
        { code: "TASK-001", test_type: "冲击试验", name: "冲击试验", required_device: "冲击试验", sample_count: 2, transfer_status: "到货" },
      ],
      [STORAGE_KEYS.experiments]: [
        { id: "TASK-001-A", task_code: "TASK-001", experiment_code: "TASK-001-A", experiment_name: "冲击试验" },
      ],
      [STORAGE_KEYS.samples]: [
        { id: "sample-1", code: "TASK-001-SP-001", task_code: "TASK-001", status: "到货", trays: [] },
        { id: "sample-2", code: "TASK-001-SP-002", task_code: "TASK-001", status: "到货", trays: [] },
      ],
      [STORAGE_KEYS.schedules]: [],
      [STORAGE_KEYS.streams]: [],
    };
    const { openEdit, editForm, saveEdit, persistSnapshot, editError } = createEditor({
      loadSnapshot: vi.fn(async () => snapshot),
    });

    openEdit({
      taskCode: "TASK-001",
      taskType: "冲击试验",
      sampleCount: 2,
      sampleCodes: ["TASK-001-SP-001", "TASK-001-SP-002"],
      experiments: [{ experimentCode: "TASK-001-A", experimentName: "冲击试验", requiredDevice: "冲击试验" }],
    });
    editForm.value.sampleCount = 3;
    editForm.value.sampleCodesText = "TASK-001-SP-001\nTASK-001-SP-002\nTASK-001-SP-003";

    await saveEdit("TASK-001");

    expect(persistSnapshot).not.toHaveBeenCalled();
    expect(editError.value).toBe("该任务样品已在接驳区确认到货，不允许更改样品数量");
  });

  test("saveEdit persists task experiments and updates task experiment summary fields", async () => {
    const snapshot = {
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-03-006", test_type: "四综合试验", name: "四综合试验", required_device: "四综合试验", sample_count: 1, status: "待排程" },
      ],
      [STORAGE_KEYS.experiments]: [],
      [STORAGE_KEYS.experiment_trays]: [],
      [STORAGE_KEYS.samples]: [{ id: "sample-1", code: "SYLU-2026-03-006-SP-001", task_code: "SYLU-2026-03-006", trays: [] }],
      [STORAGE_KEYS.schedules]: [],
      [STORAGE_KEYS.streams]: [],
    };
    const { openEdit, editForm, saveEdit, persistSnapshot } = createEditor({
      loadSnapshot: vi.fn(async () => snapshot),
    });

    openEdit({
      taskCode: "SYLU-2026-03-006",
      taskType: "四综合试验",
      sampleCount: 1,
      sampleCodes: ["SYLU-2026-03-006-SP-001"],
      experiments: [],
    });
    editForm.value.experiments = [
      { experimentCode: "SYLU-2026-03-006-A", experimentName: "A实验", requiredDevice: "四综合试验", priority: "高", plannedHours: 3.5 },
      { experimentCode: "SYLU-2026-03-006-B", experimentName: "B实验", requiredDevice: "振动试验", priority: "中", plannedHours: 4 },
    ];

    await saveEdit("SYLU-2026-03-006");

    expect(persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        [STORAGE_KEYS.tasks]: [
          expect.objectContaining({
            code: "SYLU-2026-03-006",
            experiment_count: 2,
            experiment_codes: ["SYLU-2026-03-006-A", "SYLU-2026-03-006-B"],
          }),
        ],
        [STORAGE_KEYS.experiments]: [
          expect.objectContaining({ task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "A实验" }),
          expect.objectContaining({ task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "B实验" }),
        ],
      })
    );
  });

  test("confirmDeleteTask removes task-linked tasks, samples, schedules, and streams after confirmation", async () => {
    // 删除确认不仅删任务本身，还要级联清理样品、排程和数据流。
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
      [STORAGE_KEYS.experiment_runs]: [
        { id: "run-1", task_code: "TASK-001", experiment_code: "TASK-001-A" },
        { id: "run-2", task_code: "TASK-002", experiment_code: "TASK-002-A" },
      ],
      [STORAGE_KEYS.experiment_run_trays]: [
        { id: "run-tray-1", task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TP-001" },
        { id: "run-tray-2", task_code: "TASK-002", experiment_code: "TASK-002-A", tray_code: "TP-002" },
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

    expect(persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        [STORAGE_KEYS.tasks]: [{ code: "TASK-002", test_type: "B" }],
        [STORAGE_KEYS.samples]: [{ id: "sample-2", code: "TASK-002-SP-001", task_code: "TASK-002" }],
        [STORAGE_KEYS.schedules]: [{ id: "schedule-2", task_code: "TASK-002" }],
        [STORAGE_KEYS.streams]: [{ id: "stream-2", task_code: "TASK-002" }],
        [STORAGE_KEYS.experiment_runs]: [{ id: "run-2", task_code: "TASK-002", experiment_code: "TASK-002-A" }],
        [STORAGE_KEYS.experiment_run_trays]: [{ id: "run-tray-2", task_code: "TASK-002", experiment_code: "TASK-002-A", tray_code: "TP-002" }],
      })
    );
    expect(replaceOverview).toHaveBeenCalledWith(
      [{ code: "TASK-002", test_type: "B" }],
      [{ id: "sample-2", code: "TASK-002-SP-001", task_code: "TASK-002" }],
      [{ id: "schedule-2", task_code: "TASK-002" }],
      [],
      [],
      [{ id: "run-2", task_code: "TASK-002", experiment_code: "TASK-002-A" }],
      [{ id: "run-tray-2", task_code: "TASK-002", experiment_code: "TASK-002-A", tray_code: "TP-002" }],
      []
    );
  });

  test("confirmDeleteTask also removes task-linked experiments and experiment trays", async () => {
    const snapshot = {
      [STORAGE_KEYS.tasks]: [{ code: "TASK-001", test_type: "A" }, { code: "TASK-002", test_type: "B" }],
      [STORAGE_KEYS.experiments]: [
        { id: "exp-1", task_code: "TASK-001", experiment_code: "TASK-001-A" },
        { id: "exp-2", task_code: "TASK-002", experiment_code: "TASK-002-A" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { id: "rel-1", task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TASK-001-TP-001" },
        { id: "rel-2", task_code: "TASK-002", experiment_code: "TASK-002-A", tray_code: "TASK-002-TP-001" },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        { id: "run-1", task_code: "TASK-001", experiment_code: "TASK-001-A" },
        { id: "run-2", task_code: "TASK-002", experiment_code: "TASK-002-A" },
      ],
      [STORAGE_KEYS.experiment_run_trays]: [
        { id: "run-tray-1", task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TASK-001-TP-001" },
        { id: "run-tray-2", task_code: "TASK-002", experiment_code: "TASK-002-A", tray_code: "TASK-002-TP-001" },
      ],
      [STORAGE_KEYS.samples]: [],
      [STORAGE_KEYS.schedules]: [],
      [STORAGE_KEYS.streams]: [],
    };
    const { requestDeleteTask, confirmDeleteTask, persistSnapshot } = createEditor({
      loadSnapshot: vi.fn(async () => snapshot),
    });

    await requestDeleteTask("TASK-001");
    await confirmDeleteTask("TASK-001");

    expect(persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        [STORAGE_KEYS.experiments]: [{ id: "exp-2", task_code: "TASK-002", experiment_code: "TASK-002-A" }],
        [STORAGE_KEYS.experiment_trays]: [{ id: "rel-2", task_code: "TASK-002", experiment_code: "TASK-002-A", tray_code: "TASK-002-TP-001" }],
        [STORAGE_KEYS.experiment_runs]: [{ id: "run-2", task_code: "TASK-002", experiment_code: "TASK-002-A" }],
        [STORAGE_KEYS.experiment_run_trays]: [{ id: "run-tray-2", task_code: "TASK-002", experiment_code: "TASK-002-A", tray_code: "TASK-002-TP-001" }],
      })
    );
  });

  test("confirmDeleteTask also calls the dedicated tasks delete api before refreshing overview", async () => {
    const snapshot = {
      [STORAGE_KEYS.tasks]: [
        { code: "TASK-001", test_type: "A" },
        { code: "TASK-002", test_type: "B" },
      ],
      [STORAGE_KEYS.samples]: [],
      [STORAGE_KEYS.schedules]: [],
      [STORAGE_KEYS.streams]: [],
    };
    const deleteTask = vi.fn(() => Promise.resolve());
    const { requestDeleteTask, confirmDeleteTask } = createEditor({
      loadSnapshot: vi.fn(async () => snapshot),
      deleteTask,
    });

    await requestDeleteTask("TASK-001");
    await confirmDeleteTask("TASK-001");

    expect(deleteTask).toHaveBeenCalledWith("TASK-001");
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
    // 点击当前编辑器内部元素不应被误判为“点击外部”。
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
