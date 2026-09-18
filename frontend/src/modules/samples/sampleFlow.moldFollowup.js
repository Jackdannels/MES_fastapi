import { normalizeHistoryFlowLabel } from "./sampleFlow.flowTimeHelpers";
import { WITHDRAWAL_ACTIONS } from "./sampleFlow.constants";
import { historyEntryAppliesToTray } from "./sampleFlow.runtimeEvidence";
import { normalizeText as text } from "./sampleFlow.shared";
import { asArray, parseTimeValue, resolveEntryExperimentCode, resolveEntryTaskCode, resolveEntryTrayCode } from "./sampleFlow.trayScope";

const labels = ["送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪"];
const keys = new Set(["sent_to_lab", "arrived_lab", "fixture_install", "ready"]);
const normalizeLabel = (step) => /^送至.*(?:实验室|试验室|一室|二室)$/.test(step.label) ? "送至实验室" : step.label;

// Scope the new preparation to evidence after this cancellation. In-place reruns
// need comparison/installation again, but must not invent a physical dispatch.
export function projectMoldFollowup(steps, input, { cancellation, recovery, relation }) {
  const status = text(input.status || input.flowStatus || input.flow_status);
  if (![...labels, "实验进行中", "实验中", "实验暂停", "实验已完成", "实验完成"].includes(status)) return;
  const taskCode = text(input.taskCode), trayCode = text(input.trayCode);
  let boundary = parseTimeValue(relation.ended_at || relation.updated_at);
  const samples = asArray(input.samples).filter((sample) => resolveEntryTaskCode(sample) === taskCode
    && asArray(sample.trays).some((tray) => resolveEntryTrayCode(tray) === trayCode));
  const tray = asArray(samples[0]?.trays).find((row) => resolveEntryTrayCode(row) === trayCode) || {};
  const code = text(tray.target_experiment_code || tray.targetExperimentCode || input.currentExperimentCode);
  if (!code) return;
  const experiment = asArray(input.experiments).find((row) => resolveEntryTaskCode(row) === taskCode && resolveEntryExperimentCode(row) === code);
  const name = text(experiment?.experiment_name || experiment?.experimentName || experiment?.name);
  const targetSchedule = text(tray.target_schedule_id || tray.targetScheduleId);
  const lab = text(tray.target_lab || tray.targetLab || input.location);
  const scopedHistory = samples.flatMap((sample) => asArray(sample.history).filter((entry) => historyEntryAppliesToTray(entry, sample, trayCode)));
  const scopedEvents = asArray(input.stagingEvents || input.staging_events).filter((entry) =>
    resolveEntryTaskCode(entry) === taskCode && resolveEntryTrayCode(entry) === trayCode);
  // A withdrawn outbound invalidates its preparation even within this new cycle.
  boundary = Math.max(boundary, ...scopedHistory.filter((entry) => WITHDRAWAL_ACTIONS.has(text(entry.action))).map((entry) => parseTimeValue(entry.time)),
    ...scopedEvents.filter((entry) => entry.action === "stock_out_withdraw").map((entry) => parseTimeValue(entry.time)));
  const matchesTarget = (entry) => {
    const entryCode = resolveEntryExperimentCode(entry) || text(entry.target_experiment_code);
    const entrySchedule = text(entry.target_schedule_id || entry.schedule_id || entry.scheduleId);
    if (entryCode && entryCode !== code) return false;
    if (targetSchedule && entrySchedule && entrySchedule !== targetSchedule) return false;
    const parts = text(entry.detail).split(" / ");
    return !(parts[0] === taskCode && parts.length >= 3 && name && parts[1] !== name);
  };
  const history = scopedHistory.filter((entry) => parseTimeValue(entry.time) > boundary && matchesTarget(entry)
    && (!lab || !text(entry.location) || text(entry.location) === lab));
  const events = scopedEvents.filter((entry) => parseTimeValue(entry.time) > boundary && matchesTarget(entry)
    && entry.action === "stock_out" && entry.target_type !== "staging"
    && (!lab || text(entry.target_lab) === lab));
  const timeFor = (label) => [
    ...history.filter((entry) => normalizeHistoryFlowLabel(entry.status, entry.location) === label).map((entry) => entry.time),
    ...(label === "送至实验室" ? events.map((entry) => entry.time) : []),
  ].sort((a, b) => parseTimeValue(b) - parseTimeValue(a))[0] || "";
  const preparation = steps.filter((step) => keys.has(step.key) || (/^route-\d+-\d+$/.test(step.key) && labels.includes(normalizeLabel(step))));
  if (!preparation.length) return;
  const route = [];
  for (const step of preparation) {
    const label = normalizeLabel(step);
    const time = timeFor(label);
    // The engine exposes the current route with generic keys; all its timestamps
    // must come from the selected attempt, never the canceled run.
    step.time = time;
    step.experimentCode = code;
    step.scheduleId = targetSchedule;
    step.labName = lab;
    step.reached = !step.active && (Boolean(time) || step.reached);
    step.inferred = step.reached && !time;
    if (label === "送至实验室" && !time && status !== "送至实验室") continue;
    route.push(step);
  }
  const retained = steps.filter((step) => !preparation.includes(step));
  // Keep actual storage/recovery history in front of the new route.
  let anchor = retained.indexOf(recovery || cancellation) + 1;
  const routeStart = Math.min(...route.filter((step) => step.time).map((step) => parseTimeValue(step.time)));
  retained.forEach((step, index) => {
    const time = parseTimeValue(step.time);
    if (index >= anchor && time > boundary && time < routeStart && (step.reached || step.active)) anchor = index + 1;
  });
  retained.splice(anchor, 0, ...route);
  steps.splice(0, steps.length, ...retained);
}
