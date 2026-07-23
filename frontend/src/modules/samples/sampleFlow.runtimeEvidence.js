import {
  APPEARANCE_STOCKED_STATUS,
  POST_EXPERIMENT_STAGING_SENT_STATUS,
  WITHDRAWAL_ACTIONS,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import {
  asArray,
  entryMatchesTrayCode,
  entryTimeValue,
  getSampleTrayList,
  parseTimeValue,
  resolveEntryTaskCode,
  resolveEntryTrayCode,
  uniqueNormalizedTexts,
} from "./sampleFlow.trayScope";
import { normalizeLifecycleStatus } from "./sampleFlow.status";
import {
  latestWithdrawalHistoryEntry,
  parseExperimentHistoryDetail,
  parseWithdrawalRestoreTarget,
  resolveLabDestinationName,
} from "./sampleFlow.experimentHelpers";
import { buildOrderedTrayExperiments } from "./sampleFlow.experimentOrder";
import {
  resolveExperimentRunEntry,
  resolveExperimentRunStatus,
} from "./sampleFlow.experimentRuns";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";

const APPEARANCE_SENT_STATUS_LABEL = "送至外观检测间";
const POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS = POST_EXPERIMENT_STAGING_SENT_STATUS === "送至暂存间";
const PARTIAL_AXIS_STABLE_CURRENT_STATUSES = new Set([
  "送至实验室",
  "已到达实验室",
  "工装夹具安装",
  "实验准备就绪",
  "实验进行中",
  "实验中",
  "实验已完成",
  "实验完成",
]);

const resolveSingleTrayExperiment = (input = {}) => {
  const orderedExperiments = buildOrderedTrayExperiments({
    taskCode: input.taskCode,
    trayCode: input.trayCode,
    experiments: input.experiments,
    experimentTrays: input.experimentTrays,
    schedules: input.schedules,
  });
  return orderedExperiments.length === 1 ? orderedExperiments[0] : null;
};

const resolveExperimentRuntimeFlowEvent = ({
  experiment,
  experimentRuns,
  experimentRunSteps,
  experimentRunTrays,
  experiments,
  runtimeCutoffTime = 0,
  schedules,
  taskCode,
  trayCode,
}) => {
  const experimentCode = normalizeText(experiment?.code || experiment?.experiment_code || experiment?.experimentCode);
  const status = resolveExperimentRunStatus({
    experiment,
    experimentCode,
    experimentRuns,
    experimentRunSteps,
    experimentRunTrays,
    experiments,
    runtimeCutoffTime,
    schedules,
    taskCode,
    trayCode,
  });
  const run = resolveExperimentRunEntry({
    experimentCode,
    experimentRuns,
    experimentRunTrays,
    runtimeCutoffTime,
    taskCode,
    trayCode,
  });
  const completedLike = isAxisPartialProgressStatus(status) || normalizeLifecycleStatus("", status) === "实验已完成";
  const time = completedLike
    ? normalizeText(run?.ended_at || run?.endedAt || run?.updated_at || run?.updatedAt)
    : normalizeText(run?.started_at || run?.startedAt || run?.updated_at || run?.updatedAt);
  return {
    status,
    time,
    timeValue: parseTimeValue(time),
  };
};

const partialAxisStatusMatchesExperiment = (status, experiment) => {
  const normalizedStatus = normalizeText(status);
  if (!isAxisPartialProgressStatus(normalizedStatus)) {
    return false;
  }
  return uniqueNormalizedTexts([
    experiment?.displayName,
    experiment?.name,
    experiment?.experiment_name,
    experiment?.experimentName,
    experiment?.experiment_type,
    experiment?.experimentType,
    experiment?.test_type,
    experiment?.testType,
    ...(Array.isArray(experiment?.aliases) ? experiment.aliases : []),
  ]).some((name) => name && normalizedStatus.startsWith(name));
};

const experimentIdentityNames = (experiment) => uniqueNormalizedTexts([
  experiment?.displayName,
  experiment?.name,
  experiment?.experiment_name,
  experiment?.experimentName,
  experiment?.experiment_type,
  experiment?.experimentType,
  experiment?.test_type,
  experiment?.testType,
  ...(Array.isArray(experiment?.aliases) ? experiment.aliases : []),
]);

const withdrawalRestoreTargetMatchesExperiment = (restoreTarget, experiment) => {
  const targetName = normalizeText(restoreTarget?.experimentName);
  return Boolean(targetName) && experimentIdentityNames(experiment).includes(targetName);
};

const withdrawalRestoreTargetInvalidatesRuntime = (restoreTarget) => {
  const status = normalizeText(restoreTarget?.status);
  if (!status) {
    return false;
  }
  return normalizeLifecycleStatus("", status) !== "实验已完成" && !isAxisPartialProgressStatus(status);
};

const historyEntryAppliesToTray = (entry, sample, trayCode) => {
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTrayCode) {
    return false;
  }
  if (entryMatchesTrayCode(entry, normalizedTrayCode)) {
    return true;
  }
  const sampleTrayCodes = getSampleTrayList(sample).map(resolveEntryTrayCode).filter(Boolean);
  return sampleTrayCodes.length === 1 && sampleTrayCodes[0] === normalizedTrayCode;
};

