import { synchronizeSamplesForTrayCodes } from "@/modules/samples/samplesFlowModel";
import {
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  requiresPreExperimentAppearanceStorage,
} from "@/modules/samples/sampleFlow.constants";
import { formatLocalDateTime } from "@/lib/dateTime";
import { normalizeAxisCodes } from "@/lib/axisCodes";
import { getLabsForTestType } from "@/lib/labs";
import { resolveScheduleLabCode } from "@/lib/labIdentity";
import { normalizeTrayScanCode } from "@/lib/trayQrCode";
import { isAxisProgressIncomplete, resolveAxisProgress } from "@/modules/experiment-progress/axisProgress";
import { experimentScopeIsTerminal } from "@/modules/experiment-progress/model";

const TASKS_KEY = "mes.tasks";
const SCHEDULES_KEY = "mes.schedules";
const EXPERIMENTS_KEY = "mes.experiments";
const EXPERIMENT_TRAYS_KEY = "mes.experiment_trays";
const EXPERIMENT_RUN_TRAYS_KEY = "mes.experiment_run_trays";
const EXPERIMENT_RUN_STEPS_KEY = "mes.experiment_run_steps";
const SAMPLES_KEY = "mes.samples";
const STAGING_EVENTS_KEY = "mes.staging_events";
const STAGING_LOCATION = "恒温恒湿间（暂存间）";
const POST_EXPERIMENT_STAGING_LOCATION = "恒温恒湿间（实验后暂存间）";
const APPEARANCE_LOCATION = "外观检测间";
const STAGING_STOCKED_STATUS = "到货";
const POST_EXPERIMENT_STAGING_SENT_STATUS = "送至暂存间";
const POST_EXPERIMENT_STAGING_STATUS = "实验后暂存间存放";
const POST_EXPERIMENT_STAGING_LABEL = "实验后暂存";
const NORMAL_STAGING_LABEL = "放置暂存间";
const APPEARANCE_SENT_STATUS = "送至外观检测间";
const APPEARANCE_STOCKED_STATUS = "实验后外观检测间存放";
const WITHDRAWAL_HISTORY_ACTIONS = new Set(["撤回出库", "实验任务撤回", "任务切换撤回"]);
const PRE_STAGING_STATUSES = new Set(["送至暂存间", "已到达暂存间"]);
const EXPLICIT_STAGING_INBOUND_STATUSES = new Set(["送至暂存间", POST_EXPERIMENT_STAGING_SENT_STATUS]);
const PRE_APPEARANCE_STATUSES = new Set([APPEARANCE_SENT_STATUS, APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS]);
const STOCK_IN_CANDIDATE_STATUSES = new Set([
  ...PRE_STAGING_STATUSES,
  "实验已完成",
  "实验完成",
  POST_EXPERIMENT_STAGING_STATUS,
  POST_EXPERIMENT_STAGING_SENT_STATUS,
]);
const APPEARANCE_STOCK_IN_CANDIDATE_STATUSES = new Set([
  ...PRE_APPEARANCE_STATUSES,
  APPEARANCE_STOCKED_STATUS,
]);

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const resolveScheduleLabId = (schedule) => schedule?.lab_id ?? schedule?.labId ?? "";
const resolveStorageRoomConfig = (room) =>
  STORAGE_ROOM_CONFIGS[normalizeText(room)] || STORAGE_ROOM_CONFIGS.staging;
const eventMatchesRoom = (event, config = STORAGE_ROOM_CONFIGS.staging) => {
  const eventRoom = normalizeText(event?.room || event?.storage_room || event?.storageRoom);
  return eventRoom ? eventRoom === config.eventRoom : config.key === "staging";
};
const COMPLETED_EXPERIMENT_STATUSES = new Set([
  "实验已完成",
  "实验完成",
  POST_EXPERIMENT_STAGING_STATUS,
]);
const STRICT_COMPLETED_RUN_TRAY_STATUSES = new Set([
  ...COMPLETED_EXPERIMENT_STATUSES,
  "实验已经完成",
]);
const COMPLETED_RUN_TRAY_STATUSES = new Set([
  ...COMPLETED_EXPERIMENT_STATUSES,
  "实验已经完成",
  "厂家收回",
]);
const STAGING_STOCK_IN_BLOCKED_STATUS_ERROR = "该托盘已进入试验间流程，不能暂存间入库。";
const APPEARANCE_STOCK_IN_BLOCKED_STATUS_ERROR = "该托盘未送至外观检测间，不能外观检测间入库。";
const APPEARANCE_MANUFACTURER_RETURN_ERROR = "外观检测间不允许厂家收回，请先出库至下一去向。";

