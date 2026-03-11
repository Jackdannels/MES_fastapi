import { readStorageSnapshot, writeStorageUpdates } from "@/lib/storageApi";

function useStorageSnapshot(keys) {
  return {
    loadSnapshot: () => readStorageSnapshot(keys),
    persistSnapshot: (updates) => writeStorageUpdates(updates),
  };
}

export { useStorageSnapshot };
