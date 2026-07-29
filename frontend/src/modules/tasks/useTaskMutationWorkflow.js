import { collectExperimentTypes, buildExperimentTypeSummary } from "@/lib/experimentTypes";
import { formatLocalDateTime, parseBusinessDateTimeToMs } from "@/lib/dateTime";
import { serverNowMs } from "@/lib/serverClock";
import { deleteTask as deleteTaskByApi, updateTask as updateTaskByApi } from "@/lib/tasksApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import {
  applyTaskSampleCodes,
  deleteTaskSnapshot,
  normalizeTaskSampleCount,
  normalizeText,
  splitSampleCodeText,
  syncTaskSamples,
  updateTaskRecord,
  validateSampleCodeDraft,
  validateTaskSampleCount,
  validateTaskTextFields,
} from "./model";

const SAMPLE_COUNT_LOCKED_MESSAGE = "该任务已保存预接驳托盘或已确认到货，请先重新入库后再修改样品数量";

function useTaskMutationWorkflow({
  arraysEqual,
  buildFailureMessage,
  closeSampleCodesEditor,
  closeTaskDrawer,
  editForm,
  editWarning,
  experimentCodeOf,
  isTaskDetailLocked,
  loadError,
  loadTasksPage,
  persistRelated,
  rawExperimentRuns,
  rawExperimentRunTrays,
  rawExperiments,
  rawExperimentSamples,
  rawExperimentTrays,
  rawSamples,
  rawSchedules,
  rawStreams,
  rawTasks,
  readAllTasks,
  resolveScheduledExperimentRemoval,
  resetSamplesForExperimentTypeChange,
  sampleCodesDraft,
  sampleCodesWarning,
  sampleCountChanged,
  scheduledExperimentRemovalDraft,
  scheduledExperimentRemovalModal,
  taskCodeOf,
  taskDetailSampleCodes,
  taskSampleCountLocked,
  taskStorageConfirmed,
}) {
  const closeScheduledExperimentRemovalConfirm = () => {
    scheduledExperimentRemovalModal.close();
    scheduledExperimentRemovalDraft.value = null;
  };

  const performTaskUpdate = async (draft, options = {}) => {
    const { previousCode, tasks, updatedTask, affectedCodes = new Set(), experimentTypesChanged = false } = draft;
    const confirmRemoval = Boolean(options.confirmRemoveScheduledExperiments);
    try {
      await updateTaskByApi(editForm.value.id, confirmRemoval
        ? { ...updatedTask, confirm_remove_scheduled_experiments: true }
        : updatedTask);
      rawTasks.value = tasks;
    } catch (error) {
      editWarning.value = buildFailureMessage("任务更新失败，请稍后重试", error);
      return;
    }
    const syncedSamples = syncTaskSamples(rawSamples.value, updatedTask, previousCode, { preserveExistingCodes: true });
    const nextSamples = experimentTypesChanged
      ? resetSamplesForExperimentTypeChange(syncedSamples, taskCodeOf(updatedTask))
      : syncedSamples;
    const relatedUpdates = { [STORAGE_KEYS.samples]: nextSamples };
    if (experimentTypesChanged) {
      const taskCodesToClean = new Set([previousCode, taskCodeOf(updatedTask)].map(normalizeText).filter(Boolean));
      relatedUpdates[STORAGE_KEYS.schedules] = rawSchedules.value.filter(
        (schedule) => !taskCodesToClean.has(taskCodeOf(schedule)),
      );
      relatedUpdates[STORAGE_KEYS.experiment_trays] = rawExperimentTrays.value.filter(
        (entry) => !taskCodesToClean.has(taskCodeOf(entry)),
      );
      relatedUpdates[STORAGE_KEYS.experiment_samples] = rawExperimentSamples.value.filter(
        (entry) => !taskCodesToClean.has(taskCodeOf(entry)),
      );
    } else if (affectedCodes.size > 0) {
      const taskCodesToClean = new Set([previousCode, taskCodeOf(updatedTask)].map(normalizeText).filter(Boolean));
      relatedUpdates[STORAGE_KEYS.schedules] = rawSchedules.value.filter(
        (schedule) => !(taskCodesToClean.has(taskCodeOf(schedule)) && affectedCodes.has(experimentCodeOf(schedule))),
      );
      relatedUpdates[STORAGE_KEYS.experiment_trays] = rawExperimentTrays.value.filter(
        (entry) => !(taskCodesToClean.has(taskCodeOf(entry)) && affectedCodes.has(experimentCodeOf(entry))),
      );
      relatedUpdates[STORAGE_KEYS.experiment_samples] = rawExperimentSamples.value.filter(
        (entry) => !(taskCodesToClean.has(taskCodeOf(entry)) && affectedCodes.has(experimentCodeOf(entry))),
      );
    }
    try {
      await persistRelated(relatedUpdates);
    } catch (error) {
      closeTaskDrawer();
      loadError.value = buildFailureMessage("任务已更新，但关联数据保存失败，请刷新后确认", error);
      return;
    }
    closeTaskDrawer();
    closeScheduledExperimentRemovalConfirm();
    try {
      await loadTasksPage();
      loadError.value = "";
    } catch (error) {
      loadError.value = buildFailureMessage("任务已更新，但任务列表刷新失败，请刷新后确认", error);
    }
  };

  const updateCompletedTaskName = async (originalTask) => {
    const updatedTask = { ...originalTask, name: normalizeText(editForm.value.name) };
    const textWarning = validateTaskTextFields(updatedTask);
    if (textWarning) {
      editWarning.value = textWarning;
      return;
    }
    try {
      const savedTask = await updateTaskByApi(editForm.value.id, updatedTask);
      const nextTask = savedTask && typeof savedTask === "object" ? savedTask : updatedTask;
      rawTasks.value = rawTasks.value.map((task) => (
        normalizeText(task?.id) === normalizeText(editForm.value.id) ? nextTask : task
      ));
    } catch (error) {
      editWarning.value = buildFailureMessage("任务更新失败，请稍后重试", error);
      return;
    }
    closeTaskDrawer();
    try {
      await loadTasksPage();
      loadError.value = "";
    } catch (error) {
      loadError.value = buildFailureMessage("任务已更新，但任务列表刷新失败，请刷新后确认", error);
    }
  };

  const updateTask = async () => {
    const originalTask = rawTasks.value.find((task) => normalizeText(task?.id) === normalizeText(editForm.value.id));
    if (!originalTask) return;
    if (isTaskDetailLocked.value) {
      await updateCompletedTaskName(originalTask);
      return;
    }
    const dueAtTime = parseBusinessDateTimeToMs(editForm.value.due_at);
    const originalDueAtTime = parseBusinessDateTimeToMs(originalTask?.due_at);
    const dueAtChanged = dueAtTime !== originalDueAtTime;
    if (dueAtChanged && Number.isFinite(dueAtTime) && dueAtTime < serverNowMs()) {
      editWarning.value = "期望完成时间不能早于当前时间";
      return;
    }
    if (Array.isArray(editForm.value.test_types)) {
      editForm.value.test_type = buildExperimentTypeSummary(editForm.value.test_types);
    }
    if (!Array.isArray(editForm.value.test_types) || editForm.value.test_types.length === 0) {
      editWarning.value = "请选择至少一个试验类型";
      return;
    }
    const sampleCountWarning = validateTaskSampleCount(editForm.value.sample_count);
    if (sampleCountWarning) {
      editWarning.value = sampleCountWarning;
      return;
    }
    const { previousCode, tasks } = updateTaskRecord(rawTasks.value, editForm.value);
    const updatedTask = tasks.find((task) => normalizeText(task?.id) === normalizeText(editForm.value.id));
    if (!updatedTask) return;
    const textWarning = validateTaskTextFields(updatedTask);
    if (textWarning) {
      editWarning.value = textWarning;
      return;
    }
    const originalTypes = collectExperimentTypes(originalTask?.test_types, originalTask?.test_type);
    const nextTypes = collectExperimentTypes(updatedTask?.test_types, updatedTask?.test_type);
    const experimentTypesChanged = !arraysEqual(originalTypes, nextTypes);
    if (sampleCountChanged(originalTask, updatedTask)
      && taskSampleCountLocked(originalTask, rawSamples.value)) {
      editWarning.value = SAMPLE_COUNT_LOCKED_MESSAGE;
      return;
    }
    if (experimentTypesChanged && taskStorageConfirmed(originalTask, rawSamples.value)) {
      editWarning.value = "该任务样品已在接驳区确认到货，不允许更改实验类型";
      return;
    }
    const scheduledRemoval = experimentTypesChanged
      ? resolveScheduledExperimentRemoval(taskCodeOf(originalTask), nextTypes)
      : { affectedCodes: new Set(), schedules: [] };
    const normalizedUpdatedTask = experimentTypesChanged
      ? { ...updatedTask, status: "待排程", transfer_status: "未入库", tray_codes: [] }
      : updatedTask;
    const normalizedTasks = experimentTypesChanged
      ? tasks.map((task) => (normalizeText(task?.id) === normalizeText(editForm.value.id) ? normalizedUpdatedTask : task))
      : tasks;
    const draft = {
      previousCode,
      tasks: normalizedTasks,
      updatedTask: normalizedUpdatedTask,
      affectedCodes: scheduledRemoval.affectedCodes,
      experimentTypesChanged,
    };
    if (experimentTypesChanged) {
      scheduledExperimentRemovalDraft.value = draft;
      scheduledExperimentRemovalModal.openWith({
        id: "task-scheduled-removal-confirm",
        schedules: scheduledRemoval.schedules,
      });
      return;
    }
    await performTaskUpdate(draft);
  };

  const confirmScheduledExperimentRemoval = async () => {
    if (!scheduledExperimentRemovalDraft.value) {
      closeScheduledExperimentRemovalConfirm();
      return;
    }
    await performTaskUpdate(scheduledExperimentRemovalDraft.value, { confirmRemoveScheduledExperiments: true });
  };

  const saveSampleCodes = async () => {
    const taskCode = normalizeText(editForm.value.code);
    const taskId = normalizeText(editForm.value.id);
    const codes = splitSampleCodeText(sampleCodesDraft.value);
    const warning = validateSampleCodeDraft({ codes, samples: rawSamples.value, taskCode });
    if (warning) {
      sampleCodesWarning.value = warning;
      return;
    }
    const originalTask = rawTasks.value.find((task) => normalizeText(task?.id) === taskId);
    if (!originalTask) {
      sampleCodesWarning.value = "当前任务不存在，请刷新后重试";
      return;
    }
    const originalCount = normalizeTaskSampleCount(originalTask?.sample_count, taskDetailSampleCodes.value.length);
    if (codes.length !== originalCount
      && taskSampleCountLocked(originalTask, rawSamples.value)) {
      sampleCodesWarning.value = SAMPLE_COUNT_LOCKED_MESSAGE;
      return;
    }
    const updatedTask = { ...originalTask, sample_count: codes.length, updated_at: formatLocalDateTime() };
    try {
      await updateTaskByApi(taskId, updatedTask);
      rawTasks.value = rawTasks.value.map((task) => (normalizeText(task?.id) === taskId ? updatedTask : task));
    } catch (error) {
      sampleCodesWarning.value = buildFailureMessage("样品编号保存失败，请稍后重试", error);
      return;
    }
    const currentCodes = taskDetailSampleCodes.value;
    const sampleCodeMap = new Map();
    currentCodes.forEach((code, index) => {
      const nextCode = normalizeText(codes[index]);
      const currentCode = normalizeText(code);
      if (currentCode && nextCode && currentCode !== nextCode) sampleCodeMap.set(currentCode, nextCode);
    });
    const currentCodeSet = new Set(currentCodes.map(normalizeText).filter(Boolean));
    const nextCodeSet = new Set(codes.map(normalizeText).filter(Boolean));
    const nextSamples = applyTaskSampleCodes(rawSamples.value, updatedTask, codes);
    const nextExperimentSamples = rawExperimentSamples.value.map((entry) => {
      if (normalizeText(entry?.task_code) !== taskCode) return entry;
      const currentCode = normalizeText(entry?.sample_code);
      const nextCode = sampleCodeMap.get(currentCode) || currentCode;
      return nextCode ? { ...entry, sample_code: nextCode } : entry;
    }).filter((entry) => {
      if (normalizeText(entry?.task_code) !== taskCode) return true;
      const sampleCode = normalizeText(entry?.sample_code);
      return !currentCodeSet.has(sampleCode) || nextCodeSet.has(sampleCode);
    });
    try {
      await persistRelated({
        [STORAGE_KEYS.samples]: nextSamples,
        [STORAGE_KEYS.experiment_samples]: nextExperimentSamples,
      });
    } catch (error) {
      sampleCodesWarning.value = buildFailureMessage("样品编号已更新任务数量，但样品数据保存失败，请刷新后确认", error);
      return;
    }
    editForm.value.sample_count = String(codes.length);
    closeSampleCodesEditor();
    try {
      await loadTasksPage();
      loadError.value = "";
    } catch (error) {
      loadError.value = buildFailureMessage("样品编号已保存，但任务列表刷新失败，请刷新后确认", error);
    }
  };

  const deleteTask = async () => {
    const nextSnapshot = deleteTaskSnapshot({
      experimentRuns: rawExperimentRuns.value,
      experimentRunTrays: rawExperimentRunTrays.value,
      experiments: rawExperiments.value,
      samples: rawSamples.value,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    }, editForm.value.id);
    if (nextSnapshot.error) {
      editWarning.value = nextSnapshot.error;
      return;
    }
    try {
      await deleteTaskByApi(editForm.value.id);
      rawTasks.value = nextSnapshot.tasks;
    } catch (error) {
      editWarning.value = buildFailureMessage("任务删除失败，请稍后重试", error);
      return;
    }
    try {
      await persistRelated({
        [STORAGE_KEYS.schedules]: nextSnapshot.schedules,
        [STORAGE_KEYS.samples]: nextSnapshot.samples,
        [STORAGE_KEYS.streams]: nextSnapshot.streams,
      });
    } catch (error) {
      closeTaskDrawer();
      loadError.value = buildFailureMessage("任务已删除，但关联数据保存失败，请刷新后确认", error);
      return;
    }
    closeTaskDrawer();
    try {
      rawTasks.value = await readAllTasks();
      loadError.value = "";
    } catch (error) {
      loadError.value = buildFailureMessage("任务已删除，但任务列表刷新失败，请刷新后确认", error);
    }
  };

  return {
    closeScheduledExperimentRemovalConfirm,
    confirmScheduledExperimentRemoval,
    deleteTask,
    saveSampleCodes,
    updateTask,
  };
}

export { useTaskMutationWorkflow };
