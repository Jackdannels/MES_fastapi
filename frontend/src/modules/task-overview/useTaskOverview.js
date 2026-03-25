// 负责任务总览页的筛选、计数器和编辑交互逻辑。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { SYSTEM_TRAY_TOTAL } from "@/lib/trayCapacity";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { buildTaskRows, buildTrayOverviewRows as buildTrayOverviewRowsModel } from "./model";

import { useTaskOverviewEditor } from "./useTaskOverviewEditor";

const TEST_TYPE_OPTIONS = ["冲击试验", "振动试验", "四综合试验", "温度冲击试验", "高低温湿热试验", "盐雾试验", "霉菌试验"];
const SCHEDULED_LABEL = "已排程";
const UNSCHEDULED_LABEL = "未排程";
const UNASSIGNED_EXPERIMENT_LABEL = "未分配";
const TASK_COUNTER_LABEL = "已排程总任务数";
const TRAY_COUNTER_LABEL = "剩余托盘/总托盘数";

// 为默认日期筛选控件生成稳定的 yyyy-mm-dd 值。
function getTodayDateValue(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 在渲染前对总览卡片应用关键词、类型和时间筛选。
function filterTaskOverviewRows({
  rows,
  keyword,
  testTypeFilter,
  timeFilter,
  customStartDate,
  customEndDate,
  now = new Date(),
}) {
  const rowList = Array.isArray(rows) ? rows : [];
  const query = String(keyword || "").trim().toLowerCase();
  const selectedType = String(testTypeFilter || "").trim();
  const selectedTime = String(timeFilter || "all");
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ms7 = 7 * 24 * 60 * 60 * 1000;
  const ms30 = 30 * 24 * 60 * 60 * 1000;

  const matchTime = (row) => {
    // 时间筛选统一基于任务聚合行里的 timeValue 字段判断。
    if (selectedTime === "all") {
      return true;
    }
    const rowTime = new Date(row?.timeValue || "").getTime();
    if (!Number.isFinite(rowTime)) {
      return false;
    }
    if (selectedTime === "today") {
      return rowTime >= startOfToday;
    }
    if (selectedTime === "last7") {
      return now.getTime() - rowTime <= ms7;
    }
    if (selectedTime === "last30") {
      return now.getTime() - rowTime <= ms30;
    }
    if (selectedTime === "thisYear") {
      return new Date(rowTime).getFullYear() === now.getFullYear();
    }
    if (selectedTime === "custom") {
      // 自定义区间允许开始结束倒置，内部会自动交换。
      const rawStart = customStartDate ? new Date(`${customStartDate}T00:00:00`).getTime() : Number.NaN;
      const rawEnd = customEndDate ? new Date(`${customEndDate}T23:59:59`).getTime() : Number.NaN;
      let start = Number.isFinite(rawStart) ? rawStart : null;
      let end = Number.isFinite(rawEnd) ? rawEnd : null;
      if (start !== null && end !== null && start > end) {
        const temp = start;
        start = end;
        end = temp;
      }
      if (start !== null && rowTime < start) {
        return false;
      }
      if (end !== null && rowTime > end) {
        return false;
      }
      return true;
    }
    return true;
  };

  return rowList.filter((row) => {
    // 关键词搜索覆盖任务号、类型、状态、样品号和托盘号。
    if (selectedType && (row?.taskType || "") !== selectedType) {
      return false;
    }
    if (!matchTime(row)) {
      return false;
    }
    if (!query) {
      return true;
    }
    const text = [
      row?.taskCode,
      row?.taskType,
      row?.currentStatus,
      row?.scheduleLabel,
      Array.isArray(row?.sampleCodes) ? row.sampleCodes.join(" ") : "",
      Array.isArray(row?.trays) ? row.trays.map((tray) => tray?.trayCode).join(" ") : "",
    ]
      .join(" ")
      .toLowerCase();
    return text.includes(query);
  });
}

// 构建任务视图和托盘视图顶部显示的汇总计数。
function buildOverviewMetrics({ filteredRows, trayOverviewRows, trayOverviewTotal, viewMode }) {
  const rows = Array.isArray(filteredRows) ? filteredRows : [];
  const trays = Array.isArray(trayOverviewRows) ? trayOverviewRows : [];
  const total = Number(trayOverviewTotal) || 0;
  const scheduledTaskCount = rows.filter((row) => Number(row?.scheduleCount || 0) > 0).length;
  const remainingTrayCount = trays.filter((tray) => String(tray?.targetExperiment || "").trim() === UNASSIGNED_EXPERIMENT_LABEL).length;
  const inTrayMode = viewMode === "tray";

  return {
    // 托盘模式下剩余托盘过少时给顶部计数器加预警态。
    isTrayCounterAlert: inTrayMode && remainingTrayCount <= 2,
    overviewCounterLabel: inTrayMode ? TRAY_COUNTER_LABEL : TASK_COUNTER_LABEL,
    overviewCounterValue: inTrayMode ? `${remainingTrayCount}/${total}` : `${scheduledTaskCount}/${rows.length}`,
    remainingTrayCount,
    scheduledTaskCount,
  };
}

// 将路由 query 中的状态合并到当前筛选条件和选中任务中。
function applyRouteFiltersState({ routeQuery, viewMode, testTypeFilter, selectedTaskCode }) {
  const nextState = {
    selectedTaskCode,
    testTypeFilter,
    viewMode,
  };
  const routeTestType = String(routeQuery?.testType || "").trim();
  const routeTaskCode = String(routeQuery?.task || "").trim();
  if (routeTestType) {
    // 路由指定试验类型时，页面会强制切回任务视图。
    nextState.viewMode = "task";
    nextState.testTypeFilter = routeTestType;
  }
  if (routeTaskCode) {
    nextState.selectedTaskCode = routeTaskCode;
  }
  return nextState;
}

// 统一管理任务总览页的加载、筛选、托盘模式和编辑器联动。
function useTaskOverview() {
  const route = useRoute();
  const overviewRoot = ref(null);
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.streams,
  ]);

  const loading = ref(false);
  const viewMode = ref("task");
  const trayOverviewRows = ref([]);
  const trayOverviewTotal = SYSTEM_TRAY_TOTAL;
  const keyword = ref("");
  const timeFilter = ref("all");
  const customStartDate = ref(getTodayDateValue());
  const customEndDate = ref(getTodayDateValue());
  const testTypeFilter = ref("");
  const rows = ref([]);

  const buildRows = (tasks, samples, schedules) =>
    buildTaskRows({
      tasks,
      samples,
      schedules,
      scheduledLabel: SCHEDULED_LABEL,
      unscheduledLabel: UNSCHEDULED_LABEL,
    });

  // 托盘视图和任务视图共享同一份底层快照，但会产出不同结构。
  const buildTrayOverviewRows = (tasks, samples, schedules) =>
    buildTrayOverviewRowsModel({
      tasks,
      samples,
      schedules,
      totalSlots: SYSTEM_TRAY_TOTAL,
      scheduledLabel: SCHEDULED_LABEL,
      unscheduledLabel: UNSCHEDULED_LABEL,
      unassignedExperimentLabel: UNASSIGNED_EXPERIMENT_LABEL,
    });

  const replaceOverview = (tasks, samples, schedules) => {
    // 编辑器保存/删除后通过这个入口一次性刷新两种视图。
    rows.value = buildRows(tasks, samples, schedules);
    trayOverviewRows.value = buildTrayOverviewRows(tasks, samples, schedules);
  };

  const {
    selectedTaskCode,
    editingTaskCode,
    savingTaskCode,
    deletingTaskCode,
    deleteConfirm,
    editError,
    editMessage,
    editForm,
    isEditing,
    openEdit,
    cancelEdit,
    resetDeleteConfirm,
    handleCardClick,
    handleCardDblClick,
    handleGlobalClick: handleEditorGlobalClick,
    generateCodesByCount,
    saveEdit,
    requestDeleteTask,
    confirmDeleteTask,
    updateEditForm,
  } = useTaskOverviewEditor({
    loadSnapshot,
    persistSnapshot,
    replaceOverview,
  });

  const loadOverview = async () => {
    loading.value = true;
    try {
      const snapshot = await loadSnapshot();
      replaceOverview(snapshot[STORAGE_KEYS.tasks], snapshot[STORAGE_KEYS.samples], snapshot[STORAGE_KEYS.schedules]);
    } finally {
      loading.value = false;
    }
  };

  const handleWindowClick = (event) => {
    handleEditorGlobalClick(event, overviewRoot.value);
  };

  const filteredRows = computed(() =>
    filterTaskOverviewRows({
      rows: rows.value,
      keyword: keyword.value,
      testTypeFilter: testTypeFilter.value,
      timeFilter: timeFilter.value,
      customStartDate: customStartDate.value,
      customEndDate: customEndDate.value,
    })
  );

  const testTypeOptions = computed(() => {
    // 下拉项由预设试验类型和当前数据中的动态类型合并生成。
    const dynamicTypes = rows.value.map((row) => String(row?.taskType || "").trim()).filter(Boolean);
    return Array.from(new Set(TEST_TYPE_OPTIONS.concat(dynamicTypes))).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  });

  const taskTypeEditOptions = computed(() => testTypeOptions.value);
  const overviewMetrics = computed(() =>
    buildOverviewMetrics({
      filteredRows: filteredRows.value,
      trayOverviewRows: trayOverviewRows.value,
      trayOverviewTotal,
      viewMode: viewMode.value,
    })
  );
  const overviewCounterLabel = computed(() => overviewMetrics.value.overviewCounterLabel);
  const overviewCounterValue = computed(() => overviewMetrics.value.overviewCounterValue);
  const isTrayCounterAlert = computed(() => overviewMetrics.value.isTrayCounterAlert);

  const formatTraySummary = (row) => {
    const trays = Array.isArray(row?.trays) ? row.trays : [];
    if (trays.length === 0) {
      return "未分配托盘";
    }
    return trays.map((tray) => String(tray?.trayCode || "").trim()).filter(Boolean).join("、") || "未分配托盘";
  };

  const formatTrayCount = (row) => {
    // 无托盘时返回“未分配”，便于托盘列直接展示。
    const trays = Array.isArray(row?.trays) ? row.trays : [];
    if (trays.length === 0) {
      return UNASSIGNED_EXPERIMENT_LABEL;
    }
    return String(trays.length);
  };

  const applyRouteFilters = () => {
    // 页面初始化和 query 变化都走同一套路由筛选合并逻辑。
    const nextState = applyRouteFiltersState({
      routeQuery: route.query,
      selectedTaskCode: selectedTaskCode.value,
      testTypeFilter: testTypeFilter.value,
      viewMode: viewMode.value,
    });
    viewMode.value = nextState.viewMode;
    testTypeFilter.value = nextState.testTypeFilter;
    selectedTaskCode.value = nextState.selectedTaskCode;
  };

  watch(timeFilter, (nextValue) => {
    if (nextValue !== "custom") {
      return;
    }
    if (!customStartDate.value) {
      customStartDate.value = getTodayDateValue();
    }
    if (!customEndDate.value) {
      customEndDate.value = getTodayDateValue();
    }
  });

  watch(viewMode, (nextValue) => {
    if (nextValue !== "task") {
      // 离开任务视图时清空选中卡片和编辑态，避免托盘视图残留交互状态。
      selectedTaskCode.value = "";
      if (editingTaskCode.value) {
        cancelEdit();
      }
    }
  });

  watch(
    () => [route.query.testType, route.query.task],
    () => {
      applyRouteFilters();
    }
  );

  onMounted(() => {
    applyRouteFilters();
    // 首次加载后挂全局点击，用于处理卡片外点击关闭编辑器。
    loadOverview();
    if (typeof window !== "undefined") {
      window.addEventListener("click", handleWindowClick);
    }
  });

  onBeforeUnmount(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("click", handleWindowClick);
    }
  });

  return {
    cancelEdit,
    confirmDeleteTask,
    customEndDate,
    customStartDate,
    deleteConfirm,
    deletingTaskCode,
    editError,
    editForm,
    editMessage,
    filteredRows,
    formatTrayCount,
    formatTraySummary,
    generateCodesByCount,
    handleCardClick,
    handleCardDblClick,
    isEditing,
    isTrayCounterAlert,
    keyword,
    loadOverview,
    loading,
    openEdit,
    overviewCounterLabel,
    overviewCounterValue,
    overviewRoot,
    requestDeleteTask,
    resetDeleteConfirm,
    saveEdit,
    savingTaskCode,
    selectedTaskCode,
    taskTypeEditOptions,
    testTypeFilter,
    testTypeOptions,
    timeFilter,
    trayOverviewRows,
    trayOverviewTotal,
    updateEditForm,
    viewMode,
  };
}

export {
  applyRouteFiltersState,
  buildOverviewMetrics,
  filterTaskOverviewRows,
  getTodayDateValue,
  useTaskOverview,
};
