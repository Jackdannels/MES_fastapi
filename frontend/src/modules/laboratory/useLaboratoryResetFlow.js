import { withdrawCurrentLaboratoryExperiment } from "@/lib/laboratoryApi";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import {
  formatErrorMessage,
  isResettableTrayStatus,
  normalizeText,
  resolveSubExperimentCode,
} from "./pageHelpers";

function useLaboratoryResetFlow({
  applyWithdrawResponse,
  canResetCurrentTask,
  clearHostlessTimers,
  clearLaboratoryMqError,
  currentTask,
  flushPendingRealtimeRefresh,
  ignoreNextSamplesUpdatedRefresh,
  laboratoryMqError,
  load,
  resetConfirmModalOpen,
  resetCompareState,
  resetDangerModalOpen,
  resetSubmitting,
  resetTarget,
}) {
  const getCurrentResettableTrayCodes = () => Array.from(new Set(
    (Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [])
      .filter((row) => isResettableTrayStatus(row?.trayStatus))
      .map((row) => String(row?.trayCode || "").trim())
      .filter(Boolean),
  ));

  const buildResetTarget = () => {
    const task = currentTask.value;
    const trayCodes = getCurrentResettableTrayCodes();
    const taskCode = normalizeText(task?.taskCode);
    const experimentCode = normalizeText(task?.experimentCode);
    if (!taskCode || !experimentCode || trayCodes.length === 0) {
      return null;
    }
    return {
      axisBatchNo: normalizeText(task?.axis_batch_no || task?.axisBatchNo),
      experimentCode,
      experimentName: normalizeText(task?.experimentName),
      scheduleId: normalizeText(task?.id || task?.scheduleId || task?.schedule_id),
      subExperimentCode: resolveSubExperimentCode(task),
      taskCode,
      taskId: normalizeText(task?.taskId || task?.task_id || task?.taskCode),
      taskName: normalizeText(task?.taskName || task?.name),
      trayCodes,
    };
  };

  const resetTargetIsValid = (target) => Boolean(
    target
    && normalizeText(target.taskCode)
    && normalizeText(target.experimentCode)
    && Array.isArray(target.trayCodes)
    && target.trayCodes.length > 0,
  );

  const openResetConfirm = () => {
    if (!canResetCurrentTask.value) {
      return;
    }
    const target = buildResetTarget();
    if (!resetTargetIsValid(target)) {
      laboratoryMqError.value = {
        detail: "当前任务或托盘信息已变化，请刷新后重试。",
        title: "撤回任务失败",
      };
      return;
    }
    resetTarget.value = target;
    clearLaboratoryMqError();
    resetConfirmModalOpen.value = true;
  };

  const closeResetConfirm = () => {
    resetConfirmModalOpen.value = false;
    resetTarget.value = null;
    flushPendingRealtimeRefresh();
  };

  const confirmResetPrompt = () => {
    if (!resetTargetIsValid(resetTarget.value)) {
      resetConfirmModalOpen.value = false;
      resetDangerModalOpen.value = false;
      resetTarget.value = null;
      laboratoryMqError.value = {
        detail: "撤回目标已失效，请重新打开撤回确认。",
        title: "撤回任务失败",
      };
      return;
    }
    resetConfirmModalOpen.value = false;
    resetDangerModalOpen.value = true;
  };

  const closeResetDanger = () => {
    resetDangerModalOpen.value = false;
    resetTarget.value = null;
    flushPendingRealtimeRefresh();
  };

  const confirmResetTask = async () => {
    if (resetSubmitting.value) {
      return;
    }
    const target = resetTarget.value;
    if (!resetTargetIsValid(target)) {
      resetDangerModalOpen.value = false;
      resetTarget.value = null;
      laboratoryMqError.value = {
        detail: "撤回目标已失效，请重新打开撤回确认。",
        title: "撤回任务失败",
      };
      return;
    }
    resetSubmitting.value = true;
    try {
      clearLaboratoryMqError();
      clearHostlessTimers();
      const withdrawResult = await withdrawCurrentLaboratoryExperiment({
        axisBatchNo: target.axisBatchNo,
        experimentCode: target.experimentCode,
        reason: "试验间内撤回当前实验任务",
        scheduleId: target.scheduleId,
        subExperimentCode: target.subExperimentCode,
        taskCode: target.taskCode,
        trayCodes: target.trayCodes,
      });
      resetDangerModalOpen.value = false;
      resetTarget.value = null;
      resetCompareState();
      try {
        await load();
      } catch {
        // The withdraw API response is authoritative for the local tray flow.
      }
      applyWithdrawResponse(withdrawResult);
      if (typeof window !== "undefined") {
        ignoreNextSamplesUpdatedRefresh();
        window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
      }
      flushPendingRealtimeRefresh();
    } catch (error) {
      laboratoryMqError.value = {
        detail: formatErrorMessage(error),
        title: "撤回任务失败",
      };
    } finally {
      resetSubmitting.value = false;
    }
  };

  return {
    closeResetConfirm,
    closeResetDanger,
    confirmResetPrompt,
    confirmResetTask,
    openResetConfirm,
    resetConfirmModalOpen,
    resetDangerModalOpen,
    resetSubmitting,
    resetTarget,
  };
}

export { useLaboratoryResetFlow };
