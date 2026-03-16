import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("legacy deletion batch one", () => {
  test("removes the obsolete legacy boot chain files", () => {
    [
      "src/legacy/boot.js",
      "src/legacy/boot.structure.test.js",
      "src/legacy/legacyMainBoot.test.js",
      "src/legacy/runtime/main.js",
      "src/legacy/runtime/main.structure.test.js",
      "src/legacy/runtime/actions.js",
      "src/legacy/runtime/labels.js",
      "src/legacy/runtime/labels.structure.test.js",
      "src/legacy/runtime/labs.js",
      "src/legacy/runtime/labs.structure.test.js",
      "src/legacy/runtime/render.js",
      "src/legacy/runtime/seed.js",
      "src/legacy/runtime/storage.js",
      "src/legacy/runtime/ui.js",
      "src/legacy/runtime/utils.js",
    ].forEach((relativePath) => {
      expect(existsSync(resolve(process.cwd(), relativePath)), relativePath).toBe(false);
    });
  });

  test("sample utf8 sanitization structure test no longer reads legacy actions source", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/sampleUtf8Sanitization.structure.test.js"), "utf8");

    expect(source).not.toContain("legacyActionsPath");
    expect(source).not.toContain("readFileSync(legacyActionsPath");
  });
});
