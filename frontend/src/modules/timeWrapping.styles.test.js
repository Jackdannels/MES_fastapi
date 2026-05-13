import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const laboratoryStylesPath = resolve(process.cwd(), "src/modules/laboratory/styles.css");
const processStylesPath = resolve(process.cwd(), "src/modules/process/styles.css");
const scheduleStylesPath = resolve(process.cwd(), "src/modules/schedule/styles.css");

const ruleFrom = (source, selector) => {
  const start = source.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
};

describe("time wrapping styles", () => {
  test("allows laboratory recent task time ranges to wrap at small zoom levels", () => {
    const source = readFileSync(laboratoryStylesPath, "utf8");

    const rule = ruleFrom(source, ".laboratory-recent-task__time");

    expect(rule).toContain("overflow-wrap: anywhere;");
    expect(rule).toContain("word-break: break-word;");
  });

  test("allows laboratory task list start and end time cells to wrap", () => {
    const source = readFileSync(laboratoryStylesPath, "utf8");

    const rule = ruleFrom(source, ".laboratory-task-list-card td:nth-child(3)");

    expect(rule).toContain("white-space: normal;");
    expect(rule).toContain("overflow-wrap: anywhere;");
    expect(rule).toContain("word-break: break-word;");
  });

  test("allows process card schedule time values to shrink and wrap", () => {
    const source = readFileSync(processStylesPath, "utf8");

    const rule = ruleFrom(source, ".process-lab-row strong");

    expect(rule).toContain("min-width: 0;");
    expect(rule).toContain("white-space: normal;");
    expect(rule).toContain("overflow-wrap: anywhere;");
  });

  test("allows schedule list start and end time cells to wrap", () => {
    const source = readFileSync(scheduleStylesPath, "utf8");

    const rule = ruleFrom(source, "#schedule-table td:nth-child(5)");

    expect(rule).toContain("white-space: normal;");
    expect(rule).toContain("overflow-wrap: anywhere;");
    expect(rule).toContain("word-break: break-word;");
  });
});
