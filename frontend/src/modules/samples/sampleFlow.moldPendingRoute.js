import { SAMPLE_FLOW_STEPS } from "./sampleFlow.constants";
import { normalizeText as text } from "./sampleFlow.shared";
import { asArray, parseTimeValue, resolveEntryExperimentCode, resolveEntryTaskCode, resolveEntryTrayCode, resolveEntryTrayCodes } from "./sampleFlow.trayScope";

const preparationKeys = new Set(["sent_to_lab", "arrived_lab", "fixture_install", "ready"]);
const terminalStatuses = new Set(["实验已取消", "设备故障试验取消", "实验已完成", "实验完成", "实验已经完成", "厂家收回"]);
const scheduleId = (row) => text(row?.schedule_id || row?.scheduleId || row?.schedule_no || row?.id);
const nameOf = (row) => text(row?.displayName || row?.experiment_name || row?.experimentName || row?.name);

// This is a forecast, not execution evidence. Only cancellation/recovery invokes
// it; subsequent real operations continue through the normal flow engine.
export function insertMoldPendingRoute(steps, input, { cancellation, recovery, relation }) {
  const taskCode = text(input.taskCode), trayCode = text(input.trayCode);
  const experimentCodes = new Set(asArray(input.experimentTrays || input.experiment_trays)
    .filter((row) => resolveEntryTaskCode(row) === taskCode && resolveEntryTrayCode(row) === trayCode)
    .map(resolveEntryExperimentCode));
  const experiments = asArray(input.experiments).filter((row) => resolveEntryTaskCode(row) === taskCode
    && (!experimentCodes.size || experimentCodes.has(resolveEntryExperimentCode(row))));
  const relations = asArray(input.experimentRunTrays || input.experiment_run_trays)
    .filter((row) => resolveEntryTaskCode(row) === taskCode && resolveEntryTrayCode(row) === trayCode);
  const runs = asArray(input.experimentRuns || input.experiment_runs).filter((row) => resolveEntryTaskCode(row) === taskCode);
  const canceledScheduleIds = new Set(runs.filter((row) => ["实验已取消", "设备故障试验取消"].includes(text(row.status)))
    .map(scheduleId).filter(Boolean));
  const candidates = asArray(input.schedules).filter((row) => {
    const code = resolveEntryExperimentCode(row);
    if (resolveEntryTaskCode(row) !== taskCode || !experiments.some((entry) => resolveEntryExperimentCode(entry) === code)) return false;
    if (terminalStatuses.has(text(row.status)) || canceledScheduleIds.has(scheduleId(row))) return false;
    const trays = resolveEntryTrayCodes(row);
    if (trays.length && !trays.includes(trayCode)) return false;
    const latest = relations.filter((entry) => resolveEntryExperimentCode(entry) === code)
      .sort((a, b) => parseTimeValue(b.ended_at || b.updated_at || b.started_at) - parseTimeValue(a.ended_at || a.updated_at || a.started_at))[0];
    return !["实验已完成", "实验完成", "实验已经完成", "厂家收回"].includes(text(latest?.run_tray_status || latest?.status));
  }).sort((a, b) => (parseTimeValue(a.start_at) || Infinity) - (parseTimeValue(b.start_at) || Infinity)
    || scheduleId(a).localeCompare(scheduleId(b)));
  const nextSchedule = candidates[0];
  const nextCode = resolveEntryExperimentCode(nextSchedule);
  const nextExperiment = experiments.find((row) => resolveEntryExperimentCode(row) === nextCode);
  const nextName = nameOf(nextExperiment);
  const boundary = parseTimeValue(relation?.ended_at || relation?.updated_at);
  // Remove stale or duplicate preparation templates, not genuine earlier history.
  const retained = steps.filter((step) => {
    const isPreparation = preparationKeys.has(step.key) || /^route-\d+-\d+$/.test(step.key);
    return !isPreparation || ((step.reached || step.active) && parseTimeValue(step.time) < boundary && parseTimeValue(step.time) > 0);
  });
  const identity = `${text(relation?.run_no || relation?.id)}-${scheduleId(nextSchedule) || "unscheduled"}`;
  const route = SAMPLE_FLOW_STEPS.filter((step) => preparationKeys.has(step.key)).map((step) => ({
    ...step,
    key: `mold-next-${identity}-${step.key}`,
    label: step.key === "sent_to_lab" && text(nextSchedule?.device) ? `送至${text(nextSchedule.device)}` : step.label,
    experimentCode: nextCode,
    scheduleId: scheduleId(nextSchedule),
    labName: text(nextSchedule?.device),
    active: false, reached: false, time: "",
  }));
  if (!nextSchedule) route.unshift({ key: `mold-next-${identity}-schedule`, label: "待重新排程", active: false, reached: false, time: "" });
  // Put the next scheduled obligation immediately behind its preparation route.
  // The canceled mold obligation stays unfinished even when another test is next.
  if (nextName) {
    const resultIndex = retained.findIndex((step) => !step.active && !step.reached && step.label === `${nextName}未完成`);
    if (resultIndex >= 0) route.push(retained.splice(resultIndex, 1)[0]);
  }
  const anchor = retained.indexOf(recovery || cancellation);
  retained.splice(anchor >= 0 ? anchor + 1 : retained.length, 0, ...route);
  steps.splice(0, steps.length, ...retained);
}
