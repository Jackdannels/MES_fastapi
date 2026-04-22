import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const stylesPath = resolve(process.cwd(), "src/shared/styles/components.css");

describe("shared table styles", () => {
  test("centers table headers and cells by default", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.table th\s*\{[^}]*text-align:\s*center/i);
    expect(source).toMatch(/\.table td\s*\{[^}]*text-align:\s*center/i);
    expect(source).not.toMatch(/text-align:\s*middle/i);
  });
});
