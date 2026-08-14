import { resolveTransferConfirmedAt } from "./transferArrivalTime";
import { serverNowMs } from "./serverClock";
import { TRANSFER_STATUS_ARRIVED, isTransferArrivedStatus, normalizeTaskStatusLabel } from "./statusNormalization";
import { filterActiveTasks } from "./taskArchive";

const OVERDUE_MS = 24 * 60 * 60 * 1000;
const RETENTION_KEYWORD = "暂存间";
const ARRIVED_OR_LATER_SAMPLE_STATUSES = new Set([
  TRANSFER_STATUS_ARRIVED,
  "送至实验室",
  "实验准备就绪",
  "实验进行中",
  "实验中",
  "实验已完成",
  "实验完成",
  "实验已经完成",
  "实验后暂存间存放",
  "已到达暂存间",
  "送至外观检测间",
  "实验后外观检测间存放",
]);

const normalizeText = (value) => String(value ?? "").trim();

const isArrivedOrLaterSampleStatus = (value) =>
  ARRIVED_OR_LATER_SAMPLE_STATUSES.has(normalizeTaskStatusLabel(value)) || ARRIVED_OR_LATER_SAMPLE_STATUSES.has(normalizeText(value));

const buildSamplesByTaskCode = (samples) => {
  const grouped = new Map();
  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    if (!taskCode) {
      return;
    }
    grouped.set(taskCode, [...(grouped.get(taskCode) || []), sample]);
  });
  return grouped;
};

const isTaskArrived = (task, samples) => {
  if (isTransferArrivedStatus(task?.transfer_status)) {
    return true;
  }
  const taskSamples = Array.isArray(samples) ? samples : [];
  if (taskSamples.length === 0) {
    return false;
  }
  return taskSamples.every((sample) => {
    if (isArrivedOrLaterSampleStatus(sample?.status) || isArrivedOrLaterSampleStatus(sample?.flow_status)) {
      return true;
    }
    const trays = Array.isArray(sample?.trays) ? sample.trays : [];
    return trays.length > 0 && trays.every((tray) => isArrivedOrLaterSampleStatus(tray?.status));
  });
};

const hasFormalScheduleForExperiment = (schedules, experiment) =>
  (Array.isArray(schedules) ? schedules : []).some(
    (entry) =>
      !normalizeText(entry?.device).includes(RETENTION_KEYWORD) &&
      normalizeText(entry?.task_code) === normalizeText(experiment?.task_code) &&
      normalizeText(entry?.experiment_code) === normalizeText(experiment?.experiment_code),
  );

const listOverdueWaitingExperiments = (tasks, experiments, schedules, now = serverNowMs(), samples = []) => {
  const taskByCode = new Map(
    filterActiveTasks(tasks, samples).map((task) => [normalizeText(task?.code), task]),
  );
  const samplesByTaskCode = buildSamplesByTaskCode(samples);

  return (Array.isArray(experiments) ? experiments : [])
    .filter((experiment) => {
      const taskCode = normalizeText(experiment?.task_code);
      const task = taskByCode.get(taskCode);
      if (!task) {
        return false;
      }
      const taskSamples = samplesByTaskCode.get(taskCode);
      const confirmedAt = resolveTransferConfirmedAt({ samples: taskSamples, task });
      if (!confirmedAt && !isTaskArrived(task, taskSamples)) {
        return false;
      }
      if (hasFormalScheduleForExperiment(schedules, experiment)) {
        return false;
      }
      const startedAt = confirmedAt?.getTime() ?? Number.NaN;
      return Number.isFinite(startedAt) && now - startedAt > OVERDUE_MS;
    })
    .sort((left, right) => {
      const taskCompare = normalizeText(left?.task_code).localeCompare(normalizeText(right?.task_code), "zh-Hans-CN");
      if (taskCompare !== 0) {
        return taskCompare;
      }
      return normalizeText(left?.experiment_code).localeCompare(normalizeText(right?.experiment_code), "zh-Hans-CN");
    });
};

const hasOverdueWaitingExperiment = (tasks, experiments, schedules, now = serverNowMs(), samples = []) =>
  listOverdueWaitingExperiments(tasks, experiments, schedules, now, samples).length > 0;

const findFirstOverdueWaitingTaskCode = (tasks, experiments, schedules, now = serverNowMs(), samples = []) =>
  normalizeText(listOverdueWaitingExperiments(tasks, experiments, schedules, now, samples)[0]?.task_code);

export { findFirstOverdueWaitingTaskCode, hasOverdueWaitingExperiment };
