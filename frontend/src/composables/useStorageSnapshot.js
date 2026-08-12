import {
  SNAPSHOT_UPDATED_STORAGE_KEY,
  readStorageSnapshot,
  writeStorageRunningRepair,
  writeStorageSchedulePatch,
  writeStorageUpdates,
} from "@/lib/storageApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { reconcileScheduleExceptions } from "@/lib/scheduleExceptions";

const RECONCILIATION_KEYS = [
  STORAGE_KEYS.conflicts,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_runs,
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

const normalizeIdList = (value) => {
  const values = value instanceof Set ? Array.from(value) : Array.isArray(value) ? value : [];
  return Array.from(new Set(values.map((id) => String(id || "").trim()).filter(Boolean)));
};

const collectRemovedScheduleIds = (beforeSchedules, afterSchedules) => {
  const remainingIds = new Set(
    (Array.isArray(afterSchedules) ? afterSchedules : [])
      .map((schedule) => String(schedule?.id || "").trim())
      .filter(Boolean),
  );
  return normalizeIdList(
    (Array.isArray(beforeSchedules) ? beforeSchedules : [])
      .map((schedule) => String(schedule?.id || "").trim())
      .filter((id) => id && !remainingIds.has(id)),
  );
};

const buildScheduleExceptionPatch = (snapshot, reconciled) => {
  const explicitExpiredScheduleIds = normalizeIdList(reconciled?.expiredScheduleIds);
  const deletedScheduleIds = explicitExpiredScheduleIds.length
    ? explicitExpiredScheduleIds
    : collectRemovedScheduleIds(snapshot?.[STORAGE_KEYS.schedules], reconciled?.snapshot?.[STORAGE_KEYS.schedules]);
  if (deletedScheduleIds.length === 0) {
    return null;
  }

  const upsertKeys = [
    STORAGE_KEYS.conflicts,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.tasks,
  ];
  const upserts = Object.fromEntries(
    upsertKeys
      .filter((key) => Array.isArray(reconciled?.updates?.[key]))
      .map((key) => [key, reconciled.updates[key]]),
  );
  return {
    ...(Object.keys(upserts).length ? { upserts } : {}),
    deletes: {
      [STORAGE_KEYS.schedules]: deletedScheduleIds,
    },
  };
};

function useStorageSnapshot(keys, readOptions = {}) {
  const requestedKeys = Array.isArray(keys) ? keys : [];
  const profile = String(readOptions?.profile || "").trim().toLowerCase();

  return {
    loadSnapshot: async (options = {}) => {
      const shouldReconcileScheduleExceptions = options?.reconcileScheduleExceptions === true;
      const loadedKeys = Array.from(new Set([
        ...requestedKeys,
        ...(shouldReconcileScheduleExceptions ? RECONCILIATION_KEYS : []),
      ]));
      const fallbackSnapshot = options?.fallbackSnapshot || {};
      const markerBeforeRead = readSnapshotUpdateMarker();
      const rawSnapshot = await readStorageSnapshot(loadedKeys, { normalizeMissing: false, profile });
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
      const reconciled = shouldReconcileScheduleExceptions
        ? reconcileScheduleExceptions(snapshot)
        : { changed: false, snapshot, updates: {} };
      if (reconciled.changed) {
        const markerBeforeWrite = readSnapshotUpdateMarker();
        if (markerBeforeWrite !== markerBeforeRead) {
          return Object.fromEntries(
            requestedKeys.map((key) => [key, Array.isArray(snapshot?.[key]) ? snapshot[key] : []]),
          );
        }
        const scheduleExceptionPatch = buildScheduleExceptionPatch(snapshot, reconciled);
        if (scheduleExceptionPatch) {
          await writeStorageSchedulePatch(scheduleExceptionPatch);
        } else {
          await writeStorageUpdates(reconciled.updates);
        }
      }
      return Object.fromEntries(
        requestedKeys.map((key) => [key, Array.isArray(reconciled.snapshot?.[key]) ? reconciled.snapshot[key] : []]),
      );
    },
    persistRunningRepair: (command) => writeStorageRunningRepair(command),
    persistSnapshot: (updates) => writeStorageUpdates(updates),
  };
}

export { useStorageSnapshot };
