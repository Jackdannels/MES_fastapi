import {
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  APPEARANCE_SENT_STATUS,
  APPEARANCE_STOCKED_STATUS,
  DEFAULT_LABELS,
  FLOW_STEP_INDEX_BY_KEY,
  FLOW_STEP_KEY_BY_LABEL,
} from "./sampleFlow.constants";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
import { normalizeText } from "./sampleFlow.shared";
import { normalizeLifecycleStatus } from "./sampleFlow.status";

// 样品流转的托盘作用域基础工具，尽量只保留纯函数和轻量归一化逻辑。
const asArray = (value) => (Array.isArray(value) ? value : []);

const firstNonEmptyArray = (...values) => {
  const arrays = values.filter(Array.isArray);
  return arrays.find((value) => value.length > 0) || arrays[0] || [];
};

const uniqueNormalizedTexts = (values) => Array.from(new Set(asArray(values).map(normalizeText).filter(Boolean)));

const resolveEntryTaskCode = (entry) =>
  normalizeText(entry?.task_code)
  || normalizeText(entry?.taskCode)
  || normalizeText(entry?.task_no)
  || normalizeText(entry?.taskNo);

const resolveEntryTrayCode = (entry) =>
  normalizeText(entry?.tray_code)
  || normalizeText(entry?.trayCode)
  || normalizeText(entry?.tray_no)
  || normalizeText(entry?.trayNo);

const resolveEntryTrayCodes = (entry) => {
  const primary = resolveEntryTrayCode(entry);
  const scopedCodes = uniqueNormalizedTexts(entry?.tray_codes || entry?.trayCodes);
  return primary ? [primary, ...scopedCodes.filter((code) => code !== primary)] : scopedCodes;
};

const resolveEntryExperimentCode = (entry) =>
  normalizeText(entry?.experiment_code)
  || normalizeText(entry?.experimentCode)
  || normalizeText(entry?.experiment_no)
  || normalizeText(entry?.experimentNo)
  || normalizeText(entry?.experiment_id)
  || normalizeText(entry?.experimentId);

const entryMatchesTrayCode = (entry, trayCode) => {
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTrayCode) {
    return false;
  }
  const structuredTrayCodes = resolveEntryTrayCodes(entry);
  return structuredTrayCodes.includes(normalizedTrayCode);
};

const compareText = (left, right) => normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN");

const parseTimeValue = (value) => {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const entryTimeValue = (entry) => parseTimeValue(entry?.time || entry?.updated_at || entry?.created_at || entry?.timestamp);

const resolveFlowStatusRank = (location, status, labels = DEFAULT_LABELS) => {
  const rawStatus = normalizeText(status);
  const normalizedStatus = isAxisPartialProgressStatus(rawStatus)
    ? rawStatus
    : normalizeLifecycleStatus(location, rawStatus, labels);
  const stagingArrivalIndex = FLOW_STEP_INDEX_BY_KEY.get("arrived_staging") ?? 3;
  const completedIndex = FLOW_STEP_INDEX_BY_KEY.get("completed") ?? 9;
  if (isAxisPartialProgressStatus(normalizedStatus)) {
    return completedIndex - 0.5;
  }
  if (normalizedStatus === APPEARANCE_SENT_STATUS) {
    return stagingArrivalIndex + 0.1;
  }
  if (
    normalizedStatus === APPEARANCE_STOCKED_STATUS
    || normalizedStatus === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
  ) {
    return stagingArrivalIndex + 0.2;
  }
  const key = FLOW_STEP_KEY_BY_LABEL.get(normalizedStatus);
  return FLOW_STEP_INDEX_BY_KEY.get(key) ?? -1;
};

const mergeTrayEntriesByCode = (trays, sample, labels = DEFAULT_LABELS) => {
  const mergedByCode = new Map();
  const sourceTrays = Array.isArray(trays) ? trays : [];

  sourceTrays.forEach((tray) => {
    const trayCode = normalizeText(tray?.tray_code);
    if (!trayCode) {
      return;
    }

    const candidate = { ...tray };
    const existing = mergedByCode.get(trayCode);
    if (!existing) {
      mergedByCode.set(trayCode, candidate);
      return;
    }

    const existingRank = resolveFlowStatusRank(sample?.location, existing?.status, labels);
    const candidateRank = resolveFlowStatusRank(sample?.location, candidate?.status, labels);
    if (candidateRank > existingRank) {
      mergedByCode.set(trayCode, {
        ...existing,
        ...candidate,
      });
      return;
    }

    if (candidateRank === existingRank && parseTimeValue(candidate?.updated_at) > parseTimeValue(existing?.updated_at)) {
      mergedByCode.set(trayCode, {
        ...existing,
        ...candidate,
      });
    }
  });

  return Array.from(mergedByCode.values());
};

const getSampleTrayList = (sample) => {
  if (!sample || !Array.isArray(sample.trays)) {
    return [];
  }
  const sampleCode = normalizeText(sample.code);
  const validTrays = mergeTrayEntriesByCode(sample.trays, sample).filter((tray) => {
    if (!tray) {
      return false;
    }
    const traySampleCode = normalizeText(tray.sample_code || sampleCode);
    const quantity = Number.parseInt(tray.quantity, 10);
    return traySampleCode === sampleCode && Number.isFinite(quantity) && quantity > 0;
  });
  if (validTrays.length <= 1) {
    return validTrays;
  }
  return validTrays
    .slice()
    .sort((left, right) => (
      parseTimeValue(right?.updated_at) - parseTimeValue(left?.updated_at)
      || parseTimeValue(right?.created_at) - parseTimeValue(left?.created_at)
      || sample.trays.indexOf(right) - sample.trays.indexOf(left)
    ))
    .slice(0, 1);
};

export {
  asArray,
  compareText,
  entryMatchesTrayCode,
  entryTimeValue,
  firstNonEmptyArray,
  getSampleTrayList,
  mergeTrayEntriesByCode,
  parseTimeValue,
  resolveEntryExperimentCode,
  resolveEntryTaskCode,
  resolveEntryTrayCode,
  resolveEntryTrayCodes,
  resolveFlowStatusRank,
  uniqueNormalizedTexts,
};
