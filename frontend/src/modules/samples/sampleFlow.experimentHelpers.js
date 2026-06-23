import {
  APPEARANCE_REQUIRED_KEYWORDS,
  EXPERIMENT_STARTED_FLOW_INDEX,
  FLOW_STEP_INDEX_BY_KEY,
  FLOW_STEP_KEY_BY_LABEL,
  MULTI_EXPERIMENT_ROUTE_STEPS,
  TEST_LABS,
  WITHDRAWAL_ACTIONS,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import { normalizeLifecycleStatus } from "./sampleFlow.status";
import {
  asArray,
  compareText,
  entryMatchesTrayCode,
  entryTimeValue,
  firstNonEmptyArray,
  parseTimeValue,
  resolveEntryExperimentCode,
  resolveEntryTaskCode,
  resolveEntryTrayCode,
  resolveEntryTrayCodes,
  uniqueNormalizedTexts,
} from "./sampleFlow.trayScope";

const isLikelyLabDestination = (value) => /室$/.test(normalizeText(value));

const experimentRequiresAppearanceInspection = (experiment) =>
  uniqueNormalizedTexts([
    experiment?.displayName,
    experiment?.name,
    experiment?.experiment_name,
    experiment?.experimentName,
    experiment?.experiment_type,
    experiment?.experimentType,
    experiment?.test_type,
    experiment?.testType,
    experiment?.required_device,
    experiment?.requiredDevice,
    ...(Array.isArray(experiment?.aliases) ? experiment.aliases : []),
  ]).some((text) => APPEARANCE_REQUIRED_KEYWORDS.some((keyword) => text.includes(keyword)));

const extractLabDestinationName = (value) => {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  if (TEST_LABS.has(text) || isLikelyLabDestination(text)) {
    return text;
  }
  const knownLab = Array.from(TEST_LABS).find((lab) => text.includes(lab));
  if (knownLab) {
    return knownLab;
  }
  const dispatchMatch = text.match(/送至\s*([^，,；;/\s]+室)/);
  return dispatchMatch ? normalizeText(dispatchMatch[1]) : "";
};

const resolveLabDestinationName = (...values) =>
  values.map(extractLabDestinationName).find(Boolean) || "";

const buildLabDispatchStepLabel = (labName) => {
  const normalizedLabName = normalizeText(labName);
  return normalizedLabName ? `送至${normalizedLabName}` : "送至实验室";
};

const resolveExperimentIdentityName = (experiment, fallback = "") =>
  normalizeText(experiment?.experiment_name)
  || normalizeText(experiment?.name)
  || normalizeText(experiment?.experimentName)
  || normalizeText(experiment?.experiment_type)
  || normalizeText(experiment?.experimentType)
  || normalizeText(experiment?.required_device)
  || normalizeText(experiment?.requiredDevice)
  || fallback;

const resolveExperimentDisplayName = (experiment, fallback = "") => {
  const explicitType =
    normalizeText(experiment?.experiment_type)
    || normalizeText(experiment?.experimentType)
    || normalizeText(experiment?.test_type)
    || normalizeText(experiment?.testType);
  if (explicitType) {
    return explicitType;
  }
  const requiredDevice = normalizeText(experiment?.required_device) || normalizeText(experiment?.requiredDevice);
  if (requiredDevice && !isLikelyLabDestination(requiredDevice)) {
    return requiredDevice;
  }
  return resolveExperimentIdentityName(experiment, fallback) || requiredDevice || fallback;
};

const resolveExperimentAliases = (experiment, fallback = "") =>
  uniqueNormalizedTexts([
    normalizeText(experiment?.experiment_code),
    normalizeText(experiment?.experimentCode),
    normalizeText(experiment?.code),
    normalizeText(experiment?.id),
    normalizeText(experiment?.name),
    normalizeText(experiment?.displayName),
    normalizeText(experiment?.experiment_name),
    normalizeText(experiment?.experimentName),
    normalizeText(experiment?.experiment_type),
    normalizeText(experiment?.experimentType),
    normalizeText(experiment?.test_type),
    normalizeText(experiment?.testType),
    normalizeText(experiment?.required_device),
    normalizeText(experiment?.requiredDevice),
    fallback,
  ]);

// 批量创建样品和历史记录时使用轻量级随机 ID。
const generateId = (prefix) => {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${stamp}-${rand}`;
};

// 批量输入框支持按空格、逗号和分号拆分样品号。
const parseCodeList = (value) =>
  Array.from(
    new Set(
      String(value ?? "")
        .split(/[\s,\uFF0C;\uFF1B]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const experimentRunTimeValue = (run) => {
  const status = normalizeLifecycleStatus("", run?.status);
  const primaryTime = status === "实验已完成" || status === "实验完成"
    ? run?.ended_at || run?.endedAt
    : run?.started_at || run?.startedAt;
  return parseTimeValue(
    primaryTime
    || run?.updated_at
    || run?.updatedAt
    || run?.created_at
    || run?.createdAt
    || run?.time
    || run?.timestamp,
  );
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

const isWithdrawalHistoryEntry = (entry) => WITHDRAWAL_ACTIONS.has(normalizeText(entry?.action));

const latestWithdrawalHistoryEntry = (historyEntries = []) =>
  asArray(historyEntries).reduce((latest, entry) => {
    if (!isWithdrawalHistoryEntry(entry)) {
      return latest;
    }
    const time = entryTimeValue(entry);
    if (!latest || time >= latest.time) {
      return { entry, time };
    }
    return latest;
  }, null);

const stripCompletedExperimentSuffix = (value) => {
  const text = normalizeText(value);
  return text
    .replace(/已经完成$/, "")
    .replace(/已完成$/, "")
    .replace(/完成$/, "");
};

const stripWithdrawalReasonSuffix = (value) =>
  normalizeText(value)
    .replace(/\s*[（(][^）)]*[）)]\s*$/, "")
    .trim();

const parseWithdrawalRestoreTarget = (detail, taskCode) => {
  const parsed = parseExperimentHistoryDetail(detail, taskCode);
  const rawStatus = stripWithdrawalReasonSuffix(parsed?.status);
  if (!rawStatus.startsWith("撤回至")) {
    return null;
  }
  const target = rawStatus.slice("撤回至".length).trim();
  if (!target) {
    return null;
  }
  const experimentName = stripCompletedExperimentSuffix(target);
  if (experimentName && experimentName !== target) {
    return {
      experimentName,
      status: "实验已完成",
    };
  }
  return {
    experimentName: normalizeText(parsed?.experimentName),
    status: target,
  };
};

const findCompletedExperimentHistoryEntry = (historyEntries = [], taskCode, experimentName, beforeTime = Number.MAX_SAFE_INTEGER) => {
  const normalizedExperimentName = normalizeText(experimentName);
  if (!normalizedExperimentName) {
    return null;
  }
  return asArray(historyEntries).reduce((latest, entry) => {
    const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
    if (!parsed || normalizeText(parsed.experimentName) !== normalizedExperimentName) {
      return latest;
    }
    if (normalizeLifecycleStatus("", parsed.status) !== "实验已完成") {
      return latest;
    }
    const time = entryTimeValue(entry);
    if (!time || time > beforeTime) {
      return latest;
    }
    if (!latest || time >= latest.time) {
      return { entry, time };
    }
    return latest;
  }, null);
};

const parseRetainedCompletedExperimentBeforeWithdrawal = (entry, taskCode, withdrawalEntry, restoreTarget) => {
  if (restoreTarget?.status !== "实验已完成") {
    return null;
  }
  const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
  if (!parsed || normalizeLifecycleStatus("", parsed.status) !== "实验已完成") {
    return null;
  }
  const withdrawalExperiment = parseExperimentHistoryDetail(withdrawalEntry?.detail, taskCode);
  if (normalizeText(parsed.experimentName) === normalizeText(withdrawalExperiment?.experimentName)) {
    return null;
  }
  return {
    experimentName: parsed.experimentName,
    status: "实验已完成",
  };
};

const buildExperimentRouteSteps = () => MULTI_EXPERIMENT_ROUTE_STEPS.slice();

const hasExperimentEnteredLabFlow = (status, location = "") => {
  const normalizedStatus = normalizeLifecycleStatus(location, status);
  const key = FLOW_STEP_KEY_BY_LABEL.get(normalizedStatus);
  const index = FLOW_STEP_INDEX_BY_KEY.get(key) ?? -1;
  return index >= EXPERIMENT_STARTED_FLOW_INDEX;
};

export {
  asArray,
  buildExperimentRouteSteps,
  buildLabDispatchStepLabel,
  compareText,
  entryMatchesTrayCode,
  entryTimeValue,
  experimentRequiresAppearanceInspection,
  experimentRunTimeValue,
  findCompletedExperimentHistoryEntry,
  firstNonEmptyArray,
  generateId,
  hasExperimentEnteredLabFlow,
  isLikelyLabDestination,
  latestWithdrawalHistoryEntry,
  parseCodeList,
  parseExperimentHistoryDetail,
  parseRetainedCompletedExperimentBeforeWithdrawal,
  parseTimeValue,
  parseWithdrawalRestoreTarget,
  resolveEntryExperimentCode,
  resolveEntryTaskCode,
  resolveEntryTrayCode,
  resolveEntryTrayCodes,
  resolveExperimentAliases,
  resolveExperimentDisplayName,
  resolveExperimentIdentityName,
  resolveLabDestinationName,
  uniqueNormalizedTexts,
};
