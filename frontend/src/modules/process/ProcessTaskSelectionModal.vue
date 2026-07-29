<template>
  <div class="modal process-task-selection-modal" :class="{ 'is-open': open }" data-testid="process-task-selection-modal">
    <div class="modal-backdrop" @click="$emit('close')"></div>
    <div class="modal-content process-task-selection-modal-content">
      <div class="modal-header process-task-modal-header">
        <div>
          <div class="muted process-task-modal-eyebrow">任务切换</div>
          <strong>{{ detail?.labName || "试验间" }}</strong>
          <div class="muted process-task-selection-copy">选择任务后，详情内容将同步切换。</div>
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
          :aria-label="taskOptionAriaLabel(taskOption)"
          :aria-current="isSelectedTaskOption(taskOption) ? 'true' : undefined"
          @click="$emit('select', taskOption)"
        >
          <span class="process-task-selection-option__header">
            <strong>{{ taskOption.taskCode }}</strong>
            <span v-if="isSelectedTaskOption(taskOption)" class="process-task-selection-option__badge">当前任务</span>
          </span>
          <span v-if="taskOption.taskName" class="process-task-selection-option__name">{{ taskOption.taskName }}</span>
          <span class="process-task-selection-option__details">
            <span>
              <small>试验</small>
              <strong>{{ taskOption.experimentName || "-" }}</strong>
              <small v-if="taskOption.experimentCode">{{ taskOption.experimentCode }}</small>
            </span>
            <span>
              <small>排程时间</small>
              <strong>{{ taskOption.scheduleTime || "-" }}</strong>
            </span>
            <span v-if="taskOption.status || taskOption.sampleCount !== undefined">
              <small>任务信息</small>
              <strong>{{ taskOption.status || "状态未知" }}</strong>
              <small v-if="taskOption.sampleCount !== undefined">样品 {{ taskOption.sampleCount }} 个</small>
            </span>
          </span>
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

const taskOptionAriaLabel = (taskOption) => [
  isSelectedTaskOption(taskOption) ? "当前任务" : "切换到任务",
  taskOption?.taskCode,
  taskOption?.taskName,
  taskOption?.experimentName,
  taskOption?.scheduleTime,
].filter(Boolean).join("，");
</script>

<style scoped>
.process-task-selection-modal-content {
  width: min(780px, 94vw);
  max-height: min(720px, 86vh);
  overflow: hidden;
  padding: 22px;
}

.process-task-modal-header { margin-bottom: 18px; }
.process-task-modal-eyebrow { margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.12em; }
.process-task-selection-copy { margin-top: 6px; font-size: 13px; }
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
  min-height: 152px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--bg-panel-strong);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
  display: grid;
  gap: 10px;
  transition: background-color 160ms ease, border-color 160ms ease;
}
.process-task-selection-option:hover { border-color: rgba(var(--industrial-accent-rgb), 0.5); background: rgba(var(--industrial-accent-rgb), 0.1); }
.process-task-selection-option:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.process-task-selection-option__header { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.process-task-selection-option__header > strong { color: var(--text); font-family: var(--font-code); font-size: 18px; line-height: 1.35; }
.process-task-selection-option__badge { flex: 0 0 auto; padding: 4px 9px; border: 1px solid rgba(var(--industrial-accent-rgb), 0.48); border-radius: 999px; background: rgba(var(--industrial-accent-rgb), 0.12); color: var(--accent); font-size: 12px; font-weight: 800; }
.process-task-selection-option__name { color: var(--text); font-size: 14px; font-weight: 700; }
.process-task-selection-option__details { display: grid; grid-template-columns: minmax(130px, 0.75fr) minmax(220px, 1.4fr) minmax(120px, 0.7fr); gap: 10px; }
.process-task-selection-option__details > span { display: grid; align-content: start; gap: 4px; min-width: 0; }
.process-task-selection-option__details small { color: var(--muted); font-size: 12px; line-height: 1.4; }
.process-task-selection-option__details strong { color: var(--text); font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.process-task-selection-option.is-active {
  border-color: rgba(var(--industrial-accent-rgb), 0.58);
  background: rgba(var(--industrial-accent-rgb), 0.16);
  color: var(--accent);
}
.process-task-selection-option.is-active .process-task-selection-option__header > strong { color: var(--accent); }
@media (max-width: 640px) {
  .process-task-selection-option__details { grid-template-columns: 1fr; }
}
@media (max-height: 900px) {
  .process-task-modal-header { margin-bottom: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .process-task-selection-option { transition: none; }
}
</style>
