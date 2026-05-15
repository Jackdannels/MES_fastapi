<template>
  <article
    class="task-overview-card"
    :data-task-code="row.taskCode"
    :class="{ 'is-selected': selected }"
    @click="emit('select', row)"
    @dblclick="emit('dblclick-card', row)"
  >
    <div class="task-overview-index-col">
      <div class="task-overview-index-label">序号</div>
      <div class="task-overview-index-value">{{ index + 1 }}</div>
    </div>

    <div class="task-overview-content">
      <div class="task-overview-main">
        <div class="task-overview-headline">
          <div class="task-overview-title">{{ row.taskCode }}</div>
          <button
            class="action-btn secondary task-overview-edit-btn"
            type="button"
            @click.stop="emit('open-edit', row)"
            @dblclick.stop
          >
            {{ editing ? "收起编辑" : "编辑任务" }}
          </button>
        </div>
        <div v-if="selected" class="task-overview-card-hint">
          {{ editing ? "当前正处于编辑模式，请正确修改填写信息" : "已选中任务，双击可进入编辑" }}
        </div>
        <TaskOverviewSummaryTable :format-tray-count="formatTrayCount" :format-tray-summary="formatTraySummary" :row="row" />
      </div>

      <TaskOverviewEditorPanel
        v-if="editing"
        :delete-confirm="deleteConfirm"
        :deleting="deleting"
        :edit-error="editError"
        :edit-form="editForm"
        :edit-message="editMessage"
        :row="row"
        :saving="saving"
        :task-type-edit-options="taskTypeEditOptions"
        @cancel-edit="emit('cancel-edit')"
        @clear-edit-feedback="emit('clear-edit-feedback')"
        @confirm-delete="emit('confirm-delete', $event)"
        @generate-codes="emit('generate-codes')"
        @request-delete="emit('request-delete', $event)"
        @reset-delete-confirm="emit('reset-delete-confirm')"
        @save-edit="emit('save-edit', $event)"
        @update-edit-form="emit('update-edit-form', $event)"
      />

      <TaskOverviewSampleCodes :sample-codes="row.sampleCodes" />
    </div>
  </article>
</template>

<script setup>
import TaskOverviewEditorPanel from "./TaskOverviewEditorPanel.vue";
import TaskOverviewSampleCodes from "./TaskOverviewSampleCodes.vue";
import TaskOverviewSummaryTable from "./TaskOverviewSummaryTable.vue";

defineProps({
  deleteConfirm: {
    type: Object,
    default: () => ({}),
  },
  deleting: {
    type: Boolean,
    default: false,
  },
  editError: {
    type: String,
    default: "",
  },
  editForm: {
    type: Object,
    default: () => ({
      sampleCodesText: "",
      sampleCount: 0,
      taskType: "",
    }),
  },
  editMessage: {
    type: String,
    default: "",
  },
  editing: {
    type: Boolean,
    default: false,
  },
  formatTrayCount: {
    type: Function,
    required: true,
  },
  formatTraySummary: {
    type: Function,
    required: true,
  },
  index: {
    type: Number,
    default: 0,
  },
  row: {
    type: Object,
    required: true,
  },
  saving: {
    type: Boolean,
    default: false,
  },
  selected: {
    type: Boolean,
    default: false,
  },
  taskTypeEditOptions: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  "cancel-edit",
  "clear-edit-feedback",
  "confirm-delete",
  "dblclick-card",
  "generate-codes",
  "open-edit",
  "request-delete",
  "reset-delete-confirm",
  "save-edit",
  "select",
  "update-edit-form",
]);
</script>
