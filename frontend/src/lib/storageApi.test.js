import { beforeEach, describe, expect, test, vi } from "vitest";

import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";
import { readStorageSnapshot, writeStorageUpdates } from "./storageApi";
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

  test("rejects when remote storage is unavailable instead of falling back to local storage", async () => {
    window.localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify([{ code: "LOCAL-1" }]));
    window.localStorage.setItem(STORAGE_KEYS.schedules, JSON.stringify([{ task_code: "LOCAL-1" }]));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    await expect(readStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.schedules])).rejects.toThrow("network");
  });

  test("writes updates remotely without persisting local business caches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await writeStorageUpdates({
      [STORAGE_KEYS.tasks]: [{ code: "T-2" }],
    });

    expect(window.localStorage.getItem(STORAGE_KEYS.tasks)).toBeNull();
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
});

