import { readStorageSnapshot, writeStorageUpdates } from "@/lib/storageApi";
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

function useStorageSnapshot(keys) {
  const requestedKeys = Array.isArray(keys) ? keys : [];

  return {
    loadSnapshot: async () => {
      const loadedKeys = Array.from(new Set([...requestedKeys, ...RECONCILIATION_KEYS]));
      const snapshot = await readStorageSnapshot(loadedKeys);
      const reconciled = reconcileScheduleExceptions(snapshot);
      if (reconciled.changed) {
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
