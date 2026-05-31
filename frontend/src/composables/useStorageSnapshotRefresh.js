import { getCurrentInstance, onBeforeUnmount, ref, unref } from "vue";

import {
  SNAPSHOT_UPDATED_EVENT,
  SNAPSHOT_UPDATED_STORAGE_KEY,
  subscribeStorageSnapshotUpdates,
} from "@/lib/storageApi";

function normalizeKeys(value) {
  return Array.isArray(value) ? value.filter((key) => typeof key === "string" && key) : [];
}

function parseStorageMarker(value) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function shouldRefreshForKeys(watchedKeys, incomingKeys) {
  if (!watchedKeys.size || !incomingKeys.length) {
    return true;
  }
  return incomingKeys.some((key) => watchedKeys.has(key));
}

function resolvePaused(paused) {
  if (typeof paused === "function") {
    return Boolean(paused());
  }
  return Boolean(unref(paused));
}

function useStorageSnapshotRefresh(options = {}) {
  const watchedKeys = new Set(normalizeKeys(options.keys));
  const refresh = typeof options.refresh === "function" ? options.refresh : () => {};
  const paused = options.paused;
  const debounceMs = Math.max(0, Number(options.debounceMs || 0));
  const hasPendingRefresh = ref(false);
  let stopped = false;
  let debounceTimer = null;

  const clearDebounceTimer = () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const runRefresh = () => {
    if (stopped) {
      return;
    }
    if (debounceMs > 0) {
      clearDebounceTimer();
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        refresh();
      }, debounceMs);
      return;
    }
    refresh();
  };

  const requestRefresh = (payload = {}) => {
    const incomingKeys = normalizeKeys(payload?.keys);
    if (!shouldRefreshForKeys(watchedKeys, incomingKeys)) {
      return;
    }
    if (resolvePaused(paused)) {
      hasPendingRefresh.value = true;
      return;
    }
    hasPendingRefresh.value = false;
    runRefresh();
  };

  const handleSnapshotUpdated = (event) => {
    requestRefresh(event?.detail || {});
  };
  const handleStorageUpdated = (event) => {
    if (event?.key !== SNAPSHOT_UPDATED_STORAGE_KEY) {
      return;
    }
    requestRefresh(parseStorageMarker(event?.newValue));
  };

  window.addEventListener(SNAPSHOT_UPDATED_EVENT, handleSnapshotUpdated);
  window.addEventListener("storage", handleStorageUpdated);
  const unsubscribeRemoteUpdates = subscribeStorageSnapshotUpdates(requestRefresh);

  const flushPendingRefresh = () => {
    if (!hasPendingRefresh.value || resolvePaused(paused)) {
      return false;
    }
    hasPendingRefresh.value = false;
    runRefresh();
    return true;
  };

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearDebounceTimer();
    window.removeEventListener(SNAPSHOT_UPDATED_EVENT, handleSnapshotUpdated);
    window.removeEventListener("storage", handleStorageUpdated);
    unsubscribeRemoteUpdates();
  };

  if (getCurrentInstance()) {
    onBeforeUnmount(stop);
  }

  return {
    flushPendingRefresh,
    hasPendingRefresh,
    stop,
  };
}

export { useStorageSnapshotRefresh };
