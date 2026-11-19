<template>
  <ol class="sample-flow-unified sample-flow-unified--timed">
    <li
      v-for="(step, index) in steps"
      :key="step.key"
      :data-flow-step="index"
      :data-testid="testPrefix + step.key"
      :aria-current="step.active ? 'step' : undefined"
      :title="step.inferred ? '推导节点，暂无实际时间记录' : undefined"
      :class="{
        current: step.active,
        reached: step.reached && step.pauseResetState !== 'historical' && !step.pauseResetRequired,
        'pause-reset': step.pauseResetState === 'historical' || step.pauseResetRequired,
      }"
    >
      <span class="sample-flow-label">{{ step.displayLabel || step.label }}</span>
      <span class="sample-flow-time">{{ formatFlowTime(step.time) }}</span>
    </li>
  </ol>
</template>

<script setup>
import { normalizeText } from "./sampleFlow.shared";

defineProps({
  steps: { type: Array, required: true },
  testPrefix: { type: String, required: true },
});

const formatFlowTime = (value) => normalizeText(value)
  .replace("T", " ")
  .replace(/\.\d{1,6}/, "")
  .replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "") || "-";
</script>
