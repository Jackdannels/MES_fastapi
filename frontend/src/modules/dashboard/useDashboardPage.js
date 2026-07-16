// 负责中控总览页的数据加载，并整理页面直接使用的响应式状态。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { buildDashboardViewModel } from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { serverNowMs } from "@/lib/serverClock";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

const DASHBOARD_TASK_PAGE_SIZE = 8;

// 读取持久化快照数据，并输出可直接渲染的总览页视图状态。
function useDashboardPage() {
  const { loadSnapshot } = useStorageSnapshot([
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
  ]);

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

  const viewModel = computed(() =>
    buildDashboardViewModel({
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
      now: now.value,
    })
  );

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

  const loadDashboard = async () => {
    try {
      const snapshot = await loadSnapshot({ fallbackSnapshot: buildSnapshotFallback() });
      applySnapshotArray(snapshot, STORAGE_KEYS.conflicts, rawConflicts);
      applySnapshotArray(snapshot, STORAGE_KEYS.devices, rawDevices);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiments, rawExperiments);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_runs, rawExperimentRuns);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_trays, rawExperimentRunTrays);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_trays, rawExperimentTrays);
      applySnapshotArray(snapshot, STORAGE_KEYS.schedules, rawSchedules);
      applySnapshotArray(snapshot, STORAGE_KEYS.samples, rawSamples);
      applySnapshotArray(snapshot, STORAGE_KEYS.streams, rawStreams);
      applySnapshotArray(snapshot, STORAGE_KEYS.tasks, rawTasks);
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

  const handleSamplesUpdated = () => {
    void loadDashboard();
  };

  useStorageSnapshotRefresh({
    keys: [
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
    ],
    refresh: loadDashboard,
  });

  onMounted(() => {
    void loadDashboard();
    dashboardTimer = window.setInterval(() => {
      now.value = serverNowMs();
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
    unscheduledExperimentItems: computed(() => viewModel.value.unscheduledExperimentItems),
  };
}

export { useDashboardPage };
