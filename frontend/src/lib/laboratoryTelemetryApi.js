import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

async function readLaboratoryTelemetrySnapshot({ signal } = {}) {
  const response = await fetch(buildApiUrl("/api/telemetry/laboratories", API_BASE_URL), {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to load laboratory telemetry: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return { items: Array.isArray(payload?.items) ? payload.items : [], monitorStatus: payload?.monitor_status || "online", monitorMessage: payload?.monitor_message || "" };
}

async function listLaboratoryTelemetry(options) {
  return (await readLaboratoryTelemetrySnapshot(options)).items;
}
export { listLaboratoryTelemetry, readLaboratoryTelemetrySnapshot };
