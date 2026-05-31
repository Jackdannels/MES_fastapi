import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const sourcePath = resolve(process.cwd(), "src/modules/process/useProcessLabs.js");

describe("useProcessLabs realtime refresh structure", () => {
  test("uses the shared snapshot refresh hook with process modal pause guards", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("paused: isProcessRealtimeRefreshPaused");
    expect(source).toContain("handleSamplesUpdated");
    expect(source).toContain("hasPendingSamplesRefresh");
    expect(source).toContain("taskDrawerOpen.value");
    expect(source).toContain("startExperimentModalOpen.value");
    expect(source).not.toContain("subscribeStorageSnapshotUpdates");
    expect(source).not.toContain("SNAPSHOT_UPDATED_STORAGE_KEY");
  });
});
