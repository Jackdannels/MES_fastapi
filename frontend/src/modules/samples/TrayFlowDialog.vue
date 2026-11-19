<template>
  <AppModal
    :open="open"
    :title="'统一托盘流程图 · ' + trayCode"
    content-class="sample-tray-flow-dialog sample-flow-card"
    data-testid="sample-tray-flow-dialog"
    @close="$emit('close')"
  >
    <p v-if="flow?.displayRemark" class="sample-flow-status" data-testid="samples-tray-flow-remark">
      备注：{{ flow.displayRemark }}
    </p>
    <TrayFlowTimeline v-if="flow?.steps?.length" :steps="flow.steps" test-prefix="samples-tray-flow-step-" />
    <p v-else class="muted">暂无托盘流程记录</p>
  </AppModal>
</template>

<script setup>
import AppModal from "@/components/shared/AppModal.vue";
import TrayFlowTimeline from "./TrayFlowTimeline.vue";

defineProps({
  open: { type: Boolean, default: false },
  trayCode: { type: String, default: "" },
  flow: { type: Object, default: null },
});
defineEmits(["close"]);
</script>
