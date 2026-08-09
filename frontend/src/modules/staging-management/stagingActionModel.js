import { synchronizeSamplesForTrayCodes } from "@/modules/samples/samplesFlowModel";
import { APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS } from "@/modules/samples/sampleFlow.constants";
import { formatLocalDateTime } from "@/lib/dateTime";
import { normalizeTrayScanCode } from "@/lib/trayQrCode";
import {
  APPEARANCE_MANUFACTURER_RETURN_ERROR,
  APPEARANCE_STOCKED_STATUS,
  EXPERIMENTS_KEY,
  EXPERIMENT_RUN_STEPS_KEY,
  EXPERIMENT_RUN_TRAYS_KEY,
  EXPERIMENT_TRAYS_KEY,
  POST_EXPERIMENT_STAGING_LOCATION,
  POST_EXPERIMENT_STAGING_STATUS,
  SAMPLES_KEY,
  SCHEDULES_KEY,
  STAGING_EVENTS_KEY,
  STAGING_LOCATION,
  TASKS_KEY,
  asArray,
  collectTrayStorageEvents,
  createId,
  eventMatchesRoom,
  eventTargetsStorageRoom,
  isCurrentStagingStatus,
  normalizeText,
  resolveStorageRoomConfig,
} from "./stagingStorageModel";
import {
  buildZancunRowsFromSnapshot,
  markReturnedTaskIfComplete,
  pruneTerminalExperimentSchedules,
} from "./stagingRowsModel";


