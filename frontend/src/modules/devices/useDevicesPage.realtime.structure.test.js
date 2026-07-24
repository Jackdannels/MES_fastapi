import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const sourcePath = resolve(process.cwd(), "src/modules/devices/useDevicesPage.js");
const enginePath = resolve(process.cwd(), "src/modules/devices/useDevicesPageEngine.js");

describe("useDevicesPage realtime refresh structure", () => {
  test("subscribes to device-related storage updates without overwriting open device dialogs", () => {
    const source = [sourcePath, enginePath].map((path) => readFileSync(path, "utf8")).join("\n");

    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("paused: isRealtimeRefreshPaused");
    expect(source).toContain("deviceDrawer.open.value");
    expect(source).toContain("editDeviceModal.open.value");
    expect(source).toContain("maintenancePlanModal.open.value");
    expect(source).toContain("runningRepairChoiceModal.open.value");
    expect(source).toContain("flushPendingStorageRefresh");
    expect(source).toContain("STORAGE_KEYS.devices");
    expect(source).toContain("STORAGE_KEYS.schedules");
    expect(source).toContain("STORAGE_KEYS.samples");
  });
});
