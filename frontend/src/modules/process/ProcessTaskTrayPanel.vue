<template>
  <section class="process-task-tray-panel">
    <section class="process-task-summary-card process-task-selected-tray-card">
      <div class="process-task-summary-title">托盘总览</div>
      <div
        v-if="detail?.trayCodes?.length"
        class="process-task-tray-chip-list"
        :class="{ 'is-dense': detail.trayCodes.length >= 3, 'is-single-column': true }"
      >
        <button
          v-for="trayCode in previewTrayCodes"
          :key="trayCode"
          class="process-task-tray-chip process-task-tray-chip-emphasis"
          :class="{ 'is-selected': detail?.selectedTrayCode === trayCode }"
          type="button"
          :data-testid="`process-tray-chip-${trayCode}`"
          @click="$emit('select-tray', trayCode)"
        >
          {{ trayCode }}
        </button>
        <button
          v-if="hiddenTrayCodeCount > 0"
          class="process-task-more-count process-task-more-button"
          :aria-label="`查看全部 ${hiddenTrayCodeCount} 个隐藏托盘`"
          data-testid="process-show-all-trays-count"
          type="button"
          @click="$emit('open-full-list')"
        >
          +{{ hiddenTrayCodeCount }}
        </button>
        <button
          v-if="hiddenTrayCodeCount > 0"
          class="process-task-more-button"
          data-testid="process-show-all-trays"
          type="button"
          @click="$emit('open-full-list')"
        >
          查看全部
        </button>
      </div>
    </section>

    <section class="process-task-summary-card">
      <div class="process-task-summary-title">当前实验托盘</div>
      <div v-if="detail?.runningTrayRows?.length" class="process-task-tray-list process-task-tray-list--scrollable">
        <div
          v-for="tray in previewRunningTrayRows"
          :key="tray.trayCode"
          class="process-task-tray-row"
          :class="{ 'is-selected': detail?.selectedTrayCode === tray.trayCode }"
        >
          <button class="process-task-tray-row__select" type="button" :data-testid="`process-tray-button-${tray.trayCode}`" @click="$emit('select-tray', tray.trayCode)">
            <strong>{{ tray.trayCode }}</strong>
            <span>{{ tray.status }}</span>
            <span>{{ traySamplePreviewText(tray) }}</span>
          </button>
          <span v-if="hiddenTraySampleCount(tray) > 0" class="process-task-more-inline">
            +{{ hiddenTraySampleCount(tray) }}
            <button class="process-task-more-button" type="button" @click="$emit('open-full-list')">查看全部</button>
          </span>
        </div>
        <div v-if="hiddenRunningTrayCount > 0" class="process-task-more-line">
          <span class="process-task-more-count">+{{ hiddenRunningTrayCount }}</span>
          <button class="process-task-more-button" type="button" @click="$emit('open-full-list')">查看全部</button>
        </div>
      </div>
      <div v-else class="muted">当前无实验进行中托盘。</div>
    </section>

  </section>
</template>

<script setup>
import { computed } from "vue";

defineOptions({ name: "ProcessTaskTrayPanel" });

const props = defineProps({ detail: { type: Object, default: null } });
defineEmits(["open-full-list", "select-tray"]);

const TASK_TRAY_PREVIEW_LIMIT = 5;
const TASK_ROW_PREVIEW_LIMIT = Number.POSITIVE_INFINITY;
const TASK_ROW_SAMPLE_PREVIEW_LIMIT = 1;
const takePreview = (items, limit) => (Array.isArray(items) ? items.slice(0, limit) : []);
const hiddenCount = (items, limit) => Math.max(0, (Array.isArray(items) ? items.length : 0) - limit);
const normalizeSampleCodes = (tray) => (Array.isArray(tray?.sampleCodes) ? tray.sampleCodes : [])
  .map((sampleCode) => String(sampleCode || "").trim())
  .filter(Boolean);
const traySamplePreviewText = (tray) => {
  const sampleCodes = normalizeSampleCodes(tray);
  return sampleCodes.length
    ? sampleCodes.slice(0, TASK_ROW_SAMPLE_PREVIEW_LIMIT).join("、")
    : String(tray?.sampleSummary || "-").trim() || "-";
};
const hiddenTraySampleCount = (tray) => hiddenCount(normalizeSampleCodes(tray), TASK_ROW_SAMPLE_PREVIEW_LIMIT);

