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
  const payload = task ?? {};
  const response = await fetch(buildApiUrl("/api/tasks", API_BASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    await throwApiError(response, "Failed to create task");
  }
  return response.json();
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
  const response = await fetch(buildApiUrl(`/api/tasks/external-intakes/${encodeURIComponent(intakeId)}/accept`, API_BASE_URL), {
    method: "POST",
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    await throwApiError(response, `Failed to accept external task intake ${intakeId}`);
  }
  return response.json();
}

async function updateTask(taskId, task) {
  const payload = task ?? {};
  const response = await fetch(buildApiUrl(`/api/tasks/${taskId}`, API_BASE_URL), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    await throwApiError(response, `Failed to update task ${taskId}`);
  }
  return response.json();
}

async function deleteTask(taskId) {
  const response = await fetch(buildApiUrl(`/api/tasks/${taskId}`, API_BASE_URL), {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    await throwApiError(response, `Failed to delete task ${taskId}`);
  }
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
