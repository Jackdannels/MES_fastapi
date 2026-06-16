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
});
