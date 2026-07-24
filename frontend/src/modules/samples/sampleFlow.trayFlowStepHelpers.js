import {
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  APPEARANCE_STOCKED_STATUS,
  EXPERIMENT_FLOW_STATUS_LABELS,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import { asArray, parseTimeValue, uniqueNormalizedTexts } from "./sampleFlow.trayScope";

function createTrayFlowStepTools(stepTimeMap, stepTimeHistoryMap) {
  const steps = [];
  const pushStep = (step) => {
    const rawLabel = normalizeText(step?.timeLabel || step?.label);
    const label = normalizeText(step?.displayLabel || step?.label);
    const hasExplicitTime = Object.prototype.hasOwnProperty.call(step || {}, "time");
    const stepPayload = { ...(step || {}) };
    delete stepPayload.displayLabel;
    delete stepPayload.timeLabel;
    steps.push({
      active: false,
      reached: false,
      ...stepPayload,
      label,
      time: hasExplicitTime ? normalizeText(step?.time) : stepTimeMap.get(rawLabel) || "",
    });
    return steps.length - 1;
  };
  const experimentDisplayName = (experiment, index) =>
    normalizeText(experiment?.displayName) || normalizeText(experiment?.name) || `实验${index + 1}`;
  const experimentIdentityName = (experiment, index) => normalizeText(experiment?.name) || `实验${index + 1}`;
  const experimentStatusLabel = (experiment, index, statusKey) =>
    `${experimentDisplayName(experiment, index)}${EXPERIMENT_FLOW_STATUS_LABELS[statusKey] || EXPERIMENT_FLOW_STATUS_LABELS.pending}`;
  const experimentIdentityStatusLabel = (experiment, index, statusKey) =>
    `${experimentIdentityName(experiment, index)}${EXPERIMENT_FLOW_STATUS_LABELS[statusKey] || EXPERIMENT_FLOW_STATUS_LABELS.pending}`;
  const experimentCodeStatusLabel = (experiment, statusKey) =>
    `${normalizeText(experiment?.code)}${EXPERIMENT_FLOW_STATUS_LABELS[statusKey] || EXPERIMENT_FLOW_STATUS_LABELS.pending}`;
  const completedExperimentTime = (experiment, index) => Math.max(
    parseTimeValue(stepTimeMap.get(experimentStatusLabel(experiment, index, "completed"))),
    parseTimeValue(stepTimeMap.get(experimentIdentityStatusLabel(experiment, index, "completed"))),
    parseTimeValue(stepTimeMap.get(experimentCodeStatusLabel(experiment, "completed"))),
  );
  const routeStepTimeAfter = (label, floorTime = 0, ceilingTime = 0, contextLabels = []) => {
    const baseTimeLabels = label === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
      ? [APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS, APPEARANCE_STOCKED_STATUS]
      : [label];
    const contextualTimeLabels = uniqueNormalizedTexts(asArray(contextLabels))
      .filter((timeLabel) => timeLabel && !baseTimeLabels.includes(timeLabel));
    const findMatchingTime = (timeLabels) => timeLabels.flatMap((timeLabel) => asArray(stepTimeHistoryMap.get(timeLabel)))
      .filter((time) => {
        const parsedTime = parseTimeValue(time);
        if (floorTime && parsedTime <= floorTime) {
          return false;
        }
        if (ceilingTime && parsedTime >= ceilingTime) {
          return false;
        }
        return parsedTime > 0;
      })
      .sort((left, right) => parseTimeValue(right) - parseTimeValue(left));
    const contextualMatchingTimes = findMatchingTime(contextualTimeLabels);
    if (contextualMatchingTimes.length > 0) {
      return contextualMatchingTimes[0];
    }
    if (label === "送至实验室" && contextualTimeLabels.length > 0) {
      return "";
    }
    const matchingTimes = findMatchingTime(baseTimeLabels);
    if (matchingTimes.length > 0) {
      return matchingTimes[0];
    }
    const time = baseTimeLabels.map((timeLabel) => stepTimeMap.get(timeLabel)).find(Boolean) || "";
    const parsedTime = parseTimeValue(time);
    if (!floorTime) {
      return ceilingTime && parsedTime >= ceilingTime ? "" : time;
    }
    if (parsedTime <= floorTime || (ceilingTime && parsedTime >= ceilingTime)) {
      return "";
    }
    return time;
  };

  return {
    completedExperimentTime,
    experimentCodeStatusLabel,
    experimentDisplayName,
    experimentIdentityName,
    experimentIdentityStatusLabel,
    experimentStatusLabel,
    pushStep,
    routeStepTimeAfter,
    steps,
  };
}

export { createTrayFlowStepTools };
