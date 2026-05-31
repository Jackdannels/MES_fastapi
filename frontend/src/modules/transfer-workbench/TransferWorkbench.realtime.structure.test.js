import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/modules/transfer-workbench/TransferWorkbench.vue");

describe("TransferWorkbench realtime refresh structure", () => {
  test("subscribes to storage updates without overwriting active tray editing", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("refreshTransferWorkspaceAfterTrayChange");
    expect(source).toContain("paused: isTransferRealtimeRefreshPaused");
    expect(source).toContain("handleSamplesUpdated");
    expect(source).toContain("hasPendingSamplesRefresh");
    expect(source).toContain("barcodeModalVisible.value");
    expect(source).toContain("selectedTaskId.value && !allocationReadOnly.value");
    expect(source).toContain("STORAGE_KEYS.tasks");
    expect(source).toContain("STORAGE_KEYS.samples");
    expect(source).toContain("STORAGE_KEYS.experiment_samples");
  });
});
