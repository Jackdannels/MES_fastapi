// 负责中控总览页的数据加载，并整理页面直接使用的响应式状态。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { buildDashboardViewModel } from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";

const DASHBOARD_TASK_PAGE_SIZE = 8;

// 读取持久化快照数据，并输出可直接渲染的总览页视图状态。
function useDashboardPage() {
  const { loadSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.devices,
    STORAGE_KEYS.streams,
    STORAGE_KEYS.experiments,
  ]);

  const currentPage = ref(1);
  const now = ref(Date.now());
  const rawDevices = ref([]);
  const rawExperiments = ref([]);
  const rawSchedules = ref([]);
  const rawStreams = ref([]);
  const rawTasks = ref([]);
  let dashboardTimer = null;

  const viewModel = computed(() =>
    buildDashboardViewModel({
      devices: rawDevices.value,
      experiments: rawExperiments.value,
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
    const snapshot = await loadSnapshot();
    rawDevices.value = Array.isArray(snapshot[STORAGE_KEYS.devices]) ? snapshot[STORAGE_KEYS.devices] : [];
    rawExperiments.value = Array.isArray(snapshot[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
    rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
    rawStreams.value = Array.isArray(snapshot[STORAGE_KEYS.streams]) ? snapshot[STORAGE_KEYS.streams] : [];
    rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
    // 数据量变化后若当前页已越界，则自动回退到最后一页。
    if (currentPage.value > pageCount.value) {
      currentPage.value = pageCount.value;
    }
  };

  onMounted(() => {
    void loadDashboard();
    dashboardTimer = window.setInterval(() => {
      now.value = Date.now();
    }, 1000);
  });

  onBeforeUnmount(() => {
    if (dashboardTimer) {
      window.clearInterval(dashboardTimer);
    }
  });

  return {
    currentPage,
    deviceItems: computed(() => viewModel.value.deviceItems),
    pageCount,
    pagedTaskRows,
    setCurrentPage,
    summaryCards: computed(() => viewModel.value.summaryCards),
    unscheduledExperimentItems: computed(() => viewModel.value.unscheduledExperimentItems),
  };
}

export { useDashboardPage };
