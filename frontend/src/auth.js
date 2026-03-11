import { buildApiUrl, getFrontendApiBaseUrl } from "./lib/apiBase.js";

const AUTH_STORAGE_KEY = "mes_auth_session_v1";

const MODULE_ROUTES = {
  central: "/",
  visual: "/visualization",
  staging: "/staging-management",
};

const VALID_MODULES = new Set(Object.keys(MODULE_ROUTES));
const API_BASE_URL = getFrontendApiBaseUrl();

function normalizeAuthSession(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const username = String(parsed.username || "").trim();
  const module = String(parsed.module || "").trim();
  const loggedAt = String(parsed.logged_at || "").trim();
  if (!username || !VALID_MODULES.has(module) || !loggedAt) {
    return null;
  }
  return {
    ...parsed,
    logged_at: loggedAt,
    module,
    username,
  };
}

function readAuthSession() {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return normalizeAuthSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeAuthSession(session) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearAuthSession() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

function resolveModuleHome(moduleKey) {
  return MODULE_ROUTES[moduleKey] || MODULE_ROUTES.central;
}

function isAuthenticated() {
  return Boolean(readAuthSession());
}

async function fetchAuthSession() {
  try {
    const response = await fetch(buildApiUrl("/auth/session", API_BASE_URL), {
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
    });
    if (!response.ok) {
      clearAuthSession();
      return null;
    }
    const payload = normalizeAuthSession(await response.json());
    if (!payload) {
      clearAuthSession();
      return null;
    }
    writeAuthSession(payload);
    return payload;
  } catch {
    clearAuthSession();
    return null;
  }
}

async function loginWithCredentials(username, password, moduleKey) {
  const user = String(username || "").trim();
  const pass = String(password || "");
  const module = MODULE_ROUTES[moduleKey] ? moduleKey : "central";

  try {
    const response = await fetch(buildApiUrl("/auth/login", API_BASE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        username: user,
        password: pass,
        module,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, message: payload?.detail || "Login failed" };
    }
    const session = normalizeAuthSession({
      username: payload.username || user,
      module: payload.module || module,
      logged_at: payload.logged_at || new Date().toISOString(),
    });
    if (!session) {
      clearAuthSession();
      return { ok: false, message: "Login failed" };
    }
    writeAuthSession(session);
    return { ok: true, module: payload.module || module };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

async function logoutSession() {
  try {
    await fetch(buildApiUrl("/auth/logout", API_BASE_URL), {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
    });
  } finally {
    clearAuthSession();
  }
}

export {
  AUTH_STORAGE_KEY,
  MODULE_ROUTES,
  clearAuthSession,
  fetchAuthSession,
  isAuthenticated,
  loginWithCredentials,
  logoutSession,
  readAuthSession,
  resolveModuleHome,
};
