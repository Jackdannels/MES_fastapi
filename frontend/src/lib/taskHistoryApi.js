import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

async function readErrorDetail(response) {
  try {
    const payload = await response.json();
    return typeof payload?.detail === "string" ? payload.detail.trim() : "";
  } catch (_error) {
    return "";
  }
}

async function throwApiError(response, message) {
  const detail = await readErrorDetail(response);
  const suffix = detail ? `，${detail}` : "";
  throw new Error(`${message}: ${response.status} ${response.statusText}${suffix}`);
}

const appendParam = (params, key, value) => {
  const text = String(value ?? "").trim();
  if (text) {
    params.set(key, text);
  }
};

async function readTaskHistoryPage(options = {}) {
  const params = new URLSearchParams();
  params.set("page", String(Number(options.page) > 0 ? Number(options.page) : 1));
  params.set("pageSize", String(Number(options.pageSize) > 0 ? Number(options.pageSize) : 8));
  appendParam(params, "query", options.query);
  appendParam(params, "days", options.days);

  const response = await fetch(buildApiUrl(`/api/task-history?${params.toString()}`, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    await throwApiError(response, "Failed to read task history");
  }
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : {};
}

export { readTaskHistoryPage };
