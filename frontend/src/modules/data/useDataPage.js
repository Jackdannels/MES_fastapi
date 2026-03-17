// 负责试验数据页的数据流加载、报告动作和详情展示。
import { computed, onMounted, ref } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useTableControls } from "@/composables/useTableControls";
import {
  buildDataMetrics,
  buildDataRows,
  buildSelectedDataRow,
  calculateAverageQuality,
  createReportForm,
} from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";

// 输出用于筛选数据表格和预览报告的响应式状态。
function useDataPage() {
  const { loadSnapshot } = useStorageSnapshot([STORAGE_KEYS.streams]);
  const rawStreams = ref([]);
  const reportForm = ref(createReportForm());
  const selectedRow = ref(buildSelectedDataRow());
  const reportModal = useDialogState();
  const dataDrawer = useDialogState();

  const baseRows = computed(() => buildDataRows(rawStreams.value));
  const metrics = computed(() => buildDataMetrics(rawStreams.value));

  const { query, sortDirection, sortKey, visibleRows } = useTableControls({
    rows: baseRows,
    searchFields: ["taskCode", "device", "status"],
    pageSize: 100,
  });

  const toggleSort = (nextKey) => {
    if (sortKey.value === nextKey) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
      return;
    }
    sortKey.value = nextKey;
    sortDirection.value = "asc";
  };

  const validateReport = () => {
    return {
      averageQuality: calculateAverageQuality(rawStreams.value),
      validationCount: metrics.value.validationCount,
    };
  };

  const openReportModal = () => {
    reportModal.openWith({ id: "report-preview" });
  };

  const closeReportModal = () => {
    reportModal.close();
  };

  const generateReport = () => {
    closeReportModal();
  };

  const openDataDrawer = (row) => {
    selectedRow.value = buildSelectedDataRow(row);
    dataDrawer.openWith(row);
  };

  const closeDataDrawer = () => {
    dataDrawer.close();
  };

  const loadDataPage = async () => {
    const snapshot = await loadSnapshot();
    rawStreams.value = Array.isArray(snapshot[STORAGE_KEYS.streams]) ? snapshot[STORAGE_KEYS.streams] : [];
  };

  onMounted(loadDataPage);

  return {
    closeDataDrawer,
    closeReportModal,
    dataDrawerOpen: dataDrawer.open,
    dataRows: visibleRows,
    generateReport,
    metrics,
    openDataDrawer,
    openReportModal,
    query,
    reportForm,
    reportModalOpen: reportModal.open,
    selectedRow,
    toggleSort,
    validateReport,
  };
}

export { useDataPage };
