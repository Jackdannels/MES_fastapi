import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";
import { formatLocalDateTime } from "./dateTime.js";
import { normalizeTrayScanCode } from "./trayQrCode.js";
import { performanceNow, recordPerformanceMetric } from "./performanceMonitor.js";

const API_BASE_URL = getFrontendApiBaseUrl();
const SNAPSHOT_UPDATED_STORAGE_KEY = "mes:snapshot-updated-at";
const SNAPSHOT_UPDATED_EVENT = "mes:snapshot-updated";
const STORAGE_EVENTS_ENDPOINT = buildApiUrl("/api/storage/events", API_BASE_URL);
const queuedSnapshotReadKeys = new Set();
const queuedSnapshotReads = [];
let snapshotReadBatchScheduled = false;
const storageUpdateListeners = new Set();
let storageEventSource = null;
let storageEventSourceOpened = false;

function dispatchRemoteStorageUpdate(payload) {
  storageUpdateListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
      // One page listener must not prevent the remaining subscribers from refreshing.
    }
  });
}

function ensureStorageEventSource() {
  if (storageEventSource || typeof window === "undefined" || typeof window.EventSource !== "function") {
    return;
  }
  storageEventSource = new window.EventSource(STORAGE_EVENTS_ENDPOINT, { withCredentials: true });
  storageEventSourceOpened = false;
  storageEventSource.addEventListener("open", () => {
    if (storageEventSourceOpened) {
      dispatchRemoteStorageUpdate({ keys: [], reason: "reconnect", reconnected: true });
    }
    storageEventSourceOpened = true;
  });
  storageEventSource.addEventListener("message", (event) => {
    try {
      dispatchRemoteStorageUpdate(JSON.parse(String(event?.data || "{}")));
    } catch {
      dispatchRemoteStorageUpdate({});
    }
  });
  storageEventSource.addEventListener("error", () => {
    // EventSource reconnects automatically; page-level handlers keep the last good snapshot until then.
  });
}

async function fetchStorageSnapshot(keys = []) {
  const requestedKeys = Array.from(new Set((Array.isArray(keys) ? keys : []).filter(Boolean))).sort();
  const query = requestedKeys.length ? `?keys=${encodeURIComponent(requestedKeys.join(","))}` : "";
  const requestStartedAt = performanceNow();
  let response;
  try {
    response = await fetch(buildApiUrl(`/api/storage${query}`, API_BASE_URL), {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    recordPerformanceMetric("storage.snapshot-fetch", performanceNow() - requestStartedAt, {
      category: "network",
      dbQueryCount: Number(response.headers?.get?.("X-MES-DB-Queries")) || 0,
      keyCount: requestedKeys.length,
      readCacheStatus: response.headers?.get?.("X-MES-Read-Cache") || "",
      requestId: response.headers?.get?.("X-Request-ID") || "",
      responseBytes: Number(response.headers?.get?.("X-MES-Response-Bytes")) || 0,
      serverTiming: response.headers?.get?.("Server-Timing") || "",
      status: Number(response.status) || 0,
    });
    if (!response.ok) {
      throw new Error(`Failed to read storage snapshot: ${response.status} ${response.statusText}`);
    }
    const parseStartedAt = performanceNow();
    const payload = await response.json();
    recordPerformanceMetric("storage.snapshot-json-parse", performanceNow() - parseStartedAt, {
      category: "json",
      keyCount: requestedKeys.length,
      requestId: response.headers?.get?.("X-Request-ID") || "",
    });
    return payload;
  } catch (error) {
    if (!response) {
      recordPerformanceMetric("storage.snapshot-fetch", performanceNow() - requestStartedAt, {
        category: "network",
        failed: true,
        keyCount: requestedKeys.length,
      });
    }
    throw error;
  }
}

function projectSnapshot(payload, requestedKeys, normalizeMissing) {
  return Object.fromEntries(
    requestedKeys.map((key) => [
      key,
      Array.isArray(payload?.[key]) || !normalizeMissing ? payload?.[key] : [],
    ]),
  );
}

async function flushSnapshotReadBatch() {
  snapshotReadBatchScheduled = false;
  const batchRequests = queuedSnapshotReads.splice(0, queuedSnapshotReads.length);
  const batchKeys = Array.from(queuedSnapshotReadKeys);
  queuedSnapshotReadKeys.clear();
  if (!batchRequests.length) {
    return;
  }
  try {
    const payload = await fetchStorageSnapshot(batchKeys);
    batchRequests.forEach(({ normalizeMissing, requestedKeys, resolve }) => {
      resolve(projectSnapshot(payload, requestedKeys, normalizeMissing));
    });
  } catch (error) {
    batchRequests.forEach(({ reject }) => reject(error));
  }
}

function readStorageSnapshot(keys, options = {}) {
  const requestedKeys = Array.from(new Set(Array.isArray(keys) ? keys.filter(Boolean) : []));
  const normalizeMissing = options.normalizeMissing !== false;
  requestedKeys.forEach((key) => queuedSnapshotReadKeys.add(key));
  const result = new Promise((resolve, reject) => {
    queuedSnapshotReads.push({ normalizeMissing, reject, requestedKeys, resolve });
  });
  if (!snapshotReadBatchScheduled) {
    snapshotReadBatchScheduled = true;
    queueMicrotask(flushSnapshotReadBatch);
  }
  return result;
}

async function writeStorageUpdates(updates, options = {}) {
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
  const trayCode = normalizeSegment(normalizeTrayScanCode(action?.trayCode || action?.tray_code));
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

async function writeStorageRunningRepair(command, options = {}) {
  const deviceCode = String(command?.deviceCode || command?.device_code || "").trim();
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
  const response = await fetch(buildApiUrl(`/api/storage/devices/${encodeURIComponent(deviceCode)}/running-repair`, API_BASE_URL), {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({
      maintenanceNote: String(command?.maintenanceNote || command?.maintenance_note || "").trim(),
      maintenanceType: "维修",
      targets: Array.isArray(command?.targets) ? command.targets : [],
    }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = String(payload?.detail || payload?.message || "").trim();
    } catch {
      detail = "";
    }
    throw new Error(detail || `维修操作失败，请刷新后重试（${response.status || "网络异常"}）`);
  }
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  const updatedKeys = Array.isArray(payload?.updatedKeys) ? payload.updatedKeys : [];
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
  storageUpdateListeners.add(listener);
  ensureStorageEventSource();
  let subscribed = true;
  return () => {
    if (!subscribed) {
      return;
    }
    subscribed = false;
    storageUpdateListeners.delete(listener);
    if (storageUpdateListeners.size === 0 && storageEventSource) {
      storageEventSource.close();
      storageEventSource = null;
      storageEventSourceOpened = false;
    }
  };
}

export {
  SNAPSHOT_UPDATED_EVENT,
  SNAPSHOT_UPDATED_STORAGE_KEY,
  notifyStorageSnapshotUpdated,
  readStorageSnapshot,
  subscribeStorageSnapshotUpdates,
  writeStorageRunningRepair,
  writeStorageSchedulePatch,
  writeStorageTrayAction,
  writeStorageUpdates,
};
