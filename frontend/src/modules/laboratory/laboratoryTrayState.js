import { normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";
import {
  COMPLETED_TRAY_STATUSES,
  entryMatchesTrayCode,
} from "./scheduleCompletion";
import {
  APPEARANCE_STORAGE_STATUSES,
  EXPERIMENT_COMPLETED_STATUS,
  LAB_RESET_STATUS,
  PRE_DISPATCH_STATUSES,
  UNIFIED_TRAY_FLOW_STATUS_RANK,
} from "./laboratoryConstants";
import { resolveLatestExperimentHistoryStatus } from "./laboratoryHistory";
import {
  resolveLaboratoryStatusRank,
  resolveUnifiedTrayFlowRank,
} from "./laboratoryTrayEligibility";
import { toTime } from "./laboratoryPresentation";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const shouldRevertLaboratoryTrayStatus = (status, { includeRunning = false } = {}) => {
  const normalized = normalizeText(status);
  const rank = resolveLaboratoryStatusRank(normalized);
  return normalized === LAB_RESET_STATUS || (rank >= 1 && rank < (includeRunning ? 5 : 4));
};

const resolveUnifiedTrayLifecycleTime = ({ sample, status, tray, trayCode }) => {
  const normalizedStatus = normalizeText(status);
  const normalizedTrayCode = normalizeText(trayCode);
  const candidateTimes = [
    toTime(tray?.updated_at || tray?.updatedAt),
    toTime(sample?.updated_at || sample?.updatedAt),
  ].filter(Number.isFinite);
  asArray(sample?.history).forEach((entry) => {
    if (normalizedTrayCode && !entryMatchesTrayCode(entry, normalizedTrayCode)) {
      return;
    }
    const entryStatus = normalizeLifecycleStatus(entry?.location, entry?.status);
    const entryMentionsStatus =
      entryStatus === normalizedStatus
      || normalizeText(entry?.action).includes(normalizedStatus)
      || normalizeText(entry?.detail).includes(normalizedStatus);
    if (!entryMentionsStatus) {
      return;
    }
    const entryTime = toTime(entry?.time || entry?.created_at || entry?.createdAt || entry?.updated_at || entry?.updatedAt);
    if (Number.isFinite(entryTime)) {
      candidateTimes.push(entryTime);
    }
  });
  return candidateTimes.length > 0 ? Math.max(...candidateTimes) : 0;
};

const resolveUnifiedTrayLifecycleCandidate = ({ location, sample, tray, trayCode }) => {
  const normalizedLocation = normalizeText(location);
  const trayStatus = normalizeText(tray?.status);
  const status = normalizeLifecycleStatus(
    normalizedLocation,
    trayStatus,
  );
  return {
    location: normalizedLocation,
    rank: resolveUnifiedTrayFlowRank(status),
    status,
    time: resolveUnifiedTrayLifecycleTime({ sample, status, tray, trayCode }),
  };
};

const shouldReplaceUnifiedTrayLifecycle = (row, candidate) => {
  if (!candidate?.status) {
    return false;
  }
  const currentTime = Number(row?.lifecycleTime) || 0;
  const candidateTime = Number(candidate?.time) || 0;
  if (candidateTime || currentTime) {
    if (candidateTime !== currentTime) {
      return candidateTime > currentTime;
    }
    const currentStatus = normalizeLifecycleStatus(row?.lifecycleLocation, row?.lifecycleStatus);
    const candidateStatus = normalizeLifecycleStatus(candidate?.location, candidate?.status);
    if (
      PRE_DISPATCH_STATUSES.has(currentStatus)
      && !PRE_DISPATCH_STATUSES.has(candidateStatus)
      && candidate.rank >= (UNIFIED_TRAY_FLOW_STATUS_RANK.get(EXPERIMENT_COMPLETED_STATUS) ?? 9)
    ) {
      return false;
    }
    return candidate.rank > resolveUnifiedTrayFlowRank(row?.lifecycleStatus);
  }
  return !row?.lifecycleStatus || candidate.rank > resolveUnifiedTrayFlowRank(row.lifecycleStatus);
};

const isFixtureReady = (value) => {
  if (value === true) {
    return true;
  }
  const normalized = normalizeText(value).toLowerCase();
  return ["1", "true", "yes", "ready", "fixture_ready", "夹具安装完成"].includes(normalized);
};

const buildTaskMap = (tasks) => {
  const taskMap = new Map();
  asArray(tasks).forEach((task) => {
    const code = normalizeText(task?.code);
    if (code) {
      taskMap.set(code, task);
    }
  });
  return taskMap;
};

const buildExperimentMap = (experiments) => {
  const experimentMap = new Map();
  asArray(experiments).forEach((experiment) => {
    const taskCode = normalizeText(experiment?.task_code);
    const experimentCode = normalizeText(experiment?.experiment_code);
    if (taskCode && experimentCode) {
      experimentMap.set(`${taskCode}::${experimentCode}`, normalizeText(experiment?.experiment_name));
    }
  });
  return experimentMap;
};

const buildExperimentRecordMap = (experiments) => {
  const experimentMap = new Map();
  asArray(experiments).forEach((experiment) => {
    const taskCode = normalizeText(experiment?.task_code);
    const experimentCode = normalizeText(experiment?.experiment_code);
    if (taskCode && experimentCode) {
      experimentMap.set(`${taskCode}::${experimentCode}`, experiment);
    }
  });
  return experimentMap;
};

const buildSampleMap = (samples) => {
  const sampleMap = new Map();
  asArray(samples).forEach((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    if (!taskCode) {
      return;
    }
    const current = sampleMap.get(taskCode) || [];
    current.push(sample);
    sampleMap.set(taskCode, current);
  });
  return sampleMap;
};

const experimentIsCompletedInSampleHistory = ({ experimentName, sample, taskCode, trayCode = "" }) =>
  COMPLETED_TRAY_STATUSES.has(resolveLatestExperimentHistoryStatus({ experimentName, sample, taskCode, trayCode }));

const resolveCurrentExperimentTrayStatus = ({
  completedForCurrentExperiment = false,
  completedForOtherExperiment = false,
  currentExperimentCode,
  device,
  experimentCodes = [],
  experimentName,
  historyStatus,
  physicalStatus,
  sample,
  targetExperimentCode = "",
  targetLab = "",
  taskCode,
  trayCode = "",
}) => {
  const resolvedHistoryStatus = historyStatus === undefined
    ? resolveLatestExperimentHistoryStatus({ experimentName, sample, taskCode, trayCode })
    : normalizeText(historyStatus);
  const normalizedStatus = normalizeText(physicalStatus);
  if (normalizedStatus === "送至外观检测间" || APPEARANCE_STORAGE_STATUSES.has(normalizedStatus)) {
    return normalizedStatus;
  }
  if (resolvedHistoryStatus) {
    const historyRank = resolveLaboratoryStatusRank(resolvedHistoryStatus);
    const physicalRank = resolveLaboratoryStatusRank(normalizedStatus);
    if (COMPLETED_TRAY_STATUSES.has(resolvedHistoryStatus)) {
      return resolvedHistoryStatus;
    }
    if (normalizedStatus && historyRank > 0 && physicalRank < historyRank) {
      return normalizedStatus;
    }
    return normalizedStatus || resolvedHistoryStatus;
  }

  const sharedTray = asArray(experimentCodes).length > 1;
  if (!sharedTray) {
    return normalizedStatus;
  }
  if (COMPLETED_TRAY_STATUSES.has(normalizedStatus)) {
    const normalizedTargetLab = normalizeText(targetLab);
    const normalizedDevice = normalizeText(device);
    if (
      completedForOtherExperiment
      && !completedForCurrentExperiment
      && normalizedTargetLab
      && normalizedDevice
      && normalizedTargetLab !== normalizedDevice
    ) {
      return LAB_RESET_STATUS;
    }
    return completedForCurrentExperiment || completedForOtherExperiment
      ? normalizedStatus
      : LAB_RESET_STATUS;
  }
  if (normalizedStatus === LAB_RESET_STATUS) {
    return normalizedStatus;
  }
  const normalizedTargetExperimentCode = normalizeText(targetExperimentCode);
  const normalizedCurrentExperimentCode = normalizeText(currentExperimentCode);
  if (
    normalizedTargetExperimentCode
    && normalizedCurrentExperimentCode
    && normalizedTargetExperimentCode !== normalizedCurrentExperimentCode
    && resolveLaboratoryStatusRank(normalizedStatus) > 0
  ) {
    return LAB_RESET_STATUS;
  }

  const location = normalizeText(sample?.location);
  const currentDevice = normalizeText(device);
  if (!location || !currentDevice || location === currentDevice) {
    return normalizedStatus;
  }
  if (resolveLaboratoryStatusRank(normalizedStatus) > 0) {
    return LAB_RESET_STATUS;
  }
  return normalizedStatus;
};

export {
  buildExperimentMap,
  buildExperimentRecordMap,
  buildSampleMap,
  buildTaskMap,
  experimentIsCompletedInSampleHistory,
  isFixtureReady,
  resolveCurrentExperimentTrayStatus,
  resolveUnifiedTrayLifecycleCandidate,
  shouldReplaceUnifiedTrayLifecycle,
  shouldRevertLaboratoryTrayStatus,
};
