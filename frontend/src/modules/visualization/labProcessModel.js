import { withRequiredLabDevices } from "@/lib/deviceLedger";
import { labIdentityMatches, resolveLabRef, scheduleMatchesLab } from "@/lib/labIdentity";
import { buildTrayFlowView, normalizeLifecycleStatus, SAMPLE_FLOW_STEPS } from "@/modules/samples/samplesFlowModel";
import {
  asArray,
  buildExperimentByTaskAndCode,
  compareText,
  firstNonEmptyArray,
  normalizeQuantity,
  normalizeText,
  parseTimeValue,
  resolveExperimentCode,
  resolveLabDevice,
  resolveDeviceName,
  resolveTaskCode,
  resolveTrayCode,
} from "./sharedModel";
import { entryMatchesTrayCode, relationIsCompletedForSample } from "./experimentCompletionModel";

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
  withRequiredLabDevices(asArray(devices)).forEach((device) => {
    const name = resolveDeviceName(device);
    if (name && !names.includes(name)) {
      names.push(name);
    }
  });
  return names;
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
const LAB_FLOW_OWNER_STATUSES = new Set(["送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中"]);
const lifecycleStatusBelongsToLabFlow = (status, location = "") =>
  LAB_FLOW_OWNER_STATUSES.has(normalizeLifecycleStatus(location, status));
const textMatchesLab = (value, lab) =>
  Boolean(normalizeText(value)) && labIdentityMatches({ location: value }, lab);

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

const FLOW_STEP_RANK_BY_LABEL = new Map(SAMPLE_FLOW_STEPS.map((step, index) => [step.label, index]));
const visualizationFlowStatusRank = (status) => {
  const normalized = normalizeLifecycleStatus("", status);
  const completedIndex = FLOW_STEP_RANK_BY_LABEL.get("实验已完成") ?? 9;
  if (normalized === "送至外观检测间") {
    return completedIndex + 0.1;
  }
  if (normalized === "实验后外观检测间存放") {
    return completedIndex + 0.2;
  }
  return FLOW_STEP_RANK_BY_LABEL.get(normalized) ?? -1;
};
const CENTRAL_RESTORE_STATUSES = new Set(["到货", "已接收", "送至暂存间", "已到达暂存间"]);
const isCentralRestoreStatus = (status) => CENTRAL_RESTORE_STATUSES.has(normalizeLifecycleStatus("", status));

const resolveVisualizationFlowTime = ({ sample, status, tray, trayCode }) => {
  const normalizedStatus = normalizeLifecycleStatus("", status);
  const normalizedTrayCode = normalizeText(trayCode);
  const matchedHistoryTimes = [];

  asArray(sample?.history).forEach((entry) => {
    if (normalizedTrayCode && !entryMatchesTrayCode(entry, normalizedTrayCode)) {
      return;
    }
    const entryStatus = normalizeLifecycleStatus(entry?.location, entry?.status);
    const entryMentionsStatus =
      entryStatus === normalizedStatus
      || normalizeText(entry?.action).includes(normalizedStatus)
      || normalizeText(entry?.detail).includes(normalizedStatus);
    if (!entryMentionsStatus) {
      return;
    }
    const entryTime = parseTimeValue(entry?.time || entry?.created_at || entry?.createdAt || entry?.updated_at || entry?.updatedAt);
    if (entryTime > 0) {
      matchedHistoryTimes.push(entryTime);
    }
  });

  if (matchedHistoryTimes.length > 0) {
    return Math.max(...matchedHistoryTimes);
  }

  const candidateTimes = [
    parseTimeValue(tray?.updated_at || tray?.updatedAt),
    parseTimeValue(sample?.updated_at || sample?.updatedAt),
  ].filter((time) => time > 0);
  return candidateTimes.length > 0 ? Math.max(...candidateTimes) : 0;
};

