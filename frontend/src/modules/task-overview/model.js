import { aggregateTaskStatusFromSamples } from "@/modules/tasks/model";
import { normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";

// 将任务、样品和排程整理为总览卡片和托盘汇总行数据。
const STATUS_WAITING = "待排程";
const STATUS_RETENTION = "厂家收回";
const LEGACY_STATUS_RETENTION = "暂存间排放";
const LEGACY_STATUS_STORAGE = "暂存间存放";
const RETENTION_KEYWORD = "暂存间";
const TASK_COMPLETED_STATUS = "实验已经完成";
const OVERVIEW_COMPLETED_STATUS = "实验完成";

// 任务号、样品号、托盘号的展示排序统一走中文比较规则。
function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");
}

// 统一清洗文本字段，后续所有聚合逻辑都基于规范化后的字符串。
function normalizeText(value) {
  return String(value || "").trim();
}

// 历史状态“暂存间排放/暂存间存放”在总览里统一视为“厂家收回”。
function normalizeStatus(value) {
  const normalized = normalizeText(value);
  if (normalized === LEGACY_STATUS_RETENTION || normalized === LEGACY_STATUS_STORAGE) {
    return STATUS_WAITING;
  }
  if (normalized === STATUS_RETENTION) {
    return STATUS_RETENTION;
  }
  if (normalized === TASK_COMPLETED_STATUS) {
    return OVERVIEW_COMPLETED_STATUS;
  }
  return normalized;
}

// 判断排程设备是否属于暂存间，用于区分正式实验和留样暂存。
function isRetentionDevice(value) {
  return normalizeText(value).includes(RETENTION_KEYWORD);
}

// 托盘数量默认至少记 1，避免空值导致统计为 0。
function normalizeQuantity(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function parseTimeValue(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : -1;
}

function upsertLatestSchedule(map, key, schedule) {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) {
    return;
  }
  const current = map.get(normalizedKey);
  if (!current || schedule.timestamp >= current.timestamp) {
    map.set(normalizedKey, schedule);
  }
}

function resolveExperimentDisplayStatus({ currentStatus, experiment, matchedSchedule, scheduleLabel }) {
  const experimentStatus = normalizeStatus(experiment?.status);
  if (experimentStatus && experimentStatus !== STATUS_WAITING) {
    return experimentStatus;
  }

  const scheduleStatus = normalizeStatus(matchedSchedule?.status);
  if (scheduleStatus && scheduleStatus !== STATUS_WAITING) {
    return scheduleStatus;
  }

  if (matchedSchedule) {
    return scheduleLabel;
  }

  return currentStatus || experimentStatus || STATUS_WAITING;
}

