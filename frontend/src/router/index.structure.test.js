import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const routerPath = resolve(process.cwd(), "src/router/index.js");
const modulesPath = resolve(process.cwd(), "src/modules/index.js");

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

  test("does not mark migrated dashboard, tasks, schedule, samples, data, devices, or system routes as legacy ui", () => {
    const source = readFileSync(routerPath, "utf8");
    const dashboardBlock = extractRouteBlock(source, "dashboard");
    const tasksBlock = extractRouteBlock(source, "tasks");
    const scheduleBlock = extractRouteBlock(source, "schedule");
    const samplesBlock = extractRouteBlock(source, "samples");
    const dataBlock = extractRouteBlock(source, "data");
    const devicesBlock = extractRouteBlock(source, "devices");
    const systemBlock = extractRouteBlock(source, "system");

    expect(dashboardBlock).not.toContain("legacyUi: true");
    expect(tasksBlock).not.toContain("legacyUi: true");
    expect(scheduleBlock).not.toContain("legacyUi: true");
    expect(samplesBlock).not.toContain("legacyUi: true");
    expect(dataBlock).not.toContain("legacyUi: true");
    expect(devicesBlock).not.toContain("legacyUi: true");
    expect(systemBlock).not.toContain("legacyUi: true");
  });

  test("registers sample pre-allocation and task history through the modules registry", () => {
    const source = readFileSync(modulesPath, "utf8");

    expect(source).toContain('from "./sample-pre-allocation"');
    expect(source).toContain('from "./task-history"');
  });
});
