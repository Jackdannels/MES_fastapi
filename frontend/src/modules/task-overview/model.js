import { aggregateTaskStatusFromSamples, buildTaskStatusLabel } from "@/modules/tasks/model";
import { buildExperimentTypeSummary } from "@/lib/experimentTypes";
import { filterActiveTasks, isReturnedTrayStatus } from "@/lib/taskArchive";
import { buildTrayFlowView, normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";

// 将任务、样品和排程整理为总览卡片和托盘汇总行数据。
const STATUS_WAITING = "待排程";
const STATUS_RUNNING = "任务进行中";
const STATUS_SCHEDULED = "已排程";
const LEGACY_STATUS_RUNNING = "实验中";
const EXPERIMENT_STATUS_RUNNING = "实验进行中";
const STATUS_RETENTION = "厂家收回";
const TRANSFER_STATUS_STORED = "到货";
const LEGACY_TRANSFER_STATUS_STORED = "已入库";
const LEGACY_STATUS_RETENTION = "暂存间排放";
const LEGACY_STATUS_STORAGE = "暂存间存放";
const RETENTION_KEYWORD = "暂存间";
const TASK_COMPLETED_STATUS = "任务已完成";
const EXPERIMENT_COMPLETED_STATUS = "实验已完成";
const LEGACY_TASK_COMPLETED_STATUS = "实验已经完成";
const LEGACY_OVERVIEW_COMPLETED_STATUS = "实验完成";
const OVERDUE_MS = 24 * 60 * 60 * 1000;
const SCHEDULED_EXPERIMENT_STATUSES = new Set([
  "已排程",
  "实验准备就绪",
  "工装夹具安装",
  EXPERIMENT_STATUS_RUNNING,
  "放置实验后暂存间",
  EXPERIMENT_COMPLETED_STATUS,
]);
const STARTED_EXPERIMENT_STATUSES = new Set([
  EXPERIMENT_STATUS_RUNNING,
  EXPERIMENT_COMPLETED_STATUS,
  "实验完成",
  "放置实验后暂存间",
  STATUS_RETENTION,
]);
const COMPLETED_EXPERIMENT_STATUSES = new Set([
  EXPERIMENT_COMPLETED_STATUS,
  "实验完成",
  "放置实验后暂存间",
  STATUS_RETENTION,
]);

// 任务号、样品号、托盘号的展示排序统一走中文比较规则。
function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");
}

// 统一清洗文本字段，后续所有聚合逻辑都基于规范化后的字符串。
function normalizeText(value) {
  return String(value || "").trim();
}

// 历史状态“暂存间排放/暂存间存放”在总览里统一视为“厂家收回”。
function normalizeTaskStatus(value) {
  const normalized = normalizeText(value);
  if (normalized === LEGACY_STATUS_RUNNING || normalized === EXPERIMENT_STATUS_RUNNING) {
    return STATUS_RUNNING;
  }
  if (normalized === LEGACY_STATUS_RETENTION || normalized === LEGACY_STATUS_STORAGE) {
    return STATUS_WAITING;
  }
  if (normalized === STATUS_RETENTION) {
    return STATUS_RETENTION;
  }
  if (
    normalized === LEGACY_TASK_COMPLETED_STATUS
    || normalized === LEGACY_OVERVIEW_COMPLETED_STATUS
    || normalized === EXPERIMENT_COMPLETED_STATUS
    || normalized === TASK_COMPLETED_STATUS
  ) {
    return TASK_COMPLETED_STATUS;
  }
  return normalized;
}

function normalizeExperimentStatus(value) {
  const normalized = normalizeText(value);
  if (normalized === LEGACY_STATUS_RUNNING) {
    return EXPERIMENT_STATUS_RUNNING;
  }
  if (normalized === LEGACY_TASK_COMPLETED_STATUS || normalized === LEGACY_OVERVIEW_COMPLETED_STATUS) {
    return EXPERIMENT_COMPLETED_STATUS;
  }
  return normalized;
}

