import { APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS } from "@/modules/samples/sampleFlow.constants";
import { serverNowDate } from "@/lib/serverClock";
import { experimentScopeIsTerminal } from "@/modules/experiment-progress/model";
import {
  COMPLETED_EXPERIMENT_STATUSES,
  DEVICES_KEY,
  EXPERIMENTS_KEY,
  EXPERIMENT_RUN_STEPS_KEY,
  EXPERIMENT_RUN_TRAYS_KEY,
  EXPERIMENT_RUNS_KEY,
  EXPERIMENT_RUN_PAUSES_KEY,
  EXPERIMENT_TRAYS_KEY,
  SAMPLES_KEY,
  SCHEDULES_KEY,
  STAGING_EVENTS_KEY,
  STAGING_STOCKED_STATUS,
  TASKS_KEY,
  asArray,
  buildAllEventMap,
  buildEventMap,
  buildTaskMap,
  compareValues,
  createId,
  eventTargetsPostExperimentStaging,
  eventTargetsStorageRoom,
  formatDateTime,
  hasAppearanceStorageStatus,
  hasPostExperimentStagingStorageStatus,
  hasPreAppearanceInboundStatus,
  isCurrentStagingStatus,
  isHandoverLocation,
  normalizeText,
  resolveLatestAppearanceWithdrawalRestoreStatus,
  resolveStatusClass,
  resolveStorageInboundSourceLabel,
  resolveStorageRoomConfig,
  resolveTrayStatus,
  toDateKey,
} from "./stagingStorageModel";
import {
  hasAppearanceStockInBeforeLatestLabDispatch,
  hasExplicitStagingInboundStatus,
  hasRemainingMappedExperiment,
  latestAppearanceLabDispatchRequiresPreExperiment,
  latestPartialAxisRunCompletionTime,
  resolveInboundKind,
  resolveTrayExperimentTypeText,
  resolveTrayStatusLabel,
  resolveTrayTargetDestinations,
  trayAssignedExperimentsAreCompleted,
  trayHasAllowedAppearanceSource,
  trayHasLabStockOutAtOrAfter,
  trayHasNewerAxisLabActivity,
  trayTargetsPreExperimentAppearance,
} from "./stagingExperimentModel";


const collectTaskTrayCodes = (snapshot, taskCode) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const codes = new Set();
  asArray(snapshot[EXPERIMENT_TRAYS_KEY]).forEach((entry) => {
    const trayCode = normalizeText(entry?.tray_code);
    if (normalizeText(entry?.task_code) === normalizedTaskCode && trayCode) {
      codes.add(trayCode);
    }
  });
  asArray(snapshot[SAMPLES_KEY]).forEach((sample) => {
    if (normalizeText(sample?.task_code) !== normalizedTaskCode) {
      return;
    }
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (trayCode) {
        codes.add(trayCode);
      }
    });
  });
  return Array.from(codes);
};

const markReturnedTaskIfComplete = (snapshot, taskCode) => {
  const normalizedTaskCode = normalizeText(taskCode);
  if (!normalizedTaskCode) {
    return;
  }
  const trayCodes = collectTaskTrayCodes(snapshot, normalizedTaskCode);
  if (trayCodes.length === 0) {
    return;
  }
  const eventMap = buildEventMap(snapshot[STAGING_EVENTS_KEY]);
  const allReturned = trayCodes.every((trayCode) => normalizeText(eventMap.get(trayCode)?.at(-1)?.action) === "manufacturer_return");
  if (!allReturned) {
    return;
  }
  snapshot[TASKS_KEY] = asArray(snapshot[TASKS_KEY]).map((task) =>
    normalizeText(task?.code) === normalizedTaskCode
      ? {
          ...task,
          status: "厂家收回",
          transfer_status: "厂家收回",
        }
      : task,
  );
};

