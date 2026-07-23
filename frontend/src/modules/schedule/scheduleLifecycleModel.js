import { getLabsForTestType, TEST_LABS, TEST_PREFIX_MAP } from "@/lib/labs.js";
import { normalizeAxisCodes } from "@/lib/axisCodes";
import { serverNowDate } from "@/lib/serverClock";
import {
  RETENTION_KEYWORD,
  formatDateTime,
  getSlotState,
  isRetentionDevice,
  normalizeText,
  parseDate,
} from "./sharedModel";
import {
  COMPLETED_SCHEDULE_STATUSES,
  COMPLETED_TRAY_STATUSES,
  STARTED_TRAY_STATUSES,
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
  buildAxisExperimentLabel,
  buildExperimentCandidates,
  buildExperimentLabel,
  resolveSubExperimentCode,
} from "./scheduleFoundationModel";


const SLOT_SEQUENCE = ["am", "pm"];
const resolveScheduleTaskStatusArgs = (samplesOrNow, nowMaybe, experimentTraysMaybe) => {
  if (Array.isArray(samplesOrNow)) {
    return {
      experimentTrays: Array.isArray(experimentTraysMaybe) ? experimentTraysMaybe : [],
      now: parseDate(nowMaybe) || serverNowDate(),
      samples: samplesOrNow,
    };
  }

  if (samplesOrNow instanceof Date || typeof samplesOrNow === "number" || typeof samplesOrNow === "string") {
    return {
      experimentTrays: Array.isArray(nowMaybe) ? nowMaybe : [],
      now: parseDate(samplesOrNow) || serverNowDate(),
      samples: [],
    };
  }

  return {
    experimentTrays: Array.isArray(experimentTraysMaybe) ? experimentTraysMaybe : [],
    now: parseDate(nowMaybe) || serverNowDate(),
    samples: [],
  };
};

// 推导看板行和留样视图共用的任务状态。
function resolveTaskStatus(taskOrTaskCode, schedules, samplesOrNow, nowMaybe, experimentTraysMaybe) {
  const { samples, now, experimentTrays } = resolveScheduleTaskStatusArgs(samplesOrNow, nowMaybe, experimentTraysMaybe);
  const taskCode =
    typeof taskOrTaskCode === "object" && taskOrTaskCode !== null
      ? normalizeText(taskOrTaskCode?.code)
      : normalizeText(taskOrTaskCode);
  const rawStatus =
    typeof taskOrTaskCode === "object" && taskOrTaskCode !== null
      ? normalizeText(taskOrTaskCode?.status)
      : "";
  const related = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => normalizeText(schedule?.task_code) === taskCode,
  );

  if (rawStatus === STATUS_RUNNING) {
    return STATUS_RUNNING;
  }
  if (rawStatus === STATUS_COMPLETED) {
    return STATUS_COMPLETED;
  }

  const labSchedules = related.filter((schedule) => !isRetentionDevice(schedule));
  const retentionSchedules = related.filter((schedule) => isRetentionDevice(schedule));
  const currentTime = now.getTime();
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const lifecycleStates = labSchedules.map((schedule) => resolveScheduleLifecycleState({ schedule, samples, experimentTrayMap }));

  if (lifecycleStates.some((state) => state.started)) {
    if (lifecycleStates.every((state) => state.completed)) {
      return STATUS_COMPLETED;
    }
    return STATUS_RUNNING;
  }

  // 当前时间命中排程窗口也只能说明任务已进入排程窗口，不能自动说明已经开始实验。
  const activeLab = labSchedules.find((schedule) => {
    const start = parseDate(schedule?.start_at);
    const end = parseDate(schedule?.end_at);
    return start && end && start.getTime() <= currentTime && end.getTime() >= currentTime;
  });
  if (activeLab) {
    return STATUS_SCHEDULED;
  }

  // 其次判断是否存在未来或尚未结束的正式实验排程。
  const futureLab = labSchedules.find((schedule) => {
    const end = parseDate(schedule?.end_at);
    return end && end.getTime() > currentTime;
  });
  if (futureLab) {
    return STATUS_SCHEDULED;
  }

  if (retentionSchedules.length > 0) {
    return STATUS_RETENTION;
  }

  return STATUS_WAITING;
}

const statusClass = (status) => {
  if (status === STATUS_RUNNING) {
    return "status running";
  }
  if (status === STATUS_SCHEDULED) {
    return "status scheduled";
  }
  if (status === STATUS_RETENTION) {
    return "status retention";
  }
  if (status === STATUS_COMPLETED) {
    return "status completed";
  }
  return "status";
};

