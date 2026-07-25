import {
  EXPERIMENT_STATUS_RUNNING,
  TASK_STATUS_RUNNING,
  isExperimentRunningStatus,
  normalizeTaskStatusLabel,
} from "@/lib/statusNormalization";
import { normalizeAxisCodes } from "@/lib/axisCodes";

const RUNNING_SCHEDULE_DELETE_MESSAGE = "排程已完成任务比对，不能删除";
const RUNNING_SCHEDULE_RESCHEDULE_MESSAGE = "排程已完成任务比对，不能删除后重新排程";
const RUNNING_TASK_DELETE_MESSAGE = "任务存在进行中的实验，不能删除任务";
const SCHEDULE_LOCKED_TRAY_STATUSES = new Set(["已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", "实验中", "实验已完成", "实验完成", "实验已经完成"]);

const normalizeText = (value) => String(value ?? "").trim();
const asList = (value) => (Array.isArray(value) ? value : []);

const rowTaskCode = (row) => normalizeText(row?.task_code ?? row?.taskCode ?? row?.taskNo ?? row?.task_no);
const rowExperimentCode = (row) => normalizeText(
  row?.experiment_code ?? row?.experimentCode ?? row?.experimentNo ?? row?.experiment_no,
);
const rowTrayCode = (row) => normalizeText(row?.tray_code ?? row?.trayCode ?? row?.trayNo ?? row?.tray_no);
const rowRunNo = (row) => normalizeText(row?.run_no ?? row?.runNo ?? row?.id);
const rowScheduleId = (row) => normalizeText(row?.schedule_id ?? row?.scheduleId ?? row?.schedule_no ?? row?.scheduleNo);
const rowAxisBatchNo = (row) => normalizeText(row?.axis_batch_no ?? row?.axisBatchNo);
const rowSubExperimentCode = (row) =>
  normalizeText(row?.sub_experiment_code ?? row?.subExperimentCode ?? row?.sub_experiment_no ?? row?.subExperimentNo);

const rowHasRunningExperimentStatus = (row, fields = ["status"]) =>
  fields.some((field) => isExperimentRunningStatus(row?.[field]));
const rowHasScheduleLockedStatus = (row, fields = ["status"]) =>
  fields.some((field) => SCHEDULE_LOCKED_TRAY_STATUSES.has(normalizeText(row?.[field])) || isExperimentRunningStatus(row?.[field]));
const taskHasRunningStatus = (task) => normalizeTaskStatusLabel(task?.status) === TASK_STATUS_RUNNING;

const rowMatchesTask = (row, taskCode) => rowTaskCode(row) === normalizeText(taskCode);
const rowMatchesExperiment = (row, taskCode, experimentCode) =>
  rowMatchesTask(row, taskCode) && rowExperimentCode(row) === normalizeText(experimentCode);

function rowMatchesScheduleScope(row, schedule, { allowLegacyExperimentFallback = false } = {}) {
  const taskCode = rowTaskCode(schedule);
  const experimentCode = rowExperimentCode(schedule);
  if (!rowMatchesExperiment(row, taskCode, experimentCode)) {
    return false;
  }

  const scheduleId = normalizeText(schedule?.id) || rowScheduleId(schedule);
  const recordScheduleId = rowScheduleId(row);
  if (scheduleId && recordScheduleId) {
    return scheduleId === recordScheduleId;
  }

  const subExperimentCode = rowSubExperimentCode(schedule);
  const recordSubExperimentCode = rowSubExperimentCode(row);
  if (subExperimentCode && recordSubExperimentCode) {
    return subExperimentCode === recordSubExperimentCode;
  }

  const axisBatchNo = rowAxisBatchNo(schedule);
  const recordAxisBatchNo = rowAxisBatchNo(row);
  if (axisBatchNo && recordAxisBatchNo) {
    return axisBatchNo === recordAxisBatchNo;
  }

  const scheduledAxisCodes = normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes);
  const recordAxisCodes = normalizeAxisCodes(row?.axis_codes ?? row?.axisCodes);
  if (scheduledAxisCodes.length > 0 && recordAxisCodes.length > 0) {
    const recordAxisSet = new Set(recordAxisCodes);
    return scheduledAxisCodes.some((axisCode) => recordAxisSet.has(axisCode));
  }

  const scheduleScoped = Boolean(subExperimentCode || axisBatchNo || scheduledAxisCodes.length > 0);
  const recordScoped = Boolean(recordScheduleId || recordSubExperimentCode || recordAxisBatchNo || recordAxisCodes.length > 0);
  if (scheduleScoped || recordScoped) {
    return false;
  }

  return allowLegacyExperimentFallback;
}

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

