<template>
  <section class="card transfer-overview-shell transfer-dispatch-shell" data-testid="transfer-dispatch-panel">
    <div class="transfer-overview-title-row">
      <h2 class="transfer-overview-page-title">样品出库</h2>
    </div>

    <div class="transfer-overview-shell__head">
      <div>
        <h2>托盘扫码出库</h2>
        <div class="muted">请扫描托盘二维码，系统将自动匹配目标实验室或暂存间。</div>
      </div>
    </div>

    <div class="transfer-overview-toolbar transfer-dispatch-toolbar">
      <input
        ref="scanInputRef"
        :value="dispatchState.state.scanCode"
        class="search-input"
        data-testid="transfer-dispatch-scan-input"
        placeholder="输入或扫描托盘编号"
        type="text"
        @input="dispatchState.updateScanCode($event.target.value)"
        @keyup.enter="handleLookup"
      />
      <button
        class="action-btn"
        data-testid="transfer-dispatch-scan-submit"
        type="button"
        :disabled="dispatchState.state.loading"
        @click="handleLookup"
      >
        {{ dispatchState.state.loading ? "查询中..." : "查询托盘" }}
      </button>

      <AppFeedback
        class="transfer-dispatch-feedback"
        :message="dispatchState.feedbackMessage.value"
        :tone="dispatchState.feedbackTone.value"
        data-testid="transfer-dispatch-feedback"
        @close="dispatchState.clearFeedback"
      />
    </div>

    <section v-if="dispatchState.state.tray" class="transfer-dispatch-result" data-testid="transfer-dispatch-result">
      <article class="transfer-dispatch-summary-card" data-testid="transfer-dispatch-tray-summary">
        <div class="transfer-dispatch-summary-card__ticket-main">
          <div class="transfer-dispatch-summary-card__title-row">
            <h3 class="transfer-dispatch-summary-card__tray-no">{{ dispatchState.state.tray.trayNo }}</h3>
          </div>

          <div class="transfer-dispatch-summary-card__fields">
            <div
              class="transfer-dispatch-summary-card__field transfer-dispatch-summary-card__task-no"
              data-testid="transfer-dispatch-summary-task-no"
            >
              <span>任务编号</span>
              <strong>{{ dispatchState.state.tray.taskNo }}</strong>
            </div>

            <div class="transfer-dispatch-summary-card__field">
              <span>当前状态：</span>
              <strong>{{ currentTrayDisplayStatus }}</strong>
            </div>
          </div>

          <div
            v-if="dispatchState.state.tray.experimentLabels?.length"
            class="transfer-dispatch-summary-card__experiment-tags"
          >
            <span
              v-for="(label, index) in dispatchState.state.tray.experimentLabels"
              :key="`${dispatchState.state.tray.trayNo}-${label}-${index}`"
              class="transfer-dispatch-summary-card__experiment-tag"
              :class="resolveDispatchExperimentTagTone(label)"
            >
              {{ label }}
            </span>
          </div>
        </div>

        <div class="transfer-dispatch-summary-card__ticket-stats">
          <div class="transfer-dispatch-summary-card__stat">
            <span>样品</span>
            <strong>{{ dispatchState.state.tray.sampleCount }}</strong>
          </div>
          <div class="transfer-dispatch-summary-card__stat">
            <span>实验</span>
            <strong>{{ dispatchState.state.tray.experimentLabels?.length || 0 }}</strong>
          </div>
        </div>
      </article>

      <div class="transfer-dispatch-destination-grid" data-testid="transfer-dispatch-destination-grid">
        <article
          v-for="(destination, index) in dispatchState.state.destinations"
          :key="`${destination.targetType}-${destination.targetName}-${destination.experimentCode || index}`"
          class="transfer-dispatch-destination-card"
          :class="resolveDestinationCardClass(destination)"
          :data-testid="`transfer-dispatch-destination-card-${index}`"
        >
          <div class="transfer-dispatch-destination-card__top">
            <div>
              <h4 class="transfer-dispatch-destination-card__name">{{ destination.targetName }}</h4>
              <div class="transfer-dispatch-destination-card__type">{{ resolveDestinationTypeLabel(destination) }}</div>
            </div>
            <span
              class="transfer-dispatch-destination-card__status"
              :data-testid="`transfer-dispatch-destination-badge-${index}`"
            >
              {{ resolveDestinationStatusLabel(destination) }}
            </span>
          </div>

          <div class="transfer-dispatch-destination-card__body">
            <div class="transfer-dispatch-destination-card__row">
              <span>对应实验</span>
              <strong>{{ destination.experimentName || "暂存间" }}</strong>
            </div>
            <div class="transfer-dispatch-destination-card__row">
              <span>任务编号</span>
              <strong>{{ dispatchState.state.tray.taskNo }}</strong>
            </div>
            <div class="transfer-dispatch-destination-card__row">
              <span>排程时间</span>
              <strong>{{ formatScheduleRange(destination) }}</strong>
            </div>
          </div>

          <button
            class="action-btn secondary transfer-dispatch-destination-card__action"
            :class="{ 'is-active': destination.preferred }"
            :data-testid="`transfer-dispatch-destination-${index}`"
            :disabled="!dispatchState.canSelectDestination(destination)"
            type="button"
            @click="handleDestinationSubmit(destination)"
          >
            {{ dispatchState.state.submitting ? "提交中..." : "送往此处" }}
          </button>

          <div class="transfer-dispatch-destination-card__hint">
            {{ resolveDestinationHint(destination) }}
          </div>
        </article>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import AppFeedback from "@/components/shared/AppFeedback.vue";
