import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const sourcePath = resolve(process.cwd(), "src/modules/laboratory/useLaboratoryPage.js");
const realtimeSourcePath = resolve(process.cwd(), "src/modules/laboratory/useLaboratoryRealtimeRefresh.js");

describe("useLaboratoryPage realtime refresh structure", () => {
  test("uses the shared snapshot refresh hook without loading over active operation modals", () => {
    const pageSource = readFileSync(sourcePath, "utf8");
    const source = readFileSync(realtimeSourcePath, "utf8");

    expect(pageSource).toContain('import { useLaboratoryRealtimeRefresh } from "./useLaboratoryRealtimeRefresh"');
    expect(pageSource).toContain("useLaboratoryRealtimeRefresh({");
    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("paused: isLaboratoryRealtimeRefreshPaused");
    expect(source).toContain("handleSamplesUpdated");
    expect(source).toContain("hasPendingSamplesRefresh");
    expect(source).toContain("compareModalOpen.value");
    expect(source).toContain("installModalOpen.value");
    expect(source).toContain("readyModalOpen.value");
    expect(source).toContain("resetDangerModalOpen.value");
    expect(source).not.toContain("subscribeStorageSnapshotUpdates");
    expect(source).not.toContain("SNAPSHOT_UPDATED_STORAGE_KEY");
  });
});
