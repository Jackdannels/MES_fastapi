import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";
import { STORAGE_KEYS } from "./storageKeys";

const API_BASE_URL = getFrontendApiBaseUrl();

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
    throw new Error(`Failed to read storage snapshot (${response.status})`);
  }
  const payload = await response.json();
  return Object.fromEntries(requestedKeys.map((key) => {
    const value = payload?.[key];
    return [key, Array.isArray(value) ? value : []];
  }));
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
    throw new Error(`Failed to write storage updates (${response.status})`);
  }
}

export { readLocalArray, readStorageSnapshot, writeLocalArray, writeStorageUpdates };
