const OVERDUE_MS = 24 * 60 * 60 * 1000;
const TRANSFER_STATUS_STORED = "到货";
const LEGACY_TRANSFER_STATUS_STORED = "已入库";
const RETENTION_KEYWORD = "暂存间";

const normalizeText = (value) => String(value ?? "").trim();

const parseTimeValue = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const hasFormalScheduleForExperiment = (schedules, experiment) =>
  (Array.isArray(schedules) ? schedules : []).some(
    (entry) =>
      !normalizeText(entry?.device).includes(RETENTION_KEYWORD) &&
      normalizeText(entry?.task_code) === normalizeText(experiment?.task_code) &&
      normalizeText(entry?.experiment_code) === normalizeText(experiment?.experiment_code),
  );

const listOverdueWaitingExperiments = (tasks, experiments, schedules, now = Date.now()) => {
  const taskByCode = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [normalizeText(task?.code), task]));

  return (Array.isArray(experiments) ? experiments : [])
    .filter((experiment) => {
      const task = taskByCode.get(normalizeText(experiment?.task_code));
      if (![TRANSFER_STATUS_STORED, LEGACY_TRANSFER_STATUS_STORED].includes(normalizeText(task?.transfer_status))) {
        return false;
      }
      if (hasFormalScheduleForExperiment(schedules, experiment)) {
        return false;
      }
      const startedAt = parseTimeValue(experiment?.unscheduled_since);
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

const hasOverdueWaitingExperiment = (tasks, experiments, schedules, now = Date.now()) =>
  listOverdueWaitingExperiments(tasks, experiments, schedules, now).length > 0;

const findFirstOverdueWaitingTaskCode = (tasks, experiments, schedules, now = Date.now()) =>
  normalizeText(listOverdueWaitingExperiments(tasks, experiments, schedules, now)[0]?.task_code);

export { findFirstOverdueWaitingTaskCode, hasOverdueWaitingExperiment };