const resolveExperimentRuntimeCutoffMap = ({
  orderedExperiments = [],
  samples = [],
  taskCode,
  trayCode,
} = {}) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTaskCode || !normalizedTrayCode) {
    return new Map();
  }
  const cutoffMap = new Map();
  asArray(samples).forEach((sample) => {
    if (resolveEntryTaskCode(sample) !== normalizedTaskCode) {
      return;
    }
    if (!getSampleTrayList(sample).some((tray) => resolveEntryTrayCode(tray) === normalizedTrayCode)) {
      return;
    }
    asArray(sample?.history).forEach((entry) => {
      if (!WITHDRAWAL_ACTIONS.has(normalizeText(entry?.action))) {
        return;
      }
      if (!historyEntryAppliesToTray(entry, sample, normalizedTrayCode)) {
        return;
      }
      const parsedRestoreTarget = parseWithdrawalRestoreTarget(entry?.detail, normalizedTaskCode);
      const restoreTarget = parsedRestoreTarget && isAxisPartialProgressStatus(entry?.status)
        ? { ...parsedRestoreTarget, status: normalizeText(entry.status) }
        : parsedRestoreTarget;
      if (!withdrawalRestoreTargetInvalidatesRuntime(restoreTarget)) {
        return;
      }
      const withdrawalTime = entryTimeValue(entry);
      if (!withdrawalTime) {
        return;
      }
      const matchedExperiment = asArray(orderedExperiments).find((experiment) =>
        withdrawalRestoreTargetMatchesExperiment(restoreTarget, experiment),
      );
      const experimentCode = normalizeText(matchedExperiment?.code);
      if (!experimentCode) {
        return;
      }
      const hasCommittedPartialAxisHistory = asArray(sample?.history).some((candidate) => {
        const candidateTime = entryTimeValue(candidate);
        if (!candidateTime || candidateTime >= withdrawalTime || WITHDRAWAL_ACTIONS.has(normalizeText(candidate?.action))) {
          return false;
        }
        const parsedCandidate = parseExperimentHistoryDetail(candidate?.detail, normalizedTaskCode);
        return parsedCandidate
          && isAxisPartialProgressStatus(parsedCandidate.status)
          && historyEntryAppliesToTray(candidate, sample, normalizedTrayCode)
          && (
            partialAxisStatusMatchesExperiment(parsedCandidate.status, matchedExperiment)
            || experimentIdentityNames(matchedExperiment).includes(normalizeText(parsedCandidate.experimentName))
          );
      });
      if (
        hasCommittedPartialAxisHistory
        && ["已到达暂存间", APPEARANCE_STOCKED_STATUS].includes(
          normalizeLifecycleStatus("", restoreTarget?.status),
        )
      ) {
        return;
      }
      cutoffMap.set(experimentCode, Math.max(cutoffMap.get(experimentCode) || 0, withdrawalTime));
    });
  });
  return cutoffMap;
};

const parseAxisPartialProgressStatus = (status) => {
  const matched = normalizeText(status).match(/^(.+)部分完成\s+(\d+)\/(\d+)轴$/);
  if (!matched) {
    return null;
  }
  const completedCount = Number(matched[2]);
  const totalCount = Number(matched[3]);
  const remainingCount = totalCount - completedCount;
  if (!Number.isFinite(completedCount) || !Number.isFinite(totalCount) || remainingCount <= 0) {
    return null;
  }
  return {
    completedCount,
    experimentName: matched[1],
    remainingCount,
    totalCount,
  };
};

const buildPendingAxisContinuationLabel = (status) => {
  const progress = parseAxisPartialProgressStatus(status);
  if (!progress) {
    return "";
  }
  return `待继续${progress.experimentName}：剩余 ${progress.remainingCount}/${progress.totalCount}轴`;
};

