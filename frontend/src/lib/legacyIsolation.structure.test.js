import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const readSource = (relativePath) => readFileSync(resolve(process.cwd(), relativePath), "utf8");
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

describe("legacy isolation", () => {
  test("App task intake integration test does not depend on legacy boot mocks", () => {
    const source = readSource("src/App.task-intake.integration.test.js");

    expect(source).not.toContain('./legacy/boot.js');
    expect(source).not.toContain("bootLegacyUI");
  });

  test("business-side source files do not import the legacy archive", () => {
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

  test("legacy archive carries a local isolation note", () => {
    const source = readSource("src/legacy/README.md");

    expect(source).toContain("已隔离为归档区");
  });
});
