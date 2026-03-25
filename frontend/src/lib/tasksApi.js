import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();
const TASKS_KEY = "mes.tasks";

function parseJson(raw, fallback) {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readLocalTasks() {
  if (typeof window === "undefined") {
    return [];
  }
  const parsed = parseJson(window.localStorage.getItem(TASKS_KEY), []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeLocalTasks(tasks) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(TASKS_KEY, JSON.stringify(Array.isArray(tasks) ? tasks : []));
  } catch {
    // Keep caller state in memory when local storage is unavailable.
  }
}

async function readTasks() {
  const fallback = readLocalTasks();
  try {
    const response = await fetch(buildApiUrl("/api/tasks", API_BASE_URL), {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!response.ok) {
      return fallback;
    }
    const tasks = await response.json();
    const normalized = Array.isArray(tasks) ? tasks : [];
    writeLocalTasks(normalized);
    return normalized;
  } catch {
    return fallback;
  }
}

async function createTask(task) {
  const fallbackTask = task ?? {};
  let createdTask = fallbackTask;
  try {
    const response = await fetch(buildApiUrl("/api/tasks", API_BASE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify(fallbackTask),
    });
    if (response.ok) {
      createdTask = await response.json();
    }
  } catch {
    createdTask = fallbackTask;
  }
  const cachedTasks = readLocalTasks();
  writeLocalTasks([createdTask, ...cachedTasks.filter((item) => item?.code !== createdTask?.code)]);
  return createdTask;
}

async function updateTask(taskId, task) {
  const fallbackTask = task ?? {};
  let updatedTask = fallbackTask;
  try {
    const response = await fetch(buildApiUrl(`/api/tasks/${taskId}`, API_BASE_URL), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify(fallbackTask),
    });
    if (response.ok) {
      updatedTask = await response.json();
    }
  } catch {
    updatedTask = fallbackTask;
  }
  const cachedTasks = readLocalTasks();
  writeLocalTasks(
    cachedTasks.map((item) => {
      if (item?.id === taskId || item?.code === taskId) {
        return updatedTask;
      }
      return item;
    }),
  );
  return updatedTask;
}

async function deleteTask(taskId) {
  try {
    const response = await fetch(buildApiUrl(`/api/tasks/${taskId}`, API_BASE_URL), {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Failed to delete task ${taskId}`);
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(`Failed to delete task ${taskId}`);
  }
  const cachedTasks = readLocalTasks();
  writeLocalTasks(cachedTasks.filter((item) => item?.id !== taskId && item?.code !== taskId));
}

export { createTask, deleteTask, readTasks, updateTask };
