// 过程管控兼容门面：保持原参数、返回字段和响应式语义，职责委托给单向依赖模块。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";
import { readMasterLabs } from "@/lib/masterDataApi";
import { serverNowMs } from "@/lib/serverClock";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { PROCESS_LABS } from "./model";
import {
  PROCESS_FILTERS,
  mergeProcessLabsWithStaticFallback,
  normalizeMasterProcessLabs,
  normalizeText,
} from "./processLabCatalog";
import { createProcessScheduleSelection } from "./processScheduleSelection";
import { createProcessTaskProjection } from "./processTaskProjection";
import { createProcessTrayProjection } from "./processTrayProjection";

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

function useProcessLabs(options = {}) {
  const hasExplicitLabs = Array.isArray(options.labs);
  const fallbackLabs = hasExplicitLabs ? options.labs : PROCESS_LABS;
  const processLabs = ref(fallbackLabs);
  const storage = options.storage || useStorageSnapshot([
    STORAGE_KEYS.devices,
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.experiment_runs,
    STORAGE_KEYS.experiment_run_trays,
    STORAGE_KEYS.experiment_run_steps,
    STORAGE_KEYS.experiments,
  ]);
  const loadSnapshot = options.loadSnapshot || storage.loadSnapshot;
  const loadTransferWorkspace = options.loadTransferWorkspace || (async (taskCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    if (!normalizedTaskCode) {
      return null;
    }
    try {
      const response = await fetch(
        buildApiUrl(`/api/transfer-area/tasks/${encodeURIComponent(normalizedTaskCode)}/workspace`, getFrontendApiBaseUrl()),
        { headers: { Accept: "application/json" }, credentials: "include" },
      );
      return response.ok ? await response.json() : null;
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
  const experimentRunSteps = ref([]);
  const experiments = ref([]);
  const transferWorkspaceByTaskCode = ref({});
  const activeFilter = ref(PROCESS_FILTERS.overview);
  const processActionMessage = ref("");
  const selectedTaskDetail = ref(null);
  const selectedTaskLabName = ref("");
  const selectedTaskCodeByLab = ref({});
  const selectedTrayCode = ref("");
  const taskDrawerOpen = ref(false);
  let labStatusLoadVersion = 0;
  let flushPendingStorageRefresh = () => false;
  let requestStorageRefresh = () => {};
  let hasPendingSamplesRefresh = false;

  const state = {
    devices,
    experimentRuns,
    experimentRunSteps,
    experimentRunTrays,
    experimentSamples,
    experiments,
    experimentTrays,
    labCards,
    samples,
    schedules,
    tasks,
  };
  const currentTimeValue = () => (Number.isFinite(now) ? now : serverNowMs());
  const scheduleSelection = createProcessScheduleSelection({ nowValue: currentTimeValue, processLabs, state });
  const trayProjection = createProcessTrayProjection({ scheduleSelection, state });
  const taskProjection = createProcessTaskProjection({
    currentTimeValue,
    processLabs,
    scheduleSelection,
    selectedTaskCodeByLab,
    selectedTrayCode,
    state,
    trayProjection,
  });

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
    selectedTaskDetail.value = taskProjection.buildTaskDetail(lab);
    selectedTrayCode.value = selectedTaskDetail.value?.selectedTrayCode || "";
  };

  const buildSnapshotFallback = () => ({
    [STORAGE_KEYS.devices]: devices.value,
    [STORAGE_KEYS.tasks]: tasks.value,
    [STORAGE_KEYS.schedules]: schedules.value,
    [STORAGE_KEYS.samples]: samples.value,
    [STORAGE_KEYS.experiment_trays]: experimentTrays.value,
    [STORAGE_KEYS.experiment_samples]: experimentSamples.value,
    [STORAGE_KEYS.experiment_runs]: experimentRuns.value,
    [STORAGE_KEYS.experiment_run_trays]: experimentRunTrays.value,
    [STORAGE_KEYS.experiment_run_steps]: experimentRunSteps.value,
    [STORAGE_KEYS.experiments]: experiments.value,
  });

  const applySnapshotArray = (snapshot, key, target) => {
    if (Array.isArray(snapshot?.[key])) {
      target.value = snapshot[key];
    }
  };

  const loadLabStatus = async ({ silent = false } = {}) => {
    const loadVersion = ++labStatusLoadVersion;
    const showBlockingLoading = !silent || labCards.value.length === 0;
    if (showBlockingLoading) {
      loading.value = true;
    }
    try {
      const [snapshot, masterLabs] = await Promise.all([
        loadSnapshot(silent ? { fallbackSnapshot: buildSnapshotFallback() } : undefined),
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
      applySnapshotArray(snapshot, STORAGE_KEYS.devices, devices);
      applySnapshotArray(snapshot, STORAGE_KEYS.tasks, tasks);
      applySnapshotArray(snapshot, STORAGE_KEYS.schedules, schedules);
      applySnapshotArray(snapshot, STORAGE_KEYS.samples, samples);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_trays, experimentTrays);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_samples, experimentSamples);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_runs, experimentRuns);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_trays, experimentRunTrays);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_steps, experimentRunSteps);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiments, experiments);
      taskProjection.rebuildLabCards();
      if (taskDrawerOpen.value) {
        refreshSelectedTaskDetail(selectedTrayCode.value);
      }
    } finally {
      if (showBlockingLoading && loadVersion === labStatusLoadVersion) {
        loading.value = false;
      }
    }
  };

  const overviewCount = computed(() => labCards.value.length);
  const runningCount = computed(() => labCards.value.filter((lab) => lab.statusClass === "is-running").length);
  const scheduledCount = computed(() =>
    labCards.value.filter((lab) => lab.statusClass === "is-running" || lab.statusClass === "is-scheduled").length);
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
    if (Object.values(PROCESS_FILTERS).includes(value)) {
      activeFilter.value = value;
    }
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
    if (taskDrawerOpen.value) {
      refreshSelectedTaskDetail(normalizeText(trayCode));
    }
  };

  const setSelectedTaskForLab = (labName, taskCode, experimentCode = "") => {
    const normalizedLabName = normalizeText(labName);
    const normalizedTaskCode = normalizeText(taskCode);
    selectedTaskCodeByLab.value = {
      ...selectedTaskCodeByLab.value,
      [normalizedLabName]: scheduleSelection.buildExperimentSelectionKey(normalizedTaskCode, experimentCode),
    };
    taskProjection.rebuildLabCards();
    if (selectedTaskLabName.value === normalizedLabName) {
      selectedTrayCode.value = "";
      refreshSelectedTaskDetail("");
    }
  };

  const closeTaskDrawer = () => {
    taskDrawerOpen.value = false;
    selectedTaskDetail.value = null;
    selectedTaskLabName.value = "";
    selectedTrayCode.value = "";
    flushPendingRealtimeRefresh();
  };

  const isProcessRealtimeRefreshPaused = () => Boolean(taskDrawerOpen.value);

  const flushPendingRealtimeRefresh = () => {
    const flushedStorage = flushPendingStorageRefresh();
    if (!hasPendingSamplesRefresh || isProcessRealtimeRefreshPaused()) {
      return flushedStorage;
    }
    hasPendingSamplesRefresh = false;
    if (!flushedStorage) {
      void loadLabStatus({ silent: true });
    }
    return true;
  };

  const handleSamplesUpdated = (event) => {
    if (isProcessRealtimeRefreshPaused()) {
      hasPendingSamplesRefresh = true;
      return;
    }
    hasPendingSamplesRefresh = false;
    requestStorageRefresh({
      ...(event?.detail || {}),
      keys: [STORAGE_KEYS.samples],
      immediate: true,
    });
  };

  if (autoLoad) {
    const storageRefresh = useStorageSnapshotRefresh({
      keys: Array.from(PROCESS_SNAPSHOT_KEYS),
      refresh: () => loadLabStatus({ silent: true }),
      paused: isProcessRealtimeRefreshPaused,
    });
    flushPendingStorageRefresh = storageRefresh.flushPendingRefresh;
    requestStorageRefresh = storageRefresh.requestRefresh;
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
    setSelectedTaskForLab,
    setActiveFilter,
    taskDrawerOpen,
    visibleLabCards,
  };
}

export { PROCESS_FILTERS, useProcessLabs };
