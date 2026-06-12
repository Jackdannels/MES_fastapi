import { TEST_LAB_OPTIONS } from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import {
  normalizeLabels,
  normalizeSamplesSnapshot,
} from "./sampleFlow.status";
import { getSampleTrayList } from "./sampleFlow.trayScope";
import {
  compareValue,
  resolveStatusClass,
} from "./sampleFlow.sampleTableHelpers";

function buildSamplesStagingView(input = {}) {
  const labels = normalizeLabels(input.labels);
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const query = normalizeText(filters.query || input.query).toLowerCase();
  const selectedTaskCode = normalizeText(filters.taskCode);
  const selectedStatus = normalizeText(filters.status);
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 8;
  const selectedCodes = Array.isArray(input.selectedCodes)
    ? input.selectedCodes.map((code) => normalizeText(code)).filter(Boolean)
    : [];
  const selectedSet = new Set(selectedCodes);
  const preRetentionLocation = normalizeText(labels.preRetentionLocation || labels.retentionLocation);
  const postRetentionLocation = normalizeText(labels.postRetentionLocation);

  const normalizedSamples = normalizeSamplesSnapshot(samples, labels);
  const stagingSamples = normalizedSamples.filter((sample) => {
    const location = normalizeText(sample?.location);
    return location === preRetentionLocation || location === postRetentionLocation;
  });
  const rows = stagingSamples
    .filter((sample) => {
      if (selectedTaskCode && normalizeText(sample?.task_code) !== selectedTaskCode) {
        return false;
      }
      if (selectedStatus && normalizeText(sample?.status) !== selectedStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      const searchText = [
        sample?.code,
        sample?.task_code,
        sample?.location,
        sample?.status,
        sample?.owner,
        sample?.flow_status,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return searchText.includes(query);
    })
    .map((sample) => {
      const trayCodes = getSampleTrayList(sample).map((tray) => normalizeText(tray?.tray_code)).filter(Boolean);
      return {
        ...sample,
        selected: selectedSet.has(normalizeText(sample?.code)),
        statusClass: resolveStatusClass(sample?.status),
        trayCodes,
        trayCodesText: trayCodes.join("、"),
      };
    })
    .sort((left, right) => compareValue(left.code, right.code, "asc"));

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), totalPages) : 1;
  const startIndex = (currentPage - 1) * pageSize;
  const taskOptions = Array.from(new Set(stagingSamples.map((sample) => normalizeText(sample?.task_code)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "zh-Hans-CN"),
  );
  const statusOptions = Array.from(new Set(stagingSamples.map((sample) => normalizeText(sample?.status)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "zh-Hans-CN"),
  );

  return {
    count: rows.length,
    currentPage,
    labOptions: TEST_LAB_OPTIONS.slice(),
    rows: rows.slice(startIndex, startIndex + pageSize),
    statusOptions,
    taskOptions,
    totalCount: rows.length,
    totalPages,
  };
}

export { buildSamplesStagingView };
