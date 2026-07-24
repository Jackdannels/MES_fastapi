import { ref, watch } from "vue";

function useProcessTaskDialogs({ selectedTaskDetail, setSelectedTaskForLab, taskDrawerOpen }) {
  const taskFullListOpen = ref(false);
  const taskSelectionOpen = ref(false);

  const openTaskFullList = () => {
    taskFullListOpen.value = true;
  };

  const closeTaskFullList = () => {
    taskFullListOpen.value = false;
  };

  const openTaskSelection = () => {
    taskSelectionOpen.value = true;
  };

  const closeTaskSelection = () => {
    taskSelectionOpen.value = false;
  };

  watch(taskDrawerOpen, (isOpen) => {
    if (!isOpen) {
      closeTaskSelection();
    }
  });

  const selectTaskOption = (taskOption) => {
    const labName = selectedTaskDetail.value?.labName;
    const taskCode = String(taskOption?.taskCode || "").trim();
    if (!labName || !taskCode) {
      return;
    }
    if (taskOption?.experimentCode) {
      setSelectedTaskForLab(labName, taskCode, taskOption.experimentCode);
    } else {
      setSelectedTaskForLab(labName, taskCode);
    }
    closeTaskSelection();
  };

  return {
    closeTaskFullList,
    closeTaskSelection,
    openTaskFullList,
    openTaskSelection,
    selectTaskOption,
    taskFullListOpen,
    taskSelectionOpen,
  };
}

export { useProcessTaskDialogs };
