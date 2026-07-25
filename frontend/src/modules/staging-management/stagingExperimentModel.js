import {
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  requiresPreExperimentAppearanceStorage,
} from "@/modules/samples/sampleFlow.constants";
import { formatLocalDateTime } from "@/lib/dateTime";
import { resolveActiveDeviceMaintenance } from "@/lib/deviceMaintenance";
import { serverNowDate } from "@/lib/serverClock";
import { normalizeAxisCodes } from "@/lib/axisCodes";
import { labIdentityMatches, resolveScheduleLabCode } from "@/lib/labIdentity";
import { isAxisProgressIncomplete, resolveAxisProgress } from "@/modules/experiment-progress/axisProgress";
import {
  ACTIVE_EXPERIMENT_RUN_TRAY_STATUSES,
  APPEARANCE_STOCKED_STATUS,
  COMPLETED_EXPERIMENT_STATUSES,
  COMPLETED_RUN_TRAY_STATUSES,
  EXPLICIT_STAGING_INBOUND_STATUSES,
  NORMAL_STAGING_LABEL,
  PARTIAL_AXIS_REENTRY_BLOCKING_ACTIONS,
  POST_EXPERIMENT_STAGING_LABEL,
  STAGING_LOCATION,
  STRICT_COMPLETED_RUN_TRAY_STATUSES,
  WITHDRAWAL_HISTORY_ACTIONS,
  asArray,
  eventMatchesRoom,
  eventTargetsPostExperimentStaging,
  eventTargetsStorageRoom,
  isCurrentStagingStatus,
  isStagingDestination,
  normalizeText,
  parseCompletedEventTimeValue,
  parseExperimentHistoryDetail,
  parseTimeValue,
  resolveExperimentName,
  resolveScheduleLabId,
  resolveStorageRoomConfig,
} from "./stagingStorageModel";


const buildExperimentMap = (experiments) => {
  const map = new Map();
  asArray(experiments).forEach((experiment) => {
    const code = normalizeText(experiment?.experiment_code);
    if (code) {
      map.set(code, experiment);
    }
  });
  return map;
};

const latestAppearanceLabDispatchRequiresPreExperiment = ({ events, experiments }) => {
  const orderedEvents = asArray(events);
  const withdrawalIndex = orderedEvents
    .map((event, index) => ({ action: normalizeText(event?.action), index }))
    .filter((item) => item.action === "stock_out_withdraw")
    .at(-1)?.index;
  if (withdrawalIndex === undefined) {
    return false;
  }
  const latestDispatch = orderedEvents
    .slice(0, withdrawalIndex)
    .reverse()
    .find((event) => normalizeText(event?.action) === "stock_out");
  if (!latestDispatch) {
    return false;
  }
  const targetType = normalizeText(latestDispatch?.target_type || latestDispatch?.targetType);
  if (targetType === "staging" || targetType === "appearance") {
    return false;
  }
  const targetText = [
    latestDispatch?.target_lab,
    latestDispatch?.targetLab,
    latestDispatch?.target_name,
    latestDispatch?.targetName,
  ].map((value) => normalizeText(value)).filter(Boolean).join(" ");
  if (targetText.includes("暂存间") || targetText.includes("外观检测间")) {
    return false;
  }
  const targetExperimentCode = normalizeText(latestDispatch?.target_experiment_code || latestDispatch?.targetExperimentCode);
  const targetExperiment = buildExperimentMap(experiments).get(targetExperimentCode);
  return requiresPreExperimentAppearanceStorage(
    latestDispatch?.target_lab,
    latestDispatch?.targetLab,
    latestDispatch?.target_experiment_name,
    latestDispatch?.targetExperimentName,
    targetExperimentCode,
    resolveExperimentName(targetExperiment),
  );
};

