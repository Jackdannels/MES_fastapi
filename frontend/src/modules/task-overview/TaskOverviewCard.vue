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
            {{ editing ? "收起详情" : "查看详情" }}
          </button>
        </div>
        <div v-if="selected" class="task-overview-card-hint">
          已进入详情模式，所有信息只读
        </div>
        <div class="task-overview-readonly-meta">
          <span>任务编号</span>
          <strong>{{ row.taskCode || "-" }}</strong>
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
        readonly
        :row="row"
        :saving="saving"
        :task-type-edit-options="taskTypeEditOptions"
        @cancel-edit="emit('cancel-edit')"
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
      experiments: [],
      sampleCodesText: "",
      sampleCount: 0,
      taskCode: "",
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
  "dblclick-card",
  "open-edit",
  "select",
]);
</script>
