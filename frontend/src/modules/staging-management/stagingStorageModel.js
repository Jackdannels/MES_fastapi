import { APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS } from "@/modules/samples/sampleFlow.constants";


const TASKS_KEY = "mes.tasks";
const DEVICES_KEY = "mes.devices";
const SCHEDULES_KEY = "mes.schedules";
const EXPERIMENTS_KEY = "mes.experiments";
const EXPERIMENT_TRAYS_KEY = "mes.experiment_trays";
const EXPERIMENT_RUN_TRAYS_KEY = "mes.experiment_run_trays";
const EXPERIMENT_RUN_STEPS_KEY = "mes.experiment_run_steps";
const EXPERIMENT_RUNS_KEY = "mes.experiment_runs";
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
const PARTIAL_AXIS_REENTRY_BLOCKING_ACTIONS = new Set(["任务比对", "样品安装", "实验确认", "开始实验", "实验开始"]);
const ACTIVE_EXPERIMENT_RUN_TRAY_STATUSES = new Set(["已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", "实验中"]);
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


export {
  ACTIVE_EXPERIMENT_RUN_TRAY_STATUSES,
  APPEARANCE_LOCATION,
  APPEARANCE_MANUFACTURER_RETURN_ERROR,
  APPEARANCE_SENT_STATUS,
  APPEARANCE_STOCKED_STATUS,
  COMPLETED_EXPERIMENT_STATUSES,
  COMPLETED_RUN_TRAY_STATUSES,
  DEVICES_KEY,
  EXPERIMENTS_KEY,
  EXPERIMENT_RUN_STEPS_KEY,
  EXPERIMENT_RUN_TRAYS_KEY,
  EXPERIMENT_RUNS_KEY,
  EXPERIMENT_TRAYS_KEY,
  EXPLICIT_STAGING_INBOUND_STATUSES,
  NORMAL_STAGING_LABEL,
  PARTIAL_AXIS_REENTRY_BLOCKING_ACTIONS,
  POST_EXPERIMENT_STAGING_LABEL,
  POST_EXPERIMENT_STAGING_LOCATION,
  POST_EXPERIMENT_STAGING_STATUS,
  SAMPLES_KEY,
  SCHEDULES_KEY,
  STAGING_EVENTS_KEY,
  STAGING_LOCATION,
  STAGING_STOCKED_STATUS,
  STORAGE_ROOM_CONFIGS,
  STRICT_COMPLETED_RUN_TRAY_STATUSES,
  TASKS_KEY,
  WITHDRAWAL_HISTORY_ACTIONS,
  asArray,
  buildAllEventMap,
  buildEventMap,
  buildTaskMap,
  collectTrayStorageEvents,
  compareDateTimes,
  compareValues,
  createId,
  eventMatchesRoom,
  eventTargetsPostExperimentStaging,
  eventTargetsStorageRoom,
  formatDateTime,
  hasAppearanceStorageStatus,
  hasPostExperimentStagingStorageStatus,
  hasPreAppearanceInboundStatus,
  isCurrentStagingStatus,
  isHandoverLocation,
  isStagingDestination,
  normalizeText,
  parseCompletedEventTimeValue,
  parseExperimentHistoryDetail,
  parseTimeValue,
  resolveExperimentName,
  resolveLatestAppearanceWithdrawalRestoreStatus,
  resolveScheduleLabId,
  resolveStatusClass,
  resolveStorageInboundSourceLabel,
  resolveStorageRoomConfig,
  resolveTrayStatus,
  toDateKey,
};
