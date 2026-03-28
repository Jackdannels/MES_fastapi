// 提供排程页所需的表单、看板行、甘特数据和增删改辅助函数。
import { getLabsForTestType, TEST_LABS } from "@/lib/labs.js";

const STATUS_WAITING = "待排程";
const STATUS_SCHEDULED = "已排程";
const STATUS_RUNNING = "实验中";
const STATUS_COMPLETED = "实验已完成";
const STATUS_RETENTION = "暂存间存放";
const STREAMING_STATUS = "Streaming";
const RETENTION_DEVICE = "恒温恒湿间（暂存间）";
const RETENTION_KEYWORD = "暂存间";
const SLOT_RANGES = Object.freeze({
  morning: { start: "08:00", end: "12:00", label: "上午 08:00-12:00" },
  afternoon: { start: "12:00", end: "18:00", label: "下午 12:00-18:00" },
});

// 排程模块的大部分判断都依赖稳定字符串，因此先做统一规范化。
const normalizeText = (value) => String(value ?? "").trim();

const buildExperimentLabel = (experimentCode) => {
  const code = normalizeText(experimentCode);
  if (!code) {
    return "";
  }
  const suffix = code.split("-").at(-1) || code;
  return `${suffix}实验`;
};

const buildFallbackExperimentsForTask = (task) => {
  const taskCode = normalizeText(task?.code);
  if (!taskCode) {
    return [];
  }
  const experimentName = normalizeText(task?.test_type) || normalizeText(task?.required_device) || buildExperimentLabel(taskCode);
  const experimentCodes = Array.isArray(task?.experiment_codes)
    ? task.experiment_codes.map((code) => normalizeText(code)).filter(Boolean)
    : [];
  const codes = experimentCodes.length > 0 ? experimentCodes : [`${taskCode}-A`];

  return codes.map((experimentCode) => ({
    experiment_code: experimentCode,
    experiment_name: experimentName,
    required_device: normalizeText(task?.test_type),
    task_code: taskCode,
  }));
};

const buildExperimentCandidates = ({ taskCode, experiments, tasks }) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const experimentList = Array.isArray(experiments) ? experiments : [];
  const explicitExperiments = experimentList.filter(
    (experiment) =>
      !normalizedTaskCode || normalizeText(experiment?.task_code) === normalizedTaskCode,
  );
  if (explicitExperiments.length > 0) {
    return explicitExperiments;
  }

  const taskList = Array.isArray(tasks) ? tasks : [];
  if (normalizedTaskCode) {
    const task = taskList.find((entry) => normalizeText(entry?.code) === normalizedTaskCode);
    return task ? buildFallbackExperimentsForTask(task) : [];
  }

  return taskList.flatMap((task) => buildFallbackExperimentsForTask(task));
};

// 暂存间是特殊设备类型，很多冲突和状态判断都要排除它。
const isRetentionDevice = (value) => normalizeText(value).includes(RETENTION_KEYWORD);

