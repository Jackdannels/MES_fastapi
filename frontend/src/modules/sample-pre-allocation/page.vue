<template>
  <TransferWorkbench embedded mode="pre-allocation" />
</template>

<script setup>
defineOptions({
  name: "SamplePreAllocationPage",
});

import TransferWorkbench from "@/modules/transfer-workbench/TransferWorkbench.vue";
</script>