const hasAppearanceStockInBeforeLatestLabDispatch = ({ config, latestStorageEvent, trayStorageEvents }) => {
  if (
    config.key !== "appearance"
    || normalizeText(latestStorageEvent?.action) !== "stock_out"
    || eventTargetsStorageRoom(latestStorageEvent, config)
    || eventTargetsPostExperimentStaging(latestStorageEvent)
  ) {
    return false;
  }
  const targetType = normalizeText(latestStorageEvent?.target_type || latestStorageEvent?.targetType);
  const targetText = [
    latestStorageEvent?.target_lab,
    latestStorageEvent?.targetLab,
    latestStorageEvent?.target_name,
    latestStorageEvent?.targetName,
  ].map((value) => normalizeText(value)).filter(Boolean).join(" ");
  if (targetType === "appearance" || targetType === "staging" || targetText.includes("外观检测间") || targetText.includes("暂存间")) {
    return false;
  }
  const targetExperimentCode = normalizeText(
    latestStorageEvent?.target_experiment_code || latestStorageEvent?.targetExperimentCode,
  );
  if (!targetExperimentCode) {
    return false;
  }
  const latestDispatchTime = parseTimeValue(latestStorageEvent?.time);
  let dispatched = false;
  asArray(trayStorageEvents)
    .filter((event) => eventMatchesRoom(event, config))
    .filter((event) => !latestDispatchTime || parseTimeValue(event?.time) <= latestDispatchTime)
    .slice()
    .sort((left, right) => parseTimeValue(left?.time) - parseTimeValue(right?.time))
    .forEach((event) => {
      const eventTargetCode = normalizeText(event?.target_experiment_code || event?.targetExperimentCode);
      if (eventTargetCode && eventTargetCode !== targetExperimentCode) {
        return;
      }
      const action = normalizeText(event?.action);
      if (action === "stock_out_withdraw") {
        dispatched = false;
        return;
      }
      if (
        (action === "stock_in" || action === "stock_out")
        && normalizeText(event?.appearance_phase || event?.appearancePhase) === "pre_experiment"
        && eventTargetCode === targetExperimentCode
      ) {
        dispatched = true;
      }
    });
  return dispatched;
};

const collectTrayExperimentCodes = ({ taskCode, trayCode, experimentTrays }) => {
  const codes = new Set();
  asArray(experimentTrays).forEach((entry) => {
    if (normalizeText(entry?.task_code) !== taskCode || normalizeText(entry?.tray_code) !== trayCode) {
      return;
    }
    const experimentCode = normalizeText(entry?.experiment_code);
    if (experimentCode) {
      codes.add(experimentCode);
    }
  });
  return codes;
};

const hasPendingSiblingAxisSchedule = ({ experimentCode, schedules, subExperimentCode, taskCode }) =>
  asArray(schedules).some((schedule) => {
    if (
      normalizeText(schedule?.task_code || schedule?.taskCode || schedule?.task_no || schedule?.taskNo) !== taskCode
      || normalizeText(schedule?.experiment_code || schedule?.experimentCode || schedule?.experiment_no || schedule?.experimentNo) !== experimentCode
      || !normalizeAxisCodes(schedule?.axis_codes || schedule?.axisCodes).length
      || normalizeText(schedule?.sub_experiment_code || schedule?.subExperimentCode || schedule?.sub_experiment_no || schedule?.subExperimentNo) === subExperimentCode
    ) {
      return false;
    }
    return !COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(schedule?.status || schedule?.schedule_status || schedule?.scheduleStatus));
  });

const latestPartialAxisRunCompletionTime = ({ experimentRunSteps, experimentRunTrays, experiments, schedules, taskCode, trayCode }) => {
  const experimentMap = buildExperimentMap(experiments);
  return asArray(experimentRunTrays).reduce((latest, entry) => {
    if (
      normalizeText(entry?.task_code || entry?.taskCode || entry?.task_no || entry?.taskNo) !== taskCode
      || normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo) !== trayCode
      || !COMPLETED_RUN_TRAY_STATUSES.has(normalizeText(entry?.run_tray_status || entry?.runTrayStatus || entry?.status))
    ) {
      return latest;
    }
    const experimentCode = normalizeText(entry?.experiment_code || entry?.experimentCode || entry?.experiment_no || entry?.experimentNo);
    const subExperimentCode = normalizeText(entry?.sub_experiment_code || entry?.subExperimentCode || entry?.sub_experiment_no || entry?.subExperimentNo);
    if (!subExperimentCode) {
      return latest;
    }
    const progress = resolveAxisProgress({
      experiment: experimentMap.get(experimentCode),
      experimentCode,
      experimentRunSteps,
      experimentRunTrays,
      experiments,
      schedules,
      subExperimentCode,
      taskCode,
      trayCode,
    });
    const overallProgress = resolveAxisProgress({
      experiment: experimentMap.get(experimentCode),
      experimentCode,
      experimentRunSteps,
      experimentRunTrays,
      experiments,
      schedules,
      taskCode,
      trayCode,
    });
    const overallIncomplete = isAxisProgressIncomplete(overallProgress) && Number(overallProgress.completedCount) > 0;
    const isPartialCompletion =
      overallIncomplete
      && (
        Number(progress.completedCount) > 0
        || hasPendingSiblingAxisSchedule({ experimentCode, schedules, subExperimentCode, taskCode })
      );
    if (!isPartialCompletion) {
      return latest;
    }
    return Math.max(
      latest,
      parseTimeValue(
        entry?.ended_at || entry?.endedAt || entry?.completed_at || entry?.completedAt || entry?.updated_at || entry?.updatedAt,
      ),
    );
  }, 0);
};

