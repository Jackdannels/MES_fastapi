import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

async function readErrorDetail(response) {
  try {
    const payload = await response.json();
    return String(payload?.detail || "").trim();
  } catch (_error) {
    return "";
  }
}

async function readSamplePage(options = {}) {
  const params = new URLSearchParams();
  params.set("page", String(Number(options.page) > 0 ? Number(options.page) : 1));
  params.set("pageSize", String(Number(options.pageSize) > 0 ? Number(options.pageSize) : 8));
  [
    ["query", options.query],
    ["taskCode", options.taskCode],
    ["status", options.status],
    ["sortKey", options.sortKey],
    ["sortDirection", options.sortDirection],
    ["view", options.view],
  ].forEach(([key, value]) => {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      params.set(key, normalized);
    }
  });
  const response = await fetch(buildApiUrl(`/api/samples/page?${params.toString()}`, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to read sample page: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : {};
}

async function readSampleDetail(sampleIdentifier) {
  const response = await fetch(buildApiUrl(`/api/samples/${encodeURIComponent(sampleIdentifier)}`, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to read sample detail: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : {};
}

export { readSampleDetail, readSamplePage };
