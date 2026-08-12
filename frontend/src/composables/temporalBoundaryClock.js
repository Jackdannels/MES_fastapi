import { formatBusinessDateKey, parseBusinessDateTimeToMs } from "@/lib/dateTime";

const asArray = (value) => (Array.isArray(value) ? value : []);

const collectBoundaryTimes = ({ devices = [], experimentRuns = [], schedules = [] } = {}) => [
  ...asArray(schedules).flatMap((schedule) => [
    schedule?.start_at ?? schedule?.startAt,
    schedule?.end_at ?? schedule?.endAt,
  ]),
  ...asArray(devices).flatMap((device) => [
    device?.maintenance_start_at ?? device?.maintenanceStartAt,
    device?.maintenance_end_at ?? device?.maintenanceEndAt,
  ]),
  ...asArray(experimentRuns).map((run) => run?.planned_end_at ?? run?.plannedEndAt),
]
  .map(parseBusinessDateTimeToMs)
  .filter(Number.isFinite)
  .sort((left, right) => left - right);

// 数据变化时预先找出下一个排程/维修边界，秒级时钟随后只做常数级比较。
function buildTemporalBoundaryState({ devices = [], experimentRuns = [], now, schedules = [] } = {}) {
  const nowTime = now instanceof Date ? now.getTime() : parseBusinessDateTimeToMs(now);
  const safeNow = Number.isFinite(nowTime) ? nowTime : Date.now();
  return {
    dayKey: formatBusinessDateKey(new Date(safeNow)),
    nextBoundaryTime: collectBoundaryTimes({ devices, experimentRuns, schedules })
      .find((boundaryTime) => boundaryTime > safeNow) ?? null,
  };
}

function temporalBoundaryHasElapsed(state, now) {
  const nowTime = now instanceof Date ? now.getTime() : parseBusinessDateTimeToMs(now);
  if (!Number.isFinite(nowTime)) {
    return false;
  }
  return formatBusinessDateKey(new Date(nowTime)) !== state?.dayKey
    || (Number.isFinite(state?.nextBoundaryTime) && nowTime >= state.nextBoundaryTime);
}

export { buildTemporalBoundaryState, temporalBoundaryHasElapsed };
