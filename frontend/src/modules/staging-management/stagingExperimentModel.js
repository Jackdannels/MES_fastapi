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

const scheduleRunIsCompletedForTray = ({ experimentRuns, experimentRunTrays, schedule, taskCode, trayCode }) => {
  const scheduleId = normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId);
  const experimentCode = normalizeText(schedule?.experiment_code || schedule?.experimentCode);
  if (!scheduleId || !experimentCode) {
    return false;
  }
  const runByNo = new Map(asArray(experimentRuns).map((run) => [
    normalizeText(run?.run_no || run?.runNo || run?.id),
    run,
  ]));
  return asArray(experimentRunTrays).some((relation) => {
    const runNo = normalizeText(relation?.run_no || relation?.runNo);
    const run = runByNo.get(runNo);
    const relationScheduleId = normalizeText(
      relation?.schedule_id
      || relation?.scheduleId
      || run?.schedule_id
      || run?.scheduleId
      || run?.schedule_no,
    );
    return normalizeText(relation?.task_code || relation?.taskCode || relation?.task_no) === taskCode
      && normalizeText(relation?.tray_code || relation?.trayCode || relation?.tray_no) === trayCode
      && normalizeText(relation?.experiment_code || relation?.experimentCode || relation?.experiment_no) === experimentCode
      && COMPLETED_RUN_TRAY_STATUSES.has(normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status))
      && relationScheduleId === scheduleId;
  });
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

const resolveTrayTargetDestinations = ({ row, schedules, experiments, experimentTrays, experimentRuns, experimentRunTrays, devices = [], now = serverNowDate(), room = "staging" }) => {
  const config = resolveStorageRoomConfig(room);
  const taskCode = normalizeText(row?.taskCode);
  const trayCode = normalizeText(row?.trayCode);
  if (!taskCode || !trayCode) {
    return [];
  }

  const experimentMap = buildExperimentMap(experiments);
  const trayExperimentCodes = collectTrayExperimentCodes({ taskCode, trayCode, experimentTrays });
  const restrictToAppearanceDestinations =
    config.key === "appearance"
    && asArray(row?.statuses).some((status) => normalizeText(status) === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS);
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
  const acceptsExperimentCode = (experimentCode) => trayExperimentCodes.has(normalizeText(experimentCode));
  const scheduledCandidates = asArray(schedules)
    .filter((schedule) => {
      const experimentCode = normalizeText(schedule?.experiment_code);
      const device = normalizeText(schedule?.device);
      return (
        normalizeText(schedule?.task_code) === taskCode
        && acceptsExperimentCode(experimentCode)
        && device
        && !isStagingDestination(device)
        && !scheduleRunIsCompletedForTray({
          experimentRuns,
          experimentRunTrays,
          schedule,
          taskCode,
          trayCode,
        })
      );
    })
    .sort((left, right) => {
      const timeDifference = parseTimeValue(left?.start_at) - parseTimeValue(right?.start_at);
      if (timeDifference) {
        return timeDifference;
      }
      return normalizeText(left?.id || left?.schedule_id || left?.scheduleId).localeCompare(
        normalizeText(right?.id || right?.schedule_id || right?.scheduleId),
      );
    });

  const nextSchedule = scheduledCandidates[0] || null;
  const nextExperimentCode = normalizeText(nextSchedule?.experiment_code);
  const nextExperiment = experimentMap.get(nextExperimentCode);
  const nextTargetLab = normalizeText(nextSchedule?.device);
  const nextRequiresAppearance = !nextSchedule || requiresPreExperimentAppearanceStorage(
    resolveExperimentName(nextExperiment, nextSchedule?.experiment_name),
    nextExperiment?.required_device,
    nextExperiment?.experiment_name,
    nextExperiment?.experiment_type,
    nextExperiment?.test_type,
  );
  let nextDestination = nextSchedule
    ? {
        axisBatchNo: normalizeText(nextSchedule?.axis_batch_no ?? nextSchedule?.axisBatchNo),
        axisCodes: normalizeAxisCodes(nextSchedule?.axis_codes ?? nextSchedule?.axisCodes),
        preferred: true,
        scheduleId: normalizeText(nextSchedule?.id || nextSchedule?.schedule_id || nextSchedule?.scheduleId),
        scheduled: true,
        subExperimentCode: normalizeText(
          nextSchedule?.sub_experiment_code
          || nextSchedule?.subExperimentCode
          || nextSchedule?.sub_experiment_no
          || nextSchedule?.subExperimentNo,
        ),
        targetExperimentCode: nextExperimentCode,
        targetExperimentName: resolveExperimentName(nextExperiment, nextSchedule?.experiment_name),
        targetIsFallback: false,
        targetLab: nextTargetLab,
        targetLabCode: resolveScheduleLabCode(nextSchedule),
        targetLabId: resolveScheduleLabId(nextSchedule),
        targetScheduleStartAt: normalizeText(nextSchedule?.start_at),
        targetScheduleEndAt: normalizeText(nextSchedule?.end_at),
        targetType: "lab",
        targetUnavailableReason: "",
      }
    : null;

  if (nextDestination) {
    const device = asArray(devices).find((candidate) => deviceMatchesDestination(candidate, nextDestination));
    const maintenance = resolveActiveDeviceMaintenance(device, now);
    if (restrictToAppearanceDestinations && !nextRequiresAppearance) {
      nextDestination = {
        ...nextDestination,
        targetAvailable: false,
        targetUnavailableReason: "当前下一排程不需要实验前外观检查，请先确认托盘状态。",
      };
    } else if (maintenance) {
      const endLabel = maintenance.endAt ? `，预计结束：${formatLocalDateTime(maintenance.endAt)}` : "";
      nextDestination = {
        ...nextDestination,
        targetAvailable: false,
        targetUnavailableReason: `${nextDestination.targetLab}正在${maintenance.status}，暂不可送入${endLabel}`,
      };
    } else {
      nextDestination = { ...nextDestination, targetAvailable: true };
    }
  }

  const appearanceStagingDestination = config.key === "appearance"
    ? [{
        preferred: !nextDestination,
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

  return [...(nextDestination ? [nextDestination] : []), ...appearanceStagingDestination];
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
