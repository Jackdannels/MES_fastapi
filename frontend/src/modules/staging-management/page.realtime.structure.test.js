import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/modules/staging-management/page.vue");

describe("StagingManagementPage realtime refresh structure", () => {
  test("subscribes to storage updates without refreshing over scan dialogs", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("paused: isRealtimeRefreshPaused");
    expect(source).toContain("handleSamplesUpdated");
    expect(source).toContain("hasPendingSamplesRefresh");
    expect(source).toContain("scanModalOpen.value");
    expect(source).toContain("destinationModalOpen.value");
    expect(source).toContain("returnDangerModalOpen.value");
    expect(source).toContain("STORAGE_KEYS.tasks");
    expect(source).toContain("STORAGE_KEYS.samples");
    expect(source).toContain("STORAGE_KEYS.staging_events");
  });
});
