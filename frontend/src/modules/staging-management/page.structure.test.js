import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("staging management page structure", () => {
  test("keeps the shared staging and appearance overview focused on two tray columns", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/page.vue"), "utf8");

    expect(source).not.toContain('data-testid="zancun-console-search"');
    expect(source).not.toContain('data-testid="zancun-current-view"');
    expect(source).not.toContain("activeMetricLabel");
    expect(source).not.toContain("buildZancunMetrics");
    expect(source).not.toContain("consoleTitle");
    expect(source).not.toContain("标准流程");
    expect(source).toContain("{{ roomCopy.currentColumnTitle }} {{ currentStagingTotalCount }}");
    expect(source).toContain("{{ roomCopy.plannedTitle }} {{ plannedInboundTotalCount }}");
    expect(source).toContain("暂存间托盘");
    expect(source).toContain("允许暂存托盘");
    expect(source.match(/:show-jump-controls="false"/g)).toHaveLength(2);
    expect(source).toContain("slot.row.trayCode");
    expect(source).toContain("slot.row.taskCode");
    expect(source).toContain("样品数量 <strong>{{ slot.row.quantity }}</strong>");
    expect(source).not.toContain("slot.row.sampleType");
    expect(source).not.toContain("slot.row.location");
    expect(source).not.toContain("slot.row.inboundKindLabel");
    expect(source).not.toContain("slot.row.statusLabel");
  });

  test("stock-in scan input supports inline submit and Enter-key submit", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/page.vue"), "utf8");

    expect(source).toContain('data-testid="zancun-scan-submit"');
    expect(source).toContain('content-class="zancun-scan-modal-content"');
    expect(source).toContain('@keyup="handleScanKeyup"');
    expect(source).toContain('event?.key !== "Enter"');
    expect(source).toContain('await handleScanEnter();');
    expect(source).toContain('{{ activeScanMode === "stockIn" ? "入库完成" : "扫码完成" }}');
  });
});
