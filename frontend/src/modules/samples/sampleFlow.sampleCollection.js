import { formatLocalDateTime } from "@/lib/dateTime";
import { DEFAULT_LABELS, TEST_LABS } from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import {
  normalizeLabels,
  normalizeLifecycleStatus,
} from "./sampleFlow.status";
import {
  asArray,
  getSampleTrayList,
} from "./sampleFlow.trayScope";
import { generateId } from "./sampleFlow.experimentHelpers";

const resolveSampleStatus = (location, labels = DEFAULT_LABELS) => {
  const normalizedLabels = normalizeLabels(labels);
  const normalizedLocation = normalizeText(location);
  const preRetentionLocation = normalizeText(
    normalizedLabels.preRetentionLocation || normalizedLabels.retentionLocation,
  );
  const postRetentionLocation = normalizeText(normalizedLabels.postRetentionLocation);

  if (normalizedLocation && normalizedLocation === postRetentionLocation) {
    return "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4";
  }
  if (
    normalizedLocation &&
    (normalizedLocation === preRetentionLocation ||
      normalizedLocation === normalizeText(normalizedLabels.unpackingLocation) ||
      normalizedLocation === normalizeText(normalizedLabels.intakeLocation))
  ) {
    return normalizedLocation === preRetentionLocation ? "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4" : "\u5230\u8D27";
  }
  if (TEST_LABS.has(normalizedLocation)) {
    return "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4";
  }
  return "\u8FD0\u8F93\u4E2D";
};

const appendSampleHistory = (sample, action, detail = "", now = formatLocalDateTime()) => {
  const history = Array.isArray(sample.history) ? sample.history.slice() : [];
  history.unshift({
    id: generateId("sample-event"),
    time: now,
    action,
    location: sample.location || "",
    owner: sample.owner || "",
    status: sample.status || "",
    detail,
  });
  return history;
};

const cloneSampleCollection = (samples) =>
  Array.isArray(samples)
    ? samples.map((sample) => ({
        ...sample,
        history: Array.isArray(sample?.history) ? sample.history.slice() : [],
        trays: Array.isArray(sample?.trays) ? sample.trays.map((tray) => ({ ...tray })) : [],
      }))
    : [];

const synchronizeSamplesForTrayCodes = (input = {}) => {
  const labels = normalizeLabels(input.labels);
  const samples = cloneSampleCollection(input.samples);
  const trayCodes = new Set(asArray(input.trayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const nextStatus = normalizeText(input.status);
  const now = input.now || formatLocalDateTime();
  const nextLocation = normalizeText(input.location);
  const nextOwner = normalizeText(input.owner);
  const historyAction = normalizeText(input.historyAction);
  const historyDetail = normalizeText(input.historyDetail);
  const clearTrayTarget = input.clearTrayTarget === true;

  if (trayCodes.size === 0 || !nextStatus) {
    return { samples, updatedCount: 0 };
  }

  let updatedCount = 0;
  samples.forEach((sample) => {
    const hasMatchingTray = getSampleTrayList(sample).some((tray) => trayCodes.has(normalizeText(tray?.tray_code)));
    if (!hasMatchingTray) {
      return;
    }

    sample.trays = asArray(sample.trays).map((tray) => {
      if (!trayCodes.has(normalizeText(tray?.tray_code))) {
        return tray;
      }
      const nextTray = {
        ...tray,
        status: nextStatus,
        updated_at: now,
      };
      if (clearTrayTarget) {
        delete nextTray.target_lab;
        delete nextTray.targetLab;
        delete nextTray.target_experiment_code;
        delete nextTray.targetExperimentCode;
      }
      return nextTray;
    });

    if (nextLocation) {
      sample.location = nextLocation;
    }
    if (nextOwner) {
      sample.owner = nextOwner;
    }
    sample.status = normalizeLifecycleStatus(sample.location, nextStatus, labels);
    sample.flow_status = sample.status;
    sample.updated_at = now;
    if (historyAction) {
      sample.history = appendSampleHistory(
        { ...sample, status: sample.status },
        historyAction,
        historyDetail,
        now,
      );
    }
    updatedCount += 1;
  });

  return { samples, updatedCount };
};

export {
  appendSampleHistory,
  cloneSampleCollection,
  resolveSampleStatus,
  synchronizeSamplesForTrayCodes,
};
