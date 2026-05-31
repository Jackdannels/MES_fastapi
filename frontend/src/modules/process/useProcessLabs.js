// 围绕实验室占用情况和任务下钻构建过程管控页状态。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { PROCESS_LABS, buildProcessLabCards, scheduleExperimentIsCompleted } from "./model";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";
import { readMasterLabs } from "@/lib/masterDataApi";
import { SNAPSHOT_UPDATED_EVENT, SNAPSHOT_UPDATED_STORAGE_KEY, subscribeStorageSnapshotUpdates } from "@/lib/storageApi";
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
const PROCESS_SNAPSHOT_KEYS = new Set([
  STORAGE_KEYS.devices,
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.experiment_trays,
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
    "放置实验后暂存间",
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

const normalizeMasterProcessLabs = (rows) =>
  asArray(rows)
    .filter((lab) => Number(lab?.status ?? 1) !== 0)
    .map((lab) => ({
      name: normalizeText(lab?.name || lab?.lab_name),
      testType: normalizeText(lab?.testTypeName || lab?.test_type_name || lab?.testType || lab?.test_type),
      type: normalizeText(lab?.type || lab?.lab_type),
    }))
    .filter((lab) => lab.name && lab.testType && lab.type === "实验室")
    .map((lab) => ({
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
  let unsubscribeStorageSnapshotUpdates = null;
  const taskDrawerOpen = ref(false);

  const findTaskByCode = (taskCode) => tasks.value.find((item) => normalizeText(item?.code) === taskCode) || null;
  const currentTimeValue = () => (Number.isFinite(now) ? now : Date.now());
  const getLabSchedules = (labName) =>
    schedules.value
      .filter((entry) => normalizeText(entry?.device) === normalizeText(labName))
      .sort((left, right) => parseScheduleTime(left?.start_at) - parseScheduleTime(right?.start_at));
  const isCompletedSchedule = (schedule) =>
    scheduleExperimentIsCompleted({
      experiments: experiments.value,
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
  const getExperimentLabels = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    if (!normalizedTaskCode || !normalizedExperimentCode) {
      return [];
    }
    const experimentName = getScheduledExperimentName(normalizedTaskCode, normalizedExperimentCode);
    return Array.from(new Set([normalizedExperimentCode, experimentName].map(normalizeText).filter(Boolean)));
  };
  const historyEntryText = (entry) =>
    [entry?.detail, entry?.experiment_code, entry?.experimentCode, entry?.experiment_name, entry?.experimentName]
      .map(normalizeText)
      .filter(Boolean)
      .join(" / ");
  const historyEntryMatchesExperiment = (entry, taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const text = historyEntryText(entry);
    if (!text || (normalizedTaskCode && !text.includes(normalizedTaskCode))) {
      return false;
    }
    return getExperimentLabels(taskCode, experimentCode).some((label) => text.includes(label));
  };
  const resolveHistoryExperimentName = (entry, taskCode) => {
    const text = historyEntryText(entry);
    if (!text) {
      return "";
    }
    const matchedExperiment = experiments.value.find((experiment) => {
      if (normalizeText(experiment?.task_code) !== normalizeText(taskCode)) {
        return false;
      }
      const labels = [
        normalizeText(experiment?.experiment_code),
        normalizeText(experiment?.experiment_name),
      ].filter(Boolean);
      return labels.some((label) => text.includes(label));
    });
    return normalizeText(matchedExperiment?.experiment_name) || normalizeText(matchedExperiment?.experiment_code);
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
  const findLatestTrayExperimentHistory = (taskCode, trayCode) => {
    const matchedEntries = [];
    getTaskSamples(taskCode).forEach((sample) => {
      const hasTray = asArray(sample?.trays).some((tray) => normalizeText(tray?.tray_code) === normalizeText(trayCode));
      if (!hasTray) {
        return;
      }
      asArray(sample?.history).forEach((entry, index) => {
        const status = normalizeText(entry?.status);
        const detail = normalizeText(entry?.detail);
        if (
          status !== TRAY_STATUS_READY
          && !RUNNING_TRAY_STATUSES.has(status)
          && !detail.includes(TRAY_STATUS_READY)
          && !detail.includes(TRAY_STATUS_RUNNING)
          && !detail.includes("实验中")
        ) {
          return;
        }
        matchedEntries.push({ entry, index, time: parseScheduleTime(entry?.time) });
      });
    });
    matchedEntries.sort((left, right) => {
      const leftTime = Number.isFinite(left.time) ? left.time : 0;
      const rightTime = Number.isFinite(right.time) ? right.time : 0;
      return rightTime - leftTime || left.index - right.index;
    });
    return matchedEntries[0]?.entry || null;
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

    const latestHistory = findLatestTrayExperimentHistory(taskCode, trayCode);
    if (latestHistory) {
      if (historyEntryMatchesExperiment(latestHistory, taskCode, experimentCode)) {
        return "";
      }
      const experimentName = resolveHistoryExperimentName(latestHistory, taskCode);
      return `托盘正在${experimentName || "其他实验"}中，不能开始当前实验`;
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
        const nextStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || normalizeText(sample?.status));
        const currentRank = resolveTrayFlowStatusRank(sample?.location, row.status);
        const nextRank = resolveTrayFlowStatusRank(sample?.location, nextStatus);
        if (!row.status || nextRank >= currentRank) {
          row.status = nextStatus;
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
      !normalizedLabName || trayBelongsToLab(row, normalizedLabName) || trayHasUnknownLocation(row);
    const readyTrayCandidates = rows.filter((row) => row.isReady);
    const blockedReadyRows = readyTrayCandidates
      .map((row) => ({ reason: resolveReadyBlockedReason(row, options), row }))
      .filter((entry) => entry.reason);
    const blockedReadyTrayCodes = new Set(blockedReadyRows.map((entry) => normalizeText(entry.row?.trayCode)).filter(Boolean));
    const readyTrayRows = readyTrayCandidates.filter((row) => !blockedReadyTrayCodes.has(normalizeText(row?.trayCode)));
    const runningTrayRows = rows.filter((row) => row.isRunning && matchesLab(row));
    const remainingTrayRows = rows.filter((row) => !row.isRunning && !row.isCompleted);

    return {
      canStartExperiment: readyTrayRows.length > 0 && runningTrayRows.length === 0,
      readyTrayRows,
      readyTrayCodes: readyTrayRows.map((row) => row.trayCode),
      readyTrayCount: readyTrayRows.length,
      remainingTrayCount: remainingTrayRows.length,
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
    const normalizedLabName = normalizeText(lab?.name);
    const normalizedExperimentCode = normalizeText(experimentCode);
    const relatedSchedules = schedules.value
      .filter(
        (entry) =>
          normalizeText(entry?.device) === normalizedLabName
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
      .filter((entry) => normalizeText(entry?.device) === normalizeText(lab?.name))
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
    const hasScopedExperimentTrays = collectExperimentTrayCodes(taskCode, activeExperimentCode).length > 0;
    const { trayCodes, trayCount, traySummary } = buildTraySummary(taskCode, task, activeExperimentCode);
    const trayRows = buildTrayRows(taskCode, task, activeExperimentCode);
    const runningTrayRows = trayRows.filter((row) => row.isRunning);
    const remainingTrayRows = trayRows.filter((row) => !row.isRunning && !row.isCompleted);
    const completedTrayRows = trayRows.filter((row) => row.isCompleted);
    const actionState = buildStartExperimentState(trayRows, { experimentCode: activeExperimentCode, labName, taskCode });
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
              normalizeText(entry?.device) === normalizedLabName
              && normalizeText(entry?.task_code) === taskCode
              && (!experimentCode || normalizeText(entry?.experiment_code) === experimentCode),
          )
        : schedules.value;
      return (
        buildProcessLabCards([lab], tasks.value, sourceSchedules, samples.value, currentTimeValue(), experiments.value, experimentTrays.value, devices.value)[0]
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
      canStartExperiment: actionState.canStartExperiment,
      readyTrayCount: actionState.readyTrayCount,
      remainingTrayCount: actionState.remainingTrayCount,
      runningTrayCount: actionState.runningTrayCount,
      startDisabledReason: actionState.startDisabledReason,
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
    if (!actionState.canStartExperiment) {
      return;
    }

    const startedTrayCodes = new Set(actionState.readyTrayCodes);
    const startedTrayText = actionState.readyTrayCodes.join("、");
    const timestamp = new Date().toISOString();
    const currentTime = Date.parse(timestamp);
    const targetSchedule = resolveScheduledRecordForLab(activeLab, taskCode, currentTime, detail?.activeExperimentCode);
    const startedExperimentName = detail?.targetExperiment || detail?.testType || "";
    const nextSamples = synchronizeTaskSamplesForTrayCodes({
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
    processActionMessage.value = `当前开始进行${actionState.readyTrayCount}个托盘，剩余${buildStartExperimentState(buildTaskDetail(activeLab).trayRows, {
      experimentCode: detail?.activeExperimentCode,
      labName: activeLab?.name,
      taskCode,
    }).remainingTrayCount}个托盘。`;
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
  const handleStorageSnapshotUpdated = (event) => {
    if (event?.key !== SNAPSHOT_UPDATED_STORAGE_KEY) {
      return;
    }
    let detail = {};
    try {
      detail = JSON.parse(String(event?.newValue || "{}"));
    } catch {
      detail = {};
    }
    handleSnapshotUpdated(detail);
  };
  const snapshotUpdateTouchesProcess = (detail) => {
    const keys = Array.isArray(detail?.keys) ? detail.keys : [];
    return keys.length === 0 || keys.some((key) => PROCESS_SNAPSHOT_KEYS.has(key));
  };
  const handleSnapshotUpdated = (eventOrDetail = {}) => {
    const detail = eventOrDetail?.detail || eventOrDetail;
    if (!snapshotUpdateTouchesProcess(detail)) {
      return;
    }
    void loadLabStatus();
  };

  if (autoLoad) {
    onMounted(() => {
      void loadLabStatus();
      if (typeof window !== "undefined") {
        window.addEventListener(SAMPLES_UPDATED_EVENT, loadLabStatus);
        window.addEventListener(SNAPSHOT_UPDATED_EVENT, handleSnapshotUpdated);
        window.addEventListener("storage", handleStorageSnapshotUpdated);
        unsubscribeStorageSnapshotUpdates = subscribeStorageSnapshotUpdates(handleSnapshotUpdated);
      }
    });
    onBeforeUnmount(() => {
      if (typeof window !== "undefined") {
        window.removeEventListener(SAMPLES_UPDATED_EVENT, loadLabStatus);
        window.removeEventListener(SNAPSHOT_UPDATED_EVENT, handleSnapshotUpdated);
        window.removeEventListener("storage", handleStorageSnapshotUpdated);
      }
      if (unsubscribeStorageSnapshotUpdates) {
        unsubscribeStorageSnapshotUpdates();
        unsubscribeStorageSnapshotUpdates = null;
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

export { PROCESS_FILTERS, sanitizeTaskDisplayName, useProcessLabs };
