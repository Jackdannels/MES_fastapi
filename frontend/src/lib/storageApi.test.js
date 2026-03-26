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

  test("refreshes local sample cache from clean remote storage payload", async () => {
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
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.samples))[0].history[0].action).toBe("样品编号重排");
  });

  test("migrates legacy local task-linked collections to SYLU codes and backfills historical experiments", async () => {
    window.localStorage.setItem(
      STORAGE_KEYS.tasks,
      JSON.stringify([
        {
          id: "task-1",
          code: "GDW-2024-005",
          name: "高低温湿热试验-批次E",
          test_type: "高低温湿热试验",
          created_at: "2026-03-05T09:00:00",
        },
      ]),
    );
    window.localStorage.setItem(
      STORAGE_KEYS.samples,
      JSON.stringify([
        {
          id: "sample-1",
          code: "GDW-2024-005-SP-001",
          task_code: "GDW-2024-005",
          created_at: "2026-03-05T09:05:00",
          trays: [{ tray_code: "GDW-2024-005-TP-001", sample_code: "GDW-2024-005-SP-001" }],
        },
      ]),
    );
    window.localStorage.setItem(
      STORAGE_KEYS.schedules,
      JSON.stringify([
        {
          id: "schedule-1",
          task_code: "GDW-2024-005",
          experiment_code: "GDW-2024-005-A",
          device: "高低温实验室",
        },
      ]),
    );
    window.localStorage.setItem(
      STORAGE_KEYS.streams,
      JSON.stringify([{ id: "stream-1", task_code: "GDW-2024-005" }]),
    );
    window.localStorage.setItem(STORAGE_KEYS.experiments, JSON.stringify([]));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const snapshot = await readStorageSnapshot([
      STORAGE_KEYS.tasks,
      STORAGE_KEYS.experiments,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.schedules,
      STORAGE_KEYS.streams,
    ]);

    expect(snapshot[STORAGE_KEYS.tasks][0].code).toBe("SYLU-2026-03-001");
    expect(snapshot[STORAGE_KEYS.samples][0].code).toBe("SYLU-2026-03-001-SP-001");
    expect(snapshot[STORAGE_KEYS.samples][0].trays[0].tray_code).toBe("SYLU-2026-03-001-TP-001");
    expect(snapshot[STORAGE_KEYS.schedules][0]).toMatchObject({
      task_code: "SYLU-2026-03-001",
      experiment_code: "SYLU-2026-03-001-A",
    });
    expect(snapshot[STORAGE_KEYS.streams][0].task_code).toBe("SYLU-2026-03-001");
    expect(snapshot[STORAGE_KEYS.experiments]).toHaveLength(3);
    expect(snapshot[STORAGE_KEYS.experiments].map((item) => item.experiment_code)).toEqual([
      "SYLU-2026-03-001-A",
      "SYLU-2026-03-001-B",
      "SYLU-2026-03-001-C",
    ]);
    expect(snapshot[STORAGE_KEYS.experiments].map((item) => item.experiment_name)).toEqual([
      "高低温湿热试验",
      "冲击试验",
      "振动试验",
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.tasks))[0].code).toBe("SYLU-2026-03-001");
  });
});
