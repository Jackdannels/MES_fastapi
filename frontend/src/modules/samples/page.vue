<template>
  <section class="samples-wide-head section" data-testid="samples-page-tabs">
    <div class="samples-module-cards">
    <button
      class="samples-module-card is-content-centered"
      :class="{ active: activePageTab === 'management' }"
      data-testid="samples-page-tab-management"
      type="button"
      @click="setActivePageTab('management')"
    >
      <span>
        <strong>样品信息</strong>
      </span>
    </button>
    <button
      class="samples-module-card is-content-centered"
      :class="{ active: activePageTab === 'trays' }"
      data-testid="samples-page-tab-trays"
      type="button"
      @click="setActivePageTab('trays')"
    >
      <span>
        <strong>托盘信息</strong>
      </span>
    </button>
    </div>
  </section>

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