// 输入可能来自 ISO 字符串、空值或 Date 实例，统一在这里做容错解析。
const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// 把 Date 对象格式化成日期输入框可直接消费的 yyyy-MM-dd。
const toLocalDateValue = (date) => {
  const source = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (Number.isNaN(source.getTime())) {
    return "";
  }
  const year = source.getFullYear();
  const month = String(source.getMonth() + 1).padStart(2, "0");
  const day = String(source.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// 从日期对象中提取 HH:mm，供时间输入框和展示逻辑复用。
const toLocalTimeValue = (value) => {
  const date = parseDate(value);
  if (!date) {
    return "";
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

// 排程表格统一展示 yyyy-MM-dd HH:mm 格式。
const formatDateTime = (value) => {
  const date = parseDate(value);
  if (!date) {
    return "";
  }
  return `${toLocalDateValue(date)} ${toLocalTimeValue(date)}`;
};

// 甘特图和默认排程窗口经常需要按天偏移。
const addDays = (date, days) => {
  const nextDate = new Date(date.getTime());
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

// 判断两个时间区间是否重叠，是冲突检测和甘特图命中的基础工具。
const overlaps = (startA, endA, startB, endB) => startA < endB && endA > startB;

// 新增排程、流记录等前端实体时使用轻量级本地 ID。
const createId = (prefix) => {
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${Date.now()}-${random}`;
};

const SLOT_SEQUENCE = ["am", "pm"];
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

// 计划时长以 0.5 小时为最小粒度，其他输入都会归一化到这个精度。
const parsePlannedHours = (value) => {
  const rawValue = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  const normalized = Math.round(rawValue * 2) / 2;
  return normalized >= 0.5 ? normalized : null;
};

// 如果没有显式填写计划时长，则从开始/结束时间反推。
const inferPlannedHours = (startAt, endAt) => {
  if (!startAt || !endAt) {
    return 3.5;
  }
  const hours = (endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60);
  return parsePlannedHours(hours) || 3.5;
};

// 甘特图里的时间段会根据当前时刻区分为进行中、已完成或忙碌。
const getSlotState = ({ startAt, endAt, now }) => {
  if (startAt && endAt) {
    if (endAt < now) {
      return { state: "completed", className: "gantt-slot busy completed" };
    }
    if (startAt <= now && endAt >= now) {
      return { state: "running", className: "gantt-slot busy running" };
    }
  }
  return { state: "busy", className: "gantt-slot busy" };
};

// 计算视图窗口需要覆盖多少天，以便甘特图自动延展。
const getDaySpan = (startDate, endDate) => {
  const startValue = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
  const endValue = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
  return Math.floor((endValue - startValue) / (24 * 60 * 60 * 1000));
};

// 手动排程默认落在“当前时刻之后最近一个合法时段”。
const resolveLegalManualScheduleState = (now = new Date()) => {
  const current = parseDate(now) || new Date();
  const currentHour = current.getHours();

  if (currentHour < 12) {
    return {
      schedule_date: toLocalDateValue(current),
      time_slot: "morning",
    };
  }

  if (currentHour < 18) {
    return {
      schedule_date: toLocalDateValue(current),
      time_slot: "afternoon",
    };
  }

  return {
    schedule_date: toLocalDateValue(addDays(current, 1)),
    time_slot: "morning",
  };
};

// 阻止用户把手动排程放到已经过去的非法时间片。
const isManualScheduleSelectionLegal = (form, now = new Date()) => {
  const selectedDate = normalizeText(form?.schedule_date);
  const selectedSlot = normalizeText(form?.time_slot) || "morning";
  if (!selectedDate || selectedSlot === "custom") {
    return true;
  }

  const today = toLocalDateValue(now);
  if (selectedDate > today) {
    return true;
  }
  if (selectedDate < today) {
    return false;
  }

  const currentHour = now.getHours();
  if (currentHour >= 18) {
    return false;
  }
  if (currentHour >= 12 && selectedSlot === "morning") {
    return false;
  }
  return true;
};

// 表单工厂用于统一手动创建和编辑状态的数据结构。
function createManualScheduleForm(now = new Date()) {
  const legalState = resolveLegalManualScheduleState(now);
  return {
    custom_end: "",
    custom_start: "",
    device: "",
    experiment_code: "",
    planned_hours: 3.5,
    schedule_date: legalState.schedule_date,
    task_code: "",
    time_slot: legalState.time_slot,
  };
}

function createScheduleEditForm() {
  return {
    custom_end: "",
    custom_start: "",
    device: "",
    experiment_code: "",
    id: "",
    planned_hours: 3.5,
    schedule_date: "",
    task_code: "",
    time_slot: "morning",
  };
}

// 将已存排程映射为编辑抽屉所需的表单结构。
function buildScheduleEditForm(schedule) {
  const startAt = parseDate(schedule?.start_at);
  const endAt = parseDate(schedule?.end_at);
  const startTime = startAt ? toLocalTimeValue(startAt) : "";
  const endTime = endAt ? toLocalTimeValue(endAt) : "";
  let timeSlot = "custom";

  if (startTime === SLOT_RANGES.morning.start) {
    timeSlot = "morning";
  } else if (startTime === SLOT_RANGES.afternoon.start) {
    timeSlot = "afternoon";
  }

  // 编辑表单会尽量把固定时段还原回上午/下午选项，否则回退到自定义时段。
  return {
    custom_end: endTime,
    custom_start: startTime,
    device: normalizeText(schedule?.device),
    experiment_code: normalizeText(schedule?.experiment_code),
    id: normalizeText(schedule?.id),
    planned_hours: parsePlannedHours(schedule?.planned_hours) || inferPlannedHours(startAt, endAt),
    schedule_date: startAt ? toLocalDateValue(startAt) : "",
    task_code: normalizeText(schedule?.task_code),
    time_slot: timeSlot,
  };
}

// 解析手动排程操作实际使用的开始和结束时间。
function resolveScheduleTimes(form, now = new Date()) {
  const dateValue = normalizeText(form?.schedule_date);
  if (!dateValue) {
    return { error: "Invalid schedule date" };
  }

  const isRetention = isRetentionDevice(form?.device);
  if (isRetention) {
    // 暂存间记录按“立即进入、立即结束”的占位逻辑处理，不占正式实验时长。
    const startAt = new Date(now.getTime());
    const endAt = new Date(now.getTime());
    return {
      dateValue: toLocalDateValue(startAt),
      endAt,
      endTime: toLocalTimeValue(endAt),
      plannedHours: 0,
      slot: "retention",
      startAt,
      startTime: toLocalTimeValue(startAt),
    };
  }

  const slot = normalizeText(form?.time_slot) || "morning";
  let startTime = "";
  let plannedHours = parsePlannedHours(form?.planned_hours);

  if (slot === "custom") {
    // 自定义时段优先使用手填开始时间，如未填计划时长则从结束时间反推。
    startTime = normalizeText(form?.custom_start);
    if (!startTime) {
      return { error: "Custom start time required" };
    }
    if (!plannedHours) {
      const endTime = normalizeText(form?.custom_end);
      const startAt = parseDate(`${dateValue}T${startTime}:00`);
      const endAt = parseDate(`${dateValue}T${endTime}:00`);
      plannedHours = inferPlannedHours(startAt, endAt);
    }
  } else {
    // 上午/下午快捷时段直接复用预设时间窗。
    const range = SLOT_RANGES[slot] || SLOT_RANGES.morning;
    startTime = range.start;
    plannedHours ||= inferPlannedHours(
      parseDate(`${dateValue}T${range.start}:00`),
      parseDate(`${dateValue}T${range.end}:00`),
    );
  }

  if (!plannedHours) {
    return { error: "Planned hours must be at least 0.5" };
  }

  const startAt = parseDate(`${dateValue}T${startTime}:00`);
  const endAt = startAt ? new Date(startAt.getTime() + plannedHours * 60 * 60 * 1000) : null;
  if (!startAt || !endAt || endAt <= startAt || endAt <= now) {
    return { error: "Invalid schedule time" };
  }

  return {
    dateValue,
    endAt,
    endTime: toLocalTimeValue(endAt),
    plannedHours,
    slot,
    startAt,
    startTime,
  };
}

// 推导看板行和留样视图共用的任务状态。
function resolveTaskStatus(taskCode, schedules, now = new Date()) {
  const related = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => normalizeText(schedule?.task_code) === normalizeText(taskCode),
  );

  const labSchedules = related.filter((schedule) => !isRetentionDevice(schedule?.device));
  const retentionSchedules = related.filter((schedule) => isRetentionDevice(schedule?.device));
  const currentTime = now.getTime();

  // 优先判断是否有正在执行的正式实验。
  const activeLab = labSchedules.find((schedule) => {
    const start = parseDate(schedule?.start_at);
    const end = parseDate(schedule?.end_at);
    return start && end && start.getTime() <= currentTime && end.getTime() >= currentTime;
  });
  if (activeLab) {
    return STATUS_RUNNING;
  }

  // 其次判断是否存在未来或尚未结束的正式实验排程。
  const futureLab = labSchedules.find((schedule) => {
    const end = parseDate(schedule?.end_at);
    return end && end.getTime() > currentTime;
  });
  if (futureLab) {
    return STATUS_SCHEDULED;
  }

  // 有历史实验结束记录但没有后续排程时，视为已完成。
  const completedLab = labSchedules.find((schedule) => {
    const end = parseDate(schedule?.end_at);
    return end && end.getTime() < currentTime;
  });
  if (completedLab) {
    return STATUS_COMPLETED;
  }

  if (retentionSchedules.length > 0) {
    return STATUS_RETENTION;
  }

  return STATUS_WAITING;
}

const statusClass = (status) => {
  if (status === STATUS_RUNNING) {
    return "status running";
  }
  if (status === STATUS_SCHEDULED) {
    return "status scheduled";
  }
  if (status === STATUS_RETENTION) {
    return "status retention";
  }
  if (status === STATUS_COMPLETED) {
    return "status completed";
  }
  return "status";
};

// 构建看板页签使用的主排程表格行。
function buildScheduleRows({ schedules, tasks, experiments, now = new Date() }) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const taskByCode = new Map(taskList.map((task) => [normalizeText(task?.code), task]));
  const experimentList = Array.isArray(experiments) ? experiments : [];
  const experimentNameByCode = new Map(
    experimentList.map((experiment) => [normalizeText(experiment?.experiment_code), normalizeText(experiment?.experiment_name)]),
  );

  return (Array.isArray(schedules) ? schedules : [])
    .map((schedule) => {
      const taskCode = normalizeText(schedule?.task_code);
      const experimentCode = normalizeText(schedule?.experiment_code);
      const task = taskByCode.get(taskCode);
      // 行状态不是直接读排程状态，而是基于任务整体排程情况实时推导。
      const status = resolveTaskStatus(taskCode, schedules, now);

      return {
        device: normalizeText(schedule?.device),
        endAt: formatDateTime(schedule?.end_at),
        experimentCode,
        experimentLabel: experimentNameByCode.get(experimentCode) || buildExperimentLabel(experimentCode),
        id: normalizeText(schedule?.id),
        rowStatus: status,
        rowStatusClass: statusClass(status),
        startAt: formatDateTime(schedule?.start_at),
        taskCode,
        taskName: normalizeText(task?.name),
        testType: normalizeText(task?.test_type),
      };
    })
    .sort((left, right) => left.startAt.localeCompare(right.startAt, "zh-Hans-CN"));
}

// 提取冲突排程对，用于告警条和冲突检查表格。
function buildConflictRows({ schedules }) {
  const scheduleList = (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => !isRetentionDevice(schedule?.device))
    .map((schedule) => ({ ...schedule }));
  const byDevice = new Map();

  // 冲突检查按设备分组后，只需要比较同设备下相邻时间段是否重叠。
  scheduleList.forEach((schedule) => {
    const device = normalizeText(schedule?.device);
    if (!device) {
      return;
    }
    const group = byDevice.get(device) || [];
    group.push(schedule);
    byDevice.set(device, group);
  });

  const rows = [];
  byDevice.forEach((entries, device) => {
    entries.sort((left, right) => {
      const leftTime = parseDate(left?.start_at)?.getTime() || 0;
      const rightTime = parseDate(right?.start_at)?.getTime() || 0;
      return leftTime - rightTime;
    });

    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      const previousEnd = parseDate(previous?.end_at);
      const currentStart = parseDate(current?.start_at);
      if (!previousEnd || !currentStart || previousEnd <= currentStart) {
        continue;
      }
      rows.push({
        device,
        id: normalizeText(current?.id),
        impact: "Delay",
        reason: "Overlap",
        suggestion: "Reschedule",
        taskCode: normalizeText(current?.task_code),
      });
    }
  });

  return rows;
}

// 按设备和时间窗口构建可直接用于甘特图的行数据。
function buildGanttRows({ schedules, devices, days = 3, filterDevice = "", startDate = new Date(), now = new Date() }) {
  const visibleSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => !isRetentionDevice(schedule?.device),
  );
  const anchorDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  // 如果视图窗口内的默认天数不足以覆盖最新排程，会自动向后扩展。
  const latestVisibleEnd = visibleSchedules.reduce((latest, schedule) => {
    const scheduleEnd = parseDate(schedule?.end_at);
    if (!scheduleEnd) {
      return latest;
    }
    return !latest || scheduleEnd > latest ? scheduleEnd : latest;
  }, null);
  const requiredDays = latestVisibleEnd ? getDaySpan(anchorDate, latestVisibleEnd) + 1 : days;
  const totalDays = Math.max(days, requiredDays);

  const dayList = Array.from({ length: totalDays }, (_, index) => {
    const date = addDays(anchorDate, index);
    return {
      date,
      key: toLocalDateValue(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });

  const baseDeviceCodes = Array.from(
    new Set(
      []
        .concat(TEST_LABS)
        .concat((Array.isArray(devices) ? devices : []).map((device) => normalizeText(device?.code || device?.name)))
        .concat(visibleSchedules.map((schedule) => normalizeText(schedule?.device))),
    ),
  )
    .filter(Boolean)
    .filter((device) => !isRetentionDevice(device));

  const deviceCodes = normalizeText(filterDevice)
    ? baseDeviceCodes.filter((device) => normalizeText(device) === normalizeText(filterDevice))
    : baseDeviceCodes;

  const rows = deviceCodes.map((device) => {
    const deviceSchedules = visibleSchedules.filter((schedule) => normalizeText(schedule?.device) === device);
    // 每个设备按“天 x 半天”拆成离散槽位，再聚合成最终显示段。
    const slots = dayList.flatMap((day) =>
      SLOT_SEQUENCE.map((segment) => {
        const range = segment === "am" ? SLOT_RANGES.morning : SLOT_RANGES.afternoon;
        const segmentStart = parseDate(`${day.key}T${range.start}:00`);
        const segmentEnd = segment === "am"
          ? parseDate(`${day.key}T${SLOT_RANGES.afternoon.start}:00`)
          : parseDate(`${toLocalDateValue(addDays(day.date, 1))}T${SLOT_RANGES.morning.start}:00`);
        const matched = deviceSchedules.filter((schedule) => {
          const startAt = parseDate(schedule?.start_at);
          const endAt = parseDate(schedule?.end_at);
          return startAt && endAt && overlaps(startAt, endAt, segmentStart, segmentEnd);
        });

        const slotKey = `${device}-${day.key}-${segment}`;
        if (matched.length === 0) {
          return {
            className: "gantt-slot idle",
            date: day.key,
            key: slotKey,
            label: "空闲",
            scheduleId: "",
            segment,
            state: "idle",
            title: "空闲",
          };
        }

        if (matched.length > 1) {
          // 同一半天命中多条排程时直接标记为冲突槽位。
          return {
            className: "gantt-slot conflict",
            date: day.key,
            key: slotKey,
            label: `${normalizeText(matched[0]?.task_code)} +${matched.length - 1}`,
            scheduleId: normalizeText(matched[0]?.id),
            segment,
            state: "conflict",
            title: "冲突",
          };
        }

        const schedule = matched[0];
        const startAt = parseDate(schedule?.start_at);
        const endAt = parseDate(schedule?.end_at);
        const stateMeta = getSlotState({ startAt, endAt, now });
        return {
          className: stateMeta.className,
          date: day.key,
          key: slotKey,
          label: normalizeText(schedule?.task_code),
          scheduleId: normalizeText(schedule?.id),
          segment,
          state: stateMeta.state,
          title: `${normalizeText(schedule?.task_code)} ${formatDateTime(schedule?.start_at)}-${formatDateTime(schedule?.end_at)}`.trim(),
        };
      }),
    );

    const segments = [];
    slots.forEach((slot) => {
      // 连续同态槽位在这里折叠成 colspan 段，减少甘特图重复单元格。
      const signature = slot.state === "idle"
        ? "idle"
        : slot.state === "conflict"
          ? `${slot.state}:${slot.key}`
          : `${slot.scheduleId}:${slot.className}`;
      const previous = segments[segments.length - 1];
      if (previous && previous.signature == signature && slot.state !== "conflict") {
        previous.colspan += 1;
        return;
      }
      segments.push({
        className: slot.className,
        colspan: 1,
        key: `${slot.key}-segment`,
        label: slot.label,
        scheduleId: slot.scheduleId,
        signature,
        state: slot.state,
        title: slot.title,
      });
    });

    return {
      device,
      segments: segments.map(({ signature, ...segment }) => segment),
      slots,
    };
  });

  return { days: dayList, rows };
}

// 构建留样面板中等待暂存的任务和样品行数据。
function buildRetentionInternalRows({ tasks, samples, schedules, now = new Date() }) {
  const taskByCode = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [normalizeText(task?.code), task]));
  const nonRetentionCodes = new Set(
    (Array.isArray(schedules) ? schedules : [])
      .filter((schedule) => !isRetentionDevice(schedule?.device))
      .map((schedule) => normalizeText(schedule?.task_code))
      .filter(Boolean),
  );

  const rowsByCode = new Map();

  // 留样面板只关注“仅在暂存间且尚未进入正式实验”的任务。
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    const taskCode = normalizeText(schedule?.task_code);
    if (!taskCode || nonRetentionCodes.has(taskCode) || !isRetentionDevice(schedule?.device)) {
      return;
    }
    const existing = rowsByCode.get(taskCode) || {
      code: taskCode,
      name: normalizeText(taskByCode.get(taskCode)?.name),
      testType: normalizeText(taskByCode.get(taskCode)?.test_type),
      waitLabel: "--",
      since: null,
      sinceText: "-",
    };
    const startAt = parseDate(schedule?.start_at);
    if (startAt && (!existing.since || startAt < existing.since)) {
      existing.since = startAt;
    }
    rowsByCode.set(taskCode, existing);
  });

  return Array.from(rowsByCode.values())
    .map((row) => {
      // 等待时长按最早进入暂存间的时间计算整小时差。
      const since = row.since;
      const elapsedHours = since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / (1000 * 60 * 60))) : 0;
      return {
        ...row,
        sinceText: since ? formatDateTime(since) : "-",
        waitLabel: since ? `${elapsedHours}h` : "--",
      };
    })
    .sort((left, right) => {
      const leftTime = left.since?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightTime = right.since?.getTime() || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    });
}

// 生成手动排程表单使用的下拉选项。
function buildManualTaskOptions({ tasks, experiments, samples, schedules, activeTab }) {
  if (activeTab === "retention") {
    // 留样页签下，任务下拉来源于暂存中的内部任务。
    return buildRetentionInternalRows({ tasks, samples, schedules }).map((row) => ({
      code: row.code,
      label: `${row.code}${row.name ? ` ${row.name}` : ""}`.trim(),
      testType: row.testType,
    }));
  }

  const pendingExperimentTaskCodes = new Set(
    buildExperimentOptions({ experiments, schedules, taskCode: "", tasks })
      .map((option) => normalizeText(option.taskCode))
      .filter(Boolean),
  );

  // 正常排程页签优先显示仍有未排实验的任务。
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => {
      const taskCode = normalizeText(task?.code);
      if (!taskCode) {
        return false;
      }
      if (pendingExperimentTaskCodes.size > 0) {
        return pendingExperimentTaskCodes.has(taskCode);
      }
      return normalizeText(task?.status) === STATUS_WAITING;
    })
    .map((task) => ({
      code: normalizeText(task?.code),
      label: `${normalizeText(task?.code)}${normalizeText(task?.name) ? ` ${normalizeText(task?.name)}` : ""}`.trim(),
      testType: normalizeText(task?.test_type),
    }));
}

function buildLabOptions({ testType, activeTab, selectedDevice = "" }) {
  let labs = normalizeText(testType) ? getLabsForTestType(normalizeText(testType)) : [];
  // 普通排程允许把暂存间作为一个可选去向，留样页签则反过来排除它。
  if (activeTab !== "retention" && !labs.includes(RETENTION_DEVICE)) {
    labs = [...labs, RETENTION_DEVICE];
  }
  if (activeTab === "retention") {
    labs = labs.filter((lab) => !isRetentionDevice(lab));
  }
  if (selectedDevice && !labs.includes(selectedDevice)) {
    labs = [...labs, selectedDevice];
  }
  return labs;
}

// 根据当前时钟计算留样时间状态标签。
function resolveRetentionTimeState(now = new Date()) {
  const current = new Date(now.getTime());
  const timeValue = toLocalTimeValue(current);
  const morningStart = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.morning.start}:00`);
  const morningEnd = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.morning.end}:00`);
  const afternoonStart = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.afternoon.start}:00`);
  const afternoonEnd = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.afternoon.end}:00`);
  let timeSlot = "custom";

  // 当前时刻落在上午/下午固定窗口内时，优先回填对应快捷时段。
  if (morningStart && morningEnd && current >= morningStart && current <= morningEnd) {
    timeSlot = "morning";
  } else if (afternoonStart && afternoonEnd && current >= afternoonStart && current <= afternoonEnd) {
    timeSlot = "afternoon";
  }

  return {
    custom_end: timeValue,
    custom_start: timeValue,
    schedule_date: toLocalDateValue(current),
    time_slot: timeSlot,
  };
}

// 构建排程看板上方展示的汇总卡片。
function buildSummaryCards({ schedules, now = new Date() }) {
  const rows = buildScheduleRows({ schedules, tasks: [], now });
  const conflictRows = buildConflictRows({ schedules });
  return {
    changeCount: 0,
    conflictCount: conflictRows.length,
    nextAuto: formatDateTime(new Date(now.getTime() + 60 * 60 * 1000)),
    scheduleCount: rows.length,
  };
}

// 持久化辅助逻辑会在更新排程时同步任务和数据流状态。
function syncTaskStatuses(tasks, schedules, now = new Date()) {
  return (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    // 任务状态完全以当前排程快照重新计算，避免手工维护多处状态。
    status: resolveTaskStatus(task?.code, schedules, now),
  }));
}

function buildExperimentOptions({ taskCode, experiments, schedules, tasks }) {
  const scheduledExperimentCodes = new Set(
    (Array.isArray(schedules) ? schedules : [])
      .filter(
        (schedule) =>
          !isRetentionDevice(schedule?.device) &&
          normalizeText(schedule?.experiment_code),
      )
      .map((schedule) => normalizeText(schedule?.experiment_code)),
  );

  return buildExperimentCandidates({ taskCode, experiments, tasks })
    .filter((experiment) => !scheduledExperimentCodes.has(normalizeText(experiment?.experiment_code)))
    .map((experiment) => ({
      code: normalizeText(experiment?.experiment_code),
      fullCode: normalizeText(experiment?.experiment_code),
      label: normalizeText(experiment?.experiment_name) || normalizeText(experiment?.required_device) || normalizeText(experiment?.experiment_code),
      requiredDevice: normalizeText(experiment?.required_device),
      taskCode: normalizeText(experiment?.task_code),
    }));
}

function ensureStreamForSchedule(streams, schedule, now = new Date()) {
  const nextStreams = Array.isArray(streams) ? streams.map((stream) => ({ ...stream })) : [];
  const taskCode = normalizeText(schedule?.task_code);
  const existing = nextStreams.find((stream) => normalizeText(stream?.task_code) === taskCode);
  if (existing) {
    // 已有数据流时仅同步最新设备归属，不重复创建。
    existing.device = normalizeText(schedule?.device);
    return nextStreams;
  }
  // 首次排程会为任务补建一条默认数据流记录。
  nextStreams.push({
    device: normalizeText(schedule?.device),
    id: createId("stream"),
    last_packet: formatDateTime(now),
    quality: "98.0%",
    reported: false,
    status: STREAMING_STATUS,
    task_code: taskCode,
  });
  return nextStreams;
}

function findScheduleConflicts({ schedules, candidate, ignoreId = "" }) {
  const device = normalizeText(candidate?.device);
  if (!device || isRetentionDevice(device)) {
    return [];
  }
  const startAt = parseDate(candidate?.start_at);
  const endAt = parseDate(candidate?.end_at);
  if (!startAt || !endAt) {
    return [];
  }

  // 冲突检查排除自身编辑场景，只比较同设备且时间重叠的正式排程。
  return (Array.isArray(schedules) ? schedules : []).filter((schedule) => {
    if (normalizeText(schedule?.id) === normalizeText(ignoreId)) {
      return false;
    }
    if (normalizeText(schedule?.device) !== device) {
      return false;
    }
    const existingStart = parseDate(schedule?.start_at);
    const existingEnd = parseDate(schedule?.end_at);
    return existingStart && existingEnd && overlaps(startAt, endAt, existingStart, existingEnd);
  });
}

function createScheduleRecord({ form, tasks, schedules, streams, now = new Date() }) {
  const taskCode = normalizeText(form?.task_code);
  const device = normalizeText(form?.device);
  if (!taskCode || !device) {
    return { error: "请选择任务和实验室" };
  }

  const resolved = resolveScheduleTimes(form, now);
  if (resolved.error) {
    return resolved;
  }

  const nextSchedules = Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [];
      const candidate = {
        device,
        end_at: resolved.endAt.toISOString(),
        experiment_code: normalizeText(form?.experiment_code),
        planned_hours: resolved.plannedHours,
        start_at: resolved.startAt.toISOString(),
        task_code: taskCode,
  };
  const conflicts = findScheduleConflicts({ candidate, schedules: nextSchedules });
  if (conflicts.length > 0) {
    return { error: "排程冲突，请调整时间或实验室" };
  }

  // 任务此前若只在暂存间，转入正式实验室时直接复用原暂存记录。
  const retentionSchedule = nextSchedules.find(
    (schedule) => normalizeText(schedule?.task_code) === taskCode && isRetentionDevice(schedule?.device) && !isRetentionDevice(device),
  );
  if (retentionSchedule) {
    retentionSchedule.device = device;
    retentionSchedule.start_at = candidate.start_at;
    retentionSchedule.end_at = candidate.end_at;
    retentionSchedule.experiment_code = candidate.experiment_code;
    retentionSchedule.planned_hours = candidate.planned_hours;
    retentionSchedule.status = STATUS_SCHEDULED;
  } else {
    // 否则新增一条排程记录，并根据设备类型设置初始状态。
      nextSchedules.push({
        id: createId("schedule"),
        ...candidate,
      status: isRetentionDevice(device) ? STATUS_RETENTION : STATUS_SCHEDULED,
    });
  }

  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now);
  const targetSchedule =
    nextSchedules.find((schedule) => normalizeText(schedule?.task_code) === taskCode && normalizeText(schedule?.device) === device) ||
    nextSchedules[nextSchedules.length - 1];
  const nextStreams = ensureStreamForSchedule(streams, targetSchedule, now);

  return { schedules: nextSchedules, streams: nextStreams, tasks: nextTasks };
}

function updateScheduleRecord({ form, tasks, schedules, streams, now = new Date() }) {
  const scheduleId = normalizeText(form?.id);
  const nextSchedules = Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [];
  const target = nextSchedules.find((schedule) => normalizeText(schedule?.id) === scheduleId);
  if (!target) {
    return { error: "未找到排程记录" };
  }

  const resolved = resolveScheduleTimes(form, now);
  if (resolved.error) {
    return resolved;
  }

  const device = normalizeText(form?.device);
  if (!device) {
    return { error: "请选择实验室" };
  }

  const candidate = {
    device,
    end_at: resolved.endAt.toISOString(),
    experiment_code: normalizeText(form?.experiment_code),
    planned_hours: resolved.plannedHours,
    start_at: resolved.startAt.toISOString(),
    task_code: normalizeText(form?.task_code),
  };
  const conflicts = findScheduleConflicts({ candidate, schedules: nextSchedules, ignoreId: scheduleId });
  if (conflicts.length > 0) {
    return { error: "排程冲突，请调整时间或实验室" };
  }

  // 编辑场景直接原位覆盖目标排程记录。
  target.device = device;
  target.start_at = candidate.start_at;
  target.end_at = candidate.end_at;
  target.experiment_code = candidate.experiment_code;
  target.planned_hours = candidate.planned_hours;
  target.status = isRetentionDevice(device) ? STATUS_RETENTION : STATUS_SCHEDULED;

  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now);
  const nextStreams = ensureStreamForSchedule(streams, target, now);

  return { schedules: nextSchedules, streams: nextStreams, tasks: nextTasks };
}

function deleteScheduleRecord({ scheduleId, tasks, schedules, streams, now = new Date() }) {
  const nextSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => normalizeText(schedule?.id) !== normalizeText(scheduleId),
  );
  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now);
  return {
    schedules: nextSchedules,
    streams: Array.isArray(streams) ? streams.map((stream) => ({ ...stream })) : [],
    tasks: nextTasks,
  };
}

export {
  RETENTION_DEVICE,
  SLOT_RANGES,
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
  buildConflictRows,
  buildExperimentOptions,
  buildGanttRows,
  buildLabOptions,
  buildManualTaskOptions,
  buildRetentionInternalRows,
  buildScheduleEditForm,
  buildScheduleRows,
  buildSummaryCards,
  createManualScheduleForm,
  createScheduleRecord,
  createScheduleEditForm,
  deleteScheduleRecord,
  formatDateTime,
  isRetentionDevice,
  normalizeText,
  resolveLegalManualScheduleState,
  resolveRetentionTimeState,
  resolveScheduleTimes,
  resolveTaskStatus,
  isManualScheduleSelectionLegal,
  updateScheduleRecord,
};
