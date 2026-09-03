import { computed } from "vue";

import { normalizeText } from "./pageHelpers";

const MOLD_LAB_CODE = "LAB_MOLD";
const MOLD_CANCELLATION_DEFAULT_REASON = "霉菌未按预期繁殖";
const MOLD_CANCELED_STATUS = "实验已取消";

const cancellationRowMatchesRequest = (row, pending) => {
  const pendingRunNo = normalizeText(pending?.runNo);
  const rowRunNo = normalizeText(row?.run_no || row?.runNo || row?.id);
  if (pendingRunNo) {
    return rowRunNo === pendingRunNo;
  }
  return normalizeText(row?.task_code || row?.taskCode) === normalizeText(pending?.taskCode)
    && normalizeText(row?.experiment_code || row?.experimentCode) === normalizeText(pending?.experimentCode);
};

const moldCancellationConfirmationMatches = (pending, experimentRuns) => (
  Boolean(pending)
  && (Array.isArray(experimentRuns) ? experimentRuns : []).some((run) => (
    cancellationRowMatchesRequest(run, pending)
    && normalizeText(run?.status || run?.run_status || run?.runStatus) === MOLD_CANCELED_STATUS
  ))
);

function useMoldCancellationFlow({
  cancellationAwaitingConfirmation,
  cancellationConfirmationError,
  cancellationDangerModalOpen,
  cancellationReason,
  cancellationReasonError,
  cancellationReasonModalOpen,
  cancellationSubmitting,
  completionAwaitingConfirmation,
  completionSubmitting,
  currentTask,
  laboratoryConfig,
  requestCancellation,
  runningExperiment,
}) {
  const isMoldLaboratory = computed(() => normalizeText(laboratoryConfig.value?.labCode) === MOLD_LAB_CODE);
  const canCancelMoldExperiment = computed(() => (
    isMoldLaboratory.value
    && Boolean(runningExperiment.value?.active)
    && !cancellationSubmitting.value
    && !cancellationAwaitingConfirmation.value
    && !completionSubmitting.value
    && !completionAwaitingConfirmation.value
  ));

  const openCancellationReasonModal = () => {
    if (!canCancelMoldExperiment.value) {
      return;
    }
    cancellationConfirmationError.value = "";
    cancellationReasonError.value = "";
    cancellationReason.value = MOLD_CANCELLATION_DEFAULT_REASON;
    cancellationReasonModalOpen.value = true;
  };

  const closeCancellationReasonModal = () => {
    if (cancellationSubmitting.value) {
      return;
    }
    cancellationReasonModalOpen.value = false;
    cancellationReasonError.value = "";
  };

  const continueCancellationConfirmation = () => {
    if (!normalizeText(cancellationReason.value)) {
      cancellationReasonError.value = "请填写取消原因。";
      return;
    }
    cancellationReasonError.value = "";
    cancellationReasonModalOpen.value = false;
    cancellationDangerModalOpen.value = true;
  };

  const closeCancellationDangerModal = () => {
    if (!cancellationSubmitting.value) {
      cancellationDangerModalOpen.value = false;
    }
  };

  const confirmMoldCancellation = async () => {
    if (!canCancelMoldExperiment.value || !normalizeText(cancellationReason.value)) {
      return;
    }
    const taskCode = normalizeText(currentTask.value?.taskCode || runningExperiment.value?.taskCode);
    const experimentCode = normalizeText(currentTask.value?.experimentCode || runningExperiment.value?.experimentCode);
    const runNo = normalizeText(runningExperiment.value?.runNo);
    if (!taskCode || !experimentCode || !runNo) {
      cancellationConfirmationError.value = "当前实验缺少任务、实验或运行批次信息，无法取消。";
      return;
    }

    cancellationSubmitting.value = true;
    cancellationConfirmationError.value = "";
    try {
      const published = await requestCancellation({
        cancel_reason: normalizeText(cancellationReason.value),
        experiment_code: experimentCode,
        lab_code: MOLD_LAB_CODE,
        run_no: runNo,
        task_code: taskCode,
      });
      if (!published) {
        cancellationConfirmationError.value = "取消命令发送失败，请检查设备接口后重试。";
        return;
      }
      cancellationDangerModalOpen.value = false;
      cancellationAwaitingConfirmation.value = {
        cancelRequestId: normalizeText(published?.cancelRequestId || published?.cancel_request_id),
        experimentCode,
        requestedAt: Date.now(),
        runNo,
        taskCode,
      };
    } finally {
      cancellationSubmitting.value = false;
    }
  };

  return {
    canCancelMoldExperiment,
    closeCancellationDangerModal,
    closeCancellationReasonModal,
    confirmMoldCancellation,
    continueCancellationConfirmation,
    isMoldLaboratory,
    openCancellationReasonModal,
  };
}

export {
  MOLD_CANCELLATION_DEFAULT_REASON,
  MOLD_CANCELED_STATUS,
  moldCancellationConfirmationMatches,
  useMoldCancellationFlow,
};
