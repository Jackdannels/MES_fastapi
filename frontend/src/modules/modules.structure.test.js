import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const modulesIndexPath = resolve(process.cwd(), "src/modules/index.js");
const moduleEntryPaths = [
  resolve(process.cwd(), "src/modules/dashboard/index.js"),
  resolve(process.cwd(), "src/modules/task-overview/index.js"),
  resolve(process.cwd(), "src/modules/tasks/index.js"),
  resolve(process.cwd(), "src/modules/schedule/index.js"),
  resolve(process.cwd(), "src/modules/samples/index.js"),
  resolve(process.cwd(), "src/modules/handover-system/index.js"),
  resolve(process.cwd(), "src/modules/process/index.js"),
  resolve(process.cwd(), "src/modules/devices/index.js"),
  resolve(process.cwd(), "src/modules/data/index.js"),
  resolve(process.cwd(), "src/modules/system/index.js"),
  resolve(process.cwd(), "src/modules/visualization/index.js"),
  resolve(process.cwd(), "src/modules/staging-management/index.js"),
  resolve(process.cwd(), "src/modules/appearance-inspection/index.js"),
  resolve(process.cwd(), "src/modules/laboratory/index.js"),
];

describe("frontend module registry structure", () => {
  test("defines a module registry file for page routes", () => {
    expect(existsSync(modulesIndexPath)).toBe(true);
  });

  test("exports route definitions for current pages", () => {
    const source = readFileSync(modulesIndexPath, "utf8");

    expect(source).toContain("login");
    expect(source).toContain("dashboard");
    expect(source).toContain("task-overview");
    expect(source).toContain("tasks");
    expect(source).toContain("schedule");
    expect(source).toContain("samples");
    expect(source).toContain("handover-system");
    expect(source).toContain("process");
    expect(source).toContain("devices");
    expect(source).toContain("data");
    expect(source).toContain("system");
    expect(source).toContain("visualization");
    expect(source).toContain("staging-management");
    expect(source).toContain("appearance-inspection");
    expect(source).toContain("laboratory");
  });

  test("navigation modules define non-placeholder subtitles", () => {
    for (const moduleEntryPath of moduleEntryPaths) {
      const source = readFileSync(moduleEntryPath, "utf8");

      expect(source).toContain("subtitle:");
      expect(source).not.toContain("预留");
      expect(source).not.toContain("分界面");
    }
  });
});
