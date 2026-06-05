import { aggregateTaskStatusFromSamples } from "@/modules/tasks/model";
import { experimentScopeIsTerminal } from "@/modules/experiment-progress/model";
import {
  EXPERIMENT_STATUS_COMPLETED,
  EXPERIMENT_STATUS_RUNNING as STATUS_RUNNING,
  RETURNED_STATUS,
  isExperimentCompletedStatus,
  isExperimentRunningStatus,
  normalizeExperimentStatusLabel,
} from "@/lib/statusNormalization";

// 根据当前排程状态生成过程管控页的实验室卡片和跳转目标。
const PROCESS_LABS = [
  { name: "冲击一室", testType: "冲击试验" },
  { name: "冲击二室", testType: "冲击试验" },
  { name: "振动一室", testType: "振动试验" },
  { name: "振动二室", testType: "振动试验" },
  { name: "四综合实验室", testType: "四综合试验" },
  { name: "温度冲击一室", testType: "温度冲击试验" },
  { name: "温度冲击二室", testType: "温度冲击试验" },
  { name: "高低温湿热一室", testType: "高低温湿热试验" },
  { name: "盐雾试验室", testType: "盐雾试验" },
  { name: "霉菌试验室", testType: "霉菌试验" },
];

// 中文名称排序时统一使用简体中文排序规则。
const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");
const STATUS_SCHEDULED = "已排程";
const STATUS_READY = "实验准备就绪";
const TASK_STATUS_RUNNING = "任务进行中";
const TASK_STATUS_COMPLETED = "任务已完成";
const STATUS_IDLE = "空闲";
const STATUS_MAINTENANCE = "维护/校准";
const COMPLETED_TRAY_STATUSES = new Set([EXPERIMENT_STATUS_COMPLETED, "放置实验后暂存间", RETURNED_STATUS]);
const normalizeText = (value) => String(value || "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const isDeviceUnavailable = (device) => {
  const status = normalizeText(device?.status);
  return status.includes("维护") || status.includes("维修") || status.includes("停用") || status.includes("禁用") || status.includes("不可用");
};
const findDeviceByLabName = (devices, labName) =>
  asArray(devices).find((device) => normalizeText(device?.code) === normalizeText(labName) || normalizeText(device?.name) === normalizeText(labName));
const resolveTaskCode = (entry) => normalizeText(entry?.task_code || entry?.taskCode || entry?.task_no || entry?.taskNo || entry?.code);
const resolveExperimentCode = (entry) => normalizeText(entry?.experiment_code || entry?.experimentCode || entry?.experiment_no || entry?.experimentNo || entry?.code);
const resolveTrayCode = (entry) => normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo || entry?.code);
const resolveRunStatus = (entry) => normalizeText(entry?.run_tray_status || entry?.runTrayStatus || entry?.status || entry?.state);

