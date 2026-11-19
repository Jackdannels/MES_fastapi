<template>
  <div class="samples-management-panel samples-management-panel--grouped" data-testid="samples-management-panel">
    <SampleGroupedView
      v-show="activeTab === 'sample-flow'"
      :active="activeTab === 'sample-flow'"
      :samples-flow="samplesFlow"
    />
    <SampleGroupedView
      v-show="activeTab === 'sample-staging'"
      :active="activeTab === 'sample-staging'"
      :samples-flow="samplesFlow"
      staging
    />
  </div>

</template>

<script setup>
import SampleGroupedView from "./SampleGroupedView.vue";

defineProps({
  activeTab: {
    type: String,
    default: "sample-flow",
  },
  samplesFlow: {
    type: Object,
    required: true,
  },
});
</script>
