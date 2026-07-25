<template>
  <div class="modal process-task-modal" :class="{ 'is-open': open }" id="process-task-modal">
    <div class="modal-backdrop" data-testid="process-task-backdrop" @click="$emit('close')"></div>
    <div class="modal-content process-task-modal-content process-task-detail-modal-content">
      <div class="modal-header process-task-modal-header">
        <div>
          <div class="muted process-task-modal-eyebrow">任务摘要</div>
          <strong>试验任务详情</strong>
        </div>
        <button class="modal-close" type="button" @click="$emit('close')">关闭</button>
      </div>

      <div class="process-task-hero">
        <div>
          <h2 class="process-task-code-headline">{{ detail?.code || "-" }}</h2>
          <p class="process-task-name-subtitle">{{ detail?.displayName || detail?.name || "-" }}</p>
        </div>
        <span class="pill process-task-status">{{ detail?.status || "-" }}</span>
      </div>

      <div class="process-task-detail-grid">
        <section class="process-task-summary-card process-task-overview-panel">
          <div v-if="detail?.availableTasks?.length > 1" class="process-task-select-entry">
            <button
              class="process-task-select-button"
              type="button"
              data-testid="process-open-task-selector"
              @click="$emit('open-task-selection')"
            >
              <span>任务选择</span>
              <strong>{{ detail.availableTasks.length }} 个任务</strong>
            </button>
          </div>
          <div class="process-task-summary-title">实验概览</div>
          <div class="process-task-keyfacts">
            <div class="process-task-keyfact">
              <span>试验类型</span>
              <strong>{{ detail?.testType || "-" }}</strong>
            </div>
            <div class="process-task-keyfact">
              <span>实验室</span>
              <strong>{{ detail?.labName || "-" }}</strong>
            </div>
            <div class="process-task-keyfact process-task-keyfact-wide">
              <span>排程时间</span>
              <strong>{{ detail?.scheduleTime || "-" }}</strong>
            </div>
          </div>
          <div class="process-task-stat-grid">
            <div class="process-task-stat">
              <span>样品数量</span>
              <strong>{{ detail?.sampleCount ?? "-" }}</strong>
            </div>
            <div class="process-task-stat">
              <span>托盘数量</span>
              <strong>{{ detail?.trayCount ?? 0 }}</strong>
            </div>
          </div>
        </section>

        <ProcessTaskTrayPanel
          :detail="detail"
          @open-full-list="$emit('open-full-list')"
          @select-tray="$emit('select-tray', $event)"
        />

        <section
          class="process-task-summary-card process-task-selected-samples"
          data-testid="process-sample-code-card"
        >
          <div class="process-task-summary-title">样品编号</div>
          <div
            v-if="detail?.selectedTraySummary?.sampleCodes?.length"
            class="process-task-sample-code-list"
            data-testid="process-selected-tray-sample-list"
          >
            <div
              v-for="sampleCode in previewSelectedSampleCodes"
              :key="sampleCode"
              class="process-task-sample-code-row"
              :data-testid="`process-selected-tray-sample-item-${sampleCode}`"
            >
              {{ sampleCode }}
            </div>
            <div v-if="hiddenSelectedSampleCount > 0" class="process-task-more-line">
              <span class="process-task-more-count">+{{ hiddenSelectedSampleCount }}</span>
              <button class="process-task-more-button" type="button" @click="$emit('open-full-list')">查看全部</button>
            </div>
          </div>
          <div v-else class="muted">当前托盘暂无样品编号。</div>
        </section>

        <section class="process-task-summary-card process-task-flow-card" data-testid="process-tray-flow-card">
          <div class="process-task-flow-head">
            <div><div class="process-task-summary-title">统一托盘流程图</div></div>
          </div>
          <ol class="process-task-flow-list process-task-flow-list--timed">
            <li
              v-for="(step, index) in detail?.selectedTrayFlow?.steps || []"
              :key="step.key"
              :data-flow-step="index"
              :class="{ current: step.active, reached: step.reached }"
            >
              <span class="process-task-flow-label">{{ step.label }}</span>
              <span class="process-task-flow-time">{{ formatFlowTime(step.time) }}</span>
            </li>
          </ol>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

