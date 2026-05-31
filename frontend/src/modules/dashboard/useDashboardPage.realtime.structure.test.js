import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const sourcePath = resolve(process.cwd(), "src/modules/dashboard/useDashboardPage.js");

describe("useDashboardPage realtime refresh structure", () => {
  test("uses shared snapshot refresh for dashboard data instead of data polling", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("handleSamplesUpdated");
    expect(source).toContain("STORAGE_KEYS.tasks");
    expect(source).toContain("STORAGE_KEYS.devices");
    expect(source).toContain("STORAGE_KEYS.experiments");
    expect(source).not.toContain("DASHBOARD_REFRESH_INTERVAL_MS");
    expect(source).not.toContain("dashboardRefreshTimer");
    expect(source).not.toContain('window.addEventListener("storage"');
    expect(source).not.toContain('window.addEventListener("focus"');
  });
});
