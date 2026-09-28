import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

async function backupRequest(path, method = "GET", backupPath) {
  const response = await fetch(buildApiUrl(`/api/test-data/${path}`, getFrontendApiBaseUrl()), {
    method,
    credentials: "include",
    headers: { Accept: "application/json", ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
    ...(method === "GET" ? {} : { body: JSON.stringify({ backupPath: String(backupPath || "").trim() }) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(typeof payload?.detail === "string" ? payload.detail : `备份请求失败（${response.status}）`);
    error.probe = payload?.probe;
    throw error;
  }
  return payload;
}

export const readBackupStatus = () => backupRequest("backup-status");
export const checkBackupPath = (path) => backupRequest("backup-check", "POST", path);
export const saveBackupPath = (path) => backupRequest("backup-settings", "PUT", path);
export const selectBackupDirectory = (path) => backupRequest("backup-select-directory", "POST", path);
