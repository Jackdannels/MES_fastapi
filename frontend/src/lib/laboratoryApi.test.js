import { afterEach, describe, expect, test, vi } from "vitest";

import {
  applyLaboratoryOperation,
  completeLaboratoryExperiment,
  markLaboratoryAxisAdjustmentReady,
  startLaboratoryExperiment,
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
        subExperimentCode: "axis-batch-01",
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

  test("posts scoped laboratory experiment start payload when provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, experimentRuns: [] }),
    }));

    await startLaboratoryExperiment({
      axisBatchNo: "batch-2",
      axisCodes: ["z-", "y+", "x-"],
      currentAxisCode: "y+",
      experimentCode: "EXP-START",
      labCode: "LAB_HOT_HUMID_2",
      labName: "高低温湿热二室",
      plannedEndAt: "2026-04-02 12:00:00",
      plannedHours: 2,
      runNo: "run-hot-humid-2",
      scheduleId: "schedule-hot-humid-2",
      startedAt: "2026-04-02 10:00:03",
      subExperimentCode: "axis-batch-2",
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
        axisBatchNo: "batch-2",
        axisCodes: ["z-", "y+", "x-"],
        currentAxisCode: "y+",
        labCode: "LAB_HOT_HUMID_2",
        labName: "高低温湿热二室",
        plannedEndAt: "2026-04-02 12:00:00",
        plannedHours: 2,
        runNo: "run-hot-humid-2",
        scheduleId: "schedule-hot-humid-2",
        startedAt: "2026-04-02 10:00:03",
        subExperimentCode: "axis-batch-2",
        trayCodes: ["TP-GDW-001"],
      }),
    });
  });

  test("persists second-room axis adjustment readiness before MQTT re-arming", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, experimentRunSteps: [] }),
    }));

    await markLaboratoryAxisAdjustmentReady({
      axisCode: "x-",
      experimentCode: "EXP-START",
      labCode: "LAB_HOT_HUMID_2",
      labName: "高低温湿热二室",
      runNo: "run-hot-humid-2",
      taskCode: "TASK-START",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/laboratory/tasks/TASK-START/experiments/EXP-START/axis-adjustment-ready",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          axisCode: "x-",
          labCode: "LAB_HOT_HUMID_2",
          labName: "高低温湿热二室",
          runNo: "run-hot-humid-2",
        }),
      },
    );
  });

  test("posts scoped laboratory experiment completion payload with sub experiment code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, experimentRuns: [] }),
    }));

    await completeLaboratoryExperiment({
      axisCode: "z-",
      completedAt: "2026-04-02 11:00:00",
      experimentCode: "EXP-START",
      runNo: "run-hot-humid-2",
      subExperimentCode: "axis-batch-2",
      taskCode: "TASK-START",
      trayCodes: ["TP-GDW-001"],
    });

    expect(fetch).toHaveBeenCalledWith("/api/laboratory/tasks/TASK-START/experiments/EXP-START/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        axisCode: "z-",
        completedAt: "2026-04-02 11:00:00",
        nextAxisCode: "",
        runNo: "run-hot-humid-2",
        subExperimentCode: "axis-batch-2",
        trayCodes: ["TP-GDW-001"],
      }),
    });
  });
});