const STORAGE_ROOM_CONFIGS = {
  staging: {
    currentLocation: STAGING_LOCATION,
    currentStatuses: new Set([
      STAGING_STOCKED_STATUS,
      "已到达暂存间",
      "暂存间存放",
      POST_EXPERIMENT_STAGING_STATUS,
    ]),
    duplicateStockInError: "该托盘已完成暂存间扫码入库。",
    eventRoom: "staging",
    historyStockInAction: "暂存间扫码入库",
    historyStockOutAction: "暂存间扫码出库",
    key: "staging",
    requiresStockInError: "该托盘尚未完成暂存间扫码入库。",
    stockInBlockedError: STAGING_STOCK_IN_BLOCKED_STATUS_ERROR,
    stockInStatus: "已到达暂存间",
    stockedDisplayStatus: STAGING_STOCKED_STATUS,
    stockInCandidateStatuses: STOCK_IN_CANDIDATE_STATUSES,
    terminalRetainError: "该托盘已完成全部实验，当前应保留在暂存间。",
  },
  appearance: {
    currentLocation: APPEARANCE_LOCATION,
    currentStatuses: new Set([APPEARANCE_STOCKED_STATUS, APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS]),
    duplicateStockInError: "该托盘已完成外观检测间扫码入库。",
    eventRoom: "appearance",
    historyStockInAction: "外观检测间扫码入库",
    historyStockOutAction: "外观检测间扫码出库",
    key: "appearance",
    requiresStockInError: "该托盘尚未完成外观检测间扫码入库。",
    stockInBlockedError: APPEARANCE_STOCK_IN_BLOCKED_STATUS_ERROR,
    stockInStatus: APPEARANCE_STOCKED_STATUS,
    stockedDisplayStatus: APPEARANCE_STOCKED_STATUS,
    stockInCandidateStatuses: APPEARANCE_STOCK_IN_CANDIDATE_STATUSES,
    terminalRetainError: "该托盘已完成全部实验，当前应保留在外观检测间。",
  },
};

