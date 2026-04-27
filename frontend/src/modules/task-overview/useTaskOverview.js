// 负责任务总览页的筛选、计数器和编辑交互逻辑。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { buildExperimentTypeOptions, matchesExperimentTypeFilter } from "@/lib/experimentTypes";
import { SYSTEM_TRAY_TOTAL } from "@/lib/trayCapacity";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { buildTaskRows, buildTrayOverviewRows as buildTrayOverviewRowsModel } from "./model";

import { useTaskOverviewEditor } from "./useTaskOverviewEditor";

const SCHEDULED_LABEL = "已排程";
const UNSCHEDULED_LABEL = "未排程";
const UNASSIGNED_EXPERIMENT_LABEL = "未分配";
const TASK_COUNTER_LABEL = "已排程/总任务数";
const EXPERIMENT_COUNTER_LABEL = "已排程总实验数";
const TRAY_COUNTER_LABEL = "剩余托盘/总托盘数";
const TASK_SCHEDULE_FILTERS = new Set(["all", "scheduled", "unscheduled"]);
const TASK_OVERVIEW_PAGE_SIZE = 5;
const TASK_HIGHLIGHT_QUERY_KEY = "highlightTask";
const TASK_HIGHLIGHT_CLASS = "is-highlighted";
const TASK_HIGHLIGHT_DURATION_MS = 2200;

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
  scheduleFilter = "all",
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
  const selectedScheduleFilter = TASK_SCHEDULE_FILTERS.has(String(scheduleFilter || "")) ? String(scheduleFilter || "") : "all";
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
    if (!matchesExperimentTypeFilter(selectedType, row?.taskType, row?.experimentSummary)) {
      return false;
    }
    const isScheduled = Number(row?.scheduleCount || 0) > 0;
    if (selectedScheduleFilter === "scheduled" && !isScheduled) {
      return false;
    }
    if (selectedScheduleFilter === "unscheduled" && isScheduled) {
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
      row?.experimentSummary,
      row?.taskType,
      row?.currentStatusLabel,
      row?.currentStatus,
      row?.scheduleLabel,
      Array.isArray(row?.experiments) ? row.experiments.map((item) => `${item?.experimentName || ""} ${item?.displayStatus || ""}`).join(" ") : "",
      Array.isArray(row?.sampleCodes) ? row.sampleCodes.join(" ") : "",
      Array.isArray(row?.trays) ? row.trays.map((tray) => tray?.trayCode).join(" ") : "",
    ]
      .join(" ")
      .toLowerCase();
    return text.includes(query);
  });
}

function cycleTaskScheduleFilter(currentFilter) {
  if (currentFilter === "scheduled") {
    return "unscheduled";
  }
  if (currentFilter === "unscheduled") {
    return "all";
  }
  return "scheduled";
}

