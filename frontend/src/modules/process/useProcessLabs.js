// 围绕实验室占用情况和任务下钻构建过程管控页状态。
import { computed, onMounted, ref } from "vue";

import { PROCESS_LABS, buildProcessLabCards } from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { buildTrayFlowView, resolveFlowStatusByLocation } from "@/modules/samples/samplesFlowModel";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";

const PROCESS_FILTERS = {
  idle: "idle",
  overview: "overview",
  running: "running",
  scheduled: "scheduled",
};

const TRAY_STATUS_READY = "实验准备就绪";
const TRAY_STATUS_RUNNING = "实验进行中";
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

// 加载快照数据，并输出实验室卡片及当前任务的抽屉详情。
function useProcessLabs(options = {}) {
  const labs = Array.isArray(options.labs) ? options.labs : PROCESS_LABS;
  const storage = options.storage || useStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.schedules, STORAGE_KEYS.samples]);
  const loadSnapshot = options.loadSnapshot || storage.loadSnapshot;
  const persistSnapshot = options.persistSnapshot || storage.persistSnapshot || (async () => {});
  const autoLoad = options.autoLoad !== false;
  const now = options.now;

  const loading = ref(false);
  const labCards = ref([]);
  const tasks = ref([]);
  const schedules = ref([]);
  const samples = ref([]);
  const activeFilter = ref(PROCESS_FILTERS.overview);
  const processActionMessage = ref("");
  const selectedTaskDetail = ref(null);
  const selectedTaskLabName = ref("");
  const selectedTrayCode = ref("");
  const taskDrawerOpen = ref(false);

  const buildTraySummary = (taskCode, task) => {
    const trayCodes = new Set();

    if (Array.isArray(task?.tray_codes)) {
      task.tray_codes.forEach((code) => {
        const normalized = String(code || "").trim();
        if (normalized) {
          trayCodes.add(normalized);
        }
      });
    }

    samples.value.forEach((sample) => {
      if (normalizeText(sample?.task_code) !== taskCode) {
        return;
      }
      asArray(sample?.trays).forEach((tray) => {
        const normalized = normalizeText(tray?.tray_code);
        if (normalized) {
          trayCodes.add(normalized);
        }
      });
    });

    const ordered = Array.from(trayCodes).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    const visible = ordered.slice(0, 3);
    const remaining = ordered.length - visible.length;

    return {
      trayCodes: ordered,
      trayCount: ordered.length,
      traySummary: ordered.length === 0 ? "未分配托盘" : `${visible.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`,
    };
  };

  const buildTrayRows = (taskCode) => {
    const trayMap = new Map();

    samples.value.forEach((sample) => {
      if (normalizeText(sample?.task_code) !== taskCode) {
        return;
      }

      asArray(sample?.trays).forEach((tray, index) => {
        const trayCode = normalizeText(tray?.tray_code) || `${taskCode}-tray-${index + 1}`;
        if (!trayCode) {
          return;
        }

        if (!trayMap.has(trayCode)) {
          trayMap.set(trayCode, {
            flowStatuses: [],
            locations: [],
            owners: [],
            sampleCodes: [],
            status: normalizeText(tray?.status) || normalizeText(sample?.status),
            trayCode,
          });
        }

        const row = trayMap.get(trayCode);
        const sampleCode = normalizeText(sample?.code);
        if (sampleCode && !row.sampleCodes.includes(sampleCode)) {
          row.sampleCodes.push(sampleCode);
        }
        if (!row.status) {
          row.status = normalizeText(tray?.status) || normalizeText(sample?.status);
        }
        row.locations.push(normalizeText(sample?.location));
        row.owners.push(normalizeText(sample?.owner));
        row.flowStatuses.push(resolveFlowStatusByLocation(sample?.location, normalizeText(tray?.status) || normalizeText(sample?.status)));
      });
    });

    return Array.from(trayMap.values())
      .map((row) => {
        const status = normalizeText(row.status);
        const sampleCodes = row.sampleCodes.slice().sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
        return {
          flowStatus: summarizeUniqueTexts(row.flowStatuses),
          isCompleted: COMPLETED_TRAY_STATUSES.has(status),
          isReady: status === TRAY_STATUS_READY,
          isRunning: RUNNING_TRAY_STATUSES.has(status),
          locationSummary: summarizeUniqueTexts(row.locations),
          ownerSummary: summarizeUniqueTexts(row.owners),
          sampleCodes,
          sampleCount: sampleCodes.length,
          sampleSummary: sampleCodes.length ? sampleCodes.join("、") : "-",
          status,
          trayCode: row.trayCode,
        };
      })
      .sort((left, right) => left.trayCode.localeCompare(right.trayCode, "zh-Hans-CN"));
  };

  const buildStartExperimentState = (trayRows) => {
    const rows = asArray(trayRows);
    const readyTrayRows = rows.filter((row) => row.isReady);
    const runningTrayRows = rows.filter((row) => row.isRunning);
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
    const { trayCodes, trayCount, traySummary } = buildTraySummary(taskCode, task);
    const trayRows = buildTrayRows(taskCode);
    const runningTrayRows = trayRows.filter((row) => row.isRunning);
    const remainingTrayRows = trayRows.filter((row) => !row.isRunning && !row.isCompleted);
    const completedTrayRows = trayRows.filter((row) => row.isCompleted);
    const actionState = buildStartExperimentState(trayRows);
    const activeTray =
      trayRows.find((row) => row.trayCode === selectedTrayCode.value) ||
      runningTrayRows[0] ||
      trayRows.find((row) => row.isReady) ||
      remainingTrayRows[0] ||
      trayRows[0] ||
      null;

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
      sampleCount: toCount(task?.sample_count),
      scheduleTime: toText(schedule ? `${lab?.scheduleTime || ""}` : lab?.scheduleTime),
      selectedTrayCode: activeTray?.trayCode || "",
      selectedTrayFlow: activeTray ? buildTrayFlowView({ status: activeTray.status, trayCode: activeTray.trayCode }) : buildTrayFlowView(),
      selectedTraySummary: activeTray,
      source: toText(task?.source),
      startDisabledReason: actionState.startDisabledReason,
      status: toText(task?.status, toText(lab?.status)),
      targetExperiment: toText(task?.test_type, toText(lab?.targetExperiment)),
      testType: toText(task?.test_type, toText(lab?.testType)),
      trayCodes,
      trayCount,
      trayRows,
      traySummary,
    };
  };

  const enrichLabCard = (lab) => {
    if (!lab?.hasTask) {
      return {
        ...lab,
        canStartExperiment: false,
        readyTrayCount: 0,
        remainingTrayCount: 0,
        runningTrayCount: 0,
        startDisabledReason: "当前无任务",
      };
    }

    const actionState = buildStartExperimentState(buildTrayRows(normalizeText(lab.taskCode)));
    return {
      ...lab,
      canStartExperiment: actionState.canStartExperiment,
      readyTrayCount: actionState.readyTrayCount,
      remainingTrayCount: actionState.remainingTrayCount,
      runningTrayCount: actionState.runningTrayCount,
      startDisabledReason: actionState.startDisabledReason,
    };
  };

  const rebuildLabCards = () => {
    labCards.value = buildProcessLabCards(labs, tasks.value, schedules.value, samples.value, now).map(enrichLabCard);
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

  const loadLabStatus = async () => {
    loading.value = true;
    try {
      const snapshot = await loadSnapshot();
      tasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
      schedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
      samples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
      rebuildLabCards();
      if (taskDrawerOpen.value) {
        refreshSelectedTaskDetail(selectedTrayCode.value);
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

  const openTaskOverview = (lab) => {
    if (!lab?.hasTask) {
      return;
    }
    selectedTaskLabName.value = normalizeText(lab?.name);
    selectedTrayCode.value = "";
    refreshSelectedTaskDetail("");
    taskDrawerOpen.value = true;
  };

  const selectTaskTray = (trayCode) => {
    if (!taskDrawerOpen.value) {
      return;
    }
    refreshSelectedTaskDetail(normalizeText(trayCode));
  };

  const startExperiment = async (lab) => {
    if (!lab?.hasTask) {
      return;
    }

    const taskCode = normalizeText(lab?.taskCode);
    const actionState = buildStartExperimentState(buildTrayRows(taskCode));
    if (!actionState.canStartExperiment) {
      return;
    }

    const startedTrayCodes = new Set(actionState.readyTrayCodes);
    const startedTrayText = actionState.readyTrayCodes.join("、");
    const timestamp = new Date().toISOString();
    const nextSamples = samples.value.map((sample) => {
      if (normalizeText(sample?.task_code) !== taskCode) {
        return sample;
      }

      let hasStartedTray = false;
      const nextTrays = asArray(sample?.trays).map((tray) => {
        if (!startedTrayCodes.has(normalizeText(tray?.tray_code)) || normalizeText(tray?.status) !== TRAY_STATUS_READY) {
          return tray;
        }
        hasStartedTray = true;
        return {
          ...tray,
          status: TRAY_STATUS_RUNNING,
          updated_at: timestamp,
        };
      });

      if (!hasStartedTray) {
        return sample;
      }

      const nextStatus = TRAY_STATUS_RUNNING;
      return {
        ...sample,
        flow_status: resolveFlowStatusByLocation(sample?.location, nextStatus),
        history: appendSampleHistory(
          {
            ...sample,
            status: nextStatus,
          },
          "开始实验",
          `托盘：${startedTrayText}`,
          timestamp,
        ),
        status: nextStatus,
        trays: nextTrays,
        updated_at: timestamp,
      };
    });

    const nextTasks = tasks.value.map((task) =>
      normalizeText(task?.code) === taskCode
        ? {
            ...task,
            status: "实验中",
            updated_at: timestamp,
          }
        : task,
    );

    await persistSnapshot({
      [STORAGE_KEYS.samples]: nextSamples,
      [STORAGE_KEYS.tasks]: nextTasks,
    });

    samples.value = nextSamples;
    tasks.value = nextTasks;
    rebuildLabCards();
    processActionMessage.value = `当前开始进行${actionState.readyTrayCount}个托盘，剩余${buildStartExperimentState(buildTrayRows(taskCode)).remainingTrayCount}个托盘。`;

    if (taskDrawerOpen.value && normalizeText(lab?.name) === selectedTaskLabName.value) {
      refreshSelectedTaskDetail("");
    }
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
    idleCount,
    labCards,
    loadLabStatus,
    loading,
    openTaskOverview,
    overviewCount,
    processActionMessage,
    runningCount,
    scheduledCount,
    selectedTaskDetail,
    selectTaskTray,
    setActiveFilter,
    startExperiment,
    taskDrawerOpen,
    visibleLabCards,
  };
}

export { PROCESS_FILTERS, sanitizeTaskDisplayName, useProcessLabs };