function applyZancunInventoryAction(input = {}) {
  const snapshot = input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {};
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const config = resolveStorageRoomConfig(payload.room || input.room);
  const actionMode =
    payload.mode === "manufacturerReturn"
      ? "manufacturerReturn"
      : payload.mode === "stockOut"
        ? "stockOut"
        : "stockIn";
  const normalizedCode = normalizeTrayScanCode(payload.code);
  const actionTime = normalizeText(payload.actionTime || input.now) || formatLocalDateTime();

  const nextSnapshot = {
    ...snapshot,
    [TASKS_KEY]: asArray(snapshot[TASKS_KEY]).map((task) => ({ ...task })),
    [SCHEDULES_KEY]: asArray(snapshot[SCHEDULES_KEY]).map((schedule) => ({ ...schedule })),
    [EXPERIMENTS_KEY]: asArray(snapshot[EXPERIMENTS_KEY]).map((experiment) => ({ ...experiment })),
    [EXPERIMENT_TRAYS_KEY]: asArray(snapshot[EXPERIMENT_TRAYS_KEY]).map((entry) => ({ ...entry })),
    [EXPERIMENT_RUN_TRAYS_KEY]: asArray(snapshot[EXPERIMENT_RUN_TRAYS_KEY]).map((entry) => ({ ...entry })),
    [EXPERIMENT_RUN_STEPS_KEY]: asArray(snapshot[EXPERIMENT_RUN_STEPS_KEY]).map((entry) => ({ ...entry })),
    [SAMPLES_KEY]: asArray(snapshot[SAMPLES_KEY]).map((sample) => ({
      ...sample,
      trays: asArray(sample?.trays).map((tray) => ({ ...tray })),
    })),
    [STAGING_EVENTS_KEY]: asArray(snapshot[STAGING_EVENTS_KEY]).map((event) => ({ ...event })),
  };

  if (!normalizedCode) {
    return {
      error: "未提供托盘编号。",
      row: null,
      snapshot: nextSnapshot,
    };
  }

  if (actionMode === "manufacturerReturn" && config.key === "appearance") {
    return {
      error: APPEARANCE_MANUFACTURER_RETURN_ERROR,
      row: null,
      snapshot: nextSnapshot,
    };
  }

  const rows = buildZancunRowsFromSnapshot(nextSnapshot, { now: actionTime, room: config.key });
  const matchedRow = rows.find((row) => normalizeText(row?.trayCode) === normalizedCode);
  const trayHasReturnedMarkerInSnapshot =
    nextSnapshot[STAGING_EVENTS_KEY].some(
      (event) => normalizeText(event?.tray_code) === normalizedCode && normalizeText(event?.action) === "manufacturer_return",
    ) ||
    nextSnapshot[SAMPLES_KEY].some(
      (sample) =>
        asArray(sample?.trays).some(
          (tray) => normalizeText(tray?.tray_code) === normalizedCode && normalizeText(tray?.status) === "厂家收回",
        )
        || (
          normalizeText(sample?.status) === "厂家收回"
          && asArray(sample?.trays).some((tray) => normalizeText(tray?.tray_code) === normalizedCode)
        ),
    );
  if (!matchedRow) {
    if (actionMode === "stockIn" && trayHasReturnedMarkerInSnapshot) {
      return {
        error: "该托盘已厂家收回，不能再次入库。",
        row: null,
        snapshot: nextSnapshot,
      };
    }
    return {
      error: actionMode === "stockIn" ? "未找到对应的入库托盘。" : "未找到对应的出库托盘。",
      row: null,
      snapshot: nextSnapshot,
    };
  }

  const hasReturnedMarker =
    normalizeText(matchedRow.status) === "厂家收回" ||
    trayHasReturnedMarkerInSnapshot ||
    nextSnapshot[SAMPLES_KEY].some(
      (sample) =>
        normalizeText(sample?.task_code) === normalizeText(matchedRow.taskCode) &&
        asArray(sample?.trays).some(
          (tray) => normalizeText(tray?.tray_code) === normalizedCode && normalizeText(tray?.status) === "厂家收回",
        ),
    ) ||
    nextSnapshot[TASKS_KEY].some(
      (task) => normalizeText(task?.code || task?.task_code || task?.id) === normalizeText(matchedRow.taskCode) && normalizeText(task?.transfer_status) === "厂家收回",
    );

  if (actionMode === "stockIn" && hasReturnedMarker) {
    return {
      error: "该托盘已厂家收回，不能再次入库。",
      row: null,
      snapshot: nextSnapshot,
    };
  }

  if (actionMode === "stockIn" && isCurrentStagingStatus(matchedRow.status, config)) {
    return {
      error: config.duplicateStockInError,
      row: null,
      snapshot: nextSnapshot,
    };
  }

  const trayStorageEvents = collectTrayStorageEvents(nextSnapshot[STAGING_EVENTS_KEY], normalizedCode);
  const latestStorageEvent = trayStorageEvents.at(-1) || null;
  const latestMatchedEvent = trayStorageEvents.filter((event) => eventMatchesRoom(event, config)).at(-1);
  if (
    actionMode === "stockIn"
    && normalizeText(latestMatchedEvent?.action) === "stock_in"
    && !eventTargetsStorageRoom(latestStorageEvent, config, {
      location: matchedRow.location,
      statuses: [matchedRow.status],
    })
  ) {
    return {
      error: config.duplicateStockInError,
      row: null,
      snapshot: nextSnapshot,
    };
  }

  if (actionMode === "stockIn" && normalizeText(matchedRow.status) !== "待入库") {
    return {
      error: config.stockInBlockedError,
      row: null,
      snapshot: nextSnapshot,
    };
  }

  if (actionMode === "manufacturerReturn" && !isCurrentStagingStatus(matchedRow.status, config)) {
    return {
      error: config.requiresStockInError,
      row: null,
      snapshot: nextSnapshot,
    };
  }

  if (
    actionMode === "stockOut"
    && !matchedRow.isPartialAxisInbound
    && (
      normalizeText(matchedRow.status) === POST_EXPERIMENT_STAGING_STATUS
      || (config.key === "staging" && matchedRow.isPostExperimentInbound)
    )
  ) {
    return {
      error: config.terminalRetainError,
      row: null,
      snapshot: nextSnapshot,
    };
  }

  if (actionMode === "stockOut" && !isCurrentStagingStatus(matchedRow.status, config)) {
    return {
      error: config.requiresStockInError,
      row: null,
      snapshot: nextSnapshot,
    };
  }

  if (actionMode === "stockOut" && !asArray(matchedRow.targetDestinations).length && !normalizeText(matchedRow.targetLab)) {
    return {
      error: "未找到该托盘可出库的目标实验室。",
      row: null,
      snapshot: nextSnapshot,
    };
  }

  const selectedTargetLab = normalizeText(payload.targetLab);
  const selectedTargetLabCode = normalizeText(payload.targetLabCode || payload.target_lab_code);
  const selectedTargetLabId = payload.targetLabId ?? payload.target_lab_id ?? "";
  const selectedTargetExperimentCode = normalizeText(payload.targetExperimentCode);
  const selectedTargetType = normalizeText(payload.targetType);
  const selectedScheduleId = normalizeText(payload.scheduleId || payload.schedule_id);
  const selectedSubExperimentCode = normalizeText(payload.subExperimentCode || payload.sub_experiment_code);
  const targetDestinations = asArray(matchedRow.targetDestinations);
  const destinationMatchesSelectedLab = (destination) => {
    const destinationCode = normalizeText(destination?.targetLabCode || destination?.target_lab_code);
    if (selectedTargetLabCode && destinationCode) {
      return selectedTargetLabCode === destinationCode;
    }
    return normalizeText(destination?.targetLab) === selectedTargetLab;
  };
  const selectedDestination = targetDestinations.find((destination) => (
    destinationMatchesSelectedLab(destination)
    && (!selectedTargetExperimentCode || normalizeText(destination?.targetExperimentCode) === selectedTargetExperimentCode)
    && (!selectedTargetType || normalizeText(destination?.targetType) === selectedTargetType)
    && (!selectedScheduleId || normalizeText(destination?.scheduleId || destination?.schedule_id) === selectedScheduleId)
    && (!selectedSubExperimentCode || normalizeText(destination?.subExperimentCode || destination?.sub_experiment_code) === selectedSubExperimentCode)
  )) || null;
  const resolvedTargetLab = normalizeText(selectedDestination?.targetLab) || selectedTargetLab;
  const resolvedTargetLabCode = normalizeText(selectedDestination?.targetLabCode || selectedDestination?.target_lab_code) || selectedTargetLabCode;
  const resolvedTargetLabId = selectedDestination?.targetLabId ?? selectedDestination?.target_lab_id ?? selectedTargetLabId;
  const resolvedScheduleId = normalizeText(selectedDestination?.scheduleId || selectedDestination?.schedule_id) || selectedScheduleId;
  const resolvedSubExperimentCode = normalizeText(
    selectedDestination?.subExperimentCode || selectedDestination?.sub_experiment_code,
  ) || selectedSubExperimentCode;
  if (actionMode === "stockOut" && !selectedTargetLab && !selectedTargetLabCode) {
    return {
      error: "请选择目标实验室后再出库。",
      row: null,
      snapshot: nextSnapshot,
    };
  }
  if (actionMode === "stockOut" && targetDestinations.length && !selectedDestination) {
    return {
      error: "请选择有效的目标实验室后再出库。",
      row: null,
      snapshot: nextSnapshot,
    };
  }
  if (
    actionMode === "stockOut"
    && (
      selectedDestination
        ? !selectedDestination.scheduled
          || selectedDestination.targetAvailable === false
          || Boolean(normalizeText(selectedDestination.targetUnavailableReason))
        : Boolean(normalizeText(matchedRow.targetUnavailableReason))
    )
  ) {
    return {
      error: normalizeText(selectedDestination?.targetUnavailableReason) || matchedRow.targetUnavailableReason,
      row: null,
      snapshot: nextSnapshot,
    };
  }

  const stockOutTargetExperimentCode =
    normalizeText(selectedDestination?.targetExperimentCode) || selectedTargetExperimentCode || normalizeText(matchedRow.targetExperimentCode);
  const stockOutTargetExperimentName =
    normalizeText(selectedDestination?.targetExperimentName) || normalizeText(payload.targetExperimentName) || normalizeText(matchedRow.targetExperimentName);
  const stockOutEventTargetType =
    normalizeText(selectedDestination?.targetType) || selectedTargetType || "lab";
  const isPostExperimentStagingStockIn =
    actionMode === "stockIn"
    && config.key === "staging"
    && matchedRow.isPostExperimentInbound;
  const nextStockInStatus =
    actionMode === "stockIn"
      ? matchedRow.isPreExperimentAppearanceInbound && config.key === "appearance"
        ? APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
        : matchedRow.isPostExperimentAppearanceInbound && config.key === "appearance"
          ? APPEARANCE_STOCKED_STATUS
          : isPostExperimentStagingStockIn
            ? POST_EXPERIMENT_STAGING_STATUS
            : config.stockInStatus
      : "";
  const nextStockInLocation =
    actionMode === "stockIn"
      ? isPostExperimentStagingStockIn
        ? POST_EXPERIMENT_STAGING_LOCATION
        : config.currentLocation
      : "";
  const appearanceStockInPhase =
    config.key === "appearance" && actionMode === "stockIn"
      ? nextStockInStatus === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
        ? "pre_experiment"
        : nextStockInStatus === APPEARANCE_STOCKED_STATUS
          ? "post_experiment"
          : ""
      : "";
  const appearanceStockOutPhase =
    config.key === "appearance" && actionMode === "stockOut"
      ? normalizeText(matchedRow.status) === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
        ? "pre_experiment"
        : normalizeText(matchedRow.status) === APPEARANCE_STOCKED_STATUS
          ? "post_experiment"
          : ""
      : "";
  const appearanceStockInTargetExperimentCode =
    appearanceStockInPhase
      ? normalizeText(matchedRow.inboundTargetExperimentCode) || normalizeText(matchedRow.targetExperimentCode)
      : "";

  nextSnapshot[STAGING_EVENTS_KEY].push({
    id: createId("staging-event"),
    tray_code: matchedRow.trayCode,
    task_code: matchedRow.taskCode,
    room: config.eventRoom,
    action:
      actionMode === "stockIn"
        ? "stock_in"
        : actionMode === "manufacturerReturn"
          ? "manufacturer_return"
          : "stock_out",
    time: actionTime,
    operator: normalizeText(payload.operator) || "扫码登记",
    ...(actionMode === "manufacturerReturn"
      ? {
          target_lab: "厂家收回",
        }
      : actionMode === "stockOut"
      ? {
          target_experiment_code: stockOutTargetExperimentCode,
          target_experiment_name: stockOutTargetExperimentName,
          target_lab: resolvedTargetLab,
          target_lab_code: resolvedTargetLabCode,
          target_lab_id: resolvedTargetLabId,
          target_type: stockOutEventTargetType,
          ...(resolvedScheduleId ? { schedule_id: resolvedScheduleId } : {}),
          ...(resolvedSubExperimentCode ? { sub_experiment_code: resolvedSubExperimentCode } : {}),
          ...(appearanceStockOutPhase ? { appearance_phase: appearanceStockOutPhase } : {}),
        }
      : {
          location: nextStockInLocation,
          status: nextStockInStatus,
          ...(appearanceStockInPhase ? { appearance_phase: appearanceStockInPhase } : {}),
          ...(appearanceStockInTargetExperimentCode ? { target_experiment_code: appearanceStockInTargetExperimentCode } : {}),
        }),
  });

  if (actionMode === "stockIn") {
    const synced = synchronizeSamplesForTrayCodes({
      historyAction: config.historyStockInAction,
      historyDetail: `${matchedRow.trayCode} ${nextStockInStatus}`,
      location: nextStockInLocation,
      now: actionTime,
      owner: normalizeText(payload.operator) || "扫码登记",
      samples: nextSnapshot[SAMPLES_KEY],
      status: nextStockInStatus,
      targetExperimentCode: matchedRow.isPreExperimentAppearanceInbound
        ? normalizeText(matchedRow.inboundTargetExperimentCode) || normalizeText(matchedRow.targetExperimentCode)
        : "",
      targetLab: matchedRow.isPreExperimentAppearanceInbound
        ? normalizeText(matchedRow.inboundTargetLab) || normalizeText(matchedRow.targetLab)
        : "",
      trayCodes: [matchedRow.trayCode],
    });
    nextSnapshot[SAMPLES_KEY] = synced.samples;
  }

  if (actionMode === "stockOut") {
    const isStagingTarget =
      normalizeText(selectedDestination?.targetType) === "staging"
      || selectedTargetType === "staging"
      || normalizeText(resolvedTargetLab) === STAGING_LOCATION;
    const targetExperimentCode =
      normalizeText(selectedDestination?.targetExperimentCode) || selectedTargetExperimentCode || normalizeText(matchedRow.targetExperimentCode);
    const outboundLocation = isStagingTarget ? STAGING_LOCATION : resolvedTargetLab;
    const outboundStatus = isStagingTarget ? "送至暂存间" : "送至实验室";
    const synced = synchronizeSamplesForTrayCodes({
      historyAction: config.historyStockOutAction,
      historyDetail: `${matchedRow.trayCode} 送至 ${outboundLocation}`,
      location: outboundLocation,
      now: actionTime,
      owner: normalizeText(payload.operator) || "扫码登记",
      samples: nextSnapshot[SAMPLES_KEY],
      status: outboundStatus,
      targetExperimentCode,
      targetLab: isStagingTarget ? "" : resolvedTargetLab,
      trayCodes: [matchedRow.trayCode],
    });
    nextSnapshot[SAMPLES_KEY] = synced.samples.map((sample) => ({
      ...sample,
      trays: asArray(sample?.trays).map((tray) =>
        normalizeText(tray?.tray_code) === normalizeText(matchedRow.trayCode)
          ? {
              ...tray,
              ...(isStagingTarget
                ? {
                    target_experiment_code: "",
                    target_lab: STAGING_LOCATION,
                    target_type: "staging",
                  }
                : {
                    target_experiment_code: targetExperimentCode,
                    target_lab: resolvedTargetLab,
                    target_lab_code: resolvedTargetLabCode,
                    target_lab_id: resolvedTargetLabId,
                    target_type: "lab",
                    ...(resolvedScheduleId ? { schedule_id: resolvedScheduleId } : {}),
                    ...(resolvedSubExperimentCode ? { sub_experiment_code: resolvedSubExperimentCode } : {}),
                  }),
            }
          : tray,
      ),
    }));
  }

  if (actionMode === "manufacturerReturn") {
    const synced = synchronizeSamplesForTrayCodes({
      historyAction: "厂家收回",
      historyDetail: `${matchedRow.trayCode} 厂家收回`,
      location: "厂家收回",
      now: actionTime,
      owner: normalizeText(payload.operator) || "扫码登记",
      samples: nextSnapshot[SAMPLES_KEY],
      status: "厂家收回",
      trayCodes: [matchedRow.trayCode],
    });
    nextSnapshot[SAMPLES_KEY] = synced.samples;
    markReturnedTaskIfComplete(nextSnapshot, matchedRow.taskCode);
    pruneTerminalExperimentSchedules(nextSnapshot, matchedRow.taskCode);
  }

  const nextRows = buildZancunRowsFromSnapshot(nextSnapshot, { now: actionTime, room: config.key });
  const updatedRow = nextRows.find((row) => normalizeText(row?.trayCode) === normalizedCode) || null;

  return {
    error: "",
    row: updatedRow,
    snapshot: nextSnapshot,
  };
}


export {
  applyZancunInventoryAction,
};
