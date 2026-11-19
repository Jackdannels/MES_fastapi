import {
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
  aggregateTaskStatusFromSamples,
  buildTaskExperimentProgress,
  buildTaskStatusLabel,
  normalizeText,
} from "../tasks/model.js";

const steps = [
  { key: "waiting", label: STATUS_WAITING },
  { key: "scheduled", label: STATUS_SCHEDULED },
  { key: "running", label: STATUS_RUNNING },
  { key: "completed", label: STATUS_COMPLETED },
  { key: "returned", label: STATUS_RETENTION },
];

function buildSampleTaskFlow({ taskCode, tasks, samples, experiments }) {
  const task = (Array.isArray(tasks) ? tasks : []).find((item) => normalizeText(item?.code) === taskCode);
  const taskSamples = (Array.isArray(samples) ? samples : []).filter((item) => normalizeText(item?.task_code) === taskCode);
  const aggregatedStatus = aggregateTaskStatusFromSamples(task, taskSamples);
  const progress = buildTaskExperimentProgress(taskCode, experiments);
  const status = aggregatedStatus !== STATUS_RETENTION && progress.hasPartialCompletion
    ? STATUS_RUNNING
    : aggregatedStatus || normalizeText(task?.status) || STATUS_WAITING;
  const activeIndex = Math.max(0, steps.findIndex((step) => step.label === status));

  return {
    currentStatus: buildTaskStatusLabel(status, progress),
    steps: steps.map((step, index) => ({
      ...step,
      active: index === activeIndex,
      reached: index <= activeIndex,
    })),
  };
}

export { buildSampleTaskFlow };
