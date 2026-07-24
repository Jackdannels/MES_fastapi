<template>
  <div class="modal process-task-selection-modal" :class="{ 'is-open': open }" data-testid="process-task-selection-modal">
    <div class="modal-backdrop" @click="$emit('close')"></div>
    <div class="modal-content process-task-selection-modal-content">
      <div class="modal-header process-task-modal-header">
        <div>
          <div class="muted process-task-modal-eyebrow">任务选择</div>
          <strong>{{ detail?.labName || "试验间" }}</strong>
        </div>
        <button class="modal-close" type="button" @click="$emit('close')">关闭</button>
      </div>
      <div class="process-task-selection-list">
        <button
          v-for="taskOption in detail?.availableTasks || []"
          :key="taskOption.selectionKey || taskOption.taskCode"
          class="process-task-selection-option"
          :class="{ 'is-active': isSelectedTaskOption(taskOption) }"
          type="button"
          :data-testid="`process-select-task-${taskOption.taskCode}`"
          @click="$emit('select', taskOption)"
        >
          <strong>{{ taskOption.taskCode }}</strong>
          <span>{{ taskOption.experimentName || "-" }}</span>
          <span>{{ taskOption.scheduleTime || "-" }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: "ProcessTaskSelectionModal" });

const props = defineProps({
  detail: { type: Object, default: null },
  open: { type: Boolean, default: false },
});

defineEmits(["close", "select"]);

const isSelectedTaskOption = (taskOption) => (
  props.detail?.code === taskOption?.taskCode
  && (!taskOption?.experimentCode || props.detail?.activeExperimentCode === taskOption.experimentCode)
);
</script>

<style scoped>
.process-task-selection-modal-content {
  width: min(640px, 94vw);
  max-height: min(720px, 86vh);
  overflow: hidden;
  padding: 22px;
}

.process-task-modal-header { margin-bottom: 18px; }
.process-task-modal-eyebrow { margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.12em; }
.process-task-selection-list {
  display: grid;
  gap: 10px;
  max-height: calc(86vh - 110px);
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
}
.process-task-selection-option {
  appearance: none;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--bg-panel-strong);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
  display: grid;
  gap: 5px;
}
.process-task-selection-option span { color: var(--muted); font-size: 12px; }
.process-task-selection-option.is-active {
  border-color: rgba(var(--industrial-accent-rgb), 0.58);
  background: rgba(var(--industrial-accent-rgb), 0.16);
  color: var(--accent);
}
@media (max-height: 900px) {
  .process-task-modal-header { margin-bottom: 12px; }
}
</style>
