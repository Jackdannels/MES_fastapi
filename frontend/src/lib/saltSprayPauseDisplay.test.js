import { describe, expect, test } from "vitest";

import {
  SALT_SPRAY_PAUSE_REMARK,
  resolveSaltSprayMidExperimentAppearance,
  resolveSaltSprayPauseFlowLabel,
  resolveSaltSprayPauseRemark,
  resolveSaltSprayResumePreparation,
} from "./saltSprayPauseDisplay";

const input = (overrides = {}) => ({
  experimentRunPauses: [{
    lab_code: "LAB_SALT",
    pause_no: "PAUSE-1",
    run_no: "RUN-1",
    status: "实验暂停",
  }],
  experimentRuns: [{ run_no: "RUN-1", status: "实验暂停", tray_codes: ["TP-1"] }],
  experimentRunTrays: [{ run_no: "RUN-1", tray_code: "TP-1" }],
  trayCode: "TP-1",
  ...overrides,
});

describe("saltSprayPauseDisplay", () => {
  test("derives the pause remark only after the authoritative pause acknowledgement", () => {
    expect(resolveSaltSprayPauseRemark(input())).toBe(SALT_SPRAY_PAUSE_REMARK);
    expect(resolveSaltSprayPauseRemark(input({ experimentRunPauses: [] }))).toBe("");
    expect(resolveSaltSprayPauseRemark(input({
      experimentRuns: [{ run_no: "RUN-1", status: "实验进行中", tray_codes: ["TP-1"] }],
    }))).toBe("");
  });

  test("clears the derived remark on resume or stop acknowledgement", () => {
    expect(resolveSaltSprayPauseRemark(input({
      experimentRunPauses: [{ lab_code: "LAB_SALT", run_no: "RUN-1", status: "实验已恢复", resumed_at: "2026-09-02 10:10:00" }],
    }))).toBe("");
    expect(resolveSaltSprayPauseRemark(input({
      experimentRunPauses: [{ lab_code: "LAB_SALT", run_no: "RUN-1", status: "实验已停止", stopped_at: "2026-09-02 10:10:00" }],
    }))).toBe("");
  });

  test("scopes the remark to salt spray trays and supports run-level consumers", () => {
    expect(resolveSaltSprayPauseRemark(input({ trayCode: "TP-OTHER" }))).toBe("");
    expect(resolveSaltSprayPauseRemark(input({ runNo: "RUN-1", trayCode: "" }))).toBe(SALT_SPRAY_PAUSE_REMARK);
    expect(resolveSaltSprayPauseRemark(input({
      experimentRunPauses: [{ lab_code: "LAB_MOLD", run_no: "RUN-1", status: "实验暂停" }],
    }))).toBe("");
  });

  test("decorates only the active salt-spray running label while a pause is active", () => {
    expect(resolveSaltSprayPauseFlowLabel("盐雾试验进行中", SALT_SPRAY_PAUSE_REMARK))
      .toBe("盐雾试验进行中（暂停）");
    expect(resolveSaltSprayPauseFlowLabel("盐雾试验进行中", "")).toBe("盐雾试验进行中");
    expect(resolveSaltSprayPauseFlowLabel("振动试验进行中", SALT_SPRAY_PAUSE_REMARK))
      .toBe("振动试验进行中");
  });

  test("projects mid-experiment appearance only from the current pause and tray", () => {
    const scopedInput = input({
      experimentRunPauses: [
        { lab_code: "LAB_SALT", pause_no: "PAUSE-OLD", run_no: "RUN-1", status: "实验已恢复", resumed_at: "2026-09-02 09:30:00" },
        { inspection_tray_codes: ["TP-1", "TP-2"], lab_code: "LAB_SALT", pause_no: "PAUSE-2", paused_at: "2026-09-02 10:00:00", run_no: "RUN-1", status: "实验暂停" },
      ],
      experimentRunTrays: [
        { run_no: "RUN-1", tray_code: "TP-1" },
        { run_no: "RUN-1", tray_code: "TP-2" },
      ],
      stagingEvents: [
        { action: "stock_in", appearance_phase: "mid_experiment", pause_no: "PAUSE-OLD", room: "appearance", run_no: "RUN-1", time: "2026-09-02 09:10:00", tray_code: "TP-1" },
        { action: "stock_in", appearance_phase: "mid_experiment", pause_no: "PAUSE-2", room: "appearance", run_no: "RUN-1", time: "2026-09-02 10:10:00", tray_code: "TP-1" },
        { action: "stock_out", appearance_phase: "mid_experiment", pause_no: "PAUSE-2", room: "appearance", run_no: "RUN-1", target_lab: "盐雾试验室", time: "2026-09-02 10:20:00", tray_code: "TP-2" },
      ],
    });

    expect(resolveSaltSprayMidExperimentAppearance(scopedInput)).toEqual({
      pauseNo: "PAUSE-2",
      returnedAt: "",
      runNo: "RUN-1",
      stockedAt: "2026-09-02 10:10:00",
      visible: true,
    });
    expect(resolveSaltSprayMidExperimentAppearance({ ...scopedInput, trayCode: "TP-2" })).toEqual({
      pauseNo: "PAUSE-2",
      returnedAt: "2026-09-02 10:20:00",
      runNo: "RUN-1",
      stockedAt: "",
      visible: false,
    });
  });

  test("derives resume preparation only from the current run pause and tray", () => {
    const preparation = resolveSaltSprayResumePreparation(input({
      stagingEvents: [
        { action: "resume_preparation_started", pause_no: "PAUSE-1", room: "laboratory_resume_preparation", run_no: "RUN-1", time: "2026-09-05 09:00:00", tray_code: "TP-1" },
        { action: "resume_preparation_compared", pause_no: "PAUSE-1", room: "laboratory_resume_preparation", run_no: "RUN-1", time: "2026-09-05 09:01:00", tray_code: "TP-1" },
        { action: "resume_preparation_installed", pause_no: "PAUSE-OLD", room: "laboratory_resume_preparation", run_no: "RUN-1", time: "2026-09-05 09:02:00", tray_code: "TP-1" },
        { action: "resume_preparation_ready", pause_no: "PAUSE-1", room: "laboratory_resume_preparation", run_no: "RUN-1", time: "2026-09-05 09:03:00", tray_code: "TP-OTHER" },
      ],
    }));

    expect(preparation).toEqual(expect.objectContaining({
      compared: true,
      comparedAt: "2026-09-05 09:01:00",
      installed: false,
      pauseNo: "PAUSE-1",
      ready: false,
      runNo: "RUN-1",
      started: true,
    }));
  });
});
