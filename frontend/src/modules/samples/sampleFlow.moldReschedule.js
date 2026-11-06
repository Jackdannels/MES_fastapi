import { SAMPLE_FLOW_STEPS } from "./sampleFlow.constants";
import { resolveNextMoldCancellationSchedule } from "./sampleFlow.moldPendingRoute";
import { normalizeText as text } from "./sampleFlow.shared";
import { normalizeLifecycleStatus } from "./sampleFlow.status";
import { asArray, parseTimeValue, resolveEntryExperimentCode, resolveEntryTaskCode, resolveEntryTrayCode } from "./sampleFlow.trayScope";

const completedStatuses = new Set(["实验已完成", "实验完成", "实验已经完成"]);
const previewStatuses = new Set([...completedStatuses, "实验后外观检测间存放", "送至外观检测间", "实验后暂存间存放", "送至暂存间", "已到达暂存间", "暂存间存放"]);
const preparationKeys = new Set(["sent_to_lab", "arrived_lab", "fixture_install", "ready"]);
const activeStatuses = new Set(["送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", "实验中", "实验暂停"]);
const relationStatus = (row) => text(row?.run_tray_status || row?.runTrayStatus || row?.status);
const relationTime = (row) => parseTimeValue(row?.ended_at || row?.endedAt || row?.updated_at || row?.updatedAt || row?.started_at || row?.startedAt);

// A new plan can be previewed after another test has really completed. It never
// changes the tray's physical location or supplies evidence of a new mold run.
export function resolveMoldReschedulePreview(input = {}) {
  const taskCode = text(input.taskCode), trayCode = text(input.trayCode);
  if (!taskCode || !trayCode) return null;
  const sample = asArray(input.samples).find((row) => resolveEntryTaskCode(row) === taskCode
    && asArray(row.trays).some((tray) => resolveEntryTrayCode(tray) === trayCode));
  const tray = asArray(sample?.trays).find((row) => resolveEntryTrayCode(row) === trayCode);
  const status = normalizeLifecycleStatus(sample?.location, tray?.status || input.status || sample?.status);
  if (!previewStatuses.has(status)) return null;
  const schedule = resolveNextMoldCancellationSchedule(input);
  const experimentCode = resolveEntryExperimentCode(schedule);
  const experiment = asArray(input.experiments).find((row) => resolveEntryTaskCode(row) === taskCode
    && resolveEntryExperimentCode(row) === experimentCode);
  const name = text(experiment?.experiment_name || experiment?.experimentName || experiment?.name);
  if (!schedule || !name.includes("霉菌")) return null;
  const relations = asArray(input.experimentRunTrays || input.experiment_run_trays)
    .filter((row) => resolveEntryTaskCode(row) === taskCode && resolveEntryTrayCode(row) === trayCode);
  const latestByExperiment = new Map();
  relations.forEach((row) => {
    const code = resolveEntryExperimentCode(row);
    if (!latestByExperiment.has(code) || relationTime(row) >= relationTime(latestByExperiment.get(code))) latestByExperiment.set(code, row);
  });
  const latestMold = latestByExperiment.get(experimentCode);
  if (relationStatus(latestMold) !== "实验已取消") return null;
  const canceledAt = relationTime(latestMold);
  if (!canceledAt) return null;
  const laterRelations = relations.filter((row) => relationTime(row) > canceledAt);
  if (!laterRelations.some((row) => resolveEntryExperimentCode(row) !== experimentCode && completedStatuses.has(relationStatus(row)))) return null;
  if (Array.from(latestByExperiment.values()).some((row) => activeStatuses.has(relationStatus(row)))) return null;
  return { schedule, experimentCode, name, actualLocation: text(sample?.location) };
}

export function presentMoldReschedule(flow, input = {}) {
  if (!input.previewExperimentCode) return flow;
  const preview = resolveMoldReschedulePreview(input);
  if (!preview || preview.experimentCode !== text(input.previewExperimentCode)) return flow;
  const scheduleId = text(preview.schedule.id || preview.schedule.schedule_id || preview.schedule.scheduleId);
  const labName = text(preview.schedule.device || preview.schedule.lab_name);
  const label = `${preview.name}已排程（待到达）`;
  const pendingLabel = `${preview.name}未完成`;
  const steps = asArray(flow.steps).filter((step) => (
    !preparationKeys.has(step.key)
    && !/^route-(?:\d+-\d+|final-\d+)$/.test(text(step.key))
    && step.label !== pendingLabel
  )).map((step) => ({ ...step, active: false, reached: Boolean(step.reached || step.active) }));
  const route = [
    { key: `mold-reschedule-${scheduleId}`, label, active: true, reached: false, time: "", planned: true },
    ...SAMPLE_FLOW_STEPS.filter((step) => preparationKeys.has(step.key)).map((step) => ({
      ...step,
      key: `mold-reschedule-${scheduleId}-${step.key}`,
      label: step.key === "sent_to_lab" ? `送至${labName}` : step.label,
      experimentCode: preview.experimentCode, scheduleId, labName,
      active: false, reached: false, time: "", planned: true,
    })),
    { key: `mold-reschedule-${scheduleId}-pending`, label: pendingLabel, active: false, reached: false, time: "", planned: true },
  ];
  const lastOccurred = steps.reduce((last, step, index) => step.reached ? index : last, -1);
  steps.splice(lastOccurred + 1, 0, ...route);
  return {
    ...flow,
    actualStatus: flow.status,
    actualLocation: preview.actualLocation,
    isSchedulePreview: true,
    canonicalStatus: "已排程",
    status: label,
    currentStatus: `当前托盘：${text(input.trayCode)} | 当前状态：${label}${preview.actualLocation ? `；实际位置：${preview.actualLocation}` : ""}`,
    displayRemark: [flow.displayRemark, preview.actualLocation ? `实际位置：${preview.actualLocation}` : ""].filter(Boolean).join("；"),
    steps,
  };
}
