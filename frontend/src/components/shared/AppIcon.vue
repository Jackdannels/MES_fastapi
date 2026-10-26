<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    v-html="iconPaths[name] || ''"
  ></svg>
</template>

<script setup>
import { iconPaths } from "./iconPaths";

defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
});
</script>

<style scoped>
.app-icon { display: inline-block; flex: 0 0 auto; vertical-align: middle; }
</style>
