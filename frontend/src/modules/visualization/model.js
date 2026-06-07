import {
  buildConflictRows,
  buildGanttRows,
  toLocalDateValue,
} from "@/modules/schedule/model";
import { buildTrayFlowView, normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";
import { SYSTEM_TRAY_TOTAL } from "@/lib/trayCapacity";
import { resolveLabRef, scheduleMatchesLab, scheduleTargetsStorageArea } from "@/lib/labIdentity";

const asArray = (value) => (Array.isArray(value) ? value : []);
const firstNonEmptyArray = (...values) => {
  const arrays = values.filter(Array.isArray);
  return arrays.find((value) => value.length > 0) || arrays[0] || [];
};
const normalizeText = (value) => String(value ?? "").trim();
const compareText = (left, right) => normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN", { numeric: true });
const normalizeQuantity = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};
const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const addDays = (date, days) => {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
};
const startOfLocalDay = (value) => {
  const date = parseDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};
const overlaps = (startA, endA, startB, endB) => startA < endB && endA > startB;

const resolveTaskCode = (entry) => normalizeText(entry?.task_code || entry?.taskCode || entry?.code);
const resolveExperimentCode = (entry) => normalizeText(entry?.experiment_code || entry?.experimentCode || entry?.code);
const resolveTrayCode = (entry) => normalizeText(entry?.tray_code || entry?.trayCode || entry?.code);
const resolveLabDevice = (entry) => normalizeText(entry?.device || entry?.required_device || entry?.requiredDevice || entry?.lab || entry?.labName);
const resolveDeviceName = (device) => normalizeText(device?.code) || normalizeText(device?.name);
const deviceMatchesLab = (device, labName) =>
  normalizeText(device?.code) === labName || normalizeText(device?.name) === labName;
const deviceStatusText = (device) => normalizeText(device?.status);
const resolveLabHealth = (device) => {
  const status = deviceStatusText(device);
  if (!status) {
    return { alert: "", healthLabel: "正常", healthState: "ok", status: "" };
  }
  if (status.includes("停用") || status.includes("禁用") || status.includes("不可用")) {
    return { alert: "设备停用", healthLabel: "停用", healthState: "disabled", status };
  }
  if (status.includes("维护") || status.includes("维修") || status.includes("校准") || status.includes("保养")) {
    return { alert: "设备维护中", healthLabel: "维护", healthState: "maintenance", status };
  }
  return { alert: "", healthLabel: "正常", healthState: "ok", status };
};

const getVisualizationLabNames = (devices = []) => {
  const names = [];
  asArray(devices).forEach((device) => {
    const name = resolveDeviceName(device);
    if (name && !names.includes(name)) {
      names.push(name);
    }
  });
  return names;
};

const buildExperimentByTaskAndCode = (experiments) => {
  const map = new Map();
  asArray(experiments).forEach((experiment) => {
    const taskCode = resolveTaskCode(experiment);
    const experimentCode = resolveExperimentCode(experiment);
    if (taskCode && experimentCode) {
      map.set(`${taskCode}::${experimentCode}`, experiment);
    }
  });
  return map;
};

const buildScheduleByTaskAndExperiment = (schedules) => {
  const map = new Map();
  asArray(schedules).forEach((schedule) => {
    const taskCode = resolveTaskCode(schedule);
    const experimentCode = resolveExperimentCode(schedule);
    if (taskCode && experimentCode) {
      map.set(`${taskCode}::${experimentCode}`, schedule);
    }
  });
  return map;
};

const buildRelationIndexes = ({ experimentTrays, experiments, schedules }) => {
  const experimentByKey = buildExperimentByTaskAndCode(experiments);
  const scheduleByKey = buildScheduleByTaskAndExperiment(schedules);
  const relationsByTaskAndTrayCode = new Map();

  asArray(experimentTrays).forEach((relation) => {
    const taskCode = resolveTaskCode(relation);
    const experimentCode = resolveExperimentCode(relation);
    const trayCode = resolveTrayCode(relation);
    if (!taskCode || !experimentCode || !trayCode) {
      return;
    }
    const key = `${taskCode}::${experimentCode}`;
    const indexedRelation = {
      experiment: experimentByKey.get(key) || null,
      experimentCode,
      schedule: scheduleByKey.get(key) || null,
      taskCode,
      trayCode,
    };
    const trayKey = `${taskCode}::${trayCode}`;
    const existing = relationsByTaskAndTrayCode.get(trayKey) || [];
    existing.push(indexedRelation);
    relationsByTaskAndTrayCode.set(trayKey, existing);
  });

  return { relationsByTaskAndTrayCode };
};

