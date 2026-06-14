import {
  APPEARANCE_INSPECTION_LOCATION,
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  APPEARANCE_STOCKED_STATUS,
  DEFAULT_LABELS,
  FLOW_STATUS_LABELS,
  POST_EXPERIMENT_STAGING_SENT_STATUS,
  POST_EXPERIMENT_STAGING_STOCKED_STATUS,
  SAMPLE_FLOW_STEPS,
  TEST_LABS,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";

// 允许通过覆盖 labels 复用同一套状态推导逻辑。
const normalizeLabels = (labels = {}) => ({
  ...DEFAULT_LABELS,
  ...(labels && typeof labels === "object" ? labels : {}),
});

const isPostRetentionLocation = (location, labels = DEFAULT_LABELS) => {
  const normalizedLabels = normalizeLabels(labels);
  return normalizeText(location) === normalizeText(normalizedLabels.postRetentionLocation);
};

const isAmbiguousStagingStatus = (value) => {
  const text = normalizeText(value);
  return text === "已到达暂存间" || text === "到达暂存间" || text === "放置暂存间";
};

const isAppearanceInspectionStatus = (value) => {
  const text = normalizeText(value);
  return (
    text === "送至外观检测间"
    || text === APPEARANCE_STOCKED_STATUS
    || text === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
    || text === "已到达外观检测间"
  );
};

const normalizeLifecycleStatus = (location, status = "", labels = DEFAULT_LABELS) => {
  const normalizedLabels = normalizeLabels(labels);
  const normalizedLocation = normalizeText(location);
  const currentStatus = normalizeText(status);
  const preRetentionLocation = normalizeText(
    normalizedLabels.preRetentionLocation || normalizedLabels.retentionLocation,
  );
  const postRetentionLocation = normalizeText(normalizedLabels.postRetentionLocation);
  const isPreRetention = normalizedLocation && normalizedLocation === preRetentionLocation;
  const isPostRetention = normalizedLocation && normalizedLocation === postRetentionLocation;

  if (isPostRetention && isAmbiguousStagingStatus(currentStatus)) {
    return POST_EXPERIMENT_STAGING_STOCKED_STATUS;
  }
  if (FLOW_STATUS_LABELS.has(currentStatus)) {
    return currentStatus === "运输中" ? "样品运输中" : currentStatus;
  }
  if (currentStatus === "运输中") {
    return "样品运输中";
  }
  if (currentStatus === "厂家收回" || currentStatus === "已处置") {
    return "厂家收回";
  }
  if (currentStatus === "已到达外观检测间") {
    return APPEARANCE_STOCKED_STATUS;
  }
  if (isAppearanceInspectionStatus(currentStatus)) {
    return currentStatus;
  }
  if (currentStatus === "放置暂存间") {
    return POST_EXPERIMENT_STAGING_STOCKED_STATUS;
  }
  if (
    currentStatus === normalizedLabels.sampleStored
    && normalizedLabels.sampleStored === "到货"
  ) {
    return isPostRetention ? POST_EXPERIMENT_STAGING_STOCKED_STATUS : isPreRetention ? "已到达暂存间" : "到货";
  }
  if (currentStatus === "实验完成" || currentStatus === "实验已完成") {
    return "实验已完成";
  }
  if (currentStatus === "实验进行中" || currentStatus === "实验中") {
    return "实验进行中";
  }
  if (currentStatus === "实验准备就绪" || currentStatus === normalizedLabels.sampleTesting) {
    return "实验准备就绪";
  }
  if (isPostRetention) {
    return currentStatus === POST_EXPERIMENT_STAGING_SENT_STATUS
      ? POST_EXPERIMENT_STAGING_SENT_STATUS
      : POST_EXPERIMENT_STAGING_STOCKED_STATUS;
  }
  if (normalizedLocation.includes(APPEARANCE_INSPECTION_LOCATION)) {
    return currentStatus || APPEARANCE_STOCKED_STATUS;
  }
  if (isPreRetention) {
    return "已到达暂存间";
  }
  if (TEST_LABS.has(normalizedLocation)) {
    return "已到达实验室";
  }
  if (
    normalizedLocation &&
    (normalizedLocation === normalizeText(normalizedLabels.unpackingLocation) ||
      normalizedLocation === normalizeText(normalizedLabels.intakeLocation))
  ) {
    return "到货";
  }
  return SAMPLE_FLOW_STEPS[0].label;
};

const normalizeSampleRecord = (sample, labels = DEFAULT_LABELS) => {
  const record = sample && typeof sample === "object" ? { ...sample } : {};
  const normalizedStatus = normalizeLifecycleStatus(record.location, record.status, labels);
  const trays = Array.isArray(record.trays)
    ? record.trays.map((tray) => {
        const rawTrayStatus = normalizeText(tray?.status || tray?.tray_status || tray?.trayStatus);
        return {
          ...tray,
          status: rawTrayStatus ? normalizeLifecycleStatus(record.location, rawTrayStatus, labels) : "",
        };
      })
    : [];

  return {
    ...record,
    flow_status: normalizedStatus,
    status: normalizedStatus,
    trays,
  };
};

const normalizeSamplesSnapshot = (samples, labels = DEFAULT_LABELS) =>
  (Array.isArray(samples) ? samples : []).map((sample) => normalizeSampleRecord(sample, labels));

// 托盘状态与样品状态保持同一套规范流程标签。
const syncTrayStatusToSampleStatus = (status, location = "", labels = DEFAULT_LABELS) =>
  normalizeLifecycleStatus(location, status, labels);

const resolveFlowStatusByLocation = (location, status = "", labels = DEFAULT_LABELS) =>
  normalizeLifecycleStatus(location, status, labels);

export {
  isAmbiguousStagingStatus,
  isAppearanceInspectionStatus,
  isPostRetentionLocation,
  normalizeLabels,
  normalizeLifecycleStatus,
  normalizeSampleRecord,
  normalizeSamplesSnapshot,
  resolveFlowStatusByLocation,
  syncTrayStatusToSampleStatus,
};
