import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const panelPath = resolve(process.cwd(), "src/modules/samples/SamplesManagementPanel.vue");

describe("SamplesManagementPanel structure", () => {
  test("removes the embedded pre-allocation workbench and keeps flow panels", () => {
    const source = readFileSync(panelPath, "utf8");

    expect(source).not.toContain("TransferWorkbench");
    expect(source).not.toContain("AppDrawer");
    expect(source).not.toContain('mode="pre-allocation"');
    expect(source).not.toContain("SampleProcessPanel");
    expect(source).not.toContain("样品全生命周期追踪");
    expect(source).toContain("样品流转与状态");
    expect(source).toContain("暂存间样品");
  });

  test("shows tray code in the sample flow table and opens detail as a centered flow modal", () => {
    const source = readFileSync(panelPath, "utf8");

    expect(source).toContain("托盘编号");
    expect(source).not.toContain("托盘数");
    expect(source).not.toContain("samples-flow-sort-owner");
    expect(source).toContain("sample-detail-flow-modal");
    expect(source).toContain("samples-flow-detail-flow-step");
  });

  test("keeps sample information read-only without batch intake or staging dispatch actions", () => {
    const source = readFileSync(panelPath, "utf8");

    expect(source).not.toContain("samples-flow-open-batch");
    expect(source).not.toContain("samples-flow-batch-submit");
    expect(source).not.toContain("确认入库");
    expect(source).not.toContain("批量入库");
    expect(source).not.toContain("派发至实验室");
    expect(source).not.toContain("samples-staging-select-all");
    expect(source).not.toContain("samples-staging-submit");
  });

  test("keeps staging sample filters aligned with sample flow filters", () => {
    const source = readFileSync(panelPath, "utf8");

    expect(source).toContain("samples-staging-search");
    expect(source).toContain("samples-staging-task-filter");
    expect(source).toContain("samples-staging-status-filter");
    expect(source).toContain("stagingCurrentPage");
    expect(source).toContain("stagingPageCount");
  });
});
