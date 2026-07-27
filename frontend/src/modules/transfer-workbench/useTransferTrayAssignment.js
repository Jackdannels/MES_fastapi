import { computed, ref } from "vue";

import {
  buildAllocationPayload as buildTrayAllocationPayload,
  buildInventorySlots,
  buildRebalancedTrayLayout,
  createTaskTrayRef as createLayoutTaskTrayRef,
  normalizeEditableTrays as normalizeLayoutEditableTrays,
  normalizeTraySamples,
} from "./transferTrayLayoutModel";
import {
  normalizeTaskStatus,
  normalizeTrayLimit,
  resolveExperimentDisplayName,
} from "./model";

function useTransferTrayAssignment({
  currentTask,
  mode,
  pendingStatus,
  selectedTaskId,
  showWorkbenchFeedback,
  storageOperationPending,
  storedStatus,
}) {
  const assignedTrays = ref([]);
  const experiments = ref([]);
  const activeAssignmentMode = ref("task");
  const draftExperimentTraySelections = ref({});
  const availableInventory = ref([]);
  const trayLimit = ref(16);
  const trayLimitInputVersion = ref(0);
  const trayLimitInputKey = computed(() => `tray-limit-${trayLimit.value}-${trayLimitInputVersion.value}`);
  const activeTrayIndex = ref(-1);
  const armedTrayIndex = ref(-1);
  const draggingSampleId = ref(null);
  const draggingFromTrayIndex = ref(-1);
  const selectedSampleId = ref(null);
  const selectedSampleTrayIndex = ref(-1);
  const allocationSaved = ref(false);
  const barcodePrintConfirmed = ref(false);
  const lockedOperationHint = ref("");
  const trayExperimentIndexRevision = ref(0);
  const experimentCodesByTrayNo = new Map();
  const SAVED_ALLOCATION_HINT = "托盘已保存，若想更改请重新入库";

  const rawAvailableInventoryCount = computed(() => availableInventory.value.length);
  const totalAssignedSampleCount = computed(() => assignedTrays.value.reduce((sum, tray) => sum + tray.samples.length, 0));
  const minimumTrayCount = computed(() => Math.max(1, Math.ceil(totalAssignedSampleCount.value / Math.max(1, trayLimit.value))));
  const loadedTrayCount = computed(() => assignedTrays.value.filter((tray) => tray.samples.length > 0).length);
  const isStoredTask = computed(() => normalizeTaskStatus(currentTask.value?.taskStatus) === storedStatus);
  const isStorageOperationPending = computed(() => Boolean(storageOperationPending?.value));
  const isExperimentMode = computed(() => activeAssignmentMode.value !== "task");
  const currentExperimentCode = computed(() => (isExperimentMode.value ? activeAssignmentMode.value : ""));
  const currentExperimentName = computed(() => resolveExperimentDisplayName(
    experiments.value.find((item) => item.experimentCode === currentExperimentCode.value),
  ));
  const allocationReadOnly = computed(() => (
    isStoredTask.value || allocationSaved.value || isStorageOperationPending.value
  ));
  const experimentSelectionLocked = computed(() => allocationReadOnly.value);
  const taskEditingLocked = computed(() => allocationReadOnly.value || isExperimentMode.value);
  const canDragSamples = computed(() => !taskEditingLocked.value);
  const parseNonNegativeCount = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const explicitMaxAssignableTrayCount = computed(() => parseNonNegativeCount(currentTask.value?.maxAssignableTrayCount));
  const explicitRemainingTrayCount = computed(() => parseNonNegativeCount(currentTask.value?.remainingTrayCount));
  const hasTrayCapacityLimit = computed(() => explicitMaxAssignableTrayCount.value != null || explicitRemainingTrayCount.value != null);
  const maxAssignableTrayCount = computed(() => {
    if (explicitMaxAssignableTrayCount.value != null) {
      return explicitMaxAssignableTrayCount.value;
    }
    if (explicitRemainingTrayCount.value != null) {
      return explicitRemainingTrayCount.value;
    }
    return loadedTrayCount.value + rawAvailableInventoryCount.value;
  });
  const remainingTrayCount = computed(() => {
    const remainingAfterCurrentTask = Math.max(0, maxAssignableTrayCount.value - loadedTrayCount.value);
    return Math.min(rawAvailableInventoryCount.value, remainingAfterCurrentTask);
  });
  const trayCapacityExceeded = computed(() => (
    Boolean(selectedTaskId.value)
    && hasTrayCapacityLimit.value
    && loadedTrayCount.value > maxAssignableTrayCount.value
  ));
  const trayCapacityWarning = computed(() => (
    String(currentTask.value?.trayCapacityMessage || "").trim()
    || `系统剩余托盘不足，当前最多可分配 ${maxAssignableTrayCount.value} 个托盘。`
  ));
  const loadedTrayNos = computed(() => assignedTrays.value
    .filter((tray) => Array.isArray(tray.samples) && tray.samples.length > 0)
    .map((tray) => tray.trayNo));
  const requiresExperimentTrayAllocation = computed(() => experiments.value.length > 0);
  const everyExperimentHasTray = computed(() => experiments.value.every((experiment) => (
    (draftExperimentTraySelections.value[experiment.experimentCode] || []).length > 0
  )));
  const everyLoadedTrayHasExperiment = computed(() => {
    // The revision makes the plain Map part of Vue's dependency graph without
    // wrapping every Set entry in a deep reactive proxy.
    void trayExperimentIndexRevision.value;
    return loadedTrayNos.value.every((trayNo) => (experimentCodesByTrayNo.get(trayNo)?.size || 0) > 0);
  });
  const hasCompleteExperimentTrayAllocation = computed(() => (
    loadedTrayNos.value.length > 0
    && (!requiresExperimentTrayAllocation.value || (everyExperimentHasTray.value && everyLoadedTrayHasExperiment.value))
  ));
  const allocationValidationMessage = computed(() => {
    if (!selectedTaskId.value || isStoredTask.value) {
      return "";
    }
    if (trayCapacityExceeded.value) {
      return trayCapacityWarning.value;
    }
    if (!requiresExperimentTrayAllocation.value) {
      return "";
    }
    if (!everyExperimentHasTray.value) {
      return "每个实验都必须至少分配一个托盘。";
    }
    if (!everyLoadedTrayHasExperiment.value) {
      return "有样品的托盘必须至少分配一个实验。";
    }
    return "";
  });
  const canSaveAllocation = computed(() => (
    Boolean(selectedTaskId.value)
    && !isStoredTask.value
    && !allocationSaved.value
    && !trayCapacityExceeded.value
    && (mode.value === "pre-allocation" || !isExperimentMode.value)
    && hasCompleteExperimentTrayAllocation.value
  ));
  const canPersistAllocationDraft = computed(() => (
    Boolean(selectedTaskId.value)
    && !isStoredTask.value
    && !allocationSaved.value
    && !trayCapacityExceeded.value
    && hasCompleteExperimentTrayAllocation.value
  ));
  const canConfirm = computed(() => (
    Boolean(selectedTaskId.value)
    && loadedTrayCount.value > 0
    && (allocationSaved.value || (requiresExperimentTrayAllocation.value && canPersistAllocationDraft.value))
    && !isStoredTask.value
    && !trayCapacityExceeded.value
    && hasCompleteExperimentTrayAllocation.value
  ));
  const canPrint = computed(() => (
    Boolean(selectedTaskId.value)
    && loadedTrayCount.value > 0
    && allocationSaved.value
    && hasCompleteExperimentTrayAllocation.value
    && !trayCapacityExceeded.value
    && !isStorageOperationPending.value
  ));
  const reloadBlockedReason = computed(() => {
    if (!currentTask.value?.reloadBlocked) {
      return "";
    }
    return mode.value === "pre-allocation"
      ? "该任务已有托盘开始实验，不能重新分配。"
      : "该任务已有托盘开始实验，不能重新入库。";
  });
  const canResetWorkspace = computed(() => {
    if (!selectedTaskId.value || reloadBlockedReason.value || isStorageOperationPending.value) {
      return false;
    }
    if (mode.value === "pre-allocation") {
      return !isStoredTask.value;
    }
    return true;
  });
  const selectedSampleLabel = computed(() => {
    for (const tray of assignedTrays.value) {
      const sample = tray.samples.find((item) => item.sampleId === selectedSampleId.value);
      if (sample) return sample.sampleNo;
    }
    return "";
  });
  const quickMoveTrayLabel = computed(() => assignedTrays.value[armedTrayIndex.value]?.trayNo || "");
  const selectionHintText = computed(() => {
    if (lockedOperationHint.value) {
      return lockedOperationHint.value;
    }
    if (selectedSampleLabel.value) {
      return `已选样品：${selectedSampleLabel.value}`;
    }
    if (!isExperimentMode.value && quickMoveTrayLabel.value) {
      return `目标托盘：${quickMoveTrayLabel.value}，点击其他托盘中的样品可快速移入。`;
    }
    return "";
  });
  const currentTaskCode = computed(() => String(currentTask.value?.taskNo || "").trim());

  const rebuildTrayExperimentLabels = () => {
    const experimentNameMap = Object.fromEntries(experiments.value.map((experiment) => [
      experiment.experimentCode,
      resolveExperimentDisplayName(experiment),
    ]));
    experimentCodesByTrayNo.clear();
    assignedTrays.value.forEach((tray) => {
      experimentCodesByTrayNo.set(tray.trayNo, new Set());
    });
    experiments.value.forEach((experiment) => {
      const selectedTrayNos = Array.isArray(draftExperimentTraySelections.value[experiment.experimentCode])
        ? draftExperimentTraySelections.value[experiment.experimentCode]
        : [];
      selectedTrayNos.forEach((trayNo) => {
        experimentCodesByTrayNo.get(trayNo)?.add(experiment.experimentCode);
      });
    });
    assignedTrays.value = assignedTrays.value.map((tray) => {
      const experimentCodes = experiments.value
        .map((experiment) => experiment.experimentCode)
        .filter((experimentCode) => experimentCodesByTrayNo.get(tray.trayNo)?.has(experimentCode));
      return {
        ...tray,
        experimentCodes,
        experimentLabels: experimentCodes.map((experimentCode) => experimentNameMap[experimentCode] || experimentCode),
      };
    });
    trayExperimentIndexRevision.value += 1;
  };

  const assignAllExperimentsToAllTrays = () => {
    if (allocationReadOnly.value) {
      showSavedAllocationHint();
      return;
    }
    const trayNos = assignedTrays.value.map((tray) => tray.trayNo);
    draftExperimentTraySelections.value = Object.fromEntries(experiments.value.map((experiment) => [
      experiment.experimentCode,
      [...trayNos],
    ]));
    rebuildTrayExperimentLabels();
    allocationSaved.value = false;
    activeTrayIndex.value = -1;
  };

  const resetExperimentAssignmentsForTrayLayout = () => {
    const onlyTrayNo = assignedTrays.value.length === 1 ? assignedTrays.value[0]?.trayNo : "";
    draftExperimentTraySelections.value = Object.fromEntries(
      experiments.value.map((experiment) => [experiment.experimentCode, onlyTrayNo ? [onlyTrayNo] : []]),
    );
    rebuildTrayExperimentLabels();
  };

  const taskTrayContext = () => ({
    taskCode: currentTaskCode.value,
    taskId: selectedTaskId.value,
  });
  const createTaskTrayRef = (serial, limit) => createLayoutTaskTrayRef(serial, limit, taskTrayContext());
  const normalizeEditableTrays = (trays, limit) => normalizeLayoutEditableTrays(trays, limit, taskTrayContext());
  const clearSelectedSample = () => {
    selectedSampleId.value = null;
    selectedSampleTrayIndex.value = -1;
  };
  const refreshEditableTrayState = (message = "") => {
    assignedTrays.value = normalizeEditableTrays(assignedTrays.value, trayLimit.value);
    availableInventory.value = buildInventorySlots(availableInventory.value.length, trayLimit.value);
    resetExperimentAssignmentsForTrayLayout();
    barcodePrintConfirmed.value = false;
    allocationSaved.value = false;
    lockedOperationHint.value = "";
    if (message) {
      showWorkbenchFeedback(message, "info");
    }
  };
  const rebalanceTrayLayout = ({ limit = trayLimit.value, message = "" } = {}) => {
    const layout = buildRebalancedTrayLayout({
      assignedTrays: assignedTrays.value,
      availableInventoryCount: availableInventory.value.length,
      limit,
      pendingStatus,
      taskContext: taskTrayContext(),
    });
    assignedTrays.value = layout.assignedTrays;
    availableInventory.value = layout.availableInventory;
    trayLimit.value = layout.trayLimit;
    activeTrayIndex.value = -1;
    armedTrayIndex.value = -1;
    clearSelectedSample();
    resetExperimentAssignmentsForTrayLayout();
    barcodePrintConfirmed.value = false;
    allocationSaved.value = false;
    lockedOperationHint.value = "";
    if (message) {
      showWorkbenchFeedback(message, "info");
    }
  };
  const resetInteractiveState = () => {
    activeTrayIndex.value = -1;
    armedTrayIndex.value = -1;
    draggingSampleId.value = null;
    draggingFromTrayIndex.value = -1;
    selectedSampleId.value = null;
    selectedSampleTrayIndex.value = -1;
    barcodePrintConfirmed.value = false;
    lockedOperationHint.value = "";
  };
  const showSavedAllocationHint = () => {
    if (!allocationSaved.value) {
      return false;
    }
    lockedOperationHint.value = SAVED_ALLOCATION_HINT;
    return true;
  };
  const isSampleSelected = (sampleId) => selectedSampleId.value === sampleId;
  const isTraySelectedForCurrentExperiment = (trayNo) => {
    void trayExperimentIndexRevision.value;
    return isExperimentMode.value
      && Boolean(experimentCodesByTrayNo.get(trayNo)?.has(currentExperimentCode.value));
  };
  const setAssignmentMode = (nextMode) => {
    if (isStorageOperationPending.value) {
      return;
    }
    if (nextMode && nextMode !== "task" && showSavedAllocationHint()) {
      return;
    }
    activeAssignmentMode.value = nextMode || "task";
    clearSelectedSample();
  };
  const handleDetailShellClick = (event) => {
    if (!isExperimentMode.value) {
      return;
    }
    const target = event?.target;
    if (!(target instanceof Element)) {
      setAssignmentMode("task");
      return;
    }
    if (
      target.closest("button")
      || target.closest("input")
      || target.closest("select")
      || target.closest("textarea")
      || target.closest(".sample-tray-sample-tag")
      || target.closest(".transfer-tray-card")
      || target.closest(".transfer-detail-shell__top")
    ) {
      return;
    }
    setAssignmentMode("task");
  };
  const toggleExperimentTraySelection = (trayIndex) => {
    if (!isExperimentMode.value || allocationReadOnly.value) {
      showSavedAllocationHint();
      return;
    }
    const tray = assignedTrays.value[trayIndex];
    if (!tray) {
      return;
    }
    const current = new Set(draftExperimentTraySelections.value[currentExperimentCode.value] || []);
    if (current.has(tray.trayNo)) {
      current.delete(tray.trayNo);
    } else {
      current.add(tray.trayNo);
    }
    draftExperimentTraySelections.value[currentExperimentCode.value] = Array.from(current)
      .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    const trayExperimentCodes = new Set(experimentCodesByTrayNo.get(tray.trayNo) || tray.experimentCodes || []);
    if (trayExperimentCodes.has(currentExperimentCode.value)) {
      trayExperimentCodes.delete(currentExperimentCode.value);
    } else {
      trayExperimentCodes.add(currentExperimentCode.value);
    }
    experimentCodesByTrayNo.set(tray.trayNo, trayExperimentCodes);
    const experimentCodes = experiments.value
      .map((experiment) => experiment.experimentCode)
      .filter((experimentCode) => trayExperimentCodes.has(experimentCode));
    const experimentNameMap = new Map(experiments.value.map((experiment) => [
      experiment.experimentCode,
      resolveExperimentDisplayName(experiment),
    ]));
    assignedTrays.value[trayIndex] = {
      ...tray,
      experimentCodes,
      experimentLabels: experimentCodes.map((experimentCode) => experimentNameMap.get(experimentCode) || experimentCode),
    };
    trayExperimentIndexRevision.value += 1;
    allocationSaved.value = false;
    activeTrayIndex.value = trayIndex;
  };
  const placeSelectedSampleToTray = (targetIndex) => {
    if (taskEditingLocked.value) {
      showSavedAllocationHint();
      return;
    }
    if (selectedSampleId.value == null || selectedSampleTrayIndex.value < 0) return;
    const sourceTray = assignedTrays.value[selectedSampleTrayIndex.value];
    const targetTray = assignedTrays.value[targetIndex];
    if (!sourceTray || !targetTray || sourceTray === targetTray) return;
    if (targetTray.samples.length >= trayLimit.value) {
      showWorkbenchFeedback("目标托盘已达到上限。", "warning");
      return;
    }
    const sampleIndex = sourceTray.samples.findIndex((sample) => sample.sampleId === selectedSampleId.value);
    if (sampleIndex < 0) return;
    const [sample] = sourceTray.samples.splice(sampleIndex, 1);
    targetTray.samples = normalizeTraySamples([...targetTray.samples, sample]);
    refreshEditableTrayState(`已将 ${sample.sampleNo} 移动到 ${targetTray.trayNo}`);
    activeTrayIndex.value = targetIndex;
    armedTrayIndex.value = targetIndex;
    draggingSampleId.value = null;
    draggingFromTrayIndex.value = -1;
    clearSelectedSample();
  };
  const setActiveTray = (index) => {
    if (isExperimentMode.value) {
      toggleExperimentTraySelection(index);
      return;
    }
    if (taskEditingLocked.value) {
      showSavedAllocationHint();
      return;
    }
    if (selectedSampleId.value != null && selectedSampleTrayIndex.value >= 0 && selectedSampleTrayIndex.value !== index) {
      placeSelectedSampleToTray(index);
      return;
    }
    activeTrayIndex.value = index;
    armedTrayIndex.value = index;
  };
  const setTrayLimit = (value) => {
    if (taskEditingLocked.value) return;
    const nextLimit = normalizeTrayLimit(value);
    if (nextLimit === trayLimit.value) return;
    const requiredTrayCount = Math.max(1, Math.ceil(totalAssignedSampleCount.value / nextLimit));
    if (nextLimit < trayLimit.value && requiredTrayCount > maxAssignableTrayCount.value) {
      trayLimitInputVersion.value += 1;
      showWorkbenchFeedback(trayCapacityWarning.value, "warning");
      return;
    }
    rebalanceTrayLayout({ limit: nextLimit, message: `已将每盘数量上限调整为 ${nextLimit}，并重新分配托盘。` });
  };
  const allowTrayDrag = () => canDragSamples.value;
  const startDragging = (sampleId, trayIndex) => {
    if (!canDragSamples.value) {
      showSavedAllocationHint();
      return;
    }
    draggingSampleId.value = sampleId;
    draggingFromTrayIndex.value = trayIndex;
    selectedSampleId.value = sampleId;
    selectedSampleTrayIndex.value = trayIndex;
  };
  const swapTraySamples = (sourceSampleId, sourceTrayIndex, targetSampleId, targetTrayIndex) => {
    if (taskEditingLocked.value) {
      showSavedAllocationHint();
      return;
    }
    const sourceTray = assignedTrays.value[sourceTrayIndex];
    const targetTray = assignedTrays.value[targetTrayIndex];
    if (!sourceTray || !targetTray) return;
    const sourceIndex = sourceTray.samples.findIndex((sample) => sample.sampleId === sourceSampleId);
    const targetIndex = targetTray.samples.findIndex((sample) => sample.sampleId === targetSampleId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const sourceSample = sourceTray.samples[sourceIndex];
    const targetSample = targetTray.samples[targetIndex];
    sourceTray.samples.splice(sourceIndex, 1, targetSample);
    targetTray.samples.splice(targetIndex, 1, sourceSample);
    refreshEditableTrayState(`已交换 ${sourceSample.sampleNo} 与 ${targetSample.sampleNo}`);
    activeTrayIndex.value = targetTrayIndex;
    clearSelectedSample();
  };
  const selectTraySample = (sampleId, trayIndex) => {
    if (taskEditingLocked.value) {
      showSavedAllocationHint();
      return;
    }
    if (armedTrayIndex.value >= 0 && armedTrayIndex.value !== trayIndex && selectedSampleId.value == null) {
      selectedSampleId.value = sampleId;
      selectedSampleTrayIndex.value = trayIndex;
      placeSelectedSampleToTray(armedTrayIndex.value);
      return;
    }
    if (selectedSampleId.value == null) {
      selectedSampleId.value = sampleId;
      selectedSampleTrayIndex.value = trayIndex;
      activeTrayIndex.value = trayIndex;
      return;
    }
    if (selectedSampleId.value === sampleId) {
      clearSelectedSample();
      return;
    }
    swapTraySamples(selectedSampleId.value, selectedSampleTrayIndex.value, sampleId, trayIndex);
  };
  const handleTrayDrop = (targetIndex) => {
    if (taskEditingLocked.value) {
      showSavedAllocationHint();
      return;
    }
    if (draggingSampleId.value == null || draggingFromTrayIndex.value < 0) return;
    selectedSampleId.value = draggingSampleId.value;
    selectedSampleTrayIndex.value = draggingFromTrayIndex.value;
    placeSelectedSampleToTray(targetIndex);
    draggingSampleId.value = null;
    draggingFromTrayIndex.value = -1;
  };
  const addInventoryTray = () => {
    if (taskEditingLocked.value) return;
    if (trayCapacityExceeded.value) {
      showWorkbenchFeedback(trayCapacityWarning.value, "warning");
      return;
    }
    if (remainingTrayCount.value <= 0) {
      showWorkbenchFeedback("当前没有可用空托盘。", "warning");
      return;
    }
    assignedTrays.value = normalizeEditableTrays(assignedTrays.value, trayLimit.value);
    const nextSerial = assignedTrays.value.length + 1;
    availableInventory.value = availableInventory.value.slice(1);
    assignedTrays.value.push({
      ...createTaskTrayRef(nextSerial, trayLimit.value),
      trayStatus: "已预分配",
      samples: [],
      barcode: null,
      barcodeData: null,
      loadQty: 0,
    });
    refreshEditableTrayState("已新增空托盘，可继续调整样品摆放。");
    activeTrayIndex.value = assignedTrays.value.length - 1;
    armedTrayIndex.value = -1;
  };
  const removeTray = (index) => {
    const tray = assignedTrays.value[index];
    if (!tray) return;
    if (taskEditingLocked.value) {
      showSavedAllocationHint();
      return;
    }
    if (assignedTrays.value.length <= minimumTrayCount.value) {
      showWorkbenchFeedback("当前托盘数量已是最小值，不能继续删除。", "warning");
      return;
    }
    rebalanceTrayLayout({
      limit: trayLimit.value,
      message: `已删除 ${tray.trayNo}，并自动重新分配样品。`,
    });
  };
  const buildAllocationPayload = () => buildTrayAllocationPayload({
    assignedTrays: assignedTrays.value,
    experiments: experiments.value,
    experimentTraySelections: draftExperimentTraySelections.value,
    trayLimit: trayLimit.value,
  });

  return {
    activeAssignmentMode,
    activeTrayIndex,
    addInventoryTray,
    assignAllExperimentsToAllTrays,
    allocationReadOnly,
    allocationSaved,
    allocationValidationMessage,
    allowTrayDrag,
    armedTrayIndex,
    assignedTrays,
    availableInventory,
    barcodePrintConfirmed,
    buildAllocationPayload,
    canConfirm,
    canDragSamples,
    canPersistAllocationDraft,
    canPrint,
    canResetWorkspace,
    canSaveAllocation,
    currentExperimentCode,
    currentExperimentName,
    draftExperimentTraySelections,
    experimentSelectionLocked,
    experiments,
    handleDetailShellClick,
    handleTrayDrop,
    hasCompleteExperimentTrayAllocation,
    isExperimentMode,
    isSampleSelected,
    isStoredTask,
    isTraySelectedForCurrentExperiment,
    loadedTrayCount,
    lockedOperationHint,
    maxAssignableTrayCount,
    placeSelectedSampleToTray,
    rawAvailableInventoryCount,
    rebuildTrayExperimentLabels,
    reloadBlockedReason,
    remainingTrayCount,
    removeTray,
    resetInteractiveState,
    selectTraySample,
    selectionHintText,
    setActiveTray,
    setAssignmentMode,
    setTrayLimit,
    startDragging,
    taskEditingLocked,
    toggleExperimentTraySelection,
    trayCapacityExceeded,
    trayCapacityWarning,
    trayLimit,
    trayLimitInputKey,
  };
}

export { useTransferTrayAssignment };
