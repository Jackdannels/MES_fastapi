const AUTH_STORAGE_KEY = "mes_auth_session_v1";

const DEFAULT_CREDENTIALS = {
  username: "admin",
  password: "123",
};

const MODULE_ROUTES = {
  central: "/",
  visual: "/visualization",
  staging: "/staging-management",
};

function readAuthSession() {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!parsed.username || !parsed.module) {
      return null;
    }
    return parsed;
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

function loginWithCredentials(username, password, moduleKey) {
  const user = String(username || "").trim();
  const pass = String(password || "");
  if (user !== DEFAULT_CREDENTIALS.username || pass !== DEFAULT_CREDENTIALS.password) {
    return { ok: false, message: "账号或密码错误" };
  }
  const module = MODULE_ROUTES[moduleKey] ? moduleKey : "central";
  writeAuthSession({
    username: user,
    module,
    logged_at: new Date().toISOString(),
  });
  return { ok: true, module };
}

export {
  AUTH_STORAGE_KEY,
  MODULE_ROUTES,
  clearAuthSession,
  isAuthenticated,
  loginWithCredentials,
  readAuthSession,
  resolveModuleHome,
};
