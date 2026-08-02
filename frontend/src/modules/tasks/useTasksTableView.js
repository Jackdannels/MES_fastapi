import { computed, ref } from "vue";

import { useTableControls } from "@/composables/useTableControls";
import { buildExperimentTypeOptions, matchesExperimentTypeFilter } from "@/lib/experimentTypes";
import {
  buildExternalIntakeRows,
  buildFilterOptions,
  buildTaskMetrics,
  buildTaskRows,
} from "./model";

function useTasksTableView({
  rawExperiments,
  rawExternalTaskIntakes,
  rawSamples,
  rawSchedules,
  rawTasks,
  serverMetrics,
  serverPageCount,
  serverPagination = false,
  serverStatusOptions,
  serverTestTypeOptions,
  selectedStatus,
  selectedTestType,
}) {
  const allRows = computed(() => {
    const rows = buildTaskRows(
      rawTasks.value,
      rawSchedules.value,
      rawSamples.value,
      rawExperiments.value,
    );
    if (!serverPagination) {
      return rows;
    }
    const orderByCode = new Map(
      rawTasks.value.map((task, index) => [String(task?.code || task?.task_code || task?.id || ""), index]),
    );
    return [...rows].sort((left, right) => (
      (orderByCode.get(left.code) ?? Number.MAX_SAFE_INTEGER)
      - (orderByCode.get(right.code) ?? Number.MAX_SAFE_INTEGER)
    ));
  });
  const externalTaskIntakeRows = computed(() => buildExternalIntakeRows(rawExternalTaskIntakes.value));
  const localMetrics = computed(() => buildTaskMetrics(allRows.value, externalTaskIntakeRows.value.length));
  const metrics = computed(() => {
    if (!serverPagination || !serverMetrics?.value) {
      return localMetrics.value;
    }
    const source = serverMetrics.value;
    const unscheduledCount = Number(source.unscheduledCount || 0);
    return {
      externalCount: Number(source.externalCount || 0),
      internalCount: Number(source.internalCount || 0),
      pendingExternalCount: externalTaskIntakeRows.value.length,
      retentionCount: Number(source.retentionCount || 0),
      unscheduledCount,
      unscheduledLabel: unscheduledCount,
    };
  });
  const filterOptions = computed(() => buildFilterOptions(allRows.value));
  const testTypeOptions = computed(() => (
    serverPagination && Array.isArray(serverTestTypeOptions?.value)
      ? buildExperimentTypeOptions(serverTestTypeOptions.value)
      : filterOptions.value.testTypeOptions
  ));

  const typeFilteredRows = computed(() =>
    allRows.value.filter((row) => {
      // 实验类型先限定任务范围，状态选项和后续搜索都基于这个范围。
      return matchesExperimentTypeFilter(selectedTestType.value, row.testType, row.experimentSummary);
    }),
  );
  const scopedStatusOptions = computed(() => (
    serverPagination && Array.isArray(serverStatusOptions?.value)
      ? serverStatusOptions.value
      : buildFilterOptions(typeFilteredRows.value).statusOptions
  ));
  const filteredRows = computed(() =>
    typeFilteredRows.value.filter((row) => {
      if (selectedStatus.value && row.displayStatus !== selectedStatus.value) {
        return false;
      }
      return true;
    }),
  );

  const localControls = useTableControls({
    rows: filteredRows,
    searchFields: ["code", "name", "source", "experimentSummary", "testType", "displayStatus", "displayStatusLabel"],
    pageSize: 8,
  });
  const serverCurrentPage = ref(1);
  const serverQuery = ref("");
  const serverSortDirection = ref("asc");
  const serverSortKey = ref("");
  const currentPage = serverPagination ? serverCurrentPage : localControls.currentPage;
  const pageCount = serverPagination
    ? computed(() => Math.max(1, Number(serverPageCount?.value || 1)))
    : localControls.pageCount;
  const query = serverPagination ? serverQuery : localControls.query;
  const sortDirection = serverPagination ? serverSortDirection : localControls.sortDirection;
  const sortKey = serverPagination ? serverSortKey : localControls.sortKey;
  // The server search also matches related sample/tray identifiers that are not
  // part of the task row. Re-filtering the returned page here could hide a
  // valid server match, so server mode renders the authoritative page as-is.
  const visibleRows = serverPagination ? filteredRows : localControls.visibleRows;

  const toggleSort = (nextKey) => {
    // 排序行为与其他页面保持一致：同列切换方向，换列恢复升序。
    if (sortKey.value === nextKey) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
      return;
    }
    sortKey.value = nextKey;
    sortDirection.value = "asc";
  };

  const setCurrentPage = (page) => {
    currentPage.value = page;
  };

  return {
    allRows,
    currentPage,
    externalTaskIntakeRows,
    metrics,
    pageCount,
    query,
    scopedStatusOptions,
    setCurrentPage,
    sortDirection,
    sortKey,
    testTypeOptions,
    toggleSort,
    visibleRows,
  };
}

export { useTasksTableView };
