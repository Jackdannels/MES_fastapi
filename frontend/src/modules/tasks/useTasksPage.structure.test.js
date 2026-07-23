import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const sourcePath = resolve(process.cwd(), "src/modules/tasks/useTasksPage.js");
const realtimePath = resolve(process.cwd(), "src/modules/tasks/useTasksRealtime.js");

describe("useTasksPage realtime refresh structure", () => {
  test("subscribes to storage updates without refreshing over open task dialogs", () => {
    const pageSource = readFileSync(sourcePath, "utf8");
    const realtimeSource = readFileSync(realtimePath, "utf8");
    const source = [pageSource, realtimeSource].join("\n");

    expect(pageSource).toContain("useTasksRealtime({");
    expect(realtimeSource).toContain("function useTasksRealtime");
    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("paused: isRealtimeRefreshPaused");
    expect(source).toContain("handleSamplesUpdated");
    expect(source).toContain("hasPendingSamplesRefresh");
    expect(source).toContain("intakeModal.open.value");
    expect(source).toContain("taskDrawer.open.value");
    expect(source).toContain("resetModal.open.value");
    expect(source).toContain("STORAGE_KEYS.tasks");
    expect(source).toContain("STORAGE_KEYS.samples");
    expect(source).toContain("STORAGE_KEYS.experiment_samples");
  });
});
