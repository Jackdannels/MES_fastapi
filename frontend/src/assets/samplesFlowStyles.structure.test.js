import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("samples flow styles", () => {
  test("current flow step keeps the industrial active state in the samples module stylesheet", () => {
    const moduleCssPath = resolve(process.cwd(), "src/modules/samples/styles.css");
    const moduleCssSource = readFileSync(moduleCssPath, "utf8");
    const sharedComponentsCssPath = resolve(process.cwd(), "src/shared/styles/components.css");
    const sharedComponentsCssSource = readFileSync(sharedComponentsCssPath, "utf8");

    expect(moduleCssSource).toContain(".sample-flow-unified li.current {");
    expect(moduleCssSource).toContain("border-color: rgba(var(--industrial-accent-rgb), 0.48);");
    expect(moduleCssSource).toContain("background: rgba(var(--industrial-accent-rgb), 0.16);");
    expect(moduleCssSource).toContain("color: var(--accent);");
    expect(moduleCssSource).toContain(".sample-flow-unified li.current::before {");
    expect(moduleCssSource).toContain("background: rgba(34, 197, 94, 0.9);");
    expect(sharedComponentsCssSource).not.toContain(".sample-flow-unified li.current {");
  });
});
