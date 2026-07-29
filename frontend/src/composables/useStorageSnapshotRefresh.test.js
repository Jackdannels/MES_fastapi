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
    useStorageSnapshotRefresh({ keys: ["mes.samples"], refresh, debounceMs: 0 });

    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: { keys: ["mes.samples"] } }));
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: { keys: ["mes.devices"] } }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(["mes.samples"]);
  });

  test("coalesces changed keys and passes only watched keys to the refresh callback", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    useStorageSnapshotRefresh({
      keys: ["mes.samples", "mes.tasks", "mes.devices"],
      refresh,
    });

    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, {
      detail: { keys: ["mes.samples", "mes.unwatched"] },
    }));
    storageSubscribers[0]({ keys: ["mes.tasks"] });
    vi.advanceTimersByTime(100);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(["mes.samples", "mes.tasks"]);
  });

  test.each([
    [{ keys: ["mes.samples"], version: 7 }, { keys: ["mes.samples"], version: 9 }],
    [{ keys: ["mes.samples"] }, { keys: ["mes.samples"], reason: "reconnect" }],
  ])("uses all watched keys to calibrate after a version gap or reconnect", async (firstUpdate, calibrationUpdate) => {
    const refresh = vi.fn();
    const storageRefresh = useStorageSnapshotRefresh({
      keys: ["mes.samples", "mes.tasks"],
      refresh,
      debounceMs: 0,
    });

    storageRefresh.requestRefresh(firstUpdate);
    await Promise.resolve();
    await Promise.resolve();
    storageRefresh.requestRefresh(calibrationUpdate);
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenLastCalledWith(["mes.samples", "mes.tasks"]);
  });

  test("ignores snapshot updates from the same source request", async () => {
    const refresh = vi.fn();
    useStorageSnapshotRefresh({
      keys: ["mes.samples"],
      refresh,
      debounceMs: 0,
      ignoreSource: "staging-management",
      ignoreRequestIds: ["write-1"],
    });

    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, {
      detail: { keys: ["mes.samples"], source: "staging-management", requestId: "write-1" },
    }));
    storageSubscribers[0]({ keys: ["mes.samples"], source: "staging-management", requestId: "write-1" });
    window.dispatchEvent(new StorageEvent("storage", {
      key: SNAPSHOT_UPDATED_STORAGE_KEY,
      newValue: JSON.stringify({ keys: ["mes.samples"], source: "staging-management", requestId: "write-1" }),
    }));
    await Promise.resolve();
    await Promise.resolve();

    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, {
      detail: { keys: ["mes.samples"], source: "staging-management", requestId: "write-2" },
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("subscribes to remote storage events and storage markers", async () => {
    const refresh = vi.fn();
    useStorageSnapshotRefresh({ keys: ["mes.tasks"], refresh, debounceMs: 0 });

    storageSubscribers[0]({ keys: ["mes.tasks"] });
    window.dispatchEvent(new StorageEvent("storage", {
      key: SNAPSHOT_UPDATED_STORAGE_KEY,
      newValue: JSON.stringify({ keys: ["mes.tasks"] }),
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("deduplicates the same sourced request across local, remote, and sample refresh bridges", async () => {
    const refresh = vi.fn();
    const storageRefresh = useStorageSnapshotRefresh({ keys: ["mes.samples"], refresh, debounceMs: 0 });
    const update = {
      keys: ["mes.samples"],
      source: "transfer-workbench",
      requestId: "allocate-1",
    };

    storageSubscribers[0](update);
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: update }));
    storageRefresh.requestRefresh(update);
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("runs an explicitly immediate bridge refresh without waiting for debounce", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const storageRefresh = useStorageSnapshotRefresh({ keys: ["mes.samples"], refresh });

    storageRefresh.requestRefresh({ keys: ["mes.samples"], immediate: true });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("serializes immediate bridge refreshes without request identities", async () => {
    let finishFirstRefresh;
    const refresh = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishFirstRefresh = resolve;
      }))
      .mockResolvedValue(undefined);
    const storageRefresh = useStorageSnapshotRefresh({ keys: ["mes.samples"], refresh });

    storageRefresh.requestRefresh({ keys: ["mes.samples"], immediate: true });
    storageRefresh.requestRefresh({ keys: ["mes.samples"], immediate: true });
    storageRefresh.requestRefresh({ keys: ["mes.samples"], immediate: true });

    expect(refresh).toHaveBeenCalledTimes(1);
    finishFirstRefresh();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("does not let an unrelated key claim a sourced request deduplication slot", async () => {
    const refresh = vi.fn();
    const storageRefresh = useStorageSnapshotRefresh({ keys: ["mes.samples"], refresh, debounceMs: 0 });
    const request = { source: "transfer-workbench", requestId: "allocate-2" };

    storageRefresh.requestRefresh({ ...request, keys: ["mes.devices"] });
    storageRefresh.requestRefresh({ ...request, keys: ["mes.samples"] });
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("coalesces rapid update events by default", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    useStorageSnapshotRefresh({ keys: ["mes.tasks"], refresh });

    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: { keys: ["mes.tasks"] } }));
    storageSubscribers[0]({ keys: ["mes.tasks"] });
    window.dispatchEvent(new StorageEvent("storage", {
      key: SNAPSHOT_UPDATED_STORAGE_KEY,
      newValue: JSON.stringify({ keys: ["mes.tasks"] }),
    }));

    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("does not run concurrent refreshes and replays one pending refresh", async () => {
    let finishFirstRefresh;
    const refresh = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishFirstRefresh = resolve;
      }))
      .mockResolvedValue(undefined);
    useStorageSnapshotRefresh({ keys: ["mes.tasks", "mes.samples"], refresh, debounceMs: 0 });

    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: { keys: ["mes.tasks"] } }));
    storageSubscribers[0]({ keys: ["mes.samples"] });
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: { keys: ["mes.tasks"] } }));

    expect(refresh).toHaveBeenCalledTimes(1);

    finishFirstRefresh();
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith(["mes.samples", "mes.tasks"]);
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
