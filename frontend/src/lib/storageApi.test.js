import { beforeEach, describe, expect, test, vi } from "vitest";

import { readStorageSnapshot, writeStorageUpdates } from "./storageApi";
import { STORAGE_KEYS } from "./storageKeys";

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
        }),
      })
    );

    const snapshot = await readStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.schedules]);

    expect(snapshot).toEqual({
      [STORAGE_KEYS.tasks]: [{ code: "T-1" }],
      [STORAGE_KEYS.schedules]: [{ task_code: "T-1" }],
    });
  });

  test("falls back to local storage when remote storage is unavailable", async () => {
    window.localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify([{ code: "LOCAL-1" }]));
    window.localStorage.setItem(STORAGE_KEYS.schedules, JSON.stringify([{ task_code: "LOCAL-1" }]));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    const snapshot = await readStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.schedules]);

    expect(snapshot).toEqual({
      [STORAGE_KEYS.tasks]: [{ code: "LOCAL-1" }],
      [STORAGE_KEYS.schedules]: [{ task_code: "LOCAL-1" }],
    });
  });

  test("writes updates to local storage and syncs them remotely", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await writeStorageUpdates({
      [STORAGE_KEYS.tasks]: [{ code: "T-2" }],
    });

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.tasks))).toEqual([{ code: "T-2" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/storage", {
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

  test("sanitizes legacy sample text from local storage on read", async () => {
    window.localStorage.setItem(
      STORAGE_KEYS.samples,
      JSON.stringify([
        {
          code: "S-1",
          task_code: "T-1",
          history: [
            {
              action: "鏍峰搧缂栧彿閲嶆帓",
              detail: "浠诲姟 T-1",
            },
          ],
        },
      ])
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    const snapshot = await readStorageSnapshot([STORAGE_KEYS.samples]);

    expect(snapshot[STORAGE_KEYS.samples][0].history[0].action).toBe("样品编号重排");
    expect(snapshot[STORAGE_KEYS.samples][0].history[0].detail).toBe("任务 T-1");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.samples))[0].history[0].action).toBe("样品编号重排");
  });
});
