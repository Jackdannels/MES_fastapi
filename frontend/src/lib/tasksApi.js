import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";
import { requestTaskAdminAction } from "./taskAdminAuth";
import { localizeResponseMessage } from "./responseMessages";

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
  const error = new Error(localizeResponseMessage(detail || message, `请求失败（${response.status}），请稍后重试`));
  error.status = response.status;
  throw error;
}

const taskAdminHeaders = (admin) => ({
  "X-Admin-Username": encodeURIComponent(admin.adminUsername),
  "X-Admin-Password": encodeURIComponent(admin.adminPassword),
});

function writeTaskWithAdmin(action, path, { body, method }) {
  // 在认证弹窗打开前固定本次请求内容，避免等待认证时修改了另一份任务。
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  return requestTaskAdminAction(action, async (admin) => {
    const response = await fetch(buildApiUrl(path, API_BASE_URL), {
      method,
      headers: {
        Accept: "application/json",
        ...(serializedBody === undefined ? {} : { "Content-Type": "application/json" }),
        ...taskAdminHeaders(admin),
      },
      credentials: "include",
      ...(serializedBody === undefined ? {} : { body: serializedBody }),
    });
    if (!response.ok) await throwApiError(response, `${action}失败`);
    return method === "DELETE" ? undefined : response.json();
  });
}

async function readTasks(options = {}) {
  const includeArchived = Boolean(options?.includeArchived);
  const path = includeArchived ? "/api/tasks?includeArchived=true" : "/api/tasks";
  const response = await fetch(buildApiUrl(path, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    await throwApiError(response, "Failed to read tasks");
  }
  const tasks = await response.json();
  return Array.isArray(tasks) ? tasks : [];
}

async function readTaskPage(options = {}) {
  const params = new URLSearchParams();
  params.set("page", String(Number(options.page) > 0 ? Number(options.page) : 1));
  params.set("pageSize", String(Number(options.pageSize) > 0 ? Number(options.pageSize) : 8));
  const query = String(options.query ?? "").trim();
  if (query) {
    params.set("query", query);
  }
  [
    ["status", options.status],
    ["testType", options.testType],
    ["sortKey", options.sortKey],
    ["sortDirection", options.sortDirection],
  ].forEach(([key, value]) => {
    const text = String(value ?? "").trim();
    if (text) {
      params.set(key, text);
    }
  });
  const response = await fetch(buildApiUrl(`/api/tasks/page?${params.toString()}`, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    await throwApiError(response, "Failed to read task page");
  }
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : {};
}

async function readTaskDetail(taskId) {
  const response = await fetch(buildApiUrl(`/api/tasks/${encodeURIComponent(taskId)}`, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    await throwApiError(response, `Failed to read task ${taskId}`);
  }
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : {};
}

async function readNextTaskCode(reference = "") {
  const params = new URLSearchParams();
  const normalizedReference = String(reference ?? "").trim();
  if (normalizedReference) {
    params.set("reference", normalizedReference);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(buildApiUrl(`/api/tasks/next-code${suffix}`, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    await throwApiError(response, "Failed to read next task code");
  }
  const payload = await response.json();
  return String(payload?.code ?? "").trim();
}

async function createTask(task) {
  return writeTaskWithAdmin(`确认新增任务 ${task?.code || ""}`, "/api/tasks", { method: "POST", body: task ?? {} });
}

async function readExternalTaskIntakes(options = {}) {
  const status = String(options?.status ?? "pending").trim();
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const response = await fetch(buildApiUrl(`/api/tasks/external-intakes${query}`, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    await throwApiError(response, "Failed to read external task intakes");
  }
  const intakes = await response.json();
  return Array.isArray(intakes) ? intakes : [];
}

async function acceptExternalTaskIntake(intakeId) {
  return writeTaskWithAdmin(`确认受理外部任务 ${intakeId}`, `/api/tasks/external-intakes/${encodeURIComponent(intakeId)}/accept`, { method: "POST" });
}

async function updateTask(taskId, task) {
  return writeTaskWithAdmin(`保存任务修改 ${task?.code || taskId}`, `/api/tasks/${encodeURIComponent(taskId)}`, { method: "PUT", body: task ?? {} });
}

async function deleteTask(taskId) {
  return writeTaskWithAdmin(`删除任务 ${taskId}`, `/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

async function resetTasks() {
  const response = await fetch(buildApiUrl("/api/tasks/reset", API_BASE_URL), {
    method: "POST",
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    await throwApiError(response, "Failed to reset tasks");
  }
  return response.json();
}

export {
  acceptExternalTaskIntake,
  createTask,
  deleteTask,
  readExternalTaskIntakes,
  readNextTaskCode,
  readTaskDetail,
  readTaskPage,
  readTasks,
  resetTasks,
  updateTask,
};