import { useScanInputFocus } from "@/composables/useScanInputFocus";

const props = defineProps({
  dispatchState: {
    type: Object,
    required: true,
  },
});
const dispatchState = props.dispatchState;

const scanInputRef = ref(null);
const { focusScanInput } = useScanInputFocus(scanInputRef);
const currentTrayDisplayStatus = computed(
  () => dispatchState.state.tray?.trayDisplayStatus || dispatchState.state.tray?.trayStatus || "未知",
);

const DISPATCH_EXPERIMENT_TAG_TONES = [
  { keys: ["盐雾"], className: "transfer-dispatch-summary-card__experiment-tag--tone-1" },
  { keys: ["霉菌"], className: "transfer-dispatch-summary-card__experiment-tag--tone-2" },
  { keys: ["高低温", "湿热"], className: "transfer-dispatch-summary-card__experiment-tag--tone-3" },
  { keys: ["冲击"], className: "transfer-dispatch-summary-card__experiment-tag--tone-4" },
  { keys: ["温度"], className: "transfer-dispatch-summary-card__experiment-tag--tone-5" },
  { keys: ["振动"], className: "transfer-dispatch-summary-card__experiment-tag--tone-6" },
  { keys: ["通电"], className: "transfer-dispatch-summary-card__experiment-tag--tone-2" },
  { keys: ["耐久"], className: "transfer-dispatch-summary-card__experiment-tag--tone-5" },
];

const resolveDispatchExperimentTagTone = (value) => {
  const text = String(value || "").trim();
  const matchedTone = DISPATCH_EXPERIMENT_TAG_TONES.find((tone) =>
    tone.keys.some((key) => text.includes(key)),
  );
  if (matchedTone) {
    return matchedTone.className;
  }
  const hash = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `transfer-dispatch-summary-card__experiment-tag--tone-${(hash % 6) + 1}`;
};

onMounted(() => {
  void focusScanInput();
});

const handleLookup = async () => {
  const lookedUp = await dispatchState.lookupTray();
  if (lookedUp) {
    await focusScanInput();
  }
};

const handleDestinationSubmit = async (destination) => {
  const submitted = await dispatchState.submitDestination(destination);
  if (submitted) {
    await focusScanInput();
  }
};

const resolveDestinationTypeLabel = (destination) => (destination?.targetType === "staging" ? "暂存间" : "实验室");

const resolveDestinationStatusLabel = (destination) => {
  if (destination?.preferred) {
    return "优先送达";
  }
  if (destination?.scheduled) {
    return "可送达";
  }
  return "待排程";
};

const resolveDestinationCardClass = (destination) => {
  if (destination?.targetType === "staging") {
    return "is-staging";
  }
  if (!destination?.scheduled) {
    return "is-idle";
  }
  if (destination?.preferred) {
    return "is-running";
  }
  return "is-scheduled";
};

const normalizeScheduleText = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const [datePart = "", timePart = ""] = text.replace("T", " ").split(" ");
  const dateBits = datePart.split("-");
  const shortDate = dateBits.length === 3 ? `${dateBits[1]}/${dateBits[2]}` : datePart;
  const shortTime = timePart ? timePart.slice(0, 5) : "";
  return shortTime ? `${shortDate} ${shortTime}` : shortDate;
};

const formatScheduleRange = (destination) => {
  if (!destination?.scheduled) {
    return "暂无排程";
  }

  const startText = normalizeScheduleText(destination.scheduleStartAt);
  const endText = normalizeScheduleText(destination.scheduleEndAt);
  if (startText && endText) {
    return `${startText} - ${endText}`;
  }
  return startText || endText || "暂无排程";
};

