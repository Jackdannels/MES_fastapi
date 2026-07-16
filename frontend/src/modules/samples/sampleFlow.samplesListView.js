import { resolveLaboratoryDisplayName } from "@/lib/labs";
import { normalizeText } from "./sampleFlow.shared";
import { normalizeSampleRecord } from "./sampleFlow.status";
import { getSampleTrayList } from "./sampleFlow.trayScope";
import {
  compareValue,
  filterSamplesForActiveTasks,
  resolveStatusClass,
} from "./sampleFlow.sampleTableHelpers";

function buildSamplesFlowView(input = {}) {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const samples = filterSamplesForActiveTasks(input.samples, tasks).slice();
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const sort = input.sort && typeof input.sort === "object" ? input.sort : {};
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 8;

  const query = normalizeText(filters.query).toLowerCase();
  const selectedTaskCode = normalizeText(filters.taskCode);
  const selectedStatus = normalizeText(filters.status);

  const normalizedSamples = samples.map((sample) => normalizeSampleRecord({
    ...sample,
    location: resolveLaboratoryDisplayName(sample?.location),
  }));
  const rows = normalizedSamples
    .filter((sample) => {
      if (selectedTaskCode && normalizeText(sample.task_code) !== selectedTaskCode) {
        return false;
      }
      if (selectedStatus && normalizeText(sample.status) !== selectedStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      const trayText = getSampleTrayList(sample)
        .map((tray) => normalizeText(tray.tray_code))
        .join(" ");
      const searchText = [
        sample.task_code,
        sample.code,
        trayText,
        sample.location,
        sample.owner,
        sample.status,
        sample.flow_status,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return searchText.includes(query);
    })
    .map((sample) => {
      const trayCodes = getSampleTrayList(sample).map((tray) => normalizeText(tray?.tray_code)).filter(Boolean);
      return {
        ...sample,
        trayCodes,
        trayCodesText: trayCodes.join("、"),
        statusClass: resolveStatusClass(sample.status),
      };
    });

  const sortKey = normalizeText(sort.key);
  const sortDirection = normalizeText(sort.direction) === "desc" ? "desc" : "asc";
  const sortedRows = rows.slice().sort((left, right) => {
    if (!sortKey) {
      return compareValue(left.code, right.code, "asc");
    }
    const order = compareValue(left?.[sortKey], right?.[sortKey], sortDirection);
    if (order !== 0) {
      return order;
    }
    return compareValue(left.code, right.code, "asc");
  });

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), totalPages) : 1;
  const startIndex = (currentPage - 1) * pageSize;

  const taskCodes = Array.from(
    new Set(normalizedSamples.map((sample) => normalizeText(sample?.task_code)).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  const statusOptions = Array.from(new Set(normalizedSamples.map((sample) => normalizeText(sample?.status)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "zh-Hans-CN"),
  );

  return {
    currentPage,
    rows: sortedRows.slice(startIndex, startIndex + pageSize),
    statusOptions,
    taskOptions: taskCodes,
    totalCount: sortedRows.length,
    totalPages,
  };
}

export { buildSamplesFlowView };
