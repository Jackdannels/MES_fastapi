import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

const readErrorMessage = async (response) => {
  const payload = await response.json().catch(() => null);
  return payload?.detail || payload?.message || `请求失败（${response.status}）`;
};

const requestJson = async (path, options = {}, failureMessage = "请求试验数据接口失败") => {
  const response = await fetch(buildApiUrl(path, API_BASE_URL), {
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    credentials: "include",
    ...options,
  });
  if (!response.ok) {
    throw new Error(`${failureMessage}：${await readErrorMessage(response)}`);
  }
  return response.json();
};

function readTestDataSettings() {
  return requestJson("/api/test-data/settings", {}, "读取试验数据保存设置失败");
}

function updateTestDataSettings(savePath) {
  return requestJson("/api/test-data/settings", {
    method: "PUT",
    body: JSON.stringify({ savePath: String(savePath || "").trim() }),
  }, "保存地址检测失败");
}

function listFailedTestDataExports() {
  return requestJson("/api/test-data/exports?status=failed", {}, "读取 PDF 失败记录失败");
}

function retryFailedTestDataExports(exportKeys) {
  const keys = Array.isArray(exportKeys) ? exportKeys.map((key) => String(key || "").trim()).filter(Boolean) : [];
  return requestJson("/api/test-data/retry-failed", {
    method: "POST",
    body: JSON.stringify(keys.length ? { exportKeys: keys } : {}),
  }, "重新生成 PDF 失败");
}

export {
  listFailedTestDataExports,
  readTestDataSettings,
  retryFailedTestDataExports,
  updateTestDataSettings,
};
