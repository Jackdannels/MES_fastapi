import { beforeEach, describe, expect, test, vi } from "vitest";

import { createTask, deleteTask, readTasks, updateTask } from "./tasksApi";

describe("tasksApi", () => {
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
      },
    });
    vi.restoreAllMocks();
  });

  test("reads tasks from the dedicated tasks endpoint and refreshes local cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ code: "CJ-2026-001" }],
      }),
    );

    const tasks = await readTasks();

    expect(tasks).toEqual([{ code: "CJ-2026-001" }]);
    expect(JSON.parse(window.localStorage.getItem("mes.tasks"))).toEqual([{ code: "CJ-2026-001" }]);
  });

  test("falls back to local task cache when the tasks endpoint is unavailable", async () => {
    window.localStorage.setItem("mes.tasks", JSON.stringify([{ code: "LOCAL-1" }]));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    const tasks = await readTasks();

    expect(tasks).toEqual([{ code: "LOCAL-1" }]);
  });

  test("creates, updates, and deletes tasks through the dedicated tasks endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: "CJ-2026-002" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: "CJ-2026-003" }),
      })
      .mockResolvedValueOnce({
        ok: true,
      });
    vi.stubGlobal("fetch", fetchMock);

    const created = await createTask({ code: "CJ-2026-002" });
    const updated = await updateTask("CJ-2026-002", { code: "CJ-2026-003" });
    await deleteTask("CJ-2026-003");

    expect(created).toEqual({ code: "CJ-2026-002" });
    expect(updated).toEqual({ code: "CJ-2026-003" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/tasks",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/tasks/CJ-2026-002",
      expect.objectContaining({
        method: "PUT",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/tasks/CJ-2026-003",
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
      }),
    );
  });
});
