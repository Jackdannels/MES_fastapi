import {
  EXPERIMENT_STATUS_RUNNING,
  TASK_STATUS_RUNNING,
  isExperimentRunningStatus,
  normalizeTaskStatusLabel,
} from "@/lib/statusNormalization";

const RUNNING_SCHEDULE_DELETE_MESSAGE = "实验已开始，不能删除排程";
const RUNNING_SCHEDULE_RESCHEDULE_MESSAGE = "实验已开始，不能删除后重新排程";
const RUNNING_TASK_DELETE_MESSAGE = "任务存在进行中的实验，不能删除任务";
const SCHEDULE_LOCKED_TRAY_STATUSES = new Set(["工装夹具安装", "实验准备就绪", "实验进行中", "实验中", "实验已完成", "实验完成", "实验已经完成"]);
const AXIS_STEP_COMPLETED_STATUSES = new Set(["实验已完成", "实验完成", "实验已经完成"]);

const normalizeText = (value) => String(value ?? "").trim();
const asList = (value) => (Array.isArray(value) ? value : []);

const rowTaskCode = (row) => normalizeText(row?.task_code ?? row?.taskCode ?? row?.taskNo ?? row?.task_no);
const rowExperimentCode = (row) => normalizeText(
  row?.experiment_code ?? row?.experimentCode ?? row?.experimentNo ?? row?.experiment_no,
);
const rowTrayCode = (row) => normalizeText(row?.tray_code ?? row?.trayCode ?? row?.trayNo ?? row?.tray_no);
const rowRunNo = (row) => normalizeText(row?.run_no ?? row?.runNo ?? row?.id);
const rowAxisCode = (row) => normalizeText(row?.axis_code ?? row?.axisCode).toLowerCase();
const rowSubExperimentCode = (row) =>
  normalizeText(row?.sub_experiment_code ?? row?.subExperimentCode ?? row?.sub_experiment_no ?? row?.subExperimentNo);

const rowHasRunningExperimentStatus = (row, fields = ["status"]) =>
  fields.some((field) => isExperimentRunningStatus(row?.[field]));
const rowHasScheduleLockedStatus = (row, fields = ["status"]) =>
  fields.some((field) => SCHEDULE_LOCKED_TRAY_STATUSES.has(normalizeText(row?.[field])) || isExperimentRunningStatus(row?.[field]));
const rowHasCompletedAxisStatus = (row) => AXIS_STEP_COMPLETED_STATUSES.has(normalizeText(row?.status ?? row?.step_status ?? row?.stepStatus));
const normalizeAxisCodes = (value) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/，/g, ",").split(",")
      : [];
  const seen = new Set();
  return rawValues
    .map((item) => normalizeText(item).toLowerCase())
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
};

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

function samplesHaveScheduleLockedTrayForExperiment({ experimentCode, experimentTrays = [], samples = [], taskCode }) {
  const trayCodes = buildExperimentTrayCodeSet({ experimentCode, experimentTrays, taskCode });
  if (trayCodes.size === 0) {
    return false;
  }
  return asList(samples).some((sample) => {
    if (!rowMatchesTask(sample, taskCode)) {
      return false;
    }
    return asList(sample?.trays).some(
      (tray) => trayCodes.has(rowTrayCode(tray)) && rowHasScheduleLockedStatus(tray),
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
  return samplesHaveScheduleLockedTrayForExperiment({ experimentCode, experimentTrays, samples, taskCode });
}

function scheduleHasPartialCompletedAxes({
  experimentRuns = [],
  experimentRunSteps = [],
  schedule,
}) {
  const taskCode = rowTaskCode(schedule);
  const experimentCode = rowExperimentCode(schedule);
  const subExperimentCode = rowSubExperimentCode(schedule);
  const scheduledAxisCodes = normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes);
  if (!taskCode || !experimentCode || !subExperimentCode || scheduledAxisCodes.length <= 1) {
    return false;
  }

  const matchingRunNos = new Set(
    asList(experimentRuns)
      .filter((row) => rowMatchesExperiment(row, taskCode, experimentCode) && rowSubExperimentCode(row) === subExperimentCode)
      .map(rowRunNo)
      .filter(Boolean),
  );
  const scheduledAxisSet = new Set(scheduledAxisCodes);
  const completedAxisCodes = new Set();
  for (const step of asList(experimentRunSteps)) {
    if (!rowMatchesExperiment(step, taskCode, experimentCode)) {
      continue;
    }
    if (rowSubExperimentCode(step) !== subExperimentCode) {
      continue;
    }
    const stepRunNo = rowRunNo(step);
    if (matchingRunNos.size > 0 && stepRunNo && !matchingRunNos.has(stepRunNo)) {
      continue;
    }
    const axisCode = rowAxisCode(step);
    if (scheduledAxisSet.has(axisCode) && rowHasCompletedAxisStatus(step)) {
      completedAxisCodes.add(axisCode);
    }
  }

  return completedAxisCodes.size > 0 && completedAxisCodes.size < scheduledAxisCodes.length;
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
  scheduleHasPartialCompletedAxes,
  taskHasRunningExperiment,
};
