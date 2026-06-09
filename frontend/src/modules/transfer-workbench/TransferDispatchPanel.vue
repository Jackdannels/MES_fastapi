<template>
  <section class="card transfer-overview-shell transfer-dispatch-shell" data-testid="transfer-dispatch-panel">
    <div class="transfer-overview-title-row">
      <h2 class="transfer-overview-page-title">样品出库</h2>
    </div>

    <div class="transfer-overview-shell__head">
      <div>
        <h2>托盘扫码出库</h2>
        <div class="muted">请扫描托盘条码，系统将自动匹配目标实验室或暂存间。</div>
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
        @input="dispatchState.state.scanCode = $event.target.value"
        @keyup.enter="dispatchState.lookupTray"
      />
      <button
        class="action-btn"
        data-testid="transfer-dispatch-scan-submit"
        type="button"
        :disabled="dispatchState.state.loading"
        @click="dispatchState.lookupTray"
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
        <div class="transfer-dispatch-summary-card__top">
          <div>
            <h3>{{ dispatchState.state.tray.trayNo }}</h3>
            <div
              class="transfer-dispatch-summary-card__task-no"
              data-testid="transfer-dispatch-summary-task-no"
            >
              <span>任务编号</span>
              <strong>{{ dispatchState.state.tray.taskNo }}</strong>
            </div>
            <div class="muted">当前状态：{{ dispatchState.state.tray.trayStatus || "未知" }}</div>
          </div>
          <div class="transfer-dispatch-summary-card__meta">
            <span class="transfer-dispatch-summary-card__type">托盘摘要</span>
            <span class="transfer-dispatch-summary-card__count">样品数 {{ dispatchState.state.tray.sampleCount }}</span>
          </div>
        </div>

        <div v-if="dispatchState.state.tray.experimentLabels?.length" class="transfer-tray-experiment-tags">
          <span
            v-for="(label, index) in dispatchState.state.tray.experimentLabels"
            :key="`${dispatchState.state.tray.trayNo}-${label}-${index}`"
            class="transfer-tray-experiment-tag transfer-tray-experiment-tag--tone-1"
          >
            {{ label }}
          </span>
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
import { onMounted, ref } from "vue";

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

onMounted(() => {
  void focusScanInput();
});

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
  min-height: auto;
  grid-template-rows: none;
  align-content: start;
}

.transfer-dispatch-toolbar {
  position: relative;
}

.transfer-dispatch-toolbar > .transfer-dispatch-feedback {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 8px);
  z-index: 20;
  width: auto;
  margin-top: 0;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.14);
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
  padding: 16px 18px;
  display: grid;
  gap: 10px;
}

.transfer-dispatch-summary-card__top,
.transfer-dispatch-summary-card__meta,
.transfer-dispatch-destination-card__top,
.transfer-dispatch-destination-card__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.transfer-dispatch-summary-card__top h3 {
  margin: 0;
  font-size: 22px;
  color: var(--text);
}

.transfer-dispatch-summary-card__task-no {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.25;
}

.transfer-dispatch-summary-card__task-no span {
  color: var(--muted);
}

.transfer-dispatch-summary-card__task-no strong {
  color: var(--text);
}

.transfer-dispatch-summary-card__meta {
  flex-direction: column;
  align-items: flex-end;
}

.transfer-dispatch-summary-card__type,
.transfer-dispatch-summary-card__count,
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

.transfer-dispatch-summary-card__count {
  border-color: rgba(var(--industrial-accent-rgb), 0.34);
  background: rgba(var(--industrial-accent-rgb), 0.14);
  color: var(--accent);
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
  .transfer-dispatch-summary-card__top,
  .transfer-dispatch-destination-card__top,
  .transfer-dispatch-destination-card__row {
    flex-direction: column;
    align-items: stretch;
  }

  .transfer-dispatch-summary-card__meta {
    align-items: flex-start;
  }

  .transfer-dispatch-destination-grid {
    grid-template-columns: 1fr;
  }
}
</style>
