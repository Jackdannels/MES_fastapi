<template>
  <div v-if="available" class="desktop-zoom" role="group" aria-label="页面缩放" data-testid="desktop-zoom-controls" title="Ctrl + 滚轮调整页面大小；Ctrl + 0 恢复 100%">
    <span class="desktop-zoom__label">缩放</span>
    <button class="desktop-zoom__step" type="button" aria-label="缩小页面" title="缩小页面（Ctrl + −）" :disabled="!state || state.percent === state.levels[0]" @click="requestDesktopZoom('out')">−</button>
    <output class="desktop-zoom__value" aria-live="polite" aria-atomic="true" :aria-label="state ? `当前页面缩放 ${state.percent}%` : '正在读取缩放比例'">{{ state ? `${state.percent}%` : '—' }}</output>
    <button class="desktop-zoom__step" type="button" aria-label="放大页面" title="放大页面（Ctrl + +）" :disabled="!state || state.percent === state.levels.at(-1)" @click="requestDesktopZoom('in')">+</button>
    <button class="desktop-zoom__reset" type="button" title="恢复至 100%（Ctrl + 0）" :disabled="!state || state.percent === 100" @click="requestDesktopZoom('reset')">重置</button>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, shallowRef } from "vue";
import { isDesktopZoomAvailable, requestDesktopZoom, subscribeDesktopZoom } from "@/lib/desktopZoom";

const available = isDesktopZoomAvailable();
const state = shallowRef(null);
let unsubscribe = () => {};
onMounted(() => {
  if (!available) return;
  unsubscribe = subscribeDesktopZoom((value) => { state.value = value; });
  requestDesktopZoom("get");
});
onBeforeUnmount(() => unsubscribe());
</script>

<style scoped>
.desktop-zoom {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  align-self: stretch;
  min-height: 46px;
  gap: 2px;
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--bg-card);
  color: var(--text);
  white-space: nowrap;
}
.desktop-zoom__label { padding-inline: 5px; color: var(--muted); font-size: 12px; }
.desktop-zoom__value { min-width: 56px; text-align: center; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--accent); }
.desktop-zoom button { min-height: 36px; min-width: 32px; padding: 0 7px; border: 0; border-radius: 4px; background: transparent; color: var(--text); font: inherit; cursor: pointer; }
.desktop-zoom .desktop-zoom__step { font-size: 20px; }
.desktop-zoom .desktop-zoom__reset { margin-left: 4px; padding-inline: 10px; border-left: 1px solid var(--border); border-radius: 0; font-size: 13px; }
.desktop-zoom button:hover:not(:disabled) { background: var(--bg-card-raised); }
.desktop-zoom button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.desktop-zoom button:disabled { opacity: .4; cursor: default; }
</style>
