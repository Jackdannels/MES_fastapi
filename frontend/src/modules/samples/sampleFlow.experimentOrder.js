import { normalizeText } from "./sampleFlow.shared";
import { normalizeLifecycleStatus } from "./sampleFlow.status";
import {
  parseTimeValue,
  resolveEntryExperimentCode,
  resolveEntryTaskCode,
  resolveEntryTrayCode,
} from "./sampleFlow.trayScope";
import {
  resolveExperimentAliases,
  resolveExperimentDisplayName,
  resolveExperimentIdentityName,
  resolveLabDestinationName,
} from "./sampleFlow.experimentHelpers";

const buildOrderedTrayExperiments = ({ taskCode, trayCode, experiments = [], experimentTrays = [], schedules = [] }) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTaskCode || !normalizedTrayCode) {
    return [];
  }

  const trayExperimentCodes = new Set(
    (Array.isArray(experimentTrays) ? experimentTrays : [])
      .filter(
        (entry) =>
          resolveEntryTaskCode(entry) === normalizedTaskCode && resolveEntryTrayCode(entry) === normalizedTrayCode,
      )
      .map(resolveEntryExperimentCode)
      .filter(Boolean),
  );

  const relatedSchedules = (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => resolveEntryTaskCode(schedule) === normalizedTaskCode);
  const scheduleMap = new Map(
    relatedSchedules
      .map((schedule) => [resolveEntryExperimentCode(schedule), parseTimeValue(schedule?.start_at)]),
  );
  const scheduleLabMap = new Map(
    relatedSchedules
      .map((schedule) => [
        resolveEntryExperimentCode(schedule),
        resolveLabDestinationName(
          schedule?.device,
          schedule?.lab,
          schedule?.laboratory,
          schedule?.required_device,
          schedule?.requiredDevice,
        ),
      ])
      .filter(([experimentCode, labName]) => experimentCode && labName),
  );
  const scheduleStatusMap = new Map(
    relatedSchedules
      .map((schedule) => [resolveEntryExperimentCode(schedule), normalizeText(schedule?.status)])
      .filter(([experimentCode, status]) => experimentCode && status),
  );

  return (Array.isArray(experiments) ? experiments : [])
    .filter((experiment) => {
      if (resolveEntryTaskCode(experiment) !== normalizedTaskCode) {
        return false;
      }
      const experimentCode = resolveEntryExperimentCode(experiment);
      return trayExperimentCodes.size === 0 || trayExperimentCodes.has(experimentCode);
    })
    .slice()
    .sort((left, right) => {
      const leftCode = resolveEntryExperimentCode(left);
      const rightCode = resolveEntryExperimentCode(right);
      const leftStart = scheduleMap.get(leftCode);
      const rightStart = scheduleMap.get(rightCode);
      if (Number.isFinite(leftStart) && Number.isFinite(rightStart) && leftStart !== rightStart) {
        return leftStart - rightStart;
      }
      return leftCode.localeCompare(rightCode, "zh-Hans-CN");
    })
    .map((experiment, index) => {
      const fallbackName = `${index + 1}实验`;
      const name = resolveExperimentIdentityName(experiment, fallbackName);
      const displayName = resolveExperimentDisplayName(experiment, fallbackName);
      const experimentCode = resolveEntryExperimentCode(experiment);
      const rawStatus = normalizeText(experiment?.status) || scheduleStatusMap.get(experimentCode) || "";
      const experimentType = normalizeText(experiment?.experiment_type) || normalizeText(experiment?.experimentType);
      const testType = normalizeText(experiment?.test_type) || normalizeText(experiment?.testType);
      const requiredDevice = normalizeText(experiment?.required_device) || normalizeText(experiment?.requiredDevice);
      return {
        code: experimentCode,
        name,
        displayName,
        experiment_name: normalizeText(experiment?.experiment_name),
        experimentName: normalizeText(experiment?.experimentName),
        experiment_type: experimentType,
        experimentType,
        test_type: testType,
        testType,
        required_device: requiredDevice,
        requiredDevice,
        destinationLab: scheduleLabMap.get(experimentCode)
          || resolveLabDestinationName(
            experiment?.device,
            experiment?.lab,
            experiment?.laboratory,
            experiment?.required_device,
            experiment?.requiredDevice,
        ),
        aliases: resolveExperimentAliases(experiment, name),
        status: rawStatus ? normalizeLifecycleStatus("", rawStatus) : "",
      };
    });
};

export { buildOrderedTrayExperiments };