const previewTrayCodes = computed(() => takePreview(props.detail?.trayCodes, TASK_TRAY_PREVIEW_LIMIT));
const hiddenTrayCodeCount = computed(() => hiddenCount(props.detail?.trayCodes, TASK_TRAY_PREVIEW_LIMIT));
const previewRunningTrayRows = computed(() => takePreview(props.detail?.runningTrayRows, TASK_ROW_PREVIEW_LIMIT));
const hiddenRunningTrayCount = computed(() => hiddenCount(props.detail?.runningTrayRows, TASK_ROW_PREVIEW_LIMIT));

</script>

<style scoped>
.process-task-tray-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
  overflow: hidden;
}
.process-task-tray-panel > .process-task-summary-card { display: flex; flex-direction: column; min-height: 0; }
.process-task-summary-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel-strong);
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  padding: 14px 16px;
}
.process-task-summary-title { font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.process-task-tray-chip-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 4px; width: 100%; }
.process-task-tray-chip-list.is-single-column { grid-template-columns: minmax(0, 1fr); }
.process-task-tray-chip-list.is-dense { gap: 8px; }
.process-task-tray-chip {
  appearance: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 52px;
  padding: 12px 18px;
  border-radius: 999px;
  border: 1px solid rgba(var(--industrial-accent-rgb), 0.38);
  background: rgba(var(--industrial-accent-rgb), 0.12);
  color: var(--text);
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.02em;
  transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, color 140ms ease, transform 140ms ease;
}
.process-task-tray-chip:hover { border-color: rgba(var(--industrial-accent-rgb), 0.55); background: rgba(var(--industrial-accent-rgb), 0.16); color: var(--accent); }
.process-task-tray-chip-emphasis { box-shadow: inset 0 0 0 1px rgba(var(--industrial-accent-rgb), 0.12); }
.process-task-tray-chip-list.is-dense .process-task-tray-chip { min-height: 42px; padding: 8px 14px; font-size: 14px; }
.process-task-tray-chip.is-selected { border-color: rgba(var(--industrial-accent-rgb), 0.55); background: rgba(var(--industrial-accent-rgb), 0.16); box-shadow: inset 0 0 0 1px rgba(var(--industrial-accent-rgb), 0.16); color: var(--accent); transform: translateY(-1px); }
.process-task-tray-list { display: grid; gap: 10px; }
.process-task-tray-list--scrollable { flex: 1 1 auto; min-height: 0; max-height: none; overflow: auto; overscroll-behavior: contain; padding-right: 4px; scrollbar-gutter: stable; }
.process-task-tray-row { width: 100%; text-align: left; display: grid; gap: 4px; padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-panel-strong); color: var(--text); }
.process-task-tray-row__select { appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer; display: grid; gap: 4px; min-width: 0; padding: 0; text-align: left; width: 100%; }
.process-task-tray-row__select strong,
.process-task-tray-row__select span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.process-task-tray-row.is-selected { border-color: rgba(var(--industrial-accent-rgb), 0.55); background: rgba(var(--industrial-accent-rgb), 0.16); box-shadow: inset 0 0 0 1px rgba(var(--industrial-accent-rgb), 0.16); }
.process-task-tray-row strong { font-size: 14px; }
.process-task-tray-row span { font-size: 12px; color: var(--muted); }
.process-task-more-inline { align-items: center; display: flex; gap: 8px; min-width: 0; }
.process-task-more-line { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 2px; }
.process-task-more-count { display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(var(--industrial-accent-rgb), 0.38); background: rgba(var(--industrial-accent-rgb), 0.12); color: var(--text); font-size: 13px; font-weight: 700; }
.process-task-more-button { appearance: none; cursor: pointer; min-height: 32px; padding: 5px 12px; border: 1px solid rgba(var(--industrial-accent-rgb), 0.38); border-radius: 999px; background: rgba(var(--industrial-accent-rgb), 0.12); color: var(--text); font-size: 13px; font-weight: 700; }
@media (max-width: 720px) { .process-task-tray-panel { grid-template-columns: 1fr; } }
@media (max-height: 900px) {
  .process-task-summary-card,
  .process-task-tray-row { padding: 10px 12px; }
  .process-task-tray-panel { gap: 10px; }
  .process-task-tray-chip { min-height: 42px; padding: 8px 12px; font-size: 14px; }
}
</style>
