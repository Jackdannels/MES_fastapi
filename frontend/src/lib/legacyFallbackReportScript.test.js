import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("legacy fallback report script", () => {
  test("prints separate frontend and backend fallback summaries for the default snapshot", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/legacy-fallback-snapshot-report.mjs")],
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
      [resolve(process.cwd(), "scripts/legacy-fallback-snapshot-report.mjs"), "--json"],
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
          experimentCode: expect.any(String),
          lab: expect.any(String),
          runNo: expect.any(String),
          taskCode: expect.any(String),
        }),
      ]),
    }));
  });
});
