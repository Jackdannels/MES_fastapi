import { computed } from "vue";

import { useTableControls } from "@/composables/useTableControls";
import { matchesExperimentTypeFilter } from "@/lib/experimentTypes";
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
  selectedStatus,
  selectedTestType,
}) {
  const allRows = computed(() => buildTaskRows(
    rawTasks.value,
    rawSchedules.value,
    rawSamples.value,
    rawExperiments.value,
  ));
  const externalTaskIntakeRows = computed(() => buildExternalIntakeRows(rawExternalTaskIntakes.value));
  const metrics = computed(() => buildTaskMetrics(allRows.value, externalTaskIntakeRows.value.length));
  const filterOptions = computed(() => buildFilterOptions(allRows.value));
  const testTypeOptions = computed(() => filterOptions.value.testTypeOptions);

  const typeFilteredRows = computed(() =>
    allRows.value.filter((row) => {
      // 实验类型先限定任务范围，状态选项和后续搜索都基于这个范围。
      return matchesExperimentTypeFilter(selectedTestType.value, row.testType, row.experimentSummary);
    }),
  );
  const scopedStatusOptions = computed(() => buildFilterOptions(typeFilteredRows.value).statusOptions);
  const filteredRows = computed(() =>
    typeFilteredRows.value.filter((row) => {
      if (selectedStatus.value && row.displayStatus !== selectedStatus.value) {
        return false;
      }
      return true;
    }),
  );

  const { currentPage, pageCount, query, sortDirection, sortKey, visibleRows } = useTableControls({
    rows: filteredRows,
    searchFields: ["code", "name", "source", "experimentSummary", "testType", "displayStatus", "displayStatusLabel"],
    pageSize: 8,
  });

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
