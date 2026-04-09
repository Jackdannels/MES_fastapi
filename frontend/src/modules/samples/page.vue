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
    :samples-flow="samplesFlow"
  />

  <TrayManagementPanel :hidden="activePageTab !== 'trays'" :samples-flow="samplesFlow" />
</template>

<script setup>
import { reactive } from "vue";

import { useTabState } from "@/composables/useTabState";
import SamplesManagementPanel from "./SamplesManagementPanel.vue";
import TrayManagementPanel from "./TrayManagementPanel.vue";
import { useSamplesFlow } from "./useSamplesFlow";

const { activeTab: activePageTab, setActiveTab: setActivePageTab } = useTabState("management");

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
  rawExperiments: samplesFlowRawExperiments,
  rawExperimentTrays: samplesFlowRawExperimentTrays,
  rawSchedules: samplesFlowRawSchedules,
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
  rawExperiments: samplesFlowRawExperiments,
  rawExperimentTrays: samplesFlowRawExperimentTrays,
  rawSchedules: samplesFlowRawSchedules,
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
