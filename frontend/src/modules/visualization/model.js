import { LABORATORY_OPTIONS } from "@/lib/moduleCatalog";
import { buildTrayFlowView, normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";

const DEFAULT_LAB_NAMES = ["振动一室", "高低温湿热一室", "盐雾试验室", "冲击一室", "霉菌试验室", "四综合实验室"];

const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeText = (value) => String(value ?? "").trim();
const compareText = (left, right) => normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN", { numeric: true });
const normalizeQuantity = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

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

export { buildLabProcessPanels, getVisualizationLabNames };
