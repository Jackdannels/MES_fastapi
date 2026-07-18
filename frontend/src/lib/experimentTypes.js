const normalizeExperimentType = (value) => String(value ?? "").trim();

const normalizeExperimentTypeKey = (value) =>
  normalizeExperimentType(value)
    .toLowerCase()
    .replaceAll("实验", "试验")
    .replace(/\s+/g, "");

const uniqueExperimentTypes = (values) => {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeExperimentType(value))
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
};

const splitExperimentTypeSummary = (value) =>
  uniqueExperimentTypes(
    String(value ?? "")
      .split("/")
      .map((entry) => entry.trim()),
  );

const collectExperimentTypes = (...values) =>
  uniqueExperimentTypes(
    values.flatMap((value) => {
      if (Array.isArray(value)) {
        return value.flatMap((entry) => splitExperimentTypeSummary(entry));
      }
      return splitExperimentTypeSummary(value);
    }),
  );

const sortExperimentTypes = (values) =>
  uniqueExperimentTypes(values).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

const buildExperimentTypeSummary = (...values) => collectExperimentTypes(...values).join(" / ");

const buildExperimentTypeOptions = (...values) => sortExperimentTypes(collectExperimentTypes(...values));

const matchesExperimentTypeFilter = (selectedType, ...values) => {
  const query = normalizeExperimentTypeKey(selectedType);
  if (!query) {
    return true;
  }
  return collectExperimentTypes(...values).some((value) => normalizeExperimentTypeKey(value) === query);
};

export {
  buildExperimentTypeOptions,
  buildExperimentTypeSummary,
  collectExperimentTypes,
  matchesExperimentTypeFilter,
  normalizeExperimentType,
  normalizeExperimentTypeKey,
  sortExperimentTypes,
  splitExperimentTypeSummary,
  uniqueExperimentTypes,
};
