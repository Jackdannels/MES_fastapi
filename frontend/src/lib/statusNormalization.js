const TASK_STATUS_WAITING = "待排程";
const TASK_STATUS_RUNNING = "任务进行中";
const TASK_STATUS_COMPLETED = "任务已完成";
const TRANSFER_STATUS_ARRIVED = "到货";
const RETURNED_STATUS = "厂家收回";
const EXPERIMENT_STATUS_RUNNING = "实验进行中";
const EXPERIMENT_STATUS_COMPLETED = "实验已完成";

const LEGACY_EXPERIMENT_RUNNING_STATUSES = new Set(["实验中"]);
const LEGACY_EXPERIMENT_COMPLETED_STATUSES = new Set([
  "实验完成",
  "实验已经完成",
  "实验后暂存间存放",
]);
const LEGACY_STAGING_TASK_STATUSES = new Set(["暂存间排放", "暂存间存放"]);

const normalizeStatusText = (value) => String(value ?? "").trim();

const normalizeExperimentStatusLabel = (value) => {
  const normalized = normalizeStatusText(value);
  if (normalized === EXPERIMENT_STATUS_RUNNING || LEGACY_EXPERIMENT_RUNNING_STATUSES.has(normalized)) {
    return EXPERIMENT_STATUS_RUNNING;
  }
  if (normalized === EXPERIMENT_STATUS_COMPLETED || LEGACY_EXPERIMENT_COMPLETED_STATUSES.has(normalized)) {
    return EXPERIMENT_STATUS_COMPLETED;
  }
  return normalized;
};

const normalizeTaskStatusLabel = (value) => {
  const normalized = normalizeStatusText(value);
  if (
    normalized === TASK_STATUS_RUNNING
    || normalized === EXPERIMENT_STATUS_RUNNING
    || LEGACY_EXPERIMENT_RUNNING_STATUSES.has(normalized)
  ) {
    return TASK_STATUS_RUNNING;
  }
  if (
    normalized === TASK_STATUS_COMPLETED
    || normalized === EXPERIMENT_STATUS_COMPLETED
    || LEGACY_EXPERIMENT_COMPLETED_STATUSES.has(normalized)
  ) {
    return TASK_STATUS_COMPLETED;
  }
  if (LEGACY_STAGING_TASK_STATUSES.has(normalized)) {
    return TASK_STATUS_WAITING;
  }
  return normalized;
};

const isTransferArrivedStatus = (value) => normalizeTaskStatusLabel(value) === TRANSFER_STATUS_ARRIVED;
const isExperimentRunningStatus = (value) => normalizeExperimentStatusLabel(value) === EXPERIMENT_STATUS_RUNNING;
const isExperimentCompletedStatus = (value) => normalizeExperimentStatusLabel(value) === EXPERIMENT_STATUS_COMPLETED;

export {
  EXPERIMENT_STATUS_COMPLETED,
  EXPERIMENT_STATUS_RUNNING,
  RETURNED_STATUS,
  TASK_STATUS_COMPLETED,
  TASK_STATUS_RUNNING,
  TASK_STATUS_WAITING,
  TRANSFER_STATUS_ARRIVED,
  isExperimentCompletedStatus,
  isExperimentRunningStatus,
  isTransferArrivedStatus,
  normalizeExperimentStatusLabel,
  normalizeStatusText,
  normalizeTaskStatusLabel,
};
