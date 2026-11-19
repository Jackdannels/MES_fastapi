<template>
  <nav class="samples-page-tabs" aria-label="样品和托盘信息" data-testid="samples-page-tabs">
    <button
      :aria-pressed="activePageTab === 'sample-flow'"
      data-testid="samples-tab-flow"
      type="button"
      @click="setActivePageTab('sample-flow')"
    >
      样品流转
    </button>
    <button
      :aria-pressed="activePageTab === 'sample-staging'"
      data-testid="samples-tab-staging"
      type="button"
      @click="setActivePageTab('sample-staging')"
    >
      暂存间
    </button>
  </nav>

  <SamplesManagementPanel
    :active-tab="activePageTab"
    :samples-flow="samplesFlow"
  />

</template>

<script setup>
defineOptions({
  name: "SamplesPage",
});

import { reactive } from "vue";

import { useTabState } from "@/composables/useTabState";
import SamplesManagementPanel from "./SamplesManagementPanel.vue";
import { useSamplesFlow } from "./useSamplesFlow";

const { activeTab: activePageTab, setActiveTab: setActivePageTab } = useTabState("sample-flow");

const samplesFlow = reactive(useSamplesFlow({ groupResults: true }));
</script>