// 判断排程设备是否属于暂存间，用于区分正式实验和留样暂存。
function isRetentionDevice(value) {
  return normalizeText(value).includes(RETENTION_KEYWORD);
}

// 托盘数量默认至少记 1，避免空值导致统计为 0。
function normalizeQuantity(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function parseTimeValue(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : -1;
}

function resolveFlowViewActiveStatus(flowView, fallbackStatus = "") {
  const activeStep = (Array.isArray(flowView?.steps) ? flowView.steps : [])
    .find((step) => step?.active && normalizeText(step?.label));
  return normalizeText(activeStep?.label) || normalizeText(flowView?.status) || normalizeText(fallbackStatus);
}

function isTaskStored(task) {
  return [TRANSFER_STATUS_STORED, LEGACY_TRANSFER_STATUS_STORED].includes(normalizeText(task?.transfer_status));
}

function upsertLatestSchedule(map, key, schedule) {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) {
    return;
  }
  const current = map.get(normalizedKey);
  if (!current || schedule.timestamp >= current.timestamp) {
    map.set(normalizedKey, schedule);
  }
}

function buildExperimentTrayMap(experimentTrays) {
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
}

function buildTrayExperimentCodeMap(experimentTrays) {
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
}

function resolveExperimentName(experiment) {
  return normalizeText(experiment?.experiment_name)
    || normalizeText(experiment?.experimentName)
    || normalizeText(experiment?.experiment_type)
    || normalizeText(experiment?.experimentType)
    || normalizeText(experiment?.required_device)
    || normalizeText(experiment?.requiredDevice)
    || normalizeText(experiment?.experiment_code)
    || normalizeText(experiment?.experimentCode);
}

function buildTrayAssignedExperimentLabelMap({ experiments = [], experimentTrays = [] }) {
  const experimentInfoByKey = new Map();
  const experimentOrderByKey = new Map();
  (Array.isArray(experiments) ? experiments : []).forEach((experiment, index) => {
    const taskCode = normalizeText(experiment?.task_code || experiment?.taskCode);
    const experimentCode = normalizeText(experiment?.experiment_code || experiment?.experimentCode);
    if (!taskCode || !experimentCode) {
      return;
    }
    const key = `${taskCode}::${experimentCode}`;
    experimentInfoByKey.set(key, {
      label: resolveExperimentName(experiment),
      order: index,
    });
    experimentOrderByKey.set(key, index);
  });

  const assignedByTray = new Map();
  (Array.isArray(experimentTrays) ? experimentTrays : []).forEach((entry, index) => {
    const taskCode = normalizeText(entry?.task_code || entry?.taskCode);
    const trayCode = normalizeText(entry?.tray_code || entry?.trayCode);
    const experimentCode = normalizeText(entry?.experiment_code || entry?.experimentCode);
    if (!taskCode || !trayCode || !experimentCode) {
      return;
    }
    const experimentKey = `${taskCode}::${experimentCode}`;
    const trayKey = `${taskCode}::${trayCode}`;
    const current = assignedByTray.get(trayKey) || [];
    const info = experimentInfoByKey.get(experimentKey);
    current.push({
      code: experimentCode,
      label: info?.label || experimentCode,
      order: info?.order ?? experimentOrderByKey.get(experimentKey) ?? index,
    });
    assignedByTray.set(trayKey, current);
  });

  const labelByTray = new Map();
  assignedByTray.forEach((items, trayKey) => {
    labelByTray.set(
      trayKey,
      buildExperimentTypeSummary(
        items
          .slice()
          .sort((left, right) => left.order - right.order || compareText(left.code, right.code))
          .map((item) => item.label),
      ),
    );
  });
  return labelByTray;
}

function parseExperimentHistoryDetail(detail, taskCode) {
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
}

function collectExperimentMatchedSamples({ experiment, samples, experimentTrayMap }) {
  const taskCode = normalizeText(experiment?.task_code);
  const experimentCode = normalizeText(experiment?.experimentCode || experiment?.experiment_code);
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
    matchedSamples,
    scopedTrayCodes,
    taskCode,
  };
}