const relationMatchesLab = (relation, lab) =>
  scheduleMatchesLab(relation?.schedule, lab) || scheduleMatchesLab(relation?.experiment, lab);
const resolveTrayTargetLab = (tray) => normalizeText(tray?.target_lab || tray?.targetLab);
const resolveTrayTargetExperimentCode = (tray) => normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
const resolveRelationLabName = (relation) =>
  resolveLabDevice(relation?.schedule) || resolveLabDevice(relation?.experiment);

const COMPLETED_EXPERIMENT_STATUSES = new Set(["实验已完成", "实验已经完成", "实验完成"]);
const EXPERIMENT_TRAY_TERMINAL_STATUSES = new Set([
  ...COMPLETED_EXPERIMENT_STATUSES,
  "放置实验后暂存间",
  "已到达暂存间",
  "厂家收回",
]);
const resolveRelationStatus = (relation) =>
  normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status);
const resolveRelationExperimentName = (experiment) =>
  normalizeText(
    experiment?.experiment_name
    || experiment?.experimentName
    || experiment?.name
    || experiment?.experiment_type
    || experiment?.experimentType,
  );
const parseExperimentHistoryDetail = (detail) => {
  const parts = normalizeText(detail).split("/").map(normalizeText);
  if (parts.length < 3) {
    return null;
  }
  return {
    experimentName: parts[1],
    status: parts.slice(2).join(" / "),
    taskCode: parts[0],
  };
};
const escapeRegExp = (value) => normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const entryMatchesTrayCode = (entry, trayCode) => {
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTrayCode) {
    return false;
  }
  const structuredTrayCode = resolveTrayCode(entry);
  if (structuredTrayCode) {
    return structuredTrayCode === normalizedTrayCode;
  }
  const detail = normalizeText(entry?.detail);
  if (!detail) {
    return false;
  }
  const escaped = escapeRegExp(normalizedTrayCode);
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(detail);
};
const historyEntryAppliesToTray = (entry, sample, trayCode) => {
  const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
  const matchedTrayCodes = sampleTrayCodes.filter((code) => entryMatchesTrayCode(entry, code));
  if (matchedTrayCodes.length > 0) {
    return matchedTrayCodes.includes(normalizeText(trayCode));
  }
  return sampleTrayCodes.length <= 1;
};
const sampleHasCompletedExperiment = (sample, relation) => {
  const taskCode = resolveTaskCode(relation);
  const experimentName = resolveRelationExperimentName(relation?.experiment);
  const trayCode = resolveTrayCode(relation);
  if (!taskCode || !experimentName) {
    return false;
  }
  return asArray(sample?.history).some((entry) => {
    if (!historyEntryAppliesToTray(entry, sample, trayCode)) {
      return false;
    }
    const parsed = parseExperimentHistoryDetail(entry?.detail);
    return parsed?.taskCode === taskCode
      && parsed?.experimentName === experimentName
      && normalizeLifecycleStatus("", parsed?.status) === "实验已完成";
  });
};
const relationIsCompletedByRunTray = ({ experimentRunTrays, relation }) =>
  asArray(experimentRunTrays).some((entry) =>
    resolveTaskCode(entry) === resolveTaskCode(relation)
    && resolveExperimentCode(entry) === resolveExperimentCode(relation)
    && resolveTrayCode(entry) === resolveTrayCode(relation)
    && EXPERIMENT_TRAY_TERMINAL_STATUSES.has(normalizeLifecycleStatus("", resolveRelationStatus(entry))),
  );