// 构建任务视图模式下展示的任务卡片数据。
function buildTaskRows({
  tasks,
  experiments,
  samples,
  schedules,
  scheduledLabel,
  unscheduledLabel,
}) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const experimentList = Array.isArray(experiments) ? experiments : [];
  const sampleList = Array.isArray(samples) ? samples : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const taskMap = new Map();
  const knownTaskCodes = new Set();
  const experimentsByTaskCode = new Map();
  const formalScheduleByExperimentCode = new Map();

  experimentList.forEach((experiment) => {
    const taskCode = normalizeText(experiment?.task_code);
    if (!taskCode) {
      return;
    }
    const group = experimentsByTaskCode.get(taskCode) || [];
    group.push({
      experimentCode: normalizeText(experiment?.experiment_code),
      experimentName: normalizeText(experiment?.experiment_name) || normalizeText(experiment?.experiment_code),
      requiredDevice: normalizeText(experiment?.required_device),
      status: normalizeStatus(experiment?.status),
    });
    experimentsByTaskCode.set(taskCode, group);
  });

  scheduleList.forEach((entry) => {
    if (isRetentionDevice(entry?.device)) {
      return;
    }
    const schedule = {
      device: normalizeText(entry?.device),
      status: normalizeStatus(entry?.status),
      timestamp: parseTimeValue(entry?.start_at || entry?.created_at),
    };
    upsertLatestSchedule(formalScheduleByExperimentCode, entry?.experiment_code, schedule);
  });

  // 先以任务为主表建初始行，样品和排程后续再补充到对应任务上。
  taskList.forEach((task) => {
    const code = String(task?.code || "").trim();
    if (!code) {
      return;
    }
    knownTaskCodes.add(code);
    const taskExperiments = (experimentsByTaskCode.get(code) || []).slice().sort((left, right) => compareText(left.experimentCode, right.experimentCode));
    taskMap.set(code, {
      taskCode: code,
      taskType: normalizeText(task?.test_type || task?.name),
      taskStatus: normalizeStatus(task?.status),
      plannedCount: Number.isFinite(Number(task?.sample_count)) ? Number(task.sample_count) : "",
      timeValue: normalizeText(task?.arrival_at || task?.created_at || task?.due_at),
      sampleCodes: [],
      trays: [],
      scheduleCount: 0,
      retentionCount: 0,
      experiments: taskExperiments,
      experimentCount: taskExperiments.length || Number.parseInt(task?.experiment_count, 10) || 0,
    });
  });

  sampleList.forEach((sample) => {
    const taskCode = String(sample?.task_code || "").trim();
    const sampleCode = String(sample?.code || "").trim();
    if (!taskCode || !sampleCode || !knownTaskCodes.has(taskCode)) {
      return;
    }
    const row = taskMap.get(taskCode);
    // 一个任务可能对应多个样品编码，后续会在输出阶段去重排序。
    row.sampleCodes.push(sampleCode);
    if (Array.isArray(sample?.trays)) {
      sample.trays.forEach((tray) => {
        const trayCode = String(tray?.tray_code || "").trim();
        if (!trayCode) {
          return;
        }
        row.trays.push({
          trayCode,
          sampleCode,
          status: normalizeLifecycleStatus(sample?.location, tray?.status || sample?.status),
          quantity: normalizeQuantity(tray?.quantity),
        });
      });
    }
  });

  scheduleList.forEach((entry) => {
    const taskCode = String(entry?.task_code || "").trim();
    if (!taskCode || !knownTaskCodes.has(taskCode)) {
      return;
    }
    const row = taskMap.get(taskCode);
    // 暂存间排程单独累计，正式实验排程累计到 scheduleCount。
    if (isRetentionDevice(entry?.device)) {
      row.retentionCount += 1;
    } else {
      row.scheduleCount += 1;
    }
    if (!row.taskStatus) {
      row.taskStatus = normalizeStatus(entry?.status);
    }
    if (!row.timeValue) {
      row.timeValue = normalizeText(entry?.start_at || entry?.created_at);
    }
  });

  return Array.from(taskMap.values())
    .map((row) => {
      // 样品编码先去重再排序，避免同一编码因多托盘重复出现。
      const uniqueSampleCodes = Array.from(new Set(row.sampleCodes)).sort(compareText);
      const trayMap = new Map();
      row.trays.forEach((tray) => {
        if (!trayMap.has(tray.trayCode)) {
          trayMap.set(tray.trayCode, {
            trayCode: tray.trayCode,
            sampleCodes: [],
            status: normalizeLifecycleStatus("", tray.status),
            totalQuantity: 0,
          });
        }
        const current = trayMap.get(tray.trayCode);
        if (!current.sampleCodes.includes(tray.sampleCode)) {
          current.sampleCodes.push(tray.sampleCode);
        }
        current.totalQuantity += normalizeQuantity(tray.quantity);
      });

      // 托盘维度把同 trayCode 的槽位聚合成一条记录，并列出其样品编码。
      const trays = Array.from(trayMap.values())
        .map((item) => ({
          ...item,
          sampleCodes: item.sampleCodes.slice().sort(compareText),
        }))
        .sort((left, right) => compareText(left.trayCode, right.trayCode));

      const scheduleLabel = row.scheduleCount > 0 ? scheduledLabel : unscheduledLabel;
      const aggregatedStatus = normalizeStatus(
        aggregateTaskStatusFromSamples(
          { code: row.taskCode },
          sampleList.filter((sample) => normalizeText(sample?.task_code) === row.taskCode),
        ),
      );
      // 有托盘聚合状态时优先展示，否则再按任务原状态、暂存或排程兜底。
      const currentStatus = aggregatedStatus || row.taskStatus || (row.retentionCount > 0 ? STATUS_RETENTION : scheduleLabel);
      const experiments = row.experiments.map((experiment) => ({
        ...experiment,
        displayStatus: resolveExperimentDisplayStatus({
          currentStatus,
          experiment,
          matchedSchedule: formalScheduleByExperimentCode.get(experiment.experimentCode),
          scheduleLabel,
        }),
      }));
      const experimentSummary = row.experiments
        .map((experiment) => experiment.experimentName)
        .filter(Boolean)
        .join(" / ");

      return {
        ...row,
        currentStatus,
        scheduleLabel,
        sampleCodes: uniqueSampleCodes,
        sampleCount: uniqueSampleCodes.length,
        trays,
        experiments,
        experimentCount: row.experimentCount,
        experimentSummary,
      };
    })
    .sort((left, right) => compareText(left.taskCode, right.taskCode));
}

