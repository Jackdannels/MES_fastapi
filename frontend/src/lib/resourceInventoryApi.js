import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase";
import { notifyStorageSnapshotUpdated } from "./storageApi";

export const RESOURCE_INVENTORY_KEY = "mes.resource_inventory";

export function createReplenishmentRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // getRandomValues is also available on the plant's plain-HTTP LAN terminals.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function request(path = "", body) {
  const response = await fetch(buildApiUrl(`/api/device-resources${path}`, getFrontendApiBaseUrl()), {
    method: body ? "POST" : "GET", credentials: "include",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.detail === "string" ? payload.detail : `资源请求失败（${response.status}），请重试`);
  if (!["salt", "mold"].every((key) => payload?.resources?.some((item) => item.key === key && Number.isFinite(item.remaining) && Number.isFinite(item.used)))) {
    throw new Error("资源余量数据不完整，请重试");
  }
  return payload;
}
export const readResourceInventory = () => request();
export async function replenishResourceInventory(body) {
  const result = await request("/replenishments", body);
  notifyStorageSnapshotUpdated({ [RESOURCE_INVENTORY_KEY]: true }, { source: "resource-inventory", requestId: body.request_id });
  return result;
}
