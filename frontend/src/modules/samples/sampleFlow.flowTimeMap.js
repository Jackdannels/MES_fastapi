import {
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  APPEARANCE_STOCKED_STATUS,
  EXPERIMENT_FLOW_STATUS_LABELS,
  POST_EXPERIMENT_STAGING_DISPATCH_TIME_LABEL,
  POST_EXPERIMENT_STAGING_SENT_STATUS,
  POST_EXPERIMENT_STAGING_STOCKED_STATUS,
  RUNNING_EXPERIMENT_RUN_STATUSES,
  WITHDRAWAL_ACTIONS,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import {
  asArray,
  entryTimeValue,
  firstNonEmptyArray,
  parseTimeValue,
  resolveFlowStatusRank,
  uniqueNormalizedTexts,
} from "./sampleFlow.trayScope";
import {
  isAmbiguousStagingStatus,
  isPostRetentionLocation,
  normalizeLifecycleStatus,
} from "./sampleFlow.status";
import {
  buildLabDispatchStepLabel,
  findCompletedExperimentHistoryEntry,
  latestWithdrawalHistoryEntry,
  parseExperimentHistoryDetail,
  parseRetainedCompletedExperimentBeforeWithdrawal,
  parseWithdrawalRestoreTarget,
  resolveLabDestinationName,
} from "./sampleFlow.experimentHelpers";
import { buildOrderedTrayExperiments } from "./sampleFlow.experimentOrder";
import {
  resolveExperimentRunEntry,
  resolveExperimentRunStatus,
} from "./sampleFlow.experimentRuns";
import {
  normalizeHistoryFlowLabel,
  setLatestFlowTime,
} from "./sampleFlow.flowTimeHelpers";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
import {
  APPEARANCE_SENT_STATUS_LABEL,
  historyEntryAppliesToTray,
  resolveExperimentCycleBoundaryMap,
  resolveExperimentRuntimeCutoffMap,
} from "./sampleFlow.runtimeEvidence";

const buildTrayFlowTimeMap = (input = {}) => {
  const taskCode = normalizeText(input.taskCode);
  const trayCode = normalizeText(input.trayCode);
  const orderedExperiments = buildOrderedTrayExperiments({
    taskCode,
    trayCode,
    experiments: input.experiments,
    experimentTrays: input.experimentTrays,
    schedules: input.schedules,
  });
  const cycleBoundaryMap = resolveExperimentCycleBoundaryMap({
    orderedExperiments,
    experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
    samples: input.samples,
    stagingEvents: input.stagingEvents || input.staging_events,
    taskCode,
    trayCode,
  });
  const inputCurrentExperimentCode = normalizeText(input.currentExperimentCode);
  const currentCycleBoundary = cycleBoundaryMap.get(inputCurrentExperimentCode)
    || Array.from(cycleBoundaryMap.values()).sort(
      (left, right) => Number(right?.cycleStartAt || 0) - Number(left?.cycleStartAt || 0),
    )[0]
    || null;
  const canceledAt = Number(currentCycleBoundary?.canceledAt) || 0;
  const cycleStartAt = Number(currentCycleBoundary?.cycleStartAt) || 0;
  const resetAfterCancellationLabels = new Set([
    "送至暂存间",
    "已到达暂存间",
    APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
    APPEARANCE_STOCKED_STATUS,
    "送至实验室",
    "已到达实验室",
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
  ]);
  const laboratoryCycleLabels = new Set([
    "送至实验室",
    "已到达实验室",
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
  ]);
  const timeMap = new Map();
  const timeSourceMap = new Map();
  const timeHistoryMap = new Map();
  const recordLatestFlowTime = (label, time, source = "history") => {
    const normalizedLabel = normalizeText(label);
    const timeValue = parseTimeValue(time);
    if (
      canceledAt
      && resetAfterCancellationLabels.has(normalizedLabel)
      && timeValue > 0
      && timeValue < canceledAt
    ) {
      return;
    }
    if (
      cycleStartAt
      && laboratoryCycleLabels.has(normalizedLabel)
      && timeValue > 0
      && timeValue < cycleStartAt
    ) {
      return;
    }
    setLatestFlowTime(timeMap, normalizedLabel, time, timeSourceMap, source, timeHistoryMap);
  };
  if (!trayCode) {
    timeMap.timeHistoryMap = timeHistoryMap;
    return timeMap;
  }

  (Array.isArray(input.samples) ? input.samples : []).forEach((sample) => {
    if (taskCode && normalizeText(sample?.task_code) !== taskCode) {
      return;
    }
    const trayEntries = asArray(sample?.trays).filter((tray) => normalizeText(tray?.tray_code) === trayCode);
    if (trayEntries.length === 0) {
      return;
    }
    const historyEntries = asArray(sample?.history);
    const latestWithdrawal = latestWithdrawalHistoryEntry(historyEntries);
    const latestWithdrawalEntry = latestWithdrawal?.entry || null;
    const restoreTarget = latestWithdrawalEntry
      ? parseWithdrawalRestoreTarget(latestWithdrawalEntry?.detail, taskCode)
      : null;
    const latestWithdrawalRank = latestWithdrawalEntry
      ? resolveFlowStatusRank(latestWithdrawalEntry?.location, restoreTarget?.status || latestWithdrawalEntry?.status)
      : -1;
    const restoreCycleBoundaryTime = latestWithdrawal && restoreTarget
      ? historyEntries.reduce((latestTime, entry) => {
        const entryTime = entryTimeValue(entry);
        if (!entryTime || entryTime >= latestWithdrawal.time) {
          return latestTime;
        }
        const experimentEvent = parseExperimentHistoryDetail(entry?.detail, taskCode);
        const restoredExperimentName = normalizeText(restoreTarget?.experimentName);
        const historyExperimentName = normalizeText(experimentEvent?.experimentName);
        if (restoredExperimentName && historyExperimentName && restoredExperimentName !== historyExperimentName) {
          return latestTime;
        }
        const withdrawalStatus = normalizeText(latestWithdrawalEntry?.status);
        const restoredStatus = isAxisPartialProgressStatus(withdrawalStatus)
          ? withdrawalStatus
          : normalizeText(restoreTarget?.status || withdrawalStatus);
        const entryStatus = normalizeText(experimentEvent?.status || entry?.status);
        const matchesRestoreBoundary = isAxisPartialProgressStatus(restoredStatus)
          ? isAxisPartialProgressStatus(entryStatus)
          : normalizeLifecycleStatus(entry?.location, entryStatus) === normalizeLifecycleStatus(latestWithdrawalEntry?.location, restoredStatus);
        return matchesRestoreBoundary ? Math.max(latestTime, entryTime) : latestTime;
      }, 0)
      : 0;
    const shouldIgnoreHistoryTime = (entry, label, entryLocation, historyExperimentEvent = null) => {
      if (!latestWithdrawal) {
        return false;
      }
      const entryTime = entryTimeValue(entry);
      if (entryTime >= latestWithdrawal.time) {
        return false;
      }
      const restoredExperimentName = normalizeText(restoreTarget?.experimentName);
      const historyExperimentName = normalizeText(historyExperimentEvent?.experimentName);
      if (restoredExperimentName && historyExperimentName && restoredExperimentName !== historyExperimentName) {
        return false;
      }
      if (restoreCycleBoundaryTime) {
        return entryTime > restoreCycleBoundaryTime;
      }
      const labelRank = resolveFlowStatusRank(entryLocation, label);
      if (labelRank <= latestWithdrawalRank) {
        return false;
      }
      return true;
    };
    if (latestWithdrawalEntry) {
      const withdrawalTime = latestWithdrawalEntry?.time
        || latestWithdrawalEntry?.updated_at
        || latestWithdrawalEntry?.created_at
        || latestWithdrawalEntry?.timestamp;
      if (restoreTarget?.experimentName && restoreTarget.status === "实验已完成") {
        const restoredCompletedEntry = findCompletedExperimentHistoryEntry(
          historyEntries,
          taskCode,
          restoreTarget.experimentName,
          latestWithdrawal.time,
        );
        setLatestFlowTime(
          timeMap,
          `${restoreTarget.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`,
          restoredCompletedEntry?.entry?.time || withdrawalTime,
          timeSourceMap,
          "history",
          timeHistoryMap,
        );
      } else {
        const withdrawalStatus = normalizeText(latestWithdrawalEntry?.status);
        const restoreStatusForLabel = isAxisPartialProgressStatus(withdrawalStatus)
          ? withdrawalStatus
          : restoreTarget?.status || withdrawalStatus;
        const restoreLabel = normalizeHistoryFlowLabel(
          restoreStatusForLabel,
          latestWithdrawalEntry?.location,
        );
        const withdrawalTimeSource = [APPEARANCE_STOCKED_STATUS, APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS].includes(restoreLabel)
          ? "withdrawal"
          : "history";
        if (!isAxisPartialProgressStatus(restoreLabel)) {
          recordLatestFlowTime(restoreLabel, withdrawalTime, withdrawalTimeSource);
        }
      }
    }

    trayEntries.forEach((tray) => {
      const rawTrayStatus = normalizeText(tray?.status || tray?.tray_status || tray?.trayStatus);
      if (!rawTrayStatus) {
        return;
      }
      const trayStatus = normalizeLifecycleStatus(sample?.location, rawTrayStatus);
      const trayStatusLabel = isPostRetentionLocation(sample?.location) && isAmbiguousStagingStatus(trayStatus)
        ? POST_EXPERIMENT_STAGING_STOCKED_STATUS
        : trayStatus;
      if (trayStatusLabel === APPEARANCE_SENT_STATUS_LABEL) {
        return;
      }
      if (
        latestWithdrawalEntry
        && historyEntryAppliesToTray(latestWithdrawalEntry, sample, trayCode)
        && isAxisPartialProgressStatus(latestWithdrawalEntry?.status)
        && isAxisPartialProgressStatus(trayStatusLabel)
      ) {
        return;
      }
      recordLatestFlowTime(trayStatusLabel, tray?.updated_at, "fallback");
    });

    historyEntries.forEach((entry) => {
      const time = entry?.time || entry?.updated_at || entry?.created_at || entry?.timestamp;
      const withdrawalEntry = WITHDRAWAL_ACTIONS.has(normalizeText(entry?.action));
      const statusLabel = normalizeHistoryFlowLabel(entry?.status, entry?.location);
      const actionLabel = normalizeHistoryFlowLabel(entry?.action, entry?.location, { allowLocationFallback: false });
      const detailLabel = normalizeHistoryFlowLabel(entry?.detail, entry?.location, { allowLocationFallback: false });
      const experimentEvent = parseExperimentHistoryDetail(entry?.detail, taskCode);
      const postExperimentStagingDispatch =
        normalizeText(entry?.action) === "外观检测间扫码出库"
        && [statusLabel, actionLabel, detailLabel].includes(POST_EXPERIMENT_STAGING_SENT_STATUS);
      const hasPostTestStagingLabel = [statusLabel, actionLabel, detailLabel].some((label) =>
        label === POST_EXPERIMENT_STAGING_SENT_STATUS || label === POST_EXPERIMENT_STAGING_STOCKED_STATUS,
      );
      const actualAppearanceStorage =
        statusLabel === APPEARANCE_STOCKED_STATUS
        && normalizeText(entry?.location).includes("外观检测间");
      const labels = withdrawalEntry
        ? []
        : [statusLabel, actionLabel, detailLabel].filter((label) => {
          if (!experimentEvent || label !== actionLabel || label !== "已到达实验室") {
            return true;
          }
          return !statusLabel || statusLabel === actionLabel;
        });
      labels.forEach((label) => {
        if (postExperimentStagingDispatch && label === POST_EXPERIMENT_STAGING_SENT_STATUS) {
          return;
        }
        if (hasPostTestStagingLabel && label === "已到达暂存间") {
          return;
        }
        if (label === APPEARANCE_SENT_STATUS_LABEL) {
          return;
        }
        if (!label || (!actualAppearanceStorage && shouldIgnoreHistoryTime(entry, label, entry?.location, experimentEvent))) {
          return;
        }
        recordLatestFlowTime(label, time);
      });
      if (postExperimentStagingDispatch) {
        recordLatestFlowTime(POST_EXPERIMENT_STAGING_DISPATCH_TIME_LABEL, time);
      }
      if ([statusLabel, actionLabel, detailLabel].includes("送至实验室")) {
        const dispatchLab = resolveLabDestinationName(entry?.target_lab, entry?.targetLab, entry?.location, entry?.detail);
        const dispatchLabel = buildLabDispatchStepLabel(dispatchLab);
        if (dispatchLabel !== "送至实验室") {
          recordLatestFlowTime(dispatchLabel, time);
        }
      }
      if (experimentEvent) {
        const currentTime = entryTimeValue(entry);
        if (latestWithdrawal && currentTime < latestWithdrawal.time) {
          const restoreStatus = normalizeText(restoreTarget?.status || latestWithdrawalEntry?.status);
          if (
            isAxisPartialProgressStatus(experimentEvent.status) &&
            (
              isAxisPartialProgressStatus(restoreStatus) ||
              normalizeText(restoreTarget?.experimentName) === normalizeText(experimentEvent.experimentName)
            )
          ) {
            recordLatestFlowTime(experimentEvent.status, time);
          }
          const retainedCompleted = parseRetainedCompletedExperimentBeforeWithdrawal(
            entry,
            taskCode,
            latestWithdrawalEntry,
            restoreTarget,
          );
          if (retainedCompleted) {
            setLatestFlowTime(
              timeMap,
              `${retainedCompleted.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`,
              time,
              timeSourceMap,
              "history",
              timeHistoryMap,
            );
          }
          return;
        }
        const experimentStatus = normalizeLifecycleStatus("", experimentEvent.status);
        if (isAxisPartialProgressStatus(experimentEvent.status)) {
          recordLatestFlowTime(experimentEvent.status, time);
        }
        if (experimentStatus === "实验进行中" || experimentStatus === "实验中") {
          recordLatestFlowTime(`${experimentEvent.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.running}`, time);
        }
        if (experimentStatus === "实验已完成" || experimentStatus === "实验完成") {
          recordLatestFlowTime(`${experimentEvent.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`, time);
        }
      }
    });
  });

  // A mid-experiment appearance return is the newest physical dispatch to the
  // salt-spray laboratory. Keep that display time after the pause is resumed;
  // the original dispatch history remains intact for auditing.
  asArray(input.stagingEvents || input.staging_events).forEach((event) => {
    const eventTaskCode = normalizeText(event?.task_code || event?.taskCode || event?.task_no || event?.taskNo);
    const eventTrayCode = normalizeText(event?.tray_code || event?.trayCode || event?.tray_no || event?.trayNo);
    const targetLabCode = normalizeText(event?.target_lab_code || event?.targetLabCode);
    const targetLab = normalizeText(event?.target_lab || event?.targetLab);
    if (
      normalizeText(event?.room) !== "appearance"
      || normalizeText(event?.appearance_phase || event?.appearancePhase) !== "mid_experiment"
      || normalizeText(event?.action) !== "stock_out"
      || eventTrayCode !== trayCode
      || (taskCode && eventTaskCode && eventTaskCode !== taskCode)
      || (targetLabCode !== "LAB_SALT" && !targetLab.includes("盐雾"))
    ) {
      return;
    }
    const returnTime = event?.time || event?.updated_at || event?.updatedAt;
    recordLatestFlowTime("送至盐雾试验室", returnTime, "storage-event");
    recordLatestFlowTime("送至实验室", returnTime, "storage-event");
  });

  const runtimeCutoffTimeByExperimentCode = resolveExperimentRuntimeCutoffMap({
    orderedExperiments,
    experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
    samples: input.samples,
    stagingEvents: input.stagingEvents || input.staging_events,
    taskCode,
    trayCode,
  });
  const runtimeCutoffTimeForExperiment = (experiment) =>
    runtimeCutoffTimeByExperimentCode.get(normalizeText(experiment?.code)) || 0;
  orderedExperiments.forEach((experiment) => {
    const matchedRun = resolveExperimentRunEntry({
      experimentCode: experiment.code,
      experimentRuns: input.experimentRuns || input.experiment_runs,
      experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
      runtimeCutoffTime: runtimeCutoffTimeForExperiment(experiment),
      taskCode,
      trayCode,
    });
    const runtimeStatus = resolveExperimentRunStatus({
      experiment,
      experimentCode: experiment.code,
      experimentRuns: input.experimentRuns || input.experiment_runs,
      experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
      experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
      experiments: orderedExperiments,
      runtimeCutoffTime: runtimeCutoffTimeForExperiment(experiment),
      schedules: input.schedules,
      taskCode,
      trayCode,
    });
    if (isAxisPartialProgressStatus(runtimeStatus)) {
      const startTime = normalizeText(matchedRun?.started_at || matchedRun?.startedAt || matchedRun?.created_at || matchedRun?.createdAt);
      if (startTime) {
        uniqueNormalizedTexts([
          experiment.displayName,
          experiment.name,
          experiment.code,
          ...(Array.isArray(experiment.aliases) ? experiment.aliases : []),
        ]).forEach((name) => {
          recordLatestFlowTime(`${name}${EXPERIMENT_FLOW_STATUS_LABELS.running}`, startTime, "runtime");
        });
      }
      const time = normalizeText(matchedRun?.ended_at || matchedRun?.endedAt || matchedRun?.updated_at || matchedRun?.updatedAt);
      if (time) {
        recordLatestFlowTime(runtimeStatus, time, "runtime");
      }
      return;
    }
    const runStatus = normalizeLifecycleStatus("", matchedRun?.status);
    const statusKey = RUNNING_EXPERIMENT_RUN_STATUSES.has(runStatus)
      ? "running"
      : runStatus === "实验已完成" || runStatus === "实验完成"
        ? "completed"
        : "";
    if (!statusKey) {
      return;
    }
    const time = statusKey === "completed"
      ? normalizeText(matchedRun?.ended_at || matchedRun?.endedAt || matchedRun?.updated_at || matchedRun?.updatedAt)
      : normalizeText(matchedRun?.started_at || matchedRun?.startedAt || matchedRun?.updated_at || matchedRun?.updatedAt);
    if (!time) {
      return;
    }
    const suffix = EXPERIMENT_FLOW_STATUS_LABELS[statusKey];
    uniqueNormalizedTexts([
      experiment.displayName,
      experiment.name,
      experiment.code,
      ...(Array.isArray(experiment.aliases) ? experiment.aliases : []),
    ]).forEach((name) => {
      recordLatestFlowTime(`${name}${suffix}`, time, "runtime");
    });
  });

  timeMap.timeHistoryMap = timeHistoryMap;
  return timeMap;
};

export {
  buildTrayFlowTimeMap,
};
