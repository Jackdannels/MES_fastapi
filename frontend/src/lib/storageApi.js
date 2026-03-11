import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

function parseJson(raw, fallback) {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readLocalArray(key) {
  if (typeof window === "undefined") {
    return [];
  }
  const parsed = parseJson(window.localStorage.getItem(key), []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeLocalArray(key, value) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore local storage errors and keep the in-memory caller state.
  }
}

async function readStorageSnapshot(keys) {
  const requestedKeys = Array.isArray(keys) ? keys : [];
  const snapshot = Object.fromEntries(requestedKeys.map((key) => [key, readLocalArray(key)]));

  try {
    const response = await fetch(buildApiUrl("/api/storage", API_BASE_URL), {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!response.ok) {
      return snapshot;
    }
    const payload = await response.json();
    requestedKeys.forEach((key) => {
      if (Array.isArray(payload?.[key])) {
        snapshot[key] = payload[key];
      }
    });
  } catch {
    // Keep local fallback when remote storage is unavailable.
  }

  return snapshot;
}

async function writeStorageUpdates(updates) {
  const payload = updates && typeof updates === "object" ? updates : {};
  Object.entries(payload).forEach(([key, value]) => {
    writeLocalArray(key, value);
  });

  try {
    await fetch(buildApiUrl("/api/storage", API_BASE_URL), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });
  } catch {
    // Local fallback is already written.
  }
}

export { readLocalArray, readStorageSnapshot, writeLocalArray, writeStorageUpdates };
