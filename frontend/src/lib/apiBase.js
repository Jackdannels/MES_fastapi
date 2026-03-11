const DEFAULT_BACKEND_TARGET = "http://127.0.0.1:8000";

function normalizeApiBaseUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\/+$/, "");
}

function buildApiUrl(path, baseUrl = "") {
  const normalizedPath = String(path || "").trim() || "/";
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);

  if (!normalizedBaseUrl) {
    return normalizedPath;
  }
  return `${normalizedBaseUrl}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}

function getFrontendApiBaseUrl() {
  return normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL || "");
}

function resolveBackendTarget(baseUrl, fallback = DEFAULT_BACKEND_TARGET) {
  return normalizeApiBaseUrl(baseUrl) || fallback;
}

export { DEFAULT_BACKEND_TARGET, buildApiUrl, getFrontendApiBaseUrl, normalizeApiBaseUrl, resolveBackendTarget };
