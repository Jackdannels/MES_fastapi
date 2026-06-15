import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";
import { formatLocalDateTime } from "./dateTime.js";

const API_BASE_URL = getFrontendApiBaseUrl();
const SNAPSHOT_UPDATED_STORAGE_KEY = "mes:snapshot-updated-at";
const SNAPSHOT_UPDATED_EVENT = "mes:snapshot-updated";
const STORAGE_EVENTS_ENDPOINT = buildApiUrl("/api/storage/events", API_BASE_URL);
const pendingSnapshotReads = new Map();

function fetchStorageSnapshot() {
  return fetch(buildApiUrl("/api/storage", API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to read storage snapshot: ${response.status} ${response.statusText}`);
    }
    return response.json();
  });
}

function readStorageSnapshot(keys, options = {}) {
  const requestedKeys = Array.isArray(keys) ? keys : [];
  const normalizeMissing = options.normalizeMissing !== false;
  const requestKey = JSON.stringify([...new Set(requestedKeys)].sort());
  if (!pendingSnapshotReads.has(requestKey)) {
    const pendingRead = fetchStorageSnapshot().then(
      (payload) => {
        pendingSnapshotReads.delete(requestKey);
        return payload;
      },
      (error) => {
        pendingSnapshotReads.delete(requestKey);
        throw error;
      },
    );
    pendingSnapshotReads.set(requestKey, pendingRead);
  }
  return pendingSnapshotReads.get(requestKey).then((payload) =>
    Object.fromEntries(
      requestedKeys.map((key) => [
        key,
        Array.isArray(payload?.[key]) || !normalizeMissing ? payload?.[key] : [],
      ]),
    ),
  );
}

async function writeStorageUpdates(updates) {
  pendingSnapshotReads.clear();
  const rawPayload = updates && typeof updates === "object" ? updates : {};
  const payload = Object.fromEntries(Object.entries(rawPayload));
  const response = await fetch(buildApiUrl("/api/storage", API_BASE_URL), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = String(payload?.detail || payload?.message || "").trim();
    } catch {
      detail = "";
    }
    const suffix = detail ? `，${detail}` : "";
    throw new Error(`Failed to write storage updates: ${response.status} ${response.statusText}${suffix}`);
  }
  notifyStorageSnapshotUpdated(payload);
}

function notifyStorageSnapshotUpdated(updates = {}) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  const marker = JSON.stringify({
    keys: Object.keys(updates || {}),
    updatedAt: formatLocalDateTime(),
  });
  let detail = null;
  try {
    window.localStorage.setItem(SNAPSHOT_UPDATED_STORAGE_KEY, marker);
    detail = JSON.parse(marker);
  } catch {
    // localStorage may be unavailable in private or embedded browser contexts.
    detail = {
      keys: Object.keys(updates || {}),
      updatedAt: formatLocalDateTime(),
    };
  }
  try {
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail }));
  } catch {
    // CustomEvent may be unavailable in older embedded browser contexts.
  }
}

function subscribeStorageSnapshotUpdates(listener) {
  if (typeof window === "undefined" || typeof window.EventSource !== "function" || typeof listener !== "function") {
    return () => {};
  }
  const source = new window.EventSource(STORAGE_EVENTS_ENDPOINT, { withCredentials: true });
  source.addEventListener("message", (event) => {
    try {
      listener(JSON.parse(String(event?.data || "{}")));
    } catch {
      listener({});
    }
  });
  source.addEventListener("error", () => {
    // EventSource reconnects automatically; page-level handlers keep the last good snapshot until then.
  });
  return () => {
    source.close();
  };
}

export {
  SNAPSHOT_UPDATED_EVENT,
  SNAPSHOT_UPDATED_STORAGE_KEY,
  notifyStorageSnapshotUpdated,
  readStorageSnapshot,
  subscribeStorageSnapshotUpdates,
  writeStorageUpdates,
};
