import { ref } from "vue";

import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import { normalizeInventoryRefs } from "./transferTrayLayoutModel";
import {
  formatApiErrorDetail,
  normalizeTaskRecord,
  normalizeTaskStatus,
  normalizeTrayLimit,
} from "./model";

function useTransferWorkspacePersistence({
  activeAssignmentMode,
  activeTrayIndex,
  allocationSaved,
  allocationValidationMessage,
  assignedTrays,
  availableInventory,
  barcodeModalVisible,
  barcodePreviewItems,
  buildAllocationPayload,
  canConfirm,
  canPersistAllocationDraft,
  canResetWorkspace,
  canSaveAllocation,
  clearWorkbenchFeedback,
  currentTask,
  draftExperimentTraySelections,
  experiments,
  flushPendingRealtimeRefresh,
  mode,
  openScheduleResetConfirm,
  pendingStatus,
  pendingTaskCount,
  rebuildTrayExperimentLabels,
  resetInteractiveState,
  sampleCodesModalTask,
  sampleCodesModalVisible,
  selectedTaskId,
  showWorkbenchFeedback,
  storedStatus,
  storedTaskCount,
  taskOverview,
  taskStatusFilter,
  trackOwnStorageRequest,
  trayLimit,
  viewMode,
}) {
  const API_BASE_URL = getFrontendApiBaseUrl();
  const isBootstrapLoading = ref(false);
  const bootstrapError = ref("");

  const updateOverviewTaskStatus = (taskId, status, progress) => {
    const normalizedStatus = normalizeTaskStatus(status);
    taskOverview.value = taskOverview.value.map((task) => (
      task.taskId === taskId
        ? {
            ...task,
            taskStatus: normalizedStatus,
            taskProgress: progress ?? task.taskProgress,
          }
        : task
    ));
    pendingTaskCount.value = taskOverview.value.filter(
      (task) => normalizeTaskStatus(task.taskStatus) === pendingStatus,
    ).length;
    storedTaskCount.value = taskOverview.value.filter(
      (task) => normalizeTaskStatus(task.taskStatus) === storedStatus,
    ).length;
  };

  const fetchJson = async (path, options) => {
    const response = await fetch(buildApiUrl(path, API_BASE_URL), options);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(
        formatApiErrorDetail(payload?.detail)
        || formatApiErrorDetail(payload?.message)
        || `请求失败（${response.status}）`,
      );
    }
    return payload || {};
  };

  const isArchivedWorkspaceError = (error) => String(
    error instanceof Error ? error.message : error || "",
  ).includes("归档");

  const applyWorkspace = (workspace) => {
    currentTask.value = workspace?.task ? normalizeTaskRecord(workspace.task) : null;
    experiments.value = Array.isArray(workspace?.experiments)
      ? workspace.experiments.map((experiment) => ({ ...experiment }))
      : [];
    draftExperimentTraySelections.value = Object.fromEntries(
      experiments.value.map((experiment) => [experiment.experimentCode, [...(experiment.assignedTrayNos || [])]]),
    );
    trayLimit.value = normalizeTrayLimit(workspace?.task?.trayLimit || 16);
    assignedTrays.value = (workspace?.assignedTrays || []).map((tray) => ({
      ...tray,
      samples: Array.isArray(tray.samples)
        ? tray.samples.map((sample) => ({
            ...sample,
            sampleStatus: normalizeTaskStatus(workspace?.task?.taskStatus) === storedStatus
              ? storedStatus
              : (sample.sampleStatus || pendingStatus),
          }))
        : [],
      trayStatus: normalizeTaskStatus(workspace?.task?.taskStatus) === storedStatus ? storedStatus : tray.trayStatus,
      experimentLabels: Array.isArray(tray.experimentLabels) ? [...tray.experimentLabels] : [],
      experimentCodes: Array.isArray(tray.experimentCodes) ? [...tray.experimentCodes] : [],
    }));
    availableInventory.value = normalizeInventoryRefs(workspace?.trayInventory || [], trayLimit.value);
    allocationSaved.value = Boolean(workspace?.allocationSaved);
    activeAssignmentMode.value = "task";
    rebuildTrayExperimentLabels();
    resetInteractiveState();
  };

  const applyConfirmedStorageState = (progress = "已确认入库") => {
    if (currentTask.value) {
      currentTask.value = {
        ...currentTask.value,
        taskStatus: storedStatus,
        taskProgress: progress,
      };
    }
    assignedTrays.value = assignedTrays.value.map((tray) => ({
      ...tray,
      trayStatus: storedStatus,
      samples: Array.isArray(tray.samples)
        ? tray.samples.map((sample) => ({ ...sample, sampleStatus: storedStatus }))
        : [],
    }));
  };

  const applyWorkspaceSaveGuards = (workspace) => {
    if (!workspace?.task || !currentTask.value) {
      return;
    }
    const nextTask = normalizeTaskRecord(workspace.task);
    currentTask.value = {
      ...currentTask.value,
      taskStatus: nextTask.taskStatus,
      taskProgress: nextTask.taskProgress,
      totalTrayCount: nextTask.totalTrayCount,
      remainingTrayCount: nextTask.remainingTrayCount,
      maxAssignableTrayCount: nextTask.maxAssignableTrayCount,
      requiredTrayCount: nextTask.requiredTrayCount,
      trayCapacityExceeded: nextTask.trayCapacityExceeded,
      trayCapacityMessage: nextTask.trayCapacityMessage,
      reloadBlocked: nextTask.reloadBlocked,
      reloadBlockedReason: nextTask.reloadBlockedReason,
      hasSchedules: nextTask.hasSchedules,
      scheduleResetWarning: nextTask.scheduleResetWarning,
    };
    availableInventory.value = normalizeInventoryRefs(workspace.trayInventory || [], trayLimit.value);
    allocationSaved.value = Boolean(workspace.allocationSaved);
  };

  const clearWorkspace = () => {
    selectedTaskId.value = null;
    currentTask.value = null;
    experiments.value = [];
    draftExperimentTraySelections.value = {};
    trayLimit.value = 16;
    assignedTrays.value = [];
    availableInventory.value = [];
    allocationSaved.value = false;
    activeAssignmentMode.value = "task";
    barcodeModalVisible.value = false;
    barcodePreviewItems.value = [];
    sampleCodesModalVisible.value = false;
    sampleCodesModalTask.value = null;
    resetInteractiveState();
  };

  const loadBootstrap = async ({ silent = false } = {}) => {
    const showBlockingLoading = !silent || taskOverview.value.length === 0;
    if (showBlockingLoading) {
      isBootstrapLoading.value = true;
    }
    bootstrapError.value = "";
    try {
      const payload = await fetchJson("/api/transfer-area/bootstrap");
      taskOverview.value = (payload.taskOverview || []).map((task) => normalizeTaskRecord(task));
      if (selectedTaskId.value && !taskOverview.value.some((task) => task.taskId === selectedTaskId.value)) {
        clearWorkspace();
        viewMode.value = "overview";
      }
      pendingTaskCount.value = taskOverview.value.filter(
        (task) => normalizeTaskStatus(task.taskStatus) === pendingStatus,
      ).length;
      storedTaskCount.value = taskOverview.value.filter(
        (task) => normalizeTaskStatus(task.taskStatus) === storedStatus,
      ).length;
    } catch (error) {
      if (showBlockingLoading) {
        bootstrapError.value = error instanceof Error ? error.message : "请稍后重试";
        taskOverview.value = [];
        pendingTaskCount.value = 0;
        storedTaskCount.value = 0;
      }
    } finally {
      if (showBlockingLoading) {
        isBootstrapLoading.value = false;
      }
    }
  };

  const loadWorkspace = async (taskId = selectedTaskId.value) => {
    if (!taskId) return;
    const knownStatus = normalizeTaskStatus(
      currentTask.value?.taskId === taskId
        ? currentTask.value?.taskStatus
        : taskOverview.value.find((task) => task.taskId === taskId)?.taskStatus,
    );
    const payload = await fetchJson(`/api/transfer-area/tasks/${taskId}/workspace`);
    applyWorkspace(payload);
    if (knownStatus === storedStatus && currentTask.value && normalizeTaskStatus(currentTask.value.taskStatus) !== storedStatus) {
      currentTask.value = {
        ...currentTask.value,
        taskStatus: storedStatus,
        taskProgress: currentTask.value.taskProgress || "已确认入库",
      };
    }
  };

  const refreshWorkspaceSaveGuards = async () => {
    if (!selectedTaskId.value) {
      return;
    }
    const workspace = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/workspace`);
    applyWorkspaceSaveGuards(workspace);
  };

  const openTask = async (task) => {
    selectedTaskId.value = task.taskId;
    clearWorkbenchFeedback();
    barcodeModalVisible.value = false;
    barcodePreviewItems.value = [];
    sampleCodesModalVisible.value = false;
    sampleCodesModalTask.value = null;
    viewMode.value = "detail";
    try {
      await loadWorkspace(task.taskId);
    } catch (error) {
      if (!isArchivedWorkspaceError(error)) {
        throw error;
      }
      showWorkbenchFeedback(error instanceof Error ? error.message : "任务已归档", "error");
      clearWorkspace();
      viewMode.value = "overview";
      await loadBootstrap();
    }
  };

  const refreshTransferWorkspaceAfterTrayChange = async () => {
    await loadBootstrap({ silent: true });
    if (!selectedTaskId.value) {
      return;
    }
    await loadWorkspace(selectedTaskId.value);
  };

  const persistAllocation = async (showMessage = true, { allowExperimentMode = false } = {}) => {
    if (!selectedTaskId.value || normalizeTaskStatus(currentTask.value?.taskStatus) === storedStatus) return false;
    const canPersist = allowExperimentMode ? canPersistAllocationDraft.value : canSaveAllocation.value;
    if (!canPersist) {
      const message = allocationValidationMessage.value || "托盘分配尚未完成，请检查实验与托盘关系。";
      if (showMessage) showWorkbenchFeedback(message, "warning");
      return false;
    }
    try {
      await refreshWorkspaceSaveGuards();
      const canPersistAfterRefresh = allowExperimentMode ? canPersistAllocationDraft.value : canSaveAllocation.value;
      if (!canPersistAfterRefresh) {
        const message = allocationValidationMessage.value || "托盘分配尚未完成，请检查实验与托盘关系。";
        if (showMessage) showWorkbenchFeedback(message, "warning");
        return false;
      }
      const storageUpdateMeta = trackOwnStorageRequest("allocate");
      const payload = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/allocate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-MES-Update-Source": storageUpdateMeta.source,
          "X-MES-Update-Request-Id": storageUpdateMeta.requestId,
        },
        body: JSON.stringify(buildAllocationPayload()),
      });
      applyWorkspace(payload.workspace);
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT, {
        detail: { source: "transfer-workbench", reason: "allocate", requestId: storageUpdateMeta.requestId },
      }));
      flushPendingRealtimeRefresh();
      if (showMessage) showWorkbenchFeedback(payload.message, "success");
      return true;
    } catch (error) {
      if (showMessage) {
        showWorkbenchFeedback(error instanceof Error ? error.message : "托盘分配保存失败，请重试。", "error");
      }
      return false;
    }
  };

  const confirmStorage = async () => {
    if (!canConfirm.value) return;
    if (!allocationSaved.value) {
      const saved = await persistAllocation(false, { allowExperimentMode: true });
      if (!saved) return;
    }
    const storageUpdateMeta = trackOwnStorageRequest("confirm-storage");
    const payload = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/confirm-storage`, {
      method: "POST",
      headers: {
        "X-MES-Update-Source": storageUpdateMeta.source,
        "X-MES-Update-Request-Id": storageUpdateMeta.requestId,
      },
    });
    const confirmedTaskId = selectedTaskId.value;
    const confirmedProgress = payload?.workspace?.task?.taskProgress || "已确认入库";
    applyWorkspace(payload.workspace);
    applyConfirmedStorageState(confirmedProgress);
    if (confirmedTaskId) {
      updateOverviewTaskStatus(confirmedTaskId, storedStatus, confirmedProgress);
    }
    showWorkbenchFeedback(payload.message, "success");
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT, {
      detail: { source: "transfer-workbench", reason: "confirm-storage", requestId: storageUpdateMeta.requestId },
    }));
    flushPendingRealtimeRefresh();
    taskStatusFilter.value = storedStatus;
  };

  const executeReloadWorkspace = async () => {
    if (!canResetWorkspace.value) return;
    clearWorkbenchFeedback();
    barcodeModalVisible.value = false;
    barcodePreviewItems.value = [];
    sampleCodesModalVisible.value = false;
    sampleCodesModalTask.value = null;
    const payload = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/reload`, { method: "POST" });
    applyWorkspace(payload.workspace);
    activeTrayIndex.value = -1;
    updateOverviewTaskStatus(
      selectedTaskId.value,
      pendingStatus,
      payload?.workspace?.task?.taskProgress || "样品已送达，待打印二维码",
    );
    const isStored = normalizeTaskStatus(payload?.workspace?.task?.taskStatus) === storedStatus;
    showWorkbenchFeedback(
      mode.value === "pre-allocation"
        ? (isStored ? "到货任务仅支持查看与打印。" : "任务已重新分配，可继续调整托盘方案。")
        : payload.message,
      isStored ? "warning" : "success",
    );
    await loadBootstrap();
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT, { detail: { source: "transfer-workbench", reason: "reload" } }));
    flushPendingRealtimeRefresh();
    taskStatusFilter.value = pendingStatus;
  };

  const reloadWorkspace = async () => {
    if (!canResetWorkspace.value) return;
    if (currentTask.value?.hasSchedules) {
      openScheduleResetConfirm();
      return;
    }
    await executeReloadWorkspace();
  };

  return {
    applyWorkspace,
    backToOverview: async () => {
      barcodeModalVisible.value = false;
      sampleCodesModalVisible.value = false;
      sampleCodesModalTask.value = null;
      await loadBootstrap();
      viewMode.value = "overview";
      flushPendingRealtimeRefresh();
    },
    bootstrapError,
    confirmStorage,
    executeReloadWorkspace,
    fetchJson,
    isBootstrapLoading,
    loadBootstrap,
    openTask,
    persistAllocation,
    refreshTransferWorkspaceAfterTrayChange,
    reloadBootstrap: () => loadBootstrap(),
    reloadWorkspace,
  };
}

export { useTransferWorkspacePersistence };
