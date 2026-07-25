import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { STORAGE_KEYS } from "@/lib/storageKeys";

function useTransferWorkbenchRealtime({
  allocationReadOnly,
  barcodeModalVisible,
  errorSample,
  ignoredStorageRequestIds,
  printingAllBarcodes,
  refreshTransferWorkspaceAfterTrayChange,
  sampleCodesModalVisible,
  selectedTaskId,
  viewMode,
}) {
  let hasPendingSamplesRefresh = false;

  const isTransferRealtimeRefreshPaused = () => Boolean(
    barcodeModalVisible.value
    || sampleCodesModalVisible.value
    || printingAllBarcodes.value
    || errorSample.state.open
    || errorSample.state.loading
    || errorSample.state.submitting
    || (viewMode.value === "detail" && selectedTaskId.value && !allocationReadOnly.value)
  );

  const storageRefresh = useStorageSnapshotRefresh({
    keys: [
      STORAGE_KEYS.tasks,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.schedules,
      STORAGE_KEYS.experiments,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.experiment_samples,
      STORAGE_KEYS.staging_events,
    ],
    refresh: refreshTransferWorkspaceAfterTrayChange,
    paused: isTransferRealtimeRefreshPaused,
    debounceMs: 100,
    ignoreSource: "transfer-workbench",
    ignoreRequestIds: ignoredStorageRequestIds,
  });

  function flushPendingRealtimeRefresh() {
    const flushedStorage = storageRefresh.flushPendingRefresh();
    if (!hasPendingSamplesRefresh || isTransferRealtimeRefreshPaused()) {
      return flushedStorage;
    }
    hasPendingSamplesRefresh = false;
    if (!flushedStorage) {
      void refreshTransferWorkspaceAfterTrayChange();
    }
    return true;
  }

  const handleSamplesUpdated = (event) => {
    const source = String(event?.detail?.source || "").trim();
    if (source === "transfer-workbench" || source === "tray-error-sample") {
      return;
    }
    if (isTransferRealtimeRefreshPaused()) {
      hasPendingSamplesRefresh = true;
      return;
    }
    hasPendingSamplesRefresh = false;
    storageRefresh.requestRefresh({
      ...(event?.detail || {}),
      keys: [STORAGE_KEYS.samples],
      immediate: true,
    });
  };

  return {
    flushPendingRealtimeRefresh,
    handleSamplesUpdated,
    isTransferRealtimeRefreshPaused,
  };
}

export { useTransferWorkbenchRealtime };
