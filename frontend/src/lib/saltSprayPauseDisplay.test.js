import { describe, expect, test } from "vitest";

import { SALT_SPRAY_PAUSE_REMARK, resolveSaltSprayPauseRemark } from "./saltSprayPauseDisplay";

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
});
