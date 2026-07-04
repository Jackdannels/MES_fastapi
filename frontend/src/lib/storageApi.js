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

async function writeStorageUpdates(updates, options = {}) {
  pendingSnapshotReads.clear();
  const rawPayload = updates && typeof updates === "object" ? updates : {};
  const payload = Object.fromEntries(Object.entries(rawPayload));
  const source = String(options?.source || "").trim();
  const requestId = String(options?.requestId || "").trim();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (source) {
    headers["X-MES-Update-Source"] = source;
  }
  if (requestId) {
    headers["X-MES-Update-Request-Id"] = requestId;
  }
  const response = await fetch(buildApiUrl("/api/storage", API_BASE_URL), {
    method: "PUT",
    headers,
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
  notifyStorageSnapshotUpdated(payload, { source, requestId });
}

function normalizeSegment(value, fallback = "") {
  const text = String(value || "").trim() || fallback;
  return encodeURIComponent(text);
}

function storageTrayActionEndpoint(action = {}) {
  const mode = String(action?.mode || "").trim();
  const room = normalizeSegment(action?.room, "staging");
  const trayCode = normalizeSegment(action?.trayCode || action?.tray_code);
  const actionName = mode === "manufacturerReturn"
    ? "manufacturer-return"
    : mode === "stockIn"
      ? "stock-in"
      : "stock-out";
  return buildApiUrl(`/api/storage/rooms/${room}/trays/${trayCode}/${actionName}`, API_BASE_URL);
}

function storageTrayActionBody(action = {}) {
  const mode = String(action?.mode || "").trim();
  const excludedKeys = new Set(["mode", "room", "trayCode", "tray_code"]);
  if (mode === "manufacturerReturn") {
    return Object.fromEntries(
      Object.entries(action || {}).filter(([key, value]) => !excludedKeys.has(key) && value !== undefined),
    );
  }
  return Object.fromEntries(
    Object.entries(action || {}).filter(([key, value]) => !excludedKeys.has(key) && value !== undefined),
  );
}

async function writeStorageTrayAction(action, options = {}) {
  pendingSnapshotReads.clear();
  const source = String(options?.source || "").trim();
  const requestId = String(options?.requestId || "").trim();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (source) {
    headers["X-MES-Update-Source"] = source;
  }
  if (requestId) {
    headers["X-MES-Update-Request-Id"] = requestId;
  }
  const response = await fetch(storageTrayActionEndpoint(action), {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(storageTrayActionBody(action)),
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
    throw new Error(`Failed to write storage tray action: ${response.status} ${response.statusText}${suffix}`);
  }
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  const updatedKeys = Array.isArray(payload?.updatedKeys) && payload.updatedKeys.length
    ? payload.updatedKeys
    : ["mes.samples", "mes.staging_events"];
  notifyStorageSnapshotUpdated(Object.fromEntries(updatedKeys.map((key) => [key, true])), { source, requestId });
  return payload;
}

async function writeStorageSchedulePatch(patch, options = {}) {
  pendingSnapshotReads.clear();
  const source = String(options?.source || "").trim();
  const requestId = String(options?.requestId || "").trim();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (source) {
    headers["X-MES-Update-Source"] = source;
  }
  if (requestId) {
    headers["X-MES-Update-Request-Id"] = requestId;
  }
  const response = await fetch(buildApiUrl("/api/storage/schedules/patch", API_BASE_URL), {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(patch && typeof patch === "object" ? patch : {}),
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
    throw new Error(`Failed to write storage schedule patch: ${response.status} ${response.statusText}${suffix}`);
  }
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  const updatedKeys = Array.isArray(payload?.updatedKeys) && payload.updatedKeys.length
    ? payload.updatedKeys
    : ["mes.experiments", "mes.schedules", "mes.streams", "mes.tasks"];
  notifyStorageSnapshotUpdated(Object.fromEntries(updatedKeys.map((key) => [key, true])), { source, requestId });
  return payload;
}

function notifyStorageSnapshotUpdated(updates = {}, options = {}) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  const source = String(options?.source || "").trim();
  const requestId = String(options?.requestId || "").trim();
  const reason = String(options?.reason || "").trim();
  const marker = JSON.stringify({
    keys: Object.keys(updates || {}),
    ...(source ? { source } : {}),
    ...(requestId ? { requestId } : {}),
    ...(reason ? { reason } : {}),
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
      ...(source ? { source } : {}),
      ...(requestId ? { requestId } : {}),
      ...(reason ? { reason } : {}),
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
  writeStorageSchedulePatch,
  writeStorageTrayAction,
  writeStorageUpdates,
};
