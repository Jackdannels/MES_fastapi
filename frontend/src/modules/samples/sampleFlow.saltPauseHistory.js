import { normalizeHistoryFlowLabel } from "./sampleFlow.flowTimeHelpers";
import { historyEntryAppliesToTray } from "./sampleFlow.runtimeEvidence";

const text = (value) => String(value ?? "").trim();
const rows = (value) => Array.isArray(value) ? value : [];
const at = (value) => Date.parse(value) || 0;
const runNo = (row) => text(row?.run_no || row?.runNo || row?.id);
const taskCode = (row) => text(row?.task_code || row?.taskCode || row?.task_no);
const trayCode = (row) => text(row?.tray_code || row?.trayCode || row?.tray_no);
const normalStaging = (location) => text(location).includes("暂存间") && !text(location).includes("实验后");
const predecessorLabels = new Set(["到货", "送至暂存间", "已到达暂存间"]);

// A salt pause changes preparation inside the original experiment. It supplies
// no evidence of an earlier staging visit. Both consumers use this projection.
function presentSaltSprayPauseHistory(flow, input = {}) {
  const task = text(input.taskCode), tray = text(input.trayCode || flow.trayCode);
  const runs = rows(input.experimentRuns || input.experiment_runs);
  const relations = rows(input.experimentRunTrays || input.experiment_run_trays);
  const context = rows(input.experimentRunPauses || input.experiment_run_pauses)
    .map((pause, index) => ({ pause, index, run: runs.find((run) => runNo(run) === runNo(pause) && taskCode(run) === task) }))
    .filter(({ pause, run }) => run && text(pause.lab_code || pause.labCode) === "LAB_SALT"
      && ["实验暂停", "实验已恢复"].includes(text(pause.status || pause.pause_status))
      && ["实验暂停", "实验进行中", "实验中"].includes(text(run.status || run.run_status))
      && (relations.some((relation) => runNo(relation) === runNo(run) && taskCode(relation) === task && trayCode(relation) === tray)
        || rows(pause.inspection_tray_codes || pause.inspectionTrayCodes).includes(tray)))
    .sort((a, b) => at(a.pause.paused_at || a.pause.pausedAt) - at(b.pause.paused_at || b.pause.pausedAt) || a.index - b.index)
    .at(-1);
  if (!task || !tray || !context) return flow;

  const steps = rows(flow.steps);
  const dispatchIndex = steps.findLastIndex((step) => text(step.label) === "送至盐雾试验室");
  if (dispatchIndex < 0) return flow;
  const prefix = text(steps[dispatchIndex].key).match(/^(route-\d+-)/)?.[1];
  const isPredecessor = (step, index) => index < dispatchIndex && predecessorLabels.has(step.label)
    && (["arrived", "arrival"].includes(step.key)
      || (prefix ? text(step.key).startsWith(prefix) : ["sent_to_staging", "arrived_staging"].includes(step.key)));
  const cutoff = at(context.pause.paused_at || context.pause.pausedAt);
  const floor = Math.max(0, ...steps.slice(0, dispatchIndex).filter((step) => /(?:试验|实验)已完成$/.test(step.label)).map((step) => at(step.time)));
  const evidence = new Map();
  const record = (label, time) => {
    if (!predecessorLabels.has(label)) return;
    const timestamp = at(time);
    if ((cutoff && timestamp > cutoff) || (label !== "到货" && floor && timestamp && timestamp <= floor)) return;
    const times = evidence.get(label) || [];
    times.push(timestamp ? text(time) : "");
    evidence.set(label, times);
  };
  const samples = rows(input.samples).filter((sample) => taskCode(sample) === task
    && rows(sample.trays).some((entry) => trayCode(entry) === tray));
  for (const sample of samples) {
    for (const entry of rows(sample.history)) {
      if ((trayCode(entry) && trayCode(entry) !== tray)
        || (rows(entry.tray_codes).length && !entry.tray_codes.includes(tray))
        || !historyEntryAppliesToTray(entry, sample, tray)) continue;
      for (const value of [entry.status, entry.action, entry.detail]) {
        const label = normalizeHistoryFlowLabel(value, entry.location, { allowLocationFallback: false });
        record(label === "到货" && normalStaging(entry.location) ? "已到达暂存间" : label, entry.time || entry.updated_at);
      }
    }
  }
  for (const event of rows(input.stagingEvents || input.staging_events)) {
    if (trayCode(event) !== tray || taskCode(event) !== task) continue;
    const time = event.time || event.updated_at;
    const location = text(event.location), status = text(event.status);
    if (location.includes("实验后") || status.includes("实验后")) continue;
    if (text(event.room) === "staging" && ["stock_in", "stock_out_withdraw"].includes(text(event.action))) record("已到达暂存间", time);
    if (text(event.action) === "stock_out" && normalStaging(event.target_lab || event.targetLab)) record("送至暂存间", time);
  }
  return { ...flow, steps: steps.map((step, index) => {
    if (!isPredecessor(step, index)) return step;
    const times = evidence.get(step.label);
    const actualTimes = (times || []).filter(Boolean).sort((a, b) => at(a) - at(b));
    const time = (step.label === "到货" ? actualTimes[0] : actualTimes.at(-1)) || "";
    return { ...step, active: false, reached: Boolean(times), time, inferred: Boolean(times) && !time };
  }) };
}

export { presentSaltSprayPauseHistory };
