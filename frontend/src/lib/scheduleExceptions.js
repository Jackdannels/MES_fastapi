import { STORAGE_KEYS } from "./storageKeys";
import { resolveTransferConfirmedAt } from "./transferArrivalTime";
import { formatLocalDateTime } from "./dateTime";
import { normalizeAxisCodes } from "./axisCodes";
import {
  EXPERIMENT_STATUS_COMPLETED,
  EXPERIMENT_STATUS_RUNNING,
  RETURNED_STATUS,
  isExperimentCompletedStatus,
  isExperimentRunningStatus,
  normalizeExperimentStatusLabel,
} from "./statusNormalization";
import { formatDateTime, isRetentionDevice, normalizeText, resolveTaskStatus, STATUS_WAITING } from "@/modules/schedule/model";

const STARTED_STATUSES = new Set([
  EXPERIMENT_STATUS_RUNNING,
  EXPERIMENT_STATUS_COMPLETED,
  "工装夹具安装",
  "实验准备就绪",
  "实验后暂存间存放",
  "送至外观检测间",
  "实验后外观检测间存放",
  RETURNED_STATUS,
]);
const ACTIVE_LAB_PROGRESS_STATUSES = new Set([
  EXPERIMENT_STATUS_RUNNING,
  "工装夹具安装",
  "实验准备就绪",
  "实验中",
]);
const COMPLETED_STATUSES = new Set([
  EXPERIMENT_STATUS_COMPLETED,
  "实验后暂存间存放",
  "送至外观检测间",
  "实验后外观检测间存放",
  RETURNED_STATUS,
]);

const SCHEDULE_EXCEPTION_TYPE = "schedule_missed_start";
const SCHEDULE_EXCEPTION_REASON = "排程时段内未开始实验，系统已自动撤销排程";

const asArray = (value) => (Array.isArray(value) ? value : []);

const parseDate = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
};

const cloneSnapshotArrays = (snapshot = {}) => ({
  [STORAGE_KEYS.conflicts]: asArray(snapshot[STORAGE_KEYS.conflicts]).map((entry) => ({ ...entry })),
  [STORAGE_KEYS.experiments]: asArray(snapshot[STORAGE_KEYS.experiments]).map((entry) => ({ ...entry })),
  [STORAGE_KEYS.experiment_trays]: asArray(snapshot[STORAGE_KEYS.experiment_trays]).map((entry) => ({ ...entry })),
  [STORAGE_KEYS.samples]: asArray(snapshot[STORAGE_KEYS.samples]).map((sample) => ({
    ...sample,
    history: asArray(sample?.history).map((entry) => ({ ...entry })),
    trays: asArray(sample?.trays).map((tray) => ({ ...tray })),
  })),
  [STORAGE_KEYS.schedules]: asArray(snapshot[STORAGE_KEYS.schedules]).map((entry) => ({ ...entry })),
  [STORAGE_KEYS.tasks]: asArray(snapshot[STORAGE_KEYS.tasks]).map((entry) => ({ ...entry })),
});

const buildExperimentTrayMap = (experimentTrays) => {
  const trayMap = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const taskCode = normalizeText(entry?.task_code);
    const experimentCode = normalizeText(entry?.experiment_code);
    const trayCode = normalizeText(entry?.tray_code);
    if (!taskCode || !experimentCode || !trayCode) {
      return;
    }
    const key = `${taskCode}::${experimentCode}`;
    const current = trayMap.get(key) || new Set();
    current.add(trayCode);
    trayMap.set(key, current);
  });
  return trayMap;
};

const buildTrayExperimentCodeMap = (experimentTrays) => {
  const trayMap = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const trayCode = normalizeText(entry?.tray_code);
    const experimentCode = normalizeText(entry?.experiment_code);
    if (!trayCode || !experimentCode) {
      return;
    }
    const current = trayMap.get(trayCode) || new Set();
    current.add(experimentCode);
    trayMap.set(trayCode, current);
  });
  return trayMap;
};

const buildExperimentNameMap = (experiments) =>
  new Map(
    asArray(experiments).map((entry) => [normalizeText(entry?.experiment_code), normalizeText(entry?.experiment_name)]),
  );

const rowScheduleId = (row) => normalizeText(row?.schedule_id ?? row?.scheduleId ?? row?.schedule_no ?? row?.scheduleNo);
const rowAxisBatchNo = (row) => normalizeText(row?.axis_batch_no ?? row?.axisBatchNo);
const rowSubExperimentCode = (row) =>
  normalizeText(row?.sub_experiment_code ?? row?.subExperimentCode ?? row?.sub_experiment_no ?? row?.subExperimentNo);
