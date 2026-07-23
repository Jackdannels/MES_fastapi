import { onBeforeUnmount, onMounted } from "vue";

import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

const TASKS_REALTIME_KEYS = [
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.external_task_intakes,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.streams,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.experiment_samples,
  STORAGE_KEYS.experiment_runs,
  STORAGE_KEYS.experiment_run_trays,
];

function useTasksRealtime({
  editAxisModal,
  editExperimentModal,
  intakeAxisModal,
  intakeExperimentModal,
  intakeModal,
  isTaskEditFormDirty,
  loadTasksPage,
  resetModal,
  sampleCodesModal,
  scheduledExperimentRemovalModal,
  taskDrawer,
}) {
  let hasPendingSamplesRefresh = false;
  const isRealtimeRefreshPaused = () => Boolean(
    intakeModal.open.value
    || intakeExperimentModal.open.value
    || intakeAxisModal.open.value
    || editExperimentModal.open.value
    || editAxisModal.open.value
    || sampleCodesModal.open.value
    || scheduledExperimentRemovalModal.open.value
    || resetModal.open.value
    || (taskDrawer.open.value && isTaskEditFormDirty())
  );
  const storageRefresh = useStorageSnapshotRefresh({
    keys: TASKS_REALTIME_KEYS,
    refresh: loadTasksPage,
    paused: isRealtimeRefreshPaused,
  });
  const flushPendingRealtimeRefresh = () => {
    const flushedStorage = storageRefresh.flushPendingRefresh();
    if (!hasPendingSamplesRefresh || isRealtimeRefreshPaused()) {
      return flushedStorage;
    }
    hasPendingSamplesRefresh = false;
    if (!flushedStorage) {
      void loadTasksPage();
    }
    return true;
  };
  const handleSamplesUpdated = () => {
    if (isRealtimeRefreshPaused()) {
      hasPendingSamplesRefresh = true;
      return;
    }
    hasPendingSamplesRefresh = false;
    void loadTasksPage();
  };

  onMounted(() => {
    window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });
  onBeforeUnmount(() => {
    window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  return { flushPendingRealtimeRefresh };
}

export { TASKS_REALTIME_KEYS, useTasksRealtime };