const trayHasLabStockOutAtOrAfter = ({ config, context, events, timestamp }) => {
  if (timestamp <= 0) {
    return false;
  }
  return asArray(events).some((event) => {
    if (
      normalizeText(event?.action) !== "stock_out"
      || !eventMatchesRoom(event, config)
      || eventTargetsStorageRoom(event, config, context)
    ) {
      return false;
    }
    return parseTimeValue(event?.time) >= timestamp;
  });
};

const trayHasNewerAxisLabActivity = ({ experimentRunTrays, samples, taskCode, trayCode, timestamp }) => {
  const matchingSamples = asArray(samples).filter((sample) => (
    normalizeText(sample?.task_code) === taskCode
    && asArray(sample?.trays).some((tray) => normalizeText(tray?.tray_code) === trayCode)
  ));
  const latestLifecycleEvent = matchingSamples
    .flatMap((sample) => asArray(sample?.history))
    .map((entry) => ({
      action: normalizeText(entry?.action),
      time: parseCompletedEventTimeValue(entry?.time || entry?.updated_at || entry?.updatedAt),
    }))
    .filter((entry) => (
      entry.time > 0
      && entry.time > timestamp
      && (PARTIAL_AXIS_REENTRY_BLOCKING_ACTIONS.has(entry.action) || WITHDRAWAL_HISTORY_ACTIONS.has(entry.action))
    ))
    .sort((left, right) => left.time - right.time)
    .at(-1);
  if (latestLifecycleEvent && PARTIAL_AXIS_REENTRY_BLOCKING_ACTIONS.has(latestLifecycleEvent.action)) {
    return true;
  }

  return asArray(experimentRunTrays).some((entry) => {
    if (
      normalizeText(entry?.task_code || entry?.taskCode || entry?.task_no || entry?.taskNo) !== taskCode
      || normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo) !== trayCode
      || !ACTIVE_EXPERIMENT_RUN_TRAY_STATUSES.has(normalizeText(entry?.run_tray_status || entry?.runTrayStatus || entry?.status))
    ) {
      return false;
    }
    const startedAt = parseCompletedEventTimeValue(
      entry?.started_at || entry?.startedAt || entry?.created_at || entry?.createdAt || entry?.updated_at || entry?.updatedAt,
    );
    return timestamp === Number.MAX_SAFE_INTEGER || startedAt === 0 || startedAt >= timestamp;
  });
};

const findAxisSchedulesForExperiment = ({ experimentCode, schedules, taskCode }) =>
  asArray(schedules).filter((schedule) =>
    normalizeText(schedule?.task_code || schedule?.taskCode || schedule?.task_no || schedule?.taskNo) === taskCode
    && normalizeText(schedule?.experiment_code || schedule?.experimentCode || schedule?.experiment_no || schedule?.experimentNo) === experimentCode
    && normalizeAxisCodes(schedule?.axis_codes || schedule?.axisCodes).length > 0,
  );

