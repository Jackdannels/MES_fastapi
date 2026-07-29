import { beforeEach, describe, expect, test, vi } from "vitest";

import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SNAPSHOT_UPDATED_STORAGE_KEY, writeStorageSchedulePatch, writeStorageUpdates } from "@/lib/storageApi";

const storageApiMocks = vi.hoisted(() => ({
  readStorageSnapshot: vi.fn(),
  writeStorageRunningRepair: vi.fn(),
  writeStorageSchedulePatch: vi.fn(),
  writeStorageUpdates: vi.fn(),
}));

vi.mock("@/lib/storageApi", () => {
  const SNAPSHOT_UPDATED_STORAGE_KEY = "mes:snapshot-updated-at";
  return {
    SNAPSHOT_UPDATED_STORAGE_KEY,
    readStorageSnapshot: storageApiMocks.readStorageSnapshot,
    writeStorageRunningRepair: storageApiMocks.writeStorageRunningRepair,
    writeStorageSchedulePatch: storageApiMocks.writeStorageSchedulePatch,
    writeStorageUpdates: storageApiMocks.writeStorageUpdates,
  };
});

const expiredScheduleSnapshot = (taskCode = "TASK-RESET") => ({
  [STORAGE_KEYS.conflicts]: [],
  [STORAGE_KEYS.experiments]: [
    {
      task_code: taskCode,
      experiment_code: `${taskCode}-A`,
      experiment_name: "冲击试验",
      status: "已排程",
    },
  ],
  [STORAGE_KEYS.experiment_trays]: [],
  [STORAGE_KEYS.samples]: [{ code: `${taskCode}-SP-001`, task_code: taskCode, status: "运输中" }],
  [STORAGE_KEYS.schedules]: [
    {
      id: `schedule-${taskCode.toLowerCase()}`,
      task_code: taskCode,
      experiment_code: `${taskCode}-A`,
      device: "冲击一室",
      start_at: "2000-01-01 08:00:00",
      end_at: "2000-01-01 09:00:00",
      status: "已排程",
    },
  ],
  [STORAGE_KEYS.tasks]: [{ code: taskCode, status: "已排程", test_type: "冲击试验" }],
});

describe("useStorageSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  test("skips schedule exception reconciliation writes when a task reset updates the snapshot during the read", async () => {
    storageApiMocks.readStorageSnapshot.mockImplementation(async () => {
      window.localStorage.setItem(
        SNAPSHOT_UPDATED_STORAGE_KEY,
        JSON.stringify({ source: "tasks", reason: "reset", updatedAt: "2026-07-03 08:00:00" }),
      );
      return expiredScheduleSnapshot();
    });
    const { useStorageSnapshot } = await import("./useStorageSnapshot");
    const { loadSnapshot } = useStorageSnapshot([STORAGE_KEYS.conflicts]);

    await loadSnapshot({ reconcileScheduleExceptions: true });

    expect(window.localStorage.getItem(SNAPSHOT_UPDATED_STORAGE_KEY)).toContain("\"reason\":\"reset\"");
    expect(writeStorageUpdates).not.toHaveBeenCalled();
    expect(writeStorageSchedulePatch).not.toHaveBeenCalled();
  });

  test("writes schedule exception cleanup through explicit schedule patch deletes", async () => {
    storageApiMocks.readStorageSnapshot.mockResolvedValue(expiredScheduleSnapshot("TASK-EXPIRED"));
    const { useStorageSnapshot } = await import("./useStorageSnapshot");
    const { loadSnapshot } = useStorageSnapshot([STORAGE_KEYS.schedules, STORAGE_KEYS.conflicts]);

    const snapshot = await loadSnapshot({ reconcileScheduleExceptions: true });

    expect(snapshot[STORAGE_KEYS.schedules]).toEqual([]);
    expect(snapshot[STORAGE_KEYS.conflicts]).toEqual([
      expect.objectContaining({
        schedule_id: "schedule-task-expired",
        task_code: "TASK-EXPIRED",
      }),
    ]);
    expect(writeStorageSchedulePatch).toHaveBeenCalledWith({
      upserts: {
        [STORAGE_KEYS.conflicts]: [
          expect.objectContaining({
            schedule_id: "schedule-task-expired",
            task_code: "TASK-EXPIRED",
          }),
        ],
        [STORAGE_KEYS.experiments]: [
          expect.objectContaining({
            experiment_code: "TASK-EXPIRED-A",
            status: "待排程",
          }),
        ],
        [STORAGE_KEYS.tasks]: [
          expect.objectContaining({
            code: "TASK-EXPIRED",
            status: "待排程",
          }),
        ],
      },
      deletes: {
        [STORAGE_KEYS.schedules]: ["schedule-task-expired"],
      },
    });
    expect(writeStorageUpdates).not.toHaveBeenCalled();
  });
});
