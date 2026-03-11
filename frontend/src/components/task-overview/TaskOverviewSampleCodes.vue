<template>
  <div class="task-overview-block">
    <div class="task-overview-label">样品编号</div>
    <div class="task-overview-codes">
      <span v-for="code in sampleCodes" :key="code" class="task-overview-chip">{{ code }}</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  sampleCodes: {
    type: Array,
    default: () => [],
  },
});
</script>
