<template>
  <AppModal :open="model.state.open" class="tray-error-sample-dialog" data-testid="tray-error-sample-dialog" title="出错样品处理" @close="handleClose">
    <div class="tray-error-sample-panel">
      <div class="tray-error-sample-panel__head">
        <h3>托盘查询与撤回</h3>
        <div class="muted">输入或扫描托盘编号后查询当前信息，再决定是否撤回出库。</div>
      </div>

      <div class="tray-error-sample-toolbar">
        <input
          ref="scanInputRef"
          v-model="model.state.scanCode"
          class="search-input tray-error-sample-input"
          data-testid="tray-error-sample-scan-input"
          placeholder="请扫描或输入托盘编号"
          type="text"
          @keyup.enter="handleLookup"
        />
        <button
          class="action-btn tray-error-sample-query"
          data-testid="tray-error-sample-query"
          type="button"
          :disabled="model.state.loading"
          @click="handleLookup"
        >
          {{ model.state.loading ? "查询中..." : "查询托盘" }}
        </button>
      </div>

      <AppFeedback
        v-if="feedbackMessage"
        class="tray-error-sample-feedback"
        :message="feedbackMessage"
        :tone="feedbackTone"
        data-testid="tray-error-sample-feedback"
        @close="model.clearFeedback"
      />

      <section v-if="model.state.tray" class="tray-error-sample-result" data-testid="tray-error-sample-result">
        <div class="tray-error-sample-summary">
          <div>
            <h4>{{ model.state.tray.trayNo }}</h4>
            <div class="muted">任务编号：{{ model.state.tray.taskNo }}</div>
          </div>
          <div class="tray-error-sample-summary__meta">
            <span class="pill">样品 {{ model.state.tray.sampleCount }}</span>
            <span class="pill">{{ trayDisplayStatus }}</span>
          </div>
        </div>

        <div v-if="model.state.tray.experimentLabels?.length" class="tray-error-sample-tags">
          <span
            v-for="(label, index) in model.state.tray.experimentLabels"
            :key="`${model.state.tray.trayNo}-${label}-${index}`"
            class="tray-error-sample-tag"
          >
            {{ label }}
          </span>
        </div>

        <div class="tray-error-sample-detail-grid">
          <div class="tray-error-sample-detail-row">
            <span>当前状态</span>
            <strong>{{ trayDisplayStatus }}</strong>
          </div>
          <div class="tray-error-sample-detail-row">
            <span>任务名称</span>
            <strong>{{ model.state.tray.taskName || "-" }}</strong>
          </div>
        </div>

        <div class="tray-error-sample-actions">
          <button
            v-if="canWithdraw"
            class="action-btn danger tray-error-sample-withdraw"
            data-testid="tray-error-sample-withdraw"
            type="button"
            :disabled="model.state.submitting"
            @click="openConfirm"
          >
            撤回出库
          </button>
          <div v-else class="muted tray-error-sample-disabled-hint">
            当前状态暂不可撤回出库。
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <button class="action-btn secondary" data-testid="tray-error-sample-close" type="button" @click="handleClose">关闭</button>
    </template>
  </AppModal>

  <AppModal
    :open="withdrawConfirmOpen"
    class="tray-error-sample-withdraw-modal"
    data-testid="tray-error-sample-withdraw-modal"
    title="确认撤回出库"
    @close="closeConfirm"
  >
    <div class="tray-error-sample-confirm">
      <div class="tray-error-sample-confirm__danger">
        <strong>危险操作确认</strong>
        <p>是否确认撤回出库？撤回后流程图会回到上一站。</p>
      </div>
      <div class="tray-error-sample-confirm__reason muted">
        {{ withdrawalRestoreHint }}
      </div>
    </div>
    <template #footer>
      <button class="action-btn secondary" data-testid="tray-error-sample-withdraw-cancel" type="button" @click="closeConfirm">取消</button>
      <button
        class="action-btn danger"
        data-testid="tray-error-sample-withdraw-confirm"
        type="button"
        :disabled="model.state.submitting"
        @click="confirmWithdraw"
      >
        {{ model.state.submitting ? "撤回中..." : "确认撤回" }}
      </button>
    </template>
  </AppModal>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";

import AppFeedback from "@/components/shared/AppFeedback.vue";
import AppModal from "@/components/shared/AppModal.vue";
import { useScanInputFocus } from "@/composables/useScanInputFocus";

const props = defineProps({
  model: {
    type: Object,
    required: true,
  },
});

const model = props.model;
const scanInputRef = ref(null);
const withdrawConfirmOpen = ref(false);
const { focusScanInput } = useScanInputFocus(scanInputRef);

const normalizeText = (value) => String(value || "").trim();
const canWithdraw = computed(() => {
  const status = normalizeText(model.state.tray?.trayStatus);
  return status === "送至实验室" || status === "送至暂存间";
});
const trayDisplayStatus = computed(() => model.state.tray?.trayDisplayStatus || model.state.tray?.trayStatus || "未知");
const withdrawalRestoreHint = computed(() => {
  const status = normalizeText(model.state.tray?.trayStatus);
  if (status === "送至实验室" || status === "送至暂存间") {
    return "撤回后将恢复到本次出库前状态。";
  }
  return "撤回后将恢复到原出库前状态。";
});
const feedbackMessage = computed(() => model.feedbackMessage?.value || "");
const feedbackTone = computed(() => model.feedbackTone?.value || "info");

const handleLookup = async () => {
  const lookedUp = await model.lookupTray();
  if (lookedUp) {
    await nextTick();
    await focusScanInput();
  }
};

const openConfirm = () => {
  withdrawConfirmOpen.value = true;
};

const closeConfirm = () => {
  withdrawConfirmOpen.value = false;
};

const confirmWithdraw = async () => {
  const submitted = await model.withdrawDispatch();
  if (submitted) {
    closeConfirm();
    await nextTick();
    await focusScanInput();
  }
};

const handleClose = async () => {
  closeConfirm();
  await model.close();
};

watch(
  () => model.state.open,
  async (open) => {
    if (!open) {
      closeConfirm();
      return;
    }
    await nextTick();
    await focusScanInput();
  },
);
</script>