const rowAxisCodes = (row) => {
  const explicitAxisCodes = normalizeAxisCodes(row?.axis_codes ?? row?.axisCodes);
  if (explicitAxisCodes.length > 0) {
    return explicitAxisCodes;
  }
  return normalizeAxisCodes(row?.axis_code ?? row?.axisCode);
};

const scheduleIdentifier = (schedule) => normalizeText(schedule?.id) || rowScheduleId(schedule);
const scheduleHasAxisScope = (schedule) =>
  Boolean(rowSubExperimentCode(schedule) || rowAxisBatchNo(schedule) || rowAxisCodes(schedule).length > 0);

const rowMatchesScheduleScope = (row, schedule, { allowLegacyFallback = false } = {}) => {
  const scheduleId = scheduleIdentifier(schedule);
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

  const scheduledAxisCodes = rowAxisCodes(schedule);
  const recordAxisCodes = rowAxisCodes(row);
  if (scheduledAxisCodes.length > 0 && recordAxisCodes.length > 0) {
    const recordAxisSet = new Set(recordAxisCodes);
    return scheduledAxisCodes.some((axisCode) => recordAxisSet.has(axisCode));
  }

  const scheduleScoped = scheduleHasAxisScope(schedule);
  const recordScoped = Boolean(recordScheduleId || recordSubExperimentCode || recordAxisBatchNo || recordAxisCodes.length > 0);
  if (scheduleScoped || recordScoped) {
    return false;
  }

  return allowLegacyFallback;
};

const parseExperimentHistoryDetail = (detail, taskCode) => {
  const segments = String(detail ?? "")
    .split(" / ")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  if (segments.length < 3 || segments[0] !== normalizeText(taskCode)) {
    return null;
  }
  return {
    experimentName: segments[1],
    status: segments[2],
  };
};

const collectScheduleSamples = ({ experimentTrayMap, samples, schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scopedTrayCodes = experimentTrayMap.get(`${taskCode}::${experimentCode}`) || new Set();
  const axisScopedSchedule = scheduleHasAxisScope(schedule);

  return asArray(samples).filter((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
    }
    if (axisScopedSchedule) {
      return rowMatchesScheduleScope(sample, schedule) || asArray(sample?.trays).some((tray) => {
        const trayCode = normalizeText(tray?.tray_code);
        if (scopedTrayCodes.size > 0 && !scopedTrayCodes.has(trayCode)) {
          return false;
        }
        return rowMatchesScheduleScope(tray, schedule);
      });
    }
    if (scopedTrayCodes.size === 0) {
      return true;
    }
    return asArray(sample?.trays).some((tray) => scopedTrayCodes.has(normalizeText(tray?.tray_code)));
  });
};

