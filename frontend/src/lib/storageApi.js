import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";
import { STORAGE_KEYS } from "./storageKeys";

const API_BASE_URL = getFrontendApiBaseUrl();
const SAMPLE_TEXT_REPLACEMENTS = [
  ["鏍峰搧鐧昏", "样品登记"],
  ["鏍峰搧缂栧彿閲嶆帓", "样品编号重排"],
  ["鏍峰搧缁戝畾浠诲姟", "样品绑定任务"],
  ["浠诲姟鏍峰搧閲嶇粦", "任务样品重绑"],
  ["浠诲姟鏍峰搧鍏ュ簱锛堟帴椹冲尯锛", "任务样品入库（接驳区）"],
  ["閫佽揪鏆傚瓨闂", "送达暂存间"],
  ["閫佽嚦鏆傚瓨闂", "送至暂存间"],
  ["瀹ゅ鎺ラ┏鍖", "室外接驳区"],
  ["瀹ゅ", "室外"],
  ["鎺ラ┏鍖", "接驳区"],
  ["鎭掓俯鎭掓箍闂达紙鏆傚瓨闂达級", "恒温恒湿间（暂存间）"],
  ["鏀舵牱鍙", "收样台"],
  ["鏍峰搧搴", "样品库"],
  ["宸叉帴鏀", "已接收"],
  ["宸插叆搴", "已入库"],
  ["杩愯緭涓", "运输中"],
  ["鍒拌揣", "到货"],
  ["浠诲姟 ", "任务 "],
];

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

function sanitizeSampleText(value) {
  let text = String(value ?? "");
  SAMPLE_TEXT_REPLACEMENTS.forEach(([from, to]) => {
    text = text.split(from).join(to);
  });
  return text.replace(/[�?]+$/g, "");
}

function sanitizeSampleCollection(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeSampleCollection);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeSampleCollection(entry)]));
  }
  if (typeof value === "string") {
    return sanitizeSampleText(value);
  }
  return value;
}

function normalizeCollection(key, value) {
  if (key === STORAGE_KEYS.samples && Array.isArray(value)) {
    return sanitizeSampleCollection(value);
  }
  return value;
}

function readLocalArray(key) {
  if (typeof window === "undefined") {
    return [];
  }
  const parsed = parseJson(window.localStorage.getItem(key), []);
  const normalized = Array.isArray(parsed) ? normalizeCollection(key, parsed) : [];
  if (Array.isArray(parsed) && JSON.stringify(normalized) !== JSON.stringify(parsed)) {
    writeLocalArray(key, normalized);
  }
  return normalized;
}

function writeLocalArray(key, value) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = normalizeCollection(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(normalized));
  } catch {
    // Ignore local storage errors and keep the in-memory caller state.
  }
}

async function readStorageSnapshot(keys) {
  const requestedKeys = Array.isArray(keys) ? keys : [];
  const snapshot = Object.fromEntries(requestedKeys.map((key) => [key, readLocalArray(key)]));

  try {
    const response = await fetch(buildApiUrl("/api/storage", API_BASE_URL), {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!response.ok) {
      return snapshot;
    }
    const payload = await response.json();
    requestedKeys.forEach((key) => {
      if (Array.isArray(payload?.[key])) {
        snapshot[key] = normalizeCollection(key, payload[key]);
      }
    });
  } catch {
    // Keep local fallback when remote storage is unavailable.
  }

  return snapshot;
}

async function writeStorageUpdates(updates) {
  const rawPayload = updates && typeof updates === "object" ? updates : {};
  const payload = Object.fromEntries(
    Object.entries(rawPayload).map(([key, value]) => [key, normalizeCollection(key, value)])
  );
  Object.entries(payload).forEach(([key, value]) => {
    writeLocalArray(key, value);
  });

  try {
    await fetch(buildApiUrl("/api/storage", API_BASE_URL), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });
  } catch {
    // Local fallback is already written.
  }
}

export { readLocalArray, readStorageSnapshot, writeLocalArray, writeStorageUpdates };