const trayExperimentRunIsCompleted = ({ experimentCode, experimentRunSteps, experimentRunTrays, experiments, schedules, taskCode, trayCode }) => {
  const axisSchedules = findAxisSchedulesForExperiment({ experimentCode, schedules, taskCode });
  if (axisSchedules.length > 0) {
    const overallProgress = resolveAxisProgress({
      experiment: buildExperimentMap(experiments).get(experimentCode),
      experimentCode,
      experimentRunSteps,
      experimentRunTrays,
      experiments,
      schedules,
      taskCode,
      trayCode,
    });
    if (isAxisProgressIncomplete(overallProgress)) {
      return false;
    }
    return axisSchedules.every((schedule) =>
      scheduleAxisBatchIsCompleted({
        experimentCode,
        experimentRunSteps,
        experimentRunTrays,
        experiments,
        schedule,
        taskCode,
        trayCode,
      }),
    );
  }

  return asArray(experimentRunTrays).some((entry) =>
    normalizeText(entry?.task_code || entry?.taskCode || entry?.task_no || entry?.taskNo) === taskCode
    && normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo) === trayCode
    && normalizeText(entry?.experiment_code || entry?.experimentCode || entry?.experiment_no || entry?.experimentNo) === experimentCode
    && COMPLETED_RUN_TRAY_STATUSES.has(normalizeText(entry?.run_tray_status || entry?.runTrayStatus || entry?.status))
    && !isAxisProgressIncomplete(resolveAxisProgress({
      experiment: buildExperimentMap(experiments).get(experimentCode),
      experimentCode,
      experimentRunSteps,
      experimentRunTrays,
      experiments,
      schedules,
      subExperimentCode: normalizeText(entry?.sub_experiment_code || entry?.subExperimentCode || entry?.sub_experiment_no || entry?.subExperimentNo),
      taskCode,
      trayCode,
    })),
  );
};

const scheduleAxisBatchIsCompleted = ({ experimentCode, experimentRunSteps, experimentRunTrays, experiments, schedule, taskCode, trayCode }) => {
  const scheduleAxisCodes = normalizeAxisCodes(schedule?.axis_codes || schedule?.axisCodes);
  if (!scheduleAxisCodes.length) {
    return false;
  }
  const subExperimentCode = normalizeText(schedule?.sub_experiment_code || schedule?.subExperimentCode || schedule?.sub_experiment_no || schedule?.subExperimentNo);
  const progress = resolveAxisProgress({
    experiment: buildExperimentMap(experiments).get(experimentCode),
    experimentCode,
    experimentRunSteps,
    experimentRunTrays,
    experiments,
    subExperimentCode,
    taskCode,
    trayCode,
  });
  const completedAxisCodes = new Set(asArray(progress?.completedAxisCodes).map(normalizeText).filter(Boolean));
  return scheduleAxisCodes.every((axisCode) => completedAxisCodes.has(normalizeText(axisCode)));
};

const trayAssignedExperimentsAreCompleted = ({ taskCode, trayCode, experimentTrays, experimentRunSteps, experimentRunTrays, experiments, schedules }) => {
  const trayExperimentCodes = collectTrayExperimentCodes({ taskCode, trayCode, experimentTrays });
  if (trayExperimentCodes.size === 0) {
    return false;
  }
  return Array.from(trayExperimentCodes).every((experimentCode) =>
    trayExperimentRunIsCompleted({ experimentCode, experimentRunSteps, experimentRunTrays, experiments, schedules, taskCode, trayCode }),
  );
};

const resolveTrayExperimentTypeText = ({ taskCode, trayCode, experiments, experimentTrays }) => {
  const experimentMap = buildExperimentMap(experiments);
  const names = [];
  collectTrayExperimentCodes({ taskCode, trayCode, experimentTrays }).forEach((experimentCode) => {
    const experimentName = resolveExperimentName(experimentMap.get(experimentCode), experimentCode);
    if (experimentName && !names.includes(experimentName)) {
      names.push(experimentName);
    }
  });
  return names.join(" / ");
};

const collectCompletedExperimentEvents = ({ samples, taskCode, trayCode }) => {
  const events = [];
  let sequence = 0;
  asArray(samples).forEach((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return;
    }
    const touchesTray = asArray(sample?.trays).some((tray) => normalizeText(tray?.tray_code) === trayCode);
    if (!touchesTray) {
      return;
    }
    asArray(sample?.history).forEach((entry) => {
      const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
      if (parsed && COMPLETED_EXPERIMENT_STATUSES.has(parsed.status)) {
        events.push({
          experimentName: parsed.experimentName,
          sequence,
          time: parseCompletedEventTimeValue(entry?.time || entry?.updated_at || entry?.created_at || entry?.timestamp),
        });
      }
      sequence += 1;
    });
  });
  return events;
};

const collectCompletedExperimentNames = ({ samples, taskCode, trayCode }) => {
  const names = new Set();
  collectCompletedExperimentEvents({ samples, taskCode, trayCode }).forEach((event) => {
    if (event.experimentName) {
      names.add(event.experimentName);
    }
  });
  return names;
};

