import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const routerPath = resolve(process.cwd(), "src/router/index.js");
const modulesPath = resolve(process.cwd(), "src/modules/index.js");

describe("router structure", () => {
  test("aggregates routes from the modules registry instead of importing page files directly", () => {
    const source = readFileSync(routerPath, "utf8");

    expect(source).toContain('from "@/modules"');
    expect(source).not.toContain('from "@/pages/LoginPage.vue"');
    expect(source).not.toContain('from "@/pages/DashboardPage.vue"');
    expect(source).not.toContain('from "@/pages/TaskOverviewPage.vue"');
    expect(source).not.toContain('from "@/pages/TasksPage.vue"');
    expect(source).not.toContain('from "@/pages/SchedulePage.vue"');
    expect(source).not.toContain('from "@/pages/SamplesPage.vue"');
    expect(source).not.toContain('from "@/pages/ProcessPage.vue"');
    expect(source).not.toContain('from "@/pages/DevicesPage.vue"');
    expect(source).not.toContain('from "@/pages/DataPage.vue"');
    expect(source).not.toContain('from "@/pages/SystemPage.vue"');
  });

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
    expect(source).not.toContain("涓冧簩鍥涙柊鐏伐鍖轰俊鎭寲涓帶绠＄悊绯荤粺`");
  });

  test("registers sample pre-allocation and task history through the modules registry", () => {
    const source = readFileSync(modulesPath, "utf8");

    expect(source).toContain('from "./sample-pre-allocation"');
    expect(source).toContain('from "./task-history"');
  });
});
