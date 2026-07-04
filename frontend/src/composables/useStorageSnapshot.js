import { SNAPSHOT_UPDATED_STORAGE_KEY, readStorageSnapshot, writeStorageUpdates } from "@/lib/storageApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { reconcileScheduleExceptions } from "@/lib/scheduleExceptions";

const RECONCILIATION_KEYS = [
  STORAGE_KEYS.conflicts,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.tasks,
];

const readSnapshotUpdateMarker = () => {
  if (typeof window === "undefined" || !window.localStorage || typeof window.localStorage.getItem !== "function") {
    return "";
  }
  try {
    return String(window.localStorage.getItem(SNAPSHOT_UPDATED_STORAGE_KEY) || "");
  } catch {
    return "";
  }
};

function useStorageSnapshot(keys) {
  const requestedKeys = Array.isArray(keys) ? keys : [];

  return {
    loadSnapshot: async (options = {}) => {
      const loadedKeys = Array.from(new Set([...requestedKeys, ...RECONCILIATION_KEYS]));
      const fallbackSnapshot = options?.fallbackSnapshot || {};
      const markerBeforeRead = readSnapshotUpdateMarker();
      const rawSnapshot = await readStorageSnapshot(loadedKeys, { normalizeMissing: false });
      const snapshot = Object.fromEntries(
        loadedKeys.map((key) => [
          key,
          Array.isArray(rawSnapshot?.[key])
            ? rawSnapshot[key]
            : Array.isArray(fallbackSnapshot?.[key])
              ? fallbackSnapshot[key]
            : [],
        ]),
      );
      const snapshotChangedDuringRead = readSnapshotUpdateMarker() !== markerBeforeRead;
      if (snapshotChangedDuringRead) {
        return Object.fromEntries(
          requestedKeys.map((key) => [key, Array.isArray(snapshot?.[key]) ? snapshot[key] : []]),
        );
      }
      const reconciled = reconcileScheduleExceptions(snapshot);
      if (reconciled.changed) {
        const markerBeforeWrite = readSnapshotUpdateMarker();
        if (markerBeforeWrite !== markerBeforeRead) {
          return Object.fromEntries(
            requestedKeys.map((key) => [key, Array.isArray(snapshot?.[key]) ? snapshot[key] : []]),
          );
        }
        await writeStorageUpdates(reconciled.updates);
      }
      return Object.fromEntries(
        requestedKeys.map((key) => [key, Array.isArray(reconciled.snapshot?.[key]) ? reconciled.snapshot[key] : []]),
      );
    },
    persistSnapshot: (updates) => writeStorageUpdates(updates),
  };
}

export { useStorageSnapshot };