const sampleTrayIsReturned = ({ sample, relation }) => {
  const trayCode = resolveTrayCode(relation);
  const trays = asArray(sample?.trays);
  const targetTray = trays.find((tray) => resolveTrayCode(tray) === trayCode);
  if (targetTray && normalizeLifecycleStatus("", normalizeText(targetTray?.status)) === "厂家收回") {
    return true;
  }
  if (targetTray && normalizeText(targetTray?.status)) {
    return false;
  }
  if (normalizeLifecycleStatus(sample?.location, normalizeText(sample?.status)) !== "厂家收回") {
    return false;
  }
  if (trays.length <= 1) {
    return Boolean(targetTray);
  }
  return trays.every((tray) => normalizeLifecycleStatus("", normalizeText(tray?.status)) === "厂家收回");
};
const relationIsCompletedForSample = ({ experimentRunTrays = [], sample, relation }) => {
  return relationIsCompletedByRunTray({ experimentRunTrays, relation })
    || sampleTrayIsReturned({ sample, relation })
    || sampleHasCompletedExperiment(sample, relation);
};

const buildLatestStockOutTargetByTaskAndTray = (stagingEvents) => {
  const map = new Map();
  asArray(stagingEvents).forEach((event) => {
    if (normalizeText(event?.action) !== "stock_out") {
      return;
    }
    const taskCode = resolveTaskCode(event);
    const trayCode = resolveTrayCode(event);
    if (!taskCode || !trayCode) {
      return;
    }
    const key = `${taskCode}::${trayCode}`;
    const current = map.get(key);
    const nextTime = Date.parse(normalizeText(event?.time)) || 0;
    const currentTime = Date.parse(normalizeText(current?.time)) || -1;
    if (!current || nextTime >= currentTime) {
      map.set(key, event);
    }
  });
  return map;
};

const buildTrayRowsForLab = ({ lab, labName, samples, experiments, experimentRuns, experimentRunTrays, experimentTrays, schedules, stagingEvents }) => {
  const { relationsByTaskAndTrayCode } = buildRelationIndexes({ experimentTrays, experiments, schedules });
  const latestStockOutTargetByTaskAndTray = buildLatestStockOutTargetByTaskAndTray(stagingEvents);
  const trayMap = new Map();

  asArray(samples).forEach((sample) => {
    const sampleCode = normalizeText(sample?.code || sample?.sample_code);
    const taskCode = resolveTaskCode(sample);
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = resolveTrayCode(tray);
      if (!trayCode || !taskCode) {
        return;
      }
      const trayMapKey = `${taskCode}::${trayCode}`;
      const relations = relationsByTaskAndTrayCode.get(trayMapKey) || [];
      const latestStockOutTarget = latestStockOutTargetByTaskAndTray.get(trayMapKey) || {};
      const targetExperimentCode =
        resolveTrayTargetExperimentCode(tray)
        || normalizeText(latestStockOutTarget?.target_experiment_code || latestStockOutTarget?.targetExperimentCode);
      const targetLab = resolveTrayTargetLab(tray) || normalizeText(latestStockOutTarget?.target_lab || latestStockOutTarget?.targetLab);
      const targetExperimentRelations = targetExperimentCode
        ? relations.filter((relation) => relation.experimentCode === targetExperimentCode)
        : [];
      const activeTargetExperimentCode =
        targetExperimentCode
        && targetExperimentRelations.some((relation) => !relationIsCompletedForSample({ experimentRunTrays, sample, relation }))
          ? targetExperimentCode
          : "";
      const targetLabRelations = !activeTargetExperimentCode && targetLab
        ? relations.filter((relation) => resolveRelationLabName(relation) === targetLab)
        : [];
      const activeTargetLab =
        targetLab
        && targetLabRelations.some((relation) => !relationIsCompletedForSample({ experimentRunTrays, sample, relation }))
          ? targetLab
          : "";
      const labRelations = relations.filter((relation) => relationMatchesLab(relation, lab || labName));
      const incompleteLabRelations = labRelations.filter((relation) =>
        !relationIsCompletedForSample({ experimentRunTrays, sample, relation }),
      );
      if (labRelations.length > 0 && incompleteLabRelations.length === 0) {
        return;
      }
      const trayStatus = normalizeText(tray?.status);
      const lifecycleStatus = trayStatus
        ? normalizeLifecycleStatus("", trayStatus)
        : normalizeLifecycleStatus(sample?.location, normalizeText(sample?.status));
      const lifecycleLocation = trayStatus ? "" : sample?.location;
      const scheduledLabMatches = incompleteLabRelations.length > 0;
      if (!scheduledLabMatches) {
        return;
      }

      const flow = buildTrayFlowView({
        currentExperimentCode: activeTargetExperimentCode,
        dispatchTargetLab: activeTargetLab,
        experimentRuns,
        experimentRunTrays,
        experimentTrays,
        experiments,
        location: lifecycleLocation,
        samples,
        schedules,
        status: lifecycleStatus,
        taskCode,
        trayCode,
      });

      if (!trayMap.has(trayMapKey)) {
        trayMap.set(trayMapKey, {
          canonicalStatus: flow.canonicalStatus || flow.status || "-",
          quantity: 0,
          sampleCodes: [],
          status: flow.status || "-",
          steps: asArray(flow.steps),
          taskCode,
          trayCode,
        });
      }
      const current = trayMap.get(trayMapKey);
      current.quantity += normalizeQuantity(tray?.quantity);
      if (sampleCode && !current.sampleCodes.includes(sampleCode)) {
        current.sampleCodes.push(sampleCode);
      }
      if ((flow.steps || []).some((step) => step.active)) {
        current.canonicalStatus = flow.canonicalStatus || current.canonicalStatus;
        current.status = flow.status || current.status;
        current.steps = asArray(flow.steps);
      }
    });
  });

  return Array.from(trayMap.values())
    .map((tray) => ({
      ...tray,
      sampleCodes: tray.sampleCodes.slice().sort(compareText),
    }))
    .sort((left, right) => compareText(left.trayCode, right.trayCode));
};

