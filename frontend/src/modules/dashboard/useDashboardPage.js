// 负责中控总览页的数据加载，并整理页面直接使用的响应式状态。
import { computed, onMounted, ref } from "vue";

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
  ]);

  const currentPage = ref(1);
  const viewModel = ref(
    buildDashboardViewModel({
      devices: [],
      schedules: [],
      streams: [],
      tasks: [],
    })
  );

  const pageCount = computed(() => Math.max(Math.ceil(viewModel.value.taskRows.length / DASHBOARD_TASK_PAGE_SIZE), 1));

  const pagedTaskRows = computed(() => {
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
    viewModel.value = buildDashboardViewModel({
      devices: snapshot[STORAGE_KEYS.devices],
      schedules: snapshot[STORAGE_KEYS.schedules],
      streams: snapshot[STORAGE_KEYS.streams],
      tasks: snapshot[STORAGE_KEYS.tasks],
    });
    if (currentPage.value > pageCount.value) {
      currentPage.value = pageCount.value;
    }
  };

  onMounted(loadDashboard);

  return {
    currentPage,
    dataGap: computed(() => viewModel.value.dataGap),
    dataHealth: computed(() => viewModel.value.dataHealth),
    deviceItems: computed(() => viewModel.value.deviceItems),
    pageCount,
    pagedTaskRows,
    setCurrentPage,
    summaryCards: computed(() => viewModel.value.summaryCards),
  };
}

export { useDashboardPage };
