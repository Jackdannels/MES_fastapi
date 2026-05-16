import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

async function readJsonArray(path, message) {
  const response = await fetch(buildApiUrl(path, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`${message}: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

async function readMasterTestTypes() {
  return readJsonArray("/api/master/test-types", "Failed to read master test types");
}

async function readMasterLabs() {
  return readJsonArray("/api/master/labs", "Failed to read master labs");
}

export { readMasterLabs, readMasterTestTypes };
