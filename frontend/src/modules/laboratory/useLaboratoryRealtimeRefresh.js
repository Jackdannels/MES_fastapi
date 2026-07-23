import { onBeforeUnmount, onMounted } from "vue";

import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

const LABORATORY_SNAPSHOT_KEYS = new Set([
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_runs,
  STORAGE_KEYS.experiment_run_trays,
  STORAGE_KEYS.experiment_run_steps,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.devices,
]);

function useLaboratoryRealtimeRefresh({
  compareModalOpen,
  completePromptVisible,
  installModalOpen,
  load,
  readyModalOpen,
  resetConfirmModalOpen,
  resetDangerModalOpen,
  scheduleModalOpen,
  taskListModalOpen,
}) {
  let ignoreNextSamplesUpdatedLoad = false;
  let hasPendingSamplesRefresh = false;

  const isLaboratoryRealtimeRefreshPaused = () => Boolean(
    scheduleModalOpen.value
    || taskListModalOpen.value
    || compareModalOpen.value
    || installModalOpen.value
    || readyModalOpen.value
    || resetConfirmModalOpen.value
    || resetDangerModalOpen.value
    || completePromptVisible.value
  );

  const handleSamplesUpdated = () => {
    if (ignoreNextSamplesUpdatedLoad) {
      ignoreNextSamplesUpdatedLoad = false;
      return;
    }
    if (isLaboratoryRealtimeRefreshPaused()) {
      hasPendingSamplesRefresh = true;
      return;
    }
    hasPendingSamplesRefresh = false;
    void load({ silent: true });
  };

  const storageRefresh = useStorageSnapshotRefresh({
    keys: Array.from(LABORATORY_SNAPSHOT_KEYS),
    refresh: () => load({ silent: true }),
    paused: isLaboratoryRealtimeRefreshPaused,
  });

  const flushPendingRealtimeRefresh = () => {
    const flushedStorage = storageRefresh.flushPendingRefresh();
    if (!hasPendingSamplesRefresh || isLaboratoryRealtimeRefreshPaused()) {
      return flushedStorage;
    }
    hasPendingSamplesRefresh = false;
    if (!flushedStorage) {
      void load({ silent: true });
    }
    return true;
  };

  const ignoreNextSamplesUpdatedRefresh = () => {
    ignoreNextSamplesUpdatedLoad = true;
  };

  onMounted(() => {
    if (typeof window !== "undefined") {
      window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
    }
  });

  onBeforeUnmount(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
    }
  });

  return {
    flushPendingRealtimeRefresh,
    ignoreNextSamplesUpdatedRefresh,
  };
}

export { useLaboratoryRealtimeRefresh };