const resolveScheduleLifecycle = ({
  experimentTrayMap,
  trayExperimentCodeMap,
  experimentNameByCode,
  samples,
  schedule,
}) => {
  const matchedSamples = collectScheduleSamples({ experimentTrayMap, samples, schedule });
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scopedTrayCodes = experimentTrayMap.get(`${taskCode}::${experimentCode}`) || new Set();
  const trayStatuses = [];
  const scopedTraySnapshots = [];
  const experimentName = normalizeText(experimentNameByCode.get(experimentCode));
  const latestHistoryBySample = new Map();
  const axisScopedSchedule = scheduleHasAxisScope(schedule);

  matchedSamples.forEach((sample) => {
    const sampleMatchesScheduleScope = !axisScopedSchedule || rowMatchesScheduleScope(sample, schedule, { allowLegacyFallback: true });
    const sampleHasMatchingScopedTray = !axisScopedSchedule || asArray(sample?.trays).some((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      return (scopedTrayCodes.size === 0 || scopedTrayCodes.has(trayCode)) && rowMatchesScheduleScope(tray, schedule);
    });
    asArray(sample?.history).forEach((entry) => {
      if (
        axisScopedSchedule
        && !rowMatchesScheduleScope(entry, schedule)
        && !sampleMatchesScheduleScope
        && !sampleHasMatchingScopedTray
      ) {
        return;
      }
      const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
      if (!parsed || parsed.experimentName !== experimentName) {
        return;
      }
      const sampleCode = normalizeText(sample?.code);
      if (!sampleCode) {
        return;
      }
      const eventTime = parseDate(entry?.time)?.getTime() || 0;
      const existing = latestHistoryBySample.get(sampleCode);
      if (!existing || eventTime >= existing.time) {
        latestHistoryBySample.set(sampleCode, {
          status: parsed.status,
          time: eventTime,
        });
      }
    });

    const trays = asArray(sample?.trays);
    if (trays.length === 0 && scopedTrayCodes.size === 0) {
      const sampleStatus = normalizeText(sample?.status);
      if (sampleStatus) {
        trayStatuses.push(sampleStatus);
      }
      return;
    }

    trays.forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (scopedTrayCodes.size > 0 && !scopedTrayCodes.has(trayCode)) {
        return;
      }
      if (axisScopedSchedule && !rowMatchesScheduleScope(tray, schedule) && !sampleMatchesScheduleScope) {
        return;
      }
      const trayStatus = normalizeText(tray?.status) || normalizeText(sample?.status);
      if (trayStatus) {
        trayStatuses.push(trayStatus);
        scopedTraySnapshots.push({
          location: normalizeText(tray?.target_lab || tray?.targetLab || sample?.location),
          status: trayStatus,
          targetExperimentCode: normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode),
        });
      }
    });
  });

  if (latestHistoryBySample.size > 0) {
    const historyStatuses = Array.from(latestHistoryBySample.values()).map((entry) => entry.status);
    return {
      completed: matchedSamples.length > 0 && latestHistoryBySample.size === matchedSamples.length && historyStatuses.every((status) => COMPLETED_STATUSES.has(normalizeExperimentStatusLabel(status)) || isExperimentCompletedStatus(status)),
      started: historyStatuses.some((status) => STARTED_STATUSES.has(normalizeExperimentStatusLabel(status)) || isExperimentRunningStatus(status)),
      trayStatuses,
    };
  }

  const hasSharedScopedTray = Array.from(scopedTrayCodes).some((trayCode) => (trayExperimentCodeMap.get(trayCode)?.size || 0) > 1);
  if (hasSharedScopedTray) {
    const scheduleDevice = normalizeText(schedule?.device);
    const startedByScopedTarget = scopedTraySnapshots.some(
      (tray) =>
        tray.targetExperimentCode === experimentCode
        && (STARTED_STATUSES.has(normalizeExperimentStatusLabel(tray.status)) || isExperimentRunningStatus(tray.status)),
    );
    const startedByLegacyLabLocation = scopedTraySnapshots.some(
      (tray) =>
        !tray.targetExperimentCode
        && scheduleDevice
        && tray.location === scheduleDevice
        && (ACTIVE_LAB_PROGRESS_STATUSES.has(normalizeExperimentStatusLabel(tray.status)) || isExperimentRunningStatus(tray.status)),
    );
    return {
      completed: false,
      started: startedByScopedTarget || startedByLegacyLabLocation,
      trayStatuses,
    };
  }

  const startedByStatus = trayStatuses.some((status) => STARTED_STATUSES.has(normalizeExperimentStatusLabel(status)) || isExperimentRunningStatus(status));
  const completedByStatus = trayStatuses.length > 0 && trayStatuses.every((status) => COMPLETED_STATUSES.has(normalizeExperimentStatusLabel(status)) || isExperimentCompletedStatus(status));

  return {
    completed: completedByStatus,
    started: startedByStatus,
    trayStatuses,
  };
};

const buildScheduleExceptionDetail = (schedule, experiments, now) => {
  const experimentCode = normalizeText(schedule?.experiment_code);
  const taskCode = normalizeText(schedule?.task_code);
  const experimentName = asArray(experiments).find(
    (entry) =>
      normalizeText(entry?.task_code) === taskCode &&
      normalizeText(entry?.experiment_code) === experimentCode,
  )?.experiment_name;
  return [
    taskCode || "-",
    normalizeText(experimentName) || experimentCode || "-",
    normalizeText(schedule?.device) || "-",
    `${formatDateTime(schedule?.start_at)} - ${formatDateTime(schedule?.end_at)}`.trim(),
    `触发时间：${formatDateTime(formatLocalDateTime(now))}`,
  ].join(" / ");
};

const buildExceptionId = (scheduleId) => `schedule-exception-${scheduleId || Date.now()}`;

