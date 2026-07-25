import { buildConflictRows, buildGanttRows, toLocalDateValue } from "@/modules/schedule/model";
import { scheduleTargetsStorageArea } from "@/lib/labIdentity";
import { serverNowDate } from "@/lib/serverClock";
import { addDays, asArray, normalizeText, overlaps, parseDate, startOfLocalDay } from "./sharedModel";

const formatMonthDay = (date) => `${date.getMonth() + 1}/${date.getDate()}`;

const buildThreeDayList = (now) => {
  const today = startOfLocalDay(now);
  return [0, 1, 2].map((index) => {
    const date = addDays(today, index);
    const dateLabel = formatMonthDay(date);
    return {
      date,
      key: toLocalDateValue(date),
      label: dateLabel,
      dateLabel,
    };
  });
};

const scheduleOverlapsWindow = (schedule, windowStart, windowEnd) => {
  const startAt = parseDate(schedule?.start_at);
  const endAt = parseDate(schedule?.end_at);
  return Boolean(startAt && endAt && overlaps(startAt, endAt, windowStart, windowEnd));
};

const atLocalHour = (date, hour) => {
  const next = new Date(date);
  next.setHours(hour, 0, 0, 0);
  return next;
};

const normalizeScheduleSlot = (slot) => ({
  allItems: asArray(slot?.allItems),
  className: normalizeText(slot?.className),
  date: normalizeText(slot?.date),
  displayMode: normalizeText(slot?.displayMode),
  items: asArray(slot?.items),
  key: normalizeText(slot?.key),
  label: normalizeText(slot?.label),
  overflowCount: Number(slot?.overflowCount) || 0,
  scheduleId: normalizeText(slot?.scheduleId),
  segment: normalizeText(slot?.segment),
  state: normalizeText(slot?.state),
  taskColor: normalizeText(slot?.taskColor),
  title: normalizeText(slot?.title),
});

function buildLabScheduleThreeDayView(input = {}) {
  const now = parseDate(input.now) || serverNowDate();
  const days = buildThreeDayList(now);
  const windowStart = days[0].date;
  const windowEnd = addDays(days[0].date, 3);
  const tasks = asArray(input.tasks);
  const experiments = asArray(input.experiments);
  const experimentTrays = asArray(input.experimentTrays || input.experiment_trays);
  const samples = asArray(input.samples);
  const schedules = asArray(input.schedules);
  const devices = asArray(input.devices);
  const labNames = asArray(input.labNames).map(normalizeText).filter(Boolean);

  const visibleSchedules = schedules.filter(
    (schedule) => !scheduleTargetsStorageArea(schedule) && scheduleOverlapsWindow(schedule, windowStart, windowEnd),
  );
  const visibleScheduleIds = new Set(visibleSchedules.map((schedule) => normalizeText(schedule?.id)).filter(Boolean));
  const rawGanttView = buildGanttRows({
    days: 3,
    devices,
    experiments,
    experimentTrays,
    masterLabs: labNames.map((name) => ({ name, test_types: [name] })),
    now,
    samples,
    schedules: visibleSchedules,
    startDate: windowStart,
    tasks,
  });
  const allowedLabs = new Set(labNames);
  const rows = asArray(rawGanttView.rows)
    .filter((row) => allowedLabs.size === 0 || allowedLabs.has(normalizeText(row?.device)))
    .map((row) => ({
      device: normalizeText(row?.device),
      loadCount: asArray(row?.slots).filter((slot) => normalizeText(slot?.state) !== "idle").length,
      slots: asArray(row?.slots).map(normalizeScheduleSlot),
    }));
  const runningIds = new Set();
  rows.forEach((row) => {
    row.slots.forEach((slot) => {
      if (slot.state !== "running") {
        return;
      }
      if (slot.scheduleId) {
        runningIds.add(slot.scheduleId);
      }
      slot.items.forEach((item) => asArray(item?.scheduleIds).forEach((id) => runningIds.add(normalizeText(id))));
    });
  });
  const conflicts = buildConflictRows({
    experiments,
    experimentTrays,
    samples,
    schedules: visibleSchedules,
    tasks,
  }).filter((row) => !row?.id || visibleScheduleIds.has(normalizeText(row?.id))).length;
  const periodCounts = days.flatMap((day) => [
    {
      count: visibleSchedules.filter((schedule) => scheduleOverlapsWindow(schedule, day.date, atLocalHour(day.date, 12))).length,
      dateLabel: day.dateLabel,
      key: `${day.key}-am`,
      label: `${day.dateLabel} 上午`,
      period: "am",
      periodLabel: "上午",
    },
    {
      count: visibleSchedules.filter((schedule) => scheduleOverlapsWindow(schedule, atLocalHour(day.date, 12), addDays(day.date, 1))).length,
      dateLabel: day.dateLabel,
      key: `${day.key}-pm`,
      label: `${day.dateLabel} 下午`,
      period: "pm",
      periodLabel: "下午",
    },
  ]);

  return {
    days,
    periodCounts,
    rows,
    summary: {
      conflicts,
      idleLabs: rows.filter((row) => row.loadCount === 0).length,
      running: runningIds.size,
      total: visibleSchedules.length,
      waiting: Math.max(0, visibleSchedules.length - runningIds.size),
    },
  };
}

export { buildLabScheduleThreeDayView };
