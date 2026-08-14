import { describe, expect, test } from "vitest";

import { buildSaltSprayRunPresentation, findActivePause } from "./saltSprayPausePresentation";

describe("saltSprayPausePresentation", () => {
  test("freezes effective exposure and reports an indeterminate expected end while paused", () => {
    const view = buildSaltSprayRunPresentation({
      activePause: { paused_at: "2026-08-12T10:30:00+08:00" },
      activeRun: {
        active_pause_started_at: "2026-08-12T10:30:00+08:00",
        effective_exposure_seconds: 1800,
        pause_count: 1,
        planned_end_at: "2026-08-12T12:00:00+08:00",
        required_exposure_seconds: 7200,
        started_at: "2026-08-12T10:00:00+08:00",
        status: "实验暂停",
        total_pause_seconds: 0,
      },
      now: new Date("2026-08-12T03:00:00.000Z"),
      runningExperiment: {},
    });

    expect(view).toEqual(expect.objectContaining({
      countdownLabel: "已暂停 00:30:00",
      effectiveExposureLabel: "00:30:00",
      expectedEndLabel: "待恢复后确定",
      isPaused: true,
      remainingExposureLabel: "01:30:00",
      totalPauseLabel: "00:30:00",
    }));
  });

  test("finds the open pause for the active run", () => {
    expect(findActivePause([
      { pause_no: "P-OLD", run_no: "RUN-1", paused_at: "2026-08-12T09:00:00+08:00", resumed_at: "2026-08-12T09:10:00+08:00" },
      { pause_no: "P-ACTIVE", run_no: "RUN-1", paused_at: "2026-08-12T10:00:00+08:00", resumed_at: "" },
      { pause_no: "P-OTHER", run_no: "RUN-2", paused_at: "2026-08-12T11:00:00+08:00", resumed_at: "" },
    ], "RUN-1")?.pause_no).toBe("P-ACTIVE");
  });
});
