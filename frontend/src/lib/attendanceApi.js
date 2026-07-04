import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

const readErrorMessage = async (response) => {
  const payload = await response.json().catch(() => null);
  return payload?.detail || payload?.message || `请求失败（${response.status}）`;
};

const readJson = async (path, message) => {
  const response = await fetch(buildApiUrl(path, API_BASE_URL), {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`${message}: ${await readErrorMessage(response)}`);
  }
  return response.json();
};

const writeJson = async (path, { body, method = "POST", message }) => {
  const response = await fetch(buildApiUrl(path, API_BASE_URL), {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "include",
    body: JSON.stringify(body || {}),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
};

const encodeLabName = (labName) => encodeURIComponent(String(labName || "").trim());

async function readLaboratoryAttendanceSession(labName) {
  return readJson(`/api/attendance/labs/${encodeLabName(labName)}/session`, "读取试验间登录信息失败");
}

async function loginLaboratoryAttendance({ labName, password, username }) {
  return writeJson(`/api/attendance/labs/${encodeLabName(labName)}/login`, {
    body: {
      username: String(username || "").trim(),
      password: String(password || ""),
    },
    message: "试验间登录失败",
  });
}

async function logoutLaboratoryAttendance({ labName, reason = "manual" }) {
  return writeJson(`/api/attendance/labs/${encodeLabName(labName)}/logout`, {
    body: {
      reason: String(reason || "manual"),
    },
    message: "试验间退出登录失败",
  });
}

async function markLaboratoryAttendanceWorkStarted(labName) {
  return writeJson(`/api/attendance/labs/${encodeLabName(labName)}/work/start`, {
    body: {},
    message: "开始员工工作计时失败",
  });
}

async function listAttendanceWorkTimes(date = "") {
  const query = String(date || "").trim() ? `?date=${encodeURIComponent(String(date).trim())}` : "";
  return readJson(`/api/attendance/work-times${query}`, "读取员工工作时间失败");
}

async function listAttendanceUsers() {
  return readJson("/api/attendance/users", "读取员工账号失败");
}

async function createAttendanceUser(payload = {}) {
  return writeJson("/api/attendance/users", {
    body: {
      username: String(payload.username || "").trim(),
      password: String(payload.password || ""),
      employeeName: String(payload.employeeName || "").trim(),
      roleName: String(payload.roleName || "").trim(),
      active: payload.active !== false,
    },
    message: "新增员工账号失败",
  });
}

async function updateAttendanceUser(userId, payload = {}) {
  return writeJson(`/api/attendance/users/${encodeURIComponent(String(userId))}`, {
    method: "PUT",
    body: {
      ...(payload.password !== undefined ? { password: String(payload.password || "") } : {}),
      ...(payload.employeeName !== undefined ? { employeeName: String(payload.employeeName || "").trim() } : {}),
      ...(payload.roleName !== undefined ? { roleName: String(payload.roleName || "").trim() } : {}),
      ...(payload.active !== undefined ? { active: Boolean(payload.active) } : {}),
    },
    message: "更新员工账号失败",
  });
}

async function resetAttendanceUserPassword(userId, payload = {}) {
  return writeJson(`/api/attendance/users/${encodeURIComponent(String(userId))}/password/reset`, {
    body: {
      adminUsername: String(payload.adminUsername || "").trim(),
      adminPassword: String(payload.adminPassword || ""),
      newPassword: String(payload.newPassword || ""),
    },
    message: "重置员工密码失败",
  });
}

async function deleteAttendanceUser(userId, payload = {}) {
  return writeJson(`/api/attendance/users/${encodeURIComponent(String(userId))}`, {
    method: "DELETE",
    body: {
      adminUsername: String(payload.adminUsername || "").trim(),
      adminPassword: String(payload.adminPassword || ""),
    },
    message: "删除员工账号失败",
  });
}

export {
  createAttendanceUser,
  deleteAttendanceUser,
  listAttendanceUsers,
  listAttendanceWorkTimes,
  loginLaboratoryAttendance,
  logoutLaboratoryAttendance,
  markLaboratoryAttendanceWorkStarted,
  readLaboratoryAttendanceSession,
  resetAttendanceUserPassword,
  updateAttendanceUser,
};
