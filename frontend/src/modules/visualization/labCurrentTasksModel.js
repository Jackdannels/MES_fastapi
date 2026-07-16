import { labIdentityMatches } from "@/lib/labIdentity";
import { parseBusinessDateTimeToMs } from "@/lib/dateTime";
import { serverNowMs } from "@/lib/serverClock";
import { buildDeviceRows } from "@/modules/devices/model";
import { buildLaboratoryWorkbenchView } from "@/modules/laboratory/model";
import { formatDateTime } from "@/modules/schedule/sharedModel";

const URGENT_REMAINING_SECONDS = 30 * 60;
const COMPLETED_STATUS_TEXTS = new Set(["实验已完成", "实验完成", "实验已经完成", "已完成"]);
const NON_EXPERIMENT_ROOM_KEYWORDS = ["暂存间", "外观检测间", "接驳"];

const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeText = (value) => String(value ?? "").trim();
const parseTime = (value) => {
  const text = normalizeText(value);
  if (!text) {
    return NaN;
  }
  const time = parseBusinessDateTimeToMs(text);
  return Number.isFinite(time) ? time : NaN;
};

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(value)));
const statusIsCompleted = (value) => COMPLETED_STATUS_TEXTS.has(normalizeText(value));
const isExperimentRoomName = (value) => {
  const text = normalizeText(value);
  return Boolean(text) && !NON_EXPERIMENT_ROOM_KEYWORDS.some((keyword) => text.includes(keyword));
};
const deviceIdentities = (device) =>
  [device?.code, device?.name, device?.location].map(normalizeText).filter(Boolean);
const buildExcludedRoomIdentitySet = (devices) => {
  const excluded = new Set();
  asArray(devices).forEach((device) => {
    const identities = deviceIdentities(device);
    if (identities.some((identity) => !isExperimentRoomName(identity))) {
      identities.forEach((identity) => excluded.add(identity));
    }
  });
  return excluded;
};
const resolveDeviceIssueTone = (...values) => {
  const text = values.map(normalizeText).filter(Boolean).join(" ");
  if (text.includes("保养")) {
    return "upkeep";
  }
  if (
    text.includes("故障")
    || text.includes("维修")
    || text.includes("停用")
    || text.includes("不可用")
  ) {
    return "repair";
  }
  return "";
};
const statusIsRepair = (value) => {
  const text = normalizeText(value);
  return text.includes("故障")
    || text.includes("维修")
    || text.includes("保养")
    || text.includes("停用")
    || text.includes("不可用");
};

const labRefFromName = (labName) => ({ code: normalizeText(labName), name: normalizeText(labName) });
const recordMatchesLab = (record, labRef) => labIdentityMatches(record, labRef);
const makeExperimentKey = (taskCode, experimentCode) => `${normalizeText(taskCode)}::${normalizeText(experimentCode)}`;
const resolveDisplayDateTime = (label, value) => normalizeText(label) || formatDateTime(value) || normalizeText(value) || "-";
const buildPlanTimeLabel = (startAt, endAt) => {
  if (startAt === "-" && endAt === "-") {
    return "-";
  }
  return `${startAt} - ${endAt}`;
};

const buildTaskByCode = (tasks) => {
  const map = new Map();
  asArray(tasks).forEach((task) => {
    const code = normalizeText(task?.code || task?.task_code);
    if (code) {
      map.set(code, task);
    }
  });
  return map;
};

const buildExperimentByKey = (experiments) => {
  const map = new Map();
  asArray(experiments).forEach((experiment) => {
    const taskCode = normalizeText(experiment?.task_code);
    const experimentCode = normalizeText(experiment?.experiment_code);
    if (taskCode && experimentCode) {
      map.set(makeExperimentKey(taskCode, experimentCode), experiment);
    }
  });
  return map;
};

const findDeviceRowForLab = (deviceRows, labName) => {
  const lab = normalizeText(labName);
  return asArray(deviceRows).find((device) =>
    normalizeText(device?.code) === lab
    || normalizeText(device?.name) === lab
    || normalizeText(device?.location) === lab,
  ) || null;
};
const findRawDeviceForLab = (devices, labName) => {
  const lab = normalizeText(labName);
  return asArray(devices).find((device) =>
    normalizeText(device?.code) === lab
    || normalizeText(device?.name) === lab
    || normalizeText(device?.location) === lab,
  ) || null;
};

