import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const panelPath = resolve(process.cwd(), "src/modules/samples/SamplesManagementPanel.vue");
const groupPath = resolve(process.cwd(), "src/modules/samples/SampleGroupedView.vue");

describe("SamplesManagementPanel structure", () => {
  test("removes the embedded pre-allocation workbench and keeps flow panels", () => {
    const source = readFileSync(panelPath, "utf8");

    expect(source).not.toContain("TransferWorkbench");
    expect(source).not.toContain("AppDrawer");
    expect(source).not.toContain('mode="pre-allocation"');
    expect(source).not.toContain("SampleProcessPanel");
    expect(source).not.toContain("样品全生命周期追踪");
    expect(source).toContain("<SampleGroupedView");
    expect(source).toContain('activeTab === \'sample-flow\'');
    expect(source).toContain('activeTab === \'sample-staging\'');
  });

  test("shows tray details in a centered flow modal and leaves the sample table read-only", () => {
    const groupedView = readFileSync(groupPath, "utf8");
    const dialog = readFileSync(resolve(process.cwd(), "src/modules/samples/TrayFlowDialog.vue"), "utf8");

    expect(groupedView).toContain("selectedGroup.trayCode");
    expect(groupedView).toContain("<TrayFlowDialog");
    expect(groupedView).not.toContain("openSampleDetail");
    expect(dialog).toContain("<AppModal");
    expect(dialog).toContain("<TrayFlowTimeline");
  });

  test("keeps sample information read-only without batch intake or staging dispatch actions", () => {
    const source = readFileSync(panelPath, "utf8") + readFileSync(groupPath, "utf8");

    expect(source).not.toContain("samples-flow-open-batch");
    expect(source).not.toContain("samples-flow-batch-submit");
    expect(source).not.toContain("确认入库");
    expect(source).not.toContain("批量入库");
    expect(source).not.toContain("派发至实验室");
    expect(source).not.toContain("samples-staging-select-all");
    expect(source).not.toContain("samples-staging-submit");
  });

  test("keeps independent filters and uses the available height for both scroll regions", () => {
    const source = readFileSync(groupPath, "utf8");
    const styles = readFileSync(resolve(process.cwd(), "src/modules/samples/styles.css"), "utf8");

    expect(source).toContain("setStagingQuery");
    expect(source).toContain("setStagingTaskFilter");
    expect(source).toContain("setStagingStatusFilter");
    expect(styles).toMatch(/\.app-shell--central:has\(> \.main > \.samples-management-panel--grouped\)\s*\{[^}]*block-size: 100dvh;/s);
    expect(styles).toMatch(/\.sample-group-list\s*\{[^}]*flex: 1;[^}]*overflow-y: auto;/s);
    expect(styles).toMatch(/\.sample-group-samples\s*\{[^}]*min-block-size: 0;/s);
    expect(styles).toMatch(/\.sample-group-sample-scroll\s*\{[^}]*flex: 1;[^}]*overflow: auto;/s);
    expect(styles).toMatch(/\.sample-group-sample-table\.table th\s*\{[^}]*position: sticky;[^}]*top: 0;/s);
  });
});
