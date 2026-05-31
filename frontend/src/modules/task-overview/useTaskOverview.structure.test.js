import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const sourcePath = resolve(process.cwd(), "src/modules/task-overview/useTaskOverview.js");

describe("useTaskOverview realtime refresh structure", () => {
  test("uses storage snapshot refresh without refreshing over an active editor", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("paused: isRealtimeRefreshPaused");
    expect(source).toContain("handleSamplesUpdated");
    expect(source).toContain("hasPendingSamplesRefresh");
    expect(source).toContain("editingTaskCode.value");
    expect(source).toContain("deletingTaskCode.value");
    expect(source).toContain("STORAGE_KEYS.tasks");
    expect(source).toContain("STORAGE_KEYS.samples");
    expect(source).toContain("STORAGE_KEYS.experiment_trays");
  });
});