function buildLabProcessPanels(input = {}) {
  const labRefs = asArray(input.labNames)
    .map((lab) => {
      const ref = resolveLabRef(lab);
      return { ...ref, name: ref.name || ref.code };
    })
    .filter((lab) => lab.name || lab.code);
  const labNames = labRefs.map((lab) => lab.name || lab.code).filter(Boolean);
  const devices = asArray(input.devices);
  const samples = asArray(input.samples);
  const experiments = asArray(input.experiments);
  const experimentRuns = asArray(input.experimentRuns || input.experiment_runs);
  const experimentRunTrays = firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays);
  const experimentTrays = asArray(input.experimentTrays || input.experiment_trays);
  const schedules = asArray(input.schedules);

  return labRefs.map((lab) => {
    const labName = lab.name || lab.code;
    const trays = buildTrayRowsForLab({
      lab,
      labName,
      labNames,
      samples,
      experiments,
      experimentRuns,
      experimentRunTrays,
      experimentTrays,
      stagingEvents: input.stagingEvents || input.staging_events,
      schedules,
    });
    const sampleCodes = new Set(trays.flatMap((tray) => tray.sampleCodes));
    const taskCodes = new Set(trays.map((tray) => tray.taskCode).filter(Boolean));
    const activeTray = trays.find((tray) => tray.steps.some((step) => step.active)) || trays[0] || null;
    const status = activeTray?.status || "暂无托盘";
    const labHealth = resolveLabHealth(devices.find((device) => deviceMatchesLab(device, labName)));

    return {
      alert: labHealth.alert || (status.includes("复核") ? "需复核" : ""),
      healthLabel: labHealth.healthLabel,
      healthState: labHealth.healthState,
      name: labName,
      sampleCount: sampleCodes.size,
      state: labHealth.status || status,
      task: activeTray?.taskCode || "-",
      taskCount: taskCodes.size,
      trayCount: trays.length,
      trays,
    };
  });
}

const formatMonthDay = (date) => `${date.getMonth() + 1}/${date.getDate()}`;

const buildThreeDayList = (now) => {
  const today = startOfLocalDay(now);
  return [0, 1, 2].map((index) => {
    const date = addDays(today, index);
    const dateLabel = formatMonthDay(date);
    return {
      date,
      key: toLocalDateValue(date),
      label: dateLabel,
      dateLabel,
    };
  });
};

