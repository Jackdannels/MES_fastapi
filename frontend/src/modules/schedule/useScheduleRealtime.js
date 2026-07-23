import { onBeforeUnmount, onMounted } from "vue";

import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

function useScheduleRealtime({
  exceptionModal,
  ignoredStorageRequestIds,
  loadSchedulePage,
  scheduleConflictModal,
  scheduleDrawer,
  taskDetailModal,
}) {
  let hasPendingSamplesRefresh = false;

  const refreshSchedulePageWithoutReset = () => {
    void loadSchedulePage({ resetForm: false });
  };
  const isRealtimeRefreshPaused = () => Boolean(
    scheduleDrawer.open.value
    || taskDetailModal.open.value
    || scheduleConflictModal.open.value
    || exceptionModal.open.value
  );
  const handleSamplesUpdated = () => {
    if (isRealtimeRefreshPaused()) {
      hasPendingSamplesRefresh = true;
      return;
    }
    hasPendingSamplesRefresh = false;
    refreshSchedulePageWithoutReset();
  };
  const storageRefresh = useStorageSnapshotRefresh({
    keys: [
      STORAGE_KEYS.conflicts,
      STORAGE_KEYS.devices,
      STORAGE_KEYS.experiments,
      STORAGE_KEYS.experiment_runs,
      STORAGE_KEYS.experiment_run_steps,
      STORAGE_KEYS.experiment_run_trays,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.schedules,
      STORAGE_KEYS.streams,
      STORAGE_KEYS.tasks,
    ],
    refresh: () => loadSchedulePage({ resetForm: false }),
    paused: isRealtimeRefreshPaused,
    debounceMs: 100,
    ignoreSource: "schedule-page",
    ignoreRequestIds: () => ignoredStorageRequestIds.value,
  });
  const flushPendingRealtimeRefresh = () => {
    const flushedStorage = storageRefresh.flushPendingRefresh();
    if (!hasPendingSamplesRefresh || isRealtimeRefreshPaused()) {
      return flushedStorage;
    }
    hasPendingSamplesRefresh = false;
    if (!flushedStorage) {
      refreshSchedulePageWithoutReset();
    }
    return true;
  };

  onMounted(() => {
    window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });
  onBeforeUnmount(() => {
    window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  return { flushPendingRealtimeRefresh };
}

export { useScheduleRealtime };