const appearanceExperimentIsAllowed = (experimentName) =>
  requiresPreExperimentAppearanceStorage(experimentName);

const latestCompletedExperimentEvent = ({ samples, taskCode, trayCode, experiments, experimentRunSteps, experimentRunTrays }) => {
  const completedEvents = collectCompletedExperimentEvents({ samples, taskCode, trayCode });
  const experimentMap = buildExperimentMap(experiments);
  let sequence = completedEvents.length;
  asArray(experimentRunTrays).forEach((entry) => {
    if (
      normalizeText(entry?.task_code || entry?.taskCode || entry?.task_no || entry?.taskNo) !== taskCode
      || normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo) !== trayCode
      || !STRICT_COMPLETED_RUN_TRAY_STATUSES.has(normalizeText(entry?.run_tray_status || entry?.runTrayStatus || entry?.status))
    ) {
      return;
    }
    const experimentCode = normalizeText(entry?.experiment_code || entry?.experimentCode || entry?.experiment_no || entry?.experimentNo);
    const subExperimentCode = normalizeText(entry?.sub_experiment_code || entry?.subExperimentCode || entry?.sub_experiment_no || entry?.subExperimentNo);
    const experiment = experimentMap.get(experimentCode);
    if (isAxisProgressIncomplete(resolveAxisProgress({
      experiment,
      experimentCode,
      experimentRunSteps,
      experimentRunTrays,
      experiments,
      subExperimentCode,
      taskCode,
      trayCode,
    }))) {
      return;
    }
    const experimentName = resolveExperimentName(experiment, experimentCode);
    if (!experimentName) {
      return;
    }
    completedEvents.push({
      experimentName,
      sequence,
      time: parseCompletedEventTimeValue(entry?.completed_at || entry?.completedAt || entry?.ended_at || entry?.endedAt || entry?.updated_at || entry?.updatedAt || entry?.time || entry?.timestamp),
    });
    sequence += 1;
  });

  return completedEvents
    .filter((event) => normalizeText(event.experimentName))
    .sort((left, right) => (
      (Number(left.time) || 0) - (Number(right.time) || 0)
      || Number(left.sequence) - Number(right.sequence)
    ))
    .at(-1) || null;
};

const trayHasAllowedAppearanceSource = ({ samples, taskCode, trayCode, experiments, experimentRunSteps, experimentRunTrays }) => {
  const latestCompleted = latestCompletedExperimentEvent({ experiments, experimentRunSteps, experimentRunTrays, samples, taskCode, trayCode });
  if (appearanceExperimentIsAllowed(latestCompleted?.experimentName)) {
    return true;
  }
  const experimentMap = buildExperimentMap(experiments);
  return asArray(samples).some((sample) => (
    normalizeText(sample?.task_code) === normalizeText(taskCode)
    && asArray(sample?.trays).some((tray) => {
      if (normalizeText(tray?.tray_code) !== normalizeText(trayCode)) {
        return false;
      }
      const status = normalizeText(tray?.status);
      if (
        status !== APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
        && status !== APPEARANCE_STOCKED_STATUS
        && status !== "送至实验室"
      ) {
        return false;
      }
      const targetExperimentCode = normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
      const targetExperiment = experimentMap.get(targetExperimentCode);
      return requiresPreExperimentAppearanceStorage(
        tray?.target_lab,
        tray?.targetLab,
        targetExperimentCode,
        resolveExperimentName(targetExperiment),
      );
    })
  ));
};

const trayTargetsPreExperimentAppearance = ({ row, experiments }) => {
  const targetExperimentCode = normalizeText(row?.targetExperimentCode);
  const targetExperiment = buildExperimentMap(experiments).get(targetExperimentCode);
  return requiresPreExperimentAppearanceStorage(
    row?.targetLab,
    targetExperimentCode,
    resolveExperimentName(targetExperiment),
  );
};

const hasExplicitStagingInboundStatus = (statuses) =>
  asArray(statuses).some((status) => EXPLICIT_STAGING_INBOUND_STATUSES.has(normalizeText(status)));

const resolveInboundKind = ({ config, isExplicitStagingInbound, status }) => {
  if (normalizeText(status) !== "待入库") {
    return { inboundKind: "", inboundKindLabel: "" };
  }
  if (config.key === "staging" && isExplicitStagingInbound) {
    return { inboundKind: "planned", inboundKindLabel: "计划暂存" };
  }
  if (config.key === "appearance") {
    return { inboundKind: "appearance", inboundKindLabel: "计划入库" };
  }
  return { inboundKind: "allowed", inboundKindLabel: "允许暂存" };
};

