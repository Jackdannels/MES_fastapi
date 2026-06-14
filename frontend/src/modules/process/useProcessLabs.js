// 围绕实验室占用情况和任务下钻构建过程管控页状态。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { PROCESS_LABS, buildProcessLabCards, scheduleExperimentIsCompleted } from "./model";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";
import { HOST_INTERFACE_MODES, readHostInterfaceMode } from "@/lib/hostInterfaceMode";
import { formatLocalDateTime } from "@/lib/dateTime";
import { scheduleMatchesLab } from "@/lib/labIdentity";
import { readMasterLabs } from "@/lib/masterDataApi";
import { isExperimentCompletedStatus } from "@/lib/statusNormalization";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { trayExperimentRunIsCompleted } from "@/modules/experiment-progress/model";
import {
  buildTrayFlowView,
  normalizeLifecycleStatus,
  resolveFlowStatusByLocation,
  synchronizeSamplesForTrayCodes,
} from "@/modules/samples/samplesFlowModel";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";

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
const COMPLETED_TRAY_STATUSES = new Set(["实验完成", "实验已完成", "实验已经完成", "实验后暂存间存放", "厂家收回"]);
const PROCESS_SNAPSHOT_KEYS = new Set([
  STORAGE_KEYS.devices,
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.experiment_samples,
  STORAGE_KEYS.experiment_runs,
  STORAGE_KEYS.experiment_run_trays,
  STORAGE_KEYS.experiments,
]);
const TRAY_FLOW_STATUS_RANK = new Map(
  [
    "样品运输中",
    "到货",
    "送至暂存间",
    "已到达暂存间",
    "送至实验室",
    "已到达实验室",
    "工装夹具安装",
    TRAY_STATUS_READY,
    TRAY_STATUS_RUNNING,
    "实验已完成",
    "实验后暂存间存放",
    "厂家收回",
  ].map((status, index) => [status, index]),
);

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
const MQTT_START_DISABLED_REASON = "MQTT模式下等待上位机发送实验开始信号";

const normalizeMasterProcessLabs = (rows) =>
  asArray(rows)
    .filter((lab) => Number(lab?.status ?? 1) !== 0)
    .map((lab) => ({
      code: normalizeText(lab?.code || lab?.labCode || lab?.lab_code),
      name: normalizeText(lab?.name || lab?.lab_name),
      testType: normalizeText(lab?.testTypeName || lab?.test_type_name || lab?.testType || lab?.test_type),
      type: normalizeText(lab?.type || lab?.lab_type),
    }))
    .filter((lab) => lab.name && lab.testType && lab.type === "实验室")
    .map((lab) => ({
      code: lab.code,
      name: lab.name,
      testType: lab.testType,
    }));

const mergeProcessLabsWithStaticFallback = (masterLabs, fallbackLabs) => {
  if (!asArray(masterLabs).length) {
    return fallbackLabs;
  }
  const fallbackNames = new Set(asArray(fallbackLabs).map((lab) => normalizeText(lab?.name)).filter(Boolean));
  const overlapsStaticProcessLabs = masterLabs.some((lab) => fallbackNames.has(normalizeText(lab?.name)));
  if (!overlapsStaticProcessLabs) {
    return masterLabs;
  }
  const existingNames = new Set(masterLabs.map((lab) => normalizeText(lab?.name)).filter(Boolean));
  const missingFallbackLabs = asArray(fallbackLabs).filter((lab) => {
    const name = normalizeText(lab?.name);
    return name && !existingNames.has(name);
  });
  return [...masterLabs, ...missingFallbackLabs];
};

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

const trayLabNames = (trayRow) =>
  normalizeLocationList([
    ...asArray(trayRow?.locationNames),
    ...asArray(trayRow?.targetLabNames),
  ]);

const trayBelongsToLab = (trayRow, labName) => {
  const normalizedLabName = normalizeText(labName);
  if (!normalizedLabName) {
    return false;
  }
  const labNames = trayLabNames(trayRow);
  if (labNames.length === 0) {
    return false;
  }
  return labNames.includes(normalizedLabName);
};

const trayHasUnknownLocation = (trayRow) => trayLabNames(trayRow).length === 0;

