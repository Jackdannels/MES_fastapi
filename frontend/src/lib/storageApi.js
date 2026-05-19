import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

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
}

export { readLocalArray, readStorageSnapshot, writeLocalArray, writeStorageUpdates };
