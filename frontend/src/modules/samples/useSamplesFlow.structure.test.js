import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const sourcePath = resolve(process.cwd(), "src/modules/samples/useSamplesFlow.js");

describe("useSamplesFlow realtime refresh structure", () => {
  test("subscribes to storage updates without refreshing over open sample dialogs", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("paused: isRealtimeRefreshPaused");
    expect(source).toContain("handleSamplesUpdated");
    expect(source).toContain("hasPendingSamplesRefresh");
    expect(source).toContain("batchModal.open.value");
    expect(source).toContain("detailDrawer.open.value");
    expect(source).toContain("STORAGE_KEYS.tasks");
    expect(source).toContain("STORAGE_KEYS.samples");
    expect(source).toContain("STORAGE_KEYS.experiment_trays");
  });
});