const sortTextList = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => normalizeText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN"),
  );

const DEFAULT_TASK_COLOR = "#1d4ed8";

const getMasterLabName = (lab) =>
  normalizeText(lab?.name || lab?.labName || lab?.lab_name || lab?.code || lab?.labCode || lab?.lab_code);

const getMasterLabType = (lab) => normalizeText(lab?.type || lab?.labType || lab?.lab_type);

const getMasterLabTestTypeKeys = (lab) =>
  [
    lab?.testTypeName,
    lab?.test_type_name,
    lab?.testType,
    lab?.test_type,
    lab?.testTypeCode,
    lab?.test_type_code,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean);

const FORMAL_TEST_TYPE_KEYS = new Set(
  Object.entries(TEST_PREFIX_MAP).flatMap(([testTypeName, testTypeCode]) => [testTypeName, testTypeCode]),
);

const isMasterLabEnabled = (lab) => ![0, "0", false].includes(lab?.status);

const isMasterLabCandidate = (lab) => {
  const name = getMasterLabName(lab);
  const labType = getMasterLabType(lab).toLowerCase();
  const hasFormalTestType = getMasterLabTestTypeKeys(lab).some((key) => FORMAL_TEST_TYPE_KEYS.has(key));
  return (
    Boolean(name) &&
    hasFormalTestType &&
    !isRetentionDevice(name) &&
    !["retention", "staging"].some((keyword) => labType.includes(keyword)) &&
    !labType.includes(RETENTION_KEYWORD)
  );
};

const getMasterLabCandidates = (masterLabs) =>
  (Array.isArray(masterLabs) ? masterLabs : []).filter((lab) => isMasterLabEnabled(lab) && isMasterLabCandidate(lab));

const resolveMasterLabCandidates = (value, masterLabs) => {
  const normalizedValue = normalizeText(value);
  const labs = getMasterLabCandidates(masterLabs);
  if (!normalizedValue || labs.length === 0) {
    return [];
  }
  if (labs.some((lab) => getMasterLabName(lab) === normalizedValue)) {
    return [normalizedValue];
  }
  const matchedLabs = labs
    .filter((lab) => getMasterLabTestTypeKeys(lab).includes(normalizedValue))
    .map((lab) => getMasterLabName(lab));
  return Array.from(new Set(matchedLabs));
};

const getMasterLabNames = (masterLabs) =>
  Array.from(
    new Set(
      getMasterLabCandidates(masterLabs)
        .filter((lab) => getMasterLabTestTypeKeys(lab).length > 0)
        .map((lab) => getMasterLabName(lab)),
    ),
  );

const resolveLabCandidates = (value, masterLabs = []) => {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return [];
  }
  const masterLabCandidates = resolveMasterLabCandidates(normalizedValue, masterLabs);
  if (masterLabCandidates.length > 0) {
    return masterLabCandidates;
  }
  if (TEST_LABS.includes(normalizedValue)) {
    return [normalizedValue];
  }
  return getLabsForTestType(normalizedValue).filter((lab) => !isRetentionDevice(lab));
};

const hashText = (value) => {
  const text = normalizeText(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const resolveTaskColor = (taskCode) => {
  const normalizedTaskCode = normalizeText(taskCode);
  if (!normalizedTaskCode) {
    return DEFAULT_TASK_COLOR;
  }
  const hash = hashText(normalizedTaskCode);
  const hue = (hash * 137) % 360;
  const saturation = 74 + (hash % 8);
  const lightness = 36 + ((hash >>> 3) % 7);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
};

const buildSelectedTaskLabSet = ({ selectedTaskCode, experiments, schedules, tasks, masterLabs = [] }) => {
  const normalizedTaskCode = normalizeText(selectedTaskCode);
  if (!normalizedTaskCode) {
    return null;
  }

  const labs = new Set();
  buildExperimentCandidates({ taskCode: normalizedTaskCode, experiments, tasks })
    .forEach((experiment) => {
      resolveLabCandidates(experiment?.required_device, masterLabs).forEach((lab) => labs.add(lab));
    });

  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    if (normalizeText(schedule?.task_code) !== normalizedTaskCode) {
      return;
    }
    const device = normalizeText(schedule?.device);
    if (device && !isRetentionDevice(device)) {
      labs.add(device);
    }
  });

  return labs;
};

