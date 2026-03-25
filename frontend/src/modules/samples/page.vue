<template>
  <div class="tabs section" data-testid="samples-page-tabs">
    <button
      class="tab-btn"
      :class="{ active: activePageTab === 'management' }"
      data-testid="samples-page-tab-management"
      type="button"
      @click="setActivePageTab('management')"
    >
      样品管理
    </button>
    <button
      class="tab-btn"
      :class="{ active: activePageTab === 'trays' }"
      data-testid="samples-page-tab-trays"
      type="button"
      @click="setActivePageTab('trays')"
    >
      托盘管理
    </button>
  </div>

  <SamplesManagementPanel
    :hidden="activePageTab !== 'management'"
    :sample-trace="sampleTrace"
    :samples-flow="samplesFlow"
    :samples-process="samplesProcess"
  />

  <TrayManagementPanel :hidden="activePageTab !== 'trays'" :samples-flow="samplesFlow" />
</template>

<script setup>
import { reactive } from "vue";

import { useTabState } from "@/composables/useTabState";
import SamplesManagementPanel from "./SamplesManagementPanel.vue";
import TrayManagementPanel from "./TrayManagementPanel.vue";
import { useSampleTrace } from "./useSampleTrace";
import { useSamplesFlow } from "./useSamplesFlow";
import { useSamplesProcess } from "./useSamplesProcess";

const { activeTab: activePageTab, setActiveTab: setActivePageTab } = useTabState("management");

const {
  form: sampleTraceForm,
  resetTrace,
  runTrace,
  summaryText: sampleTraceSummaryText,
  timelineItems: sampleTraceTimelineItems,
} = useSampleTrace();

const {
  activeTrayIndex,
  addTray,
  canPrint,
  confirmStore,
  currentFlowStatus,
  flowSteps,
  handleTrayDrop,
  moveToActiveTray,
  printTrays,
  restoreStore,
  sampleCodesText,
  selectTask,
  selectProcessTray,
  selectedTaskCode,
  setActiveTray,
  setTrayLimit,
  storeLocked,
  startDragging,
  taskOptions,
  trayDraft,
  trayPreviewText,
  warning,
  removeTray,
} = useSamplesProcess();

const {
  batchForm: samplesFlowBatchForm,
  batchModalOpen: samplesFlowBatchOpen,
  closeBatchModal,
  closeDetailDrawer: closeSampleDetail,
  currentPage: samplesFlowCurrentPage,
  detailDrawerOpen: samplesFlowDetailOpen,
  detailForm: samplesFlowDetailForm,
  detailStatusOptions: samplesFlowDetailStatusOptions,
  locationOptions: samplesFlowLocationOptions,
  openBatchModal,
  openDetailDrawer: openSampleDetail,
  pageCount: samplesFlowPageCount,
  query,
  rawSamples: samplesFlowRawSamples,
  rawTasks: samplesFlowRawTasks,
  sampleRows: samplesFlowRows,
  saveDetail: saveSampleDetail,
  selectedStatus: selectedFlowStatus,
  selectedTaskCode: selectedFlowTaskCode,
  setPage: setSamplesFlowPage,
  setQuery,
  setStagingQuery,
  setStatusFilter,
  setTaskFilter,
  sortDirection: samplesFlowSortDirection,
  sortKey: samplesFlowSortKey,
  stagingAllSelected,
  stagingCount,
  stagingForm,
  stagingLabOptions,
  stagingQuery,
  stagingRows,
  statusOptions: samplesFlowStatusOptions,
  submitStagingDispatch,
  submitBatch: submitSamplesFlowBatch,
  taskOptions: samplesFlowTaskOptions,
  trayRows,
  trayStatusOptions,
  toggleAllStagingSelection,
  toggleStagingSelection,
  toggleSort: toggleSamplesFlowSort,
  updateTrayStatusInline,
  warning: samplesFlowWarning,
  resetStaging,
} = useSamplesFlow();

const sampleTrace = reactive({
  form: sampleTraceForm,
  resetTrace,
  runTrace,
  summaryText: sampleTraceSummaryText,
  timelineItems: sampleTraceTimelineItems,
});

const samplesProcess = reactive({
  activeTrayIndex,
  addTray,
  canPrint,
  confirmStore,
  currentFlowStatus,
  flowSteps,
  handleTrayDrop,
  moveToActiveTray,
  printTrays,
  removeTray,
  restoreStore,
  sampleCodesText,
  selectTask,
  selectProcessTray,
  selectedTaskCode,
  setActiveTray,
  setTrayLimit,
  startDragging,
  storeLocked,
  taskOptions,
  trayDraft,
  trayPreviewText,
  warning,
});

const samplesFlow = reactive({
  batchForm: samplesFlowBatchForm,
  batchModalOpen: samplesFlowBatchOpen,
  closeBatchModal,
  closeSampleDetail,
  currentPage: samplesFlowCurrentPage,
  detailDrawerOpen: samplesFlowDetailOpen,
  detailForm: samplesFlowDetailForm,
  detailStatusOptions: samplesFlowDetailStatusOptions,
  locationOptions: samplesFlowLocationOptions,
  openBatchModal,
  openSampleDetail,
  pageCount: samplesFlowPageCount,
  query,
  rawSamples: samplesFlowRawSamples,
  rawTasks: samplesFlowRawTasks,
  rows: samplesFlowRows,
  saveSampleDetail,
  selectedStatus: selectedFlowStatus,
  selectedTaskCode: selectedFlowTaskCode,
  setPage: setSamplesFlowPage,
  setQuery,
  setStagingQuery,
  setStatusFilter,
  setTaskFilter,
  sortDirection: samplesFlowSortDirection,
  sortKey: samplesFlowSortKey,
  stagingAllSelected,
  stagingCount,
  stagingForm,
  stagingLabOptions,
  stagingQuery,
  stagingRows,
  statusOptions: samplesFlowStatusOptions,
  submitSamplesFlowBatch,
  submitStagingDispatch,
  taskOptions: samplesFlowTaskOptions,
  trayRows,
  trayStatusOptions,
  toggleAllStagingSelection,
  toggleSamplesFlowSort,
  toggleStagingSelection,
  updateTrayStatusInline,
  warning: samplesFlowWarning,
  resetStaging,
});
</script>
