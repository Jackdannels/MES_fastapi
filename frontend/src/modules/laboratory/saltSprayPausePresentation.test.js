import { describe, expect, test } from "vitest";

import { buildSaltSprayRunPresentation, findActivePause, summarizeRunPauses } from "./saltSprayPausePresentation";

describe("saltSprayPausePresentation", () => {
  test("freezes effective exposure and reports an indeterminate expected end while paused", () => {
    const view = buildSaltSprayRunPresentation({
      activePause: { paused_at: "2026-08-12T10:30:00+08:00" },
      activeRun: {
        active_pause_started_at: "2026-08-12T10:30:00+08:00",
        effective_exposure_seconds: 1800,
        planned_end_at: "2026-08-12T12:00:00+08:00",
        required_exposure_seconds: 7200,
        started_at: "2026-08-12T10:00:00+08:00",
        status: "实验暂停",
        run_no: "RUN-1",
      },
      now: new Date("2026-08-12T03:00:00.000Z"),
      pauseRows: [{ pause_no: "P-ACTIVE", run_no: "RUN-1", paused_at: "2026-08-12T10:30:00+08:00" }],
      runningExperiment: {},
    });

    expect(view).toEqual(expect.objectContaining({
      countdownLabel: "已暂停 00:30:00",
      effectiveExposureLabel: "00:30:00",
      expectedEndLabel: "待恢复后确定",
      isPaused: true,
      pauseCount: 1,
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

  test("accumulates resumed and active intervals and counts unique pauses", () => {
    const pauseRows = [
      {
        pause_no: "P-1",
        run_no: "RUN-1",
        paused_at: "2026-08-12T09:00:00+08:00",
        resumed_at: "2026-08-12T09:10:00+08:00",
        pause_seconds: 600,
        status: "实验已恢复",
      },
      {
        pause_no: "P-2",
        run_no: "RUN-1",
        paused_at: "2026-08-12T10:00:00+08:00",
        status: "实验暂停",
      },
      // 重复明细不得重复计数或累计。
      {
        pause_no: "P-1",
        run_no: "RUN-1",
        paused_at: "2026-08-12T09:00:00+08:00",
        resumed_at: "2026-08-12T09:10:00+08:00",
        pause_seconds: 600,
        status: "实验已恢复",
      },
      { pause_no: "P-OTHER", run_no: "RUN-2", paused_at: "2026-08-12T08:00:00+08:00" },
    ];

    const summary = summarizeRunPauses(pauseRows, "RUN-1", new Date("2026-08-12T02:05:00.000Z"));
    const view = buildSaltSprayRunPresentation({
      activeRun: {
        effective_exposure_seconds: 3000,
        required_exposure_seconds: 7200,
        run_no: "RUN-1",
        status: "实验暂停",
      },
      now: new Date("2026-08-12T02:05:00.000Z"),
      pauseRows,
      runningExperiment: {},
    });

    expect(summary).toEqual(expect.objectContaining({
      activePauseSeconds: 300,
      confirmedPauseSeconds: 600,
      pauseCount: 2,
      totalPauseSeconds: 900,
    }));
    expect(view).toEqual(expect.objectContaining({
      pauseCount: 2,
      totalPauseLabel: "00:15:00",
      totalPauseSeconds: 900,
    }));
  });

  test("falls back to timestamps when a closed interval has no persisted duration", () => {
    expect(summarizeRunPauses([{
      pause_no: "P-1",
      run_no: "RUN-1",
      paused_at: "2026-08-12T09:00:00+08:00",
      resumed_at: "2026-08-12T09:12:34+08:00",
      pause_seconds: "",
      status: "实验已恢复",
    }], "RUN-1", new Date("2026-08-12T03:00:00.000Z"))).toEqual(expect.objectContaining({
      confirmedPauseSeconds: 754,
      pauseCount: 1,
      totalPauseSeconds: 754,
    }));
  });

  test("does not treat stopped records as an active pause", () => {
    const stoppedPause = {
      pause_no: "P-STOPPED",
      run_no: "RUN-1",
      paused_at: "2026-08-12T09:00:00+08:00",
      stopped_at: "2026-08-12T09:05:00+08:00",
      status: "实验已停止",
    };

    expect(findActivePause([stoppedPause], "RUN-1")).toBeNull();
    expect(summarizeRunPauses([stoppedPause], "RUN-1", new Date("2026-08-12T03:00:00.000Z")))
      .toEqual(expect.objectContaining({
        activePause: null,
        confirmedPauseSeconds: 300,
        pauseCount: 1,
        totalPauseSeconds: 300,
      }));
  });
});