const createId = (prefix) => {
  const stamp = Date.now();
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${stamp}-${random}`;
};

const formatDateTime = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "-";
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized.replace("T", " ");
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

const resolveStatusClass = (status) => {
  const normalized = normalizeText(status);
  if (normalized === "待入库") {
    return "status accepted";
  }
  if (isCurrentStagingStatus(normalized)) {
    return "status retention";
  }
  if (normalized === "已出库") {
    return "status warn";
  }
  return "status";
};

const compareValues = (left, right, direction) => {
  const factor = direction === "desc" ? -1 : 1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return (leftNumber - rightNumber) * factor;
  }

  return normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN") * factor;
};

const compareDateTimes = (left, right, direction) => {
  const leftTime = new Date(normalizeText(left)).getTime();
  const rightTime = new Date(normalizeText(right)).getTime();

  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return direction === "desc" ? rightTime - leftTime : leftTime - rightTime;
  }

  return compareValues(left, right, direction);
};

const toDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseTimeValue = (value) => {
  const timestamp = Date.parse(normalizeText(value));
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
};

const parseCompletedEventTimeValue = (value) => {
  const timestamp = Date.parse(normalizeText(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const isStagingDestination = (value) => {
  const text = normalizeText(value);
  return text.includes("暂存间") || text.includes("外观检测间");
};

const isHandoverLocation = (value) => {
  const text = normalizeText(value);
  return text === "接驳区" || text === "室外接驳区";
};

const contextIndicatesStorageRoomInbound = (context = {}, config = STORAGE_ROOM_CONFIGS.staging) => {
  const statuses = asArray(context.statuses).map((status) => normalizeText(status));
  const location = normalizeText(context.location);
  if (config.key === "appearance") {
    return statuses.some((status) => PRE_APPEARANCE_STATUSES.has(status));
  }
  return location === STAGING_LOCATION || statuses.some((status) => PRE_STAGING_STATUSES.has(status));
};

const resolveExperimentName = (experiment, fallback = "") =>
  normalizeText(experiment?.experiment_name)
  || normalizeText(experiment?.name)
  || normalizeText(experiment?.experiment_type)
  || normalizeText(fallback);

const parseExperimentHistoryDetail = (detail, taskCode) => {
  const segments = normalizeText(detail)
    .split(" / ")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  if (segments.length < 3 || segments[0] !== normalizeText(taskCode)) {
    return null;
  }
  return {
    experimentName: segments[1],
    status: segments[2],
  };
};

const normalizeWithdrawalRestoreStatus = (value) => {
  let text = normalizeText(value);
  if (text.startsWith("撤回至")) {
    text = text.slice("撤回至".length);
  }
  const reasonIndex = text.indexOf("（");
  if (reasonIndex >= 0) {
    text = text.slice(0, reasonIndex);
  }
  return normalizeText(text);
};

const resolveLatestAppearanceWithdrawalRestoreStatus = ({ sample, taskCode }) => {
  let latestStatus = "";
  let latestTime = -Infinity;
  asArray(sample?.history).forEach((entry) => {
    if (!WITHDRAWAL_HISTORY_ACTIONS.has(normalizeText(entry?.action))) {
      return;
    }
    const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
    const status =
      normalizeText(entry?.status)
      || normalizeWithdrawalRestoreStatus(parsed?.status);
    if (!STORAGE_ROOM_CONFIGS.appearance.currentStatuses.has(status)) {
      return;
    }
    const entryTime = parseCompletedEventTimeValue(entry?.time || entry?.updated_at || entry?.created_at || entry?.timestamp);
    if (entryTime >= latestTime) {
      latestStatus = status;
      latestTime = entryTime;
    }
  });
  return latestStatus;
};

const buildTaskMap = (tasks) => {
  const map = new Map();
  asArray(tasks).forEach((task) => {
    const code = normalizeText(task?.code);
    if (code) {
      map.set(code, task);
    }
  });
  return map;
};

const buildEventMap = (stagingEvents, config = STORAGE_ROOM_CONFIGS.staging) => {
  const eventMap = new Map();
  asArray(stagingEvents).forEach((event) => {
    if (!eventMatchesRoom(event, config)) {
      return;
    }
    const trayCode = normalizeText(event?.tray_code);
    if (!trayCode) {
      return;
    }
    const current = eventMap.get(trayCode) || [];
    current.push({ ...event });
    eventMap.set(trayCode, current);
  });

  eventMap.forEach((events, trayCode) => {
    eventMap.set(
      trayCode,
      events.slice().sort((left, right) => compareDateTimes(left?.time, right?.time, "asc")),
    );
  });

  return eventMap;
};

const buildAllEventMap = (stagingEvents) => {
  const eventMap = new Map();
  asArray(stagingEvents).forEach((event) => {
    const trayCode = normalizeText(event?.tray_code);
    if (!trayCode) {
      return;
    }
    const current = eventMap.get(trayCode) || [];
    current.push({ ...event });
    eventMap.set(trayCode, current);
  });

  eventMap.forEach((events, trayCode) => {
    eventMap.set(
      trayCode,
      events.slice().sort((left, right) => compareDateTimes(left?.time, right?.time, "asc")),
    );
  });

  return eventMap;
};

const eventTargetsStorageRoom = (event, config = STORAGE_ROOM_CONFIGS.staging, context = {}) => {
  if (!event) {
    return false;
  }
  const targetType = normalizeText(event?.target_type || event?.targetType);
  const targetLab = normalizeText(event?.target_lab || event?.targetLab);
  const targetName = normalizeText(event?.target_name || event?.targetName);
  const targetText = [targetLab, targetName].filter(Boolean).join(" ");
  const isStagingTarget =
    targetType === "staging"
    || targetText === STAGING_LOCATION
    || targetText.includes("暂存间");
  const isAppearanceTarget =
    targetType === "appearance"
    || targetText === APPEARANCE_LOCATION
    || targetText.includes("外观检测间");
  const isCrossRoomStockOut = normalizeText(event?.action) === "stock_out" && !eventMatchesRoom(event, config);
  if (!isCrossRoomStockOut) {
    return false;
  }
  if (config.key === "appearance") {
    return isAppearanceTarget;
  }
  if (isStagingTarget) {
    return true;
  }

  const hasExplicitTarget = Boolean(targetType || targetLab || targetName);
  return (
    !hasExplicitTarget
    && resolveStorageEventSourceLabel(event) === APPEARANCE_LOCATION
    && contextIndicatesStorageRoomInbound(context, config)
  );
};

const eventTargetsPostExperimentStaging = (event) => {
  const targetType = normalizeText(event?.target_type || event?.targetType);
  const targetLab = normalizeText(event?.target_lab || event?.targetLab);
  const targetName = normalizeText(event?.target_name || event?.targetName);
  const targetText = [targetLab, targetName].filter(Boolean).join(" ");
  return targetType === "staging" || targetText === STAGING_LOCATION || targetText.includes("暂存间");
};

const resolveStorageEventSourceLabel = (event) => {
  const room = normalizeText(event?.room || event?.storage_room || event?.storageRoom);
  if (room === STORAGE_ROOM_CONFIGS.appearance.eventRoom) {
    return APPEARANCE_LOCATION;
  }
  if (room === STORAGE_ROOM_CONFIGS.staging.eventRoom) {
    return STAGING_LOCATION;
  }
  return room;
};

const resolveStorageInboundSourceLabel = (events, config = STORAGE_ROOM_CONFIGS.staging, context = {}) => {
  const orderedEvents = asArray(events).slice().sort((left, right) => compareDateTimes(left?.time, right?.time, "asc"));
  let latestStockInIndex = -1;
  orderedEvents.forEach((event, index) => {
    if (normalizeText(event?.action) === "stock_in" && eventMatchesRoom(event, config)) {
      latestStockInIndex = index;
    }
  });

  const findLatestSourceEvent = (startIndex = orderedEvents.length - 1) => {
    for (let index = startIndex; index >= 0; index -= 1) {
      const event = orderedEvents[index];
      if (eventTargetsStorageRoom(event, config, context)) {
        return event;
      }
    }
    return null;
  };

  const latestSourceEvent = findLatestSourceEvent();
  const latestStockInEvent = latestStockInIndex >= 0 ? orderedEvents[latestStockInIndex] : null;
  const sourceEvent = latestStockInEvent && latestSourceEvent
    ? (
        compareDateTimes(latestSourceEvent?.time, latestStockInEvent?.time, "asc") > 0
          ? latestSourceEvent
          : findLatestSourceEvent(latestStockInIndex - 1)
      )
    : latestSourceEvent;
  return resolveStorageEventSourceLabel(sourceEvent);
};

const collectTrayStorageEvents = (stagingEvents, trayCode) =>
  asArray(stagingEvents)
    .filter((event) => normalizeText(event?.tray_code) === normalizeText(trayCode))
    .map((event) => ({ ...event }))
    .sort((left, right) => compareDateTimes(left?.time, right?.time, "asc"));

const hasPreAppearanceInboundStatus = (statuses) =>
  asArray(statuses).some((status) => PRE_APPEARANCE_STATUSES.has(normalizeText(status)));

const hasPostExperimentStagingStorageStatus = (row) => {
  const statuses = asArray(row?.statuses).map((status) => normalizeText(status));
  return (
    statuses.includes(POST_EXPERIMENT_STAGING_STATUS)
    || normalizeText(row?.location).includes("实验后暂存间")
  );
};

const hasAppearanceStorageStatus = (row) =>
  asArray(row?.statuses).some((status) =>
    STORAGE_ROOM_CONFIGS.appearance.currentStatuses.has(normalizeText(status)),
  );

const isCurrentStagingStatus = (status, config = STORAGE_ROOM_CONFIGS.staging) => {
  const normalized = normalizeText(status);
  return config.currentStatuses.has(normalized);
};

const resolveTrayStatus = (statuses, events, options = {}) => {
  const config = resolveStorageRoomConfig(options.room);
  const latestEvent = asArray(events).at(-1);
  const isExperimentCompletionInbound = Boolean(options.isPostExperimentInbound || options.isPartialAxisInbound);
  const hasStoredStatus = statuses.some((status) => isCurrentStagingStatus(status, config));
  const hasStockInCandidateStatus = statuses.some((status) => config.stockInCandidateStatuses.has(normalizeText(status)));
  const hasPreAppearanceInbound = hasPreAppearanceInboundStatus(statuses);
  const hasCompletedExperimentStatus = statuses.some((status) => COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(status)));
  if (config.key === "appearance" && normalizeText(latestEvent?.action) === "stock_out" && hasPreAppearanceInbound) {
    return "待入库";
  }
  if (
    config.key === "staging"
    && normalizeText(latestEvent?.action) === "stock_out"
    && (hasCompletedExperimentStatus || isExperimentCompletionInbound)
  ) {
    return "待入库";
  }
  if (normalizeText(latestEvent?.action) === "stock_out") {
    return "已出库";
  }
  if (
    config.key === "staging"
    && !hasStoredStatus
    && !hasStockInCandidateStatus
    && !normalizeText(latestEvent?.action)
    && isExperimentCompletionInbound
  ) {
    return "待入库";
  }
  if (normalizeText(latestEvent?.action) === "stock_out_withdraw") {
    const normalizedStatuses = statuses.map((status) => normalizeText(status)).filter(Boolean);
    const restoredStatus =
      normalizedStatuses.find((status) => status === config.stockInStatus)
      || normalizedStatuses.find((status) => isCurrentStagingStatus(status, config));
    if (restoredStatus) {
      return restoredStatus;
    }
    if (config.key === "appearance" && normalizedStatuses.includes(APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS)) {
      return APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS;
    }
  }
  if (normalizeText(latestEvent?.action) === "manufacturer_return") {
    return "厂家收回";
  }
  if (normalizeText(latestEvent?.action) === "stock_in") {
    if (
      config.key === "appearance"
      && statuses.some((status) => normalizeText(status) === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS)
    ) {
      return APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS;
    }
    if (
      config.key === "staging"
      && statuses.some((status) =>
        normalizeText(status) === POST_EXPERIMENT_STAGING_STATUS,
      )
    ) {
      return POST_EXPERIMENT_STAGING_STATUS;
    }
    return isExperimentCompletionInbound && config.key === "staging"
      ? config.stockInStatus
      : config.stockedDisplayStatus;
  }
  if (hasStoredStatus) {
    if (
      config.key === "appearance"
      && statuses.some((status) => normalizeText(status) === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS)
    ) {
      return APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS;
    }
    if (isExperimentCompletionInbound && config.key === "staging") {
      return config.stockInStatus;
    }
    return config.stockedDisplayStatus;
  }
  if (hasStockInCandidateStatus) {
    return "待入库";
  }
  return "";
};

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
  const latestDispatchTime = parseTimeValue(latestStorageEvent?.time);
  return asArray(trayStorageEvents).some((event) =>
    eventMatchesRoom(event, config)
    && normalizeText(event?.action) === "stock_in"
    && (!latestDispatchTime || parseTimeValue(event?.time) < latestDispatchTime),
  );
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

const trayHasPartialAxisRunCompletion = ({ experimentRunSteps, experimentRunTrays, experiments, schedules, taskCode, trayCode }) => {
  const experimentMap = buildExperimentMap(experiments);
  return asArray(experimentRunTrays).some((entry) => {
    if (
      normalizeText(entry?.task_code || entry?.taskCode || entry?.task_no || entry?.taskNo) !== taskCode
      || normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo) !== trayCode
      || !COMPLETED_RUN_TRAY_STATUSES.has(normalizeText(entry?.run_tray_status || entry?.runTrayStatus || entry?.status))
    ) {
      return false;
    }
    const experimentCode = normalizeText(entry?.experiment_code || entry?.experimentCode || entry?.experiment_no || entry?.experimentNo);
    const subExperimentCode = normalizeText(entry?.sub_experiment_code || entry?.subExperimentCode || entry?.sub_experiment_no || entry?.subExperimentNo);
    if (!subExperimentCode) {
      return false;
    }
    const experiment = experimentMap.get(experimentCode);
    const progress = resolveAxisProgress({
      experiment,
      experimentCode,
      experimentRunSteps,
      experimentRunTrays,
      experiments,
      schedules,
      subExperimentCode,
      taskCode,
      trayCode,
    });
    if (isAxisProgressIncomplete(progress) && Number(progress.completedCount) > 0) {
      return true;
    }
    return (
      Number(progress.completedCount) > 0
      && hasPendingSiblingAxisSchedule({ experimentCode, schedules, subExperimentCode, taskCode })
    );
  });
};

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

const resolveTrayStatusLabel = ({ config, experiments, experimentRunSteps, experimentRunTrays, isPartialAxisInbound, isPostExperimentInbound, samples, status, taskCode, trayCode }) => {
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

const resolveTrayTargetDestinations = ({ row, samples, schedules, experiments, experimentTrays, experimentRunSteps, experimentRunTrays, room = "staging" }) => {
  const config = resolveStorageRoomConfig(room);
  const taskCode = normalizeText(row?.taskCode);
  const trayCode = normalizeText(row?.trayCode);
  if (!taskCode || !trayCode) {
    return [];
  }

  const experimentMap = buildExperimentMap(experiments);
  const trayExperimentCodes = collectTrayExperimentCodes({ taskCode, trayCode, experimentTrays });
  const completedExperimentNames = collectCompletedExperimentNames({ samples, taskCode, trayCode });
  const acceptsExperimentCode = (experimentCode) => trayExperimentCodes.size === 0 || trayExperimentCodes.has(normalizeText(experimentCode));
  const restrictToAppearanceDestinations =
    config.key === "appearance"
    && asArray(row?.statuses).some((status) => normalizeText(status) === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS);
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
  const directExperimentCandidates = [];
  const resolveDirectExperimentLab = (experiment, fallbackName = "") => {
    const experimentName = resolveExperimentName(experiment, fallbackName);
    const requiredDevice = normalizeText(experiment?.required_device || experiment?.requiredDevice);
    const mappedLabs = getLabsForTestType(experimentName);
    if (requiredDevice && !isStagingDestination(requiredDevice) && mappedLabs.includes(requiredDevice)) {
      return requiredDevice;
    }
    if (requiredDevice && !isStagingDestination(requiredDevice) && !requiredDevice.endsWith("试验")) {
      return requiredDevice;
    }
    return mappedLabs[0] || (isStagingDestination(requiredDevice) ? "" : requiredDevice);
  };
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
      scheduledCandidates.push({
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
      });
      return;
    }

    if (row?.isPartialAxisInbound) {
      const targetLab = resolveDirectExperimentLab(experiment);
      if (targetLab) {
        directExperimentCandidates.push({
          preferred: false,
          scheduled: true,
          targetExperimentCode: nextExperimentCode,
          targetExperimentName: resolveExperimentName(experiment),
          targetIsFallback: true,
          targetLab,
          targetLabCode: "",
          targetLabId: "",
          targetScheduleStartAt: "",
          targetScheduleEndAt: "",
          targetUnavailableReason: "",
        });
      }
    }
  });

  scheduledCandidates.sort(
    (left, right) =>
      parseTimeValue(left?.targetScheduleStartAt) - parseTimeValue(right?.targetScheduleStartAt)
      || normalizeText(left?.targetLab).localeCompare(normalizeText(right?.targetLab), "zh-Hans-CN"),
  );
  if (scheduledCandidates.length) {
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
        return {
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
        };
      })
    .sort((left, right) => parseTimeValue(left?.targetScheduleStartAt) - parseTimeValue(right?.targetScheduleStartAt));

  const appearanceStagingDestination = config.key === "appearance"
    ? [{
        preferred: directScheduledCandidates.length === 0 && scheduledCandidates.length === 0,
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
    const earliest = parseTimeValue(directScheduledCandidates[0]?.targetScheduleStartAt);
    const earliestCount = directScheduledCandidates.filter((item) => parseTimeValue(item?.targetScheduleStartAt) === earliest).length;
    if (earliestCount === 1) {
      directScheduledCandidates[0].preferred = true;
    }
    return [...directScheduledCandidates, ...appearanceStagingDestination];
  }

  if (scheduledCandidates.length || directExperimentCandidates.length || trayExperimentCodes.size > 0) {
    const scheduledExperimentCodes = new Set(scheduledCandidates.map((candidate) => candidate.targetExperimentCode));
    const remainingDirectCandidates = directExperimentCandidates.filter((candidate) =>
      !scheduledExperimentCodes.has(candidate.targetExperimentCode),
    );
    return [...scheduledCandidates, ...remainingDirectCandidates, ...appearanceStagingDestination];
  }

  return appearanceStagingDestination;
};

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
  const schedules = asArray(snapshot[SCHEDULES_KEY]);
  const experiments = asArray(snapshot[EXPERIMENTS_KEY]);
  const experimentTrays = asArray(snapshot[EXPERIMENT_TRAYS_KEY]);
  const experimentRunTrays = asArray(snapshot[EXPERIMENT_RUN_TRAYS_KEY]);
  const experimentRunSteps = asArray(snapshot[EXPERIMENT_RUN_STEPS_KEY]);
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
        originalTargetExperimentCode: "",
        originalTargetLab: "",
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
      current.originalTargetExperimentCode = current.originalTargetExperimentCode || trayTargetExperimentCode;
      current.originalTargetLab = current.originalTargetLab || trayTargetLab;
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
        originalTargetExperimentCode: "",
        originalTargetLab: "",
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
      const appearancePreInspectionAlreadyDispatched =
        appearanceAlreadyDispatchedFromStorage
        || (
          config.key === "appearance"
          && normalizeText(lastEvent?.action) === "stock_out"
          && !eventTargetsPostExperimentStaging(lastEvent)
          && events
            .slice(0, -1)
            .some((event) => normalizeText(event?.action) === "stock_in")
        );
      const lastStockInEvent = events
        .slice()
        .reverse()
        .find((event) => normalizeText(event?.action) === "stock_in") || null;
      const hasCompletedExperimentStatus = row.statuses.some((status) => COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(status)));
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
        && !latestLabStockOutAfterPartialAxisCompletion;
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
        (event) => normalizeText(event?.action) === "stock_in" && toDateKey(event?.time) === toDateKey(options.now || new Date()),
      );
      const stockOutToday =
        normalizeText(lastEvent?.action) === "stock_out"
        && toDateKey(lastEvent?.time) === toDateKey(options.now || new Date());

      const targetDestinations = resolveTrayTargetDestinations({
        experiments,
        experimentRunSteps,
        experimentRunTrays,
        experimentTrays,
        row: { ...row, isPartialAxisInbound },
        room: config.key,
        samples,
        schedules,
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
        originalTargetExperimentCode: normalizeText(row.originalTargetExperimentCode || row.targetExperimentCode),
        originalTargetLab: normalizeText(row.originalTargetLab || row.targetLab),
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

function buildZancunInventorySections(rows = [], options = {}) {
  const config = resolveStorageRoomConfig(options.room);
  const rowList = asArray(rows);
  return {
    currentStagingRows: rowList
      .filter((row) => isCurrentStagingStatus(row?.status, config))
      .sort((left, right) => compareValues(left?.trayCode, right?.trayCode, "asc")),
    plannedInboundRows: rowList
      .filter((row) => normalizeText(row?.status) === "待入库")
      .sort((left, right) => compareValues(left?.trayCode, right?.trayCode, "asc")),
  };
}

function buildZancunMetrics(input = {}) {
  const rowList = Array.isArray(input) ? input : asArray(input.rows);
  const config = resolveStorageRoomConfig(Array.isArray(input) ? "staging" : input.room);
  const stagingEvents = Array.isArray(input) ? [] : asArray(input.stagingEvents);
  const todayKey = toDateKey(Array.isArray(input) ? new Date() : (input.now || new Date()));
  const stockedInToday = new Set();
  const latestEventsByTray = new Map();

  stagingEvents.forEach((event) => {
    const trayCode = normalizeText(event?.tray_code);
    if (!trayCode || !eventMatchesRoom(event, config)) {
      return;
    }
    const current = latestEventsByTray.get(trayCode);
    if (!current || compareDateTimes(current?.time, event?.time, "asc") <= 0) {
      latestEventsByTray.set(trayCode, event);
    }
    if (toDateKey(event?.time) === todayKey && normalizeText(event?.action) === "stock_in") {
      stockedInToday.add(trayCode);
    }
  });
  const stockedOutToday = new Set(
    Array.from(latestEventsByTray.entries())
      .filter(([, event]) => (
        toDateKey(event?.time) === todayKey
        && eventMatchesRoom(event, config)
        && ["stock_out", "manufacturer_return"].includes(normalizeText(event?.action))
      ))
      .map(([trayCode]) => trayCode),
  );

  return {
    stockedInTodayCount: stockedInToday.size,
    stockedOutTodayCount: stockedOutToday.size,
    totalTrayCount: rowList.filter((row) => isCurrentStagingStatus(row?.status, config)).length,
  };
}

function buildZancunOverviewView(input = {}) {
  const rows = asArray(input.rows);
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const sort = input.sort && typeof input.sort === "object" ? input.sort : {};
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 4;
  const query = normalizeText(filters.query).toLowerCase();
  const sampleType = normalizeText(filters.sampleType);
  const status = normalizeText(filters.status);
  const metricMode = normalizeText(filters.metricMode) || "all";
  const sortKey = normalizeText(sort.key) || "trayCode";
  const sortDirection = normalizeText(sort.direction) === "desc" ? "desc" : "asc";

  const filteredRows = rows
    .filter((row) => {
      if (metricMode === "active" && normalizeText(row?.status) === "已出库") {
        return false;
      }
      if (metricMode === "stockedInToday" && !row?.stockInToday) {
        return false;
      }
      if (metricMode === "stockedOutToday" && !row?.stockOutToday) {
        return false;
      }
      if (sampleType && normalizeText(row?.sampleType) !== sampleType) {
        return false;
      }
      if (status && normalizeText(row?.status) !== status) {
        return false;
      }
      if (!query) {
        return true;
      }

      const searchText = [row.trayCode, row.taskCode, row.owner, row.location, row.source, row.sampleType, row.status]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return searchText.includes(query);
    })
    .slice()
    .sort((left, right) => {
      if (sortKey === "stockInAt") {
        const order = compareDateTimes(left?.stockInAt, right?.stockInAt, sortDirection);
        if (order !== 0) {
          return order;
        }
        return compareValues(left?.trayCode, right?.trayCode, "asc");
      }
      const order = compareValues(left?.[sortKey], right?.[sortKey], sortDirection);
      if (order !== 0) {
        return order;
      }
      return compareValues(left?.trayCode, right?.trayCode, "asc");
    });

  const totalCount = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), pageCount) : 1;
  const startIndex = (currentPage - 1) * pageSize;

  return {
    currentPage,
    pageCount,
    rows: filteredRows.slice(startIndex, startIndex + pageSize),
    totalCount,
  };
}

function buildZancunScanDetail(rows, code, mode, options = {}) {
  const config = resolveStorageRoomConfig(options.room);
  const rowList = asArray(rows);
  const normalizedCode = normalizeTrayScanCode(code);
  const actionMode = mode === "stockOut" ? "stockOut" : "stockIn";
  const matchedRow = rowList.find((row) => normalizeText(row?.trayCode) === normalizedCode);

  if (!matchedRow) {
    return {
      actionLabel: actionMode === "stockIn" ? "入库" : "出库",
      actionMode,
      found: false,
      location: actionMode === "stockIn" ? `待确认${config.currentLocation}` : "待确认当前位置",
      nextStatus: actionMode === "stockIn" ? config.stockedDisplayStatus : "已出库",
      owner: "待确认",
      quantity: 0,
      sampleType: "待确认样品类型",
      source: "扫码识别",
      status: actionMode === "stockIn" ? "待入库" : "待出库",
      stockInAt: "",
      stockInAtDisplay: "-",
      taskCode: "待确认任务",
      targetExperimentCode: "",
      targetExperimentName: "",
      targetIsFallback: false,
      targetLab: "",
      targetUnavailableReason: "",
      trayCode: normalizedCode,
    };
  }

  return {
    ...matchedRow,
    actionLabel: actionMode === "stockIn" ? "入库" : "出库",
    actionMode,
    found: true,
    nextStatus: actionMode === "stockIn" ? config.stockedDisplayStatus : "已出库",
    stockInAtDisplay: formatDateTime(matchedRow.stockInAt),
  };
}

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
  )) || null;
  const resolvedTargetLab = normalizeText(selectedDestination?.targetLab) || selectedTargetLab;
  const resolvedTargetLabCode = normalizeText(selectedDestination?.targetLabCode || selectedDestination?.target_lab_code) || selectedTargetLabCode;
  const resolvedTargetLabId = selectedDestination?.targetLabId ?? selectedDestination?.target_lab_id ?? selectedTargetLabId;
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
  if (actionMode === "stockOut" && (selectedDestination ? !selectedDestination.scheduled : normalizeText(matchedRow.targetUnavailableReason))) {
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
        }
      : {}),
  });

  if (actionMode === "stockIn") {
    const isPostExperimentStagingStockIn =
      config.key === "staging"
      && matchedRow.isPostExperimentInbound;
    const nextStockInStatus =
      matchedRow.isPreExperimentAppearanceInbound && config.key === "appearance"
        ? APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
        : matchedRow.isPostExperimentAppearanceInbound && config.key === "appearance"
          ? APPEARANCE_STOCKED_STATUS
        : isPostExperimentStagingStockIn
          ? POST_EXPERIMENT_STAGING_STATUS
          : config.stockInStatus;
    const nextStockInLocation =
      isPostExperimentStagingStockIn
        ? POST_EXPERIMENT_STAGING_LOCATION
        : config.currentLocation;
    const synced = synchronizeSamplesForTrayCodes({
      historyAction: config.historyStockInAction,
      historyDetail: `${matchedRow.trayCode} ${nextStockInStatus}`,
      location: nextStockInLocation,
      now: actionTime,
      owner: normalizeText(payload.operator) || "扫码登记",
      samples: nextSnapshot[SAMPLES_KEY],
      status: nextStockInStatus,
      targetExperimentCode: matchedRow.isPreExperimentAppearanceInbound
        ? normalizeText(matchedRow.originalTargetExperimentCode) || normalizeText(matchedRow.targetExperimentCode)
        : "",
      targetLab: matchedRow.isPreExperimentAppearanceInbound
        ? normalizeText(matchedRow.originalTargetLab) || normalizeText(matchedRow.targetLab)
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
  buildZancunInventorySections,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunRowsFromSnapshot,
  buildZancunScanDetail,
};
