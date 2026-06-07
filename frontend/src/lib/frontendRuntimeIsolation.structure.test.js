import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const readSource = (relativePath) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

const extractRouteBlock = (source, routeName) => {
  const start = source.indexOf(`name: "${routeName}"`);
  if (start === -1) {
    return "";
  }

  const nextRoute = source.indexOf("\n  {\n", start + 1);
  if (nextRoute === -1) {
    return source.slice(start);
  }

  return source.slice(start, nextRoute);
};

const walk = (rootRelativePath) => {
  const rootAbsolutePath = resolve(process.cwd(), rootRelativePath);
  const entries = readdirSync(rootAbsolutePath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = `${rootRelativePath}/${entry.name}`;
    const absolutePath = resolve(process.cwd(), relativePath);
    if (entry.isDirectory()) {
      return walk(relativePath);
    }
    if (!statSync(absolutePath).isFile()) {
      return [];
    }
    return [relativePath];
  });
};

describe("frontend runtime isolation", () => {
  test("App task intake integration test stays on the Vue runtime path", () => {
    const source = readSource("src/App.task-intake.integration.test.js");

    expect(source).not.toContain("./legacy/boot.js");
    expect(source).not.toContain("bootLegacyUI");
  });

  test("business-side source files do not import the archived DOM runtime", () => {
    const sourceFiles = walk("src").filter(
      (file) =>
        !file.startsWith("src/legacy/") &&
        !file.endsWith(".test.js") &&
        !file.endsWith(".structure.test.js")
    );

    sourceFiles.forEach((file) => {
      const source = readSource(file);
      expect(source, file).not.toContain("/legacy/");
      expect(source, file).not.toContain("./legacy/");
    });
  });

  test("migrated module routes do not opt into the archived DOM runtime", () => {
    const source = readSource("src/router/index.js");
    const migratedRouteNames = ["dashboard", "tasks", "schedule", "samples", "data", "devices", "system"];

    migratedRouteNames.forEach((routeName) => {
      expect(extractRouteBlock(source, routeName), routeName).not.toContain("legacyUi: true");
    });
  });

  test("archived DOM runtime directory has been removed", () => {
    expect(existsSync(resolve(process.cwd(), "src/legacy"))).toBe(false);
  });
});
