const normalizeExperimentType = (value) => String(value ?? "").trim();

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
  const query = normalizeExperimentType(selectedType).toLowerCase();
  if (!query) {
    return true;
  }
  return collectExperimentTypes(...values).some((value) => normalizeExperimentType(value).toLowerCase().includes(query));
};

export {
  buildExperimentTypeOptions,
  buildExperimentTypeSummary,
  collectExperimentTypes,
  matchesExperimentTypeFilter,
  normalizeExperimentType,
  sortExperimentTypes,
  splitExperimentTypeSummary,
  uniqueExperimentTypes,
};
