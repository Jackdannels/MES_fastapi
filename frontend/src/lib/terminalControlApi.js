import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

const requestJson = async (path, options = {}) => {
  const response = await fetch(buildApiUrl(path, API_BASE_URL), {
    credentials: "include",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.detail || `请求失败（${response.status}）`);
  }
  return payload;
};

const reportTerminalPage = (path, title) => requestJson("/api/terminal-control/page", {
  method: "POST",
  body: JSON.stringify({ path, title }),
});

export { reportTerminalPage };
