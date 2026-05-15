<template>
  <div
    v-if="normalizedMessage && visible"
    class="app-feedback"
    :class="`app-feedback--${normalizedTone}`"
    role="button"
    tabindex="0"
    title="点击关闭提示"
    @click="dismiss"
    @keydown.enter.prevent="dismiss"
    @keydown.space.prevent="dismiss"
  >
    <span class="app-feedback__icon" aria-hidden="true">{{ icon }}</span>
    <div class="app-feedback__body">
      <slot>{{ normalizedMessage }}</slot>
    </div>
    <button class="app-feedback__close" type="button" aria-label="关闭提示" @click.stop="dismiss">×</button>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";

import { DEFAULT_FEEDBACK_DISMISS_MS } from "@/composables/useFeedback";

const emit = defineEmits(["close"]);

const props = defineProps({
  message: {
    type: String,
    default: "",
  },
  tone: {
    type: String,
    default: "info",
  },
  autoDismissMs: {
    type: Number,
    default: DEFAULT_FEEDBACK_DISMISS_MS,
  },
});

const toneSet = new Set(["success", "error", "warning", "info"]);
const visible = ref(false);
let dismissTimer = null;

const clearTimer = () => {
  if (dismissTimer && typeof window !== "undefined") {
    window.clearTimeout(dismissTimer);
  }
  dismissTimer = null;
};

const dismiss = () => {
  clearTimer();
  visible.value = false;
  emit("close");
};

const normalizedMessage = computed(() => String(props.message || "").trim());
const normalizedTone = computed(() => {
  const tone = String(props.tone || "").trim();
  return toneSet.has(tone) ? tone : "info";
});
const icon = computed(() => {
  if (normalizedTone.value === "success") {
    return "✓";
  }
  if (normalizedTone.value === "info") {
    return "i";
  }
  return "!";
});

watch(
  normalizedMessage,
  (message) => {
    clearTimer();
    visible.value = Boolean(message);
    if (message && props.autoDismissMs > 0 && typeof window !== "undefined") {
      dismissTimer = window.setTimeout(() => {
        visible.value = false;
        dismissTimer = null;
        emit("close");
      }, props.autoDismissMs);
    }
  },
  { immediate: true },
);

onBeforeUnmount(clearTimer);
</script>

<style scoped>
.app-feedback {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
}

.app-feedback__icon,
.app-feedback__close {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  font-weight: 800;
}

.app-feedback__body {
  min-width: 0;
}

.app-feedback__close {
  border: 0;
  background: rgba(255, 255, 255, 0.55);
  color: inherit;
}

.app-feedback--success {
  border-color: rgba(34, 197, 94, 0.42);
  background: rgba(236, 253, 245, 0.92);
  color: #166534;
}

.app-feedback--error {
  border-color: rgba(244, 63, 94, 0.35);
  background: rgba(255, 241, 242, 0.94);
  color: #b91c1c;
}

.app-feedback--warning {
  border-color: rgba(245, 158, 11, 0.38);
  background: rgba(255, 251, 235, 0.95);
  color: #92400e;
}

.app-feedback--info {
  border-color: rgba(59, 130, 246, 0.32);
  background: rgba(239, 246, 255, 0.95);
  color: #1d4ed8;
}
</style>