const scheduleOverlapsWindow = (schedule, windowStart, windowEnd) => {
  const startAt = parseDate(schedule?.start_at);
  const endAt = parseDate(schedule?.end_at);
  return Boolean(startAt && endAt && overlaps(startAt, endAt, windowStart, windowEnd));
};

const normalizeScheduleSlot = (slot) => ({
  className: normalizeText(slot?.className),
  date: normalizeText(slot?.date),
  displayMode: normalizeText(slot?.displayMode),
  items: asArray(slot?.items),
  key: normalizeText(slot?.key),
  label: normalizeText(slot?.label),
  overflowCount: Number(slot?.overflowCount) || 0,
  scheduleId: normalizeText(slot?.scheduleId),
  segment: normalizeText(slot?.segment),
  state: normalizeText(slot?.state),
  taskColor: normalizeText(slot?.taskColor),
  title: normalizeText(slot?.title),
});

function buildLabScheduleThreeDayView(input = {}) {
  const now = parseDate(input.now) || new Date();
  const days = buildThreeDayList(now);
  const windowStart = days[0].date;
  const windowEnd = addDays(days[0].date, 3);
  const tasks = asArray(input.tasks);
  const experiments = asArray(input.experiments);
  const experimentTrays = asArray(input.experimentTrays || input.experiment_trays);
  const samples = asArray(input.samples);
  const schedules = asArray(input.schedules);
  const devices = asArray(input.devices);
  const labNames = asArray(input.labNames).map(normalizeText).filter(Boolean);

  const visibleSchedules = schedules.filter(
    (schedule) => !scheduleTargetsStorageArea(schedule) && scheduleOverlapsWindow(schedule, windowStart, windowEnd),
  );
  const visibleScheduleIds = new Set(visibleSchedules.map((schedule) => normalizeText(schedule?.id)).filter(Boolean));
  const rawGanttView = buildGanttRows({
    days: 3,
    devices,
    experiments,
    experimentTrays,
    masterLabs: labNames.map((name) => ({ name, test_types: [name] })),
    now,
    samples,
    schedules: visibleSchedules,
    startDate: windowStart,
    tasks,
  });
  const allowedLabs = new Set(labNames);
  const rows = asArray(rawGanttView.rows)
    .filter((row) => allowedLabs.size === 0 || allowedLabs.has(normalizeText(row?.device)))
    .map((row) => ({
      device: normalizeText(row?.device),
      loadCount: asArray(row?.slots).filter((slot) => normalizeText(slot?.state) !== "idle").length,
      slots: asArray(row?.slots).map(normalizeScheduleSlot),
    }));
  const runningIds = new Set();
  rows.forEach((row) => {
    row.slots.forEach((slot) => {
      if (slot.state !== "running") {
        return;
      }
      if (slot.scheduleId) {
        runningIds.add(slot.scheduleId);
      }
      slot.items.forEach((item) => asArray(item?.scheduleIds).forEach((id) => runningIds.add(normalizeText(id))));
    });
  });
  const conflicts = buildConflictRows({
    experiments,
    experimentTrays,
    samples,
    schedules: visibleSchedules,
    tasks,
  }).filter((row) => !row?.id || visibleScheduleIds.has(normalizeText(row?.id))).length;
  const dayCounts = days.map((day) => {
    const dayStart = day.date;
    const dayEnd = addDays(day.date, 1);
    return {
      ...day,
      count: visibleSchedules.filter((schedule) => scheduleOverlapsWindow(schedule, dayStart, dayEnd)).length,
    };
  });

  return {
    dayCounts,
    days,
    rows,
    summary: {
      conflicts,
      idleLabs: rows.filter((row) => row.loadCount === 0).length,
      running: runningIds.size,
      total: visibleSchedules.length,
      waiting: Math.max(0, visibleSchedules.length - runningIds.size),
    },
  };
}

