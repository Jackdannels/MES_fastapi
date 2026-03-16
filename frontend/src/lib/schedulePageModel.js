import { getLabsForTestType, TEST_LABS } from "@/lib/labs.js";

const STATUS_WAITING = "待排程";
const STATUS_SCHEDULED = "已排程";
const STATUS_RUNNING = "实验中";
const STATUS_COMPLETED = "实验已完成";
const STATUS_RETENTION = "暂存间排放";
const STREAMING_STATUS = "Streaming";
const RETENTION_DEVICE = "恒温恒湿间（暂存间）";
const RETENTION_KEYWORD = "暂存间";
const SLOT_RANGES = Object.freeze({
  morning: { start: "08:00", end: "12:00", label: "上午 08:00-12:00" },
  afternoon: { start: "12:00", end: "18:00", label: "下午 12:00-18:00" },
});

const normalizeText = (value) => String(value ?? "").trim();

const isRetentionDevice = (value) => normalizeText(value).includes(RETENTION_KEYWORD);

const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

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

const toLocalTimeValue = (value) => {
  const date = parseDate(value);
  if (!date) {
    return "";
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const formatDateTime = (value) => {
  const date = parseDate(value);
  if (!date) {
    return "";
  }
  return `${toLocalDateValue(date)} ${toLocalTimeValue(date)}`;
};

const addDays = (date, days) => {
  const nextDate = new Date(date.getTime());
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

const overlaps = (startA, endA, startB, endB) => startA < endB && endA > startB;

const createId = (prefix) => {
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${Date.now()}-${random}`;
};

const SLOT_SEQUENCE = ["am", "pm"];
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

const parsePlannedHours = (value) => {
  const rawValue = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  const normalized = Math.round(rawValue * 2) / 2;
  return normalized >= 0.5 ? normalized : null;
};

const inferPlannedHours = (startAt, endAt) => {
  if (!startAt || !endAt) {
    return 3.5;
  }
  const hours = (endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60);
  return parsePlannedHours(hours) || 3.5;
};

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

const getDaySpan = (startDate, endDate) => {
  const startValue = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
  const endValue = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
  return Math.floor((endValue - startValue) / (24 * 60 * 60 * 1000));
};

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

function createManualScheduleForm(now = new Date()) {
  const legalState = resolveLegalManualScheduleState(now);
  return {
    custom_end: "",
    custom_start: "",
    device: "",
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
    id: "",
    planned_hours: 3.5,
    schedule_date: "",
    task_code: "",
    time_slot: "morning",
  };
}

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

  return {
    custom_end: endTime,
    custom_start: startTime,
    device: normalizeText(schedule?.device),
    id: normalizeText(schedule?.id),
    planned_hours: parsePlannedHours(schedule?.planned_hours) || inferPlannedHours(startAt, endAt),
    schedule_date: startAt ? toLocalDateValue(startAt) : "",
    task_code: normalizeText(schedule?.task_code),
    time_slot: timeSlot,
  };
}

function resolveScheduleTimes(form, now = new Date()) {
  const dateValue = normalizeText(form?.schedule_date);
  if (!dateValue) {
    return { error: "Invalid schedule date" };
  }

  const isRetention = isRetentionDevice(form?.device);
  if (isRetention) {
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

function resolveTaskStatus(taskCode, schedules, now = new Date()) {
  const related = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => normalizeText(schedule?.task_code) === normalizeText(taskCode),
  );

  const labSchedules = related.filter((schedule) => !isRetentionDevice(schedule?.device));
  const retentionSchedules = related.filter((schedule) => isRetentionDevice(schedule?.device));
  const currentTime = now.getTime();

  const activeLab = labSchedules.find((schedule) => {
    const start = parseDate(schedule?.start_at);
    const end = parseDate(schedule?.end_at);
    return start && end && start.getTime() <= currentTime && end.getTime() >= currentTime;
  });
  if (activeLab) {
    return STATUS_RUNNING;
  }

  const futureLab = labSchedules.find((schedule) => {
    const end = parseDate(schedule?.end_at);
    return end && end.getTime() > currentTime;
  });
  if (futureLab) {
    return STATUS_SCHEDULED;
  }

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

function buildScheduleRows({ schedules, tasks, now = new Date() }) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const taskByCode = new Map(taskList.map((task) => [normalizeText(task?.code), task]));

  return (Array.isArray(schedules) ? schedules : [])
    .map((schedule) => {
      const taskCode = normalizeText(schedule?.task_code);
      const task = taskByCode.get(taskCode);
      const status = resolveTaskStatus(taskCode, schedules, now);

      return {
        device: normalizeText(schedule?.device),
        endAt: formatDateTime(schedule?.end_at),
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

function buildConflictRows({ schedules }) {
  const scheduleList = (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => !isRetentionDevice(schedule?.device))
    .map((schedule) => ({ ...schedule }));
  const byDevice = new Map();

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

function buildGanttRows({ schedules, devices, days = 3, filterDevice = "", startDate = new Date(), now = new Date() }) {
  const visibleSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => !isRetentionDevice(schedule?.device),
  );
  const anchorDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
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

function buildRetentionInternalRows({ tasks, samples, schedules, now = new Date() }) {
  const taskByCode = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [normalizeText(task?.code), task]));
  const nonRetentionCodes = new Set(
    (Array.isArray(schedules) ? schedules : [])
      .filter((schedule) => !isRetentionDevice(schedule?.device))
      .map((schedule) => normalizeText(schedule?.task_code))
      .filter(Boolean),
  );

  const rowsByCode = new Map();

  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    if (!taskCode || nonRetentionCodes.has(taskCode) || !isRetentionDevice(sample?.location)) {
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
    const createdAt = parseDate(sample?.created_at);
    if (createdAt && (!existing.since || createdAt < existing.since)) {
      existing.since = createdAt;
    }
    rowsByCode.set(taskCode, existing);
  });

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

function buildManualTaskOptions({ tasks, samples, schedules, activeTab }) {
  if (activeTab === "retention") {
    return buildRetentionInternalRows({ tasks, samples, schedules }).map((row) => ({
      code: row.code,
      label: `${row.code}${row.name ? ` ${row.name}` : ""}`.trim(),
      testType: row.testType,
    }));
  }

  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => normalizeText(task?.status) === STATUS_WAITING)
    .map((task) => ({
      code: normalizeText(task?.code),
      label: `${normalizeText(task?.code)}${normalizeText(task?.name) ? ` ${normalizeText(task?.name)}` : ""}`.trim(),
      testType: normalizeText(task?.test_type),
    }));
}

function buildLabOptions({ testType, activeTab, selectedDevice = "" }) {
  let labs = normalizeText(testType) ? getLabsForTestType(normalizeText(testType)) : [];
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

function resolveRetentionTimeState(now = new Date()) {
  const current = new Date(now.getTime());
  const timeValue = toLocalTimeValue(current);
  const morningStart = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.morning.start}:00`);
  const morningEnd = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.morning.end}:00`);
  const afternoonStart = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.afternoon.start}:00`);
  const afternoonEnd = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.afternoon.end}:00`);
  let timeSlot = "custom";

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

function syncTaskStatuses(tasks, schedules, now = new Date()) {
  return (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    status: resolveTaskStatus(task?.code, schedules, now),
  }));
}

function ensureStreamForSchedule(streams, schedule, now = new Date()) {
  const nextStreams = Array.isArray(streams) ? streams.map((stream) => ({ ...stream })) : [];
  const taskCode = normalizeText(schedule?.task_code);
  const existing = nextStreams.find((stream) => normalizeText(stream?.task_code) === taskCode);
  if (existing) {
    existing.device = normalizeText(schedule?.device);
    return nextStreams;
  }
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
    planned_hours: resolved.plannedHours,
    start_at: resolved.startAt.toISOString(),
    task_code: taskCode,
  };
  const conflicts = findScheduleConflicts({ candidate, schedules: nextSchedules });
  if (conflicts.length > 0) {
    return { error: "排程冲突，请调整时间或实验室" };
  }

  const retentionSchedule = nextSchedules.find(
    (schedule) => normalizeText(schedule?.task_code) === taskCode && isRetentionDevice(schedule?.device) && !isRetentionDevice(device),
  );
  if (retentionSchedule) {
    retentionSchedule.device = device;
    retentionSchedule.start_at = candidate.start_at;
    retentionSchedule.end_at = candidate.end_at;
    retentionSchedule.planned_hours = candidate.planned_hours;
    retentionSchedule.status = STATUS_SCHEDULED;
  } else {
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
    planned_hours: resolved.plannedHours,
    start_at: resolved.startAt.toISOString(),
    task_code: normalizeText(form?.task_code),
  };
  const conflicts = findScheduleConflicts({ candidate, schedules: nextSchedules, ignoreId: scheduleId });
  if (conflicts.length > 0) {
    return { error: "排程冲突，请调整时间或实验室" };
  }

  target.device = device;
  target.start_at = candidate.start_at;
  target.end_at = candidate.end_at;
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