const pruneTerminalExperimentSchedules = (snapshot, taskCode) => {
  const normalizedTaskCode = normalizeText(taskCode);
  if (!normalizedTaskCode) {
    return;
  }
  const experiments = asArray(snapshot[EXPERIMENTS_KEY]);
  const experimentTrays = asArray(snapshot[EXPERIMENT_TRAYS_KEY]);
  const experimentRunSteps = asArray(snapshot[EXPERIMENT_RUN_STEPS_KEY]);
  const experimentRunTrays = asArray(snapshot[EXPERIMENT_RUN_TRAYS_KEY]);
  const samples = asArray(snapshot[SAMPLES_KEY]);
  const terminalExperimentCodes = new Set();

  experiments.forEach((experiment) => {
    const experimentCode = normalizeText(experiment?.experiment_code);
    if (normalizeText(experiment?.task_code) !== normalizedTaskCode || !experimentCode) {
      return;
    }
    if (experimentScopeIsTerminal({
      experiments,
      experimentCode,
      experimentRunSteps,
      experimentRunTrays,
      experimentTrays,
      samples,
      taskCode: normalizedTaskCode,
    })) {
      terminalExperimentCodes.add(experimentCode);
    }
  });

  if (!terminalExperimentCodes.size) {
    return;
  }

  snapshot[SCHEDULES_KEY] = asArray(snapshot[SCHEDULES_KEY]).filter((schedule) =>
    normalizeText(schedule?.task_code) !== normalizedTaskCode
    || !terminalExperimentCodes.has(normalizeText(schedule?.experiment_code)),
  );
  snapshot[EXPERIMENTS_KEY] = experiments.map((experiment) =>
    normalizeText(experiment?.task_code) === normalizedTaskCode
      && terminalExperimentCodes.has(normalizeText(experiment?.experiment_code))
      ? { ...experiment, status: "实验已完成" }
      : experiment,
  );
};

