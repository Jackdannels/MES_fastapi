import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";
import { formatLocalDateTime } from "./dateTime.js";

const API_BASE_URL = getFrontendApiBaseUrl();
const SNAPSHOT_UPDATED_STORAGE_KEY = "mes:snapshot-updated-at";
const SNAPSHOT_UPDATED_EVENT = "mes:snapshot-updated";
const STORAGE_EVENTS_ENDPOINT = buildApiUrl("/api/storage/events", API_BASE_URL);

function readLocalArray(key) {
  void key;
  return [];
}

function writeLocalArray(key, value) {
  void key;
  void value;
}

async function readStorageSnapshot(keys) {
  const requestedKeys = Array.isArray(keys) ? keys : [];
  const response = await fetch(buildApiUrl("/api/storage", API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to read storage snapshot: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return Object.fromEntries(
    requestedKeys.map((key) => [key, Array.isArray(payload?.[key]) ? payload[key] : []]),
  );
}

async function writeStorageUpdates(updates) {
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
  readLocalArray,
  readStorageSnapshot,
  subscribeStorageSnapshotUpdates,
  writeLocalArray,
  writeStorageUpdates,
};
