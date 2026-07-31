import { onBeforeUnmount, watch } from "vue";

import { COMPLETED_EXPERIMENT_RUN_STATUSES, normalizeText } from "./pageHelpers";

const RUNNING_MODAL_RESTORE_MS = 10_000;

function useLaboratoryRunningModal({
  completedRunningExperiment,
  confirmedModalOpen,
  experimentRuns,
  openAttendanceLogoutPrompt,
  readyModalOpen,
  runningExperiment,
  runningModalVisible,
}) {
  let runningModalRestoreTimer = null;
  let lastActiveRunningExperiment = null;

  const clearRunningModalRestoreTimer = () => {
    if (runningModalRestoreTimer && typeof window !== "undefined") {
      window.clearTimeout(runningModalRestoreTimer);
      runningModalRestoreTimer = null;
    }
  };

  const showRunningModal = () => {
    if (runningExperiment.value.active || completedRunningExperiment.value?.active) {
      runningModalVisible.value = true;
    }
    clearRunningModalRestoreTimer();
  };

  const scheduleRunningModalRestore = () => {
    clearRunningModalRestoreTimer();
    if (!runningExperiment.value.active || runningModalVisible.value || typeof window === "undefined") {
      return;
    }
    runningModalRestoreTimer = window.setTimeout(() => {
      runningModalVisible.value = true;
      runningModalRestoreTimer = null;
    }, RUNNING_MODAL_RESTORE_MS);
  };

  const hideRunningModal = () => {
    if (completedRunningExperiment.value?.active) {
      completedRunningExperiment.value = null;
      runningModalVisible.value = false;
      clearRunningModalRestoreTimer();
      openAttendanceLogoutPrompt();
      return;
    }
    if (!runningExperiment.value.active) {
      return;
    }
    runningModalVisible.value = false;
    scheduleRunningModalRestore();
  };

  const handleRunningModalActivity = () => {
    if (!runningExperiment.value.active || runningModalVisible.value) {
      return;
    }
    scheduleRunningModalRestore();
  };

  const runMatchesCompletedSnapshot = (run, runningSnapshot) => {
    const runNo = normalizeText(run?.run_no) || normalizeText(run?.id);
    if (normalizeText(runningSnapshot?.runNo) && runNo === normalizeText(runningSnapshot?.runNo)) {
      return true;
    }
    if (
      normalizeText(run?.task_code) !== normalizeText(runningSnapshot?.taskCode)
      || normalizeText(run?.experiment_code) !== normalizeText(runningSnapshot?.experimentCode)
    ) {
      return false;
    }
    const snapshotTrayCodes = new Set((runningSnapshot?.trayCodes || []).map(normalizeText).filter(Boolean));
    const runTrayCodes = new Set((Array.isArray(run?.tray_codes) ? run.tray_codes : []).map(normalizeText).filter(Boolean));
    return snapshotTrayCodes.size > 0 && Array.from(snapshotTrayCodes).every((trayCode) => runTrayCodes.has(trayCode));
  };

  const preserveExternallyCompletedRunningExperiment = (runningSnapshot) => {
    if (!runningSnapshot?.active) {
      return false;
    }
    const matchedCompletedRun = experimentRuns.value.find(
      (run) => COMPLETED_EXPERIMENT_RUN_STATUSES.has(normalizeText(run?.status))
        && runMatchesCompletedSnapshot(run, runningSnapshot),
    );
    if (!matchedCompletedRun) {
      return false;
    }
    const completedAt = normalizeText(matchedCompletedRun?.ended_at) || normalizeText(matchedCompletedRun?.updated_at);
    completedRunningExperiment.value = {
      ...runningSnapshot,
      active: true,
      completed: true,
      countdownLabel: "实验已完成",
      endDateTimeLabel: completedAt || runningSnapshot.endDateTimeLabel,
      overdue: false,
      overdueLabel: "",
      remainingSeconds: 0,
      statusLabel: "实验已完成",
    };
    runningModalVisible.value = true;
    clearRunningModalRestoreTimer();
    return true;
  };

  watch(
    () => runningExperiment.value.active,
    (active) => {
      if (active) {
        completedRunningExperiment.value = null;
        lastActiveRunningExperiment = { ...runningExperiment.value };
        readyModalOpen.value = false;
        confirmedModalOpen.value = false;
        showRunningModal();
        return;
      }
      if (preserveExternallyCompletedRunningExperiment(lastActiveRunningExperiment)) {
        lastActiveRunningExperiment = null;
        return;
      }
      lastActiveRunningExperiment = null;
      if (completedRunningExperiment.value?.active) {
        runningModalVisible.value = true;
        clearRunningModalRestoreTimer();
        return;
      }
      runningModalVisible.value = false;
      clearRunningModalRestoreTimer();
    },
    { immediate: true },
  );

  const clearRunningModalTimers = () => {
    clearRunningModalRestoreTimer();
  };

  onBeforeUnmount(clearRunningModalTimers);

  return {
    clearRunningModalRestoreTimer,
    handleRunningModalActivity,
    hideRunningModal,
    showRunningModal,
  };
}

export { useLaboratoryRunningModal };