const STAGING_CURRENT_STATUSES = new Set(["已入库", "暂存间存放", "已到达暂存间"]);
const APPEARANCE_CURRENT_STATUSES = new Set(["外观检测间存放", "已到达外观检测间"]);
const POST_TEST_STAGING_KEYWORD = "实验后暂存间";
const APPEARANCE_LOCATION_KEYWORD = "外观检测间";
const PLANNED_STAGING_STATUSES = new Set(["送至暂存间"]);
const PLANNED_STAGING_ACTIONS = new Set(["送至暂存间"]);
const STAGING_KIND_LABELS = {
  current: "暂存间存放",
  planned: "计划暂存",
  "post-test": "实验后暂存间",
  appearance: "外观检测间存放",
};

const resolveTaskName = (task) => normalizeText(task?.name || task?.task_name || task?.code);
const resolveTaskTestType = (task) => normalizeText(task?.test_type || task?.sample_type || task?.type);
const resolveExperimentName = (experiment, fallback = "") =>
  normalizeText(experiment?.experiment_name || experiment?.name || experiment?.experiment_type || fallback);

const buildTaskByCode = (tasks) => {
  const map = new Map();
  asArray(tasks).forEach((task) => {
    const code = resolveTaskCode(task);
    if (code) {
      map.set(code, task);
    }
  });
  return map;
};

const buildLatestStagingEventByTray = (stagingEvents) => {
  const map = new Map();
  asArray(stagingEvents).forEach((event) => {
    const trayCode = resolveTrayCode(event);
    if (!trayCode) {
      return;
    }
    const current = map.get(trayCode);
    const nextTime = parseDate(event?.time)?.getTime() ?? 0;
    const currentTime = parseDate(current?.time)?.getTime() ?? -1;
    if (!current || nextTime >= currentTime) {
      map.set(trayCode, event);
    }
  });
  return map;
};

const buildExperimentLabelByTray = ({ experiments, experimentTrays }) => {
  const experimentByKey = buildExperimentByTaskAndCode(experiments);
  const labelsByTray = new Map();
  asArray(experimentTrays).forEach((relation) => {
    const taskCode = resolveTaskCode(relation);
    const experimentCode = resolveExperimentCode(relation);
    const trayCode = resolveTrayCode(relation);
    if (!taskCode || !experimentCode || !trayCode) {
      return;
    }
    const label = resolveExperimentName(experimentByKey.get(`${taskCode}::${experimentCode}`), experimentCode);
    if (!label) {
      return;
    }
    const labels = labelsByTray.get(trayCode) || [];
    if (!labels.includes(label)) {
      labels.push(label);
      labelsByTray.set(trayCode, labels);
    }
  });
  return labelsByTray;
};

const isCurrentStagingStatus = (status) => STAGING_CURRENT_STATUSES.has(normalizeText(status));
const isAppearanceStatus = (status) => APPEARANCE_CURRENT_STATUSES.has(normalizeText(status));
const isAppearanceLocation = (value) => normalizeText(value).includes(APPEARANCE_LOCATION_KEYWORD);
const isPostTestStagingLocation = (value) => normalizeText(value).includes(POST_TEST_STAGING_KEYWORD);
const isPostTestStagingStatus = (status) => normalizeText(status) === "放置实验后暂存间";
const isPlannedStagingStatus = (status) => PLANNED_STAGING_STATUSES.has(normalizeText(status));
const isStagingDestination = (value) => {
  const text = normalizeText(value);
  return text === "staging" || text.includes("暂存间");
};
const isStockOutToStaging = (event) =>
  normalizeText(event?.action) === "stock_out"
  && (
    isStagingDestination(event?.target_type || event?.targetType)
    || isStagingDestination(event?.target_lab || event?.targetLab || event?.target_name || event?.targetName)
  );

const buildStagingKind = (kind, status = "") => ({
  kind,
  label: STAGING_KIND_LABELS[kind],
  status: normalizeText(status) || STAGING_KIND_LABELS[kind],
});

