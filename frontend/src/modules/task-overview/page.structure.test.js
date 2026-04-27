import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/modules/task-overview/page.vue");

describe("TaskOverviewPage structure", () => {
  test("does not keep legacy editor helpers in the page file", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain("TaskOverviewToolbar");
    expect(source).toContain("TaskOverviewCard");
    expect(source).toContain("TaskOverviewTrayTable");
    expect(source).toContain("useTaskOverview");
    expect(source).not.toContain('class="task-overview-pagination"');
    expect(source).not.toContain('class="task-overview-header"');
    expect(source).not.toContain('class="task-overview-actions"');
    expect(source).not.toContain('class="task-overview-card"');
    expect(source).not.toContain('class="task-overview-tray-wrap"');
    expect(source).not.toContain("const filteredRows = computed");
    expect(source).not.toContain("const testTypeOptions = computed");
    expect(source).not.toContain("const applyRouteFilters =");
    expect(source).not.toContain("watch(timeFilter");
    expect(source).not.toContain("watch(viewMode");
    expect(source).not.toContain("isEditingLegacy");
    expect(source).not.toContain("openEditLegacy");
    expect(source).not.toContain("cancelEditLegacy");
    expect(source).not.toContain("resetDeleteConfirmLegacy");
    expect(source).not.toContain("handleCardClickLegacy");
    expect(source).not.toContain("handleCardDblClickLegacy");
    expect(source).not.toContain("generateCodesByCountLegacy");
    expect(source).not.toContain("saveEditLegacy");
    expect(source).not.toContain("requestDeleteTaskLegacy");
    expect(source).not.toContain("confirmDeleteTaskLegacy");
    expect(source).not.toContain("buildRowsLegacy");
    expect(source).not.toContain("buildTrayOverviewRowsLegacy");
  });
});
