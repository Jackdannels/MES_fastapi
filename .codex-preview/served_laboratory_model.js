import {
  SAMPLE_FLOW_STEPS,
  buildTrayFlowView,
  normalizeLifecycleStatus,
  synchronizeSamplesForTrayCodes,
} from "/src/modules/samples/samplesFlowModel.js";
import { resolveLabDestinationName } from "/src/modules/samples/sampleFlow.experimentHelpers.js";
import { formatLocalDateTime } from "/src/lib/dateTime.js";
import { resolveLabRef, scheduleMatchesLab } from "/src/lib/labIdentity.js";
import {
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
} from "/src/modules/tasks/model.js";
import { experimentScopeIsTerminal } from "/src/modules/experiment-progress/model.js";

const SALT_SPRAY_LAB = "çé¾è¯éªå®¤";
const LAB_COMPARE_STATUS = "å·²å°è¾¾å®éªå®¤";
const LAB_INSTALL_STATUS = "å·¥è£å¤¹å·å®è£";
const LAB_READY_STATUS = "å®éªåå¤å°±ç»ª";
const LAB_RESET_STATUS = "éè³å®éªå®¤";
const EXPERIMENT_COMPLETED_STATUS = "å®éªå·²å®æ";
const PRE_DISPATCH_STAGING_LOCATION = "ææ¸©ææ¹¿é´ï¼æå­é´ï¼";
const PRE_DISPATCH_STAGING_STATUS = "å·²å°è¾¾æå­é´";
const APPEARANCE_INSPECTION_LOCATION = "å¤è§æ£æµé´";
const APPEARANCE_INSPECTION_STOCKED_STATUS = "å®éªåå¤è§æ£æµé´å­æ¾";
const PRE_EXPERIMENT_APPEARANCE_STOCKED_STATUS = "å®éªåå¤è§æ£æµé´å­æ¾";
const UNIFIED_TRAY_FLOW_STATUS_RANK = new Map(SAMPLE_FLOW_STEPS.map((step, index) => [step.label, index]));
const PRE_DISPATCH_STATUSES = new Set(["å°è´§", "å·²æ¥æ¶", "éè³æå­é´", "å·²å°è¾¾æå­é´"]);
const APPEARANCE_STORAGE_STATUSES = new Set([
  APPEARANCE_INSPECTION_STOCKED_STATUS,
  PRE_EXPERIMENT_APPEARANCE_STOCKED_STATUS,
]);
const RUNNING_EXPERIMENT_STATUSES = new Set(["å®éªè¿è¡ä¸­", "å®éªä¸­"]);
const LAB_DISPATCH_HISTORY_ACTIONS = new Set(["æå­é´æ«ç åºåº", "å¤è§æ£æµé´æ«ç åºåº", "æ¥é©³åºæ«ç åºåº", "éè³å®éªå®¤"]);
const LABORATORY_TASK_FLOW_STEPS = [
  { key: "waiting", label: STATUS_WAITING },
  { key: "scheduled", label: STATUS_SCHEDULED },
  { key: "running", label: STATUS_RUNNING },
  { key: "completed", label: STATUS_COMPLETED },
  { key: "returned", label: STATUS_RETENTION },
];
const LABORATORY_TASK_FLOW_INDEX = new Map(LABORATORY_TASK_FLOW_STEPS.map((step, index) => [step.label, index]));
const COMPLETED_EXPERIMENT_STATUSES = new Set(["å®éªå·²å®æ", "å®éªå·²ç»å®æ", "å®éªå®æ"]);
const COMPLETED_TRAY_STATUSES = new Set(["å®éªå·²å®æ", "å®éªå·²ç»å®æ", "å®éªå®æ", "å®éªåæå­é´å­æ¾", "åå®¶æ¶å"]);
const EXPERIMENT_TRAY_TERMINAL_STATUSES = new Set([
  ...COMPLETED_EXPERIMENT_STATUSES,
  "å®éªåæå­é´å­æ¾",
  "åå®¶æ¶å",
]);

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeAxisCodes = (value) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/ï¼/g, ",").split(",")
      : [];
  const seen = new Set();
  return rawValues.map(normalizeText).filter((axisCode) => {
    if (!axisCode || seen.has(axisCode)) {
      return false;
    }
    seen.add(axisCode);
    return true;
  });
};
const resolveSubExperimentCode = (value = {}) =>
  normalizeText(value?.subExperimentCode ?? value?.sub_experiment_code ?? value?.sub_experiment_no ?? value?.subExperimentNo);
const escapeRegExp = (value) => normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const experimentHistoryStatusIsWithdrawal = (status) => normalizeText(status).startsWith("æ¤åè³");
const resolveTrayCode = (entry) => normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo || entry?.code);
const entryMatchesTrayCode = (entry, trayCode) => {
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTrayCode) {
    return false;
  }
  const structuredTrayCode = resolveTrayCode(entry);
  if (structuredTrayCode) {
    return structuredTrayCode === normalizedTrayCode;
  }
  const detail = normalizeText(entry?.detail);
  if (!detail) {
    return false;
  }
  const escaped = escapeRegExp(normalizedTrayCode);
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(detail);
};
const historyEntryAppliesToTray = (entry, sampleTrayCodes, trayCode) => {
  const matchedTrayCodes = asArray(sampleTrayCodes).filter((code) => entryMatchesTrayCode(entry, code));
  if (matchedTrayCodes.length > 0) {
    return matchedTrayCodes.includes(normalizeText(trayCode));
  }
  return asArray(sampleTrayCodes).length <= 1;
};

const toTime = (value) => {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : null;
};

const toPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const resolvePlannedDurationMs = (schedule, activeRun) => {
  const plannedHours =
    toPositiveNumber(activeRun?.planned_hours ?? activeRun?.plannedHours)
    ?? toPositiveNumber(schedule?.planned_hours ?? schedule?.plannedHours);
  if (plannedHours) {
    return plannedHours * 60 * 60 * 1000;
  }
  const scheduleStartTime = toTime(schedule?.start_at || schedule?.startAt);
  const scheduleEndTime = toTime(schedule?.end_at || schedule?.endAt);
  return Number.isFinite(scheduleStartTime) && Number.isFinite(scheduleEndTime) && scheduleEndTime > scheduleStartTime
    ? scheduleEndTime - scheduleStartTime
    : null;
};

const addDurationToDateTime = (dateTime, durationMs) => {
  const startTime = toTime(dateTime);
  return Number.isFinite(startTime) && Number.isFinite(durationMs) && durationMs > 0
    ? new Date(startTime + durationMs).toISOString()
    : "";
};

const formatTime = (value) => {
  const time = toTime(value);
  if (!Number.isFinite(time)) {
    return "-";
  }
  const date = new Date(time);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const formatDateKey = (value) => {
  const time = value instanceof Date ? value.getTime() : toTime(value);
  if (!Number.isFinite(time)) {
    return "";
  }
  const date = new Date(time);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateTime = (value) => {
  const time = toTime(value);
  if (!Number.isFinite(time)) {
    return "-";
  }
  const date = new Date(time);
  return `${formatDateKey(date)} ${formatTime(date)}`;
};

const formatDuration = (totalSeconds) => {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = String(Math.floor(safeSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(Math.floor(safeSeconds % 60)).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const uniqueValues = (values = []) => {
  const seen = new Set();
  return asArray(values).filter((value) => {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
};

const buildLaboratoryHistoryEntry = (sample, action, status, detail, now) => {
  const history = Array.isArray(sample?.history) ? sample.history.slice() : [];
  history.unshift({
    action,
    detail,
    id: `laboratory-event-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    location: normalizeText(sample?.location) || SALT_SPRAY_LAB,
    owner: normalizeText(sample?.owner),
    status,
    time: now,
  });
  return history;
};

const resolvePreDispatchLocation = (status, location = "") => {
  const normalizedLocation = normalizeText(location);
  if (normalizedLocation) {
    return normalizedLocation;
  }
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === "å°è´§" || normalizedStatus === "å·²æ¥æ¶") {
    return "æ¥é©³åº";
  }
  return PRE_DISPATCH_STAGING_LOCATION;
};

const resolvePreDispatchStatusFromLocation = (location) => {
  const normalizedLocation = normalizeText(location);
  if (normalizedLocation === PRE_DISPATCH_STAGING_LOCATION) {
    return PRE_DISPATCH_STAGING_STATUS;
  }
  if (normalizedLocation === "æ¥é©³åº" || normalizedLocation === "å®¤å¤æ¥é©³åº") {
    return "å°è´§";
  }
  return "";
};

const resolvePreDispatchSnapshot = (sample) => {
  const history = asArray(sample?.history);
  for (const entry of history) {
    const status = normalizeText(entry?.status);
    const location = normalizeText(entry?.location);
    if (PRE_DISPATCH_STATUSES.has(status)) {
      return {
        location: resolvePreDispatchLocation(status, location),
        status,
        time: toTime(entry?.time) || -Infinity,
      };
    }
    const statusFromLocation = resolvePreDispatchStatusFromLocation(location);
    if (statusFromLocation) {
      return {
        location,
        status: statusFromLocation,
        time: toTime(entry?.time) || -Infinity,
      };
    }
  }
  return null;
};

const resolveAppearanceStorageSnapshot = (sample) => {
  const candidates = asArray(sample?.history)
    .map((entry) => {
      const status = normalizeText(entry?.status);
      const location = normalizeText(entry?.location);
      const action = normalizeText(entry?.action);
      const marksAppearanceStorage =
        APPEARANCE_STORAGE_STATUSES.has(status)
        || (
          action === "å¤è§æ£æµé´æ«ç å¥åº"
          && (!status || APPEARANCE_STORAGE_STATUSES.has(status) || location === APPEARANCE_INSPECTION_LOCATION)
        );
      if (!marksAppearanceStorage) {
        return null;
      }
      return {
        experimentName: "",
        location: APPEARANCE_INSPECTION_LOCATION,
        status: APPEARANCE_STORAGE_STATUSES.has(status) ? status : APPEARANCE_INSPECTION_STOCKED_STATUS,
        time: toTime(entry?.time) || -Infinity,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  return candidates[candidates.length - 1] || null;
};

const shouldRevertLaboratoryTrayStatus = (status, { includeRunning = false } = {}) => {
  const normalized = normalizeText(status);
  const rank = resolveLaboratoryStatusRank(normalized);
  return normalized === LAB_RESET_STATUS || (rank >= 1 && rank < (includeRunning ? 5 : 4));
};

const resolveLaboratoryStatusRank = (value) => {
  const normalized = normalizeText(value);
  if (normalized === LAB_COMPARE_STATUS) {
    return 1;
  }
  if (normalized === LAB_INSTALL_STATUS) {
    return 2;
  }
  if (normalized === LAB_READY_STATUS) {
    return 3;
  }
  if (normalized === "å®éªè¿è¡ä¸­" || normalized === "å®éªä¸­") {
    return 4;
  }
  if (normalized === "å®éªå·²å®æ" || normalized === "å®éªåæå­é´å­æ¾" || normalized === "åå®¶æ¶å") {
    return 5;
  }
  return 0;
};

const resolveUnifiedTrayFlowRank = (status) => {
  const normalized = normalizeText(status);
  if (!normalized) {
    return -1;
  }
  const completedIndex = UNIFIED_TRAY_FLOW_STATUS_RANK.get(EXPERIMENT_COMPLETED_STATUS) ?? 9;
  if (normalized === "éè³å¤è§æ£æµé´") {
    return completedIndex + 0.1;
  }
  if (APPEARANCE_STORAGE_STATUSES.has(normalized)) {
    return completedIndex + 0.2;
  }
  return UNIFIED_TRAY_FLOW_STATUS_RANK.get(normalized) ?? -1;
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
  return ["1", "true", "yes", "ready", "fixture_ready", "å¤¹å·å®è£å®æ"].includes(normalized);
};

const buildBlockedComparisonResult = (trayCode, status) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === "å®éªå·²å®æ" || normalizedStatus === "å®éªå®æ" || normalizedStatus === "å®éªåæå­é´å­æ¾" || normalizedStatus === "åå®¶æ¶å") {
    return {
      guidance: `${normalizedTrayCode} å·²å®æå®éªï¼æ éåæ¬¡æ¯å¯¹ã`,
      message: "æçå·²å®æå®éª",
      ok: false,
      tone: "error",
      trayCode: normalizedTrayCode,
    };
  }
  if (normalizedStatus === "å®éªè¿è¡ä¸­" || normalizedStatus === "å®éªä¸­") {
    return {
      guidance: `${normalizedTrayCode} å½åå®éªæ­£å¨è¿è¡ä¸­ï¼ä¸è½åæ¬¡æ¯å¯¹ã`,
      message: "æçå®éªè¿è¡ä¸­",
      ok: false,
      tone: "error",
      trayCode: normalizedTrayCode,
    };
  }
  return {
    guidance: `${normalizedTrayCode} å½åç¶æä¸º${normalizedStatus || "å·²æ¯å¯¹"}ï¼å·²å®æä»»å¡æ¯å¯¹ï¼æ éåæ¬¡æ¯å¯¹ã`,
    message: "æçå·²å®ææ¯å¯¹",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
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

const findExperimentRecord = ({ experiments, experimentCode, taskCode }) =>
  asArray(experiments).find(
    (experiment) =>
      normalizeText(experiment?.task_code) === normalizeText(taskCode)
      && normalizeText(experiment?.experiment_code) === normalizeText(experimentCode),
  ) || null;

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

const parseExperimentHistoryDetail = (detail, taskCode) => {
  const segments = String(detail ?? "")
    .split(" / ")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  if (segments.length < 3 || segments[0] !== normalizeText(taskCode)) {
    return null;
  }
  return {
    experimentName: segments[1],
    status: segments[2],
  };
};

const resolvePreviousCompletedExperimentSnapshot = (sample, taskCode, currentExperimentName) => {
  const candidates = asArray(sample?.history)
    .map((entry) => {
      const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
      if (!parsed || parsed.status !== "å®éªå·²å®æ" || parsed.experimentName === currentExperimentName) {
        return null;
      }
      return {
        experimentName: parsed.experimentName,
        location: normalizeText(entry?.location) || normalizeText(sample?.location),
        status: "å®éªå·²å®æ",
        time: toTime(entry?.time) || -Infinity,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  return candidates[candidates.length - 1] || null;
};

const resolvePreviousStableSnapshot = (sample, taskCode, currentExperimentName) => {
  const preDispatchSnapshot = resolvePreDispatchSnapshot(sample);
  const candidates = [
    resolvePreviousCompletedExperimentSnapshot(sample, taskCode, currentExperimentName),
    resolveAppearanceStorageSnapshot(sample),
    preDispatchSnapshot ? {
      ...preDispatchSnapshot,
      experimentName: "",
    } : null,
  ].filter(Boolean);
  candidates.sort((left, right) => left.time - right.time);
  return candidates[candidates.length - 1];
};

const resolveLatestExperimentHistorySnapshot = ({ experimentName, sample, taskCode, trayCode = "" }) => {
  const normalizedExperimentName = normalizeText(experimentName);
  if (!normalizedExperimentName) {
    return null;
  }
  const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
  let latestSnapshot = null;
  let latestTime = -Infinity;
  asArray(sample?.history).forEach((entry) => {
    const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
    if (!parsed || parsed.experimentName !== normalizedExperimentName) {
      return;
    }
    if (trayCode && !historyEntryAppliesToTray(entry, sampleTrayCodes, trayCode)) {
      return;
    }
    const eventTime = toTime(entry?.time) || 0;
    if (eventTime > latestTime) {
      latestSnapshot = {
        status: parsed.status,
        time: eventTime,
      };
      latestTime = eventTime;
    }
  });
  return latestSnapshot;
};

const resolveLatestAnyExperimentHistorySnapshot = ({ sample, taskCode, trayCode = "" }) => {
  const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
  let latestSnapshot = null;
  let latestTime = -Infinity;
  asArray(sample?.history).forEach((entry) => {
    const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
    if (!parsed) {
      return;
    }
    if (trayCode && !historyEntryAppliesToTray(entry, sampleTrayCodes, trayCode)) {
      return;
    }
    const eventTime = toTime(entry?.time) || 0;
    if (eventTime > latestTime) {
      latestSnapshot = {
        experimentName: parsed.experimentName,
        status: parsed.status,
        time: eventTime,
      };
      latestTime = eventTime;
    }
  });
  return latestSnapshot;
};

const resolveLatestExperimentHistoryStatus = (input) =>
  resolveLatestExperimentHistorySnapshot(input)?.status || null;

const resolveLatestLaboratoryDispatchSnapshot = ({
  currentExperimentCode = "",
  currentLab = "",
  sample,
  trayCode = "",
}) => {
  const normalizedCurrentExperimentCode = normalizeText(currentExperimentCode);
  const normalizedCurrentLab = normalizeText(currentLab);
  const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
  let latestSnapshot = null;
  let latestTime = -Infinity;
  asArray(sample?.history).forEach((entry) => {
    const status = normalizeLifecycleStatus(normalizeText(entry?.status || entry?.flow_status || entry?.flowStatus));
    const action = normalizeText(entry?.action);
    const targetType = normalizeText(entry?.target_type || entry?.targetType);
    if (targetType && targetType !== "lab") {
      return;
    }
    if (status !== LAB_RESET_STATUS && !LAB_DISPATCH_HISTORY_ACTIONS.has(action)) {
      return;
    }
    if (trayCode && !historyEntryAppliesToTray(entry, sampleTrayCodes, trayCode)) {
      return;
    }
    const targetLab = resolveLabDestinationName(
      entry?.target_lab,
      entry?.targetLab,
      entry?.location,
      entry?.location_desc,
      entry?.locationDesc,
      entry?.detail,
    );
    if (!targetLab) {
      return;
    }
    const targetExperimentCode =
      normalizeText(entry?.target_experiment_code || entry?.targetExperimentCode)
      || (normalizedCurrentLab && targetLab === normalizedCurrentLab ? normalizedCurrentExperimentCode : "");
    const eventTime = toTime(entry?.time) || 0;
    if (eventTime > latestTime) {
      latestSnapshot = {
        targetExperimentCode,
        targetLab,
        time: eventTime,
      };
      latestTime = eventTime;
    }
  });
  return latestSnapshot;
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
  if (normalizedStatus === "éè³å¤è§æ£æµé´" || APPEARANCE_STORAGE_STATUSES.has(normalizedStatus)) {
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

const resolveNotDispatchedSourceGuidance = (tray = null) => {
  const location = normalizeText(tray?.currentLocation || tray?.location);
  const status = normalizeText(tray?.trayStatus || tray?.displayStatus);
  if (status === "éè³å¤è§æ£æµé´") {
    return "å½åæçéåè¿å¥å¤è§æ£æµé´å¹¶å®æå¥åºï¼åç±å¤è§æ£æµé´åºåºéè³å®éªå®¤ã";
  }
  if (
    location.includes(APPEARANCE_INSPECTION_LOCATION)
    || status.includes(APPEARANCE_INSPECTION_LOCATION)
  ) {
    return "è¯·åå¨å¤è§æ£æµé´å®æåºåºå¹¶éè³å®éªå®¤ã";
  }
  const sourceLabel = location.includes("æå­é´") || status.includes("æå­é´") ? "æå­é´" : "æ¥é©³é´";
  return `è¯·åå¨${sourceLabel}å®æåºåºå¹¶éè³å®éªå®¤ã`;
};

const buildNotDispatchedComparisonResult = (trayCode, tray = null) => {
  const normalizedTrayCode = normalizeText(trayCode);
  return {
    guidance: resolveNotDispatchedSourceGuidance(tray),
    message: "æçå°æªåºåº",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
};
const buildWrongLaboratoryDispatchResult = (trayCode, tray = null, currentTask = null) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const location = normalizeText(tray?.targetLab || tray?.target_lab || tray?.currentLocation || tray?.location);
  const currentLab = normalizeText(currentTask?.device);
  return {
    guidance: `${normalizedTrayCode} å·²åºåºè³${location || "å¶ä»è¯éªé´"}ï¼è¯·å¨${currentLab || "å½åè¯éªé´"}åºåºååæ¯å¯¹ã`,
    message: "æçæªéè¾¾å½åè¯éªé´",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
};

const buildActiveOtherExperimentComparisonResult = (trayCode, lock = null) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const experimentName = normalizeText(lock?.experimentName);
  const device = normalizeText(lock?.device);
  const runningLabel = [device, experimentName].filter(Boolean).join(" / ") || "å¶ä»å®éª";
  return {
    guidance: `${normalizedTrayCode} æ­£å¨${runningLabel}è¿è¡å®éªï¼å®æåæå¯å¨å½åè¯éªé´æ¯å¯¹ã`,
    message: "æçæ­£å¨å¶ä»å®éªä¸­",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
};

const buildScheduleTrayCodeSet = ({ experimentTrays, experimentCode, taskCode }) =>
  new Set(
    asArray(experimentTrays)
      .filter(
        (entry) =>
          normalizeText(entry?.task_code) === normalizeText(taskCode)
          && normalizeText(entry?.experiment_code) === normalizeText(experimentCode),
      )
      .map((entry) => normalizeText(entry?.tray_code))
      .filter(Boolean),
  );

const buildTrayExperimentCodeMap = (experimentTrays) => {
  const trayMap = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const trayCode = normalizeText(entry?.tray_code);
    const experimentCode = normalizeText(entry?.experiment_code);
    if (!trayCode || !experimentCode) {
      return;
    }
    const current = trayMap.get(trayCode) || new Set();
    current.add(experimentCode);
    trayMap.set(trayCode, current);
  });
  return trayMap;
};

const collectScheduleSamples = ({ experimentTrays, samples, schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scopedTrayCodes = buildScheduleTrayCodeSet({ experimentTrays, experimentCode, taskCode });
  const matchedSamples = asArray(samples).filter((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
    }
    if (!scopedTrayCodes.size) {
      return true;
    }
    return asArray(sample?.trays).some((tray) => scopedTrayCodes.has(normalizeText(tray?.tray_code)));
  });

  return {
    matchedSamples,
    scopedTrayCodes,
    taskCode,
  };
};

const scheduleRunCompletionCoversSchedule = ({ experimentRuns = [], experimentRunTrays = [], schedule, scopedTrayCodes = new Set() }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scheduleId = normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId);
  const scheduleRuns = asArray(experimentRuns).filter((run) =>
    resolveRunTaskCode(run) === taskCode
    && resolveRunExperimentCode(run) === experimentCode
    && (!scheduleId || resolveRunScheduleId(run) === scheduleId),
  );
  const scheduleRunNos = new Set(scheduleRuns.map(resolveRunNo).filter(Boolean));
  const completedRunTrayCodes = new Set(
    asArray(experimentRunTrays)
      .filter((relation) =>
        resolveRelationTaskCode(relation) === taskCode
        && resolveRelationExperimentCode(relation) === experimentCode
        && relationIsCompleted(relation)
        && (!scheduleRunNos.size || scheduleRunNos.has(resolveRelationRunNo(relation))),
      )
      .map(resolveRelationTrayCode)
      .filter(Boolean),
  );
  const scopedCodes = Array.from(scopedTrayCodes).filter(Boolean);
  if (scopedCodes.length > 0) {
    if (scopedCodes.every((trayCode) => completedRunTrayCodes.has(trayCode))) {
      return true;
    }
    const completedRunTrayCodesFromRuns = new Set(
      scheduleRuns
        .filter((run) => COMPLETED_EXPERIMENT_STATUSES.has(resolveRunStatus(run)))
        .flatMap((run) => asArray(run?.tray_codes ?? run?.trayCodes).map(normalizeText))
        .filter(Boolean),
    );
    return completedRunTrayCodesFromRuns.size > 0
      && scopedCodes.every((trayCode) => completedRunTrayCodesFromRuns.has(trayCode));
  }
  return completedRunTrayCodes.size > 0 || scheduleRuns.some((run) => COMPLETED_EXPERIMENT_STATUSES.has(resolveRunStatus(run)));
};

const scheduleExperimentIsCompleted = ({ experiments, experimentRuns = [], experimentRunSteps = [], experimentRunTrays = [], experimentTrays, samples, schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  if (!taskCode) {
    return false;
  }

  const experiment = findExperimentRecord({ experiments, experimentCode, taskCode });
  const axisProgress = buildAxisProgressForSchedule({
    experiment,
    experimentName: normalizeText(experiment?.experiment_name) || normalizeText(experiment?.experiment_type),
    experimentRuns,
    experimentRunSteps,
    schedule,
  });
  if (axisProgress?.remainingAxisCodes?.length > 0) {
    return false;
  }
  const { matchedSamples, scopedTrayCodes } = collectScheduleSamples({ experimentTrays, samples, schedule });
  if (axisProgress?.requiredAxisCodes?.length > 0) {
    return scheduleRunCompletionCoversSchedule({ experimentRuns, experimentRunTrays, schedule, scopedTrayCodes });
  }
  if (COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(experiment?.status)) && scopedTrayCodes.size === 0) {
    return true;
  }

  if (experimentScopeIsTerminal({
    experiments,
    experimentCode,
    experimentRunTrays,
    experimentTrays,
    samples,
    taskCode,
  })) {
    return true;
  }
  if (matchedSamples.length === 0) {
    return false;
  }

  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const hasSharedScopedTray = Array.from(scopedTrayCodes).some((trayCode) => (trayExperimentCodeMap.get(trayCode)?.size || 0) > 1);
  if (experimentCode && hasSharedScopedTray) {
    return false;
  }

  const experimentName = normalizeText(experiment?.experiment_name);
  if (experimentName) {
    const latestHistoryByTray = new Map();
    matchedSamples.forEach((sample) => {
      const sampleTrayCodes = asArray(sample?.trays)
        .map(resolveTrayCode)
        .filter((trayCode) => !scopedTrayCodes.size || scopedTrayCodes.has(trayCode));
      asArray(sample?.history).forEach((entry) => {
        const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
        if (!parsed || parsed.experimentName !== experimentName) {
          return;
        }
        const eventTime = toTime(entry?.time) || 0;
        const targetTrayCodes = sampleTrayCodes.filter((trayCode) =>
          historyEntryAppliesToTray(entry, sampleTrayCodes, trayCode),
        );
        targetTrayCodes.forEach((trayCode) => {
          const existing = latestHistoryByTray.get(trayCode);
          if (!existing || eventTime >= existing.time) {
            latestHistoryByTray.set(trayCode, { status: parsed.status, time: eventTime });
          }
        });
      });
    });

    if (latestHistoryByTray.size > 0) {
      const requiredTrayCodes = scopedTrayCodes.size ? Array.from(scopedTrayCodes) : Array.from(latestHistoryByTray.keys());
      return (
        requiredTrayCodes.length > 0
        && requiredTrayCodes.every((trayCode) => COMPLETED_TRAY_STATUSES.has(latestHistoryByTray.get(trayCode)?.status))
      );
    }
  }

  const statuses = [];
  matchedSamples.forEach((sample) => {
    const sampleTrays = asArray(sample?.trays);
    if (!sampleTrays.length && !scopedTrayCodes.size) {
      const sampleStatus = normalizeText(sample?.status);
      if (sampleStatus) {
        statuses.push(sampleStatus);
      }
      return;
    }
    sampleTrays.forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (scopedTrayCodes.size && !scopedTrayCodes.has(trayCode)) {
        return;
      }
      const status = normalizeText(tray?.status) || normalizeText(sample?.status);
      if (status) {
        statuses.push(status);
      }
    });
  });

  return statuses.length > 0 && statuses.every((status) => COMPLETED_TRAY_STATUSES.has(status));
};

const buildLaboratoryTaskFlow = (status = STATUS_WAITING, axisProgress = null) => {
  const currentStatus = LABORATORY_TASK_FLOW_INDEX.has(status) ? status : STATUS_WAITING;
  const activeIndex = LABORATORY_TASK_FLOW_INDEX.get(currentStatus) ?? 0;
  return {
    currentStatus: normalizeText(axisProgress?.statusLabel) || currentStatus,
    steps: LABORATORY_TASK_FLOW_STEPS.map((step, index) => ({
      ...step,
      active: index === activeIndex,
      reached: index <= activeIndex,
    })),
  };
};

const resolveLaboratoryTaskStatus = (currentTask) => {
  if (!currentTask) {
    return STATUS_WAITING;
  }
  if (getRunningTrayRowsForCurrentTask(currentTask).length > 0) {
    return STATUS_RUNNING;
  }
  return STATUS_SCHEDULED;
};

const laboratoryOperationKey = (task) =>
  normalizeText(task?.experimentKey)
  || (normalizeText(task?.taskCode) && normalizeText(task?.experimentCode)
    ? `${normalizeText(task?.taskCode)}::${normalizeText(task?.experimentCode)}`
    : normalizeText(task?.id));
const resolveTrayExperimentOperationState = (row, currentTask) => {
  const hasAuthoritativeActiveRun = rowHasRunningStatus(row) && trayHasActiveRunForCurrentExperiment(row, currentTask);
  if (hasAuthoritativeActiveRun) {
    return {
      active: true,
      belongsToCurrentWorkflow: true,
      rank: resolveLaboratoryStatusRank(row?.trayStatus),
      withdrawn: false,
    };
  }

  const withdrawn = experimentHistoryStatusIsWithdrawal(
    row?.currentExperimentHistoryStatus || row?.latestExperimentHistoryStatus,
  );
  if (withdrawn) {
    return {
      active: false,
      belongsToCurrentWorkflow: false,
      rank: 0,
      withdrawn: true,
    };
  }

  const belongsToCurrentWorkflow = trayBelongsToCurrentLaboratoryWorkflow(row, currentTask);
  const rank = belongsToCurrentWorkflow ? resolveCurrentWorkflowTrayRank(row, currentTask) : 0;
  return {
    active: belongsToCurrentWorkflow && rank >= 1 && rank < 5,
    belongsToCurrentWorkflow,
    rank,
    withdrawn: false,
  };
};
const laboratoryRowHasStartedOperation = (row) =>
  asArray(row?.trayRows).some((tray) => resolveTrayExperimentOperationState(tray, row).active);
const laboratoryOperationTrayCodeSet = (row) =>
  new Set(
    asArray(row?.trayRows)
      .filter((tray) => resolveTrayExperimentOperationState(tray, row).active)
      .map((tray) => normalizeText(tray?.trayCode))
      .filter(Boolean),
  );
const trayHasExplicitLaboratoryWorkflowScope = (row) =>
  Boolean(
    normalizeText(row?.targetExperimentCode || row?.target_experiment_code)
    || normalizeText(row?.targetLab || row?.target_lab)
    || asArray(row?.experimentCodes).length === 1,
  );
const trayLaboratoryLocation = (row) => normalizeText(
  row?.currentLocation
  || row?.lifecycleLocation
  || row?.location,
);
const trayLocationMatchesCurrentLaboratory = (row, currentTask) => {
  const currentLab = normalizeText(currentTask?.device);
  const currentLocation = trayLaboratoryLocation(row);
  return !currentLab || !currentLocation || currentLocation === currentLab;
};
const trayCanUseImplicitLaboratoryWorkflowScope = (row, currentTask) =>
  trayHasExplicitLaboratoryWorkflowScope(row)
  || (
    row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
    && currentExperimentIsNextUnfinishedForTray(row, currentTask)
  )
  || !trayLaboratoryLocation(row)
  || trayLocationMatchesCurrentLaboratory(row, currentTask);
const trayCanParticipateInSharedOperationLock = (row, currentTask) =>
  trayBelongsToCurrentLaboratoryWorkflow(row, currentTask)
  || (!trayHasExplicitLaboratoryWorkflowScope(row) && !trayLaboratoryLocation(row));
const laboratoryRowsShareTray = (left, right) => {
  const leftTrayCodes = laboratoryOperationTrayCodeSet(left);
  if (!leftTrayCodes.size) {
    return false;
  }
  return asArray(right?.trayRows).some((tray) =>
    trayCanParticipateInSharedOperationLock(tray, right)
    && leftTrayCodes.has(normalizeText(tray?.trayCode)),
  );
};
const rowCompletedExperimentCodeSet = (row) =>
  new Set(asArray(row?.completedExperimentCodes).map((code) => normalizeText(code)).filter(Boolean));
const rowHasUnfinishedDifferentTargetExperiment = (row, currentTask) => {
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  return Boolean(
    targetExperimentCode
    && currentExperimentCode
    && targetExperimentCode !== currentExperimentCode
    && !rowCompletedExperimentCodeSet(row).has(targetExperimentCode),
  );
};
const rowHasPreDispatchLifecycleStatus = (row) => {
  const lifecycleStatus = normalizeText(row?.lifecycleStatus);
  const displayStatus = normalizeText(row?.displayStatus);
  const trayStatus = normalizeText(row?.trayStatus);
  return PRE_DISPATCH_STATUSES.has(lifecycleStatus)
    || PRE_DISPATCH_STATUSES.has(displayStatus)
    || PRE_DISPATCH_STATUSES.has(trayStatus)
    || APPEARANCE_STORAGE_STATUSES.has(lifecycleStatus)
    || APPEARANCE_STORAGE_STATUSES.has(displayStatus)
    || APPEARANCE_STORAGE_STATUSES.has(trayStatus)
    || lifecycleStatus === "éè³å¤è§æ£æµé´"
    || displayStatus === "éè³å¤è§æ£æµé´"
    || trayStatus === "éè³å¤è§æ£æµé´";
};
const currentExperimentIsNextUnfinishedForTray = (row, currentTask) => {
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const experimentCodes = asArray(row?.experimentCodes).map((code) => normalizeText(code)).filter(Boolean);
  const currentIndex = experimentCodes.indexOf(currentExperimentCode);
  if (!currentExperimentCode || currentIndex < 0) {
    return false;
  }
  const completedCodes = rowCompletedExperimentCodeSet(row);
  if (completedCodes.has(currentExperimentCode)) {
    return false;
  }
  return experimentCodes.slice(0, currentIndex).every((experimentCode) => completedCodes.has(experimentCode));
};
const taskHasDispatchValidationScope = (task) =>
  Boolean(normalizeText(task?.experimentCode) || normalizeText(task?.device));
const trayIsDispatchedToCurrentLaboratory = (row, currentTask) => {
  const trayStatus = normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus);
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const experimentCodes = asArray(row?.experimentCodes).map((code) => normalizeText(code)).filter(Boolean);
  const currentExperimentIndex = experimentCodes.indexOf(currentExperimentCode);
  const targetLab = normalizeText(row?.targetLab || row?.target_lab);
  const currentLab = normalizeText(currentTask?.device);
  const targetLabMatchesCurrent = Boolean(targetLab && currentLab && targetLab === currentLab);
  const hasCurrentExperimentRelation = Boolean(
    currentExperimentCode && experimentCodes.includes(currentExperimentCode),
  );
  const targetExperimentMatchesCurrent = Boolean(
    targetExperimentCode
    && currentExperimentCode
    && targetExperimentCode === currentExperimentCode,
  );
  const currentIsNextUnfinished = currentExperimentIsNextUnfinishedForTray(row, currentTask);
  if (
    targetExperimentCode
    && currentExperimentCode
    && targetExperimentCode !== currentExperimentCode
    && row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
    && currentIsNextUnfinished
    && rowCompletedExperimentCodeSet(row).has(targetExperimentCode)
  ) {
    return true;
  }
  if (targetExperimentCode && currentExperimentCode && targetExperimentCode !== currentExperimentCode) {
    return false;
  }
  if (trayStatus !== LAB_RESET_STATUS) {
    return true;
  }
  if (targetExperimentMatchesCurrent) {
    return targetLab ? targetLabMatchesCurrent : Boolean(currentLab);
  }
  if (!targetExperimentCode && hasCurrentExperimentRelation) {
    if (targetLabMatchesCurrent) {
      return true;
    }
    if (targetLab) {
      return row?.completedForOtherExperiment === true && currentIsNextUnfinished;
    }
    return experimentCodes.length <= 1 || currentExperimentIndex === 0 || currentIsNextUnfinished;
  }
  if (
    !targetExperimentCode
    && row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
    && currentExperimentCode
    && currentIsNextUnfinished
  ) {
    return targetLabMatchesCurrent;
  }
  return false;
};
const trayLifecycleIsBeforeLaboratoryDispatch = (row) => {
  const lifecycleStatus = normalizeText(row?.lifecycleStatus);
  if (!lifecycleStatus) {
    return false;
  }
  const rank = resolveUnifiedTrayFlowRank(lifecycleStatus);
  const sentToLabRank = resolveUnifiedTrayFlowRank(LAB_RESET_STATUS);
  return rank >= 0 && rank < sentToLabRank;
};
const taskHasWrongLaboratoryDispatch = (task) =>
  taskHasDispatchValidationScope(task)
  && asArray(task?.trayRows).some((row) => !trayIsDispatchedToCurrentLaboratory(row, task));
const trayBelongsToCurrentLaboratoryWorkflow = (row, currentTask) =>
  !taskHasDispatchValidationScope(currentTask)
  || (
    trayIsDispatchedToCurrentLaboratory(row, currentTask)
    && trayCanUseImplicitLaboratoryWorkflowScope(row, currentTask)
  );
const taskHasCurrentLaboratoryDispatch = (task) =>
  asArray(task?.trayRows).some((row) => trayBelongsToCurrentLaboratoryWorkflow(row, task));
const resolveLaboratoryOperationLabRef = (currentTask = null, lab = null) => {
  const explicitLab = resolveLabRef(lab);
  const explicitName = normalizeText(explicitLab?.name);
  const explicitCode = normalizeText(explicitLab?.code);
  const explicitId = normalizeText(explicitLab?.id);
  if (explicitName || explicitCode || explicitId) {
    return explicitLab;
  }
  return resolveLabRef({
    code: currentTask?.labCode,
    device: currentTask?.device,
  });
};
const getLaboratoryOperationLock = (scheduleRows = [], currentTask = null, lab = null) => {
  const currentKey = laboratoryOperationKey(currentTask);
  const labRef = resolveLaboratoryOperationLabRef(currentTask, lab);
  const hasLabScope = Boolean(normalizeText(labRef?.name) || normalizeText(labRef?.code) || normalizeText(labRef?.id));
  const lockedRow = asArray(scheduleRows).find((row) => {
    const rowKey = laboratoryOperationKey(row);
    const sameLaboratory = hasLabScope && scheduleMatchesLab(row, labRef);
    const sharedTray = laboratoryRowsShareTray(row, currentTask);
    const matchesOperationScope =
      (!hasLabScope && !currentTask)
      || sameLaboratory
      || sharedTray;
    return (!currentKey || rowKey !== currentKey)
      && matchesOperationScope
      && laboratoryRowHasStartedOperation(row);
  });
  if (!lockedRow) {
    return { active: false };
  }
  const sameLaboratory = hasLabScope && scheduleMatchesLab(lockedRow, labRef);
  const sharedTray = laboratoryRowsShareTray(lockedRow, currentTask);
  return {
    active: true,
    experimentKey: laboratoryOperationKey(lockedRow),
    experimentName: normalizeText(lockedRow?.experimentName),
    sameLaboratory,
    sharedTray,
    taskCode: normalizeText(lockedRow?.taskCode),
  };
};

const isPreviousExperimentCompletionForCurrentTask = (row, currentTask) => {
  const trayStatus = normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus);
  const currentExperimentStatus = normalizeText(currentTask?.status);
  const hasScopedOtherExperimentCompletion = row?.completedForOtherExperiment === true;
  return (
    COMPLETED_EXPERIMENT_STATUSES.has(trayStatus)
    && row?.completedForCurrentExperiment !== true
    && !COMPLETED_EXPERIMENT_STATUSES.has(currentExperimentStatus)
    && normalizeText(currentTask?.experimentCode)
    && asArray(row?.experimentCodes).length > 1
    && hasScopedOtherExperimentCompletion
  );
};

const trayIsCompletedForCurrentExperiment = (row, currentTask) => {
  const trayStatus = normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus);
  return COMPLETED_EXPERIMENT_STATUSES.has(trayStatus) && !isPreviousExperimentCompletionForCurrentTask(row, currentTask);
};

const trayHasActiveRunForCurrentExperiment = (row, currentTask) => {
  if (!normalizeText(currentTask?.runNo)) {
    return false;
  }
  const activeRunTrayCodes = asArray(currentTask?.activeRunTrayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean);
  if (!activeRunTrayCodes.length) {
    return true;
  }
  return activeRunTrayCodes.includes(normalizeText(row?.trayCode));
};

const rowHasRunningStatus = (row) => RUNNING_EXPERIMENT_STATUSES.has(normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus));
const rowHasReturnedStatus = (row) =>
  normalizeText(row?.trayStatus) === "åå®¶æ¶å"
  || normalizeText(row?.displayStatus) === "åå®¶æ¶å"
  || normalizeText(row?.lifecycleStatus) === "åå®¶æ¶å";

const getRunningTrayRowsForCurrentTask = (currentTask) => {
  const runningTrayRows = asArray(currentTask?.trayRows).filter((row) => rowHasRunningStatus(row));
  if (!normalizeText(currentTask?.runNo)) {
    return [];
  }
  return runningTrayRows.filter((row) => trayHasActiveRunForCurrentExperiment(row, currentTask));
};

const resolveCurrentWorkflowTrayRank = (row, currentTask) => {
  if (isPreviousExperimentCompletionForCurrentTask(row, currentTask)) {
    return 0;
  }
  if (rowHasRunningStatus(row) && normalizeText(currentTask?.runNo) && !trayHasActiveRunForCurrentExperiment(row, currentTask)) {
    return 0;
  }
  return resolveLaboratoryStatusRank(row?.trayStatus);
};

const resolveSelectedTrayFlowStatus = (row, currentTask) => {
  const lifecycleStatus = normalizeText(row?.lifecycleStatus);
  const displayStatus = normalizeText(row?.displayStatus);
  const trayStatus = normalizeText(row?.trayStatus);
  if (RUNNING_EXPERIMENT_STATUSES.has(lifecycleStatus) && !trayHasActiveRunForCurrentExperiment(row, currentTask)) {
    return displayStatus || trayStatus || lifecycleStatus;
  }
  return lifecycleStatus || displayStatus || trayStatus;
};

const trayHasCurrentExperimentFlowContext = (row, currentTask) => {
  if (!row || !currentTask) {
    return false;
  }
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  if (targetExperimentCode) {
    return !currentExperimentCode || targetExperimentCode === currentExperimentCode;
  }
  if (row?.completedForCurrentExperiment === true || trayHasActiveRunForCurrentExperiment(row, currentTask)) {
    return true;
  }
  const trayStatus = normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus);
  const trayStatusRank = resolveLaboratoryStatusRank(trayStatus);
  if (trayStatusRank > 0 && trayStatusRank < 5 && !isPreviousExperimentCompletionForCurrentTask(row, currentTask)) {
    return true;
  }
  const lifecycleStatus = normalizeLifecycleStatus(
    normalizeText(row?.lifecycleLocation) || normalizeText(row?.currentLocation),
    normalizeText(row?.lifecycleStatus),
  );
  if (
    COMPLETED_TRAY_STATUSES.has(lifecycleStatus)
    && row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
  ) {
    return false;
  }
  if (
    row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
    && row?.hasCurrentExperimentHistory !== true
  ) {
    return false;
  }
  const targetLab = normalizeText(row?.targetLab || row?.target_lab);
  const currentLab = normalizeText(currentTask?.device);
  if (trayStatus === LAB_RESET_STATUS && targetLab && currentLab && targetLab === currentLab) {
    return true;
  }
  return trayStatusRank > 0 && trayStatusRank < 5 && !isPreviousExperimentCompletionForCurrentTask(row, currentTask);
};

const buildRunningExperimentView = ({ currentTask, now }) => {
  const runningTrayRows = getRunningTrayRowsForCurrentTask(currentTask);
  if (!currentTask || !runningTrayRows.length) {
    return {
      active: false,
      countdownLabel: "",
      endDateTimeLabel: "-",
      endTime: null,
      experimentName: "",
      overdue: false,
      overdueLabel: "",
      remainingSeconds: 0,
      sampleCodes: [],
      startDateTimeLabel: "-",
      startTime: null,
      taskCode: "",
      trayCodes: [],
      trayRows: [],
    };
  }

  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const startTime = toTime(currentTask?.startAt);
  const endTime = toTime(currentTask?.endAt);
  const remainingSeconds = Number.isFinite(endTime) && Number.isFinite(nowTime) ? Math.floor((endTime - nowTime) / 1000) : 0;
  const overdueSeconds = remainingSeconds < 0 ? Math.abs(remainingSeconds) : 0;

  return {
    active: true,
    countdownLabel: remainingSeconds >= 0 ? formatDuration(remainingSeconds) : `å·²è¶æ¶ ${formatDuration(overdueSeconds)}`,
    endDateTimeLabel: formatDateTime(currentTask?.endAt),
    endTime,
    experimentName: normalizeText(currentTask?.experimentName),
    overdue: remainingSeconds < 0,
    overdueLabel: overdueSeconds ? formatDuration(overdueSeconds) : "",
    remainingSeconds,
    runNo: normalizeText(currentTask?.runNo),
    sampleCodes: uniqueValues(runningTrayRows.flatMap((row) => asArray(row?.sampleCodes))),
    startDateTimeLabel: formatDateTime(currentTask?.startAt),
    startTime,
    subExperimentCode: resolveSubExperimentCode(currentTask),
    sub_experiment_code: resolveSubExperimentCode(currentTask),
    taskCode: normalizeText(currentTask?.taskCode),
    trayCodes: runningTrayRows.map((row) => row.trayCode),
    trayRows: runningTrayRows,
  };
};

const buildExperimentTrayCodeMap = (experimentTrays) => {
  const trayMap = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const taskCode = normalizeText(entry?.task_code);
    const experimentCode = normalizeText(entry?.experiment_code);
    const trayCode = normalizeText(entry?.tray_code);
    if (!taskCode || !experimentCode || !trayCode) {
      return;
    }
    const key = `${taskCode}::${experimentCode}`;
    const current = trayMap.get(key) || [];
    if (!current.includes(trayCode)) {
      current.push(trayCode);
    }
    trayMap.set(key, current);
  });
  return trayMap;
};

const buildExperimentCodesByTrayCode = (experimentTrayCodeMap) => {
  const trayMap = new Map();
  experimentTrayCodeMap.forEach((trayCodes, experimentKey) => {
    const experimentCode = normalizeText(String(experimentKey).split("::")[1]);
    if (!experimentCode) {
      return;
    }
    asArray(trayCodes).forEach((trayCode) => {
      const normalizedTrayCode = normalizeText(trayCode);
      if (!normalizedTrayCode) {
        return;
      }
      const current = trayMap.get(normalizedTrayCode) || [];
      if (!current.includes(experimentCode)) {
        current.push(experimentCode);
      }
      trayMap.set(normalizedTrayCode, current);
    });
  });
  return trayMap;
};

const RUNNING_EXPERIMENT_RUN_STATUSES = new Set(["å®éªè¿è¡ä¸­", "å®éªä¸­"]);
const resolveRunNo = (run) => normalizeText(run?.run_no || run?.runNo || run?.id);
const resolveRunTaskCode = (run) => normalizeText(run?.task_code || run?.taskCode || run?.task_no || run?.taskNo);
const resolveRunExperimentCode = (run) =>
  normalizeText(run?.experiment_code || run?.experimentCode || run?.experiment_no || run?.experimentNo);
const resolveRunDevice = (run) => normalizeText(run?.device || run?.device_name || run?.deviceName || run?.lab_name || run?.labName);
const resolveRunScheduleId = (run) => normalizeText(run?.schedule_id || run?.scheduleId);
const resolveRunStatus = (run) => normalizeText(run?.status || run?.run_status || run?.runStatus);
const resolveRelationRunNo = (relation) => normalizeText(relation?.run_no || relation?.runNo);
const resolveRelationTaskCode = (relation) => normalizeText(relation?.task_code || relation?.taskCode || relation?.task_no || relation?.taskNo);
const resolveRelationExperimentCode = (relation) =>
  normalizeText(relation?.experiment_code || relation?.experimentCode || relation?.experiment_no || relation?.experimentNo);
const resolveRelationTrayCode = (relation) => normalizeText(relation?.tray_code || relation?.trayCode || relation?.tray_no || relation?.trayNo);
const resolveRelationStatus = (relation) => normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status);
const relationIsCompleted = (relation) =>
  EXPERIMENT_TRAY_TERMINAL_STATUSES.has(normalizeText(relation?.status))
  || EXPERIMENT_TRAY_TERMINAL_STATUSES.has(normalizeText(relation?.run_tray_status))
  || EXPERIMENT_TRAY_TERMINAL_STATUSES.has(normalizeText(relation?.runTrayStatus));

const buildCompletedScheduleTrayCodeSet = ({ experimentRuns = [], experimentRunTrays = [], schedule = null }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scheduleId = normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId);
  const subExperimentCode = resolveSubExperimentCode(schedule);
  if (!taskCode || !experimentCode || (!scheduleId && !subExperimentCode)) {
    return new Set();
  }
  const runByNo = new Map(
    asArray(experimentRuns)
      .map((run) => [resolveRunNo(run), run])
      .filter(([runNo]) => Boolean(runNo)),
  );
  return new Set(
    asArray(experimentRunTrays)
      .filter((relation) => {
        if (
          resolveRelationTaskCode(relation) !== taskCode
          || resolveRelationExperimentCode(relation) !== experimentCode
          || !relationIsCompleted(relation)
        ) {
          return false;
        }
        if (subExperimentCode) {
          return resolveSubExperimentCode(relation) === subExperimentCode;
        }
        const relationRun = runByNo.get(resolveRelationRunNo(relation));
        return scheduleId && resolveRunScheduleId(relationRun) === scheduleId;
      })
      .map(resolveRelationTrayCode)
      .filter(Boolean),
  );
};
const stepAxisCode = (step) => normalizeText(step?.axis_code || step?.axisCode);
const stepRunNo = (step) => normalizeText(step?.run_no || step?.runNo);
const stepTaskCode = (step) => normalizeText(step?.task_code || step?.taskCode || step?.task_no || step?.taskNo);
const stepExperimentCode = (step) => normalizeText(step?.experiment_code || step?.experimentCode || step?.experiment_no || step?.experimentNo);
const stepSubExperimentCode = (step) =>
  normalizeText(step?.sub_experiment_code || step?.subExperimentCode || step?.sub_experiment_no || step?.subExperimentNo);
const stepIsCompleted = (step) => COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(step?.status || step?.step_status || step?.stepStatus));

const buildAxisProgressForSchedule = ({ experiment, experimentRunSteps = [], experimentRuns = [], experimentName, schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scheduleId = normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId);
  const subExperimentCode = resolveSubExperimentCode(schedule);
  const requiredAxisCodes = normalizeAxisCodes(experiment?.axis_codes ?? experiment?.axisCodes);
  const scheduledAxisCodes = normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes);
  const scheduleRunAxisCodes = uniqueValues(
    asArray(experimentRuns)
      .filter((run) =>
        resolveRunTaskCode(run) === taskCode
        && resolveRunExperimentCode(run) === experimentCode
        && scheduleId
        && resolveRunScheduleId(run) === scheduleId,
      )
      .flatMap((run) => normalizeAxisCodes(run?.axis_codes ?? run?.axisCodes)),
  );
  const axisCodes =
    scheduledAxisCodes.length > 0
      ? scheduledAxisCodes
      : scheduleRunAxisCodes.length > 0
        ? scheduleRunAxisCodes
        : requiredAxisCodes;
  if (axisCodes.length === 0) {
    return null;
  }
  const runScopes = new Map(
    asArray(experimentRuns)
      .map((run) => [
        resolveRunNo(run),
        {
          experimentCode: resolveRunExperimentCode(run),
          scheduleId: resolveRunScheduleId(run),
          subExperimentCode: resolveSubExperimentCode(run),
          taskCode: resolveRunTaskCode(run),
        },
      ])
      .filter(([runNo]) => Boolean(runNo)),
  );
  const completedAxisCodes = axisCodes.filter((axisCode) =>
    asArray(experimentRunSteps).some((step) => {
      if (!stepIsCompleted(step) || stepAxisCode(step) !== axisCode) {
        return false;
      }
      const stepRunScope = runScopes.get(stepRunNo(step));
      if (scheduleId && stepRunScope?.scheduleId && stepRunScope.scheduleId !== scheduleId) {
        return false;
      }
      if (subExperimentCode && stepSubExperimentCode(step) && stepSubExperimentCode(step) !== subExperimentCode) {
        return false;
      }
      if (subExperimentCode && stepRunScope?.subExperimentCode && stepRunScope.subExperimentCode !== subExperimentCode) {
        return false;
      }
      const directTaskCode = stepTaskCode(step);
      const directExperimentCode = stepExperimentCode(step);
      if (directTaskCode || directExperimentCode) {
        return directTaskCode === taskCode && directExperimentCode === experimentCode;
      }
      return stepRunScope?.taskCode === taskCode && stepRunScope?.experimentCode === experimentCode;
    }),
  );
  const totalCompletedAxisCodes = requiredAxisCodes.filter((axisCode) =>
    asArray(experimentRunSteps).some((step) => {
      if (!stepIsCompleted(step) || stepAxisCode(step) !== axisCode) {
        return false;
      }
      const directTaskCode = stepTaskCode(step);
      const directExperimentCode = stepExperimentCode(step);
      if (directTaskCode || directExperimentCode) {
        return directTaskCode === taskCode && directExperimentCode === experimentCode;
      }
      const stepRunScope = runScopes.get(stepRunNo(step));
      return stepRunScope?.taskCode === taskCode && stepRunScope?.experimentCode === experimentCode;
    }),
  );
  const remainingAxisCodes = axisCodes.filter((axisCode) => !completedAxisCodes.includes(axisCode));
  const totalRemainingAxisCodes = requiredAxisCodes.filter((axisCode) => !totalCompletedAxisCodes.includes(axisCode));
  const completedCount = completedAxisCodes.length;
  const totalCount = axisCodes.length;
  const totalCompletedCount = totalCompletedAxisCodes.length;
  const totalRequiredCount = requiredAxisCodes.length;
  const labelPrefix = normalizeText(experimentName) || normalizeText(experiment?.experiment_name) || normalizeText(experiment?.experiment_type) || "å½åè¯éª";
  const statusLabel =
    completedCount > 0 && completedCount < totalCount
      ? `${labelPrefix}é¨åå®æ ${completedCount}/${totalCount}è½´`
      : completedCount === totalCount
        ? `${labelPrefix}å·²å®æ ${completedCount}/${totalCount}è½´`
        : "";
  const totalStatusLabel =
    totalCompletedCount > 0 && totalCompletedCount < totalRequiredCount
      ? `${labelPrefix}é¨åå®æ ${totalCompletedCount}/${totalRequiredCount}è½´`
      : totalCompletedCount === totalRequiredCount && totalRequiredCount > 0
        ? `${labelPrefix}å·²å®æ ${totalCompletedCount}/${totalRequiredCount}è½´`
        : "";
  return {
    completedAxisCodes,
    completedCount,
    remainingAxisCodes,
    requiredAxisCodes: axisCodes,
    scheduledAxisCodes,
    scheduleRunAxisCodes,
    statusLabel,
    totalCount,
    totalCompletedAxisCodes,
    totalCompletedCount,
    totalRemainingAxisCodes,
    totalRequiredAxisCodes: requiredAxisCodes,
    totalRequiredCount,
    totalStatusLabel,
  };
};

const buildCompletedExperimentCodesByTrayCode = ({ experimentRunTrays = [], taskCode }) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const completedCodesByTrayCode = new Map();
  asArray(experimentRunTrays).forEach((relation) => {
    if (resolveRelationTaskCode(relation) !== normalizedTaskCode || !relationIsCompleted(relation)) {
      return;
    }
    const trayCode = resolveRelationTrayCode(relation);
    const experimentCode = resolveRelationExperimentCode(relation);
    if (!trayCode || !experimentCode) {
      return;
    }
    const existing = completedCodesByTrayCode.get(trayCode) || new Set();
    existing.add(experimentCode);
    completedCodesByTrayCode.set(trayCode, existing);
  });
  return completedCodesByTrayCode;
};

const buildCompletedExperimentRecordCodesByTrayCode = ({ currentExperimentCode = "", experimentRecordMap, experimentTrayCodeMap, taskCode }) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedCurrentExperimentCode = normalizeText(currentExperimentCode);
  const completedCodesByTrayCode = new Map();
  experimentTrayCodeMap.forEach((trayCodes, experimentKey) => {
    const [entryTaskCode, experimentCode] = String(experimentKey).split("::");
    if (normalizeText(entryTaskCode) !== normalizedTaskCode || !normalizeText(experimentCode)) {
      return;
    }
    const experiment = experimentRecordMap?.get(experimentKey);
    if (!COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(experiment?.status))) {
      return;
    }
    if (normalizeText(experimentCode) === normalizedCurrentExperimentCode) {
      return;
    }
    asArray(trayCodes).forEach((trayCode) => {
      const normalizedTrayCode = normalizeText(trayCode);
      if (!normalizedTrayCode) {
        return;
      }
      const existing = completedCodesByTrayCode.get(normalizedTrayCode) || new Set();
      existing.add(experimentCode);
      completedCodesByTrayCode.set(normalizedTrayCode, existing);
    });
  });
  return completedCodesByTrayCode;
};

const findActiveExperimentRun = ({ device, experimentCode, experimentRuns, scheduleId = "", taskCode }) => {
  const normalizedDevice = normalizeText(device);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const normalizedScheduleId = normalizeText(scheduleId);
  const normalizedTaskCode = normalizeText(taskCode);
  const matchedRuns = asArray(experimentRuns)
    .filter(
      (run) =>
        resolveRunTaskCode(run) === normalizedTaskCode
        && resolveRunExperimentCode(run) === normalizedExperimentCode
        && (!normalizedScheduleId || !resolveRunScheduleId(run) || resolveRunScheduleId(run) === normalizedScheduleId)
        && (!normalizedDevice || !resolveRunDevice(run) || resolveRunDevice(run) === normalizedDevice)
        && RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRunStatus(run))
    )
    .sort((left, right) => (toTime(right?.started_at) || 0) - (toTime(left?.started_at) || 0));
  return matchedRuns[0] || null;
};

const findActiveExperimentRunTrayRelations = ({ device, experimentCode, experimentRuns, experimentRunTrays, scheduleId = "", taskCode }) => {
  const normalizedDevice = normalizeText(device);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const normalizedScheduleId = normalizeText(scheduleId);
  const normalizedTaskCode = normalizeText(taskCode);
  const runByNo = new Map(
    asArray(experimentRuns)
      .map((run) => [resolveRunNo(run), run])
      .filter(([runNo]) => Boolean(runNo)),
  );
  return asArray(experimentRunTrays)
    .filter((relation) => {
      if (
        resolveRelationTaskCode(relation) !== normalizedTaskCode
        || resolveRelationExperimentCode(relation) !== normalizedExperimentCode
        || !RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRelationStatus(relation))
      ) {
        return false;
      }
      const run = runByNo.get(resolveRelationRunNo(relation));
      if (normalizedScheduleId && run && resolveRunScheduleId(run) && resolveRunScheduleId(run) !== normalizedScheduleId) {
        return false;
      }
      return !normalizedDevice || !run || !resolveRunDevice(run) || resolveRunDevice(run) === normalizedDevice;
    })
    .sort((left, right) => (toTime(right?.started_at || right?.startedAt) || 0) - (toTime(left?.started_at || left?.startedAt) || 0));
};

const buildActiveOtherExperimentRunLocks = ({
  currentExperimentCode,
  experimentMap,
  experimentRuns,
  experimentRunTrays,
  taskCode,
  trayCode,
}) => {
  const normalizedCurrentExperimentCode = normalizeText(currentExperimentCode);
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTaskCode || !normalizedTrayCode || !normalizedCurrentExperimentCode) {
    return [];
  }

  const runByNo = new Map(
    asArray(experimentRuns)
      .map((run) => [resolveRunNo(run), run])
      .filter(([runNo]) => Boolean(runNo)),
  );
  const locksByKey = new Map();
  const pushLock = ({ experimentCode, relation = null, run = null }) => {
    const normalizedExperimentCode = normalizeText(experimentCode);
    if (!normalizedExperimentCode || normalizedExperimentCode === normalizedCurrentExperimentCode) {
      return;
    }
    const runNo = resolveRunNo(run) || resolveRelationRunNo(relation);
    const key = `${runNo || "run"}::${normalizedExperimentCode}`;
    if (locksByKey.has(key)) {
      return;
    }
    locksByKey.set(key, {
      device: resolveRunDevice(run),
      experimentCode: normalizedExperimentCode,
      experimentName: normalizeText(experimentMap?.get(`${normalizedTaskCode}::${normalizedExperimentCode}`)) || normalizedExperimentCode,
      runNo,
      trayCode: normalizedTrayCode,
    });
  };

  asArray(experimentRunTrays).forEach((relation) => {
    if (
      resolveRelationTaskCode(relation) !== normalizedTaskCode
      || resolveRelationTrayCode(relation) !== normalizedTrayCode
      || !RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRelationStatus(relation))
    ) {
      return;
    }
    const run = runByNo.get(resolveRelationRunNo(relation));
    if (run && !RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRunStatus(run))) {
      return;
    }
    pushLock({ experimentCode: resolveRelationExperimentCode(relation), relation, run });
  });

  const runKeysWithTrayRelations = new Set(
    asArray(experimentRunTrays)
      .filter((relation) =>
        resolveRelationTaskCode(relation) === normalizedTaskCode
        && resolveRelationRunNo(relation)
      )
      .map((relation) => `${resolveRelationRunNo(relation)}::${resolveRelationExperimentCode(relation)}`),
  );

  asArray(experimentRuns).forEach((run) => {
    const runNo = resolveRunNo(run);
    const experimentCode = resolveRunExperimentCode(run);
    if (
      resolveRunTaskCode(run) !== normalizedTaskCode
      || !RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRunStatus(run))
      || runKeysWithTrayRelations.has(`${runNo}::${experimentCode}`)
      || !asArray(run?.tray_codes || run?.trayCodes).map(normalizeText).includes(normalizedTrayCode)
    ) {
      return;
    }
    pushLock({ experimentCode, run });
  });

  return Array.from(locksByKey.values());
};

const collectTrayRows = ({
  device,
  experimentName,
  experimentRecordMap,
  experimentRuns,
  experimentRunTrays,
  experimentTrayCodeMap,
  experimentKey,
  relatedSamples,
  schedule,
  taskCode,
}) => {
  const trayRows = [];
  const indexByTrayCode = new Map();
  const experimentCodesByTrayCode = buildExperimentCodesByTrayCode(experimentTrayCodeMap);
  const currentExperimentCode = normalizeText(String(experimentKey).split("::")[1]);
  const currentScheduleIsAxisSubExperiment = Boolean(
    resolveSubExperimentCode(schedule)
    && normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).length > 0,
  );
  const completedCurrentScheduleTrayCodes = currentScheduleIsAxisSubExperiment
    ? buildCompletedScheduleTrayCodeSet({ experimentRuns, experimentRunTrays, schedule })
    : new Set();
  const completedExperimentCodesByTrayCode = buildCompletedExperimentCodesByTrayCode({ experimentRunTrays, taskCode });
  const completedExperimentRecordCodesByTrayCode = buildCompletedExperimentRecordCodesByTrayCode({
    currentExperimentCode,
    experimentRecordMap,
    experimentTrayCodeMap,
    taskCode,
  });

  const pushRow = (
    trayCode,
    sampleCode = "",
    quantity = "",
    owner = "",
    location = "",
    fixtureReady = false,
    targetLab = "",
    targetExperimentCode = "",
    hasCurrentExperimentHistory = false,
  ) => {
    const normalizedTrayCode = normalizeText(trayCode);
    if (!normalizedTrayCode) {
      return;
    }
    const normalizedTargetLab = normalizeText(targetLab);
    const normalizedTargetExperimentCode = normalizeText(targetExperimentCode);
    const existingIndex = indexByTrayCode.get(normalizedTrayCode);
    if (existingIndex !== undefined) {
      const current = trayRows[existingIndex];
      if (sampleCode && !current.sampleCodes.includes(sampleCode)) {
        current.sampleCodes.push(sampleCode);
      }
      if (!current.owner && owner) {
        current.owner = owner;
      }
      if (!current.quantity && quantity) {
        current.quantity = quantity;
      }
      if (!current.currentLocation && location) {
        current.currentLocation = location;
      }
      if (!current.targetLab && normalizedTargetLab) {
        current.targetLab = normalizedTargetLab;
      }
      if (!current.targetExperimentCode && normalizedTargetExperimentCode) {
        current.targetExperimentCode = normalizedTargetExperimentCode;
      }
      current.hasCurrentExperimentHistory = current.hasCurrentExperimentHistory || Boolean(hasCurrentExperimentHistory);
      current.fixtureReady = current.fixtureReady || isFixtureReady(fixtureReady);
      return;
    }
    indexByTrayCode.set(normalizedTrayCode, trayRows.length);
    const completedExperimentCodes = new Set([
      ...Array.from(completedExperimentCodesByTrayCode.get(normalizedTrayCode) || []),
      ...Array.from(completedExperimentRecordCodesByTrayCode.get(normalizedTrayCode) || []),
    ]);
    if (currentScheduleIsAxisSubExperiment && !completedCurrentScheduleTrayCodes.has(normalizedTrayCode)) {
      completedExperimentCodes.delete(currentExperimentCode);
    }
    trayRows.push({
      currentLocation: normalizeText(location),
      completedExperimentCodes: Array.from(completedExperimentCodes),
      completedForCurrentExperiment: false,
      completedForOtherExperiment: false,
      displayStatus: "",
      experimentCodes: experimentCodesByTrayCode.get(normalizedTrayCode) || [],
      lifecycleLocation: normalizeText(location),
      lifecycleStatus: "",
      lifecycleTime: 0,
      hasCurrentExperimentHistory: false,
      currentExperimentHistoryStatus: "",
      owner: normalizeText(owner),
      quantity: quantity || "",
      sampleCodes: sampleCode ? [sampleCode] : [],
      targetExperimentCode: normalizedTargetExperimentCode,
      targetLab: normalizedTargetLab,
      fixtureReady: isFixtureReady(fixtureReady),
      trayStatus: "",
      trayCode: normalizedTrayCode,
    });
  };

  const scopedTrayCodes = experimentTrayCodeMap.get(experimentKey) || [];
  scopedTrayCodes.forEach((trayCode) => pushRow(trayCode));

  asArray(relatedSamples).forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    const owner = normalizeText(sample?.owner);
    const location = normalizeText(sample?.location);
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      const quantity = tray?.quantity ?? "";
      if (scopedTrayCodes.length > 0 && !scopedTrayCodes.includes(trayCode)) {
        return;
      }
      const targetLab = normalizeText(tray?.target_lab || tray?.targetLab);
      const targetExperimentCode = normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
      const physicalTrayStatus = normalizeText(tray?.status);
      const latestDispatch = physicalTrayStatus === LAB_RESET_STATUS
        ? resolveLatestLaboratoryDispatchSnapshot({
            currentExperimentCode,
            currentLab: device,
            sample,
            trayCode,
          })
        : null;
      const restoredDispatch = physicalTrayStatus === LAB_RESET_STATUS && (!targetLab || !targetExperimentCode)
        ? latestDispatch
        : null;
      const currentExperimentHistorySnapshot = resolveLatestExperimentHistorySnapshot({
        experimentName,
        sample,
        taskCode,
        trayCode,
      });
      const latestExperimentHistorySnapshot = resolveLatestAnyExperimentHistorySnapshot({
        sample,
        taskCode,
        trayCode,
      });
      const currentExperimentHistoryIsStale =
        currentExperimentHistorySnapshot
        && latestExperimentHistorySnapshot
        && normalizeText(latestExperimentHistorySnapshot.experimentName) !== normalizeText(experimentName)
        && (latestExperimentHistorySnapshot.time || -Infinity) > (currentExperimentHistorySnapshot.time || -Infinity)
        && resolveLaboratoryStatusRank(latestExperimentHistorySnapshot.status) > 0;
      const dispatchRestoresWithdrawnCurrentExperiment =
        experimentHistoryStatusIsWithdrawal(currentExperimentHistorySnapshot?.status)
        && latestDispatch
        && latestDispatch.time > (currentExperimentHistorySnapshot?.time || -Infinity)
        && normalizeText(latestDispatch.targetLab) === normalizeText(device)
        && (
          !normalizeText(currentExperimentCode)
          || normalizeText(latestDispatch.targetExperimentCode) === normalizeText(currentExperimentCode)
        );
      const currentExperimentHistoryStatus = dispatchRestoresWithdrawnCurrentExperiment
        || currentExperimentHistoryIsStale
        || currentScheduleIsAxisSubExperiment
        ? ""
        : normalizeText(currentExperimentHistorySnapshot?.status);
      const restoredTargetLab = targetLab || normalizeText(restoredDispatch?.targetLab);
      const restoredTargetExperimentCode =
        targetExperimentCode
        || (restoredTargetLab === normalizeText(restoredDispatch?.targetLab)
          ? normalizeText(restoredDispatch?.targetExperimentCode)
          : "");
      const sampleHasCurrentExperimentHistory = Boolean(currentExperimentHistoryStatus);
      const currentExperimentHistoryRank = resolveLaboratoryStatusRank(currentExperimentHistoryStatus);
      const currentExperimentProgressIsAuthoritative = sampleHasCurrentExperimentHistory && currentExperimentHistoryRank > 0;
      const effectiveTargetLab = currentExperimentProgressIsAuthoritative ? device : restoredTargetLab;
      const effectiveTargetExperimentCode = currentExperimentProgressIsAuthoritative ? currentExperimentCode : restoredTargetExperimentCode;
      pushRow(
        trayCode,
        sampleCode,
        quantity,
        owner,
        location,
        tray?.fixtureReady ?? tray?.fixture_ready,
        effectiveTargetLab,
        effectiveTargetExperimentCode,
        sampleHasCurrentExperimentHistory,
      );
      const row = trayRows[indexByTrayCode.get(trayCode)];
      const completedExperimentCodes = completedExperimentCodesByTrayCode.get(trayCode) || new Set();
      const completedExperimentRecordCodes = completedExperimentRecordCodesByTrayCode.get(trayCode) || new Set();
      row.completedExperimentCodes = uniqueValues([
        ...asArray(row.completedExperimentCodes),
        ...Array.from(completedExperimentCodes),
        ...Array.from(completedExperimentRecordCodes),
      ]);
      row.completedForCurrentExperiment =
        row.completedForCurrentExperiment
        || (
          currentScheduleIsAxisSubExperiment
            ? completedCurrentScheduleTrayCodes.has(trayCode)
            : (
                completedExperimentCodes.has(currentExperimentCode)
                || completedExperimentRecordCodes.has(currentExperimentCode)
                || experimentIsCompletedInSampleHistory({ experimentName, sample, taskCode, trayCode })
              )
        );
      row.completedForOtherExperiment =
        row.completedForOtherExperiment
        || asArray(row?.experimentCodes).some((experimentCode) =>
          experimentCode !== currentExperimentCode
          && (completedExperimentCodes.has(experimentCode) || completedExperimentRecordCodes.has(experimentCode)),
        )
        || Boolean(resolvePreviousCompletedExperimentSnapshot(sample, taskCode, experimentName));
      row.hasCurrentExperimentHistory =
        row.hasCurrentExperimentHistory
        || sampleHasCurrentExperimentHistory;
      if (currentExperimentHistoryStatus) {
        row.currentExperimentHistoryStatus = currentExperimentHistoryStatus;
      }
      const currentRank = resolveLaboratoryStatusRank(row?.trayStatus);
      const nextStatus = physicalTrayStatus
        ? resolveCurrentExperimentTrayStatus({
            completedForCurrentExperiment: row.completedForCurrentExperiment,
            completedForOtherExperiment: row.completedForOtherExperiment,
            currentExperimentCode,
            device,
            experimentCodes: row?.experimentCodes,
            experimentName,
            historyStatus: currentExperimentHistoryStatus,
            physicalStatus: physicalTrayStatus,
            sample,
            targetExperimentCode: effectiveTargetExperimentCode,
            targetLab: effectiveTargetLab,
            taskCode,
            trayCode: row.trayCode,
          })
        : "";
      const displayStatusCandidate = resolveCurrentExperimentTrayStatus({
        completedForCurrentExperiment: row.completedForCurrentExperiment,
        completedForOtherExperiment: row.completedForOtherExperiment,
        currentExperimentCode,
        device,
        experimentCodes: row?.experimentCodes,
        experimentName,
        historyStatus: currentExperimentHistoryStatus,
        physicalStatus: physicalTrayStatus,
        sample,
        targetExperimentCode: effectiveTargetExperimentCode,
        targetLab: effectiveTargetLab,
        taskCode,
        trayCode: row.trayCode,
      });
      if (currentExperimentProgressIsAuthoritative) {
        row.targetLab = effectiveTargetLab;
        row.targetExperimentCode = effectiveTargetExperimentCode;
      }
      if (resolveLaboratoryStatusRank(nextStatus) >= currentRank) {
        row.trayStatus = nextStatus;
      }
      if (physicalTrayStatus === LAB_RESET_STATUS && effectiveTargetLab) {
        row.currentLocation = effectiveTargetLab;
        row.lifecycleLocation = effectiveTargetLab;
      }
      const currentDisplayRank = resolveLaboratoryStatusRank(row?.displayStatus);
      if (resolveLaboratoryStatusRank(displayStatusCandidate) >= currentDisplayRank) {
        row.displayStatus = displayStatusCandidate;
      }
      const lifecycleLocation = physicalTrayStatus === LAB_RESET_STATUS && effectiveTargetLab ? effectiveTargetLab : location;
      const lifecycleCandidate = resolveUnifiedTrayLifecycleCandidate({
        location: lifecycleLocation,
        sample,
        tray,
        trayCode: row.trayCode,
      });
      if (shouldReplaceUnifiedTrayLifecycle(row, lifecycleCandidate)) {
        row.lifecycleLocation = lifecycleCandidate.location || row.currentLocation;
        row.lifecycleStatus = lifecycleCandidate.status;
        row.lifecycleTime = lifecycleCandidate.time || 0;
      }
    });
  });

  return trayRows;
};

const buildLaboratoryScheduleRow = ({
  experimentMap,
  experimentRecordMap,
  experimentRuns,
  experimentRunSteps,
  experimentRunTrays,
  experimentTrayCodeMap,
  sampleMap,
  schedule,
  taskMap,
}) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const task = taskMap.get(taskCode) || null;
  const relatedSamples = sampleMap.get(taskCode) || [];
  const experimentKey = `${taskCode}::${experimentCode}`;
  const experiment = experimentRecordMap.get(experimentKey) || null;
  const owner = normalizeText(relatedSamples[0]?.owner) || "-";
  const experimentName =
    normalizeText(experiment?.experiment_name)
    || normalizeText(experimentMap.get(experimentKey))
    || normalizeText(task?.test_type)
    || normalizeText(task?.name)
    || "-";
  const startAt = String(schedule?.start_at || "");
  const endAt = String(schedule?.end_at || "");
  const scheduleId = normalizeText(schedule?.id) || `${taskCode}-${experimentCode}-${startAt}`;
  const axisProgress = buildAxisProgressForSchedule({
    experiment,
    experimentName,
    experimentRuns,
    experimentRunSteps,
    schedule,
  });
  const device = normalizeText(schedule?.device) || SALT_SPRAY_LAB;
  const labCode = normalizeText(schedule?.lab_code || schedule?.labCode);
  const subExperimentCode = resolveSubExperimentCode(schedule);
  const scheduleIsAxisSubExperiment = Boolean(
    subExperimentCode
    && normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).length > 0,
  );
  const completedScheduleTrayCodes = scheduleIsAxisSubExperiment
    ? buildCompletedScheduleTrayCodeSet({ experimentRuns, experimentRunTrays, schedule })
    : new Set();
  const trayRows = collectTrayRows({
    device,
    experimentName,
    experimentRecordMap,
    experimentRuns,
    experimentRunTrays,
    experimentTrayCodeMap,
    experimentKey,
    relatedSamples,
    schedule,
    taskCode,
  });
  const activeRun = findActiveExperimentRun({
    device,
    experimentCode,
    experimentRuns,
    scheduleId,
    taskCode,
  });
  const activeRunTrayRelations = findActiveExperimentRunTrayRelations({
    device,
    experimentCode,
    experimentRuns,
    experimentRunTrays,
    scheduleId,
    taskCode,
  });
  const activeRunTrayCodes = activeRunTrayRelations.length > 0
    ? uniqueValues(activeRunTrayRelations.map(resolveRelationTrayCode))
    : uniqueValues(asArray(activeRun?.tray_codes).map((trayCode) => normalizeText(trayCode)));
  const displayStartAt = normalizeText(activeRunTrayRelations[0]?.started_at || activeRunTrayRelations[0]?.startedAt) || normalizeText(activeRun?.started_at) || startAt;
  const estimatedEndAt = addDurationToDateTime(displayStartAt, resolvePlannedDurationMs(schedule, activeRun));
  const displayEndAt = estimatedEndAt || normalizeText(activeRun?.planned_end_at) || normalizeText(activeRun?.ended_at) || endAt;
  const activeRunStatus = activeRunTrayRelations.length > 0 || RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeText(activeRun?.status)) ? "å®éªè¿è¡ä¸­" : "";
  if (activeRunStatus) {
    trayRows.forEach((row) => {
      if (activeRunTrayCodes.length > 0 && !activeRunTrayCodes.includes(normalizeText(row?.trayCode))) {
        return;
      }
      if (COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(row?.trayStatus))) {
        return;
      }
      row.displayStatus = activeRunStatus;
      row.lifecycleStatus = activeRunStatus;
      row.trayStatus = activeRunStatus;
    });
  }
  if (axisProgress?.remainingAxisCodes?.length > 0) {
    trayRows.forEach((row) => {
      row.completedForCurrentExperiment = false;
      row.completedExperimentCodes = asArray(row.completedExperimentCodes).filter((code) => normalizeText(code) !== experimentCode);
      if (
        COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(row?.trayStatus))
        || COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(row?.displayStatus))
        || COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(row?.lifecycleStatus))
      ) {
        row.trayStatus = LAB_RESET_STATUS;
        row.displayStatus = LAB_RESET_STATUS;
        row.lifecycleStatus = LAB_RESET_STATUS;
      }
    });
  }
  const completedRunTrayCodes = new Set(
    scheduleIsAxisSubExperiment
      ? Array.from(completedScheduleTrayCodes)
      : axisProgress?.remainingAxisCodes?.length > 0
        ? []
        : asArray(experimentRunTrays)
        .filter((relation) =>
          resolveRelationTaskCode(relation) === taskCode
          && resolveRelationExperimentCode(relation) === experimentCode
          && relationIsCompleted(relation),
        )
        .map(resolveRelationTrayCode)
        .filter(Boolean),
  );
  const returnedRunTrayCodes = new Set(
    asArray(experimentRunTrays)
      .filter((relation) =>
        resolveRelationTaskCode(relation) === taskCode
        && resolveRelationExperimentCode(relation) === experimentCode
        && normalizeText(resolveRelationStatus(relation)) === "åå®¶æ¶å",
      )
      .map(resolveRelationTrayCode)
      .filter(Boolean),
  );
  trayRows.forEach((row) => {
    const activeOtherExperimentRuns = buildActiveOtherExperimentRunLocks({
      currentExperimentCode: experimentCode,
      experimentMap,
      experimentRuns,
      experimentRunTrays,
      taskCode,
      trayCode: row?.trayCode,
    });
    row.activeOtherExperimentRuns = activeOtherExperimentRuns;
    row.activeOtherExperimentRun = activeOtherExperimentRuns[0] || null;

    if (!completedRunTrayCodes.has(normalizeText(row?.trayCode))) {
      return;
    }
    row.completedForCurrentExperiment = true;
    row.completedExperimentCodes = uniqueValues([...asArray(row.completedExperimentCodes), experimentCode]);
    row.displayStatus = EXPERIMENT_COMPLETED_STATUS;
    row.lifecycleStatus = EXPERIMENT_COMPLETED_STATUS;
    row.trayStatus = EXPERIMENT_COMPLETED_STATUS;
  });
  const visibleTrayRows = trayRows.filter((row) =>
    row?.completedForCurrentExperiment !== true
    && !completedRunTrayCodes.has(normalizeText(row?.trayCode))
    && !rowHasReturnedStatus(row),
  );

  return {
    activeRunTrayCodes,
    allTrayCodes: trayRows
      .filter((row) => !returnedRunTrayCodes.has(normalizeText(row?.trayCode)) && !rowHasReturnedStatus(row))
      .map((row) => row.trayCode),
    allTrayRows: trayRows,
    axisBatchNo: normalizeText(schedule?.axis_batch_no ?? schedule?.axisBatchNo),
    axisCodes: normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes),
    axisProgress,
    axis_batch_no: normalizeText(schedule?.axis_batch_no ?? schedule?.axisBatchNo),
    axis_codes: normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes),
    device,
    endAt: displayEndAt,
    endTimeLabel: formatTime(displayEndAt),
    experimentCode,
    experimentKey,
    experimentName,
    id: scheduleId,
    labCode,
    owner,
    sampleCount: visibleTrayRows.reduce((count, row) => count + Math.max(1, row.sampleCodes.length || 0), 0) || visibleTrayRows.length,
    runNo:
      normalizeText(activeRun?.run_no)
      || normalizeText(activeRun?.id)
      || normalizeText(activeRunTrayRelations[0]?.run_no)
      || normalizeText(activeRunTrayRelations[0]?.runNo),
    startAt: displayStartAt,
    startDateTimeLabel: formatDateTime(displayStartAt),
    startTimeLabel: formatTime(displayStartAt),
    status: normalizeText(experiment?.status),
    subExperimentCode,
    sub_experiment_code: subExperimentCode,
    taskCode,
    taskName: normalizeText(task?.name) || taskCode || "-",
    dateTimeRange: `${formatDateTime(displayStartAt)} - ${formatDateTime(displayEndAt)}`,
    timeRange: `${formatTime(displayStartAt)} - ${formatTime(displayEndAt)}`,
    title: `${taskCode} / ${experimentName} / ${formatDateTime(displayStartAt)} - ${formatDateTime(displayEndAt)}`,
    trayCodes: visibleTrayRows.map((row) => row.trayCode),
    trayRows: visibleTrayRows,
    endDateTimeLabel: formatDateTime(displayEndAt),
  };
};

const isFutureAxisContinuationRow = (row, nowTime) => {
  const axisProgress = row?.axisProgress;
  const startsInFuture = (toTime(row?.startAt) || 0) > nowTime;
  return startsInFuture
    && asArray(axisProgress?.scheduledAxisCodes).length > 0
    && asArray(axisProgress?.totalRequiredAxisCodes).length > asArray(axisProgress?.scheduledAxisCodes).length
    && Number(axisProgress?.totalCompletedCount || 0) > 0
    && Number(axisProgress?.completedCount || 0) === 0;
};

const findTrayFlowContextTask = (scheduleRows, currentTask, selectedTrayCode) => {
  if (currentTask) {
    return currentTask;
  }
  const normalizedTrayCode = normalizeText(selectedTrayCode);
  if (!normalizedTrayCode) {
    return asArray(scheduleRows)[0] || null;
  }
  return asArray(scheduleRows).find((row) =>
    asArray(row?.trayCodes).includes(normalizedTrayCode)
    || asArray(row?.allTrayCodes).includes(normalizedTrayCode),
  ) || asArray(scheduleRows)[0] || null;
};

function buildLaboratoryWorkbenchView({
  tasks = [],
  schedules = [],
  experiments = [],
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays = [],
  experimentTrays = [],
  samples = [],
  now = new Date(),
  selectedTaskCode = "",
  selectedTrayCode = "",
  labName = SALT_SPRAY_LAB,
  labCode = "",
}) {
  const taskMap = buildTaskMap(tasks);
  const experimentMap = buildExperimentMap(experiments);
  const experimentRecordMap = buildExperimentRecordMap(experiments);
  const sampleMap = buildSampleMap(samples);
  const experimentTrayCodeMap = buildExperimentTrayCodeMap(experimentTrays);
  const rowBuilderInput = { experimentMap, experimentRecordMap, experimentRuns, experimentRunSteps, experimentRunTrays, experimentTrayCodeMap, sampleMap, taskMap };

  const activeSchedules = asArray(schedules).filter(
    (schedule) => !scheduleExperimentIsCompleted({
      experiments,
      experimentRuns,
      experimentRunSteps,
      experimentRunTrays,
      experimentTrays,
      samples,
      schedule,
    }),
  );
  const allScheduleRows = activeSchedules
    .map((schedule) => buildLaboratoryScheduleRow({ ...rowBuilderInput, schedule }))
    .sort((left, right) => (toTime(left.startAt) || 0) - (toTime(right.startAt) || 0));

  const labRef = { code: labCode, name: labName };
  const scheduleRows = allScheduleRows.filter((row) => scheduleMatchesLab(row, labRef));
  const nowTime = now instanceof Date ? now.getTime() : toTime(now) || Date.now();
  const operationTask =
    scheduleRows.find((row) => normalizeText(row?.runNo))
    || scheduleRows.find((row) => !isFutureAxisContinuationRow(row, nowTime) && laboratoryRowHasStartedOperation(row));
  const defaultCandidate = scheduleRows[0] || null;
  const defaultTask = operationTask || defaultCandidate;

  const selectedKey = normalizeText(selectedTaskCode);
  const selectedTaskCandidate =
    scheduleRows.find((row) => normalizeText(row.id) === selectedKey)
    || scheduleRows.find((row) => normalizeText(row.experimentKey) === selectedKey)
    || scheduleRows.find((row) => row.taskCode === selectedKey)
    || null;
  const selectedTask = selectedTaskCandidate || null;
  const currentTask = selectedTask || defaultTask;
  const flowContextTask = findTrayFlowContextTask(scheduleRows, currentTask, selectedTrayCode);
  const currentExperimentTrayRows = asArray(currentTask?.trayRows);
  const flowContextTrayRows = asArray(flowContextTask?.trayRows);
  const selectedTrayRow =
    flowContextTrayRows.find((row) => row.trayCode === normalizeText(selectedTrayCode))
    || flowContextTrayRows[0]
    || null;
  const selectedTrayHasCurrentExperimentContext = trayHasCurrentExperimentFlowContext(selectedTrayRow, flowContextTask);
  const selectedTrayDifferentTargetIsActive = rowHasUnfinishedDifferentTargetExperiment(selectedTrayRow, flowContextTask);
  const selectedTrayOnlyHasOtherExperimentCompletion =
    !selectedTrayHasCurrentExperimentContext
    && selectedTrayRow?.completedForOtherExperiment === true
    && selectedTrayRow?.completedForCurrentExperiment !== true
    && !selectedTrayDifferentTargetIsActive
    && !rowHasPreDispatchLifecycleStatus(selectedTrayRow);
  const selectedTrayFlowStatus =
    selectedTrayOnlyHasOtherExperimentCompletion
      ? EXPERIMENT_COMPLETED_STATUS
      : resolveSelectedTrayFlowStatus(selectedTrayRow, flowContextTask);
  const currentTaskStatus = resolveLaboratoryTaskStatus(currentTask);
  const currentTaskFlow = buildLaboratoryTaskFlow(currentTaskStatus, currentTask?.axisProgress);
  const baseSelectedTrayFlow = selectedTrayRow
    ? buildTrayFlowView({
        currentExperimentCode: selectedTrayHasCurrentExperimentContext
          ? normalizeText(flowContextTask?.experimentCode)
          : selectedTrayDifferentTargetIsActive
            ? normalizeText(selectedTrayRow?.targetExperimentCode || selectedTrayRow?.target_experiment_code)
            : "",
        experimentRuns,
        experimentRunSteps,
        experimentRunTrays,
        experimentTrays,
        experiments,
        dispatchTargetLab: selectedTrayHasCurrentExperimentContext || selectedTrayDifferentTargetIsActive
          ? normalizeText(selectedTrayRow?.targetLab || selectedTrayRow?.target_lab)
          : "",
        location: normalizeText(selectedTrayRow?.lifecycleLocation) || normalizeText(selectedTrayRow?.currentLocation),
        samples,
        schedules,
        status: selectedTrayFlowStatus,
        suppressGuessedDestinationLab: selectedTrayOnlyHasOtherExperimentCompletion,
        taskCode: normalizeText(flowContextTask?.taskCode),
        trayCode: normalizeText(selectedTrayRow?.trayCode),
      })
    : buildTrayFlowView();
  const selectedTrayAxisStatus =
    normalizeText(currentTask?.axisProgress?.statusLabel)
    || (!currentTask ? normalizeText(flowContextTask?.axisProgress?.totalStatusLabel) : "");
  const selectedTrayFlow =
    selectedTrayRow && selectedTrayAxisStatus
      ? {
          ...baseSelectedTrayFlow,
          canonicalStatus: selectedTrayAxisStatus,
          currentStatus: `å½åæçï¼${selectedTrayRow.trayCode} | å½åç¶æï¼${selectedTrayAxisStatus}`,
          status: selectedTrayAxisStatus,
        }
      : baseSelectedTrayFlow;
  const operationTaskMatchesCurrentTask =
    operationTask
    && currentTask
    && normalizeText(operationTask.taskCode) === normalizeText(currentTask.taskCode)
    && normalizeText(operationTask.experimentCode) === normalizeText(currentTask.experimentCode);
  const runningExperiment = buildRunningExperimentView({
    currentTask: operationTaskMatchesCurrentTask || !selectedTask ? (operationTask || currentTask) : currentTask,
    now: now instanceof Date ? now : new Date(toTime(now) || Date.now()),
  });

  return {
    allScheduleRows,
    currentTask,
    currentTaskFlow,
    currentTaskStatus,
    currentExperimentTrayRows,
    defaultTask,
    labName,
    runningExperiment,
    scheduleRows,
    selectedTrayFlow,
    selectedTrayRow,
  };
}

function buildLaboratorySummary(scheduleRows = [], now = new Date()) {
  const todayKey = formatDateKey(now);
  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const todayRows = asArray(scheduleRows).filter((row) => formatDateKey(row?.startAt) === todayKey);
  return {
    todayPendingCount: todayRows.length,
    todayUndoneCount: todayRows.filter((row) => {
      const end = toTime(row?.endAt);
      return Number.isFinite(end) && end < nowTime;
    }).length,
  };
}

function createLaboratoryWorkflow() {
  return {
    comparisonDone: false,
    experimentConfirmed: false,
    fixtureReadyDone: false,
    hasCompared: false,
    hasInstalled: false,
    installationDone: false,
  };
}

function buildLaboratoryWorkflowFromTask(task) {
  const trayRows = asArray(task?.trayRows);
  const workflowRowsWithState = trayRows
    .map((row) => ({ row, state: resolveTrayExperimentOperationState(row, task) }))
    .filter(({ state }) => state.belongsToCurrentWorkflow);
  const workflowTrayRows = workflowRowsWithState.map(({ row }) => row);
  const activeOtherExperimentRows = workflowTrayRows.filter((row) => asArray(row?.activeOtherExperimentRuns).length > 0);
  const comparableTrayRows = workflowTrayRows.filter((row) =>
    asArray(row?.activeOtherExperimentRuns).length === 0
    && resolveTrayExperimentOperationState(row, task).rank < 1
  );
  const trayRanks = workflowRowsWithState.map(({ state }) => state.rank);
  const installedWaitingReadyRows = workflowTrayRows.filter((row) => resolveLaboratoryStatusRank(row?.trayStatus) === 2);
  const hasCompared = trayRanks.some((rank) => rank >= 1);
  const comparisonDone = trayRanks.length > 0 && trayRanks.every((rank) => rank >= 1);
  const hasInstalled = trayRanks.some((rank) => rank >= 2 && rank < 5);
  const installationDone = trayRanks.length > 0 && trayRanks.every((rank) => rank >= 2);
  const experimentConfirmed = trayRanks.length > 0 && trayRanks.every((rank) => rank >= 3);
  const fixtureReadyDone =
    installedWaitingReadyRows.length > 0 && installedWaitingReadyRows.every((row) => row?.fixtureReady === true);
  const workflow = {
    comparisonDone,
    experimentConfirmed,
    hasCompared,
    hasInstalled,
    installationDone,
  };
  Object.defineProperties(workflow, {
    fixtureReadyDone: {
      value: fixtureReadyDone,
    },
    hasComparedWaitingInstall: {
      value: trayRanks.some((rank) => rank === 1),
    },
    hasInstalledWaitingReady: {
      value: trayRanks.some((rank) => rank === 2),
    },
    hasActiveOtherExperimentRun: {
      value: activeOtherExperimentRows.length > 0,
    },
    activeOtherExperimentRows: {
      value: activeOtherExperimentRows,
    },
    activeOtherExperimentRun: {
      value: activeOtherExperimentRows[0]?.activeOtherExperimentRun || null,
    },
    hasComparableTrayWithoutActiveOtherExperiment: {
      value: comparableTrayRows.length > 0,
    },
    hasInProgressPreparation: {
      value: trayRanks.some((rank) => rank >= 2 && rank < 5),
    },
    hasWrongLaboratoryDispatch: {
      value: taskHasWrongLaboratoryDispatch(task),
    },
    hasCurrentLaboratoryDispatch: {
      value: taskHasCurrentLaboratoryDispatch(task),
    },
  });
  return workflow;
}

function getLaboratoryActionState(workflow = createLaboratoryWorkflow()) {
  if (workflow.experimentConfirmed) {
    return {
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    };
  }
  const hasComparedWaitingInstall = Object.prototype.hasOwnProperty.call(workflow, "hasComparedWaitingInstall")
    ? workflow.hasComparedWaitingInstall
    : !workflow.hasInstalled && (workflow.hasCompared || workflow.comparisonDone) && !workflow.installationDone;
  const hasInstalledWaitingReady = Object.prototype.hasOwnProperty.call(workflow, "hasInstalledWaitingReady")
    ? workflow.hasInstalledWaitingReady
    : (workflow.hasInstalled || workflow.installationDone) && !workflow.experimentConfirmed;
  const hasInProgressPreparation = Object.prototype.hasOwnProperty.call(workflow, "hasInProgressPreparation")
    ? workflow.hasInProgressPreparation
    : Boolean(workflow.hasInstalled);
  const fixtureReadyDone = Object.prototype.hasOwnProperty.call(workflow, "fixtureReadyDone")
    ? workflow.fixtureReadyDone
    : false;
  const hasCurrentLaboratoryDispatch = Object.prototype.hasOwnProperty.call(workflow, "hasCurrentLaboratoryDispatch")
    ? workflow.hasCurrentLaboratoryDispatch
    : true;
  const hasActiveOtherExperimentRun = Object.prototype.hasOwnProperty.call(workflow, "hasActiveOtherExperimentRun")
    ? workflow.hasActiveOtherExperimentRun
    : false;
  const hasComparableTrayWithoutActiveOtherExperiment = Object.prototype.hasOwnProperty.call(
    workflow,
    "hasComparableTrayWithoutActiveOtherExperiment",
  )
    ? workflow.hasComparableTrayWithoutActiveOtherExperiment
    : false;
  if (hasActiveOtherExperimentRun && !hasComparableTrayWithoutActiveOtherExperiment) {
    return {
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    };
  }
  return {
    canCompare: hasCurrentLaboratoryDispatch && !workflow.comparisonDone && !hasInProgressPreparation,
    canInstallSample: Boolean(hasComparedWaitingInstall),
    canMarkReady: Boolean(hasInstalledWaitingReady && fixtureReadyDone),
  };
}

const buildSaltSprayLaboratoryView = buildLaboratoryWorkbenchView;

function completeLaboratoryComparison(workflow = createLaboratoryWorkflow()) {
  return {
    ...workflow,
    comparisonDone: true,
    experimentConfirmed: false,
    hasCompared: true,
    hasInstalled: false,
    installationDone: false,
  };
}

function completeLaboratoryInstallation(workflow = createLaboratoryWorkflow()) {
  if (!(workflow.hasCompared || workflow.comparisonDone)) {
    return { ...workflow };
  }
  return {
    ...workflow,
    hasCompared: true,
    hasInstalled: true,
    installationDone: true,
    fixtureReadyDone: false,
    experimentConfirmed: false,
  };
}

function confirmLaboratoryExperiment(workflow = createLaboratoryWorkflow()) {
  if (!(workflow.hasInstalled || workflow.installationDone) || !workflow.fixtureReadyDone) {
    return { ...workflow };
  }
  return {
    comparisonDone: true,
    experimentConfirmed: true,
    fixtureReadyDone: true,
    hasCompared: true,
    hasInstalled: true,
    installationDone: true,
  };
}

function buildLaboratoryProgressMessage(workflow, currentTask, labName = SALT_SPRAY_LAB) {
  if (!currentTask) {
    return `å½å${normalizeText(labName) || SALT_SPRAY_LAB}ææ æç¨`;
  }
  if (getRunningTrayRowsForCurrentTask(currentTask).length > 0) {
    return `å½åä»»å¡ ${currentTask.taskCode} å·²è¿å¥å®éªè¿è¡ä¸­`;
  }
  if (
    workflow.hasActiveOtherExperimentRun
    && !workflow.hasComparableTrayWithoutActiveOtherExperiment
  ) {
    const lock = workflow.activeOtherExperimentRun || {};
    const target = normalizeText(lock.device) || normalizeText(lock.experimentName) || "å¶ä»å®éª";
    return `æçæ­£å¨${target}è¿è¡å®éªï¼å®æåæå¯ç»§ç»­å½åè¯éªé´æµç¨`;
  }
  if (workflow.experimentConfirmed) {
    return "å½åä»»å¡å·²ç¡®è®¤å¨é¨æçå®éªåå¤å°±ç»ª";
  }
  if (workflow.hasInstalledWaitingReady && !workflow.fixtureReadyDone) {
    return "å½åä»»å¡å·²å®æå¤¹å·å®è£ï¼ç­å¾ä¸ä½æºç¡®è®¤å¤¹å·å®è£å®æ";
  }
  if (workflow.hasInstalledWaitingReady && workflow.fixtureReadyDone) {
    return "å¤¹å·å®è£å®æï¼å¯ç¡®è®¤å®éªåå¤å°±ç»ª";
  }
  if (workflow.hasInstalled && !workflow.installationDone) {
    return "å½åä»»å¡å·²ææçå®ææ ·åå®è£ï¼å¾ç¡®è®¤å·²å®è£æçåå¤å°±ç»ª";
  }
  if (workflow.installationDone) {
    return "å½åä»»å¡å·²å®æå¨é¨æçæ ·åå®è£ï¼å¾å®éªç¡®è®¤";
  }
  if (workflow.hasCompared && !workflow.comparisonDone) {
    return "å½åä»»å¡å·²å®æé¨åæçæ¯å¯¹ï¼å¯ç»§ç»­æ¯å¯¹æå¼å§æ ·åå®è£";
  }
  if (workflow.comparisonDone) {
    return "å½åä»»å¡å·²å®æå¨é¨æçä»»å¡æ¯å¯¹ï¼å¾æ ·åå®è£";
  }
  return `å½åä»»å¡ ${currentTask.taskCode} å¾å¼å§ä»»å¡æ¯å¯¹`;
}

function applyLaboratoryTaskStep({
  samples = [],
  currentTask = null,
  nextStatus = "",
  historyAction = "",
  now = formatLocalDateTime(),
  targetTrayCodes = [],
}) {
  if (!currentTask) {
    return asArray(samples);
  }

  const normalizedStatus = normalizeText(nextStatus);
  const scopedTrayCodes = asArray(targetTrayCodes).length > 0 ? targetTrayCodes : currentTask.trayCodes;
  const trayCodeSet = new Set(asArray(scopedTrayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const taskCode = normalizeText(currentTask.taskCode);
  const detail = `${taskCode} / ${normalizeText(currentTask.experimentName) || "-"} / ${normalizedStatus}`;
  const scopedSamples = asArray(samples).filter((sample) => normalizeText(sample?.task_code) === taskCode);
  const targetStatusRank = resolveLaboratoryStatusRank(normalizedStatus);
  const protectsCompletedCurrentExperiment = targetStatusRank > 0 && targetStatusRank < 5;
  const protectedCompletedTrayCodes = new Set(
    asArray(samples)
      .filter((sample) => normalizeText(sample?.task_code) === taskCode)
      .flatMap((sample) =>
        asArray(sample?.trays)
          .map((tray) => normalizeText(tray?.tray_code))
          .filter((trayCode) =>
            trayCodeSet.has(trayCode)
            && protectsCompletedCurrentExperiment
            && experimentIsCompletedInSampleHistory({
              experimentName: currentTask.experimentName,
              sample,
              taskCode,
              trayCode,
            }),
          ),
      )
      .filter(Boolean),
  );
  const mutableTrayCodes = Array.from(trayCodeSet).filter((trayCode) => !protectedCompletedTrayCodes.has(trayCode));
  if (mutableTrayCodes.length === 0) {
    return asArray(samples);
  }

  const syncedSamples = synchronizeSamplesForTrayCodes({
    historyAction,
    historyDetail: detail,
    location: normalizeText(currentTask.device) || SALT_SPRAY_LAB,
    now,
    samples: scopedSamples,
    status: normalizedStatus,
    targetExperimentCode: normalizeText(currentTask.experimentCode),
    targetLab: normalizeText(currentTask.device) || SALT_SPRAY_LAB,
    trayCodes: mutableTrayCodes,
  }).samples;
  const syncedByCode = new Map(syncedSamples.map((sample) => [normalizeText(sample?.code), sample]));
  return asArray(samples).map((sample) => syncedByCode.get(normalizeText(sample?.code)) || sample);
}

function resetLaboratoryExperimentTrays({
  samples = [],
  currentTask = null,
  now = formatLocalDateTime(),
}) {
  if (!currentTask || !asArray(currentTask?.trayCodes).length) {
    return asArray(samples);
  }

  return applyLaboratoryTaskStep({
    currentTask,
    historyAction: "å®éªä»»å¡éç½®",
    nextStatus: LAB_RESET_STATUS,
    now,
    samples,
    targetTrayCodes: currentTask.trayCodes,
  });
}

function revertLaboratoryTaskToPreDispatch({
  samples = [],
  currentTask = null,
  now = formatLocalDateTime(),
}) {
  if (!currentTask || !asArray(currentTask?.trayCodes).length) {
    return asArray(samples);
  }

  const taskCode = normalizeText(currentTask?.taskCode);
  const trayCodeSet = new Set(asArray(currentTask?.trayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const experimentName = normalizeText(currentTask?.experimentName) || "-";

  return asArray(samples).map((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return sample;
    }

    let restoreSnapshot = null;
    let reverted = false;
    const nextTrays = asArray(sample?.trays).map((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (!trayCodeSet.has(trayCode) || !shouldRevertLaboratoryTrayStatus(normalizeText(tray?.status) || normalizeText(sample?.status))) {
        return { ...tray };
      }
      restoreSnapshot = restoreSnapshot || resolvePreDispatchSnapshot(sample);
      if (!restoreSnapshot) {
        return { ...tray };
      }
      reverted = true;
      return {
        ...tray,
        status: restoreSnapshot.status,
        updated_at: now,
      };
    });

    if (!reverted || !restoreSnapshot) {
      return sample;
    }

    const nextSample = {
      ...sample,
      flow_status: restoreSnapshot.status,
      location: restoreSnapshot.location,
      status: restoreSnapshot.status,
      trays: nextTrays,
      updated_at: now,
    };
    nextSample.history = buildLaboratoryHistoryEntry(
      nextSample,
      "ä»»å¡åæ¢æ¤å",
      restoreSnapshot.status,
      `${taskCode} / ${experimentName} / æ¤åè³${restoreSnapshot.status}`,
      now,
    );
    return nextSample;
  });
}

function revertLaboratoryTaskToPreviousStableState({
  allowRunningRevert = false,
  samples = [],
  currentTask = null,
  now = formatLocalDateTime(),
}) {
  if (!currentTask || !asArray(currentTask?.trayCodes).length) {
    return asArray(samples);
  }

  const taskCode = normalizeText(currentTask?.taskCode);
  const trayCodeSet = new Set(asArray(currentTask?.trayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const experimentName = normalizeText(currentTask?.experimentName) || "-";

  return asArray(samples).map((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return sample;
    }

    let restoreSnapshot = null;
    let reverted = false;
    const nextTrays = asArray(sample?.trays).map((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (
        !trayCodeSet.has(trayCode)
        || !shouldRevertLaboratoryTrayStatus(normalizeText(tray?.status) || normalizeText(sample?.status), {
          includeRunning: allowRunningRevert,
        })
      ) {
        return { ...tray };
      }
      restoreSnapshot = restoreSnapshot || resolvePreviousStableSnapshot(sample, taskCode, experimentName);
      reverted = true;
      return {
        ...tray,
        status: restoreSnapshot.status,
        updated_at: now,
      };
    });

    if (!reverted || !restoreSnapshot) {
      return sample;
    }

    const nextSample = {
      ...sample,
      flow_status: restoreSnapshot.status,
      location: restoreSnapshot.location,
      status: restoreSnapshot.status,
      trays: nextTrays,
      updated_at: now,
    };
    const detailTarget = restoreSnapshot.experimentName
      ? `${restoreSnapshot.experimentName}å·²å®æ`
      : restoreSnapshot.status;
    nextSample.history = buildLaboratoryHistoryEntry(
      nextSample,
      "ä»»å¡åæ¢æ¤å",
      restoreSnapshot.status,
      `${taskCode} / ${experimentName} / æ¤åè³${detailTarget}`,
      now,
    );
    return nextSample;
  });
}

function buildLaboratoryChecklist(task) {
  if (!task) {
    return [];
  }
  return [
    { label: "ä»»å¡ç¼å·", value: task.taskCode || "-" },
    { label: "å®éªé¡¹ç®", value: task.experimentName || "-" },
    { label: "æ§è¡äººå", value: task.owner || "-" },
    { label: "å¼å§æ¶é´", value: task.startTimeLabel || "-" },
    { label: "ç»ææ¶é´", value: task.endTimeLabel || "-" },
    { label: "æ ·åæ°é", value: task.sampleCount ? `${task.sampleCount} ä»¶` : "-" },
    { label: "å®éªå®¤", value: task.device || SALT_SPRAY_LAB },
  ];
}

function validateLaboratoryTrayScan({ currentTask = null, scheduleRows = [], allScheduleRows = [], scanCode = "" }) {
  const normalizedScanCode = normalizeText(scanCode);
  if (!normalizedScanCode) {
    return {
      guidance: "è¯·æ«ææçç¼å·",
      message: "è¯·æ«ææçç¼å·",
      ok: false,
      tone: "error",
    };
  }
  if (!currentTask) {
    return {
      guidance: "å½åæ²¡æå¯æ¯å¯¹çä»»å¡",
      message: "å½åæ²¡æå¯æ¯å¯¹çä»»å¡",
      ok: false,
      tone: "error",
    };
  }

  const currentTaskTrayCodes = uniqueValues([...asArray(currentTask.trayCodes), ...asArray(currentTask.allTrayCodes)]);
  if (currentTaskTrayCodes.includes(normalizedScanCode)) {
    const matchedTray =
      asArray(currentTask.trayRows).find((row) => normalizeText(row?.trayCode) === normalizedScanCode)
      || asArray(currentTask.allTrayRows).find((row) => normalizeText(row?.trayCode) === normalizedScanCode)
      || null;
    const trayStatus = normalizeText(matchedTray?.trayStatus) || normalizeText(matchedTray?.displayStatus);
    const activeOtherExperimentRun = asArray(matchedTray?.activeOtherExperimentRuns)[0] || matchedTray?.activeOtherExperimentRun || null;
    if (activeOtherExperimentRun) {
      return buildActiveOtherExperimentComparisonResult(normalizedScanCode, activeOtherExperimentRun);
    }
    if (trayLifecycleIsBeforeLaboratoryDispatch(matchedTray)) {
      return buildNotDispatchedComparisonResult(normalizedScanCode, {
        ...matchedTray,
        currentLocation: normalizeText(matchedTray?.lifecycleLocation) || normalizeText(matchedTray?.currentLocation),
        trayStatus: normalizeText(matchedTray?.lifecycleStatus) || trayStatus,
      });
    }
    if (resolveLaboratoryStatusRank(trayStatus) >= 1) {
      if (trayIsCompletedForCurrentExperiment(matchedTray, currentTask)) {
        return buildBlockedComparisonResult(normalizedScanCode, trayStatus);
      }
      const canEnterNextExperiment =
        (trayStatus === "å®éªå·²å®æ" || trayStatus === "å®éªå®æ" || trayStatus === "å®éªå·²ç»å®æ")
        && isPreviousExperimentCompletionForCurrentTask(matchedTray, currentTask);
      if (canEnterNextExperiment) {
        return {
          guidance: `${normalizedScanCode} å±äºå½åä»»å¡ ${currentTask.taskCode}`,
          matchedRow: currentTask,
          message: "æ¯å¯¹æ­£ç¡®",
          ok: true,
          tone: "success",
          trayCode: normalizedScanCode,
        };
      }
      return buildBlockedComparisonResult(normalizedScanCode, trayStatus);
    }
    if (trayStatus !== LAB_RESET_STATUS) {
      return buildNotDispatchedComparisonResult(normalizedScanCode, matchedTray);
    }
    if (!trayIsDispatchedToCurrentLaboratory(matchedTray, currentTask)) {
      return buildWrongLaboratoryDispatchResult(normalizedScanCode, matchedTray, currentTask);
    }
    return {
      guidance: `${normalizedScanCode} å±äºå½åä»»å¡ ${currentTask.taskCode}`,
      matchedRow: currentTask,
      message: "æ¯å¯¹æ­£ç¡®",
      ok: true,
      tone: "success",
      trayCode: normalizedScanCode,
    };
  }

  const searchRows = asArray(allScheduleRows).length ? asArray(allScheduleRows) : asArray(scheduleRows);
  const matchedRows = searchRows.filter((row) =>
    uniqueValues([...asArray(row.trayCodes), ...asArray(row.allTrayCodes)]).includes(normalizedScanCode),
  );
  if (matchedRows.length > 0) {
    const destinationLabels = uniqueValues(matchedRows.map((row) => row.device));
    return {
      guidance: `å½åä»»å¡å¹¶éä¼åæéä»»å¡ãè¯¥æçå¯åå¾ï¼${destinationLabels.join("ã")}`,
      matchedRow: matchedRows[0],
      matchedRows,
      message: "æ¯å¯¹ä¸æ­£ç¡®",
      ok: false,
      tone: "error",
      trayCode: normalizedScanCode,
    };
  }

  return {
    guidance: "æªå¹éå°è¯¥æç",
    message: "æªå¹éå°ä»»å¡",
    ok: false,
    tone: "error",
    trayCode: normalizedScanCode,
  };
}

export {
  applyLaboratoryTaskStep,
  SALT_SPRAY_LAB,
  LAB_COMPARE_STATUS,
  LAB_INSTALL_STATUS,
  LAB_READY_STATUS,
  buildLaboratoryChecklist,
  buildLaboratoryWorkbenchView,
  buildLaboratoryProgressMessage,
  buildLaboratorySummary,
  buildLaboratoryWorkflowFromTask,
  buildSaltSprayLaboratoryView,
  completeLaboratoryComparison,
  completeLaboratoryInstallation,
  confirmLaboratoryExperiment,
  createLaboratoryWorkflow,
  getLaboratoryActionState,
  getLaboratoryOperationLock,
  resetLaboratoryExperimentTrays,
  revertLaboratoryTaskToPreviousStableState,
  revertLaboratoryTaskToPreDispatch,
  validateLaboratoryTrayScan,
};

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1vZGVsLmpzP3Q9Y2hlY2siXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgU0FNUExFX0ZMT1dfU1RFUFMsXG4gIGJ1aWxkVHJheUZsb3dWaWV3LFxuICBub3JtYWxpemVMaWZlY3ljbGVTdGF0dXMsXG4gIHN5bmNocm9uaXplU2FtcGxlc0ZvclRyYXlDb2Rlcyxcbn0gZnJvbSBcIi9zcmMvbW9kdWxlcy9zYW1wbGVzL3NhbXBsZXNGbG93TW9kZWwuanNcIjtcbmltcG9ydCB7IHJlc29sdmVMYWJEZXN0aW5hdGlvbk5hbWUgfSBmcm9tIFwiL3NyYy9tb2R1bGVzL3NhbXBsZXMvc2FtcGxlRmxvdy5leHBlcmltZW50SGVscGVycy5qc1wiO1xuaW1wb3J0IHsgZm9ybWF0TG9jYWxEYXRlVGltZSB9IGZyb20gXCIvc3JjL2xpYi9kYXRlVGltZS5qc1wiO1xyXG5pbXBvcnQgeyByZXNvbHZlTGFiUmVmLCBzY2hlZHVsZU1hdGNoZXNMYWIgfSBmcm9tIFwiL3NyYy9saWIvbGFiSWRlbnRpdHkuanNcIjtcclxuaW1wb3J0IHtcclxuICBTVEFUVVNfQ09NUExFVEVELFxyXG4gIFNUQVRVU19SRVRFTlRJT04sXHJcbiAgU1RBVFVTX1JVTk5JTkcsXHJcbiAgU1RBVFVTX1NDSEVEVUxFRCxcclxuICBTVEFUVVNfV0FJVElORyxcclxufSBmcm9tIFwiL3NyYy9tb2R1bGVzL3Rhc2tzL21vZGVsLmpzXCI7XHJcbmltcG9ydCB7IGV4cGVyaW1lbnRTY29wZUlzVGVybWluYWwgfSBmcm9tIFwiL3NyYy9tb2R1bGVzL2V4cGVyaW1lbnQtcHJvZ3Jlc3MvbW9kZWwuanNcIjtcclxuXHJcbmNvbnN0IFNBTFRfU1BSQVlfTEFCID0gXCLnm5Dpm77or5XpqozlrqRcIjtcclxuY29uc3QgTEFCX0NPTVBBUkVfU1RBVFVTID0gXCLlt7LliLDovr7lrp7pqozlrqRcIjtcclxuY29uc3QgTEFCX0lOU1RBTExfU1RBVFVTID0gXCLlt6Xoo4XlpLnlhbflronoo4VcIjtcclxuY29uc3QgTEFCX1JFQURZX1NUQVRVUyA9IFwi5a6e6aqM5YeG5aSH5bCx57uqXCI7XHJcbmNvbnN0IExBQl9SRVNFVF9TVEFUVVMgPSBcIumAgeiHs+WunumqjOWupFwiO1xyXG5jb25zdCBFWFBFUklNRU5UX0NPTVBMRVRFRF9TVEFUVVMgPSBcIuWunumqjOW3suWujOaIkFwiO1xyXG5jb25zdCBQUkVfRElTUEFUQ0hfU1RBR0lOR19MT0NBVElPTiA9IFwi5oGS5rip5oGS5rm/6Ze077yI5pqC5a2Y6Ze077yJXCI7XHJcbmNvbnN0IFBSRV9ESVNQQVRDSF9TVEFHSU5HX1NUQVRVUyA9IFwi5bey5Yiw6L6+5pqC5a2Y6Ze0XCI7XHJcbmNvbnN0IEFQUEVBUkFOQ0VfSU5TUEVDVElPTl9MT0NBVElPTiA9IFwi5aSW6KeC5qOA5rWL6Ze0XCI7XHJcbmNvbnN0IEFQUEVBUkFOQ0VfSU5TUEVDVElPTl9TVE9DS0VEX1NUQVRVUyA9IFwi5a6e6aqM5ZCO5aSW6KeC5qOA5rWL6Ze05a2Y5pS+XCI7XHJcbmNvbnN0IFBSRV9FWFBFUklNRU5UX0FQUEVBUkFOQ0VfU1RPQ0tFRF9TVEFUVVMgPSBcIuWunumqjOWJjeWkluinguajgOa1i+mXtOWtmOaUvlwiO1xyXG5jb25zdCBVTklGSUVEX1RSQVlfRkxPV19TVEFUVVNfUkFOSyA9IG5ldyBNYXAoU0FNUExFX0ZMT1dfU1RFUFMubWFwKChzdGVwLCBpbmRleCkgPT4gW3N0ZXAubGFiZWwsIGluZGV4XSkpO1xyXG5jb25zdCBQUkVfRElTUEFUQ0hfU1RBVFVTRVMgPSBuZXcgU2V0KFtcIuWIsOi0p1wiLCBcIuW3suaOpeaUtlwiLCBcIumAgeiHs+aaguWtmOmXtFwiLCBcIuW3suWIsOi+vuaaguWtmOmXtFwiXSk7XHJcbmNvbnN0IEFQUEVBUkFOQ0VfU1RPUkFHRV9TVEFUVVNFUyA9IG5ldyBTZXQoW1xuICBBUFBFQVJBTkNFX0lOU1BFQ1RJT05fU1RPQ0tFRF9TVEFUVVMsXG4gIFBSRV9FWFBFUklNRU5UX0FQUEVBUkFOQ0VfU1RPQ0tFRF9TVEFUVVMsXG5dKTtcbmNvbnN0IFJVTk5JTkdfRVhQRVJJTUVOVF9TVEFUVVNFUyA9IG5ldyBTZXQoW1wi5a6e6aqM6L+b6KGM5LitXCIsIFwi5a6e6aqM5LitXCJdKTtcbmNvbnN0IExBQl9ESVNQQVRDSF9ISVNUT1JZX0FDVElPTlMgPSBuZXcgU2V0KFtcIuaaguWtmOmXtOaJq+eggeWHuuW6k1wiLCBcIuWkluinguajgOa1i+mXtOaJq+eggeWHuuW6k1wiLCBcIuaOpemps+WMuuaJq+eggeWHuuW6k1wiLCBcIumAgeiHs+WunumqjOWupFwiXSk7XG5jb25zdCBMQUJPUkFUT1JZX1RBU0tfRkxPV19TVEVQUyA9IFtcbiAgeyBrZXk6IFwid2FpdGluZ1wiLCBsYWJlbDogU1RBVFVTX1dBSVRJTkcgfSxcclxuICB7IGtleTogXCJzY2hlZHVsZWRcIiwgbGFiZWw6IFNUQVRVU19TQ0hFRFVMRUQgfSxcclxuICB7IGtleTogXCJydW5uaW5nXCIsIGxhYmVsOiBTVEFUVVNfUlVOTklORyB9LFxyXG4gIHsga2V5OiBcImNvbXBsZXRlZFwiLCBsYWJlbDogU1RBVFVTX0NPTVBMRVRFRCB9LFxyXG4gIHsga2V5OiBcInJldHVybmVkXCIsIGxhYmVsOiBTVEFUVVNfUkVURU5USU9OIH0sXHJcbl07XHJcbmNvbnN0IExBQk9SQVRPUllfVEFTS19GTE9XX0lOREVYID0gbmV3IE1hcChMQUJPUkFUT1JZX1RBU0tfRkxPV19TVEVQUy5tYXAoKHN0ZXAsIGluZGV4KSA9PiBbc3RlcC5sYWJlbCwgaW5kZXhdKSk7XHJcbmNvbnN0IENPTVBMRVRFRF9FWFBFUklNRU5UX1NUQVRVU0VTID0gbmV3IFNldChbXCLlrp7pqozlt7LlrozmiJBcIiwgXCLlrp7pqozlt7Lnu4/lrozmiJBcIiwgXCLlrp7pqozlrozmiJBcIl0pO1xyXG5jb25zdCBDT01QTEVURURfVFJBWV9TVEFUVVNFUyA9IG5ldyBTZXQoW1wi5a6e6aqM5bey5a6M5oiQXCIsIFwi5a6e6aqM5bey57uP5a6M5oiQXCIsIFwi5a6e6aqM5a6M5oiQXCIsIFwi5a6e6aqM5ZCO5pqC5a2Y6Ze05a2Y5pS+XCIsIFwi5Y6C5a625pS25ZueXCJdKTtcbmNvbnN0IEVYUEVSSU1FTlRfVFJBWV9URVJNSU5BTF9TVEFUVVNFUyA9IG5ldyBTZXQoW1xuICAuLi5DT01QTEVURURfRVhQRVJJTUVOVF9TVEFUVVNFUyxcbiAgXCLlrp7pqozlkI7mmoLlrZjpl7TlrZjmlL5cIixcbiAgXCLljoLlrrbmlLblm55cIixcbl0pO1xuXHJcbmNvbnN0IG5vcm1hbGl6ZVRleHQgPSAodmFsdWUpID0+IFN0cmluZyh2YWx1ZSA/PyBcIlwiKS50cmltKCk7XG5jb25zdCBhc0FycmF5ID0gKHZhbHVlKSA9PiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IFtdKTtcbmNvbnN0IG5vcm1hbGl6ZUF4aXNDb2RlcyA9ICh2YWx1ZSkgPT4ge1xuICBjb25zdCByYXdWYWx1ZXMgPSBBcnJheS5pc0FycmF5KHZhbHVlKVxuICAgID8gdmFsdWVcbiAgICA6IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIlxuICAgICAgPyB2YWx1ZS5yZXBsYWNlKC/vvIwvZywgXCIsXCIpLnNwbGl0KFwiLFwiKVxuICAgICAgOiBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgcmV0dXJuIHJhd1ZhbHVlcy5tYXAobm9ybWFsaXplVGV4dCkuZmlsdGVyKChheGlzQ29kZSkgPT4ge1xuICAgIGlmICghYXhpc0NvZGUgfHwgc2Vlbi5oYXMoYXhpc0NvZGUpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHNlZW4uYWRkKGF4aXNDb2RlKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSk7XG59O1xuY29uc3QgcmVzb2x2ZVN1YkV4cGVyaW1lbnRDb2RlID0gKHZhbHVlID0ge30pID0+XG4gIG5vcm1hbGl6ZVRleHQodmFsdWU/LnN1YkV4cGVyaW1lbnRDb2RlID8/IHZhbHVlPy5zdWJfZXhwZXJpbWVudF9jb2RlID8/IHZhbHVlPy5zdWJfZXhwZXJpbWVudF9ubyA/PyB2YWx1ZT8uc3ViRXhwZXJpbWVudE5vKTtcbmNvbnN0IGVzY2FwZVJlZ0V4cCA9ICh2YWx1ZSkgPT4gbm9ybWFsaXplVGV4dCh2YWx1ZSkucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpO1xuY29uc3QgZXhwZXJpbWVudEhpc3RvcnlTdGF0dXNJc1dpdGhkcmF3YWwgPSAoc3RhdHVzKSA9PiBub3JtYWxpemVUZXh0KHN0YXR1cykuc3RhcnRzV2l0aChcIuaSpOWbnuiHs1wiKTtcclxuY29uc3QgcmVzb2x2ZVRyYXlDb2RlID0gKGVudHJ5KSA9PiBub3JtYWxpemVUZXh0KGVudHJ5Py50cmF5X2NvZGUgfHwgZW50cnk/LnRyYXlDb2RlIHx8IGVudHJ5Py50cmF5X25vIHx8IGVudHJ5Py50cmF5Tm8gfHwgZW50cnk/LmNvZGUpO1xyXG5jb25zdCBlbnRyeU1hdGNoZXNUcmF5Q29kZSA9IChlbnRyeSwgdHJheUNvZGUpID0+IHtcclxuICBjb25zdCBub3JtYWxpemVkVHJheUNvZGUgPSBub3JtYWxpemVUZXh0KHRyYXlDb2RlKTtcclxuICBpZiAoIW5vcm1hbGl6ZWRUcmF5Q29kZSkge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuICBjb25zdCBzdHJ1Y3R1cmVkVHJheUNvZGUgPSByZXNvbHZlVHJheUNvZGUoZW50cnkpO1xyXG4gIGlmIChzdHJ1Y3R1cmVkVHJheUNvZGUpIHtcclxuICAgIHJldHVybiBzdHJ1Y3R1cmVkVHJheUNvZGUgPT09IG5vcm1hbGl6ZWRUcmF5Q29kZTtcclxuICB9XHJcbiAgY29uc3QgZGV0YWlsID0gbm9ybWFsaXplVGV4dChlbnRyeT8uZGV0YWlsKTtcclxuICBpZiAoIWRldGFpbCkge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuICBjb25zdCBlc2NhcGVkID0gZXNjYXBlUmVnRXhwKG5vcm1hbGl6ZWRUcmF5Q29kZSk7XHJcbiAgcmV0dXJuIG5ldyBSZWdFeHAoYChefFteQS1aYS16MC05Xy1dKSR7ZXNjYXBlZH0oJHxbXkEtWmEtejAtOV8tXSlgKS50ZXN0KGRldGFpbCk7XHJcbn07XHJcbmNvbnN0IGhpc3RvcnlFbnRyeUFwcGxpZXNUb1RyYXkgPSAoZW50cnksIHNhbXBsZVRyYXlDb2RlcywgdHJheUNvZGUpID0+IHtcclxuICBjb25zdCBtYXRjaGVkVHJheUNvZGVzID0gYXNBcnJheShzYW1wbGVUcmF5Q29kZXMpLmZpbHRlcigoY29kZSkgPT4gZW50cnlNYXRjaGVzVHJheUNvZGUoZW50cnksIGNvZGUpKTtcclxuICBpZiAobWF0Y2hlZFRyYXlDb2Rlcy5sZW5ndGggPiAwKSB7XHJcbiAgICByZXR1cm4gbWF0Y2hlZFRyYXlDb2Rlcy5pbmNsdWRlcyhub3JtYWxpemVUZXh0KHRyYXlDb2RlKSk7XHJcbiAgfVxyXG4gIHJldHVybiBhc0FycmF5KHNhbXBsZVRyYXlDb2RlcykubGVuZ3RoIDw9IDE7XHJcbn07XHJcblxyXG5jb25zdCB0b1RpbWUgPSAodmFsdWUpID0+IHtcclxuICBjb25zdCB0aW1lID0gRGF0ZS5wYXJzZShTdHJpbmcodmFsdWUgfHwgXCJcIikpO1xyXG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUodGltZSkgPyB0aW1lIDogbnVsbDtcclxufTtcclxuXHJcbmNvbnN0IHRvUG9zaXRpdmVOdW1iZXIgPSAodmFsdWUpID0+IHtcclxuICBjb25zdCBudW1iZXIgPSBOdW1iZXIodmFsdWUpO1xyXG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobnVtYmVyKSAmJiBudW1iZXIgPiAwID8gbnVtYmVyIDogbnVsbDtcclxufTtcclxuXHJcbmNvbnN0IHJlc29sdmVQbGFubmVkRHVyYXRpb25NcyA9IChzY2hlZHVsZSwgYWN0aXZlUnVuKSA9PiB7XHJcbiAgY29uc3QgcGxhbm5lZEhvdXJzID1cclxuICAgIHRvUG9zaXRpdmVOdW1iZXIoYWN0aXZlUnVuPy5wbGFubmVkX2hvdXJzID8/IGFjdGl2ZVJ1bj8ucGxhbm5lZEhvdXJzKVxyXG4gICAgPz8gdG9Qb3NpdGl2ZU51bWJlcihzY2hlZHVsZT8ucGxhbm5lZF9ob3VycyA/PyBzY2hlZHVsZT8ucGxhbm5lZEhvdXJzKTtcclxuICBpZiAocGxhbm5lZEhvdXJzKSB7XHJcbiAgICByZXR1cm4gcGxhbm5lZEhvdXJzICogNjAgKiA2MCAqIDEwMDA7XHJcbiAgfVxyXG4gIGNvbnN0IHNjaGVkdWxlU3RhcnRUaW1lID0gdG9UaW1lKHNjaGVkdWxlPy5zdGFydF9hdCB8fCBzY2hlZHVsZT8uc3RhcnRBdCk7XHJcbiAgY29uc3Qgc2NoZWR1bGVFbmRUaW1lID0gdG9UaW1lKHNjaGVkdWxlPy5lbmRfYXQgfHwgc2NoZWR1bGU/LmVuZEF0KTtcclxuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKHNjaGVkdWxlU3RhcnRUaW1lKSAmJiBOdW1iZXIuaXNGaW5pdGUoc2NoZWR1bGVFbmRUaW1lKSAmJiBzY2hlZHVsZUVuZFRpbWUgPiBzY2hlZHVsZVN0YXJ0VGltZVxyXG4gICAgPyBzY2hlZHVsZUVuZFRpbWUgLSBzY2hlZHVsZVN0YXJ0VGltZVxyXG4gICAgOiBudWxsO1xyXG59O1xyXG5cclxuY29uc3QgYWRkRHVyYXRpb25Ub0RhdGVUaW1lID0gKGRhdGVUaW1lLCBkdXJhdGlvbk1zKSA9PiB7XHJcbiAgY29uc3Qgc3RhcnRUaW1lID0gdG9UaW1lKGRhdGVUaW1lKTtcclxuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKHN0YXJ0VGltZSkgJiYgTnVtYmVyLmlzRmluaXRlKGR1cmF0aW9uTXMpICYmIGR1cmF0aW9uTXMgPiAwXHJcbiAgICA/IG5ldyBEYXRlKHN0YXJ0VGltZSArIGR1cmF0aW9uTXMpLnRvSVNPU3RyaW5nKClcclxuICAgIDogXCJcIjtcclxufTtcclxuXHJcbmNvbnN0IGZvcm1hdFRpbWUgPSAodmFsdWUpID0+IHtcclxuICBjb25zdCB0aW1lID0gdG9UaW1lKHZhbHVlKTtcclxuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh0aW1lKSkge1xyXG4gICAgcmV0dXJuIFwiLVwiO1xyXG4gIH1cclxuICBjb25zdCBkYXRlID0gbmV3IERhdGUodGltZSk7XHJcbiAgY29uc3QgaG91cnMgPSBTdHJpbmcoZGF0ZS5nZXRIb3VycygpKS5wYWRTdGFydCgyLCBcIjBcIik7XHJcbiAgY29uc3QgbWludXRlcyA9IFN0cmluZyhkYXRlLmdldE1pbnV0ZXMoKSkucGFkU3RhcnQoMiwgXCIwXCIpO1xyXG4gIHJldHVybiBgJHtob3Vyc306JHttaW51dGVzfWA7XHJcbn07XHJcblxyXG5jb25zdCBmb3JtYXREYXRlS2V5ID0gKHZhbHVlKSA9PiB7XHJcbiAgY29uc3QgdGltZSA9IHZhbHVlIGluc3RhbmNlb2YgRGF0ZSA/IHZhbHVlLmdldFRpbWUoKSA6IHRvVGltZSh2YWx1ZSk7XHJcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodGltZSkpIHtcclxuICAgIHJldHVybiBcIlwiO1xyXG4gIH1cclxuICBjb25zdCBkYXRlID0gbmV3IERhdGUodGltZSk7XHJcbiAgY29uc3QgeWVhciA9IFN0cmluZyhkYXRlLmdldEZ1bGxZZWFyKCkpO1xyXG4gIGNvbnN0IG1vbnRoID0gU3RyaW5nKGRhdGUuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsIFwiMFwiKTtcclxuICBjb25zdCBkYXkgPSBTdHJpbmcoZGF0ZS5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKTtcclxuICByZXR1cm4gYCR7eWVhcn0tJHttb250aH0tJHtkYXl9YDtcclxufTtcclxuXHJcbmNvbnN0IGZvcm1hdERhdGVUaW1lID0gKHZhbHVlKSA9PiB7XHJcbiAgY29uc3QgdGltZSA9IHRvVGltZSh2YWx1ZSk7XHJcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodGltZSkpIHtcclxuICAgIHJldHVybiBcIi1cIjtcclxuICB9XHJcbiAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKHRpbWUpO1xyXG4gIHJldHVybiBgJHtmb3JtYXREYXRlS2V5KGRhdGUpfSAke2Zvcm1hdFRpbWUoZGF0ZSl9YDtcclxufTtcclxuXHJcbmNvbnN0IGZvcm1hdER1cmF0aW9uID0gKHRvdGFsU2Vjb25kcykgPT4ge1xyXG4gIGNvbnN0IHNhZmVTZWNvbmRzID0gTWF0aC5tYXgoMCwgTnVtYmVyKHRvdGFsU2Vjb25kcykgfHwgMCk7XHJcbiAgY29uc3QgaG91cnMgPSBTdHJpbmcoTWF0aC5mbG9vcihzYWZlU2Vjb25kcyAvIDM2MDApKS5wYWRTdGFydCgyLCBcIjBcIik7XHJcbiAgY29uc3QgbWludXRlcyA9IFN0cmluZyhNYXRoLmZsb29yKChzYWZlU2Vjb25kcyAlIDM2MDApIC8gNjApKS5wYWRTdGFydCgyLCBcIjBcIik7XHJcbiAgY29uc3Qgc2Vjb25kcyA9IFN0cmluZyhNYXRoLmZsb29yKHNhZmVTZWNvbmRzICUgNjApKS5wYWRTdGFydCgyLCBcIjBcIik7XHJcbiAgcmV0dXJuIGAke2hvdXJzfToke21pbnV0ZXN9OiR7c2Vjb25kc31gO1xyXG59O1xyXG5cclxuY29uc3QgdW5pcXVlVmFsdWVzID0gKHZhbHVlcyA9IFtdKSA9PiB7XHJcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcclxuICByZXR1cm4gYXNBcnJheSh2YWx1ZXMpLmZpbHRlcigodmFsdWUpID0+IHtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVUZXh0KHZhbHVlKTtcclxuICAgIGlmICghbm9ybWFsaXplZCB8fCBzZWVuLmhhcyhub3JtYWxpemVkKSkge1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBzZWVuLmFkZChub3JtYWxpemVkKTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0pO1xyXG59O1xyXG5cclxuY29uc3QgYnVpbGRMYWJvcmF0b3J5SGlzdG9yeUVudHJ5ID0gKHNhbXBsZSwgYWN0aW9uLCBzdGF0dXMsIGRldGFpbCwgbm93KSA9PiB7XHJcbiAgY29uc3QgaGlzdG9yeSA9IEFycmF5LmlzQXJyYXkoc2FtcGxlPy5oaXN0b3J5KSA/IHNhbXBsZS5oaXN0b3J5LnNsaWNlKCkgOiBbXTtcclxuICBoaXN0b3J5LnVuc2hpZnQoe1xyXG4gICAgYWN0aW9uLFxyXG4gICAgZGV0YWlsLFxyXG4gICAgaWQ6IGBsYWJvcmF0b3J5LWV2ZW50LSR7RGF0ZS5ub3coKX0tJHtNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxMDAwKX1gLFxyXG4gICAgbG9jYXRpb246IG5vcm1hbGl6ZVRleHQoc2FtcGxlPy5sb2NhdGlvbikgfHwgU0FMVF9TUFJBWV9MQUIsXHJcbiAgICBvd25lcjogbm9ybWFsaXplVGV4dChzYW1wbGU/Lm93bmVyKSxcclxuICAgIHN0YXR1cyxcclxuICAgIHRpbWU6IG5vdyxcclxuICB9KTtcclxuICByZXR1cm4gaGlzdG9yeTtcclxufTtcclxuXHJcbmNvbnN0IHJlc29sdmVQcmVEaXNwYXRjaExvY2F0aW9uID0gKHN0YXR1cywgbG9jYXRpb24gPSBcIlwiKSA9PiB7XHJcbiAgY29uc3Qgbm9ybWFsaXplZExvY2F0aW9uID0gbm9ybWFsaXplVGV4dChsb2NhdGlvbik7XHJcbiAgaWYgKG5vcm1hbGl6ZWRMb2NhdGlvbikge1xyXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRMb2NhdGlvbjtcclxuICB9XHJcbiAgY29uc3Qgbm9ybWFsaXplZFN0YXR1cyA9IG5vcm1hbGl6ZVRleHQoc3RhdHVzKTtcclxuICBpZiAobm9ybWFsaXplZFN0YXR1cyA9PT0gXCLliLDotKdcIiB8fCBub3JtYWxpemVkU3RhdHVzID09PSBcIuW3suaOpeaUtlwiKSB7XHJcbiAgICByZXR1cm4gXCLmjqXpqbPljLpcIjtcclxuICB9XHJcbiAgcmV0dXJuIFBSRV9ESVNQQVRDSF9TVEFHSU5HX0xPQ0FUSU9OO1xyXG59O1xyXG5cclxuY29uc3QgcmVzb2x2ZVByZURpc3BhdGNoU3RhdHVzRnJvbUxvY2F0aW9uID0gKGxvY2F0aW9uKSA9PiB7XHJcbiAgY29uc3Qgbm9ybWFsaXplZExvY2F0aW9uID0gbm9ybWFsaXplVGV4dChsb2NhdGlvbik7XHJcbiAgaWYgKG5vcm1hbGl6ZWRMb2NhdGlvbiA9PT0gUFJFX0RJU1BBVENIX1NUQUdJTkdfTE9DQVRJT04pIHtcclxuICAgIHJldHVybiBQUkVfRElTUEFUQ0hfU1RBR0lOR19TVEFUVVM7XHJcbiAgfVxyXG4gIGlmIChub3JtYWxpemVkTG9jYXRpb24gPT09IFwi5o6l6amz5Yy6XCIgfHwgbm9ybWFsaXplZExvY2F0aW9uID09PSBcIuWupOWkluaOpemps+WMulwiKSB7XHJcbiAgICByZXR1cm4gXCLliLDotKdcIjtcclxuICB9XHJcbiAgcmV0dXJuIFwiXCI7XHJcbn07XHJcblxyXG5jb25zdCByZXNvbHZlUHJlRGlzcGF0Y2hTbmFwc2hvdCA9IChzYW1wbGUpID0+IHtcclxuICBjb25zdCBoaXN0b3J5ID0gYXNBcnJheShzYW1wbGU/Lmhpc3RvcnkpO1xyXG4gIGZvciAoY29uc3QgZW50cnkgb2YgaGlzdG9yeSkge1xyXG4gICAgY29uc3Qgc3RhdHVzID0gbm9ybWFsaXplVGV4dChlbnRyeT8uc3RhdHVzKTtcclxuICAgIGNvbnN0IGxvY2F0aW9uID0gbm9ybWFsaXplVGV4dChlbnRyeT8ubG9jYXRpb24pO1xyXG4gICAgaWYgKFBSRV9ESVNQQVRDSF9TVEFUVVNFUy5oYXMoc3RhdHVzKSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIGxvY2F0aW9uOiByZXNvbHZlUHJlRGlzcGF0Y2hMb2NhdGlvbihzdGF0dXMsIGxvY2F0aW9uKSxcclxuICAgICAgICBzdGF0dXMsXHJcbiAgICAgICAgdGltZTogdG9UaW1lKGVudHJ5Py50aW1lKSB8fCAtSW5maW5pdHksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgICBjb25zdCBzdGF0dXNGcm9tTG9jYXRpb24gPSByZXNvbHZlUHJlRGlzcGF0Y2hTdGF0dXNGcm9tTG9jYXRpb24obG9jYXRpb24pO1xyXG4gICAgaWYgKHN0YXR1c0Zyb21Mb2NhdGlvbikge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIGxvY2F0aW9uLFxyXG4gICAgICAgIHN0YXR1czogc3RhdHVzRnJvbUxvY2F0aW9uLFxyXG4gICAgICAgIHRpbWU6IHRvVGltZShlbnRyeT8udGltZSkgfHwgLUluZmluaXR5LFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufTtcclxuXHJcbmNvbnN0IHJlc29sdmVBcHBlYXJhbmNlU3RvcmFnZVNuYXBzaG90ID0gKHNhbXBsZSkgPT4ge1xyXG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBhc0FycmF5KHNhbXBsZT8uaGlzdG9yeSlcclxuICAgIC5tYXAoKGVudHJ5KSA9PiB7XHJcbiAgICAgIGNvbnN0IHN0YXR1cyA9IG5vcm1hbGl6ZVRleHQoZW50cnk/LnN0YXR1cyk7XHJcbiAgICAgIGNvbnN0IGxvY2F0aW9uID0gbm9ybWFsaXplVGV4dChlbnRyeT8ubG9jYXRpb24pO1xyXG4gICAgICBjb25zdCBhY3Rpb24gPSBub3JtYWxpemVUZXh0KGVudHJ5Py5hY3Rpb24pO1xyXG4gICAgICBjb25zdCBtYXJrc0FwcGVhcmFuY2VTdG9yYWdlID1cclxuICAgICAgICBBUFBFQVJBTkNFX1NUT1JBR0VfU1RBVFVTRVMuaGFzKHN0YXR1cylcclxuICAgICAgICB8fCAoXHJcbiAgICAgICAgICBhY3Rpb24gPT09IFwi5aSW6KeC5qOA5rWL6Ze05omr56CB5YWl5bqTXCJcclxuICAgICAgICAgICYmICghc3RhdHVzIHx8IEFQUEVBUkFOQ0VfU1RPUkFHRV9TVEFUVVNFUy5oYXMoc3RhdHVzKSB8fCBsb2NhdGlvbiA9PT0gQVBQRUFSQU5DRV9JTlNQRUNUSU9OX0xPQ0FUSU9OKVxyXG4gICAgICAgICk7XHJcbiAgICAgIGlmICghbWFya3NBcHBlYXJhbmNlU3RvcmFnZSkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgZXhwZXJpbWVudE5hbWU6IFwiXCIsXHJcbiAgICAgICAgbG9jYXRpb246IEFQUEVBUkFOQ0VfSU5TUEVDVElPTl9MT0NBVElPTixcclxuICAgICAgICBzdGF0dXM6IEFQUEVBUkFOQ0VfU1RPUkFHRV9TVEFUVVNFUy5oYXMoc3RhdHVzKSA/IHN0YXR1cyA6IEFQUEVBUkFOQ0VfSU5TUEVDVElPTl9TVE9DS0VEX1NUQVRVUyxcclxuICAgICAgICB0aW1lOiB0b1RpbWUoZW50cnk/LnRpbWUpIHx8IC1JbmZpbml0eSxcclxuICAgICAgfTtcclxuICAgIH0pXHJcbiAgICAuZmlsdGVyKEJvb2xlYW4pXHJcbiAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQudGltZSAtIHJpZ2h0LnRpbWUpO1xyXG4gIHJldHVybiBjYW5kaWRhdGVzW2NhbmRpZGF0ZXMubGVuZ3RoIC0gMV0gfHwgbnVsbDtcclxufTtcclxuXHJcbmNvbnN0IHNob3VsZFJldmVydExhYm9yYXRvcnlUcmF5U3RhdHVzID0gKHN0YXR1cywgeyBpbmNsdWRlUnVubmluZyA9IGZhbHNlIH0gPSB7fSkgPT4ge1xyXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVUZXh0KHN0YXR1cyk7XHJcbiAgY29uc3QgcmFuayA9IHJlc29sdmVMYWJvcmF0b3J5U3RhdHVzUmFuayhub3JtYWxpemVkKTtcclxuICByZXR1cm4gbm9ybWFsaXplZCA9PT0gTEFCX1JFU0VUX1NUQVRVUyB8fCAocmFuayA+PSAxICYmIHJhbmsgPCAoaW5jbHVkZVJ1bm5pbmcgPyA1IDogNCkpO1xyXG59O1xyXG5cclxuY29uc3QgcmVzb2x2ZUxhYm9yYXRvcnlTdGF0dXNSYW5rID0gKHZhbHVlKSA9PiB7XHJcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVRleHQodmFsdWUpO1xyXG4gIGlmIChub3JtYWxpemVkID09PSBMQUJfQ09NUEFSRV9TVEFUVVMpIHtcclxuICAgIHJldHVybiAxO1xyXG4gIH1cclxuICBpZiAobm9ybWFsaXplZCA9PT0gTEFCX0lOU1RBTExfU1RBVFVTKSB7XHJcbiAgICByZXR1cm4gMjtcclxuICB9XHJcbiAgaWYgKG5vcm1hbGl6ZWQgPT09IExBQl9SRUFEWV9TVEFUVVMpIHtcclxuICAgIHJldHVybiAzO1xyXG4gIH1cclxuICBpZiAobm9ybWFsaXplZCA9PT0gXCLlrp7pqozov5vooYzkuK1cIiB8fCBub3JtYWxpemVkID09PSBcIuWunumqjOS4rVwiKSB7XHJcbiAgICByZXR1cm4gNDtcclxuICB9XHJcbiAgaWYgKG5vcm1hbGl6ZWQgPT09IFwi5a6e6aqM5bey5a6M5oiQXCIgfHwgbm9ybWFsaXplZCA9PT0gXCLlrp7pqozlkI7mmoLlrZjpl7TlrZjmlL5cIiB8fCBub3JtYWxpemVkID09PSBcIuWOguWutuaUtuWbnlwiKSB7XHJcbiAgICByZXR1cm4gNTtcclxuICB9XHJcbiAgcmV0dXJuIDA7XHJcbn07XHJcblxyXG5jb25zdCByZXNvbHZlVW5pZmllZFRyYXlGbG93UmFuayA9IChzdGF0dXMpID0+IHtcclxuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVGV4dChzdGF0dXMpO1xyXG4gIGlmICghbm9ybWFsaXplZCkge1xyXG4gICAgcmV0dXJuIC0xO1xyXG4gIH1cclxuICBjb25zdCBjb21wbGV0ZWRJbmRleCA9IFVOSUZJRURfVFJBWV9GTE9XX1NUQVRVU19SQU5LLmdldChFWFBFUklNRU5UX0NPTVBMRVRFRF9TVEFUVVMpID8/IDk7XHJcbiAgaWYgKG5vcm1hbGl6ZWQgPT09IFwi6YCB6Iez5aSW6KeC5qOA5rWL6Ze0XCIpIHtcclxuICAgIHJldHVybiBjb21wbGV0ZWRJbmRleCArIDAuMTtcclxuICB9XHJcbiAgaWYgKEFQUEVBUkFOQ0VfU1RPUkFHRV9TVEFUVVNFUy5oYXMobm9ybWFsaXplZCkpIHtcclxuICAgIHJldHVybiBjb21wbGV0ZWRJbmRleCArIDAuMjtcclxuICB9XHJcbiAgcmV0dXJuIFVOSUZJRURfVFJBWV9GTE9XX1NUQVRVU19SQU5LLmdldChub3JtYWxpemVkKSA/PyAtMTtcclxufTtcclxuXHJcbmNvbnN0IHJlc29sdmVVbmlmaWVkVHJheUxpZmVjeWNsZVRpbWUgPSAoeyBzYW1wbGUsIHN0YXR1cywgdHJheSwgdHJheUNvZGUgfSkgPT4ge1xyXG4gIGNvbnN0IG5vcm1hbGl6ZWRTdGF0dXMgPSBub3JtYWxpemVUZXh0KHN0YXR1cyk7XHJcbiAgY29uc3Qgbm9ybWFsaXplZFRyYXlDb2RlID0gbm9ybWFsaXplVGV4dCh0cmF5Q29kZSk7XHJcbiAgY29uc3QgY2FuZGlkYXRlVGltZXMgPSBbXHJcbiAgICB0b1RpbWUodHJheT8udXBkYXRlZF9hdCB8fCB0cmF5Py51cGRhdGVkQXQpLFxyXG4gICAgdG9UaW1lKHNhbXBsZT8udXBkYXRlZF9hdCB8fCBzYW1wbGU/LnVwZGF0ZWRBdCksXHJcbiAgXS5maWx0ZXIoTnVtYmVyLmlzRmluaXRlKTtcclxuICBhc0FycmF5KHNhbXBsZT8uaGlzdG9yeSkuZm9yRWFjaCgoZW50cnkpID0+IHtcclxuICAgIGlmIChub3JtYWxpemVkVHJheUNvZGUgJiYgIWVudHJ5TWF0Y2hlc1RyYXlDb2RlKGVudHJ5LCBub3JtYWxpemVkVHJheUNvZGUpKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IGVudHJ5U3RhdHVzID0gbm9ybWFsaXplTGlmZWN5Y2xlU3RhdHVzKGVudHJ5Py5sb2NhdGlvbiwgZW50cnk/LnN0YXR1cyk7XHJcbiAgICBjb25zdCBlbnRyeU1lbnRpb25zU3RhdHVzID1cclxuICAgICAgZW50cnlTdGF0dXMgPT09IG5vcm1hbGl6ZWRTdGF0dXNcclxuICAgICAgfHwgbm9ybWFsaXplVGV4dChlbnRyeT8uYWN0aW9uKS5pbmNsdWRlcyhub3JtYWxpemVkU3RhdHVzKVxyXG4gICAgICB8fCBub3JtYWxpemVUZXh0KGVudHJ5Py5kZXRhaWwpLmluY2x1ZGVzKG5vcm1hbGl6ZWRTdGF0dXMpO1xyXG4gICAgaWYgKCFlbnRyeU1lbnRpb25zU3RhdHVzKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IGVudHJ5VGltZSA9IHRvVGltZShlbnRyeT8udGltZSB8fCBlbnRyeT8uY3JlYXRlZF9hdCB8fCBlbnRyeT8uY3JlYXRlZEF0IHx8IGVudHJ5Py51cGRhdGVkX2F0IHx8IGVudHJ5Py51cGRhdGVkQXQpO1xyXG4gICAgaWYgKE51bWJlci5pc0Zpbml0ZShlbnRyeVRpbWUpKSB7XHJcbiAgICAgIGNhbmRpZGF0ZVRpbWVzLnB1c2goZW50cnlUaW1lKTtcclxuICAgIH1cclxuICB9KTtcclxuICByZXR1cm4gY2FuZGlkYXRlVGltZXMubGVuZ3RoID4gMCA/IE1hdGgubWF4KC4uLmNhbmRpZGF0ZVRpbWVzKSA6IDA7XHJcbn07XHJcblxyXG5jb25zdCByZXNvbHZlVW5pZmllZFRyYXlMaWZlY3ljbGVDYW5kaWRhdGUgPSAoeyBsb2NhdGlvbiwgc2FtcGxlLCB0cmF5LCB0cmF5Q29kZSB9KSA9PiB7XHJcbiAgY29uc3Qgbm9ybWFsaXplZExvY2F0aW9uID0gbm9ybWFsaXplVGV4dChsb2NhdGlvbik7XHJcbiAgY29uc3QgdHJheVN0YXR1cyA9IG5vcm1hbGl6ZVRleHQodHJheT8uc3RhdHVzKTtcclxuICBjb25zdCBzdGF0dXMgPSBub3JtYWxpemVMaWZlY3ljbGVTdGF0dXMoXHJcbiAgICBub3JtYWxpemVkTG9jYXRpb24sXHJcbiAgICB0cmF5U3RhdHVzLFxyXG4gICk7XHJcbiAgcmV0dXJuIHtcclxuICAgIGxvY2F0aW9uOiBub3JtYWxpemVkTG9jYXRpb24sXHJcbiAgICByYW5rOiByZXNvbHZlVW5pZmllZFRyYXlGbG93UmFuayhzdGF0dXMpLFxyXG4gICAgc3RhdHVzLFxyXG4gICAgdGltZTogcmVzb2x2ZVVuaWZpZWRUcmF5TGlmZWN5Y2xlVGltZSh7IHNhbXBsZSwgc3RhdHVzLCB0cmF5LCB0cmF5Q29kZSB9KSxcclxuICB9O1xyXG59O1xyXG5cclxuY29uc3Qgc2hvdWxkUmVwbGFjZVVuaWZpZWRUcmF5TGlmZWN5Y2xlID0gKHJvdywgY2FuZGlkYXRlKSA9PiB7XHJcbiAgaWYgKCFjYW5kaWRhdGU/LnN0YXR1cykge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuICBjb25zdCBjdXJyZW50VGltZSA9IE51bWJlcihyb3c/LmxpZmVjeWNsZVRpbWUpIHx8IDA7XHJcbiAgY29uc3QgY2FuZGlkYXRlVGltZSA9IE51bWJlcihjYW5kaWRhdGU/LnRpbWUpIHx8IDA7XHJcbiAgaWYgKGNhbmRpZGF0ZVRpbWUgfHwgY3VycmVudFRpbWUpIHtcclxuICAgIGlmIChjYW5kaWRhdGVUaW1lICE9PSBjdXJyZW50VGltZSkge1xyXG4gICAgICByZXR1cm4gY2FuZGlkYXRlVGltZSA+IGN1cnJlbnRUaW1lO1xyXG4gICAgfVxyXG4gICAgY29uc3QgY3VycmVudFN0YXR1cyA9IG5vcm1hbGl6ZUxpZmVjeWNsZVN0YXR1cyhyb3c/LmxpZmVjeWNsZUxvY2F0aW9uLCByb3c/LmxpZmVjeWNsZVN0YXR1cyk7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVTdGF0dXMgPSBub3JtYWxpemVMaWZlY3ljbGVTdGF0dXMoY2FuZGlkYXRlPy5sb2NhdGlvbiwgY2FuZGlkYXRlPy5zdGF0dXMpO1xyXG4gICAgaWYgKFxyXG4gICAgICBQUkVfRElTUEFUQ0hfU1RBVFVTRVMuaGFzKGN1cnJlbnRTdGF0dXMpXHJcbiAgICAgICYmICFQUkVfRElTUEFUQ0hfU1RBVFVTRVMuaGFzKGNhbmRpZGF0ZVN0YXR1cylcclxuICAgICAgJiYgY2FuZGlkYXRlLnJhbmsgPj0gKFVOSUZJRURfVFJBWV9GTE9XX1NUQVRVU19SQU5LLmdldChFWFBFUklNRU5UX0NPTVBMRVRFRF9TVEFUVVMpID8/IDkpXHJcbiAgICApIHtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGNhbmRpZGF0ZS5yYW5rID4gcmVzb2x2ZVVuaWZpZWRUcmF5Rmxvd1Jhbmsocm93Py5saWZlY3ljbGVTdGF0dXMpO1xyXG4gIH1cclxuICByZXR1cm4gIXJvdz8ubGlmZWN5Y2xlU3RhdHVzIHx8IGNhbmRpZGF0ZS5yYW5rID4gcmVzb2x2ZVVuaWZpZWRUcmF5Rmxvd1Jhbmsocm93LmxpZmVjeWNsZVN0YXR1cyk7XHJcbn07XHJcblxyXG5jb25zdCBpc0ZpeHR1cmVSZWFkeSA9ICh2YWx1ZSkgPT4ge1xyXG4gIGlmICh2YWx1ZSA9PT0gdHJ1ZSkge1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVUZXh0KHZhbHVlKS50b0xvd2VyQ2FzZSgpO1xyXG4gIHJldHVybiBbXCIxXCIsIFwidHJ1ZVwiLCBcInllc1wiLCBcInJlYWR5XCIsIFwiZml4dHVyZV9yZWFkeVwiLCBcIuWkueWFt+WuieijheWujOaIkFwiXS5pbmNsdWRlcyhub3JtYWxpemVkKTtcclxufTtcclxuXHJcbmNvbnN0IGJ1aWxkQmxvY2tlZENvbXBhcmlzb25SZXN1bHQgPSAodHJheUNvZGUsIHN0YXR1cykgPT4ge1xyXG4gIGNvbnN0IG5vcm1hbGl6ZWRUcmF5Q29kZSA9IG5vcm1hbGl6ZVRleHQodHJheUNvZGUpO1xyXG4gIGNvbnN0IG5vcm1hbGl6ZWRTdGF0dXMgPSBub3JtYWxpemVUZXh0KHN0YXR1cyk7XHJcbiAgaWYgKG5vcm1hbGl6ZWRTdGF0dXMgPT09IFwi5a6e6aqM5bey5a6M5oiQXCIgfHwgbm9ybWFsaXplZFN0YXR1cyA9PT0gXCLlrp7pqozlrozmiJBcIiB8fCBub3JtYWxpemVkU3RhdHVzID09PSBcIuWunumqjOWQjuaaguWtmOmXtOWtmOaUvlwiIHx8IG5vcm1hbGl6ZWRTdGF0dXMgPT09IFwi5Y6C5a625pS25ZueXCIpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGd1aWRhbmNlOiBgJHtub3JtYWxpemVkVHJheUNvZGV9IOW3suWujOaIkOWunumqjO+8jOaXoOmcgOWGjeasoeavlOWvueOAgmAsXHJcbiAgICAgIG1lc3NhZ2U6IFwi5omY55uY5bey5a6M5oiQ5a6e6aqMXCIsXHJcbiAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgdG9uZTogXCJlcnJvclwiLFxyXG4gICAgICB0cmF5Q29kZTogbm9ybWFsaXplZFRyYXlDb2RlLFxyXG4gICAgfTtcclxuICB9XHJcbiAgaWYgKG5vcm1hbGl6ZWRTdGF0dXMgPT09IFwi5a6e6aqM6L+b6KGM5LitXCIgfHwgbm9ybWFsaXplZFN0YXR1cyA9PT0gXCLlrp7pqozkuK1cIikge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgZ3VpZGFuY2U6IGAke25vcm1hbGl6ZWRUcmF5Q29kZX0g5b2T5YmN5a6e6aqM5q2j5Zyo6L+b6KGM5Lit77yM5LiN6IO95YaN5qyh5q+U5a+544CCYCxcclxuICAgICAgbWVzc2FnZTogXCLmiZjnm5jlrp7pqozov5vooYzkuK1cIixcclxuICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICB0b25lOiBcImVycm9yXCIsXHJcbiAgICAgIHRyYXlDb2RlOiBub3JtYWxpemVkVHJheUNvZGUsXHJcbiAgICB9O1xyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgZ3VpZGFuY2U6IGAke25vcm1hbGl6ZWRUcmF5Q29kZX0g5b2T5YmN54q25oCB5Li6JHtub3JtYWxpemVkU3RhdHVzIHx8IFwi5bey5q+U5a+5XCJ977yM5bey5a6M5oiQ5Lu75Yqh5q+U5a+577yM5peg6ZyA5YaN5qyh5q+U5a+544CCYCxcclxuICAgIG1lc3NhZ2U6IFwi5omY55uY5bey5a6M5oiQ5q+U5a+5XCIsXHJcbiAgICBvazogZmFsc2UsXHJcbiAgICB0b25lOiBcImVycm9yXCIsXHJcbiAgICB0cmF5Q29kZTogbm9ybWFsaXplZFRyYXlDb2RlLFxyXG4gIH07XHJcbn07XHJcblxyXG5jb25zdCBidWlsZFRhc2tNYXAgPSAodGFza3MpID0+IHtcclxuICBjb25zdCB0YXNrTWFwID0gbmV3IE1hcCgpO1xyXG4gIGFzQXJyYXkodGFza3MpLmZvckVhY2goKHRhc2spID0+IHtcclxuICAgIGNvbnN0IGNvZGUgPSBub3JtYWxpemVUZXh0KHRhc2s/LmNvZGUpO1xyXG4gICAgaWYgKGNvZGUpIHtcclxuICAgICAgdGFza01hcC5zZXQoY29kZSwgdGFzayk7XHJcbiAgICB9XHJcbiAgfSk7XHJcbiAgcmV0dXJuIHRhc2tNYXA7XHJcbn07XHJcblxyXG5jb25zdCBidWlsZEV4cGVyaW1lbnRNYXAgPSAoZXhwZXJpbWVudHMpID0+IHtcclxuICBjb25zdCBleHBlcmltZW50TWFwID0gbmV3IE1hcCgpO1xyXG4gIGFzQXJyYXkoZXhwZXJpbWVudHMpLmZvckVhY2goKGV4cGVyaW1lbnQpID0+IHtcclxuICAgIGNvbnN0IHRhc2tDb2RlID0gbm9ybWFsaXplVGV4dChleHBlcmltZW50Py50YXNrX2NvZGUpO1xyXG4gICAgY29uc3QgZXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KGV4cGVyaW1lbnQ/LmV4cGVyaW1lbnRfY29kZSk7XHJcbiAgICBpZiAodGFza0NvZGUgJiYgZXhwZXJpbWVudENvZGUpIHtcclxuICAgICAgZXhwZXJpbWVudE1hcC5zZXQoYCR7dGFza0NvZGV9Ojoke2V4cGVyaW1lbnRDb2RlfWAsIG5vcm1hbGl6ZVRleHQoZXhwZXJpbWVudD8uZXhwZXJpbWVudF9uYW1lKSk7XHJcbiAgICB9XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGV4cGVyaW1lbnRNYXA7XHJcbn07XHJcblxyXG5jb25zdCBidWlsZEV4cGVyaW1lbnRSZWNvcmRNYXAgPSAoZXhwZXJpbWVudHMpID0+IHtcclxuICBjb25zdCBleHBlcmltZW50TWFwID0gbmV3IE1hcCgpO1xyXG4gIGFzQXJyYXkoZXhwZXJpbWVudHMpLmZvckVhY2goKGV4cGVyaW1lbnQpID0+IHtcclxuICAgIGNvbnN0IHRhc2tDb2RlID0gbm9ybWFsaXplVGV4dChleHBlcmltZW50Py50YXNrX2NvZGUpO1xyXG4gICAgY29uc3QgZXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KGV4cGVyaW1lbnQ/LmV4cGVyaW1lbnRfY29kZSk7XHJcbiAgICBpZiAodGFza0NvZGUgJiYgZXhwZXJpbWVudENvZGUpIHtcclxuICAgICAgZXhwZXJpbWVudE1hcC5zZXQoYCR7dGFza0NvZGV9Ojoke2V4cGVyaW1lbnRDb2RlfWAsIGV4cGVyaW1lbnQpO1xyXG4gICAgfVxyXG4gIH0pO1xyXG4gIHJldHVybiBleHBlcmltZW50TWFwO1xyXG59O1xyXG5cclxuY29uc3QgZmluZEV4cGVyaW1lbnRSZWNvcmQgPSAoeyBleHBlcmltZW50cywgZXhwZXJpbWVudENvZGUsIHRhc2tDb2RlIH0pID0+XHJcbiAgYXNBcnJheShleHBlcmltZW50cykuZmluZChcclxuICAgIChleHBlcmltZW50KSA9PlxyXG4gICAgICBub3JtYWxpemVUZXh0KGV4cGVyaW1lbnQ/LnRhc2tfY29kZSkgPT09IG5vcm1hbGl6ZVRleHQodGFza0NvZGUpXHJcbiAgICAgICYmIG5vcm1hbGl6ZVRleHQoZXhwZXJpbWVudD8uZXhwZXJpbWVudF9jb2RlKSA9PT0gbm9ybWFsaXplVGV4dChleHBlcmltZW50Q29kZSksXHJcbiAgKSB8fCBudWxsO1xyXG5cclxuY29uc3QgYnVpbGRTYW1wbGVNYXAgPSAoc2FtcGxlcykgPT4ge1xyXG4gIGNvbnN0IHNhbXBsZU1hcCA9IG5ldyBNYXAoKTtcclxuICBhc0FycmF5KHNhbXBsZXMpLmZvckVhY2goKHNhbXBsZSkgPT4ge1xyXG4gICAgY29uc3QgdGFza0NvZGUgPSBub3JtYWxpemVUZXh0KHNhbXBsZT8udGFza19jb2RlKTtcclxuICAgIGlmICghdGFza0NvZGUpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgY3VycmVudCA9IHNhbXBsZU1hcC5nZXQodGFza0NvZGUpIHx8IFtdO1xyXG4gICAgY3VycmVudC5wdXNoKHNhbXBsZSk7XHJcbiAgICBzYW1wbGVNYXAuc2V0KHRhc2tDb2RlLCBjdXJyZW50KTtcclxuICB9KTtcclxuICByZXR1cm4gc2FtcGxlTWFwO1xyXG59O1xyXG5cclxuY29uc3QgcGFyc2VFeHBlcmltZW50SGlzdG9yeURldGFpbCA9IChkZXRhaWwsIHRhc2tDb2RlKSA9PiB7XHJcbiAgY29uc3Qgc2VnbWVudHMgPSBTdHJpbmcoZGV0YWlsID8/IFwiXCIpXHJcbiAgICAuc3BsaXQoXCIgLyBcIilcclxuICAgIC5tYXAoKHNlZ21lbnQpID0+IG5vcm1hbGl6ZVRleHQoc2VnbWVudCkpXHJcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xyXG4gIGlmIChzZWdtZW50cy5sZW5ndGggPCAzIHx8IHNlZ21lbnRzWzBdICE9PSBub3JtYWxpemVUZXh0KHRhc2tDb2RlKSkge1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBleHBlcmltZW50TmFtZTogc2VnbWVudHNbMV0sXHJcbiAgICBzdGF0dXM6IHNlZ21lbnRzWzJdLFxyXG4gIH07XHJcbn07XHJcblxyXG5jb25zdCByZXNvbHZlUHJldmlvdXNDb21wbGV0ZWRFeHBlcmltZW50U25hcHNob3QgPSAoc2FtcGxlLCB0YXNrQ29kZSwgY3VycmVudEV4cGVyaW1lbnROYW1lKSA9PiB7XHJcbiAgY29uc3QgY2FuZGlkYXRlcyA9IGFzQXJyYXkoc2FtcGxlPy5oaXN0b3J5KVxyXG4gICAgLm1hcCgoZW50cnkpID0+IHtcclxuICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VFeHBlcmltZW50SGlzdG9yeURldGFpbChlbnRyeT8uZGV0YWlsLCB0YXNrQ29kZSk7XHJcbiAgICAgIGlmICghcGFyc2VkIHx8IHBhcnNlZC5zdGF0dXMgIT09IFwi5a6e6aqM5bey5a6M5oiQXCIgfHwgcGFyc2VkLmV4cGVyaW1lbnROYW1lID09PSBjdXJyZW50RXhwZXJpbWVudE5hbWUpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIGV4cGVyaW1lbnROYW1lOiBwYXJzZWQuZXhwZXJpbWVudE5hbWUsXHJcbiAgICAgICAgbG9jYXRpb246IG5vcm1hbGl6ZVRleHQoZW50cnk/LmxvY2F0aW9uKSB8fCBub3JtYWxpemVUZXh0KHNhbXBsZT8ubG9jYXRpb24pLFxyXG4gICAgICAgIHN0YXR1czogXCLlrp7pqozlt7LlrozmiJBcIixcclxuICAgICAgICB0aW1lOiB0b1RpbWUoZW50cnk/LnRpbWUpIHx8IC1JbmZpbml0eSxcclxuICAgICAgfTtcclxuICAgIH0pXHJcbiAgICAuZmlsdGVyKEJvb2xlYW4pXHJcbiAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQudGltZSAtIHJpZ2h0LnRpbWUpO1xyXG4gIHJldHVybiBjYW5kaWRhdGVzW2NhbmRpZGF0ZXMubGVuZ3RoIC0gMV0gfHwgbnVsbDtcclxufTtcclxuXHJcbmNvbnN0IHJlc29sdmVQcmV2aW91c1N0YWJsZVNuYXBzaG90ID0gKHNhbXBsZSwgdGFza0NvZGUsIGN1cnJlbnRFeHBlcmltZW50TmFtZSkgPT4ge1xyXG4gIGNvbnN0IHByZURpc3BhdGNoU25hcHNob3QgPSByZXNvbHZlUHJlRGlzcGF0Y2hTbmFwc2hvdChzYW1wbGUpO1xyXG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXHJcbiAgICByZXNvbHZlUHJldmlvdXNDb21wbGV0ZWRFeHBlcmltZW50U25hcHNob3Qoc2FtcGxlLCB0YXNrQ29kZSwgY3VycmVudEV4cGVyaW1lbnROYW1lKSxcclxuICAgIHJlc29sdmVBcHBlYXJhbmNlU3RvcmFnZVNuYXBzaG90KHNhbXBsZSksXHJcbiAgICBwcmVEaXNwYXRjaFNuYXBzaG90ID8ge1xyXG4gICAgICAuLi5wcmVEaXNwYXRjaFNuYXBzaG90LFxyXG4gICAgICBleHBlcmltZW50TmFtZTogXCJcIixcclxuICAgIH0gOiBudWxsLFxyXG4gIF0uZmlsdGVyKEJvb2xlYW4pO1xyXG4gIGNhbmRpZGF0ZXMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQudGltZSAtIHJpZ2h0LnRpbWUpO1xyXG4gIHJldHVybiBjYW5kaWRhdGVzW2NhbmRpZGF0ZXMubGVuZ3RoIC0gMV07XHJcbn07XHJcblxyXG5jb25zdCByZXNvbHZlTGF0ZXN0RXhwZXJpbWVudEhpc3RvcnlTbmFwc2hvdCA9ICh7IGV4cGVyaW1lbnROYW1lLCBzYW1wbGUsIHRhc2tDb2RlLCB0cmF5Q29kZSA9IFwiXCIgfSkgPT4ge1xuICBjb25zdCBub3JtYWxpemVkRXhwZXJpbWVudE5hbWUgPSBub3JtYWxpemVUZXh0KGV4cGVyaW1lbnROYW1lKTtcbiAgaWYgKCFub3JtYWxpemVkRXhwZXJpbWVudE5hbWUpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBzYW1wbGVUcmF5Q29kZXMgPSBhc0FycmF5KHNhbXBsZT8udHJheXMpLm1hcChyZXNvbHZlVHJheUNvZGUpLmZpbHRlcihCb29sZWFuKTtcbiAgbGV0IGxhdGVzdFNuYXBzaG90ID0gbnVsbDtcbiAgbGV0IGxhdGVzdFRpbWUgPSAtSW5maW5pdHk7XG4gIGFzQXJyYXkoc2FtcGxlPy5oaXN0b3J5KS5mb3JFYWNoKChlbnRyeSkgPT4ge1xuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlRXhwZXJpbWVudEhpc3RvcnlEZXRhaWwoZW50cnk/LmRldGFpbCwgdGFza0NvZGUpO1xuICAgIGlmICghcGFyc2VkIHx8IHBhcnNlZC5leHBlcmltZW50TmFtZSAhPT0gbm9ybWFsaXplZEV4cGVyaW1lbnROYW1lKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxyXG4gICAgaWYgKHRyYXlDb2RlICYmICFoaXN0b3J5RW50cnlBcHBsaWVzVG9UcmF5KGVudHJ5LCBzYW1wbGVUcmF5Q29kZXMsIHRyYXlDb2RlKSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XG4gICAgY29uc3QgZXZlbnRUaW1lID0gdG9UaW1lKGVudHJ5Py50aW1lKSB8fCAwO1xuICAgIGlmIChldmVudFRpbWUgPiBsYXRlc3RUaW1lKSB7XG4gICAgICBsYXRlc3RTbmFwc2hvdCA9IHtcbiAgICAgICAgc3RhdHVzOiBwYXJzZWQuc3RhdHVzLFxuICAgICAgICB0aW1lOiBldmVudFRpbWUsXG4gICAgICB9O1xuICAgICAgbGF0ZXN0VGltZSA9IGV2ZW50VGltZTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gbGF0ZXN0U25hcHNob3Q7XG59O1xuXG5jb25zdCByZXNvbHZlTGF0ZXN0QW55RXhwZXJpbWVudEhpc3RvcnlTbmFwc2hvdCA9ICh7IHNhbXBsZSwgdGFza0NvZGUsIHRyYXlDb2RlID0gXCJcIiB9KSA9PiB7XG4gIGNvbnN0IHNhbXBsZVRyYXlDb2RlcyA9IGFzQXJyYXkoc2FtcGxlPy50cmF5cykubWFwKHJlc29sdmVUcmF5Q29kZSkuZmlsdGVyKEJvb2xlYW4pO1xuICBsZXQgbGF0ZXN0U25hcHNob3QgPSBudWxsO1xuICBsZXQgbGF0ZXN0VGltZSA9IC1JbmZpbml0eTtcbiAgYXNBcnJheShzYW1wbGU/Lmhpc3RvcnkpLmZvckVhY2goKGVudHJ5KSA9PiB7XG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VFeHBlcmltZW50SGlzdG9yeURldGFpbChlbnRyeT8uZGV0YWlsLCB0YXNrQ29kZSk7XG4gICAgaWYgKCFwYXJzZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRyYXlDb2RlICYmICFoaXN0b3J5RW50cnlBcHBsaWVzVG9UcmF5KGVudHJ5LCBzYW1wbGVUcmF5Q29kZXMsIHRyYXlDb2RlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBldmVudFRpbWUgPSB0b1RpbWUoZW50cnk/LnRpbWUpIHx8IDA7XG4gICAgaWYgKGV2ZW50VGltZSA+IGxhdGVzdFRpbWUpIHtcbiAgICAgIGxhdGVzdFNuYXBzaG90ID0ge1xuICAgICAgICBleHBlcmltZW50TmFtZTogcGFyc2VkLmV4cGVyaW1lbnROYW1lLFxuICAgICAgICBzdGF0dXM6IHBhcnNlZC5zdGF0dXMsXG4gICAgICAgIHRpbWU6IGV2ZW50VGltZSxcbiAgICAgIH07XG4gICAgICBsYXRlc3RUaW1lID0gZXZlbnRUaW1lO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsYXRlc3RTbmFwc2hvdDtcbn07XG5cbmNvbnN0IHJlc29sdmVMYXRlc3RFeHBlcmltZW50SGlzdG9yeVN0YXR1cyA9IChpbnB1dCkgPT5cbiAgcmVzb2x2ZUxhdGVzdEV4cGVyaW1lbnRIaXN0b3J5U25hcHNob3QoaW5wdXQpPy5zdGF0dXMgfHwgbnVsbDtcblxuY29uc3QgcmVzb2x2ZUxhdGVzdExhYm9yYXRvcnlEaXNwYXRjaFNuYXBzaG90ID0gKHtcbiAgY3VycmVudEV4cGVyaW1lbnRDb2RlID0gXCJcIixcbiAgY3VycmVudExhYiA9IFwiXCIsXG4gIHNhbXBsZSxcbiAgdHJheUNvZGUgPSBcIlwiLFxufSkgPT4ge1xuICBjb25zdCBub3JtYWxpemVkQ3VycmVudEV4cGVyaW1lbnRDb2RlID0gbm9ybWFsaXplVGV4dChjdXJyZW50RXhwZXJpbWVudENvZGUpO1xuICBjb25zdCBub3JtYWxpemVkQ3VycmVudExhYiA9IG5vcm1hbGl6ZVRleHQoY3VycmVudExhYik7XG4gIGNvbnN0IHNhbXBsZVRyYXlDb2RlcyA9IGFzQXJyYXkoc2FtcGxlPy50cmF5cykubWFwKHJlc29sdmVUcmF5Q29kZSkuZmlsdGVyKEJvb2xlYW4pO1xuICBsZXQgbGF0ZXN0U25hcHNob3QgPSBudWxsO1xuICBsZXQgbGF0ZXN0VGltZSA9IC1JbmZpbml0eTtcbiAgYXNBcnJheShzYW1wbGU/Lmhpc3RvcnkpLmZvckVhY2goKGVudHJ5KSA9PiB7XG4gICAgY29uc3Qgc3RhdHVzID0gbm9ybWFsaXplTGlmZWN5Y2xlU3RhdHVzKG5vcm1hbGl6ZVRleHQoZW50cnk/LnN0YXR1cyB8fCBlbnRyeT8uZmxvd19zdGF0dXMgfHwgZW50cnk/LmZsb3dTdGF0dXMpKTtcbiAgICBjb25zdCBhY3Rpb24gPSBub3JtYWxpemVUZXh0KGVudHJ5Py5hY3Rpb24pO1xuICAgIGNvbnN0IHRhcmdldFR5cGUgPSBub3JtYWxpemVUZXh0KGVudHJ5Py50YXJnZXRfdHlwZSB8fCBlbnRyeT8udGFyZ2V0VHlwZSk7XG4gICAgaWYgKHRhcmdldFR5cGUgJiYgdGFyZ2V0VHlwZSAhPT0gXCJsYWJcIikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoc3RhdHVzICE9PSBMQUJfUkVTRVRfU1RBVFVTICYmICFMQUJfRElTUEFUQ0hfSElTVE9SWV9BQ1RJT05TLmhhcyhhY3Rpb24pKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0cmF5Q29kZSAmJiAhaGlzdG9yeUVudHJ5QXBwbGllc1RvVHJheShlbnRyeSwgc2FtcGxlVHJheUNvZGVzLCB0cmF5Q29kZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdGFyZ2V0TGFiID0gcmVzb2x2ZUxhYkRlc3RpbmF0aW9uTmFtZShcbiAgICAgIGVudHJ5Py50YXJnZXRfbGFiLFxuICAgICAgZW50cnk/LnRhcmdldExhYixcbiAgICAgIGVudHJ5Py5sb2NhdGlvbixcbiAgICAgIGVudHJ5Py5sb2NhdGlvbl9kZXNjLFxuICAgICAgZW50cnk/LmxvY2F0aW9uRGVzYyxcbiAgICAgIGVudHJ5Py5kZXRhaWwsXG4gICAgKTtcbiAgICBpZiAoIXRhcmdldExhYikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB0YXJnZXRFeHBlcmltZW50Q29kZSA9XG4gICAgICBub3JtYWxpemVUZXh0KGVudHJ5Py50YXJnZXRfZXhwZXJpbWVudF9jb2RlIHx8IGVudHJ5Py50YXJnZXRFeHBlcmltZW50Q29kZSlcbiAgICAgIHx8IChub3JtYWxpemVkQ3VycmVudExhYiAmJiB0YXJnZXRMYWIgPT09IG5vcm1hbGl6ZWRDdXJyZW50TGFiID8gbm9ybWFsaXplZEN1cnJlbnRFeHBlcmltZW50Q29kZSA6IFwiXCIpO1xuICAgIGNvbnN0IGV2ZW50VGltZSA9IHRvVGltZShlbnRyeT8udGltZSkgfHwgMDtcbiAgICBpZiAoZXZlbnRUaW1lID4gbGF0ZXN0VGltZSkge1xuICAgICAgbGF0ZXN0U25hcHNob3QgPSB7XG4gICAgICAgIHRhcmdldEV4cGVyaW1lbnRDb2RlLFxuICAgICAgICB0YXJnZXRMYWIsXG4gICAgICAgIHRpbWU6IGV2ZW50VGltZSxcbiAgICAgIH07XG4gICAgICBsYXRlc3RUaW1lID0gZXZlbnRUaW1lO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsYXRlc3RTbmFwc2hvdDtcbn07XG5cbmNvbnN0IGV4cGVyaW1lbnRJc0NvbXBsZXRlZEluU2FtcGxlSGlzdG9yeSA9ICh7IGV4cGVyaW1lbnROYW1lLCBzYW1wbGUsIHRhc2tDb2RlLCB0cmF5Q29kZSA9IFwiXCIgfSkgPT5cbiAgQ09NUExFVEVEX1RSQVlfU1RBVFVTRVMuaGFzKHJlc29sdmVMYXRlc3RFeHBlcmltZW50SGlzdG9yeVN0YXR1cyh7IGV4cGVyaW1lbnROYW1lLCBzYW1wbGUsIHRhc2tDb2RlLCB0cmF5Q29kZSB9KSk7XG5cclxuY29uc3QgcmVzb2x2ZUN1cnJlbnRFeHBlcmltZW50VHJheVN0YXR1cyA9ICh7XHJcbiAgY29tcGxldGVkRm9yQ3VycmVudEV4cGVyaW1lbnQgPSBmYWxzZSxcclxuICBjb21wbGV0ZWRGb3JPdGhlckV4cGVyaW1lbnQgPSBmYWxzZSxcclxuICBjdXJyZW50RXhwZXJpbWVudENvZGUsXHJcbiAgZGV2aWNlLFxuICBleHBlcmltZW50Q29kZXMgPSBbXSxcbiAgZXhwZXJpbWVudE5hbWUsXG4gIGhpc3RvcnlTdGF0dXMsXG4gIHBoeXNpY2FsU3RhdHVzLFxuICBzYW1wbGUsXG4gIHRhcmdldEV4cGVyaW1lbnRDb2RlID0gXCJcIixcbiAgdGFyZ2V0TGFiID0gXCJcIixcbiAgdGFza0NvZGUsXG4gIHRyYXlDb2RlID0gXCJcIixcbn0pID0+IHtcbiAgY29uc3QgcmVzb2x2ZWRIaXN0b3J5U3RhdHVzID0gaGlzdG9yeVN0YXR1cyA9PT0gdW5kZWZpbmVkXG4gICAgPyByZXNvbHZlTGF0ZXN0RXhwZXJpbWVudEhpc3RvcnlTdGF0dXMoeyBleHBlcmltZW50TmFtZSwgc2FtcGxlLCB0YXNrQ29kZSwgdHJheUNvZGUgfSlcbiAgICA6IG5vcm1hbGl6ZVRleHQoaGlzdG9yeVN0YXR1cyk7XG4gIGNvbnN0IG5vcm1hbGl6ZWRTdGF0dXMgPSBub3JtYWxpemVUZXh0KHBoeXNpY2FsU3RhdHVzKTtcbiAgaWYgKG5vcm1hbGl6ZWRTdGF0dXMgPT09IFwi6YCB6Iez5aSW6KeC5qOA5rWL6Ze0XCIgfHwgQVBQRUFSQU5DRV9TVE9SQUdFX1NUQVRVU0VTLmhhcyhub3JtYWxpemVkU3RhdHVzKSkge1xuICAgIHJldHVybiBub3JtYWxpemVkU3RhdHVzO1xuICB9XG4gIGlmIChyZXNvbHZlZEhpc3RvcnlTdGF0dXMpIHtcbiAgICBjb25zdCBoaXN0b3J5UmFuayA9IHJlc29sdmVMYWJvcmF0b3J5U3RhdHVzUmFuayhyZXNvbHZlZEhpc3RvcnlTdGF0dXMpO1xuICAgIGNvbnN0IHBoeXNpY2FsUmFuayA9IHJlc29sdmVMYWJvcmF0b3J5U3RhdHVzUmFuayhub3JtYWxpemVkU3RhdHVzKTtcbiAgICBpZiAoQ09NUExFVEVEX1RSQVlfU1RBVFVTRVMuaGFzKHJlc29sdmVkSGlzdG9yeVN0YXR1cykpIHtcbiAgICAgIHJldHVybiByZXNvbHZlZEhpc3RvcnlTdGF0dXM7XG4gICAgfVxuICAgIGlmIChub3JtYWxpemVkU3RhdHVzICYmIGhpc3RvcnlSYW5rID4gMCAmJiBwaHlzaWNhbFJhbmsgPCBoaXN0b3J5UmFuaykge1xuICAgICAgcmV0dXJuIG5vcm1hbGl6ZWRTdGF0dXM7XG4gICAgfVxuICAgIHJldHVybiBub3JtYWxpemVkU3RhdHVzIHx8IHJlc29sdmVkSGlzdG9yeVN0YXR1cztcbiAgfVxuXHJcbiAgY29uc3Qgc2hhcmVkVHJheSA9IGFzQXJyYXkoZXhwZXJpbWVudENvZGVzKS5sZW5ndGggPiAxO1xyXG4gIGlmICghc2hhcmVkVHJheSkge1xyXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRTdGF0dXM7XHJcbiAgfVxyXG4gIGlmIChDT01QTEVURURfVFJBWV9TVEFUVVNFUy5oYXMobm9ybWFsaXplZFN0YXR1cykpIHtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRUYXJnZXRMYWIgPSBub3JtYWxpemVUZXh0KHRhcmdldExhYik7XHJcbiAgICBjb25zdCBub3JtYWxpemVkRGV2aWNlID0gbm9ybWFsaXplVGV4dChkZXZpY2UpO1xyXG4gICAgaWYgKFxyXG4gICAgICBjb21wbGV0ZWRGb3JPdGhlckV4cGVyaW1lbnRcclxuICAgICAgJiYgIWNvbXBsZXRlZEZvckN1cnJlbnRFeHBlcmltZW50XHJcbiAgICAgICYmIG5vcm1hbGl6ZWRUYXJnZXRMYWJcclxuICAgICAgJiYgbm9ybWFsaXplZERldmljZVxyXG4gICAgICAmJiBub3JtYWxpemVkVGFyZ2V0TGFiICE9PSBub3JtYWxpemVkRGV2aWNlXHJcbiAgICApIHtcclxuICAgICAgcmV0dXJuIExBQl9SRVNFVF9TVEFUVVM7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY29tcGxldGVkRm9yQ3VycmVudEV4cGVyaW1lbnQgfHwgY29tcGxldGVkRm9yT3RoZXJFeHBlcmltZW50XHJcbiAgICAgID8gbm9ybWFsaXplZFN0YXR1c1xyXG4gICAgICA6IExBQl9SRVNFVF9TVEFUVVM7XHJcbiAgfVxyXG4gIGlmIChub3JtYWxpemVkU3RhdHVzID09PSBMQUJfUkVTRVRfU1RBVFVTKSB7XHJcbiAgICByZXR1cm4gbm9ybWFsaXplZFN0YXR1cztcclxuICB9XHJcbiAgY29uc3Qgbm9ybWFsaXplZFRhcmdldEV4cGVyaW1lbnRDb2RlID0gbm9ybWFsaXplVGV4dCh0YXJnZXRFeHBlcmltZW50Q29kZSk7XHJcbiAgY29uc3Qgbm9ybWFsaXplZEN1cnJlbnRFeHBlcmltZW50Q29kZSA9IG5vcm1hbGl6ZVRleHQoY3VycmVudEV4cGVyaW1lbnRDb2RlKTtcclxuICBpZiAoXHJcbiAgICBub3JtYWxpemVkVGFyZ2V0RXhwZXJpbWVudENvZGVcclxuICAgICYmIG5vcm1hbGl6ZWRDdXJyZW50RXhwZXJpbWVudENvZGVcclxuICAgICYmIG5vcm1hbGl6ZWRUYXJnZXRFeHBlcmltZW50Q29kZSAhPT0gbm9ybWFsaXplZEN1cnJlbnRFeHBlcmltZW50Q29kZVxyXG4gICAgJiYgcmVzb2x2ZUxhYm9yYXRvcnlTdGF0dXNSYW5rKG5vcm1hbGl6ZWRTdGF0dXMpID4gMFxyXG4gICkge1xyXG4gICAgcmV0dXJuIExBQl9SRVNFVF9TVEFUVVM7XHJcbiAgfVxyXG5cclxuICBjb25zdCBsb2NhdGlvbiA9IG5vcm1hbGl6ZVRleHQoc2FtcGxlPy5sb2NhdGlvbik7XHJcbiAgY29uc3QgY3VycmVudERldmljZSA9IG5vcm1hbGl6ZVRleHQoZGV2aWNlKTtcclxuICBpZiAoIWxvY2F0aW9uIHx8ICFjdXJyZW50RGV2aWNlIHx8IGxvY2F0aW9uID09PSBjdXJyZW50RGV2aWNlKSB7XHJcbiAgICByZXR1cm4gbm9ybWFsaXplZFN0YXR1cztcclxuICB9XHJcbiAgaWYgKHJlc29sdmVMYWJvcmF0b3J5U3RhdHVzUmFuayhub3JtYWxpemVkU3RhdHVzKSA+IDApIHtcclxuICAgIHJldHVybiBMQUJfUkVTRVRfU1RBVFVTO1xyXG4gIH1cclxuICByZXR1cm4gbm9ybWFsaXplZFN0YXR1cztcclxufTtcclxuXHJcbmNvbnN0IHJlc29sdmVOb3REaXNwYXRjaGVkU291cmNlR3VpZGFuY2UgPSAodHJheSA9IG51bGwpID0+IHtcclxuICBjb25zdCBsb2NhdGlvbiA9IG5vcm1hbGl6ZVRleHQodHJheT8uY3VycmVudExvY2F0aW9uIHx8IHRyYXk/LmxvY2F0aW9uKTtcclxuICBjb25zdCBzdGF0dXMgPSBub3JtYWxpemVUZXh0KHRyYXk/LnRyYXlTdGF0dXMgfHwgdHJheT8uZGlzcGxheVN0YXR1cyk7XHJcbiAgaWYgKHN0YXR1cyA9PT0gXCLpgIHoh7PlpJbop4Lmo4DmtYvpl7RcIikge1xyXG4gICAgcmV0dXJuIFwi5b2T5YmN5omY55uY6ZyA5YWI6L+b5YWl5aSW6KeC5qOA5rWL6Ze05bm25a6M5oiQ5YWl5bqT77yM5YaN55Sx5aSW6KeC5qOA5rWL6Ze05Ye65bqT6YCB6Iez5a6e6aqM5a6k44CCXCI7XHJcbiAgfVxyXG4gIGlmIChcclxuICAgIGxvY2F0aW9uLmluY2x1ZGVzKEFQUEVBUkFOQ0VfSU5TUEVDVElPTl9MT0NBVElPTilcclxuICAgIHx8IHN0YXR1cy5pbmNsdWRlcyhBUFBFQVJBTkNFX0lOU1BFQ1RJT05fTE9DQVRJT04pXHJcbiAgKSB7XHJcbiAgICByZXR1cm4gXCLor7flhYjlnKjlpJbop4Lmo4DmtYvpl7TlrozmiJDlh7rlupPlubbpgIHoh7Plrp7pqozlrqTjgIJcIjtcclxuICB9XHJcbiAgY29uc3Qgc291cmNlTGFiZWwgPSBsb2NhdGlvbi5pbmNsdWRlcyhcIuaaguWtmOmXtFwiKSB8fCBzdGF0dXMuaW5jbHVkZXMoXCLmmoLlrZjpl7RcIikgPyBcIuaaguWtmOmXtFwiIDogXCLmjqXpqbPpl7RcIjtcclxuICByZXR1cm4gYOivt+WFiOWcqCR7c291cmNlTGFiZWx95a6M5oiQ5Ye65bqT5bm26YCB6Iez5a6e6aqM5a6k44CCYDtcclxufTtcclxuXHJcbmNvbnN0IGJ1aWxkTm90RGlzcGF0Y2hlZENvbXBhcmlzb25SZXN1bHQgPSAodHJheUNvZGUsIHRyYXkgPSBudWxsKSA9PiB7XHJcbiAgY29uc3Qgbm9ybWFsaXplZFRyYXlDb2RlID0gbm9ybWFsaXplVGV4dCh0cmF5Q29kZSk7XHJcbiAgcmV0dXJuIHtcclxuICAgIGd1aWRhbmNlOiByZXNvbHZlTm90RGlzcGF0Y2hlZFNvdXJjZUd1aWRhbmNlKHRyYXkpLFxyXG4gICAgbWVzc2FnZTogXCLmiZjnm5jlsJrmnKrlh7rlupNcIixcclxuICAgIG9rOiBmYWxzZSxcclxuICAgIHRvbmU6IFwiZXJyb3JcIixcclxuICAgIHRyYXlDb2RlOiBub3JtYWxpemVkVHJheUNvZGUsXHJcbiAgfTtcclxufTtcclxuY29uc3QgYnVpbGRXcm9uZ0xhYm9yYXRvcnlEaXNwYXRjaFJlc3VsdCA9ICh0cmF5Q29kZSwgdHJheSA9IG51bGwsIGN1cnJlbnRUYXNrID0gbnVsbCkgPT4ge1xyXG4gIGNvbnN0IG5vcm1hbGl6ZWRUcmF5Q29kZSA9IG5vcm1hbGl6ZVRleHQodHJheUNvZGUpO1xyXG4gIGNvbnN0IGxvY2F0aW9uID0gbm9ybWFsaXplVGV4dCh0cmF5Py50YXJnZXRMYWIgfHwgdHJheT8udGFyZ2V0X2xhYiB8fCB0cmF5Py5jdXJyZW50TG9jYXRpb24gfHwgdHJheT8ubG9jYXRpb24pO1xyXG4gIGNvbnN0IGN1cnJlbnRMYWIgPSBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy5kZXZpY2UpO1xyXG4gIHJldHVybiB7XHJcbiAgICBndWlkYW5jZTogYCR7bm9ybWFsaXplZFRyYXlDb2RlfSDlt7Llh7rlupPoh7Mke2xvY2F0aW9uIHx8IFwi5YW25LuW6K+V6aqM6Ze0XCJ977yM6K+35ZyoJHtjdXJyZW50TGFiIHx8IFwi5b2T5YmN6K+V6aqM6Ze0XCJ95Ye65bqT5ZCO5YaN5q+U5a+544CCYCxcclxuICAgIG1lc3NhZ2U6IFwi5omY55uY5pyq6YCB6L6+5b2T5YmN6K+V6aqM6Ze0XCIsXHJcbiAgICBvazogZmFsc2UsXHJcbiAgICB0b25lOiBcImVycm9yXCIsXHJcbiAgICB0cmF5Q29kZTogbm9ybWFsaXplZFRyYXlDb2RlLFxyXG4gIH07XHJcbn07XHJcblxyXG5jb25zdCBidWlsZEFjdGl2ZU90aGVyRXhwZXJpbWVudENvbXBhcmlzb25SZXN1bHQgPSAodHJheUNvZGUsIGxvY2sgPSBudWxsKSA9PiB7XHJcbiAgY29uc3Qgbm9ybWFsaXplZFRyYXlDb2RlID0gbm9ybWFsaXplVGV4dCh0cmF5Q29kZSk7XHJcbiAgY29uc3QgZXhwZXJpbWVudE5hbWUgPSBub3JtYWxpemVUZXh0KGxvY2s/LmV4cGVyaW1lbnROYW1lKTtcclxuICBjb25zdCBkZXZpY2UgPSBub3JtYWxpemVUZXh0KGxvY2s/LmRldmljZSk7XHJcbiAgY29uc3QgcnVubmluZ0xhYmVsID0gW2RldmljZSwgZXhwZXJpbWVudE5hbWVdLmZpbHRlcihCb29sZWFuKS5qb2luKFwiIC8gXCIpIHx8IFwi5YW25LuW5a6e6aqMXCI7XHJcbiAgcmV0dXJuIHtcclxuICAgIGd1aWRhbmNlOiBgJHtub3JtYWxpemVkVHJheUNvZGV9IOato+WcqCR7cnVubmluZ0xhYmVsfei/m+ihjOWunumqjO+8jOWujOaIkOWQjuaJjeWPr+WcqOW9k+WJjeivlemqjOmXtOavlOWvueOAgmAsXHJcbiAgICBtZXNzYWdlOiBcIuaJmOebmOato+WcqOWFtuS7luWunumqjOS4rVwiLFxyXG4gICAgb2s6IGZhbHNlLFxyXG4gICAgdG9uZTogXCJlcnJvclwiLFxyXG4gICAgdHJheUNvZGU6IG5vcm1hbGl6ZWRUcmF5Q29kZSxcclxuICB9O1xyXG59O1xyXG5cclxuY29uc3QgYnVpbGRTY2hlZHVsZVRyYXlDb2RlU2V0ID0gKHsgZXhwZXJpbWVudFRyYXlzLCBleHBlcmltZW50Q29kZSwgdGFza0NvZGUgfSkgPT5cclxuICBuZXcgU2V0KFxyXG4gICAgYXNBcnJheShleHBlcmltZW50VHJheXMpXHJcbiAgICAgIC5maWx0ZXIoXHJcbiAgICAgICAgKGVudHJ5KSA9PlxyXG4gICAgICAgICAgbm9ybWFsaXplVGV4dChlbnRyeT8udGFza19jb2RlKSA9PT0gbm9ybWFsaXplVGV4dCh0YXNrQ29kZSlcclxuICAgICAgICAgICYmIG5vcm1hbGl6ZVRleHQoZW50cnk/LmV4cGVyaW1lbnRfY29kZSkgPT09IG5vcm1hbGl6ZVRleHQoZXhwZXJpbWVudENvZGUpLFxyXG4gICAgICApXHJcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiBub3JtYWxpemVUZXh0KGVudHJ5Py50cmF5X2NvZGUpKVxyXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pLFxyXG4gICk7XHJcblxyXG5jb25zdCBidWlsZFRyYXlFeHBlcmltZW50Q29kZU1hcCA9IChleHBlcmltZW50VHJheXMpID0+IHtcclxuICBjb25zdCB0cmF5TWFwID0gbmV3IE1hcCgpO1xyXG4gIGFzQXJyYXkoZXhwZXJpbWVudFRyYXlzKS5mb3JFYWNoKChlbnRyeSkgPT4ge1xyXG4gICAgY29uc3QgdHJheUNvZGUgPSBub3JtYWxpemVUZXh0KGVudHJ5Py50cmF5X2NvZGUpO1xyXG4gICAgY29uc3QgZXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KGVudHJ5Py5leHBlcmltZW50X2NvZGUpO1xyXG4gICAgaWYgKCF0cmF5Q29kZSB8fCAhZXhwZXJpbWVudENvZGUpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgY3VycmVudCA9IHRyYXlNYXAuZ2V0KHRyYXlDb2RlKSB8fCBuZXcgU2V0KCk7XHJcbiAgICBjdXJyZW50LmFkZChleHBlcmltZW50Q29kZSk7XHJcbiAgICB0cmF5TWFwLnNldCh0cmF5Q29kZSwgY3VycmVudCk7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIHRyYXlNYXA7XHJcbn07XHJcblxyXG5jb25zdCBjb2xsZWN0U2NoZWR1bGVTYW1wbGVzID0gKHsgZXhwZXJpbWVudFRyYXlzLCBzYW1wbGVzLCBzY2hlZHVsZSB9KSA9PiB7XG4gIGNvbnN0IHRhc2tDb2RlID0gbm9ybWFsaXplVGV4dChzY2hlZHVsZT8udGFza19jb2RlKTtcbiAgY29uc3QgZXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KHNjaGVkdWxlPy5leHBlcmltZW50X2NvZGUpO1xuICBjb25zdCBzY29wZWRUcmF5Q29kZXMgPSBidWlsZFNjaGVkdWxlVHJheUNvZGVTZXQoeyBleHBlcmltZW50VHJheXMsIGV4cGVyaW1lbnRDb2RlLCB0YXNrQ29kZSB9KTtcbiAgY29uc3QgbWF0Y2hlZFNhbXBsZXMgPSBhc0FycmF5KHNhbXBsZXMpLmZpbHRlcigoc2FtcGxlKSA9PiB7XHJcbiAgICBpZiAobm9ybWFsaXplVGV4dChzYW1wbGU/LnRhc2tfY29kZSkgIT09IHRhc2tDb2RlKSB7XHJcbiAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIGlmICghc2NvcGVkVHJheUNvZGVzLnNpemUpIHtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYXNBcnJheShzYW1wbGU/LnRyYXlzKS5zb21lKCh0cmF5KSA9PiBzY29wZWRUcmF5Q29kZXMuaGFzKG5vcm1hbGl6ZVRleHQodHJheT8udHJheV9jb2RlKSkpO1xyXG4gIH0pO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgbWF0Y2hlZFNhbXBsZXMsXHJcbiAgICBzY29wZWRUcmF5Q29kZXMsXHJcbiAgICB0YXNrQ29kZSxcbiAgfTtcbn07XG5cbmNvbnN0IHNjaGVkdWxlUnVuQ29tcGxldGlvbkNvdmVyc1NjaGVkdWxlID0gKHsgZXhwZXJpbWVudFJ1bnMgPSBbXSwgZXhwZXJpbWVudFJ1blRyYXlzID0gW10sIHNjaGVkdWxlLCBzY29wZWRUcmF5Q29kZXMgPSBuZXcgU2V0KCkgfSkgPT4ge1xuICBjb25zdCB0YXNrQ29kZSA9IG5vcm1hbGl6ZVRleHQoc2NoZWR1bGU/LnRhc2tfY29kZSk7XG4gIGNvbnN0IGV4cGVyaW1lbnRDb2RlID0gbm9ybWFsaXplVGV4dChzY2hlZHVsZT8uZXhwZXJpbWVudF9jb2RlKTtcbiAgY29uc3Qgc2NoZWR1bGVJZCA9IG5vcm1hbGl6ZVRleHQoc2NoZWR1bGU/LmlkIHx8IHNjaGVkdWxlPy5zY2hlZHVsZV9pZCB8fCBzY2hlZHVsZT8uc2NoZWR1bGVJZCk7XG4gIGNvbnN0IHNjaGVkdWxlUnVucyA9IGFzQXJyYXkoZXhwZXJpbWVudFJ1bnMpLmZpbHRlcigocnVuKSA9PlxuICAgIHJlc29sdmVSdW5UYXNrQ29kZShydW4pID09PSB0YXNrQ29kZVxuICAgICYmIHJlc29sdmVSdW5FeHBlcmltZW50Q29kZShydW4pID09PSBleHBlcmltZW50Q29kZVxuICAgICYmICghc2NoZWR1bGVJZCB8fCByZXNvbHZlUnVuU2NoZWR1bGVJZChydW4pID09PSBzY2hlZHVsZUlkKSxcbiAgKTtcbiAgY29uc3Qgc2NoZWR1bGVSdW5Ob3MgPSBuZXcgU2V0KHNjaGVkdWxlUnVucy5tYXAocmVzb2x2ZVJ1bk5vKS5maWx0ZXIoQm9vbGVhbikpO1xuICBjb25zdCBjb21wbGV0ZWRSdW5UcmF5Q29kZXMgPSBuZXcgU2V0KFxuICAgIGFzQXJyYXkoZXhwZXJpbWVudFJ1blRyYXlzKVxuICAgICAgLmZpbHRlcigocmVsYXRpb24pID0+XG4gICAgICAgIHJlc29sdmVSZWxhdGlvblRhc2tDb2RlKHJlbGF0aW9uKSA9PT0gdGFza0NvZGVcbiAgICAgICAgJiYgcmVzb2x2ZVJlbGF0aW9uRXhwZXJpbWVudENvZGUocmVsYXRpb24pID09PSBleHBlcmltZW50Q29kZVxuICAgICAgICAmJiByZWxhdGlvbklzQ29tcGxldGVkKHJlbGF0aW9uKVxuICAgICAgICAmJiAoIXNjaGVkdWxlUnVuTm9zLnNpemUgfHwgc2NoZWR1bGVSdW5Ob3MuaGFzKHJlc29sdmVSZWxhdGlvblJ1bk5vKHJlbGF0aW9uKSkpLFxuICAgICAgKVxuICAgICAgLm1hcChyZXNvbHZlUmVsYXRpb25UcmF5Q29kZSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbiksXG4gICk7XG4gIGNvbnN0IHNjb3BlZENvZGVzID0gQXJyYXkuZnJvbShzY29wZWRUcmF5Q29kZXMpLmZpbHRlcihCb29sZWFuKTtcbiAgaWYgKHNjb3BlZENvZGVzLmxlbmd0aCA+IDApIHtcbiAgICBpZiAoc2NvcGVkQ29kZXMuZXZlcnkoKHRyYXlDb2RlKSA9PiBjb21wbGV0ZWRSdW5UcmF5Q29kZXMuaGFzKHRyYXlDb2RlKSkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBjb25zdCBjb21wbGV0ZWRSdW5UcmF5Q29kZXNGcm9tUnVucyA9IG5ldyBTZXQoXG4gICAgICBzY2hlZHVsZVJ1bnNcbiAgICAgICAgLmZpbHRlcigocnVuKSA9PiBDT01QTEVURURfRVhQRVJJTUVOVF9TVEFUVVNFUy5oYXMocmVzb2x2ZVJ1blN0YXR1cyhydW4pKSlcbiAgICAgICAgLmZsYXRNYXAoKHJ1bikgPT4gYXNBcnJheShydW4/LnRyYXlfY29kZXMgPz8gcnVuPy50cmF5Q29kZXMpLm1hcChub3JtYWxpemVUZXh0KSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKSxcbiAgICApO1xuICAgIHJldHVybiBjb21wbGV0ZWRSdW5UcmF5Q29kZXNGcm9tUnVucy5zaXplID4gMFxuICAgICAgJiYgc2NvcGVkQ29kZXMuZXZlcnkoKHRyYXlDb2RlKSA9PiBjb21wbGV0ZWRSdW5UcmF5Q29kZXNGcm9tUnVucy5oYXModHJheUNvZGUpKTtcbiAgfVxuICByZXR1cm4gY29tcGxldGVkUnVuVHJheUNvZGVzLnNpemUgPiAwIHx8IHNjaGVkdWxlUnVucy5zb21lKChydW4pID0+IENPTVBMRVRFRF9FWFBFUklNRU5UX1NUQVRVU0VTLmhhcyhyZXNvbHZlUnVuU3RhdHVzKHJ1bikpKTtcbn07XG5cbmNvbnN0IHNjaGVkdWxlRXhwZXJpbWVudElzQ29tcGxldGVkID0gKHsgZXhwZXJpbWVudHMsIGV4cGVyaW1lbnRSdW5zID0gW10sIGV4cGVyaW1lbnRSdW5TdGVwcyA9IFtdLCBleHBlcmltZW50UnVuVHJheXMgPSBbXSwgZXhwZXJpbWVudFRyYXlzLCBzYW1wbGVzLCBzY2hlZHVsZSB9KSA9PiB7XG4gIGNvbnN0IHRhc2tDb2RlID0gbm9ybWFsaXplVGV4dChzY2hlZHVsZT8udGFza19jb2RlKTtcbiAgY29uc3QgZXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KHNjaGVkdWxlPy5leHBlcmltZW50X2NvZGUpO1xuICBpZiAoIXRhc2tDb2RlKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY29uc3QgZXhwZXJpbWVudCA9IGZpbmRFeHBlcmltZW50UmVjb3JkKHsgZXhwZXJpbWVudHMsIGV4cGVyaW1lbnRDb2RlLCB0YXNrQ29kZSB9KTtcbiAgY29uc3QgYXhpc1Byb2dyZXNzID0gYnVpbGRBeGlzUHJvZ3Jlc3NGb3JTY2hlZHVsZSh7XG4gICAgZXhwZXJpbWVudCxcbiAgICBleHBlcmltZW50TmFtZTogbm9ybWFsaXplVGV4dChleHBlcmltZW50Py5leHBlcmltZW50X25hbWUpIHx8IG5vcm1hbGl6ZVRleHQoZXhwZXJpbWVudD8uZXhwZXJpbWVudF90eXBlKSxcbiAgICBleHBlcmltZW50UnVucyxcbiAgICBleHBlcmltZW50UnVuU3RlcHMsXG4gICAgc2NoZWR1bGUsXG4gIH0pO1xuICBpZiAoYXhpc1Byb2dyZXNzPy5yZW1haW5pbmdBeGlzQ29kZXM/Lmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgY29uc3QgeyBtYXRjaGVkU2FtcGxlcywgc2NvcGVkVHJheUNvZGVzIH0gPSBjb2xsZWN0U2NoZWR1bGVTYW1wbGVzKHsgZXhwZXJpbWVudFRyYXlzLCBzYW1wbGVzLCBzY2hlZHVsZSB9KTtcbiAgaWYgKGF4aXNQcm9ncmVzcz8ucmVxdWlyZWRBeGlzQ29kZXM/Lmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gc2NoZWR1bGVSdW5Db21wbGV0aW9uQ292ZXJzU2NoZWR1bGUoeyBleHBlcmltZW50UnVucywgZXhwZXJpbWVudFJ1blRyYXlzLCBzY2hlZHVsZSwgc2NvcGVkVHJheUNvZGVzIH0pO1xuICB9XG4gIGlmIChDT01QTEVURURfRVhQRVJJTUVOVF9TVEFUVVNFUy5oYXMobm9ybWFsaXplVGV4dChleHBlcmltZW50Py5zdGF0dXMpKSAmJiBzY29wZWRUcmF5Q29kZXMuc2l6ZSA9PT0gMCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cclxuICBpZiAoZXhwZXJpbWVudFNjb3BlSXNUZXJtaW5hbCh7XHJcbiAgICBleHBlcmltZW50cyxcclxuICAgIGV4cGVyaW1lbnRDb2RlLFxyXG4gICAgZXhwZXJpbWVudFJ1blRyYXlzLFxyXG4gICAgZXhwZXJpbWVudFRyYXlzLFxyXG4gICAgc2FtcGxlcyxcclxuICAgIHRhc2tDb2RlLFxyXG4gIH0pKSB7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcbiAgaWYgKG1hdGNoZWRTYW1wbGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgdHJheUV4cGVyaW1lbnRDb2RlTWFwID0gYnVpbGRUcmF5RXhwZXJpbWVudENvZGVNYXAoZXhwZXJpbWVudFRyYXlzKTtcclxuICBjb25zdCBoYXNTaGFyZWRTY29wZWRUcmF5ID0gQXJyYXkuZnJvbShzY29wZWRUcmF5Q29kZXMpLnNvbWUoKHRyYXlDb2RlKSA9PiAodHJheUV4cGVyaW1lbnRDb2RlTWFwLmdldCh0cmF5Q29kZSk/LnNpemUgfHwgMCkgPiAxKTtcclxuICBpZiAoZXhwZXJpbWVudENvZGUgJiYgaGFzU2hhcmVkU2NvcGVkVHJheSkge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgZXhwZXJpbWVudE5hbWUgPSBub3JtYWxpemVUZXh0KGV4cGVyaW1lbnQ/LmV4cGVyaW1lbnRfbmFtZSk7XHJcbiAgaWYgKGV4cGVyaW1lbnROYW1lKSB7XHJcbiAgICBjb25zdCBsYXRlc3RIaXN0b3J5QnlUcmF5ID0gbmV3IE1hcCgpO1xyXG4gICAgbWF0Y2hlZFNhbXBsZXMuZm9yRWFjaCgoc2FtcGxlKSA9PiB7XHJcbiAgICAgIGNvbnN0IHNhbXBsZVRyYXlDb2RlcyA9IGFzQXJyYXkoc2FtcGxlPy50cmF5cylcclxuICAgICAgICAubWFwKHJlc29sdmVUcmF5Q29kZSlcclxuICAgICAgICAuZmlsdGVyKCh0cmF5Q29kZSkgPT4gIXNjb3BlZFRyYXlDb2Rlcy5zaXplIHx8IHNjb3BlZFRyYXlDb2Rlcy5oYXModHJheUNvZGUpKTtcclxuICAgICAgYXNBcnJheShzYW1wbGU/Lmhpc3RvcnkpLmZvckVhY2goKGVudHJ5KSA9PiB7XHJcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VFeHBlcmltZW50SGlzdG9yeURldGFpbChlbnRyeT8uZGV0YWlsLCB0YXNrQ29kZSk7XHJcbiAgICAgICAgaWYgKCFwYXJzZWQgfHwgcGFyc2VkLmV4cGVyaW1lbnROYW1lICE9PSBleHBlcmltZW50TmFtZSkge1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBldmVudFRpbWUgPSB0b1RpbWUoZW50cnk/LnRpbWUpIHx8IDA7XHJcbiAgICAgICAgY29uc3QgdGFyZ2V0VHJheUNvZGVzID0gc2FtcGxlVHJheUNvZGVzLmZpbHRlcigodHJheUNvZGUpID0+XHJcbiAgICAgICAgICBoaXN0b3J5RW50cnlBcHBsaWVzVG9UcmF5KGVudHJ5LCBzYW1wbGVUcmF5Q29kZXMsIHRyYXlDb2RlKSxcclxuICAgICAgICApO1xyXG4gICAgICAgIHRhcmdldFRyYXlDb2Rlcy5mb3JFYWNoKCh0cmF5Q29kZSkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBsYXRlc3RIaXN0b3J5QnlUcmF5LmdldCh0cmF5Q29kZSk7XHJcbiAgICAgICAgICBpZiAoIWV4aXN0aW5nIHx8IGV2ZW50VGltZSA+PSBleGlzdGluZy50aW1lKSB7XHJcbiAgICAgICAgICAgIGxhdGVzdEhpc3RvcnlCeVRyYXkuc2V0KHRyYXlDb2RlLCB7IHN0YXR1czogcGFyc2VkLnN0YXR1cywgdGltZTogZXZlbnRUaW1lIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGlmIChsYXRlc3RIaXN0b3J5QnlUcmF5LnNpemUgPiAwKSB7XHJcbiAgICAgIGNvbnN0IHJlcXVpcmVkVHJheUNvZGVzID0gc2NvcGVkVHJheUNvZGVzLnNpemUgPyBBcnJheS5mcm9tKHNjb3BlZFRyYXlDb2RlcykgOiBBcnJheS5mcm9tKGxhdGVzdEhpc3RvcnlCeVRyYXkua2V5cygpKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICByZXF1aXJlZFRyYXlDb2Rlcy5sZW5ndGggPiAwXHJcbiAgICAgICAgJiYgcmVxdWlyZWRUcmF5Q29kZXMuZXZlcnkoKHRyYXlDb2RlKSA9PiBDT01QTEVURURfVFJBWV9TVEFUVVNFUy5oYXMobGF0ZXN0SGlzdG9yeUJ5VHJheS5nZXQodHJheUNvZGUpPy5zdGF0dXMpKVxyXG4gICAgICApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgY29uc3Qgc3RhdHVzZXMgPSBbXTtcclxuICBtYXRjaGVkU2FtcGxlcy5mb3JFYWNoKChzYW1wbGUpID0+IHtcclxuICAgIGNvbnN0IHNhbXBsZVRyYXlzID0gYXNBcnJheShzYW1wbGU/LnRyYXlzKTtcclxuICAgIGlmICghc2FtcGxlVHJheXMubGVuZ3RoICYmICFzY29wZWRUcmF5Q29kZXMuc2l6ZSkge1xyXG4gICAgICBjb25zdCBzYW1wbGVTdGF0dXMgPSBub3JtYWxpemVUZXh0KHNhbXBsZT8uc3RhdHVzKTtcclxuICAgICAgaWYgKHNhbXBsZVN0YXR1cykge1xyXG4gICAgICAgIHN0YXR1c2VzLnB1c2goc2FtcGxlU3RhdHVzKTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBzYW1wbGVUcmF5cy5mb3JFYWNoKCh0cmF5KSA9PiB7XHJcbiAgICAgIGNvbnN0IHRyYXlDb2RlID0gbm9ybWFsaXplVGV4dCh0cmF5Py50cmF5X2NvZGUpO1xyXG4gICAgICBpZiAoc2NvcGVkVHJheUNvZGVzLnNpemUgJiYgIXNjb3BlZFRyYXlDb2Rlcy5oYXModHJheUNvZGUpKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IHN0YXR1cyA9IG5vcm1hbGl6ZVRleHQodHJheT8uc3RhdHVzKSB8fCBub3JtYWxpemVUZXh0KHNhbXBsZT8uc3RhdHVzKTtcclxuICAgICAgaWYgKHN0YXR1cykge1xyXG4gICAgICAgIHN0YXR1c2VzLnB1c2goc3RhdHVzKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIHJldHVybiBzdGF0dXNlcy5sZW5ndGggPiAwICYmIHN0YXR1c2VzLmV2ZXJ5KChzdGF0dXMpID0+IENPTVBMRVRFRF9UUkFZX1NUQVRVU0VTLmhhcyhzdGF0dXMpKTtcclxufTtcclxuXHJcbmNvbnN0IGJ1aWxkTGFib3JhdG9yeVRhc2tGbG93ID0gKHN0YXR1cyA9IFNUQVRVU19XQUlUSU5HLCBheGlzUHJvZ3Jlc3MgPSBudWxsKSA9PiB7XG4gIGNvbnN0IGN1cnJlbnRTdGF0dXMgPSBMQUJPUkFUT1JZX1RBU0tfRkxPV19JTkRFWC5oYXMoc3RhdHVzKSA/IHN0YXR1cyA6IFNUQVRVU19XQUlUSU5HO1xuICBjb25zdCBhY3RpdmVJbmRleCA9IExBQk9SQVRPUllfVEFTS19GTE9XX0lOREVYLmdldChjdXJyZW50U3RhdHVzKSA/PyAwO1xuICByZXR1cm4ge1xuICAgIGN1cnJlbnRTdGF0dXM6IG5vcm1hbGl6ZVRleHQoYXhpc1Byb2dyZXNzPy5zdGF0dXNMYWJlbCkgfHwgY3VycmVudFN0YXR1cyxcbiAgICBzdGVwczogTEFCT1JBVE9SWV9UQVNLX0ZMT1dfU1RFUFMubWFwKChzdGVwLCBpbmRleCkgPT4gKHtcbiAgICAgIC4uLnN0ZXAsXG4gICAgICBhY3RpdmU6IGluZGV4ID09PSBhY3RpdmVJbmRleCxcclxuICAgICAgcmVhY2hlZDogaW5kZXggPD0gYWN0aXZlSW5kZXgsXHJcbiAgICB9KSksXHJcbiAgfTtcclxufTtcclxuXHJcbmNvbnN0IHJlc29sdmVMYWJvcmF0b3J5VGFza1N0YXR1cyA9IChjdXJyZW50VGFzaykgPT4ge1xyXG4gIGlmICghY3VycmVudFRhc2spIHtcclxuICAgIHJldHVybiBTVEFUVVNfV0FJVElORztcclxuICB9XHJcbiAgaWYgKGdldFJ1bm5pbmdUcmF5Um93c0ZvckN1cnJlbnRUYXNrKGN1cnJlbnRUYXNrKS5sZW5ndGggPiAwKSB7XHJcbiAgICByZXR1cm4gU1RBVFVTX1JVTk5JTkc7XHJcbiAgfVxyXG4gIHJldHVybiBTVEFUVVNfU0NIRURVTEVEO1xyXG59O1xyXG5cclxuY29uc3QgbGFib3JhdG9yeU9wZXJhdGlvbktleSA9ICh0YXNrKSA9PlxyXG4gIG5vcm1hbGl6ZVRleHQodGFzaz8uZXhwZXJpbWVudEtleSlcclxuICB8fCAobm9ybWFsaXplVGV4dCh0YXNrPy50YXNrQ29kZSkgJiYgbm9ybWFsaXplVGV4dCh0YXNrPy5leHBlcmltZW50Q29kZSlcclxuICAgID8gYCR7bm9ybWFsaXplVGV4dCh0YXNrPy50YXNrQ29kZSl9Ojoke25vcm1hbGl6ZVRleHQodGFzaz8uZXhwZXJpbWVudENvZGUpfWBcclxuICAgIDogbm9ybWFsaXplVGV4dCh0YXNrPy5pZCkpO1xyXG5jb25zdCByZXNvbHZlVHJheUV4cGVyaW1lbnRPcGVyYXRpb25TdGF0ZSA9IChyb3csIGN1cnJlbnRUYXNrKSA9PiB7XHJcbiAgY29uc3QgaGFzQXV0aG9yaXRhdGl2ZUFjdGl2ZVJ1biA9IHJvd0hhc1J1bm5pbmdTdGF0dXMocm93KSAmJiB0cmF5SGFzQWN0aXZlUnVuRm9yQ3VycmVudEV4cGVyaW1lbnQocm93LCBjdXJyZW50VGFzayk7XHJcbiAgaWYgKGhhc0F1dGhvcml0YXRpdmVBY3RpdmVSdW4pIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGFjdGl2ZTogdHJ1ZSxcclxuICAgICAgYmVsb25nc1RvQ3VycmVudFdvcmtmbG93OiB0cnVlLFxyXG4gICAgICByYW5rOiByZXNvbHZlTGFib3JhdG9yeVN0YXR1c1Jhbmsocm93Py50cmF5U3RhdHVzKSxcclxuICAgICAgd2l0aGRyYXduOiBmYWxzZSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBjb25zdCB3aXRoZHJhd24gPSBleHBlcmltZW50SGlzdG9yeVN0YXR1c0lzV2l0aGRyYXdhbChcclxuICAgIHJvdz8uY3VycmVudEV4cGVyaW1lbnRIaXN0b3J5U3RhdHVzIHx8IHJvdz8ubGF0ZXN0RXhwZXJpbWVudEhpc3RvcnlTdGF0dXMsXHJcbiAgKTtcclxuICBpZiAod2l0aGRyYXduKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBhY3RpdmU6IGZhbHNlLFxyXG4gICAgICBiZWxvbmdzVG9DdXJyZW50V29ya2Zsb3c6IGZhbHNlLFxyXG4gICAgICByYW5rOiAwLFxyXG4gICAgICB3aXRoZHJhd246IHRydWUsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgY29uc3QgYmVsb25nc1RvQ3VycmVudFdvcmtmbG93ID0gdHJheUJlbG9uZ3NUb0N1cnJlbnRMYWJvcmF0b3J5V29ya2Zsb3cocm93LCBjdXJyZW50VGFzayk7XHJcbiAgY29uc3QgcmFuayA9IGJlbG9uZ3NUb0N1cnJlbnRXb3JrZmxvdyA/IHJlc29sdmVDdXJyZW50V29ya2Zsb3dUcmF5UmFuayhyb3csIGN1cnJlbnRUYXNrKSA6IDA7XHJcbiAgcmV0dXJuIHtcclxuICAgIGFjdGl2ZTogYmVsb25nc1RvQ3VycmVudFdvcmtmbG93ICYmIHJhbmsgPj0gMSAmJiByYW5rIDwgNSxcclxuICAgIGJlbG9uZ3NUb0N1cnJlbnRXb3JrZmxvdyxcclxuICAgIHJhbmssXHJcbiAgICB3aXRoZHJhd246IGZhbHNlLFxyXG4gIH07XHJcbn07XHJcbmNvbnN0IGxhYm9yYXRvcnlSb3dIYXNTdGFydGVkT3BlcmF0aW9uID0gKHJvdykgPT5cclxuICBhc0FycmF5KHJvdz8udHJheVJvd3MpLnNvbWUoKHRyYXkpID0+IHJlc29sdmVUcmF5RXhwZXJpbWVudE9wZXJhdGlvblN0YXRlKHRyYXksIHJvdykuYWN0aXZlKTtcclxuY29uc3QgbGFib3JhdG9yeU9wZXJhdGlvblRyYXlDb2RlU2V0ID0gKHJvdykgPT5cbiAgbmV3IFNldChcbiAgICBhc0FycmF5KHJvdz8udHJheVJvd3MpXG4gICAgICAuZmlsdGVyKCh0cmF5KSA9PiByZXNvbHZlVHJheUV4cGVyaW1lbnRPcGVyYXRpb25TdGF0ZSh0cmF5LCByb3cpLmFjdGl2ZSlcbiAgICAgIC5tYXAoKHRyYXkpID0+IG5vcm1hbGl6ZVRleHQodHJheT8udHJheUNvZGUpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKSxcbiAgKTtcbmNvbnN0IHRyYXlIYXNFeHBsaWNpdExhYm9yYXRvcnlXb3JrZmxvd1Njb3BlID0gKHJvdykgPT5cbiAgQm9vbGVhbihcbiAgICBub3JtYWxpemVUZXh0KHJvdz8udGFyZ2V0RXhwZXJpbWVudENvZGUgfHwgcm93Py50YXJnZXRfZXhwZXJpbWVudF9jb2RlKVxuICAgIHx8IG5vcm1hbGl6ZVRleHQocm93Py50YXJnZXRMYWIgfHwgcm93Py50YXJnZXRfbGFiKVxuICAgIHx8IGFzQXJyYXkocm93Py5leHBlcmltZW50Q29kZXMpLmxlbmd0aCA9PT0gMSxcbiAgKTtcbmNvbnN0IHRyYXlMYWJvcmF0b3J5TG9jYXRpb24gPSAocm93KSA9PiBub3JtYWxpemVUZXh0KFxuICByb3c/LmN1cnJlbnRMb2NhdGlvblxuICB8fCByb3c/LmxpZmVjeWNsZUxvY2F0aW9uXG4gIHx8IHJvdz8ubG9jYXRpb24sXG4pO1xuY29uc3QgdHJheUxvY2F0aW9uTWF0Y2hlc0N1cnJlbnRMYWJvcmF0b3J5ID0gKHJvdywgY3VycmVudFRhc2spID0+IHtcbiAgY29uc3QgY3VycmVudExhYiA9IG5vcm1hbGl6ZVRleHQoY3VycmVudFRhc2s/LmRldmljZSk7XG4gIGNvbnN0IGN1cnJlbnRMb2NhdGlvbiA9IHRyYXlMYWJvcmF0b3J5TG9jYXRpb24ocm93KTtcbiAgcmV0dXJuICFjdXJyZW50TGFiIHx8ICFjdXJyZW50TG9jYXRpb24gfHwgY3VycmVudExvY2F0aW9uID09PSBjdXJyZW50TGFiO1xufTtcbmNvbnN0IHRyYXlDYW5Vc2VJbXBsaWNpdExhYm9yYXRvcnlXb3JrZmxvd1Njb3BlID0gKHJvdywgY3VycmVudFRhc2spID0+XG4gIHRyYXlIYXNFeHBsaWNpdExhYm9yYXRvcnlXb3JrZmxvd1Njb3BlKHJvdylcbiAgfHwgKFxuICAgIHJvdz8uY29tcGxldGVkRm9yT3RoZXJFeHBlcmltZW50ID09PSB0cnVlXG4gICAgJiYgcm93Py5jb21wbGV0ZWRGb3JDdXJyZW50RXhwZXJpbWVudCAhPT0gdHJ1ZVxuICAgICYmIGN1cnJlbnRFeHBlcmltZW50SXNOZXh0VW5maW5pc2hlZEZvclRyYXkocm93LCBjdXJyZW50VGFzaylcbiAgKVxuICB8fCAhdHJheUxhYm9yYXRvcnlMb2NhdGlvbihyb3cpXG4gIHx8IHRyYXlMb2NhdGlvbk1hdGNoZXNDdXJyZW50TGFib3JhdG9yeShyb3csIGN1cnJlbnRUYXNrKTtcbmNvbnN0IHRyYXlDYW5QYXJ0aWNpcGF0ZUluU2hhcmVkT3BlcmF0aW9uTG9jayA9IChyb3csIGN1cnJlbnRUYXNrKSA9PlxuICB0cmF5QmVsb25nc1RvQ3VycmVudExhYm9yYXRvcnlXb3JrZmxvdyhyb3csIGN1cnJlbnRUYXNrKVxuICB8fCAoIXRyYXlIYXNFeHBsaWNpdExhYm9yYXRvcnlXb3JrZmxvd1Njb3BlKHJvdykgJiYgIXRyYXlMYWJvcmF0b3J5TG9jYXRpb24ocm93KSk7XG5jb25zdCBsYWJvcmF0b3J5Um93c1NoYXJlVHJheSA9IChsZWZ0LCByaWdodCkgPT4ge1xuICBjb25zdCBsZWZ0VHJheUNvZGVzID0gbGFib3JhdG9yeU9wZXJhdGlvblRyYXlDb2RlU2V0KGxlZnQpO1xuICBpZiAoIWxlZnRUcmF5Q29kZXMuc2l6ZSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gYXNBcnJheShyaWdodD8udHJheVJvd3MpLnNvbWUoKHRyYXkpID0+XG4gICAgdHJheUNhblBhcnRpY2lwYXRlSW5TaGFyZWRPcGVyYXRpb25Mb2NrKHRyYXksIHJpZ2h0KVxuICAgICYmIGxlZnRUcmF5Q29kZXMuaGFzKG5vcm1hbGl6ZVRleHQodHJheT8udHJheUNvZGUpKSxcbiAgKTtcbn07XG5jb25zdCByb3dDb21wbGV0ZWRFeHBlcmltZW50Q29kZVNldCA9IChyb3cpID0+XHJcbiAgbmV3IFNldChhc0FycmF5KHJvdz8uY29tcGxldGVkRXhwZXJpbWVudENvZGVzKS5tYXAoKGNvZGUpID0+IG5vcm1hbGl6ZVRleHQoY29kZSkpLmZpbHRlcihCb29sZWFuKSk7XHJcbmNvbnN0IHJvd0hhc1VuZmluaXNoZWREaWZmZXJlbnRUYXJnZXRFeHBlcmltZW50ID0gKHJvdywgY3VycmVudFRhc2spID0+IHtcclxuICBjb25zdCB0YXJnZXRFeHBlcmltZW50Q29kZSA9IG5vcm1hbGl6ZVRleHQocm93Py50YXJnZXRFeHBlcmltZW50Q29kZSB8fCByb3c/LnRhcmdldF9leHBlcmltZW50X2NvZGUpO1xyXG4gIGNvbnN0IGN1cnJlbnRFeHBlcmltZW50Q29kZSA9IG5vcm1hbGl6ZVRleHQoY3VycmVudFRhc2s/LmV4cGVyaW1lbnRDb2RlKTtcclxuICByZXR1cm4gQm9vbGVhbihcclxuICAgIHRhcmdldEV4cGVyaW1lbnRDb2RlXHJcbiAgICAmJiBjdXJyZW50RXhwZXJpbWVudENvZGVcclxuICAgICYmIHRhcmdldEV4cGVyaW1lbnRDb2RlICE9PSBjdXJyZW50RXhwZXJpbWVudENvZGVcclxuICAgICYmICFyb3dDb21wbGV0ZWRFeHBlcmltZW50Q29kZVNldChyb3cpLmhhcyh0YXJnZXRFeHBlcmltZW50Q29kZSksXHJcbiAgKTtcclxufTtcclxuY29uc3Qgcm93SGFzUHJlRGlzcGF0Y2hMaWZlY3ljbGVTdGF0dXMgPSAocm93KSA9PiB7XHJcbiAgY29uc3QgbGlmZWN5Y2xlU3RhdHVzID0gbm9ybWFsaXplVGV4dChyb3c/LmxpZmVjeWNsZVN0YXR1cyk7XHJcbiAgY29uc3QgZGlzcGxheVN0YXR1cyA9IG5vcm1hbGl6ZVRleHQocm93Py5kaXNwbGF5U3RhdHVzKTtcclxuICBjb25zdCB0cmF5U3RhdHVzID0gbm9ybWFsaXplVGV4dChyb3c/LnRyYXlTdGF0dXMpO1xyXG4gIHJldHVybiBQUkVfRElTUEFUQ0hfU1RBVFVTRVMuaGFzKGxpZmVjeWNsZVN0YXR1cylcclxuICAgIHx8IFBSRV9ESVNQQVRDSF9TVEFUVVNFUy5oYXMoZGlzcGxheVN0YXR1cylcclxuICAgIHx8IFBSRV9ESVNQQVRDSF9TVEFUVVNFUy5oYXModHJheVN0YXR1cylcclxuICAgIHx8IEFQUEVBUkFOQ0VfU1RPUkFHRV9TVEFUVVNFUy5oYXMobGlmZWN5Y2xlU3RhdHVzKVxyXG4gICAgfHwgQVBQRUFSQU5DRV9TVE9SQUdFX1NUQVRVU0VTLmhhcyhkaXNwbGF5U3RhdHVzKVxyXG4gICAgfHwgQVBQRUFSQU5DRV9TVE9SQUdFX1NUQVRVU0VTLmhhcyh0cmF5U3RhdHVzKVxyXG4gICAgfHwgbGlmZWN5Y2xlU3RhdHVzID09PSBcIumAgeiHs+WkluinguajgOa1i+mXtFwiXHJcbiAgICB8fCBkaXNwbGF5U3RhdHVzID09PSBcIumAgeiHs+WkluinguajgOa1i+mXtFwiXHJcbiAgICB8fCB0cmF5U3RhdHVzID09PSBcIumAgeiHs+WkluinguajgOa1i+mXtFwiO1xyXG59O1xyXG5jb25zdCBjdXJyZW50RXhwZXJpbWVudElzTmV4dFVuZmluaXNoZWRGb3JUcmF5ID0gKHJvdywgY3VycmVudFRhc2spID0+IHtcclxuICBjb25zdCBjdXJyZW50RXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy5leHBlcmltZW50Q29kZSk7XHJcbiAgY29uc3QgZXhwZXJpbWVudENvZGVzID0gYXNBcnJheShyb3c/LmV4cGVyaW1lbnRDb2RlcykubWFwKChjb2RlKSA9PiBub3JtYWxpemVUZXh0KGNvZGUpKS5maWx0ZXIoQm9vbGVhbik7XHJcbiAgY29uc3QgY3VycmVudEluZGV4ID0gZXhwZXJpbWVudENvZGVzLmluZGV4T2YoY3VycmVudEV4cGVyaW1lbnRDb2RlKTtcclxuICBpZiAoIWN1cnJlbnRFeHBlcmltZW50Q29kZSB8fCBjdXJyZW50SW5kZXggPCAwKSB7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG4gIGNvbnN0IGNvbXBsZXRlZENvZGVzID0gcm93Q29tcGxldGVkRXhwZXJpbWVudENvZGVTZXQocm93KTtcclxuICBpZiAoY29tcGxldGVkQ29kZXMuaGFzKGN1cnJlbnRFeHBlcmltZW50Q29kZSkpIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcbiAgcmV0dXJuIGV4cGVyaW1lbnRDb2Rlcy5zbGljZSgwLCBjdXJyZW50SW5kZXgpLmV2ZXJ5KChleHBlcmltZW50Q29kZSkgPT4gY29tcGxldGVkQ29kZXMuaGFzKGV4cGVyaW1lbnRDb2RlKSk7XHJcbn07XHJcbmNvbnN0IHRhc2tIYXNEaXNwYXRjaFZhbGlkYXRpb25TY29wZSA9ICh0YXNrKSA9PlxyXG4gIEJvb2xlYW4obm9ybWFsaXplVGV4dCh0YXNrPy5leHBlcmltZW50Q29kZSkgfHwgbm9ybWFsaXplVGV4dCh0YXNrPy5kZXZpY2UpKTtcclxuY29uc3QgdHJheUlzRGlzcGF0Y2hlZFRvQ3VycmVudExhYm9yYXRvcnkgPSAocm93LCBjdXJyZW50VGFzaykgPT4ge1xyXG4gIGNvbnN0IHRyYXlTdGF0dXMgPSBub3JtYWxpemVUZXh0KHJvdz8udHJheVN0YXR1cykgfHwgbm9ybWFsaXplVGV4dChyb3c/LmRpc3BsYXlTdGF0dXMpO1xyXG4gIGNvbnN0IHRhcmdldEV4cGVyaW1lbnRDb2RlID0gbm9ybWFsaXplVGV4dChyb3c/LnRhcmdldEV4cGVyaW1lbnRDb2RlIHx8IHJvdz8udGFyZ2V0X2V4cGVyaW1lbnRfY29kZSk7XHJcbiAgY29uc3QgY3VycmVudEV4cGVyaW1lbnRDb2RlID0gbm9ybWFsaXplVGV4dChjdXJyZW50VGFzaz8uZXhwZXJpbWVudENvZGUpO1xyXG4gIGNvbnN0IGV4cGVyaW1lbnRDb2RlcyA9IGFzQXJyYXkocm93Py5leHBlcmltZW50Q29kZXMpLm1hcCgoY29kZSkgPT4gbm9ybWFsaXplVGV4dChjb2RlKSkuZmlsdGVyKEJvb2xlYW4pO1xyXG4gIGNvbnN0IGN1cnJlbnRFeHBlcmltZW50SW5kZXggPSBleHBlcmltZW50Q29kZXMuaW5kZXhPZihjdXJyZW50RXhwZXJpbWVudENvZGUpO1xyXG4gIGNvbnN0IHRhcmdldExhYiA9IG5vcm1hbGl6ZVRleHQocm93Py50YXJnZXRMYWIgfHwgcm93Py50YXJnZXRfbGFiKTtcclxuICBjb25zdCBjdXJyZW50TGFiID0gbm9ybWFsaXplVGV4dChjdXJyZW50VGFzaz8uZGV2aWNlKTtcclxuICBjb25zdCB0YXJnZXRMYWJNYXRjaGVzQ3VycmVudCA9IEJvb2xlYW4odGFyZ2V0TGFiICYmIGN1cnJlbnRMYWIgJiYgdGFyZ2V0TGFiID09PSBjdXJyZW50TGFiKTtcclxuICBjb25zdCBoYXNDdXJyZW50RXhwZXJpbWVudFJlbGF0aW9uID0gQm9vbGVhbihcclxuICAgIGN1cnJlbnRFeHBlcmltZW50Q29kZSAmJiBleHBlcmltZW50Q29kZXMuaW5jbHVkZXMoY3VycmVudEV4cGVyaW1lbnRDb2RlKSxcclxuICApO1xyXG4gIGNvbnN0IHRhcmdldEV4cGVyaW1lbnRNYXRjaGVzQ3VycmVudCA9IEJvb2xlYW4oXHJcbiAgICB0YXJnZXRFeHBlcmltZW50Q29kZVxyXG4gICAgJiYgY3VycmVudEV4cGVyaW1lbnRDb2RlXHJcbiAgICAmJiB0YXJnZXRFeHBlcmltZW50Q29kZSA9PT0gY3VycmVudEV4cGVyaW1lbnRDb2RlLFxyXG4gICk7XHJcbiAgY29uc3QgY3VycmVudElzTmV4dFVuZmluaXNoZWQgPSBjdXJyZW50RXhwZXJpbWVudElzTmV4dFVuZmluaXNoZWRGb3JUcmF5KHJvdywgY3VycmVudFRhc2spO1xyXG4gIGlmIChcclxuICAgIHRhcmdldEV4cGVyaW1lbnRDb2RlXHJcbiAgICAmJiBjdXJyZW50RXhwZXJpbWVudENvZGVcclxuICAgICYmIHRhcmdldEV4cGVyaW1lbnRDb2RlICE9PSBjdXJyZW50RXhwZXJpbWVudENvZGVcclxuICAgICYmIHJvdz8uY29tcGxldGVkRm9yT3RoZXJFeHBlcmltZW50ID09PSB0cnVlXHJcbiAgICAmJiByb3c/LmNvbXBsZXRlZEZvckN1cnJlbnRFeHBlcmltZW50ICE9PSB0cnVlXHJcbiAgICAmJiBjdXJyZW50SXNOZXh0VW5maW5pc2hlZFxyXG4gICAgJiYgcm93Q29tcGxldGVkRXhwZXJpbWVudENvZGVTZXQocm93KS5oYXModGFyZ2V0RXhwZXJpbWVudENvZGUpXHJcbiAgKSB7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcbiAgaWYgKHRhcmdldEV4cGVyaW1lbnRDb2RlICYmIGN1cnJlbnRFeHBlcmltZW50Q29kZSAmJiB0YXJnZXRFeHBlcmltZW50Q29kZSAhPT0gY3VycmVudEV4cGVyaW1lbnRDb2RlKSB7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG4gIGlmICh0cmF5U3RhdHVzICE9PSBMQUJfUkVTRVRfU1RBVFVTKSB7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcbiAgaWYgKHRhcmdldEV4cGVyaW1lbnRNYXRjaGVzQ3VycmVudCkge1xyXG4gICAgcmV0dXJuIHRhcmdldExhYiA/IHRhcmdldExhYk1hdGNoZXNDdXJyZW50IDogQm9vbGVhbihjdXJyZW50TGFiKTtcclxuICB9XHJcbiAgaWYgKCF0YXJnZXRFeHBlcmltZW50Q29kZSAmJiBoYXNDdXJyZW50RXhwZXJpbWVudFJlbGF0aW9uKSB7XHJcbiAgICBpZiAodGFyZ2V0TGFiTWF0Y2hlc0N1cnJlbnQpIHtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICBpZiAodGFyZ2V0TGFiKSB7XHJcbiAgICAgIHJldHVybiByb3c/LmNvbXBsZXRlZEZvck90aGVyRXhwZXJpbWVudCA9PT0gdHJ1ZSAmJiBjdXJyZW50SXNOZXh0VW5maW5pc2hlZDtcclxuICAgIH1cclxuICAgIHJldHVybiBleHBlcmltZW50Q29kZXMubGVuZ3RoIDw9IDEgfHwgY3VycmVudEV4cGVyaW1lbnRJbmRleCA9PT0gMCB8fCBjdXJyZW50SXNOZXh0VW5maW5pc2hlZDtcclxuICB9XHJcbiAgaWYgKFxyXG4gICAgIXRhcmdldEV4cGVyaW1lbnRDb2RlXHJcbiAgICAmJiByb3c/LmNvbXBsZXRlZEZvck90aGVyRXhwZXJpbWVudCA9PT0gdHJ1ZVxyXG4gICAgJiYgcm93Py5jb21wbGV0ZWRGb3JDdXJyZW50RXhwZXJpbWVudCAhPT0gdHJ1ZVxyXG4gICAgJiYgY3VycmVudEV4cGVyaW1lbnRDb2RlXHJcbiAgICAmJiBjdXJyZW50SXNOZXh0VW5maW5pc2hlZFxyXG4gICkge1xyXG4gICAgcmV0dXJuIHRhcmdldExhYk1hdGNoZXNDdXJyZW50O1xyXG4gIH1cclxuICByZXR1cm4gZmFsc2U7XHJcbn07XHJcbmNvbnN0IHRyYXlMaWZlY3ljbGVJc0JlZm9yZUxhYm9yYXRvcnlEaXNwYXRjaCA9IChyb3cpID0+IHtcclxuICBjb25zdCBsaWZlY3ljbGVTdGF0dXMgPSBub3JtYWxpemVUZXh0KHJvdz8ubGlmZWN5Y2xlU3RhdHVzKTtcclxuICBpZiAoIWxpZmVjeWNsZVN0YXR1cykge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuICBjb25zdCByYW5rID0gcmVzb2x2ZVVuaWZpZWRUcmF5Rmxvd1JhbmsobGlmZWN5Y2xlU3RhdHVzKTtcclxuICBjb25zdCBzZW50VG9MYWJSYW5rID0gcmVzb2x2ZVVuaWZpZWRUcmF5Rmxvd1JhbmsoTEFCX1JFU0VUX1NUQVRVUyk7XHJcbiAgcmV0dXJuIHJhbmsgPj0gMCAmJiByYW5rIDwgc2VudFRvTGFiUmFuaztcclxufTtcclxuY29uc3QgdGFza0hhc1dyb25nTGFib3JhdG9yeURpc3BhdGNoID0gKHRhc2spID0+XG4gIHRhc2tIYXNEaXNwYXRjaFZhbGlkYXRpb25TY29wZSh0YXNrKVxuICAmJiBhc0FycmF5KHRhc2s/LnRyYXlSb3dzKS5zb21lKChyb3cpID0+ICF0cmF5SXNEaXNwYXRjaGVkVG9DdXJyZW50TGFib3JhdG9yeShyb3csIHRhc2spKTtcbmNvbnN0IHRyYXlCZWxvbmdzVG9DdXJyZW50TGFib3JhdG9yeVdvcmtmbG93ID0gKHJvdywgY3VycmVudFRhc2spID0+XG4gICF0YXNrSGFzRGlzcGF0Y2hWYWxpZGF0aW9uU2NvcGUoY3VycmVudFRhc2spXG4gIHx8IChcbiAgICB0cmF5SXNEaXNwYXRjaGVkVG9DdXJyZW50TGFib3JhdG9yeShyb3csIGN1cnJlbnRUYXNrKVxuICAgICYmIHRyYXlDYW5Vc2VJbXBsaWNpdExhYm9yYXRvcnlXb3JrZmxvd1Njb3BlKHJvdywgY3VycmVudFRhc2spXG4gICk7XG5jb25zdCB0YXNrSGFzQ3VycmVudExhYm9yYXRvcnlEaXNwYXRjaCA9ICh0YXNrKSA9PlxyXG4gIGFzQXJyYXkodGFzaz8udHJheVJvd3MpLnNvbWUoKHJvdykgPT4gdHJheUJlbG9uZ3NUb0N1cnJlbnRMYWJvcmF0b3J5V29ya2Zsb3cocm93LCB0YXNrKSk7XHJcbmNvbnN0IHJlc29sdmVMYWJvcmF0b3J5T3BlcmF0aW9uTGFiUmVmID0gKGN1cnJlbnRUYXNrID0gbnVsbCwgbGFiID0gbnVsbCkgPT4ge1xyXG4gIGNvbnN0IGV4cGxpY2l0TGFiID0gcmVzb2x2ZUxhYlJlZihsYWIpO1xyXG4gIGNvbnN0IGV4cGxpY2l0TmFtZSA9IG5vcm1hbGl6ZVRleHQoZXhwbGljaXRMYWI/Lm5hbWUpO1xyXG4gIGNvbnN0IGV4cGxpY2l0Q29kZSA9IG5vcm1hbGl6ZVRleHQoZXhwbGljaXRMYWI/LmNvZGUpO1xyXG4gIGNvbnN0IGV4cGxpY2l0SWQgPSBub3JtYWxpemVUZXh0KGV4cGxpY2l0TGFiPy5pZCk7XHJcbiAgaWYgKGV4cGxpY2l0TmFtZSB8fCBleHBsaWNpdENvZGUgfHwgZXhwbGljaXRJZCkge1xyXG4gICAgcmV0dXJuIGV4cGxpY2l0TGFiO1xyXG4gIH1cclxuICByZXR1cm4gcmVzb2x2ZUxhYlJlZih7XHJcbiAgICBjb2RlOiBjdXJyZW50VGFzaz8ubGFiQ29kZSxcclxuICAgIGRldmljZTogY3VycmVudFRhc2s/LmRldmljZSxcclxuICB9KTtcclxufTtcclxuY29uc3QgZ2V0TGFib3JhdG9yeU9wZXJhdGlvbkxvY2sgPSAoc2NoZWR1bGVSb3dzID0gW10sIGN1cnJlbnRUYXNrID0gbnVsbCwgbGFiID0gbnVsbCkgPT4ge1xyXG4gIGNvbnN0IGN1cnJlbnRLZXkgPSBsYWJvcmF0b3J5T3BlcmF0aW9uS2V5KGN1cnJlbnRUYXNrKTtcclxuICBjb25zdCBsYWJSZWYgPSByZXNvbHZlTGFib3JhdG9yeU9wZXJhdGlvbkxhYlJlZihjdXJyZW50VGFzaywgbGFiKTtcbiAgY29uc3QgaGFzTGFiU2NvcGUgPSBCb29sZWFuKG5vcm1hbGl6ZVRleHQobGFiUmVmPy5uYW1lKSB8fCBub3JtYWxpemVUZXh0KGxhYlJlZj8uY29kZSkgfHwgbm9ybWFsaXplVGV4dChsYWJSZWY/LmlkKSk7XG4gIGNvbnN0IGxvY2tlZFJvdyA9IGFzQXJyYXkoc2NoZWR1bGVSb3dzKS5maW5kKChyb3cpID0+IHtcbiAgICBjb25zdCByb3dLZXkgPSBsYWJvcmF0b3J5T3BlcmF0aW9uS2V5KHJvdyk7XG4gICAgY29uc3Qgc2FtZUxhYm9yYXRvcnkgPSBoYXNMYWJTY29wZSAmJiBzY2hlZHVsZU1hdGNoZXNMYWIocm93LCBsYWJSZWYpO1xuICAgIGNvbnN0IHNoYXJlZFRyYXkgPSBsYWJvcmF0b3J5Um93c1NoYXJlVHJheShyb3csIGN1cnJlbnRUYXNrKTtcbiAgICBjb25zdCBtYXRjaGVzT3BlcmF0aW9uU2NvcGUgPVxuICAgICAgKCFoYXNMYWJTY29wZSAmJiAhY3VycmVudFRhc2spXG4gICAgICB8fCBzYW1lTGFib3JhdG9yeVxuICAgICAgfHwgc2hhcmVkVHJheTtcbiAgICByZXR1cm4gKCFjdXJyZW50S2V5IHx8IHJvd0tleSAhPT0gY3VycmVudEtleSlcbiAgICAgICYmIG1hdGNoZXNPcGVyYXRpb25TY29wZVxuICAgICAgJiYgbGFib3JhdG9yeVJvd0hhc1N0YXJ0ZWRPcGVyYXRpb24ocm93KTtcbiAgfSk7XG4gIGlmICghbG9ja2VkUm93KSB7XG4gICAgcmV0dXJuIHsgYWN0aXZlOiBmYWxzZSB9O1xuICB9XG4gIGNvbnN0IHNhbWVMYWJvcmF0b3J5ID0gaGFzTGFiU2NvcGUgJiYgc2NoZWR1bGVNYXRjaGVzTGFiKGxvY2tlZFJvdywgbGFiUmVmKTtcbiAgY29uc3Qgc2hhcmVkVHJheSA9IGxhYm9yYXRvcnlSb3dzU2hhcmVUcmF5KGxvY2tlZFJvdywgY3VycmVudFRhc2spO1xuICByZXR1cm4ge1xuICAgIGFjdGl2ZTogdHJ1ZSxcbiAgICBleHBlcmltZW50S2V5OiBsYWJvcmF0b3J5T3BlcmF0aW9uS2V5KGxvY2tlZFJvdyksXG4gICAgZXhwZXJpbWVudE5hbWU6IG5vcm1hbGl6ZVRleHQobG9ja2VkUm93Py5leHBlcmltZW50TmFtZSksXG4gICAgc2FtZUxhYm9yYXRvcnksXG4gICAgc2hhcmVkVHJheSxcbiAgICB0YXNrQ29kZTogbm9ybWFsaXplVGV4dChsb2NrZWRSb3c/LnRhc2tDb2RlKSxcbiAgfTtcbn07XG5cclxuY29uc3QgaXNQcmV2aW91c0V4cGVyaW1lbnRDb21wbGV0aW9uRm9yQ3VycmVudFRhc2sgPSAocm93LCBjdXJyZW50VGFzaykgPT4ge1xyXG4gIGNvbnN0IHRyYXlTdGF0dXMgPSBub3JtYWxpemVUZXh0KHJvdz8udHJheVN0YXR1cykgfHwgbm9ybWFsaXplVGV4dChyb3c/LmRpc3BsYXlTdGF0dXMpO1xyXG4gIGNvbnN0IGN1cnJlbnRFeHBlcmltZW50U3RhdHVzID0gbm9ybWFsaXplVGV4dChjdXJyZW50VGFzaz8uc3RhdHVzKTtcclxuICBjb25zdCBoYXNTY29wZWRPdGhlckV4cGVyaW1lbnRDb21wbGV0aW9uID0gcm93Py5jb21wbGV0ZWRGb3JPdGhlckV4cGVyaW1lbnQgPT09IHRydWU7XHJcbiAgcmV0dXJuIChcclxuICAgIENPTVBMRVRFRF9FWFBFUklNRU5UX1NUQVRVU0VTLmhhcyh0cmF5U3RhdHVzKVxyXG4gICAgJiYgcm93Py5jb21wbGV0ZWRGb3JDdXJyZW50RXhwZXJpbWVudCAhPT0gdHJ1ZVxyXG4gICAgJiYgIUNPTVBMRVRFRF9FWFBFUklNRU5UX1NUQVRVU0VTLmhhcyhjdXJyZW50RXhwZXJpbWVudFN0YXR1cylcclxuICAgICYmIG5vcm1hbGl6ZVRleHQoY3VycmVudFRhc2s/LmV4cGVyaW1lbnRDb2RlKVxyXG4gICAgJiYgYXNBcnJheShyb3c/LmV4cGVyaW1lbnRDb2RlcykubGVuZ3RoID4gMVxyXG4gICAgJiYgaGFzU2NvcGVkT3RoZXJFeHBlcmltZW50Q29tcGxldGlvblxyXG4gICk7XHJcbn07XHJcblxyXG5jb25zdCB0cmF5SXNDb21wbGV0ZWRGb3JDdXJyZW50RXhwZXJpbWVudCA9IChyb3csIGN1cnJlbnRUYXNrKSA9PiB7XHJcbiAgY29uc3QgdHJheVN0YXR1cyA9IG5vcm1hbGl6ZVRleHQocm93Py50cmF5U3RhdHVzKSB8fCBub3JtYWxpemVUZXh0KHJvdz8uZGlzcGxheVN0YXR1cyk7XHJcbiAgcmV0dXJuIENPTVBMRVRFRF9FWFBFUklNRU5UX1NUQVRVU0VTLmhhcyh0cmF5U3RhdHVzKSAmJiAhaXNQcmV2aW91c0V4cGVyaW1lbnRDb21wbGV0aW9uRm9yQ3VycmVudFRhc2socm93LCBjdXJyZW50VGFzayk7XHJcbn07XHJcblxyXG5jb25zdCB0cmF5SGFzQWN0aXZlUnVuRm9yQ3VycmVudEV4cGVyaW1lbnQgPSAocm93LCBjdXJyZW50VGFzaykgPT4ge1xyXG4gIGlmICghbm9ybWFsaXplVGV4dChjdXJyZW50VGFzaz8ucnVuTm8pKSB7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG4gIGNvbnN0IGFjdGl2ZVJ1blRyYXlDb2RlcyA9IGFzQXJyYXkoY3VycmVudFRhc2s/LmFjdGl2ZVJ1blRyYXlDb2RlcykubWFwKCh0cmF5Q29kZSkgPT4gbm9ybWFsaXplVGV4dCh0cmF5Q29kZSkpLmZpbHRlcihCb29sZWFuKTtcclxuICBpZiAoIWFjdGl2ZVJ1blRyYXlDb2Rlcy5sZW5ndGgpIHtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH1cclxuICByZXR1cm4gYWN0aXZlUnVuVHJheUNvZGVzLmluY2x1ZGVzKG5vcm1hbGl6ZVRleHQocm93Py50cmF5Q29kZSkpO1xyXG59O1xyXG5cclxuY29uc3Qgcm93SGFzUnVubmluZ1N0YXR1cyA9IChyb3cpID0+IFJVTk5JTkdfRVhQRVJJTUVOVF9TVEFUVVNFUy5oYXMobm9ybWFsaXplVGV4dChyb3c/LnRyYXlTdGF0dXMpIHx8IG5vcm1hbGl6ZVRleHQocm93Py5kaXNwbGF5U3RhdHVzKSk7XHJcbmNvbnN0IHJvd0hhc1JldHVybmVkU3RhdHVzID0gKHJvdykgPT5cclxuICBub3JtYWxpemVUZXh0KHJvdz8udHJheVN0YXR1cykgPT09IFwi5Y6C5a625pS25ZueXCJcclxuICB8fCBub3JtYWxpemVUZXh0KHJvdz8uZGlzcGxheVN0YXR1cykgPT09IFwi5Y6C5a625pS25ZueXCJcclxuICB8fCBub3JtYWxpemVUZXh0KHJvdz8ubGlmZWN5Y2xlU3RhdHVzKSA9PT0gXCLljoLlrrbmlLblm55cIjtcclxuXHJcbmNvbnN0IGdldFJ1bm5pbmdUcmF5Um93c0ZvckN1cnJlbnRUYXNrID0gKGN1cnJlbnRUYXNrKSA9PiB7XHJcbiAgY29uc3QgcnVubmluZ1RyYXlSb3dzID0gYXNBcnJheShjdXJyZW50VGFzaz8udHJheVJvd3MpLmZpbHRlcigocm93KSA9PiByb3dIYXNSdW5uaW5nU3RhdHVzKHJvdykpO1xyXG4gIGlmICghbm9ybWFsaXplVGV4dChjdXJyZW50VGFzaz8ucnVuTm8pKSB7XHJcbiAgICByZXR1cm4gW107XHJcbiAgfVxyXG4gIHJldHVybiBydW5uaW5nVHJheVJvd3MuZmlsdGVyKChyb3cpID0+IHRyYXlIYXNBY3RpdmVSdW5Gb3JDdXJyZW50RXhwZXJpbWVudChyb3csIGN1cnJlbnRUYXNrKSk7XHJcbn07XHJcblxyXG5jb25zdCByZXNvbHZlQ3VycmVudFdvcmtmbG93VHJheVJhbmsgPSAocm93LCBjdXJyZW50VGFzaykgPT4ge1xyXG4gIGlmIChpc1ByZXZpb3VzRXhwZXJpbWVudENvbXBsZXRpb25Gb3JDdXJyZW50VGFzayhyb3csIGN1cnJlbnRUYXNrKSkge1xyXG4gICAgcmV0dXJuIDA7XHJcbiAgfVxyXG4gIGlmIChyb3dIYXNSdW5uaW5nU3RhdHVzKHJvdykgJiYgbm9ybWFsaXplVGV4dChjdXJyZW50VGFzaz8ucnVuTm8pICYmICF0cmF5SGFzQWN0aXZlUnVuRm9yQ3VycmVudEV4cGVyaW1lbnQocm93LCBjdXJyZW50VGFzaykpIHtcclxuICAgIHJldHVybiAwO1xyXG4gIH1cclxuICByZXR1cm4gcmVzb2x2ZUxhYm9yYXRvcnlTdGF0dXNSYW5rKHJvdz8udHJheVN0YXR1cyk7XHJcbn07XHJcblxyXG5jb25zdCByZXNvbHZlU2VsZWN0ZWRUcmF5Rmxvd1N0YXR1cyA9IChyb3csIGN1cnJlbnRUYXNrKSA9PiB7XHJcbiAgY29uc3QgbGlmZWN5Y2xlU3RhdHVzID0gbm9ybWFsaXplVGV4dChyb3c/LmxpZmVjeWNsZVN0YXR1cyk7XHJcbiAgY29uc3QgZGlzcGxheVN0YXR1cyA9IG5vcm1hbGl6ZVRleHQocm93Py5kaXNwbGF5U3RhdHVzKTtcclxuICBjb25zdCB0cmF5U3RhdHVzID0gbm9ybWFsaXplVGV4dChyb3c/LnRyYXlTdGF0dXMpO1xyXG4gIGlmIChSVU5OSU5HX0VYUEVSSU1FTlRfU1RBVFVTRVMuaGFzKGxpZmVjeWNsZVN0YXR1cykgJiYgIXRyYXlIYXNBY3RpdmVSdW5Gb3JDdXJyZW50RXhwZXJpbWVudChyb3csIGN1cnJlbnRUYXNrKSkge1xyXG4gICAgcmV0dXJuIGRpc3BsYXlTdGF0dXMgfHwgdHJheVN0YXR1cyB8fCBsaWZlY3ljbGVTdGF0dXM7XHJcbiAgfVxyXG4gIHJldHVybiBsaWZlY3ljbGVTdGF0dXMgfHwgZGlzcGxheVN0YXR1cyB8fCB0cmF5U3RhdHVzO1xyXG59O1xyXG5cclxuY29uc3QgdHJheUhhc0N1cnJlbnRFeHBlcmltZW50Rmxvd0NvbnRleHQgPSAocm93LCBjdXJyZW50VGFzaykgPT4ge1xyXG4gIGlmICghcm93IHx8ICFjdXJyZW50VGFzaykge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuICBjb25zdCBjdXJyZW50RXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy5leHBlcmltZW50Q29kZSk7XHJcbiAgY29uc3QgdGFyZ2V0RXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KHJvdz8udGFyZ2V0RXhwZXJpbWVudENvZGUgfHwgcm93Py50YXJnZXRfZXhwZXJpbWVudF9jb2RlKTtcclxuICBpZiAodGFyZ2V0RXhwZXJpbWVudENvZGUpIHtcclxuICAgIHJldHVybiAhY3VycmVudEV4cGVyaW1lbnRDb2RlIHx8IHRhcmdldEV4cGVyaW1lbnRDb2RlID09PSBjdXJyZW50RXhwZXJpbWVudENvZGU7XHJcbiAgfVxyXG4gIGlmIChyb3c/LmNvbXBsZXRlZEZvckN1cnJlbnRFeHBlcmltZW50ID09PSB0cnVlIHx8IHRyYXlIYXNBY3RpdmVSdW5Gb3JDdXJyZW50RXhwZXJpbWVudChyb3csIGN1cnJlbnRUYXNrKSkge1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG4gIGNvbnN0IHRyYXlTdGF0dXMgPSBub3JtYWxpemVUZXh0KHJvdz8udHJheVN0YXR1cykgfHwgbm9ybWFsaXplVGV4dChyb3c/LmRpc3BsYXlTdGF0dXMpO1xyXG4gIGNvbnN0IHRyYXlTdGF0dXNSYW5rID0gcmVzb2x2ZUxhYm9yYXRvcnlTdGF0dXNSYW5rKHRyYXlTdGF0dXMpO1xyXG4gIGlmICh0cmF5U3RhdHVzUmFuayA+IDAgJiYgdHJheVN0YXR1c1JhbmsgPCA1ICYmICFpc1ByZXZpb3VzRXhwZXJpbWVudENvbXBsZXRpb25Gb3JDdXJyZW50VGFzayhyb3csIGN1cnJlbnRUYXNrKSkge1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG4gIGNvbnN0IGxpZmVjeWNsZVN0YXR1cyA9IG5vcm1hbGl6ZUxpZmVjeWNsZVN0YXR1cyhcclxuICAgIG5vcm1hbGl6ZVRleHQocm93Py5saWZlY3ljbGVMb2NhdGlvbikgfHwgbm9ybWFsaXplVGV4dChyb3c/LmN1cnJlbnRMb2NhdGlvbiksXHJcbiAgICBub3JtYWxpemVUZXh0KHJvdz8ubGlmZWN5Y2xlU3RhdHVzKSxcclxuICApO1xyXG4gIGlmIChcclxuICAgIENPTVBMRVRFRF9UUkFZX1NUQVRVU0VTLmhhcyhsaWZlY3ljbGVTdGF0dXMpXHJcbiAgICAmJiByb3c/LmNvbXBsZXRlZEZvck90aGVyRXhwZXJpbWVudCA9PT0gdHJ1ZVxyXG4gICAgJiYgcm93Py5jb21wbGV0ZWRGb3JDdXJyZW50RXhwZXJpbWVudCAhPT0gdHJ1ZVxyXG4gICkge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuICBpZiAoXHJcbiAgICByb3c/LmNvbXBsZXRlZEZvck90aGVyRXhwZXJpbWVudCA9PT0gdHJ1ZVxyXG4gICAgJiYgcm93Py5jb21wbGV0ZWRGb3JDdXJyZW50RXhwZXJpbWVudCAhPT0gdHJ1ZVxyXG4gICAgJiYgcm93Py5oYXNDdXJyZW50RXhwZXJpbWVudEhpc3RvcnkgIT09IHRydWVcclxuICApIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcbiAgY29uc3QgdGFyZ2V0TGFiID0gbm9ybWFsaXplVGV4dChyb3c/LnRhcmdldExhYiB8fCByb3c/LnRhcmdldF9sYWIpO1xyXG4gIGNvbnN0IGN1cnJlbnRMYWIgPSBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy5kZXZpY2UpO1xyXG4gIGlmICh0cmF5U3RhdHVzID09PSBMQUJfUkVTRVRfU1RBVFVTICYmIHRhcmdldExhYiAmJiBjdXJyZW50TGFiICYmIHRhcmdldExhYiA9PT0gY3VycmVudExhYikge1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG4gIHJldHVybiB0cmF5U3RhdHVzUmFuayA+IDAgJiYgdHJheVN0YXR1c1JhbmsgPCA1ICYmICFpc1ByZXZpb3VzRXhwZXJpbWVudENvbXBsZXRpb25Gb3JDdXJyZW50VGFzayhyb3csIGN1cnJlbnRUYXNrKTtcclxufTtcclxuXHJcbmNvbnN0IGJ1aWxkUnVubmluZ0V4cGVyaW1lbnRWaWV3ID0gKHsgY3VycmVudFRhc2ssIG5vdyB9KSA9PiB7XHJcbiAgY29uc3QgcnVubmluZ1RyYXlSb3dzID0gZ2V0UnVubmluZ1RyYXlSb3dzRm9yQ3VycmVudFRhc2soY3VycmVudFRhc2spO1xyXG4gIGlmICghY3VycmVudFRhc2sgfHwgIXJ1bm5pbmdUcmF5Um93cy5sZW5ndGgpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGFjdGl2ZTogZmFsc2UsXHJcbiAgICAgIGNvdW50ZG93bkxhYmVsOiBcIlwiLFxyXG4gICAgICBlbmREYXRlVGltZUxhYmVsOiBcIi1cIixcclxuICAgICAgZW5kVGltZTogbnVsbCxcclxuICAgICAgZXhwZXJpbWVudE5hbWU6IFwiXCIsXHJcbiAgICAgIG92ZXJkdWU6IGZhbHNlLFxyXG4gICAgICBvdmVyZHVlTGFiZWw6IFwiXCIsXHJcbiAgICAgIHJlbWFpbmluZ1NlY29uZHM6IDAsXHJcbiAgICAgIHNhbXBsZUNvZGVzOiBbXSxcclxuICAgICAgc3RhcnREYXRlVGltZUxhYmVsOiBcIi1cIixcclxuICAgICAgc3RhcnRUaW1lOiBudWxsLFxyXG4gICAgICB0YXNrQ29kZTogXCJcIixcclxuICAgICAgdHJheUNvZGVzOiBbXSxcclxuICAgICAgdHJheVJvd3M6IFtdLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIGNvbnN0IG5vd1RpbWUgPSBub3cgaW5zdGFuY2VvZiBEYXRlID8gbm93LmdldFRpbWUoKSA6IHRvVGltZShub3cpO1xyXG4gIGNvbnN0IHN0YXJ0VGltZSA9IHRvVGltZShjdXJyZW50VGFzaz8uc3RhcnRBdCk7XHJcbiAgY29uc3QgZW5kVGltZSA9IHRvVGltZShjdXJyZW50VGFzaz8uZW5kQXQpO1xyXG4gIGNvbnN0IHJlbWFpbmluZ1NlY29uZHMgPSBOdW1iZXIuaXNGaW5pdGUoZW5kVGltZSkgJiYgTnVtYmVyLmlzRmluaXRlKG5vd1RpbWUpID8gTWF0aC5mbG9vcigoZW5kVGltZSAtIG5vd1RpbWUpIC8gMTAwMCkgOiAwO1xyXG4gIGNvbnN0IG92ZXJkdWVTZWNvbmRzID0gcmVtYWluaW5nU2Vjb25kcyA8IDAgPyBNYXRoLmFicyhyZW1haW5pbmdTZWNvbmRzKSA6IDA7XHJcblxyXG4gIHJldHVybiB7XHJcbiAgICBhY3RpdmU6IHRydWUsXHJcbiAgICBjb3VudGRvd25MYWJlbDogcmVtYWluaW5nU2Vjb25kcyA+PSAwID8gZm9ybWF0RHVyYXRpb24ocmVtYWluaW5nU2Vjb25kcykgOiBg5bey6LaF5pe2ICR7Zm9ybWF0RHVyYXRpb24ob3ZlcmR1ZVNlY29uZHMpfWAsXHJcbiAgICBlbmREYXRlVGltZUxhYmVsOiBmb3JtYXREYXRlVGltZShjdXJyZW50VGFzaz8uZW5kQXQpLFxyXG4gICAgZW5kVGltZSxcclxuICAgIGV4cGVyaW1lbnROYW1lOiBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy5leHBlcmltZW50TmFtZSksXHJcbiAgICBvdmVyZHVlOiByZW1haW5pbmdTZWNvbmRzIDwgMCxcclxuICAgIG92ZXJkdWVMYWJlbDogb3ZlcmR1ZVNlY29uZHMgPyBmb3JtYXREdXJhdGlvbihvdmVyZHVlU2Vjb25kcykgOiBcIlwiLFxyXG4gICAgcmVtYWluaW5nU2Vjb25kcyxcclxuICAgIHJ1bk5vOiBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy5ydW5ObyksXG4gICAgc2FtcGxlQ29kZXM6IHVuaXF1ZVZhbHVlcyhydW5uaW5nVHJheVJvd3MuZmxhdE1hcCgocm93KSA9PiBhc0FycmF5KHJvdz8uc2FtcGxlQ29kZXMpKSksXG4gICAgc3RhcnREYXRlVGltZUxhYmVsOiBmb3JtYXREYXRlVGltZShjdXJyZW50VGFzaz8uc3RhcnRBdCksXHJcbiAgICBzdGFydFRpbWUsXG4gICAgc3ViRXhwZXJpbWVudENvZGU6IHJlc29sdmVTdWJFeHBlcmltZW50Q29kZShjdXJyZW50VGFzayksXG4gICAgc3ViX2V4cGVyaW1lbnRfY29kZTogcmVzb2x2ZVN1YkV4cGVyaW1lbnRDb2RlKGN1cnJlbnRUYXNrKSxcbiAgICB0YXNrQ29kZTogbm9ybWFsaXplVGV4dChjdXJyZW50VGFzaz8udGFza0NvZGUpLFxuICAgIHRyYXlDb2RlczogcnVubmluZ1RyYXlSb3dzLm1hcCgocm93KSA9PiByb3cudHJheUNvZGUpLFxuICAgIHRyYXlSb3dzOiBydW5uaW5nVHJheVJvd3MsXG4gIH07XHJcbn07XHJcblxyXG5jb25zdCBidWlsZEV4cGVyaW1lbnRUcmF5Q29kZU1hcCA9IChleHBlcmltZW50VHJheXMpID0+IHtcclxuICBjb25zdCB0cmF5TWFwID0gbmV3IE1hcCgpO1xyXG4gIGFzQXJyYXkoZXhwZXJpbWVudFRyYXlzKS5mb3JFYWNoKChlbnRyeSkgPT4ge1xyXG4gICAgY29uc3QgdGFza0NvZGUgPSBub3JtYWxpemVUZXh0KGVudHJ5Py50YXNrX2NvZGUpO1xyXG4gICAgY29uc3QgZXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KGVudHJ5Py5leHBlcmltZW50X2NvZGUpO1xyXG4gICAgY29uc3QgdHJheUNvZGUgPSBub3JtYWxpemVUZXh0KGVudHJ5Py50cmF5X2NvZGUpO1xyXG4gICAgaWYgKCF0YXNrQ29kZSB8fCAhZXhwZXJpbWVudENvZGUgfHwgIXRyYXlDb2RlKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IGtleSA9IGAke3Rhc2tDb2RlfTo6JHtleHBlcmltZW50Q29kZX1gO1xyXG4gICAgY29uc3QgY3VycmVudCA9IHRyYXlNYXAuZ2V0KGtleSkgfHwgW107XHJcbiAgICBpZiAoIWN1cnJlbnQuaW5jbHVkZXModHJheUNvZGUpKSB7XHJcbiAgICAgIGN1cnJlbnQucHVzaCh0cmF5Q29kZSk7XHJcbiAgICB9XHJcbiAgICB0cmF5TWFwLnNldChrZXksIGN1cnJlbnQpO1xyXG4gIH0pO1xyXG4gIHJldHVybiB0cmF5TWFwO1xyXG59O1xyXG5cclxuY29uc3QgYnVpbGRFeHBlcmltZW50Q29kZXNCeVRyYXlDb2RlID0gKGV4cGVyaW1lbnRUcmF5Q29kZU1hcCkgPT4ge1xyXG4gIGNvbnN0IHRyYXlNYXAgPSBuZXcgTWFwKCk7XHJcbiAgZXhwZXJpbWVudFRyYXlDb2RlTWFwLmZvckVhY2goKHRyYXlDb2RlcywgZXhwZXJpbWVudEtleSkgPT4ge1xyXG4gICAgY29uc3QgZXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KFN0cmluZyhleHBlcmltZW50S2V5KS5zcGxpdChcIjo6XCIpWzFdKTtcclxuICAgIGlmICghZXhwZXJpbWVudENvZGUpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgYXNBcnJheSh0cmF5Q29kZXMpLmZvckVhY2goKHRyYXlDb2RlKSA9PiB7XHJcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRUcmF5Q29kZSA9IG5vcm1hbGl6ZVRleHQodHJheUNvZGUpO1xyXG4gICAgICBpZiAoIW5vcm1hbGl6ZWRUcmF5Q29kZSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCBjdXJyZW50ID0gdHJheU1hcC5nZXQobm9ybWFsaXplZFRyYXlDb2RlKSB8fCBbXTtcclxuICAgICAgaWYgKCFjdXJyZW50LmluY2x1ZGVzKGV4cGVyaW1lbnRDb2RlKSkge1xyXG4gICAgICAgIGN1cnJlbnQucHVzaChleHBlcmltZW50Q29kZSk7XHJcbiAgICAgIH1cclxuICAgICAgdHJheU1hcC5zZXQobm9ybWFsaXplZFRyYXlDb2RlLCBjdXJyZW50KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIHJldHVybiB0cmF5TWFwO1xyXG59O1xyXG5cclxuY29uc3QgUlVOTklOR19FWFBFUklNRU5UX1JVTl9TVEFUVVNFUyA9IG5ldyBTZXQoW1wi5a6e6aqM6L+b6KGM5LitXCIsIFwi5a6e6aqM5LitXCJdKTtcclxuY29uc3QgcmVzb2x2ZVJ1bk5vID0gKHJ1bikgPT4gbm9ybWFsaXplVGV4dChydW4/LnJ1bl9ubyB8fCBydW4/LnJ1bk5vIHx8IHJ1bj8uaWQpO1xyXG5jb25zdCByZXNvbHZlUnVuVGFza0NvZGUgPSAocnVuKSA9PiBub3JtYWxpemVUZXh0KHJ1bj8udGFza19jb2RlIHx8IHJ1bj8udGFza0NvZGUgfHwgcnVuPy50YXNrX25vIHx8IHJ1bj8udGFza05vKTtcclxuY29uc3QgcmVzb2x2ZVJ1bkV4cGVyaW1lbnRDb2RlID0gKHJ1bikgPT5cbiAgbm9ybWFsaXplVGV4dChydW4/LmV4cGVyaW1lbnRfY29kZSB8fCBydW4/LmV4cGVyaW1lbnRDb2RlIHx8IHJ1bj8uZXhwZXJpbWVudF9ubyB8fCBydW4/LmV4cGVyaW1lbnRObyk7XG5jb25zdCByZXNvbHZlUnVuRGV2aWNlID0gKHJ1bikgPT4gbm9ybWFsaXplVGV4dChydW4/LmRldmljZSB8fCBydW4/LmRldmljZV9uYW1lIHx8IHJ1bj8uZGV2aWNlTmFtZSB8fCBydW4/LmxhYl9uYW1lIHx8IHJ1bj8ubGFiTmFtZSk7XG5jb25zdCByZXNvbHZlUnVuU2NoZWR1bGVJZCA9IChydW4pID0+IG5vcm1hbGl6ZVRleHQocnVuPy5zY2hlZHVsZV9pZCB8fCBydW4/LnNjaGVkdWxlSWQpO1xuY29uc3QgcmVzb2x2ZVJ1blN0YXR1cyA9IChydW4pID0+IG5vcm1hbGl6ZVRleHQocnVuPy5zdGF0dXMgfHwgcnVuPy5ydW5fc3RhdHVzIHx8IHJ1bj8ucnVuU3RhdHVzKTtcbmNvbnN0IHJlc29sdmVSZWxhdGlvblJ1bk5vID0gKHJlbGF0aW9uKSA9PiBub3JtYWxpemVUZXh0KHJlbGF0aW9uPy5ydW5fbm8gfHwgcmVsYXRpb24/LnJ1bk5vKTtcbmNvbnN0IHJlc29sdmVSZWxhdGlvblRhc2tDb2RlID0gKHJlbGF0aW9uKSA9PiBub3JtYWxpemVUZXh0KHJlbGF0aW9uPy50YXNrX2NvZGUgfHwgcmVsYXRpb24/LnRhc2tDb2RlIHx8IHJlbGF0aW9uPy50YXNrX25vIHx8IHJlbGF0aW9uPy50YXNrTm8pO1xuY29uc3QgcmVzb2x2ZVJlbGF0aW9uRXhwZXJpbWVudENvZGUgPSAocmVsYXRpb24pID0+XG4gIG5vcm1hbGl6ZVRleHQocmVsYXRpb24/LmV4cGVyaW1lbnRfY29kZSB8fCByZWxhdGlvbj8uZXhwZXJpbWVudENvZGUgfHwgcmVsYXRpb24/LmV4cGVyaW1lbnRfbm8gfHwgcmVsYXRpb24/LmV4cGVyaW1lbnRObyk7XG5jb25zdCByZXNvbHZlUmVsYXRpb25UcmF5Q29kZSA9IChyZWxhdGlvbikgPT4gbm9ybWFsaXplVGV4dChyZWxhdGlvbj8udHJheV9jb2RlIHx8IHJlbGF0aW9uPy50cmF5Q29kZSB8fCByZWxhdGlvbj8udHJheV9ubyB8fCByZWxhdGlvbj8udHJheU5vKTtcclxuY29uc3QgcmVzb2x2ZVJlbGF0aW9uU3RhdHVzID0gKHJlbGF0aW9uKSA9PiBub3JtYWxpemVUZXh0KHJlbGF0aW9uPy5ydW5fdHJheV9zdGF0dXMgfHwgcmVsYXRpb24/LnJ1blRyYXlTdGF0dXMgfHwgcmVsYXRpb24/LnN0YXR1cyk7XHJcbmNvbnN0IHJlbGF0aW9uSXNDb21wbGV0ZWQgPSAocmVsYXRpb24pID0+XG4gIEVYUEVSSU1FTlRfVFJBWV9URVJNSU5BTF9TVEFUVVNFUy5oYXMobm9ybWFsaXplVGV4dChyZWxhdGlvbj8uc3RhdHVzKSlcbiAgfHwgRVhQRVJJTUVOVF9UUkFZX1RFUk1JTkFMX1NUQVRVU0VTLmhhcyhub3JtYWxpemVUZXh0KHJlbGF0aW9uPy5ydW5fdHJheV9zdGF0dXMpKVxuICB8fCBFWFBFUklNRU5UX1RSQVlfVEVSTUlOQUxfU1RBVFVTRVMuaGFzKG5vcm1hbGl6ZVRleHQocmVsYXRpb24/LnJ1blRyYXlTdGF0dXMpKTtcblxuY29uc3QgYnVpbGRDb21wbGV0ZWRTY2hlZHVsZVRyYXlDb2RlU2V0ID0gKHsgZXhwZXJpbWVudFJ1bnMgPSBbXSwgZXhwZXJpbWVudFJ1blRyYXlzID0gW10sIHNjaGVkdWxlID0gbnVsbCB9KSA9PiB7XG4gIGNvbnN0IHRhc2tDb2RlID0gbm9ybWFsaXplVGV4dChzY2hlZHVsZT8udGFza19jb2RlKTtcbiAgY29uc3QgZXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KHNjaGVkdWxlPy5leHBlcmltZW50X2NvZGUpO1xuICBjb25zdCBzY2hlZHVsZUlkID0gbm9ybWFsaXplVGV4dChzY2hlZHVsZT8uaWQgfHwgc2NoZWR1bGU/LnNjaGVkdWxlX2lkIHx8IHNjaGVkdWxlPy5zY2hlZHVsZUlkKTtcbiAgY29uc3Qgc3ViRXhwZXJpbWVudENvZGUgPSByZXNvbHZlU3ViRXhwZXJpbWVudENvZGUoc2NoZWR1bGUpO1xuICBpZiAoIXRhc2tDb2RlIHx8ICFleHBlcmltZW50Q29kZSB8fCAoIXNjaGVkdWxlSWQgJiYgIXN1YkV4cGVyaW1lbnRDb2RlKSkge1xuICAgIHJldHVybiBuZXcgU2V0KCk7XG4gIH1cbiAgY29uc3QgcnVuQnlObyA9IG5ldyBNYXAoXG4gICAgYXNBcnJheShleHBlcmltZW50UnVucylcbiAgICAgIC5tYXAoKHJ1bikgPT4gW3Jlc29sdmVSdW5ObyhydW4pLCBydW5dKVxuICAgICAgLmZpbHRlcigoW3J1bk5vXSkgPT4gQm9vbGVhbihydW5ObykpLFxuICApO1xuICByZXR1cm4gbmV3IFNldChcbiAgICBhc0FycmF5KGV4cGVyaW1lbnRSdW5UcmF5cylcbiAgICAgIC5maWx0ZXIoKHJlbGF0aW9uKSA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICByZXNvbHZlUmVsYXRpb25UYXNrQ29kZShyZWxhdGlvbikgIT09IHRhc2tDb2RlXG4gICAgICAgICAgfHwgcmVzb2x2ZVJlbGF0aW9uRXhwZXJpbWVudENvZGUocmVsYXRpb24pICE9PSBleHBlcmltZW50Q29kZVxuICAgICAgICAgIHx8ICFyZWxhdGlvbklzQ29tcGxldGVkKHJlbGF0aW9uKVxuICAgICAgICApIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN1YkV4cGVyaW1lbnRDb2RlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc29sdmVTdWJFeHBlcmltZW50Q29kZShyZWxhdGlvbikgPT09IHN1YkV4cGVyaW1lbnRDb2RlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uUnVuID0gcnVuQnlOby5nZXQocmVzb2x2ZVJlbGF0aW9uUnVuTm8ocmVsYXRpb24pKTtcbiAgICAgICAgcmV0dXJuIHNjaGVkdWxlSWQgJiYgcmVzb2x2ZVJ1blNjaGVkdWxlSWQocmVsYXRpb25SdW4pID09PSBzY2hlZHVsZUlkO1xuICAgICAgfSlcbiAgICAgIC5tYXAocmVzb2x2ZVJlbGF0aW9uVHJheUNvZGUpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pLFxuICApO1xufTtcbmNvbnN0IHN0ZXBBeGlzQ29kZSA9IChzdGVwKSA9PiBub3JtYWxpemVUZXh0KHN0ZXA/LmF4aXNfY29kZSB8fCBzdGVwPy5heGlzQ29kZSk7XG5jb25zdCBzdGVwUnVuTm8gPSAoc3RlcCkgPT4gbm9ybWFsaXplVGV4dChzdGVwPy5ydW5fbm8gfHwgc3RlcD8ucnVuTm8pO1xuY29uc3Qgc3RlcFRhc2tDb2RlID0gKHN0ZXApID0+IG5vcm1hbGl6ZVRleHQoc3RlcD8udGFza19jb2RlIHx8IHN0ZXA/LnRhc2tDb2RlIHx8IHN0ZXA/LnRhc2tfbm8gfHwgc3RlcD8udGFza05vKTtcbmNvbnN0IHN0ZXBFeHBlcmltZW50Q29kZSA9IChzdGVwKSA9PiBub3JtYWxpemVUZXh0KHN0ZXA/LmV4cGVyaW1lbnRfY29kZSB8fCBzdGVwPy5leHBlcmltZW50Q29kZSB8fCBzdGVwPy5leHBlcmltZW50X25vIHx8IHN0ZXA/LmV4cGVyaW1lbnRObyk7XG5jb25zdCBzdGVwU3ViRXhwZXJpbWVudENvZGUgPSAoc3RlcCkgPT5cbiAgbm9ybWFsaXplVGV4dChzdGVwPy5zdWJfZXhwZXJpbWVudF9jb2RlIHx8IHN0ZXA/LnN1YkV4cGVyaW1lbnRDb2RlIHx8IHN0ZXA/LnN1Yl9leHBlcmltZW50X25vIHx8IHN0ZXA/LnN1YkV4cGVyaW1lbnRObyk7XG5jb25zdCBzdGVwSXNDb21wbGV0ZWQgPSAoc3RlcCkgPT4gQ09NUExFVEVEX0VYUEVSSU1FTlRfU1RBVFVTRVMuaGFzKG5vcm1hbGl6ZVRleHQoc3RlcD8uc3RhdHVzIHx8IHN0ZXA/LnN0ZXBfc3RhdHVzIHx8IHN0ZXA/LnN0ZXBTdGF0dXMpKTtcblxuY29uc3QgYnVpbGRBeGlzUHJvZ3Jlc3NGb3JTY2hlZHVsZSA9ICh7IGV4cGVyaW1lbnQsIGV4cGVyaW1lbnRSdW5TdGVwcyA9IFtdLCBleHBlcmltZW50UnVucyA9IFtdLCBleHBlcmltZW50TmFtZSwgc2NoZWR1bGUgfSkgPT4ge1xuICBjb25zdCB0YXNrQ29kZSA9IG5vcm1hbGl6ZVRleHQoc2NoZWR1bGU/LnRhc2tfY29kZSk7XG4gIGNvbnN0IGV4cGVyaW1lbnRDb2RlID0gbm9ybWFsaXplVGV4dChzY2hlZHVsZT8uZXhwZXJpbWVudF9jb2RlKTtcbiAgY29uc3Qgc2NoZWR1bGVJZCA9IG5vcm1hbGl6ZVRleHQoc2NoZWR1bGU/LmlkIHx8IHNjaGVkdWxlPy5zY2hlZHVsZV9pZCB8fCBzY2hlZHVsZT8uc2NoZWR1bGVJZCk7XG4gIGNvbnN0IHN1YkV4cGVyaW1lbnRDb2RlID0gcmVzb2x2ZVN1YkV4cGVyaW1lbnRDb2RlKHNjaGVkdWxlKTtcbiAgY29uc3QgcmVxdWlyZWRBeGlzQ29kZXMgPSBub3JtYWxpemVBeGlzQ29kZXMoZXhwZXJpbWVudD8uYXhpc19jb2RlcyA/PyBleHBlcmltZW50Py5heGlzQ29kZXMpO1xuICBjb25zdCBzY2hlZHVsZWRBeGlzQ29kZXMgPSBub3JtYWxpemVBeGlzQ29kZXMoc2NoZWR1bGU/LmF4aXNfY29kZXMgPz8gc2NoZWR1bGU/LmF4aXNDb2Rlcyk7XG4gIGNvbnN0IHNjaGVkdWxlUnVuQXhpc0NvZGVzID0gdW5pcXVlVmFsdWVzKFxuICAgIGFzQXJyYXkoZXhwZXJpbWVudFJ1bnMpXG4gICAgICAuZmlsdGVyKChydW4pID0+XG4gICAgICAgIHJlc29sdmVSdW5UYXNrQ29kZShydW4pID09PSB0YXNrQ29kZVxuICAgICAgICAmJiByZXNvbHZlUnVuRXhwZXJpbWVudENvZGUocnVuKSA9PT0gZXhwZXJpbWVudENvZGVcbiAgICAgICAgJiYgc2NoZWR1bGVJZFxuICAgICAgICAmJiByZXNvbHZlUnVuU2NoZWR1bGVJZChydW4pID09PSBzY2hlZHVsZUlkLFxuICAgICAgKVxuICAgICAgLmZsYXRNYXAoKHJ1bikgPT4gbm9ybWFsaXplQXhpc0NvZGVzKHJ1bj8uYXhpc19jb2RlcyA/PyBydW4/LmF4aXNDb2RlcykpLFxuICApO1xuICBjb25zdCBheGlzQ29kZXMgPVxuICAgIHNjaGVkdWxlZEF4aXNDb2Rlcy5sZW5ndGggPiAwXG4gICAgICA/IHNjaGVkdWxlZEF4aXNDb2Rlc1xuICAgICAgOiBzY2hlZHVsZVJ1bkF4aXNDb2Rlcy5sZW5ndGggPiAwXG4gICAgICAgID8gc2NoZWR1bGVSdW5BeGlzQ29kZXNcbiAgICAgICAgOiByZXF1aXJlZEF4aXNDb2RlcztcbiAgaWYgKGF4aXNDb2Rlcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBydW5TY29wZXMgPSBuZXcgTWFwKFxuICAgIGFzQXJyYXkoZXhwZXJpbWVudFJ1bnMpXG4gICAgICAubWFwKChydW4pID0+IFtcbiAgICAgICAgcmVzb2x2ZVJ1bk5vKHJ1biksXG4gICAgICAgIHtcbiAgICAgICAgICBleHBlcmltZW50Q29kZTogcmVzb2x2ZVJ1bkV4cGVyaW1lbnRDb2RlKHJ1biksXG4gICAgICAgICAgc2NoZWR1bGVJZDogcmVzb2x2ZVJ1blNjaGVkdWxlSWQocnVuKSxcbiAgICAgICAgICBzdWJFeHBlcmltZW50Q29kZTogcmVzb2x2ZVN1YkV4cGVyaW1lbnRDb2RlKHJ1biksXG4gICAgICAgICAgdGFza0NvZGU6IHJlc29sdmVSdW5UYXNrQ29kZShydW4pLFxuICAgICAgICB9LFxuICAgICAgXSlcbiAgICAgIC5maWx0ZXIoKFtydW5Ob10pID0+IEJvb2xlYW4ocnVuTm8pKSxcbiAgKTtcbiAgY29uc3QgY29tcGxldGVkQXhpc0NvZGVzID0gYXhpc0NvZGVzLmZpbHRlcigoYXhpc0NvZGUpID0+XG4gICAgYXNBcnJheShleHBlcmltZW50UnVuU3RlcHMpLnNvbWUoKHN0ZXApID0+IHtcbiAgICAgIGlmICghc3RlcElzQ29tcGxldGVkKHN0ZXApIHx8IHN0ZXBBeGlzQ29kZShzdGVwKSAhPT0gYXhpc0NvZGUpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc3RlcFJ1blNjb3BlID0gcnVuU2NvcGVzLmdldChzdGVwUnVuTm8oc3RlcCkpO1xuICAgICAgaWYgKHNjaGVkdWxlSWQgJiYgc3RlcFJ1blNjb3BlPy5zY2hlZHVsZUlkICYmIHN0ZXBSdW5TY29wZS5zY2hlZHVsZUlkICE9PSBzY2hlZHVsZUlkKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmIChzdWJFeHBlcmltZW50Q29kZSAmJiBzdGVwU3ViRXhwZXJpbWVudENvZGUoc3RlcCkgJiYgc3RlcFN1YkV4cGVyaW1lbnRDb2RlKHN0ZXApICE9PSBzdWJFeHBlcmltZW50Q29kZSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoc3ViRXhwZXJpbWVudENvZGUgJiYgc3RlcFJ1blNjb3BlPy5zdWJFeHBlcmltZW50Q29kZSAmJiBzdGVwUnVuU2NvcGUuc3ViRXhwZXJpbWVudENvZGUgIT09IHN1YkV4cGVyaW1lbnRDb2RlKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRpcmVjdFRhc2tDb2RlID0gc3RlcFRhc2tDb2RlKHN0ZXApO1xuICAgICAgY29uc3QgZGlyZWN0RXhwZXJpbWVudENvZGUgPSBzdGVwRXhwZXJpbWVudENvZGUoc3RlcCk7XG4gICAgICBpZiAoZGlyZWN0VGFza0NvZGUgfHwgZGlyZWN0RXhwZXJpbWVudENvZGUpIHtcbiAgICAgICAgcmV0dXJuIGRpcmVjdFRhc2tDb2RlID09PSB0YXNrQ29kZSAmJiBkaXJlY3RFeHBlcmltZW50Q29kZSA9PT0gZXhwZXJpbWVudENvZGU7XG4gICAgICB9XG4gICAgICByZXR1cm4gc3RlcFJ1blNjb3BlPy50YXNrQ29kZSA9PT0gdGFza0NvZGUgJiYgc3RlcFJ1blNjb3BlPy5leHBlcmltZW50Q29kZSA9PT0gZXhwZXJpbWVudENvZGU7XG4gICAgfSksXG4gICk7XG4gIGNvbnN0IHRvdGFsQ29tcGxldGVkQXhpc0NvZGVzID0gcmVxdWlyZWRBeGlzQ29kZXMuZmlsdGVyKChheGlzQ29kZSkgPT5cbiAgICBhc0FycmF5KGV4cGVyaW1lbnRSdW5TdGVwcykuc29tZSgoc3RlcCkgPT4ge1xuICAgICAgaWYgKCFzdGVwSXNDb21wbGV0ZWQoc3RlcCkgfHwgc3RlcEF4aXNDb2RlKHN0ZXApICE9PSBheGlzQ29kZSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb25zdCBkaXJlY3RUYXNrQ29kZSA9IHN0ZXBUYXNrQ29kZShzdGVwKTtcbiAgICAgIGNvbnN0IGRpcmVjdEV4cGVyaW1lbnRDb2RlID0gc3RlcEV4cGVyaW1lbnRDb2RlKHN0ZXApO1xuICAgICAgaWYgKGRpcmVjdFRhc2tDb2RlIHx8IGRpcmVjdEV4cGVyaW1lbnRDb2RlKSB7XG4gICAgICAgIHJldHVybiBkaXJlY3RUYXNrQ29kZSA9PT0gdGFza0NvZGUgJiYgZGlyZWN0RXhwZXJpbWVudENvZGUgPT09IGV4cGVyaW1lbnRDb2RlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc3RlcFJ1blNjb3BlID0gcnVuU2NvcGVzLmdldChzdGVwUnVuTm8oc3RlcCkpO1xuICAgICAgcmV0dXJuIHN0ZXBSdW5TY29wZT8udGFza0NvZGUgPT09IHRhc2tDb2RlICYmIHN0ZXBSdW5TY29wZT8uZXhwZXJpbWVudENvZGUgPT09IGV4cGVyaW1lbnRDb2RlO1xuICAgIH0pLFxuICApO1xuICBjb25zdCByZW1haW5pbmdBeGlzQ29kZXMgPSBheGlzQ29kZXMuZmlsdGVyKChheGlzQ29kZSkgPT4gIWNvbXBsZXRlZEF4aXNDb2Rlcy5pbmNsdWRlcyhheGlzQ29kZSkpO1xuICBjb25zdCB0b3RhbFJlbWFpbmluZ0F4aXNDb2RlcyA9IHJlcXVpcmVkQXhpc0NvZGVzLmZpbHRlcigoYXhpc0NvZGUpID0+ICF0b3RhbENvbXBsZXRlZEF4aXNDb2Rlcy5pbmNsdWRlcyhheGlzQ29kZSkpO1xuICBjb25zdCBjb21wbGV0ZWRDb3VudCA9IGNvbXBsZXRlZEF4aXNDb2Rlcy5sZW5ndGg7XG4gIGNvbnN0IHRvdGFsQ291bnQgPSBheGlzQ29kZXMubGVuZ3RoO1xuICBjb25zdCB0b3RhbENvbXBsZXRlZENvdW50ID0gdG90YWxDb21wbGV0ZWRBeGlzQ29kZXMubGVuZ3RoO1xuICBjb25zdCB0b3RhbFJlcXVpcmVkQ291bnQgPSByZXF1aXJlZEF4aXNDb2Rlcy5sZW5ndGg7XG4gIGNvbnN0IGxhYmVsUHJlZml4ID0gbm9ybWFsaXplVGV4dChleHBlcmltZW50TmFtZSkgfHwgbm9ybWFsaXplVGV4dChleHBlcmltZW50Py5leHBlcmltZW50X25hbWUpIHx8IG5vcm1hbGl6ZVRleHQoZXhwZXJpbWVudD8uZXhwZXJpbWVudF90eXBlKSB8fCBcIuW9k+WJjeivlemqjFwiO1xuICBjb25zdCBzdGF0dXNMYWJlbCA9XG4gICAgY29tcGxldGVkQ291bnQgPiAwICYmIGNvbXBsZXRlZENvdW50IDwgdG90YWxDb3VudFxuICAgICAgPyBgJHtsYWJlbFByZWZpeH3pg6jliIblrozmiJAgJHtjb21wbGV0ZWRDb3VudH0vJHt0b3RhbENvdW50fei9tGBcbiAgICAgIDogY29tcGxldGVkQ291bnQgPT09IHRvdGFsQ291bnRcbiAgICAgICAgPyBgJHtsYWJlbFByZWZpeH3lt7LlrozmiJAgJHtjb21wbGV0ZWRDb3VudH0vJHt0b3RhbENvdW50fei9tGBcbiAgICAgICAgOiBcIlwiO1xuICBjb25zdCB0b3RhbFN0YXR1c0xhYmVsID1cbiAgICB0b3RhbENvbXBsZXRlZENvdW50ID4gMCAmJiB0b3RhbENvbXBsZXRlZENvdW50IDwgdG90YWxSZXF1aXJlZENvdW50XG4gICAgICA/IGAke2xhYmVsUHJlZml4femDqOWIhuWujOaIkCAke3RvdGFsQ29tcGxldGVkQ291bnR9LyR7dG90YWxSZXF1aXJlZENvdW50fei9tGBcbiAgICAgIDogdG90YWxDb21wbGV0ZWRDb3VudCA9PT0gdG90YWxSZXF1aXJlZENvdW50ICYmIHRvdGFsUmVxdWlyZWRDb3VudCA+IDBcbiAgICAgICAgPyBgJHtsYWJlbFByZWZpeH3lt7LlrozmiJAgJHt0b3RhbENvbXBsZXRlZENvdW50fS8ke3RvdGFsUmVxdWlyZWRDb3VudH3ovbRgXG4gICAgICAgIDogXCJcIjtcbiAgcmV0dXJuIHtcbiAgICBjb21wbGV0ZWRBeGlzQ29kZXMsXG4gICAgY29tcGxldGVkQ291bnQsXG4gICAgcmVtYWluaW5nQXhpc0NvZGVzLFxuICAgIHJlcXVpcmVkQXhpc0NvZGVzOiBheGlzQ29kZXMsXG4gICAgc2NoZWR1bGVkQXhpc0NvZGVzLFxuICAgIHNjaGVkdWxlUnVuQXhpc0NvZGVzLFxuICAgIHN0YXR1c0xhYmVsLFxuICAgIHRvdGFsQ291bnQsXG4gICAgdG90YWxDb21wbGV0ZWRBeGlzQ29kZXMsXG4gICAgdG90YWxDb21wbGV0ZWRDb3VudCxcbiAgICB0b3RhbFJlbWFpbmluZ0F4aXNDb2RlcyxcbiAgICB0b3RhbFJlcXVpcmVkQXhpc0NvZGVzOiByZXF1aXJlZEF4aXNDb2RlcyxcbiAgICB0b3RhbFJlcXVpcmVkQ291bnQsXG4gICAgdG90YWxTdGF0dXNMYWJlbCxcbiAgfTtcbn07XG5cbmNvbnN0IGJ1aWxkQ29tcGxldGVkRXhwZXJpbWVudENvZGVzQnlUcmF5Q29kZSA9ICh7IGV4cGVyaW1lbnRSdW5UcmF5cyA9IFtdLCB0YXNrQ29kZSB9KSA9PiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRUYXNrQ29kZSA9IG5vcm1hbGl6ZVRleHQodGFza0NvZGUpO1xyXG4gIGNvbnN0IGNvbXBsZXRlZENvZGVzQnlUcmF5Q29kZSA9IG5ldyBNYXAoKTtcclxuICBhc0FycmF5KGV4cGVyaW1lbnRSdW5UcmF5cykuZm9yRWFjaCgocmVsYXRpb24pID0+IHtcclxuICAgIGlmIChyZXNvbHZlUmVsYXRpb25UYXNrQ29kZShyZWxhdGlvbikgIT09IG5vcm1hbGl6ZWRUYXNrQ29kZSB8fCAhcmVsYXRpb25Jc0NvbXBsZXRlZChyZWxhdGlvbikpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgdHJheUNvZGUgPSByZXNvbHZlUmVsYXRpb25UcmF5Q29kZShyZWxhdGlvbik7XHJcbiAgICBjb25zdCBleHBlcmltZW50Q29kZSA9IHJlc29sdmVSZWxhdGlvbkV4cGVyaW1lbnRDb2RlKHJlbGF0aW9uKTtcclxuICAgIGlmICghdHJheUNvZGUgfHwgIWV4cGVyaW1lbnRDb2RlKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IGV4aXN0aW5nID0gY29tcGxldGVkQ29kZXNCeVRyYXlDb2RlLmdldCh0cmF5Q29kZSkgfHwgbmV3IFNldCgpO1xyXG4gICAgZXhpc3RpbmcuYWRkKGV4cGVyaW1lbnRDb2RlKTtcclxuICAgIGNvbXBsZXRlZENvZGVzQnlUcmF5Q29kZS5zZXQodHJheUNvZGUsIGV4aXN0aW5nKTtcclxuICB9KTtcclxuICByZXR1cm4gY29tcGxldGVkQ29kZXNCeVRyYXlDb2RlO1xyXG59O1xyXG5cclxuY29uc3QgYnVpbGRDb21wbGV0ZWRFeHBlcmltZW50UmVjb3JkQ29kZXNCeVRyYXlDb2RlID0gKHsgY3VycmVudEV4cGVyaW1lbnRDb2RlID0gXCJcIiwgZXhwZXJpbWVudFJlY29yZE1hcCwgZXhwZXJpbWVudFRyYXlDb2RlTWFwLCB0YXNrQ29kZSB9KSA9PiB7XHJcbiAgY29uc3Qgbm9ybWFsaXplZFRhc2tDb2RlID0gbm9ybWFsaXplVGV4dCh0YXNrQ29kZSk7XHJcbiAgY29uc3Qgbm9ybWFsaXplZEN1cnJlbnRFeHBlcmltZW50Q29kZSA9IG5vcm1hbGl6ZVRleHQoY3VycmVudEV4cGVyaW1lbnRDb2RlKTtcclxuICBjb25zdCBjb21wbGV0ZWRDb2Rlc0J5VHJheUNvZGUgPSBuZXcgTWFwKCk7XHJcbiAgZXhwZXJpbWVudFRyYXlDb2RlTWFwLmZvckVhY2goKHRyYXlDb2RlcywgZXhwZXJpbWVudEtleSkgPT4ge1xyXG4gICAgY29uc3QgW2VudHJ5VGFza0NvZGUsIGV4cGVyaW1lbnRDb2RlXSA9IFN0cmluZyhleHBlcmltZW50S2V5KS5zcGxpdChcIjo6XCIpO1xyXG4gICAgaWYgKG5vcm1hbGl6ZVRleHQoZW50cnlUYXNrQ29kZSkgIT09IG5vcm1hbGl6ZWRUYXNrQ29kZSB8fCAhbm9ybWFsaXplVGV4dChleHBlcmltZW50Q29kZSkpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgZXhwZXJpbWVudCA9IGV4cGVyaW1lbnRSZWNvcmRNYXA/LmdldChleHBlcmltZW50S2V5KTtcclxuICAgIGlmICghQ09NUExFVEVEX0VYUEVSSU1FTlRfU1RBVFVTRVMuaGFzKG5vcm1hbGl6ZVRleHQoZXhwZXJpbWVudD8uc3RhdHVzKSkpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKG5vcm1hbGl6ZVRleHQoZXhwZXJpbWVudENvZGUpID09PSBub3JtYWxpemVkQ3VycmVudEV4cGVyaW1lbnRDb2RlKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGFzQXJyYXkodHJheUNvZGVzKS5mb3JFYWNoKCh0cmF5Q29kZSkgPT4ge1xyXG4gICAgICBjb25zdCBub3JtYWxpemVkVHJheUNvZGUgPSBub3JtYWxpemVUZXh0KHRyYXlDb2RlKTtcclxuICAgICAgaWYgKCFub3JtYWxpemVkVHJheUNvZGUpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBjb21wbGV0ZWRDb2Rlc0J5VHJheUNvZGUuZ2V0KG5vcm1hbGl6ZWRUcmF5Q29kZSkgfHwgbmV3IFNldCgpO1xyXG4gICAgICBleGlzdGluZy5hZGQoZXhwZXJpbWVudENvZGUpO1xyXG4gICAgICBjb21wbGV0ZWRDb2Rlc0J5VHJheUNvZGUuc2V0KG5vcm1hbGl6ZWRUcmF5Q29kZSwgZXhpc3RpbmcpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGNvbXBsZXRlZENvZGVzQnlUcmF5Q29kZTtcclxufTtcclxuXHJcbmNvbnN0IGZpbmRBY3RpdmVFeHBlcmltZW50UnVuID0gKHsgZGV2aWNlLCBleHBlcmltZW50Q29kZSwgZXhwZXJpbWVudFJ1bnMsIHNjaGVkdWxlSWQgPSBcIlwiLCB0YXNrQ29kZSB9KSA9PiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWREZXZpY2UgPSBub3JtYWxpemVUZXh0KGRldmljZSk7XG4gIGNvbnN0IG5vcm1hbGl6ZWRFeHBlcmltZW50Q29kZSA9IG5vcm1hbGl6ZVRleHQoZXhwZXJpbWVudENvZGUpO1xuICBjb25zdCBub3JtYWxpemVkU2NoZWR1bGVJZCA9IG5vcm1hbGl6ZVRleHQoc2NoZWR1bGVJZCk7XG4gIGNvbnN0IG5vcm1hbGl6ZWRUYXNrQ29kZSA9IG5vcm1hbGl6ZVRleHQodGFza0NvZGUpO1xuICBjb25zdCBtYXRjaGVkUnVucyA9IGFzQXJyYXkoZXhwZXJpbWVudFJ1bnMpXG4gICAgLmZpbHRlcihcbiAgICAgIChydW4pID0+XG4gICAgICAgIHJlc29sdmVSdW5UYXNrQ29kZShydW4pID09PSBub3JtYWxpemVkVGFza0NvZGVcbiAgICAgICAgJiYgcmVzb2x2ZVJ1bkV4cGVyaW1lbnRDb2RlKHJ1bikgPT09IG5vcm1hbGl6ZWRFeHBlcmltZW50Q29kZVxuICAgICAgICAmJiAoIW5vcm1hbGl6ZWRTY2hlZHVsZUlkIHx8ICFyZXNvbHZlUnVuU2NoZWR1bGVJZChydW4pIHx8IHJlc29sdmVSdW5TY2hlZHVsZUlkKHJ1bikgPT09IG5vcm1hbGl6ZWRTY2hlZHVsZUlkKVxuICAgICAgICAmJiAoIW5vcm1hbGl6ZWREZXZpY2UgfHwgIXJlc29sdmVSdW5EZXZpY2UocnVuKSB8fCByZXNvbHZlUnVuRGV2aWNlKHJ1bikgPT09IG5vcm1hbGl6ZWREZXZpY2UpXG4gICAgICAgICYmIFJVTk5JTkdfRVhQRVJJTUVOVF9SVU5fU1RBVFVTRVMuaGFzKHJlc29sdmVSdW5TdGF0dXMocnVuKSlcbiAgICApXG4gICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiAodG9UaW1lKHJpZ2h0Py5zdGFydGVkX2F0KSB8fCAwKSAtICh0b1RpbWUobGVmdD8uc3RhcnRlZF9hdCkgfHwgMCkpO1xyXG4gIHJldHVybiBtYXRjaGVkUnVuc1swXSB8fCBudWxsO1xyXG59O1xyXG5cclxuY29uc3QgZmluZEFjdGl2ZUV4cGVyaW1lbnRSdW5UcmF5UmVsYXRpb25zID0gKHsgZGV2aWNlLCBleHBlcmltZW50Q29kZSwgZXhwZXJpbWVudFJ1bnMsIGV4cGVyaW1lbnRSdW5UcmF5cywgc2NoZWR1bGVJZCA9IFwiXCIsIHRhc2tDb2RlIH0pID0+IHtcbiAgY29uc3Qgbm9ybWFsaXplZERldmljZSA9IG5vcm1hbGl6ZVRleHQoZGV2aWNlKTtcbiAgY29uc3Qgbm9ybWFsaXplZEV4cGVyaW1lbnRDb2RlID0gbm9ybWFsaXplVGV4dChleHBlcmltZW50Q29kZSk7XG4gIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUlkID0gbm9ybWFsaXplVGV4dChzY2hlZHVsZUlkKTtcbiAgY29uc3Qgbm9ybWFsaXplZFRhc2tDb2RlID0gbm9ybWFsaXplVGV4dCh0YXNrQ29kZSk7XG4gIGNvbnN0IHJ1bkJ5Tm8gPSBuZXcgTWFwKFxuICAgIGFzQXJyYXkoZXhwZXJpbWVudFJ1bnMpXHJcbiAgICAgIC5tYXAoKHJ1bikgPT4gW3Jlc29sdmVSdW5ObyhydW4pLCBydW5dKVxyXG4gICAgICAuZmlsdGVyKChbcnVuTm9dKSA9PiBCb29sZWFuKHJ1bk5vKSksXHJcbiAgKTtcclxuICByZXR1cm4gYXNBcnJheShleHBlcmltZW50UnVuVHJheXMpXHJcbiAgICAuZmlsdGVyKChyZWxhdGlvbikgPT4ge1xyXG4gICAgICBpZiAoXHJcbiAgICAgICAgcmVzb2x2ZVJlbGF0aW9uVGFza0NvZGUocmVsYXRpb24pICE9PSBub3JtYWxpemVkVGFza0NvZGVcclxuICAgICAgICB8fCByZXNvbHZlUmVsYXRpb25FeHBlcmltZW50Q29kZShyZWxhdGlvbikgIT09IG5vcm1hbGl6ZWRFeHBlcmltZW50Q29kZVxyXG4gICAgICAgIHx8ICFSVU5OSU5HX0VYUEVSSU1FTlRfUlVOX1NUQVRVU0VTLmhhcyhyZXNvbHZlUmVsYXRpb25TdGF0dXMocmVsYXRpb24pKVxyXG4gICAgICApIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJ1biA9IHJ1bkJ5Tm8uZ2V0KHJlc29sdmVSZWxhdGlvblJ1bk5vKHJlbGF0aW9uKSk7XG4gICAgICBpZiAobm9ybWFsaXplZFNjaGVkdWxlSWQgJiYgcnVuICYmIHJlc29sdmVSdW5TY2hlZHVsZUlkKHJ1bikgJiYgcmVzb2x2ZVJ1blNjaGVkdWxlSWQocnVuKSAhPT0gbm9ybWFsaXplZFNjaGVkdWxlSWQpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuICFub3JtYWxpemVkRGV2aWNlIHx8ICFydW4gfHwgIXJlc29sdmVSdW5EZXZpY2UocnVuKSB8fCByZXNvbHZlUnVuRGV2aWNlKHJ1bikgPT09IG5vcm1hbGl6ZWREZXZpY2U7XG4gICAgfSlcbiAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+ICh0b1RpbWUocmlnaHQ/LnN0YXJ0ZWRfYXQgfHwgcmlnaHQ/LnN0YXJ0ZWRBdCkgfHwgMCkgLSAodG9UaW1lKGxlZnQ/LnN0YXJ0ZWRfYXQgfHwgbGVmdD8uc3RhcnRlZEF0KSB8fCAwKSk7XHJcbn07XHJcblxyXG5jb25zdCBidWlsZEFjdGl2ZU90aGVyRXhwZXJpbWVudFJ1bkxvY2tzID0gKHtcclxuICBjdXJyZW50RXhwZXJpbWVudENvZGUsXHJcbiAgZXhwZXJpbWVudE1hcCxcclxuICBleHBlcmltZW50UnVucyxcclxuICBleHBlcmltZW50UnVuVHJheXMsXHJcbiAgdGFza0NvZGUsXHJcbiAgdHJheUNvZGUsXHJcbn0pID0+IHtcclxuICBjb25zdCBub3JtYWxpemVkQ3VycmVudEV4cGVyaW1lbnRDb2RlID0gbm9ybWFsaXplVGV4dChjdXJyZW50RXhwZXJpbWVudENvZGUpO1xyXG4gIGNvbnN0IG5vcm1hbGl6ZWRUYXNrQ29kZSA9IG5vcm1hbGl6ZVRleHQodGFza0NvZGUpO1xyXG4gIGNvbnN0IG5vcm1hbGl6ZWRUcmF5Q29kZSA9IG5vcm1hbGl6ZVRleHQodHJheUNvZGUpO1xyXG4gIGlmICghbm9ybWFsaXplZFRhc2tDb2RlIHx8ICFub3JtYWxpemVkVHJheUNvZGUgfHwgIW5vcm1hbGl6ZWRDdXJyZW50RXhwZXJpbWVudENvZGUpIHtcclxuICAgIHJldHVybiBbXTtcclxuICB9XHJcblxyXG4gIGNvbnN0IHJ1bkJ5Tm8gPSBuZXcgTWFwKFxyXG4gICAgYXNBcnJheShleHBlcmltZW50UnVucylcclxuICAgICAgLm1hcCgocnVuKSA9PiBbcmVzb2x2ZVJ1bk5vKHJ1biksIHJ1bl0pXHJcbiAgICAgIC5maWx0ZXIoKFtydW5Ob10pID0+IEJvb2xlYW4ocnVuTm8pKSxcclxuICApO1xyXG4gIGNvbnN0IGxvY2tzQnlLZXkgPSBuZXcgTWFwKCk7XHJcbiAgY29uc3QgcHVzaExvY2sgPSAoeyBleHBlcmltZW50Q29kZSwgcmVsYXRpb24gPSBudWxsLCBydW4gPSBudWxsIH0pID0+IHtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRFeHBlcmltZW50Q29kZSA9IG5vcm1hbGl6ZVRleHQoZXhwZXJpbWVudENvZGUpO1xyXG4gICAgaWYgKCFub3JtYWxpemVkRXhwZXJpbWVudENvZGUgfHwgbm9ybWFsaXplZEV4cGVyaW1lbnRDb2RlID09PSBub3JtYWxpemVkQ3VycmVudEV4cGVyaW1lbnRDb2RlKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHJ1bk5vID0gcmVzb2x2ZVJ1bk5vKHJ1bikgfHwgcmVzb2x2ZVJlbGF0aW9uUnVuTm8ocmVsYXRpb24pO1xyXG4gICAgY29uc3Qga2V5ID0gYCR7cnVuTm8gfHwgXCJydW5cIn06OiR7bm9ybWFsaXplZEV4cGVyaW1lbnRDb2RlfWA7XHJcbiAgICBpZiAobG9ja3NCeUtleS5oYXMoa2V5KSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBsb2Nrc0J5S2V5LnNldChrZXksIHtcclxuICAgICAgZGV2aWNlOiByZXNvbHZlUnVuRGV2aWNlKHJ1biksXHJcbiAgICAgIGV4cGVyaW1lbnRDb2RlOiBub3JtYWxpemVkRXhwZXJpbWVudENvZGUsXHJcbiAgICAgIGV4cGVyaW1lbnROYW1lOiBub3JtYWxpemVUZXh0KGV4cGVyaW1lbnRNYXA/LmdldChgJHtub3JtYWxpemVkVGFza0NvZGV9Ojoke25vcm1hbGl6ZWRFeHBlcmltZW50Q29kZX1gKSkgfHwgbm9ybWFsaXplZEV4cGVyaW1lbnRDb2RlLFxyXG4gICAgICBydW5ObyxcclxuICAgICAgdHJheUNvZGU6IG5vcm1hbGl6ZWRUcmF5Q29kZSxcclxuICAgIH0pO1xyXG4gIH07XHJcblxyXG4gIGFzQXJyYXkoZXhwZXJpbWVudFJ1blRyYXlzKS5mb3JFYWNoKChyZWxhdGlvbikgPT4ge1xyXG4gICAgaWYgKFxyXG4gICAgICByZXNvbHZlUmVsYXRpb25UYXNrQ29kZShyZWxhdGlvbikgIT09IG5vcm1hbGl6ZWRUYXNrQ29kZVxyXG4gICAgICB8fCByZXNvbHZlUmVsYXRpb25UcmF5Q29kZShyZWxhdGlvbikgIT09IG5vcm1hbGl6ZWRUcmF5Q29kZVxyXG4gICAgICB8fCAhUlVOTklOR19FWFBFUklNRU5UX1JVTl9TVEFUVVNFUy5oYXMocmVzb2x2ZVJlbGF0aW9uU3RhdHVzKHJlbGF0aW9uKSlcclxuICAgICkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBydW4gPSBydW5CeU5vLmdldChyZXNvbHZlUmVsYXRpb25SdW5ObyhyZWxhdGlvbikpO1xyXG4gICAgaWYgKHJ1biAmJiAhUlVOTklOR19FWFBFUklNRU5UX1JVTl9TVEFUVVNFUy5oYXMocmVzb2x2ZVJ1blN0YXR1cyhydW4pKSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBwdXNoTG9jayh7IGV4cGVyaW1lbnRDb2RlOiByZXNvbHZlUmVsYXRpb25FeHBlcmltZW50Q29kZShyZWxhdGlvbiksIHJlbGF0aW9uLCBydW4gfSk7XHJcbiAgfSk7XHJcblxyXG4gIGNvbnN0IHJ1bktleXNXaXRoVHJheVJlbGF0aW9ucyA9IG5ldyBTZXQoXHJcbiAgICBhc0FycmF5KGV4cGVyaW1lbnRSdW5UcmF5cylcclxuICAgICAgLmZpbHRlcigocmVsYXRpb24pID0+XHJcbiAgICAgICAgcmVzb2x2ZVJlbGF0aW9uVGFza0NvZGUocmVsYXRpb24pID09PSBub3JtYWxpemVkVGFza0NvZGVcclxuICAgICAgICAmJiByZXNvbHZlUmVsYXRpb25SdW5ObyhyZWxhdGlvbilcclxuICAgICAgKVxyXG4gICAgICAubWFwKChyZWxhdGlvbikgPT4gYCR7cmVzb2x2ZVJlbGF0aW9uUnVuTm8ocmVsYXRpb24pfTo6JHtyZXNvbHZlUmVsYXRpb25FeHBlcmltZW50Q29kZShyZWxhdGlvbil9YCksXHJcbiAgKTtcclxuXHJcbiAgYXNBcnJheShleHBlcmltZW50UnVucykuZm9yRWFjaCgocnVuKSA9PiB7XHJcbiAgICBjb25zdCBydW5ObyA9IHJlc29sdmVSdW5ObyhydW4pO1xyXG4gICAgY29uc3QgZXhwZXJpbWVudENvZGUgPSByZXNvbHZlUnVuRXhwZXJpbWVudENvZGUocnVuKTtcclxuICAgIGlmIChcclxuICAgICAgcmVzb2x2ZVJ1blRhc2tDb2RlKHJ1bikgIT09IG5vcm1hbGl6ZWRUYXNrQ29kZVxyXG4gICAgICB8fCAhUlVOTklOR19FWFBFUklNRU5UX1JVTl9TVEFUVVNFUy5oYXMocmVzb2x2ZVJ1blN0YXR1cyhydW4pKVxyXG4gICAgICB8fCBydW5LZXlzV2l0aFRyYXlSZWxhdGlvbnMuaGFzKGAke3J1bk5vfTo6JHtleHBlcmltZW50Q29kZX1gKVxyXG4gICAgICB8fCAhYXNBcnJheShydW4/LnRyYXlfY29kZXMgfHwgcnVuPy50cmF5Q29kZXMpLm1hcChub3JtYWxpemVUZXh0KS5pbmNsdWRlcyhub3JtYWxpemVkVHJheUNvZGUpXHJcbiAgICApIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgcHVzaExvY2soeyBleHBlcmltZW50Q29kZSwgcnVuIH0pO1xyXG4gIH0pO1xyXG5cclxuICByZXR1cm4gQXJyYXkuZnJvbShsb2Nrc0J5S2V5LnZhbHVlcygpKTtcclxufTtcclxuXHJcbmNvbnN0IGNvbGxlY3RUcmF5Um93cyA9ICh7XG4gIGRldmljZSxcbiAgZXhwZXJpbWVudE5hbWUsXG4gIGV4cGVyaW1lbnRSZWNvcmRNYXAsXG4gIGV4cGVyaW1lbnRSdW5zLFxuICBleHBlcmltZW50UnVuVHJheXMsXG4gIGV4cGVyaW1lbnRUcmF5Q29kZU1hcCxcbiAgZXhwZXJpbWVudEtleSxcbiAgcmVsYXRlZFNhbXBsZXMsXG4gIHNjaGVkdWxlLFxuICB0YXNrQ29kZSxcbn0pID0+IHtcbiAgY29uc3QgdHJheVJvd3MgPSBbXTtcbiAgY29uc3QgaW5kZXhCeVRyYXlDb2RlID0gbmV3IE1hcCgpO1xuICBjb25zdCBleHBlcmltZW50Q29kZXNCeVRyYXlDb2RlID0gYnVpbGRFeHBlcmltZW50Q29kZXNCeVRyYXlDb2RlKGV4cGVyaW1lbnRUcmF5Q29kZU1hcCk7XG4gIGNvbnN0IGN1cnJlbnRFeHBlcmltZW50Q29kZSA9IG5vcm1hbGl6ZVRleHQoU3RyaW5nKGV4cGVyaW1lbnRLZXkpLnNwbGl0KFwiOjpcIilbMV0pO1xuICBjb25zdCBjdXJyZW50U2NoZWR1bGVJc0F4aXNTdWJFeHBlcmltZW50ID0gQm9vbGVhbihcbiAgICByZXNvbHZlU3ViRXhwZXJpbWVudENvZGUoc2NoZWR1bGUpXG4gICAgJiYgbm9ybWFsaXplQXhpc0NvZGVzKHNjaGVkdWxlPy5heGlzX2NvZGVzID8/IHNjaGVkdWxlPy5heGlzQ29kZXMpLmxlbmd0aCA+IDAsXG4gICk7XG4gIGNvbnN0IGNvbXBsZXRlZEN1cnJlbnRTY2hlZHVsZVRyYXlDb2RlcyA9IGN1cnJlbnRTY2hlZHVsZUlzQXhpc1N1YkV4cGVyaW1lbnRcbiAgICA/IGJ1aWxkQ29tcGxldGVkU2NoZWR1bGVUcmF5Q29kZVNldCh7IGV4cGVyaW1lbnRSdW5zLCBleHBlcmltZW50UnVuVHJheXMsIHNjaGVkdWxlIH0pXG4gICAgOiBuZXcgU2V0KCk7XG4gIGNvbnN0IGNvbXBsZXRlZEV4cGVyaW1lbnRDb2Rlc0J5VHJheUNvZGUgPSBidWlsZENvbXBsZXRlZEV4cGVyaW1lbnRDb2Rlc0J5VHJheUNvZGUoeyBleHBlcmltZW50UnVuVHJheXMsIHRhc2tDb2RlIH0pO1xuICBjb25zdCBjb21wbGV0ZWRFeHBlcmltZW50UmVjb3JkQ29kZXNCeVRyYXlDb2RlID0gYnVpbGRDb21wbGV0ZWRFeHBlcmltZW50UmVjb3JkQ29kZXNCeVRyYXlDb2RlKHtcclxuICAgIGN1cnJlbnRFeHBlcmltZW50Q29kZSxcclxuICAgIGV4cGVyaW1lbnRSZWNvcmRNYXAsXHJcbiAgICBleHBlcmltZW50VHJheUNvZGVNYXAsXHJcbiAgICB0YXNrQ29kZSxcclxuICB9KTtcclxuXHJcbiAgY29uc3QgcHVzaFJvdyA9IChcclxuICAgIHRyYXlDb2RlLFxyXG4gICAgc2FtcGxlQ29kZSA9IFwiXCIsXHJcbiAgICBxdWFudGl0eSA9IFwiXCIsXHJcbiAgICBvd25lciA9IFwiXCIsXHJcbiAgICBsb2NhdGlvbiA9IFwiXCIsXHJcbiAgICBmaXh0dXJlUmVhZHkgPSBmYWxzZSxcclxuICAgIHRhcmdldExhYiA9IFwiXCIsXHJcbiAgICB0YXJnZXRFeHBlcmltZW50Q29kZSA9IFwiXCIsXHJcbiAgICBoYXNDdXJyZW50RXhwZXJpbWVudEhpc3RvcnkgPSBmYWxzZSxcclxuICApID0+IHtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRUcmF5Q29kZSA9IG5vcm1hbGl6ZVRleHQodHJheUNvZGUpO1xyXG4gICAgaWYgKCFub3JtYWxpemVkVHJheUNvZGUpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgbm9ybWFsaXplZFRhcmdldExhYiA9IG5vcm1hbGl6ZVRleHQodGFyZ2V0TGFiKTtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRUYXJnZXRFeHBlcmltZW50Q29kZSA9IG5vcm1hbGl6ZVRleHQodGFyZ2V0RXhwZXJpbWVudENvZGUpO1xyXG4gICAgY29uc3QgZXhpc3RpbmdJbmRleCA9IGluZGV4QnlUcmF5Q29kZS5nZXQobm9ybWFsaXplZFRyYXlDb2RlKTtcclxuICAgIGlmIChleGlzdGluZ0luZGV4ICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgY29uc3QgY3VycmVudCA9IHRyYXlSb3dzW2V4aXN0aW5nSW5kZXhdO1xyXG4gICAgICBpZiAoc2FtcGxlQ29kZSAmJiAhY3VycmVudC5zYW1wbGVDb2Rlcy5pbmNsdWRlcyhzYW1wbGVDb2RlKSkge1xyXG4gICAgICAgIGN1cnJlbnQuc2FtcGxlQ29kZXMucHVzaChzYW1wbGVDb2RlKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAoIWN1cnJlbnQub3duZXIgJiYgb3duZXIpIHtcclxuICAgICAgICBjdXJyZW50Lm93bmVyID0gb3duZXI7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKCFjdXJyZW50LnF1YW50aXR5ICYmIHF1YW50aXR5KSB7XHJcbiAgICAgICAgY3VycmVudC5xdWFudGl0eSA9IHF1YW50aXR5O1xyXG4gICAgICB9XHJcbiAgICAgIGlmICghY3VycmVudC5jdXJyZW50TG9jYXRpb24gJiYgbG9jYXRpb24pIHtcclxuICAgICAgICBjdXJyZW50LmN1cnJlbnRMb2NhdGlvbiA9IGxvY2F0aW9uO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICghY3VycmVudC50YXJnZXRMYWIgJiYgbm9ybWFsaXplZFRhcmdldExhYikge1xyXG4gICAgICAgIGN1cnJlbnQudGFyZ2V0TGFiID0gbm9ybWFsaXplZFRhcmdldExhYjtcclxuICAgICAgfVxyXG4gICAgICBpZiAoIWN1cnJlbnQudGFyZ2V0RXhwZXJpbWVudENvZGUgJiYgbm9ybWFsaXplZFRhcmdldEV4cGVyaW1lbnRDb2RlKSB7XHJcbiAgICAgICAgY3VycmVudC50YXJnZXRFeHBlcmltZW50Q29kZSA9IG5vcm1hbGl6ZWRUYXJnZXRFeHBlcmltZW50Q29kZTtcclxuICAgICAgfVxyXG4gICAgICBjdXJyZW50Lmhhc0N1cnJlbnRFeHBlcmltZW50SGlzdG9yeSA9IGN1cnJlbnQuaGFzQ3VycmVudEV4cGVyaW1lbnRIaXN0b3J5IHx8IEJvb2xlYW4oaGFzQ3VycmVudEV4cGVyaW1lbnRIaXN0b3J5KTtcclxuICAgICAgY3VycmVudC5maXh0dXJlUmVhZHkgPSBjdXJyZW50LmZpeHR1cmVSZWFkeSB8fCBpc0ZpeHR1cmVSZWFkeShmaXh0dXJlUmVhZHkpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpbmRleEJ5VHJheUNvZGUuc2V0KG5vcm1hbGl6ZWRUcmF5Q29kZSwgdHJheVJvd3MubGVuZ3RoKTtcclxuICAgIGNvbnN0IGNvbXBsZXRlZEV4cGVyaW1lbnRDb2RlcyA9IG5ldyBTZXQoW1xuICAgICAgLi4uQXJyYXkuZnJvbShjb21wbGV0ZWRFeHBlcmltZW50Q29kZXNCeVRyYXlDb2RlLmdldChub3JtYWxpemVkVHJheUNvZGUpIHx8IFtdKSxcbiAgICAgIC4uLkFycmF5LmZyb20oY29tcGxldGVkRXhwZXJpbWVudFJlY29yZENvZGVzQnlUcmF5Q29kZS5nZXQobm9ybWFsaXplZFRyYXlDb2RlKSB8fCBbXSksXG4gICAgXSk7XG4gICAgaWYgKGN1cnJlbnRTY2hlZHVsZUlzQXhpc1N1YkV4cGVyaW1lbnQgJiYgIWNvbXBsZXRlZEN1cnJlbnRTY2hlZHVsZVRyYXlDb2Rlcy5oYXMobm9ybWFsaXplZFRyYXlDb2RlKSkge1xuICAgICAgY29tcGxldGVkRXhwZXJpbWVudENvZGVzLmRlbGV0ZShjdXJyZW50RXhwZXJpbWVudENvZGUpO1xuICAgIH1cbiAgICB0cmF5Um93cy5wdXNoKHtcclxuICAgICAgY3VycmVudExvY2F0aW9uOiBub3JtYWxpemVUZXh0KGxvY2F0aW9uKSxcclxuICAgICAgY29tcGxldGVkRXhwZXJpbWVudENvZGVzOiBBcnJheS5mcm9tKGNvbXBsZXRlZEV4cGVyaW1lbnRDb2RlcyksXHJcbiAgICAgIGNvbXBsZXRlZEZvckN1cnJlbnRFeHBlcmltZW50OiBmYWxzZSxcclxuICAgICAgY29tcGxldGVkRm9yT3RoZXJFeHBlcmltZW50OiBmYWxzZSxcclxuICAgICAgZGlzcGxheVN0YXR1czogXCJcIixcclxuICAgICAgZXhwZXJpbWVudENvZGVzOiBleHBlcmltZW50Q29kZXNCeVRyYXlDb2RlLmdldChub3JtYWxpemVkVHJheUNvZGUpIHx8IFtdLFxyXG4gICAgICBsaWZlY3ljbGVMb2NhdGlvbjogbm9ybWFsaXplVGV4dChsb2NhdGlvbiksXHJcbiAgICAgIGxpZmVjeWNsZVN0YXR1czogXCJcIixcclxuICAgICAgbGlmZWN5Y2xlVGltZTogMCxcclxuICAgICAgaGFzQ3VycmVudEV4cGVyaW1lbnRIaXN0b3J5OiBmYWxzZSxcclxuICAgICAgY3VycmVudEV4cGVyaW1lbnRIaXN0b3J5U3RhdHVzOiBcIlwiLFxyXG4gICAgICBvd25lcjogbm9ybWFsaXplVGV4dChvd25lciksXHJcbiAgICAgIHF1YW50aXR5OiBxdWFudGl0eSB8fCBcIlwiLFxyXG4gICAgICBzYW1wbGVDb2Rlczogc2FtcGxlQ29kZSA/IFtzYW1wbGVDb2RlXSA6IFtdLFxyXG4gICAgICB0YXJnZXRFeHBlcmltZW50Q29kZTogbm9ybWFsaXplZFRhcmdldEV4cGVyaW1lbnRDb2RlLFxyXG4gICAgICB0YXJnZXRMYWI6IG5vcm1hbGl6ZWRUYXJnZXRMYWIsXHJcbiAgICAgIGZpeHR1cmVSZWFkeTogaXNGaXh0dXJlUmVhZHkoZml4dHVyZVJlYWR5KSxcclxuICAgICAgdHJheVN0YXR1czogXCJcIixcclxuICAgICAgdHJheUNvZGU6IG5vcm1hbGl6ZWRUcmF5Q29kZSxcclxuICAgIH0pO1xyXG4gIH07XHJcblxyXG4gIGNvbnN0IHNjb3BlZFRyYXlDb2RlcyA9IGV4cGVyaW1lbnRUcmF5Q29kZU1hcC5nZXQoZXhwZXJpbWVudEtleSkgfHwgW107XHJcbiAgc2NvcGVkVHJheUNvZGVzLmZvckVhY2goKHRyYXlDb2RlKSA9PiBwdXNoUm93KHRyYXlDb2RlKSk7XHJcblxyXG4gIGFzQXJyYXkocmVsYXRlZFNhbXBsZXMpLmZvckVhY2goKHNhbXBsZSkgPT4ge1xyXG4gICAgY29uc3Qgc2FtcGxlQ29kZSA9IG5vcm1hbGl6ZVRleHQoc2FtcGxlPy5jb2RlKTtcclxuICAgIGNvbnN0IG93bmVyID0gbm9ybWFsaXplVGV4dChzYW1wbGU/Lm93bmVyKTtcclxuICAgIGNvbnN0IGxvY2F0aW9uID0gbm9ybWFsaXplVGV4dChzYW1wbGU/LmxvY2F0aW9uKTtcclxuICAgIGFzQXJyYXkoc2FtcGxlPy50cmF5cykuZm9yRWFjaCgodHJheSkgPT4ge1xyXG4gICAgICBjb25zdCB0cmF5Q29kZSA9IG5vcm1hbGl6ZVRleHQodHJheT8udHJheV9jb2RlKTtcclxuICAgICAgY29uc3QgcXVhbnRpdHkgPSB0cmF5Py5xdWFudGl0eSA/PyBcIlwiO1xyXG4gICAgICBpZiAoc2NvcGVkVHJheUNvZGVzLmxlbmd0aCA+IDAgJiYgIXNjb3BlZFRyYXlDb2Rlcy5pbmNsdWRlcyh0cmF5Q29kZSkpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdGFyZ2V0TGFiID0gbm9ybWFsaXplVGV4dCh0cmF5Py50YXJnZXRfbGFiIHx8IHRyYXk/LnRhcmdldExhYik7XG4gICAgICBjb25zdCB0YXJnZXRFeHBlcmltZW50Q29kZSA9IG5vcm1hbGl6ZVRleHQodHJheT8udGFyZ2V0X2V4cGVyaW1lbnRfY29kZSB8fCB0cmF5Py50YXJnZXRFeHBlcmltZW50Q29kZSk7XG4gICAgICBjb25zdCBwaHlzaWNhbFRyYXlTdGF0dXMgPSBub3JtYWxpemVUZXh0KHRyYXk/LnN0YXR1cyk7XG4gICAgICBjb25zdCBsYXRlc3REaXNwYXRjaCA9IHBoeXNpY2FsVHJheVN0YXR1cyA9PT0gTEFCX1JFU0VUX1NUQVRVU1xuICAgICAgICA/IHJlc29sdmVMYXRlc3RMYWJvcmF0b3J5RGlzcGF0Y2hTbmFwc2hvdCh7XG4gICAgICAgICAgICBjdXJyZW50RXhwZXJpbWVudENvZGUsXG4gICAgICAgICAgICBjdXJyZW50TGFiOiBkZXZpY2UsXG4gICAgICAgICAgICBzYW1wbGUsXG4gICAgICAgICAgICB0cmF5Q29kZSxcbiAgICAgICAgICB9KVxuICAgICAgICA6IG51bGw7XG4gICAgICBjb25zdCByZXN0b3JlZERpc3BhdGNoID0gcGh5c2ljYWxUcmF5U3RhdHVzID09PSBMQUJfUkVTRVRfU1RBVFVTICYmICghdGFyZ2V0TGFiIHx8ICF0YXJnZXRFeHBlcmltZW50Q29kZSlcbiAgICAgICAgPyBsYXRlc3REaXNwYXRjaFxuICAgICAgICA6IG51bGw7XG4gICAgICBjb25zdCBjdXJyZW50RXhwZXJpbWVudEhpc3RvcnlTbmFwc2hvdCA9IHJlc29sdmVMYXRlc3RFeHBlcmltZW50SGlzdG9yeVNuYXBzaG90KHtcbiAgICAgICAgZXhwZXJpbWVudE5hbWUsXG4gICAgICAgIHNhbXBsZSxcbiAgICAgICAgdGFza0NvZGUsXG4gICAgICAgIHRyYXlDb2RlLFxuICAgICAgfSk7XG4gICAgICBjb25zdCBsYXRlc3RFeHBlcmltZW50SGlzdG9yeVNuYXBzaG90ID0gcmVzb2x2ZUxhdGVzdEFueUV4cGVyaW1lbnRIaXN0b3J5U25hcHNob3Qoe1xuICAgICAgICBzYW1wbGUsXG4gICAgICAgIHRhc2tDb2RlLFxuICAgICAgICB0cmF5Q29kZSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgY3VycmVudEV4cGVyaW1lbnRIaXN0b3J5SXNTdGFsZSA9XG4gICAgICAgIGN1cnJlbnRFeHBlcmltZW50SGlzdG9yeVNuYXBzaG90XG4gICAgICAgICYmIGxhdGVzdEV4cGVyaW1lbnRIaXN0b3J5U25hcHNob3RcbiAgICAgICAgJiYgbm9ybWFsaXplVGV4dChsYXRlc3RFeHBlcmltZW50SGlzdG9yeVNuYXBzaG90LmV4cGVyaW1lbnROYW1lKSAhPT0gbm9ybWFsaXplVGV4dChleHBlcmltZW50TmFtZSlcbiAgICAgICAgJiYgKGxhdGVzdEV4cGVyaW1lbnRIaXN0b3J5U25hcHNob3QudGltZSB8fCAtSW5maW5pdHkpID4gKGN1cnJlbnRFeHBlcmltZW50SGlzdG9yeVNuYXBzaG90LnRpbWUgfHwgLUluZmluaXR5KVxuICAgICAgICAmJiByZXNvbHZlTGFib3JhdG9yeVN0YXR1c1JhbmsobGF0ZXN0RXhwZXJpbWVudEhpc3RvcnlTbmFwc2hvdC5zdGF0dXMpID4gMDtcbiAgICAgIGNvbnN0IGRpc3BhdGNoUmVzdG9yZXNXaXRoZHJhd25DdXJyZW50RXhwZXJpbWVudCA9XG4gICAgICAgIGV4cGVyaW1lbnRIaXN0b3J5U3RhdHVzSXNXaXRoZHJhd2FsKGN1cnJlbnRFeHBlcmltZW50SGlzdG9yeVNuYXBzaG90Py5zdGF0dXMpXG4gICAgICAgICYmIGxhdGVzdERpc3BhdGNoXG4gICAgICAgICYmIGxhdGVzdERpc3BhdGNoLnRpbWUgPiAoY3VycmVudEV4cGVyaW1lbnRIaXN0b3J5U25hcHNob3Q/LnRpbWUgfHwgLUluZmluaXR5KVxuICAgICAgICAmJiBub3JtYWxpemVUZXh0KGxhdGVzdERpc3BhdGNoLnRhcmdldExhYikgPT09IG5vcm1hbGl6ZVRleHQoZGV2aWNlKVxuICAgICAgICAmJiAoXG4gICAgICAgICAgIW5vcm1hbGl6ZVRleHQoY3VycmVudEV4cGVyaW1lbnRDb2RlKVxuICAgICAgICAgIHx8IG5vcm1hbGl6ZVRleHQobGF0ZXN0RGlzcGF0Y2gudGFyZ2V0RXhwZXJpbWVudENvZGUpID09PSBub3JtYWxpemVUZXh0KGN1cnJlbnRFeHBlcmltZW50Q29kZSlcbiAgICAgICAgKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRFeHBlcmltZW50SGlzdG9yeVN0YXR1cyA9IGRpc3BhdGNoUmVzdG9yZXNXaXRoZHJhd25DdXJyZW50RXhwZXJpbWVudFxuICAgICAgICB8fCBjdXJyZW50RXhwZXJpbWVudEhpc3RvcnlJc1N0YWxlXG4gICAgICAgIHx8IGN1cnJlbnRTY2hlZHVsZUlzQXhpc1N1YkV4cGVyaW1lbnRcbiAgICAgICAgPyBcIlwiXG4gICAgICAgIDogbm9ybWFsaXplVGV4dChjdXJyZW50RXhwZXJpbWVudEhpc3RvcnlTbmFwc2hvdD8uc3RhdHVzKTtcbiAgICAgIGNvbnN0IHJlc3RvcmVkVGFyZ2V0TGFiID0gdGFyZ2V0TGFiIHx8IG5vcm1hbGl6ZVRleHQocmVzdG9yZWREaXNwYXRjaD8udGFyZ2V0TGFiKTtcbiAgICAgIGNvbnN0IHJlc3RvcmVkVGFyZ2V0RXhwZXJpbWVudENvZGUgPVxuICAgICAgICB0YXJnZXRFeHBlcmltZW50Q29kZVxuICAgICAgICB8fCAocmVzdG9yZWRUYXJnZXRMYWIgPT09IG5vcm1hbGl6ZVRleHQocmVzdG9yZWREaXNwYXRjaD8udGFyZ2V0TGFiKVxuICAgICAgICAgID8gbm9ybWFsaXplVGV4dChyZXN0b3JlZERpc3BhdGNoPy50YXJnZXRFeHBlcmltZW50Q29kZSlcbiAgICAgICAgICA6IFwiXCIpO1xuICAgICAgY29uc3Qgc2FtcGxlSGFzQ3VycmVudEV4cGVyaW1lbnRIaXN0b3J5ID0gQm9vbGVhbihjdXJyZW50RXhwZXJpbWVudEhpc3RvcnlTdGF0dXMpO1xuICAgICAgY29uc3QgY3VycmVudEV4cGVyaW1lbnRIaXN0b3J5UmFuayA9IHJlc29sdmVMYWJvcmF0b3J5U3RhdHVzUmFuayhjdXJyZW50RXhwZXJpbWVudEhpc3RvcnlTdGF0dXMpO1xuICAgICAgY29uc3QgY3VycmVudEV4cGVyaW1lbnRQcm9ncmVzc0lzQXV0aG9yaXRhdGl2ZSA9IHNhbXBsZUhhc0N1cnJlbnRFeHBlcmltZW50SGlzdG9yeSAmJiBjdXJyZW50RXhwZXJpbWVudEhpc3RvcnlSYW5rID4gMDtcbiAgICAgIGNvbnN0IGVmZmVjdGl2ZVRhcmdldExhYiA9IGN1cnJlbnRFeHBlcmltZW50UHJvZ3Jlc3NJc0F1dGhvcml0YXRpdmUgPyBkZXZpY2UgOiByZXN0b3JlZFRhcmdldExhYjtcbiAgICAgIGNvbnN0IGVmZmVjdGl2ZVRhcmdldEV4cGVyaW1lbnRDb2RlID0gY3VycmVudEV4cGVyaW1lbnRQcm9ncmVzc0lzQXV0aG9yaXRhdGl2ZSA/IGN1cnJlbnRFeHBlcmltZW50Q29kZSA6IHJlc3RvcmVkVGFyZ2V0RXhwZXJpbWVudENvZGU7XG4gICAgICBwdXNoUm93KFxyXG4gICAgICAgIHRyYXlDb2RlLFxyXG4gICAgICAgIHNhbXBsZUNvZGUsXHJcbiAgICAgICAgcXVhbnRpdHksXHJcbiAgICAgICAgb3duZXIsXHJcbiAgICAgICAgbG9jYXRpb24sXHJcbiAgICAgICAgdHJheT8uZml4dHVyZVJlYWR5ID8/IHRyYXk/LmZpeHR1cmVfcmVhZHksXHJcbiAgICAgICAgZWZmZWN0aXZlVGFyZ2V0TGFiLFxyXG4gICAgICAgIGVmZmVjdGl2ZVRhcmdldEV4cGVyaW1lbnRDb2RlLFxyXG4gICAgICAgIHNhbXBsZUhhc0N1cnJlbnRFeHBlcmltZW50SGlzdG9yeSxcclxuICAgICAgKTtcclxuICAgICAgY29uc3Qgcm93ID0gdHJheVJvd3NbaW5kZXhCeVRyYXlDb2RlLmdldCh0cmF5Q29kZSldO1xyXG4gICAgICBjb25zdCBjb21wbGV0ZWRFeHBlcmltZW50Q29kZXMgPSBjb21wbGV0ZWRFeHBlcmltZW50Q29kZXNCeVRyYXlDb2RlLmdldCh0cmF5Q29kZSkgfHwgbmV3IFNldCgpO1xyXG4gICAgICBjb25zdCBjb21wbGV0ZWRFeHBlcmltZW50UmVjb3JkQ29kZXMgPSBjb21wbGV0ZWRFeHBlcmltZW50UmVjb3JkQ29kZXNCeVRyYXlDb2RlLmdldCh0cmF5Q29kZSkgfHwgbmV3IFNldCgpO1xyXG4gICAgICByb3cuY29tcGxldGVkRXhwZXJpbWVudENvZGVzID0gdW5pcXVlVmFsdWVzKFtcclxuICAgICAgICAuLi5hc0FycmF5KHJvdy5jb21wbGV0ZWRFeHBlcmltZW50Q29kZXMpLFxyXG4gICAgICAgIC4uLkFycmF5LmZyb20oY29tcGxldGVkRXhwZXJpbWVudENvZGVzKSxcclxuICAgICAgICAuLi5BcnJheS5mcm9tKGNvbXBsZXRlZEV4cGVyaW1lbnRSZWNvcmRDb2RlcyksXHJcbiAgICAgIF0pO1xyXG4gICAgICByb3cuY29tcGxldGVkRm9yQ3VycmVudEV4cGVyaW1lbnQgPVxuICAgICAgICByb3cuY29tcGxldGVkRm9yQ3VycmVudEV4cGVyaW1lbnRcbiAgICAgICAgfHwgKFxuICAgICAgICAgIGN1cnJlbnRTY2hlZHVsZUlzQXhpc1N1YkV4cGVyaW1lbnRcbiAgICAgICAgICAgID8gY29tcGxldGVkQ3VycmVudFNjaGVkdWxlVHJheUNvZGVzLmhhcyh0cmF5Q29kZSlcbiAgICAgICAgICAgIDogKFxuICAgICAgICAgICAgICAgIGNvbXBsZXRlZEV4cGVyaW1lbnRDb2Rlcy5oYXMoY3VycmVudEV4cGVyaW1lbnRDb2RlKVxuICAgICAgICAgICAgICAgIHx8IGNvbXBsZXRlZEV4cGVyaW1lbnRSZWNvcmRDb2Rlcy5oYXMoY3VycmVudEV4cGVyaW1lbnRDb2RlKVxuICAgICAgICAgICAgICAgIHx8IGV4cGVyaW1lbnRJc0NvbXBsZXRlZEluU2FtcGxlSGlzdG9yeSh7IGV4cGVyaW1lbnROYW1lLCBzYW1wbGUsIHRhc2tDb2RlLCB0cmF5Q29kZSB9KVxuICAgICAgICAgICAgICApXG4gICAgICAgICk7XG4gICAgICByb3cuY29tcGxldGVkRm9yT3RoZXJFeHBlcmltZW50ID1cclxuICAgICAgICByb3cuY29tcGxldGVkRm9yT3RoZXJFeHBlcmltZW50XHJcbiAgICAgICAgfHwgYXNBcnJheShyb3c/LmV4cGVyaW1lbnRDb2Rlcykuc29tZSgoZXhwZXJpbWVudENvZGUpID0+XHJcbiAgICAgICAgICBleHBlcmltZW50Q29kZSAhPT0gY3VycmVudEV4cGVyaW1lbnRDb2RlXHJcbiAgICAgICAgICAmJiAoY29tcGxldGVkRXhwZXJpbWVudENvZGVzLmhhcyhleHBlcmltZW50Q29kZSkgfHwgY29tcGxldGVkRXhwZXJpbWVudFJlY29yZENvZGVzLmhhcyhleHBlcmltZW50Q29kZSkpLFxyXG4gICAgICAgIClcclxuICAgICAgICB8fCBCb29sZWFuKHJlc29sdmVQcmV2aW91c0NvbXBsZXRlZEV4cGVyaW1lbnRTbmFwc2hvdChzYW1wbGUsIHRhc2tDb2RlLCBleHBlcmltZW50TmFtZSkpO1xyXG4gICAgICByb3cuaGFzQ3VycmVudEV4cGVyaW1lbnRIaXN0b3J5ID1cclxuICAgICAgICByb3cuaGFzQ3VycmVudEV4cGVyaW1lbnRIaXN0b3J5XHJcbiAgICAgICAgfHwgc2FtcGxlSGFzQ3VycmVudEV4cGVyaW1lbnRIaXN0b3J5O1xyXG4gICAgICBpZiAoY3VycmVudEV4cGVyaW1lbnRIaXN0b3J5U3RhdHVzKSB7XHJcbiAgICAgICAgcm93LmN1cnJlbnRFeHBlcmltZW50SGlzdG9yeVN0YXR1cyA9IGN1cnJlbnRFeHBlcmltZW50SGlzdG9yeVN0YXR1cztcclxuICAgICAgfVxuICAgICAgY29uc3QgY3VycmVudFJhbmsgPSByZXNvbHZlTGFib3JhdG9yeVN0YXR1c1Jhbmsocm93Py50cmF5U3RhdHVzKTtcbiAgICAgIGNvbnN0IG5leHRTdGF0dXMgPSBwaHlzaWNhbFRyYXlTdGF0dXNcbiAgICAgICAgPyByZXNvbHZlQ3VycmVudEV4cGVyaW1lbnRUcmF5U3RhdHVzKHtcclxuICAgICAgICAgICAgY29tcGxldGVkRm9yQ3VycmVudEV4cGVyaW1lbnQ6IHJvdy5jb21wbGV0ZWRGb3JDdXJyZW50RXhwZXJpbWVudCxcclxuICAgICAgICAgICAgY29tcGxldGVkRm9yT3RoZXJFeHBlcmltZW50OiByb3cuY29tcGxldGVkRm9yT3RoZXJFeHBlcmltZW50LFxyXG4gICAgICAgICAgICBjdXJyZW50RXhwZXJpbWVudENvZGUsXHJcbiAgICAgICAgICAgIGRldmljZSxcbiAgICAgICAgICAgIGV4cGVyaW1lbnRDb2Rlczogcm93Py5leHBlcmltZW50Q29kZXMsXG4gICAgICAgICAgICBleHBlcmltZW50TmFtZSxcbiAgICAgICAgICAgIGhpc3RvcnlTdGF0dXM6IGN1cnJlbnRFeHBlcmltZW50SGlzdG9yeVN0YXR1cyxcbiAgICAgICAgICAgIHBoeXNpY2FsU3RhdHVzOiBwaHlzaWNhbFRyYXlTdGF0dXMsXG4gICAgICAgICAgICBzYW1wbGUsXG4gICAgICAgICAgICB0YXJnZXRFeHBlcmltZW50Q29kZTogZWZmZWN0aXZlVGFyZ2V0RXhwZXJpbWVudENvZGUsXG4gICAgICAgICAgICB0YXJnZXRMYWI6IGVmZmVjdGl2ZVRhcmdldExhYixcbiAgICAgICAgICAgIHRhc2tDb2RlLFxyXG4gICAgICAgICAgICB0cmF5Q29kZTogcm93LnRyYXlDb2RlLFxyXG4gICAgICAgICAgfSlcclxuICAgICAgICA6IFwiXCI7XHJcbiAgICAgIGNvbnN0IGRpc3BsYXlTdGF0dXNDYW5kaWRhdGUgPSByZXNvbHZlQ3VycmVudEV4cGVyaW1lbnRUcmF5U3RhdHVzKHtcclxuICAgICAgICBjb21wbGV0ZWRGb3JDdXJyZW50RXhwZXJpbWVudDogcm93LmNvbXBsZXRlZEZvckN1cnJlbnRFeHBlcmltZW50LFxyXG4gICAgICAgIGNvbXBsZXRlZEZvck90aGVyRXhwZXJpbWVudDogcm93LmNvbXBsZXRlZEZvck90aGVyRXhwZXJpbWVudCxcclxuICAgICAgICBjdXJyZW50RXhwZXJpbWVudENvZGUsXHJcbiAgICAgICAgZGV2aWNlLFxuICAgICAgICBleHBlcmltZW50Q29kZXM6IHJvdz8uZXhwZXJpbWVudENvZGVzLFxuICAgICAgICBleHBlcmltZW50TmFtZSxcbiAgICAgICAgaGlzdG9yeVN0YXR1czogY3VycmVudEV4cGVyaW1lbnRIaXN0b3J5U3RhdHVzLFxuICAgICAgICBwaHlzaWNhbFN0YXR1czogcGh5c2ljYWxUcmF5U3RhdHVzLFxuICAgICAgICBzYW1wbGUsXG4gICAgICAgIHRhcmdldEV4cGVyaW1lbnRDb2RlOiBlZmZlY3RpdmVUYXJnZXRFeHBlcmltZW50Q29kZSxcbiAgICAgICAgdGFyZ2V0TGFiOiBlZmZlY3RpdmVUYXJnZXRMYWIsXHJcbiAgICAgICAgdGFza0NvZGUsXHJcbiAgICAgICAgdHJheUNvZGU6IHJvdy50cmF5Q29kZSxcclxuICAgICAgfSk7XHJcbiAgICAgIGlmIChjdXJyZW50RXhwZXJpbWVudFByb2dyZXNzSXNBdXRob3JpdGF0aXZlKSB7XHJcbiAgICAgICAgcm93LnRhcmdldExhYiA9IGVmZmVjdGl2ZVRhcmdldExhYjtcclxuICAgICAgICByb3cudGFyZ2V0RXhwZXJpbWVudENvZGUgPSBlZmZlY3RpdmVUYXJnZXRFeHBlcmltZW50Q29kZTtcclxuICAgICAgfVxyXG4gICAgICBpZiAocmVzb2x2ZUxhYm9yYXRvcnlTdGF0dXNSYW5rKG5leHRTdGF0dXMpID49IGN1cnJlbnRSYW5rKSB7XHJcbiAgICAgICAgcm93LnRyYXlTdGF0dXMgPSBuZXh0U3RhdHVzO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChwaHlzaWNhbFRyYXlTdGF0dXMgPT09IExBQl9SRVNFVF9TVEFUVVMgJiYgZWZmZWN0aXZlVGFyZ2V0TGFiKSB7XHJcbiAgICAgICAgcm93LmN1cnJlbnRMb2NhdGlvbiA9IGVmZmVjdGl2ZVRhcmdldExhYjtcclxuICAgICAgICByb3cubGlmZWN5Y2xlTG9jYXRpb24gPSBlZmZlY3RpdmVUYXJnZXRMYWI7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgY3VycmVudERpc3BsYXlSYW5rID0gcmVzb2x2ZUxhYm9yYXRvcnlTdGF0dXNSYW5rKHJvdz8uZGlzcGxheVN0YXR1cyk7XHJcbiAgICAgIGlmIChyZXNvbHZlTGFib3JhdG9yeVN0YXR1c1JhbmsoZGlzcGxheVN0YXR1c0NhbmRpZGF0ZSkgPj0gY3VycmVudERpc3BsYXlSYW5rKSB7XHJcbiAgICAgICAgcm93LmRpc3BsYXlTdGF0dXMgPSBkaXNwbGF5U3RhdHVzQ2FuZGlkYXRlO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IGxpZmVjeWNsZUxvY2F0aW9uID0gcGh5c2ljYWxUcmF5U3RhdHVzID09PSBMQUJfUkVTRVRfU1RBVFVTICYmIGVmZmVjdGl2ZVRhcmdldExhYiA/IGVmZmVjdGl2ZVRhcmdldExhYiA6IGxvY2F0aW9uO1xyXG4gICAgICBjb25zdCBsaWZlY3ljbGVDYW5kaWRhdGUgPSByZXNvbHZlVW5pZmllZFRyYXlMaWZlY3ljbGVDYW5kaWRhdGUoe1xyXG4gICAgICAgIGxvY2F0aW9uOiBsaWZlY3ljbGVMb2NhdGlvbixcclxuICAgICAgICBzYW1wbGUsXHJcbiAgICAgICAgdHJheSxcclxuICAgICAgICB0cmF5Q29kZTogcm93LnRyYXlDb2RlLFxyXG4gICAgICB9KTtcclxuICAgICAgaWYgKHNob3VsZFJlcGxhY2VVbmlmaWVkVHJheUxpZmVjeWNsZShyb3csIGxpZmVjeWNsZUNhbmRpZGF0ZSkpIHtcclxuICAgICAgICByb3cubGlmZWN5Y2xlTG9jYXRpb24gPSBsaWZlY3ljbGVDYW5kaWRhdGUubG9jYXRpb24gfHwgcm93LmN1cnJlbnRMb2NhdGlvbjtcclxuICAgICAgICByb3cubGlmZWN5Y2xlU3RhdHVzID0gbGlmZWN5Y2xlQ2FuZGlkYXRlLnN0YXR1cztcclxuICAgICAgICByb3cubGlmZWN5Y2xlVGltZSA9IGxpZmVjeWNsZUNhbmRpZGF0ZS50aW1lIHx8IDA7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICByZXR1cm4gdHJheVJvd3M7XHJcbn07XHJcblxyXG5jb25zdCBidWlsZExhYm9yYXRvcnlTY2hlZHVsZVJvdyA9ICh7XG4gIGV4cGVyaW1lbnRNYXAsXG4gIGV4cGVyaW1lbnRSZWNvcmRNYXAsXG4gIGV4cGVyaW1lbnRSdW5zLFxuICBleHBlcmltZW50UnVuU3RlcHMsXG4gIGV4cGVyaW1lbnRSdW5UcmF5cyxcbiAgZXhwZXJpbWVudFRyYXlDb2RlTWFwLFxuICBzYW1wbGVNYXAsXG4gIHNjaGVkdWxlLFxuICB0YXNrTWFwLFxufSkgPT4ge1xuICBjb25zdCB0YXNrQ29kZSA9IG5vcm1hbGl6ZVRleHQoc2NoZWR1bGU/LnRhc2tfY29kZSk7XHJcbiAgY29uc3QgZXhwZXJpbWVudENvZGUgPSBub3JtYWxpemVUZXh0KHNjaGVkdWxlPy5leHBlcmltZW50X2NvZGUpO1xyXG4gIGNvbnN0IHRhc2sgPSB0YXNrTWFwLmdldCh0YXNrQ29kZSkgfHwgbnVsbDtcclxuICBjb25zdCByZWxhdGVkU2FtcGxlcyA9IHNhbXBsZU1hcC5nZXQodGFza0NvZGUpIHx8IFtdO1xyXG4gIGNvbnN0IGV4cGVyaW1lbnRLZXkgPSBgJHt0YXNrQ29kZX06OiR7ZXhwZXJpbWVudENvZGV9YDtcclxuICBjb25zdCBleHBlcmltZW50ID0gZXhwZXJpbWVudFJlY29yZE1hcC5nZXQoZXhwZXJpbWVudEtleSkgfHwgbnVsbDtcclxuICBjb25zdCBvd25lciA9IG5vcm1hbGl6ZVRleHQocmVsYXRlZFNhbXBsZXNbMF0/Lm93bmVyKSB8fCBcIi1cIjtcclxuICBjb25zdCBleHBlcmltZW50TmFtZSA9XG4gICAgbm9ybWFsaXplVGV4dChleHBlcmltZW50Py5leHBlcmltZW50X25hbWUpXG4gICAgfHwgbm9ybWFsaXplVGV4dChleHBlcmltZW50TWFwLmdldChleHBlcmltZW50S2V5KSlcbiAgICB8fCBub3JtYWxpemVUZXh0KHRhc2s/LnRlc3RfdHlwZSlcbiAgICB8fCBub3JtYWxpemVUZXh0KHRhc2s/Lm5hbWUpXG4gICAgfHwgXCItXCI7XG4gIGNvbnN0IHN0YXJ0QXQgPSBTdHJpbmcoc2NoZWR1bGU/LnN0YXJ0X2F0IHx8IFwiXCIpO1xuICBjb25zdCBlbmRBdCA9IFN0cmluZyhzY2hlZHVsZT8uZW5kX2F0IHx8IFwiXCIpO1xuICBjb25zdCBzY2hlZHVsZUlkID0gbm9ybWFsaXplVGV4dChzY2hlZHVsZT8uaWQpIHx8IGAke3Rhc2tDb2RlfS0ke2V4cGVyaW1lbnRDb2RlfS0ke3N0YXJ0QXR9YDtcbiAgY29uc3QgYXhpc1Byb2dyZXNzID0gYnVpbGRBeGlzUHJvZ3Jlc3NGb3JTY2hlZHVsZSh7XG4gICAgZXhwZXJpbWVudCxcbiAgICBleHBlcmltZW50TmFtZSxcbiAgICBleHBlcmltZW50UnVucyxcbiAgICBleHBlcmltZW50UnVuU3RlcHMsXG4gICAgc2NoZWR1bGUsXG4gIH0pO1xuICBjb25zdCBkZXZpY2UgPSBub3JtYWxpemVUZXh0KHNjaGVkdWxlPy5kZXZpY2UpIHx8IFNBTFRfU1BSQVlfTEFCO1xuICBjb25zdCBsYWJDb2RlID0gbm9ybWFsaXplVGV4dChzY2hlZHVsZT8ubGFiX2NvZGUgfHwgc2NoZWR1bGU/LmxhYkNvZGUpO1xuICBjb25zdCBzdWJFeHBlcmltZW50Q29kZSA9IHJlc29sdmVTdWJFeHBlcmltZW50Q29kZShzY2hlZHVsZSk7XG4gIGNvbnN0IHNjaGVkdWxlSXNBeGlzU3ViRXhwZXJpbWVudCA9IEJvb2xlYW4oXG4gICAgc3ViRXhwZXJpbWVudENvZGVcbiAgICAmJiBub3JtYWxpemVBeGlzQ29kZXMoc2NoZWR1bGU/LmF4aXNfY29kZXMgPz8gc2NoZWR1bGU/LmF4aXNDb2RlcykubGVuZ3RoID4gMCxcbiAgKTtcbiAgY29uc3QgY29tcGxldGVkU2NoZWR1bGVUcmF5Q29kZXMgPSBzY2hlZHVsZUlzQXhpc1N1YkV4cGVyaW1lbnRcbiAgICA/IGJ1aWxkQ29tcGxldGVkU2NoZWR1bGVUcmF5Q29kZVNldCh7IGV4cGVyaW1lbnRSdW5zLCBleHBlcmltZW50UnVuVHJheXMsIHNjaGVkdWxlIH0pXG4gICAgOiBuZXcgU2V0KCk7XG4gIGNvbnN0IHRyYXlSb3dzID0gY29sbGVjdFRyYXlSb3dzKHtcbiAgICBkZXZpY2UsXG4gICAgZXhwZXJpbWVudE5hbWUsXG4gICAgZXhwZXJpbWVudFJlY29yZE1hcCxcbiAgICBleHBlcmltZW50UnVucyxcbiAgICBleHBlcmltZW50UnVuVHJheXMsXG4gICAgZXhwZXJpbWVudFRyYXlDb2RlTWFwLFxuICAgIGV4cGVyaW1lbnRLZXksXG4gICAgcmVsYXRlZFNhbXBsZXMsXG4gICAgc2NoZWR1bGUsXG4gICAgdGFza0NvZGUsXG4gIH0pO1xuICBjb25zdCBhY3RpdmVSdW4gPSBmaW5kQWN0aXZlRXhwZXJpbWVudFJ1bih7XG4gICAgZGV2aWNlLFxuICAgIGV4cGVyaW1lbnRDb2RlLFxuICAgIGV4cGVyaW1lbnRSdW5zLFxuICAgIHNjaGVkdWxlSWQsXG4gICAgdGFza0NvZGUsXG4gIH0pO1xuICBjb25zdCBhY3RpdmVSdW5UcmF5UmVsYXRpb25zID0gZmluZEFjdGl2ZUV4cGVyaW1lbnRSdW5UcmF5UmVsYXRpb25zKHtcbiAgICBkZXZpY2UsXG4gICAgZXhwZXJpbWVudENvZGUsXG4gICAgZXhwZXJpbWVudFJ1bnMsXG4gICAgZXhwZXJpbWVudFJ1blRyYXlzLFxuICAgIHNjaGVkdWxlSWQsXG4gICAgdGFza0NvZGUsXG4gIH0pO1xuICBjb25zdCBhY3RpdmVSdW5UcmF5Q29kZXMgPSBhY3RpdmVSdW5UcmF5UmVsYXRpb25zLmxlbmd0aCA+IDBcclxuICAgID8gdW5pcXVlVmFsdWVzKGFjdGl2ZVJ1blRyYXlSZWxhdGlvbnMubWFwKHJlc29sdmVSZWxhdGlvblRyYXlDb2RlKSlcclxuICAgIDogdW5pcXVlVmFsdWVzKGFzQXJyYXkoYWN0aXZlUnVuPy50cmF5X2NvZGVzKS5tYXAoKHRyYXlDb2RlKSA9PiBub3JtYWxpemVUZXh0KHRyYXlDb2RlKSkpO1xyXG4gIGNvbnN0IGRpc3BsYXlTdGFydEF0ID0gbm9ybWFsaXplVGV4dChhY3RpdmVSdW5UcmF5UmVsYXRpb25zWzBdPy5zdGFydGVkX2F0IHx8IGFjdGl2ZVJ1blRyYXlSZWxhdGlvbnNbMF0/LnN0YXJ0ZWRBdCkgfHwgbm9ybWFsaXplVGV4dChhY3RpdmVSdW4/LnN0YXJ0ZWRfYXQpIHx8IHN0YXJ0QXQ7XHJcbiAgY29uc3QgZXN0aW1hdGVkRW5kQXQgPSBhZGREdXJhdGlvblRvRGF0ZVRpbWUoZGlzcGxheVN0YXJ0QXQsIHJlc29sdmVQbGFubmVkRHVyYXRpb25NcyhzY2hlZHVsZSwgYWN0aXZlUnVuKSk7XHJcbiAgY29uc3QgZGlzcGxheUVuZEF0ID0gZXN0aW1hdGVkRW5kQXQgfHwgbm9ybWFsaXplVGV4dChhY3RpdmVSdW4/LnBsYW5uZWRfZW5kX2F0KSB8fCBub3JtYWxpemVUZXh0KGFjdGl2ZVJ1bj8uZW5kZWRfYXQpIHx8IGVuZEF0O1xyXG4gIGNvbnN0IGFjdGl2ZVJ1blN0YXR1cyA9IGFjdGl2ZVJ1blRyYXlSZWxhdGlvbnMubGVuZ3RoID4gMCB8fCBSVU5OSU5HX0VYUEVSSU1FTlRfUlVOX1NUQVRVU0VTLmhhcyhub3JtYWxpemVUZXh0KGFjdGl2ZVJ1bj8uc3RhdHVzKSkgPyBcIuWunumqjOi/m+ihjOS4rVwiIDogXCJcIjtcclxuICBpZiAoYWN0aXZlUnVuU3RhdHVzKSB7XG4gICAgdHJheVJvd3MuZm9yRWFjaCgocm93KSA9PiB7XG4gICAgICBpZiAoYWN0aXZlUnVuVHJheUNvZGVzLmxlbmd0aCA+IDAgJiYgIWFjdGl2ZVJ1blRyYXlDb2Rlcy5pbmNsdWRlcyhub3JtYWxpemVUZXh0KHJvdz8udHJheUNvZGUpKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAoQ09NUExFVEVEX0VYUEVSSU1FTlRfU1RBVFVTRVMuaGFzKG5vcm1hbGl6ZVRleHQocm93Py50cmF5U3RhdHVzKSkpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgcm93LmRpc3BsYXlTdGF0dXMgPSBhY3RpdmVSdW5TdGF0dXM7XHJcbiAgICAgIHJvdy5saWZlY3ljbGVTdGF0dXMgPSBhY3RpdmVSdW5TdGF0dXM7XHJcbiAgICAgIHJvdy50cmF5U3RhdHVzID0gYWN0aXZlUnVuU3RhdHVzO1xuICAgIH0pO1xuICB9XG4gIGlmIChheGlzUHJvZ3Jlc3M/LnJlbWFpbmluZ0F4aXNDb2Rlcz8ubGVuZ3RoID4gMCkge1xuICAgIHRyYXlSb3dzLmZvckVhY2goKHJvdykgPT4ge1xuICAgICAgcm93LmNvbXBsZXRlZEZvckN1cnJlbnRFeHBlcmltZW50ID0gZmFsc2U7XG4gICAgICByb3cuY29tcGxldGVkRXhwZXJpbWVudENvZGVzID0gYXNBcnJheShyb3cuY29tcGxldGVkRXhwZXJpbWVudENvZGVzKS5maWx0ZXIoKGNvZGUpID0+IG5vcm1hbGl6ZVRleHQoY29kZSkgIT09IGV4cGVyaW1lbnRDb2RlKTtcbiAgICAgIGlmIChcbiAgICAgICAgQ09NUExFVEVEX0VYUEVSSU1FTlRfU1RBVFVTRVMuaGFzKG5vcm1hbGl6ZVRleHQocm93Py50cmF5U3RhdHVzKSlcbiAgICAgICAgfHwgQ09NUExFVEVEX0VYUEVSSU1FTlRfU1RBVFVTRVMuaGFzKG5vcm1hbGl6ZVRleHQocm93Py5kaXNwbGF5U3RhdHVzKSlcbiAgICAgICAgfHwgQ09NUExFVEVEX0VYUEVSSU1FTlRfU1RBVFVTRVMuaGFzKG5vcm1hbGl6ZVRleHQocm93Py5saWZlY3ljbGVTdGF0dXMpKVxuICAgICAgKSB7XG4gICAgICAgIHJvdy50cmF5U3RhdHVzID0gTEFCX1JFU0VUX1NUQVRVUztcbiAgICAgICAgcm93LmRpc3BsYXlTdGF0dXMgPSBMQUJfUkVTRVRfU1RBVFVTO1xuICAgICAgICByb3cubGlmZWN5Y2xlU3RhdHVzID0gTEFCX1JFU0VUX1NUQVRVUztcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuICBjb25zdCBjb21wbGV0ZWRSdW5UcmF5Q29kZXMgPSBuZXcgU2V0KFxuICAgIHNjaGVkdWxlSXNBeGlzU3ViRXhwZXJpbWVudFxuICAgICAgPyBBcnJheS5mcm9tKGNvbXBsZXRlZFNjaGVkdWxlVHJheUNvZGVzKVxuICAgICAgOiBheGlzUHJvZ3Jlc3M/LnJlbWFpbmluZ0F4aXNDb2Rlcz8ubGVuZ3RoID4gMFxuICAgICAgICA/IFtdXG4gICAgICAgIDogYXNBcnJheShleHBlcmltZW50UnVuVHJheXMpXG4gICAgICAgIC5maWx0ZXIoKHJlbGF0aW9uKSA9PlxuICAgICAgICAgIHJlc29sdmVSZWxhdGlvblRhc2tDb2RlKHJlbGF0aW9uKSA9PT0gdGFza0NvZGVcbiAgICAgICAgICAmJiByZXNvbHZlUmVsYXRpb25FeHBlcmltZW50Q29kZShyZWxhdGlvbikgPT09IGV4cGVyaW1lbnRDb2RlXG4gICAgICAgICAgJiYgcmVsYXRpb25Jc0NvbXBsZXRlZChyZWxhdGlvbiksXG4gICAgICAgIClcbiAgICAgICAgLm1hcChyZXNvbHZlUmVsYXRpb25UcmF5Q29kZSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKSxcbiAgKTtcbiAgY29uc3QgcmV0dXJuZWRSdW5UcmF5Q29kZXMgPSBuZXcgU2V0KFxyXG4gICAgYXNBcnJheShleHBlcmltZW50UnVuVHJheXMpXHJcbiAgICAgIC5maWx0ZXIoKHJlbGF0aW9uKSA9PlxyXG4gICAgICAgIHJlc29sdmVSZWxhdGlvblRhc2tDb2RlKHJlbGF0aW9uKSA9PT0gdGFza0NvZGVcclxuICAgICAgICAmJiByZXNvbHZlUmVsYXRpb25FeHBlcmltZW50Q29kZShyZWxhdGlvbikgPT09IGV4cGVyaW1lbnRDb2RlXHJcbiAgICAgICAgJiYgbm9ybWFsaXplVGV4dChyZXNvbHZlUmVsYXRpb25TdGF0dXMocmVsYXRpb24pKSA9PT0gXCLljoLlrrbmlLblm55cIixcclxuICAgICAgKVxyXG4gICAgICAubWFwKHJlc29sdmVSZWxhdGlvblRyYXlDb2RlKVxyXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pLFxyXG4gICk7XHJcbiAgdHJheVJvd3MuZm9yRWFjaCgocm93KSA9PiB7XHJcbiAgICBjb25zdCBhY3RpdmVPdGhlckV4cGVyaW1lbnRSdW5zID0gYnVpbGRBY3RpdmVPdGhlckV4cGVyaW1lbnRSdW5Mb2Nrcyh7XHJcbiAgICAgIGN1cnJlbnRFeHBlcmltZW50Q29kZTogZXhwZXJpbWVudENvZGUsXHJcbiAgICAgIGV4cGVyaW1lbnRNYXAsXHJcbiAgICAgIGV4cGVyaW1lbnRSdW5zLFxyXG4gICAgICBleHBlcmltZW50UnVuVHJheXMsXHJcbiAgICAgIHRhc2tDb2RlLFxyXG4gICAgICB0cmF5Q29kZTogcm93Py50cmF5Q29kZSxcclxuICAgIH0pO1xyXG4gICAgcm93LmFjdGl2ZU90aGVyRXhwZXJpbWVudFJ1bnMgPSBhY3RpdmVPdGhlckV4cGVyaW1lbnRSdW5zO1xyXG4gICAgcm93LmFjdGl2ZU90aGVyRXhwZXJpbWVudFJ1biA9IGFjdGl2ZU90aGVyRXhwZXJpbWVudFJ1bnNbMF0gfHwgbnVsbDtcclxuXHJcbiAgICBpZiAoIWNvbXBsZXRlZFJ1blRyYXlDb2Rlcy5oYXMobm9ybWFsaXplVGV4dChyb3c/LnRyYXlDb2RlKSkpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgcm93LmNvbXBsZXRlZEZvckN1cnJlbnRFeHBlcmltZW50ID0gdHJ1ZTtcclxuICAgIHJvdy5jb21wbGV0ZWRFeHBlcmltZW50Q29kZXMgPSB1bmlxdWVWYWx1ZXMoWy4uLmFzQXJyYXkocm93LmNvbXBsZXRlZEV4cGVyaW1lbnRDb2RlcyksIGV4cGVyaW1lbnRDb2RlXSk7XHJcbiAgICByb3cuZGlzcGxheVN0YXR1cyA9IEVYUEVSSU1FTlRfQ09NUExFVEVEX1NUQVRVUztcclxuICAgIHJvdy5saWZlY3ljbGVTdGF0dXMgPSBFWFBFUklNRU5UX0NPTVBMRVRFRF9TVEFUVVM7XHJcbiAgICByb3cudHJheVN0YXR1cyA9IEVYUEVSSU1FTlRfQ09NUExFVEVEX1NUQVRVUztcclxuICB9KTtcclxuICBjb25zdCB2aXNpYmxlVHJheVJvd3MgPSB0cmF5Um93cy5maWx0ZXIoKHJvdykgPT5cbiAgICByb3c/LmNvbXBsZXRlZEZvckN1cnJlbnRFeHBlcmltZW50ICE9PSB0cnVlXG4gICAgJiYgIWNvbXBsZXRlZFJ1blRyYXlDb2Rlcy5oYXMobm9ybWFsaXplVGV4dChyb3c/LnRyYXlDb2RlKSlcbiAgICAmJiAhcm93SGFzUmV0dXJuZWRTdGF0dXMocm93KSxcbiAgKTtcblxyXG4gIHJldHVybiB7XG4gICAgYWN0aXZlUnVuVHJheUNvZGVzLFxuICAgIGFsbFRyYXlDb2RlczogdHJheVJvd3NcbiAgICAgIC5maWx0ZXIoKHJvdykgPT4gIXJldHVybmVkUnVuVHJheUNvZGVzLmhhcyhub3JtYWxpemVUZXh0KHJvdz8udHJheUNvZGUpKSAmJiAhcm93SGFzUmV0dXJuZWRTdGF0dXMocm93KSlcbiAgICAgIC5tYXAoKHJvdykgPT4gcm93LnRyYXlDb2RlKSxcbiAgICBhbGxUcmF5Um93czogdHJheVJvd3MsXG4gICAgYXhpc0JhdGNoTm86IG5vcm1hbGl6ZVRleHQoc2NoZWR1bGU/LmF4aXNfYmF0Y2hfbm8gPz8gc2NoZWR1bGU/LmF4aXNCYXRjaE5vKSxcbiAgICBheGlzQ29kZXM6IG5vcm1hbGl6ZUF4aXNDb2RlcyhzY2hlZHVsZT8uYXhpc19jb2RlcyA/PyBzY2hlZHVsZT8uYXhpc0NvZGVzKSxcbiAgICBheGlzUHJvZ3Jlc3MsXG4gICAgYXhpc19iYXRjaF9ubzogbm9ybWFsaXplVGV4dChzY2hlZHVsZT8uYXhpc19iYXRjaF9ubyA/PyBzY2hlZHVsZT8uYXhpc0JhdGNoTm8pLFxuICAgIGF4aXNfY29kZXM6IG5vcm1hbGl6ZUF4aXNDb2RlcyhzY2hlZHVsZT8uYXhpc19jb2RlcyA/PyBzY2hlZHVsZT8uYXhpc0NvZGVzKSxcbiAgICBkZXZpY2UsXG4gICAgZW5kQXQ6IGRpc3BsYXlFbmRBdCxcbiAgICBlbmRUaW1lTGFiZWw6IGZvcm1hdFRpbWUoZGlzcGxheUVuZEF0KSxcbiAgICBleHBlcmltZW50Q29kZSxcclxuICAgIGV4cGVyaW1lbnRLZXksXHJcbiAgICBleHBlcmltZW50TmFtZSxcclxuICAgIGlkOiBzY2hlZHVsZUlkLFxuICAgIGxhYkNvZGUsXHJcbiAgICBvd25lcixcclxuICAgIHNhbXBsZUNvdW50OiB2aXNpYmxlVHJheVJvd3MucmVkdWNlKChjb3VudCwgcm93KSA9PiBjb3VudCArIE1hdGgubWF4KDEsIHJvdy5zYW1wbGVDb2Rlcy5sZW5ndGggfHwgMCksIDApIHx8IHZpc2libGVUcmF5Um93cy5sZW5ndGgsXHJcbiAgICBydW5ObzpcclxuICAgICAgbm9ybWFsaXplVGV4dChhY3RpdmVSdW4/LnJ1bl9ubylcclxuICAgICAgfHwgbm9ybWFsaXplVGV4dChhY3RpdmVSdW4/LmlkKVxyXG4gICAgICB8fCBub3JtYWxpemVUZXh0KGFjdGl2ZVJ1blRyYXlSZWxhdGlvbnNbMF0/LnJ1bl9ubylcclxuICAgICAgfHwgbm9ybWFsaXplVGV4dChhY3RpdmVSdW5UcmF5UmVsYXRpb25zWzBdPy5ydW5ObyksXHJcbiAgICBzdGFydEF0OiBkaXNwbGF5U3RhcnRBdCxcclxuICAgIHN0YXJ0RGF0ZVRpbWVMYWJlbDogZm9ybWF0RGF0ZVRpbWUoZGlzcGxheVN0YXJ0QXQpLFxuICAgIHN0YXJ0VGltZUxhYmVsOiBmb3JtYXRUaW1lKGRpc3BsYXlTdGFydEF0KSxcbiAgICBzdGF0dXM6IG5vcm1hbGl6ZVRleHQoZXhwZXJpbWVudD8uc3RhdHVzKSxcbiAgICBzdWJFeHBlcmltZW50Q29kZSxcbiAgICBzdWJfZXhwZXJpbWVudF9jb2RlOiBzdWJFeHBlcmltZW50Q29kZSxcbiAgICB0YXNrQ29kZSxcbiAgICB0YXNrTmFtZTogbm9ybWFsaXplVGV4dCh0YXNrPy5uYW1lKSB8fCB0YXNrQ29kZSB8fCBcIi1cIixcclxuICAgIGRhdGVUaW1lUmFuZ2U6IGAke2Zvcm1hdERhdGVUaW1lKGRpc3BsYXlTdGFydEF0KX0gLSAke2Zvcm1hdERhdGVUaW1lKGRpc3BsYXlFbmRBdCl9YCxcclxuICAgIHRpbWVSYW5nZTogYCR7Zm9ybWF0VGltZShkaXNwbGF5U3RhcnRBdCl9IC0gJHtmb3JtYXRUaW1lKGRpc3BsYXlFbmRBdCl9YCxcclxuICAgIHRpdGxlOiBgJHt0YXNrQ29kZX0gLyAke2V4cGVyaW1lbnROYW1lfSAvICR7Zm9ybWF0RGF0ZVRpbWUoZGlzcGxheVN0YXJ0QXQpfSAtICR7Zm9ybWF0RGF0ZVRpbWUoZGlzcGxheUVuZEF0KX1gLFxyXG4gICAgdHJheUNvZGVzOiB2aXNpYmxlVHJheVJvd3MubWFwKChyb3cpID0+IHJvdy50cmF5Q29kZSksXHJcbiAgICB0cmF5Um93czogdmlzaWJsZVRyYXlSb3dzLFxyXG4gICAgZW5kRGF0ZVRpbWVMYWJlbDogZm9ybWF0RGF0ZVRpbWUoZGlzcGxheUVuZEF0KSxcclxuICB9O1xufTtcblxuY29uc3QgaXNGdXR1cmVBeGlzQ29udGludWF0aW9uUm93ID0gKHJvdywgbm93VGltZSkgPT4ge1xuICBjb25zdCBheGlzUHJvZ3Jlc3MgPSByb3c/LmF4aXNQcm9ncmVzcztcbiAgY29uc3Qgc3RhcnRzSW5GdXR1cmUgPSAodG9UaW1lKHJvdz8uc3RhcnRBdCkgfHwgMCkgPiBub3dUaW1lO1xuICByZXR1cm4gc3RhcnRzSW5GdXR1cmVcbiAgICAmJiBhc0FycmF5KGF4aXNQcm9ncmVzcz8uc2NoZWR1bGVkQXhpc0NvZGVzKS5sZW5ndGggPiAwXG4gICAgJiYgYXNBcnJheShheGlzUHJvZ3Jlc3M/LnRvdGFsUmVxdWlyZWRBeGlzQ29kZXMpLmxlbmd0aCA+IGFzQXJyYXkoYXhpc1Byb2dyZXNzPy5zY2hlZHVsZWRBeGlzQ29kZXMpLmxlbmd0aFxuICAgICYmIE51bWJlcihheGlzUHJvZ3Jlc3M/LnRvdGFsQ29tcGxldGVkQ291bnQgfHwgMCkgPiAwXG4gICAgJiYgTnVtYmVyKGF4aXNQcm9ncmVzcz8uY29tcGxldGVkQ291bnQgfHwgMCkgPT09IDA7XG59O1xuXG5jb25zdCBmaW5kVHJheUZsb3dDb250ZXh0VGFzayA9IChzY2hlZHVsZVJvd3MsIGN1cnJlbnRUYXNrLCBzZWxlY3RlZFRyYXlDb2RlKSA9PiB7XG4gIGlmIChjdXJyZW50VGFzaykge1xuICAgIHJldHVybiBjdXJyZW50VGFzaztcbiAgfVxuICBjb25zdCBub3JtYWxpemVkVHJheUNvZGUgPSBub3JtYWxpemVUZXh0KHNlbGVjdGVkVHJheUNvZGUpO1xuICBpZiAoIW5vcm1hbGl6ZWRUcmF5Q29kZSkge1xuICAgIHJldHVybiBhc0FycmF5KHNjaGVkdWxlUm93cylbMF0gfHwgbnVsbDtcbiAgfVxuICByZXR1cm4gYXNBcnJheShzY2hlZHVsZVJvd3MpLmZpbmQoKHJvdykgPT5cbiAgICBhc0FycmF5KHJvdz8udHJheUNvZGVzKS5pbmNsdWRlcyhub3JtYWxpemVkVHJheUNvZGUpXG4gICAgfHwgYXNBcnJheShyb3c/LmFsbFRyYXlDb2RlcykuaW5jbHVkZXMobm9ybWFsaXplZFRyYXlDb2RlKSxcbiAgKSB8fCBhc0FycmF5KHNjaGVkdWxlUm93cylbMF0gfHwgbnVsbDtcbn07XG5cbmZ1bmN0aW9uIGJ1aWxkTGFib3JhdG9yeVdvcmtiZW5jaFZpZXcoe1xuICB0YXNrcyA9IFtdLFxyXG4gIHNjaGVkdWxlcyA9IFtdLFxyXG4gIGV4cGVyaW1lbnRzID0gW10sXG4gIGV4cGVyaW1lbnRSdW5zID0gW10sXG4gIGV4cGVyaW1lbnRSdW5TdGVwcyA9IFtdLFxuICBleHBlcmltZW50UnVuVHJheXMgPSBbXSxcbiAgZXhwZXJpbWVudFRyYXlzID0gW10sXHJcbiAgc2FtcGxlcyA9IFtdLFxyXG4gIG5vdyA9IG5ldyBEYXRlKCksXHJcbiAgc2VsZWN0ZWRUYXNrQ29kZSA9IFwiXCIsXHJcbiAgc2VsZWN0ZWRUcmF5Q29kZSA9IFwiXCIsXHJcbiAgbGFiTmFtZSA9IFNBTFRfU1BSQVlfTEFCLFxyXG4gIGxhYkNvZGUgPSBcIlwiLFxyXG59KSB7XHJcbiAgY29uc3QgdGFza01hcCA9IGJ1aWxkVGFza01hcCh0YXNrcyk7XHJcbiAgY29uc3QgZXhwZXJpbWVudE1hcCA9IGJ1aWxkRXhwZXJpbWVudE1hcChleHBlcmltZW50cyk7XHJcbiAgY29uc3QgZXhwZXJpbWVudFJlY29yZE1hcCA9IGJ1aWxkRXhwZXJpbWVudFJlY29yZE1hcChleHBlcmltZW50cyk7XHJcbiAgY29uc3Qgc2FtcGxlTWFwID0gYnVpbGRTYW1wbGVNYXAoc2FtcGxlcyk7XHJcbiAgY29uc3QgZXhwZXJpbWVudFRyYXlDb2RlTWFwID0gYnVpbGRFeHBlcmltZW50VHJheUNvZGVNYXAoZXhwZXJpbWVudFRyYXlzKTtcclxuICBjb25zdCByb3dCdWlsZGVySW5wdXQgPSB7IGV4cGVyaW1lbnRNYXAsIGV4cGVyaW1lbnRSZWNvcmRNYXAsIGV4cGVyaW1lbnRSdW5zLCBleHBlcmltZW50UnVuU3RlcHMsIGV4cGVyaW1lbnRSdW5UcmF5cywgZXhwZXJpbWVudFRyYXlDb2RlTWFwLCBzYW1wbGVNYXAsIHRhc2tNYXAgfTtcblxuICBjb25zdCBhY3RpdmVTY2hlZHVsZXMgPSBhc0FycmF5KHNjaGVkdWxlcykuZmlsdGVyKFxuICAgIChzY2hlZHVsZSkgPT4gIXNjaGVkdWxlRXhwZXJpbWVudElzQ29tcGxldGVkKHtcbiAgICAgIGV4cGVyaW1lbnRzLFxuICAgICAgZXhwZXJpbWVudFJ1bnMsXG4gICAgICBleHBlcmltZW50UnVuU3RlcHMsXG4gICAgICBleHBlcmltZW50UnVuVHJheXMsXG4gICAgICBleHBlcmltZW50VHJheXMsXG4gICAgICBzYW1wbGVzLFxuICAgICAgc2NoZWR1bGUsXG4gICAgfSksXG4gICk7XG4gIGNvbnN0IGFsbFNjaGVkdWxlUm93cyA9IGFjdGl2ZVNjaGVkdWxlc1xyXG4gICAgLm1hcCgoc2NoZWR1bGUpID0+IGJ1aWxkTGFib3JhdG9yeVNjaGVkdWxlUm93KHsgLi4ucm93QnVpbGRlcklucHV0LCBzY2hlZHVsZSB9KSlcclxuICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4gKHRvVGltZShsZWZ0LnN0YXJ0QXQpIHx8IDApIC0gKHRvVGltZShyaWdodC5zdGFydEF0KSB8fCAwKSk7XHJcblxyXG4gIGNvbnN0IGxhYlJlZiA9IHsgY29kZTogbGFiQ29kZSwgbmFtZTogbGFiTmFtZSB9O1xuICBjb25zdCBzY2hlZHVsZVJvd3MgPSBhbGxTY2hlZHVsZVJvd3MuZmlsdGVyKChyb3cpID0+IHNjaGVkdWxlTWF0Y2hlc0xhYihyb3csIGxhYlJlZikpO1xuICBjb25zdCBub3dUaW1lID0gbm93IGluc3RhbmNlb2YgRGF0ZSA/IG5vdy5nZXRUaW1lKCkgOiB0b1RpbWUobm93KSB8fCBEYXRlLm5vdygpO1xuICBjb25zdCBvcGVyYXRpb25UYXNrID1cbiAgICBzY2hlZHVsZVJvd3MuZmluZCgocm93KSA9PiBub3JtYWxpemVUZXh0KHJvdz8ucnVuTm8pKVxuICAgIHx8IHNjaGVkdWxlUm93cy5maW5kKChyb3cpID0+ICFpc0Z1dHVyZUF4aXNDb250aW51YXRpb25Sb3cocm93LCBub3dUaW1lKSAmJiBsYWJvcmF0b3J5Um93SGFzU3RhcnRlZE9wZXJhdGlvbihyb3cpKTtcbiAgY29uc3QgZGVmYXVsdENhbmRpZGF0ZSA9IHNjaGVkdWxlUm93c1swXSB8fCBudWxsO1xuICBjb25zdCBkZWZhdWx0VGFzayA9IG9wZXJhdGlvblRhc2sgfHwgZGVmYXVsdENhbmRpZGF0ZTtcblxuICBjb25zdCBzZWxlY3RlZEtleSA9IG5vcm1hbGl6ZVRleHQoc2VsZWN0ZWRUYXNrQ29kZSk7XG4gIGNvbnN0IHNlbGVjdGVkVGFza0NhbmRpZGF0ZSA9XG4gICAgc2NoZWR1bGVSb3dzLmZpbmQoKHJvdykgPT4gbm9ybWFsaXplVGV4dChyb3cuaWQpID09PSBzZWxlY3RlZEtleSlcbiAgICB8fCBzY2hlZHVsZVJvd3MuZmluZCgocm93KSA9PiBub3JtYWxpemVUZXh0KHJvdy5leHBlcmltZW50S2V5KSA9PT0gc2VsZWN0ZWRLZXkpXG4gICAgfHwgc2NoZWR1bGVSb3dzLmZpbmQoKHJvdykgPT4gcm93LnRhc2tDb2RlID09PSBzZWxlY3RlZEtleSlcbiAgICB8fCBudWxsO1xuICBjb25zdCBzZWxlY3RlZFRhc2sgPSBzZWxlY3RlZFRhc2tDYW5kaWRhdGUgfHwgbnVsbDtcbiAgY29uc3QgY3VycmVudFRhc2sgPSBzZWxlY3RlZFRhc2sgfHwgZGVmYXVsdFRhc2s7XG4gIGNvbnN0IGZsb3dDb250ZXh0VGFzayA9IGZpbmRUcmF5Rmxvd0NvbnRleHRUYXNrKHNjaGVkdWxlUm93cywgY3VycmVudFRhc2ssIHNlbGVjdGVkVHJheUNvZGUpO1xuICBjb25zdCBjdXJyZW50RXhwZXJpbWVudFRyYXlSb3dzID0gYXNBcnJheShjdXJyZW50VGFzaz8udHJheVJvd3MpO1xuICBjb25zdCBmbG93Q29udGV4dFRyYXlSb3dzID0gYXNBcnJheShmbG93Q29udGV4dFRhc2s/LnRyYXlSb3dzKTtcbiAgY29uc3Qgc2VsZWN0ZWRUcmF5Um93ID1cbiAgICBmbG93Q29udGV4dFRyYXlSb3dzLmZpbmQoKHJvdykgPT4gcm93LnRyYXlDb2RlID09PSBub3JtYWxpemVUZXh0KHNlbGVjdGVkVHJheUNvZGUpKVxuICAgIHx8IGZsb3dDb250ZXh0VHJheVJvd3NbMF1cbiAgICB8fCBudWxsO1xuICBjb25zdCBzZWxlY3RlZFRyYXlIYXNDdXJyZW50RXhwZXJpbWVudENvbnRleHQgPSB0cmF5SGFzQ3VycmVudEV4cGVyaW1lbnRGbG93Q29udGV4dChzZWxlY3RlZFRyYXlSb3csIGZsb3dDb250ZXh0VGFzayk7XG4gIGNvbnN0IHNlbGVjdGVkVHJheURpZmZlcmVudFRhcmdldElzQWN0aXZlID0gcm93SGFzVW5maW5pc2hlZERpZmZlcmVudFRhcmdldEV4cGVyaW1lbnQoc2VsZWN0ZWRUcmF5Um93LCBmbG93Q29udGV4dFRhc2spO1xuICBjb25zdCBzZWxlY3RlZFRyYXlPbmx5SGFzT3RoZXJFeHBlcmltZW50Q29tcGxldGlvbiA9XHJcbiAgICAhc2VsZWN0ZWRUcmF5SGFzQ3VycmVudEV4cGVyaW1lbnRDb250ZXh0XHJcbiAgICAmJiBzZWxlY3RlZFRyYXlSb3c/LmNvbXBsZXRlZEZvck90aGVyRXhwZXJpbWVudCA9PT0gdHJ1ZVxyXG4gICAgJiYgc2VsZWN0ZWRUcmF5Um93Py5jb21wbGV0ZWRGb3JDdXJyZW50RXhwZXJpbWVudCAhPT0gdHJ1ZVxyXG4gICAgJiYgIXNlbGVjdGVkVHJheURpZmZlcmVudFRhcmdldElzQWN0aXZlXHJcbiAgICAmJiAhcm93SGFzUHJlRGlzcGF0Y2hMaWZlY3ljbGVTdGF0dXMoc2VsZWN0ZWRUcmF5Um93KTtcclxuICBjb25zdCBzZWxlY3RlZFRyYXlGbG93U3RhdHVzID1cbiAgICBzZWxlY3RlZFRyYXlPbmx5SGFzT3RoZXJFeHBlcmltZW50Q29tcGxldGlvblxuICAgICAgPyBFWFBFUklNRU5UX0NPTVBMRVRFRF9TVEFUVVNcbiAgICAgIDogcmVzb2x2ZVNlbGVjdGVkVHJheUZsb3dTdGF0dXMoc2VsZWN0ZWRUcmF5Um93LCBmbG93Q29udGV4dFRhc2spO1xuICBjb25zdCBjdXJyZW50VGFza1N0YXR1cyA9IHJlc29sdmVMYWJvcmF0b3J5VGFza1N0YXR1cyhjdXJyZW50VGFzayk7XG4gIGNvbnN0IGN1cnJlbnRUYXNrRmxvdyA9IGJ1aWxkTGFib3JhdG9yeVRhc2tGbG93KGN1cnJlbnRUYXNrU3RhdHVzLCBjdXJyZW50VGFzaz8uYXhpc1Byb2dyZXNzKTtcbiAgY29uc3QgYmFzZVNlbGVjdGVkVHJheUZsb3cgPSBzZWxlY3RlZFRyYXlSb3dcbiAgICA/IGJ1aWxkVHJheUZsb3dWaWV3KHtcbiAgICAgICAgY3VycmVudEV4cGVyaW1lbnRDb2RlOiBzZWxlY3RlZFRyYXlIYXNDdXJyZW50RXhwZXJpbWVudENvbnRleHRcbiAgICAgICAgICA/IG5vcm1hbGl6ZVRleHQoZmxvd0NvbnRleHRUYXNrPy5leHBlcmltZW50Q29kZSlcbiAgICAgICAgICA6IHNlbGVjdGVkVHJheURpZmZlcmVudFRhcmdldElzQWN0aXZlXG4gICAgICAgICAgICA/IG5vcm1hbGl6ZVRleHQoc2VsZWN0ZWRUcmF5Um93Py50YXJnZXRFeHBlcmltZW50Q29kZSB8fCBzZWxlY3RlZFRyYXlSb3c/LnRhcmdldF9leHBlcmltZW50X2NvZGUpXG4gICAgICAgICAgICA6IFwiXCIsXG4gICAgICAgIGV4cGVyaW1lbnRSdW5zLFxuICAgICAgICBleHBlcmltZW50UnVuU3RlcHMsXG4gICAgICAgIGV4cGVyaW1lbnRSdW5UcmF5cyxcbiAgICAgICAgZXhwZXJpbWVudFRyYXlzLFxuICAgICAgICBleHBlcmltZW50cyxcbiAgICAgICAgZGlzcGF0Y2hUYXJnZXRMYWI6IHNlbGVjdGVkVHJheUhhc0N1cnJlbnRFeHBlcmltZW50Q29udGV4dCB8fCBzZWxlY3RlZFRyYXlEaWZmZXJlbnRUYXJnZXRJc0FjdGl2ZVxyXG4gICAgICAgICAgPyBub3JtYWxpemVUZXh0KHNlbGVjdGVkVHJheVJvdz8udGFyZ2V0TGFiIHx8IHNlbGVjdGVkVHJheVJvdz8udGFyZ2V0X2xhYilcclxuICAgICAgICAgIDogXCJcIixcclxuICAgICAgICBsb2NhdGlvbjogbm9ybWFsaXplVGV4dChzZWxlY3RlZFRyYXlSb3c/LmxpZmVjeWNsZUxvY2F0aW9uKSB8fCBub3JtYWxpemVUZXh0KHNlbGVjdGVkVHJheVJvdz8uY3VycmVudExvY2F0aW9uKSxcclxuICAgICAgICBzYW1wbGVzLFxyXG4gICAgICAgIHNjaGVkdWxlcyxcclxuICAgICAgICBzdGF0dXM6IHNlbGVjdGVkVHJheUZsb3dTdGF0dXMsXHJcbiAgICAgICAgc3VwcHJlc3NHdWVzc2VkRGVzdGluYXRpb25MYWI6IHNlbGVjdGVkVHJheU9ubHlIYXNPdGhlckV4cGVyaW1lbnRDb21wbGV0aW9uLFxyXG4gICAgICAgIHRhc2tDb2RlOiBub3JtYWxpemVUZXh0KGZsb3dDb250ZXh0VGFzaz8udGFza0NvZGUpLFxuICAgICAgICB0cmF5Q29kZTogbm9ybWFsaXplVGV4dChzZWxlY3RlZFRyYXlSb3c/LnRyYXlDb2RlKSxcbiAgICAgIH0pXG4gICAgOiBidWlsZFRyYXlGbG93VmlldygpO1xuICBjb25zdCBzZWxlY3RlZFRyYXlBeGlzU3RhdHVzID1cbiAgICBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy5heGlzUHJvZ3Jlc3M/LnN0YXR1c0xhYmVsKVxuICAgIHx8ICghY3VycmVudFRhc2sgPyBub3JtYWxpemVUZXh0KGZsb3dDb250ZXh0VGFzaz8uYXhpc1Byb2dyZXNzPy50b3RhbFN0YXR1c0xhYmVsKSA6IFwiXCIpO1xuICBjb25zdCBzZWxlY3RlZFRyYXlGbG93ID1cbiAgICBzZWxlY3RlZFRyYXlSb3cgJiYgc2VsZWN0ZWRUcmF5QXhpc1N0YXR1c1xuICAgICAgPyB7XG4gICAgICAgICAgLi4uYmFzZVNlbGVjdGVkVHJheUZsb3csXG4gICAgICAgICAgY2Fub25pY2FsU3RhdHVzOiBzZWxlY3RlZFRyYXlBeGlzU3RhdHVzLFxuICAgICAgICAgIGN1cnJlbnRTdGF0dXM6IGDlvZPliY3miZjnm5jvvJoke3NlbGVjdGVkVHJheVJvdy50cmF5Q29kZX0gfCDlvZPliY3nirbmgIHvvJoke3NlbGVjdGVkVHJheUF4aXNTdGF0dXN9YCxcbiAgICAgICAgICBzdGF0dXM6IHNlbGVjdGVkVHJheUF4aXNTdGF0dXMsXG4gICAgICAgIH1cbiAgICAgIDogYmFzZVNlbGVjdGVkVHJheUZsb3c7XG4gIGNvbnN0IG9wZXJhdGlvblRhc2tNYXRjaGVzQ3VycmVudFRhc2sgPVxuICAgIG9wZXJhdGlvblRhc2tcbiAgICAmJiBjdXJyZW50VGFza1xuICAgICYmIG5vcm1hbGl6ZVRleHQob3BlcmF0aW9uVGFzay50YXNrQ29kZSkgPT09IG5vcm1hbGl6ZVRleHQoY3VycmVudFRhc2sudGFza0NvZGUpXG4gICAgJiYgbm9ybWFsaXplVGV4dChvcGVyYXRpb25UYXNrLmV4cGVyaW1lbnRDb2RlKSA9PT0gbm9ybWFsaXplVGV4dChjdXJyZW50VGFzay5leHBlcmltZW50Q29kZSk7XG4gIGNvbnN0IHJ1bm5pbmdFeHBlcmltZW50ID0gYnVpbGRSdW5uaW5nRXhwZXJpbWVudFZpZXcoe1xuICAgIGN1cnJlbnRUYXNrOiBvcGVyYXRpb25UYXNrTWF0Y2hlc0N1cnJlbnRUYXNrIHx8ICFzZWxlY3RlZFRhc2sgPyAob3BlcmF0aW9uVGFzayB8fCBjdXJyZW50VGFzaykgOiBjdXJyZW50VGFzayxcbiAgICBub3c6IG5vdyBpbnN0YW5jZW9mIERhdGUgPyBub3cgOiBuZXcgRGF0ZSh0b1RpbWUobm93KSB8fCBEYXRlLm5vdygpKSxcbiAgfSk7XG5cclxuICByZXR1cm4ge1xyXG4gICAgYWxsU2NoZWR1bGVSb3dzLFxyXG4gICAgY3VycmVudFRhc2ssXHJcbiAgICBjdXJyZW50VGFza0Zsb3csXHJcbiAgICBjdXJyZW50VGFza1N0YXR1cyxcclxuICAgIGN1cnJlbnRFeHBlcmltZW50VHJheVJvd3MsXHJcbiAgICBkZWZhdWx0VGFzayxcclxuICAgIGxhYk5hbWUsXHJcbiAgICBydW5uaW5nRXhwZXJpbWVudCxcclxuICAgIHNjaGVkdWxlUm93cyxcclxuICAgIHNlbGVjdGVkVHJheUZsb3csXHJcbiAgICBzZWxlY3RlZFRyYXlSb3csXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gYnVpbGRMYWJvcmF0b3J5U3VtbWFyeShzY2hlZHVsZVJvd3MgPSBbXSwgbm93ID0gbmV3IERhdGUoKSkge1xyXG4gIGNvbnN0IHRvZGF5S2V5ID0gZm9ybWF0RGF0ZUtleShub3cpO1xyXG4gIGNvbnN0IG5vd1RpbWUgPSBub3cgaW5zdGFuY2VvZiBEYXRlID8gbm93LmdldFRpbWUoKSA6IHRvVGltZShub3cpO1xyXG4gIGNvbnN0IHRvZGF5Um93cyA9IGFzQXJyYXkoc2NoZWR1bGVSb3dzKS5maWx0ZXIoKHJvdykgPT4gZm9ybWF0RGF0ZUtleShyb3c/LnN0YXJ0QXQpID09PSB0b2RheUtleSk7XHJcbiAgcmV0dXJuIHtcclxuICAgIHRvZGF5UGVuZGluZ0NvdW50OiB0b2RheVJvd3MubGVuZ3RoLFxyXG4gICAgdG9kYXlVbmRvbmVDb3VudDogdG9kYXlSb3dzLmZpbHRlcigocm93KSA9PiB7XHJcbiAgICAgIGNvbnN0IGVuZCA9IHRvVGltZShyb3c/LmVuZEF0KTtcclxuICAgICAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShlbmQpICYmIGVuZCA8IG5vd1RpbWU7XHJcbiAgICB9KS5sZW5ndGgsXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gY3JlYXRlTGFib3JhdG9yeVdvcmtmbG93KCkge1xyXG4gIHJldHVybiB7XHJcbiAgICBjb21wYXJpc29uRG9uZTogZmFsc2UsXHJcbiAgICBleHBlcmltZW50Q29uZmlybWVkOiBmYWxzZSxcclxuICAgIGZpeHR1cmVSZWFkeURvbmU6IGZhbHNlLFxyXG4gICAgaGFzQ29tcGFyZWQ6IGZhbHNlLFxyXG4gICAgaGFzSW5zdGFsbGVkOiBmYWxzZSxcclxuICAgIGluc3RhbGxhdGlvbkRvbmU6IGZhbHNlLFxyXG4gIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJ1aWxkTGFib3JhdG9yeVdvcmtmbG93RnJvbVRhc2sodGFzaykge1xyXG4gIGNvbnN0IHRyYXlSb3dzID0gYXNBcnJheSh0YXNrPy50cmF5Um93cyk7XHJcbiAgY29uc3Qgd29ya2Zsb3dSb3dzV2l0aFN0YXRlID0gdHJheVJvd3NcclxuICAgIC5tYXAoKHJvdykgPT4gKHsgcm93LCBzdGF0ZTogcmVzb2x2ZVRyYXlFeHBlcmltZW50T3BlcmF0aW9uU3RhdGUocm93LCB0YXNrKSB9KSlcclxuICAgIC5maWx0ZXIoKHsgc3RhdGUgfSkgPT4gc3RhdGUuYmVsb25nc1RvQ3VycmVudFdvcmtmbG93KTtcclxuICBjb25zdCB3b3JrZmxvd1RyYXlSb3dzID0gd29ya2Zsb3dSb3dzV2l0aFN0YXRlLm1hcCgoeyByb3cgfSkgPT4gcm93KTtcclxuICBjb25zdCBhY3RpdmVPdGhlckV4cGVyaW1lbnRSb3dzID0gd29ya2Zsb3dUcmF5Um93cy5maWx0ZXIoKHJvdykgPT4gYXNBcnJheShyb3c/LmFjdGl2ZU90aGVyRXhwZXJpbWVudFJ1bnMpLmxlbmd0aCA+IDApO1xyXG4gIGNvbnN0IGNvbXBhcmFibGVUcmF5Um93cyA9IHdvcmtmbG93VHJheVJvd3MuZmlsdGVyKChyb3cpID0+XHJcbiAgICBhc0FycmF5KHJvdz8uYWN0aXZlT3RoZXJFeHBlcmltZW50UnVucykubGVuZ3RoID09PSAwXHJcbiAgICAmJiByZXNvbHZlVHJheUV4cGVyaW1lbnRPcGVyYXRpb25TdGF0ZShyb3csIHRhc2spLnJhbmsgPCAxXHJcbiAgKTtcclxuICBjb25zdCB0cmF5UmFua3MgPSB3b3JrZmxvd1Jvd3NXaXRoU3RhdGUubWFwKCh7IHN0YXRlIH0pID0+IHN0YXRlLnJhbmspO1xyXG4gIGNvbnN0IGluc3RhbGxlZFdhaXRpbmdSZWFkeVJvd3MgPSB3b3JrZmxvd1RyYXlSb3dzLmZpbHRlcigocm93KSA9PiByZXNvbHZlTGFib3JhdG9yeVN0YXR1c1Jhbmsocm93Py50cmF5U3RhdHVzKSA9PT0gMik7XHJcbiAgY29uc3QgaGFzQ29tcGFyZWQgPSB0cmF5UmFua3Muc29tZSgocmFuaykgPT4gcmFuayA+PSAxKTtcclxuICBjb25zdCBjb21wYXJpc29uRG9uZSA9IHRyYXlSYW5rcy5sZW5ndGggPiAwICYmIHRyYXlSYW5rcy5ldmVyeSgocmFuaykgPT4gcmFuayA+PSAxKTtcclxuICBjb25zdCBoYXNJbnN0YWxsZWQgPSB0cmF5UmFua3Muc29tZSgocmFuaykgPT4gcmFuayA+PSAyICYmIHJhbmsgPCA1KTtcclxuICBjb25zdCBpbnN0YWxsYXRpb25Eb25lID0gdHJheVJhbmtzLmxlbmd0aCA+IDAgJiYgdHJheVJhbmtzLmV2ZXJ5KChyYW5rKSA9PiByYW5rID49IDIpO1xyXG4gIGNvbnN0IGV4cGVyaW1lbnRDb25maXJtZWQgPSB0cmF5UmFua3MubGVuZ3RoID4gMCAmJiB0cmF5UmFua3MuZXZlcnkoKHJhbmspID0+IHJhbmsgPj0gMyk7XHJcbiAgY29uc3QgZml4dHVyZVJlYWR5RG9uZSA9XHJcbiAgICBpbnN0YWxsZWRXYWl0aW5nUmVhZHlSb3dzLmxlbmd0aCA+IDAgJiYgaW5zdGFsbGVkV2FpdGluZ1JlYWR5Um93cy5ldmVyeSgocm93KSA9PiByb3c/LmZpeHR1cmVSZWFkeSA9PT0gdHJ1ZSk7XHJcbiAgY29uc3Qgd29ya2Zsb3cgPSB7XHJcbiAgICBjb21wYXJpc29uRG9uZSxcclxuICAgIGV4cGVyaW1lbnRDb25maXJtZWQsXHJcbiAgICBoYXNDb21wYXJlZCxcclxuICAgIGhhc0luc3RhbGxlZCxcclxuICAgIGluc3RhbGxhdGlvbkRvbmUsXHJcbiAgfTtcclxuICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyh3b3JrZmxvdywge1xyXG4gICAgZml4dHVyZVJlYWR5RG9uZToge1xyXG4gICAgICB2YWx1ZTogZml4dHVyZVJlYWR5RG9uZSxcclxuICAgIH0sXHJcbiAgICBoYXNDb21wYXJlZFdhaXRpbmdJbnN0YWxsOiB7XHJcbiAgICAgIHZhbHVlOiB0cmF5UmFua3Muc29tZSgocmFuaykgPT4gcmFuayA9PT0gMSksXHJcbiAgICB9LFxyXG4gICAgaGFzSW5zdGFsbGVkV2FpdGluZ1JlYWR5OiB7XHJcbiAgICAgIHZhbHVlOiB0cmF5UmFua3Muc29tZSgocmFuaykgPT4gcmFuayA9PT0gMiksXHJcbiAgICB9LFxyXG4gICAgaGFzQWN0aXZlT3RoZXJFeHBlcmltZW50UnVuOiB7XHJcbiAgICAgIHZhbHVlOiBhY3RpdmVPdGhlckV4cGVyaW1lbnRSb3dzLmxlbmd0aCA+IDAsXHJcbiAgICB9LFxyXG4gICAgYWN0aXZlT3RoZXJFeHBlcmltZW50Um93czoge1xyXG4gICAgICB2YWx1ZTogYWN0aXZlT3RoZXJFeHBlcmltZW50Um93cyxcclxuICAgIH0sXHJcbiAgICBhY3RpdmVPdGhlckV4cGVyaW1lbnRSdW46IHtcclxuICAgICAgdmFsdWU6IGFjdGl2ZU90aGVyRXhwZXJpbWVudFJvd3NbMF0/LmFjdGl2ZU90aGVyRXhwZXJpbWVudFJ1biB8fCBudWxsLFxyXG4gICAgfSxcclxuICAgIGhhc0NvbXBhcmFibGVUcmF5V2l0aG91dEFjdGl2ZU90aGVyRXhwZXJpbWVudDoge1xyXG4gICAgICB2YWx1ZTogY29tcGFyYWJsZVRyYXlSb3dzLmxlbmd0aCA+IDAsXHJcbiAgICB9LFxyXG4gICAgaGFzSW5Qcm9ncmVzc1ByZXBhcmF0aW9uOiB7XHJcbiAgICAgIHZhbHVlOiB0cmF5UmFua3Muc29tZSgocmFuaykgPT4gcmFuayA+PSAyICYmIHJhbmsgPCA1KSxcclxuICAgIH0sXHJcbiAgICBoYXNXcm9uZ0xhYm9yYXRvcnlEaXNwYXRjaDoge1xyXG4gICAgICB2YWx1ZTogdGFza0hhc1dyb25nTGFib3JhdG9yeURpc3BhdGNoKHRhc2spLFxyXG4gICAgfSxcclxuICAgIGhhc0N1cnJlbnRMYWJvcmF0b3J5RGlzcGF0Y2g6IHtcclxuICAgICAgdmFsdWU6IHRhc2tIYXNDdXJyZW50TGFib3JhdG9yeURpc3BhdGNoKHRhc2spLFxyXG4gICAgfSxcclxuICB9KTtcclxuICByZXR1cm4gd29ya2Zsb3c7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldExhYm9yYXRvcnlBY3Rpb25TdGF0ZSh3b3JrZmxvdyA9IGNyZWF0ZUxhYm9yYXRvcnlXb3JrZmxvdygpKSB7XHJcbiAgaWYgKHdvcmtmbG93LmV4cGVyaW1lbnRDb25maXJtZWQpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGNhbkNvbXBhcmU6IGZhbHNlLFxyXG4gICAgICBjYW5JbnN0YWxsU2FtcGxlOiBmYWxzZSxcclxuICAgICAgY2FuTWFya1JlYWR5OiBmYWxzZSxcclxuICAgIH07XHJcbiAgfVxyXG4gIGNvbnN0IGhhc0NvbXBhcmVkV2FpdGluZ0luc3RhbGwgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwod29ya2Zsb3csIFwiaGFzQ29tcGFyZWRXYWl0aW5nSW5zdGFsbFwiKVxyXG4gICAgPyB3b3JrZmxvdy5oYXNDb21wYXJlZFdhaXRpbmdJbnN0YWxsXHJcbiAgICA6ICF3b3JrZmxvdy5oYXNJbnN0YWxsZWQgJiYgKHdvcmtmbG93Lmhhc0NvbXBhcmVkIHx8IHdvcmtmbG93LmNvbXBhcmlzb25Eb25lKSAmJiAhd29ya2Zsb3cuaW5zdGFsbGF0aW9uRG9uZTtcclxuICBjb25zdCBoYXNJbnN0YWxsZWRXYWl0aW5nUmVhZHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwod29ya2Zsb3csIFwiaGFzSW5zdGFsbGVkV2FpdGluZ1JlYWR5XCIpXHJcbiAgICA/IHdvcmtmbG93Lmhhc0luc3RhbGxlZFdhaXRpbmdSZWFkeVxyXG4gICAgOiAod29ya2Zsb3cuaGFzSW5zdGFsbGVkIHx8IHdvcmtmbG93Lmluc3RhbGxhdGlvbkRvbmUpICYmICF3b3JrZmxvdy5leHBlcmltZW50Q29uZmlybWVkO1xyXG4gIGNvbnN0IGhhc0luUHJvZ3Jlc3NQcmVwYXJhdGlvbiA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh3b3JrZmxvdywgXCJoYXNJblByb2dyZXNzUHJlcGFyYXRpb25cIilcclxuICAgID8gd29ya2Zsb3cuaGFzSW5Qcm9ncmVzc1ByZXBhcmF0aW9uXHJcbiAgICA6IEJvb2xlYW4od29ya2Zsb3cuaGFzSW5zdGFsbGVkKTtcclxuICBjb25zdCBmaXh0dXJlUmVhZHlEb25lID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHdvcmtmbG93LCBcImZpeHR1cmVSZWFkeURvbmVcIilcclxuICAgID8gd29ya2Zsb3cuZml4dHVyZVJlYWR5RG9uZVxyXG4gICAgOiBmYWxzZTtcclxuICBjb25zdCBoYXNDdXJyZW50TGFib3JhdG9yeURpc3BhdGNoID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHdvcmtmbG93LCBcImhhc0N1cnJlbnRMYWJvcmF0b3J5RGlzcGF0Y2hcIilcclxuICAgID8gd29ya2Zsb3cuaGFzQ3VycmVudExhYm9yYXRvcnlEaXNwYXRjaFxyXG4gICAgOiB0cnVlO1xyXG4gIGNvbnN0IGhhc0FjdGl2ZU90aGVyRXhwZXJpbWVudFJ1biA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh3b3JrZmxvdywgXCJoYXNBY3RpdmVPdGhlckV4cGVyaW1lbnRSdW5cIilcclxuICAgID8gd29ya2Zsb3cuaGFzQWN0aXZlT3RoZXJFeHBlcmltZW50UnVuXHJcbiAgICA6IGZhbHNlO1xyXG4gIGNvbnN0IGhhc0NvbXBhcmFibGVUcmF5V2l0aG91dEFjdGl2ZU90aGVyRXhwZXJpbWVudCA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChcclxuICAgIHdvcmtmbG93LFxyXG4gICAgXCJoYXNDb21wYXJhYmxlVHJheVdpdGhvdXRBY3RpdmVPdGhlckV4cGVyaW1lbnRcIixcclxuICApXHJcbiAgICA/IHdvcmtmbG93Lmhhc0NvbXBhcmFibGVUcmF5V2l0aG91dEFjdGl2ZU90aGVyRXhwZXJpbWVudFxyXG4gICAgOiBmYWxzZTtcclxuICBpZiAoaGFzQWN0aXZlT3RoZXJFeHBlcmltZW50UnVuICYmICFoYXNDb21wYXJhYmxlVHJheVdpdGhvdXRBY3RpdmVPdGhlckV4cGVyaW1lbnQpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGNhbkNvbXBhcmU6IGZhbHNlLFxyXG4gICAgICBjYW5JbnN0YWxsU2FtcGxlOiBmYWxzZSxcclxuICAgICAgY2FuTWFya1JlYWR5OiBmYWxzZSxcclxuICAgIH07XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBjYW5Db21wYXJlOiBoYXNDdXJyZW50TGFib3JhdG9yeURpc3BhdGNoICYmICF3b3JrZmxvdy5jb21wYXJpc29uRG9uZSAmJiAhaGFzSW5Qcm9ncmVzc1ByZXBhcmF0aW9uLFxyXG4gICAgY2FuSW5zdGFsbFNhbXBsZTogQm9vbGVhbihoYXNDb21wYXJlZFdhaXRpbmdJbnN0YWxsKSxcclxuICAgIGNhbk1hcmtSZWFkeTogQm9vbGVhbihoYXNJbnN0YWxsZWRXYWl0aW5nUmVhZHkgJiYgZml4dHVyZVJlYWR5RG9uZSksXHJcbiAgfTtcclxufVxyXG5cclxuY29uc3QgYnVpbGRTYWx0U3ByYXlMYWJvcmF0b3J5VmlldyA9IGJ1aWxkTGFib3JhdG9yeVdvcmtiZW5jaFZpZXc7XHJcblxyXG5mdW5jdGlvbiBjb21wbGV0ZUxhYm9yYXRvcnlDb21wYXJpc29uKHdvcmtmbG93ID0gY3JlYXRlTGFib3JhdG9yeVdvcmtmbG93KCkpIHtcclxuICByZXR1cm4ge1xyXG4gICAgLi4ud29ya2Zsb3csXHJcbiAgICBjb21wYXJpc29uRG9uZTogdHJ1ZSxcclxuICAgIGV4cGVyaW1lbnRDb25maXJtZWQ6IGZhbHNlLFxyXG4gICAgaGFzQ29tcGFyZWQ6IHRydWUsXHJcbiAgICBoYXNJbnN0YWxsZWQ6IGZhbHNlLFxyXG4gICAgaW5zdGFsbGF0aW9uRG9uZTogZmFsc2UsXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29tcGxldGVMYWJvcmF0b3J5SW5zdGFsbGF0aW9uKHdvcmtmbG93ID0gY3JlYXRlTGFib3JhdG9yeVdvcmtmbG93KCkpIHtcclxuICBpZiAoISh3b3JrZmxvdy5oYXNDb21wYXJlZCB8fCB3b3JrZmxvdy5jb21wYXJpc29uRG9uZSkpIHtcclxuICAgIHJldHVybiB7IC4uLndvcmtmbG93IH07XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICAuLi53b3JrZmxvdyxcclxuICAgIGhhc0NvbXBhcmVkOiB0cnVlLFxyXG4gICAgaGFzSW5zdGFsbGVkOiB0cnVlLFxyXG4gICAgaW5zdGFsbGF0aW9uRG9uZTogdHJ1ZSxcclxuICAgIGZpeHR1cmVSZWFkeURvbmU6IGZhbHNlLFxyXG4gICAgZXhwZXJpbWVudENvbmZpcm1lZDogZmFsc2UsXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29uZmlybUxhYm9yYXRvcnlFeHBlcmltZW50KHdvcmtmbG93ID0gY3JlYXRlTGFib3JhdG9yeVdvcmtmbG93KCkpIHtcclxuICBpZiAoISh3b3JrZmxvdy5oYXNJbnN0YWxsZWQgfHwgd29ya2Zsb3cuaW5zdGFsbGF0aW9uRG9uZSkgfHwgIXdvcmtmbG93LmZpeHR1cmVSZWFkeURvbmUpIHtcclxuICAgIHJldHVybiB7IC4uLndvcmtmbG93IH07XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBjb21wYXJpc29uRG9uZTogdHJ1ZSxcclxuICAgIGV4cGVyaW1lbnRDb25maXJtZWQ6IHRydWUsXHJcbiAgICBmaXh0dXJlUmVhZHlEb25lOiB0cnVlLFxyXG4gICAgaGFzQ29tcGFyZWQ6IHRydWUsXHJcbiAgICBoYXNJbnN0YWxsZWQ6IHRydWUsXHJcbiAgICBpbnN0YWxsYXRpb25Eb25lOiB0cnVlLFxyXG4gIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJ1aWxkTGFib3JhdG9yeVByb2dyZXNzTWVzc2FnZSh3b3JrZmxvdywgY3VycmVudFRhc2ssIGxhYk5hbWUgPSBTQUxUX1NQUkFZX0xBQikge1xyXG4gIGlmICghY3VycmVudFRhc2spIHtcclxuICAgIHJldHVybiBg5b2T5YmNJHtub3JtYWxpemVUZXh0KGxhYk5hbWUpIHx8IFNBTFRfU1BSQVlfTEFCfeaaguaXoOaOkueoi2A7XHJcbiAgfVxyXG4gIGlmIChnZXRSdW5uaW5nVHJheVJvd3NGb3JDdXJyZW50VGFzayhjdXJyZW50VGFzaykubGVuZ3RoID4gMCkge1xyXG4gICAgcmV0dXJuIGDlvZPliY3ku7vliqEgJHtjdXJyZW50VGFzay50YXNrQ29kZX0g5bey6L+b5YWl5a6e6aqM6L+b6KGM5LitYDtcclxuICB9XHJcbiAgaWYgKFxyXG4gICAgd29ya2Zsb3cuaGFzQWN0aXZlT3RoZXJFeHBlcmltZW50UnVuXHJcbiAgICAmJiAhd29ya2Zsb3cuaGFzQ29tcGFyYWJsZVRyYXlXaXRob3V0QWN0aXZlT3RoZXJFeHBlcmltZW50XHJcbiAgKSB7XHJcbiAgICBjb25zdCBsb2NrID0gd29ya2Zsb3cuYWN0aXZlT3RoZXJFeHBlcmltZW50UnVuIHx8IHt9O1xyXG4gICAgY29uc3QgdGFyZ2V0ID0gbm9ybWFsaXplVGV4dChsb2NrLmRldmljZSkgfHwgbm9ybWFsaXplVGV4dChsb2NrLmV4cGVyaW1lbnROYW1lKSB8fCBcIuWFtuS7luWunumqjFwiO1xyXG4gICAgcmV0dXJuIGDmiZjnm5jmraPlnKgke3RhcmdldH3ov5vooYzlrp7pqozvvIzlrozmiJDlkI7miY3lj6/nu6fnu63lvZPliY3or5Xpqozpl7TmtYHnqItgO1xyXG4gIH1cclxuICBpZiAod29ya2Zsb3cuZXhwZXJpbWVudENvbmZpcm1lZCkge1xyXG4gICAgcmV0dXJuIFwi5b2T5YmN5Lu75Yqh5bey56Gu6K6k5YWo6YOo5omY55uY5a6e6aqM5YeG5aSH5bCx57uqXCI7XHJcbiAgfVxyXG4gIGlmICh3b3JrZmxvdy5oYXNJbnN0YWxsZWRXYWl0aW5nUmVhZHkgJiYgIXdvcmtmbG93LmZpeHR1cmVSZWFkeURvbmUpIHtcclxuICAgIHJldHVybiBcIuW9k+WJjeS7u+WKoeW3suWujOaIkOWkueWFt+Wuieijhe+8jOetieW+heS4iuS9jeacuuehruiupOWkueWFt+WuieijheWujOaIkFwiO1xyXG4gIH1cclxuICBpZiAod29ya2Zsb3cuaGFzSW5zdGFsbGVkV2FpdGluZ1JlYWR5ICYmIHdvcmtmbG93LmZpeHR1cmVSZWFkeURvbmUpIHtcclxuICAgIHJldHVybiBcIuWkueWFt+WuieijheWujOaIkO+8jOWPr+ehruiupOWunumqjOWHhuWkh+Wwsee7qlwiO1xyXG4gIH1cclxuICBpZiAod29ya2Zsb3cuaGFzSW5zdGFsbGVkICYmICF3b3JrZmxvdy5pbnN0YWxsYXRpb25Eb25lKSB7XHJcbiAgICByZXR1cm4gXCLlvZPliY3ku7vliqHlt7LmnInmiZjnm5jlrozmiJDmoLflk4Hlronoo4XvvIzlvoXnoa7orqTlt7Llronoo4XmiZjnm5jlh4blpIflsLHnu6pcIjtcclxuICB9XHJcbiAgaWYgKHdvcmtmbG93Lmluc3RhbGxhdGlvbkRvbmUpIHtcclxuICAgIHJldHVybiBcIuW9k+WJjeS7u+WKoeW3suWujOaIkOWFqOmDqOaJmOebmOagt+WTgeWuieijhe+8jOW+heWunumqjOehruiupFwiO1xyXG4gIH1cclxuICBpZiAod29ya2Zsb3cuaGFzQ29tcGFyZWQgJiYgIXdvcmtmbG93LmNvbXBhcmlzb25Eb25lKSB7XHJcbiAgICByZXR1cm4gXCLlvZPliY3ku7vliqHlt7LlrozmiJDpg6jliIbmiZjnm5jmr5Tlr7nvvIzlj6/nu6fnu63mr5Tlr7nmiJblvIDlp4vmoLflk4Hlronoo4VcIjtcclxuICB9XHJcbiAgaWYgKHdvcmtmbG93LmNvbXBhcmlzb25Eb25lKSB7XHJcbiAgICByZXR1cm4gXCLlvZPliY3ku7vliqHlt7LlrozmiJDlhajpg6jmiZjnm5jku7vliqHmr5Tlr7nvvIzlvoXmoLflk4Hlronoo4VcIjtcclxuICB9XHJcbiAgcmV0dXJuIGDlvZPliY3ku7vliqEgJHtjdXJyZW50VGFzay50YXNrQ29kZX0g5b6F5byA5aeL5Lu75Yqh5q+U5a+5YDtcclxufVxyXG5cclxuZnVuY3Rpb24gYXBwbHlMYWJvcmF0b3J5VGFza1N0ZXAoe1xyXG4gIHNhbXBsZXMgPSBbXSxcclxuICBjdXJyZW50VGFzayA9IG51bGwsXHJcbiAgbmV4dFN0YXR1cyA9IFwiXCIsXHJcbiAgaGlzdG9yeUFjdGlvbiA9IFwiXCIsXHJcbiAgbm93ID0gZm9ybWF0TG9jYWxEYXRlVGltZSgpLFxyXG4gIHRhcmdldFRyYXlDb2RlcyA9IFtdLFxyXG59KSB7XHJcbiAgaWYgKCFjdXJyZW50VGFzaykge1xyXG4gICAgcmV0dXJuIGFzQXJyYXkoc2FtcGxlcyk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBub3JtYWxpemVkU3RhdHVzID0gbm9ybWFsaXplVGV4dChuZXh0U3RhdHVzKTtcclxuICBjb25zdCBzY29wZWRUcmF5Q29kZXMgPSBhc0FycmF5KHRhcmdldFRyYXlDb2RlcykubGVuZ3RoID4gMCA/IHRhcmdldFRyYXlDb2RlcyA6IGN1cnJlbnRUYXNrLnRyYXlDb2RlcztcclxuICBjb25zdCB0cmF5Q29kZVNldCA9IG5ldyBTZXQoYXNBcnJheShzY29wZWRUcmF5Q29kZXMpLm1hcCgodHJheUNvZGUpID0+IG5vcm1hbGl6ZVRleHQodHJheUNvZGUpKS5maWx0ZXIoQm9vbGVhbikpO1xyXG4gIGNvbnN0IHRhc2tDb2RlID0gbm9ybWFsaXplVGV4dChjdXJyZW50VGFzay50YXNrQ29kZSk7XHJcbiAgY29uc3QgZGV0YWlsID0gYCR7dGFza0NvZGV9IC8gJHtub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrLmV4cGVyaW1lbnROYW1lKSB8fCBcIi1cIn0gLyAke25vcm1hbGl6ZWRTdGF0dXN9YDtcclxuICBjb25zdCBzY29wZWRTYW1wbGVzID0gYXNBcnJheShzYW1wbGVzKS5maWx0ZXIoKHNhbXBsZSkgPT4gbm9ybWFsaXplVGV4dChzYW1wbGU/LnRhc2tfY29kZSkgPT09IHRhc2tDb2RlKTtcclxuICBjb25zdCB0YXJnZXRTdGF0dXNSYW5rID0gcmVzb2x2ZUxhYm9yYXRvcnlTdGF0dXNSYW5rKG5vcm1hbGl6ZWRTdGF0dXMpO1xyXG4gIGNvbnN0IHByb3RlY3RzQ29tcGxldGVkQ3VycmVudEV4cGVyaW1lbnQgPSB0YXJnZXRTdGF0dXNSYW5rID4gMCAmJiB0YXJnZXRTdGF0dXNSYW5rIDwgNTtcclxuICBjb25zdCBwcm90ZWN0ZWRDb21wbGV0ZWRUcmF5Q29kZXMgPSBuZXcgU2V0KFxyXG4gICAgYXNBcnJheShzYW1wbGVzKVxyXG4gICAgICAuZmlsdGVyKChzYW1wbGUpID0+IG5vcm1hbGl6ZVRleHQoc2FtcGxlPy50YXNrX2NvZGUpID09PSB0YXNrQ29kZSlcclxuICAgICAgLmZsYXRNYXAoKHNhbXBsZSkgPT5cclxuICAgICAgICBhc0FycmF5KHNhbXBsZT8udHJheXMpXHJcbiAgICAgICAgICAubWFwKCh0cmF5KSA9PiBub3JtYWxpemVUZXh0KHRyYXk/LnRyYXlfY29kZSkpXHJcbiAgICAgICAgICAuZmlsdGVyKCh0cmF5Q29kZSkgPT5cclxuICAgICAgICAgICAgdHJheUNvZGVTZXQuaGFzKHRyYXlDb2RlKVxyXG4gICAgICAgICAgICAmJiBwcm90ZWN0c0NvbXBsZXRlZEN1cnJlbnRFeHBlcmltZW50XHJcbiAgICAgICAgICAgICYmIGV4cGVyaW1lbnRJc0NvbXBsZXRlZEluU2FtcGxlSGlzdG9yeSh7XHJcbiAgICAgICAgICAgICAgZXhwZXJpbWVudE5hbWU6IGN1cnJlbnRUYXNrLmV4cGVyaW1lbnROYW1lLFxyXG4gICAgICAgICAgICAgIHNhbXBsZSxcclxuICAgICAgICAgICAgICB0YXNrQ29kZSxcclxuICAgICAgICAgICAgICB0cmF5Q29kZSxcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICApLFxyXG4gICAgICApXHJcbiAgICAgIC5maWx0ZXIoQm9vbGVhbiksXHJcbiAgKTtcclxuICBjb25zdCBtdXRhYmxlVHJheUNvZGVzID0gQXJyYXkuZnJvbSh0cmF5Q29kZVNldCkuZmlsdGVyKCh0cmF5Q29kZSkgPT4gIXByb3RlY3RlZENvbXBsZXRlZFRyYXlDb2Rlcy5oYXModHJheUNvZGUpKTtcclxuICBpZiAobXV0YWJsZVRyYXlDb2Rlcy5sZW5ndGggPT09IDApIHtcclxuICAgIHJldHVybiBhc0FycmF5KHNhbXBsZXMpO1xyXG4gIH1cclxuXHJcbiAgY29uc3Qgc3luY2VkU2FtcGxlcyA9IHN5bmNocm9uaXplU2FtcGxlc0ZvclRyYXlDb2Rlcyh7XHJcbiAgICBoaXN0b3J5QWN0aW9uLFxyXG4gICAgaGlzdG9yeURldGFpbDogZGV0YWlsLFxyXG4gICAgbG9jYXRpb246IG5vcm1hbGl6ZVRleHQoY3VycmVudFRhc2suZGV2aWNlKSB8fCBTQUxUX1NQUkFZX0xBQixcclxuICAgIG5vdyxcclxuICAgIHNhbXBsZXM6IHNjb3BlZFNhbXBsZXMsXHJcbiAgICBzdGF0dXM6IG5vcm1hbGl6ZWRTdGF0dXMsXHJcbiAgICB0YXJnZXRFeHBlcmltZW50Q29kZTogbm9ybWFsaXplVGV4dChjdXJyZW50VGFzay5leHBlcmltZW50Q29kZSksXHJcbiAgICB0YXJnZXRMYWI6IG5vcm1hbGl6ZVRleHQoY3VycmVudFRhc2suZGV2aWNlKSB8fCBTQUxUX1NQUkFZX0xBQixcclxuICAgIHRyYXlDb2RlczogbXV0YWJsZVRyYXlDb2RlcyxcclxuICB9KS5zYW1wbGVzO1xyXG4gIGNvbnN0IHN5bmNlZEJ5Q29kZSA9IG5ldyBNYXAoc3luY2VkU2FtcGxlcy5tYXAoKHNhbXBsZSkgPT4gW25vcm1hbGl6ZVRleHQoc2FtcGxlPy5jb2RlKSwgc2FtcGxlXSkpO1xyXG4gIHJldHVybiBhc0FycmF5KHNhbXBsZXMpLm1hcCgoc2FtcGxlKSA9PiBzeW5jZWRCeUNvZGUuZ2V0KG5vcm1hbGl6ZVRleHQoc2FtcGxlPy5jb2RlKSkgfHwgc2FtcGxlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVzZXRMYWJvcmF0b3J5RXhwZXJpbWVudFRyYXlzKHtcclxuICBzYW1wbGVzID0gW10sXHJcbiAgY3VycmVudFRhc2sgPSBudWxsLFxyXG4gIG5vdyA9IGZvcm1hdExvY2FsRGF0ZVRpbWUoKSxcclxufSkge1xyXG4gIGlmICghY3VycmVudFRhc2sgfHwgIWFzQXJyYXkoY3VycmVudFRhc2s/LnRyYXlDb2RlcykubGVuZ3RoKSB7XHJcbiAgICByZXR1cm4gYXNBcnJheShzYW1wbGVzKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBhcHBseUxhYm9yYXRvcnlUYXNrU3RlcCh7XHJcbiAgICBjdXJyZW50VGFzayxcclxuICAgIGhpc3RvcnlBY3Rpb246IFwi5a6e6aqM5Lu75Yqh6YeN572uXCIsXHJcbiAgICBuZXh0U3RhdHVzOiBMQUJfUkVTRVRfU1RBVFVTLFxyXG4gICAgbm93LFxyXG4gICAgc2FtcGxlcyxcclxuICAgIHRhcmdldFRyYXlDb2RlczogY3VycmVudFRhc2sudHJheUNvZGVzLFxyXG4gIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZXZlcnRMYWJvcmF0b3J5VGFza1RvUHJlRGlzcGF0Y2goe1xyXG4gIHNhbXBsZXMgPSBbXSxcclxuICBjdXJyZW50VGFzayA9IG51bGwsXHJcbiAgbm93ID0gZm9ybWF0TG9jYWxEYXRlVGltZSgpLFxyXG59KSB7XHJcbiAgaWYgKCFjdXJyZW50VGFzayB8fCAhYXNBcnJheShjdXJyZW50VGFzaz8udHJheUNvZGVzKS5sZW5ndGgpIHtcclxuICAgIHJldHVybiBhc0FycmF5KHNhbXBsZXMpO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgdGFza0NvZGUgPSBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy50YXNrQ29kZSk7XHJcbiAgY29uc3QgdHJheUNvZGVTZXQgPSBuZXcgU2V0KGFzQXJyYXkoY3VycmVudFRhc2s/LnRyYXlDb2RlcykubWFwKCh0cmF5Q29kZSkgPT4gbm9ybWFsaXplVGV4dCh0cmF5Q29kZSkpLmZpbHRlcihCb29sZWFuKSk7XHJcbiAgY29uc3QgZXhwZXJpbWVudE5hbWUgPSBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy5leHBlcmltZW50TmFtZSkgfHwgXCItXCI7XHJcblxyXG4gIHJldHVybiBhc0FycmF5KHNhbXBsZXMpLm1hcCgoc2FtcGxlKSA9PiB7XHJcbiAgICBpZiAobm9ybWFsaXplVGV4dChzYW1wbGU/LnRhc2tfY29kZSkgIT09IHRhc2tDb2RlKSB7XHJcbiAgICAgIHJldHVybiBzYW1wbGU7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHJlc3RvcmVTbmFwc2hvdCA9IG51bGw7XHJcbiAgICBsZXQgcmV2ZXJ0ZWQgPSBmYWxzZTtcclxuICAgIGNvbnN0IG5leHRUcmF5cyA9IGFzQXJyYXkoc2FtcGxlPy50cmF5cykubWFwKCh0cmF5KSA9PiB7XHJcbiAgICAgIGNvbnN0IHRyYXlDb2RlID0gbm9ybWFsaXplVGV4dCh0cmF5Py50cmF5X2NvZGUpO1xyXG4gICAgICBpZiAoIXRyYXlDb2RlU2V0Lmhhcyh0cmF5Q29kZSkgfHwgIXNob3VsZFJldmVydExhYm9yYXRvcnlUcmF5U3RhdHVzKG5vcm1hbGl6ZVRleHQodHJheT8uc3RhdHVzKSB8fCBub3JtYWxpemVUZXh0KHNhbXBsZT8uc3RhdHVzKSkpIHtcclxuICAgICAgICByZXR1cm4geyAuLi50cmF5IH07XHJcbiAgICAgIH1cclxuICAgICAgcmVzdG9yZVNuYXBzaG90ID0gcmVzdG9yZVNuYXBzaG90IHx8IHJlc29sdmVQcmVEaXNwYXRjaFNuYXBzaG90KHNhbXBsZSk7XHJcbiAgICAgIGlmICghcmVzdG9yZVNuYXBzaG90KSB7XHJcbiAgICAgICAgcmV0dXJuIHsgLi4udHJheSB9O1xyXG4gICAgICB9XHJcbiAgICAgIHJldmVydGVkID0gdHJ1ZTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICAuLi50cmF5LFxyXG4gICAgICAgIHN0YXR1czogcmVzdG9yZVNuYXBzaG90LnN0YXR1cyxcclxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXHJcbiAgICAgIH07XHJcbiAgICB9KTtcclxuXHJcbiAgICBpZiAoIXJldmVydGVkIHx8ICFyZXN0b3JlU25hcHNob3QpIHtcclxuICAgICAgcmV0dXJuIHNhbXBsZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBuZXh0U2FtcGxlID0ge1xyXG4gICAgICAuLi5zYW1wbGUsXHJcbiAgICAgIGZsb3dfc3RhdHVzOiByZXN0b3JlU25hcHNob3Quc3RhdHVzLFxyXG4gICAgICBsb2NhdGlvbjogcmVzdG9yZVNuYXBzaG90LmxvY2F0aW9uLFxyXG4gICAgICBzdGF0dXM6IHJlc3RvcmVTbmFwc2hvdC5zdGF0dXMsXHJcbiAgICAgIHRyYXlzOiBuZXh0VHJheXMsXHJcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcclxuICAgIH07XHJcbiAgICBuZXh0U2FtcGxlLmhpc3RvcnkgPSBidWlsZExhYm9yYXRvcnlIaXN0b3J5RW50cnkoXHJcbiAgICAgIG5leHRTYW1wbGUsXHJcbiAgICAgIFwi5Lu75Yqh5YiH5o2i5pKk5ZueXCIsXHJcbiAgICAgIHJlc3RvcmVTbmFwc2hvdC5zdGF0dXMsXHJcbiAgICAgIGAke3Rhc2tDb2RlfSAvICR7ZXhwZXJpbWVudE5hbWV9IC8g5pKk5Zue6IezJHtyZXN0b3JlU25hcHNob3Quc3RhdHVzfWAsXHJcbiAgICAgIG5vdyxcclxuICAgICk7XHJcbiAgICByZXR1cm4gbmV4dFNhbXBsZTtcclxuICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmV2ZXJ0TGFib3JhdG9yeVRhc2tUb1ByZXZpb3VzU3RhYmxlU3RhdGUoe1xyXG4gIGFsbG93UnVubmluZ1JldmVydCA9IGZhbHNlLFxyXG4gIHNhbXBsZXMgPSBbXSxcclxuICBjdXJyZW50VGFzayA9IG51bGwsXHJcbiAgbm93ID0gZm9ybWF0TG9jYWxEYXRlVGltZSgpLFxyXG59KSB7XHJcbiAgaWYgKCFjdXJyZW50VGFzayB8fCAhYXNBcnJheShjdXJyZW50VGFzaz8udHJheUNvZGVzKS5sZW5ndGgpIHtcclxuICAgIHJldHVybiBhc0FycmF5KHNhbXBsZXMpO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgdGFza0NvZGUgPSBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy50YXNrQ29kZSk7XHJcbiAgY29uc3QgdHJheUNvZGVTZXQgPSBuZXcgU2V0KGFzQXJyYXkoY3VycmVudFRhc2s/LnRyYXlDb2RlcykubWFwKCh0cmF5Q29kZSkgPT4gbm9ybWFsaXplVGV4dCh0cmF5Q29kZSkpLmZpbHRlcihCb29sZWFuKSk7XHJcbiAgY29uc3QgZXhwZXJpbWVudE5hbWUgPSBub3JtYWxpemVUZXh0KGN1cnJlbnRUYXNrPy5leHBlcmltZW50TmFtZSkgfHwgXCItXCI7XHJcblxyXG4gIHJldHVybiBhc0FycmF5KHNhbXBsZXMpLm1hcCgoc2FtcGxlKSA9PiB7XHJcbiAgICBpZiAobm9ybWFsaXplVGV4dChzYW1wbGU/LnRhc2tfY29kZSkgIT09IHRhc2tDb2RlKSB7XHJcbiAgICAgIHJldHVybiBzYW1wbGU7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHJlc3RvcmVTbmFwc2hvdCA9IG51bGw7XHJcbiAgICBsZXQgcmV2ZXJ0ZWQgPSBmYWxzZTtcclxuICAgIGNvbnN0IG5leHRUcmF5cyA9IGFzQXJyYXkoc2FtcGxlPy50cmF5cykubWFwKCh0cmF5KSA9PiB7XHJcbiAgICAgIGNvbnN0IHRyYXlDb2RlID0gbm9ybWFsaXplVGV4dCh0cmF5Py50cmF5X2NvZGUpO1xyXG4gICAgICBpZiAoXHJcbiAgICAgICAgIXRyYXlDb2RlU2V0Lmhhcyh0cmF5Q29kZSlcclxuICAgICAgICB8fCAhc2hvdWxkUmV2ZXJ0TGFib3JhdG9yeVRyYXlTdGF0dXMobm9ybWFsaXplVGV4dCh0cmF5Py5zdGF0dXMpIHx8IG5vcm1hbGl6ZVRleHQoc2FtcGxlPy5zdGF0dXMpLCB7XHJcbiAgICAgICAgICBpbmNsdWRlUnVubmluZzogYWxsb3dSdW5uaW5nUmV2ZXJ0LFxyXG4gICAgICAgIH0pXHJcbiAgICAgICkge1xyXG4gICAgICAgIHJldHVybiB7IC4uLnRyYXkgfTtcclxuICAgICAgfVxyXG4gICAgICByZXN0b3JlU25hcHNob3QgPSByZXN0b3JlU25hcHNob3QgfHwgcmVzb2x2ZVByZXZpb3VzU3RhYmxlU25hcHNob3Qoc2FtcGxlLCB0YXNrQ29kZSwgZXhwZXJpbWVudE5hbWUpO1xyXG4gICAgICByZXZlcnRlZCA9IHRydWU7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgLi4udHJheSxcclxuICAgICAgICBzdGF0dXM6IHJlc3RvcmVTbmFwc2hvdC5zdGF0dXMsXHJcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxyXG4gICAgICB9O1xyXG4gICAgfSk7XHJcblxyXG4gICAgaWYgKCFyZXZlcnRlZCB8fCAhcmVzdG9yZVNuYXBzaG90KSB7XHJcbiAgICAgIHJldHVybiBzYW1wbGU7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbmV4dFNhbXBsZSA9IHtcclxuICAgICAgLi4uc2FtcGxlLFxyXG4gICAgICBmbG93X3N0YXR1czogcmVzdG9yZVNuYXBzaG90LnN0YXR1cyxcclxuICAgICAgbG9jYXRpb246IHJlc3RvcmVTbmFwc2hvdC5sb2NhdGlvbixcclxuICAgICAgc3RhdHVzOiByZXN0b3JlU25hcHNob3Quc3RhdHVzLFxyXG4gICAgICB0cmF5czogbmV4dFRyYXlzLFxyXG4gICAgICB1cGRhdGVkX2F0OiBub3csXHJcbiAgICB9O1xyXG4gICAgY29uc3QgZGV0YWlsVGFyZ2V0ID0gcmVzdG9yZVNuYXBzaG90LmV4cGVyaW1lbnROYW1lXHJcbiAgICAgID8gYCR7cmVzdG9yZVNuYXBzaG90LmV4cGVyaW1lbnROYW1lfeW3suWujOaIkGBcclxuICAgICAgOiByZXN0b3JlU25hcHNob3Quc3RhdHVzO1xyXG4gICAgbmV4dFNhbXBsZS5oaXN0b3J5ID0gYnVpbGRMYWJvcmF0b3J5SGlzdG9yeUVudHJ5KFxyXG4gICAgICBuZXh0U2FtcGxlLFxyXG4gICAgICBcIuS7u+WKoeWIh+aNouaSpOWbnlwiLFxyXG4gICAgICByZXN0b3JlU25hcHNob3Quc3RhdHVzLFxyXG4gICAgICBgJHt0YXNrQ29kZX0gLyAke2V4cGVyaW1lbnROYW1lfSAvIOaSpOWbnuiHsyR7ZGV0YWlsVGFyZ2V0fWAsXHJcbiAgICAgIG5vdyxcclxuICAgICk7XHJcbiAgICByZXR1cm4gbmV4dFNhbXBsZTtcclxuICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gYnVpbGRMYWJvcmF0b3J5Q2hlY2tsaXN0KHRhc2spIHtcclxuICBpZiAoIXRhc2spIHtcclxuICAgIHJldHVybiBbXTtcclxuICB9XHJcbiAgcmV0dXJuIFtcclxuICAgIHsgbGFiZWw6IFwi5Lu75Yqh57yW5Y+3XCIsIHZhbHVlOiB0YXNrLnRhc2tDb2RlIHx8IFwiLVwiIH0sXHJcbiAgICB7IGxhYmVsOiBcIuWunumqjOmhueebrlwiLCB2YWx1ZTogdGFzay5leHBlcmltZW50TmFtZSB8fCBcIi1cIiB9LFxyXG4gICAgeyBsYWJlbDogXCLmiafooYzkurrlkZhcIiwgdmFsdWU6IHRhc2sub3duZXIgfHwgXCItXCIgfSxcclxuICAgIHsgbGFiZWw6IFwi5byA5aeL5pe26Ze0XCIsIHZhbHVlOiB0YXNrLnN0YXJ0VGltZUxhYmVsIHx8IFwiLVwiIH0sXHJcbiAgICB7IGxhYmVsOiBcIue7k+adn+aXtumXtFwiLCB2YWx1ZTogdGFzay5lbmRUaW1lTGFiZWwgfHwgXCItXCIgfSxcclxuICAgIHsgbGFiZWw6IFwi5qC35ZOB5pWw6YePXCIsIHZhbHVlOiB0YXNrLnNhbXBsZUNvdW50ID8gYCR7dGFzay5zYW1wbGVDb3VudH0g5Lu2YCA6IFwiLVwiIH0sXHJcbiAgICB7IGxhYmVsOiBcIuWunumqjOWupFwiLCB2YWx1ZTogdGFzay5kZXZpY2UgfHwgU0FMVF9TUFJBWV9MQUIgfSxcclxuICBdO1xyXG59XHJcblxyXG5mdW5jdGlvbiB2YWxpZGF0ZUxhYm9yYXRvcnlUcmF5U2Nhbih7IGN1cnJlbnRUYXNrID0gbnVsbCwgc2NoZWR1bGVSb3dzID0gW10sIGFsbFNjaGVkdWxlUm93cyA9IFtdLCBzY2FuQ29kZSA9IFwiXCIgfSkge1xyXG4gIGNvbnN0IG5vcm1hbGl6ZWRTY2FuQ29kZSA9IG5vcm1hbGl6ZVRleHQoc2NhbkNvZGUpO1xyXG4gIGlmICghbm9ybWFsaXplZFNjYW5Db2RlKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBndWlkYW5jZTogXCLor7fmiavmj4/miZjnm5jnvJblj7dcIixcclxuICAgICAgbWVzc2FnZTogXCLor7fmiavmj4/miZjnm5jnvJblj7dcIixcclxuICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICB0b25lOiBcImVycm9yXCIsXHJcbiAgICB9O1xyXG4gIH1cclxuICBpZiAoIWN1cnJlbnRUYXNrKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBndWlkYW5jZTogXCLlvZPliY3msqHmnInlj6/mr5Tlr7nnmoTku7vliqFcIixcclxuICAgICAgbWVzc2FnZTogXCLlvZPliY3msqHmnInlj6/mr5Tlr7nnmoTku7vliqFcIixcclxuICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICB0b25lOiBcImVycm9yXCIsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgY29uc3QgY3VycmVudFRhc2tUcmF5Q29kZXMgPSB1bmlxdWVWYWx1ZXMoWy4uLmFzQXJyYXkoY3VycmVudFRhc2sudHJheUNvZGVzKSwgLi4uYXNBcnJheShjdXJyZW50VGFzay5hbGxUcmF5Q29kZXMpXSk7XHJcbiAgaWYgKGN1cnJlbnRUYXNrVHJheUNvZGVzLmluY2x1ZGVzKG5vcm1hbGl6ZWRTY2FuQ29kZSkpIHtcclxuICAgIGNvbnN0IG1hdGNoZWRUcmF5ID1cclxuICAgICAgYXNBcnJheShjdXJyZW50VGFzay50cmF5Um93cykuZmluZCgocm93KSA9PiBub3JtYWxpemVUZXh0KHJvdz8udHJheUNvZGUpID09PSBub3JtYWxpemVkU2NhbkNvZGUpXHJcbiAgICAgIHx8IGFzQXJyYXkoY3VycmVudFRhc2suYWxsVHJheVJvd3MpLmZpbmQoKHJvdykgPT4gbm9ybWFsaXplVGV4dChyb3c/LnRyYXlDb2RlKSA9PT0gbm9ybWFsaXplZFNjYW5Db2RlKVxyXG4gICAgICB8fCBudWxsO1xyXG4gICAgY29uc3QgdHJheVN0YXR1cyA9IG5vcm1hbGl6ZVRleHQobWF0Y2hlZFRyYXk/LnRyYXlTdGF0dXMpIHx8IG5vcm1hbGl6ZVRleHQobWF0Y2hlZFRyYXk/LmRpc3BsYXlTdGF0dXMpO1xyXG4gICAgY29uc3QgYWN0aXZlT3RoZXJFeHBlcmltZW50UnVuID0gYXNBcnJheShtYXRjaGVkVHJheT8uYWN0aXZlT3RoZXJFeHBlcmltZW50UnVucylbMF0gfHwgbWF0Y2hlZFRyYXk/LmFjdGl2ZU90aGVyRXhwZXJpbWVudFJ1biB8fCBudWxsO1xyXG4gICAgaWYgKGFjdGl2ZU90aGVyRXhwZXJpbWVudFJ1bikge1xyXG4gICAgICByZXR1cm4gYnVpbGRBY3RpdmVPdGhlckV4cGVyaW1lbnRDb21wYXJpc29uUmVzdWx0KG5vcm1hbGl6ZWRTY2FuQ29kZSwgYWN0aXZlT3RoZXJFeHBlcmltZW50UnVuKTtcclxuICAgIH1cclxuICAgIGlmICh0cmF5TGlmZWN5Y2xlSXNCZWZvcmVMYWJvcmF0b3J5RGlzcGF0Y2gobWF0Y2hlZFRyYXkpKSB7XHJcbiAgICAgIHJldHVybiBidWlsZE5vdERpc3BhdGNoZWRDb21wYXJpc29uUmVzdWx0KG5vcm1hbGl6ZWRTY2FuQ29kZSwge1xyXG4gICAgICAgIC4uLm1hdGNoZWRUcmF5LFxyXG4gICAgICAgIGN1cnJlbnRMb2NhdGlvbjogbm9ybWFsaXplVGV4dChtYXRjaGVkVHJheT8ubGlmZWN5Y2xlTG9jYXRpb24pIHx8IG5vcm1hbGl6ZVRleHQobWF0Y2hlZFRyYXk/LmN1cnJlbnRMb2NhdGlvbiksXHJcbiAgICAgICAgdHJheVN0YXR1czogbm9ybWFsaXplVGV4dChtYXRjaGVkVHJheT8ubGlmZWN5Y2xlU3RhdHVzKSB8fCB0cmF5U3RhdHVzLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIGlmIChyZXNvbHZlTGFib3JhdG9yeVN0YXR1c1JhbmsodHJheVN0YXR1cykgPj0gMSkge1xyXG4gICAgICBpZiAodHJheUlzQ29tcGxldGVkRm9yQ3VycmVudEV4cGVyaW1lbnQobWF0Y2hlZFRyYXksIGN1cnJlbnRUYXNrKSkge1xyXG4gICAgICAgIHJldHVybiBidWlsZEJsb2NrZWRDb21wYXJpc29uUmVzdWx0KG5vcm1hbGl6ZWRTY2FuQ29kZSwgdHJheVN0YXR1cyk7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgY2FuRW50ZXJOZXh0RXhwZXJpbWVudCA9XHJcbiAgICAgICAgKHRyYXlTdGF0dXMgPT09IFwi5a6e6aqM5bey5a6M5oiQXCIgfHwgdHJheVN0YXR1cyA9PT0gXCLlrp7pqozlrozmiJBcIiB8fCB0cmF5U3RhdHVzID09PSBcIuWunumqjOW3sue7j+WujOaIkFwiKVxyXG4gICAgICAgICYmIGlzUHJldmlvdXNFeHBlcmltZW50Q29tcGxldGlvbkZvckN1cnJlbnRUYXNrKG1hdGNoZWRUcmF5LCBjdXJyZW50VGFzayk7XHJcbiAgICAgIGlmIChjYW5FbnRlck5leHRFeHBlcmltZW50KSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIGd1aWRhbmNlOiBgJHtub3JtYWxpemVkU2NhbkNvZGV9IOWxnuS6juW9k+WJjeS7u+WKoSAke2N1cnJlbnRUYXNrLnRhc2tDb2RlfWAsXHJcbiAgICAgICAgICBtYXRjaGVkUm93OiBjdXJyZW50VGFzayxcclxuICAgICAgICAgIG1lc3NhZ2U6IFwi5q+U5a+55q2j56GuXCIsXHJcbiAgICAgICAgICBvazogdHJ1ZSxcclxuICAgICAgICAgIHRvbmU6IFwic3VjY2Vzc1wiLFxyXG4gICAgICAgICAgdHJheUNvZGU6IG5vcm1hbGl6ZWRTY2FuQ29kZSxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBidWlsZEJsb2NrZWRDb21wYXJpc29uUmVzdWx0KG5vcm1hbGl6ZWRTY2FuQ29kZSwgdHJheVN0YXR1cyk7XHJcbiAgICB9XHJcbiAgICBpZiAodHJheVN0YXR1cyAhPT0gTEFCX1JFU0VUX1NUQVRVUykge1xyXG4gICAgICByZXR1cm4gYnVpbGROb3REaXNwYXRjaGVkQ29tcGFyaXNvblJlc3VsdChub3JtYWxpemVkU2NhbkNvZGUsIG1hdGNoZWRUcmF5KTtcclxuICAgIH1cclxuICAgIGlmICghdHJheUlzRGlzcGF0Y2hlZFRvQ3VycmVudExhYm9yYXRvcnkobWF0Y2hlZFRyYXksIGN1cnJlbnRUYXNrKSkge1xyXG4gICAgICByZXR1cm4gYnVpbGRXcm9uZ0xhYm9yYXRvcnlEaXNwYXRjaFJlc3VsdChub3JtYWxpemVkU2NhbkNvZGUsIG1hdGNoZWRUcmF5LCBjdXJyZW50VGFzayk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBndWlkYW5jZTogYCR7bm9ybWFsaXplZFNjYW5Db2RlfSDlsZ7kuo7lvZPliY3ku7vliqEgJHtjdXJyZW50VGFzay50YXNrQ29kZX1gLFxyXG4gICAgICBtYXRjaGVkUm93OiBjdXJyZW50VGFzayxcclxuICAgICAgbWVzc2FnZTogXCLmr5Tlr7nmraPnoa5cIixcclxuICAgICAgb2s6IHRydWUsXHJcbiAgICAgIHRvbmU6IFwic3VjY2Vzc1wiLFxyXG4gICAgICB0cmF5Q29kZTogbm9ybWFsaXplZFNjYW5Db2RlLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIGNvbnN0IHNlYXJjaFJvd3MgPSBhc0FycmF5KGFsbFNjaGVkdWxlUm93cykubGVuZ3RoID8gYXNBcnJheShhbGxTY2hlZHVsZVJvd3MpIDogYXNBcnJheShzY2hlZHVsZVJvd3MpO1xyXG4gIGNvbnN0IG1hdGNoZWRSb3dzID0gc2VhcmNoUm93cy5maWx0ZXIoKHJvdykgPT5cclxuICAgIHVuaXF1ZVZhbHVlcyhbLi4uYXNBcnJheShyb3cudHJheUNvZGVzKSwgLi4uYXNBcnJheShyb3cuYWxsVHJheUNvZGVzKV0pLmluY2x1ZGVzKG5vcm1hbGl6ZWRTY2FuQ29kZSksXHJcbiAgKTtcclxuICBpZiAobWF0Y2hlZFJvd3MubGVuZ3RoID4gMCkge1xyXG4gICAgY29uc3QgZGVzdGluYXRpb25MYWJlbHMgPSB1bmlxdWVWYWx1ZXMobWF0Y2hlZFJvd3MubWFwKChyb3cpID0+IHJvdy5kZXZpY2UpKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGd1aWRhbmNlOiBg5b2T5YmN5Lu75Yqh5bm26Z2e5LyY5YWI5omA6YCJ5Lu75Yqh44CC6K+l5omY55uY5Y+v5YmN5b6A77yaJHtkZXN0aW5hdGlvbkxhYmVscy5qb2luKFwi44CBXCIpfWAsXHJcbiAgICAgIG1hdGNoZWRSb3c6IG1hdGNoZWRSb3dzWzBdLFxyXG4gICAgICBtYXRjaGVkUm93cyxcclxuICAgICAgbWVzc2FnZTogXCLmr5Tlr7nkuI3mraPnoa5cIixcclxuICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICB0b25lOiBcImVycm9yXCIsXHJcbiAgICAgIHRyYXlDb2RlOiBub3JtYWxpemVkU2NhbkNvZGUsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIGd1aWRhbmNlOiBcIuacquWMuemFjeWIsOivpeaJmOebmFwiLFxyXG4gICAgbWVzc2FnZTogXCLmnKrljLnphY3liLDku7vliqFcIixcclxuICAgIG9rOiBmYWxzZSxcclxuICAgIHRvbmU6IFwiZXJyb3JcIixcclxuICAgIHRyYXlDb2RlOiBub3JtYWxpemVkU2NhbkNvZGUsXHJcbiAgfTtcclxufVxyXG5cclxuZXhwb3J0IHtcclxuICBhcHBseUxhYm9yYXRvcnlUYXNrU3RlcCxcclxuICBTQUxUX1NQUkFZX0xBQixcclxuICBMQUJfQ09NUEFSRV9TVEFUVVMsXHJcbiAgTEFCX0lOU1RBTExfU1RBVFVTLFxyXG4gIExBQl9SRUFEWV9TVEFUVVMsXHJcbiAgYnVpbGRMYWJvcmF0b3J5Q2hlY2tsaXN0LFxyXG4gIGJ1aWxkTGFib3JhdG9yeVdvcmtiZW5jaFZpZXcsXHJcbiAgYnVpbGRMYWJvcmF0b3J5UHJvZ3Jlc3NNZXNzYWdlLFxyXG4gIGJ1aWxkTGFib3JhdG9yeVN1bW1hcnksXHJcbiAgYnVpbGRMYWJvcmF0b3J5V29ya2Zsb3dGcm9tVGFzayxcclxuICBidWlsZFNhbHRTcHJheUxhYm9yYXRvcnlWaWV3LFxyXG4gIGNvbXBsZXRlTGFib3JhdG9yeUNvbXBhcmlzb24sXHJcbiAgY29tcGxldGVMYWJvcmF0b3J5SW5zdGFsbGF0aW9uLFxyXG4gIGNvbmZpcm1MYWJvcmF0b3J5RXhwZXJpbWVudCxcclxuICBjcmVhdGVMYWJvcmF0b3J5V29ya2Zsb3csXHJcbiAgZ2V0TGFib3JhdG9yeUFjdGlvblN0YXRlLFxyXG4gIGdldExhYm9yYXRvcnlPcGVyYXRpb25Mb2NrLFxyXG4gIHJlc2V0TGFib3JhdG9yeUV4cGVyaW1lbnRUcmF5cyxcclxuICByZXZlcnRMYWJvcmF0b3J5VGFza1RvUHJldmlvdXNTdGFibGVTdGF0ZSxcclxuICByZXZlcnRMYWJvcmF0b3J5VGFza1RvUHJlRGlzcGF0Y2gsXHJcbiAgdmFsaWRhdGVMYWJvcmF0b3J5VHJheVNjYW4sXHJcbn07XHJcbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxNQUFNLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQztBQUNwQixDQUFDLENBQUMsaUJBQWlCLENBQUM7QUFDcEIsQ0FBQyxDQUFDLHdCQUF3QixDQUFDO0FBQzNCLENBQUMsQ0FBQyw4QkFBOEIsQ0FBQztBQUNqQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUNsRCxNQUFNLENBQUMsQ0FBQyxDQUFDLHlC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QTZCLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDNUUsS0FBSyxDQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDekYsS0FBSyxDQUFDLGlDQUFpQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDbkQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLDZCQUE2QixDQUFDO0FBQ25DLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDYixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNULENBQUMsQ0FBQyxDQUFDO0FBQ0gsQ0FBQztBQUNELEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7QUFDNUQs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QUFDLEVBQUUsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3JDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQy9ELENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDL0MsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDNUIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNoRCxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDOUMsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN0QyxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDaEMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ2hFLENBQUMsQ0FBQyxDQUFDO0FBQ0gsQ0FBQztBQUNELEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDNUQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDO0FBQ3ZCLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsU0FBUyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7QUFDNUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN0QixDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUMxQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO0FBQzdFLENBQUMsQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDdkUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDO0FBQ3ZILENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsaUJBQWlCLENBQUM7QUFDMUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDWixDQUFDLENBQUMsQ0FBQztBQUNILENBQUM7QUFDRCxLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzFELENBQUMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUN0QyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNyRixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQztBQUNyRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1YsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0FBQzlCLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2hCLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQy9CLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDMUQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM5RCxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEMsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDbkMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDeEUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNoQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2YsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7QUFDL0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDM0MsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzlELENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkQsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNwQyxDQUFDLENBQUMsQ0FBQztBQUNILENBQUM7QUFDRCxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNwQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDOUIsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNoQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEIsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7QUFDL0IsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3ZELENBQUMsQ0FBQyxDQUFDO0FBQ0gsQ0FBQztBQUNELEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzNDLENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzlELENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3pFLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2xGLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3pFLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDM0MsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3hDLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzFCLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxD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QUFNLENBQUMsQ0FBQztBQUNoRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNqQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsMkJBQTJCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLDhCQUE4QixDQUFDLENBQUM7QUFDakgsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1gsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNyQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3JCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDZixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM1QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsOEJBQThCLENBQUMsQ0FBQztBQUNsRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsMkJBQTJCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLENBQUM7QUFDekcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQ2hELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDckIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQ3BELENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3BELENBQUMsQ0FBQyxDQUFDO0FBQ0gsQ0FBQztBQUNELEtBQUssQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN4RixDQUFDLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDNUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLDJCQUEyQixDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7QUFDeEQsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDNUYsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLDJCQUEyQixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNqRCxDQUFDLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDM0MsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzNDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2QsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMzQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNkLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDekMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN4RCxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNkLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3RGLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2QsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDWixDQUFDLENBQUMsQ0FBQztBQUNILENBQUM7QUFDRCxLQUFLLENBQUMsMEJBQTBCLENBQUMsQ0FBQyxDQUFDLENBQUMs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LENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkksQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQ2IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3ZELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMxQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNqQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDckIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQztBQUNwQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3BFLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNiLENBQUMsQ0FBQyxDQUFD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QUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNyQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDbkQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7QUFDdEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQ3BCLENBQUMsQ0FBQyxDQUFDO0FBQ0gsQ0FBQztBQUNELEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDN0QsQ0FBQyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN4QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDbEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO0FBQzlDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztBQUN0QixDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN4RSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUNqQixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDWCxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2pDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDekIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLDBDQUEwQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2xHLENBQUMsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDOUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN0QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyw0QkFBNEIsQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQzVFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3JHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDckIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNmLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDL0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUNyRixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDekIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJ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QztBQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMvQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQztBQUNqQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDeEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUM7QUFDOUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFNBQVMsQ0FBQztBQUN4QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztBQUM3QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQztBQUN4QixDQUFDLENBQUM7QUFDRjtBQUNBLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVGLENBQUMsQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsS0FB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LENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQztBQUM5RSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM3QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUM7QUFDYixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsNEJBQTRCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNuRixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUM7QUFDYixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHlCQUF5QixDQUFDLEtBQUssQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNuRixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUM7QUFDYixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLHlCQUF5QixDQUFDO0FBQ2hELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLFVBQVUsQ0FBQztBQUN4QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxTQUFTLENBQUM7QUFDdkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDO0FBQ3RCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLGFBQWEsQ0FBQztBQUMzQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxZQUFZLENBQUM7QUFDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDO0FBQ3BCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7QUFDckIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDO0FBQ2IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUMsQ0FBQztBQUNoQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsb0JBQW9CLENBQUM7QUFDakYsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsK0JBQStCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDN0csQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQy9DLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDO0FBQ2pDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN4QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsb0JBQW9CLENBQUM7QUFDN0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztBQUNsQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxDQUFDO0FBQ3hCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO0FBQzdCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDO0FBQ3hCLENBQUMsQ0FBQztBQUNGO0FBQ0EsS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNyRyxDQUFDLENBQUMsdUJBQXVCLENBQUMsR0FBRyxDQUFDLG9DQUFvQyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNwSCxD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QyxLQUFLLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQ3RELENBQUMsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQztBQUM5RCxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDOUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN2RixDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNYLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVFLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMxQixDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ2YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FB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QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsNEJBQTRCLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUM5RSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNuRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ2xCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDVixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3BELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDckUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx5QkFBeUIsQ0FBQyxLQUFLLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQ3ZFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNYLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2hELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDOUQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN6RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMzRixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNaLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1osQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNWLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUM7QUFDRCxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3hDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM3SCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQ2YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3JDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUN6SCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNULENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUM7QUFDRCxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN2QixDQUFDLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN2QyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0FBQ2hELENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN4RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUMxRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztBQUNyQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO0FBQ3ZELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3BFLENBQUMsQ0FBQyxDQUFDLENB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QyxDQUFDLHdCQUF3QixDQUFDLENBQUM7QUFDOUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUNWLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDdEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDSCxLQUFLLENBQUMsZ0NBQWdDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDbEQsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQ2hHLEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDL0MsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUM7QUFDVixDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxRQUFRLENBQUM7QUFDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUM7QUFDOUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDbkQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7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LENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUM7QUFDL0QsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDO0FBQzNELENBQUMsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQztBQUNyRCxDQUFDLENBQUMsTUFBTSxDQUFDLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQztBQUNwRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztBQUNoRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQztBQUM3QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLDJCQUEyQixDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQztBQUN4RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLDJCQUEyQixDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztBQUN0RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLDJCQUEyQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQztBQUNuRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDckMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENB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QUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzNJLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN0QyxDQUFDLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM1QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNsRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3JELENBQUM7QUFDRCxLQUFLLENBQUMsZ0NBQWdDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVELENBQUMsQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3BHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM1QyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FB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QUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3JCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDdEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN4QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzNCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDL0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDdkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNwQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3JCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDcEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDO0FBQ0QsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxD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QixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2pDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUNoQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM3RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDL0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQztBQUN0QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztBQUNoRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDbEIsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDbkUsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQ25GLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNuSCxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3pDLENBQUMsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDeEcsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDckksS0FBSyxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDekYsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQ2xHLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQzlGLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDaEosS0FBSyxDQUFDLDZCQUE2QixDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNuRCxDQUFDLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNqSixLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNySSxLQUFLLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3pDLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ3hFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDO0FBQ3BGLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUM7QUFDbkY7QUFDQSxLQUFLLENBQUMsaUNBQWlDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2xILENBQUMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDdEQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQztBQUNsRSxDQUFDLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDbEcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDL0QsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM1RSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUNyQixDQUFDLENBQUMsQ0FBQztBQUNILENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDO0FBQzFCLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQztBQUMzQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDN0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDM0MsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUNqQixDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQztBQUMvQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDN0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ1osQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVE7QUFDeEQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWM7QUFDdkUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQztBQUMzQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDWCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUM7QUFDdkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDVCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDO0FBQ2hDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLHdCQUF3QixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsaUJBQWlCLENBQUM7QUFDMUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDVCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQ3hFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDO0FBQzlFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLHVCQUF1QixDQUFDO0FBQ25DLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQ3ZCLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUM7QUFDRixLQUFLLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDaEYsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3ZFLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ2pILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDL0ksS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN2QyxDQUFDLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDO0FBQzFILEtBQUssQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsNkJBQTZCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7QUFDMUk7QUFDQSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNsSSxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQ3RELENBQUMsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUM7QUFDbEUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2xHLENBQUMsQ0FBQyxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQy9ELENBQUMsQ0FBQyxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLFVBQVUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUNoRyxDQUFDLENBQUMsS0FBSyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxRQUFRLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDN0YsQ0FBQyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDO0FBQzVDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQztBQUMzQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN0QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRO0FBQzVDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWM7QUFDM0QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVU7QUFDckIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDO0FBQ3BELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO0FBQy9FLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQ25CLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2pDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0I7QUFDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN2QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQjtBQUM5QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDO0FBQzVCLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMvQixDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUM7QUFDaEIsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUM1QixDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUM7QUFDM0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3JCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDVCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3hELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDaEQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQzNELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDNUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNWLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0FBQzNDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsS0FBSyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzNELENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLGtCQUFrQixDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNoRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQ3RFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDO0FBQ3JCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQzFELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7QUFDN0YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUM7QUFDckIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVB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QUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7QUFDN0QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVU7QUFDckMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7QUFDOUQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNiLENBQUMsQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztBQUMxQixDQUFDLENBQUMsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLGtCQUFrQjtBQUN2RSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDO0FBQzFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQztBQUMzRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2IsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ1YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQztBQUN2QixDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQztBQUNuQixDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDO0FBQ3ZCLENBQUMsQ0FBQyxDQUFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxTQUFTLENBQUM7QUFDakMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQztBQUN2QixDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixDQUFDO0FBQ3pCLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDO0FBQ2hCLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDO0FBQ2YsQ0FBQyxDQUFDLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQztBQUM1QixDQUFDLENBQUMsQ0FBQyxDQUFDLG1CQUFtQixDQUFDO0FBQ3hCLENBQUMsQ0FBQyxDQUFDLENBQUMsdUJBQXVCLENBQUM7QUFDNUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLGlCQUFpQixDQUFDO0FBQzlDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUM7QUFDdkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQztBQUNyQixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDO0FBQ0Y7QUFDQSxLQUFLLENBQUMsdUNBQXVDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVGLENBQUMsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQ3RELENBQUMsQ0FBQyxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDOUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN0RCxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN0RyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQ3hELENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsNkJBQTZCLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUNwRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3hDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ2QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzFFLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDO0FBQ2xDLENBQUMsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDdEQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUMsTUFBTSxDQUFDLHdCQUF3QixDQUFDLENBQUM7QUFDbkMsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLDZDQUE2QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNsSixDQUFDLENBQUMsS0FBSyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUN0RCxDQUFDLENBQUMsS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDO0FBQ2hGLENBQUMsQ0FBQyxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDOUMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNoRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDL0UsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNqRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDO0FBQ2hFLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDakYsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsK0JBQStCLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDN0UsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMvQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQzFELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDakMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ2hCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdEYsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDbEUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUMsTUFBTSxDQUFDLHdCQUF3QixDQUFDLENBQUM7QUFDbkMsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDNUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ2pELENBQUMsQ0FBQyxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUNqRSxDQUFDLENBQUMsS0FBSyxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDekQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQ3JELENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDO0FBQzdDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUM7QUFDWixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQjtBQUN0RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx3QkFBd0I7QUFDckUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsb0JBQW9CLENBQUM7QUFDdEgsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUM7QUFDdEcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLCtCQUErQixDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNyRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNoRyxDQUFDLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUNqQyxDQUFDLENBQUMsQ0FBQztBQUNILENBQUM7QUFDRCxLQUFLLENBQUMsb0NBQW9DLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzdJLENBQUMsQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUNqRCxDQUFDLENBQUMsS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDakUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3pELENBQUMsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUNyRCxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUMxQixDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUM1QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUM5QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLGtCQUFrQixDQUFDLENBQUM7QUFDckMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM1QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQ1gsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUM7QUFDakUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLDZCQUE2QixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUM7QUFDaEYsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsK0JBQStCLENBQUMsR0FBRyxDQUFDLHFCQUFxQixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDakYsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNWLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDdEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUM5RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUM7QUFDM0gsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUM7QUFDckIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQztBQUMvRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkksQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsS0FBSyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM5QyxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQztBQUN6QixDQUFDLENBQUMsYUFBYSxDQUFDLENBQUM7QUFDakIsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDO0FBQ2xCLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO0FBQ3RCLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUNaLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUNaLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxLQUFLLENBQUMsK0JBQStCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7QUFDaEYsQ0FBQyxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDdEQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDdEQsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLCtCQUErQixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3hGLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDZixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQztBQUNELENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDM0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDNUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFDOUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM1QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNoQyxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDMUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDO0FBQ3BFLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLCtCQUErQixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3JHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ2QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQ3ZFLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNsRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDL0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUNyQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO0FBQ2hELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLENBQUM7QUFDM0ksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDYixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUM7QUFDRCxDQUFDLENBQUMsT0FBTyxDQUFDLGtCQUFrQixDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3RELENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUNULENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUM7QUFDL0QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsdUJBQXVCLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQztBQUNsRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLCtCQUErQixDQUFDLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQy9FLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ2QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzdELENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsK0JBQStCLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDOUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyw2QkFBNkIsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzFGLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUNELENBQUMsQ0FBQyxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUM1QyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO0FBQ2hDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDNUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUM7QUFDakUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQzFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsb0JBQW9CLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzNHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUM7QUFDRCxDQUFDLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM3QyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ3JDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUMxRCxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFDVCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDO0FBQ3JELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsK0JBQStCLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFDckUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNyRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO0FBQ3JHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ2QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDO0FBQ0QsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMxQyxDQUFDLENBQUMsQ0FBQztBQUNILENBQUM7QUFDRCxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDMUIsQ0FBQyxDQUFDLE1BQU0sQ0FBQztBQUNULENBQUMsQ0FBQyxjQUFjLENBQUM7QUFDakIsQ0FBQyxDQUFDLG1CQUFtQixDQUFDO0FBQ3RCLENBQUMsQ0FBQyxjQUFjLENBQUM7QUFDakIsQ0FBQyxDQUFDLGtCQUFrQixDQUFDO0FBQ3JCLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQztBQUN4QixDQUFDLENBQUMsYUFBYSxDQUFDO0FBQ2hCLENBQUMsQ0FBQyxjQUFjLENBQUM7QUFDakIsQ0FBQyxDQUFDLFFBQVEsQ0FBQztBQUNYLENBQUMsQ0FBQyxRQUFRLENBQUM7QUFDWCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3RCLENBQUMsQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUNwQyxDQUFDLENBQUMsS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUMsQ0FBQyw4QkFBOEIsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO0FBQzFGLENBQUMsQ0FBQyxLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDcEYsQ0FBQyxDQUFDLEtBQUssQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDO0FBQ3JELENBQUMsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsUUFBUSxDQUFDO0FBQ3RDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsUUFBUSxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2xGLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0M7QUFDOUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsaUNBQWlDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUN6RixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUNoQixDQUFDLENBQUMsS0FBSyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkgsQ0FBQyxDQUFDLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDLENBQUMsNkNBQTZDLENBQUMsQ0FBQyxDQUFDO0FBQ25HLENBQUMsQ0FBQyxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQztBQUMzQixDQUFDLENBQUMsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUM7QUFDekIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO0FBQzNCLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUM7QUFDRCxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3BCLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNyQixDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNuQixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNoQixDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNuQixDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDcEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMvQixDQUFDLENBQUMsQ0FBQyxDQUFDLDJCQUEyQixDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUN6QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNULENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUN4RCxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDL0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztBQUMxRCxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQztBQUNoRixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDO0FBQ25FLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3ZDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDO0FBQy9DLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3JFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDO0FBQzlDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDckMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQy9CLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDM0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQ3JDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDbEQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQzVDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FB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Q3BELENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDaEQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUN0RCxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDL0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7QUFDdkQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDN0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMvRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDaEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFD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QUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQztBQUMxQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUN0QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDcEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNiLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNkLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxDQUFDO0FBQzFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDO0FBQzFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQywyQkFBMkIsQ0FBQyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsQ0FBQyxDQUFDO0FBQ3RFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO0FBQy9CLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUM7QUFDZixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsZUFBZSxDQUFDO0FBQzlDLENB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LEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM5QixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxDQUFDO0FBQzNFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDN0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUM7QUFDckIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDdEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQztBQUMxQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUNoQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUMvQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUixDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDLENBQUMseUJBQXlCLENBQUMsQ0FBQztBQUMvRCxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLENBQUMseUJBQXlCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDekUsQ0FBQztBQUNELENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDcEUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7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QyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMxRixDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzlFLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3BILENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0FBQzNELENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUM7QUFDL0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDO0FBQ3BELENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUM7QUFDRjtBQUNBLEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3ZELENBQUMsQ0FBQyxLQUFLLENB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QyxlQUFlLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQztBQUMxQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsMEJBQTBCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3JGLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDeEYsQ0FBQztBQUNELENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztBQUNsRCxDQUFDLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDeEYsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFH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LFFBQVEsQ0FBQywyQkFBMkIsQ0FBQztBQUMzQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNiLENBQUMsQ0FBQyxLQUFLLENBQUMsNkNBQTZDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQzlGLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDZCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsNkNBQTZDLENBQUMsQ0FBQyxDQUFDO0FBQ3JELENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsNkNBQTZDLENBQUM7QUFDN0QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDYixDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsMkJBQTJCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyw2Q0FBNkMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN2RixDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDYixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUN6QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQy9CLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQzNCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDWCxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLDRCQUE0QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMs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Q0FBQyxDQUFDLENBQUMsQ0FBQztBQUMvQixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDN0QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMxQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNuQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDMUQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMs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QUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztBQUN6RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUN0QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQztBQUNsRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDLENBQUM7QUFDdEQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUMxRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDdEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQ3hCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUN4QixDQUFDLENBQUMsQ0FBQyxDQUFD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SSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDM0ksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLDBCQUEwQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDL0UsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDOUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDdkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNmLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUNqQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ3hDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUN6QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNULENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUM7QUFDRCxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3pDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUNyQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUM7QUFDRCxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN6QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUNqQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDM0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQzFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUN0QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUN4QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUN2QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FB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QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQztBQUM5QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDWCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLDZCQUE2QixDQUFDLE1BQU0sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUM7QUFDNUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUN2QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQ2YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ2pCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDeEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3pCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1IsQ0FBQztBQUNELENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDekMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ3JCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUNELENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3pCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ2pCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUMzQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDMUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ3RDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQ3hCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxjQUFjLENBQUM7QUFDeEQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQy9DLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDaEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQywyQkFBMkIsQ0FBQyxDQUFDO0FBQ3RELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2xCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQzlCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDOUQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDWCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDdkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUM7QUFDRixDQUFDO0FBQ0QsUUFBUSxDQUFDLHdCQUF3QixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMxQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDZixDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2YsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQ1gsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNwRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzFELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDakQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMxRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3hELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEYsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM1RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUM7QUFDRixDQUFDO0FBQ0QsUUFBUSxDQUFDLDBCQUEwQixDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdEgsQ0FBQyxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDdEQsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDN0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQ2IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzNCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMxQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNqQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDckIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQ2IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzlCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM3QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNqQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMs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Q0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUM7QUFDdkgsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQztBQUMvRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLDJCQUEyQixDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN4RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMzRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLDRCQUE0QixDQUFDLGtCQUFrQixDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQztBQUM3RSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDO0FBQ3JDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDckYsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLDRDQUE0QyxDQUFDLFdBQVcsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7QUFDbkYsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDcEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDakIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDNUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUNuQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMzQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3BCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMs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RyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQztBQUMxRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2hDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDbEYsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQ2IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdEUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDbEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUM7QUFDbkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDeEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDakIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0FBQ3JCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUM7QUFDcEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDO0FBQ0QsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDWCxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN6QixDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNmLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0FBQ25CLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQztBQUNsQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUM7QUFDRixDQUFDO0FBQ0QsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNULENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDO0FBQzNCLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUNsQixDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQztBQUN0QixDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQztBQUN0QixDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztBQUNwQixDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQztBQUM1QixDQUFDLENBQUMsNEJBQTRCLENBQUMsQ0FBQztBQUNoQyxDQUFDLENBQUMsOEJBQThCLENBQUMsQ0FBQztBQUNsQyxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQztBQUMxQixDQUFDLENBQUMsK0JBQStCLENBQUMsQ0FBQztBQUNuQyxDQUFDLENBQUMsNEJBQTRCLENBQUMsQ0FBQztBQUNoQyxDQUFDLENBQUMsNEJBQTRCLENBQUMsQ0FBQztBQUNoQyxDQUFDLENBQUMsOEJBQThCLENBQUMsQ0FBQztBQUNsQyxDQUFDLENBQUMsMkJBQTJCLENBQUMsQ0FBQztBQUMvQixDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQztBQUM1QixDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQztBQUM1QixDQUFDLENBQUMsMEJBQTBCLENBQUMsQ0FBQztBQUM5QixDQUFDLENBQUMsOEJBQThCLENBQUMsQ0FBQztBQUNsQyxDQUFDLENBQUMseUNBQXlDLENBQUMsQ0FBQztBQUM3QyxDQUFDLENBQUMsaUNBQWlDLENBQUMsQ0FBQztBQUNyQyxDQUFDLENBQUMsMEJBQTBCLENBQUMsQ0FBQztBQUM5QixDQUFDLENBQUMsQ0FBQzsifQ==
