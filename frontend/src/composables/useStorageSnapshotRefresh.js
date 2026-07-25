import { getCurrentInstance, onBeforeUnmount, ref, unref } from "vue";

import {
  SNAPSHOT_UPDATED_EVENT,
  SNAPSHOT_UPDATED_STORAGE_KEY,
  subscribeStorageSnapshotUpdates,
} from "@/lib/storageApi";

const DEFAULT_REFRESH_DEBOUNCE_MS = 100;
const RECENT_REQUEST_TTL_MS = 5000;

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

function normalizeSource(value) {
  return String(value || "").trim();
}

function normalizeRequestIds(value) {
  const resolved = typeof value === "function" ? value() : unref(value);
  if (resolved instanceof Set) {
    return resolved;
  }
  if (Array.isArray(resolved)) {
    return new Set(resolved.map((item) => String(item || "").trim()).filter(Boolean));
  }
  const requestId = String(resolved || "").trim();
  return requestId ? new Set([requestId]) : new Set();
}

function updateRequestKey(payload) {
  const source = normalizeSource(payload?.source);
  const requestId = String(payload?.requestId || "").trim();
  return source && requestId ? `${source}::${requestId}` : "";
}

function shouldIgnoreUpdate(payload, options) {
  const ignoredSource = normalizeSource(options.ignoreSource);
  const source = normalizeSource(payload?.source);
  const requestId = String(payload?.requestId || "").trim();
  if (!ignoredSource || !source || source !== ignoredSource || !requestId) {
    return false;
  }
  return normalizeRequestIds(options.ignoreRequestIds).has(requestId);
}

function useStorageSnapshotRefresh(options = {}) {
  const watchedKeys = new Set(normalizeKeys(options.keys));
  const refresh = typeof options.refresh === "function" ? options.refresh : () => {};
  const paused = options.paused;
  const debounceMs = options.debounceMs === undefined
    ? DEFAULT_REFRESH_DEBOUNCE_MS
    : Math.max(0, Number(options.debounceMs || 0));
  const hasPendingRefresh = ref(false);
  let stopped = false;
  let debounceTimer = null;
  let refreshInFlight = false;
  let refreshQueued = false;
  const recentRequestTimes = new Map();

  const clearDebounceTimer = () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const executeRefresh = () => {
    if (stopped) {
      return;
    }
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }
    refreshInFlight = true;
    const settleRefresh = () => {
      refreshInFlight = false;
      if (!refreshQueued || stopped) {
        refreshQueued = false;
        return;
      }
      refreshQueued = false;
      if (resolvePaused(paused)) {
        hasPendingRefresh.value = true;
        return;
      }
      executeRefresh();
    };
    try {
      Promise.resolve(refresh()).then(settleRefresh, settleRefresh);
    } catch {
      settleRefresh();
    }
  };

  const runRefresh = ({ immediate = false } = {}) => {
    if (stopped) {
      return;
    }
    if (!immediate && debounceMs > 0) {
      clearDebounceTimer();
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        executeRefresh();
      }, debounceMs);
      return;
    }
    executeRefresh();
  };

  const requestRefresh = (payload = {}) => {
    if (shouldIgnoreUpdate(payload, options)) {
      return;
    }
    const incomingKeys = normalizeKeys(payload?.keys);
    if (!shouldRefreshForKeys(watchedKeys, incomingKeys)) {
      return;
    }
    const now = Date.now();
    const requestKey = updateRequestKey(payload);
    if (requestKey) {
      const previousTime = recentRequestTimes.get(requestKey);
      if (previousTime !== undefined && now - previousTime < RECENT_REQUEST_TTL_MS) {
        return;
      }
      recentRequestTimes.set(requestKey, now);
      recentRequestTimes.forEach((handledAt, key) => {
        if (now - handledAt >= RECENT_REQUEST_TTL_MS) {
          recentRequestTimes.delete(key);
        }
      });
    }
    if (resolvePaused(paused)) {
      hasPendingRefresh.value = true;
      return;
    }
    hasPendingRefresh.value = false;
    // Legacy sample bridge events have no request identity. Keep their former
    // immediate/concurrent semantics; identified writes still use the shared
    // scheduler so duplicate local/SSE/storage notifications collapse safely.
    if (payload?.immediate && !requestKey) {
      try {
        Promise.resolve(refresh()).catch(() => {});
      } catch {
        // Refresh failures are surfaced by each page's own load state.
      }
      return;
    }
    runRefresh({ immediate: Boolean(payload?.immediate) });
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
    runRefresh({ immediate: true });
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
    requestRefresh,
    stop,
  };
}

export { useStorageSnapshotRefresh };
