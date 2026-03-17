import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("frontend app styles", () => {
  test("frontend style entry composes shared style layers without reaching outside frontend", () => {
    const appCssPath = resolve(process.cwd(), "src/assets/app.css");
    const appCssSource = readFileSync(appCssPath, "utf8");

    expect(appCssSource).not.toContain("../../../app/static/app.css");
    expect(appCssSource).toContain('@import "../shared/styles/base.css"');
    expect(appCssSource).toContain('@import "../shared/styles/shell.css"');
    expect(appCssSource).toContain('@import "../shared/styles/components.css"');
    expect(existsSync(resolve(process.cwd(), "src/shared/styles/base.css"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "src/shared/styles/shell.css"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "src/shared/styles/components.css"))).toBe(true);
    expect(appCssSource).not.toContain('@import "./mes-app.css"');
  });

  test("shared components layer does not duplicate shared base and shell layers", () => {
    const componentsCssPath = resolve(process.cwd(), "src/shared/styles/components.css");
    const componentsCssSource = readFileSync(componentsCssPath, "utf8");

    expect(componentsCssSource).not.toContain('@import url("https://fonts.googleapis.com');
    expect(componentsCssSource).not.toMatch(/^:root\s*\{/m);
    expect(componentsCssSource).not.toMatch(/^\*\s*\{/m);
    expect(componentsCssSource).not.toMatch(/^body\s*\{/m);
    expect(componentsCssSource).not.toMatch(/^\.app-shell\s*\{/m);
    expect(componentsCssSource).not.toMatch(/^\.sidebar\s*\{/m);
    expect(componentsCssSource).not.toMatch(/^\.brand\s*\{/m);
    expect(componentsCssSource).not.toMatch(/^\.nav a\s*\{/m);
    expect(componentsCssSource).not.toMatch(/^@media\s*\(max-width:\s*980px\)\s*\{/m);
  });
});