// 构建任务视图和托盘视图顶部显示的汇总计数。
function buildOverviewMetrics({ filteredRows, trayOverviewRows, trayOverviewTotal, viewMode }) {
  const rows = Array.isArray(filteredRows) ? filteredRows : [];
  const trays = Array.isArray(trayOverviewRows) ? trayOverviewRows : [];
  const total = Number(trayOverviewTotal) || 0;
  const scheduledTaskCount = rows.filter((row) => Number(row?.scheduleCount || 0) > 0).length;
  const unscheduledTaskCount = rows.length - scheduledTaskCount;
  const scheduledExperimentCount = rows.reduce((sum, row) => sum + Number(row?.scheduledExperimentCount || 0), 0);
  const eligibleExperimentCount = rows.reduce((sum, row) => sum + Number(row?.eligibleExperimentCount || 0), 0);
  const remainingTrayCount = trays.filter((tray) => String(tray?.targetExperiment || "").trim() === UNASSIGNED_EXPERIMENT_LABEL).length;
  const inTrayMode = viewMode === "tray";

  return {
    experimentCounterLabel: inTrayMode ? "" : EXPERIMENT_COUNTER_LABEL,
    experimentCounterValue: inTrayMode ? "" : `${scheduledExperimentCount}/${eligibleExperimentCount}`,
    // 托盘模式下剩余托盘过少时给顶部计数器加预警态。
    isTrayCounterAlert: inTrayMode && remainingTrayCount <= 2,
    overviewCounterLabel: inTrayMode ? TRAY_COUNTER_LABEL : TASK_COUNTER_LABEL,
    overviewCounterValue: inTrayMode ? `${remainingTrayCount}/${total}` : `${scheduledTaskCount}/${rows.length}`,
    remainingTrayCount,
    scheduledTaskCount,
    totalTaskCount: rows.length,
    unscheduledTaskCount,
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

function findTaskCardElement(rootElement, taskCode) {
  const normalizedTaskCode = String(taskCode || "").trim();
  if (!rootElement || !normalizedTaskCode) {
    return null;
  }
  return Array.from(rootElement.querySelectorAll(".task-overview-card")).find(
    (element) => String(element.getAttribute("data-task-code") || "").trim() === normalizedTaskCode
  ) || null;
}

// 统一管理任务总览页的加载、筛选、托盘模式和编辑器联动。
function useTaskOverview() {
  const route = useRoute();
  const router = useRouter();
  const overviewRoot = ref(null);
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.streams,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_trays,
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
  const taskScheduleFilter = ref("all");
  const taskPage = ref(1);
  const rows = ref([]);
  let highlightTimer = null;
  let highlightedCardElement = null;

  const buildRows = (tasks, samples, schedules, experiments, experimentTrays) =>
    buildTaskRows({
      tasks,
      experiments,
      samples,
      schedules,
      experimentTrays,
      scheduledLabel: SCHEDULED_LABEL,
      unscheduledLabel: UNSCHEDULED_LABEL,
    });

  // 托盘视图和任务视图共享同一份底层快照，但会产出不同结构。
  const buildTrayOverviewRows = (tasks, samples, schedules, experiments) =>
    buildTrayOverviewRowsModel({
      tasks,
      experiments,
      samples,
      schedules,
      totalSlots: SYSTEM_TRAY_TOTAL,
      scheduledLabel: SCHEDULED_LABEL,
      unscheduledLabel: UNSCHEDULED_LABEL,
      unassignedExperimentLabel: UNASSIGNED_EXPERIMENT_LABEL,
    });

  const replaceOverview = (tasks, samples, schedules, experiments, experimentTrays = []) => {
    // 编辑器保存/删除后通过这个入口一次性刷新两种视图。
    rows.value = buildRows(tasks, samples, schedules, experiments, experimentTrays);
    trayOverviewRows.value = buildTrayOverviewRows(tasks, samples, schedules, experiments);
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
      replaceOverview(
        snapshot[STORAGE_KEYS.tasks],
        snapshot[STORAGE_KEYS.samples],
        snapshot[STORAGE_KEYS.schedules],
        snapshot[STORAGE_KEYS.experiments],
        snapshot[STORAGE_KEYS.experiment_trays],
      );
    } finally {
      loading.value = false;
    }
  };

  const handleWindowClick = (event) => {
    handleEditorGlobalClick(event, overviewRoot.value);
  };

  const baseFilteredRows = computed(() =>
    filterTaskOverviewRows({
      rows: rows.value,
      keyword: keyword.value,
      scheduleFilter: "all",
      testTypeFilter: testTypeFilter.value,
      timeFilter: timeFilter.value,
      customStartDate: customStartDate.value,
      customEndDate: customEndDate.value,
    })
  );
  const filteredRows = computed(() =>
    filterTaskOverviewRows({
      rows: baseFilteredRows.value,
      keyword: "",
      scheduleFilter: taskScheduleFilter.value,
      testTypeFilter: "",
      timeFilter: "all",
      customStartDate: "",
      customEndDate: "",
    })
  );
  const taskPageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / TASK_OVERVIEW_PAGE_SIZE)));
  const currentTaskPage = computed(() => Math.min(taskPage.value, taskPageCount.value));
  const pagedRows = computed(() => filteredRows.value.slice(
    (currentTaskPage.value - 1) * TASK_OVERVIEW_PAGE_SIZE,
    currentTaskPage.value * TASK_OVERVIEW_PAGE_SIZE,
  ));

  const testTypeOptions = computed(() => {
    // 下拉项统一只展示当前数据中存在的原子实验类型。
    return buildExperimentTypeOptions(rows.value.map((row) => row?.experimentSummary || row?.taskType));
  });

  const taskTypeEditOptions = computed(() => testTypeOptions.value);
  const overviewMetrics = computed(() =>
    buildOverviewMetrics({
      filteredRows: baseFilteredRows.value,
      trayOverviewRows: trayOverviewRows.value,
      trayOverviewTotal,
      viewMode: viewMode.value,
    })
  );
  const experimentCounterLabel = computed(() => overviewMetrics.value.experimentCounterLabel);
  const experimentCounterValue = computed(() => overviewMetrics.value.experimentCounterValue);
  const overviewCounterLabel = computed(() => overviewMetrics.value.overviewCounterLabel);
  const overviewCounterValue = computed(() => overviewMetrics.value.overviewCounterValue);
  const isTrayCounterAlert = computed(() => overviewMetrics.value.isTrayCounterAlert);
  const unscheduledTaskCounterValue = computed(() => `${overviewMetrics.value.unscheduledTaskCount}/${overviewMetrics.value.totalTaskCount}`);

  const taskScheduleCounterLabel = computed(() => {
    if (taskScheduleFilter.value === "scheduled") {
      return "已排程任务";
    }
    if (taskScheduleFilter.value === "unscheduled") {
      return "未排程任务";
    }
    return TASK_COUNTER_LABEL;
  });
  const taskScheduleCounterValue = computed(() => (
    taskScheduleFilter.value === "unscheduled" ? unscheduledTaskCounterValue.value : overviewCounterValue.value
  ));

  const cycleTaskScheduleFilterState = () => {
    taskScheduleFilter.value = cycleTaskScheduleFilter(taskScheduleFilter.value);
    taskPage.value = 1;
  };

  const setTaskPage = (page) => {
    const nextPage = Number.parseInt(String(page ?? ""), 10);
    if (!Number.isFinite(nextPage)) {
      return;
    }
    taskPage.value = Math.min(Math.max(nextPage, 1), taskPageCount.value);
  };

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

  const clearHighlightedCard = () => {
    if (highlightTimer && typeof window !== "undefined") {
      window.clearTimeout(highlightTimer);
    }
    highlightTimer = null;
    if (highlightedCardElement) {
      highlightedCardElement.classList.remove(TASK_HIGHLIGHT_CLASS);
      highlightedCardElement = null;
    }
  };

  const clearHighlightTaskQuery = () => {
    if (!String(route.query?.[TASK_HIGHLIGHT_QUERY_KEY] || "").trim()) {
      return;
    }
    const nextQuery = { ...route.query };
    delete nextQuery[TASK_HIGHLIGHT_QUERY_KEY];
    void router.replace({ query: nextQuery }).catch(() => {});
  };

  const highlightTaskCardFromRoute = async () => {
    const highlightedTaskCode = String(route.query?.[TASK_HIGHLIGHT_QUERY_KEY] || "").trim();
    if (!highlightedTaskCode || viewMode.value !== "task") {
      return;
    }

    await nextTick();
    const targetCard = findTaskCardElement(overviewRoot.value, highlightedTaskCode);
    if (!targetCard) {
      return;
    }

    clearHighlightedCard();
    highlightedCardElement = targetCard;
    targetCard.classList.add(TASK_HIGHLIGHT_CLASS);
    targetCard.scrollIntoView?.({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    clearHighlightTaskQuery();

    if (typeof window !== "undefined") {
      highlightTimer = window.setTimeout(() => {
        if (highlightedCardElement === targetCard) {
          targetCard.classList.remove(TASK_HIGHLIGHT_CLASS);
          highlightedCardElement = null;
        }
        highlightTimer = null;
      }, TASK_HIGHLIGHT_DURATION_MS);
    }
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
      taskScheduleFilter.value = "all";
      taskPage.value = 1;
    }
  });

  watch([keyword, timeFilter, customStartDate, customEndDate, testTypeFilter, taskScheduleFilter], () => {
    taskPage.value = 1;
  });

  watch(
    () => [route.query.testType, route.query.task],
    () => {
      applyRouteFilters();
    }
  );

  watch(
    () => [route.query[TASK_HIGHLIGHT_QUERY_KEY], filteredRows.value.length, viewMode.value],
    () => {
      if (route.query[TASK_HIGHLIGHT_QUERY_KEY]) {
        void highlightTaskCardFromRoute();
      }
    },
    { flush: "post" }
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
    clearHighlightedCard();
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
    experimentCounterLabel,
    experimentCounterValue,
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
    currentTaskPage,
    cycleTaskScheduleFilterState,
    pagedRows,
    requestDeleteTask,
    resetDeleteConfirm,
    saveEdit,
    savingTaskCode,
    selectedTaskCode,
    setTaskPage,
    taskTypeEditOptions,
    taskPageCount,
    taskScheduleCounterLabel,
    taskScheduleCounterValue,
    taskScheduleFilter,
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
  cycleTaskScheduleFilter,
  findTaskCardElement,
  filterTaskOverviewRows,
  getTodayDateValue,
  useTaskOverview,
};