const findLatestCompletedSchedule = ({ experiments, schedules, taskByCode, experimentByKey, labRef }) => {
  const rows = asArray(schedules)
    .filter((schedule) => recordMatchesLab(schedule, labRef))
    .map((schedule) => {
      const taskCode = normalizeText(schedule?.task_code);
      const experimentCode = normalizeText(schedule?.experiment_code);
      const experiment = experimentByKey.get(makeExperimentKey(taskCode, experimentCode)) || null;
      const completed =
        statusIsCompleted(schedule?.status)
        || statusIsCompleted(schedule?.displayStatus)
        || statusIsCompleted(experiment?.status);
      if (!completed) {
        return null;
      }
      const task = taskByCode.get(taskCode) || null;
      const finishedAt = parseTime(schedule?.actual_end_at || schedule?.actualEndAt || schedule?.end_at || schedule?.endAt);
      const startAt = schedule?.start_at || schedule?.startAt;
      const endAt = schedule?.actual_end_at || schedule?.actualEndAt || schedule?.end_at || schedule?.endAt;
      return {
        endAt,
        experimentCode,
        experimentName:
          normalizeText(experiment?.experiment_name)
          || normalizeText(schedule?.experiment_name)
          || normalizeText(task?.test_type)
          || "-",
        finishedAt: Number.isFinite(finishedAt) ? finishedAt : 0,
        sampleCount: 0,
        startAt,
        status: "实验已完成",
        taskCode,
        taskName: normalizeText(task?.name) || taskCode || "-",
        trayCodes: [],
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.finishedAt - left.finishedAt);
  return rows[0] || null;
};

const buildCountdown = (runningExperiment) => {
  if (!runningExperiment?.active) {
    return { active: false, progressPercent: 0, remainingLabel: "" };
  }
  const startTime = Number(runningExperiment.startTime);
  const endTime = Number(runningExperiment.endTime);
  const remainingSeconds = Number(runningExperiment.remainingSeconds) || 0;
  const duration = Number.isFinite(startTime) && Number.isFinite(endTime) ? Math.max(0, endTime - startTime) : 0;
  const elapsed = duration > 0 ? duration - Math.max(0, remainingSeconds * 1000) : 0;
  return {
    active: true,
    progressPercent: duration > 0 ? clampPercent((elapsed / duration) * 100) : 0,
    remainingLabel: runningExperiment.countdownLabel || "",
  };
};

const formatUrgentMinutes = (remainingSeconds) => {
  if (remainingSeconds <= 0) {
    return "已完成";
  }
  return `${Math.ceil(remainingSeconds / 60)} 分钟`;
};

const trayCodesFromRows = (rows) => asArray(rows)
  .map((row) => normalizeText(row?.trayCode || row?.tray_code))
  .filter(Boolean);
const sampleCountFromTrayRow = (row) => {
  const sampleCodes = asArray(row?.sampleCodes || row?.sample_codes);
  const quantity = Number(row?.quantity);
  return Math.max(1, sampleCodes.length || (Number.isFinite(quantity) ? quantity : 0));
};
const sampleCountFromRows = (rows) => asArray(rows).reduce((count, row) => {
  return count + sampleCountFromTrayRow(row);
}, 0);
const trayItemsFromRows = (rows) => asArray(rows)
  .map((row) => {
    const trayCode = normalizeText(row?.trayCode || row?.tray_code);
    if (!trayCode) {
      return null;
    }
    const sampleCount = sampleCountFromTrayRow(row);
    return {
      sampleCount,
      sampleLabel: `${sampleCount}件`,
      trayCode,
    };
  })
  .filter(Boolean);
const trayItemsFromCodes = (trayCodes, sampleCount) => {
  const codes = asArray(trayCodes).map(normalizeText).filter(Boolean);
  const total = Number(sampleCount) || 0;
  return codes.map((trayCode, index) => {
    const count = codes.length === 1 ? total : 0;
    return {
      sampleCount: count,
      sampleLabel: count > 0 ? `${count}件` : "-",
      trayCode,
      order: index,
    };
  });
};

const buildLabCard = ({ deviceRow, experimentByKey, labName, now, rawDevice, snapshot, taskByCode }) => {
  const labRef = labRefFromName(labName);
  const workbench = buildLaboratoryWorkbenchView({
    tasks: snapshot.tasks,
    schedules: snapshot.schedules,
    experiments: snapshot.experiments,
    experimentRuns: snapshot.experimentRuns,
    experimentRunSteps: snapshot.experimentRunSteps,
    experimentRunTrays: snapshot.experimentRunTrays,
    experimentTrays: snapshot.experimentTrays,
    samples: snapshot.samples,
    now,
    labName,
    labCode: normalizeText(deviceRow?.code),
  });
  const currentTask = workbench.currentTask;
  const completedTask = currentTask ? null : findLatestCompletedSchedule({
    experiments: snapshot.experiments,
    schedules: snapshot.schedules,
    taskByCode,
    experimentByKey,
    labRef,
  });
  const displayTask = currentTask || completedTask;
  const countdown = buildCountdown(workbench.runningExperiment);
  const displayTrayRows = countdown.active
    ? asArray(workbench.runningExperiment?.trayRows)
    : asArray(displayTask?.trayRows);
  const displayTrayCodes = displayTrayRows.length > 0
    ? trayCodesFromRows(displayTrayRows)
    : asArray(displayTask?.trayCodes);
  const displaySampleCount = displayTrayRows.length > 0
    ? sampleCountFromRows(displayTrayRows)
    : Number(displayTask?.sampleCount) || 0;
  const trayItems = displayTrayRows.length > 0
    ? trayItemsFromRows(displayTrayRows)
    : trayItemsFromCodes(displayTrayCodes, displaySampleCount);
  const remainingSeconds = Number(workbench.runningExperiment?.remainingSeconds) || 0;
  const isUrgentRunning = countdown.active && remainingSeconds <= URGENT_REMAINING_SECONDS;
  const isCompleted = Boolean(completedTask) || statusIsCompleted(currentTask?.status);
  const issueTone = resolveDeviceIssueTone(rawDevice?.status, deviceRow?.status, deviceRow?.safetyStatus);
  const repair = Boolean(issueTone) || statusIsRepair(deviceRow?.status) || statusIsRepair(deviceRow?.safetyStatus);
  const taskCode = normalizeText(displayTask?.taskCode);
  const statusTone = repair
    ? issueTone || "repair"
    : isCompleted
      ? "completed"
      : countdown.active || normalizeText(deviceRow?.status) === "工作中"
        ? "running"
        : taskCode
          ? "scheduled"
          : "unplanned";
  const statusLabel = repair
    ? issueTone === "upkeep" ? "保养" : "维修"
    : isCompleted
      ? "实验已完成"
      : countdown.active
        ? "实验进行中"
        : taskCode
          ? "已排程"
          : "未排程";
  const startAt = resolveDisplayDateTime(displayTask?.startDateTimeLabel, displayTask?.startAt);
  const endAt = resolveDisplayDateTime(displayTask?.endDateTimeLabel, displayTask?.endAt);

  return {
    countdown,
    deviceStatus: normalizeText(deviceRow?.status) || "-",
    endAt,
    experimentName: normalizeText(displayTask?.experimentName) || "-",
    labName,
    planTimeLabel: buildPlanTimeLabel(startAt, endAt),
    sampleCount: displaySampleCount,
    shouldBlink: isUrgentRunning,
    startAt,
    stageLabel: statusLabel,
    statusLabel,
    statusTone,
    taskCode: taskCode || "-",
    taskName: normalizeText(displayTask?.taskName) || "-",
    trayCodes: displayTrayCodes,
    trayCount: trayItems.length || displayTrayCodes.length,
    trayItems,
    traySummaryLabel: `托盘 ${trayItems.length || displayTrayCodes.length}，样品 ${displaySampleCount}`,
  };
};

function buildLabCurrentTaskMatrixView(input = {}) {
  const excludedRoomIdentities = buildExcludedRoomIdentitySet(input.devices);
  const labNames = asArray(input.labNames)
    .map((lab) => normalizeText(lab?.name || lab?.code || lab))
    .filter((labName) => isExperimentRoomName(labName) && !excludedRoomIdentities.has(labName));
  const now = input.now instanceof Date ? input.now : new Date(parseTime(input.now) || serverNowMs());
  const snapshot = {
    devices: asArray(input.devices),
    experimentRuns: asArray(input.experimentRuns || input.experiment_runs),
    experimentRunSteps: asArray(input.experimentRunSteps || input.experiment_run_steps),
    experimentRunTrays: asArray(input.experimentRunTrays || input.experiment_run_trays),
    experimentTrays: asArray(input.experimentTrays || input.experiment_trays),
    experiments: asArray(input.experiments),
    samples: asArray(input.samples),
    schedules: asArray(input.schedules),
    tasks: asArray(input.tasks),
  };
  const deviceRows = buildDeviceRows(
    snapshot.devices,
    snapshot.schedules,
    now,
    snapshot.samples,
    snapshot.experimentTrays,
    snapshot.experimentRuns,
  );
  const taskByCode = buildTaskByCode(snapshot.tasks);
  const experimentByKey = buildExperimentByKey(snapshot.experiments);
  const labs = labNames.map((labName) => buildLabCard({
    deviceRow: findDeviceRowForLab(deviceRows, labName),
    experimentByKey,
    labName,
    now,
    rawDevice: findRawDeviceForLab(snapshot.devices, labName),
    snapshot,
    taskByCode,
  }));
  const counts = labs.reduce(
    (summary, lab) => {
      summary.total += 1;
      if (lab.statusTone === "unplanned") summary.unplanned += 1;
      if (lab.statusTone === "scheduled") summary.scheduled += 1;
      if (lab.statusTone === "repair") summary.repair += 1;
      if (lab.statusTone === "upkeep") summary.upkeep += 1;
      if (lab.statusTone === "running") summary.running += 1;
      if (lab.statusTone === "completed") summary.completed += 1;
      return summary;
    },
    { completed: 0, repair: 0, running: 0, scheduled: 0, total: 0, unplanned: 0, upkeep: 0 },
  );

  return {
    counts,
    labs,
  };
}

export { buildLabCurrentTaskMatrixView };
