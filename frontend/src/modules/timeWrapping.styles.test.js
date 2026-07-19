import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const laboratoryStylesPath = resolve(process.cwd(), "src/modules/laboratory/styles.css");
const processStylesPath = resolve(process.cwd(), "src/modules/process/styles.css");
const scheduleStylesPath = resolve(process.cwd(), "src/modules/schedule/styles.css");

const ruleFrom = (source, selector) => {
  const start = source.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const openBrace = source.indexOf("{", start);
  expect(openBrace).toBeGreaterThanOrEqual(0);
  const closeBrace = source.indexOf("}", openBrace);
  expect(closeBrace).toBeGreaterThan(openBrace);
  return source.slice(start, closeBrace + 1);
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

  test("keeps laboratory tray flow steps wide enough for status labels", () => {
    const source = readFileSync(laboratoryStylesPath, "utf8");

    const trayRule = ruleFrom(source, ".laboratory-flow-steps--tray");
    const trayItemRule = ruleFrom(source, ".laboratory-flow-steps--tray li");
    const labelRule = ruleFrom(source, ".laboratory-flow-label");
    const timeRule = ruleFrom(source, ".laboratory-flow-time");

    expect(trayRule).toContain("repeat(auto-fit, minmax(220px, 1fr))");
    expect(trayRule).not.toContain("repeat(4, minmax(0, 1fr))");
    expect(trayItemRule).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(trayItemRule).toContain("grid-template-rows: auto auto;");
    expect(labelRule).toContain("min-width: 0;");
    expect(labelRule).toContain("overflow-wrap: anywhere;");
    expect(timeRule).toContain("overflow: hidden;");
    expect(timeRule).toContain("text-overflow: ellipsis;");
    expect(timeRule).toContain("white-space: nowrap;");
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
