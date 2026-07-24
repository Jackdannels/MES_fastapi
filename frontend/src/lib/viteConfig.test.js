import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("vite.config", () => {
  test("build output stays inside the frontend workspace", () => {
    const configSource = readFileSync(resolve(process.cwd(), "vite.config.js"), "utf8");

    expect(configSource).toContain('outDir: "dist"');
    expect(configSource).not.toContain('outDir: "../app/static/dist"');
  });

  test("frontend base path no longer depends on backend static directories", () => {
    const configSource = readFileSync(resolve(process.cwd(), "vite.config.js"), "utf8");

    expect(configSource).toContain('base: "/"');
    expect(configSource).not.toContain('base: "/static/dist/"');
  });

  test("dev server no longer opens parent directories for backend asset coupling", () => {
    const configSource = readFileSync(resolve(process.cwd(), "vite.config.js"), "utf8");

    expect(configSource).not.toContain('allow: [".."]');
    expect(configSource).not.toContain("allow: ['..']");
  });

  test("build warnings are not hidden instead of fixing bundle size", () => {
    const configSource = readFileSync(resolve(process.cwd(), "vite.config.js"), "utf8");

    expect(configSource).not.toContain("chunkSizeWarningLimit");
  });
});
