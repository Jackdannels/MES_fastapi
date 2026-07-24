import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

async function postLaboratoryMqCommand(path, payload) {
  const response = await fetch(buildApiUrl(path, API_BASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const detail = String(errorPayload?.detail || "").trim();
    throw new Error(`Failed to publish laboratory MQ command: ${detail || `${response.status} ${response.statusText}`}`);
  }
  const result = await response.json();
  if (result?.published === false) {
    throw new Error(`Failed to publish laboratory MQ command: ${result.reason || "not_published"}`);
  }
  return result;
}

const publishLaboratoryFixtureInstall = (payload) =>
  postLaboratoryMqCommand("/api/mq/laboratory/fixture-install", payload);

const publishLaboratoryReady = (payload) =>
  postLaboratoryMqCommand("/api/mq/laboratory/ready", payload);

const publishLaboratoryEndRequest = (payload) =>
  postLaboratoryMqCommand("/api/mq/laboratory/end-request", payload);

export { publishLaboratoryEndRequest, publishLaboratoryFixtureInstall, publishLaboratoryReady };