const hasScheduleOverlap = (schedules) => {
  const sortedSchedules = [...(Array.isArray(schedules) ? schedules : [])].sort((left, right) => {
    const leftTime = parseDate(left?.start_at)?.getTime() || 0;
    const rightTime = parseDate(right?.start_at)?.getTime() || 0;
    return leftTime - rightTime;
  });

  for (let index = 1; index < sortedSchedules.length; index += 1) {
    const previousEnd = parseDate(sortedSchedules[index - 1]?.end_at);
    const currentStart = parseDate(sortedSchedules[index]?.start_at);
    if (previousEnd && currentStart && previousEnd > currentStart) {
      return true;
    }
  }
  return false;
};

const buildSlotTaskItems = ({ matchedSchedules, now, experimentNameByCode }) => {
  const sortedSchedules = [...matchedSchedules].sort((left, right) => {
    const leftTime = parseDate(left?.start_at)?.getTime() || 0;
    const rightTime = parseDate(right?.start_at)?.getTime() || 0;
    return leftTime - rightTime;
  });

  const items = [];
  const byTaskCode = new Map();

  sortedSchedules.forEach((schedule) => {
    const taskCode = normalizeText(schedule?.task_code);
    if (!taskCode) {
      return;
    }
    const experimentCode = normalizeText(schedule?.experiment_code);
    const axisCodes = normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes);
    const subExperimentCode = resolveSubExperimentCode(schedule);
    const groupKey = subExperimentCode || (axisCodes.length > 0 ? `${taskCode}::${experimentCode}::${axisCodes.join("/")}` : taskCode);
    const current = byTaskCode.get(groupKey);
    const startAt = parseDate(schedule?.start_at);
    const endAt = parseDate(schedule?.end_at);
    const stateMeta = getSlotState({ startAt, endAt, now });
    if (!current) {
      const experimentLabel = buildAxisExperimentLabel(
        experimentNameByCode?.get(experimentCode) || buildExperimentLabel(experimentCode),
        axisCodes,
      );
      const timeRange = formatScheduleWindow(schedule?.start_at, schedule?.end_at);
      const nextItem = {
        color: resolveTaskColor(taskCode),
        experimentLabel,
        scheduleId: normalizeText(schedule?.id),
        scheduleIds: [normalizeText(schedule?.id)].filter(Boolean),
        state: stateMeta.state,
        subExperimentCode,
        sub_experiment_code: subExperimentCode,
        taskCode,
        timeRange,
        title: `${taskCode} / ${experimentLabel || "-"} / ${timeRange}`.trim(),
      };
      byTaskCode.set(groupKey, nextItem);
      items.push(nextItem);
      return;
    }

    const scheduleId = normalizeText(schedule?.id);
    if (scheduleId && !current.scheduleIds.includes(scheduleId)) {
      current.scheduleIds.push(scheduleId);
    }
    if (current.state !== "running" && stateMeta.state === "running") {
      current.state = "running";
    } else if (current.state === "completed" && stateMeta.state === "busy") {
      current.state = "busy";
    }
  });

  return items;
};

const mergeUniqueTextList = (values) => {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map(normalizeText)
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
};

const mergeGanttItems = (leftItems = [], rightItems = []) => {
  const result = [];
  const seen = new Set();
  [...(Array.isArray(leftItems) ? leftItems : []), ...(Array.isArray(rightItems) ? rightItems : [])].forEach((item) => {
    const itemScheduleIds = Array.isArray(item?.scheduleIds) ? item.scheduleIds : [item?.scheduleId].filter(Boolean);
    const key = itemScheduleIds.join("\u0001") || normalizeText(item?.title);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(item);
  });
  return result;
};

const collectGanttScheduleIds = (items = []) =>
  mergeUniqueTextList((Array.isArray(items) ? items : []).flatMap((item) =>
    Array.isArray(item?.scheduleIds) ? item.scheduleIds : [item?.scheduleId],
  ));

const buildExperimentNameMap = (experiments) =>
  new Map(
    (Array.isArray(experiments) ? experiments : []).map((experiment) => [
      normalizeText(experiment?.experiment_code),
      resolveExperimentTypeLabel(experiment),
    ]),
  );

const isLikelyLabDestination = (value) => /室$/.test(normalizeText(value));

const resolveExperimentTypeLabel = (experiment) => {
  const explicitType =
    normalizeText(experiment?.experiment_type)
    || normalizeText(experiment?.experimentType)
    || normalizeText(experiment?.test_type)
    || normalizeText(experiment?.testType);
  if (explicitType) {
    return explicitType;
  }
  const requiredDevice = normalizeText(experiment?.required_device) || normalizeText(experiment?.requiredDevice);
  if (requiredDevice && !isLikelyLabDestination(requiredDevice)) {
    return requiredDevice;
  }
  return normalizeText(experiment?.experiment_name)
    || normalizeText(experiment?.experimentName)
    || normalizeText(experiment?.name)
    || requiredDevice;
};

