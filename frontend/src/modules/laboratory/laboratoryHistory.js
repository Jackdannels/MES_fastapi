import { parseBusinessDateTimeToMs } from "@/lib/dateTime";
import { normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";
import { resolveLabDestinationName } from "@/modules/samples/sampleFlow.experimentHelpers";
import {
  APPEARANCE_INSPECTION_LOCATION,
  APPEARANCE_INSPECTION_STOCKED_STATUS,
  APPEARANCE_STORAGE_STATUSES,
  PRE_DISPATCH_STATUSES,
  PRE_DISPATCH_STAGING_LOCATION,
  PRE_DISPATCH_STAGING_STATUS,
  SALT_SPRAY_LAB,
  LAB_DISPATCH_HISTORY_ACTIONS,
  LAB_RESET_STATUS,
} from "./laboratoryConstants";
import {
  historyEntryAppliesToTray,
  parseExperimentHistoryDetail,
  resolveTrayCode,
} from "./scheduleCompletion";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const toTime = (value) => parseBusinessDateTimeToMs(value);

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
  return PRE_DISPATCH_STAGING_LOCATION;
};

const resolvePreDispatchStatusFromLocation = (location) => {
  const normalizedLocation = normalizeText(location);
  if (normalizedLocation === PRE_DISPATCH_STAGING_LOCATION) {
    return PRE_DISPATCH_STAGING_STATUS;
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
          action === "外观检测间扫码入库"
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
  const preDispatchSnapshot = resolvePreDispatchSnapshot(sample);
  const candidates = [
    resolvePreviousCompletedExperimentSnapshot(sample, taskCode, currentExperimentName),
    resolveAppearanceStorageSnapshot(sample),
    preDispatchSnapshot ? { ...preDispatchSnapshot, experimentName: "" } : null,
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
      latestSnapshot = { status: parsed.status, time: eventTime };
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
    if (!parsed || (trayCode && !historyEntryAppliesToTray(entry, sampleTrayCodes, trayCode))) {
      return;
    }
    const eventTime = toTime(entry?.time) || 0;
    if (eventTime > latestTime) {
      latestSnapshot = { experimentName: parsed.experimentName, status: parsed.status, time: eventTime };
      latestTime = eventTime;
    }
  });
  return latestSnapshot;
};

const resolveLatestExperimentHistoryStatus = (input) =>
  resolveLatestExperimentHistorySnapshot(input)?.status || null;

const resolveLatestLaboratoryDispatchSnapshot = ({ currentExperimentCode = "", currentLab = "", sample, trayCode = "" }) => {
  const normalizedCurrentExperimentCode = normalizeText(currentExperimentCode);
  const normalizedCurrentLab = normalizeText(currentLab);
  const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
  let latestSnapshot = null;
  let latestTime = -Infinity;
  asArray(sample?.history).forEach((entry) => {
    const status = normalizeLifecycleStatus(normalizeText(entry?.status || entry?.flow_status || entry?.flowStatus));
    const action = normalizeText(entry?.action);
    const targetType = normalizeText(entry?.target_type || entry?.targetType);
    if ((targetType && targetType !== "lab") || (status !== LAB_RESET_STATUS && !LAB_DISPATCH_HISTORY_ACTIONS.has(action))) {
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
      latestSnapshot = { targetExperimentCode, targetLab, time: eventTime };
      latestTime = eventTime;
    }
  });
  return latestSnapshot;
};

export {
  buildLaboratoryHistoryEntry,
  resolveAppearanceStorageSnapshot,
  resolveLatestAnyExperimentHistorySnapshot,
  resolveLatestExperimentHistorySnapshot,
  resolveLatestExperimentHistoryStatus,
  resolveLatestLaboratoryDispatchSnapshot,
  resolvePreDispatchSnapshot,
  resolvePreviousCompletedExperimentSnapshot,
  resolvePreviousStableSnapshot,
};