function buildZancunRowsFromSnapshot(snapshot = {}, options = {}) {
  const config = resolveStorageRoomConfig(options.room);
  const tasks = asArray(snapshot[TASKS_KEY]);
  const devices = asArray(snapshot[DEVICES_KEY]);
  const schedules = asArray(snapshot[SCHEDULES_KEY]);
  const experiments = asArray(snapshot[EXPERIMENTS_KEY]);
  const experimentTrays = asArray(snapshot[EXPERIMENT_TRAYS_KEY]);
  const experimentRunTrays = asArray(snapshot[EXPERIMENT_RUN_TRAYS_KEY]);
  const experimentRunSteps = asArray(snapshot[EXPERIMENT_RUN_STEPS_KEY]);
  const experimentRuns = asArray(snapshot[EXPERIMENT_RUNS_KEY]);
  const experimentRunPauses = asArray(snapshot[EXPERIMENT_RUN_PAUSES_KEY]);
  const samples = asArray(snapshot[SAMPLES_KEY]);
  const stagingEvents = asArray(snapshot[STAGING_EVENTS_KEY]);
  const taskMap = buildTaskMap(tasks);
  const eventMap = buildEventMap(stagingEvents, config);
  const allEventMap = buildAllEventMap(stagingEvents);
  const trayMap = new Map();

  samples.forEach((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    asArray(sample?.trays).forEach((tray, trayIndex) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (!trayCode) {
        return;
      }

      const task = taskMap.get(taskCode) || {};
      const trayExperimentTypeText = resolveTrayExperimentTypeText({
        experiments,
        experimentTrays,
        taskCode,
        trayCode,
      });
      const fallbackSampleType = normalizeText(task?.test_type || task?.sample_type || sample?.sample_type) || "待确认样品类型";
      const current = trayMap.get(trayCode) || {
        id: createId("zancun-row"),
        location: normalizeText(sample?.location) || config.currentLocation,
        owner: normalizeText(sample?.owner) || "待确认",
        quantity: 0,
        sampleType: trayExperimentTypeText || fallbackSampleType,
        source: normalizeText(task?.source) || "待确认来源",
        inboundTargetExperimentCode: "",
        inboundTargetLab: "",
        withdrawalRestoreStatuses: [],
        statuses: [],
        taskCode,
        targetExperimentCode: "",
        targetLab: "",
        testType: normalizeText(task?.test_type),
        trayCode,
      };

      current.taskCode = current.taskCode || taskCode;
      current.owner = current.owner || normalizeText(sample?.owner) || "待确认";
      current.location = current.location || normalizeText(sample?.location) || config.currentLocation;
      current.sampleType = trayExperimentTypeText || current.sampleType || fallbackSampleType;
      current.source = current.source || normalizeText(task?.source) || "待确认来源";
      current.testType = current.testType || normalizeText(task?.test_type);
      const trayTargetExperimentCode = normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
      const trayTargetLab = normalizeText(tray?.target_lab || tray?.targetLab);
      current.inboundTargetExperimentCode = current.inboundTargetExperimentCode || trayTargetExperimentCode;
      current.inboundTargetLab = current.inboundTargetLab || trayTargetLab;
      current.targetExperimentCode = current.targetExperimentCode || trayTargetExperimentCode;
      current.targetLab = current.targetLab || trayTargetLab;
      current.quantity += Number(tray?.quantity) || 1;
      const rowStatuses = [
        normalizeText(tray?.status),
        normalizeText(sample?.status),
        normalizeText(sample?.flow_status),
      ].filter(Boolean);
      const withdrawalRestoreStatus = resolveLatestAppearanceWithdrawalRestoreStatus({ sample, taskCode });
      if (withdrawalRestoreStatus && !current.withdrawalRestoreStatuses.includes(withdrawalRestoreStatus)) {
        current.withdrawalRestoreStatuses.push(withdrawalRestoreStatus);
      }
      current.statuses.push(...(rowStatuses.length > 0 ? rowStatuses : [`${taskCode}-tray-${trayIndex + 1}`]));
      trayMap.set(trayCode, current);
    });
  });

  eventMap.forEach((events, trayCode) => {
    if (!trayMap.has(trayCode)) {
      const latestEvent = events.at(-1) || {};
      trayMap.set(trayCode, {
        id: createId("zancun-row"),
        location: config.currentLocation,
        owner: normalizeText(latestEvent?.operator) || "待确认",
        quantity: 0,
        sampleType: "待确认样品类型",
        source: "待确认来源",
        statuses: [],
        taskCode: normalizeText(latestEvent?.task_code),
        inboundTargetExperimentCode: "",
        inboundTargetLab: "",
        withdrawalRestoreStatuses: [],
        testType: "",
        trayCode,
      });
    }
  });

  return Array.from(trayMap.values())
    .map((row) => {
      const events = eventMap.get(row.trayCode) || [];
      const lastEvent = events.at(-1) || null;
      const trayStorageEvents = allEventMap.get(row.trayCode) || [];
      const latestStorageEvent = trayStorageEvents.at(-1) || null;
      const storageEventContext = {
        location: row.location,
        statuses: row.statuses,
      };
      const inboundSourceLabel = resolveStorageInboundSourceLabel(trayStorageEvents, config, storageEventContext);
      const latestEventDispatchesToCurrentRoom = eventTargetsStorageRoom(latestStorageEvent, config, storageEventContext);
      const latestAction = normalizeText(latestStorageEvent?.action);
      const eventDerivedWithdrawalRestoreStatus =
        config.key === "appearance"
        && latestAction === "stock_out_withdraw"
        && latestAppearanceLabDispatchRequiresPreExperiment({ events, experiments })
          ? APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
          : "";
      const effectiveStatuses =
        latestAction === "stock_out_withdraw"
          ? [...row.statuses, ...asArray(row.withdrawalRestoreStatuses), eventDerivedWithdrawalRestoreStatus].filter(Boolean)
          : row.statuses;
      const storedInPostExperimentStaging =
        hasPostExperimentStagingStorageStatus(row)
        && !(config.key === "appearance" && latestEventDispatchesToCurrentRoom);
      const storedInAppearance =
        hasAppearanceStorageStatus(row)
        && !(config.key === "staging" && latestEventDispatchesToCurrentRoom);
      const latestEventDispatchesToPostExperimentStaging =
        config.key === "appearance"
        && latestAction === "stock_out"
        && eventTargetsPostExperimentStaging(latestStorageEvent);
      const appearanceAlreadyDispatchedFromStorage =
        hasAppearanceStockInBeforeLatestLabDispatch({ config, latestStorageEvent, trayStorageEvents });
      const appearancePreInspectionAlreadyDispatched = appearanceAlreadyDispatchedFromStorage;
      const lastStockInEvent = events
        .slice()
        .reverse()
        .find((event) => normalizeText(event?.action) === "stock_in") || null;
      const hasCompletedExperimentStatus = row.statuses.some((status) => COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(status)));
      const midPause = config.key === "appearance"
        ? experimentRunPauses.find((pause) => {
          const runNo = normalizeText(pause?.run_no || pause?.runNo);
          const run = experimentRuns.find((item) => normalizeText(item?.run_no || item?.runNo) === runNo);
          const belongsToRun = experimentRunTrays.some((relation) => (
            normalizeText(relation?.run_no || relation?.runNo) === runNo
            && normalizeText(relation?.tray_code || relation?.trayCode || relation?.tray_no || relation?.trayNo) === normalizeText(row.trayCode)
          ));
          return normalizeText(pause?.status) === "实验暂停"
            && normalizeText(run?.status || run?.run_status) === "实验暂停"
            && belongsToRun
            && asArray(pause?.inspection_tray_codes || pause?.inspectionTrayCodes)
              .some((code) => normalizeText(code) === normalizeText(row.trayCode))
            && (normalizeText(pause?.lab_code || pause?.labCode) === "LAB_SALT" || normalizeText(run?.device).includes("盐雾"));
        })
        : null;
      const midRun = midPause
        ? experimentRuns.find((run) => normalizeText(run?.run_no || run?.runNo) === normalizeText(midPause?.run_no || midPause?.runNo))
        : null;
      const midPauseNo = normalizeText(midPause?.pause_no || midPause?.pauseNo);
      const midRunNo = normalizeText(midPause?.run_no || midPause?.runNo);
      const latestMidPauseEvent = midPause
        ? trayStorageEvents
          .filter((event) => (
            normalizeText(event?.room) === "appearance"
            && normalizeText(event?.appearance_phase || event?.appearancePhase) === "mid_experiment"
            && normalizeText(event?.run_no || event?.runNo) === midRunNo
            && normalizeText(event?.pause_no || event?.pauseNo) === midPauseNo
          ))
          .at(-1) || null
        : null;
      const midPauseAwaitingStockIn = Boolean(midPause) && !latestMidPauseEvent;
      const midPauseStockedIn = normalizeText(latestMidPauseEvent?.action) === "stock_in";
      const midPauseCompleted = normalizeText(latestMidPauseEvent?.action) === "stock_out";
      const allAssignedExperimentsCompleted = trayAssignedExperimentsAreCompleted({
        experiments,
        experimentRunTrays,
        experimentRunSteps,
        experimentTrays,
        schedules,
        taskCode: normalizeText(row.taskCode),
        trayCode: normalizeText(row.trayCode),
      });
      const partialAxisCompletionTime = config.key === "staging"
        ? latestPartialAxisRunCompletionTime({
          experiments,
          experimentRunSteps,
          experimentRunTrays,
          schedules,
          taskCode: normalizeText(row.taskCode),
          trayCode: normalizeText(row.trayCode),
        })
        : 0;
      const latestLabStockOutAfterPartialAxisCompletion =
        config.key === "staging"
        && trayHasLabStockOutAtOrAfter({
          config,
          context: storageEventContext,
          events: trayStorageEvents,
          timestamp: partialAxisCompletionTime,
        });
      const isPartialAxisInbound =
        config.key === "staging"
        && partialAxisCompletionTime > 0
        && !latestLabStockOutAfterPartialAxisCompletion
        && !trayHasNewerAxisLabActivity({
          experimentRunTrays,
          samples,
          taskCode: normalizeText(row.taskCode),
          trayCode: normalizeText(row.trayCode),
          timestamp: partialAxisCompletionTime,
        });
      const explicitAppearanceInboundStatus =
        hasPreAppearanceInboundStatus(effectiveStatuses)
        && (config.key === "appearance" || !latestEventDispatchesToCurrentRoom);
      const hasPreExperimentAppearanceStorageStatus = effectiveStatuses.some(
        (statusItem) => normalizeText(statusItem) === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
      );
      const isPreExperimentAppearanceLabDispatch =
        config.key === "appearance"
        && !appearancePreInspectionAlreadyDispatched
        && row.statuses.some((statusItem) => normalizeText(statusItem) === "送至实验室")
        && trayTargetsPreExperimentAppearance({ experiments, row });
      const postExperimentRequiresAppearanceInbound =
        hasCompletedExperimentStatus
        && trayHasAllowedAppearanceSource({
          experiments,
          experimentRunSteps,
          experimentRunTrays,
          samples,
          taskCode: normalizeText(row.taskCode),
          trayCode: normalizeText(row.trayCode),
        });
      const isPostExperimentAppearanceInbound =
        config.key === "appearance"
        && !storedInPostExperimentStaging
        && postExperimentRequiresAppearanceInbound;
      const isExplicitStagingInbound =
        config.key === "staging"
        && (
          latestEventDispatchesToCurrentRoom
          || hasExplicitStagingInboundStatus(row.statuses)
        );
      const isPostExperimentInbound =
        !explicitAppearanceInboundStatus
        && !isPartialAxisInbound
        && !(config.key === "staging" && storedInAppearance)
        && (hasCompletedExperimentStatus || allAssignedExperimentsCompleted)
        && !hasRemainingMappedExperiment({
          experiments,
          experimentRunSteps,
          experimentRunTrays,
          experimentTrays,
          schedules,
          samples,
          taskCode: normalizeText(row.taskCode),
          trayCode: normalizeText(row.trayCode),
        });
      let status = resolveTrayStatus(effectiveStatuses, events, { isPartialAxisInbound, isPostExperimentInbound, room: config.key });
      if (isPreExperimentAppearanceLabDispatch) {
        status = "待入库";
      }
      if (isPostExperimentAppearanceInbound && !isCurrentStagingStatus(status, config)) {
        status = "待入库";
      }
      if (midPauseAwaitingStockIn && !isCurrentStagingStatus(status, config)) {
        status = "待入库";
      }
      if (midPauseStockedIn) {
        status = "中途外观检查中";
      }
      if (midPauseCompleted) {
        status = "";
      }
      if (latestEventDispatchesToCurrentRoom && !(config.key === "appearance" && hasPreExperimentAppearanceStorageStatus)) {
        status = "待入库";
      }
      if (config.key === "appearance" && latestEventDispatchesToPostExperimentStaging) {
        status = "";
      }
      if (
        (config.key === "appearance" && storedInPostExperimentStaging)
        || (config.key === "staging" && storedInAppearance)
      ) {
        status = "";
      }
      if (latestAction === "manufacturer_return" || row.statuses.some((item) => normalizeText(item) === "厂家收回")) {
        status = "";
      }
      const rowLocation = normalizeText(row.location);
      if (
        config.key === "staging"
        && status === STAGING_STOCKED_STATUS
        && isHandoverLocation(rowLocation)
        && normalizeText(lastEvent?.action) !== "stock_in"
      ) {
        status = "";
      }
      if (
        config.key === "appearance"
        && status
        && !midPause
        && !trayHasAllowedAppearanceSource({
          experiments,
          experimentRunSteps,
          experimentRunTrays,
          samples,
          taskCode: normalizeText(row.taskCode),
          trayCode: normalizeText(row.trayCode),
        })
      ) {
        status = "";
      }
      const stockInToday = events.some(
        (event) => normalizeText(event?.action) === "stock_in" && toDateKey(event?.time) === toDateKey(options.now || serverNowDate()),
      );
      const stockOutToday =
        normalizeText(lastEvent?.action) === "stock_out"
        && toDateKey(lastEvent?.time) === toDateKey(options.now || serverNowDate());

      const targetDestinations = midPause
        ? [{
          preferred: true,
          scheduled: true,
          targetAvailable: true,
          targetExperimentCode: normalizeText(midPause?.experiment_code || midPause?.experimentCode || midRun?.experiment_code),
          targetExperimentName: "盐雾试验（中途检查返回）",
          targetLab: normalizeText(midRun?.device || midRun?.device_name) || "盐雾试验室",
          targetLabCode: normalizeText(midPause?.lab_code || midPause?.labCode) || "LAB_SALT",
          targetLabId: midRun?.lab_id || midRun?.labId || "",
          targetType: "lab",
          runNo: normalizeText(midPause?.run_no || midPause?.runNo),
        }]
        : resolveTrayTargetDestinations({
        devices,
        experiments,
        experimentRunSteps,
        experimentRunTrays,
        experimentRuns,
        experimentTrays,
        row: { ...row, isPartialAxisInbound },
        room: config.key,
        samples,
        schedules,
        now: options.now || serverNowDate(),
      });
      const targetDestination =
        targetDestinations.find((destination) => destination.preferred)
        || targetDestinations.find((destination) => destination.scheduled)
        || targetDestinations[0]
        || null;
      const inboundKind = resolveInboundKind({ config, isExplicitStagingInbound, status });
      const statusLabel = resolveTrayStatusLabel({
        config,
        experiments,
        experimentRunSteps,
        experimentRunTrays,
        isPartialAxisInbound,
        isPostExperimentInbound,
        samples,
        status,
        taskCode: row.taskCode,
        trayCode: row.trayCode,
      });

      return {
        id: row.id,
        ...inboundKind,
        location: status === "已出库" ? "已完成出库" : normalizeText(row.location) || config.currentLocation,
        owner: normalizeText(row.owner) || "待确认",
        quantity: Number(row.quantity) || 0,
        sampleType: normalizeText(row.sampleType) || "待确认样品类型",
        source: inboundSourceLabel || normalizeText(row.source) || "待确认来源",
        status,
        statusClass: resolveStatusClass(status),
        statusLabel,
        stockInAt: normalizeText(lastStockInEvent?.time),
        stockInAtDisplay: formatDateTime(lastStockInEvent?.time),
        stockInToday,
        stockOutToday,
        taskCode: normalizeText(row.taskCode),
        isPartialAxisInbound,
        isPostExperimentInbound,
        isPostExperimentAppearanceInbound,
        isPreExperimentAppearanceInbound: isPreExperimentAppearanceLabDispatch,
        isMidExperimentAppearanceInbound: Boolean(midPause) && !midPauseCompleted,
        midExperimentPauseNo: midPauseNo,
        midExperimentRunNo: midRunNo,
        inboundTargetExperimentCode: normalizeText(row.inboundTargetExperimentCode || row.targetExperimentCode),
        inboundTargetLab: normalizeText(row.inboundTargetLab || row.targetLab),
        targetExperimentCode: targetDestination?.targetExperimentCode || "",
        targetExperimentName: targetDestination?.targetExperimentName || "",
        targetIsFallback: Boolean(targetDestination?.targetIsFallback),
        targetLab: targetDestination?.targetLab || "",
        targetLabCode: targetDestination?.targetLabCode || "",
        targetLabId: targetDestination?.targetLabId || "",
        targetDestinations,
        targetScheduleEndAt: targetDestination?.targetScheduleEndAt || "",
        targetScheduleStartAt: targetDestination?.targetScheduleStartAt || "",
        targetUnavailableReason: targetDestination?.targetUnavailableReason || "",
        testType: normalizeText(row.testType),
        trayCode: normalizeText(row.trayCode),
        updatedAt: normalizeText(lastEvent?.time || lastStockInEvent?.time),
      };
    })
    .filter((row) => Boolean(row.status))
    .sort((left, right) => compareValues(left.trayCode, right.trayCode, "asc"));
}


export {
  buildZancunRowsFromSnapshot,
  collectTaskTrayCodes,
  markReturnedTaskIfComplete,
  pruneTerminalExperimentSchedules,
};