function buildExperimentTrayProgress({ matchedSamples, scopedTrayCodes, latestHistoryBySample }) {
  const trayCodes = scopedTrayCodes.size > 0
    ? Array.from(scopedTrayCodes)
    : Array.from(new Set(
      matchedSamples.flatMap((sample) => (Array.isArray(sample?.trays) ? sample.trays : [])
        .map((tray) => normalizeText(tray?.tray_code))
        .filter(Boolean)),
    ));
  if (trayCodes.length === 0) {
    return {
      completedCount: 0,
      totalCount: 0,
    };
  }
  const completedCount = trayCodes.filter((trayCode) => {
    const traySamples = matchedSamples.filter((sample) => (
      (Array.isArray(sample?.trays) ? sample.trays : []).some((tray) => normalizeText(tray?.tray_code) === trayCode)
    ));
    return traySamples.length > 0 && traySamples.every((sample) => {
      const latestStatus = normalizeExperimentStatus(latestHistoryBySample.get(normalizeText(sample?.code))?.status);
      return COMPLETED_EXPERIMENT_STATUSES.has(latestStatus);
    });
  }).length;
  return {
    completedCount,
    totalCount: trayCodes.length,
  };
}

function resolveExperimentLifecycleState({ experiment, samples, experimentTrayMap, trayExperimentCodeMap }) {
  const { matchedSamples, scopedTrayCodes, taskCode } = collectExperimentMatchedSamples({
    experiment,
    samples,
    experimentTrayMap,
  });
  const experimentName =
    normalizeText(experiment?.experimentName)
    || normalizeText(experiment?.experiment_name)
    || normalizeText(experiment?.requiredDevice)
    || normalizeText(experiment?.required_device);
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
        const eventTime = parseTimeValue(entry?.time);
        const existing = latestHistoryBySample.get(sampleCode);
        if (!existing || eventTime >= existing.time) {
          latestHistoryBySample.set(sampleCode, { status: parsed.status, time: eventTime });
        }
      });
    });
  }

  if (latestHistoryBySample.size > 0) {
    const historyStatuses = Array.from(latestHistoryBySample.values()).map((entry) => normalizeExperimentStatus(entry.status));
    const trayProgress = buildExperimentTrayProgress({ matchedSamples, scopedTrayCodes, latestHistoryBySample });
    return {
      completed: matchedSamples.length > 0 && latestHistoryBySample.size === matchedSamples.length && historyStatuses.every((status) => COMPLETED_EXPERIMENT_STATUSES.has(status)),
      started: historyStatuses.some((status) => STARTED_EXPERIMENT_STATUSES.has(status)),
      trayProgress,
    };
  }

  const hasSharedScopedTray = Array.from(scopedTrayCodes).some((trayCode) => (trayExperimentCodeMap.get(`${taskCode}::${trayCode}`)?.size || 0) > 1);
  if (hasSharedScopedTray) {
    return {
      completed: false,
      started: false,
      trayProgress: {
        completedCount: 0,
        totalCount: scopedTrayCodes.size,
      },
    };
  }

  return {
    completed: false,
    started: false,
    trayProgress: {
      completedCount: 0,
      totalCount: 0,
    },
  };
}

function resolveExperimentDisplayStatus({ experiment, matchedSchedule, scheduleLabel, samples, experimentTrayMap, trayExperimentCodeMap, lifecycleState: providedLifecycleState }) {
  const lifecycleState = providedLifecycleState || resolveExperimentLifecycleState({
    experiment,
    samples,
    experimentTrayMap,
    trayExperimentCodeMap,
  });
  if (lifecycleState.started) {
    return lifecycleState.completed ? EXPERIMENT_COMPLETED_STATUS : EXPERIMENT_STATUS_RUNNING;
  }

  const scheduleStatus = normalizeExperimentStatus(matchedSchedule?.status);
  if (scheduleStatus && scheduleStatus !== STATUS_WAITING) {
    return scheduleStatus;
  }

  if (matchedSchedule) {
    return scheduleLabel;
  }

  const experimentStatus = normalizeExperimentStatus(experiment?.status);
  if (
    experimentStatus &&
    experimentStatus !== STATUS_WAITING &&
    experimentStatus !== EXPERIMENT_STATUS_RUNNING
  ) {
    return experimentStatus;
  }

  return STATUS_WAITING;
}

