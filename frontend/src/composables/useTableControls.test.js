import { describe, expect, test } from "vitest";

import { useTableControls } from "./useTableControls";

describe("useTableControls", () => {
  test("filters then sorts rows deterministically", () => {
    const { query, sortKey, sortDirection, visibleRows } = useTableControls({
      rows: [
        { code: "B-002", status: "待排程" },
        { code: "A-001", status: "已排程" },
      ],
      searchFields: ["code", "status"],
    });

    query.value = "A-001";
    sortKey.value = "code";
    sortDirection.value = "asc";

    expect(visibleRows.value.map((row) => row.code)).toEqual(["A-001"]);
  });

  test("slices rows by current page", () => {
    const { currentPage, visibleRows, pageCount } = useTableControls({
      rows: Array.from({ length: 25 }, (_, index) => ({ code: `T-${index + 1}` })),
      searchFields: ["code"],
      pageSize: 10,
    });

    currentPage.value = 2;

    expect(pageCount.value).toBe(3);
    expect(visibleRows.value).toHaveLength(10);
    expect(visibleRows.value[0].code).toBe("T-11");
  });

  test("resets current page when query changes", () => {
    const { query, currentPage } = useTableControls({
      rows: Array.from({ length: 25 }, (_, index) => ({ code: `T-${index + 1}` })),
      searchFields: ["code"],
      pageSize: 10,
    });

    currentPage.value = 3;
    query.value = "T-1";

    expect(currentPage.value).toBe(1);
  });
});