const formatScheduleWindow = (startAt, endAt) => {
  const startLabel = formatDateTime(startAt);
  const endLabel = formatDateTime(endAt);
  return startLabel && endLabel ? `${startLabel} - ${endLabel}` : "";
};

const buildExperimentTrayMap = (experimentTrays) => {
  const trayMap = new Map();
  (Array.isArray(experimentTrays) ? experimentTrays : []).forEach((entry) => {
    const taskCode = normalizeText(entry?.task_code || entry?.taskCode);
    const experimentCode = normalizeText(entry?.experiment_code || entry?.experimentCode);
    const trayCode = normalizeText(entry?.tray_code || entry?.trayCode);
    if (!taskCode || !experimentCode || !trayCode) {
      return;
    }
    const key = `${taskCode}::${experimentCode}`;
    const trays = trayMap.get(key) || [];
    trays.push(trayCode);
    trayMap.set(key, trays);
  });
  return trayMap;
};

const buildTrayExperimentCodeMap = (experimentTrays) => {
  const trayMap = new Map();
  (Array.isArray(experimentTrays) ? experimentTrays : []).forEach((entry) => {
    const taskCode = normalizeText(entry?.task_code || entry?.taskCode);
    const trayCode = normalizeText(entry?.tray_code || entry?.trayCode);
    const experimentCode = normalizeText(entry?.experiment_code || entry?.experimentCode);
    if (!taskCode || !trayCode || !experimentCode) {
      return;
    }
    const key = `${taskCode}::${trayCode}`;
    const current = trayMap.get(key) || new Set();
    current.add(experimentCode);
    trayMap.set(key, current);
  });
  return trayMap;
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

const collectScheduleMatchedSamples = ({ schedule, samples, experimentTrayMap }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scopedTrayCodes = new Set(experimentTrayMap.get(`${taskCode}::${experimentCode}`) || []);
  const matchedSamples = (Array.isArray(samples) ? samples : []).filter((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
    }
    if (scopedTrayCodes.size === 0) {
      return true;
    }
    return (Array.isArray(sample?.trays) ? sample.trays : []).some((tray) => scopedTrayCodes.has(normalizeText(tray?.tray_code)));
  });
  return {
    experimentCode,
    matchedSamples,
    scopedTrayCodes,
    taskCode,
  };
};

const collectScheduleTrayStatuses = ({ schedule, samples, experimentTrayMap }) => {
  const { matchedSamples, scopedTrayCodes } = collectScheduleMatchedSamples({ schedule, samples, experimentTrayMap });
  const statuses = [];

  matchedSamples.forEach((sample) => {
    const trays = Array.isArray(sample?.trays) ? sample.trays : [];
    if (trays.length === 0 && scopedTrayCodes.size === 0) {
      const sampleStatus = normalizeText(sample?.status);
      if (sampleStatus) {
        statuses.push(sampleStatus);
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
        statuses.push(trayStatus);
      }
    });
  });

  return statuses;
};

const resolveScheduleLifecycleState = ({
  schedule,
  samples,
  experimentTrayMap,
  experimentNameByCode = new Map(),
  trayExperimentCodeMap = new Map(),
}) => {
  if (COMPLETED_SCHEDULE_STATUSES.has(normalizeText(schedule?.status ?? schedule?.schedule_status))) {
    return {
      completed: true,
      started: true,
    };
  }

  const { matchedSamples, scopedTrayCodes, taskCode, experimentCode } = collectScheduleMatchedSamples({
    schedule,
    samples,
    experimentTrayMap,
  });
  const experimentName =
    normalizeText(schedule?.experiment_name)
    || normalizeText(experimentNameByCode.get(experimentCode));
  const latestHistoryBySample = new Map();

  if (experimentName) {
    matchedSamples.forEach((sample) => {
      const sampleCode = normalizeText(sample?.code);
      if (!sampleCode) {
        return;
      }
      (Array.isArray(sample?.history) ? sample.history : []).forEach((entry) => {
        const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
        if (!parsed || parsed.experimentName !== experimentName) {
          return;
        }
        const eventTime = parseDate(entry?.time)?.getTime() || 0;
        const existing = latestHistoryBySample.get(sampleCode);
        if (!existing || eventTime >= existing.time) {
          latestHistoryBySample.set(sampleCode, { status: parsed.status, time: eventTime });
        }
      });
    });
  }

  if (latestHistoryBySample.size > 0) {
    const historyStatuses = Array.from(latestHistoryBySample.values()).map((entry) => entry.status);
    return {
      completed: matchedSamples.length > 0 && latestHistoryBySample.size === matchedSamples.length && historyStatuses.every((status) => COMPLETED_TRAY_STATUSES.has(status)),
      started: historyStatuses.some((status) => STARTED_TRAY_STATUSES.has(status)),
    };
  }

  const trayStatuses = collectScheduleTrayStatuses({ schedule, samples, experimentTrayMap });
  const hasSharedScopedTray = Array.from(scopedTrayCodes).some((trayCode) => (trayExperimentCodeMap.get(`${taskCode}::${trayCode}`)?.size || 0) > 1);
  if (hasSharedScopedTray) {
    return {
      completed: false,
      started: false,
    };
  }
  return {
    completed: trayStatuses.length > 0 && trayStatuses.every((status) => COMPLETED_TRAY_STATUSES.has(status)),
    started: trayStatuses.some((status) => STARTED_TRAY_STATUSES.has(status)),
  };
};

