import { computed, ref, watch } from "vue";

import { buildExperimentTypeOptions, matchesExperimentTypeFilter } from "@/lib/experimentTypes";
import {
  buildOverviewSearchText,
  normalizeTaskStatus,
} from "./model";

function useTransferWorkbenchOverview({ pendingStatus, taskOverview }) {
  const searchText = ref("");
  const taskTypeFilter = ref("");
  const taskStatusFilter = ref(pendingStatus);
  const overviewTaskNoSortDirection = ref("");
  const taskPage = ref(1);
  const overviewPageSize = ref(3);
  const pendingTaskCount = ref(0);
  const storedTaskCount = ref(0);

  watch([searchText, taskTypeFilter], () => {
    taskPage.value = 1;
  });

  const taskTypeOptions = computed(() =>
    buildExperimentTypeOptions(taskOverview.value.map((task) => task.experimentTypeText || task.taskType)),
  );
  const filteredTaskOverview = computed(() => {
    const query = searchText.value.trim().toLowerCase();
    return taskOverview.value.filter((task) => {
      const typeMatch = matchesExperimentTypeFilter(taskTypeFilter.value, task.experimentTypeText, task.taskType);
      const statusMatch = !taskStatusFilter.value || normalizeTaskStatus(task.taskStatus) === taskStatusFilter.value;
      const searchTextPool = task.overviewSearchText || buildOverviewSearchText(task);
      return typeMatch && statusMatch && (!query || searchTextPool.includes(query));
    });
  });
  const sortedTaskOverview = computed(() => {
    const rows = filteredTaskOverview.value.slice();
    if (!overviewTaskNoSortDirection.value) {
      return rows;
    }
    const directionFactor = overviewTaskNoSortDirection.value === "desc" ? -1 : 1;
    return rows.sort((left, right) => {
      const taskNoCompare = String(left?.taskNo || "").localeCompare(String(right?.taskNo || ""), "zh-Hans-CN", {
        numeric: true,
        sensitivity: "base",
      });
      if (taskNoCompare !== 0) {
        return taskNoCompare * directionFactor;
      }
      const leftSeq = Number.parseInt(left?.seq, 10);
      const rightSeq = Number.parseInt(right?.seq, 10);
      return ((Number.isFinite(leftSeq) ? leftSeq : 0) - (Number.isFinite(rightSeq) ? rightSeq : 0)) * directionFactor;
    });
  });
  const taskPageCount = computed(() => Math.max(1, Math.ceil(sortedTaskOverview.value.length / overviewPageSize.value)));
  const currentTaskPage = computed(() => Math.min(taskPage.value, taskPageCount.value));
  const pagedTaskOverview = computed(() => sortedTaskOverview.value.slice(
    (currentTaskPage.value - 1) * overviewPageSize.value,
    currentTaskPage.value * overviewPageSize.value,
  ));
  const pagedTaskOverviewRows = computed(() => {
    const rows = pagedTaskOverview.value.map((task) => ({ ...task, rowKey: `task-${task.taskId}` }));
    if (!rows.length) {
      return rows;
    }
    const placeholderCount = Math.max(0, overviewPageSize.value - rows.length);
    return [
      ...rows,
      ...Array.from({ length: placeholderCount }, (_, index) => ({
        isPlaceholder: true,
        placeholderIndex: index + 1,
        rowKey: `placeholder-${currentTaskPage.value}-${index}`,
      })),
    ];
  });

  const clearFilters = () => {
    searchText.value = "";
    taskTypeFilter.value = "";
    taskStatusFilter.value = "";
    taskPage.value = 1;
  };

  const setTaskStatusFilter = (status) => {
    taskStatusFilter.value = status;
    taskPage.value = 1;
  };

  const setTaskPage = (page) => {
    const nextPage = Number.parseInt(page, 10);
    taskPage.value = Math.min(taskPageCount.value, Math.max(1, Number.isFinite(nextPage) ? nextPage : 1));
  };

  const toggleOverviewTaskNoSort = () => {
    overviewTaskNoSortDirection.value = overviewTaskNoSortDirection.value === "asc" ? "desc" : "asc";
    taskPage.value = 1;
  };

  return {
    clearFilters,
    currentTaskPage,
    filteredTaskOverview,
    overviewPageSize,
    overviewTaskNoSortDirection,
    pagedTaskOverview,
    pagedTaskOverviewRows,
    pendingTaskCount,
    searchText,
    setTaskPage,
    setTaskStatusFilter,
    sortedTaskOverview,
    storedTaskCount,
    taskPage,
    taskPageCount,
    taskStatusFilter,
    taskTypeFilter,
    taskTypeOptions,
    toggleOverviewTaskNoSort,
  };
}

export { useTransferWorkbenchOverview };