const resolveCurrentTrayStatusTime = (input = {}, status = "") => {
  const normalizedTaskCode = normalizeText(input.taskCode);
  const normalizedTrayCode = normalizeText(input.trayCode);
  const normalizedStatus = normalizeLifecycleStatus(input.location, status);
  if (!normalizedTaskCode || !normalizedTrayCode || !normalizedStatus) {
    return 0;
  }
  let latestTime = 0;
  const recordTime = (value) => {
    latestTime = Math.max(latestTime, parseTimeValue(value));
  };
  asArray(input.samples).forEach((sample) => {
    if (resolveEntryTaskCode(sample) !== normalizedTaskCode) {
      return;
    }
    const matchingTrays = getSampleTrayList(sample).filter((tray) =>
      resolveEntryTrayCode(tray) === normalizedTrayCode,
    );
    if (matchingTrays.length === 0) {
      return;
    }
    matchingTrays.forEach((tray) => {
      const trayStatus = normalizeLifecycleStatus(
        sample?.location || input.location,
        tray?.status || tray?.tray_status || tray?.trayStatus,
      );
      if (trayStatus === normalizedStatus) {
        recordTime(tray?.updated_at || tray?.updatedAt || tray?.created_at || tray?.createdAt);
      }
    });
    const sampleStatus = normalizeLifecycleStatus(sample?.location || input.location, sample?.status);
    if (sampleStatus === normalizedStatus) {
      recordTime(sample?.updated_at || sample?.updatedAt || sample?.created_at || sample?.createdAt);
    }
    asArray(sample?.history).forEach((entry) => {
      if (
        normalizeLifecycleStatus(entry?.location || sample?.location || input.location, entry?.status) === normalizedStatus
        && entryMatchesTrayCode(entry, normalizedTrayCode)
      ) {
        recordTime(entry?.time || entry?.updated_at || entry?.updatedAt || entry?.created_at || entry?.createdAt);
      }
    });
  });
  return latestTime;
};

const resolveTrayDispatchTarget = (input = {}) => {
  const normalizedTaskCode = normalizeText(input.taskCode);
  const normalizedTrayCode = normalizeText(input.trayCode);
  if (!normalizedTaskCode || !normalizedTrayCode) {
    return { targetLab: "", targetExperimentCode: "" };
  }

  let targetLab = "";
  let targetExperimentCode = "";
  let latestHistoryMatch = null;

  asArray(input.samples).forEach((sample) => {
    if (resolveEntryTaskCode(sample) !== normalizedTaskCode) {
      return;
    }
    asArray(sample?.trays).forEach((tray) => {
      if (resolveEntryTrayCode(tray) !== normalizedTrayCode) {
        return;
      }
      if (input.ignoreTrayDispatchTarget) {
        return;
      }
      const trayTargetLab = normalizeText(tray?.target_lab || tray?.targetLab);
      if (trayTargetLab) {
        targetLab = trayTargetLab;
      }
      targetExperimentCode = targetExperimentCode
        || normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
    });
    asArray(sample?.history).forEach((entry) => {
      if (input.ignoreTrayDispatchTarget) {
        return;
      }
      const detail = normalizeText(entry?.detail);
      if (!entryMatchesTrayCode(entry, normalizedTrayCode)) {
        return;
      }
      const eventTargetLab = resolveLabDestinationName(
        entry?.target_lab,
        entry?.targetLab,
        entry?.location,
        entry?.location_desc,
        entry?.locationDesc,
        detail,
      );
      if (!eventTargetLab) {
        return;
      }
      const eventTime = entryTimeValue(entry);
      if (!latestHistoryMatch || eventTime >= latestHistoryMatch.time) {
        latestHistoryMatch = { targetLab: eventTargetLab, time: eventTime };
      }
    });
  });

  return {
    targetLab: targetLab || latestHistoryMatch?.targetLab || "",
    targetExperimentCode,
  };
};

const resolveLatestWithdrawalRestoreTarget = ({ taskCode, trayCode, samples = [] } = {}) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTaskCode || !normalizedTrayCode) {
    return null;
  }

  return asArray(samples).reduce((latest, sample) => {
    if (resolveEntryTaskCode(sample) !== normalizedTaskCode) {
      return latest;
    }
    const touchesTray = getSampleTrayList(sample).some((tray) => resolveEntryTrayCode(tray) === normalizedTrayCode);
    if (!touchesTray) {
      return latest;
    }
    const withdrawal = latestWithdrawalHistoryEntry(sample?.history);
    const restoreTarget = withdrawal
      ? parseWithdrawalRestoreTarget(withdrawal.entry?.detail, normalizedTaskCode)
      : null;
    if (!restoreTarget) {
      return latest;
    }
    if (!latest || withdrawal.time >= latest.time) {
      return { ...restoreTarget, time: withdrawal.time };
    }
    return latest;
  }, null);
};

export {
  APPEARANCE_SENT_STATUS_LABEL,
  PARTIAL_AXIS_STABLE_CURRENT_STATUSES,
  POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS,
  buildPendingAxisContinuationLabel,
  historyEntryAppliesToTray,
  partialAxisStatusMatchesExperiment,
  resolveCurrentTrayStatusTime,
  resolveExperimentRuntimeCutoffMap,
  resolveExperimentRuntimeFlowEvent,
  resolveLatestWithdrawalRestoreTarget,
  resolveSingleTrayExperiment,
  resolveTrayDispatchTarget,
};