const resolveTrayFlowStatusRank = (location, status) => {
  const normalizedStatus = normalizeLifecycleStatus(location, status);
  return TRAY_FLOW_STATUS_RANK.get(normalizedStatus) ?? -1;
};

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
  const hasExplicitLabs = Array.isArray(options.labs);
  const fallbackLabs = hasExplicitLabs ? options.labs : PROCESS_LABS;
  const processLabs = ref(fallbackLabs);
  const storage =
    options.storage ||
    useStorageSnapshot([
      STORAGE_KEYS.devices,
      STORAGE_KEYS.tasks,
      STORAGE_KEYS.schedules,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.experiment_runs,
      STORAGE_KEYS.experiment_run_trays,
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
  const devices = ref([]);
  const tasks = ref([]);
  const schedules = ref([]);
  const samples = ref([]);
  const experimentTrays = ref([]);
  const experimentSamples = ref([]);
  const experimentRuns = ref([]);
  const experimentRunTrays = ref([]);
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
  let labStatusLoadVersion = 0;
  let flushPendingStorageRefresh = () => false;
  let hasPendingSamplesRefresh = false;
  const taskDrawerOpen = ref(false);

  const findTaskByCode = (taskCode) => tasks.value.find((item) => normalizeText(item?.code) === taskCode) || null;
  const currentTimeValue = () => (Number.isFinite(now) ? now : Date.now());
  const findProcessLabByName = (labName) =>
    processLabs.value.find((lab) => normalizeText(lab?.name) === normalizeText(labName)) || { name: labName };
  const getLabSchedules = (labName) =>
    schedules.value
      .filter((entry) => scheduleMatchesLab(entry, findProcessLabByName(labName)))
      .sort((left, right) => parseScheduleTime(left?.start_at) - parseScheduleTime(right?.start_at));
  const isCompletedSchedule = (schedule) =>
    scheduleExperimentIsCompleted({
      experiments: experiments.value,
      experimentRunTrays: experimentRunTrays.value,
      experimentTrays: experimentTrays.value,
      samples: samples.value,
      schedule,
      taskStatusMap: new Map(),
    });
  const buildExperimentSelectionKey = (taskCode, experimentCode = "") => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    return normalizedExperimentCode ? `${normalizedTaskCode}::${normalizedExperimentCode}` : normalizedTaskCode;
  };
  const parseExperimentSelectionKey = (value) => {
    const normalized = normalizeText(value);
    const separatorIndex = normalized.indexOf("::");
    if (separatorIndex === -1) {
      return { experimentCode: "", taskCode: normalized };
    }
    return {
      experimentCode: normalized.slice(separatorIndex + 2),
      taskCode: normalized.slice(0, separatorIndex),
    };
  };
  const resolveSelectedTaskForLab = (labName, fallbackTaskCode = "", fallbackExperimentCode = "") => {
    const selected = normalizeText(selectedTaskCodeByLab.value[normalizeText(labName)]);
    if (selected) {
      return parseExperimentSelectionKey(selected);
    }
    return {
      experimentCode: normalizeText(fallbackExperimentCode),
      taskCode: normalizeText(fallbackTaskCode),
    };
  };

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
  const getScheduledLabName = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    const matchedSchedule = schedules.value.find(
      (entry) =>
        normalizeText(entry?.task_code) === normalizedTaskCode
        && normalizeText(entry?.experiment_code) === normalizedExperimentCode
    );
    return normalizeText(matchedSchedule?.device || matchedSchedule?.lab_name || matchedSchedule?.labName);
  };
  const getScheduledStartTime = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    const matchedSchedule = schedules.value.find(
      (entry) =>
        normalizeText(entry?.task_code) === normalizedTaskCode
        && normalizeText(entry?.experiment_code) === normalizedExperimentCode
    );
    return parseScheduleTime(matchedSchedule?.start_at);
  };
  const isSharedExperimentTray = (taskCode, trayCode) => {
    const experimentCodes = new Set();
    experimentTrays.value.forEach((entry) => {
      if (normalizeText(entry?.task_code) !== normalizeText(taskCode) || normalizeText(entry?.tray_code) !== normalizeText(trayCode)) {
        return;
      }
      const experimentCode = normalizeText(entry?.experiment_code);
      if (experimentCode) {
        experimentCodes.add(experimentCode);
      }
    });
    return experimentCodes.size > 1;
  };
  const resolveReadyBlockedReason = (row, options = {}) => {
    if (!row?.isReady) {
      return "";
    }
    const taskCode = normalizeText(options.taskCode);
    const experimentCode = normalizeText(options.experimentCode);
    const trayCode = normalizeText(row?.trayCode);
    if (!taskCode || !experimentCode || !trayCode || !isSharedExperimentTray(taskCode, trayCode)) {
      return "";
    }
    const targetExperimentCodes = asArray(row?.targetExperimentCodes).map(normalizeText).filter(Boolean);
    if (row?.hasCurrentExperimentReadyEvidence === true) {
      return "";
    }
    if (targetExperimentCodes.length > 0 && !targetExperimentCodes.includes(experimentCode)) {
      const targetExperimentName = getScheduledExperimentName(taskCode, targetExperimentCodes[0]);
      return `托盘正在${targetExperimentName || "其他实验"}中，不能开始当前实验`;
    }

    const labName = normalizeText(options.labName);
    if (!labName || trayBelongsToLab(row, labName) || trayHasUnknownLocation(row)) {
      return "";
    }
    return "托盘正在其他实验中，不能开始当前实验";
  };
  const buildAvailableTasksForLab = (labName) => {
    const rows = [];
    const seen = new Set();
    getLabSchedules(labName).filter((schedule) => !isCompletedSchedule(schedule)).forEach((schedule) => {
      const taskCode = normalizeText(schedule?.task_code);
      const experimentCode = normalizeText(schedule?.experiment_code);
      const selectionKey = buildExperimentSelectionKey(taskCode, experimentCode);
      if (!taskCode || seen.has(selectionKey)) {
        return;
      }
      seen.add(selectionKey);
      rows.push({
        experimentCode,
        experimentName: getScheduledExperimentName(taskCode, experimentCode),
        scheduleTime: `${toText(schedule?.start_at)} - ${toText(schedule?.end_at)}`,
        selectionKey,
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

  const buildExperimentRunTrayStatusMap = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    const trayStatusMap = new Map();
    if (!normalizedTaskCode || !normalizedExperimentCode) {
      return trayStatusMap;
    }

    const scopedRunTrays = experimentRunTrays.value.filter((relation) => (
      normalizeText(relation?.task_code) === normalizedTaskCode
      && normalizeText(relation?.experiment_code) === normalizedExperimentCode
    ));
    if (scopedRunTrays.length > 0) {
      scopedRunTrays.forEach((relation) => {
        const trayCode = normalizeText(relation?.tray_code || relation?.tray_no);
        if (!trayCode) {
          return;
        }
        const status = normalizeLifecycleStatus("", normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status));
        const isRunning = RUNNING_TRAY_STATUSES.has(status);
        const isCompleted = trayExperimentRunIsCompleted({
          experimentCode: normalizedExperimentCode,
          experimentRunTrays: [relation],
          taskCode: normalizedTaskCode,
          trayCode,
        });
        if (!isRunning && !isCompleted) {
          return;
        }
        const current = trayStatusMap.get(trayCode) || { isCompleted: false, isRunning: false };
        trayStatusMap.set(trayCode, {
          isCompleted: current.isCompleted || isCompleted,
          isRunning: current.isRunning || isRunning,
        });
      });
    }
    return trayStatusMap;
  };

  const collectTaskTrayCodes = (taskCode, task = null, experimentCode = "") => {
    const experimentTrayCodes = collectExperimentTrayCodes(taskCode, experimentCode);
    if (experimentTrayCodes.length) {
      return experimentTrayCodes;
    }

    const trayCodes = new Set();
    experimentTrays.value.forEach((entry) => {
      if (normalizeText(entry?.task_code) !== taskCode) {
        return;
      }
      const normalized = normalizeText(entry?.tray_code);
      if (normalized) {
        trayCodes.add(normalized);
      }
    });

    return Array.from(trayCodes).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  };

  const collectExperimentSampleCodes = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    if (!normalizedTaskCode || !normalizedExperimentCode) {
      return [];
    }
    const sampleCodes = new Set();
    experimentSamples.value.forEach((entry) => {
      if (
        normalizeText(entry?.task_code) !== normalizedTaskCode
        || normalizeText(entry?.experiment_code) !== normalizedExperimentCode
      ) {
        return;
      }
      const sampleCode = normalizeText(entry?.sample_code || entry?.sample_no);
      if (sampleCode) {
        sampleCodes.add(sampleCode);
      }
    });
    return Array.from(sampleCodes).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  };

  const sampleTrayShowsCurrentExperimentReady = ({ experimentCode, labName, sample, taskCode, tray }) => {
    const trayStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status));
    if (trayStatus !== TRAY_STATUS_READY) {
      return false;
    }
    const targetExperimentCode = normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
    if (targetExperimentCode) {
      if (targetExperimentCode === normalizeText(experimentCode)) {
        return true;
      }
      const targetStart = getScheduledStartTime(taskCode, targetExperimentCode);
      const currentStart = getScheduledStartTime(taskCode, experimentCode);
      return (
        normalizeText(sample?.location) === normalizeText(labName)
        && Number.isFinite(targetStart)
        && Number.isFinite(currentStart)
        && targetStart < currentStart
      );
    }
    const targetLab = normalizeText(tray?.target_lab || tray?.targetLab);
    if (targetLab) {
      return targetLab === normalizeText(labName);
    }
    return normalizeText(sample?.location) === normalizeText(labName);
  };

  const buildTaskFallbackTrayContext = (taskCode, trayCodeSet = null) => {
    return {
      flowStatus: "",
      locationSummary: "",
      ownerSummary: "",
      status: "",
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
    const scopedSampleCodes = collectExperimentSampleCodes(taskCode, experimentCode);
    const scopedSampleCodeSet = scopedSampleCodes.length ? new Set(scopedSampleCodes) : null;
    const experimentRunTrayStatusMap = buildExperimentRunTrayStatusMap(taskCode, experimentCode);
    const currentLabName = getScheduledLabName(taskCode, experimentCode);
    const fallbackContext = buildTaskFallbackTrayContext(taskCode, scopedTrayCodeSet);

    collectTaskTrayCodes(taskCode, task, experimentCode).forEach((trayCode) => {
      trayMap.set(trayCode, {
        flowStatuses: [],
        locations: [],
        owners: [],
        sampleCodes: [],
        status: "",
        targetExperimentCodes: [],
        targetLabs: [],
        hasCurrentExperimentReadyEvidence: false,
        trayCode,
      });
    });

    getTaskSamples(taskCode).forEach((sample) => {
      if (normalizeText(sample?.task_code) !== taskCode) {
        return;
      }

      asArray(sample?.trays).forEach((tray, index) => {
        const trayCode = normalizeText(tray?.tray_code);
        if (!trayCode || !trayMap.has(trayCode) || (scopedTrayCodeSet && !scopedTrayCodeSet.has(trayCode))) {
          return;
        }

        const row = trayMap.get(trayCode);
        const sampleCode = normalizeText(sample?.code);
        if (scopedSampleCodeSet && !scopedSampleCodeSet.has(sampleCode)) {
          return;
        }
        if (sampleCode && !row.sampleCodes.includes(sampleCode)) {
          row.sampleCodes.push(sampleCode);
        }
        const nextStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status));
        if (
          nextStatus === TRAY_STATUS_READY
          && sampleTrayShowsCurrentExperimentReady({
            experimentCode,
            labName: currentLabName,
            sample,
            taskCode,
            tray,
          })
        ) {
          row.hasCurrentExperimentReadyEvidence = true;
        }
        const currentRank = resolveTrayFlowStatusRank(sample?.location, row.status);
        const nextRank = resolveTrayFlowStatusRank(sample?.location, nextStatus);
        if (!row.status || nextRank >= currentRank) {
          row.status = nextStatus;
        }
        row.locations.push(normalizeText(sample?.location));
        row.owners.push(normalizeText(sample?.owner));
        row.targetExperimentCodes.push(normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode));
        row.targetLabs.push(normalizeText(tray?.target_lab || tray?.targetLab));
        row.flowStatuses.push(
          resolveFlowStatusByLocation(sample?.location, normalizeText(tray?.status)),
        );
      });
    });

    return Array.from(trayMap.values())
      .map((row) => {
        const status = normalizeText(row.status) || fallbackContext.status;
        const sampleCodes = row.sampleCodes.slice().sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
        const runTrayStatus = experimentRunTrayStatusMap.get(row.trayCode);
        const isRunning = Boolean(runTrayStatus?.isRunning);
        const isCompleted = !isRunning && (COMPLETED_TRAY_STATUSES.has(status) || Boolean(runTrayStatus?.isCompleted));
        return {
          flowStatus: row.flowStatuses.length ? summarizeUniqueTexts(row.flowStatuses) : toText(fallbackContext.flowStatus),
          isCompleted,
          isReady: !isCompleted && status === TRAY_STATUS_READY,
          isRunning,
          locationNames: normalizeLocationList(row.locations),
          locationSummary: summarizeUniqueTexts(row.locations, fallbackContext.locationSummary),
          ownerSummary: summarizeUniqueTexts(row.owners, fallbackContext.ownerSummary),
          sampleCodes,
          sampleCount: sampleCodes.length,
          sampleSummary: sampleCodes.length ? sampleCodes.join("、") : "-",
          status,
          targetExperimentCodes: normalizeLocationList(row.targetExperimentCodes),
          targetLabNames: normalizeLocationList(row.targetLabs),
          hasCurrentExperimentReadyEvidence: row.hasCurrentExperimentReadyEvidence === true,
          trayCode: row.trayCode,
        };
      })
      .sort((left, right) => left.trayCode.localeCompare(right.trayCode, "zh-Hans-CN"));
  };

  const synchronizeTaskSamplesForTrayCodes = ({ taskCode, trayCodes, ...input }) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const scopedSamples = samples.value.filter((sample) => normalizeText(sample?.task_code) === normalizedTaskCode);
    const syncedSamples = synchronizeSamplesForTrayCodes({
      ...input,
      samples: scopedSamples,
      trayCodes,
    }).samples;
    const syncedByCode = new Map(syncedSamples.map((sample) => [normalizeText(sample?.code), sample]));
    return samples.value.map((sample) => syncedByCode.get(normalizeText(sample?.code)) || sample);
  };

  const buildStartExperimentState = (trayRows, options = {}) => {
    const rows = asArray(trayRows);
    const normalizedLabName = normalizeText(options.labName);
    const matchesLab = (row) =>
      row.isRunning || !normalizedLabName || trayBelongsToLab(row, normalizedLabName) || trayHasUnknownLocation(row);
    const readyTrayCandidates = rows.filter((row) => row.isReady && !row.isCompleted);
    const blockedReadyRows = readyTrayCandidates
      .map((row) => ({ reason: resolveReadyBlockedReason(row, options), row }))
      .filter((entry) => entry.reason);
    const blockedReadyTrayCodes = new Set(blockedReadyRows.map((entry) => normalizeText(entry.row?.trayCode)).filter(Boolean));
    const readyTrayRows = readyTrayCandidates.filter((row) => !blockedReadyTrayCodes.has(normalizeText(row?.trayCode)));
    const runningTrayRows = rows.filter((row) => row.isRunning && matchesLab(row));
    const remainingTrayRows = rows.filter((row) => !row.isReady && !row.isRunning && !row.isCompleted);

    return {
      canStartExperiment: readyTrayRows.length > 0 && runningTrayRows.length === 0,
      readyTrayRows,
      readyTrayCodes: readyTrayRows.map((row) => row.trayCode),
      readyTrayCount: readyTrayRows.length,
      remainingTrayRows,
      remainingTrayCount: remainingTrayRows.length,
      runningTrayRows,
      runningTrayCount: runningTrayRows.length,
      startDisabledReason:
        runningTrayRows.length > 0
          ? "当前批次实验未结束"
          : readyTrayRows.length === 0 && blockedReadyRows.length > 0
            ? blockedReadyRows[0].reason
            : readyTrayRows.length === 0
              ? "暂无可启动托盘"
              : "",
    };
  };

  const findStartableScheduleForLab = (labName) => {
    let candidate = null;
    const labSchedules = getLabSchedules(labName).filter((schedule) => !isCompletedSchedule(schedule));
    for (const schedule of labSchedules) {
      const taskCode = normalizeText(schedule?.task_code);
      const experimentCode = normalizeText(schedule?.experiment_code);
      const task = findTaskByCode(taskCode);
      const actionState = buildStartExperimentState(buildTrayRows(taskCode, task, experimentCode), { experimentCode, labName, taskCode });
      if (actionState.runningTrayCount > 0) {
        return null;
      }
      if (!candidate && actionState.canStartExperiment) {
        candidate = schedule;
      }
    }
    return candidate;
  };

  const resolveScheduledRecordForLab = (lab, taskCode, currentTime, experimentCode = "") => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    const relatedSchedules = schedules.value
      .filter(
        (entry) =>
          scheduleMatchesLab(entry, lab)
          && normalizeText(entry?.task_code) === normalizedTaskCode
          && (!normalizedExperimentCode || normalizeText(entry?.experiment_code) === normalizedExperimentCode),
      )
      .filter((entry) => !isCompletedSchedule(entry))
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
    const activeExperimentCodeFromLab = normalizeText(lab?.experimentCode);
    const relatedSchedules = schedules.value
      .filter((entry) => scheduleMatchesLab(entry, lab))
      .filter((entry) => !isCompletedSchedule(entry))
      .sort((left, right) => Date.parse(String(right?.start_at || "")) - Date.parse(String(left?.start_at || "")));
    const schedule =
      relatedSchedules.find(
        (entry) =>
          normalizeText(entry?.task_code) === taskCode
          && (!activeExperimentCodeFromLab || normalizeText(entry?.experiment_code) === activeExperimentCodeFromLab),
      )
      || relatedSchedules.find((entry) => normalizeText(entry?.task_code) === taskCode)
      || relatedSchedules[0]
      || null;
    const activeExperimentCode = activeExperimentCodeFromLab || normalizeText(schedule?.experiment_code);
    const scheduledExperimentName = getScheduledExperimentName(taskCode, activeExperimentCode);
    const hasScopedExperimentSamples = collectExperimentSampleCodes(taskCode, activeExperimentCode).length > 0;
    const { trayCodes, trayCount, traySummary } = buildTraySummary(taskCode, task, activeExperimentCode);
    const trayRows = buildTrayRows(taskCode, task, activeExperimentCode);
    const actionState = buildStartExperimentState(trayRows, { experimentCode: activeExperimentCode, labName, taskCode });
    const runningTrayRows = actionState.runningTrayRows;
    const remainingTrayRows = actionState.remainingTrayRows;
    const completedTrayRows = trayRows.filter((row) => row.isCompleted);
    const activeTray =
      trayRows.find((row) => row.trayCode === selectedTrayCode.value) ||
      runningTrayRows[0] ||
      trayRows.find((row) => row.isReady) ||
      remainingTrayRows[0] ||
      trayRows[0] ||
      null;
    const selectedTrayFlowExperimentCode =
      activeTray && asArray(activeTray.targetLabNames).length > 0 ? "" : activeExperimentCode;
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
      sampleCount: hasScopedExperimentSamples ? filteredSampleCount : toCount(task?.sample_count),
      scheduleTime: toText(schedule ? `${lab?.scheduleTime || ""}` : lab?.scheduleTime),
      selectedTrayCode: activeTray?.trayCode || "",
      selectedTrayFlow: activeTray
        ? buildTrayFlowView({
            currentExperimentCode: selectedTrayFlowExperimentCode,
            experimentRuns: experimentRuns.value,
            experimentRunTrays: experimentRunTrays.value,
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
      readyTrayRows: actionState.readyTrayRows,
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
    const normalizedLabName = normalizeText(lab?.name);
    const explicitSelection = normalizeText(selectedTaskCodeByLab.value[normalizedLabName]);
    const selectedTask = resolveSelectedTaskForLab(lab?.name, lab?.taskCode, lab?.experimentCode);
    const buildScopedLab = (taskCode, experimentCode) => {
      const sourceSchedules = taskCode
        ? schedules.value.filter(
            (entry) =>
              scheduleMatchesLab(entry, lab)
              && normalizeText(entry?.task_code) === taskCode
              && (!experimentCode || normalizeText(entry?.experiment_code) === experimentCode),
          )
        : schedules.value;
      return (
        buildProcessLabCards(
          [lab],
          tasks.value,
          sourceSchedules,
          samples.value,
          currentTimeValue(),
          experiments.value,
          experimentTrays.value,
          devices.value,
          experimentRuns.value,
          experimentRunTrays.value,
        )[0]
        || lab
      );
    };
    let scopedLab = buildScopedLab(selectedTask.taskCode, selectedTask.experimentCode);
    if (!scopedLab?.hasTask && explicitSelection) {
      scopedLab = buildScopedLab(normalizeText(lab?.taskCode), normalizeText(lab?.experimentCode));
    }

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

    let taskCode = normalizeText(scopedLab.taskCode);
    let task = findTaskByCode(taskCode);
    let schedule = resolveScheduledRecordForLab(scopedLab, taskCode, currentTimeValue(), normalizeText(scopedLab?.experimentCode));
    let activeExperimentCode = normalizeText(schedule?.experiment_code) || normalizeText(scopedLab?.experimentCode);
    let scopedTrayRows = buildTrayRows(taskCode, task, activeExperimentCode);
    let actionState = buildStartExperimentState(scopedTrayRows, { experimentCode: activeExperimentCode, labName: scopedLab?.name, taskCode });

    if (!explicitSelection && !actionState.canStartExperiment && actionState.runningTrayCount === 0) {
      const startableSchedule = findStartableScheduleForLab(scopedLab?.name);
      const startableTaskCode = normalizeText(startableSchedule?.task_code);
      const startableExperimentCode = normalizeText(startableSchedule?.experiment_code);
      if (startableTaskCode && (startableTaskCode !== taskCode || startableExperimentCode !== activeExperimentCode)) {
        scopedLab = buildScopedLab(startableTaskCode, startableExperimentCode);
        taskCode = normalizeText(scopedLab.taskCode);
        task = findTaskByCode(taskCode);
        schedule = resolveScheduledRecordForLab(scopedLab, taskCode, currentTimeValue(), normalizeText(scopedLab?.experimentCode));
        activeExperimentCode = normalizeText(schedule?.experiment_code) || normalizeText(scopedLab?.experimentCode);
        scopedTrayRows = buildTrayRows(taskCode, task, activeExperimentCode);
        actionState = buildStartExperimentState(scopedTrayRows, { experimentCode: activeExperimentCode, labName: scopedLab?.name, taskCode });
      }
    }
    const scheduledExperimentName = getScheduledExperimentName(taskCode, activeExperimentCode);
    const hasScheduledTask = Boolean(scopedLab?.hasTask);
    const mqttMode = readHostInterfaceMode() === HOST_INTERFACE_MODES.mqtt;
    if (normalizeText(scopedLab?.statusClass) === "is-maintenance") {
      return {
        ...scopedLab,
        canStartExperiment: false,
        experimentCode: activeExperimentCode,
        readyTrayCount: actionState.readyTrayCount,
        remainingTrayCount: actionState.remainingTrayCount,
        runningTrayCount: actionState.runningTrayCount,
        startDisabledReason: "设备维护中，禁止开始实验",
        targetExperiment: toText(scheduledExperimentName, toText(task?.test_type, toText(scopedLab?.targetExperiment))),
      };
    }
    const status = actionState.runningTrayCount > 0 ? TRAY_STATUS_RUNNING : hasScheduledTask ? "已排程" : "空闲";
    const statusClass = actionState.runningTrayCount > 0 ? "is-running" : hasScheduledTask ? "is-scheduled" : "is-idle";
    return {
      ...scopedLab,
      canStartExperiment: actionState.canStartExperiment && !mqttMode,
      readyTrayCount: actionState.readyTrayCount,
      remainingTrayCount: actionState.remainingTrayCount,
      runningTrayCount: actionState.runningTrayCount,
      startDisabledReason: mqttMode && actionState.canStartExperiment ? MQTT_START_DISABLED_REASON : actionState.startDisabledReason,
      status,
      statusClass,
      experimentCode: activeExperimentCode,
      targetExperiment: toText(scheduledExperimentName, toText(task?.test_type, toText(scopedLab?.targetExperiment))),
    };
  };

  const rebuildLabCards = () => {
    labCards.value = buildProcessLabCards(
      processLabs.value,
      tasks.value,
      schedules.value,
      samples.value,
      currentTimeValue(),
      experiments.value,
      experimentTrays.value,
      devices.value,
      experimentRuns.value,
      experimentRunTrays.value,
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
    const loadVersion = ++labStatusLoadVersion;
    loading.value = true;
    try {
      const [snapshot, masterLabs] = await Promise.all([
        loadSnapshot(),
        hasExplicitLabs ? Promise.resolve([]) : readMasterLabs().catch(() => []),
      ]);
      if (loadVersion !== labStatusLoadVersion) {
        return;
      }
      if (!hasExplicitLabs) {
        const normalizedMasterLabs = normalizeMasterProcessLabs(masterLabs);
        processLabs.value = normalizedMasterLabs.length
          ? mergeProcessLabsWithStaticFallback(normalizedMasterLabs, fallbackLabs)
          : fallbackLabs;
      }
      devices.value = Array.isArray(snapshot[STORAGE_KEYS.devices]) ? snapshot[STORAGE_KEYS.devices] : [];
      tasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
      schedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
      samples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
      experimentTrays.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_trays]) ? snapshot[STORAGE_KEYS.experiment_trays] : [];
      experimentSamples.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_samples]) ? snapshot[STORAGE_KEYS.experiment_samples] : [];
      experimentRuns.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_runs]) ? snapshot[STORAGE_KEYS.experiment_runs] : [];
      experimentRunTrays.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_run_trays]) ? snapshot[STORAGE_KEYS.experiment_run_trays] : [];
      experiments.value = Array.isArray(snapshot[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
      rebuildLabCards();
      if (taskDrawerOpen.value) {
        refreshSelectedTaskDetail(selectedTrayCode.value);
      }
      if (startExperimentModalOpen.value) {
        refreshStartExperimentTaskDetail();
      }
    } finally {
      if (loadVersion === labStatusLoadVersion) {
        loading.value = false;
      }
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

  const setSelectedTaskForLab = (labName, taskCode, experimentCode = "") => {
    const normalizedLabName = normalizeText(labName);
    const normalizedTaskCode = normalizeText(taskCode);
    const selectionKey = buildExperimentSelectionKey(normalizedTaskCode, experimentCode);
    selectedTaskCodeByLab.value = {
      ...selectedTaskCodeByLab.value,
      [normalizedLabName]: selectionKey,
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
    if (readHostInterfaceMode() === HOST_INTERFACE_MODES.mqtt) {
      processActionMessage.value = MQTT_START_DISABLED_REASON;
      return;
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
    const actionState = buildStartExperimentState(detail?.trayRows, {
      experimentCode: detail?.activeExperimentCode,
      labName: activeLab?.name,
      taskCode,
    });
    if (normalizeText(activeLab?.statusClass) === "is-maintenance") {
      processActionMessage.value = "设备维护中，禁止开始实验";
      return;
    }
    if (readHostInterfaceMode() === HOST_INTERFACE_MODES.mqtt) {
      processActionMessage.value = MQTT_START_DISABLED_REASON;
      return;
    }
    if (!actionState.canStartExperiment) {
      return;
    }

    const startedTrayCodes = new Set(actionState.readyTrayCodes);
    const startedTrayText = actionState.readyTrayCodes.join("、");
    const now = new Date();
    const timestamp = formatLocalDateTime(now);
    const currentTime = now.getTime();
    const targetSchedule = resolveScheduledRecordForLab(activeLab, taskCode, currentTime, detail?.activeExperimentCode);
    const startedExperimentName = detail?.targetExperiment || detail?.testType || "";
    const durationHours = resolveScheduleDurationHours(targetSchedule);
    const plannedEndAt = durationHours > 0 ? formatLocalDateTime(new Date(currentTime + durationHours * 60 * 60 * 1000)) : timestamp;
    const nextSamples = synchronizeTaskSamplesForTrayCodes({
      clearTrayTarget: true,
      historyAction: "开始实验",
      historyDetail: `${taskCode} / ${startedExperimentName || "-"} / ${TRAY_STATUS_RUNNING} / 托盘：${startedTrayText}`,
      location: normalizeText(activeLab?.name),
      now: timestamp,
      status: TRAY_STATUS_RUNNING,
      taskCode,
      trayCodes: Array.from(startedTrayCodes),
    });

    const nextTasks = tasks.value.map((task) =>
      normalizeText(task?.code) === taskCode
        ? {
            ...task,
            status: TASK_STATUS_RUNNING,
            updated_at: timestamp,
          }
        : task,
    );
    const activeExperimentCode = normalizeText(detail?.activeExperimentCode);
    const activeScheduleId = normalizeText(targetSchedule?.id);
    const nextSchedules = schedules.value.map((schedule) =>
      (
        (activeScheduleId && normalizeText(schedule?.id) === activeScheduleId)
        || (
          normalizeText(schedule?.task_code) === taskCode
          && normalizeText(schedule?.experiment_code) === activeExperimentCode
          && scheduleMatchesLab(schedule, activeLab)
        )
      )
        ? {
            ...schedule,
            status: TRAY_STATUS_RUNNING,
            updated_at: timestamp,
          }
        : schedule,
    );
    const nextExperiments = experiments.value.map((experiment) =>
      normalizeText(experiment?.task_code) === taskCode && normalizeText(experiment?.experiment_code) === activeExperimentCode
        ? {
            ...experiment,
            actual_start_time: normalizeText(experiment?.actual_start_time) || timestamp,
            status: TRAY_STATUS_RUNNING,
            updated_at: timestamp,
          }
        : experiment,
    );
    const runNo = `run-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
    const nextExperimentRuns = [
      ...experimentRuns.value,
      {
        id: runNo,
        run_no: runNo,
        schedule_id: normalizeText(targetSchedule?.id),
        task_code: taskCode,
        experiment_code: activeExperimentCode,
        device: normalizeText(activeLab?.name),
        tray_codes: Array.from(startedTrayCodes),
        status: TRAY_STATUS_RUNNING,
        started_at: timestamp,
        planned_hours: durationHours,
        planned_end_at: plannedEndAt,
        ended_at: "",
        created_at: timestamp,
        updated_at: timestamp,
      },
    ];
    const nextExperimentRunTrays = [
      ...experimentRunTrays.value,
      ...Array.from(startedTrayCodes).map((trayCode) => ({
        id: `${runNo}:${trayCode}`,
        run_no: runNo,
        task_code: taskCode,
        experiment_code: activeExperimentCode,
        tray_code: trayCode,
        status: TRAY_STATUS_RUNNING,
        run_tray_status: TRAY_STATUS_RUNNING,
        started_at: timestamp,
        ended_at: "",
        created_at: timestamp,
        updated_at: timestamp,
      })),
    ];

    await persistSnapshot({
      [STORAGE_KEYS.samples]: nextSamples,
      [STORAGE_KEYS.schedules]: nextSchedules,
      [STORAGE_KEYS.tasks]: nextTasks,
      [STORAGE_KEYS.experiments]: nextExperiments,
      [STORAGE_KEYS.experiment_runs]: nextExperimentRuns,
      [STORAGE_KEYS.experiment_run_trays]: nextExperimentRunTrays,
    });

    samples.value = nextSamples;
    schedules.value = nextSchedules;
    tasks.value = nextTasks;
    experiments.value = nextExperiments;
    experimentRuns.value = nextExperimentRuns;
    experimentRunTrays.value = nextExperimentRunTrays;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    }
    rebuildLabCards();
    processActionMessage.value = `当前开始进行${actionState.readyTrayCount}个托盘，剩余${buildStartExperimentState(buildTaskDetail(activeLab).trayRows, {
      experimentCode: detail?.activeExperimentCode,
      labName: activeLab?.name,
      taskCode,
    }).remainingTrayCount}个托盘。`;
    startExperimentModalOpen.value = false;
    startExperimentTaskDetail.value = null;
    startExperimentLabName.value = "";
    flushPendingRealtimeRefresh();

    if (taskDrawerOpen.value && normalizeText(activeLab?.name) === selectedTaskLabName.value) {
      refreshSelectedTaskDetail("");
    }
  };

  const closeStartExperimentModal = () => {
    startExperimentModalOpen.value = false;
    startExperimentTaskDetail.value = null;
    startExperimentLabName.value = "";
    flushPendingRealtimeRefresh();
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
    flushPendingRealtimeRefresh();
  };

  const isProcessRealtimeRefreshPaused = () => Boolean(taskDrawerOpen.value || startExperimentModalOpen.value);

  const flushPendingRealtimeRefresh = () => {
    const flushedStorage = flushPendingStorageRefresh();
    if (!hasPendingSamplesRefresh || isProcessRealtimeRefreshPaused()) {
      return flushedStorage;
    }
    hasPendingSamplesRefresh = false;
    if (!flushedStorage) {
      void loadLabStatus();
    }
    return true;
  };

  const handleSamplesUpdated = () => {
    if (isProcessRealtimeRefreshPaused()) {
      hasPendingSamplesRefresh = true;
      return;
    }
    hasPendingSamplesRefresh = false;
    void loadLabStatus();
  };

  if (autoLoad) {
    const storageRefresh = useStorageSnapshotRefresh({
      keys: Array.from(PROCESS_SNAPSHOT_KEYS),
      refresh: loadLabStatus,
      paused: isProcessRealtimeRefreshPaused,
    });
    flushPendingStorageRefresh = storageRefresh.flushPendingRefresh;

    onMounted(() => {
      void loadLabStatus();
      if (typeof window !== "undefined") {
        window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
      }
    });
    onBeforeUnmount(() => {
      if (typeof window !== "undefined") {
        window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
      }
    });
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

export { PROCESS_FILTERS, useProcessLabs };
