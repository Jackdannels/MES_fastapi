import { STORAGE_KEYS } from "./storageKeys";
import { formatDateTime, isRetentionDevice, normalizeText, resolveTaskStatus, STATUS_WAITING } from "@/modules/schedule/model";

const RUNNING_STATUSES = new Set(["实验进行中", "实验中"]);
const STARTED_STATUSES = new Set(["实验进行中", "实验中", "实验已完成", "实验完成", "放置实验后暂存间", "厂家收回"]);
const COMPLETED_STATUSES = new Set(["实验已完成", "实验完成", "放置实验后暂存间", "厂家收回"]);

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

  return asArray(samples).filter((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
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
  const experimentName = normalizeText(experimentNameByCode.get(experimentCode));
  const latestHistoryBySample = new Map();

  matchedSamples.forEach((sample) => {
    asArray(sample?.history).forEach((entry) => {
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
      const trayStatus = normalizeText(tray?.status) || normalizeText(sample?.status);
      if (trayStatus) {
        trayStatuses.push(trayStatus);
      }
    });
  });

  if (latestHistoryBySample.size > 0) {
    const historyStatuses = Array.from(latestHistoryBySample.values()).map((entry) => entry.status);
    return {
      completed: matchedSamples.length > 0 && latestHistoryBySample.size === matchedSamples.length && historyStatuses.every((status) => COMPLETED_STATUSES.has(status)),
      started: historyStatuses.some((status) => STARTED_STATUSES.has(status)),
      trayStatuses,
    };
  }

  const hasSharedScopedTray = Array.from(scopedTrayCodes).some((trayCode) => (trayExperimentCodeMap.get(trayCode)?.size || 0) > 1);
  if (hasSharedScopedTray) {
    return {
      completed: false,
      started: false,
      trayStatuses,
    };
  }

  const startedByStatus = trayStatuses.some((status) => STARTED_STATUSES.has(status));
  const completedByStatus = trayStatuses.length > 0 && trayStatuses.every((status) => COMPLETED_STATUSES.has(status));

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
    `触发时间：${formatDateTime(now.toISOString())}`,
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

  const expiredUnstartedSchedules = schedules.filter((schedule) => {
    if (isRetentionDevice(schedule?.device)) {
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
    return {
      ...experiment,
      status: STATUS_WAITING,
      unscheduled_since: now.toISOString(),
      updated_at: now.toISOString(),
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
      created_at: now.toISOString(),
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
