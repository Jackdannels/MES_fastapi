// 构建样品流转列表、暂存视图和更新辅助逻辑。
import { filterActiveTasks, isReturnedTrayStatus } from "@/lib/taskArchive";
const DEFAULT_LABELS = {
  intakeLocation: "\u63A5\u9A73\u533A",
  unpackingLocation: "\u62C6\u7BB1\u64CD\u4F5C\u95F4",
  preRetentionLocation: "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u6682\u5B58\u95F4\uFF09",
  retentionLocation: "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u6682\u5B58\u95F4\uFF09",
  postRetentionLocation: "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4\uFF09",
  sampleReceived: "\u5DF2\u63A5\u6536",
  sampleTesting: "\u8BD5\u9A8C\u4E2D",
  sampleStored: "\u5DF2\u5165\u5E93",
};

const TEST_LABS = new Set([
  "\u51B2\u51FB\u4E00\u5BA4",
  "\u51B2\u51FB\u4E8C\u5BA4",
  "\u632F\u52A8\u4E00\u5BA4",
  "\u632F\u52A8\u4E8C\u5BA4",
  "\u56DB\u7EFC\u5408\u5B9E\u9A8C\u5BA4",
  "\u6E29\u5EA6\u51B2\u51FB\u4E00\u5BA4",
  "\u6E29\u5EA6\u51B2\u51FB\u4E8C\u5BA4",
  "\u9AD8\u4F4E\u6E29\u6E7F\u70ED\u4E00\u5BA4",
  "\u76D0\u96FE\u8BD5\u9A8C\u5BA4",
  "\u9709\u83CC\u8BD5\u9A8C\u5BA4",
]);

const TEST_LAB_OPTIONS = Array.from(TEST_LABS).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

const SAMPLE_FLOW_STEPS = [
  { key: "in_transit", label: "\u6837\u54C1\u8FD0\u8F93\u4E2D" },
  { key: "arrived", label: "\u5230\u8D27" },
  { key: "sent_to_staging", label: "\u9001\u81F3\u6682\u5B58\u95F4" },
  { key: "arrived_staging", label: "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4" },
  { key: "sent_to_lab", label: "\u9001\u81F3\u5B9E\u9A8C\u5BA4" },
  { key: "arrived_lab", label: "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4" },
  { key: "fixture_install", label: "\u5DE5\u88C5\u5939\u5177\u5B89\u88C5" },
  { key: "ready", label: "\u5B9E\u9A8C\u51C6\u5907\u5C31\u7EEA" },
  { key: "running", label: "\u5B9E\u9A8C\u8FDB\u884C\u4E2D" },
  { key: "completed", label: "\u5B9E\u9A8C\u5DF2\u5B8C\u6210" },
  { key: "post_test_staging", label: "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4" },
  { key: "returned", label: "\u5382\u5BB6\u6536\u56DE" },
];

const FLOW_STEP_KEY_BY_LABEL = new Map(SAMPLE_FLOW_STEPS.map((step) => [step.label, step.key]));
const FLOW_STEP_INDEX_BY_KEY = new Map(SAMPLE_FLOW_STEPS.map((step, index) => [step.key, index]));
const EXPERIMENT_STARTED_FLOW_INDEX = FLOW_STEP_INDEX_BY_KEY.get("sent_to_lab") ?? 4;
const EXPERIMENT_FLOW_STATUS_LABELS = {
  pending: "未完成",
  running: "进行中",
  completed: "已完成",
};
const MULTI_EXPERIMENT_ROUTE_STEPS = ["送至暂存间", "已到达暂存间", "送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪"];
const WITHDRAWAL_ACTIONS = new Set(["撤回出库", "实验任务撤回", "任务切换撤回"]);

const DETAIL_STATUS_OPTIONS = SAMPLE_FLOW_STEPS.map((step) => step.label);
const FLOW_STATUS_LABELS = new Set(DETAIL_STATUS_OPTIONS);
const TRAY_STATUS_OPTIONS = DETAIL_STATUS_OPTIONS.slice();

// 样品流转涉及大量字符串比较，统一先做基础规范化。
const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const uniqueNormalizedTexts = (values) => Array.from(new Set(asArray(values).map(normalizeText).filter(Boolean)));
const isLikelyLabDestination = (value) => /室$/.test(normalizeText(value));

const resolveExperimentIdentityName = (experiment, fallback = "") =>
  normalizeText(experiment?.experiment_name)
  || normalizeText(experiment?.name)
  || normalizeText(experiment?.experimentName)
  || normalizeText(experiment?.experiment_type)
  || normalizeText(experiment?.experimentType)
  || normalizeText(experiment?.required_device)
  || normalizeText(experiment?.requiredDevice)
  || fallback;

const resolveExperimentDisplayName = (experiment, fallback = "") => {
  const explicitType =
    normalizeText(experiment?.experiment_type)
    || normalizeText(experiment?.experimentType)
    || normalizeText(experiment?.test_type)
    || normalizeText(experiment?.testType);
  if (explicitType) {
    return explicitType;
  }
  const requiredDevice = normalizeText(experiment?.required_device) || normalizeText(experiment?.requiredDevice);
  if (requiredDevice && !isLikelyLabDestination(requiredDevice)) {
    return requiredDevice;
  }
  return resolveExperimentIdentityName(experiment, fallback) || requiredDevice || fallback;
};

const resolveExperimentAliases = (experiment, fallback = "") =>
  uniqueNormalizedTexts([
    normalizeText(experiment?.name),
    normalizeText(experiment?.displayName),
    normalizeText(experiment?.experiment_name),
    normalizeText(experiment?.experimentName),
    normalizeText(experiment?.experiment_type),
    normalizeText(experiment?.experimentType),
    normalizeText(experiment?.test_type),
    normalizeText(experiment?.testType),
    normalizeText(experiment?.required_device),
    normalizeText(experiment?.requiredDevice),
    fallback,
  ]);

// 允许通过覆盖 labels 复用同一套状态推导逻辑。
const normalizeLabels = (labels = {}) => ({
  ...DEFAULT_LABELS,
  ...(labels && typeof labels === "object" ? labels : {}),
});

const isPostRetentionLocation = (location, labels = DEFAULT_LABELS) => {
  const normalizedLabels = normalizeLabels(labels);
  return normalizeText(location) === normalizeText(normalizedLabels.postRetentionLocation);
};

const isAmbiguousStagingStatus = (value) => {
  const text = normalizeText(value);
  return text === "已到达暂存间" || text === "到达暂存间" || text === "放置暂存间" || text === "入库" || text === "已入库";
};

const normalizeLifecycleStatus = (location, status = "", labels = DEFAULT_LABELS) => {
  const normalizedLabels = normalizeLabels(labels);
  const normalizedLocation = normalizeText(location);
  const currentStatus = normalizeText(status);
  const preRetentionLocation = normalizeText(
    normalizedLabels.preRetentionLocation || normalizedLabels.retentionLocation,
  );
  const postRetentionLocation = normalizeText(normalizedLabels.postRetentionLocation);
  const isPreRetention = normalizedLocation && normalizedLocation === preRetentionLocation;
  const isPostRetention = normalizedLocation && normalizedLocation === postRetentionLocation;

  if (FLOW_STATUS_LABELS.has(currentStatus)) {
    return currentStatus === "运输中" ? "样品运输中" : currentStatus;
  }
  if (currentStatus === "运输中") {
    return "样品运输中";
  }
  if (currentStatus === "厂家收回" || currentStatus === "已处置") {
    return "厂家收回";
  }
  if (currentStatus === "放置暂存间") {
    return "放置实验后暂存间";
  }
  if (currentStatus === "入库" || currentStatus === "已入库" || currentStatus === normalizedLabels.sampleStored) {
    return isPostRetention ? "放置实验后暂存间" : isPreRetention ? "已到达暂存间" : "到货";
  }
  if (currentStatus === "实验完成" || currentStatus === "实验已完成") {
    return "实验已完成";
  }
  if (currentStatus === "实验进行中" || currentStatus === "实验中") {
    return "实验进行中";
  }
  if (currentStatus === "实验准备就绪" || currentStatus === normalizedLabels.sampleTesting) {
    return "实验准备就绪";
  }
  if (isPostRetention) {
    return "放置实验后暂存间";
  }
  if (isPreRetention) {
    return "已到达暂存间";
  }
  if (TEST_LABS.has(normalizedLocation)) {
    return "已到达实验室";
  }
  if (
    normalizedLocation &&
    (normalizedLocation === normalizeText(normalizedLabels.unpackingLocation) ||
      normalizedLocation === normalizeText(normalizedLabels.intakeLocation))
  ) {
    return "到货";
  }
  return SAMPLE_FLOW_STEPS[0].label;
};

