import { beforeEach, describe, expect, test, vi } from "vitest";

import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SNAPSHOT_UPDATED_STORAGE_KEY, writeStorageUpdates } from "@/lib/storageApi";

vi.mock("@/lib/storageApi", () => {
  const SNAPSHOT_UPDATED_STORAGE_KEY = "mes:snapshot-updated-at";
  const writeStorageUpdates = vi.fn();
  return {
    SNAPSHOT_UPDATED_STORAGE_KEY,
    readStorageSnapshot: vi.fn(async () => {
      window.localStorage.setItem(
        SNAPSHOT_UPDATED_STORAGE_KEY,
        JSON.stringify({ source: "tasks", reason: "reset", updatedAt: "2026-07-03 08:00:00" }),
      );
      return {
        [STORAGE_KEYS.conflicts]: [],
        [STORAGE_KEYS.experiments]: [
          {
            task_code: "TASK-RESET",
            experiment_code: "TASK-RESET-A",
            experiment_name: "冲击试验",
            status: "已排程",
          },
        ],
        [STORAGE_KEYS.experiment_trays]: [],
        [STORAGE_KEYS.samples]: [{ code: "TASK-RESET-SP-001", task_code: "TASK-RESET", status: "运输中" }],
        [STORAGE_KEYS.schedules]: [
          {
            id: "schedule-reset-race",
            task_code: "TASK-RESET",
            experiment_code: "TASK-RESET-A",
            device: "冲击一室",
            start_at: "2000-01-01 08:00:00",
            end_at: "2000-01-01 09:00:00",
            status: "已排程",
          },
        ],
        [STORAGE_KEYS.tasks]: [{ code: "TASK-RESET", status: "已排程", test_type: "冲击试验" }],
      };
    }),
    writeStorageUpdates,
  };
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
    const { useStorageSnapshot } = await import("./useStorageSnapshot");
    const { loadSnapshot } = useStorageSnapshot([STORAGE_KEYS.conflicts]);

    await loadSnapshot();

    expect(window.localStorage.getItem(SNAPSHOT_UPDATED_STORAGE_KEY)).toContain("\"reason\":\"reset\"");
    expect(writeStorageUpdates).not.toHaveBeenCalled();
  });
});
