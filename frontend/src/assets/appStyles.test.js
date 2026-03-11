import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("frontend app styles", () => {
  test("frontend style entry only depends on files inside frontend assets", () => {
    const appCssPath = resolve(process.cwd(), "src/assets/app.css");
    const appCssSource = readFileSync(appCssPath, "utf8");

    expect(appCssSource).not.toContain("../../../app/static/app.css");
    expect(appCssSource).toContain('@import "./mes-app.css"');
    expect(existsSync(resolve(process.cwd(), "src/assets/mes-app.css"))).toBe(true);
  });
});
