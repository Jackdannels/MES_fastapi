import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase";

const API_BASE_URL = getFrontendApiBaseUrl();

async function syncHostInterfaceMode(mode) {
  const response = await fetch(buildApiUrl("/api/mq/interface-mode", API_BASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ mode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || `接口模式切换失败：${response.status} ${response.statusText}`);
  }
  return payload;
}

export { syncHostInterfaceMode };
