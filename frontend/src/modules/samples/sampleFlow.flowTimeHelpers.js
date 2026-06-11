import {
  APPEARANCE_STOCKED_STATUS,
  FLOW_STEP_KEY_BY_LABEL,
  SAMPLE_FLOW_STEPS,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import {
  isAmbiguousStagingStatus,
  isAppearanceInspectionStatus,
  isPostRetentionLocation,
  normalizeLifecycleStatus,
} from "./sampleFlow.status";
import { parseTimeValue } from "./sampleFlow.trayScope";

const normalizeHistoryFlowLabel = (value, location = "") => {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  if (isPostRetentionLocation(location) && (isAmbiguousStagingStatus(text) || text.includes("已到达暂存间"))) {
    return "放置实验后暂存间";
  }
  if (isAppearanceInspectionStatus(text)) {
    return text === "已到达外观检测间" ? APPEARANCE_STOCKED_STATUS : text;
  }
  if (FLOW_STEP_KEY_BY_LABEL.has(text)) {
    return text;
  }
  if (text === "运输中" || text === "已运输") {
    return "样品运输中";
  }
  if (text === "实验完成" || text === "试验完成") {
    return "实验已完成";
  }
  if (text === "放置实验后暂存" || text === "实验后暂存") {
    return "放置实验后暂存间";
  }
  if (text === "收回" || text === "已收回" || text.includes("厂家收回")) {
    return "厂家收回";
  }
  const matchedStep = SAMPLE_FLOW_STEPS.find((step) => text.includes(step.label));
  if (matchedStep) {
    return matchedStep.label;
  }
  const normalized = normalizeLifecycleStatus(location, text);
  return FLOW_STEP_KEY_BY_LABEL.has(normalized) ? normalized : "";
};

const appendFlowTimeHistory = (timeHistoryMap, label, time) => {
  const normalizedLabel = normalizeText(label);
  const normalizedTime = normalizeText(time);
  if (!timeHistoryMap || !normalizedLabel || !normalizedTime) {
    return;
  }
  const existing = timeHistoryMap.get(normalizedLabel) || [];
  if (!existing.includes(normalizedTime)) {
    timeHistoryMap.set(normalizedLabel, [...existing, normalizedTime]);
  }
};

const setLatestFlowTime = (timeMap, label, time, sourceMap = new Map(), source = "history", timeHistoryMap = null) => {
  const normalizedLabel = normalizeText(label);
  const normalizedTime = normalizeText(time);
  if (!normalizedLabel || !normalizedTime) {
    return;
  }
  appendFlowTimeHistory(timeHistoryMap, normalizedLabel, normalizedTime);
  const existing = timeMap.get(normalizedLabel);
  const existingSource = sourceMap.get(normalizedLabel) || "";
  const historyPreferredLabel = normalizedLabel === "到货" || normalizedLabel === "厂家收回";
  if (historyPreferredLabel && existingSource === "history" && source !== "history") {
    return;
  }
  if (historyPreferredLabel && existingSource !== "history" && source === "history") {
    timeMap.set(normalizedLabel, normalizedTime);
    sourceMap.set(normalizedLabel, source);
    return;
  }
  if (
    !existing
    || (normalizedLabel === "到货" && parseTimeValue(normalizedTime) < parseTimeValue(existing))
    || (normalizedLabel !== "到货" && parseTimeValue(normalizedTime) >= parseTimeValue(existing))
  ) {
    timeMap.set(normalizedLabel, normalizedTime);
    sourceMap.set(normalizedLabel, source);
  }
};

const hidePendingFlowStepTimes = (steps = []) => {
  steps.forEach((step) => {
    if (step && !step.active && !step.reached) {
      step.time = "";
    }
  });
  return steps;
};

export {
  appendFlowTimeHistory,
  hidePendingFlowStepTimes,
  normalizeHistoryFlowLabel,
  setLatestFlowTime,
};
