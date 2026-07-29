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
          v-for="trayCode in detail.trayCodes"
          :key="trayCode"
          class="process-task-tray-chip process-task-tray-chip-emphasis"
          :class="{
            'is-current-experiment': isCurrentExperimentTray(trayCode),
            'is-selected': detail?.selectedTrayCode === trayCode,
          }"
          :aria-label="isCurrentExperimentTray(trayCode) ? `${trayCode}，当前实验托盘` : trayCode"
          :aria-pressed="detail?.selectedTrayCode === trayCode"
          type="button"
          :data-testid="`process-tray-chip-${trayCode}`"
          @click="$emit('select-tray', trayCode)"
        >
          <span class="process-task-tray-chip__code">{{ trayCode }}</span>
          <span v-if="isCurrentExperimentTray(trayCode)" class="process-task-tray-chip__status">当前实验</span>
        </button>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed } from "vue";

defineOptions({ name: "ProcessTaskTrayPanel" });

const props = defineProps({ detail: { type: Object, default: null } });
defineEmits(["select-tray"]);

const currentExperimentTrayCodes = computed(() => new Set(
  (Array.isArray(props.detail?.runningTrayRows) ? props.detail.runningTrayRows : [])
    .map((tray) => String(tray?.trayCode || "").trim())
    .filter(Boolean)
));
const isCurrentExperimentTray = (trayCode) => currentExperimentTrayCodes.value.has(String(trayCode || "").trim());

</script>

<style scoped>
.process-task-tray-panel {
  display: block;
  min-height: 0;
  overflow: hidden;
}
.process-task-tray-panel > .process-task-summary-card { box-sizing: border-box; display: flex; flex-direction: column; height: 100%; min-height: 0; }
.process-task-summary-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel-strong);
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  padding: 14px 16px;
}
.process-task-summary-title { flex: 0 0 auto; font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.process-task-tray-chip-list { align-content: start; display: grid; flex: 1 1 auto; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 4px; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 2px 8px 2px 2px; scrollbar-color: rgba(var(--industrial-accent-rgb), 0.22) transparent; scrollbar-gutter: stable; scrollbar-width: thin; width: 100%; }
.process-task-tray-chip-list:hover,
.process-task-tray-chip-list:focus-within { scrollbar-color: rgba(var(--industrial-accent-rgb), 0.72) transparent; }
.process-task-tray-chip-list::-webkit-scrollbar { width: 8px; }
.process-task-tray-chip-list::-webkit-scrollbar-track { border-radius: 999px; background: transparent; }
.process-task-tray-chip-list::-webkit-scrollbar-thumb { border: 2px solid var(--bg-panel-strong); border-radius: 999px; background: rgba(var(--industrial-accent-rgb), 0.18); }
.process-task-tray-chip-list:hover::-webkit-scrollbar-thumb,
.process-task-tray-chip-list:focus-within::-webkit-scrollbar-thumb { background: rgba(var(--industrial-accent-rgb), 0.62); }
.process-task-tray-chip-list::-webkit-scrollbar-thumb:hover { background: rgba(var(--industrial-accent-rgb), 0.88); }
.process-task-tray-chip-list.is-single-column { grid-template-columns: minmax(0, 1fr); }
.process-task-tray-chip-list.is-dense { gap: 8px; }
.process-task-tray-chip {
  appearance: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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
.process-task-tray-chip__code { flex: 1 1 auto; min-width: 0; overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.process-task-tray-chip__status { flex: 0 0 auto; padding: 3px 8px; border: 1px solid rgba(255, 237, 213, 0.56); border-radius: 999px; color: #fff7ed; font-size: 12px; font-weight: 800; letter-spacing: 0; line-height: 1.25; }
.process-task-tray-chip:hover { border-color: rgba(var(--industrial-accent-rgb), 0.55); background: rgba(var(--industrial-accent-rgb), 0.16); color: var(--accent); }
.process-task-tray-chip-emphasis { box-shadow: inset 0 0 0 1px rgba(var(--industrial-accent-rgb), 0.12); }
.process-task-tray-chip-list.is-dense .process-task-tray-chip { min-height: 44px; padding: 8px 14px; font-size: 14px; }
.process-task-tray-chip.is-selected { border-color: rgba(var(--industrial-accent-rgb), 0.72); background: rgba(var(--industrial-accent-rgb), 0.16); box-shadow: inset 0 0 0 2px rgba(var(--industrial-accent-rgb), 0.34); color: var(--accent); }
.process-task-tray-chip.is-current-experiment { border-color: rgba(251, 146, 60, 0.88); background: rgba(194, 65, 12, 0.52); box-shadow: inset 0 0 0 1px rgba(251, 146, 60, 0.28); color: #fff7ed; }
.process-task-tray-chip.is-current-experiment:hover { border-color: #fb923c; background: rgba(194, 65, 12, 0.64); color: #fff7ed; }
.process-task-tray-chip.is-current-experiment.is-selected { box-shadow: inset 0 0 0 2px rgba(var(--industrial-accent-rgb), 0.92), inset 0 0 0 3px rgba(251, 146, 60, 0.28); }
.process-task-tray-chip:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--accent); }
@media (max-height: 900px) {
  .process-task-summary-card { padding: 10px 12px; }
  .process-task-tray-chip { min-height: 44px; padding: 8px 12px; font-size: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .process-task-tray-chip { transition: none; }
}
</style>
