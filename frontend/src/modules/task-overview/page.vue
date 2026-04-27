<template>
  <section ref="overviewRoot" class="card section">
    <TaskOverviewToolbar
      v-model:view-mode="viewMode"
      v-model:keyword="keyword"
      v-model:time-filter="timeFilter"
      v-model:custom-start-date="customStartDate"
      v-model:custom-end-date="customEndDate"
      v-model:test-type-filter="testTypeFilter"
      :experiment-counter-label="experimentCounterLabel"
      :experiment-counter-value="experimentCounterValue"
      :test-type-options="testTypeOptions"
      :overview-counter-label="overviewCounterLabel"
      :overview-counter-value="overviewCounterValue"
      :is-tray-counter-alert="isTrayCounterAlert"
      :task-schedule-counter-label="taskScheduleCounterLabel"
      :task-schedule-counter-value="taskScheduleCounterValue"
      :task-schedule-filter="taskScheduleFilter"
      :current-task-page="currentTaskPage"
      :task-page-count="taskPageCount"
      @change-task-page="setTaskPage"
      @cycle-task-schedule-filter="cycleTaskScheduleFilterState"
      @refresh="loadOverview"
    />

    <div v-if="loading" class="muted">正在加载任务明细...</div>
    <div v-else-if="viewMode === 'task' && filteredRows.length === 0" class="muted">暂无可展示的任务信息。</div>

    <div v-else-if="viewMode === 'task'" class="task-overview-list">
      <TaskOverviewCard
        v-for="(row, index) in pagedRows"
        :key="row.taskCode"
        :delete-confirm="deleteConfirm"
        :deleting="deletingTaskCode === row.taskCode"
        :edit-error="editError"
        :edit-form="editForm"
        :edit-message="editMessage"
        :editing="isEditing(row.taskCode)"
        :format-tray-count="formatTrayCount"
        :format-tray-summary="formatTraySummary"
        :index="(currentTaskPage - 1) * 5 + index"
        :row="row"
        :saving="savingTaskCode === row.taskCode"
        :selected="selectedTaskCode === row.taskCode"
        :task-type-edit-options="taskTypeEditOptions"
        @cancel-edit="cancelEdit"
        @confirm-delete="confirmDeleteTask"
        @dblclick-card="handleCardDblClick"
        @generate-codes="generateCodesByCount"
        @open-edit="openEdit"
        @request-delete="requestDeleteTask"
        @reset-delete-confirm="resetDeleteConfirm"
        @save-edit="saveEdit"
        @select="handleCardClick"
        @update-edit-form="updateEditForm"
      />
    </div>

    <TaskOverviewTrayTable v-else :tray-overview-rows="trayOverviewRows" :tray-overview-total="trayOverviewTotal" />
  </section>
</template>

<script setup>
import TaskOverviewCard from "./TaskOverviewCard.vue";
import TaskOverviewToolbar from "./TaskOverviewToolbar.vue";
import TaskOverviewTrayTable from "./TaskOverviewTrayTable.vue";
import { useTaskOverview } from "./useTaskOverview";

const {
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
} = useTaskOverview();
</script>
