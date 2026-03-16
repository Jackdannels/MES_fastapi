import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("gantt styles", () => {
  test("gantt slots stay centered and visually distinct by state", () => {
    const cssPath = resolve(process.cwd(), "src/assets/mes-app.css");
    const cssSource = readFileSync(cssPath, "utf8");

    expect(cssSource).toContain("vertical-align: middle;");
    expect(cssSource).toContain("width: 100%;");
    expect(cssSource).toContain("appearance: none;");
    expect(cssSource).toContain(".gantt tbody tr:hover td .gantt-slot.idle");
    expect(cssSource).toContain(".gantt tbody tr:hover td .gantt-slot.busy");
  });
});