const normalizeSampleRecord = (sample, labels = DEFAULT_LABELS) => {
  const record = sample && typeof sample === "object" ? { ...sample } : {};
  const normalizedStatus = normalizeLifecycleStatus(record.location, record.status, labels);
  const trays = Array.isArray(record.trays)
    ? record.trays.map((tray) => ({
        ...tray,
        status: normalizeLifecycleStatus(record.location, normalizeText(tray?.status) || normalizedStatus, labels),
      }))
    : [];

  return {
    ...record,
    flow_status: normalizedStatus,
    status: normalizedStatus,
    trays,
  };
};

const normalizeSamplesSnapshot = (samples, labels = DEFAULT_LABELS) =>
  (Array.isArray(samples) ? samples : []).map((sample) => normalizeSampleRecord(sample, labels));

// 托盘状态与样品状态保持同一套规范流程标签。
const syncTrayStatusToSampleStatus = (status, location = "", labels = DEFAULT_LABELS) =>
  normalizeLifecycleStatus(location, status, labels);

// 批量创建样品和历史记录时使用轻量级随机 ID。
const generateId = (prefix) => {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${stamp}-${rand}`;
};

// 批量输入框支持按空格、逗号和分号拆分样品号。
const parseCodeList = (value) =>
  Array.from(
    new Set(
      String(value ?? "")
        .split(/[\s,\uFF0C;\uFF1B]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const compareText = (left, right) => normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN");
const parseTimeValue = (value) => {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
};
const entryTimeValue = (entry) => parseTimeValue(entry?.time || entry?.updated_at || entry?.created_at || entry?.timestamp);
const parseExperimentHistoryDetail = (detail, taskCode) => {
  const segments = String(detail ?? "")
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
const isWithdrawalHistoryEntry = (entry) => WITHDRAWAL_ACTIONS.has(normalizeText(entry?.action));
const latestWithdrawalHistoryEntry = (historyEntries = []) =>
  asArray(historyEntries).reduce((latest, entry) => {
    if (!isWithdrawalHistoryEntry(entry)) {
      return latest;
    }
    const time = entryTimeValue(entry);
    if (!latest || time >= latest.time) {
      return { entry, time };
    }
    return latest;
  }, null);
const stripCompletedExperimentSuffix = (value) => {
  const text = normalizeText(value);
  return text
    .replace(/已经完成$/, "")
    .replace(/已完成$/, "")
    .replace(/完成$/, "");
};
const parseWithdrawalRestoreTarget = (detail, taskCode) => {
  const parsed = parseExperimentHistoryDetail(detail, taskCode);
  const rawStatus = normalizeText(parsed?.status);
  if (!rawStatus.startsWith("撤回至")) {
    return null;
  }
  const target = rawStatus.slice("撤回至".length).trim();
  if (!target) {
    return null;
  }
  const experimentName = stripCompletedExperimentSuffix(target);
  if (experimentName && experimentName !== target) {
    return {
      experimentName,
      status: "实验已完成",
    };
  }
  return {
    experimentName: "",
    status: target,
  };
};

const buildExperimentRouteSteps = () => MULTI_EXPERIMENT_ROUTE_STEPS.slice();

const hasExperimentEnteredLabFlow = (status, location = "") => {
  const normalizedStatus = normalizeLifecycleStatus(location, status);
  const key = FLOW_STEP_KEY_BY_LABEL.get(normalizedStatus);
  const index = FLOW_STEP_INDEX_BY_KEY.get(key) ?? -1;
  return index >= EXPERIMENT_STARTED_FLOW_INDEX;
};

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
          normalizeText(entry?.task_code) === normalizedTaskCode && normalizeText(entry?.tray_code) === normalizedTrayCode,
      )
      .map((entry) => normalizeText(entry?.experiment_code))
      .filter(Boolean),
  );

  const scheduleMap = new Map(
    (Array.isArray(schedules) ? schedules : [])
      .filter((schedule) => normalizeText(schedule?.task_code) === normalizedTaskCode)
      .map((schedule) => [normalizeText(schedule?.experiment_code), parseTimeValue(schedule?.start_at)]),
  );

  return (Array.isArray(experiments) ? experiments : [])
    .filter((experiment) => {
      if (normalizeText(experiment?.task_code) !== normalizedTaskCode) {
        return false;
      }
      const experimentCode = normalizeText(experiment?.experiment_code);
      return trayExperimentCodes.size === 0 || trayExperimentCodes.has(experimentCode);
    })
    .slice()
    .sort((left, right) => {
      const leftCode = normalizeText(left?.experiment_code);
      const rightCode = normalizeText(right?.experiment_code);
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
      return {
        code: normalizeText(experiment?.experiment_code),
        name,
        displayName,
        aliases: resolveExperimentAliases(experiment, name),
      };
    });
};

const resolveSingleTrayExperiment = (input = {}) => {
  const orderedExperiments = buildOrderedTrayExperiments({
    taskCode: input.taskCode,
    trayCode: input.trayCode,
    experiments: input.experiments,
    experimentTrays: input.experimentTrays,
    schedules: input.schedules,
  });
  return orderedExperiments.length === 1 ? orderedExperiments[0] : null;
};

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

  const setExperimentEvent = (parsed, time) => {
    if (!parsed?.experimentName) {
      return;
    }
    const currentTime = Number(time) || 0;
    const existingEvent = eventMap.get(parsed.experimentName);
    if (!existingEvent || currentTime >= existingEvent.time) {
      eventMap.set(parsed.experimentName, {
        ...parsed,
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
      setExperimentEvent(
        {
          experimentName: restoreTarget.experimentName,
          status: "实验已完成",
        },
        latestWithdrawal.time,
      );
    }

    historyEntries.forEach((entry) => {
      const currentTime = entryTimeValue(entry);
      if (latestWithdrawal && currentTime <= latestWithdrawal.time) {
        return;
      }
      const parsed = parseExperimentHistoryDetail(entry?.detail, normalizedTaskCode);
      if (!parsed) {
        return;
      }
      setExperimentEvent(parsed, currentTime);
    });
  });

  return eventMap;
};

const resolveExperimentEvent = (eventMap, experiment) => {
  const aliases = uniqueNormalizedTexts([
    ...(Array.isArray(experiment?.aliases) ? experiment.aliases : []),
    experiment?.name,
    experiment?.displayName,
  ]);
  for (const alias of aliases) {
    const event = eventMap.get(alias);
    if (event) {
      return event;
    }
  }
  return null;
};

const buildTrayExperimentFlow = (input = {}) => {
  const taskCode = normalizeText(input.taskCode);
  const trayCode = normalizeText(input.trayCode);
  const orderedExperiments = buildOrderedTrayExperiments({
    taskCode,
    trayCode,
    experiments: input.experiments,
    experimentTrays: input.experimentTrays,
    schedules: input.schedules,
  });
  if (orderedExperiments.length <= 1) {
    return [];
  }

  const normalizedStatus = normalizeLifecycleStatus(input.location, input.status);
  const explicitExperimentCode = normalizeText(input.currentExperimentCode);
  const explicitIndex = explicitExperimentCode
    ? orderedExperiments.findIndex((experiment) => experiment.code === explicitExperimentCode)
    : -1;
  const experimentEventMap = resolveLatestExperimentEventMap({
    taskCode,
    trayCode,
    samples: input.samples,
  });
  const experimentStatusMap = new Map(
    orderedExperiments.map((experiment) => {
      const event = resolveExperimentEvent(experimentEventMap, experiment);
      const eventStatus = normalizeText(event?.status);
      const normalizedStatusIsCompleted = normalizeLifecycleStatus("", normalizedStatus) === "实验已完成";
      const fallbackStatus =
        experiment.code === explicitExperimentCode && !(normalizedStatusIsCompleted && !event)
          ? normalizedStatus
          : "";
      return [experiment.code, eventStatus || fallbackStatus];
    }),
  );
  const completedExperiments = orderedExperiments
    .map((experiment) => {
      const event = resolveExperimentEvent(experimentEventMap, experiment);
      if (!event || event.status !== "实验已完成") {
        return null;
      }
      return {
        code: experiment.code,
        name: experiment.name,
        displayName: experiment.displayName,
        aliases: experiment.aliases,
        state: "completed",
        completedAt: event.time,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.completedAt - right.completedAt);
  const completedCodeSet = new Set(completedExperiments.map((experiment) => experiment.code));
  const unfinishedExperiments = orderedExperiments.filter((experiment) => !completedCodeSet.has(experiment.code));
  const startedUnfinishedExperiments = unfinishedExperiments.filter((experiment) =>
    hasExperimentEnteredLabFlow(experimentStatusMap.get(experiment.code)),
  );
  const startedUnfinishedCodeSet = new Set(startedUnfinishedExperiments.map((experiment) => experiment.code));
  const explicitExperiment =
    explicitIndex >= 0
    && !completedCodeSet.has(orderedExperiments[explicitIndex]?.code)
    && hasExperimentEnteredLabFlow(experimentStatusMap.get(orderedExperiments[explicitIndex]?.code))
      ? orderedExperiments[explicitIndex]
      : null;
  const currentExperiment =
    explicitExperiment || startedUnfinishedExperiments[0] || unfinishedExperiments[0] || null;
  const isSyntheticUnstartedCurrent =
    (normalizedStatus === "厂家收回" || normalizeLifecycleStatus("", normalizedStatus) === "实验已完成")
    && completedExperiments.length > 0
    && startedUnfinishedExperiments.length === 0
    && !explicitExperiment;

  if (!currentExperiment) {
    return completedExperiments.map((experiment, index) => ({
      code: experiment.code,
      name: experiment.name,
      displayName: experiment.displayName,
      aliases: experiment.aliases,
      state: "completed",
      routeSteps: index === completedExperiments.length - 1 ? buildExperimentRouteSteps() : [],
      routeStatus: index === completedExperiments.length - 1 ? "实验已完成" : "",
    }));
  }

  const routeStatus = experimentStatusMap.get(currentExperiment.code) || normalizedStatus;
  const orderedFlowExperiments = [
    ...orderedExperiments.filter((experiment) => completedCodeSet.has(experiment.code)),
    currentExperiment,
    ...startedUnfinishedExperiments.filter((experiment) => experiment.code !== currentExperiment.code),
    ...unfinishedExperiments.filter(
      (experiment) =>
        experiment.code !== currentExperiment.code && !startedUnfinishedCodeSet.has(experiment.code),
    ),
  ];

  return orderedFlowExperiments.map((experiment) => {
    if (completedCodeSet.has(experiment.code)) {
      return {
        code: experiment.code,
        name: experiment.name,
        displayName: experiment.displayName,
        aliases: experiment.aliases,
        state: "completed",
      };
    }
    if (experiment.code === currentExperiment.code) {
      return {
        code: currentExperiment.code,
        name: currentExperiment.name,
        displayName: currentExperiment.displayName,
        aliases: currentExperiment.aliases,
        state: "current",
        unstarted: isSyntheticUnstartedCurrent,
        routeSteps: buildExperimentRouteSteps(),
        routeStatus,
      };
    }
    return {
      code: experiment.code,
      name: experiment.name,
      displayName: experiment.displayName,
      aliases: experiment.aliases,
      state: "pending",
    };
  });
};

const resolveFlowStatusRank = (location, status, labels = DEFAULT_LABELS) => {
  const normalizedStatus = normalizeLifecycleStatus(location, status, labels);
  const key = FLOW_STEP_KEY_BY_LABEL.get(normalizedStatus);
  return FLOW_STEP_INDEX_BY_KEY.get(key) ?? -1;
};

const mergeTrayEntriesByCode = (trays, sample, labels = DEFAULT_LABELS) => {
  const mergedByCode = new Map();
  const sourceTrays = Array.isArray(trays) ? trays : [];

  sourceTrays.forEach((tray) => {
    const trayCode = normalizeText(tray?.tray_code);
    if (!trayCode) {
      return;
    }

    const candidate = { ...tray };
    const existing = mergedByCode.get(trayCode);
    if (!existing) {
      mergedByCode.set(trayCode, candidate);
      return;
    }

    const existingRank = resolveFlowStatusRank(sample?.location, existing?.status, labels);
    const candidateRank = resolveFlowStatusRank(sample?.location, candidate?.status, labels);
    if (candidateRank > existingRank) {
      mergedByCode.set(trayCode, {
        ...existing,
        ...candidate,
      });
      return;
    }

    if (candidateRank === existingRank && parseTimeValue(candidate?.updated_at) > parseTimeValue(existing?.updated_at)) {
      mergedByCode.set(trayCode, {
        ...existing,
        ...candidate,
      });
    }
  });

  return Array.from(mergedByCode.values());
};

const getSampleTrayList = (sample) => {
  if (!sample || !Array.isArray(sample.trays)) {
    return [];
  }
  const sampleCode = normalizeText(sample.code);
  const validTrays = mergeTrayEntriesByCode(sample.trays, sample).filter((tray) => {
    // 只保留与当前样品编码匹配且数量有效的托盘条目。
    if (!tray) {
      return false;
    }
    const traySampleCode = normalizeText(tray.sample_code || sampleCode);
    const quantity = Number.parseInt(tray.quantity, 10);
    return traySampleCode === sampleCode && Number.isFinite(quantity) && quantity > 0;
  });
  if (validTrays.length <= 1) {
    return validTrays;
  }
  return validTrays
    .slice()
    .sort((left, right) => (
      parseTimeValue(right?.updated_at) - parseTimeValue(left?.updated_at)
      || parseTimeValue(right?.created_at) - parseTimeValue(left?.created_at)
      || sample.trays.indexOf(right) - sample.trays.indexOf(left)
    ))
    .slice(0, 1);
};

function buildSamplesTrayOverviewView(input = {}) {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const query = normalizeText(input.query).toLowerCase();
  const taskMap = new Map(
    tasks.map((task) => [
      normalizeText(task?.code),
      {
        code: normalizeText(task?.code),
        name: normalizeText(task?.name),
        testType: normalizeText(task?.test_type),
      },
    ]),
  );
  const trayMap = new Map();

  samples.forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    const taskCode = normalizeText(sample?.task_code);
    const task = taskMap.get(taskCode) || { code: taskCode, name: "", testType: "" };
    const sampleStatus = normalizeLifecycleStatus(sample?.location, sample?.status);
    getSampleTrayList(sample).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (!trayCode) {
        return;
      }
      const trayStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || sampleStatus);
      if (isReturnedTrayStatus(trayStatus)) {
        return;
      }
      if (!trayMap.has(trayCode)) {
        trayMap.set(trayCode, {
          trayCode,
          taskCode,
          taskName: task.name,
          testType: task.testType,
          status: trayStatus,
          sampleCodes: [],
        });
      }
      const row = trayMap.get(trayCode);
      if (!row.sampleCodes.includes(sampleCode)) {
        row.sampleCodes.push(sampleCode);
      }
      if (!row.status) {
        row.status = trayStatus;
      }
    });
  });

  const rows = Array.from(trayMap.values())
    .map((row) => ({
      ...row,
      sampleCodes: row.sampleCodes.slice().sort(compareText),
      sampleCount: row.sampleCodes.length,
      statusClass: resolveStatusClass(row.status),
      sampleSummary: row.sampleCodes.slice().sort(compareText).join("、"),
    }))
    .filter((row) => {
      if (!query) {
        return true;
      }
      return [row.trayCode, row.taskCode, row.taskName, row.testType, row.status, row.sampleSummary]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ")
        .includes(query);
    })
    .sort((left, right) => compareText(left.trayCode, right.trayCode));

  return { rows };
}

const normalizeHistoryFlowLabel = (value, location = "") => {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  if (isPostRetentionLocation(location) && (isAmbiguousStagingStatus(text) || text.includes("已到达暂存间"))) {
    return "放置实验后暂存间";
  }
  if (FLOW_STEP_KEY_BY_LABEL.has(text)) {
    return text;
  }
  if (text === "运输中" || text === "已运输") {
    return "样品运输中";
  }
  if (text === "实验完成" || text === "试验完成") {
    return "实验已完成";
  }
  if (text === "放置实验后暂存" || text === "实验后暂存") {
    return "放置实验后暂存间";
  }
  if (text === "收回" || text === "已收回" || text.includes("厂家收回")) {
    return "厂家收回";
  }
  const matchedStep = SAMPLE_FLOW_STEPS.find((step) => text.includes(step.label));
  if (matchedStep) {
    return matchedStep.label;
  }
  const normalized = normalizeLifecycleStatus(location, text);
  return FLOW_STEP_KEY_BY_LABEL.has(normalized) ? normalized : "";
};

const setLatestFlowTime = (timeMap, label, time) => {
  const normalizedLabel = normalizeText(label);
  const normalizedTime = normalizeText(time);
  if (!normalizedLabel || !normalizedTime) {
    return;
  }
  const existing = timeMap.get(normalizedLabel);
  if (!existing || parseTimeValue(normalizedTime) >= parseTimeValue(existing)) {
    timeMap.set(normalizedLabel, normalizedTime);
  }
};

const hidePendingFlowStepTimes = (steps = []) => {
  steps.forEach((step) => {
    if (step && !step.active && !step.reached) {
      step.time = "";
    }
  });
  return steps;
};

const buildTrayFlowTimeMap = (input = {}) => {
  const taskCode = normalizeText(input.taskCode);
  const trayCode = normalizeText(input.trayCode);
  const timeMap = new Map();
  if (!trayCode) {
    return timeMap;
  }

  (Array.isArray(input.samples) ? input.samples : []).forEach((sample) => {
    if (taskCode && normalizeText(sample?.task_code) !== taskCode) {
      return;
    }
    const trayEntries = asArray(sample?.trays).filter((tray) => normalizeText(tray?.tray_code) === trayCode);
    if (trayEntries.length === 0) {
      return;
    }
    const historyEntries = asArray(sample?.history);
    const latestWithdrawal = latestWithdrawalHistoryEntry(historyEntries);
    const latestWithdrawalEntry = latestWithdrawal?.entry || null;
    const restoreTarget = latestWithdrawalEntry
      ? parseWithdrawalRestoreTarget(latestWithdrawalEntry?.detail, taskCode)
      : null;
    const latestWithdrawalRank = latestWithdrawalEntry
      ? resolveFlowStatusRank(latestWithdrawalEntry?.location, restoreTarget?.status || latestWithdrawalEntry?.status)
      : -1;
    const shouldIgnoreHistoryTime = (entry, label, entryLocation) => {
      if (!latestWithdrawal) {
        return false;
      }
      const entryTime = entryTimeValue(entry);
      if (entryTime >= latestWithdrawal.time) {
        return false;
      }
      const labelRank = resolveFlowStatusRank(entryLocation, label);
      return labelRank > latestWithdrawalRank;
    };
    if (latestWithdrawalEntry) {
      const withdrawalTime = latestWithdrawalEntry?.time
        || latestWithdrawalEntry?.updated_at
        || latestWithdrawalEntry?.created_at
        || latestWithdrawalEntry?.timestamp;
      if (restoreTarget?.experimentName && restoreTarget.status === "实验已完成") {
        setLatestFlowTime(timeMap, `${restoreTarget.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`, withdrawalTime);
      } else {
        const restoreLabel = normalizeHistoryFlowLabel(
          restoreTarget?.status || latestWithdrawalEntry?.status,
          latestWithdrawalEntry?.location,
        );
        setLatestFlowTime(timeMap, restoreLabel, withdrawalTime);
      }
    }

    const sampleStatus = normalizeLifecycleStatus(sample?.location, sample?.status);
    if (parseTimeValue(sample?.created_at) > 0 && resolveFlowStatusRank("", sampleStatus) >= (FLOW_STEP_INDEX_BY_KEY.get("arrived") ?? 1)) {
      setLatestFlowTime(timeMap, "到货", sample?.created_at);
    }

    trayEntries.forEach((tray) => {
      const trayStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || sampleStatus);
      const trayStatusLabel = isPostRetentionLocation(sample?.location) && isAmbiguousStagingStatus(trayStatus)
        ? "放置实验后暂存间"
        : trayStatus;
      setLatestFlowTime(timeMap, trayStatusLabel, tray?.updated_at || sample?.updated_at);
    });

    historyEntries.forEach((entry) => {
      const time = entry?.time || entry?.updated_at || entry?.created_at || entry?.timestamp;
      const statusLabel = normalizeHistoryFlowLabel(entry?.status, entry?.location);
      const actionLabel = normalizeHistoryFlowLabel(entry?.action, entry?.location);
      const detailLabel = normalizeHistoryFlowLabel(entry?.detail, entry?.location);
      [statusLabel, actionLabel, detailLabel].forEach((label) => {
        if (!label || shouldIgnoreHistoryTime(entry, label, entry?.location)) {
          return;
        }
        setLatestFlowTime(timeMap, label, time);
      });

      const experimentEvent = parseExperimentHistoryDetail(entry?.detail, taskCode);
      if (experimentEvent) {
        const currentTime = entryTimeValue(entry);
        if (latestWithdrawal && currentTime < latestWithdrawal.time) {
          return;
        }
        const experimentStatus = normalizeLifecycleStatus("", experimentEvent.status);
        if (experimentStatus === "实验进行中" || experimentStatus === "实验中") {
          setLatestFlowTime(timeMap, `${experimentEvent.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.running}`, time);
        }
        if (experimentStatus === "实验已完成" || experimentStatus === "实验完成") {
          setLatestFlowTime(timeMap, `${experimentEvent.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`, time);
        }
      }
    });
  });

  return timeMap;
};

function buildTrayFlowView(input = {}) {
  const stepTimeMap = buildTrayFlowTimeMap(input);
  const experimentFlow = Array.isArray(input.experimentFlow) && input.experimentFlow.length > 0
    ? input.experimentFlow
    : buildTrayExperimentFlow(input);
  const trayCode = normalizeText(input.trayCode);
  if (experimentFlow.length > 0) {
    const currentExperimentIndex = experimentFlow.findIndex((item) => normalizeText(item?.state) === "current");
    const activeExperiment = currentExperimentIndex >= 0 ? experimentFlow[currentExperimentIndex] : null;
    const completedExperiments = experimentFlow.filter((item) => normalizeText(item?.state) === "completed");
    const experimentsBeforeCurrent = currentExperimentIndex >= 0 ? experimentFlow.slice(0, currentExperimentIndex) : [];
    const experimentsAfterCurrent = currentExperimentIndex >= 0 ? experimentFlow.slice(currentExperimentIndex + 1) : [];
    const steps = [];

    const pushStep = (step) => {
      const label = normalizeText(step?.label);
      steps.push({
        active: false,
        reached: false,
        time: step?.time || stepTimeMap.get(label) || "",
        ...step,
      });
      return steps.length - 1;
    };
    const experimentDisplayName = (experiment, index) =>
      normalizeText(experiment?.displayName) || normalizeText(experiment?.name) || `实验${index + 1}`;
    const experimentIdentityName = (experiment, index) => normalizeText(experiment?.name) || `实验${index + 1}`;
    const experimentStatusLabel = (experiment, index, statusKey) =>
      `${experimentDisplayName(experiment, index)}${EXPERIMENT_FLOW_STATUS_LABELS[statusKey] || EXPERIMENT_FLOW_STATUS_LABELS.pending}`;
    const experimentIdentityStatusLabel = (experiment, index, statusKey) =>
      `${experimentIdentityName(experiment, index)}${EXPERIMENT_FLOW_STATUS_LABELS[statusKey] || EXPERIMENT_FLOW_STATUS_LABELS.pending}`;

    const transportIndex = pushStep({ key: "in_transit", label: "样品运输中" });
    const arrivalIndex = pushStep({ key: "arrival", label: "到货" });

    let currentStatus = "到货";
    let activeIndex = arrivalIndex;

    if (activeExperiment) {
      const pushExperimentStep = (experiment, index) => {
        const state = normalizeText(experiment?.state);
        const labelState = state === "current" && experiment?.unstarted ? "pending" : state;
        const label = experimentStatusLabel(experiment, index, labelState);
        const identityLabel = experimentIdentityStatusLabel(experiment, index, labelState);
        return pushStep({
          key: `experiment-${state || "pending"}-${index}`,
          label,
          reached: state === "completed",
          time: stepTimeMap.get(label) || stepTimeMap.get(identityLabel) || "",
        });
      };
      const completedStepIndexes = [];
      experimentsBeforeCurrent.forEach((experiment, index) => {
        completedStepIndexes.push(pushExperimentStep(experiment, index));
      });
      const routeSteps = Array.isArray(activeExperiment?.routeSteps) && activeExperiment.routeSteps.length > 0
        ? activeExperiment.routeSteps.filter(Boolean)
        : buildExperimentRouteSteps();
      const normalizedRouteStatus = normalizeLifecycleStatus(input.location, activeExperiment?.routeStatus || input.status);
      const routeStatusIndex = routeSteps.findIndex((label) => label === normalizedRouteStatus);
      const routeIndexes = routeSteps.map((label, index) =>
        pushStep({
          key: `route-${currentExperimentIndex}-${index}`,
          label,
        }),
      );
      const experimentName = experimentDisplayName(activeExperiment, currentExperimentIndex);
      const experimentIdentityNameText = experimentIdentityName(activeExperiment, currentExperimentIndex);
      const currentExperimentLabel = `${experimentName}${activeExperiment?.unstarted ? EXPERIMENT_FLOW_STATUS_LABELS.pending : EXPERIMENT_FLOW_STATUS_LABELS.running}`;
      const currentExperimentIdentityLabel = `${experimentIdentityNameText}${activeExperiment?.unstarted ? EXPERIMENT_FLOW_STATUS_LABELS.pending : EXPERIMENT_FLOW_STATUS_LABELS.running}`;
      const currentExperimentIndexInSteps = pushStep({
        key: `experiment-current-${currentExperimentIndex}`,
        label: currentExperimentLabel,
        time: stepTimeMap.get(currentExperimentLabel) || stepTimeMap.get(currentExperimentIdentityLabel) || "",
      });

      experimentsAfterCurrent.forEach((experiment, index) => {
        pushExperimentStep(experiment, index + experimentsBeforeCurrent.length + 1);
      });
      const postTestStagingIndex = pushStep({
        key: `route-post-staging-${currentExperimentIndex}`,
        label: "放置实验后暂存间",
      });
      const returnedIndex = pushStep({
        key: `route-returned-${currentExperimentIndex}`,
        label: "厂家收回",
      });

      if (routeStatusIndex >= 0) {
        currentStatus = normalizedRouteStatus;
        activeIndex = routeIndexes[routeStatusIndex];
        routeIndexes.forEach((stepIndex, index) => {
          if (index < routeStatusIndex) {
            steps[stepIndex].reached = true;
          }
        });
      } else if (normalizedRouteStatus === "实验进行中" || normalizedRouteStatus === "实验中") {
        currentStatus = `${experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.running}`;
        activeIndex = currentExperimentIndexInSteps;
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
      } else if (normalizedRouteStatus === "实验已完成" || normalizedRouteStatus === "实验完成") {
        const latestCompletedIndex = completedStepIndexes.at(-1);
        if (latestCompletedIndex !== undefined) {
          currentStatus = steps[latestCompletedIndex].label;
          activeIndex = latestCompletedIndex;
        } else {
          currentStatus = `${experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`;
          activeIndex = currentExperimentIndexInSteps;
        }
      } else if (normalizedRouteStatus === "放置实验后暂存间") {
        currentStatus = normalizedRouteStatus;
        activeIndex = postTestStagingIndex;
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        steps[currentExperimentIndexInSteps].reached = true;
      } else if (normalizedRouteStatus === "厂家收回") {
        currentStatus = normalizedRouteStatus;
        activeIndex = returnedIndex;
        if (activeExperiment?.unstarted) {
          routeIndexes.forEach((stepIndex, index) => {
            if (index <= 1) {
              steps[stepIndex].reached = true;
            }
          });
        } else {
          routeIndexes.forEach((stepIndex) => {
            steps[stepIndex].reached = true;
          });
          steps[currentExperimentIndexInSteps].reached = true;
          steps[postTestStagingIndex].reached = true;
        }
      } else if (normalizedRouteStatus === "样品运输中") {
        currentStatus = normalizedRouteStatus;
        activeIndex = transportIndex;
      } else {
        currentStatus = normalizedRouteStatus || "到货";
        activeIndex = arrivalIndex;
      }
    } else {
      const completedMilestones = completedExperiments.slice(0, -1);
      completedMilestones.forEach((experiment, index) => {
        const label = experimentStatusLabel(experiment, index, "completed");
        const identityLabel = experimentIdentityStatusLabel(experiment, index, "completed");
        pushStep({
          key: `experiment-completed-${index}`,
          label,
          reached: true,
          time: stepTimeMap.get(label) || stepTimeMap.get(identityLabel) || "",
        });
      });
      const lastExperiment = completedExperiments.at(-1);
      const routeSteps = Array.isArray(lastExperiment?.routeSteps) && lastExperiment.routeSteps.length > 0
        ? lastExperiment.routeSteps.filter(Boolean)
        : buildExperimentRouteSteps();
      routeSteps.forEach((label, index) => {
        pushStep({
          key: `route-final-${index}`,
          label,
          reached: true,
        });
      });
      const experimentName = experimentDisplayName(lastExperiment, completedExperiments.length - 1);
      const experimentIdentityNameText = experimentIdentityName(lastExperiment, completedExperiments.length - 1);
      const completedLabel = `${experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`;
      const completedIdentityLabel = `${experimentIdentityNameText}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`;
      const completedIndex = pushStep({
        key: "experiment-final-completed",
        label: completedLabel,
        time: stepTimeMap.get(completedLabel) || stepTimeMap.get(completedIdentityLabel) || "",
      });
      const postTestStagingIndex = pushStep({
        key: "route-final-post-staging",
        label: "放置实验后暂存间",
      });
      const returnedIndex = pushStep({
        key: "route-final-returned",
        label: "厂家收回",
      });
      const normalizedFinalStatus = normalizeLifecycleStatus(input.location, input.status);
      if (normalizedFinalStatus === "放置实验后暂存间" || normalizedFinalStatus === "已到达暂存间") {
        activeIndex = postTestStagingIndex;
        steps[completedIndex].reached = true;
        currentStatus = "放置实验后暂存间";
      } else if (normalizedFinalStatus === "厂家收回") {
        activeIndex = returnedIndex;
        steps[completedIndex].reached = true;
        steps[postTestStagingIndex].reached = true;
        currentStatus = normalizedFinalStatus;
      } else {
        activeIndex = completedIndex;
        currentStatus = completedLabel;
      }
    }

    steps[transportIndex].active = activeIndex === transportIndex;
    steps[transportIndex].reached = activeIndex !== transportIndex;
    steps[arrivalIndex].active = activeIndex === arrivalIndex;
    steps[arrivalIndex].reached = activeIndex !== arrivalIndex && activeIndex !== transportIndex;
    if (steps[activeIndex]) {
      steps[activeIndex].active = true;
    }
    hidePendingFlowStepTimes(steps);

    return {
      trayCode,
      status: currentStatus,
      currentStatus: trayCode ? `当前托盘：${trayCode} | 当前状态：${currentStatus}` : `当前状态：${currentStatus}`,
      steps,
    };
  }

  const status = normalizeLifecycleStatus(input.location, input.status) || SAMPLE_FLOW_STEPS[0].label;
  const currentKey = FLOW_STEP_KEY_BY_LABEL.get(status) || SAMPLE_FLOW_STEPS[0].key;
  const currentIndex = FLOW_STEP_INDEX_BY_KEY.get(currentKey) ?? 0;
  const singleExperiment = resolveSingleTrayExperiment(input);
  const singleExperimentName = normalizeText(singleExperiment?.displayName || singleExperiment?.name);
  const singleExperimentIdentityName = normalizeText(singleExperiment?.name);
  const displayStatus = buildSingleExperimentStatusLabel(singleExperimentName, status);
  const singleExperimentEvent = singleExperiment
    ? resolveExperimentEvent(
      resolveLatestExperimentEventMap({
        taskCode: input.taskCode,
        trayCode: input.trayCode,
        samples: input.samples,
      }),
      singleExperiment,
    )
    : null;
  const singleExperimentCompleted = normalizeLifecycleStatus("", singleExperimentEvent?.status) === "实验已完成";
  const holdUncompletedSingleExperiment =
    status === "厂家收回" && Boolean(singleExperimentName) && !singleExperimentCompleted;
  const preExperimentReturnedReachedIndex = FLOW_STEP_INDEX_BY_KEY.get("arrived_staging") ?? 3;

  return {
    trayCode,
    status: displayStatus,
    currentStatus: trayCode ? `当前托盘：${trayCode} | 当前状态：${displayStatus}` : `当前状态：${displayStatus}`,
    steps: SAMPLE_FLOW_STEPS.map((step, index) => {
      const label = buildSingleExperimentStatusLabel(singleExperimentName, step.label);
      const identityLabel = buildSingleExperimentStatusLabel(singleExperimentIdentityName || singleExperimentName, step.label);
      const active = step.key === currentKey;
      const reached = holdUncompletedSingleExperiment ? index <= preExperimentReturnedReachedIndex : index < currentIndex;
      const time = active || reached ? stepTimeMap.get(label) || stepTimeMap.get(identityLabel) || stepTimeMap.get(step.label) || "" : "";
      return {
        ...step,
        label,
        time,
        active,
        reached,
      };
    }),
  };
}

const resolveSampleStatus = (location, labels = DEFAULT_LABELS) => {
  const normalizedLabels = normalizeLabels(labels);
  const normalizedLocation = normalizeText(location);
  const preRetentionLocation = normalizeText(
    normalizedLabels.preRetentionLocation || normalizedLabels.retentionLocation,
  );
  const postRetentionLocation = normalizeText(normalizedLabels.postRetentionLocation);

  // 按位置反推展示状态，让批量入库不需要额外指定状态。
  if (normalizedLocation && normalizedLocation === postRetentionLocation) {
    return "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4";
  }
  if (
    normalizedLocation &&
    (normalizedLocation === preRetentionLocation ||
      normalizedLocation === normalizeText(normalizedLabels.unpackingLocation) ||
      normalizedLocation === normalizeText(normalizedLabels.intakeLocation))
  ) {
    return normalizedLocation === preRetentionLocation ? "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4" : "\u5230\u8D27";
  }
  if (TEST_LABS.has(normalizedLocation)) {
    return "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4";
  }
  return "\u8FD0\u8F93\u4E2D";
};

const resolveFlowStatusByLocation = (location, status = "", labels = DEFAULT_LABELS) =>
  normalizeLifecycleStatus(location, status, labels);

const appendSampleHistory = (sample, action, detail = "", now = new Date().toISOString()) => {
  const history = Array.isArray(sample.history) ? sample.history.slice() : [];
  history.unshift({
    // 每次流转更新都记录时间、位置、责任人和状态快照。
    id: generateId("sample-event"),
    time: now,
    action,
    location: sample.location || "",
    owner: sample.owner || "",
    status: sample.status || "",
    detail,
  });
  return history;
};

const cloneSampleCollection = (samples) =>
  Array.isArray(samples)
    ? samples.map((sample) => ({
        ...sample,
        history: Array.isArray(sample?.history) ? sample.history.slice() : [],
        trays: Array.isArray(sample?.trays) ? sample.trays.map((tray) => ({ ...tray })) : [],
      }))
    : [];

const synchronizeSamplesForTrayCodes = (input = {}) => {
  const labels = normalizeLabels(input.labels);
  const samples = cloneSampleCollection(input.samples);
  const trayCodes = new Set(asArray(input.trayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const nextStatus = normalizeText(input.status);
  const now = input.now || new Date().toISOString();
  const nextLocation = normalizeText(input.location);
  const nextOwner = normalizeText(input.owner);
  const historyAction = normalizeText(input.historyAction);
  const historyDetail = normalizeText(input.historyDetail);

  if (trayCodes.size === 0 || !nextStatus) {
    return { samples, updatedCount: 0 };
  }

  let updatedCount = 0;
  samples.forEach((sample) => {
    const hasMatchingTray = getSampleTrayList(sample).some((tray) => trayCodes.has(normalizeText(tray?.tray_code)));
    if (!hasMatchingTray) {
      return;
    }

    sample.trays = asArray(sample.trays).map((tray) =>
      trayCodes.has(normalizeText(tray?.tray_code))
        ? {
            ...tray,
            status: nextStatus,
            updated_at: now,
          }
        : tray,
    );

    if (nextLocation) {
      sample.location = nextLocation;
    }
    if (nextOwner) {
      sample.owner = nextOwner;
    }
    sample.status = normalizeLifecycleStatus(sample.location, nextStatus, labels);
    sample.flow_status = sample.status;
    sample.updated_at = now;
    if (historyAction) {
      sample.history = appendSampleHistory(
        { ...sample, status: sample.status },
        historyAction,
        historyDetail,
        now,
      );
    }
    updatedCount += 1;
  });

  return { samples, updatedCount };
};

const resolveStatusClass = (status) => {
  const normalized = normalizeText(status);
  if (
    normalized === "\u9001\u81F3\u5B9E\u9A8C\u5BA4" ||
    normalized === "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4" ||
    normalized === "\u5DE5\u88C5\u5939\u5177\u5B89\u88C5" ||
    normalized === "\u5B9E\u9A8C\u51C6\u5907\u5C31\u7EEA" ||
    normalized === "\u5B9E\u9A8C\u8FDB\u884C\u4E2D"
  ) {
    return "status running";
  }
  if (
    normalized === "\u9001\u81F3\u6682\u5B58\u95F4" ||
    normalized === "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4" ||
    normalized === "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4"
  ) {
    return "status retention";
  }
  if (
    normalized === "\u5DF2\u5904\u7F6E" ||
    normalized === "\u5382\u5BB6\u6536\u56DE" ||
    normalized === "\u5B9E\u9A8C\u5DF2\u5B8C\u6210"
  ) {
    return "status completed";
  }
  if (normalized === "\u6837\u54C1\u8FD0\u8F93\u4E2D" || normalized === "\u8FD0\u8F93\u4E2D" || normalized === "\u5230\u8D27") {
    return "status accepted";
  }
  return "status";
};

// 排序时优先按数字比较，无法数字化时回退到中文字符串排序。
const compareValue = (left, right, direction) => {
  const factor = direction === "desc" ? -1 : 1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return (leftNumber - rightNumber) * factor;
  }
  return normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN") * factor;
};

const filterSamplesForActiveTasks = (samples, tasks) => {
  const taskList = Array.isArray(tasks) ? tasks : [];
  if (taskList.length === 0) {
    return Array.isArray(samples) ? samples : [];
  }
  const activeTaskCodes = new Set(
    filterActiveTasks(taskList, samples)
      .map((task) => normalizeText(task?.code))
      .filter(Boolean),
  );
  return (Array.isArray(samples) ? samples : []).filter((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    return !taskCode || activeTaskCodes.has(taskCode);
  });
};

// 在筛选和排序后构建分页样品流转表格。
function buildSamplesFlowView(input = {}) {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const samples = filterSamplesForActiveTasks(input.samples, tasks).slice();
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const sort = input.sort && typeof input.sort === "object" ? input.sort : {};
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 8;

  const query = normalizeText(filters.query).toLowerCase();
  const selectedTaskCode = normalizeText(filters.taskCode);
  const selectedStatus = normalizeText(filters.status);

  const normalizedSamples = samples.map((sample) => normalizeSampleRecord(sample));
  const rows = normalizedSamples
    .filter((sample) => {
      // 列表筛选同时支持任务号、状态和自由关键词。
      if (selectedTaskCode && normalizeText(sample.task_code) !== selectedTaskCode) {
        return false;
      }
      if (selectedStatus && normalizeText(sample.status) !== selectedStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      const trayText = getSampleTrayList(sample)
        .map((tray) => normalizeText(tray.tray_code))
        .join(" ");
      const searchText = [
        sample.task_code,
        sample.code,
        trayText,
        sample.location,
        sample.owner,
        sample.status,
        sample.flow_status,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return searchText.includes(query);
    })
    .map((sample) => {
      const trayCodes = getSampleTrayList(sample).map((tray) => normalizeText(tray?.tray_code)).filter(Boolean);
      return {
        ...sample,
        // 托盘编号和状态样式都在视图层消费，因此提前派生好。
        trayCodes,
        trayCodesText: trayCodes.join("、"),
        statusClass: resolveStatusClass(sample.status),
      };
    });

  const sortKey = normalizeText(sort.key);
  const sortDirection = normalizeText(sort.direction) === "desc" ? "desc" : "asc";
  const sortedRows = rows.slice().sort((left, right) => {
    if (!sortKey) {
      return compareValue(left.code, right.code, "asc");
    }
    const order = compareValue(left?.[sortKey], right?.[sortKey], sortDirection);
    if (order !== 0) {
      return order;
    }
    return compareValue(left.code, right.code, "asc");
  });

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), totalPages) : 1;
  const startIndex = (currentPage - 1) * pageSize;

  const taskCodes = Array.from(
    new Set(normalizedSamples.map((sample) => normalizeText(sample?.task_code)).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  const statusOptions = Array.from(new Set(normalizedSamples.map((sample) => normalizeText(sample?.status)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "zh-Hans-CN"),
  );

  return {
    currentPage,
    rows: sortedRows.slice(startIndex, startIndex + pageSize),
    statusOptions,
    taskOptions: taskCodes,
    totalCount: sortedRows.length,
    totalPages,
  };
}

// 对多个样品一次性执行批量接样操作。
function submitSamplesBatchIntake(input = {}) {
  const labels = normalizeLabels(input.labels);
  const samples = Array.isArray(input.samples)
    ? input.samples.map((sample) => ({
        ...sample,
        history: Array.isArray(sample?.history) ? sample.history.slice() : [],
        trays: Array.isArray(sample?.trays) ? sample.trays.slice() : [],
      }))
    : [];
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const codes = parseCodeList(payload.codes);
  const targetLocation =
    normalizeText(payload.location) ||
    normalizeText(labels.intakeLocation) ||
    normalizeText(labels.unpackingLocation) ||
      normalizeText(labels.preRetentionLocation) ||
      normalizeText(labels.retentionLocation);

  // 批量接样要求同时提供目标位置和至少一个样品号。
  if (!targetLocation || codes.length === 0) {
    return { error: "\u8BF7\u586B\u5199\u5165\u5E93\u4F4D\u7F6E\u548C\u6837\u54C1\u5217\u8868\u3002", samples };
  }

  const now = input.now || new Date().toISOString();
  codes.forEach((code) => {
    const existing = samples.find((sample) => normalizeText(sample.code) === code);
    const nextStatus = resolveSampleStatus(targetLocation, labels);
    if (existing) {
      // 已存在样品按“更新位置与状态”处理，不重复生成记录。
      existing.location = targetLocation;
      existing.owner = normalizeText(payload.owner) || existing.owner || "";
      existing.status = normalizeLifecycleStatus(targetLocation, nextStatus, labels);
      existing.flow_status = existing.status;
      existing.updated_at = now;
      existing.history = appendSampleHistory(existing, "\u6279\u91CF\u5165\u5E93", "", now);
      return;
    }

    const created = {
      // 不存在的样品号会在批量接样时被直接创建。
      id: generateId("sample"),
      code,
      task_code: "",
      location: targetLocation,
      owner: normalizeText(payload.owner),
      status: normalizeLifecycleStatus(targetLocation, nextStatus, labels),
      flow_status: normalizeLifecycleStatus(targetLocation, nextStatus, labels),
      created_at: now,
      updated_at: now,
      trays: [],
      history: [],
    };
    created.history = appendSampleHistory(created, "\u6279\u91CF\u5165\u5E93", "", now);
    samples.unshift(created);
  });

  return { error: "", samples: normalizeSamplesSnapshot(samples, labels) };
}

// 更新单个样品可编辑的明细字段及其派生状态。
function updateSampleDetail(input = {}) {
  const sample = input.sample && typeof input.sample === "object" ? { ...input.sample } : null;
  if (!sample) {
    return { error: "\u672A\u627E\u5230\u6837\u54C1\u3002", sample: null };
  }
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const labels = normalizeLabels(input.labels);
  const nextStatus = normalizeText(payload.status) || normalizeText(sample.status);
  const nextRemark = normalizeText(payload.remark);
  const now = input.now || new Date().toISOString();
  const trayCodes = getSampleTrayList(sample).map((tray) => normalizeText(tray?.tray_code)).filter(Boolean);

  if (trayCodes.length > 0) {
    const result = synchronizeSamplesForTrayCodes({
      historyAction: "\u6837\u54C1\u8BE6\u60C5\u66F4\u65B0",
      historyDetail: nextRemark,
      labels,
      now,
      samples: [sample],
      status: nextStatus,
      trayCodes,
    });
    return { error: "", sample: result.samples[0] || sample };
  }

  // 明细抽屉只允许改状态与备注，流转状态由位置和状态共同派生。
  sample.status = normalizeLifecycleStatus(sample.location, nextStatus, labels);
  sample.flow_status = sample.status;
  sample.updated_at = now;
  sample.history = appendSampleHistory(sample, "\u6837\u54C1\u8BE6\u60C5\u66F4\u65B0", nextRemark, now);

  return { error: "", sample };
}

function updateTrayStatus(input = {}) {
  const trayCode = normalizeText(input.trayCode);
  const labels = normalizeLabels(input.labels);
  const now = input.now || new Date().toISOString();
  const samples = cloneSampleCollection(input.samples);

  if (!trayCode || !normalizeText(input.status)) {
    return { error: "请选择托盘和目标状态。", samples };
  }

  const nextStatus = syncTrayStatusToSampleStatus(input.status, "", labels);
  const result = synchronizeSamplesForTrayCodes({
    historyAction: "托盘状态更新",
    historyDetail: `${trayCode} -> ${nextStatus}`,
    labels,
    now,
    samples,
    status: nextStatus,
    trayCodes: [trayCode],
  });

  return {
    error: result.updatedCount > 0 ? "" : `未找到托盘 ${trayCode}。`,
    samples: result.samples,
  };
}

// 构建当前位于前置或实验后暂存间的只读样品列表。
function buildSamplesStagingView(input = {}) {
  const labels = normalizeLabels(input.labels);
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const query = normalizeText(filters.query || input.query).toLowerCase();
  const selectedTaskCode = normalizeText(filters.taskCode);
  const selectedStatus = normalizeText(filters.status);
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 8;
  const selectedCodes = Array.isArray(input.selectedCodes)
    ? input.selectedCodes.map((code) => normalizeText(code)).filter(Boolean)
    : [];
  const selectedSet = new Set(selectedCodes);
  const preRetentionLocation = normalizeText(labels.preRetentionLocation || labels.retentionLocation);
  const postRetentionLocation = normalizeText(labels.postRetentionLocation);

  const normalizedSamples = normalizeSamplesSnapshot(samples, labels);
  const stagingSamples = normalizedSamples.filter((sample) => {
    // 样品信息中的暂存间只做查看，包含前置暂存间和实验后暂存间。
    const location = normalizeText(sample?.location);
    return location === preRetentionLocation || location === postRetentionLocation;
  });
  const rows = stagingSamples
    .filter((sample) => {
      if (selectedTaskCode && normalizeText(sample?.task_code) !== selectedTaskCode) {
        return false;
      }
      if (selectedStatus && normalizeText(sample?.status) !== selectedStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      const searchText = [
        sample?.code,
        sample?.task_code,
        sample?.location,
        sample?.status,
        sample?.owner,
        sample?.flow_status,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return searchText.includes(query);
    })
    .map((sample) => {
      const trayCodes = getSampleTrayList(sample).map((tray) => normalizeText(tray?.tray_code)).filter(Boolean);
      return {
        ...sample,
        selected: selectedSet.has(normalizeText(sample?.code)),
        statusClass: resolveStatusClass(sample?.status),
        trayCodes,
        trayCodesText: trayCodes.join("、"),
      };
    })
    .sort((left, right) => compareValue(left.code, right.code, "asc"));

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), totalPages) : 1;
  const startIndex = (currentPage - 1) * pageSize;
  const taskOptions = Array.from(new Set(stagingSamples.map((sample) => normalizeText(sample?.task_code)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "zh-Hans-CN"),
  );
  const statusOptions = Array.from(new Set(stagingSamples.map((sample) => normalizeText(sample?.status)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "zh-Hans-CN"),
  );

  return {
    count: rows.length,
    currentPage,
    labOptions: TEST_LAB_OPTIONS.slice(),
    rows: rows.slice(startIndex, startIndex + pageSize),
    statusOptions,
    taskOptions,
    totalCount: rows.length,
    totalPages,
  };
}

// 将选中的暂存样品派发到目标实验室和责任人。
function dispatchStagingSamples(input = {}) {
  const labels = normalizeLabels(input.labels);
  let samples = cloneSampleCollection(input.samples);
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const selectedCodes = Array.isArray(input.selectedCodes) ? input.selectedCodes : [];
  const targetLab = normalizeText(payload.targetLab);
  const owner = normalizeText(payload.owner);
  const preRetentionLocation = normalizeText(labels.preRetentionLocation || labels.retentionLocation);
  const codes = Array.from(new Set([...selectedCodes, ...parseCodeList(payload.codes)].map((code) => normalizeText(code)).filter(Boolean)));

  // 暂存派发要求目标实验室和样品集合都有效。
  if (!targetLab || codes.length === 0) {
    return {
      error: "请填写样品编号并选择目标实验室。",
      samples,
      dispatchedCodes: [],
    };
  }

  const missing = [];
  const notStaging = [];
  const dispatchedCodes = [];
  const now = input.now || new Date().toISOString();
  const trayCodesToSync = new Set();

  codes.forEach((code) => {
    const sample = samples.find((item) => normalizeText(item?.code) === code);
    if (!sample) {
      missing.push(code);
      return;
    }
    if (normalizeText(sample.location) !== preRetentionLocation) {
      notStaging.push(code);
      return;
    }

    // 只有当前位于暂存间的样品才允许派发到正式实验室。
    getSampleTrayList(sample).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (trayCode) {
        trayCodesToSync.add(trayCode);
      }
    });
    sample.location = targetLab;
    sample.owner = owner || normalizeText(sample.owner);
    sample.status = normalizeLifecycleStatus(targetLab, "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4", labels);
    sample.flow_status = sample.status;
    sample.updated_at = now;
    sample.history = appendSampleHistory(sample, "暂存间派发", "", now);
    dispatchedCodes.push(code);
  });

  if (trayCodesToSync.size > 0) {
    const synced = synchronizeSamplesForTrayCodes({
      historyAction: "",
      labels,
      location: targetLab,
      now,
      owner,
      samples,
      status: "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4",
      trayCodes: Array.from(trayCodesToSync),
    });
    samples = synced.samples;
  }

  const warnings = [];
  if (missing.length) {
    warnings.push(`未找到样品：${missing.join("、")}`);
  }
  if (notStaging.length) {
    warnings.push(`不在暂存间：${notStaging.join("、")}`);
  }

  return {
    // 部分成功时会同时返回更新后的样品集合和告警文本。
    error: warnings.length ? `${warnings.join("；")}。` : "",
    samples,
    dispatchedCodes,
  };
}

export {
  SAMPLE_FLOW_STEPS,
  DETAIL_STATUS_OPTIONS,
  buildTrayFlowView,
  buildSamplesFlowView,
  buildSamplesTrayOverviewView,
  buildSamplesStagingView,
  dispatchStagingSamples,
  getSampleTrayList,
  normalizeLifecycleStatus,
  normalizeSampleRecord,
  normalizeSamplesSnapshot,
  resolveFlowStatusByLocation,
  synchronizeSamplesForTrayCodes,
  submitSamplesBatchIntake,
  syncTrayStatusToSampleStatus,
  TRAY_STATUS_OPTIONS,
  updateTrayStatus,
  updateSampleDetail,
};
