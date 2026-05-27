// 负责中控总览页的数据加载，并整理页面直接使用的响应式状态。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { buildDashboardViewModel } from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/useSampleIntake";

const DASHBOARD_TASK_PAGE_SIZE = 8;
const DASHBOARD_REFRESH_INTERVAL_MS = 5000;

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
  ]);

  const currentPage = ref(1);
  const now = ref(Date.now());
  const rawDevices = ref([]);
  const rawExperiments = ref([]);
  const rawConflicts = ref([]);
  const rawSchedules = ref([]);
  const rawSamples = ref([]);
  const rawStreams = ref([]);
  const rawTasks = ref([]);
  const loadError = ref("");
  let dashboardTimer = null;
  let dashboardRefreshTimer = null;

  const viewModel = computed(() =>
    buildDashboardViewModel({
      devices: rawDevices.value,
      experiments: rawExperiments.value,
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

  const loadDashboard = async () => {
    try {
      const snapshot = await loadSnapshot();
      rawConflicts.value = Array.isArray(snapshot[STORAGE_KEYS.conflicts]) ? snapshot[STORAGE_KEYS.conflicts] : [];
      rawDevices.value = Array.isArray(snapshot[STORAGE_KEYS.devices]) ? snapshot[STORAGE_KEYS.devices] : [];
      rawExperiments.value = Array.isArray(snapshot[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
      rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
      rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
      rawStreams.value = Array.isArray(snapshot[STORAGE_KEYS.streams]) ? snapshot[STORAGE_KEYS.streams] : [];
      rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
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

  onMounted(() => {
    void loadDashboard();
    dashboardTimer = window.setInterval(() => {
      now.value = Date.now();
    }, 1000);
    dashboardRefreshTimer = window.setInterval(() => {
      void loadDashboard();
    }, DASHBOARD_REFRESH_INTERVAL_MS);
    window.addEventListener(SAMPLES_UPDATED_EVENT, loadDashboard);
    window.addEventListener("storage", loadDashboard);
    window.addEventListener("focus", loadDashboard);
  });

  onBeforeUnmount(() => {
    if (dashboardTimer) {
      window.clearInterval(dashboardTimer);
    }
    if (dashboardRefreshTimer) {
      window.clearInterval(dashboardRefreshTimer);
    }
    window.removeEventListener(SAMPLES_UPDATED_EVENT, loadDashboard);
    window.removeEventListener("storage", loadDashboard);
    window.removeEventListener("focus", loadDashboard);
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
