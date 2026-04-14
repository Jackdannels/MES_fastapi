import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

async function readTasks() {
  const response = await fetch(buildApiUrl("/api/tasks", API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to read tasks (${response.status})`);
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
    throw new Error(`Failed to create task (${response.status})`);
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
    throw new Error(`Failed to update task ${taskId} (${response.status})`);
  }
  return response.json();
}

async function deleteTask(taskId) {
  const response = await fetch(buildApiUrl(`/api/tasks/${taskId}`, API_BASE_URL), {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to delete task ${taskId}`);
  }
}

export { createTask, deleteTask, readTasks, updateTask };
