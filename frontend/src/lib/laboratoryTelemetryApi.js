import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

async function listLaboratoryTelemetry() {
  const response = await fetch(buildApiUrl("/api/telemetry/laboratories", API_BASE_URL), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to load laboratory telemetry: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

export { listLaboratoryTelemetry };