import ProcessTaskTrayPanel from "./ProcessTaskTrayPanel.vue";

defineOptions({ name: "ProcessTaskDetailModal" });

const props = defineProps({
  detail: { type: Object, default: null },
  open: { type: Boolean, default: false },
});

defineEmits(["close", "open-full-list", "open-task-selection", "select-tray"]);

const TASK_SAMPLE_PREVIEW_LIMIT = 5;
const takePreview = (items, limit) => (Array.isArray(items) ? items.slice(0, limit) : []);
const hiddenCount = (items, limit) => Math.max(0, (Array.isArray(items) ? items.length : 0) - limit);
const previewSelectedSampleCodes = computed(() => takePreview(props.detail?.selectedTraySummary?.sampleCodes, TASK_SAMPLE_PREVIEW_LIMIT));
const hiddenSelectedSampleCount = computed(() => hiddenCount(props.detail?.selectedTraySummary?.sampleCodes, TASK_SAMPLE_PREVIEW_LIMIT));

const formatFlowTime = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized
    .replace("T", " ")
    .replace(/\.\d{1,6}/, "")
    .replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "");
};
</script>

<style scoped>
.process-task-modal-content { width: min(1260px, 97vw); max-height: calc(100dvh - 32px); overflow: auto; overscroll-behavior: contain; padding: 24px; }
.process-task-detail-modal-content { display: flex; flex-direction: column; height: min(900px, calc(100dvh - 32px)); max-height: calc(100dvh - 32px); overflow: hidden; box-sizing: border-box; }
.process-task-modal-header { margin-bottom: 18px; }
.process-task-modal-eyebrow { margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.12em; }
.process-task-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px; border: 1px solid var(--border); border-radius: 8px; background: linear-gradient(135deg, rgba(var(--industrial-accent-rgb), 0.16), rgba(19, 26, 34, 0.96)); }
.process-task-code-headline { margin: 0; font-size: clamp(30px, 4vw, 42px); line-height: 1; font-weight: 800; letter-spacing: 0.04em; color: var(--text); }
.process-task-name-subtitle { margin: 10px 0 0; font-size: 15px; line-height: 1.4; color: var(--muted); }
.process-task-status { flex-shrink: 0; }
.process-task-detail-grid { display: grid; grid-template-columns: minmax(280px, 0.82fr) minmax(360px, 1.05fr) minmax(320px, 0.88fr); grid-template-rows: minmax(320px, 1.15fr) minmax(180px, 0.85fr); gap: 16px; flex: 1 1 auto; min-height: 0; margin-top: 16px; overflow: hidden; }
.process-task-summary-card,
.process-task-keyfact { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel-strong); color: var(--text); min-width: 0; overflow: hidden; padding: 14px 16px; }
.process-task-overview-panel { grid-column: 1; grid-row: 1; display: grid; grid-template-rows: auto auto auto; align-content: start; gap: 12px; min-height: 0; overflow: auto; }
.process-task-tray-panel { grid-column: 2; grid-row: 1; }
.process-task-overview-panel .process-task-summary-title { margin-bottom: 0; }
.process-task-summary-title { font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.process-task-keyfacts { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.process-task-keyfact span,
.process-task-stat span { display: block; font-size: 12px; color: var(--muted); letter-spacing: 0.06em; }
.process-task-keyfact strong,
.process-task-stat strong { display: block; margin-top: 6px; font-size: 16px; font-weight: 600; }
.process-task-keyfact-wide { grid-column: span 1; }
.process-task-stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
.process-task-stat { border-radius: 8px; background: var(--bg-panel-strong); padding: 12px; border: 1px solid var(--border); color: var(--text); }
.process-task-selected-samples { grid-column: 1 / span 2; grid-row: 2; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.process-task-sample-code-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 8px; min-height: 0; overflow: auto; overscroll-behavior: contain; padding-right: 4px; scrollbar-gutter: stable; }
.process-task-sample-code-row { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-panel-strong); font-size: 14px; font-weight: 600; color: var(--text); word-break: break-all; }
.process-task-more-line { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 2px; }
.process-task-more-count { display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(var(--industrial-accent-rgb), 0.38); background: rgba(var(--industrial-accent-rgb), 0.12); color: var(--text); font-size: 13px; font-weight: 700; }
.process-task-more-button { appearance: none; cursor: pointer; min-height: 32px; padding: 5px 12px; border: 1px solid rgba(var(--industrial-accent-rgb), 0.38); border-radius: 999px; background: rgba(var(--industrial-accent-rgb), 0.12); color: var(--text); font-size: 13px; font-weight: 700; }
.process-task-select-entry { margin-bottom: 12px; }
.process-task-select-button { appearance: none; width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-panel-strong); color: var(--text); font: inherit; font-size: 14px; font-weight: 800; text-align: left; cursor: pointer; overflow-wrap: anywhere; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.process-task-select-button strong { color: var(--accent); font-size: 13px; }
.process-task-flow-card { grid-column: 3; grid-row: 1 / span 2; height: 100%; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.process-task-flow-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.process-task-flow-list { list-style: none; margin: 0; padding: 0 4px 12px 0; display: grid; align-content: start; gap: 10px; flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.process-task-flow-list li { position: relative; padding: 12px 14px 12px 38px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, 0.24); background: rgba(15, 23, 42, 0.34); color: var(--muted); font-size: 14px; }
.process-task-flow-list li::before { content: ""; position: absolute; left: 12px; top: 50%; width: 10px; height: 10px; margin-top: -5px; border-radius: 50%; background: rgba(148, 163, 184, 0.58); }
.process-task-flow-list li.reached { border-color: rgba(34, 197, 94, 0.58); background: rgba(22, 101, 52, 0.2); color: #bbf7d0; }
.process-task-flow-list li.current { border-color: rgba(34, 211, 238, 0.86); background: rgba(8, 145, 178, 0.22); color: #cffafe; border-width: 2px; font-weight: 700; box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.16), 0 0 0 1px rgba(34, 211, 238, 0.1); }
.process-task-flow-list li.reached::before { background: rgba(34, 197, 94, 0.9); }
.process-task-flow-list li.current::before { background: rgba(34, 211, 238, 0.96); }
.process-task-flow-list--timed li { display: grid; grid-template-columns: minmax(0, 1fr) max-content; align-items: center; gap: 12px; }
.process-task-flow-label { line-height: 1.35; }
.process-task-flow-time { color: var(--muted); font-size: 12px; font-weight: 500; text-align: right; white-space: nowrap; }
@media (max-width: 720px) {
  .process-task-hero,
  .process-task-flow-head { flex-direction: column; align-items: flex-start; }
  .process-task-detail-grid,
  .process-task-keyfacts,
  .process-task-stat-grid,
  .process-task-sample-code-list { grid-template-columns: 1fr; }
  .process-task-detail-grid { grid-template-rows: auto; overflow: auto; }
  .process-task-overview-panel,
  .process-task-tray-panel,
  .process-task-selected-samples,
  .process-task-flow-card { grid-column: 1; grid-row: auto; }
}
@media (max-height: 900px) {
  .process-task-modal-content { padding: 18px; }
  .process-task-modal-header { margin-bottom: 12px; }
  .process-task-hero,
  .process-task-keyfact,
  .process-task-summary-card,
  .process-task-stat { padding: 10px 12px; }
  .process-task-code-headline { font-size: clamp(26px, 3.4vw, 34px); }
  .process-task-keyfacts,
  .process-task-detail-grid,
  .process-task-overview-panel { gap: 10px; }
  .process-task-flow-list { gap: 7px; }
  .process-task-flow-list li { padding: 9px 10px 9px 32px; font-size: 13px; }
}
</style>
