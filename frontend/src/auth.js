import { buildApiUrl, getFrontendApiBaseUrl } from "./lib/apiBase.js";
import { MODULE_ROUTES } from "./lib/moduleCatalog.js";

const AUTH_STORAGE_KEY = "mes_auth_session_v1";
const SESSION_PROBE_DEDUP_MS = 1000;
const NO_SESSION_PROBE_RESULT = Symbol("no-session-probe-result");

const VALID_MODULES = new Set(Object.keys(MODULE_ROUTES));
const API_BASE_URL = getFrontendApiBaseUrl();
let pendingAuthSessionRequest = null;
let lastAuthSessionProbe = {
  session: NO_SESSION_PROBE_RESULT,
  timestamp: 0,
};

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
  lastAuthSessionProbe = {
    session,
    timestamp: Date.now(),
  };
}

function clearAuthSession() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  lastAuthSessionProbe = {
    session: null,
    timestamp: Date.now(),
  };
}

function resetAuthSessionStateForTests() {
  pendingAuthSessionRequest = null;
  lastAuthSessionProbe = {
    session: NO_SESSION_PROBE_RESULT,
    timestamp: 0,
  };
}

function resolveModuleHome(moduleKey) {
  return MODULE_ROUTES[moduleKey] || MODULE_ROUTES.central;
}

function isAuthenticated() {
  return Boolean(readAuthSession());
}

async function fetchAuthSession() {
  const now = Date.now();
  if (lastAuthSessionProbe.session !== NO_SESSION_PROBE_RESULT && now - lastAuthSessionProbe.timestamp < SESSION_PROBE_DEDUP_MS) {
    return lastAuthSessionProbe.session;
  }
  if (pendingAuthSessionRequest) {
    return pendingAuthSessionRequest;
  }

  const cachedSession = readAuthSession();
  pendingAuthSessionRequest = (async () => {
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
      if (cachedSession) {
        lastAuthSessionProbe = {
          session: cachedSession,
          timestamp: Date.now(),
        };
        return cachedSession;
      }
      clearAuthSession();
      return null;
    } finally {
      pendingAuthSessionRequest = null;
    }
  })();

  return pendingAuthSessionRequest;
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

async function switchSessionModule(moduleKey) {
  const module = MODULE_ROUTES[moduleKey] ? moduleKey : "";
  if (!module) {
    return { ok: false, message: "Invalid module" };
  }

  try {
    const response = await fetch(buildApiUrl("/auth/switch-module", API_BASE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        module,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, message: payload?.detail || "Module switch failed" };
    }
    const session = normalizeAuthSession({
      username: payload.username,
      module: payload.module || module,
      logged_at: payload.logged_at,
    });
    if (!session) {
      clearAuthSession();
      return { ok: false, message: "Module switch failed" };
    }
    writeAuthSession(session);
    return { ok: true, module: session.module };
  } catch {
    return { ok: false, message: "Network error" };
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
  resetAuthSessionStateForTests,
  switchSessionModule,
};
