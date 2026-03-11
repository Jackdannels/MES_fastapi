import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("legacy boot entry", () => {
  test("loads the frontend-local legacy runtime instead of backend static scripts", () => {
    const source = readFileSync(resolve(process.cwd(), "src/legacy/boot.js"), "utf8");

    expect(source).toContain('import("./runtime/main.js")');
    expect(source).not.toContain("/static/js/main.js");
    expect(source).not.toContain('document.createElement("script")');
  });
});