const resolveStagingTrayKind = (row, latestEvent) => {
  const latestAction = normalizeText(latestEvent?.action);
  const plannedStatus = row.statuses.find((status) => isPlannedStagingStatus(status));
  if (latestAction === "manufacturer_return") {
    return null;
  }
  if (latestAction === "stock_out" && !isStockOutToStaging(latestEvent) && !plannedStatus) {
    return null;
  }
  if (plannedStatus) {
    return buildStagingKind("planned", plannedStatus);
  }
  if (isStockOutToStaging(latestEvent)) {
    return buildStagingKind("planned", "送至暂存间");
  }
  if (
    row.hasAppearanceLocation
    || row.statuses.some((status) => isAppearanceStatus(status))
    || normalizeText(latestEvent?.room || latestEvent?.storage_room || latestEvent?.storageRoom) === "appearance"
  ) {
    return buildStagingKind("appearance", "外观检测间存放");
  }
  if (row.hasPostTestStagingLocation || row.statuses.some((status) => isPostTestStagingStatus(status))) {
    return buildStagingKind("post-test", "放置实验后暂存间");
  }
  const currentStatus = row.statuses.find((status) => isCurrentStagingStatus(status));
  if (currentStatus) {
    return buildStagingKind("current", currentStatus);
  }
  if (latestAction === "stock_in") {
    return buildStagingKind("current", "已入库");
  }
  if (PLANNED_STAGING_ACTIONS.has(latestAction)) {
    return buildStagingKind("planned", latestAction);
  }
  return null;
};

const clampRemaining = (capacity, used) => Math.max(0, capacity - used);

const isReleasedTray = (sample, tray, latestEvent) => {
  if (normalizeText(latestEvent?.action) === "manufacturer_return") {
    return true;
  }
  return normalizeText(sample?.status) === "厂家收回" || normalizeText(tray?.status) === "厂家收回";
};

const countUsedSystemTrays = ({ samples, latestEventByTray }) => {
  const trayCodes = new Set();
  asArray(samples).forEach((sample) => {
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = resolveTrayCode(tray);
      if (!trayCode || isReleasedTray(sample, tray, latestEventByTray.get(trayCode))) {
        return;
      }
      trayCodes.add(trayCode);
    });
  });
  return trayCodes.size;
};

