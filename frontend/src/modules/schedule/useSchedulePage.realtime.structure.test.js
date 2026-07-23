import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/modules/schedule/useSchedulePage.js");
const realtimePath = resolve(process.cwd(), "src/modules/schedule/useScheduleRealtime.js");

describe("useSchedulePage realtime refresh structure", () => {
  test("uses snapshot refresh without polling or refreshing over schedule dialogs", () => {
    const pageSource = readFileSync(pagePath, "utf8");
    const realtimeSource = readFileSync(realtimePath, "utf8");
    const source = `${pageSource}\n${realtimeSource}`;

    expect(pageSource).toContain("useScheduleRealtime({");
    expect(realtimeSource).toContain("function useScheduleRealtime");
    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("paused: isRealtimeRefreshPaused");
    expect(source).toContain("handleSamplesUpdated");
    expect(source).toContain("hasPendingSamplesRefresh");
    expect(source).toContain("scheduleDrawer.open.value");
    expect(source).toContain("taskDetailModal.open.value");
    expect(source).toContain("scheduleConflictModal.open.value");
    expect(source).not.toContain("SCHEDULE_PAGE_REFRESH_INTERVAL_MS");
    expect(source).not.toContain("scheduleRefreshTimer");
    expect(source).not.toContain('window.addEventListener("storage"');
    expect(source).not.toContain('window.addEventListener("focus"');
  });
});
