/* FILE: storage.js
 * Thin wrapper around localStorage with safe JSON parsing.
 */
// Keys used for persistence.
const STORAGE_KEYS = {
  tasks: "mes.tasks",
  schedules: "mes.schedules",
  samples: "mes.samples",
  devices: "mes.devices",
  streams: "mes.streams",
  conflicts: "mes.conflicts",
};

const memoryStore = {};
const pendingWrites = new Map();
const REMOTE_STORAGE_BASE = "/api/storage";
let remoteEnabled = false;
let remoteReady = false;
let remoteInitPromise = null;
let flushTimer = null;

function safeJsonParse(raw, fallback) {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function queueRemoteWrite(key, value) {
  pendingWrites.set(key, value);
  if (flushTimer) {
    return;
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushRemoteWrites();
  }, 300);
}

async function flushRemoteWrites() {
  if (!pendingWrites.size) {
    return;
  }
  const entries = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  await Promise.all(
    entries.map(async ([key, value]) => {
      try {
        const response = await fetch(`${REMOTE_STORAGE_BASE}/${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(value),
        });
        if (!response.ok) {
          pendingWrites.set(key, value);
        }
      } catch {
        pendingWrites.set(key, value);
      }
    })
  );
  if (pendingWrites.size && !flushTimer) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      flushRemoteWrites();
    }, 1000);
  }
}

async function initRemoteStore() {
  if (remoteInitPromise) {
    return remoteInitPromise;
  }
  remoteInitPromise = fetch(REMOTE_STORAGE_BASE, {
    headers: { Accept: "application/json" },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Remote store unavailable");
      }
      return response.json();
    })
    .then((payload) => {
      if (payload && typeof payload === "object") {
        Object.keys(payload).forEach((key) => {
          memoryStore[key] = payload[key];
        });
        remoteEnabled = true;
      }
    })
    .catch(() => {
      remoteEnabled = false;
    })
    .finally(() => {
      remoteReady = true;
    });
  return remoteInitPromise;
}

function isRemoteStoreEnabled() {
  return remoteEnabled;
}

function isRemoteStoreReady() {
  return remoteReady;
}

// Safe JSON load with fallback to in-memory cache.
function loadStore(key, fallback) {
  if (remoteEnabled) {
    if (Object.prototype.hasOwnProperty.call(memoryStore, key)) {
      return memoryStore[key];
    }
    return fallback;
  }
  try {
    return safeJsonParse(localStorage.getItem(key), fallback);
  } catch {
    return memoryStore[key] || fallback;
  }
}

// Save JSON to localStorage with memory fallback.
function saveStore(key, value) {
  if (remoteEnabled) {
    memoryStore[key] = value;
    queueRemoteWrite(key, value);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    memoryStore[key] = value;
  }
}

export { STORAGE_KEYS, initRemoteStore, isRemoteStoreEnabled, isRemoteStoreReady, loadStore, saveStore };
