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
      const trayScoped = entryMatchesTrayCode(entry, normalizedTrayCode);
      if (!trayScoped) {
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

const chooseExperimentStatus = ({ eventStatus, runtimeStatus, fallbackStatus, recordStatus }) => {
  const normalizedEventStatus = normalizeText(eventStatus);
  const normalizedRuntimeStatus = normalizeText(runtimeStatus);
  if (
    normalizedRuntimeStatus
    && experimentFlowStatusRank(normalizedRuntimeStatus) >= experimentFlowStatusRank(normalizedEventStatus)
  ) {
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
