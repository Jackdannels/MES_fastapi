import { afterEach, describe, expect, test, vi } from "vitest";

import { applyLaboratoryOperation, startLaboratoryExperiment } from "./laboratoryApi.js";

describe("laboratoryApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("posts scoped laboratory operations without a full storage snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, samples: [] }),
    }));

    await applyLaboratoryOperation({
      experimentCode: "EXP-B",
      labCode: "LAB_MOLD",
      labName: "霉菌试验室",
      occurredAt: "2026-06-11 10:02:00",
      operationType: "install",
      taskCode: "TASK-PARALLEL",
      trayCodes: ["TP-B"],
    });

    expect(fetch).toHaveBeenCalledWith("/api/laboratory/operations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        experimentCode: "EXP-B",
        labCode: "LAB_MOLD",
        labName: "霉菌试验室",
        occurredAt: "2026-06-11 10:02:00",
        operationType: "install",
        taskCode: "TASK-PARALLEL",
        trayCodes: ["TP-B"],
      }),
    });
  });

  test("posts laboratory experiment start requests to the task experiment endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, experimentRuns: [] }),
    }));

    const result = await startLaboratoryExperiment({
      experimentCode: "EXP-START",
      taskCode: "TASK-START",
    });

    expect(result).toEqual({ ok: true, experimentRuns: [] });
    expect(fetch).toHaveBeenCalledWith("/api/laboratory/tasks/TASK-START/experiments/EXP-START/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
    });
  });

  test("posts scoped laboratory experiment start payload when provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, experimentRuns: [] }),
    }));

    await startLaboratoryExperiment({
      experimentCode: "EXP-START",
      labCode: "LAB_HOT_HUMID_2",
      labName: "高低温湿热二室",
      plannedEndAt: "2026-04-02 12:00:00",
      plannedHours: 2,
      runNo: "run-hot-humid-2",
      scheduleId: "schedule-hot-humid-2",
      startedAt: "2026-04-02 10:00:03",
      taskCode: "TASK-START",
      trayCodes: ["TP-GDW-001"],
    });

    expect(fetch).toHaveBeenCalledWith("/api/laboratory/tasks/TASK-START/experiments/EXP-START/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        labCode: "LAB_HOT_HUMID_2",
        labName: "高低温湿热二室",
        plannedEndAt: "2026-04-02 12:00:00",
        plannedHours: 2,
        runNo: "run-hot-humid-2",
        scheduleId: "schedule-hot-humid-2",
        startedAt: "2026-04-02 10:00:03",
        trayCodes: ["TP-GDW-001"],
      }),
    });
  });
});