function buildTaskTrayExperimentCodeMap({ experimentTrays = [], taskCode }) {
  const experimentCodesByTray = new Map();
  for (const row of asList(experimentTrays)) {
    if (!rowMatchesTask(row, taskCode)) {
      continue;
    }
    const trayCode = rowTrayCode(row);
    const experimentCode = rowExperimentCode(row);
    if (!trayCode || !experimentCode) {
      continue;
    }
    const experimentCodes = experimentCodesByTray.get(trayCode) || new Set();
    experimentCodes.add(experimentCode);
    experimentCodesByTray.set(trayCode, experimentCodes);
  }
  return experimentCodesByTray;
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

function samplesHaveScheduleLockedTrayForExperiment({ experimentCode, experimentTrays = [], samples = [], schedule, taskCode }) {
  const trayCodes = buildExperimentTrayCodeSet({ experimentCode, experimentTrays, taskCode });
  const experimentCodesByTray = buildTaskTrayExperimentCodeMap({ experimentTrays, taskCode });
  const scheduleSubExperimentCode = rowSubExperimentCode(schedule);
  if (trayCodes.size === 0) {
    return false;
  }
  return asList(samples).some((sample) => {
    if (!rowMatchesTask(sample, taskCode)) {
      return false;
    }
    return asList(sample?.trays).some((tray) => {
      const trayCode = rowTrayCode(tray);
      if (!trayCodes.has(trayCode) || !rowHasScheduleLockedStatus(tray)) {
        return false;
      }
      const targetExperimentCode = normalizeText(tray?.target_experiment_code ?? tray?.targetExperimentCode);
      if (targetExperimentCode && targetExperimentCode !== experimentCode) {
        return false;
      }
      if (!scheduleSubExperimentCode) {
        if (!targetExperimentCode && (experimentCodesByTray.get(trayCode)?.size || 0) > 1) {
          return false;
        }
        return true;
      }
      return normalizeText(tray?.target_sub_experiment_code ?? tray?.targetSubExperimentCode) === scheduleSubExperimentCode;
    });
  });
}

function scheduleExperimentHasStarted({
  experimentRuns = [],
  experimentRunSteps = [],
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

  const matchingRunningRunNos = new Set();
  const hasMatchingRunningRun = asList(experimentRuns).some((row) => {
    if (!rowMatchesScheduleScope(row, schedule, { allowLegacyExperimentFallback: true }) || !rowHasRunningExperimentStatus(row)) {
      return false;
    }
    const runNo = rowRunNo(row);
    if (runNo) {
      matchingRunningRunNos.add(runNo);
    }
    return true;
  });
  if (hasMatchingRunningRun) {
    return true;
  }
  if (
    asList(experimentRunTrays).some(
      (row) => {
        if (!rowMatchesExperiment(row, taskCode, experimentCode)) {
          return false;
        }
        if (!rowHasRunningExperimentStatus(row, ["run_tray_status", "status", "experiment_status"])) {
          return false;
        }
        const runNo = rowRunNo(row);
        return (runNo && matchingRunningRunNos.has(runNo)) || rowMatchesScheduleScope(row, schedule);
      },
    )
  ) {
    return true;
  }
  if (
    asList(experimentRunSteps).some(
      (row) => rowHasScheduleLockedStatus(row) && rowMatchesScheduleScope(row, schedule),
    )
  ) {
    return true;
  }
  return samplesHaveScheduleLockedTrayForExperiment({ experimentCode, experimentTrays, samples, schedule, taskCode });
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
