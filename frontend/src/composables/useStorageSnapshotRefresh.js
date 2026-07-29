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

function normalizeUpdateVersion(payload) {
  const rawVersion = payload?.version ?? payload?.revision ?? payload?.sequence;
  if (rawVersion === undefined || rawVersion === null || rawVersion === "") {
    return null;
  }
  const version = Number(rawVersion);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function requestsFullRefresh(payload) {
  if (payload?.fullRefresh === true || payload?.reset === true || payload?.reconnected === true) {
    return true;
  }
  return /(?:reconnect|resync|version[-_ ]?gap)/i.test(String(payload?.reason || ""));
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
  let pendingRefreshRequested = false;
  let pendingFullRefresh = false;
  let lastUpdateVersion = null;
  const pendingRefreshKeys = new Set();
  const recentRequestTimes = new Map();

  const clearDebounceTimer = () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const queueRefreshKeys = (keys, fullRefresh = false) => {
    pendingRefreshRequested = true;
    pendingFullRefresh = pendingFullRefresh || fullRefresh;
    normalizeKeys(keys).forEach((key) => pendingRefreshKeys.add(key));
  };

  const consumeRefreshKeys = () => {
    const keys = pendingFullRefresh && watchedKeys.size
      ? Array.from(watchedKeys)
      : Array.from(pendingRefreshKeys);
    pendingRefreshRequested = false;
    pendingFullRefresh = false;
    pendingRefreshKeys.clear();
    return keys;
  };

  const executeRefresh = () => {
    if (stopped) {
      return;
    }
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }
    if (!pendingRefreshRequested) {
      return;
    }
    const refreshKeys = consumeRefreshKeys();
    refreshInFlight = true;
    const settleRefresh = () => {
      refreshInFlight = false;
      if ((!refreshQueued && !pendingRefreshRequested) || stopped) {
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
      Promise.resolve(refresh(refreshKeys)).then(settleRefresh, settleRefresh);
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
    clearDebounceTimer();
    executeRefresh();
  };

  const requestRefresh = (payload = {}) => {
    if (shouldIgnoreUpdate(payload, options)) {
      return;
    }
    const incomingKeys = normalizeKeys(payload?.keys);
    const updateVersion = normalizeUpdateVersion(payload);
    let fullRefresh = requestsFullRefresh(payload);
    if (updateVersion !== null) {
      if (lastUpdateVersion !== null && updateVersion !== lastUpdateVersion && updateVersion !== lastUpdateVersion + 1) {
        fullRefresh = true;
      }
      lastUpdateVersion = updateVersion;
    }
    if (!fullRefresh && !shouldRefreshForKeys(watchedKeys, incomingKeys)) {
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
    const refreshKeys = fullRefresh || incomingKeys.length === 0
      ? Array.from(watchedKeys)
      : watchedKeys.size
        ? incomingKeys.filter((key) => watchedKeys.has(key))
        : incomingKeys;
    queueRefreshKeys(refreshKeys, fullRefresh || incomingKeys.length === 0);
    if (resolvePaused(paused)) {
      hasPendingRefresh.value = true;
      return;
    }
    hasPendingRefresh.value = false;
    // Immediate bridge events skip debounce but still share the in-flight
    // scheduler, so an event burst can queue at most one follow-up refresh.
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
