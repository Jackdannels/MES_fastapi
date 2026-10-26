<template>
  <aside class="sidebar" :class="{ 'is-open': expanded }" @keydown.esc.stop.prevent="closeNavigation(true)">
    <div class="sidebar-heading">
      <slot name="brand" />
      <button
        ref="toggleButton"
        class="sidebar-toggle action-btn secondary"
        data-testid="sidebar-toggle"
        type="button"
        :aria-expanded="expanded"
        :aria-controls="panelId"
        @click="expanded = !expanded"
      >
        {{ expanded ? "收起导航" : "展开导航" }}
      </button>
    </div>
    <div :id="panelId" class="sidebar-panel" @click="handleNavigationClick">
      <slot />
    </div>
  </aside>
</template>

<script setup>
import { nextTick, ref, watch } from "vue";

const props = defineProps({
  panelId: { type: String, required: true },
  routeKey: { type: String, default: "" },
});

const expanded = ref(false);
const toggleButton = ref(null);

function closeNavigation(restoreFocus = false) {
  if (!expanded.value) return;
  expanded.value = false;
  if (restoreFocus) void nextTick(() => toggleButton.value?.focus());
}

function handleNavigationClick(event) {
  if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (event.target.closest?.("a")) closeNavigation(true);
}

watch(() => props.routeKey, () => closeNavigation());
</script>
