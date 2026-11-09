import { execFileSync } from "node:child_process";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

describe("legacy fallback report script", () => {
  let fixtureDirectory;
  let snapshotPath;
  beforeAll(() => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), "mes-legacy-report-test-"));
    snapshotPath = join(fixtureDirectory, "snapshot.json");
    writeFileSync(snapshotPath, JSON.stringify({
      "mes.tasks": [{ code: "TASK-REPORT", test_type: "振动试验" }],
      "mes.experiments": [{ task_code: "TASK-REPORT", experiment_code: "EXP-REPORT", experiment_name: "振动试验", required_device: "振动试验" }],
      "mes.experiment_runs": [{
        task_code: "TASK-REPORT", experiment_code: "EXP-REPORT", run_no: "RUN-REPORT-COMPLETED",
        device: "振动一室", lab_code: "LAB_VIBRATION_1", status: "实验已完成", ended_at: "2026-11-09 09:00:00",
      }],
      "mes.experiment_trays": [{ task_code: "TASK-REPORT", experiment_code: "EXP-REPORT", tray_code: "TP-REPORT" }],
      "mes.samples": [{
        code: "SP-REPORT", task_code: "TASK-REPORT", status: "实验已完成", location: "振动一室",
        trays: [{ tray_code: "TP-REPORT", status: "实验已完成" }], history: [],
      }],
    }), "utf8");
  });
  afterAll(() => {
    // Only this file and its empty directory; no recursive workspace cleanup.
    if (snapshotPath) unlinkSync(snapshotPath);
    if (fixtureDirectory) rmdirSync(fixtureDirectory);
  });

  test("prints separate frontend and backend fallback summaries for an isolated snapshot", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/legacy-fallback-snapshot-report.mjs"), "--snapshot", snapshotPath],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      }
    );

    expect(output).toContain("Frontend legacy fallback hits:");
    expect(output).toContain("Backend legacy fallback hits:");
    expect(output).toContain("Backend risk examples:");
  });

  test("includes backend risk examples with run context in json output", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/legacy-fallback-snapshot-report.mjs"), "--json", "--snapshot", snapshotPath],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      }
    );

    const report = JSON.parse(output);
    const recentRunRisk = report.backend.phases
      .flatMap((phase) => phase.risks)
      .find((risk) => risk.id === "backend.mq.experiment_result.recent_completed_run_fallback");

    expect(recentRunRisk).toEqual(expect.objectContaining({
      examples: expect.arrayContaining([
        expect.objectContaining({
          experimentCode: "EXP-REPORT",
          lab: "LAB_VIBRATION_1",
          runNo: "RUN-REPORT-COMPLETED",
          taskCode: "TASK-REPORT",
        }),
      ]),
    }));
  });
});
