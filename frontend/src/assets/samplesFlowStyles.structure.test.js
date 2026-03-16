import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("samples flow styles", () => {
  test("current flow step keeps the green active state", () => {
    const cssPath = resolve(process.cwd(), "src/assets/mes-app.css");
    const cssSource = readFileSync(cssPath, "utf8");

    expect(cssSource).toContain(".sample-flow-unified li.current {");
    expect(cssSource).toContain("border-color: rgba(34, 197, 94, 0.45);");
    expect(cssSource).toContain("background: rgba(34, 197, 94, 0.14);");
    expect(cssSource).toContain(".sample-flow-unified li.current::before {");
    expect(cssSource).toContain("background: rgba(34, 197, 94, 0.9);");
  });
});
