import {
  SAMPLE_FLOW_STEPS,
  buildTrayFlowView,
  normalizeLifecycleStatus,
  synchronizeSamplesForTrayCodes,
} from "@/modules/samples/samplesFlowModel";
import { formatLocalDateTime } from "@/lib/dateTime";
import { resolveLabRef, scheduleMatchesLab } from "@/lib/labIdentity";
import {
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
} from "@/modules/tasks/model";
import { experimentScopeIsTerminal } from "@/modules/experiment-progress/model";

const SALT_SPRAY_LAB = "盐雾试验室";
const LAB_COMPARE_STATUS = "已到达实验室";
const LAB_INSTALL_STATUS = "工装夹具安装";
const LAB_READY_STATUS = "实验准备就绪";
const LAB_RESET_STATUS = "送至实验室";
const EXPERIMENT_COMPLETED_STATUS = "实验已完成";
const PRE_DISPATCH_FALLBACK_LOCATION = "恒温恒湿间（暂存间）";
const PRE_DISPATCH_FALLBACK_STATUS = "已到达暂存间";
const APPEARANCE_INSPECTION_LOCATION = "外观检测间";
const APPEARANCE_INSPECTION_STOCKED_STATUS = "外观检测间存放";
const UNIFIED_TRAY_FLOW_STATUS_RANK = new Map(SAMPLE_FLOW_STEPS.map((step, index) => [step.label, index]));
const PRE_DISPATCH_STATUSES = new Set(["到货", "已接收", "送至暂存间", "已到达暂存间"]);
const APPEARANCE_STORAGE_STATUSES = new Set([APPEARANCE_INSPECTION_STOCKED_STATUS, "已到达外观检测间"]);
const RUNNING_EXPERIMENT_STATUSES = new Set(["实验进行中", "实验中"]);
const LABORATORY_TASK_FLOW_STEPS = [
  { key: "waiting", label: STATUS_WAITING },
  { key: "scheduled", label: STATUS_SCHEDULED },
  { key: "running", label: STATUS_RUNNING },
  { key: "completed", label: STATUS_COMPLETED },
  { key: "returned", label: STATUS_RETENTION },
];
const LABORATORY_TASK_FLOW_INDEX = new Map(LABORATORY_TASK_FLOW_STEPS.map((step, index) => [step.label, index]));
const COMPLETED_EXPERIMENT_STATUSES = new Set(["实验已完成", "实验已经完成", "实验完成"]);
const COMPLETED_TRAY_STATUSES = new Set(["实验已完成", "实验已经完成", "实验完成", "放置实验后暂存间", "厂家收回"]);
const EXPERIMENT_TRAY_TERMINAL_STATUSES = new Set([
  ...COMPLETED_EXPERIMENT_STATUSES,
  "放置实验后暂存间",
  "已到达暂存间",
  "厂家收回",
]);

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const escapeRegExp = (value) => normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  if (normalizedStatus === "到货" || normalizedStatus === "已接收") {
    return "接驳区";
  }
  return PRE_DISPATCH_FALLBACK_LOCATION;
};