// 过程卡片只展示月/日 + 时:分，因此在这里统一格式化。
const formatDateTime = (value) => {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) {
    return "-";
  }
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hours}:${minutes}`;
};

const scheduleIsActiveAt = (schedule, now) => {
  const start = Date.parse(String(schedule?.start_at || ""));
  if (!Number.isFinite(start) || start > now) {
    return false;
  }
  const end = Date.parse(String(schedule?.end_at || ""));
  return !Number.isFinite(end) || end >= now;
};

const resolveScheduledExperimentLabel = ({ experiments, fallback, schedule, taskCode }) => {
  const normalizedExperimentCode = String(schedule?.experiment_code || "").trim();
  const experimentList = Array.isArray(experiments) ? experiments : [];
  const matchedExperiment = experimentList.find(
    (experiment) =>
      String(experiment?.task_code || "").trim() === String(taskCode || "").trim()
      && String(experiment?.experiment_code || "").trim() === normalizedExperimentCode
  );
  const experimentName = String(matchedExperiment?.experiment_name || "").trim();
  if (experimentName) {
    return experimentName;
  }
  const fallbackText = String(fallback || "").trim();
  return fallbackText || "-";
};

// 构建过程管控页展示的实验室卡片集合。
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

const buildExperimentTrayCodeSet = ({ experimentTrays, experimentCode, taskCode }) =>
  new Set(
    asArray(experimentTrays)
      .filter(
        (entry) =>
          resolveTaskCode(entry) === taskCode
          && resolveExperimentCode(entry) === experimentCode
      )
      .map(resolveTrayCode)
      .filter(Boolean)
  );

const buildTrayExperimentCodeMap = (experimentTrays) => {
  const trayMap = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const taskCode = resolveTaskCode(entry);
    const trayCode = resolveTrayCode(entry);
    const experimentCode = resolveExperimentCode(entry);
    if (!taskCode || !trayCode || !experimentCode) {
      return;
    }
    const key = `${taskCode}::${trayCode}`;
    const current = trayMap.get(key) || new Set();
    current.add(experimentCode);
    trayMap.set(key, current);
  });
  return trayMap;
};

const experimentHistoryEntryMatches = ({ entry, experimentCode, experimentName, taskCode }) => {
  const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
  if (parsed && normalizeText(parsed.experimentName) === normalizeText(experimentName)) {
    return parsed;
  }
  const entryExperimentCode = normalizeText(entry?.experiment_code || entry?.experimentCode);
  if (experimentCode && entryExperimentCode === experimentCode) {
    return {
      experimentName: normalizeText(experimentName) || entryExperimentCode,
      status: normalizeText(entry?.status),
    };
  }
  return null;
};

const collectScheduleSamples = ({ experimentTrays, samples, schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scopedTrayCodes = buildExperimentTrayCodeSet({ experimentTrays, experimentCode, taskCode });
  const matchedSamples = asArray(samples).filter((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
    }
    if (!scopedTrayCodes.size) {
      return true;
    }
    return asArray(sample?.trays).some((tray) => scopedTrayCodes.has(normalizeText(tray?.tray_code)));
  });

  return {
    experimentCode,
    matchedSamples,
    scopedTrayCodes,
    taskCode,
  };
};

const scheduleExperimentIsCompleted = ({ experiments, experimentRunTrays = [], experimentTrays, samples, schedule, taskStatusMap }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  if (!taskCode) {
    return false;
  }

  if (!experimentCode) {
    return taskStatusMap.get(taskCode) === TASK_STATUS_COMPLETED;
  }

  const matchedExperiment = asArray(experiments).find(
    (experiment) =>
      normalizeText(experiment?.task_code) === taskCode
      && normalizeText(experiment?.experiment_code) === experimentCode
  );
  const { matchedSamples, scopedTrayCodes } = collectScheduleSamples({ experimentTrays, samples, schedule });
  if (isExperimentCompletedStatus(matchedExperiment?.status) && scopedTrayCodes.size === 0) {
    return true;
  }
  if (!matchedSamples.length) {
    return false;
  }
  if (experimentScopeIsTerminal({
    experiments,
    experimentCode,
    experimentRunTrays,
    experimentTrays,
    samples,
    taskCode,
  })) {
    return true;
  }

  const experimentName = normalizeText(matchedExperiment?.experiment_name);
  if (experimentName) {
    const latestHistoryByTray = new Map();
    matchedSamples.forEach((sample) => {
      const sampleTrayCodes = asArray(sample?.trays)
        .map((tray) => normalizeText(tray?.tray_code))
        .filter((trayCode) => !scopedTrayCodes.size || scopedTrayCodes.has(trayCode));
      asArray(sample?.history).forEach((entry) => {
        const parsed = experimentHistoryEntryMatches({ entry, experimentCode, experimentName, taskCode });
        if (!parsed) {
          return;
        }
        const eventTime = Date.parse(String(entry?.time || "")) || 0;
        const detailText = normalizeText(entry?.detail);
        const matchedTrayCodes = sampleTrayCodes.filter((trayCode) => !detailText || detailText.includes(trayCode));
        const targetTrayCodes = matchedTrayCodes.length ? matchedTrayCodes : sampleTrayCodes;
        targetTrayCodes.forEach((trayCode) => {
          const existing = latestHistoryByTray.get(trayCode);
          if (!existing || eventTime >= existing.time) {
            latestHistoryByTray.set(trayCode, { status: parsed.status, time: eventTime });
          }
        });
      });
    });

    if (latestHistoryByTray.size > 0) {
      const requiredTrayCodes = scopedTrayCodes.size ? Array.from(scopedTrayCodes) : Array.from(latestHistoryByTray.keys());
      return (
        requiredTrayCodes.length > 0
        && requiredTrayCodes.every((trayCode) => COMPLETED_TRAY_STATUSES.has(normalizeExperimentStatusLabel(latestHistoryByTray.get(trayCode)?.status)))
      );
    }
  }

  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const hasSharedScopedTray = Array.from(scopedTrayCodes).some((trayCode) => (trayExperimentCodeMap.get(`${taskCode}::${trayCode}`)?.size || 0) > 1);
  if (experimentCode && hasSharedScopedTray) {
    return false;
  }

  const statuses = [];
  matchedSamples.forEach((sample) => {
    const sampleTrays = asArray(sample?.trays);
    if (!sampleTrays.length && !scopedTrayCodes.size) {
      const sampleStatus = normalizeText(sample?.status);
      if (sampleStatus) {
        statuses.push(sampleStatus);
      }
      return;
    }
    sampleTrays.forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (scopedTrayCodes.size && !scopedTrayCodes.has(trayCode)) {
        return;
      }
      const status = normalizeText(tray?.status) || normalizeText(sample?.status);
      if (status) {
        statuses.push(status);
      }
    });
  });

  return statuses.length > 0 && statuses.every((status) => COMPLETED_TRAY_STATUSES.has(normalizeExperimentStatusLabel(status)));
};

const experimentHasRunningTrays = ({ experimentRuns = [], experimentRunTrays = [], experimentTrays = [], schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const labName = normalizeText(schedule?.device);
  if (!taskCode) {
    return false;
  }

  const scopedTrayCodes = new Set(
    asArray(experimentTrays)
      .filter(
        (entry) =>
          resolveTaskCode(entry) === taskCode
          && resolveExperimentCode(entry) === experimentCode
      )
      .map(resolveTrayCode)
      .filter(Boolean)
  );

  const matchesTaskExperiment = (entry) =>
    resolveTaskCode(entry) === taskCode
    && (!experimentCode || resolveExperimentCode(entry) === experimentCode);

  const hasRunningRunTray = asArray(experimentRunTrays).some((entry) =>
    matchesTaskExperiment(entry)
    && isExperimentRunningStatus(resolveRunStatus(entry))
    && (!scopedTrayCodes.size || scopedTrayCodes.has(resolveTrayCode(entry)))
  );
  if (hasRunningRunTray) {
    return true;
  }

  return asArray(experimentRuns).some((run) => {
    if (!matchesTaskExperiment(run) || !isExperimentRunningStatus(resolveRunStatus(run))) {
      return false;
    }
    const runLabName = normalizeText(run?.device || run?.lab || run?.labName);
    if (labName && runLabName && runLabName !== labName) {
      return false;
    }
    const runTrayCodes = asArray(run?.tray_codes || run?.trayCodes).map(normalizeText).filter(Boolean);
    return !scopedTrayCodes.size || runTrayCodes.some((trayCode) => scopedTrayCodes.has(trayCode));
  });
};

const experimentHasReadyTrays = ({ schedule, experimentTrays, samples }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const labName = normalizeText(schedule?.device);
  if (!taskCode) {
    return false;
  }

  const scopedTrayCodes = buildExperimentTrayCodeSet({ experimentTrays, experimentCode, taskCode });
  if (experimentCode && !scopedTrayCodes.size) {
    return false;
  }

  return asArray(samples).some((sample) =>
    normalizeText(sample?.task_code) === taskCode
    && (!labName || !normalizeText(sample?.location) || normalizeText(sample?.location) === labName)
    && asArray(sample?.trays).some((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (scopedTrayCodes.size && !scopedTrayCodes.has(trayCode)) {
        return false;
      }
      return normalizeText(tray?.status) === STATUS_READY || normalizeText(sample?.status) === STATUS_READY;
    })
  );
};

const buildProcessLabCards = (
  labs,
  tasks,
  schedules,
  samplesOrNow,
  nowMaybe,
  experiments = [],
  experimentTrays = [],
  devices = [],
  experimentRuns = [],
  experimentRunTrays = [],
) => {
  const sampleList = Array.isArray(samplesOrNow) ? samplesOrNow : [];
  const now = Array.isArray(samplesOrNow) ? (Number.isFinite(nowMaybe) ? nowMaybe : Date.now()) : samplesOrNow ?? Date.now();
  const labList = Array.isArray(labs) ? labs : [];
  const taskList = Array.isArray(tasks) ? tasks : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const taskMap = new Map();
  const taskStatusMap = new Map();

  // 先把任务按任务号建索引，后续排程关联时可 O(1) 查找任务信息。
  taskList.forEach((task) => {
    const code = String(task?.code || "").trim();
    if (!code) {
      return;
    }
    taskMap.set(code, task);
    taskStatusMap.set(
      code,
      aggregateTaskStatusFromSamples(
        task,
        sampleList.filter((sample) => String(sample?.task_code || "").trim() === code),
      ),
    );
  });

  return labList
    .map((lab) => {
      // 每个实验室只关注绑定到该实验室的排程，并优先看最近开始的记录。
      const labSchedules = scheduleList
        .filter((entry) => String(entry?.device || "").trim() === lab.name)
        .filter(
          (entry) =>
            !scheduleExperimentIsCompleted({
              experiments,
              experimentRunTrays,
              experimentTrays,
              samples: sampleList,
              schedule: entry,
              taskStatusMap,
            })
        )
        .sort((left, right) => Date.parse(String(right?.start_at || "")) - Date.parse(String(left?.start_at || "")));

      // 当前命中排程窗口只说明已进入执行时段，不能自动说明已经开始实验。
      const runningSchedule =
        labSchedules.find((entry) => {
          if (experimentHasRunningTrays({ experimentRuns, experimentRunTrays, experimentTrays, schedule: entry })) {
            return true;
          }
          const experimentCode = normalizeText(entry?.experiment_code);
          if (experimentCode) {
            return false;
          }
          return taskStatusMap.get(normalizeText(entry?.task_code)) === TASK_STATUS_RUNNING;
        }) || null;
      const activeSchedule =
        labSchedules.find((entry) => scheduleIsActiveAt(entry, now)) || null;
      const readySchedule =
        labSchedules.find((entry) => experimentHasReadyTrays({ experimentTrays, samples: sampleList, schedule: entry })) || null;

      // 没有进行中的情况下，展示最近的未来排程。
      const upcomingSchedule =
        labSchedules.find((entry) => {
          const start = Date.parse(String(entry?.start_at || ""));
          return Number.isFinite(start) && start > now;
        }) || null;
      const nextSchedule = runningSchedule || activeSchedule || readySchedule || upcomingSchedule || null;

      const taskCode = String(nextSchedule?.task_code || "").trim();
      const task = taskMap.get(taskCode);
      const aggregatedTaskStatus = taskStatusMap.get(taskCode) || "";
      // 目标试验名称优先取任务配置，其次回退到实验室默认试验类型。
      const targetExperiment = resolveScheduledExperimentLabel({
        experiments,
        fallback: String(task?.test_type || task?.name || lab.testType || "").trim(),
        schedule: nextSchedule,
        taskCode,
      });

      const device = findDeviceByLabName(devices, lab.name);
      const deviceUnavailable = isDeviceUnavailable(device);
      let status = STATUS_IDLE;
      let statusClass = "is-idle";
      if (runningSchedule || (!normalizeText(nextSchedule?.experiment_code) && aggregatedTaskStatus === TASK_STATUS_RUNNING)) {
        status = STATUS_RUNNING;
        statusClass = "is-running";
      } else if (deviceUnavailable) {
        status = normalizeText(device?.status) || STATUS_MAINTENANCE;
        statusClass = "is-maintenance";
      } else if (activeSchedule || readySchedule || upcomingSchedule) {
        status = STATUS_SCHEDULED;
        statusClass = "is-scheduled";
      }

      return {
        experimentCode: String(nextSchedule?.experiment_code || "").trim(),
        name: lab.name,
        scheduleTime: nextSchedule
          ? `${formatDateTime(nextSchedule.start_at)} - ${formatDateTime(nextSchedule.end_at)}`
          : "暂无排程",
        hasTask: Boolean(taskCode),
        canStartExperiment: !deviceUnavailable,
        startDisabledReason: deviceUnavailable ? "设备维护中，禁止开始实验" : "",
        status,
        statusClass,
        targetExperiment: taskCode ? targetExperiment : "未分配",
        taskCode: taskCode || "-",
        testType: lab.testType,
      };
    })
    .sort((left, right) => compareText(left.name, right.name));
};

// 统一生成跳往任务总览页的查询参数，避免页面侧重复拼接路由。
const buildTaskOverviewPath = ({ taskCode, testType } = {}) => {
  const params = new URLSearchParams();
  const safeTestType = String(testType || "").trim();
  const safeTaskCode = String(taskCode || "").trim();

  if (safeTestType) {
    params.set("testType", safeTestType);
  }
  if (safeTaskCode && safeTaskCode !== "-") {
    params.set("task", safeTaskCode);
  }

  const query = params.toString();
  return query ? `/task-overview?${query}` : "/task-overview";
};

export { PROCESS_LABS, buildProcessLabCards, buildTaskOverviewPath, scheduleExperimentIsCompleted };