const resolveScheduleRowStatus = ({
  schedule,
  samples,
  now,
  experimentTrayMap,
  experimentNameByCode = new Map(),
  trayExperimentCodeMap = new Map(),
}) => {
  const lifecycleState = resolveScheduleLifecycleState({
    schedule,
    samples,
    experimentTrayMap,
    experimentNameByCode,
    trayExperimentCodeMap,
  });
  if (lifecycleState.started) {
    return lifecycleState.completed ? STATUS_COMPLETED : STATUS_RUNNING;
  }

  if (isRetentionDevice(schedule)) {
    return STATUS_RETENTION;
  }

  const currentTime = now.getTime();
  const startAt = parseDate(schedule?.start_at);
  const endAt = parseDate(schedule?.end_at);
  if (startAt && endAt && startAt.getTime() <= currentTime && endAt.getTime() >= currentTime) {
    return STATUS_SCHEDULED;
  }
  if (endAt && endAt.getTime() > currentTime) {
    return STATUS_SCHEDULED;
  }
  return STATUS_WAITING;
};

const scheduleIsCompleted = ({
  experimentNameByCode = new Map(),
  experimentTrayMap,
  samples,
  schedule,
  trayExperimentCodeMap = new Map(),
}) =>
  resolveScheduleLifecycleState({
    experimentNameByCode,
    experimentTrayMap,
    samples,
    schedule,
    trayExperimentCodeMap,
  }).completed;

const taskHasSavedTrayPlan = ({ task, samples, experimentTrays }) => {
  const taskCode = normalizeText(task?.code);
  if (!taskCode) {
    return false;
  }

  const taskTrayCodes = Array.isArray(task?.tray_codes)
    ? task.tray_codes.map((trayCode) => normalizeText(trayCode)).filter(Boolean)
    : [];
  if (taskTrayCodes.length > 0) {
    return true;
  }

  const sampleHasTray = (Array.isArray(samples) ? samples : []).some((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
    }
    const trays = Array.isArray(sample?.trays)
      ? sample.trays.map((trayCode) => normalizeText(trayCode)).filter(Boolean)
      : [];
    return trays.length > 0;
  });
  if (sampleHasTray) {
    return true;
  }

  return (Array.isArray(experimentTrays) ? experimentTrays : []).some(
    (entry) =>
      normalizeText(entry?.task_code) === taskCode &&
      normalizeText(entry?.tray_code),
  );
};

const formatTraySummary = (trayNos) => {
  const trays = sortTextList(trayNos);
  return trays.length > 0 ? trays.join(" / ") : "未记录托盘";
};

const formatOverlapRange = (startAt, endAt) => {
  const start = parseDate(startAt);
  const end = parseDate(endAt);
  if (!start || !end) {
    return "-";
  }
  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
};


export {
  DEFAULT_TASK_COLOR,
  SLOT_SEQUENCE,
  buildExperimentNameMap,
  buildExperimentTrayMap,
  buildSelectedTaskLabSet,
  buildSlotTaskItems,
  buildTrayExperimentCodeMap,
  collectGanttScheduleIds,
  formatOverlapRange,
  formatScheduleWindow,
  formatTraySummary,
  getMasterLabName,
  getMasterLabNames,
  hasScheduleOverlap,
  mergeGanttItems,
  resolveExperimentTypeLabel,
  resolveLabCandidates,
  resolveScheduleLifecycleState,
  resolveScheduleRowStatus,
  resolveTaskColor,
  resolveTaskStatus,
  scheduleIsCompleted,
  sortTextList,
  statusClass,
  taskHasSavedTrayPlan,
};
