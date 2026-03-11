import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const routerPath = resolve(process.cwd(), "src/router/index.js");

describe("router structure", () => {
  test("delegates auth guard logic to authRouting helpers", () => {
    const source = readFileSync(routerPath, "utf8");

    expect(source).toContain("buildRouteAccessDecision");
    expect(source).toContain("fetchAuthSession");
    expect(source).not.toContain("if (!isAuthenticated())");
    expect(source).not.toContain("selectedModule !== targetModule");
  });

  test("delegates document title building to routerTitle helpers", () => {
    const source = readFileSync(routerPath, "utf8");

    expect(source).toContain("buildDocumentTitle");
    expect(source).not.toContain("document.title = to.meta?.title");
    expect(source).not.toContain("七二四新火工区信息化中控管理系统`");
  });
});
