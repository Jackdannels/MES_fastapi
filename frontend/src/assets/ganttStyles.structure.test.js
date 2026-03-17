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
});
