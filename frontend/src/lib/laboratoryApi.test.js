import { afterEach, describe, expect, test, vi } from "vitest";

import {
  applyLaboratoryOperation,
  withdrawCurrentLaboratoryExperiment,
} from "./laboratoryApi.js";

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
      scheduleId: "SCHEDULE-B",
      subExperimentCode: "axis-batch-01",
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
        scheduleId: "SCHEDULE-B",
        subExperimentCode: "axis-batch-01",
        taskCode: "TASK-PARALLEL",
        trayCodes: ["TP-B"],
      }),
    });
  });

  test("posts scoped tray codes when withdrawing the current laboratory experiment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, affectedTrayCodes: ["TP-001"] }),
    }));

    await withdrawCurrentLaboratoryExperiment({
      axisBatchNo: "002",
      experimentCode: "EXP-A",
      reason: "试验间内撤回当前实验任务",
      scheduleId: "SCHEDULE-002",
      subExperimentCode: "EXP-A-AXIS-002",
      taskCode: "TASK-001",
      trayCodes: ["TP-001"],
    });

    expect(fetch).toHaveBeenCalledWith("/api/laboratory/tasks/TASK-001/experiments/EXP-A/withdraw-current", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        axisBatchNo: "002",
        reason: "试验间内撤回当前实验任务",
        scheduleId: "SCHEDULE-002",
        subExperimentCode: "EXP-A-AXIS-002",
        trayCodes: ["TP-001"],
      }),
    });
  });


});
