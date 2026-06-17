import { scheduleTargetsStorageArea } from "@/lib/labIdentity";
import { toLocalDateValue } from "@/modules/schedule/model";
import {
  asArray,
  buildExperimentByTaskAndCode,
  compareText,
  normalizeQuantity,
  normalizeText,
  parseDate,
  resolveExperimentCode,
  resolveLabDevice,
  resolveTaskCode,
  resolveTrayCode,
  startOfLocalDay,
} from "./sharedModel";

const formatLocalTime = (value) => {
  const date = parseDate(value);
  if (!date) {
    return "";
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const buildTimeLabel = (schedule) => {
  const start = formatLocalTime(schedule?.start_at || schedule?.startAt);
  const end = formatLocalTime(schedule?.end_at || schedule?.endAt);
  if (!start && !end) {
    return "-";
  }
  return `${start || "-"}-${end || "-"}`;
};

const scheduleOverlapsDate = (schedule, date) => {
  const dayStart = startOfLocalDay(date);
  const dayEnd = new Date(dayStart.getTime());
  dayEnd.setDate(dayEnd.getDate() + 1);
  const startAt = parseDate(schedule?.start_at || schedule?.startAt);
  const endAt = parseDate(schedule?.end_at || schedule?.endAt) || startAt;
  if (!startAt || !endAt) {
    return false;
  }
  return startAt < dayEnd && endAt > dayStart;
};

const resolveExperimentName = ({ experiment, schedule, task, experimentCode }) =>
  normalizeText(experiment?.experiment_name)
  || normalizeText(experiment?.name)
  || normalizeText(schedule?.experiment_name)
  || normalizeText(schedule?.experimentName)
  || normalizeText(task?.test_type)
  || normalizeText(task?.sample_type)
  || normalizeText(experimentCode)
  || "-";

const buildTaskByCode = (tasks) => {
  const map = new Map();
  asArray(tasks).forEach((task) => {
    const taskCode = resolveTaskCode(task);
    if (taskCode) {
      map.set(taskCode, task);
    }
  });
  return map;
};

const buildTrayCodesByExperiment = (experimentTrays) => {
  const map = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const taskCode = resolveTaskCode(entry);
    const experimentCode = resolveExperimentCode(entry);
    const trayCode = resolveTrayCode(entry);
    if (!taskCode || !experimentCode || !trayCode) {
      return;
    }
    const key = `${taskCode}::${experimentCode}`;
    const trayCodes = map.get(key) || [];
    if (!trayCodes.includes(trayCode)) {
      trayCodes.push(trayCode);
      map.set(key, trayCodes);
    }
  });
  return map;
};

const countSamplesForTrays = ({ samples, taskCode, trayCodes }) => {
  const traySet = new Set(trayCodes);
  if (!taskCode || traySet.size === 0) {
    return 0;
  }
  return asArray(samples).reduce((total, sample) => {
    if (resolveTaskCode(sample) !== taskCode) {
      return total;
    }
    return total + asArray(sample?.trays).reduce((trayTotal, tray) => {
      const trayCode = resolveTrayCode(tray);
      return traySet.has(trayCode) ? trayTotal + normalizeQuantity(tray?.quantity) : trayTotal;
    }, 0);
  }, 0);
};

function buildTodayTaskPlanView(input = {}) {
  const now = parseDate(input.now) || new Date();
  const tasks = asArray(input.tasks);
  const samples = asArray(input.samples);
  const schedules = asArray(input.schedules)
    .filter((schedule) => !scheduleTargetsStorageArea(schedule))
    .filter((schedule) => scheduleOverlapsDate(schedule, now))
    .sort((left, right) => {
      const leftStart = parseDate(left?.start_at || left?.startAt)?.getTime() ?? 0;
      const rightStart = parseDate(right?.start_at || right?.startAt)?.getTime() ?? 0;
      return leftStart - rightStart || compareText(resolveTaskCode(left), resolveTaskCode(right));
    });
  const taskByCode = buildTaskByCode(tasks);
  const experimentByKey = buildExperimentByTaskAndCode(input.experiments);
  const trayCodesByExperiment = buildTrayCodesByExperiment(input.experimentTrays || input.experiment_trays);
  const tasksByCode = new Map();

  schedules.forEach((schedule) => {
    const taskCode = resolveTaskCode(schedule);
    const experimentCode = resolveExperimentCode(schedule);
    if (!taskCode || !experimentCode) {
      return;
    }
    const key = `${taskCode}::${experimentCode}`;
    const task = taskByCode.get(taskCode) || null;
    const experiment = experimentByKey.get(key) || null;
    const trays = trayCodesByExperiment.get(key) || [];
    const row = {
      experimentCode,
      experimentType: resolveExperimentName({ experiment, experimentCode, schedule, task }),
      lab: resolveLabDevice(schedule) || resolveLabDevice(experiment) || "-",
      sampleCount: countSamplesForTrays({ samples, taskCode, trayCodes: trays }),
      time: buildTimeLabel(schedule),
      trays,
    };
    const taskEntry = tasksByCode.get(taskCode) || {
      experiments: [],
      taskCode,
    };
    taskEntry.experiments.push(row);
    tasksByCode.set(taskCode, taskEntry);
  });

  const planTasks = Array.from(tasksByCode.values());
  const rows = planTasks.flatMap((task) => task.experiments || []);
  return {
    date: toLocalDateValue(now),
    emptyText: "今日暂无实验排程",
    tasks: planTasks,
    summary: {
      assigned: rows.filter((row) => row.trays?.length).length,
      experiments: rows.length,
      pending: rows.filter((row) => !row.trays?.length).length,
      samples: rows.reduce((total, row) => total + (Number(row.sampleCount) || 0), 0),
      tasks: planTasks.length,
      types: new Set(rows.map((row) => row.experimentType).filter(Boolean)).size,
    },
  };
}

export { buildTodayTaskPlanView };
