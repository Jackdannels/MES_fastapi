import { STORAGE_KEYS } from "./storageKeys";
import { resolveTransferConfirmedAt } from "./transferArrivalTime";
import { formatLocalDateTime } from "./dateTime";
import { serverNowDate } from "./serverClock";
import { normalizeAxisCodes } from "./axisCodes";
import { labIdentityMatches } from "./labIdentity";
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
  "已到达实验室",
  "工装夹具安装",
  "实验准备就绪",
  "实验后暂存间存放",
  "送至外观检测间",
  "实验后外观检测间存放",
  RETURNED_STATUS,
]);
const ACTIVE_LAB_PROGRESS_STATUSES = new Set([
  EXPERIMENT_STATUS_RUNNING,
  "已到达实验室",
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
const SCHEDULE_DELAY_EXCEPTION_TYPE = "schedule_delayed_by_active_run";
const SCHEDULE_DELAY_EXCEPTION_REASON = "受前序实验超时影响，等待预计结束";

const asArray = (value) => (Array.isArray(value) ? value : []);

const parseDate = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
};

const cloneSnapshotArrays = (snapshot = {}) => ({
  [STORAGE_KEYS.conflicts]: asArray(snapshot[STORAGE_KEYS.conflicts]).map((entry) => ({ ...entry })),
  [STORAGE_KEYS.experiments]: asArray(snapshot[STORAGE_KEYS.experiments]).map((entry) => ({ ...entry })),
  [STORAGE_KEYS.experiment_runs]: asArray(snapshot[STORAGE_KEYS.experiment_runs]).map((entry) => ({ ...entry })),
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
  normalizeText(
    row?.sub_experiment_code
      ?? row?.subExperimentCode
      ?? row?.sub_experiment_no
      ?? row?.subExperimentNo
      ?? row?.target_sub_experiment_code
      ?? row?.targetSubExperimentCode,
  );
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

const runIdentifier = (run) => normalizeText(run?.run_no ?? run?.runNo ?? run?.id);

const isActiveExperimentRun = (run) =>
  isExperimentRunningStatus(run?.status ?? run?.run_status ?? run?.runStatus);

const runScheduleIdentifier = (run) => normalizeText(
  run?.schedule_id ?? run?.scheduleId ?? run?.schedule_no ?? run?.scheduleNo,
);

const runPrecedesSchedule = (run, schedule, schedules) => {
  const currentSchedule = asArray(schedules).find(
    (entry) => scheduleIdentifier(entry) === runScheduleIdentifier(run),
  );
  const targetStart = parseDate(schedule?.original_start_at ?? schedule?.originalStartAt ?? schedule?.start_at ?? schedule?.startAt);
  const currentStart = parseDate(
    currentSchedule?.original_start_at
      ?? currentSchedule?.originalStartAt
      ?? currentSchedule?.start_at
      ?? currentSchedule?.startAt
      ?? run?.started_at
      ?? run?.startedAt,
  );
  if (currentStart && targetStart) {
    return currentStart.getTime() <= targetStart.getTime();
  }
  const runStartedAt = parseDate(run?.started_at ?? run?.startedAt);
  const targetEnd = parseDate(schedule?.end_at ?? schedule?.endAt);
  return Boolean(runStartedAt && targetEnd && runStartedAt.getTime() <= targetEnd.getTime());
};

const runIsOverdueForSchedule = (run, schedule, schedules, now) => {
  const currentSchedule = asArray(schedules).find(
    (entry) => scheduleIdentifier(entry) === runScheduleIdentifier(run),
  );
  const expectedEnd = parseDate(
    run?.planned_end_at
      ?? run?.plannedEndAt
      ?? currentSchedule?.end_at
      ?? currentSchedule?.endAt,
  );
  if (expectedEnd) {
    return expectedEnd.getTime() < now.getTime();
  }
  const targetStart = parseDate(schedule?.start_at ?? schedule?.startAt);
  return Boolean(targetStart && targetStart.getTime() <= now.getTime());
};

const findBlockingActiveRun = (schedule, experimentRuns, schedules, now) =>
  asArray(experimentRuns).find(
    (run) => isActiveExperimentRun(run)
      && labIdentityMatches(run, schedule)
      && runPrecedesSchedule(run, schedule, schedules)
      && runIsOverdueForSchedule(run, schedule, schedules, now),
  ) || null;

const buildScheduleDelayExceptionDetail = (schedule, experiments, run, now) => {
  const baseDetail = buildScheduleExceptionDetail(schedule, experiments, now);
  const runNo = runIdentifier(run);
  const plannedEndAt = formatDateTime(run?.planned_end_at ?? run?.plannedEndAt);
  return [
    baseDetail,
    runNo ? `前序运行：${runNo}` : "",
    `预计结束：${plannedEndAt || "等待设备或操作员确认"}`,
  ].filter(Boolean).join(" / ");
};

const scheduleHasWaitingMetadata = (schedule, run) =>
  normalizeText(schedule?.delay_reason ?? schedule?.delayReason) === SCHEDULE_DELAY_EXCEPTION_REASON
  && normalizeText(
    schedule?.source_run_no
      ?? schedule?.sourceRunNo
      ?? schedule?.delay_source_run_no
      ?? schedule?.delaySourceRunNo,
  ) === runIdentifier(run);

const withWaitingMetadata = (schedule, run) => ({
  ...schedule,
  delay_minutes: Number(schedule?.delay_minutes ?? schedule?.delayMinutes) || 0,
  delay_reason: SCHEDULE_DELAY_EXCEPTION_REASON,
  original_end_at: schedule?.original_end_at || schedule?.originalEndAt || schedule?.end_at || schedule?.endAt,
  original_start_at: schedule?.original_start_at || schedule?.originalStartAt || schedule?.start_at || schedule?.startAt,
  source_run_no: runIdentifier(run),
  delay_status: "waiting_active_run_end",
  delay_waiting_for_estimated_end: true,
});

function reconcileScheduleExceptions(snapshot = {}, options = {}) {
  const now = parseDate(options.now) || serverNowDate();
  const working = cloneSnapshotArrays(snapshot);
  const schedules = working[STORAGE_KEYS.schedules];
  const tasks = working[STORAGE_KEYS.tasks];
  const experiments = working[STORAGE_KEYS.experiments];
  const experimentRuns = working[STORAGE_KEYS.experiment_runs];
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

  const allUnstartedSchedules = schedules.filter((schedule) => {
    if (isRetentionDevice(schedule)) {
      return false;
    }
    const lifecycle = resolveScheduleLifecycle({ experimentTrayMap, trayExperimentCodeMap, experimentNameByCode, samples, schedule });
    return !lifecycle.started;
  });

  const blockedScheduleRuns = new Map();
  allUnstartedSchedules.forEach((schedule) => {
    const blockingRun = findBlockingActiveRun(schedule, experimentRuns, schedules, now);
    if (blockingRun) {
      blockedScheduleRuns.set(scheduleIdentifier(schedule), blockingRun);
    }
  });
  const expiredUnstartedSchedules = allUnstartedSchedules.filter((schedule) => {
    const endAt = parseDate(schedule?.end_at);
    return endAt
      && endAt.getTime() < now.getTime()
      && !blockedScheduleRuns.has(scheduleIdentifier(schedule));
  });

  if (expiredUnstartedSchedules.length === 0 && blockedScheduleRuns.size === 0) {
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
  let scheduleMetadataChanged = false;
  const nextSchedules = schedules
    .filter((schedule) => !removedScheduleIds.has(normalizeText(schedule?.id)))
    .map((schedule) => {
      const blockingRun = blockedScheduleRuns.get(scheduleIdentifier(schedule));
      if (!blockingRun || scheduleHasWaitingMetadata(schedule, blockingRun)) {
        return schedule;
      }
      scheduleMetadataChanged = true;
      return withWaitingMetadata(schedule, blockingRun);
    });
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
  let conflictsChanged = false;

  blockedScheduleRuns.forEach((blockingRun, scheduleId) => {
    const runNo = runIdentifier(blockingRun);
    const duplicated = nextConflicts.some(
      (entry) =>
        normalizeText(entry?.type) === SCHEDULE_DELAY_EXCEPTION_TYPE
        && normalizeText(entry?.schedule_id) === scheduleId
        && normalizeText(entry?.source_run_no) === runNo,
    );
    if (duplicated) {
      return;
    }
    const schedule = schedules.find((entry) => scheduleIdentifier(entry) === scheduleId);
    if (!schedule) {
      return;
    }
    nextConflicts.push({
      acknowledged_at: "",
      created_at: formatLocalDateTime(now),
      detail: buildScheduleDelayExceptionDetail(schedule, experiments, blockingRun, now),
      device: normalizeText(schedule?.device),
      experiment_code: normalizeText(schedule?.experiment_code),
      id: `schedule-delay-exception-${scheduleId}-${runNo || "active-run"}`,
      reason: SCHEDULE_DELAY_EXCEPTION_REASON,
      schedule_id: scheduleId,
      source_run_no: runNo,
      status: "pending",
      task_code: normalizeText(schedule?.task_code),
      type: SCHEDULE_DELAY_EXCEPTION_TYPE,
    });
    conflictsChanged = true;
  });

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
    conflictsChanged = true;
  });

  const nextTasks = tasks.map((task) => ({
    ...task,
    status: resolveTaskStatus(task, nextSchedules, samples, now, experimentTrays),
  }));

  const nextSnapshot = {
    ...snapshot,
    [STORAGE_KEYS.conflicts]: nextConflicts,
    [STORAGE_KEYS.experiments]: nextExperiments,
    [STORAGE_KEYS.experiment_runs]: experimentRuns,
    [STORAGE_KEYS.experiment_trays]: experimentTrays,
    [STORAGE_KEYS.samples]: samples,
    [STORAGE_KEYS.schedules]: nextSchedules,
    [STORAGE_KEYS.tasks]: nextTasks,
  };

  return {
    changed: expiredUnstartedSchedules.length > 0 || scheduleMetadataChanged || conflictsChanged,
    snapshot: nextSnapshot,
    updates: {
      ...(conflictsChanged ? { [STORAGE_KEYS.conflicts]: nextConflicts } : {}),
      ...(expiredUnstartedSchedules.length > 0 ? {
        [STORAGE_KEYS.experiments]: nextExperiments,
        [STORAGE_KEYS.tasks]: nextTasks,
      } : {}),
      ...(expiredUnstartedSchedules.length > 0 || scheduleMetadataChanged
        ? { [STORAGE_KEYS.schedules]: nextSchedules }
        : {}),
    },
  };
}

export {
  reconcileScheduleExceptions,
  SCHEDULE_DELAY_EXCEPTION_REASON,
  SCHEDULE_DELAY_EXCEPTION_TYPE,
  SCHEDULE_EXCEPTION_REASON,
  SCHEDULE_EXCEPTION_TYPE,
};
