import {
  EXPERIMENT_STATUS_RUNNING,
  TASK_STATUS_RUNNING,
  isExperimentRunningStatus,
  normalizeTaskStatusLabel,
} from "@/lib/statusNormalization";

const RUNNING_SCHEDULE_DELETE_MESSAGE = "实验已开始，不能删除排程";
const RUNNING_SCHEDULE_RESCHEDULE_MESSAGE = "实验已开始，不能删除后重新排程";
const RUNNING_TASK_DELETE_MESSAGE = "任务存在进行中的实验，不能删除任务";

const normalizeText = (value) => String(value ?? "").trim();
const asList = (value) => (Array.isArray(value) ? value : []);

const rowTaskCode = (row) => normalizeText(row?.task_code ?? row?.taskCode ?? row?.taskNo ?? row?.task_no);
const rowExperimentCode = (row) => normalizeText(
  row?.experiment_code ?? row?.experimentCode ?? row?.experimentNo ?? row?.experiment_no,
);
const rowTrayCode = (row) => normalizeText(row?.tray_code ?? row?.trayCode ?? row?.trayNo ?? row?.tray_no);

const rowHasRunningExperimentStatus = (row, fields = ["status"]) =>
  fields.some((field) => isExperimentRunningStatus(row?.[field]));

const taskHasRunningStatus = (task) => normalizeTaskStatusLabel(task?.status) === TASK_STATUS_RUNNING;

const rowMatchesTask = (row, taskCode) => rowTaskCode(row) === normalizeText(taskCode);
const rowMatchesExperiment = (row, taskCode, experimentCode) =>
  rowMatchesTask(row, taskCode) && rowExperimentCode(row) === normalizeText(experimentCode);

function buildExperimentTrayCodeSet({ experimentCode, experimentTrays = [], taskCode }) {
  const trays = new Set();
  for (const row of asList(experimentTrays)) {
    if (rowMatchesExperiment(row, taskCode, experimentCode)) {
      const trayCode = rowTrayCode(row);
      if (trayCode) {
        trays.add(trayCode);
      }
    }
  }
  return trays;
}

function samplesHaveRunningTrayForTask(samples, taskCode) {
  const normalizedTaskCode = normalizeText(taskCode);
  if (!normalizedTaskCode) {
    return false;
  }
  return asList(samples).some((sample) => {
    if (rowTaskCode(sample) !== normalizedTaskCode) {
      return false;
    }
    return asList(sample?.trays).some((tray) => isExperimentRunningStatus(tray?.status));
  });
}

function samplesHaveRunningTrayForExperiment({ experimentCode, experimentTrays = [], samples = [], taskCode }) {
  const trayCodes = buildExperimentTrayCodeSet({ experimentCode, experimentTrays, taskCode });
  if (trayCodes.size === 0) {
    return false;
  }
  return asList(samples).some((sample) => {
    if (!rowMatchesTask(sample, taskCode)) {
      return false;
    }
    return asList(sample?.trays).some(
      (tray) => trayCodes.has(rowTrayCode(tray)) && isExperimentRunningStatus(tray?.status),
    );
  });
}

function scheduleExperimentHasStarted({
  experimentRuns = [],
  experimentRunTrays = [],
  experimentTrays = [],
  samples = [],
  schedule,
}) {
  const taskCode = rowTaskCode(schedule);
  const experimentCode = rowExperimentCode(schedule);
  if (!taskCode || !experimentCode) {
    return false;
  }
  if (rowHasRunningExperimentStatus(schedule)) {
    return true;
  }
  if (asList(experimentRuns).some((row) => rowMatchesExperiment(row, taskCode, experimentCode) && rowHasRunningExperimentStatus(row))) {
    return true;
  }
  if (
    asList(experimentRunTrays).some(
      (row) =>
        rowMatchesExperiment(row, taskCode, experimentCode)
        && rowHasRunningExperimentStatus(row, ["run_tray_status", "status", "experiment_status"]),
    )
  ) {
    return true;
  }
  return samplesHaveRunningTrayForExperiment({ experimentCode, experimentTrays, samples, taskCode });
}

function taskHasRunningExperiment({
  experimentRuns = [],
  experimentRunTrays = [],
  experiments = [],
  samples = [],
  schedules = [],
  task,
}) {
  const taskCode = normalizeText(task?.code ?? task?.task_code ?? task?.id);
  if (!taskCode) {
    return false;
  }
  if (taskHasRunningStatus(task)) {
    return true;
  }
  if (asList(schedules).some((row) => rowMatchesTask(row, taskCode) && rowHasRunningExperimentStatus(row))) {
    return true;
  }
  if (asList(experiments).some((row) => rowMatchesTask(row, taskCode) && rowHasRunningExperimentStatus(row))) {
    return true;
  }
  if (asList(experimentRuns).some((row) => rowMatchesTask(row, taskCode) && rowHasRunningExperimentStatus(row))) {
    return true;
  }
  if (
    asList(experimentRunTrays).some(
      (row) => rowMatchesTask(row, taskCode) && rowHasRunningExperimentStatus(row, ["run_tray_status", "status", "experiment_status"]),
    )
  ) {
    return true;
  }
  return samplesHaveRunningTrayForTask(samples, taskCode);
}

export {
  EXPERIMENT_STATUS_RUNNING,
  RUNNING_SCHEDULE_DELETE_MESSAGE,
  RUNNING_SCHEDULE_RESCHEDULE_MESSAGE,
  RUNNING_TASK_DELETE_MESSAGE,
  scheduleExperimentHasStarted,
  taskHasRunningExperiment,
};