const shouldReplaceVisualizationTrayEntry = (current, candidate) => {
  if (!current) {
    return true;
  }
  const candidateRank = visualizationFlowStatusRank(candidate.lifecycleStatus);
  const currentRank = visualizationFlowStatusRank(current.lifecycleStatus);
  const candidateTime = resolveVisualizationFlowTime(candidate);
  const currentTime = resolveVisualizationFlowTime(current);
  if (candidateTime || currentTime) {
    if (candidateTime !== currentTime) {
      return candidateTime > currentTime;
    }
    const completedRank = FLOW_STEP_RANK_BY_LABEL.get("实验已完成") ?? 9;
    const candidateIsCentralRestore = isCentralRestoreStatus(candidate.lifecycleStatus);
    const currentIsCentralRestore = isCentralRestoreStatus(current.lifecycleStatus);
    if (currentIsCentralRestore && !candidateIsCentralRestore && candidateRank >= completedRank) {
      return false;
    }
    if (candidateIsCentralRestore && !currentIsCentralRestore && currentRank >= completedRank) {
      return true;
    }
  }
  return candidateRank > currentRank;
};

const buildTrayRowsForLab = ({
  lab,
  labName,
  samples,
  experiments,
  experimentRuns,
  experimentRunTrays,
  experimentTrays,
  schedules,
  stagingEvents,
  buildTrayFlow = buildTrayFlowView,
}) => {
  const { relationsByTaskAndTrayCode } = buildRelationIndexes({ experimentTrays, experiments, schedules });
  const latestStockOutTargetByTaskAndTray = buildLatestStockOutTargetByTaskAndTray(stagingEvents);
  const trayAggregates = new Map();

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
      const sampleLocationMatchesLab = textMatchesLab(sample?.location, lab || labName);
      const targetLabMatchesLab = textMatchesLab(targetLab, lab || labName);
      const currentLabExperimentCode =
        !activeTargetExperimentCode
        && incompleteLabRelations.length === 1
        && lifecycleStatusBelongsToLabFlow(lifecycleStatus, lifecycleLocation)
        && (sampleLocationMatchesLab || targetLabMatchesLab)
          ? incompleteLabRelations[0].experimentCode
          : "";

      const entry = {
        currentExperimentCode: activeTargetExperimentCode || currentLabExperimentCode,
        dispatchTargetLab: activeTargetLab,
        lifecycleLocation,
        lifecycleStatus,
        sample,
        status: lifecycleStatus,
        tray,
        trayCode,
      };
      if (!trayAggregates.has(trayMapKey)) {
        trayAggregates.set(trayMapKey, {
          quantity: 0,
          representativeEntry: null,
          sampleCodeSet: new Set(),
          taskCode,
          trayCode,
        });
      }
      const aggregate = trayAggregates.get(trayMapKey);
      aggregate.quantity += normalizeQuantity(tray?.quantity);
      if (sampleCode) {
        aggregate.sampleCodeSet.add(sampleCode);
      }
      if (shouldReplaceVisualizationTrayEntry(aggregate.representativeEntry, entry)) {
        aggregate.representativeEntry = entry;
      }
    });
  });

  return Array.from(trayAggregates.values())
    .map((aggregate) => {
      const entry = aggregate.representativeEntry || {};
      const flow = buildTrayFlow({
        currentExperimentCode: entry.currentExperimentCode,
        dispatchTargetLab: entry.dispatchTargetLab,
        experimentRuns,
        experimentRunTrays,
        experimentTrays,
        experiments,
        location: entry.lifecycleLocation,
        preferCurrentExperimentCode: Boolean(entry.currentExperimentCode),
        samples,
        schedules,
        status: entry.lifecycleStatus,
        taskCode: aggregate.taskCode,
        trayCode: aggregate.trayCode,
      });

      return {
        canonicalStatus: flow.canonicalStatus || flow.status || "-",
        quantity: aggregate.quantity,
        sampleCodes: Array.from(aggregate.sampleCodeSet).sort(compareText),
        status: flow.status || "-",
        steps: asArray(flow.steps),
        taskCode: aggregate.taskCode,
        trayCode: aggregate.trayCode,
      };
    })
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
      buildTrayFlow: input.buildTrayFlow,
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

export { buildLabProcessPanels, getVisualizationLabNames };