// 构建托盘视图模式下逐槽位展示的托盘汇总数据。
function buildTrayOverviewRows({
  tasks,
  samples,
  schedules,
  totalSlots,
  scheduledLabel,
  unscheduledLabel,
  unassignedExperimentLabel,
}) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const sampleList = Array.isArray(samples) ? samples : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];

  const taskTypeByCode = new Map();
  // 任务号到试验类型的映射用于给托盘视图补齐目标试验名称。
  taskList.forEach((task) => {
    const code = String(task?.code || "").trim();
    if (!code) {
      return;
    }
    taskTypeByCode.set(code, String(task?.test_type || task?.name || "").trim());
  });

  const scheduleByTaskCode = new Map();
  // 同一任务可能有多次排程，托盘视图保留最近的一次正式实验室分配。
  scheduleList.forEach((entry) => {
    const taskCode = String(entry?.task_code || "").trim();
    if (!taskCode) {
      return;
    }
    if (isRetentionDevice(entry?.device)) {
      return;
    }
    const device = String(entry?.device || "").trim();
    const ts = Date.parse(String(entry?.start_at || entry?.created_at || ""));
    const current = scheduleByTaskCode.get(taskCode);
    const next = { device, ts: Number.isFinite(ts) ? ts : -1 };
    if (!current || next.ts >= current.ts) {
      scheduleByTaskCode.set(taskCode, next);
    }
  });

  const trayMap = new Map();
  sampleList.forEach((sample) => {
    const taskCode = String(sample?.task_code || "").trim();
    if (!taskCode || !taskTypeByCode.has(taskCode)) {
      return;
    }
    const targetExperiment = taskTypeByCode.get(taskCode) || "-";
    const scheduleInfo = scheduleByTaskCode.get(taskCode);
    const isScheduled = Boolean(scheduleInfo);
    const scheduleStatus = isScheduled ? scheduledLabel : unscheduledLabel;
    const lab = scheduleInfo?.device || "";

    (Array.isArray(sample?.trays) ? sample.trays : []).forEach((tray) => {
      const trayCode = String(tray?.tray_code || "").trim();
      // 托盘视图每个托盘只需要一条记录，重复 trayCode 直接跳过。
      if (!trayCode || trayMap.has(trayCode)) {
        return;
      }
      trayMap.set(trayCode, {
        trayCode,
        taskCode,
        targetExperiment,
        isScheduled,
        scheduleStatus,
        lab: isScheduled ? lab || "-" : "-",
      });
    });
  });

  const existingTrays = Array.from(trayMap.values())
    .sort((left, right) => compareText(left.trayCode, right.trayCode))
    .slice(0, totalSlots);

  return Array.from({ length: totalSlots }, (_, index) => {
    const slotCode = `TP-${String(index + 1).padStart(3, "0")}`;
    const tray = existingTrays[index];
    if (tray) {
      // 有实物托盘时，槽位编码与托盘编码分开保留，便于页面同时展示“槽位”和“托盘”。
      return {
        slotCode,
        trayCode: tray.trayCode,
        taskCode: tray.taskCode || "-",
        targetExperiment: tray.targetExperiment || "-",
        isScheduled: tray.isScheduled,
        scheduleStatus: tray.scheduleStatus,
        lab: tray.lab || "-",
      };
    }
    // 空槽位用占位数据补齐，保证页面总是渲染 totalSlots 个槽位。
    return {
      slotCode,
      trayCode: slotCode,
      taskCode: "-",
      targetExperiment: unassignedExperimentLabel,
      isScheduled: false,
      scheduleStatus: unscheduledLabel,
      lab: "-",
    };
  });
}

export { buildTaskRows, buildTrayOverviewRows };
