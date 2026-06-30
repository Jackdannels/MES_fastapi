import {
  APPEARANCE_SENT_STATUS,
  APPEARANCE_STOCKED_STATUS,
  EXPERIMENT_FLOW_STATUS_LABELS,
  FLOW_STEP_INDEX_BY_KEY,
  FLOW_STEP_KEY_BY_LABEL,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import { normalizeLifecycleStatus } from "./sampleFlow.status";
import {
  asArray,
  entryMatchesTrayCode,
  entryTimeValue,
  getSampleTrayList,
  uniqueNormalizedTexts,
} from "./sampleFlow.trayScope";
import {
  findCompletedExperimentHistoryEntry,
  latestWithdrawalHistoryEntry,
  parseExperimentHistoryDetail,
  parseRetainedCompletedExperimentBeforeWithdrawal,
  parseWithdrawalRestoreTarget,
} from "./sampleFlow.experimentHelpers";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";

const buildSingleExperimentStatusLabel = (experimentName, status) => {
  const normalizedName = normalizeText(experimentName);
  const normalizedStatus = normalizeText(status);
  if (!normalizedName) {
    return normalizedStatus;
  }
  if (normalizedStatus === "实验进行中" || normalizedStatus === "实验中") {
    return `${normalizedName}${EXPERIMENT_FLOW_STATUS_LABELS.running}`;
  }
  if (normalizedStatus === "实验已完成" || normalizedStatus === "实验完成") {
    return `${normalizedName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`;
  }
  return normalizedStatus;
};

const isReturnedStatus = (value, location = "") =>
  normalizeLifecycleStatus(location, value) === "厂家收回" || normalizeText(value) === "厂家收回";

const sampleHasOnlyCurrentTray = (sample, trayCode) => {
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTrayCode) {
    return false;
  }
  const trayCodes = uniqueNormalizedTexts(
    asArray(sample?.trays).map((tray) => tray?.tray_code || tray?.trayCode || tray?.tray_no || tray?.trayNo),
  );
  return trayCodes.length === 1 && trayCodes[0] === normalizedTrayCode;
};

const sampleCurrentTrayIsReturned = (sample, trayCode) => {
  if (!sampleHasOnlyCurrentTray(sample, trayCode)) {
    return false;
  }
  if (isReturnedStatus(sample?.status, sample?.location) || isReturnedStatus(sample?.location)) {
    return true;
  }
  return asArray(sample?.trays).some((tray) =>
    normalizeText(tray?.tray_code || tray?.trayCode || tray?.tray_no || tray?.trayNo) === normalizeText(trayCode)
    && isReturnedStatus(tray?.status || tray?.tray_status || tray?.trayStatus, sample?.location),
  );
};

const shouldRetainReturnedSingleTrayCompletedEvent = ({ parsed, sample, trayCode, trayScoped }) =>
  !trayScoped
  && normalizeLifecycleStatus("", parsed?.status) === "实验已完成"
  && sampleCurrentTrayIsReturned(sample, trayCode);

const parsedExperimentEventMatchesTrayCode = (parsed, trayCode) => {
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTrayCode) {
    return false;
  }
  return uniqueNormalizedTexts([
    parsed?.trayCode,
    ...(Array.isArray(parsed?.trayCodes) ? parsed.trayCodes : []),
  ]).includes(normalizedTrayCode);
};

const resolveLatestExperimentEventMap = ({ taskCode, trayCode, samples = [] }) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  const eventMap = new Map();

  const setExperimentEvent = (parsed, time, trayScoped = false) => {
    if (!parsed?.experimentName) {
      return;
    }
    const currentTime = Number(time) || 0;
    const existingEvent = eventMap.get(parsed.experimentName);
    if (!existingEvent || currentTime >= existingEvent.time) {
      eventMap.set(parsed.experimentName, {
        ...parsed,
        trayScoped: Boolean(trayScoped || parsed.trayScoped),
        time: currentTime,
      });
    }
  };

  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    if (normalizeText(sample?.task_code) !== normalizedTaskCode) {
      return;
    }
    const touchesTray = getSampleTrayList(sample).some((tray) => normalizeText(tray?.tray_code) === normalizedTrayCode);
    if (!touchesTray) {
      return;
    }
    const historyEntries = asArray(sample?.history);
    const latestWithdrawal = latestWithdrawalHistoryEntry(historyEntries);
    const restoreTarget = latestWithdrawal
      ? parseWithdrawalRestoreTarget(latestWithdrawal.entry?.detail, normalizedTaskCode)
      : null;
    if (restoreTarget?.experimentName && restoreTarget.status === "实验已完成") {
      const restoredCompletedEntry = findCompletedExperimentHistoryEntry(
        historyEntries,
        normalizedTaskCode,
        restoreTarget.experimentName,
        latestWithdrawal.time,
      );
      setExperimentEvent(
        {
          experimentName: restoreTarget.experimentName,
          status: "实验已完成",
        },
        restoredCompletedEntry?.time || latestWithdrawal.time,
        false,
      );
    }

    historyEntries.forEach((entry) => {
      const currentTime = entryTimeValue(entry);
      if (latestWithdrawal && currentTime <= latestWithdrawal.time) {
        const retainedCompleted = parseRetainedCompletedExperimentBeforeWithdrawal(
          entry,
          normalizedTaskCode,
          latestWithdrawal.entry,
          restoreTarget,
        );
        if (retainedCompleted) {
          setExperimentEvent(retainedCompleted, currentTime, false);
        }
        return;
      }
      const parsed = parseExperimentHistoryDetail(entry?.detail, normalizedTaskCode);
      if (!parsed) {
        return;
      }
      const trayScoped =
        entryMatchesTrayCode(entry, normalizedTrayCode)
        || parsedExperimentEventMatchesTrayCode(parsed, normalizedTrayCode);
      if (
        !trayScoped
        && !shouldRetainReturnedSingleTrayCompletedEvent({
          parsed,
          sample,
          trayCode: normalizedTrayCode,
          trayScoped,
        })
      ) {
        return;
      }
      setExperimentEvent(parsed, currentTime, trayScoped);
    });
  });

  return eventMap;
};

