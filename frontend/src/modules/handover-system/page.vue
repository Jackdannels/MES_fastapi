<template>
  <TransferWorkbench mode="handover" terminal />
</template>

<script setup>
defineOptions({
  name: "HandoverSystemPage",
});

import TransferWorkbench from "@/modules/transfer-workbench/TransferWorkbench.vue";
</script>
