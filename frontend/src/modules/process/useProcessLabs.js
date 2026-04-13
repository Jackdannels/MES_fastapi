// 围绕实验室占用情况和任务下钻构建过程管控页状态。
import { computed, onMounted, ref } from "vue";

import { PROCESS_LABS, buildProcessLabCards } from "./model";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import {
  buildTrayFlowView,
  normalizeLifecycleStatus,
  resolveFlowStatusByLocation,
  synchronizeSamplesForTrayCodes,
} from "@/modules/samples/samplesFlowModel";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/useSampleIntake";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";

const PROCESS_FILTERS = {
  idle: "idle",
  overview: "overview",
  running: "running",
  scheduled: "scheduled",
};

const TRAY_STATUS_READY = "实验准备就绪";
const TRAY_STATUS_RUNNING = "实验进行中";
const TASK_STATUS_RUNNING = "任务进行中";
const RUNNING_TRAY_STATUSES = new Set([TRAY_STATUS_RUNNING, "实验中"]);
const COMPLETED_TRAY_STATUSES = new Set(["实验完成", "实验已完成", "放置实验后暂存间", "厂家收回"]);

// 为抽屉详情提供统一的文案兜底，避免页面出现空串。
const toText = (value, fallback = "-") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

// 数量字段在为 0 时保留数值，其余空值走占位符。
const toCount = (value) => {
  if (value === 0 || value === "0") {
    return 0;
  }
  return value ? value : "-";
};

const BATCH_SUFFIX_PATTERNS = [
  /(?:\s*[-/|]\s*|\s+)?batch\s*[a-z0-9_-]*$/i,
  /(?:\s*[-/|]\s*|\s+)?\u6279\u6b21\s*[a-z0-9_-]*$/i,
];

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const API_BASE_URL = getFrontendApiBaseUrl();

// 任务名称里如果带“批次 / batch”后缀，抽屉标题会裁掉这部分噪音。
const sanitizeTaskDisplayName = (value, fallback = "-") => {
  let normalized = String(value ?? "").trim();
  if (!normalized) {
    return fallback;
  }
  BATCH_SUFFIX_PATTERNS.forEach((pattern) => {
    normalized = normalized.replace(pattern, "").trim();
  });
  return normalized || fallback;
};

