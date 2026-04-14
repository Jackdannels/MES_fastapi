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

  test("reads tasks from the dedicated tasks endpoint without refreshing local cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ code: "SYLU-2026-03-001" }],
      }),
    );

    const tasks = await readTasks();

    expect(tasks).toEqual([{ code: "SYLU-2026-03-001" }]);
    expect(window.localStorage.getItem("mes.tasks")).toBeNull();
  });

  test("rejects when the tasks endpoint is unavailable instead of falling back to local cache", async () => {
    window.localStorage.setItem("mes.tasks", JSON.stringify([{ code: "LOCAL-1" }]));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    await expect(readTasks()).rejects.toThrow("network");
  });

  test("creates, updates, and deletes tasks through the dedicated tasks endpoint without mutating local cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: "SYLU-2026-03-002" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: "SYLU-2026-03-003" }),
      })
      .mockResolvedValueOnce({
        ok: true,
      });
    vi.stubGlobal("fetch", fetchMock);

    const created = await createTask({ code: "SYLU-2026-03-002" });
    const updated = await updateTask("SYLU-2026-03-002", { code: "SYLU-2026-03-003" });
    await deleteTask("SYLU-2026-03-003");

    expect(created).toEqual({ code: "SYLU-2026-03-002" });
    expect(updated).toEqual({ code: "SYLU-2026-03-003" });
    expect(window.localStorage.getItem("mes.tasks")).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/tasks",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/tasks/SYLU-2026-03-002",
      expect.objectContaining({
        method: "PUT",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/tasks/SYLU-2026-03-003",
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
      }),
    );
  });

  test("rejects failed task mutations instead of pretending local success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(createTask({ code: "SYLU-2026-03-009" })).rejects.toThrow("offline");
    await expect(updateTask("SYLU-2026-03-009", { code: "SYLU-2026-03-010" })).rejects.toThrow("offline");
    expect(window.localStorage.getItem("mes.tasks")).toBeNull();
  });
});
