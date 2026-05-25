import { LABORATORY_OPTIONS } from "@/lib/moduleCatalog";
import {
  buildConflictRows,
  buildGanttRows,
  isRetentionDevice,
  toLocalDateValue,
} from "@/modules/schedule/model";
import { buildTrayFlowView, normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";

const DEFAULT_LAB_NAMES = ["振动一室", "高低温湿热一室", "盐雾试验室", "冲击一室", "霉菌试验室", "四综合实验室"];

const asArray = (value) => (Array.isArray(value) ? value : []);
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

const getVisualizationLabNames = () => {
  const configured = asArray(LABORATORY_OPTIONS).map((option) => normalizeText(option?.label || option?.key)).filter(Boolean);
  const prioritized = DEFAULT_LAB_NAMES.filter((labName) => configured.includes(labName) || configured.length === 0);
  const remaining = configured.filter((labName) => !prioritized.includes(labName));
  return [...prioritized, ...remaining];
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
  const relationsByTrayCode = new Map();

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
    const existing = relationsByTrayCode.get(trayCode) || [];
    existing.push(indexedRelation);
    relationsByTrayCode.set(trayCode, existing);
  });

  return { relationsByTrayCode };
};

const relationMatchesLab = (relation, labName) =>
  resolveLabDevice(relation?.schedule) === labName || resolveLabDevice(relation?.experiment) === labName;

const sampleMatchesLab = (sample, labName) => normalizeText(sample?.location) === labName || normalizeText(sample?.current_location) === labName;

const buildTrayRowsForLab = ({ labName, samples, experiments, experimentTrays, schedules }) => {
  const { relationsByTrayCode } = buildRelationIndexes({ experimentTrays, experiments, schedules });
  const trayMap = new Map();

  asArray(samples).forEach((sample) => {
    const sampleCode = normalizeText(sample?.code || sample?.sample_code);
    const taskCode = resolveTaskCode(sample);
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = resolveTrayCode(tray);
      if (!trayCode || !taskCode) {
        return;
      }
      const relations = relationsByTrayCode.get(trayCode) || [];
      const labRelations = relations.filter((relation) => relationMatchesLab(relation, labName));
      if (labRelations.length === 0 && !sampleMatchesLab(sample, labName)) {
        return;
      }

      const relation = labRelations[0] || relations[0] || {};
      const flow = buildTrayFlowView({
        currentExperimentCode: relation.experimentCode || "",
        experimentTrays,
        experiments,
        location: sample?.location,
        samples,
        schedules,
        status: normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || normalizeText(sample?.status)),
        taskCode,
        trayCode,
      });

      if (!trayMap.has(trayCode)) {
        trayMap.set(trayCode, {
          quantity: 0,
          sampleCodes: [],
          status: flow.status || "-",
          steps: asArray(flow.steps),
          taskCode,
          trayCode,
        });
      }
      const current = trayMap.get(trayCode);
      current.quantity += normalizeQuantity(tray?.quantity);
      if (sampleCode && !current.sampleCodes.includes(sampleCode)) {
        current.sampleCodes.push(sampleCode);
      }
      if ((flow.steps || []).some((step) => step.active)) {
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
  const labNames = asArray(input.labNames).length ? input.labNames : DEFAULT_LAB_NAMES;
  const samples = asArray(input.samples);
  const experiments = asArray(input.experiments);
  const experimentTrays = asArray(input.experimentTrays || input.experiment_trays);
  const schedules = asArray(input.schedules);

  return labNames.map((labName) => {
    const trays = buildTrayRowsForLab({
      labName,
      samples,
      experiments,
      experimentTrays,
      schedules,
    });
    const sampleCodes = new Set(trays.flatMap((tray) => tray.sampleCodes));
    const taskCodes = new Set(trays.map((tray) => tray.taskCode).filter(Boolean));
    const activeTray = trays.find((tray) => tray.steps.some((step) => step.active)) || trays[0] || null;
    const status = activeTray?.status || "暂无托盘";

    return {
      alert: status.includes("复核") ? "需复核" : "",
      name: labName,
      sampleCount: sampleCodes.size,
      state: status,
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
  const labNames = asArray(input.labNames).map(normalizeText).filter(Boolean);

  const visibleSchedules = schedules.filter(
    (schedule) => !isRetentionDevice(schedule?.device) && scheduleOverlapsWindow(schedule, windowStart, windowEnd),
  );
  const visibleScheduleIds = new Set(visibleSchedules.map((schedule) => normalizeText(schedule?.id)).filter(Boolean));
  const rawGanttView = buildGanttRows({
    days: 3,
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

export { buildLabProcessPanels, buildLabScheduleThreeDayView, getVisualizationLabNames };
