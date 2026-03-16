import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const readSource = (relativePath) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("vue migration structure", () => {
  test("App.vue no longer references legacy ui bridge runtime", () => {
    const source = readSource("src/App.vue");

    expect(source).not.toContain("shouldBridgeLegacyUi");
    expect(source).not.toContain("bootLegacyUI");
    expect(source).not.toContain("legacyUiBootKey");
  });

  test("page models and schedule test no longer import labs from legacy runtime", () => {
    const files = [
      "src/lib/tasksPageModel.js",
      "src/lib/devicesPageModel.js",
      "src/lib/schedulePageModel.js",
      "src/pages/SchedulePage.runtime.test.js",
    ];

    files.forEach((file) => {
      expect(readSource(file)).not.toContain("@/legacy/runtime/labs");
    });
  });
});
