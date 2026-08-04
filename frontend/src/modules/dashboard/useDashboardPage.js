// 负责中控总览页的数据加载，并整理页面直接使用的响应式状态。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { buildDashboardViewModel } from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { serverNowMs } from "@/lib/serverClock";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

const DASHBOARD_TASK_PAGE_SIZE = 8;
const DASHBOARD_SNAPSHOT_KEYS = [
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.conflicts,
  STORAGE_KEYS.devices,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.streams,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_runs,
  STORAGE_KEYS.experiment_run_trays,
  STORAGE_KEYS.experiment_trays,
];

const normalizeDashboardRefreshKeys = (keys) => {
  if (!Array.isArray(keys) || keys.length === 0) {
    return DASHBOARD_SNAPSHOT_KEYS;
  }
  const watchedKeys = new Set(DASHBOARD_SNAPSHOT_KEYS);
  return Array.from(new Set(keys.filter((key) => watchedKeys.has(key))));
};
const ELAPSED_LABEL_PATTERN = /^(\d+):(\d{2}):(\d{2})$/;
const OVERDUE_SECONDS = 24 * 60 * 60;

const alignToSecond = (value) => Math.floor(Number(value) / 1000) * 1000;

const elapsedLabelToSeconds = (value) => {
  const match = ELAPSED_LABEL_PATTERN.exec(String(value ?? ""));
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

const formatElapsedSeconds = (value) => {
  const elapsedSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = String(Math.floor(elapsedSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const parseDeviceBoundary = (device, snakeCaseKey, camelCaseKey) =>
  Date.parse(String(device?.[snakeCaseKey] ?? device?.[camelCaseKey] ?? ""));

const crossedDeviceMaintenanceBoundary = (devices, previousNow, currentNow) => {
  if (!Number.isFinite(previousNow) || !Number.isFinite(currentNow) || currentNow < previousNow) {
    return true;
  }
  return (Array.isArray(devices) ? devices : []).some((device) => {
    const startAt = parseDeviceBoundary(device, "maintenance_start_at", "maintenanceStartAt");
    const endAt = parseDeviceBoundary(device, "maintenance_end_at", "maintenanceEndAt");
    return (
      (Number.isFinite(startAt) && previousNow < startAt && currentNow >= startAt)
      || (Number.isFinite(endAt) && previousNow <= endAt && currentNow > endAt)
    );
  });
};

// 读取持久化快照数据，并输出可直接渲染的总览页视图状态。
function useDashboardPage() {
  const { loadSnapshot } = useStorageSnapshot(DASHBOARD_SNAPSHOT_KEYS, { profile: "dashboard" });

  const currentPage = ref(1);
  const now = ref(serverNowMs());
  const rawDevices = ref([]);
  const rawExperiments = ref([]);
  const rawExperimentRuns = ref([]);
  const rawExperimentRunTrays = ref([]);
  const rawExperimentTrays = ref([]);
  const rawConflicts = ref([]);
  const rawSchedules = ref([]);
  const rawSamples = ref([]);
  const rawStreams = ref([]);
  const rawTasks = ref([]);
  const loadError = ref("");
  let dashboardTimer = null;
  let modelReferenceNow = alignToSecond(now.value);
  const deviceTimeWindowRevision = ref(0);

  const dashboardModel = computed(() => {
    // 仅在快照或设备维护时间窗发生变化时重建；每秒时钟不再触发全量样品扫描。
    void deviceTimeWindowRevision.value;
    const builtAt = modelReferenceNow;
    return {
      builtAt,
      value: buildDashboardViewModel({
        devices: rawDevices.value,
        experiments: rawExperiments.value,
        experimentRuns: rawExperimentRuns.value,
        experimentRunTrays: rawExperimentRunTrays.value,
        experimentTrays: rawExperimentTrays.value,
        conflicts: rawConflicts.value,
        samples: rawSamples.value,
        schedules: rawSchedules.value,
        streams: rawStreams.value,
        tasks: rawTasks.value,
        now: builtAt,
      }),
    };
  });

  const viewModel = computed(() => dashboardModel.value.value);
  const unscheduledExperimentItems = computed(() => {
    const model = dashboardModel.value;
    const elapsedDeltaSeconds = Math.max(0, Math.floor((now.value - model.builtAt) / 1000));
    if (elapsedDeltaSeconds === 0) {
      return model.value.unscheduledExperimentItems;
    }
    return model.value.unscheduledExperimentItems.map((item) => {
      const elapsedSeconds = elapsedLabelToSeconds(item.elapsedLabel) + elapsedDeltaSeconds;
      return {
        ...item,
        elapsedLabel: formatElapsedSeconds(elapsedSeconds),
        isOverdue: item.isOverdue || elapsedSeconds >= OVERDUE_SECONDS,
      };
    });
  });

  const pageCount = computed(() => Math.max(Math.ceil(viewModel.value.taskRows.length / DASHBOARD_TASK_PAGE_SIZE), 1));

  const pagedTaskRows = computed(() => {
    // 当前页超界时先回收，再按页大小切片并重算序号。
    const safePage = Math.min(Math.max(currentPage.value, 1), pageCount.value);
    const startIndex = (safePage - 1) * DASHBOARD_TASK_PAGE_SIZE;
    return viewModel.value.taskRows.slice(startIndex, startIndex + DASHBOARD_TASK_PAGE_SIZE).map((row, index) => ({
      ...row,
      index: startIndex + index + 1,
    }));
  });

  const setCurrentPage = (page) => {
    currentPage.value = Math.min(Math.max(page, 1), pageCount.value);
  };

  const buildSnapshotFallback = () => ({
    [STORAGE_KEYS.conflicts]: rawConflicts.value,
    [STORAGE_KEYS.devices]: rawDevices.value,
    [STORAGE_KEYS.experiments]: rawExperiments.value,
    [STORAGE_KEYS.experiment_runs]: rawExperimentRuns.value,
    [STORAGE_KEYS.experiment_run_trays]: rawExperimentRunTrays.value,
    [STORAGE_KEYS.experiment_trays]: rawExperimentTrays.value,
    [STORAGE_KEYS.schedules]: rawSchedules.value,
    [STORAGE_KEYS.samples]: rawSamples.value,
    [STORAGE_KEYS.streams]: rawStreams.value,
    [STORAGE_KEYS.tasks]: rawTasks.value,
  });

  const applySnapshotArray = (snapshot, key, target) => {
    if (Array.isArray(snapshot?.[key])) {
      target.value = snapshot[key];
    }
  };

  const loadDashboard = async (changedKeys) => {
    try {
      const refreshKeys = normalizeDashboardRefreshKeys(changedKeys);
      const refreshKeySet = new Set(refreshKeys);
      const snapshotLoader = refreshKeys.length === DASHBOARD_SNAPSHOT_KEYS.length
        ? loadSnapshot
        : useStorageSnapshot(refreshKeys, { profile: "dashboard" }).loadSnapshot;
      const snapshot = await snapshotLoader({ fallbackSnapshot: buildSnapshotFallback() });
      modelReferenceNow = alignToSecond(now.value);
      const applyRequestedSnapshotArray = (key, target) => {
        if (refreshKeySet.has(key)) {
          applySnapshotArray(snapshot, key, target);
        }
      };
      applyRequestedSnapshotArray(STORAGE_KEYS.conflicts, rawConflicts);
      applyRequestedSnapshotArray(STORAGE_KEYS.devices, rawDevices);
      applyRequestedSnapshotArray(STORAGE_KEYS.experiments, rawExperiments);
      applyRequestedSnapshotArray(STORAGE_KEYS.experiment_runs, rawExperimentRuns);
      applyRequestedSnapshotArray(STORAGE_KEYS.experiment_run_trays, rawExperimentRunTrays);
      applyRequestedSnapshotArray(STORAGE_KEYS.experiment_trays, rawExperimentTrays);
      applyRequestedSnapshotArray(STORAGE_KEYS.schedules, rawSchedules);
      applyRequestedSnapshotArray(STORAGE_KEYS.samples, rawSamples);
      applyRequestedSnapshotArray(STORAGE_KEYS.streams, rawStreams);
      applyRequestedSnapshotArray(STORAGE_KEYS.tasks, rawTasks);
      loadError.value = "";
      // 数据量变化后若当前页已越界，则自动回退到最后一页。
      if (currentPage.value > pageCount.value) {
        currentPage.value = pageCount.value;
      }
    } catch (error) {
      const detail = error instanceof Error ? String(error.message || "").trim() : "";
      loadError.value = detail ? `总览数据加载失败，请稍后重试，${detail}` : "总览数据加载失败，请稍后重试";
    }
  };

  const handleSamplesUpdated = (event) => {
    storageRefresh.requestRefresh({
      ...(event?.detail || {}),
      keys: [STORAGE_KEYS.samples],
      immediate: true,
    });
  };

  const storageRefresh = useStorageSnapshotRefresh({
    keys: DASHBOARD_SNAPSHOT_KEYS,
    refresh: loadDashboard,
  });

  onMounted(() => {
    void loadDashboard();
    dashboardTimer = window.setInterval(() => {
      const previousNow = now.value;
      const currentNow = serverNowMs();
      now.value = currentNow;
      if (crossedDeviceMaintenanceBoundary(rawDevices.value, previousNow, currentNow)) {
        modelReferenceNow = alignToSecond(currentNow);
        deviceTimeWindowRevision.value += 1;
      }
    }, 1000);
    window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  onBeforeUnmount(() => {
    if (dashboardTimer) {
      window.clearInterval(dashboardTimer);
    }
    window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  return {
    currentPage,
    deviceItems: computed(() => viewModel.value.deviceItems),
    loadError,
    pageCount,
    pagedTaskRows,
    setCurrentPage,
    summaryCards: computed(() => viewModel.value.summaryCards),
    unscheduledExperimentItems,
  };
}

export { useDashboardPage };