function buildExperimentStatusLabel(displayStatus, trayProgress) {
  const normalizedStatus = normalizeText(displayStatus);
  const completedCount = Number.parseInt(trayProgress?.completedCount, 10);
  const totalCount = Number.parseInt(trayProgress?.totalCount, 10);
  if (
    normalizedStatus === EXPERIMENT_STATUS_RUNNING
    && Number.isFinite(completedCount)
    && Number.isFinite(totalCount)
    && totalCount > 1
    && completedCount > 0
    && completedCount < totalCount
  ) {
    return `${EXPERIMENT_STATUS_RUNNING}（已完成 ${completedCount}/${totalCount} 托盘）`;
  }
  return normalizedStatus;
}

// 构建任务视图模式下展示的任务卡片数据。
function buildTaskRows({
  tasks,
  experiments,
  samples,
  schedules,
  experimentTrays = [],
  scheduledLabel,
  unscheduledLabel,
  now = Date.now(),
}) {
  const sampleList = Array.isArray(samples) ? samples : [];
  const taskList = filterActiveTasks(tasks, sampleList);
  const experimentList = Array.isArray(experiments) ? experiments : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const taskMap = new Map();
  const knownTaskCodes = new Set();
  const experimentsByTaskCode = new Map();
  const formalScheduleByExperimentCode = new Map();
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);

  experimentList.forEach((experiment) => {
    const taskCode = normalizeText(experiment?.task_code);
    if (!taskCode) {
      return;
    }
    const group = experimentsByTaskCode.get(taskCode) || [];
    group.push({
      experimentCode: normalizeText(experiment?.experiment_code),
      experimentName:
        normalizeText(experiment?.experiment_name)
        || normalizeText(experiment?.experiment_type)
        || normalizeText(experiment?.required_device)
        || normalizeText(experiment?.experiment_code),
      requiredDevice: normalizeText(experiment?.required_device),
      status: normalizeExperimentStatus(experiment?.status),
      task_code: taskCode,
      unscheduledSince: parseTimeValue(experiment?.unscheduled_since),
    });
    experimentsByTaskCode.set(taskCode, group);
  });

  scheduleList.forEach((entry) => {
    if (isRetentionDevice(entry?.device)) {
      return;
    }
    const schedule = {
      device: normalizeText(entry?.device),
      status: normalizeExperimentStatus(entry?.status),
      timestamp: parseTimeValue(entry?.start_at || entry?.created_at),
    };
    upsertLatestSchedule(formalScheduleByExperimentCode, entry?.experiment_code, schedule);
  });

  // 先以任务为主表建初始行，样品和排程后续再补充到对应任务上。
  taskList.forEach((task) => {
    const code = String(task?.code || "").trim();
    if (!code) {
      return;
    }
    knownTaskCodes.add(code);
    const taskExperiments = (experimentsByTaskCode.get(code) || []).slice().sort((left, right) => compareText(left.experimentCode, right.experimentCode));
    taskMap.set(code, {
      taskCode: code,
      taskType: normalizeText(task?.test_type || task?.name),
      taskStatus: normalizeTaskStatus(task?.status),
      transfer_status: normalizeText(task?.transfer_status),
      plannedCount: Number.isFinite(Number(task?.sample_count)) ? Number(task.sample_count) : "",
      timeValue: normalizeText(task?.arrival_at || task?.created_at || task?.due_at),
      sampleCodes: [],
      trays: [],
      returnedTrays: [],
      scheduleCount: 0,
      retentionCount: 0,
      experiments: taskExperiments,
      experimentCount: taskExperiments.length || Number.parseInt(task?.experiment_count, 10) || 0,
    });
  });

  sampleList.forEach((sample) => {
    const taskCode = String(sample?.task_code || "").trim();
    const sampleCode = String(sample?.code || "").trim();
    if (!taskCode || !sampleCode || !knownTaskCodes.has(taskCode)) {
      return;
    }
    const row = taskMap.get(taskCode);
    // 一个任务可能对应多个样品编码，后续会在输出阶段去重排序。
    row.sampleCodes.push(sampleCode);
    if (Array.isArray(sample?.trays)) {
      sample.trays.forEach((tray) => {
        const trayCode = String(tray?.tray_code || "").trim();
        if (!trayCode) {
          return;
        }
        const status = normalizeLifecycleStatus(sample?.location, tray?.status || sample?.status);
        if (
          isReturnedTrayStatus(status)
          || isReturnedTrayStatus(tray?.status)
          || isReturnedTrayStatus(sample?.status)
          || isReturnedTrayStatus(sample?.location)
        ) {
          row.returnedTrays.push({
            trayCode,
            sampleCode,
            status,
            quantity: normalizeQuantity(tray?.quantity),
          });
          return;
        }
        row.trays.push({
          trayCode,
          sampleCode,
          status,
          quantity: normalizeQuantity(tray?.quantity),
        });
      });
    }
  });

  scheduleList.forEach((entry) => {
    const taskCode = String(entry?.task_code || "").trim();
    if (!taskCode || !knownTaskCodes.has(taskCode)) {
      return;
    }
    const row = taskMap.get(taskCode);
    // 暂存间排程单独累计，正式实验排程累计到 scheduleCount。
    if (isRetentionDevice(entry?.device)) {
      row.retentionCount += 1;
    } else {
      row.scheduleCount = 1;
    }
    if (!row.taskStatus) {
      row.taskStatus = normalizeTaskStatus(entry?.status);
    }
    if (!row.timeValue) {
      row.timeValue = normalizeText(entry?.start_at || entry?.created_at);
    }
  });

  return Array.from(taskMap.values())
    .map((row) => {
      // 样品编码先去重再排序，避免同一编码因多托盘重复出现。
      const uniqueSampleCodes = Array.from(new Set(row.sampleCodes)).sort(compareText);
      const trayMap = new Map();
      row.trays.forEach((tray) => {
        if (!trayMap.has(tray.trayCode)) {
          trayMap.set(tray.trayCode, {
            trayCode: tray.trayCode,
            sampleCodes: [],
            status: normalizeLifecycleStatus("", tray.status),
            totalQuantity: 0,
          });
        }
        const current = trayMap.get(tray.trayCode);
        if (!current.sampleCodes.includes(tray.sampleCode)) {
          current.sampleCodes.push(tray.sampleCode);
        }
        current.totalQuantity += normalizeQuantity(tray.quantity);
      });

      // 托盘维度把同 trayCode 的槽位聚合成一条记录，并列出其样品编码。
      const trays = Array.from(trayMap.values())
        .map((item) => ({
          ...item,
          sampleCodes: item.sampleCodes.slice().sort(compareText),
        }))
        .sort((left, right) => compareText(left.trayCode, right.trayCode));
      const returnedTrayCodes = Array.from(new Set(row.returnedTrays.map((tray) => tray.trayCode).filter(Boolean))).sort(compareText);
      const originalTrayCodes = Array.from(new Set([
        ...trays.map((tray) => tray.trayCode),
        ...returnedTrayCodes,
      ])).sort(compareText);

      const scheduleLabel = row.scheduleCount > 0 ? scheduledLabel : unscheduledLabel;
      const aggregatedStatus = normalizeTaskStatus(
        aggregateTaskStatusFromSamples(
          { code: row.taskCode },
          sampleList.filter((sample) => normalizeText(sample?.task_code) === row.taskCode),
        ),
      );
      const experiments = row.experiments.map((experiment) => {
        const lifecycleState = resolveExperimentLifecycleState({
          experiment,
          samples: sampleList,
          experimentTrayMap,
          trayExperimentCodeMap,
        });
        const displayStatus = resolveExperimentDisplayStatus({
          experiment,
          matchedSchedule: formalScheduleByExperimentCode.get(experiment.experimentCode),
          scheduleLabel,
          samples: sampleList,
          experimentTrayMap,
          trayExperimentCodeMap,
          lifecycleState,
        });
        return {
          ...experiment,
          displayStatus,
          displayStatusLabel: buildExperimentStatusLabel(displayStatus, lifecycleState.trayProgress),
          isOverdueWaiting:
            isTaskStored(row) &&
            normalizeText(displayStatus) === STATUS_WAITING &&
            Number.isFinite(experiment.unscheduledSince) &&
            now - experiment.unscheduledSince > OVERDUE_MS,
          trayProgress: lifecycleState.trayProgress,
        };
      });
      const completedExperimentCount = experiments.filter(
        (experiment) => normalizeText(experiment.displayStatus) === EXPERIMENT_COMPLETED_STATUS,
      ).length;
      const runningExperimentCount = experiments.filter(
        (experiment) => normalizeText(experiment.displayStatus) === EXPERIMENT_STATUS_RUNNING,
      ).length;
      const scheduledExperimentCount = experiments.filter(
        (experiment) => SCHEDULED_EXPERIMENT_STATUSES.has(normalizeText(experiment.displayStatus)),
      ).length;
      const hasPartialCompletion = experiments.length > 0 && completedExperimentCount > 0 && completedExperimentCount < experiments.length;
      const experimentProgress = {
        completedCount: completedExperimentCount,
        hasPartialCompletion,
        isFullyCompleted: experiments.length > 0 && completedExperimentCount === experiments.length,
        totalCount: experiments.length,
      };
      // 任务概览优先使用实验级结果构建任务状态，避免共享托盘的样品状态把未排实验顶成进行中。
      const currentStatus =
        experiments.length > 0
          ? row.taskStatus === STATUS_RETENTION
            ? STATUS_RETENTION
            : aggregatedStatus === STATUS_RETENTION
            ? STATUS_RETENTION
            : experimentProgress.isFullyCompleted
              ? TASK_COMPLETED_STATUS
              : runningExperimentCount > 0 || experimentProgress.hasPartialCompletion
                ? STATUS_RUNNING
                : scheduledExperimentCount > 0
                  ? STATUS_SCHEDULED
                  : STATUS_WAITING
          : row.taskStatus === STATUS_RETENTION
            ? STATUS_RETENTION
            : aggregatedStatus === STATUS_RETENTION
            ? STATUS_RETENTION
            : aggregatedStatus || row.taskStatus || (row.retentionCount > 0 ? STATUS_WAITING : scheduleLabel);
      const currentStatusLabel = buildTaskStatusLabel(currentStatus, experimentProgress);
      const experimentSummary =
        row.experiments.length > 0
          ? buildExperimentTypeSummary(row.experiments.map((experiment) => experiment.requiredDevice || experiment.experimentName))
          : buildExperimentTypeSummary(row.taskType);

      return {
        ...row,
        currentStatus,
        currentStatusLabel,
        eligibleExperimentCount: currentStatus === STATUS_RETENTION ? 0 : experiments.length,
        scheduleLabel,
        scheduledExperimentCount: currentStatus === STATUS_RETENTION ? 0 : scheduledExperimentCount,
        sampleCodes: uniqueSampleCodes,
        sampleCount: uniqueSampleCodes.length,
        taskType: buildExperimentTypeSummary(row.taskType),
        trays,
        returnedTrayCodes,
        returnedTrayCount: returnedTrayCodes.length,
        unfinishedTrayCount: trays.length,
        originalTrayCount: originalTrayCodes.length,
        experiments,
        experimentCount: row.experimentCount,
        experimentSummary,
      };
    })
    .sort((left, right) => compareText(left.taskCode, right.taskCode));
}