const resolveTrayStatusLabel = ({ config, isPartialAxisInbound, isPostExperimentInbound, status }) => {
  const normalizedStatus = normalizeText(status);
  if (config.key !== "staging" || !isCurrentStagingStatus(normalizedStatus, config)) {
    return normalizedStatus;
  }
  if (isPostExperimentInbound) {
    return POST_EXPERIMENT_STAGING_LABEL;
  }
  if (isPartialAxisInbound) {
    return normalizedStatus;
  }
  return NORMAL_STAGING_LABEL;
};

const hasRemainingMappedExperiment = ({ samples, taskCode, trayCode, experiments, experimentTrays, experimentRunSteps, experimentRunTrays, schedules }) => {
  const experimentMap = buildExperimentMap(experiments);
  const trayExperimentCodes = collectTrayExperimentCodes({ taskCode, trayCode, experimentTrays });
  if (trayExperimentCodes.size === 0) {
    return false;
  }

  const completedExperimentNames = collectCompletedExperimentNames({ samples, taskCode, trayCode });
  return Array.from(trayExperimentCodes).some((experimentCode) => {
    if (trayExperimentRunIsCompleted({ experimentCode, experimentRunSteps, experimentRunTrays, experiments, schedules, taskCode, trayCode })) {
      return false;
    }
    const experimentName = resolveExperimentName(experimentMap.get(experimentCode));
    return !experimentName || !completedExperimentNames.has(experimentName);
  });
};

