import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

async function readTasks(options = {}) {
  const includeArchived = Boolean(options?.includeArchived);
  const path = includeArchived ? "/api/tasks?includeArchived=true" : "/api/tasks";
  const response = await fetch(buildApiUrl(path, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to read tasks: ${response.status} ${response.statusText}`);
  }
  const tasks = await response.json();
  return Array.isArray(tasks) ? tasks : [];
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
    throw new Error(`Failed to create task: ${response.status} ${response.statusText}`);
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
    throw new Error(`Failed to update task ${taskId}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function deleteTask(taskId) {
  const response = await fetch(buildApiUrl(`/api/tasks/${taskId}`, API_BASE_URL), {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to delete task ${taskId}: ${response.status} ${response.statusText}`);
  }
}

async function resetTasks() {
  const response = await fetch(buildApiUrl("/api/tasks/reset", API_BASE_URL), {
    method: "POST",
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to reset tasks: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export { createTask, deleteTask, readTasks, resetTasks, updateTask };
