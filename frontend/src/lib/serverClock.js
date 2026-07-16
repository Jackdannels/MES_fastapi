import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();
const DEFAULT_SYNC_INTERVAL_MS = 60 * 1000;
const SYNC_REQUEST_TIMEOUT_MS = 5 * 1000;

let anchorServerTimeMs = null;
let anchorMonotonicTimeMs = null;
let syncTimer = null;
let pendingSync = null;

const monotonicNow = () => (
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now()
);

function serverNowMs() {
  if (Number.isFinite(anchorServerTimeMs) && Number.isFinite(anchorMonotonicTimeMs)) {
    return anchorServerTimeMs + Math.max(0, monotonicNow() - anchorMonotonicTimeMs);
  }
  return Date.now();
}

function serverNowDate() {
  return new Date(serverNowMs());
}

async function syncServerClock() {
  if (pendingSync) {
    return pendingSync;
  }
  pendingSync = (async () => {
    const requestStartedAt = monotonicNow();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutId = setTimeout(() => controller?.abort(), SYNC_REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(buildApiUrl("/api/system/time", API_BASE_URL), {
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      throw new Error(`Failed to synchronize server time: ${response.status} ${response.statusText}`);
    }
    const payload = await response.json();
    const serverTimeMs = Number(payload?.epochMs);
    if (!Number.isFinite(serverTimeMs)) {
      throw new Error("Failed to synchronize server time: invalid server timestamp");
    }
    const responseReceivedAt = monotonicNow();
    anchorServerTimeMs = serverTimeMs + Math.max(0, responseReceivedAt - requestStartedAt) / 2;
    anchorMonotonicTimeMs = responseReceivedAt;
    return {
      ...payload,
      synchronized: true,
    };
  })().finally(() => {
    pendingSync = null;
  });
  return pendingSync;
}

function startServerClockSync(intervalMs = DEFAULT_SYNC_INTERVAL_MS) {
  if (typeof window === "undefined") {
    return;
  }
  if (syncTimer !== null) {
    window.clearInterval(syncTimer);
  }
  syncTimer = window.setInterval(() => {
    void syncServerClock().catch(() => {});
  }, Math.max(10_000, Number(intervalMs) || DEFAULT_SYNC_INTERVAL_MS));
}

function stopServerClockSync() {
  if (typeof window !== "undefined" && syncTimer !== null) {
    window.clearInterval(syncTimer);
  }
  syncTimer = null;
}

export {
  serverNowDate,
  serverNowMs,
  startServerClockSync,
  stopServerClockSync,
  syncServerClock,
};