const resolveTrayTargetDestinations = ({ row, samples, schedules, experiments, experimentTrays, experimentRunSteps, experimentRunTrays, devices = [], now = serverNowDate(), room = "staging" }) => {
  const config = resolveStorageRoomConfig(room);
  const taskCode = normalizeText(row?.taskCode);
  const trayCode = normalizeText(row?.trayCode);
  if (!taskCode || !trayCode) {
    return [];
  }

  const experimentMap = buildExperimentMap(experiments);
  const trayExperimentCodes = collectTrayExperimentCodes({ taskCode, trayCode, experimentTrays });
  const completedExperimentNames = collectCompletedExperimentNames({ samples, taskCode, trayCode });
  const restrictToAppearanceDestinations =
    config.key === "appearance"
    && asArray(row?.statuses).some((status) => normalizeText(status) === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS);
  const originalTargetExperimentCode = normalizeText(row?.originalTargetExperimentCode || row?.targetExperimentCode);
  const originalTargetLab = normalizeText(row?.originalTargetLab || row?.targetLab);
  const destinationMatchesOriginalPlan = (destination) => {
    if (!restrictToAppearanceDestinations || (!originalTargetExperimentCode && !originalTargetLab)) {
      return false;
    }
    const experimentMatches = !originalTargetExperimentCode
      || normalizeText(destination?.targetExperimentCode) === originalTargetExperimentCode;
    const labMatches = !originalTargetLab || normalizeText(destination?.targetLab) === originalTargetLab;
    return experimentMatches && labMatches;
  };
  const markOriginalPlan = (destination) => {
    const originalPlanned = destinationMatchesOriginalPlan(destination);
    return {
      ...destination,
      originalPlanned,
      preferred: originalPlanned,
    };
  };
  const deviceMatchesDestination = (device, destination) => {
    const target = {
      labCode: destination?.targetLabCode,
      labId: destination?.targetLabId,
      name: destination?.targetLab,
    };
    const identities = [
      {
        device: normalizeText(device?.code),
        lab_code: device?.lab_code || device?.labCode || device?.code,
        lab_id: device?.lab_id ?? device?.labId ?? "",
      },
      { device: normalizeText(device?.location) },
      { device: normalizeText(device?.name) },
    ];
    return identities.some((identity) => labIdentityMatches(identity, target));
  };
  const finalizeDestinations = (destinations) => {
    const annotated = asArray(destinations).map((destination) => {
      if (normalizeText(destination?.targetType) === "staging") {
        return { ...destination, targetAvailable: true };
      }
      const device = asArray(devices).find((candidate) => deviceMatchesDestination(candidate, destination));
      const maintenance = resolveActiveDeviceMaintenance(device, now);
      if (!maintenance) {
        return { ...destination, targetAvailable: true };
      }
      const endLabel = maintenance.endAt ? `，预计结束：${formatLocalDateTime(maintenance.endAt)}` : "";
      return {
        ...destination,
        preferred: Boolean(destination.originalPlanned),
        targetAvailable: false,
        targetUnavailableReason: `${destination.targetLab}正在${maintenance.status}，暂不可送入${endLabel}`,
      };
    });
    if (
      !restrictToAppearanceDestinations
      && !annotated.some((destination) => destination.preferred && destination.targetAvailable !== false)
    ) {
      const nextPreferred = annotated.find((destination) => destination.scheduled && destination.targetAvailable !== false);
      if (nextPreferred) {
        nextPreferred.preferred = true;
      }
    }
    return annotated;
  };
  const acceptsExperimentCode = (experimentCode) => trayExperimentCodes.size === 0 || trayExperimentCodes.has(normalizeText(experimentCode));
  const appearanceAcceptsExperiment = (experiment, fallbackName = "") =>
    !restrictToAppearanceDestinations
    || requiresPreExperimentAppearanceStorage(
      resolveExperimentName(experiment, fallbackName),
      experiment?.required_device,
      experiment?.experiment_name,
      experiment?.experiment_type,
      experiment?.test_type,
    );
  const isUnfinishedExperiment = (experimentCode, fallbackName = "") => {
    if (trayExperimentRunIsCompleted({
      experimentCode: normalizeText(experimentCode),
      experimentRunSteps,
      experimentRunTrays,
      experiments,
      schedules,
      taskCode,
      trayCode,
    })) {
      return false;
    }
    const experiment = experimentMap.get(normalizeText(experimentCode));
    const experimentName = resolveExperimentName(experiment, fallbackName);
    return !experimentName || !completedExperimentNames.has(experimentName);
  };

  const candidateExperiments = asArray(experiments).filter((experiment) => {
    const experimentCode = normalizeText(experiment?.experiment_code);
    return (
      normalizeText(experiment?.task_code) === taskCode
      && acceptsExperimentCode(experimentCode)
      && appearanceAcceptsExperiment(experiment)
      && isUnfinishedExperiment(experimentCode, experiment?.experiment_name)
    );
  });

  const scheduledCandidates = [];
  candidateExperiments.forEach((experiment) => {
    const nextExperimentCode = normalizeText(experiment?.experiment_code);
    const scheduledDestinations = asArray(schedules)
      .filter((schedule) => {
        const device = normalizeText(schedule?.device);
        return (
          normalizeText(schedule?.task_code) === taskCode
          && normalizeText(schedule?.experiment_code) === nextExperimentCode
          && device
          && !isStagingDestination(device)
          && !scheduleAxisBatchIsCompleted({
            experimentCode: nextExperimentCode,
            experimentRunSteps,
            experimentRunTrays,
            experiments,
            schedule,
            taskCode,
            trayCode,
          })
        );
      })
      .sort((left, right) => parseTimeValue(left?.start_at) - parseTimeValue(right?.start_at));

    const scheduled = scheduledDestinations[0];
    if (scheduled) {
      scheduledCandidates.push(markOriginalPlan({
        preferred: false,
        scheduled: true,
        targetExperimentCode: nextExperimentCode,
        targetExperimentName: resolveExperimentName(experiment, scheduled?.experiment_name),
        targetIsFallback: false,
        targetLab: normalizeText(scheduled?.device),
        targetLabCode: resolveScheduleLabCode(scheduled),
        targetLabId: resolveScheduleLabId(scheduled),
        targetScheduleStartAt: normalizeText(scheduled?.start_at),
        targetScheduleEndAt: normalizeText(scheduled?.end_at),
        targetUnavailableReason: "",
      }));
      return;
    }

  });

  scheduledCandidates.sort(
    (left, right) =>
      Number(Boolean(right?.originalPlanned)) - Number(Boolean(left?.originalPlanned))
      || parseTimeValue(left?.targetScheduleStartAt) - parseTimeValue(right?.targetScheduleStartAt)
      || normalizeText(left?.targetLab).localeCompare(normalizeText(right?.targetLab), "zh-Hans-CN"),
  );
  if (!restrictToAppearanceDestinations && scheduledCandidates.length) {
    const earliest = parseTimeValue(scheduledCandidates[0]?.targetScheduleStartAt);
    const earliestCount = scheduledCandidates.filter((item) => parseTimeValue(item?.targetScheduleStartAt) === earliest).length;
    if (earliestCount === 1) {
      scheduledCandidates[0].preferred = true;
    }
  }
  const directScheduledCandidates = scheduledCandidates.length || trayExperimentCodes.size > 0
    ? []
    : asArray(schedules)
      .filter((schedule) => {
        const experimentCode = normalizeText(schedule?.experiment_code);
        const device = normalizeText(schedule?.device);
        return (
          normalizeText(schedule?.task_code) === taskCode
          && device
          && !isStagingDestination(device)
          && acceptsExperimentCode(experimentCode)
          && appearanceAcceptsExperiment(experimentMap.get(experimentCode), schedule?.experiment_name)
          && isUnfinishedExperiment(experimentCode, schedule?.experiment_name)
          && !scheduleAxisBatchIsCompleted({
            experimentCode,
            experimentRunSteps,
            experimentRunTrays,
            experiments,
            schedule,
            taskCode,
            trayCode,
          })
        );
      })
      .map((schedule) => {
        const experimentCode = normalizeText(schedule?.experiment_code);
        const experiment = experimentMap.get(experimentCode);
        return markOriginalPlan({
          preferred: false,
          scheduled: true,
          targetExperimentCode: experimentCode,
          targetExperimentName: resolveExperimentName(experiment, schedule?.experiment_name),
          targetIsFallback: false,
          targetLab: normalizeText(schedule?.device),
          targetLabCode: resolveScheduleLabCode(schedule),
          targetLabId: resolveScheduleLabId(schedule),
          targetScheduleStartAt: normalizeText(schedule?.start_at),
          targetScheduleEndAt: normalizeText(schedule?.end_at),
          targetUnavailableReason: "",
        });
      })
    .sort((left, right) => (
      Number(Boolean(right?.originalPlanned)) - Number(Boolean(left?.originalPlanned))
      || parseTimeValue(left?.targetScheduleStartAt) - parseTimeValue(right?.targetScheduleStartAt)
    ));

  const appearanceStagingDestination = config.key === "appearance"
    ? [{
        originalPlanned: false,
        preferred: !restrictToAppearanceDestinations && directScheduledCandidates.length === 0 && scheduledCandidates.length === 0,
        scheduled: true,
        targetExperimentCode: "",
        targetExperimentName: "暂存间存放",
        targetIsFallback: false,
        targetLab: STAGING_LOCATION,
        targetScheduleStartAt: "",
        targetScheduleEndAt: "",
        targetType: "staging",
        targetUnavailableReason: "",
      }]
    : [];

  if (directScheduledCandidates.length) {
    if (!restrictToAppearanceDestinations) {
      const earliest = parseTimeValue(directScheduledCandidates[0]?.targetScheduleStartAt);
      const earliestCount = directScheduledCandidates.filter((item) => parseTimeValue(item?.targetScheduleStartAt) === earliest).length;
      if (earliestCount === 1) {
        directScheduledCandidates[0].preferred = true;
      }
    }
    return finalizeDestinations([...directScheduledCandidates, ...appearanceStagingDestination]);
  }

  if (scheduledCandidates.length || trayExperimentCodes.size > 0) {
    return finalizeDestinations([...scheduledCandidates, ...appearanceStagingDestination]);
  }

  return finalizeDestinations(appearanceStagingDestination);
};


export {
  appearanceExperimentIsAllowed,
  buildExperimentMap,
  collectCompletedExperimentEvents,
  collectCompletedExperimentNames,
  collectTrayExperimentCodes,
  findAxisSchedulesForExperiment,
  hasAppearanceStockInBeforeLatestLabDispatch,
  hasExplicitStagingInboundStatus,
  hasPendingSiblingAxisSchedule,
  hasRemainingMappedExperiment,
  latestAppearanceLabDispatchRequiresPreExperiment,
  latestCompletedExperimentEvent,
  latestPartialAxisRunCompletionTime,
  resolveInboundKind,
  resolveTrayExperimentTypeText,
  resolveTrayStatusLabel,
  resolveTrayTargetDestinations,
  scheduleAxisBatchIsCompleted,
  trayAssignedExperimentsAreCompleted,
  trayHasAllowedAppearanceSource,
  trayHasLabStockOutAtOrAfter,
  trayHasNewerAxisLabActivity,
  trayTargetsPreExperimentAppearance,
};