const resolveExperimentEvent = (eventMap, experiment) => {
  const aliases = uniqueNormalizedTexts([
    ...(Array.isArray(experiment?.aliases) ? experiment.aliases : []),
    experiment?.code,
    experiment?.name,
    experiment?.displayName,
  ]);
  let latestEvent = null;
  for (const alias of aliases) {
    const event = eventMap.get(alias);
    if (event && (!latestEvent || entryTimeValue(event) >= entryTimeValue(latestEvent))) {
      latestEvent = event;
    }
  }
  return latestEvent;
};

const experimentFlowStatusRank = (status) => {
  if (isAxisPartialProgressStatus(status)) {
    return FLOW_STEP_INDEX_BY_KEY.get("running") ?? FLOW_STEP_INDEX_BY_KEY.get("ready") ?? -1;
  }
  const normalizedStatus = normalizeLifecycleStatus("", status);
  if (normalizedStatus === APPEARANCE_SENT_STATUS) {
    return (FLOW_STEP_INDEX_BY_KEY.get("completed") ?? 9) + 0.1;
  }
  if (normalizedStatus === APPEARANCE_STOCKED_STATUS) {
    return (FLOW_STEP_INDEX_BY_KEY.get("completed") ?? 9) + 0.2;
  }
  const key = FLOW_STEP_KEY_BY_LABEL.get(normalizedStatus);
  return FLOW_STEP_INDEX_BY_KEY.get(key) ?? -1;
};

const isCurrentLabProgressStatus = (status) => {
  const normalizedStatus = normalizeLifecycleStatus("", status);
  const key = FLOW_STEP_KEY_BY_LABEL.get(normalizedStatus);
  const index = FLOW_STEP_INDEX_BY_KEY.get(key) ?? -1;
  const arrivedIndex = FLOW_STEP_INDEX_BY_KEY.get("sent_to_lab") ?? FLOW_STEP_INDEX_BY_KEY.get("arrived_lab") ?? -1;
  const completedIndex = FLOW_STEP_INDEX_BY_KEY.get("completed") ?? Number.MAX_SAFE_INTEGER;
  return index >= arrivedIndex && index < completedIndex;
};

const chooseExperimentStatus = ({
  eventStatus,
  eventTime,
  runtimeStatus,
  runtimeTime,
  fallbackStatus,
  fallbackTime,
  recordStatus,
}) => {
  const normalizedEventStatus = normalizeText(eventStatus);
  const normalizedRuntimeStatus = normalizeText(runtimeStatus);
  const normalizedFallbackStatus = normalizeText(fallbackStatus);
  if (
    isAxisPartialProgressStatus(normalizedRuntimeStatus)
    && isCurrentLabProgressStatus(normalizedEventStatus)
    && Number(eventTime || 0) >= Number(runtimeTime || 0)
  ) {
    return normalizedEventStatus;
  }
  if (
    isAxisPartialProgressStatus(normalizedRuntimeStatus)
    && isCurrentLabProgressStatus(normalizedFallbackStatus)
    && Number(fallbackTime || 0) > 0
    && Number(fallbackTime || 0) >= Number(runtimeTime || 0)
  ) {
    return normalizedFallbackStatus;
  }
  if (
    normalizedRuntimeStatus
    && experimentFlowStatusRank(normalizedRuntimeStatus) >= experimentFlowStatusRank(normalizedEventStatus)
  ) {
    return normalizedRuntimeStatus;
  }
  if (isAxisPartialProgressStatus(normalizedRuntimeStatus)) {
    return normalizedRuntimeStatus;
  }
  if (normalizeLifecycleStatus("", normalizedEventStatus) === "实验已完成") {
    return normalizedEventStatus;
  }
  return normalizedEventStatus || normalizedRuntimeStatus || fallbackStatus || recordStatus;
};

export {
  buildSingleExperimentStatusLabel,
  chooseExperimentStatus,
  experimentFlowStatusRank,
  resolveExperimentEvent,
  resolveLatestExperimentEventMap,
};
