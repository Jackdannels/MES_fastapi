import { beforeEach, describe, expect, test, vi } from "vitest";

import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";
import { SNAPSHOT_UPDATED_EVENT, readStorageSnapshot, subscribeStorageSnapshotUpdates, writeStorageUpdates } from "./storageApi";
import { STORAGE_KEYS } from "./storageKeys";

const STORAGE_ENDPOINT = buildApiUrl("/api/storage", getFrontendApiBaseUrl());

describe("storageApi", () => {
  beforeEach(() => {
    const store = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem(key) {
          return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
          store.set(key, String(value));
        },
        removeItem(key) {
          store.delete(key);
        },
        clear() {
          store.clear();
        },
      },
    });
    vi.restoreAllMocks();
  });

  test("reads requested collections from remote storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          [STORAGE_KEYS.tasks]: [{ code: "T-1" }],
          [STORAGE_KEYS.schedules]: [{ task_code: "T-1" }],
          [STORAGE_KEYS.staging_events]: [{ tray_code: "T-1-TP-001", action: "stock_in" }],
        }),
      })
    );

    const snapshot = await readStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.schedules, STORAGE_KEYS.staging_events]);

    expect(snapshot).toEqual({
      [STORAGE_KEYS.tasks]: [{ code: "T-1" }],
      [STORAGE_KEYS.schedules]: [{ task_code: "T-1" }],
      [STORAGE_KEYS.staging_events]: [{ tray_code: "T-1-TP-001", action: "stock_in" }],
    });
    expect(window.localStorage.getItem(STORAGE_KEYS.tasks)).toBeNull();
  });

  test("can preserve missing or malformed collections for background refresh fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          [STORAGE_KEYS.tasks]: [{ code: "T-1" }],
          [STORAGE_KEYS.samples]: { stale: true },
        }),
      })
    );

    const snapshot = await readStorageSnapshot(
      [STORAGE_KEYS.tasks, STORAGE_KEYS.samples, STORAGE_KEYS.schedules],
      { normalizeMissing: false },
    );

    expect(snapshot).toEqual({
      [STORAGE_KEYS.tasks]: [{ code: "T-1" }],
      [STORAGE_KEYS.samples]: { stale: true },
      [STORAGE_KEYS.schedules]: undefined,
    });
  });

  test("coalesces concurrent snapshot reads for the same key set into one remote request", async () => {
    let resolveResponse;
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveResponse = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const firstRead = readStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.samples]);
    const secondRead = readStorageSnapshot([STORAGE_KEYS.samples, STORAGE_KEYS.tasks]);

    resolveResponse({
      ok: true,
      json: async () => ({
        [STORAGE_KEYS.tasks]: [{ code: "T-1" }],
        [STORAGE_KEYS.samples]: [{ code: "S-1" }],
      }),
    });

    await expect(firstRead).resolves.toEqual({
      [STORAGE_KEYS.tasks]: [{ code: "T-1" }],
      [STORAGE_KEYS.samples]: [{ code: "S-1" }],
    });
    await expect(secondRead).resolves.toEqual({
      [STORAGE_KEYS.samples]: [{ code: "S-1" }],
      [STORAGE_KEYS.tasks]: [{ code: "T-1" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("rejects when remote storage is unavailable instead of falling back to local storage", async () => {
    window.localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify([{ code: "LOCAL-1" }]));
    window.localStorage.setItem(STORAGE_KEYS.schedules, JSON.stringify([{ task_code: "LOCAL-1" }]));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    await expect(readStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.schedules])).rejects.toThrow("network");
  });

  test("writes updates remotely without persisting local business caches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const eventSpy = vi.fn();
    window.addEventListener(SNAPSHOT_UPDATED_EVENT, eventSpy);

    await writeStorageUpdates({
      [STORAGE_KEYS.tasks]: [{ code: "T-2" }],
    });

    expect(window.localStorage.getItem(STORAGE_KEYS.tasks)).toBeNull();
    expect(window.localStorage.getItem("mes:snapshot-updated-at")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(STORAGE_ENDPOINT, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        [STORAGE_KEYS.tasks]: [{ code: "T-2" }],
      }),
    });
    expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({
        keys: [STORAGE_KEYS.tasks],
      }),
    }));
    window.removeEventListener(SNAPSHOT_UPDATED_EVENT, eventSpy);
  });

  test("returns clean remote sample payloads without refreshing local sample cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          [STORAGE_KEYS.samples]: [
            {
              code: "S-1",
              task_code: "T-1",
              history: [
                {
                  action: "样品编号重排",
                  detail: "任务 T-1",
                },
              ],
            },
          ],
        }),
      })
    );

    const snapshot = await readStorageSnapshot([STORAGE_KEYS.samples]);

    expect(snapshot[STORAGE_KEYS.samples][0].history[0].action).toBe("样品编号重排");
    expect(snapshot[STORAGE_KEYS.samples][0].history[0].detail).toBe("任务 T-1");
    expect(window.localStorage.getItem(STORAGE_KEYS.samples)).toBeNull();
  });

  test("does not persist local business caches when remote writes fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(
      writeStorageUpdates({
        [STORAGE_KEYS.tasks]: [{ code: "T-3" }],
      }),
    ).rejects.toThrow("offline");

    expect(window.localStorage.getItem(STORAGE_KEYS.tasks)).toBeNull();
  });

  test("includes backend validation detail when remote writes fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ detail: "托盘尚未从接驳间出库，不能直接到达实验室" }),
      }),
    );

    await expect(
      writeStorageUpdates({
        [STORAGE_KEYS.samples]: [],
      }),
    ).rejects.toThrow("Failed to write storage updates: 400 Bad Request，托盘尚未从接驳间出库，不能直接到达实验室");
  });

  test("subscribes to remote storage update events with EventSource", () => {
    const instances = [];
    class MockEventSource {
      constructor(url, options) {
        this.url = url;
        this.options = options;
        this.listeners = {};
        this.close = vi.fn();
        instances.push(this);
      }

      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }
    }
    window.EventSource = MockEventSource;
    const listener = vi.fn();

    const unsubscribe = subscribeStorageSnapshotUpdates(listener);

    expect(instances[0]).toEqual(expect.objectContaining({
      options: { withCredentials: true },
      url: buildApiUrl("/api/storage/events", getFrontendApiBaseUrl()),
    }));

    instances[0].listeners.message({ data: JSON.stringify({ keys: [STORAGE_KEYS.samples], updatedAt: "2026-04-02T10:00:00.000Z" }) });

    expect(listener).toHaveBeenCalledWith({
      keys: [STORAGE_KEYS.samples],
      updatedAt: "2026-04-02T10:00:00.000Z",
    });

    unsubscribe();
    expect(instances[0].close).toHaveBeenCalledTimes(1);
  });
});