function reconcileScheduleExceptions(snapshot = {}, options = {}) {
  const now = parseDate(options.now) || new Date();
  const working = cloneSnapshotArrays(snapshot);
  const schedules = working[STORAGE_KEYS.schedules];
  const tasks = working[STORAGE_KEYS.tasks];
  const experiments = working[STORAGE_KEYS.experiments];
  const samples = working[STORAGE_KEYS.samples];
  const experimentTrays = working[STORAGE_KEYS.experiment_trays];
  const conflicts = working[STORAGE_KEYS.conflicts];
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const taskByCode = new Map(tasks.map((task) => [normalizeText(task?.code || task?.task_code), task]));
  const samplesByTaskCode = new Map();
  samples.forEach((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    if (!taskCode) {
      return;
    }
    samplesByTaskCode.set(taskCode, [...(samplesByTaskCode.get(taskCode) || []), sample]);
  });

  const expiredUnstartedSchedules = schedules.filter((schedule) => {
    if (isRetentionDevice(schedule)) {
      return false;
    }
    const endAt = parseDate(schedule?.end_at);
    if (!endAt || endAt.getTime() >= now.getTime()) {
      return false;
    }
    const lifecycle = resolveScheduleLifecycle({ experimentTrayMap, trayExperimentCodeMap, experimentNameByCode, samples, schedule });
    return !lifecycle.started;
  });

  if (expiredUnstartedSchedules.length === 0) {
    return {
      changed: false,
      snapshot: {
        ...snapshot,
        ...working,
      },
      updates: {},
    };
  }

  const removedScheduleIds = new Set(expiredUnstartedSchedules.map((schedule) => normalizeText(schedule?.id)).filter(Boolean));
  const removedExperiments = new Set(
    expiredUnstartedSchedules.map((schedule) => `${normalizeText(schedule?.task_code)}::${normalizeText(schedule?.experiment_code)}`),
  );
  const nextSchedules = schedules.filter((schedule) => !removedScheduleIds.has(normalizeText(schedule?.id)));
  const nextExperiments = experiments.map((experiment) => {
    const key = `${normalizeText(experiment?.task_code)}::${normalizeText(experiment?.experiment_code)}`;
    if (!removedExperiments.has(key)) {
      return experiment;
    }
    const taskCode = normalizeText(experiment?.task_code);
    const confirmedAt = resolveTransferConfirmedAt({
      samples: samplesByTaskCode.get(taskCode),
      task: taskByCode.get(taskCode),
    });
    const unscheduledSince = confirmedAt ? formatLocalDateTime(confirmedAt) : "";
    return {
      ...experiment,
      status: STATUS_WAITING,
      unscheduled_since: unscheduledSince,
      updated_at: formatLocalDateTime(now),
    };
  });
  const nextConflicts = conflicts.slice();

  expiredUnstartedSchedules.forEach((schedule) => {
    const scheduleId = normalizeText(schedule?.id);
    const duplicated = nextConflicts.some(
      (entry) =>
        normalizeText(entry?.type) === SCHEDULE_EXCEPTION_TYPE &&
        normalizeText(entry?.schedule_id) === scheduleId &&
        normalizeText(entry?.status) === "pending",
    );
    if (duplicated) {
      return;
    }
    nextConflicts.push({
      acknowledged_at: "",
      created_at: formatLocalDateTime(now),
      detail: buildScheduleExceptionDetail(schedule, nextExperiments, now),
      device: normalizeText(schedule?.device),
      experiment_code: normalizeText(schedule?.experiment_code),
      id: buildExceptionId(scheduleId),
      reason: SCHEDULE_EXCEPTION_REASON,
      schedule_id: scheduleId,
      status: "pending",
      task_code: normalizeText(schedule?.task_code),
      type: SCHEDULE_EXCEPTION_TYPE,
    });
  });

  const nextTasks = tasks.map((task) => ({
    ...task,
    status: resolveTaskStatus(task, nextSchedules, samples, now, experimentTrays),
  }));

  const nextSnapshot = {
    ...snapshot,
    [STORAGE_KEYS.conflicts]: nextConflicts,
    [STORAGE_KEYS.experiments]: nextExperiments,
    [STORAGE_KEYS.experiment_trays]: experimentTrays,
    [STORAGE_KEYS.samples]: samples,
    [STORAGE_KEYS.schedules]: nextSchedules,
    [STORAGE_KEYS.tasks]: nextTasks,
  };

  return {
    changed: true,
    snapshot: nextSnapshot,
    updates: {
      [STORAGE_KEYS.conflicts]: nextConflicts,
      [STORAGE_KEYS.experiments]: nextExperiments,
      [STORAGE_KEYS.schedules]: nextSchedules,
      [STORAGE_KEYS.tasks]: nextTasks,
    },
  };
}

export { reconcileScheduleExceptions, SCHEDULE_EXCEPTION_REASON, SCHEDULE_EXCEPTION_TYPE };