const resolvePreDispatchStatusFromLocation = (location) => {
  const normalizedLocation = normalizeText(location);
  if (normalizedLocation === PRE_DISPATCH_FALLBACK_LOCATION) {
    return PRE_DISPATCH_FALLBACK_STATUS;
  }
  if (normalizedLocation === "接驳区" || normalizedLocation === "室外接驳区") {
    return "到货";
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
  return {
    location: PRE_DISPATCH_FALLBACK_LOCATION,
    status: PRE_DISPATCH_FALLBACK_STATUS,
    time: -Infinity,
  };
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
          action === "外观检测间扫码入库"
          && (!status || APPEARANCE_STORAGE_STATUSES.has(status) || location === APPEARANCE_INSPECTION_LOCATION)
        );
      if (!marksAppearanceStorage) {
        return null;
      }
      return {
        experimentName: "",
        location: APPEARANCE_INSPECTION_LOCATION,
        status: APPEARANCE_INSPECTION_STOCKED_STATUS,
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
  if (normalized === "实验进行中" || normalized === "实验中") {
    return 4;
  }
  if (normalized === "实验已完成" || normalized === "放置实验后暂存间" || normalized === "厂家收回") {
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
  if (normalized === "送至外观检测间") {
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
  return ["1", "true", "yes", "ready", "fixture_ready", "夹具安装完成"].includes(normalized);
};

const buildBlockedComparisonResult = (trayCode, status) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === "实验已完成" || normalizedStatus === "实验完成" || normalizedStatus === "放置实验后暂存间" || normalizedStatus === "厂家收回") {
    return {
      guidance: `${normalizedTrayCode} 已完成实验，无需再次比对。`,
      message: "托盘已完成实验",
      ok: false,
      tone: "error",
      trayCode: normalizedTrayCode,
    };
  }
  if (normalizedStatus === "实验进行中" || normalizedStatus === "实验中") {
    return {
      guidance: `${normalizedTrayCode} 当前实验正在进行中，不能再次比对。`,
      message: "托盘实验进行中",
      ok: false,
      tone: "error",
      trayCode: normalizedTrayCode,
    };
  }
  return {
    guidance: `${normalizedTrayCode} 当前状态为${normalizedStatus || "已比对"}，已完成任务比对，无需再次比对。`,
    message: "托盘已完成比对",
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
      if (!parsed || parsed.status !== "实验已完成" || parsed.experimentName === currentExperimentName) {
        return null;
      }
      return {
        experimentName: parsed.experimentName,
        location: normalizeText(entry?.location) || normalizeText(sample?.location),
        status: "实验已完成",
        time: toTime(entry?.time) || -Infinity,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  return candidates[candidates.length - 1] || null;
};

const resolvePreviousStableSnapshot = (sample, taskCode, currentExperimentName) => {
  const candidates = [
    resolvePreviousCompletedExperimentSnapshot(sample, taskCode, currentExperimentName),
    resolveAppearanceStorageSnapshot(sample),
    {
    ...resolvePreDispatchSnapshot(sample),
    experimentName: "",
    },
  ].filter(Boolean);
  candidates.sort((left, right) => left.time - right.time);
  return candidates[candidates.length - 1];
};

const resolveLatestExperimentHistoryStatus = ({ experimentName, sample, taskCode, trayCode = "" }) => {
  const normalizedExperimentName = normalizeText(experimentName);
  if (!normalizedExperimentName) {
    return null;
  }
  const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
  let latestStatus = null;
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
      latestStatus = parsed.status;
      latestTime = eventTime;
    }
  });
  return latestStatus;
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
  physicalStatus,
  sample,
  targetExperimentCode = "",
  targetLab = "",
  taskCode,
  trayCode = "",
}) => {
  const historyStatus = resolveLatestExperimentHistoryStatus({ experimentName, sample, taskCode, trayCode });
  const normalizedStatus = normalizeText(physicalStatus);
  if (normalizedStatus === "送至外观检测间" || APPEARANCE_STORAGE_STATUSES.has(normalizedStatus)) {
    return normalizedStatus;
  }
  if (historyStatus) {
    const historyRank = resolveLaboratoryStatusRank(historyStatus);
    const physicalRank = resolveLaboratoryStatusRank(normalizedStatus);
    if (COMPLETED_TRAY_STATUSES.has(historyStatus)) {
      return historyStatus;
    }
    if (normalizedStatus && historyRank > 0 && physicalRank < historyRank) {
      return normalizedStatus;
    }
    return normalizedStatus || historyStatus;
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
  if (status === "送至外观检测间") {
    return "当前托盘需先进入外观检测间并完成入库，再由外观检测间出库送至实验室。";
  }
  if (
    location.includes(APPEARANCE_INSPECTION_LOCATION)
    || status.includes(APPEARANCE_INSPECTION_LOCATION)
  ) {
    return "请先在外观检测间完成出库并送至实验室。";
  }
  const sourceLabel = location.includes("暂存间") || status.includes("暂存间") ? "暂存间" : "接驳间";
  return `请先在${sourceLabel}完成出库并送至实验室。`;
};

const buildNotDispatchedComparisonResult = (trayCode, tray = null) => {
  const normalizedTrayCode = normalizeText(trayCode);
  return {
    guidance: resolveNotDispatchedSourceGuidance(tray),
    message: "托盘尚未出库",
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
    guidance: `${normalizedTrayCode} 已出库至${location || "其他试验间"}，请在${currentLab || "当前试验间"}出库后再比对。`,
    message: "托盘未送达当前试验间",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
};

const buildActiveOtherExperimentComparisonResult = (trayCode, lock = null) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const experimentName = normalizeText(lock?.experimentName);
  const device = normalizeText(lock?.device);
  const runningLabel = [device, experimentName].filter(Boolean).join(" / ") || "其他实验";
  return {
    guidance: `${normalizedTrayCode} 正在${runningLabel}进行实验，完成后才可在当前试验间比对。`,
    message: "托盘正在其他实验中",
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

const scheduleExperimentIsCompleted = ({ experiments, experimentRunTrays = [], experimentTrays, samples, schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  if (!taskCode) {
    return false;
  }

  const experiment = findExperimentRecord({ experiments, experimentCode, taskCode });
  const { matchedSamples, scopedTrayCodes } = collectScheduleSamples({ experimentTrays, samples, schedule });
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

const buildLaboratoryTaskFlow = (status = STATUS_WAITING) => {
  const currentStatus = LABORATORY_TASK_FLOW_INDEX.has(status) ? status : STATUS_WAITING;
  const activeIndex = LABORATORY_TASK_FLOW_INDEX.get(currentStatus) ?? 0;
  return {
    currentStatus,
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
const laboratoryRowHasStartedOperation = (row) =>
  asArray(row?.trayRows).some((tray) => {
    if (!trayBelongsToCurrentLaboratoryWorkflow(tray, row)) {
      return false;
    }
    const rank = resolveCurrentWorkflowTrayRank(tray, row);
    return rank >= 1 && rank < 5;
  });
const laboratoryOperationTrayCodeSet = (row) =>
  new Set(asArray(row?.trayRows).map((tray) => normalizeText(tray?.trayCode)).filter(Boolean));
const laboratoryRowsShareTray = (left, right) => {
  const leftTrayCodes = laboratoryOperationTrayCodeSet(left);
  if (!leftTrayCodes.size) {
    return false;
  }
  return asArray(right?.trayRows).some((tray) => leftTrayCodes.has(normalizeText(tray?.trayCode)));
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
    || lifecycleStatus === "送至外观检测间"
    || displayStatus === "送至外观检测间"
    || trayStatus === "送至外观检测间";
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
const trayIsDispatchedToCurrentLaboratory = (row, currentTask) => {
  const trayStatus = normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus);
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  if (
    targetExperimentCode
    && currentExperimentCode
    && targetExperimentCode !== currentExperimentCode
    && row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
    && currentExperimentIsNextUnfinishedForTray(row, currentTask)
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
  if (
    !targetExperimentCode
    && row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
    && currentExperimentCode
  ) {
    return true;
  }
  const location = normalizeText(row?.targetLab || row?.target_lab || row?.currentLocation || row?.location);
  const currentLab = normalizeText(currentTask?.device);
  return !location || !currentLab || location === currentLab;
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
  asArray(task?.trayRows).some((row) => !trayIsDispatchedToCurrentLaboratory(row, task));
const trayBelongsToCurrentLaboratoryWorkflow = (row, currentTask) =>
  trayIsDispatchedToCurrentLaboratory(row, currentTask);
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
    const matchesOperationScope =
      (!hasLabScope && !currentTask)
      || (hasLabScope && scheduleMatchesLab(row, labRef))
      || laboratoryRowsShareTray(row, currentTask);
    return (!currentKey || rowKey !== currentKey)
      && matchesOperationScope
      && laboratoryRowHasStartedOperation(row);
  });
  if (!lockedRow) {
    return { active: false };
  }
  return {
    active: true,
    experimentKey: laboratoryOperationKey(lockedRow),
    experimentName: normalizeText(lockedRow?.experimentName),
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
  normalizeText(row?.trayStatus) === "厂家收回"
  || normalizeText(row?.displayStatus) === "厂家收回"
  || normalizeText(row?.lifecycleStatus) === "厂家收回";

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
    countdownLabel: remainingSeconds >= 0 ? formatDuration(remainingSeconds) : `已超时 ${formatDuration(overdueSeconds)}`,
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

const RUNNING_EXPERIMENT_RUN_STATUSES = new Set(["实验进行中", "实验中"]);
const resolveRunNo = (run) => normalizeText(run?.run_no || run?.runNo || run?.id);
const resolveRunTaskCode = (run) => normalizeText(run?.task_code || run?.taskCode || run?.task_no || run?.taskNo);
const resolveRunExperimentCode = (run) =>
  normalizeText(run?.experiment_code || run?.experimentCode || run?.experiment_no || run?.experimentNo);
const resolveRunDevice = (run) => normalizeText(run?.device || run?.device_name || run?.deviceName || run?.lab_name || run?.labName);
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

const findActiveExperimentRun = ({ device, experimentCode, experimentRuns, taskCode }) => {
  const normalizedDevice = normalizeText(device);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const normalizedTaskCode = normalizeText(taskCode);
  const matchedRuns = asArray(experimentRuns)
    .filter(
      (run) =>
        resolveRunTaskCode(run) === normalizedTaskCode
        && resolveRunExperimentCode(run) === normalizedExperimentCode
        && (!normalizedDevice || !resolveRunDevice(run) || resolveRunDevice(run) === normalizedDevice)
        && RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRunStatus(run))
    )
    .sort((left, right) => (toTime(right?.started_at) || 0) - (toTime(left?.started_at) || 0));
  return matchedRuns[0] || null;
};

const findActiveExperimentRunTrayRelations = ({ device, experimentCode, experimentRuns, experimentRunTrays, taskCode }) => {
  const normalizedDevice = normalizeText(device);
  const normalizedExperimentCode = normalizeText(experimentCode);
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

  asArray(experimentRuns).forEach((run) => {
    if (
      resolveRunTaskCode(run) !== normalizedTaskCode
      || !RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRunStatus(run))
      || !asArray(run?.tray_codes || run?.trayCodes).map(normalizeText).includes(normalizedTrayCode)
    ) {
      return;
    }
    pushLock({ experimentCode: resolveRunExperimentCode(run), run });
  });

  return Array.from(locksByKey.values());
};

const collectTrayRows = ({ device, experimentName, experimentRecordMap, experimentRunTrays, experimentTrayCodeMap, experimentKey, relatedSamples, taskCode }) => {
  const trayRows = [];
  const indexByTrayCode = new Map();
  const experimentCodesByTrayCode = buildExperimentCodesByTrayCode(experimentTrayCodeMap);
  const currentExperimentCode = normalizeText(String(experimentKey).split("::")[1]);
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
      const sampleHasCurrentExperimentHistory = Boolean(resolveLatestExperimentHistoryStatus({
        experimentName,
        sample,
        taskCode,
        trayCode,
      }));
      pushRow(
        trayCode,
        sampleCode,
        quantity,
        owner,
        location,
        tray?.fixtureReady ?? tray?.fixture_ready,
        targetLab,
        targetExperimentCode,
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
        || completedExperimentCodes.has(currentExperimentCode)
        || completedExperimentRecordCodes.has(currentExperimentCode)
        || experimentIsCompletedInSampleHistory({ experimentName, sample, taskCode, trayCode });
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
      const currentRank = resolveLaboratoryStatusRank(row?.trayStatus);
      const physicalTrayStatus = normalizeText(tray?.status);
      const nextStatus = physicalTrayStatus
        ? resolveCurrentExperimentTrayStatus({
            completedForCurrentExperiment: row.completedForCurrentExperiment,
            completedForOtherExperiment: row.completedForOtherExperiment,
            currentExperimentCode,
            device,
            experimentCodes: row?.experimentCodes,
            experimentName,
            physicalStatus: physicalTrayStatus,
            sample,
            targetExperimentCode,
            targetLab,
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
        physicalStatus: physicalTrayStatus,
        sample,
        targetExperimentCode,
        targetLab,
        taskCode,
        trayCode: row.trayCode,
      });
      if (resolveLaboratoryStatusRank(nextStatus) >= currentRank) {
        row.trayStatus = nextStatus;
      }
      if (physicalTrayStatus === LAB_RESET_STATUS && targetLab) {
        row.currentLocation = targetLab;
        row.lifecycleLocation = targetLab;
      }
      const currentDisplayRank = resolveLaboratoryStatusRank(row?.displayStatus);
      if (resolveLaboratoryStatusRank(displayStatusCandidate) >= currentDisplayRank) {
        row.displayStatus = displayStatusCandidate;
      }
      const lifecycleLocation = physicalTrayStatus === LAB_RESET_STATUS && targetLab ? targetLab : location;
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

const buildLaboratoryScheduleRow = ({ experimentMap, experimentRecordMap, experimentRuns, experimentRunTrays, experimentTrayCodeMap, sampleMap, schedule, taskMap }) => {
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
  const device = normalizeText(schedule?.device) || SALT_SPRAY_LAB;
  const labCode = normalizeText(schedule?.lab_code || schedule?.labCode);
  const trayRows = collectTrayRows({
    device,
    experimentName,
    experimentRecordMap,
    experimentRunTrays,
    experimentTrayCodeMap,
    experimentKey,
    relatedSamples,
    taskCode,
  });
  const startAt = String(schedule?.start_at || "");
  const endAt = String(schedule?.end_at || "");
  const activeRun = findActiveExperimentRun({
    device,
    experimentCode,
    experimentRuns,
    taskCode,
  });
  const activeRunTrayRelations = findActiveExperimentRunTrayRelations({
    device,
    experimentCode,
    experimentRuns,
    experimentRunTrays,
    taskCode,
  });
  const activeRunTrayCodes = activeRunTrayRelations.length > 0
    ? uniqueValues(activeRunTrayRelations.map(resolveRelationTrayCode))
    : uniqueValues(asArray(activeRun?.tray_codes).map((trayCode) => normalizeText(trayCode)));
  const displayStartAt = normalizeText(activeRunTrayRelations[0]?.started_at || activeRunTrayRelations[0]?.startedAt) || normalizeText(activeRun?.started_at) || startAt;
  const estimatedEndAt = addDurationToDateTime(displayStartAt, resolvePlannedDurationMs(schedule, activeRun));
  const displayEndAt = estimatedEndAt || normalizeText(activeRun?.planned_end_at) || normalizeText(activeRun?.ended_at) || endAt;
  const activeRunStatus = activeRunTrayRelations.length > 0 || RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeText(activeRun?.status)) ? "实验进行中" : "";
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
  const completedRunTrayCodes = new Set(
    asArray(experimentRunTrays)
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
        && normalizeText(resolveRelationStatus(relation)) === "厂家收回",
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
    device,
    endAt: displayEndAt,
    endTimeLabel: formatTime(displayEndAt),
    experimentCode,
    experimentKey,
    experimentName,
    id: normalizeText(schedule?.id) || `${taskCode}-${experimentCode}-${startAt}`,
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

function buildLaboratoryWorkbenchView({
  tasks = [],
  schedules = [],
  experiments = [],
  experimentRuns = [],
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
  const rowBuilderInput = { experimentMap, experimentRecordMap, experimentRuns, experimentRunTrays, experimentTrayCodeMap, sampleMap, taskMap };

  const activeSchedules = asArray(schedules).filter(
    (schedule) => !scheduleExperimentIsCompleted({ experiments, experimentRunTrays, experimentTrays, samples, schedule }),
  );
  const allScheduleRows = activeSchedules
    .map((schedule) => buildLaboratoryScheduleRow({ ...rowBuilderInput, schedule }))
    .sort((left, right) => (toTime(left.startAt) || 0) - (toTime(right.startAt) || 0));

  const labRef = { code: labCode, name: labName };
  const scheduleRows = allScheduleRows.filter((row) => scheduleMatchesLab(row, labRef));
  const operationTask = scheduleRows.find((row) => laboratoryRowHasStartedOperation(row));
  const defaultTask = operationTask || scheduleRows[0] || null;

  const selectedKey = normalizeText(selectedTaskCode);
  const selectedTask =
    scheduleRows.find((row) => normalizeText(row.experimentKey) === selectedKey || normalizeText(row.id) === selectedKey)
    || scheduleRows.find((row) => row.taskCode === selectedKey)
    || null;
  const currentTask = selectedTask || defaultTask;
  const currentExperimentTrayRows = asArray(currentTask?.trayRows);
  const selectedTrayRow =
    currentExperimentTrayRows.find((row) => row.trayCode === normalizeText(selectedTrayCode))
    || currentExperimentTrayRows[0]
    || null;
  const selectedTrayHasCurrentExperimentContext = trayHasCurrentExperimentFlowContext(selectedTrayRow, currentTask);
  const selectedTrayDifferentTargetIsActive = rowHasUnfinishedDifferentTargetExperiment(selectedTrayRow, currentTask);
  const selectedTrayOnlyHasOtherExperimentCompletion =
    !selectedTrayHasCurrentExperimentContext
    && selectedTrayRow?.completedForOtherExperiment === true
    && selectedTrayRow?.completedForCurrentExperiment !== true
    && !selectedTrayDifferentTargetIsActive
    && !rowHasPreDispatchLifecycleStatus(selectedTrayRow);
  const selectedTrayFlowStatus =
    selectedTrayOnlyHasOtherExperimentCompletion
      ? EXPERIMENT_COMPLETED_STATUS
      : resolveSelectedTrayFlowStatus(selectedTrayRow, currentTask);
  const currentTaskStatus = resolveLaboratoryTaskStatus(currentTask);
  const currentTaskFlow = buildLaboratoryTaskFlow(currentTaskStatus);
  const selectedTrayFlow = selectedTrayRow
    ? buildTrayFlowView({
        currentExperimentCode: selectedTrayHasCurrentExperimentContext
          ? normalizeText(currentTask?.experimentCode)
          : selectedTrayDifferentTargetIsActive
            ? normalizeText(selectedTrayRow?.targetExperimentCode || selectedTrayRow?.target_experiment_code)
            : "",
        experimentRuns,
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
        taskCode: normalizeText(currentTask?.taskCode),
        trayCode: normalizeText(selectedTrayRow?.trayCode),
      })
    : buildTrayFlowView();
  const runningExperiment = buildRunningExperimentView({
    currentTask,
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
  const workflowTrayRows = trayRows.filter((row) => trayBelongsToCurrentLaboratoryWorkflow(row, task));
  const activeOtherExperimentRows = workflowTrayRows.filter((row) => asArray(row?.activeOtherExperimentRuns).length > 0);
  const comparableTrayRows = workflowTrayRows.filter((row) =>
    asArray(row?.activeOtherExperimentRuns).length === 0
    && resolveCurrentWorkflowTrayRank(row, task) < 1
  );
  const trayRanks = workflowTrayRows.map((row) => resolveCurrentWorkflowTrayRank(row, task));
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
    return `当前${normalizeText(labName) || SALT_SPRAY_LAB}暂无排程`;
  }
  if (getRunningTrayRowsForCurrentTask(currentTask).length > 0) {
    return `当前任务 ${currentTask.taskCode} 已进入实验进行中`;
  }
  if (
    workflow.hasActiveOtherExperimentRun
    && !workflow.hasComparableTrayWithoutActiveOtherExperiment
  ) {
    const lock = workflow.activeOtherExperimentRun || {};
    const target = normalizeText(lock.device) || normalizeText(lock.experimentName) || "其他实验";
    return `托盘正在${target}进行实验，完成后才可继续当前试验间流程`;
  }
  if (workflow.experimentConfirmed) {
    return "当前任务已确认全部托盘实验准备就绪";
  }
  if (workflow.hasInstalledWaitingReady && !workflow.fixtureReadyDone) {
    return "当前任务已完成夹具安装，等待上位机确认夹具安装完成";
  }
  if (workflow.hasInstalledWaitingReady && workflow.fixtureReadyDone) {
    return "夹具安装完成，可确认实验准备就绪";
  }
  if (workflow.hasInstalled && !workflow.installationDone) {
    return "当前任务已有托盘完成样品安装，待确认已安装托盘准备就绪";
  }
  if (workflow.installationDone) {
    return "当前任务已完成全部托盘样品安装，待实验确认";
  }
  if (workflow.hasCompared && !workflow.comparisonDone) {
    return "当前任务已完成部分托盘比对，可继续比对或开始样品安装";
  }
  if (workflow.comparisonDone) {
    return "当前任务已完成全部托盘任务比对，待样品安装";
  }
  return `当前任务 ${currentTask.taskCode} 待开始任务比对`;
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
    historyAction: "实验任务重置",
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
      "任务切换撤回",
      restoreSnapshot.status,
      `${taskCode} / ${experimentName} / 撤回至${restoreSnapshot.status}`,
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
      ? `${restoreSnapshot.experimentName}已完成`
      : restoreSnapshot.status;
    nextSample.history = buildLaboratoryHistoryEntry(
      nextSample,
      "任务切换撤回",
      restoreSnapshot.status,
      `${taskCode} / ${experimentName} / 撤回至${detailTarget}`,
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
    { label: "任务编号", value: task.taskCode || "-" },
    { label: "实验项目", value: task.experimentName || "-" },
    { label: "执行人员", value: task.owner || "-" },
    { label: "开始时间", value: task.startTimeLabel || "-" },
    { label: "结束时间", value: task.endTimeLabel || "-" },
    { label: "样品数量", value: task.sampleCount ? `${task.sampleCount} 件` : "-" },
    { label: "实验室", value: task.device || SALT_SPRAY_LAB },
  ];
}

function validateLaboratoryTrayScan({ currentTask = null, scheduleRows = [], allScheduleRows = [], scanCode = "" }) {
  const normalizedScanCode = normalizeText(scanCode);
  if (!normalizedScanCode) {
    return {
      guidance: "请扫描托盘编号",
      message: "请扫描托盘编号",
      ok: false,
      tone: "error",
    };
  }
  if (!currentTask) {
    return {
      guidance: "当前没有可比对的任务",
      message: "当前没有可比对的任务",
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
        (trayStatus === "实验已完成" || trayStatus === "实验完成" || trayStatus === "实验已经完成")
        && isPreviousExperimentCompletionForCurrentTask(matchedTray, currentTask);
      if (canEnterNextExperiment) {
        return {
          guidance: `${normalizedScanCode} 属于当前任务 ${currentTask.taskCode}`,
          matchedRow: currentTask,
          message: "比对正确",
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
      guidance: `${normalizedScanCode} 属于当前任务 ${currentTask.taskCode}`,
      matchedRow: currentTask,
      message: "比对正确",
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
      guidance: `当前任务并非优先所选任务。该托盘可前往：${destinationLabels.join("、")}`,
      matchedRow: matchedRows[0],
      matchedRows,
      message: "比对不正确",
      ok: false,
      tone: "error",
      trayCode: normalizedScanCode,
    };
  }

  return {
    guidance: "未匹配到该托盘",
    message: "未匹配到任务",
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
