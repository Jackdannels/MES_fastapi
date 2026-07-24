<template>
  <div class="modal process-task-full-modal" :class="{ 'is-open': open }" data-testid="process-task-full-list-modal">
    <div class="modal-backdrop" @click="$emit('close')"></div>
    <div class="modal-content process-task-full-modal-content">
      <div class="modal-header process-task-modal-header">
        <div>
          <div class="muted process-task-modal-eyebrow">完整清单</div>
          <strong>全部托盘与样品</strong>
        </div>
        <button class="modal-close" type="button" @click="$emit('close')">关闭</button>
      </div>
      <div class="process-task-full-summary">
        <span>任务编号：{{ detail?.code || "-" }}</span>
        <span>托盘：{{ allTaskTrayRows.length }}</span>
        <span>样品：{{ allTaskSampleCount }}</span>
      </div>
      <div class="process-task-full-list">
        <button
          v-for="tray in allTaskTrayRows"
          :key="tray.trayCode"
          class="process-task-full-row"
          :class="{ 'is-selected': detail?.selectedTrayCode === tray.trayCode }"
          type="button"
          :data-testid="`process-full-tray-row-${tray.trayCode}`"
          @click="$emit('select-tray', tray.trayCode)"
        >
          <div>
            <strong>{{ tray.trayCode }}</strong>
            <span>{{ tray.status || tray.flowStatus || "-" }}</span>
          </div>
          <div class="process-task-full-samples">
            <span v-for="sampleCode in tray.sampleCodes || []" :key="`${tray.trayCode}-${sampleCode}`">{{ sampleCode }}</span>
            <span v-if="!(tray.sampleCodes || []).length" class="muted">暂无样品编号</span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

defineOptions({ name: "ProcessTaskFullListModal" });

const props = defineProps({
  detail: { type: Object, default: null },
  open: { type: Boolean, default: false },
});

defineEmits(["close", "select-tray"]);

const allTaskTrayRows = computed(() => {
  const detail = props.detail || {};
  const rows = Array.isArray(detail.trayRows) && detail.trayRows.length
    ? detail.trayRows
    : [
        ...(Array.isArray(detail.runningTrayRows) ? detail.runningTrayRows : []),
        ...(Array.isArray(detail.remainingTrayRows) ? detail.remainingTrayRows : []),
        ...(Array.isArray(detail.completedTrayRows) ? detail.completedTrayRows : []),
      ];
  const seen = new Set();
  return rows.filter((row) => {
    const trayCode = String(row?.trayCode || "").trim();
    if (!trayCode || seen.has(trayCode)) {
      return false;
    }
    seen.add(trayCode);
    return true;
  });
});

const allTaskSampleCount = computed(() => {
  const samples = new Set();
  allTaskTrayRows.value.forEach((row) => {
    (Array.isArray(row.sampleCodes) ? row.sampleCodes : []).forEach((sampleCode) => {
      const normalized = String(sampleCode || "").trim();
      if (normalized) {
        samples.add(normalized);
      }
    });
  });
  return samples.size;
});
</script>

<style scoped>
.process-task-full-modal-content {
  width: min(980px, 94vw);
  max-height: min(760px, 86vh);
  overflow: auto;
  padding: 22px;
}
.process-task-modal-header { margin-bottom: 18px; }
.process-task-modal-eyebrow { margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.12em; }
.process-task-full-summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.process-task-full-summary span {
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-panel-strong);
  padding: 6px 12px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}
.process-task-full-list { display: grid; gap: 10px; }
.process-task-full-row {
  appearance: none;
  cursor: pointer;
  display: grid;
  grid-template-columns: minmax(180px, 0.42fr) minmax(0, 1fr);
  gap: 14px;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel-strong);
  color: var(--text);
  text-align: left;
}
.process-task-full-row.is-selected {
  border-color: rgba(var(--industrial-accent-rgb), 0.55);
  background: rgba(var(--industrial-accent-rgb), 0.16);
  box-shadow: inset 0 0 0 1px rgba(var(--industrial-accent-rgb), 0.16);
}
.process-task-full-row strong,
.process-task-full-row span { display: block; }
.process-task-full-row strong { margin-bottom: 6px; color: var(--text); font-size: 14px; }
.process-task-full-row span { color: var(--muted); font-size: 12px; }
.process-task-full-samples { display: flex; flex-wrap: wrap; gap: 6px; }
.process-task-full-samples span {
  border-radius: 999px;
  border: 1px solid rgba(var(--industrial-accent-rgb), 0.38);
  background: rgba(var(--industrial-accent-rgb), 0.12);
  padding: 5px 9px;
  color: var(--text);
  font-weight: 600;
  word-break: break-all;
}
@media (max-height: 900px) {
  .process-task-modal-header { margin-bottom: 12px; }
}
</style>