function buildStagingSamplesView(input = {}) {
  const capacity = Number.isFinite(Number(input.capacity)) ? Number(input.capacity) : 100;
  const trayCapacity = Number.isFinite(Number(input.trayCapacity)) ? Number(input.trayCapacity) : SYSTEM_TRAY_TOTAL;
  const samples = asArray(input.samples);
  const taskByCode = buildTaskByCode(input.tasks);
  const labelsByTray = buildExperimentLabelByTray({
    experiments: input.experiments,
    experimentTrays: input.experimentTrays || input.experiment_trays,
  });
  const latestEventByTray = buildLatestStagingEventByTray(input.stagingEvents || input.staging_events);
  const usedSystemTrayCount = countUsedSystemTrays({ latestEventByTray, samples });
  const trayMap = new Map();

  samples.forEach((sample) => {
    const taskCode = resolveTaskCode(sample);
    const sampleCode = normalizeText(sample?.code || sample?.sample_code);
    const task = taskByCode.get(taskCode) || {};
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = resolveTrayCode(tray);
      if (!taskCode || !trayCode) {
        return;
      }
      const key = `${taskCode}::${trayCode}`;
      const current = trayMap.get(key) || {
        experimentLabels: labelsByTray.get(trayCode) || [],
        hasAppearanceLocation: false,
        hasPostTestStagingLocation: false,
        sampleCodes: [],
        sampleTypeFallback: "",
        statuses: [],
        taskCode,
        taskName: resolveTaskName(task),
        testType: resolveTaskTestType(task),
        trayCode,
      };
      current.hasPostTestStagingLocation =
        current.hasPostTestStagingLocation
        || isPostTestStagingLocation(sample?.location)
        || isPostTestStagingLocation(sample?.current_location);
      current.hasAppearanceLocation =
        current.hasAppearanceLocation
        || isAppearanceLocation(sample?.location)
        || isAppearanceLocation(sample?.current_location);
      current.sampleTypeFallback =
        current.sampleTypeFallback || normalizeText(sample?.sample_type || task?.sample_type || task?.test_type);
      [
        normalizeText(tray?.status),
        normalizeText(sample?.status),
        normalizeText(sample?.flow_status),
      ].filter(Boolean).forEach((status) => {
        if (!current.statuses.includes(status)) {
          current.statuses.push(status);
        }
      });
      if (sampleCode && !current.sampleCodes.includes(sampleCode)) {
        current.sampleCodes.push(sampleCode);
      }
      trayMap.set(key, current);
    });
  });

  latestEventByTray.forEach((event, trayCode) => {
    const latestAction = normalizeText(event?.action);
    if (latestAction === "manufacturer_return" || (latestAction === "stock_out" && !isStockOutToStaging(event))) {
      return;
    }
    const taskCode = resolveTaskCode(event);
    if (!taskCode) {
      return;
    }
    const key = `${taskCode}::${trayCode}`;
    if (!trayMap.has(key)) {
      const task = taskByCode.get(taskCode) || {};
      trayMap.set(key, {
        experimentLabels: labelsByTray.get(trayCode) || [],
        hasAppearanceLocation: normalizeText(event?.room || event?.storage_room || event?.storageRoom) === "appearance",
        hasPostTestStagingLocation: false,
        sampleCodes: [],
        sampleTypeFallback: "",
        statuses: [],
        taskCode,
        taskName: resolveTaskName(task),
        testType: resolveTaskTestType(task),
        trayCode,
      });
    }
  });

  const trays = Array.from(trayMap.values())
    .map((row) => {
      const latestEvent = latestEventByTray.get(row.trayCode);
      const stagingKind = resolveStagingTrayKind(row, latestEvent);
      if (!stagingKind) {
        return null;
      }
      const experimentType = row.experimentLabels.join(" / ") || row.testType || row.sampleTypeFallback || "待确认实验";
      const sampleCodes = row.sampleCodes.slice().sort(compareText);
      return {
        experimentType,
        overflowSampleCount: Math.max(0, sampleCodes.length - 5),
        sampleCodes,
        sampleCount: sampleCodes.length,
        stagingKind: stagingKind.kind,
        stagingKindLabel: stagingKind.label,
        status: stagingKind.status,
        taskCode: row.taskCode,
        taskName: row.taskName || row.taskCode,
        trayCode: row.trayCode,
        updatedAt: normalizeText(latestEvent?.time),
        visibleSampleCodes: sampleCodes.slice(0, 5),
      };
    })
    .filter(Boolean)
    .sort((left, right) => compareText(left.taskCode, right.taskCode) || compareText(left.trayCode, right.trayCode));

  const tasks = Array.from(
    trays.reduce((map, tray) => {
      if (!map.has(tray.taskCode)) {
        map.set(tray.taskCode, {
          sampleCount: 0,
          taskCode: tray.taskCode,
          taskName: tray.taskName,
          trays: [],
          trayCount: 0,
        });
      }
      const task = map.get(tray.taskCode);
      task.trays.push(tray);
      task.trayCount += 1;
      task.sampleCount += tray.sampleCount;
      return map;
    }, new Map()).values(),
  ).sort((left, right) => compareText(left.taskCode, right.taskCode));

  const saltSprayTrayCount = trays.filter((tray) => tray.experimentType.includes("盐雾")).length;
  const moldTrayCount = trays.filter((tray) => tray.experimentType.includes("霉菌")).length;

  return {
    summary: {
      appearanceTrayCount: trays.filter((tray) => tray.stagingKind === "appearance").length,
      currentTrayCount: trays.filter((tray) => tray.stagingKind === "current").length,
      moldRemaining: clampRemaining(capacity, moldTrayCount),
      moldTrayCount,
      plannedTrayCount: trays.filter((tray) => tray.stagingKind === "planned").length,
      postTestTrayCount: trays.filter((tray) => tray.stagingKind === "post-test").length,
      saltSprayRemaining: clampRemaining(capacity, saltSprayTrayCount),
      saltSprayTrayCount,
      totalSampleCount: trays.reduce((total, tray) => total + tray.sampleCount, 0),
      totalTaskCount: tasks.length,
      totalTrayCount: trays.length,
      trayRemaining: clampRemaining(trayCapacity, usedSystemTrayCount),
      usedSystemTrayCount,
    },
    tasks,
  };
}

export { buildLabProcessPanels, buildLabScheduleThreeDayView, buildStagingSamplesView, getVisualizationLabNames };