// 构建托盘视图模式下逐槽位展示的托盘汇总数据。
function buildTrayOverviewRows({
  tasks,
  experiments = [],
  experimentRuns = [],
  experimentRunTrays = [],
  experimentTrays = [],
  samples,
  schedules,
  totalSlots,
  unassignedExperimentLabel,
}) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const sampleList = Array.isArray(samples) ? samples : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const activeTaskList = filterActiveTasks(taskList, sampleList);

  const taskTypeByCode = new Map();
  // 任务号到试验类型的映射用于给托盘视图补齐目标试验名称。
  activeTaskList.forEach((task) => {
    const code = String(task?.code || "").trim();
    if (!code) {
      return;
    }
    taskTypeByCode.set(code, String(task?.test_type || task?.name || "").trim());
  });

  const experimentList = Array.isArray(experiments) ? experiments : [];
  const experimentTrayList = Array.isArray(experimentTrays) ? experimentTrays : [];
  const trayAssignedExperimentLabelMap = buildTrayAssignedExperimentLabelMap({
    experiments: experimentList,
    experimentTrays: experimentTrayList,
  });

  const trayMap = new Map();
  const summarizeUniqueTexts = (values, fallback = "-") => {
    const unique = Array.from(new Set(values.map(normalizeText).filter(Boolean))).sort(compareText);
    return unique.length ? unique.join("、") : fallback;
  };

  sampleList.forEach((sample) => {
    const taskCode = String(sample?.task_code || "").trim();
    if (!taskCode || !taskTypeByCode.has(taskCode)) {
      return;
    }
    (Array.isArray(sample?.trays) ? sample.trays : []).forEach((tray) => {
      const trayCode = String(tray?.tray_code || "").trim();
      const trayMapKey = `${taskCode}::${trayCode}`;
      // 托盘视图按任务和托盘共同唯一，避免不同任务复用同一托盘号时互相覆盖。
      if (!trayCode || trayMap.has(trayMapKey)) {
        return;
      }
      const location = summarizeUniqueTexts([sample?.location]);
      const status = normalizeLifecycleStatus(location, normalizeText(tray?.status) || normalizeText(sample?.status));
      if (
        isReturnedTrayStatus(status)
        || isReturnedTrayStatus(tray?.status)
        || isReturnedTrayStatus(sample?.status)
        || isReturnedTrayStatus(location)
      ) {
        return;
      }
      const targetExperiment =
        trayAssignedExperimentLabelMap.get(trayMapKey)
        || taskTypeByCode.get(taskCode)
        || "-";
      const flowView = buildTrayFlowView({
        experimentRuns,
        experimentRunTrays,
        experimentTrays: experimentTrayList,
        experiments: experimentList,
        location,
        samples: sampleList,
        schedules: scheduleList,
        status,
        taskCode,
        trayCode,
      });
      const currentStatus = resolveFlowViewActiveStatus(flowView, status);
      trayMap.set(trayMapKey, {
        canonicalStatus: normalizeText(flowView?.canonicalStatus) || normalizeText(flowView?.status) || status,
        trayCode,
        taskCode,
        targetExperiment,
        currentLocation: location,
        currentStatus,
        hasTray: true,
      });
    });
  });

  const existingTrays = Array.from(trayMap.values())
    .sort((left, right) => compareText(left.trayCode, right.trayCode))
    .slice(0, totalSlots);

  return Array.from({ length: totalSlots }, (_, index) => {
    const slotCode = `TP-${String(index + 1).padStart(3, "0")}`;
    const tray = existingTrays[index];
    if (tray) {
      // 有实物托盘时，槽位编码与托盘编码分开保留，便于页面同时展示“槽位”和“托盘”。
      return {
        slotCode,
        trayCode: tray.trayCode,
        taskCode: tray.taskCode || "-",
        targetExperiment: tray.targetExperiment || "-",
        currentLocation: tray.currentLocation || "-",
        currentStatus: tray.currentStatus || "-",
        canonicalStatus: tray.canonicalStatus || tray.currentStatus || "-",
        hasTray: true,
      };
    }
    // 空槽位用占位数据补齐，保证页面总是渲染 totalSlots 个槽位。
    return {
      slotCode,
      trayCode: slotCode,
      taskCode: "-",
      targetExperiment: unassignedExperimentLabel,
      isScheduled: false,
      currentLocation: "-",
      currentStatus: "-",
      hasTray: false,
    };
  });
}

export { buildTaskRows, buildTrayOverviewRows };
