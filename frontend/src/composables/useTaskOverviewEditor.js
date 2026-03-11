import { ref } from "vue";

import { STORAGE_KEYS } from "@/lib/storageKeys";

const createEmptyDeleteConfirm = () => ({
  taskCode: "",
  sampleCount: 0,
  scheduleCount: 0,
  streamCount: 0,
});

const createEmptyEditForm = () => ({
  taskCode: "",
  taskType: "",
  sampleCount: 0,
  sampleCodesText: "",
});

const normalizeCount = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");

const splitCodeText = (value) =>
  String(value || "")
    .split(/[\n\r,，、;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const uniqueCodes = (codes) => {
  const seen = new Set();
  const output = [];
  (Array.isArray(codes) ? codes : []).forEach((code) => {
    if (seen.has(code)) {
      return;
    }
    seen.add(code);
    output.push(code);
  });
  return output;
};

const buildGeneratedSampleCodes = (taskCode, count, occupiedCodes = new Set()) => {
  const safeTaskCode = String(taskCode || "").trim();
  const targetCount = normalizeCount(count);
  if (!safeTaskCode || targetCount <= 0) {
    return [];
  }
  const output = [];
  let index = 1;
  while (output.length < targetCount) {
    const nextCode = `${safeTaskCode}-SP-${String(index).padStart(3, "0")}`;
    if (!occupiedCodes.has(nextCode)) {
      output.push(nextCode);
      occupiedCodes.add(nextCode);
    }
    index += 1;
    if (index > 9999) {
      break;
    }
  }
  return output;
};

function useTaskOverviewEditor({ loadSnapshot, persistSnapshot, replaceOverview }) {
  const selectedTaskCode = ref("");
  const editingTaskCode = ref("");
  const savingTaskCode = ref("");
  const deletingTaskCode = ref("");
  const deleteConfirm = ref(createEmptyDeleteConfirm());
  const editError = ref("");
  const editMessage = ref("");
  const editForm = ref(createEmptyEditForm());

  const resetDeleteConfirm = () => {
    deleteConfirm.value = createEmptyDeleteConfirm();
  };

  const clearEditFeedback = () => {
    editError.value = "";
    editMessage.value = "";
  };

  const isEditing = (taskCode) => editingTaskCode.value === String(taskCode || "").trim();

  const openEdit = (row) => {
    const code = String(row?.taskCode || "").trim();
    if (!code) {
      return;
    }
    resetDeleteConfirm();
    if (isEditing(code)) {
      editingTaskCode.value = "";
      clearEditFeedback();
      return;
    }
    editingTaskCode.value = code;
    clearEditFeedback();
    editForm.value = {
      taskCode: code,
      taskType: String(row?.taskType || "").trim(),
      sampleCount: normalizeCount(row?.sampleCount),
      sampleCodesText: (Array.isArray(row?.sampleCodes) ? row.sampleCodes : []).join("\n"),
    };
  };

  const cancelEdit = () => {
    resetDeleteConfirm();
    editingTaskCode.value = "";
    clearEditFeedback();
  };

  const handleCardClick = (row) => {
    const code = String(row?.taskCode || "").trim();
    if (!code) {
      return;
    }
    if (editingTaskCode.value === code) {
      cancelEdit();
      return;
    }
    if (editingTaskCode.value && editingTaskCode.value !== code) {
      cancelEdit();
    }
    selectedTaskCode.value = selectedTaskCode.value === code ? "" : code;
  };

  const handleCardDblClick = (row) => {
    const code = String(row?.taskCode || "").trim();
    if (!code || isEditing(code)) {
      return;
    }
    selectedTaskCode.value = code;
    openEdit(row);
  };

  const handleGlobalClick = (event, overviewRoot) => {
    const target = event?.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!(overviewRoot instanceof Element)) {
      return;
    }
    if (!overviewRoot.contains(target)) {
      selectedTaskCode.value = "";
      if (editingTaskCode.value) {
        cancelEdit();
      }
      return;
    }
    const clickedCard = target.closest(".task-overview-card");
    if (!clickedCard) {
      selectedTaskCode.value = "";
      if (editingTaskCode.value) {
        cancelEdit();
      }
      return;
    }
    if (!editingTaskCode.value) {
      return;
    }
    const clickedTaskCode = String(clickedCard.getAttribute("data-task-code") || "").trim();
    if (!clickedTaskCode || clickedTaskCode !== editingTaskCode.value) {
      cancelEdit();
      return;
    }
    if (!target.closest(".task-overview-editor")) {
      cancelEdit();
    }
  };

  const generateCodesByCount = () => {
    const taskCode = String(editForm.value.taskCode || "").trim();
    const count = normalizeCount(editForm.value.sampleCount);
    if (!taskCode) {
      editError.value = "Missing task code. Unable to generate sample codes.";
      return;
    }
    clearEditFeedback();
    const generated = buildGeneratedSampleCodes(taskCode, count, new Set());
    editForm.value.sampleCodesText = generated.join("\n");
  };

  const updateEditForm = (patch) => {
    if (!patch || typeof patch !== "object") {
      return;
    }
    editForm.value = {
      ...editForm.value,
      ...patch,
    };
  };

  const saveEdit = async (taskCode) => {
    const code = String(taskCode || editForm.value.taskCode || "").trim();
    if (!code || savingTaskCode.value) {
      return;
    }

    const nextTaskType = String(editForm.value.taskType || "").trim();
    if (!nextTaskType) {
      editError.value = "Task type is required.";
      editMessage.value = "";
      return;
    }

    savingTaskCode.value = code;
    clearEditFeedback();

    try {
      const snapshot = await loadSnapshot();
      const tasks = snapshot[STORAGE_KEYS.tasks];
      const samples = snapshot[STORAGE_KEYS.samples];
      const schedules = snapshot[STORAGE_KEYS.schedules];
      const taskIndex = tasks.findIndex((task) => String(task?.code || "").trim() === code);
      if (taskIndex < 0) {
        editError.value = `Task ${code} was not found.`;
        return;
      }

      const inputCodes = uniqueCodes(splitCodeText(editForm.value.sampleCodesText));
      let desiredCount = normalizeCount(editForm.value.sampleCount);
      if (desiredCount <= 0) {
        desiredCount = inputCodes.length;
      }

      let finalCodes = inputCodes.slice(0, desiredCount || inputCodes.length);
      if (desiredCount > finalCodes.length) {
        const occupied = new Set(finalCodes);
        const generated = buildGeneratedSampleCodes(code, desiredCount - finalCodes.length, occupied);
        finalCodes = finalCodes.concat(generated);
      }
      finalCodes = uniqueCodes(finalCodes);
      if (desiredCount > finalCodes.length) {
        const generated = buildGeneratedSampleCodes(code, desiredCount - finalCodes.length, new Set(finalCodes));
        finalCodes = finalCodes.concat(generated);
      }

      const otherTaskCodeSet = new Set(
        samples
          .filter((sample) => String(sample?.task_code || "").trim() !== code)
          .map((sample) => String(sample?.code || "").trim())
          .filter(Boolean)
      );
      const duplicateWithOthers = finalCodes.filter((sampleCode) => otherTaskCodeSet.has(sampleCode));
      if (duplicateWithOthers.length > 0) {
        editError.value = `Sample codes already in use: ${duplicateWithOthers.join(", ")}`;
        return;
      }

      const now = new Date().toISOString();
      const taskSamples = samples
        .filter((sample) => String(sample?.task_code || "").trim() === code)
        .sort((left, right) => compareText(left?.code, right?.code));

      const nextTaskSamples = finalCodes.map((sampleCode, index) => {
        const existing = taskSamples[index];
        if (existing) {
          const updated = {
            ...existing,
            code: sampleCode,
            task_code: code,
            updated_at: now,
          };
          if (Array.isArray(existing.trays)) {
            updated.trays = existing.trays.map((tray) => ({
              ...tray,
              sample_code: sampleCode,
              updated_at: now,
            }));
          }
          return updated;
        }

        return {
          id: `sample-${Date.now()}-${index}`,
          code: sampleCode,
          task_code: code,
          location: "",
          owner: "",
          status: "运输中",
          flow_status: "运输中",
          created_at: now,
        };
      });

      const nextTasks = tasks.map((task, index) => {
        if (index !== taskIndex) {
          return task;
        }
        return {
          ...task,
          test_type: nextTaskType,
          name: nextTaskType,
          required_device: nextTaskType,
          sample_count: finalCodes.length,
          updated_at: now,
        };
      });

      const nextSamples = samples
        .filter((sample) => String(sample?.task_code || "").trim() !== code)
        .concat(nextTaskSamples);

      await persistSnapshot({
        [STORAGE_KEYS.tasks]: nextTasks,
        [STORAGE_KEYS.samples]: nextSamples,
      });

      replaceOverview(nextTasks, nextSamples, schedules);
      editForm.value.sampleCount = finalCodes.length;
      editForm.value.sampleCodesText = finalCodes.join("\n");
      editMessage.value = `Task ${code} was updated.`;
    } finally {
      savingTaskCode.value = "";
    }
  };

  const requestDeleteTask = async (taskCode) => {
    const code = String(taskCode || editForm.value.taskCode || "").trim();
    if (!code || savingTaskCode.value || deletingTaskCode.value) {
      return;
    }

    const snapshot = await loadSnapshot();
    const tasks = snapshot[STORAGE_KEYS.tasks];
    const samples = snapshot[STORAGE_KEYS.samples];
    const schedules = snapshot[STORAGE_KEYS.schedules];
    const streams = snapshot[STORAGE_KEYS.streams];
    const taskExists = tasks.some((task) => String(task?.code || "").trim() === code);
    if (!taskExists) {
      editError.value = `Task ${code} was not found.`;
      editMessage.value = "";
      return;
    }

    deleteConfirm.value = {
      taskCode: code,
      sampleCount: samples.filter((sample) => String(sample?.task_code || "").trim() === code).length,
      scheduleCount: schedules.filter((entry) => String(entry?.task_code || "").trim() === code).length,
      streamCount: streams.filter((entry) => String(entry?.task_code || "").trim() === code).length,
    };
    clearEditFeedback();
  };

  const confirmDeleteTask = async (taskCode) => {
    const code = String(taskCode || editForm.value.taskCode || "").trim();
    if (!code || savingTaskCode.value || deletingTaskCode.value) {
      return;
    }
    if (deleteConfirm.value.taskCode !== code) {
      await requestDeleteTask(code);
      return;
    }

    deletingTaskCode.value = code;
    clearEditFeedback();
    try {
      const snapshot = await loadSnapshot();
      const tasks = snapshot[STORAGE_KEYS.tasks];
      const samples = snapshot[STORAGE_KEYS.samples];
      const schedules = snapshot[STORAGE_KEYS.schedules];
      const streams = snapshot[STORAGE_KEYS.streams];
      const nextTasks = tasks.filter((task) => String(task?.code || "").trim() !== code);
      const nextSamples = samples.filter((sample) => String(sample?.task_code || "").trim() !== code);
      const nextSchedules = schedules.filter((entry) => String(entry?.task_code || "").trim() !== code);
      const nextStreams = streams.filter((entry) => String(entry?.task_code || "").trim() !== code);

      await persistSnapshot({
        [STORAGE_KEYS.tasks]: nextTasks,
        [STORAGE_KEYS.samples]: nextSamples,
        [STORAGE_KEYS.schedules]: nextSchedules,
        [STORAGE_KEYS.streams]: nextStreams,
      });

      replaceOverview(nextTasks, nextSamples, nextSchedules);
      selectedTaskCode.value = "";
      cancelEdit();
    } finally {
      deletingTaskCode.value = "";
      resetDeleteConfirm();
    }
  };

  return {
    selectedTaskCode,
    editingTaskCode,
    savingTaskCode,
    deletingTaskCode,
    deleteConfirm,
    editError,
    editMessage,
    editForm,
    isEditing,
    openEdit,
    cancelEdit,
    resetDeleteConfirm,
    handleCardClick,
    handleCardDblClick,
    handleGlobalClick,
    generateCodesByCount,
    saveEdit,
    requestDeleteTask,
    confirmDeleteTask,
    updateEditForm,
  };
}

export { useTaskOverviewEditor };
