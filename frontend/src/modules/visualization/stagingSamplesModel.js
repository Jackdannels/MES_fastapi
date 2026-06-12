import { SYSTEM_TRAY_TOTAL } from "@/lib/trayCapacity";
import { APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS } from "@/modules/samples/sampleFlow.constants";
import { normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";
import {
  asArray,
  buildExperimentByTaskAndCode,
  compareText,
  firstNonEmptyArray,
  normalizeText,
  parseDate,
  resolveExperimentCode,
  resolveTaskCode,
  resolveTrayCode,
} from "./sharedModel";
import { COMPLETED_EXPERIMENT_STATUSES, resolveRelationStatus, sampleHasCompletedExperiment } from "./experimentCompletionModel";

const STAGING_CURRENT_STATUSES = new Set(["已入库", "暂存间存放", "已到达暂存间"]);
const APPEARANCE_CURRENT_STATUSES = new Set(["外观检测间存放", APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS, "已到达外观检测间"]);
const POST_TEST_STAGING_KEYWORD = "实验后暂存间";
const APPEARANCE_LOCATION_KEYWORD = "外观检测间";
const PLANNED_APPEARANCE_STATUSES = new Set(["送至外观检测间"]);
const PLANNED_STAGING_STATUSES = new Set(["送至暂存间"]);
const PLANNED_STAGING_ACTIONS = new Set(["送至暂存间"]);
const STAGING_KIND_LABELS = {
  "appearance-planned": "计划入库",
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
const isPlannedAppearanceStatus = (status) => PLANNED_APPEARANCE_STATUSES.has(normalizeText(status));
const isAppearanceLocation = (value) => normalizeText(value).includes(APPEARANCE_LOCATION_KEYWORD);
const isPostTestStagingLocation = (value) => normalizeText(value).includes(POST_TEST_STAGING_KEYWORD);
const isPostTestStagingStatus = (status) => normalizeText(status) === "放置实验后暂存间";
const isPlannedStagingStatus = (status) => PLANNED_STAGING_STATUSES.has(normalizeText(status));
const isReturnedStatus = (status) => normalizeLifecycleStatus("", status) === "厂家收回";
const isStagingDestination = (value) => {
  const text = normalizeText(value);
  return text === "staging" || text.includes("暂存间");
};
const isAppearanceEventRoom = (event) =>
  normalizeText(event?.room || event?.storage_room || event?.storageRoom) === "appearance";
const isAppearanceStockInEvent = (event) =>
  normalizeText(event?.action) === "stock_in" && isAppearanceEventRoom(event);
const isStockOutToStaging = (event) =>
  normalizeText(event?.action) === "stock_out"
  && (
    isStagingDestination(event?.target_type || event?.targetType)
    || isStagingDestination(event?.target_lab || event?.targetLab || event?.target_name || event?.targetName)
  );

const buildStagingKind = (kind, status = "", label = "") => ({
  kind,
  label: normalizeText(label) || STAGING_KIND_LABELS[kind],
  status: normalizeText(status) || STAGING_KIND_LABELS[kind],
});

const collectTrayExperimentCodes = ({ experimentTrays, taskCode, trayCode }) => {
  const codes = new Set();
  asArray(experimentTrays).forEach((entry) => {
    if (resolveTaskCode(entry) !== taskCode || resolveTrayCode(entry) !== trayCode) {
      return;
    }
    const experimentCode = resolveExperimentCode(entry);
    if (experimentCode) {
      codes.add(experimentCode);
    }
  });
  return codes;
};

const trayExperimentRunIsCompleted = ({ experimentCode, experimentRunTrays, taskCode, trayCode }) =>
  asArray(experimentRunTrays).some((entry) =>
    resolveTaskCode(entry) === taskCode
    && resolveExperimentCode(entry) === experimentCode
    && resolveTrayCode(entry) === trayCode
    && COMPLETED_EXPERIMENT_STATUSES.has(normalizeLifecycleStatus("", resolveRelationStatus(entry))),
  );

const trayExperimentHistoryIsCompleted = ({ experimentByKey, experimentCode, samples, taskCode, trayCode }) => {
  const relation = {
    experiment: experimentByKey.get(`${taskCode}::${experimentCode}`) || null,
    experiment_code: experimentCode,
    task_code: taskCode,
    tray_code: trayCode,
  };
  return asArray(samples).some((sample) =>
    resolveTaskCode(sample) === taskCode && sampleHasCompletedExperiment(sample, relation),
  );
};

const trayAssignedExperimentsAreCompleted = ({ experimentRunTrays, experimentTrays, experiments, samples, taskCode, trayCode }) => {
  const experimentCodes = collectTrayExperimentCodes({ experimentTrays, taskCode, trayCode });
  if (experimentCodes.size === 0) {
    return false;
  }
  const experimentByKey = buildExperimentByTaskAndCode(experiments);
  return Array.from(experimentCodes).every((experimentCode) =>
    trayExperimentRunIsCompleted({ experimentCode, experimentRunTrays, taskCode, trayCode })
    || trayExperimentHistoryIsCompleted({ experimentByKey, experimentCode, samples, taskCode, trayCode }),
  );
};

const resolveStagingTrayKind = (row, latestEvent) => {
  const latestAction = normalizeText(latestEvent?.action);
  const plannedStatus = row.statuses.find((status) => isPlannedStagingStatus(status));
  if (latestAction === "manufacturer_return" || row.statuses.some((status) => isReturnedStatus(status))) {
    return null;
  }
  if (latestAction === "stock_out" && !isStockOutToStaging(latestEvent) && !plannedStatus && !row.allAssignedExperimentsCompleted) {
    return null;
  }
  if (plannedStatus) {
    return buildStagingKind("planned", plannedStatus);
  }
  if (isStockOutToStaging(latestEvent)) {
    return buildStagingKind("planned", "送至暂存间");
  }
  const plannedAppearanceStatus = row.statuses.find((status) => isPlannedAppearanceStatus(status));
  if (plannedAppearanceStatus) {
    return buildStagingKind("appearance-planned", plannedAppearanceStatus);
  }
  if (
    row.statuses.some((status) => isAppearanceStatus(status))
    || isAppearanceStockInEvent(latestEvent)
  ) {
    const appearanceStatus = row.statuses.find((status) => isAppearanceStatus(status)) || "外观检测间存放";
    return buildStagingKind("appearance", appearanceStatus);
  }
  if (row.hasPostTestStagingLocation || row.statuses.some((status) => isPostTestStagingStatus(status))) {
    return buildStagingKind("post-test", "放置实验后暂存间");
  }
  const currentStatus = row.statuses.find((status) => isCurrentStagingStatus(status));
  if (currentStatus) {
    return buildStagingKind("current", currentStatus);
  }
  if (row.allAssignedExperimentsCompleted) {
    return buildStagingKind("planned", "送至暂存间");
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
  const experimentRunTrays = firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays);
  const experimentTrays = input.experimentTrays || input.experiment_trays;
  const taskByCode = buildTaskByCode(input.tasks);
  const labelsByTray = buildExperimentLabelByTray({
    experiments: input.experiments,
    experimentTrays,
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
        allAssignedExperimentsCompleted: trayAssignedExperimentsAreCompleted({
          experiments: input.experiments,
          experimentRunTrays,
          experimentTrays,
          samples,
          taskCode,
          trayCode,
        }),
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
      current.allAssignedExperimentsCompleted =
        current.allAssignedExperimentsCompleted
        || trayAssignedExperimentsAreCompleted({
          experiments: input.experiments,
          experimentRunTrays,
          experimentTrays,
          samples,
          taskCode,
          trayCode,
        });
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
        allAssignedExperimentsCompleted: trayAssignedExperimentsAreCompleted({
          experiments: input.experiments,
          experimentRunTrays,
          experimentTrays,
          samples,
          taskCode,
          trayCode,
        }),
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
      appearancePlannedTrayCount: trays.filter((tray) => tray.stagingKind === "appearance-planned").length,
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

export { buildStagingSamplesView };