const resolveDestinationHint = (destination) => {
  if (destination?.targetType === "staging") {
    return "允许先送暂存间，后续再转正式实验室。";
  }
  if (!destination?.scheduled) {
    return "当前实验尚未排程，暂不能直接送达。";
  }
  return "当前托盘可直接送往该实验室。";
};
</script>

<style scoped>
.transfer-dispatch-shell {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  align-content: stretch;
  gap: 12px;
  overflow: hidden;
}

.transfer-dispatch-toolbar {
  position: static;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 1fr) 220px;
}

.transfer-dispatch-toolbar > .transfer-dispatch-feedback {
  position: static;
  grid-column: 1 / -1;
  width: 100%;
  margin-top: 0;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.14);
}

.transfer-dispatch-result {
  min-height: 0;
  flex: 1 1 auto;
  grid-template-rows: auto auto;
  gap: 14px;
  align-content: start;
  margin-top: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.transfer-dispatch-summary-card,
.transfer-dispatch-destination-card {
  border-radius: 18px;
  border: 1px solid var(--border);
  background: var(--bg-card-raised);
  color: var(--text);
  box-shadow: var(--shadow);
}

.transfer-dispatch-summary-card {
  height: 190px;
  min-height: 190px;
  max-height: 190px;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  overflow: hidden;
  background:
    linear-gradient(90deg, transparent calc(100% - 241px), rgba(255, 255, 255, 0.08) calc(100% - 241px), rgba(255, 255, 255, 0.08) calc(100% - 240px), transparent calc(100% - 240px)),
    var(--bg-card-raised);
}

.transfer-dispatch-destination-card__top,
.transfer-dispatch-destination-card__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.transfer-dispatch-summary-card__ticket-main {
  min-width: 0;
  padding: 16px 18px;
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 10px;
}

.transfer-dispatch-summary-card__title-row {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.transfer-dispatch-summary-card__tray-no {
  min-width: 0;
  margin: 0;
  font-size: 22px;
  line-height: 1.1;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transfer-dispatch-summary-card__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.transfer-dispatch-summary-card__field {
  min-width: 0;
  min-height: 34px;
  padding: 7px 9px;
  border-radius: 8px;
  background: rgba(8, 24, 28, 0.86);
  font-size: 13px;
  overflow: hidden;
}

.transfer-dispatch-summary-card__field span {
  display: block;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.1;
}

.transfer-dispatch-summary-card__field strong {
  display: block;
  min-width: 0;
  margin-top: 2px;
  color: var(--text);
  font-size: 15px;
  line-height: 1.15;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transfer-dispatch-summary-card__task-no {
  display: block;
}

.transfer-dispatch-summary-card__experiment-tags {
  min-width: 0;
  max-width: 100%;
  max-height: 58px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-content: flex-start;
  overflow: auto;
  scrollbar-width: thin;
}

.transfer-dispatch-summary-card__experiment-tag {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 0;
  height: auto;
  min-height: 28px;
  padding: 4px 10px;
  aspect-ratio: auto;
  border-radius: 999px;
  border: 1px solid var(--dispatch-experiment-border, rgba(14, 165, 233, 0.45));
  background: var(--dispatch-experiment-bg, rgba(14, 165, 233, 0.14));
  color: var(--dispatch-experiment-color, #7dd3fc);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  writing-mode: horizontal-tb;
  text-orientation: mixed;
}

.transfer-dispatch-summary-card__experiment-tag--tone-1 {
  --dispatch-experiment-bg: rgba(14, 165, 233, 0.14);
  --dispatch-experiment-border: rgba(14, 165, 233, 0.45);
  --dispatch-experiment-color: #7dd3fc;
}

.transfer-dispatch-summary-card__experiment-tag--tone-2 {
  --dispatch-experiment-bg: rgba(16, 185, 129, 0.14);
  --dispatch-experiment-border: rgba(16, 185, 129, 0.4);
  --dispatch-experiment-color: #86efac;
}

.transfer-dispatch-summary-card__experiment-tag--tone-3 {
  --dispatch-experiment-bg: rgba(245, 158, 11, 0.16);
  --dispatch-experiment-border: rgba(245, 158, 11, 0.44);
  --dispatch-experiment-color: #facc15;
}

.transfer-dispatch-summary-card__experiment-tag--tone-4 {
  --dispatch-experiment-bg: rgba(244, 114, 182, 0.15);
  --dispatch-experiment-border: rgba(236, 72, 153, 0.42);
  --dispatch-experiment-color: #f9a8d4;
}

.transfer-dispatch-summary-card__experiment-tag--tone-5 {
  --dispatch-experiment-bg: rgba(168, 85, 247, 0.16);
  --dispatch-experiment-border: rgba(147, 51, 234, 0.44);
  --dispatch-experiment-color: #c4b5fd;
}

.transfer-dispatch-summary-card__experiment-tag--tone-6 {
  --dispatch-experiment-bg: rgba(239, 68, 68, 0.13);
  --dispatch-experiment-border: rgba(239, 68, 68, 0.38);
  --dispatch-experiment-color: #fca5a5;
}

.transfer-dispatch-summary-card__ticket-stats {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 12px;
  padding: 16px;
  background: rgba(var(--industrial-accent-rgb), 0.08);
}

.transfer-dispatch-summary-card__stat {
  width: 100%;
  min-height: 58px;
  display: grid;
  place-items: center;
  align-content: center;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(7, 17, 20, 0.6);
}

.transfer-dispatch-summary-card__stat span {
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.transfer-dispatch-summary-card__stat strong {
  margin-top: 4px;
  color: var(--accent);
  font-size: 24px;
  line-height: 1;
}

.transfer-dispatch-destination-card__status {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--border);
  background: var(--bg-panel-strong);
  color: var(--text);
}

.transfer-dispatch-summary-card__body,
.transfer-dispatch-destination-card__body {
  display: grid;
  gap: 10px;
}

.transfer-dispatch-summary-row__label,
.transfer-dispatch-destination-card__row span,
.transfer-dispatch-destination-card__type,
.transfer-dispatch-destination-card__hint {
  color: var(--muted);
}

.transfer-dispatch-summary-row {
  display: grid;
  gap: 4px;
}

.transfer-dispatch-summary-row strong,
.transfer-dispatch-destination-card__row strong,
.transfer-dispatch-destination-card__name {
  color: var(--text);
}

.transfer-dispatch-destination-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.transfer-dispatch-destination-card {
  padding: 16px;
  display: grid;
  gap: 14px;
  min-height: 248px;
}

.transfer-dispatch-destination-card.is-running {
  border-color: rgba(34, 197, 94, 0.34);
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.12);
}

.transfer-dispatch-destination-card.is-scheduled,
.transfer-dispatch-destination-card.is-staging {
  border-color: rgba(var(--industrial-accent-rgb), 0.3);
  box-shadow: inset 0 0 0 1px rgba(var(--industrial-accent-rgb), 0.1);
}

.transfer-dispatch-destination-card.is-staging {
  border-color: rgba(245, 158, 11, 0.38);
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.12);
}

.transfer-dispatch-destination-card.is-idle {
  border-color: rgba(148, 163, 184, 0.26);
}

.transfer-dispatch-destination-card.is-running .transfer-dispatch-destination-card__status {
  border-color: rgba(34, 197, 94, 0.42);
  background: rgba(22, 101, 52, 0.24);
  color: #bbf7d0;
}

.transfer-dispatch-destination-card.is-scheduled .transfer-dispatch-destination-card__status {
  border-color: rgba(var(--industrial-accent-rgb), 0.4);
  background: rgba(var(--industrial-accent-rgb), 0.16);
  color: var(--accent);
}

.transfer-dispatch-destination-card.is-staging .transfer-dispatch-destination-card__status {
  border-color: rgba(245, 158, 11, 0.42);
  background: rgba(180, 83, 9, 0.22);
  color: #fde68a;
}

.transfer-dispatch-destination-card.is-idle .transfer-dispatch-destination-card__status {
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(148, 163, 184, 0.16);
  color: rgba(226, 232, 240, 0.86);
}

.transfer-dispatch-destination-card__name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.transfer-dispatch-destination-card__type {
  margin-top: 4px;
  font-size: 12px;
}

.transfer-dispatch-destination-card__row {
  align-items: baseline;
  padding-bottom: 8px;
  border-bottom: 1px dashed rgba(148, 163, 184, 0.3);
}

.transfer-dispatch-destination-card__row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.transfer-dispatch-destination-card__action {
  width: 100%;
  justify-content: center;
}

.transfer-dispatch-destination-card__hint {
  font-size: 13px;
}

@media (max-width: 1280px) {
  .transfer-dispatch-destination-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .transfer-dispatch-toolbar {
    grid-template-columns: 1fr;
  }

  .transfer-dispatch-destination-card__top,
  .transfer-dispatch-destination-card__row {
    flex-direction: column;
    align-items: stretch;
  }

  .transfer-dispatch-summary-card {
    height: 228px;
    min-height: 228px;
    max-height: 228px;
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) auto;
    background: var(--bg-card-raised);
  }

  .transfer-dispatch-summary-card__ticket-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 10px 18px 14px;
  }

  .transfer-dispatch-summary-card__stat {
    min-height: 42px;
  }

  .transfer-dispatch-destination-grid {
    grid-template-columns: 1fr;
  }
}
</style>
