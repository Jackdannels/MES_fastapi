import { ref } from "vue";

function useTabState(initialTab) {
  const activeTab = ref(initialTab);

  const setActiveTab = (nextTab) => {
    activeTab.value = nextTab;
  };

  return {
    activeTab,
    setActiveTab,
  };
}

export { useTabState };
