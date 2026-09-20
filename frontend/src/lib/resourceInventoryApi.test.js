import { afterEach, expect, test, vi } from "vitest";
import { createReplenishmentRequestId, readResourceInventory, replenishResourceInventory } from "./resourceInventoryApi";
const notify = vi.hoisted(() => vi.fn());
vi.mock('./storageApi', () => ({ notifyStorageSnapshotUpdated: notify }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

test('requests shared inventory and posts idempotent authenticated refills', async () => {
  const payload = { resources: [{ key: 'salt', remaining: 99, used: 1 }, { key: 'mold', remaining: 100, used: 0 }], records: [] };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }); vi.stubGlobal('fetch', fetcher);
  expect(await readResourceInventory()).toEqual(payload);
  const body = { resource: 'salt', quantity: 1, request_id: createReplenishmentRequestId() };
  await replenishResourceInventory(body);
  expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'include', method: 'POST', body: JSON.stringify(body) });
  expect(notify).toHaveBeenCalledWith({ 'mes.resource_inventory': true }, expect.objectContaining({ requestId: body.request_id }));
});
test('failed or malformed responses cannot report success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ detail: 'Central management session required' }) }));
  await expect(replenishResourceInventory({})).rejects.toThrow('Central management');
  expect(notify).not.toHaveBeenCalled();
  fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  await expect(readResourceInventory()).rejects.toThrow('不完整');
});
test('generates RFC4122 request ids on insecure LAN origins without randomUUID', () => {
  const original = crypto;
  vi.stubGlobal('crypto', { getRandomValues: (array) => original.getRandomValues(array) });
  expect(createReplenishmentRequestId()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
