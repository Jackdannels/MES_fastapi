import { afterEach, describe, expect, test, vi } from "vitest";

import { SNAPSHOT_UPDATED_EVENT, SNAPSHOT_UPDATED_STORAGE_KEY } from "@/lib/storageApi";
import { useStorageSnapshotRefresh } from "./useStorageSnapshotRefresh";

const storageSubscribers = [];

vi.mock("@/lib/storageApi", () => ({
  SNAPSHOT_UPDATED_EVENT: "mes:snapshot-updated",
  SNAPSHOT_UPDATED_STORAGE_KEY: "mes:snapshot-updated-at",
  subscribeStorageSnapshotUpdates: vi.fn((listener) => {
    storageSubscribers.push(listener);
    return vi.fn();
  }),
}));

afterEach(() => {
  storageSubscribers.length = 0;
  vi.useRealTimers();
});

describe("useStorageSnapshotRefresh", () => {
  test("refreshes when a matching snapshot key is updated", () => {
    const refresh = vi.fn();
    useStorageSnapshotRefresh({ keys: ["mes.samples"], refresh });

    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: { keys: ["mes.samples"] } }));
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: { keys: ["mes.devices"] } }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("subscribes to remote storage events and storage markers", () => {
    const refresh = vi.fn();
    useStorageSnapshotRefresh({ keys: ["mes.tasks"], refresh });

    storageSubscribers[0]({ keys: ["mes.tasks"] });
    window.dispatchEvent(new StorageEvent("storage", {
      key: SNAPSHOT_UPDATED_STORAGE_KEY,
      newValue: JSON.stringify({ keys: ["mes.tasks"] }),
    }));

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("defers refresh while paused and flushes after editing ends", () => {
    const refresh = vi.fn();
    let editing = true;
    const { flushPendingRefresh, hasPendingRefresh } = useStorageSnapshotRefresh({
      keys: ["mes.samples"],
      paused: () => editing,
      refresh,
    });

    storageSubscribers[0]({ keys: ["mes.samples"] });

    expect(refresh).not.toHaveBeenCalled();
    expect(hasPendingRefresh.value).toBe(true);

    editing = false;
    flushPendingRefresh();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(hasPendingRefresh.value).toBe(false);
  });
});