const appendSampleHistory = (sample, action, detail = "", now = new Date().toISOString()) => {
  const history = Array.isArray(sample?.history) ? sample.history.slice() : [];
  history.unshift({
    action,
    detail,
    id: `process-event-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    location: normalizeText(sample?.location),
    owner: normalizeText(sample?.owner),
    status: normalizeText(sample?.status),
    time: now,
  });
  return history;
};

const summarizeUniqueTexts = (values, fallback = "-") => {
  const unique = Array.from(new Set(asArray(values).map(normalizeText).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN"),
  );
  return unique.length ? unique.join("、") : fallback;
};

const parseScheduleTime = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const normalizeLocationList = (locations) =>
  Array.from(new Set(asArray(locations).map(normalizeText).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN"),
  );

const trayBelongsToLab = (trayRow, labName) => {
  const normalizedLabName = normalizeText(labName);
  if (!normalizedLabName) {
    return false;
  }
  const locationNames = normalizeLocationList(trayRow?.locationNames);
  if (locationNames.length === 0) {
    return false;
  }
  return locationNames.includes(normalizedLabName);
};

const trayHasUnknownLocation = (trayRow) => normalizeLocationList(trayRow?.locationNames).length === 0;

const resolveScheduleDurationHours = (schedule) => {
  const plannedHours = Number(schedule?.planned_hours);
  if (Number.isFinite(plannedHours) && plannedHours > 0) {
    return plannedHours;
  }

  const startAt = parseScheduleTime(schedule?.start_at);
  const endAt = parseScheduleTime(schedule?.end_at);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    return 0;
  }
  return (endAt - startAt) / (60 * 60 * 1000);
};

// 加载快照数据，并输出实验室卡片及当前任务的抽屉详情。
function useProcessLabs(options = {}) {
  const labs = Array.isArray(options.labs) ? options.labs : PROCESS_LABS;
  const storage =
    options.storage ||
    useStorageSnapshot([
      STORAGE_KEYS.tasks,
      STORAGE_KEYS.schedules,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.experiments,
    ]);
  const loadSnapshot = options.loadSnapshot || storage.loadSnapshot;
  const persistSnapshot = options.persistSnapshot || storage.persistSnapshot || (async () => {});
  const loadTransferWorkspace =
    options.loadTransferWorkspace ||
    (async (taskCode) => {
      const normalizedTaskCode = normalizeText(taskCode);
      if (!normalizedTaskCode) {
        return null;
      }
      try {
        const response = await fetch(buildApiUrl(`/api/transfer-area/tasks/${encodeURIComponent(normalizedTaskCode)}/workspace`, API_BASE_URL), {
          headers: { Accept: "application/json" },
          credentials: "include",
        });
        if (!response.ok) {
          return null;
        }
        return await response.json();
      } catch {
        return null;
      }
    });
  const autoLoad = options.autoLoad !== false;
  const now = options.now;

  const loading = ref(false);
  const labCards = ref([]);
  const tasks = ref([]);
  const schedules = ref([]);
  const samples = ref([]);
  const experimentTrays = ref([]);
  const experiments = ref([]);
  const transferWorkspaceByTaskCode = ref({});
  const activeFilter = ref(PROCESS_FILTERS.overview);
  const processActionMessage = ref("");
  const selectedTaskDetail = ref(null);
  const selectedTaskLabName = ref("");
  const selectedTaskCodeByLab = ref({});
  const selectedTrayCode = ref("");
  const startExperimentLabName = ref("");
  const startExperimentModalOpen = ref(false);
  const startExperimentTaskDetail = ref(null);
  const taskDrawerOpen = ref(false);

  const findTaskByCode = (taskCode) => tasks.value.find((item) => normalizeText(item?.code) === taskCode) || null;
  const currentTimeValue = () => (Number.isFinite(now) ? now : Date.now());
  const getLabSchedules = (labName) =>
    schedules.value
      .filter((entry) => normalizeText(entry?.device) === normalizeText(labName))
      .sort((left, right) => parseScheduleTime(left?.start_at) - parseScheduleTime(right?.start_at));
  const resolveSelectedTaskCodeForLab = (labName, fallback = "") =>
    normalizeText(selectedTaskCodeByLab.value[normalizeText(labName)]) || normalizeText(fallback);

  const getTaskSamples = (taskCode) => samples.value.filter((sample) => normalizeText(sample?.task_code) === taskCode);
  const getTransferWorkspace = (taskCode) => transferWorkspaceByTaskCode.value[taskCode] || null;
  const getScheduledExperimentName = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    if (!normalizedTaskCode || !normalizedExperimentCode) {
      return "";
    }

    const matchedExperiment = experiments.value.find(
      (entry) =>
        normalizeText(entry?.task_code) === normalizedTaskCode
        && normalizeText(entry?.experiment_code) === normalizedExperimentCode
    );
    return normalizeText(matchedExperiment?.experiment_name);
  };
  const buildAvailableTasksForLab = (labName) => {
    const rows = [];
    const seen = new Set();
    getLabSchedules(labName).forEach((schedule) => {
      const taskCode = normalizeText(schedule?.task_code);
      if (!taskCode || seen.has(taskCode)) {
        return;
      }
      seen.add(taskCode);
      rows.push({
        experimentCode: normalizeText(schedule?.experiment_code),
        experimentName: getScheduledExperimentName(taskCode, normalizeText(schedule?.experiment_code)),
        scheduleTime: `${toText(schedule?.start_at)} - ${toText(schedule?.end_at)}`,
        taskCode,
      });
    });
    return rows;
  };
  const collectExperimentTrayCodes = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    if (!normalizedTaskCode || !normalizedExperimentCode) {
      return [];
    }

    const trayCodes = new Set();
    experimentTrays.value.forEach((entry) => {
      if (
        normalizeText(entry?.task_code) !== normalizedTaskCode
        || normalizeText(entry?.experiment_code) !== normalizedExperimentCode
      ) {
        return;
      }
      const trayCode = normalizeText(entry?.tray_code);
      if (trayCode) {
        trayCodes.add(trayCode);
      }
    });

    return Array.from(trayCodes).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  };

  const collectTaskTrayCodes = (taskCode, task = null, experimentCode = "") => {
    const experimentTrayCodes = collectExperimentTrayCodes(taskCode, experimentCode);
    if (experimentTrayCodes.length) {
      return experimentTrayCodes;
    }

    const trayCodes = new Set();
    const matchedTask = task || findTaskByCode(taskCode);

    if (Array.isArray(matchedTask?.tray_codes)) {
      matchedTask.tray_codes.forEach((code) => {
        const normalized = normalizeText(code);
        if (normalized) {
          trayCodes.add(normalized);
        }
      });
    }

    experimentTrays.value.forEach((entry) => {
      if (normalizeText(entry?.task_code) !== taskCode) {
        return;
      }
      const normalized = normalizeText(entry?.tray_code);
      if (normalized) {
        trayCodes.add(normalized);
      }
    });

    asArray(getTransferWorkspace(taskCode)?.assignedTrays).forEach((tray) => {
      const normalized = normalizeText(tray?.trayNo);
      if (normalized) {
        trayCodes.add(normalized);
      }
    });

    getTaskSamples(taskCode).forEach((sample) => {
      asArray(sample?.trays).forEach((tray) => {
        const normalized = normalizeText(tray?.tray_code);
        if (normalized) {
          trayCodes.add(normalized);
        }
      });
    });

    return Array.from(trayCodes).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  };

  const buildTaskFallbackTrayContext = (taskCode, trayCodeSet = null) => {
    const taskSamples = getTaskSamples(taskCode).slice().sort((left, right) => (
      normalizeText(left?.code).localeCompare(normalizeText(right?.code), "zh-Hans-CN")
    ));
    const filteredSamples = trayCodeSet
      ? taskSamples.filter((sample) => asArray(sample?.trays).some((tray) => trayCodeSet.has(normalizeText(tray?.tray_code))))
      : taskSamples;
    const primarySample = filteredSamples[0] || taskSamples[0] || null;
    const fallbackStatus = normalizeLifecycleStatus(primarySample?.location, normalizeText(primarySample?.status));

    return {
      flowStatus: resolveFlowStatusByLocation(primarySample?.location, fallbackStatus),
      locationSummary: summarizeUniqueTexts((filteredSamples.length ? filteredSamples : taskSamples).map((sample) => sample?.location)),
      ownerSummary: summarizeUniqueTexts((filteredSamples.length ? filteredSamples : taskSamples).map((sample) => sample?.owner)),
      status: fallbackStatus,
    };
  };

  const buildTraySummary = (taskCode, task, experimentCode = "") => {
    const ordered = collectTaskTrayCodes(taskCode, task, experimentCode);
    const visible = ordered.slice(0, 3);
    const remaining = ordered.length - visible.length;

    return {
      trayCodes: ordered,
      trayCount: ordered.length,
      traySummary: ordered.length === 0 ? "未分配托盘" : `${visible.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`,
    };
  };

  const buildTrayRows = (taskCode, task = null, experimentCode = "") => {
    const trayMap = new Map();
    const scopedTrayCodes = collectExperimentTrayCodes(taskCode, experimentCode);
    const scopedTrayCodeSet = scopedTrayCodes.length ? new Set(scopedTrayCodes) : null;
    const fallbackContext = buildTaskFallbackTrayContext(taskCode, scopedTrayCodeSet);
    const workspaceTrays = asArray(getTransferWorkspace(taskCode)?.assignedTrays);

    collectTaskTrayCodes(taskCode, task, experimentCode).forEach((trayCode) => {
      trayMap.set(trayCode, {
        flowStatuses: [],
        locations: [],
        owners: [],
        sampleCodes: [],
        status: "",
        trayCode,
      });
    });

    getTaskSamples(taskCode).forEach((sample) => {
      if (normalizeText(sample?.task_code) !== taskCode) {
        return;
      }

      asArray(sample?.trays).forEach((tray, index) => {
        const trayCode = normalizeText(tray?.tray_code) || `${taskCode}-tray-${index + 1}`;
        if (!trayCode) {
          return;
        }
        if (scopedTrayCodeSet && !scopedTrayCodeSet.has(trayCode)) {
          return;
        }

        if (!trayMap.has(trayCode)) {
          trayMap.set(trayCode, {
            flowStatuses: [],
            locations: [],
            owners: [],
            sampleCodes: [],
            status: normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || normalizeText(sample?.status)),
            trayCode,
          });
        }

        const row = trayMap.get(trayCode);
        const sampleCode = normalizeText(sample?.code);
        if (sampleCode && !row.sampleCodes.includes(sampleCode)) {
          row.sampleCodes.push(sampleCode);
        }
        if (!row.status) {
          row.status = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || normalizeText(sample?.status));
        }
        row.locations.push(normalizeText(sample?.location));
        row.owners.push(normalizeText(sample?.owner));
        row.flowStatuses.push(
          resolveFlowStatusByLocation(sample?.location, normalizeText(tray?.status) || normalizeText(sample?.status)),
        );
      });
    });

    workspaceTrays.forEach((tray) => {
      const trayCode = normalizeText(tray?.trayNo);
      if (!trayCode) {
        return;
      }
      if (scopedTrayCodeSet && !scopedTrayCodeSet.has(trayCode)) {
        return;
      }

      if (!trayMap.has(trayCode)) {
        trayMap.set(trayCode, {
          flowStatuses: [],
          locations: [],
          owners: [],
          sampleCodes: [],
          status: "",
          trayCode,
        });
      }

      const row = trayMap.get(trayCode);
      const traySamples = asArray(tray?.samples);
      const fallbackStatus = normalizeLifecycleStatus("", normalizeText(tray?.trayStatus) || normalizeText(traySamples[0]?.sampleStatus));
      if (!row.status && fallbackStatus) {
        row.status = fallbackStatus;
      }
      if (row.flowStatuses.length === 0 && fallbackStatus) {
        row.flowStatuses.push(resolveFlowStatusByLocation("", fallbackStatus));
      }
      traySamples.forEach((sample) => {
        const sampleCode = normalizeText(sample?.sampleNo);
        if (sampleCode && !row.sampleCodes.includes(sampleCode)) {
          row.sampleCodes.push(sampleCode);
        }
      });
    });

    return Array.from(trayMap.values())
      .map((row) => {
        const status = normalizeText(row.status) || fallbackContext.status;
        const sampleCodes = row.sampleCodes.slice().sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
        return {
          flowStatus: row.flowStatuses.length ? summarizeUniqueTexts(row.flowStatuses) : toText(fallbackContext.flowStatus),
          isCompleted: COMPLETED_TRAY_STATUSES.has(status),
          isReady: status === TRAY_STATUS_READY,
          isRunning: RUNNING_TRAY_STATUSES.has(status),
          locationNames: normalizeLocationList(row.locations),
          locationSummary: summarizeUniqueTexts(row.locations, fallbackContext.locationSummary),
          ownerSummary: summarizeUniqueTexts(row.owners, fallbackContext.ownerSummary),
          sampleCodes,
          sampleCount: sampleCodes.length,
          sampleSummary: sampleCodes.length ? sampleCodes.join("、") : "-",
          status,
          trayCode: row.trayCode,
        };
      })
      .sort((left, right) => left.trayCode.localeCompare(right.trayCode, "zh-Hans-CN"));
  };

  const buildStartExperimentState = (trayRows, options = {}) => {
    const rows = asArray(trayRows);
    const normalizedLabName = normalizeText(options.labName);
    const matchesLab = (row) =>
      !normalizedLabName || trayBelongsToLab(row, normalizedLabName) || trayHasUnknownLocation(row);
    const readyTrayRows = rows.filter((row) => row.isReady && matchesLab(row));
    const runningTrayRows = rows.filter((row) => row.isRunning && matchesLab(row));
    const remainingTrayRows = rows.filter((row) => !row.isRunning && !row.isCompleted);

    return {
      canStartExperiment: readyTrayRows.length > 0 && runningTrayRows.length === 0,
      readyTrayCodes: readyTrayRows.map((row) => row.trayCode),
      readyTrayCount: readyTrayRows.length,
      remainingTrayCount: remainingTrayRows.length,
      runningTrayCount: runningTrayRows.length,
      startDisabledReason:
        runningTrayRows.length > 0 ? "当前批次实验未结束" : readyTrayRows.length === 0 ? "暂无可启动托盘" : "",
    };
  };

  const resolveScheduledRecordForLab = (lab, taskCode, currentTime, experimentCode = "") => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedLabName = normalizeText(lab?.name);
    const normalizedExperimentCode = normalizeText(experimentCode);
    const relatedSchedules = schedules.value
      .filter(
        (entry) =>
          normalizeText(entry?.device) === normalizedLabName
          && normalizeText(entry?.task_code) === normalizedTaskCode
          && (!normalizedExperimentCode || normalizeText(entry?.experiment_code) === normalizedExperimentCode),
      )
      .sort((left, right) => parseScheduleTime(left?.start_at) - parseScheduleTime(right?.start_at));

    const activeSchedule = relatedSchedules.find((entry) => {
      const startAt = parseScheduleTime(entry?.start_at);
      const endAt = parseScheduleTime(entry?.end_at);
      return Number.isFinite(startAt) && Number.isFinite(endAt) && startAt <= currentTime && endAt >= currentTime;
    });
    if (activeSchedule) {
      return activeSchedule;
    }

    const futureSchedule = relatedSchedules.find((entry) => parseScheduleTime(entry?.start_at) > currentTime);
    return futureSchedule || relatedSchedules[relatedSchedules.length - 1] || null;
  };

  const buildTaskDetail = (lab) => {
    const taskCode = toText(lab?.taskCode, "");
    const labName = toText(lab?.name);
    const task =
      tasks.value.find((item) => normalizeText(item?.code) === taskCode) ||
      tasks.value.find((item) => normalizeText(item?.required_device) === normalizeText(lab?.testType)) ||
      null;
    const relatedSchedules = schedules.value
      .filter((entry) => normalizeText(entry?.device) === normalizeText(lab?.name))
      .sort((left, right) => Date.parse(String(right?.start_at || "")) - Date.parse(String(left?.start_at || "")));
    const schedule =
      relatedSchedules.find((entry) => normalizeText(entry?.task_code) === taskCode) || relatedSchedules[0] || null;
    const activeExperimentCode = normalizeText(schedule?.experiment_code);
    const scheduledExperimentName = getScheduledExperimentName(taskCode, activeExperimentCode);
    const hasScopedExperimentTrays = collectExperimentTrayCodes(taskCode, activeExperimentCode).length > 0;
    const { trayCodes, trayCount, traySummary } = buildTraySummary(taskCode, task, activeExperimentCode);
    const trayRows = buildTrayRows(taskCode, task, activeExperimentCode);
    const readyTrayRows = trayRows.filter((row) => row.isReady);
    const runningTrayRows = trayRows.filter((row) => row.isRunning);
    const remainingTrayRows = trayRows.filter((row) => !row.isRunning && !row.isCompleted);
    const completedTrayRows = trayRows.filter((row) => row.isCompleted);
    const actionState = buildStartExperimentState(trayRows, { labName });
    const activeTray =
      trayRows.find((row) => row.trayCode === selectedTrayCode.value) ||
      runningTrayRows[0] ||
      trayRows.find((row) => row.isReady) ||
      remainingTrayRows[0] ||
      trayRows[0] ||
      null;
    const filteredSampleCount = Array.from(new Set(trayRows.flatMap((row) => row.sampleCodes))).length;

    return {
      code: taskCode || "-",
      completedTrayRows,
      canStartExperiment: actionState.canStartExperiment,
      displayName: sanitizeTaskDisplayName(task?.name, toText(task?.test_type, "-")),
      dueAt: toText(task?.due_at),
      labName,
      name: toText(task?.name),
      priority: toText(task?.priority),
      readyTrayCount: actionState.readyTrayCount,
      remainingTrayCount: actionState.remainingTrayCount,
      remainingTrayRows,
      requiredDevice: toText(task?.required_device, labName),
      runningTrayCount: actionState.runningTrayCount,
      runningTrayRows,
      sampleCount: hasScopedExperimentTrays ? filteredSampleCount || toCount(task?.sample_count) : toCount(task?.sample_count),
      scheduleTime: toText(schedule ? `${lab?.scheduleTime || ""}` : lab?.scheduleTime),
      selectedTrayCode: activeTray?.trayCode || "",
      selectedTrayFlow: activeTray
        ? buildTrayFlowView({
            currentExperimentCode: activeExperimentCode,
            experimentTrays: experimentTrays.value,
            experiments: experiments.value,
            location: activeTray.locationSummary,
            samples: samples.value,
            schedules: schedules.value,
            status: activeTray.flowStatus || activeTray.status,
            taskCode,
            trayCode: activeTray.trayCode,
          })
        : buildTrayFlowView(),
      selectedTraySummary: activeTray,
      activeExperimentCode,
      availableTasks: buildAvailableTasksForLab(labName),
      source: toText(task?.source),
      readyTrayRows,
      startDisabledReason: actionState.startDisabledReason,
      status: toText(task?.status, toText(lab?.status)),
      targetExperiment: toText(scheduledExperimentName, toText(task?.test_type, toText(lab?.targetExperiment))),
      testType: toText(scheduledExperimentName, toText(task?.test_type, toText(lab?.testType))),
      trayCodes,
      trayCount,
      trayRows,
      traySummary,
    };
  };

  const enrichLabCard = (lab) => {
    const selectedTaskCode = resolveSelectedTaskCodeForLab(lab?.name, lab?.taskCode);
    const sourceSchedules = selectedTaskCode
      ? schedules.value.filter(
          (entry) =>
            normalizeText(entry?.device) === normalizeText(lab?.name) && normalizeText(entry?.task_code) === selectedTaskCode,
        )
      : schedules.value;
    const scopedLab =
      buildProcessLabCards([lab], tasks.value, sourceSchedules, samples.value, currentTimeValue(), experiments.value, experimentTrays.value)[0]
      || lab;

    if (!scopedLab?.hasTask) {
      return {
        ...scopedLab,
        canStartExperiment: false,
        readyTrayCount: 0,
        remainingTrayCount: 0,
        runningTrayCount: 0,
        startDisabledReason: "当前无任务",
      };
    }

    const taskCode = normalizeText(scopedLab.taskCode);
    const task = findTaskByCode(taskCode);
    const schedule = resolveScheduledRecordForLab(scopedLab, taskCode, currentTimeValue());
    const activeExperimentCode = normalizeText(schedule?.experiment_code);
    const scopedTrayRows = buildTrayRows(taskCode, task, activeExperimentCode);
    const actionState = buildStartExperimentState(scopedTrayRows, { labName: scopedLab?.name });
    const scheduledExperimentName = getScheduledExperimentName(taskCode, activeExperimentCode);
    const hasScheduledTask = Boolean(scopedLab?.hasTask);
    const status = actionState.runningTrayCount > 0 ? TRAY_STATUS_RUNNING : hasScheduledTask ? "已排程" : "空闲";
    const statusClass = actionState.runningTrayCount > 0 ? "is-running" : hasScheduledTask ? "is-scheduled" : "is-idle";
    return {
      ...scopedLab,
      canStartExperiment: actionState.canStartExperiment,
      readyTrayCount: actionState.readyTrayCount,
      remainingTrayCount: actionState.remainingTrayCount,
      runningTrayCount: actionState.runningTrayCount,
      startDisabledReason: actionState.startDisabledReason,
      status,
      statusClass,
      targetExperiment: toText(scheduledExperimentName, toText(task?.test_type, toText(scopedLab?.targetExperiment))),
    };
  };

  const rebuildLabCards = () => {
    labCards.value = buildProcessLabCards(
      labs,
      tasks.value,
      schedules.value,
      samples.value,
      currentTimeValue(),
      experiments.value,
      experimentTrays.value,
    ).map(enrichLabCard);
  };

  const ensureTaskWorkspaceLoaded = async (taskCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    if (!normalizedTaskCode || Object.prototype.hasOwnProperty.call(transferWorkspaceByTaskCode.value, normalizedTaskCode)) {
      return;
    }
    const workspace = await loadTransferWorkspace(normalizedTaskCode);
    transferWorkspaceByTaskCode.value = {
      ...transferWorkspaceByTaskCode.value,
      [normalizedTaskCode]: workspace && typeof workspace === "object" ? workspace : null,
    };
  };

  const refreshSelectedTaskDetail = (preferredTrayCode = "") => {
    if (preferredTrayCode) {
      selectedTrayCode.value = preferredTrayCode;
    }
    const lab = labCards.value.find((item) => normalizeText(item?.name) === selectedTaskLabName.value) || null;
    if (!lab?.hasTask) {
      selectedTaskDetail.value = null;
      selectedTrayCode.value = "";
      return;
    }
    selectedTaskDetail.value = buildTaskDetail(lab);
    selectedTrayCode.value = selectedTaskDetail.value?.selectedTrayCode || "";
  };

  const refreshStartExperimentTaskDetail = () => {
    const lab = labCards.value.find((item) => normalizeText(item?.name) === startExperimentLabName.value) || null;
    if (!lab?.hasTask) {
      startExperimentTaskDetail.value = null;
      return;
    }
    startExperimentTaskDetail.value = buildTaskDetail(lab);
  };

  const loadLabStatus = async () => {
    loading.value = true;
    try {
      const snapshot = await loadSnapshot();
      tasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
      schedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
      samples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
      experimentTrays.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_trays]) ? snapshot[STORAGE_KEYS.experiment_trays] : [];
      experiments.value = Array.isArray(snapshot[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
      rebuildLabCards();
      if (taskDrawerOpen.value) {
        refreshSelectedTaskDetail(selectedTrayCode.value);
      }
      if (startExperimentModalOpen.value) {
        refreshStartExperimentTaskDetail();
      }
    } finally {
      loading.value = false;
    }
  };

  const overviewCount = computed(() => labCards.value.length);
  const runningCount = computed(() => labCards.value.filter((lab) => lab.statusClass === "is-running").length);
  const scheduledCount = computed(
    () => labCards.value.filter((lab) => lab.statusClass === "is-running" || lab.statusClass === "is-scheduled").length,
  );
  const idleCount = computed(() => labCards.value.filter((lab) => lab.statusClass === "is-idle").length);
  const visibleLabCards = computed(() => {
    if (activeFilter.value === PROCESS_FILTERS.running) {
      return labCards.value.filter((lab) => lab.statusClass === "is-running");
    }
    if (activeFilter.value === PROCESS_FILTERS.scheduled) {
      return labCards.value.filter((lab) => lab.statusClass === "is-running" || lab.statusClass === "is-scheduled");
    }
    if (activeFilter.value === PROCESS_FILTERS.idle) {
      return labCards.value.filter((lab) => lab.statusClass === "is-idle");
    }
    return labCards.value;
  });

  const setActiveFilter = (value) => {
    if (!Object.values(PROCESS_FILTERS).includes(value)) {
      return;
    }
    activeFilter.value = value;
  };

  const openTaskOverview = async (lab) => {
    if (!lab?.hasTask) {
      return;
    }
    selectedTaskLabName.value = normalizeText(lab?.name);
    selectedTrayCode.value = "";
    refreshSelectedTaskDetail("");
    taskDrawerOpen.value = true;

    const taskCode = normalizeText(lab?.taskCode);
    if (!selectedTaskDetail.value?.trayCount) {
      await ensureTaskWorkspaceLoaded(taskCode);
      refreshSelectedTaskDetail(selectedTrayCode.value);
    }
  };

  const selectTaskTray = (trayCode) => {
    if (!taskDrawerOpen.value) {
      return;
    }
    refreshSelectedTaskDetail(normalizeText(trayCode));
  };

  const setSelectedTaskForLab = (labName, taskCode) => {
    const normalizedLabName = normalizeText(labName);
    const normalizedTaskCode = normalizeText(taskCode);
    selectedTaskCodeByLab.value = {
      ...selectedTaskCodeByLab.value,
      [normalizedLabName]: normalizedTaskCode,
    };
    rebuildLabCards();
    if (selectedTaskLabName.value === normalizedLabName) {
      selectedTrayCode.value = "";
      refreshSelectedTaskDetail("");
    }
    if (startExperimentLabName.value === normalizedLabName) {
      refreshStartExperimentTaskDetail();
    }
  };

  const openStartExperimentModal = async (lab) => {
    if (!lab?.hasTask) {
      return;
    }
    startExperimentLabName.value = normalizeText(lab?.name);
    refreshStartExperimentTaskDetail();

    const taskCode = normalizeText(lab?.taskCode);
    if (!startExperimentTaskDetail.value?.trayCount) {
      await ensureTaskWorkspaceLoaded(taskCode);
      refreshStartExperimentTaskDetail();
    }
    if (!startExperimentTaskDetail.value?.canStartExperiment) {
      return;
    }
    startExperimentModalOpen.value = true;
  };

  const startExperiment = async (lab) => {
    const activeLab =
      labCards.value.find((item) => normalizeText(item?.name) === normalizeText(lab?.name || startExperimentLabName.value)) || lab;
    if (!activeLab?.hasTask) {
      return;
    }

    const detail =
      startExperimentModalOpen.value && startExperimentTaskDetail.value && normalizeText(startExperimentTaskDetail.value.labName) === normalizeText(activeLab?.name)
        ? startExperimentTaskDetail.value
        : buildTaskDetail(activeLab);
    const taskCode = normalizeText(detail?.code);
    const actionState = buildStartExperimentState(detail?.trayRows);
    if (!actionState.canStartExperiment) {
      return;
    }

    const startedTrayCodes = new Set(actionState.readyTrayCodes);
    const startedTrayText = actionState.readyTrayCodes.join("、");
    const timestamp = new Date().toISOString();
    const currentTime = Date.parse(timestamp);
    const targetSchedule = resolveScheduledRecordForLab(activeLab, taskCode, currentTime, detail?.activeExperimentCode);
    const startedExperimentName = detail?.targetExperiment || detail?.testType || "";
    const nextSamples = synchronizeSamplesForTrayCodes({
      historyAction: "开始实验",
      historyDetail: `${taskCode} / ${startedExperimentName || "-"} / ${TRAY_STATUS_RUNNING} / 托盘：${startedTrayText}`,
      location: normalizeText(activeLab?.name),
      now: timestamp,
      samples: samples.value,
      status: TRAY_STATUS_RUNNING,
      trayCodes: Array.from(startedTrayCodes),
    }).samples;

    const nextTasks = tasks.value.map((task) =>
      normalizeText(task?.code) === taskCode
        ? {
            ...task,
            status: TASK_STATUS_RUNNING,
            updated_at: timestamp,
          }
        : task,
    );
    const nextSchedules = schedules.value.map((schedule) => {
      if (normalizeText(schedule?.id) !== normalizeText(targetSchedule?.id)) {
        return schedule;
      }

      const durationHours = resolveScheduleDurationHours(schedule);
      const endTime = durationHours > 0 ? new Date(currentTime + durationHours * 60 * 60 * 1000).toISOString() : timestamp;
      return {
        ...schedule,
        end_at: endTime,
        start_at: timestamp,
        updated_at: timestamp,
      };
    });

    await persistSnapshot({
      [STORAGE_KEYS.samples]: nextSamples,
      [STORAGE_KEYS.schedules]: nextSchedules,
      [STORAGE_KEYS.tasks]: nextTasks,
    });

    samples.value = nextSamples;
    schedules.value = nextSchedules;
    tasks.value = nextTasks;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    }
    rebuildLabCards();
    processActionMessage.value = `当前开始进行${actionState.readyTrayCount}个托盘，剩余${buildStartExperimentState(buildTaskDetail(activeLab).trayRows).remainingTrayCount}个托盘。`;
    startExperimentModalOpen.value = false;
    startExperimentTaskDetail.value = null;
    startExperimentLabName.value = "";

    if (taskDrawerOpen.value && normalizeText(activeLab?.name) === selectedTaskLabName.value) {
      refreshSelectedTaskDetail("");
    }
  };

  const closeStartExperimentModal = () => {
    startExperimentModalOpen.value = false;
    startExperimentTaskDetail.value = null;
    startExperimentLabName.value = "";
  };

  const confirmStartExperiment = async () => {
    const lab = labCards.value.find((item) => normalizeText(item?.name) === startExperimentLabName.value) || null;
    if (!lab) {
      return;
    }
    await startExperiment(lab);
  };

  const closeTaskDrawer = () => {
    taskDrawerOpen.value = false;
    selectedTaskDetail.value = null;
    selectedTaskLabName.value = "";
    selectedTrayCode.value = "";
  };

  if (autoLoad) {
    onMounted(loadLabStatus);
  }

  return {
    activeFilter,
    closeTaskDrawer,
    closeStartExperimentModal,
    confirmStartExperiment,
    currentStartableTrayRows: computed(() => asArray(startExperimentTaskDetail.value?.readyTrayRows)),
    idleCount,
    labCards,
    loadLabStatus,
    loading,
    openTaskOverview,
    openStartExperimentModal,
    overviewCount,
    processActionMessage,
    runningCount,
    scheduledCount,
    selectedTaskDetail,
    startExperimentTaskDetail,
    selectTaskTray,
    setSelectedTaskForLab,
    setActiveFilter,
    startExperiment,
    startExperimentModalOpen,
    taskDrawerOpen,
    visibleLabCards,
  };
}

export { PROCESS_FILTERS, sanitizeTaskDisplayName, useProcessLabs };
