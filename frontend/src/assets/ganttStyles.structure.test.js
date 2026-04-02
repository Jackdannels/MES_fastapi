import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("gantt styles", () => {
  test("gantt slots stay centered and visually distinct by state in the schedule module stylesheet", () => {
    const moduleCssPath = resolve(process.cwd(), "src/modules/schedule/styles.css");
    const moduleCssSource = readFileSync(moduleCssPath, "utf8");
    const sharedComponentsCssPath = resolve(process.cwd(), "src/shared/styles/components.css");
    const sharedComponentsCssSource = readFileSync(sharedComponentsCssPath, "utf8");

    expect(moduleCssSource).toContain("vertical-align: middle;");
    expect(moduleCssSource).toContain("width: 100%;");
    expect(moduleCssSource).toContain("appearance: none;");
    expect(moduleCssSource).toContain(".gantt tbody tr:hover td .gantt-slot.idle");
    expect(moduleCssSource).toContain(".gantt tbody tr:hover td .gantt-slot.busy");
    expect(sharedComponentsCssSource).not.toContain(".gantt-slot");
  });

  test("gantt stacked task styles stay in the schedule module stylesheet", () => {
    const moduleCssPath = resolve(process.cwd(), "src/modules/schedule/styles.css");
    const moduleCssSource = readFileSync(moduleCssPath, "utf8");
    const sharedComponentsCssPath = resolve(process.cwd(), "src/shared/styles/components.css");
    const sharedComponentsCssSource = readFileSync(sharedComponentsCssPath, "utf8");

    expect(moduleCssSource).toContain(".gantt-slot--stacked");
    expect(moduleCssSource).toContain(".gantt-slot--split");
    expect(moduleCssSource).toContain(".gantt-slot.busy:not(.gantt-slot--stacked):not(.gantt-slot--split) {");
    expect(moduleCssSource).toContain(".gantt-task-item");
    expect(moduleCssSource).toContain(".gantt-task-overflow");
    expect(moduleCssSource).toContain("height: 100%;");
    expect(moduleCssSource).toContain("border-radius: 0;");
    expect(sharedComponentsCssSource).not.toContain(".gantt-task-item");
  });

  test("gantt busy hover and focus styles preserve task fills with lightweight highlighting", () => {
    const moduleCssPath = resolve(process.cwd(), "src/modules/schedule/styles.css");
    const moduleCssSource = readFileSync(moduleCssPath, "utf8");

    expect(moduleCssSource).toContain(".gantt-slot.focus {");
    expect(moduleCssSource).toContain(".gantt tbody tr:hover td .gantt-slot.busy:not(.gantt-slot--stacked):not(.gantt-slot--split) {");
    expect(moduleCssSource).toContain("box-shadow:");
    expect(moduleCssSource).not.toContain(".gantt tbody tr:hover td .gantt-slot.busy {\n  background: rgba(191, 219, 254, 0.82);");
  });
});
