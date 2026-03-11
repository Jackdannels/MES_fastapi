import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { buildTaskRows, buildTrayOverviewRows as buildTrayOverviewRowsModel } from "@/lib/taskOverviewModel";

import { useTaskOverviewEditor } from "./useTaskOverviewEditor";

const TEST_TYPE_OPTIONS = ["冲击试验", "振动试验", "四综合试验", "温度冲击试验", "高低温湿热试验", "盐雾试验", "霉菌试验"];
const TRAY_OVERVIEW_TOTAL = 10;
const SCHEDULED_LABEL = "已排期";
const UNSCHEDULED_LABEL = "未排期";
const UNASSIGNED_EXPERIMENT_LABEL = "未分配";
const TASK_COUNTER_LABEL = "已排期/总任务数";
const TRAY_COUNTER_LABEL = "剩余托盘/总托盘数";

function getTodayDateValue(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

function buildOverviewMetrics({ filteredRows, trayOverviewRows, trayOverviewTotal, viewMode }) {
  const rows = Array.isArray(filteredRows) ? filteredRows : [];
  const trays = Array.isArray(trayOverviewRows) ? trayOverviewRows : [];
  const total = Number(trayOverviewTotal) || 0;
  const scheduledTaskCount = rows.filter((row) => Number(row?.scheduleCount || 0) > 0).length;
  const remainingTrayCount = trays.filter((tray) => String(tray?.targetExperiment || "").trim() === UNASSIGNED_EXPERIMENT_LABEL).length;
  const inTrayMode = viewMode === "tray";

  return {
    isTrayCounterAlert: inTrayMode && remainingTrayCount <= 2,
    overviewCounterLabel: inTrayMode ? TRAY_COUNTER_LABEL : TASK_COUNTER_LABEL,
    overviewCounterValue: inTrayMode ? `${remainingTrayCount}/${total}` : `${scheduledTaskCount}/${rows.length}`,
    remainingTrayCount,
    scheduledTaskCount,
  };
}

function applyRouteFiltersState({ routeQuery, viewMode, testTypeFilter, selectedTaskCode }) {
  const nextState = {
    selectedTaskCode,
    testTypeFilter,
    viewMode,
  };
  const routeTestType = String(routeQuery?.testType || "").trim();
  const routeTaskCode = String(routeQuery?.task || "").trim();
  if (routeTestType) {
    nextState.viewMode = "task";
    nextState.testTypeFilter = routeTestType;
  }
  if (routeTaskCode) {
    nextState.selectedTaskCode = routeTaskCode;
  }
  return nextState;
}

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
  const trayOverviewTotal = TRAY_OVERVIEW_TOTAL;
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

  const buildTrayOverviewRows = (tasks, samples, schedules) =>
    buildTrayOverviewRowsModel({
      tasks,
      samples,
      schedules,
      totalSlots: TRAY_OVERVIEW_TOTAL,
      scheduledLabel: SCHEDULED_LABEL,
      unscheduledLabel: UNSCHEDULED_LABEL,
      unassignedExperimentLabel: UNASSIGNED_EXPERIMENT_LABEL,
    });

  const replaceOverview = (tasks, samples, schedules) => {
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
    const trays = Array.isArray(row?.trays) ? row.trays : [];
    if (trays.length === 0) {
      return UNASSIGNED_EXPERIMENT_LABEL;
    }
    return String(trays.length);
  };

  const applyRouteFilters = () => {
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
