<template>
  <section class="card transfer-overview-shell" data-testid="transfer-dispatch-panel">
    <div class="transfer-overview-title-row">
      <h2 class="transfer-overview-page-title">样品出库</h2>
    </div>

    <div class="transfer-overview-shell__head">
      <div>
        <h2>托盘扫码出库</h2>
        <div class="muted">请扫描托盘条码，系统将自动匹配目标实验室或暂存间。</div>
      </div>
    </div>

    <div class="transfer-overview-toolbar">
      <input
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
    </div>

    <div v-if="dispatchState.state.feedback" class="form-alert" data-testid="transfer-dispatch-feedback">
      {{ dispatchState.state.feedback }}
    </div>

    <section v-if="dispatchState.state.tray" class="card section" data-testid="transfer-dispatch-result">
      <div class="transfer-overview-shell__head">
        <div>
          <h3>{{ dispatchState.state.tray.trayNo }}</h3>
          <div class="muted">当前状态：{{ dispatchState.state.tray.trayStatus || "未知" }}</div>
        </div>
        <div class="muted">任务 {{ dispatchState.state.tray.taskNo }} | 样品数 {{ dispatchState.state.tray.sampleCount }}</div>
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

      <div class="form-actions">
        <button
          v-for="(destination, index) in dispatchState.state.destinations"
          :key="`${destination.targetType}-${destination.targetName}-${destination.experimentCode || index}`"
          class="action-btn secondary"
          :class="{ 'is-active': destination.preferred }"
          :data-testid="`transfer-dispatch-destination-${index}`"
          :disabled="!dispatchState.canSelectDestination(destination)"
          type="button"
          @click="dispatchState.submitDestination(destination)"
        >
          {{ destination.targetName }}
          <span v-if="destination.preferred"> · 优先送达</span>
        </button>
      </div>
    </section>
  </section>
</template>

<script setup>
defineProps({
  dispatchState: {
    type: Object,
    required: true,
  },
});
</script>
