import { beforeEach, describe, expect, test, vi } from "vitest";

import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";
import { createTask, deleteTask, readTasks, resetTasks, updateTask } from "./tasksApi";

const TASKS_ENDPOINT = buildApiUrl("/api/tasks", getFrontendApiBaseUrl());
const TASKS_RESET_ENDPOINT = buildApiUrl("/api/tasks/reset", getFrontendApiBaseUrl());
const buildTaskEndpoint = (taskId) => buildApiUrl(`/api/tasks/${taskId}`, getFrontendApiBaseUrl());

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

    const created = await createTask({
      code: "SYLU-2026-03-002",
      test_type: "冲击试验 / 盐雾试验",
      test_types: ["冲击试验", "盐雾试验"],
    });
    const updated = await updateTask("SYLU-2026-03-002", { code: "SYLU-2026-03-003" });
    await deleteTask("SYLU-2026-03-003");

    expect(created).toEqual({ code: "SYLU-2026-03-002" });
    expect(updated).toEqual({ code: "SYLU-2026-03-003" });
    expect(window.localStorage.getItem("mes.tasks")).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      TASKS_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          code: "SYLU-2026-03-002",
          test_type: "冲击试验 / 盐雾试验",
          test_types: ["冲击试验", "盐雾试验"],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      buildTaskEndpoint("SYLU-2026-03-002"),
      expect.objectContaining({
        method: "PUT",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      buildTaskEndpoint("SYLU-2026-03-003"),
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

  test("resets tasks through the dedicated reset endpoint without mutating local cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_count: 20, sample_count: 160, experiment_count: 60 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await resetTasks();

    expect(summary).toEqual({ task_count: 20, sample_count: 160, experiment_count: 60 });
    expect(window.localStorage.getItem("mes.tasks")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      TASKS_RESET_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });
});
