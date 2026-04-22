import { computed, ref, unref, watch } from "vue";

const normalizeText = (value) => String(value ?? "").trim().toLowerCase();
const parseSortableNumber = (value) => {
  const text = String(value ?? "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

function useTableControls(options) {
  const query = ref("");
  const sortKey = ref("");
  const sortDirection = ref("asc");
  const currentPage = ref(1);
  const pageSize = Number(options?.pageSize) > 0 ? Number(options.pageSize) : 10;
  const searchFields = Array.isArray(options?.searchFields) ? options.searchFields : [];

  const filteredRows = computed(() => {
    const rows = Array.isArray(unref(options?.rows)) ? unref(options.rows) : [];
    const normalizedQuery = normalizeText(query.value);
    if (!normalizedQuery) {
      return rows.slice();
    }

    return rows.filter((row) =>
      searchFields.some((field) => normalizeText(row?.[field]).includes(normalizedQuery))
    );
  });

  const sortedRows = computed(() => {
    const rows = filteredRows.value.slice();
    if (!sortKey.value) {
      return rows;
    }

    const directionFactor = sortDirection.value === "desc" ? -1 : 1;
    return rows.sort((left, right) => {
      const rawLeftValue = left?.[sortKey.value];
      const rawRightValue = right?.[sortKey.value];
      const leftNumber = parseSortableNumber(rawLeftValue);
      const rightNumber = parseSortableNumber(rawRightValue);
      if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
        return (leftNumber - rightNumber) * directionFactor;
      }
      const leftValue = normalizeText(rawLeftValue);
      const rightValue = normalizeText(rawRightValue);
      if (leftValue === rightValue) {
        return normalizeText(left?.code).localeCompare(normalizeText(right?.code)) * directionFactor;
      }
      return leftValue.localeCompare(rightValue) * directionFactor;
    });
  });

  const pageCount = computed(() => Math.max(Math.ceil(sortedRows.value.length / pageSize), 1));

  const visibleRows = computed(() => {
    const safePage = Math.min(Math.max(currentPage.value, 1), pageCount.value);
    const start = (safePage - 1) * pageSize;
    return sortedRows.value.slice(start, start + pageSize);
  });

  watch(
    [query, sortKey, sortDirection],
    () => {
      currentPage.value = 1;
    },
    { flush: "sync" }
  );

  watch(pageCount, (nextPageCount) => {
    if (currentPage.value > nextPageCount) {
      currentPage.value = nextPageCount;
    }
  });

  return {
    currentPage,
    filteredRows,
    pageCount,
    query,
    sortDirection,
    sortKey,
    visibleRows,
  };
}

export { useTableControls };
